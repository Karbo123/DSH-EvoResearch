/**
 * P1-3 ask_researcher 模型工具（平台适配路径）。
 *
 * 背景：rc.8 平台提供 ctx.userQuestions（UserQuestionService.ask(request) →
 * Promise<AskUserQuestionAnswer>），web 侧问题卡 UI 已在工作台实现；本工具是
 * 模型侧薄封装，让科研对话能用结构化追问（实验设计取舍、消融顺序确认等需要
 * 用户拍板的场景）。
 *
 * 降级语义：
 * - userQuestions 服务缺失 → 注册器直接告警返回 undefined，不伪造能力；
 * - uq.ask reject（用户关闭卡片等）→ { ok:false, note }，不抛异常；
 * - 超时无人回答 → { ok:false, timed_out:true, note }，不卡死会话。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import type {
  AskUserQuestionAnswer,
  AskUserQuestionItem,
  AskUserQuestionOption,
} from '@deepseek-ai/dsh-user-questions/types'

/** ask 请求的最小结构（@deepseek-ai/dsh-user-questions AskUserQuestionRequest）。 */
interface AskUserQuestionRequest {
  questions: AskUserQuestionItem[]
  agent?: unknown
  signal?: AbortSignal
}

/** 注册选项。 */
export interface AskResearcherOptions {
  /** 等待回答的超时毫秒数（默认 600_000 = 10 分钟）。 */
  timeoutMs?: number
}

/** userQuestions 服务的最小结构契约（@deepseek-ai/dsh-user-questions）。 */
interface UserQuestionsLike {
  ask(request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer>
}

/** 工具输出（wire JSON，snake_case）。 */
export interface AskResearcherOutput {
  ok: boolean
  selected?: string[]
  custom?: string
  timed_out?: boolean
  note?: string
}

/** 构造一个 JSON Schema 参数定义（与 memory/tools.ts 一致）。 */
function paramsSchema(properties: Record<string, unknown>, required: readonly string[] = []): Record<string, unknown> {
  return { type: 'object', properties, required, additionalProperties: false }
}

/** 文本输出渲染。 */
function textRender(_args: unknown, value: unknown): Array<{ type: 'text'; text: string }> {
  return [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }]
}

/** 默认等待时长：10 分钟。 */
const DEFAULT_TIMEOUT_MS = 600_000

/** options 归一化上限（防御性截断）。 */
const MAX_OPTIONS = 6

/**
 * 注册 ask_researcher 工具。
 * @returns 解除注册的 disposer；userQuestions 服务缺失时告警并返回 undefined。
 */
export function registerAskResearcherTool(ctx: Context, options?: AskResearcherOptions): (() => void) | undefined {
  const uq = ctx.get('userQuestions') as UserQuestionsLike | undefined
  if (!uq || typeof uq.ask !== 'function') {
    console.warn('[evoresearch:tools] userQuestions 服务不可用，ask_researcher 未注册（追问将退化为普通文本提问）')
    return undefined
  }
  const tools = ctx.get('tools') as { register(definition: ToolDefinition): () => void } | undefined
  if (!tools) return undefined

  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS

  const definition: ToolDefinition = {
    name: 'ask_researcher',
    description:
      '向研究者提出结构化追问并等待回答。适合实验设计取舍（对比方法选官方实现还是社区复现？）、' +
      '消融顺序确认等需要用户拍板的场景。用户回答（选项/自定义文本）会作为工具结果返回；' +
      '无人值守或超时会降级返回提示，不会卡死会话。',
    parameters: paramsSchema(
      {
        question: { type: 'string', description: '一个问题，一句话说清选项间的取舍点' },
        options: {
          type: 'array',
          description: '2-4 个互斥选项；不需要选项时可省略，仅收自由文本',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string', description: '选项标签' },
              description: { type: 'string', description: '选项补充说明（可选）' },
            },
            required: ['label'],
          },
        },
        multi_select: { type: 'boolean', description: '是否允许多选（默认单选）' },
        free_text_hint: { type: 'string', description: '自由文本输入框的占位提示' },
      },
      ['question'],
    ),
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          selected: { type: 'array', items: { type: 'string' } },
          custom: { type: 'string' },
          timed_out: { type: 'boolean' },
          note: { type: 'string' },
        },
      },
      render: textRender,
    },
    execute: async (args, exec): Promise<AskResearcherOutput> => {
      const input = args as {
        question?: string
        options?: Array<{ label?: string; description?: string }>
        multi_select?: boolean
        free_text_hint?: string
      }
      // 1) 必填校验 + options 归一化（label 非空，最多 MAX_OPTIONS 个）
      const question = typeof input.question === 'string' ? input.question.trim() : ''
      if (question === '') {
        return { ok: false, note: 'question 必填：请用一句话说清要确认的取舍点' }
      }
      const normalizedOptions: AskUserQuestionOption[] = (Array.isArray(input.options) ? input.options : [])
        .map((option) => ({
          label: typeof option?.label === 'string' ? option.label.trim() : '',
          ...(typeof option?.description === 'string' && option.description.trim() !== '' ? { description: option.description.trim() } : {}),
        }))
        .filter((option) => option.label !== '')
        .slice(0, MAX_OPTIONS)

      // 2) 组装请求（无有效选项时不带 options 字段，仅收自由文本）
      const item: AskUserQuestionItem = {
        id: 'q1',
        question,
        ...(normalizedOptions.length > 0 ? { options: normalizedOptions } : {}),
        multiSelect: input.multi_select === true,
      }
      // free_text_hint 走 detail 通道（UI 渲染在问题旁、不进选项标签）
      if (typeof input.free_text_hint === 'string' && input.free_text_hint.trim() !== '') {
        item.detail = input.free_text_hint.trim()
      }

      // 3) 发起提问 + 超时竞速
      const execAny = exec as { agent?: unknown; signal?: AbortSignal }
      const askPromise = uq.ask({ questions: [item], agent: execAny?.agent as never, signal: execAny?.signal })
      let timer: NodeJS.Timeout | undefined
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('__ask_timeout__')), timeoutMs)
      })
      try {
        const answer = await Promise.race([askPromise, timeoutPromise])
        // 5) 成功：按 id 取回答案，透传 selected/custom
        const matched = answer.answers.find((entry) => entry.id === 'q1')
        return {
          ok: true,
          ...(matched?.selected?.length ? { selected: [...matched.selected] } : {}),
          ...(matched?.custom ? { custom: matched.custom } : {}),
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (message === '__ask_timeout__') {
          // 4a) 超时降级：不卡死会话
          return { ok: false, timed_out: true, note: '用户暂未回答（超过 10 分钟），已降级：请以普通文本继续对话，稍后再询问' }
        }
        // 4b) 用户关闭卡片 / 服务拒绝：同样降级为提示
        return { ok: false, note: message }
      } finally {
        if (timer !== undefined) clearTimeout(timer)
      }
    },
  }

  return tools.register(definition)
}
