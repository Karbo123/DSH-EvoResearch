/**
 * 视觉检查能力：调用视觉模型分析截图/图片（用于 GUI 效果验收与回归检查）。
 *
 * 模型配置（OpenAI 兼容端点）：
 * - 读取 D:\ResearchOS\.env 或环境变量：
 *   RESEARCH_VISION_MODEL / RESEARCH_VISION_MODEL_URL / RESEARCH_VISION_MODEL_KEY
 * - 插件配置 evoresearch.visionEnabled 开启后注册 vision_check 模型工具。
 */
import type { Context } from '@deepseek-ai/cordis'
import { readFileSync, existsSync } from 'node:fs'

/** 视觉模型配置。 */
export interface VisionConfig {
  readonly model: string
  readonly url: string
  readonly key: string
}

/** 从 .env 文件解析键值。 */
function parseEnvFile(file: string): Record<string, string> {
  const result: Record<string, string> = {}
  if (!existsSync(file)) return result
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const idx = trimmed.indexOf('=')
    if (idx <= 0) continue
    result[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '')
  }
  return result
}

/** 解析视觉模型配置（.env 优先于环境变量）。 */
export function resolveVisionConfig(): VisionConfig | undefined {
  const env = { ...parseEnvFile('D:\\ResearchOS\\.env'), ...process.env }
  const model = env['RESEARCH_VISION_MODEL']
  const url = env['RESEARCH_VISION_MODEL_URL']
  const key = env['RESEARCH_VISION_MODEL_KEY']
  if (!model || !url || !key) return undefined
  return { model, url: url.replace(/\/+$/, ''), key }
}

/**
 * 调用视觉模型分析一张本地图片。
 * @param imagePath 图片路径。
 * @param instruction 检查指令。
 * @returns 模型分析文本。
 */
export async function analyzeImage(config: VisionConfig, imagePath: string, instruction: string): Promise<string> {
  if (!existsSync(imagePath)) throw new Error(`图片不存在: ${imagePath}`)
  const base64 = readFileSync(imagePath).toString('base64')
  const mime = imagePath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg'
  const body = {
    model: config.model,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: instruction },
          { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } },
        ],
      },
    ],
    max_tokens: 1024,
  }
  const response = await fetch(`${config.url}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${config.key}` },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 400)
    throw new Error(`视觉模型调用失败（${response.status}）: ${detail}`)
  }
  const data = (await response.json()) as { choices?: Array<{ message?: { content?: unknown } }> }
  const text = data?.choices?.[0]?.message?.content
  if (typeof text !== 'string') throw new Error('视觉模型响应异常')
  return text
}

/** 注册 vision_check 模型工具（仅在配置就绪且启用时）。 */
export function registerVisionTool(ctx: Context, enabled: boolean): (() => void) | undefined {
  const config = resolveVisionConfig()
  if (!enabled || !config) return undefined
  const tools = ctx.get('tools')
  if (!tools) return undefined
  return tools.register({
    name: 'vision_check',
    description: '视觉检查：调用视觉模型分析一张本地截图或图片，用于验收 GUI 效果、检查排版与显示问题。',
    parameters: {
      type: 'object',
      properties: {
        image_path: { type: 'string', description: '本地图片/截图的绝对路径（png/jpg）' },
        instruction: { type: 'string', description: '检查指令（可省略，默认描述内容并指出视觉问题）' },
      },
      required: ['image_path'],
      additionalProperties: false,
    },
    output: {
      schema: { type: 'object', properties: { analysis: { type: 'string' } } },
      render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
    },
    async execute(args) {
      const input = args as { image_path: string; instruction?: string }
      const instruction = input.instruction?.trim() || '请详细描述这张截图的内容，并指出任何视觉问题（排版、布局、报错、黑屏、控制台窗口等）。'
      const analysis = await analyzeImage(config, input.image_path, instruction)
      return { analysis }
    },
  })
}
