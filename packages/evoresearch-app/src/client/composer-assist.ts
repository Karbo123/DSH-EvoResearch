/**
 * 输入辅助（移植规范 §23.2–23.5）：
 * - 斜杠命令候选（/）：目录从后端 dsh-commands 注册表动态读取；
 * - @文件 补全：按当前 workspace 递归文件树模糊搜索（§27.1 上限）；
 * - 输入历史：按 workspace 保存最近 200 条，输入时按内容匹配候选，空输入或普通输入均可用上下键浏览；
 * - 候选弹层：listbox/option 语义 + aria-activedescendant，Tab 应用、Esc 关闭。
 */
import { jsx, jsxs, Fragment } from 'react/jsx-runtime'
import { useEffect, useRef, useState } from 'react'
import { Folder, FileText, Command } from 'lucide-react'
import { t } from './i18n'

export interface Candidate {
  key: string
  title: string
  subtitle?: string
  kind: 'command' | 'file' | 'history'
  insert: string
}

export type TriggerKind = 'command' | 'mention' | 'history' | null

export interface Trigger {
  kind: TriggerKind
  /** 光标前的查询文本（不含触发符）。 */
  query: string
  /** 替换起点：从该下标到光标之间的文本将被候选替换。 */
  start: number
}

/** 发送给模型或渲染为用户消息前，去除输入两端的 Unicode 空白。 */
export function trimPromptEdges(value: string): string {
  return value.trim()
}

/** 分析输入与光标位置，得出当前激活的候选触发（无触发返回 null）。 */
export function detectTrigger(input: string, cursor: number): Trigger {
  const before = input.slice(0, cursor)
  // 行首斜杠命令：/name（光标前同词无空格）
  const lineStart = before.lastIndexOf('\n') + 1
  if (before[lineStart] === '/') {
    const word = before.slice(lineStart + 1)
    if (!/[\s/]/.test(word)) return { kind: 'command', query: word.toLowerCase(), start: lineStart }
  }
  // @文件：光标前最近一个 @，其后无空白
  const at = before.lastIndexOf('@')
  if (at !== -1 && at >= lineStart) {
    const word = before.slice(at + 1)
    if (!/[\s@]/.test(word)) return { kind: 'mention', query: word.toLowerCase(), start: at }
  }
  // 普通文本：按已输入内容匹配历史记录。候选弹层会明确说明其来源与 Tab 操作。
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
    const raw = JSON.parse(localStorage.getItem(historyKey(cwd)) ?? '[]')
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string').slice(0, HISTORY_CAP) : []
  } catch {
    return []
  }
}
export function pushHistory(cwd: string | null, text: string): void {
  try {
    const list = readHistory(cwd).filter((item) => item !== text)
    list.unshift(text)
    localStorage.setItem(historyKey(cwd), JSON.stringify(list.slice(0, HISTORY_CAP)))
  } catch { /* 存储不可用时忽略 */ }
}

interface CommandEntry { name: string; description: string; hint?: string }
interface FileEntry { path: string; isDir: boolean }

/** 平台/常见命令补充（§23.3 目录；agent 作用域命令不在全局注册表，静态镜像）。 */
const PLATFORM_COMMANDS: CommandEntry[] = [
  { name: 'help', description: '列出全部命令、参数、别名与说明' },
  { name: 'model', description: '切换当前模型；--save 同时写配置', hint: '[name] [--save]' },
  { name: 'model-fallback', description: '管理有序备用模型链', hint: 'list|add|remove|clear|save|help' },
  { name: 'compact', description: '对较早活跃上下文生成摘要投影（不删历史）' },
  { name: 'new', description: '开始新的 Thread' },
  { name: 'clear', description: '清理当前 UI/会话视图（不删持久数据）' },
  { name: 'threads', description: '列出最近持久会话' },
  { name: 'resume', description: '用唯一 Thread ID 或前缀恢复会话', hint: '<id-or-prefix>' },
  { name: 'delete', description: '永久删除指定会话（需确认）', hint: '<id-or-prefix>' },
  { name: 'current', description: '显示当前 Thread、workspace、模型与状态' },
  { name: 'skills', description: '按 workspace/global/built-in 三层列出技能' },
  { name: 'install-skill', description: '从本地目录或远端仓库安装技能', hint: '<source> [--local]' },
  { name: 'uninstall-skill', description: '删除可删除技能', hint: '<name>' },
  { name: 'experts', description: '列出已安装 Expert 及当前邀请状态' },
  { name: 'mcp', description: '管理 MCP server', hint: 'list|config|add|edit|remove|install' },
  { name: 'plan', description: '进入计划模式' },
  { name: 'exit', description: '退出' },
]

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
      setCatalog([...dynamic, ...PLATFORM_COMMANDS.filter((c) => !names.has(c.name))])
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])
  return catalog
}

/** 工作区递归文件树（按 root 缓存一次；§27.1 上限 2000/深度 12）。 */
const TREE_CACHE = new Map<string, FileEntry[]>()
export function useFileTree(cwd: string | null): FileEntry[] {
  const [tree, setTree] = useState<FileEntry[]>([])
  useEffect(() => {
    if (cwd === null) { setTree([]); return }
    const cached = TREE_CACHE.get(cwd)
    if (cached !== undefined) { setTree(cached); return }
    let cancelled = false
    void fetch('/evoresearch/fs/list-tree', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ root: cwd }),
    }).then((res) => res.json()).then((json) => {
      if (cancelled) return
      const entries: FileEntry[] = json.ok ? (json.value?.entries ?? []) : []
      TREE_CACHE.set(cwd, entries)
      setTree(entries)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [cwd])
  return tree
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
      candidates.map((c, index) => {
        const Icon = c.kind === 'command' ? Command : c.kind === 'file' ? (c.subtitle === 'folder' ? Folder : FileText) : FileText
        return jsxs('div', {
          className: 'evo-cand-item',
          'data-index': index,
          'data-active': index === active || undefined,
          role: 'option',
          'aria-selected': index === active || undefined,
          id: `evo-cand-${index}`,
          onPointerEnter: () => onActive(index),
          onPointerDown: (e: { preventDefault(): void }) => { e.preventDefault(); onApply(c) },
          children: [
            jsx(Icon, {}),
            jsxs('div', {
              className: 'evo-cand-text',
              children: [
                jsx('div', { className: 'evo-cand-title', children: c.title }),
                c.subtitle !== undefined && c.subtitle !== '' && jsx('div', { className: 'evo-cand-sub', children: c.subtitle }),
              ],
            }),
          ],
        }, c.key)
      }),
    ],
  })
}

/** 组装各触发源的候选列表（纯函数，便于测试）。 */
export function buildCandidates(trigger: Trigger, catalog: CommandEntry[], tree: FileEntry[], history: string[]): Candidate[] {
  if (trigger === null) return []
  if (trigger.kind === 'command') {
    return matchQuery(
      catalog.map((c) => ({ key: `cmd:${c.name}`, title: `/${c.name}`, subtitle: c.hint !== '' ? c.hint : c.description, kind: 'command' as const, insert: `/${c.name}` })),
      trigger.query,
    )
  }
  if (trigger.kind === 'mention') {
    const items: Candidate[] = tree.map((entry) => ({
      key: entry.path,
      title: entry.path,
      subtitle: entry.isDir ? t('folder') : undefined,
      kind: 'file' as const,
      insert: `@${entry.path}`,
    }))
    const q = trigger.query.trim().toLowerCase()
    // 排序：基名前缀 > 基名包含 > 全路径包含；无查询时保持树顺序
    const scored = items
      .map((item) => {
        const base = (item.title.split(/[\\/]/).pop() ?? item.title).toLowerCase()
        let score = 3
        if (q === '') score = 0
        else if (base.startsWith(q)) score = 0
        else if (base.includes(q)) score = 1
        else if (item.title.toLowerCase().includes(q)) score = 2
        return { item, score }
      })
      .filter((x) => x.score < 3)
      .sort((a, b) => a.score - b.score || a.item.title.localeCompare(b.item.title))
    return scored.slice(0, 8).map((x) => x.item)
  }
  // 保留历史候选的组装能力，实际触发由显式历史入口决定。
  if (trigger.query === '') return []
  return matchQuery(
    history.map((text) => ({ key: `hist:${text}`, title: text, kind: 'history' as const, insert: text })),
    trigger.query,
  )
}

/** 发送前解析 @引用（§23.4）：小型文本文件注入内容，其余保留路径。 */
export async function resolveMentions(text: string, cwd: string | null): Promise<string> {
  if (!text.includes('@') || cwd === null) return text
  const tokens = text.match(/@(\S+)/g) ?? []
  if (tokens.length === 0) return text
  const MAX_INLINE_BYTES = 16 * 1024
  const resolved = await Promise.all(tokens.map(async (token) => {
    const ref = token.slice(1)
    const path = ref.startsWith('/') || /^[A-Za-z]:[\\/]/.test(ref) ? ref : `${cwd}\\${ref.replace(/\//g, '\\')}`
    try {
      const res = await fetch('/evoresearch/fs/read', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path }),
      })
      const json = await res.json()
      if (!json.ok) return null
      const content: string = json.value?.text ?? ''
      if (content.length > MAX_INLINE_BYTES) return null
      return { token, block: `[@${ref}]\n\`\`\`\n${content}\n\`\`\`` }
    } catch {
      return null
    }
  }))
  let out = text
  for (const item of resolved) {
    if (item !== null) out = out.replace(item.token, item.block)
  }
  return out
}
