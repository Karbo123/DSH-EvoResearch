/**
 * 输入辅助（移植规范 §23.2–23.5）：
 * - 斜杠命令候选（/）：目录从后端 dsh-commands 注册表动态读取；
 * - @引用：使用 DSH 官方 grammar，候选由 file/session reference Remote 提供；
 * - 输入历史：按 workspace 保存最近 200 条；
 * - 候选弹层：listbox/option 语义（Tab 应用、Esc 关闭）。
 */
import { jsx, jsxs } from 'react/jsx-runtime'
import { useEffect, useRef, useState } from 'react'
import { Folder, FileText, Command, MessagesSquare } from 'lucide-react'
import { activeAtToken, formatFileMention } from '@deepseek-ai/dsh-file-reference/grammar'
import type { FileReferenceCandidate } from '@deepseek-ai/dsh-file-reference/types'
import type { SessionReferenceMentionCandidate } from '@deepseek-ai/dsh-session-reference/types'
import { t } from './i18n'
import { clientStateGet, clientStateSet } from './client-state'

export interface Candidate {
  key: string
  title: string
  subtitle?: string
  kind: 'command' | 'file' | 'folder' | 'session' | 'history'
  insert: string
}

export type TriggerKind = 'command' | 'mention' | 'history' | null

export interface Trigger {
  kind: TriggerKind
  /** 光标前的查询文本（不含触发符）。 */
  query: string
  /** 替换起点：从该下标到光标之间的文本将被候选替换。 */
  start: number
  /** @ token 是否由引号形式开启。 */
  quoted?: boolean
  /** 当前完整触发 token；编辑器适配层以此校验局部替换范围。 */
  prefix?: string
}

export interface ReferenceCandidates {
  files: FileReferenceCandidate[]
  sessions: SessionReferenceMentionCandidate[]
}

export interface CandidateReplacement {
  value: string
  cursor: number
}

/** 发送给模型或渲染为用户消息前，去除输入两端的 Unicode 空白。 */
export function trimPromptEdges(value: string): string {
  return value.trim()
}

/** 分析输入与光标位置，得出当前激活的候选触发（无触发返回 null）。 */
export function detectTrigger(input: string, cursor: number): Trigger {
  const safeCursor = Math.max(0, Math.min(cursor, input.length))
  const before = input.slice(0, safeCursor)
  const lineStart = before.lastIndexOf('\n') + 1
  const line = input.slice(lineStart, safeCursor)

  if (line[0] === '/') {
    const word = line.slice(1)
    if (!/[\s/]/.test(word)) return { kind: 'command', query: word.toLowerCase(), start: lineStart, prefix: `/${word}` }
  }

  const token = activeAtToken(line, line.length)
  if (token !== undefined) {
    return {
      kind: 'mention',
      query: token.query,
      start: safeCursor - token.prefix.length,
      quoted: token.quoted,
      prefix: token.prefix,
    }
  }

  // 保留普通文本按内容匹配历史记录的既有行为。
  if (input.trim() !== '') return { kind: 'history', query: before.toLowerCase(), start: 0 }
  return null
}

/** 子串包含匹配（大小写不敏感）。 */
export function matchQuery(items: Candidate[], query: string): Candidate[] {
  const q = query.trim().toLowerCase()
  if (q === '') return items.slice(0, 8)
  return items.filter((item) => item.title.toLowerCase().includes(q)).slice(0, 8)
}

/** 历史（§23.5）：每 workspace 最近 200 条，localStorage 键含 cwd。 */
const HISTORY_CAP = 200
function historyKey(cwd: string | null): string {
  return `evoresearch-input-history:${cwd ?? '__new__'}`
}
export function readHistory(cwd: string | null): string[] {
  try {
    const raw = JSON.parse(clientStateGet(historyKey(cwd)) ?? '[]')
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string').slice(0, HISTORY_CAP) : []
  } catch {
    return []
  }
}
export function pushHistory(cwd: string | null, text: string): void {
  const list = readHistory(cwd).filter((item) => item !== text)
  list.unshift(text)
  clientStateSet(historyKey(cwd), JSON.stringify(list.slice(0, HISTORY_CAP)))
}

interface CommandEntry { name: string; description: string; hint?: string }

/** 平台命令静态补充；其余命令由后端注册表动态返回。 */
const PLATFORM_COMMANDS: CommandEntry[] = [
  { name: 'compact', description: 'Generate a summary projection of earlier active context (keeps history)', _i18nKey: 'cmdCompactDesc' },
  { name: 'plan', description: 'Enter plan mode', _i18nKey: 'cmdPlanDesc' },
] as Array<CommandEntry & { _i18nKey?: string }>

/** 命令目录：后端注册表动态读取 + 平台命令补充（按名称去重）。 */
export function useCommandCatalog(): CommandEntry[] {
  const [catalog, setCatalog] = useState<CommandEntry[]>([])
  useEffect(() => {
    let cancelled = false
    void fetch('/evoresearch/fs/commands', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }).then((res) => res.json()).then((json) => {
      if (cancelled) return
      const dynamic: CommandEntry[] = json.ok && Array.isArray(json.value?.commands) ? json.value.commands : []
      const names = new Set(dynamic.map((c) => c.name))
      const platform = PLATFORM_COMMANDS.filter((c) => !names.has(c.name)).map((c) => (c as any)._i18nKey ? { ...c, description: t((c as any)._i18nKey) } : c)
      setCatalog([...dynamic, ...platform])
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])
  return catalog
}

function basename(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] || path
}

function parentPath(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const slash = normalized.lastIndexOf('/')
  return slash > 0 ? normalized.slice(0, slash) : ''
}

// 弹层展示上限：官方 Remote 单次最多返回 20 个文件候选和 50 个会话候选，
// 全量渲染既超出弹层可用高度，也远超一次补全的浏览需求。
const MAX_FILE_CANDIDATES = 8
const MAX_SESSION_CANDIDATES = 6

/** 把官方 file/session discovery 结果映射为 EvoResearch 现有弹层的数据。 */
export function buildReferenceCandidates(trigger: Trigger, source: ReferenceCandidates): Candidate[] {
  if (trigger.kind !== 'mention') return []
  const files: Candidate[] = source.files.flatMap((entry) => {
    const insert = formatFileMention(entry, trigger.quoted === true)
    if (insert === undefined) return []
    const parent = parentPath(entry.path)
    const folder = entry.kind === 'directory'
    return [{
      key: `file:${entry.kind}:${entry.path}`,
      title: basename(entry.path),
      subtitle: folder
        ? [parent, t('folder')].filter(Boolean).join(' · ')
        : parent || undefined,
      kind: folder ? 'folder' : 'file',
      insert,
    }]
  })
  // 引号形式是官方约定的「只搜文件」模式，会话候选不参与。
  if (trigger.quoted === true) return files.slice(0, MAX_FILE_CANDIDATES)
  const sessions: Candidate[] = source.sessions.map((entry) => ({
    key: `session:${entry.sessionId}`,
    title: entry.label,
    subtitle: entry.sameWorkspace
      ? t('sameWorkspace')
      : [t('otherWorkspace'), entry.cwd].filter(Boolean).join(' · '),
    kind: 'session',
    insert: entry.mention,
  }))
  return [...files.slice(0, MAX_FILE_CANDIDATES), ...sessions.slice(0, MAX_SESSION_CANDIDATES)]
}

/** 用触发区间替换纯文本草稿；目录 mention 以尾部 / 结束并继续保持补全。 */
export function replaceTriggerText(input: string, cursor: number, trigger: Trigger | null, insert: string): CandidateReplacement {
  const safeCursor = Math.max(0, Math.min(cursor, input.length))
  if (trigger === null || (trigger.kind !== 'mention' && trigger.kind !== 'command')) {
    return { value: insert, cursor: insert.length }
  }
  const value = input.slice(0, trigger.start) + insert + input.slice(safeCursor)
  return { value, cursor: trigger.start + insert.length }
}

/** 候选弹层（listbox/option 语义，Tab 应用、Esc 关闭）。 */
export function CandidatePopup({
  candidates,
  active,
  onActive,
  onApply,
  onClose,
  label,
  hint,
}: {
  candidates: Candidate[]
  active: number
  onActive: (index: number) => void
  onApply: (candidate: Candidate) => void
  onClose: () => void
  label: string
  hint: string
}) {
  const listRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = listRef.current
    if (el === null) return
    const item = el.querySelector<HTMLElement>(`[data-index="${active}"]`)
    item?.scrollIntoView({ block: 'nearest' })
  }, [active, candidates.length])

  if (candidates.length === 0) return null
  return jsxs('div', {
    className: 'evo-cand',
    role: 'listbox',
    'aria-label': label,
    ref: listRef,
    children: [
      jsxs('div', {
        className: 'evo-cand-head',
        children: [
          jsx('span', { className: 'evo-cand-label', children: label }),
          jsx('span', { className: 'evo-cand-hint', children: hint }),
        ],
      }),
      candidates.map((candidate, index) => {
        const Icon = candidate.kind === 'command'
          ? Command
          : candidate.kind === 'folder'
            ? Folder
            : candidate.kind === 'session'
              ? MessagesSquare
              : FileText
        return jsxs('div', {
          className: 'evo-cand-item',
          'data-index': index,
          'data-active': index === active || undefined,
          'data-kind': candidate.kind,
          role: 'option',
          'aria-selected': index === active || undefined,
          id: `evo-cand-${index}`,
          onPointerEnter: () => onActive(index),
          onPointerDown: (event: { preventDefault(): void }) => { event.preventDefault(); onApply(candidate) },
          children: [
            jsx(Icon, {}),
            jsxs('div', {
              className: 'evo-cand-text',
              children: [
                jsx('div', { className: 'evo-cand-title', children: candidate.title }),
                candidate.subtitle !== undefined && candidate.subtitle !== '' && jsx('div', { className: 'evo-cand-sub', children: candidate.subtitle }),
              ],
            }),
          ],
        }, candidate.key)
      }),
    ],
  })
}

/** 组装命令和历史候选；@引用由异步官方 Remote 结果单独组装。 */
export function buildCandidates(trigger: Trigger, catalog: CommandEntry[], history: string[]): Candidate[] {
  if (trigger.kind === 'command') {
    return matchQuery(
      catalog.map((command) => ({
        key: `cmd:${command.name}`,
        title: `/${command.name}`,
        subtitle: command.hint != null && command.hint !== '' ? command.hint : command.description,
        kind: 'command' as const,
        insert: `/${command.name}`,
      })),
      trigger.query,
    )
  }
  if (trigger.kind === 'history' && trigger.query !== '') {
    return matchQuery(
      history.map((text) => ({ key: `hist:${text}`, title: text, kind: 'history' as const, insert: text })),
      trigger.query,
    )
  }
  return []
}
