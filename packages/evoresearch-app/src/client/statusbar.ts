/**
 * 会话统计栏（仿 DSH 设计，置于聊天输入框外部，小字号）。
 *
 * 数据：session.events 实时计算——回合/步骤数、LLM 总时长、工具调用总时长、
 * 首 token 平均延迟、输出 tok/s、缓存命中率、输入 token 总量。
 * 展示：`123 轮 · 5507 步 | LLM 571m36s · 工具调用 1344m23s | 首 token 平均 2.9s ·
 * 149 tok/s | 缓存命中 100% | 输入 2411M token`
 */
import { jsx, jsxs, Fragment } from 'react/jsx-runtime'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Cpu } from 'lucide-react'
import { toast } from './toast'
import { t } from './i18n'
import { TIER_KEYS, tierMeta, effortLabel } from './session-actions'

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

/** 输入框内右下侧的模型徽章：当前模型 + 推理强度，点击弹出三档模型下拉（与设置面板下拉同风格）。 */
export function ComposerModelInfo() {
  const [info, setInfo] = useState<{
    provider?: string | null
    model?: string | null
    tier?: string | null
    reasoningEffort?: string | null
  } | null>(null)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ left: number; top: number; upward: boolean } | null>(null)
  const [tiers, setTiers] = useState<Array<{ key: typeof TIER_KEYS[number]; provider: string; model: string; reasoningEffort: string }> | null>(null)
  const [names, setNames] = useState<{ providers: Map<string, string>; models: Map<string, string> }>({ providers: new Map(), models: new Map() })
  const [current, setCurrent] = useState<{ provider: string | null; model: string | null; tier: string | null }>({ provider: null, model: null, tier: null })
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

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

  // 打开时惰性加载三档配置（与设置面板同一数据源），只加载一次。
  useEffect(() => {
    if (!open || tiers !== null) return
    let cancelled = false
    void Promise.all([
      fetch('/evoresearch/fs/model-settings-get', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
        .then((r) => r.json()).catch(() => ({ ok: false })),
      fetch('/evoresearch/fs/models', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
        .then((r) => r.json()).catch(() => ({ ok: false })),
      fetch('/evoresearch/fs/models-catalog', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
        .then((r) => r.json()).catch(() => ({ ok: false })),
    ]).then(([settingsJson, currentJson, catalogJson]) => {
      if (cancelled) return
      if (settingsJson.ok === true) {
        const code = settingsJson.value?.code ?? {}
        setTiers(TIER_KEYS.map((key) => {
          const cfg = code[key] ?? {}
          return { key, provider: cfg.provider ?? '', model: cfg.model ?? '', reasoningEffort: cfg.reasoningEffort ?? '' }
        }))
      } else {
        setTiers([])
      }
      if (currentJson.ok === true) {
        setCurrent({ provider: currentJson.value?.provider ?? null, model: currentJson.value?.model ?? null, tier: currentJson.value?.tier ?? null })
      }
      if (catalogJson.ok === true) {
        const providers = new Map<string, string>()
        const models = new Map<string, string>()
        for (const group of catalogJson.value?.groups ?? []) {
          providers.set(group.provider?.id ?? '', group.provider?.name ?? group.provider?.id ?? '')
          for (const m of group.models ?? []) models.set(m.id, m.name ?? m.id)
        }
        setNames({ providers, models })
      }
    }).catch(() => {})
    return () => { cancelled = true }
  }, [open, tiers])

  // 浮层关闭行为与设置面板 Dropdown 一致：外部点击 / Escape / 页面滚动关闭；
  // 菜单自身滚动与滚轮不冒泡，避免一滚就收起。
  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    const onDocDown = (e: MouseEvent) => {
      const el = e.target as Node | null
      if (el === null) return
      if (btnRef.current !== null && btnRef.current.contains(el)) return
      if (menuRef.current !== null && menuRef.current.contains(el)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    const onScroll = (e: Event) => {
      const target = e.target as Node | null
      if (target instanceof Element && target.closest('.evo-composer-model-menu') !== null) return
      close()
    }
    const onWheel = (e: WheelEvent) => {
      const target = e.target as Element | null
      if (target === null) return
      const menu = target.closest('.evo-composer-model-menu')
      if (menu === null) return
      e.preventDefault()
      e.stopPropagation()
      if (menu.scrollHeight > menu.clientHeight) menu.scrollTop += e.deltaY
    }
    document.addEventListener('mousedown', onDocDown)
    document.addEventListener('keydown', onKey)
    document.addEventListener('scroll', onScroll, true)
    document.addEventListener('wheel', onWheel, { passive: false, capture: true })
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('mousedown', onDocDown)
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('scroll', onScroll, true)
      document.removeEventListener('wheel', onWheel, { capture: true })
      window.removeEventListener('resize', close)
    }
  }, [open])

  const toggle = () => {
    if (open) { setOpen(false); return }
    const r = btnRef.current?.getBoundingClientRect()
    if (r !== undefined) {
      const menuWidth = Math.min(400, window.innerWidth - 24)
      const upward = r.bottom + 360 > window.innerHeight && r.top > 360
      setPos({
        left: Math.min(Math.max(8, r.left), window.innerWidth - menuWidth - 8),
        top: upward ? r.top - 6 : r.bottom + 6,
        upward,
      })
    }
    setOpen(true)
  }

  const apply = (tier: typeof TIER_KEYS[number]) => {
    if (saving !== null) return
    setSaving(tier)
    setError(null)
    void fetch('/evoresearch/fs/model-settings-apply', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tier }),
    }).then((r) => r.json()).then((j) => {
      setSaving(null)
      if (j.ok) {
        const entry = tiers?.find((x) => x.key === tier)
        const label = entry !== undefined && entry.model !== ''
          ? `${names.models.get(entry.model) ?? entry.model}（${names.providers.get(entry.provider) ?? entry.provider}）`
          : tier
        window.dispatchEvent(new CustomEvent('evo-model-changed'))
        toast(t('modelApplied').replace('{name}', label), 'success')
        setOpen(false)
      } else setError(j.error?.message ?? t('assignSaveFailed'))
    }).catch((e) => { setSaving(null); setError(String(e)) })
  }

  if (info?.model == null) return null
  const currentEffortLabel = info.reasoningEffort === 'off' ? t('effortOff')
    : info.reasoningEffort === 'minimal' ? t('effortMinimal')
      : info.reasoningEffort === 'low' ? t('effortLow')
        : info.reasoningEffort === 'medium' ? t('effortMedium')
          : info.reasoningEffort === 'high' ? t('effortHigh')
            : info.reasoningEffort === 'xhigh' ? t('effortXhigh')
          : info.reasoningEffort === 'max' ? t('effortMax')
            : null
  const detail = [`${info.model}（${info.provider ?? '?'}）`, currentEffortLabel !== null ? `推理强度：${currentEffortLabel}` : null].filter(Boolean).join(' · ')
  return jsxs(Fragment, { children: [
    jsxs('button', {
      ref: btnRef,
      type: 'button',
      className: `evo-composer-model${open ? ' evo-composer-model-open' : ''}`,
      title: `${detail}（点击切换）`,
      'aria-label': t('model'),
      'aria-expanded': open || undefined,
      'aria-haspopup': 'listbox',
      onClick: toggle,
      children: [
        jsx(Cpu, {}),
        jsx('span', { className: 'evo-composer-model-name', children: String(info.model) }),
        currentEffortLabel !== null && jsx('span', { className: 'evo-composer-model-effort', children: `${t('reasoningEffort')} ${currentEffortLabel}` }),
      ],
    }),
    open && pos !== null && jsxs('div', {
      className: 'evo-composer-model-menu',
      ref: menuRef,
      role: 'listbox',
      'aria-label': t('selectModel'),
      style: {
        left: pos.left,
        top: pos.top,
        ...(pos.upward ? { transform: 'translateY(-100%)' } : {}),
      },
      children: [
        jsx('div', { className: 'evo-composer-model-menu-hint', children: t('modelTierHint') }),
        error !== null && jsx('div', { className: 'evo-panel-error', children: error }),
        tiers === null
          ? jsx('div', { className: 'evo-setting-hint', children: t('loading') })
          : tiers.map((entry) => {
              const configured = entry.provider !== '' && entry.model !== ''
              const active = current.tier === entry.key
              const effort = effortLabel(entry.reasoningEffort)
              return jsx('button', {
                type: 'button',
                className: 'evo-tier-option',
                'data-active': active || undefined,
                disabled: saving !== null || !configured,
                onClick: () => apply(entry.key),
                children: [
                  jsxs('div', { className: 'evo-tier-option-head', children: [
                    jsx('span', { className: 'evo-tier-option-name', children: tierMeta[entry.key].name }),
                    jsx('span', { className: 'evo-tier-option-desc', children: tierMeta[entry.key].desc }),
                    active && jsx('span', { className: 'evo-tier-option-current', children: t('currentModel') }),
                  ] }),
                  jsx('div', {
                    className: 'evo-tier-option-detail',
                    children: configured
                      ? `${names.providers.get(entry.provider) ?? entry.provider} · ${names.models.get(entry.model) ?? entry.model}${effort !== null ? ` · ${t('reasoningEffort')} ${effort}` : ''}`
                      : t('notConfigured'),
                  }),
                ],
              }, entry.key)
            }),
      ],
    }),
  ] })
}
