/**
 * 会话统计栏（仿 DSH 设计，置于聊天输入框外部，小字号）。
 *
 * 数据：session.events 实时计算——回合/步骤数、LLM 总时长、工具调用总时长、
 * 首 token 平均延迟、输出 tok/s、缓存命中率、输入 token 总量。
 * 展示：`123 轮 · 5507 步 | LLM 571m36s · 工具调用 1344m23s | 首 token 平均 2.9s ·
 * 149 tok/s | 缓存命中 100% | 输入 2411M token`
 */
import { jsx, jsxs, Fragment } from 'react/jsx-runtime'
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { Cpu } from 'lucide-react'
import { t } from './i18n'

interface TrajStats {
  turns: number
  steps: number
  llmMs: number
  toolMs: number
  firstTokenAvgMs: number
  outTokens: number
  inTokens: number
  cacheRead: number
  sampleSteps: number
}

/** 从事件日志统计轨迹指标（与轨迹面板同源）。 */
export function computeStats(events: any[]): TrajStats {
  const stats: TrajStats = { turns: 0, steps: 0, llmMs: 0, toolMs: 0, firstTokenAvgMs: 0, outTokens: 0, inTokens: 0, cacheRead: 0, sampleSteps: 0 }
  let stepStart: { turn: number; step: number; time: number } | null = null
  let stepEnd: { turn: number; step: number; time: number } | null = null
  let toolStart: { callId: string; time: number } | null = null
  let firstTokenMs = 0
  let firstTokenSteps = 0
  const stepKey = (s: { turn: number; step: number }): string => `${s.turn}:${s.step}`
  for (const ev of events ?? []) {
    if (ev === null || typeof ev !== 'object') continue
    const type = ev.type
    const data = ev.data ?? {}
    const time = typeof ev.time === 'number' ? ev.time : Date.now()
    if (type === 'turn/start') { stats.turns += 1; continue }
    if (type === 'step/start') {
      stats.steps += 1
      stepStart = { turn: data.turn ?? 0, step: data.step ?? 0, time }
      stepEnd = null
      continue
    }
    if (type === 'assistant/chunk') {
      const chunk = data?.chunk
      if (chunk?.type === 'usage' && chunk.usage !== undefined) {
        stats.inTokens += chunk.usage.inputTokens ?? 0
        stats.outTokens += chunk.usage.outputTokens ?? 0
        stats.cacheRead += chunk.usage.cacheReadTokens ?? 0
      }
      if (stepStart !== null && (chunk?.type === 'text-delta' || chunk?.type === 'reasoning-delta' || chunk?.type === 'block-start')) {
        firstTokenMs += time - stepStart.time
        firstTokenSteps += 1
        stepStart = null
      }
      continue
    }
    if (type === 'step/end') {
      stepEnd = { turn: data.turn ?? 0, step: data.step ?? 0, time }
      if (stepStart !== null && stepKey(stepStart) === stepKey(stepEnd)) {
        stats.llmMs += time - stepStart.time
        stepStart = null
      }
      continue
    }
    if (type === 'tool/call') {
      toolStart = { callId: String(data.callId ?? ''), time }
      continue
    }
    if (type === 'tool/result') {
      const callId = data?.message?.source?.callId
      if (toolStart !== null && toolStart.callId === callId) {
        stats.toolMs += time - toolStart.time
      }
      toolStart = null
      continue
    }
  }
  if (firstTokenSteps > 0) stats.firstTokenAvgMs = firstTokenMs / firstTokenSteps
  stats.sampleSteps = firstTokenSteps
  return stats
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return '0s'
  const totalSec = Math.round(ms / 1000)
  if (totalSec < 60) return `${totalSec}s`
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  if (min < 60) return `${min}m${sec.toString().padStart(2, '0')}s`
  const hr = Math.floor(min / 60)
  return `${hr}h${(min % 60).toString().padStart(2, '0')}m`
}

function fmtTokens(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${Math.round(n / 1e3)}K`
  return String(n)
}

/** 会话统计栏（始终渲染；无会话时显示占位）。 */
export function StatusBar({ session }: { session: any }) {
  const notifier = session?.notifier
  const eventsLen = useSyncExternalStore(
    (onChange: () => void) => (notifier?.subscribe(onChange) ?? (() => {})),
    () => (session?.events?.length ?? 0),
  )
  const stats = useMemo(() => computeStats(session?.events ?? []), [session, eventsLen])
  const hasSession = session !== undefined && session !== null && stats.steps > 0
  if (!hasSession) {
    return jsx('div', { className: 'evo-statusbar', children: jsx('span', { className: 'evo-statusbar-empty', children: '—' }) })
  }
  const llmSec = stats.llmMs / 1000
  const tokPerSec = llmSec > 0 ? Math.round(stats.outTokens / llmSec) : 0
  const cacheHit = stats.inTokens + stats.cacheRead > 0 ? Math.round((stats.cacheRead / (stats.inTokens + stats.cacheRead)) * 100) : 0
  return jsxs('div', {
    className: 'evo-statusbar',
    children: [
      jsxs('span', { className: 'evo-statusbar-item', children: [jsx('b', { children: stats.turns }), jsx('span', { children: t('statTurns') }), jsx('span', { className: 'evo-statusbar-sep', children: '·' }), jsx('b', { children: stats.steps }), jsx('span', { children: t('statSteps') })] }),
      jsxs('span', { className: 'evo-statusbar-item', children: [jsx('span', { className: 'evo-statusbar-label', children: 'LLM' }), jsx('span', { children: fmtDuration(stats.llmMs) }), jsx('span', { className: 'evo-statusbar-sep', children: '·' }), jsx('span', { className: 'evo-statusbar-label', children: t('statTools') }), jsx('span', { children: fmtDuration(stats.toolMs) })] }),
      jsxs('span', { className: 'evo-statusbar-item', children: [jsx('span', { children: `${t('statFirstToken')} ${(stats.firstTokenAvgMs / 1000).toFixed(1)}s` }), jsx('span', { className: 'evo-statusbar-sep', children: '·' }), jsx('span', { children: `${tokPerSec} tok/s` })] }),
      jsxs('span', { className: 'evo-statusbar-item', children: [jsx('span', { children: `${t('statCacheHit')} ${cacheHit}%` })] }),
      jsxs('span', { className: 'evo-statusbar-item', children: [jsx('span', { children: `${t('statInput')} ${fmtTokens(stats.inTokens)} ${t('statTokenUnit')}` })] }),
    ],
  })
}

/** 输入框外右下方的模型徽章：当前模型 + 推理强度，点击打开模型选择器。 */
export function ComposerModelInfo() {
  const [info, setInfo] = useState<{
    provider?: string | null
    model?: string | null
    tier?: string | null
    reasoningEffort?: string | null
  } | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = () => fetch('/evoresearch/fs/models', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }).then((res) => res.json()).then((json) => {
      if (!cancelled && json.ok) setInfo(json.value)
    }).catch(() => {})
    void load()
    const onChange = () => { void load() }
    window.addEventListener('evo-model-changed', onChange)
    return () => {
      cancelled = true
      window.removeEventListener('evo-model-changed', onChange)
    }
  }, [])

  if (info?.model == null) return null
  const effortLabel = info.reasoningEffort === 'low' ? t('effortLow') : info.reasoningEffort === 'medium' ? t('effortMedium') : info.reasoningEffort === 'high' ? t('effortHigh') : null
  const tierLabel = info.tier === 'simple' ? t('tierSimple') : info.tier === 'medium' ? t('tierMedium') : info.tier === 'complex' ? t('tierComplex') : null
  const detail = [`${info.model}（${info.provider ?? '?'}）`, tierLabel !== null ? `档位：${tierLabel}` : null, effortLabel !== null ? `推理强度：${effortLabel}` : null].filter(Boolean).join(' · ')
  return jsxs('button', {
    type: 'button',
    className: 'evo-composer-model',
    title: `${detail}（点击切换）`,
    'aria-label': t('model'),
    onClick: () => window.dispatchEvent(new CustomEvent('evo-open-model-selector')),
    children: [
      jsx(Cpu, {}),
      jsx('span', { className: 'evo-composer-model-name', children: String(info.model) }),
      effortLabel !== null && jsx('span', { className: 'evo-composer-model-effort', children: `${t('reasoningEffort')} ${effortLabel}` }),
    ],
  })
}
