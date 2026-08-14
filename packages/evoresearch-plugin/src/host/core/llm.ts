/**
 * LLM 调用辅助（基于 DSH 的 ctx.llm 流式服务）。
 *
 * EvoResearch 中分类器、Goal 提取等"后台小模型调用"在此统一封装：
 * - callText：一次性文本调用（流式收集）；
 * - callJson：JSON 结构化输出 + 宽松解析（支持代码块包裹、前后噪声裁剪），
 *   与 EvoResearch classifier 的"普通 JSON 输出 + 严格校验、失败回退"策略对齐。
 */
import type { Context } from '@deepseek-ai/cordis'
import { createMessage, type GenerateOptions, type Message } from '@deepseek-ai/dsh-llm'

/** 构造一条文本消息（ContentBlock 形态）。 */
export function textMessage(role: 'system' | 'user' | 'assistant', text: string): Message {
  return createMessage({ role, content: [{ type: 'text', text }], source: { kind: 'user' } })
}

/** 从流式迭代器收集文本；支持 finish/error chunk 语义。 */
export async function collectTextChunks(stream: AsyncIterable<unknown>): Promise<string> {
  let text = ''
  for await (const chunk of stream) {
    const c = chunk as { type?: string; text?: string; error?: unknown }
    if (c && typeof c === 'object' && c.type === 'error') {
      throw c.error instanceof Error ? c.error : new Error(String(c.error ?? '模型调用失败'))
    }
    if (c && typeof c === 'object' && typeof c.text === 'string') text += c.text
  }
  return text
}

/** 简单 LLM 调用参数。 */
export interface SimpleCallOptions {
  provider: string
  model: string
  system?: string
  messages: string[]
  maxTokens?: number
  signal?: AbortSignal
  /** 可选 reasoning effort。 */
  reasoningEffort?: string
}

/**
 * 调用一次模型（文本输出）。
 * @param ctx Cordis 上下文（提供 llm 服务）。
 * @param options 调用参数。
 * @returns 模型输出文本。
 */
export async function callText(ctx: Context, options: SimpleCallOptions): Promise<string> {
  const llm = ctx.get('llm')
  if (!llm) throw new Error('llm 服务不可用')
  const generate: GenerateOptions = {
    provider: options.provider,
    model: options.model,
    system: options.system,
    messages: options.messages.map((text, index) => textMessage(index === 0 ? 'user' : 'user', text)),
    maxTokens: options.maxTokens,
    signal: options.signal,
    ...(options.reasoningEffort ? { reasoningEffort: options.reasoningEffort as GenerateOptions['reasoningEffort'] } : {}),
  }
  return collectTextChunks(llm.stream(generate) as AsyncIterable<unknown>)
}

/**
 * 从模型输出中宽松提取 JSON（支持 ```json 代码块、首尾噪声）。
 * @param output 模型原始输出。
 * @returns 解析出的 JSON 值；无法解析时返回 undefined。
 */
export function extractJson(output: string): unknown | undefined {
  const trimmed = output.trim()
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed)
  const candidate = fenced ? fenced[1]! : trimmed
  // 裁剪到第一个 { 与最后一个 }（或 [ 与 ]）之间，容忍前后噪声。
  const start = candidate.search(/[\[{]/)
  const end = Math.max(candidate.lastIndexOf('}'), candidate.lastIndexOf(']'))
  if (start < 0 || end <= start) return undefined
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as unknown
  } catch {
    return undefined
  }
}

/**
 * 调用一次模型并要求 JSON 输出。
 * @returns 解析出的 JSON；解析失败时返回 undefined（由调用方决定回退策略）。
 */
export async function callJson(
  ctx: Context,
  options: SimpleCallOptions & { jsonInstruction: string },
): Promise<unknown | undefined> {
  const output = await callText(ctx, {
    ...options,
    system: [
      options.system ?? '',
      '你只输出一个 JSON 对象，不要输出任何其他内容、解释或 Markdown 代码块标记。',
      options.jsonInstruction,
    ].join('\n'),
  })
  return extractJson(output)
}

/** 估算一段文本的 token 数（中文约 1.5 字符/token，保守取 3 字符/token）。 */
export function estimateTokens(text: string): number {
  if (text.length === 0) return 0
  return Math.ceil(text.length / 3)
}
