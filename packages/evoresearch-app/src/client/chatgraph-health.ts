/**
 * 上下文体检卡（ChatGraph v2 §7）：选中 chat 节点后在 Inspector 内展示
 * 该会话最近一轮的上下文明细。数据来自 Remote graph-health-report；
 * 全部字段防御性渲染——后端未提供/格式不符时该区块显示"暂无记录"。
 *
 * 分区（大白话）：每轮固定带了什么 / 记忆包提了什么 / 这一轮实际读到了哪些记忆
 * （可点击→画布脉冲定位）/ 压缩历史；机制数值只收进"给想深究的人"折叠区。
 */
import { jsx, jsxs, Fragment } from 'react/jsx-runtime'
import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { t } from './i18n'

interface HealthInjection {
  name?: string
  label?: string
  chars?: number
}
interface HealthHit {
  nodeId?: string
  title?: string
  locator?: string
  score?: number
}
export interface GraphHealthReport {
  generatedAt?: number | string
  sessionId?: string
  injections?: HealthInjection[]
  memoryPacket?: Record<string, unknown>
  hits?: HealthHit[]
  toolCount?: number
  tokenUsage?: unknown
  compactions?: unknown[]
  raw?: unknown
}

async function callApi<T>(method: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`/evoresearch/fs/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await response.json() as { ok?: boolean; value?: T; error?: { message?: string } }
  if (json.ok !== true) throw new Error(json.error?.message ?? t('graphHealthLoadFailed'))
  return json.value as T
}

function formatTime(value: number | string | undefined): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleString()
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Date.parse(value)
    if (!Number.isNaN(parsed)) return new Date(parsed).toLocaleString()
    return value
  }
  return ''
}

/** 压缩历史条目：字符串原样；对象取可读字段兜底为单行文本（防御性）。 */
function compactionLine(entry: unknown): string {
  if (typeof entry === 'string') return entry
  if (entry !== null && typeof entry === 'object') {
    const record = entry as Record<string, unknown>
    const at = typeof record.at === 'number' ? new Date(record.at).toLocaleString() : typeof record.at === 'string' ? record.at : undefined
    const text = [record.summary, record.label, record.reason, record.title].find((candidate): candidate is string => typeof candidate === 'string' && candidate.trim() !== '')
    if (at !== undefined || text !== undefined) return [at, text].filter((part) => part !== undefined).join(' · ')
  }
  return String(entry)
}

export interface GraphHealthCardProps {
  sessionId: string
  workspaceDir?: string
  /** 点击命中记忆 → 画布脉冲定位（不切换选中，避免离开体检卡）。 */
  onLocate: (nodeId: string) => void
}

export function GraphHealthCard({ sessionId, workspaceDir, onLocate }: GraphHealthCardProps) {
  const [report, setReport] = useState<GraphHealthReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [reloadTick, setReloadTick] = useState(0)

  useEffect(() => {
    if (sessionId.trim() === '') return
    let cancelled = false
    setLoading(true)
    setFailed(false)
    callApi<GraphHealthReport>('graph-health-report', { sessionId, workspaceDir })
      .then((result) => { if (!cancelled) setReport(result ?? null) })
      .catch(() => { if (!cancelled) { setReport(null); setFailed(true) } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [sessionId, workspaceDir, reloadTick])

  const injections = (report?.injections ?? []).filter((item) => item !== null && typeof item === 'object')
  const hits = (report?.hits ?? []).filter((item) => item !== null && typeof item === 'object')
  const compactions = report?.compactions ?? []
  const hasPacket = report?.memoryPacket !== undefined && report.memoryPacket !== null && Object.keys(report.memoryPacket).length > 0
  const hasAnything = injections.length > 0 || hits.length > 0 || compactions.length > 0 || hasPacket
  const checkedAt = formatTime(report?.generatedAt)
  const deepText = (() => {
    try {
      return JSON.stringify(report?.raw ?? report ?? {}, null, 2).slice(0, 4000)
    } catch {
      return ''
    }
  })()

  return jsxs('div', { className: 'evo-graph-health', children: [
    jsxs('div', { className: 'evo-graph-health-head', children: [
      jsx('strong', { children: t('graphHealthTitle') }),
      jsx('span', { style: { flex: 1 } }),
      jsx('button', {
        type: 'button', className: 'evo-icon-btn', 'aria-label': t('graphHealthRefreshAria'), title: t('graphHealthRefreshAria'),
        disabled: loading,
        onClick: () => setReloadTick((value) => value + 1),
        children: jsx(RefreshCw, {}),
      }),
    ] }),
    checkedAt !== '' && jsx('div', { className: 'evo-graph-health-time', children: t('graphHealthAt').replace('{time}', checkedAt) }),
    loading && report === null && jsx('div', { className: 'evo-graph-health-empty', children: t('graphReading') }),
    !loading && !hasAnything && jsx('div', { className: 'evo-graph-health-empty', children: failed ? t('graphHealthLoadFailed') : t('graphHealthEmpty') }),
    hasAnything && jsxs(Fragment, { children: [
      injections.length > 0 && jsxs('div', { className: 'evo-graph-health-section', children: [
        jsx('span', { children: t('graphHealthInjections') }),
        ...injections.map((item, index) => jsxs('div', { className: 'evo-graph-health-row', children: [
          jsx('span', { className: 'evo-graph-health-row-main', children: item.label ?? item.name ?? '—' }),
          typeof item.chars === 'number' && jsx('span', { className: 'evo-graph-health-row-meta', children: t('graphHealthChars').replace('{n}', String(item.chars)) }),
        ] }, `injection-${index}-${item.name ?? item.label ?? index}`)),
      ] }),
      hasPacket && jsxs('div', { className: 'evo-graph-health-section', children: [
        jsx('span', { children: t('graphHealthPacket') }),
        jsx('div', { className: 'evo-graph-health-row', children: jsx('span', { className: 'evo-graph-health-row-main', children: t('graphHealthPacketDesc') }) }),
      ] }),
      hits.length > 0 && jsxs('div', { className: 'evo-graph-health-section', children: [
        jsx('span', { children: t('graphHealthHits') }),
        ...hits.map((hit, index) => {
          const label = hit.title ?? hit.locator ?? hit.nodeId ?? '—'
          return hit.nodeId !== undefined && hit.nodeId !== ''
            ? jsx('button', {
                type: 'button', className: 'evo-graph-health-hit', title: t('graphHealthLocate'),
                onClick: () => onLocate(hit.nodeId as string),
                children: label,
              }, `hit-${index}-${hit.nodeId}`)
            : jsx('div', { className: 'evo-graph-health-row', children: jsx('span', { className: 'evo-graph-health-row-main', children: label }) }, `hit-${index}-${label}`)
        }),
      ] }),
      compactions.length > 0 && jsxs('div', { className: 'evo-graph-health-section', children: [
        jsx('span', { children: t('graphHealthCompactions') }),
        ...compactions.map((entry, index) => jsx('div', { className: 'evo-graph-health-row', children: jsx('span', { className: 'evo-graph-health-row-main', children: compactionLine(entry) }) }, `compaction-${index}`)),
      ] }),
      jsxs('details', { className: 'evo-graph-health-deep', children: [
        jsx('summary', { children: t('graphHealthDeep') }),
        deepText !== '' && jsx('pre', { children: deepText }),
      ] }),
    ] }),
  ] })
}
