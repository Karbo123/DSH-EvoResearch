/**
 * 会话动作（移植规范 §25.6 / §26.8）：
 * - Current 弹窗：Thread ID / workspace / 模型 / token·context / 专家 / 事件数 /
 *   持久化文件路径与大小 + Clear view（清空展示，不删数据，刷新恢复）；
 * - Search 弹窗：先搜当前 DOM 已加载消息，Full history 走后端全文搜索（§9.5）；
 * - Shortcuts 弹窗：键盘规则表（§23.2）。
 */
import { jsx, jsxs, Fragment } from 'react/jsx-runtime'
import { useEffect, useState, useRef } from 'react'
import { X, Search, Keyboard, FileText, Eraser, Copy, Check } from 'lucide-react'
import { toast } from './toast'
import { t } from './i18n'

/** 模态外壳（与设置弹窗同视觉）。§30.2：打开聚焦首个可操作元素，关闭恢复触发按钮焦点。 */
function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: any }) {
  const shellRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const el = shellRef.current?.querySelector<HTMLElement>('button, input, textarea, [tabindex]')
    el?.focus()
    return () => { previous?.focus?.() }
  }, [])
  return jsxs('div', {
    className: 'evo-modal-mask',
    ref: shellRef,
    onPointerDown: (e: { target: HTMLElement; currentTarget: HTMLElement }) => { if (e.target === e.currentTarget) onClose() },
    children: [
      jsxs('div', {
        className: 'evo-modal',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': title,
        children: [
          jsxs('div', {
            className: 'evo-modal-head',
            children: [
              jsx('div', { className: 'evo-modal-title', children: title }),
              jsx('button', { type: 'button', className: 'evo-icon-btn', onClick: onClose, title: t('close'), 'aria-label': t('close'), children: jsx(X, {}) }),
            ],
          }),
          jsx('div', { className: 'evo-modal-body', children }),
        ],
      }),
    ],
  })
}

function Row({ label, children, mono }: { label: string; children: any; mono?: boolean }) {
  return jsxs('div', {
    className: 'evo-info-row',
    children: [
      jsx('span', { className: 'evo-info-label', children: label }),
      jsx('span', { className: `evo-info-value${mono ? ' evo-info-mono' : ''}`, children }),
    ],
  })
}

function fmtBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${n} B`
}

function fmtTokens(n: number | undefined): string {
  if (n === undefined) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(0)}k`
  return String(n)
}

/** 复制小按钮。 */
function CopyCell({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return jsx('button', {
    type: 'button',
    className: 'evo-info-copy',
    title: copied ? t('copied') : t('copy'),
    'aria-label': copied ? t('copied') : t('copy'),
    onClick: (e: { stopPropagation(): void }) => {
      e.stopPropagation()
      try { void navigator.clipboard?.writeText(text) } catch { /* 忽略 */ }
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    },
    children: copied ? jsx(Check, {}) : jsx(Copy, {}),
  })
}

/** Current 弹窗（§26.8）。 */
export function CurrentDialog({
  sessionId, cwd, session, onClose, onClearView,
}: {
  sessionId: string
  cwd: string | null
  session: any
  onClose: () => void
  onClearView: () => void
}) {
  const [model, setModel] = useState<{ provider: string | null; model: string | null } | null>(null)
  const [experts, setExperts] = useState<Array<{ name: string }> | null>(null)
  const [info, setInfo] = useState<{ file: string | null; bytes: number; events: number | null } | null>(null)
  const [mode, setMode] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void fetch('/evoresearch/fs/models', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
      .then((r) => r.json()).then((j) => { if (!cancelled && j.ok) setModel(j.value) }).catch(() => {})
    void fetch('/evoresearch/fs/experts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
      .then((r) => r.json()).then((j) => { if (!cancelled && j.ok) setExperts((j.value ?? []).filter((e: any) => e.invitedAt !== 0)) }).catch(() => {})
    void fetch('/evoresearch/fs/session-info', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId }) })
      .then((r) => r.json()).then((j) => { if (!cancelled && j.ok) setInfo(j.value) }).catch(() => {})
    void fetch('/evoresearch/fs/mode').then((r) => r.json()).then((j) => { if (!cancelled && j.ok) setMode(j.value.preset) }).catch(() => {})
    return () => { cancelled = true }
  }, [sessionId])

  const projections = session?.projections
  const usage = projections?.get('tokenUsage')
  const pressure = projections?.get('contextPressure')
  const used = pressure?.projectedTokens ?? pressure?.pressureTokens
  const total = pressure?.contextWindow
  const contextText = used !== undefined && total !== undefined && total > 0
    ? `${fmtTokens(used)} / ${fmtTokens(total)}（${Math.min(100, Math.round((used / total) * 100))}%）`
    : '—'

  return jsx(ModalShell, {
    title: t('currentSession'),
    onClose,
    children: jsxs('div', {
      className: 'evo-info',
      children: [
        jsx(Row, { label: t('threadId'), mono: true, children: jsxs(Fragment, { children: [jsx('span', { children: sessionId }), jsx(CopyCell, { text: sessionId })] }) }),
        jsx(Row, { label: t('workspace'), mono: true, children: cwd ?? '—' }),
        jsx(Row, { label: t('modelProvider'), children: model?.model != null ? `${model.model}（${model.provider ?? '?'}）` : '—' }),
        jsx(Row, { label: t('permission'), children: mode ?? '—' }),
        jsx(Row, { label: t('tokensContext'), children: contextText }),
        jsx(Row, { label: t('inputOutput'), children: `${fmtTokens(usage?.inputTokens ?? 0)} · ${fmtTokens(usage?.outputTokens ?? 0)}` }),
        jsx(Row, { label: t('activeExperts'), children: (experts ?? []).length === 0 ? t('none') : (experts ?? []).map((e) => e.name).join(', ') }),
        jsx(Row, { label: t('sessionEvents'), children: info?.events != null ? String(info.events) : '—' }),
        info?.file != null
          ? jsx(Row, { label: t('sessionFile'), mono: true, children: jsxs(Fragment, { children: [jsx('span', { className: 'evo-info-path', children: info.file }), jsx('span', { children: `（${fmtBytes(info.bytes)}）` })] }) })
          : null,
        jsxs('div', {
          className: 'evo-info-actions',
          children: [
            jsx('button', {
              type: 'button',
              className: 'evo-btn evo-btn-danger',
              onClick: onClearView,
              title: t('clearViewTitle'),
              children: jsxs(Fragment, { children: [jsx(Eraser, {}), jsx('span', { children: t('clearView') })] }),
            }),
          ],
        }),
      ],
    }),
  })
}

/** Search 弹窗（§9.5）：先搜当前可见消息，Full history 走后端。 */
export function SearchDialog({
  nodes, sessionId, onClose, onJumpToNode, onOpenThread,
}: {
  nodes: Array<{ key: string; kind: string; data: { text?: string } }>
  sessionId: string
  onClose: () => void
  onJumpToNode: (key: string) => void
  onOpenThread: (id: string) => void
}) {
  const [query, setQuery] = useState('')
  const [domHits, setDomHits] = useState<Array<{ key: string; snippet: string }>>([])
  const [historyHits, setHistoryHits] = useState<Array<{ threadId?: string; messageId?: string; text?: string }> | null>(null)
  const [searching, setSearching] = useState(false)

  const searchDom = (q: string) => {
    const needle = q.trim().toLowerCase()
    if (needle === '') { setDomHits([]); return }
    const hits: Array<{ key: string; snippet: string }> = []
    for (const node of nodes) {
      const text = node.data?.text ?? ''
      const idx = text.toLowerCase().indexOf(needle)
      if (idx !== -1) {
        const start = Math.max(0, idx - 30)
        hits.push({ key: node.key, snippet: `${node.kind === 'user' ? t('you') : 'Evo'}: ${text.slice(start, idx + needle.length + 60)}` })
        if (hits.length >= 20) break
      }
    }
    setDomHits(hits)
  }

  const searchFull = () => {
    const q = query.trim()
    if (q === '') return
    setSearching(true)
    void fetch('/evoresearch/fs/threads-search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: q, limit: 50 }),
    }).then((r) => r.json()).then((j) => {
      setSearching(false)
      if (j.ok) setHistoryHits((j.value?.hits ?? []) as Array<{ threadId?: string; messageId?: string; text?: string }>)
    }).catch(() => setSearching(false))
  }

  return jsx(ModalShell, {
    title: t('search'),
    onClose,
    children: jsxs('div', {
      className: 'evo-search',
      children: [
        jsxs('div', {
          className: 'evo-search-bar',
          children: [
            jsx(Search, {}),
            jsx('input', {
              type: 'text',
              className: 'evo-search-input',
              placeholder: t('searchCurrentView'),
              value: query,
              onInput: (e) => { setQuery(e.currentTarget.value); searchDom(e.currentTarget.value) },
            }),
            jsx('button', {
              type: 'button',
              className: 'evo-btn evo-btn-run',
              disabled: query.trim() === '' || searching,
              onClick: searchFull,
              children: jsxs(Fragment, { children: [jsx(FileText, {}), jsx('span', { children: searching ? t('searching') : t('fullHistory') })] }),
            }),
          ],
        }),
        domHits.length > 0 && jsxs('div', {
          className: 'evo-search-section',
          children: [
            jsx('div', { className: 'evo-search-section-title', children: `${t('currentView')}（${domHits.length}）` }),
            jsx('div', {
              className: 'evo-search-results',
              children: domHits.map((hit) => jsx('button', {
                type: 'button',
                className: 'evo-search-hit',
                onClick: () => onJumpToNode(hit.key),
                children: hit.snippet,
              }, hit.key)),
            }),
          ],
        }),
        historyHits !== null && jsxs('div', {
          className: 'evo-search-section',
          children: [
            jsx('div', { className: 'evo-search-section-title', children: `Full history（${historyHits.length}）` }),
            historyHits.length === 0
              ? jsx('div', { className: 'evo-search-empty', children: t('noMatches') })
              : jsx('div', {
                  className: 'evo-search-results',
                  children: historyHits.map((hit, i) => jsx('button', {
                    type: 'button',
                    className: 'evo-search-hit',
                    onClick: () => {
                      if (hit.threadId !== undefined && hit.threadId !== sessionId) onOpenThread(hit.threadId)
                      else if (hit.threadId === sessionId) onJumpToNode(hit.messageId ?? '')
                    },
                    children: `${hit.threadId ?? ''} · ${hit.text ?? ''}`.slice(0, 160),
                  }, `${hit.threadId ?? 't'}-${i}`)),
                }),
          ],
        }),
      ],
    }),
  })
}

/** Shortcuts 弹窗（§23.2 键盘规则）。 */
export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const rows: Array<[string, string]> = [
    ['Enter', '换行'],
    ['Ctrl/Cmd+Enter', '发送'],
    ['Tab', '应用命令、文件或历史候选'],
    ['↑ / ↓', '移动候选；空输入时浏览输入历史'],
    ['Esc', '关闭候选；运行中打开停止确认'],
  ]
  return jsx(ModalShell, {
    title: t('shortcuts'),
    onClose,
    children: jsx('div', {
      className: 'evo-shortcuts',
      children: rows.map(([keys, desc]) => jsxs('div', {
        className: 'evo-shortcut-row',
        children: [
          jsx('kbd', { className: 'evo-kbd', children: keys }),
          jsx('span', { children: desc }),
        ],
      }, keys)),
    }),
  })
}

/** 模型选择器（§25.2）：provider 分组 + 模型列表，点击即保存默认模型。 */
export function ModelSelectorDialog({ onClose }: { onClose: () => void }) {
  const [groups, setGroups] = useState<Array<{ provider: { id: string; name: string }; models: Array<{ id: string; name: string; contextWindow: number | null }> }> | null>(null)
  const [current, setCurrent] = useState<{ provider: string | null; model: string | null }>({ provider: null, model: null })
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      fetch('/evoresearch/fs/models-catalog', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
        .then((r) => r.json()).then((j) => { if (!cancelled && j.ok) setGroups(j.value?.groups ?? []) }).catch(() => {}),
      fetch('/evoresearch/fs/models', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
        .then((r) => r.json()).then((j) => { if (!cancelled && j.ok) setCurrent({ provider: j.value?.provider ?? null, model: j.value?.model ?? null }) }).catch(() => {}),
    ])
    return () => { cancelled = true }
  }, [])

  const select = (provider: string, model: string) => {
    if (saving) return
    setSaving(true)
    setError(null)
    void fetch('/evoresearch/fs/models/select', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider, model }),
    }).then((r) => r.json()).then((j) => {
      setSaving(false)
      if (j.ok) {
        setCurrent({ provider, model })
        window.dispatchEvent(new CustomEvent('evo-model-changed'))
        toast(`Model switched to ${model}`, 'success')
        onClose()
      } else setError(j.error?.message ?? '保存失败')
    }).catch((e) => { setSaving(false); setError(String(e)) })
  }

  return jsx(ModalShell, {
    title: t('selectModel'),
    onClose,
    children: jsxs('div', {
      className: 'evo-models',
      children: [
        error !== null && jsx('div', { className: 'evo-panel-error', children: error }),
        groups === null
          ? jsx('div', { className: 'evo-setting-hint', children: t('loading') })
          : groups.length === 0
            ? jsx('div', { className: 'evo-setting-hint', children: t('noModels') })
            : jsx('div', {
                className: 'evo-model-list',
                children: groups.map((group) => jsxs('div', {
                  className: 'evo-model-group',
                  children: [
                    jsx('div', { className: 'evo-model-group-name', children: group.provider.name }),
                    group.models.map((m) => {
                      const active = current.provider === group.provider.id && current.model === m.id
                      return jsx('button', {
                        type: 'button',
                        className: 'evo-model-item',
                        'data-active': active || undefined,
                        disabled: saving,
                        onClick: () => select(group.provider.id, m.id),
                        title: m.contextWindow != null ? `context ${fmtTokens(m.contextWindow)}` : undefined,
                        children: m.name,
                      }, `${group.provider.id}:${m.id}`)
                    }),
                  ],
                }, group.provider.id)),
              }),
      ],
    }),
  })
}

/** 二次确认弹窗（§33.1 需决策操作）。 */
export function ConfirmDialog({
  title, message, confirmLabel, danger, onConfirm, onClose,
}: {
  title: string
  message: string
  confirmLabel: string
  danger?: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  return jsx(ModalShell, {
    title,
    onClose,
    children: jsxs('div', {
      className: 'evo-confirm',
      children: [
        jsx('div', { className: 'evo-confirm-msg', children: message }),
        jsxs('div', {
          className: 'evo-confirm-actions',
          children: [
            jsx('button', { type: 'button', className: 'evo-btn', onClick: onClose, children: t('cancel') }),
            jsx('button', {
              type: 'button',
              className: danger ? 'evo-btn evo-btn-danger' : 'evo-btn evo-btn-run',
              onClick: () => { onConfirm(); onClose() },
              children: confirmLabel,
            }),
          ],
        }),
      ],
    }),
  })
}
