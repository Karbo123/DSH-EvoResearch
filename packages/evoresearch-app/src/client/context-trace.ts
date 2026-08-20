/**
 * Context Trace drawer for Chat Graph.
 *
 * The drawer is deliberately a projection: temporary include/exclude choices
 * live only in this component, while "固定到图" is the explicit operation
 * that writes a resource node and a reference edge.  Memory text and original
 * files remain owned by the host services.
 */
import { jsx, jsxs, Fragment } from 'react/jsx-runtime'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ExternalLink, Link2, Pin, RefreshCw, X } from 'lucide-react'
import { t } from './i18n'
import type { ChatGraph, GraphNode } from './chatgraph'

interface PreviewItem {
  id: string
  kind: string
  title: string
  snippet: string
  connected: boolean
  included: boolean
  reason: string
}

export interface LinkTraceEntry {
  sourceLocator: string
  label: string
  target: string
  kind: string
  locator: string
  opened: boolean
  reason: string
}

interface Candidate {
  id: string
  kind: string
  title: string
  snippet: string
  connected?: boolean
  location?: { kind?: string; nodeId?: string; path?: string; sessionId?: string }
}

interface AssemblyResult {
  candidates?: Candidate[]
  included?: Candidate[]
  linkTrace?: LinkTraceEntry[]
  degraded?: string[]
  estimatedTokens?: number
  text?: string
}

export interface ContextTraceDrawerProps {
  sessionId: string
  workspaceDir?: string
  question: string
  graph: ChatGraph
  onClose: () => void
  onOpenNode: (nodeId: string) => void
  onOpenSession?: (sessionId: string) => void
  onOpenResource?: (target: string, kind: string) => void
  onGraphChanged?: () => void
  onHighlight: (ids: Set<string>) => void
  onError: (message: string) => void
}

async function callApi<T>(method: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`/evoresearch/fs/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await response.json() as { ok?: boolean; value?: T; error?: { message?: string } }
  if (json.ok !== true) throw new Error(json.error?.message ?? t('contextTraceApiFailed').replace('{method}', method))
  return json.value as T
}

function graphNodeFromLocator(locator: string): string | undefined {
  return locator.startsWith('graph:') ? locator.slice('graph:'.length) : undefined
}

function localResourceKind(kind: string, target: string): 'note' | 'pdf' | 'experiment' | 'run' | 'log' | 'result' | 'code' | 'latex' | 'manuscript' | 'file' | undefined {
  if (kind === 'url' || kind === 'chat') return undefined
  if (kind === 'paper') return 'pdf'
  if (kind === 'experiment' || kind === 'run' || kind === 'log' || kind === 'result' || kind === 'code' || kind === 'latex' || kind === 'manuscript' || kind === 'note') return kind
  const lower = target.toLowerCase()
  if (lower.endsWith('.pdf')) return 'pdf'
  if (/\.(py|ts|tsx|js|jsx|java|cpp|c|rs|go)$/.test(lower)) return 'code'
  if (/\.(tex|bib)$/.test(lower)) return 'latex'
  if (/\.(log|out|err)$/.test(lower)) return 'log'
  if (/\.(csv|json|jsonl|npy|npz|png|jpg|jpeg|svg)$/.test(lower)) return 'result'
  return 'file'
}

function traceTargetLabel(trace: LinkTraceEntry): string {
  return trace.target.length > 110 ? `${trace.target.slice(0, 109)}…` : trace.target
}

export function ContextTraceDrawer(props: ContextTraceDrawerProps) {
  const [question, setQuestion] = useState(props.question)
  const [items, setItems] = useState<PreviewItem[]>([])
  const [trace, setTrace] = useState<LinkTraceEntry[]>([])
  const [degraded, setDegraded] = useState<string[]>([])
  const [excludedIds, setExcludedIds] = useState<Set<string>>(new Set())
  const [includedIds, setIncludedIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [assembled, setAssembled] = useState(false)
  const [error, setLocalError] = useState<string | null>(null)
  const [pinning, setPinning] = useState<string | null>(null)
  const drawerRef = useRef<HTMLElement | null>(null)
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  // The drawer is modal in the visual layout.  Keep keyboard focus inside the
  // first meaningful control and restore focus to the opener when it closes.
  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        props.onClose()
        return
      }
      if (event.key === 'Tab') {
        const root = drawerRef.current
        if (root === null) return
        const focusable = [...root.querySelectorAll<HTMLElement>('button:not([disabled]), textarea, input, [href], [tabindex]:not([tabindex="-1"])')]
        if (focusable.length === 0) return
        const first = focusable[0]!
        const last = focusable[focusable.length - 1]!
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      previousFocusRef.current?.focus()
    }
  }, [props.onClose])

  useEffect(() => { setQuestion(props.question) }, [props.question])
  useEffect(() => {
    const ids = new Set<string>()
    for (const item of trace) {
      const id = graphNodeFromLocator(item.sourceLocator)
      if (id !== undefined) ids.add(id)
    }
    for (const item of items) if (props.graph.nodes.some((node) => node.id === item.id)) ids.add(item.id)
    props.onHighlight(ids)
    // onHighlight is intentionally omitted: the parent provides an inline
    // callback, while items/trace are the actual state that should trigger a
    // new visual highlight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, trace])

  const requestBody = useMemo(() => ({
    sessionId: props.sessionId,
    userQuestion: question.trim(),
    workspaceDir: props.workspaceDir,
    options: {
      excludedIds: [...excludedIds],
      includedIds: [...includedIds],
      tokenBudget: 6000,
    },
  }), [excludedIds, includedIds, props.sessionId, props.workspaceDir, question])

  const refresh = async (deep: boolean): Promise<void> => {
    if (props.sessionId.trim() === '' || question.trim() === '') {
      setLocalError(t('contextTraceErrorRequired'))
      return
    }
    setLoading(true)
    setLocalError(null)
    try {
      if (deep) {
        const result = await callApi<AssemblyResult>('context-assemble-deep', requestBody)
        setTrace(result.linkTrace ?? [])
        setDegraded(result.degraded ?? [])
        setAssembled(true)
        const graphIds = new Set<string>()
        for (const candidate of result.included ?? []) {
          const id = candidate.location?.nodeId ?? (candidate.kind === 'graph' ? candidate.id : undefined)
          if (id !== undefined) graphIds.add(id)
        }
        for (const link of result.linkTrace ?? []) {
          const id = graphNodeFromLocator(link.sourceLocator)
          if (id !== undefined) graphIds.add(id)
        }
        props.onHighlight(graphIds)
      } else {
        const result = await callApi<{ items?: PreviewItem[] }>('context-preview', requestBody)
        setItems(result.items ?? [])
        setAssembled(false)
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught)
      setLocalError(message)
      props.onError(message)
    } finally {
      setLoading(false)
    }
  }

  const toggleExcluded = (id: string) => {
    setExcludedIds((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleIncluded = (id: string) => {
    setIncludedIds((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const openTrace = (entry: LinkTraceEntry) => {
    const nodeId = graphNodeFromLocator(entry.sourceLocator)
    if (nodeId !== undefined) props.onOpenNode(nodeId)
    if (entry.kind === 'chat') props.onOpenSession?.(entry.target)
    else if (entry.target.startsWith('http://') || entry.target.startsWith('https://')) window.open(entry.target, '_blank', 'noopener,noreferrer')
    else props.onOpenResource?.(entry.target, entry.kind)
  }

  const pinTrace = async (entry: LinkTraceEntry) => {
    const kind = localResourceKind(entry.kind, entry.target)
    if (kind === undefined || props.workspaceDir === undefined) {
      setLocalError(t('contextTracePinExternal'))
      return
    }
    setPinning(entry.locator)
    try {
      const created = await callApi<{ node?: GraphNode }>('graph-add-node', {
        workspaceDir: props.workspaceDir,
        operationId: `trace-pin-${entry.locator}`,
        node: {
          type: 'resource', displayKind: kind, title: entry.label || entry.target,
          x: 80, y: 80, scope: 'project', origin: 'user', ref: { kind, path: entry.target },
        },
      })
      const target = props.graph.nodes.find((node) => node.type === 'chat' && node.sessionId === props.sessionId)
      if (created.node !== undefined && target !== undefined) {
        await callApi('graph-add-edge', {
          workspaceDir: props.workspaceDir,
          operationId: `trace-pin-edge-${created.node.id}-${target.id}`,
          edge: { from: created.node.id, to: target.id, toPort: 'memory', behavior: 'reference', enabled: true, label: entry.label },
        })
      }
      // graph-add-node/graph-add-edge are durable operations, but the parent
      // still owns the in-memory projection.  Refresh immediately so a pin is
      // visible without closing/reopening the drawer.
      props.onGraphChanged?.()
      setLocalError(null)
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught)
      setLocalError(message)
      props.onError(message)
    } finally {
      setPinning(null)
    }
  }

  return jsxs('aside', {
    className: 'evo-context-trace',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': t('contextTraceAria'),
    'aria-busy': loading,
    ref: drawerRef,
    children: [
      jsxs('div', { className: 'evo-context-trace-head', children: [
        jsxs('div', { children: [jsx('strong', { children: t('contextTraceTitle') }), jsx('p', { children: t('contextTraceSubtitle') })] }),
        jsx('button', { ref: closeRef, type: 'button', className: 'evo-icon-btn', 'aria-label': t('contextTraceCloseAria'), title: t('contextTraceCloseTitle'), onClick: props.onClose, children: jsx(X, {}) }),
      ] }),
      jsxs('div', { className: 'evo-context-trace-question', children: [
        jsx('label', { htmlFor: 'evo-context-question', children: t('contextTraceQuestion') }),
        jsx('textarea', { id: 'evo-context-question', rows: 2, value: question, placeholder: t('contextTracePlaceholder'), onInput: (event) => setQuestion(event.currentTarget.value) }),
        jsxs('div', { className: 'evo-context-trace-actions', children: [
          jsx('button', { type: 'button', className: 'evo-graph-btn', disabled: loading, onClick: () => { void refresh(false) }, children: jsxs(Fragment, { children: [jsx(RefreshCw, { 'aria-hidden': true }), jsx('span', { children: t('contextTracePreview') })] }) }),
          jsx('button', { type: 'button', className: 'evo-btn evo-btn-run', disabled: loading, onClick: () => { void refresh(true) }, children: jsxs(Fragment, { children: [jsx(Check, { 'aria-hidden': true }), jsx('span', { children: t('contextTraceGenerate') })] }) }),
        ] }),
      ] }),
      error !== null && jsx('div', { className: 'evo-context-trace-error', role: 'alert', children: error }),
      loading && jsx('div', { className: 'evo-context-trace-loading', role: 'status', 'aria-live': 'polite', children: t('contextTraceLoading') }),
      degraded.length > 0 && jsx('div', { className: 'evo-context-trace-degraded', role: 'status', 'aria-live': 'polite', children: t('contextTraceDegraded').replace('{list}', degraded.join(t('contextTraceDegradedSep'))) }),
      items.length === 0 && trace.length === 0 && jsx('div', { className: 'evo-context-trace-empty', children: assembled ? t('contextTraceEmptyAssembled') : t('contextTraceEmptyFirst') }),
      items.length > 0 && jsxs('section', { className: 'evo-context-trace-section', 'aria-labelledby': 'evo-context-candidates-title', children: [
        jsx('h3', { id: 'evo-context-candidates-title', children: t('contextTraceCandidatesCount').replace('{n}', String(items.length)) }),
        ...items.map((item) => {
          const excluded = excludedIds.has(item.id)
          const supplemented = includedIds.has(item.id)
          return jsxs('article', { className: `evo-context-trace-item${excluded ? ' excluded' : ''}`, children: [
            jsxs('div', { className: 'evo-context-trace-item-head', children: [jsx('strong', { children: item.title }), jsx('span', { className: item.connected ? 'connected' : '', children: item.connected ? t('contextTraceConnected') : item.kind })] }),
            jsx('p', { children: item.snippet || item.reason }),
            jsxs('div', { className: 'evo-context-trace-item-actions', children: [
              jsx('button', { type: 'button', onClick: () => toggleExcluded(item.id), 'aria-pressed': excluded, children: excluded ? t('contextTraceRestore') : t('contextTraceExcludeTemp') }),
              jsx('button', { type: 'button', onClick: () => toggleIncluded(item.id), 'aria-pressed': supplemented, children: supplemented ? t('contextTraceUnsupplement') : t('contextTraceSupplement') }),
            ] }),
          ] }, `candidate-${item.kind}-${item.id}`)
        }),
      ] }),
      trace.length > 0 && jsxs('section', { className: 'evo-context-trace-section', 'aria-labelledby': 'evo-context-trace-title', children: [
        jsx('h3', { id: 'evo-context-trace-title', children: t('contextTraceLinksCount').replace('{n}', String(trace.length)) }),
        ...trace.map((entry) => jsxs('article', { className: 'evo-context-trace-link', children: [
          jsxs('div', { className: 'evo-context-trace-link-line', children: [jsx(Link2, {}), jsx('button', { type: 'button', onClick: () => openTrace(entry), children: entry.label || entry.sourceLocator }), jsx('span', { children: '→' }), jsx('code', { title: entry.target, children: traceTargetLabel(entry) })] }),
          jsx('small', { children: entry.opened ? entry.reason : t('contextTraceNotOpened').replace('{reason}', entry.reason) }),
          jsxs('div', { className: 'evo-context-trace-item-actions', children: [
            jsx('button', { type: 'button', onClick: () => openTrace(entry), children: jsxs(Fragment, { children: [jsx(ExternalLink, {}), jsx('span', { children: t('contextTraceOpen') })] }) }),
            jsx('button', { type: 'button', disabled: pinning !== null, onClick: () => { void pinTrace(entry) }, 'aria-busy': pinning === entry.locator, children: jsxs(Fragment, { children: [jsx(Pin, { 'aria-hidden': true }), jsx('span', { children: pinning === entry.locator ? t('contextTracePinning') : t('contextTracePinToGraph') })] }) }),
          ] }),
        ] }, `trace-${entry.locator}-${entry.target}`)),
      ] }),
      jsx('button', { type: 'button', className: 'evo-context-trace-close-bottom', onClick: props.onClose, children: t('contextTraceDone') }),
    ],
  })
}
