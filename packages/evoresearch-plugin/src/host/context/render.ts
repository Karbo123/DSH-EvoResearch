/**
 * CTX-08 上下文渲染：把组装好的材料渲染成给模型的"自然语言阅读材料"
 * （Markdown），而不是把项目状态序列化成字段。
 *
 * 结构：
 * 1. 当前分支背景（最近聊天 + Graph 记忆）；
 * 2. 相关原文片段（含内部定位，供 Agent 调用工具继续阅读）；
 * 3. 相连笔记/论文/实验短摘录；
 * 4. 继续深入读取位置。
 *
 * CTX-11：按 token/字符预算填充，优先级从高到低；低相关内容不为填满
 * 预算注入；预算耗尽时后续片段只保留"继续读取"入口。
 */
import { estimateProjectionTokens } from './window.js'

/** 每 token 字符数（与 window.ts 默认一致）。 */
const CHARS_PER_TOKEN = 3

/** 片段渲染输入（与 SearchCandidate 同源，但只取渲染需要的字段）。 */
export interface RenderSnippet {
  readonly id: string
  readonly kind: string
  readonly title: string
  readonly text: string
  /** 内部定位（模型可见；普通用户界面不展示）。 */
  readonly location: string
  /** 是否来自 Graph 明确连接（渲染时加注）。 */
  readonly connected?: boolean
}

/** 继续深入读取入口。 */
export interface ContinueReadEntry {
  readonly label: string
  /** 工具调用提示（如 read_research_turn(turnId=…)）。 */
  readonly hint: string
  /** 内部定位。 */
  readonly location: string
}

/** 渲染输入。 */
export interface RenderInput {
  readonly sessionId: string
  /** 当前用户问题（标题行）。 */
  readonly question: string
  /** 当前分支背景文本（最近聊天；可为空串）。 */
  readonly branchBackground?: string
  /** Graph 记忆文本（可为空串）。 */
  readonly graphBackground?: string
  /** 相关原文片段（按分数降序传入；内部再按预算截断）。 */
  readonly snippets?: readonly RenderSnippet[]
  /** 相连资料短摘录（笔记/论文/实验；优先级低于原文片段）。 */
  readonly excerpts?: readonly RenderSnippet[]
  /** 继续深入读取入口。 */
  readonly continueRead?: readonly ContinueReadEntry[]
  /** token 预算（默认 6000）。 */
  readonly tokenBudget?: number
}

/** 渲染出的一个章节。 */
export interface RenderedSection {
  readonly id: string
  readonly title: string
  readonly text: string
  readonly estimatedTokens: number
}

/** 渲染结果。 */
export interface RenderedMaterial {
  readonly text: string
  readonly estimatedTokens: number
  readonly sections: readonly RenderedSection[]
  /** 被预算截断的片段 id（CTX-10 效果信号用）。 */
  readonly truncatedIds: readonly string[]
}

/** 定位行（内部定位标签，机器可读）。 */
export function locationLine(location: string): string {
  return `[定位: ${location}]`
}

/**
 * 渲染整份阅读材料（CTX-08 + CTX-11）。
 * 预算分配顺序：问题 → 分支背景 → Graph 记忆 → 原文片段 → 短摘录 →
 * 继续读取入口；任一环节超出剩余预算即停止填充正文，只保留入口。
 */
export function renderReadingMaterial(input: RenderInput): RenderedMaterial {
  const budgetChars = (input.tokenBudget ?? 6000) * CHARS_PER_TOKEN
  const sections: RenderedSection[] = []
  const truncatedIds: string[] = []
  let used = 0

  const pushSection = (id: string, title: string, body: string): boolean => {
    const text = body.trim()
    if (text === '') return true
    const tokens = estimateProjectionTokens(text)
    if (used + tokens > budgetChars / CHARS_PER_TOKEN) {
      // 预算耗尽：不再填充正文（不注入低相关内容）
      return false
    }
    sections.push({ id, title, text, estimatedTokens: tokens })
    used += tokens
    return true
  }

  // 1) 当前问题
  pushSection('question', '当前问题', input.question)

  // 2) 当前分支背景
  const branchParts: string[] = []
  if (input.branchBackground && input.branchBackground.trim() !== '') branchParts.push(input.branchBackground.trim())
  if (input.graphBackground && input.graphBackground.trim() !== '') {
    branchParts.push(`【Graph 记忆】\n${input.graphBackground.trim()}`)
  }
  pushSection('background', '当前分支背景', branchParts.join('\n\n'))

  // 3) 相关原文片段（含内部定位）
  const snippetParts: RenderedSection[] = []
  const allSnippets = input.snippets ?? []
  for (let index = 0; index < allSnippets.length; index++) {
    const snippet = allSnippets[index]!
    const text = snippet.text.trim()
    if (text === '') continue
    const body = [
      `- 【${snippet.kind}${snippet.connected ? ' · Graph 连接' : ''}】${snippet.title}`,
      ...text.split('\n').map((line) => `  ${line}`),
      `  ${locationLine(snippet.location)}`,
    ].join('\n')
    const section: RenderedSection = {
      id: `snippet:${snippet.id}`,
      title: snippet.title,
      text: body,
      estimatedTokens: estimateProjectionTokens(body),
    }
    if (used + section.estimatedTokens > budgetChars / CHARS_PER_TOKEN) {
      // 预算耗尽：本片段及之后全部不注入（CTX-11）
      truncatedIds.push(...allSnippets.slice(index).map((snippet) => snippet.id))
      break
    }
    snippetParts.push(section)
    used += section.estimatedTokens
  }
  if (snippetParts.length > 0) {
    sections.push({
      id: 'snippets',
      title: '相关原文片段',
      text: snippetParts.map((section) => section.text).join('\n'),
      estimatedTokens: snippetParts.reduce((sum, section) => sum + section.estimatedTokens, 0),
    })
  }

  // 4) 相连资料短摘录（笔记/论文/实验）
  const excerptParts: string[] = []
  for (const excerpt of input.excerpts ?? []) {
    const text = excerpt.text.trim()
    if (text === '') continue
    const body = [
      `- 【${excerpt.kind}】${excerpt.title}`,
      ...text.split('\n').map((line) => `  ${line}`),
      `  ${locationLine(excerpt.location)}`,
    ].join('\n')
    const tokens = estimateProjectionTokens(body)
    if (used + tokens > budgetChars / CHARS_PER_TOKEN) {
      truncatedIds.push(excerpt.id)
      break
    }
    excerptParts.push(body)
    used += tokens
  }
  if (excerptParts.length > 0) {
    sections.push({
      id: 'excerpts',
      title: '相连资料短摘录',
      text: excerptParts.join('\n'),
      estimatedTokens: excerptParts.reduce((sum, body) => sum + estimateProjectionTokens(body), 0),
    })
  }

  // 5) 继续深入读取入口（始终保留——不占太多预算，且是"读原文"的钥匙）
  const entries = input.continueRead ?? []
  if (entries.length > 0) {
    const lines = entries.map((entry) => `- ${entry.label}：\`${entry.hint}\`（${entry.location}）`)
    const text = lines.join('\n')
    sections.push({
      id: 'continue-read',
      title: '继续深入读取',
      text,
      estimatedTokens: estimateProjectionTokens(text),
    })
  }

  const text = [
    '<context_reading_material>',
    ...sections.map((section) => `## ${section.title}\n${section.text}`),
    '</context_reading_material>',
  ].join('\n\n')

  return {
    text,
    estimatedTokens: estimateProjectionTokens(text),
    sections,
    truncatedIds,
  }
}
