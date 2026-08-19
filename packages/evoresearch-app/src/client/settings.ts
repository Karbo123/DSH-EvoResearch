/**
 * 设置面板：左侧 tab 导航 + 右侧配置 + 左上角「返回」（图标 + 文字）。
 * - 通用：权限模式 / 默认模型 / 插件清单 / 关于（主题与语言在顶栏，不重复）；
 * - 模型设置：1）模型提供商（Provider 接口配置 + 统一「已获取模型」列表）；
 *   2）模型分配（代码三档 / 图片识别 / 图片生成 / 语音识别，从 Provider
 *   模型列表选择并设置推理强度）；
 * - 清除数据。
 */
import { jsx, jsxs, Fragment } from 'react/jsx-runtime'
import { useState, useEffect, useRef } from 'react'
import { ArrowLeft, Check, ChevronDown, Cpu, Info, Puzzle, ShieldCheck as ShieldCheckIcon, Code2, Eye, Image as ImageIcon, Mic, Trash2, Server, Plus, X, Zap } from 'lucide-react'
import { t } from './i18n'
import { toast } from './toast'
import { ConfirmDialog } from './session-actions'

export interface SettingsDialogProps {
  onClose: () => void
  /** 当前会话 id（权限切换目标；无会话时为 null）。 */
  sessionId: string | null
}

interface PluginRow { id: string; state: string }

/** 构建指纹（§44.2）：读取 dist/build-stamp.json（前端 hash + 构建时间）。 */
function BuildStamp() {
  const [stamp, setStamp] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    void fetch('/build-stamp.json')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || j === null || typeof j.revision !== 'string') return
        const when = typeof j.builtAt === 'string' ? ` · ${j.builtAt.slice(0, 16).replace('T', ' ')}` : ''
        setStamp(`build ${j.revision}${when}`)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])
  return stamp === null ? jsx('div', {}) : jsx('div', { style: { color: 'var(--color-text-tertiary)', fontSize: 11.5 }, children: stamp })
}

/** 权限模式选择（写 host permission 预设）。 */
function PermissionSection({ sessionId }: { sessionId: string | null }) {
  const [current, setCurrent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void fetch('/evoresearch/fs/mode').then((res) => res.json()).then((json) => {
      if (!cancelled && json.ok) setCurrent(json.value.preset)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  const switchMode = (preset: string) => {
    if (sessionId === null) { setError('打开一个会话后可切换权限模式'); return }
    void fetch('/evoresearch/fs/mode', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, preset }),
    }).then((res) => res.json()).then((json) => {
      if (json.ok) setCurrent(preset)
      else setError(json.error?.message ?? '切换失败')
    }).catch((e: any) => setError(String(e)))
  }

  const presets = [
    { key: 'read-only', label: t('readOnly') },
    { key: 'workspace-write', label: t('permWrite') },
    { key: 'danger-full-access', label: t('fullEffect') },
  ]
  return jsxs('div', {
    className: 'evo-setting',
    children: [
      jsxs('div', {
        className: 'evo-setting-label',
        children: [jsx(ShieldCheckIcon, {}), jsx('span', { children: t('permission') })],
      }),
      jsx('div', {
        className: 'evo-mode-row',
        children: presets.map((p) => jsx('button', {
          type: 'button',
          className: 'evo-mode-chip',
          'data-active': current === p.key || undefined,
          onClick: () => switchMode(p.key),
          children: p.label,
        }, p.key)),
      }),
      error !== null && jsx('div', { className: 'evo-panel-error', children: error }),
    ],
  })
}

/** 插件清单（官方插件状态快照）。 */
function PluginListSection() {
  const [plugins, setPlugins] = useState<PluginRow[] | null>(null)
  useEffect(() => {
    let cancelled = false
    void fetch('/evoresearch/fs/plugins').then((res) => res.json()).then((json) => {
      if (!cancelled && json.ok && Array.isArray(json.value)) {
        setPlugins((json.value as Array<{ id: string; state?: string }>).map((p) => ({ id: p.id, state: p.state ?? '' })))
      }
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])
  return jsxs('div', {
    className: 'evo-setting',
    children: [
      jsxs('div', {
        className: 'evo-setting-label',
        children: [jsx(Puzzle, {}), jsx('span', { children: t('plugins') })],
      }),
      plugins === null
        ? jsx('div', { className: 'evo-setting-hint', children: 'Loading…' })
        : plugins.length === 0
          ? jsx('div', { className: 'evo-setting-hint', children: t('noModels') })
          : jsx('div', { className: 'evo-plugin-list', children: plugins.map((p) => jsxs('div', { className: 'evo-plugin-row', children: [jsx('span', { children: p.id }), jsx('span', { className: 'evo-plugin-state', children: p.state })] }, p.id)) }),
    ],
  })
}

/** 关于：版本 + 基于 + 构建指纹。 */
function AboutSection() {
  return jsxs('div', {
    className: 'evo-setting',
    children: [
      jsxs('div', {
        className: 'evo-setting-label',
        children: [jsx(Info, {}), jsx('span', { children: t('about') })],
      }),
      jsxs('div', {
        className: 'evo-setting-hint',
        children: [
          jsx('div', { children: `EvoResearch 0.1.0-rc.1` }),
          jsx('div', { children: t('basedOn') }),
          jsx(BuildStamp, {}),
        ],
      }),
    ],
  })
}

/** 模型分配（代码三档 + 视觉/图片/语音）：provider / model / reasoningEffort 等。 */
interface AssignSetting {
  provider: string
  model: string
  reasoningEffort?: string
}

interface TestState {
  busy: boolean
  ok: boolean
  message: string
}

interface DropdownOption { value: string; label: string }

/**
 * 主题化下拉（仿左侧「搜索标题或内容」旁的排序弹层）：
 * 按钮 + 自定义浮层，避免原生 select 的长列表把弹层撑得过高；
 * 长列表限高滚动，选中项带对勾与品牌色高亮。
 */
function Dropdown({ value, options, onChange, placeholder, className }: {
  value: string
  options: DropdownOption[]
  onChange: (v: string) => void
  placeholder?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ left: number; top: number; width: number; upward: boolean } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    const onDocDown = (e: MouseEvent) => {
      const el = e.target as Node | null
      if (el === null) return
      if (btnRef.current !== null && btnRef.current.contains(el)) return
      if (el instanceof Element && el.closest('.evo-dropdown-menu') !== null) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    document.addEventListener('mousedown', onDocDown)
    document.addEventListener('keydown', onKey)
    document.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('mousedown', onDocDown)
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  const toggle = () => {
    if (open) { setOpen(false); return }
    const r = btnRef.current?.getBoundingClientRect()
    if (r !== undefined) {
      const upward = r.bottom + 310 > window.innerHeight && r.top > 310
      setPos({ left: r.left, top: upward ? r.top - 6 : r.bottom + 6, width: r.width, upward })
    }
    setOpen(true)
  }
  const selected = options.find((o) => o.value === value)
  const display = selected?.label ?? (value !== '' ? value : (placeholder ?? t('assignmentNone')))
  return jsxs('div', {
    className: `evo-dropdown${className !== undefined ? ` ${className}` : ''}`,
    children: [
      jsx('button', {
        ref: btnRef,
        type: 'button',
        className: `evo-dropdown-btn${open ? ' evo-dropdown-open' : ''}`,
        'aria-expanded': open || undefined,
        'aria-haspopup': 'listbox',
        onClick: toggle,
        children: jsxs(Fragment, { children: [
          jsx('span', { className: 'evo-dropdown-value', children: display }),
          jsx(ChevronDown, {}),
        ] }),
      }),
      open && pos !== null && jsxs('div', {
        className: 'evo-dropdown-menu',
        role: 'listbox',
        style: {
          left: pos.left,
          top: pos.top,
          minWidth: Math.max(pos.width, 168),
          ...(pos.upward ? { transform: 'translateY(-100%)' } : {}),
        },
        children: options.map((o) => jsxs('button', {
          type: 'button',
          className: 'evo-dropdown-option',
          'data-active': o.value === value || undefined,
          role: 'option',
          'aria-selected': o.value === value || undefined,
          onClick: () => { onChange(o.value); setOpen(false) },
          children: [
            jsx('span', { children: o.label }),
            o.value === value && jsx(Check, {}),
          ],
        }, o.value)),
      }),
    ],
  })
}

/** 模型分配下拉用的模型条目（含输入模态，用于视觉/语音过滤）。 */
interface AssignModelOption {
  id: string
  name: string
  supportedReasoning: string[] | null
  input: string[] | null
}

function ModelField({ label, value, onChange, placeholder, className }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return jsxs('label', {
    className: className !== undefined ? `evo-setting-field ${className}` : 'evo-setting-field',
    children: [
      jsx('span', { className: 'evo-setting-field-label', children: label }),
      jsx('input', {
        type: 'text',
        className: 'evo-panel-input',
        value: value,
        placeholder: placeholder ?? '',
        onInput: (e: { currentTarget: HTMLInputElement }) => onChange(e.currentTarget.value),
      }),
    ],
  })
}


/** 模型分配（模型设置第 2 步）：从模型提供商 Provider 的模型列表中选择各任务模型并设置推理强度。 */
function ModelAssignSection() {
  const [assign, setAssign] = useState<Record<string, AssignSetting> | null>(null)
  const [providers, setProviders] = useState<LlmProviderEditor[]>([])
  const [catalog, setCatalog] = useState<Array<{ provider?: { id?: string }; models?: Array<{ id?: string; name?: string; supportedReasoning?: string[] | null; input?: string[] | null }> }>>([])
  const [saving, setSaving] = useState<string | null>(null)
  const [testState, setTestState] = useState<Record<string, TestState>>({})
  const [error, setError] = useState<string | null>(null)
  const [migrated, setMigrated] = useState<Record<string, string>>({})

  const providerModels = (providerId: string): AssignModelOption[] => {
    const group = catalog.find((g) => g.provider?.id === providerId)
    const live = (group?.models ?? []).filter((m) => m.id !== undefined && m.id !== '')
    if (live.length > 0) {
      return live.map((m) => ({ id: m.id as string, name: m.name ?? (m.id as string), supportedReasoning: Array.isArray(m.supportedReasoning) ? m.supportedReasoning : null, input: Array.isArray(m.input) ? m.input as string[] : null }))
    }
    return (providers.find((p) => p.id === providerId)?.models ?? []).map((m) => ({ id: m.id, name: m.name !== '' ? m.name : m.id, supportedReasoning: m.supportedReasoning, input: null }))
  }
  /** 各分配类型要求的输入模态：vision=图片输入，voice=音频输入；其余不限。 */
  const kindInputModality = (kind: string): string | null => (kind === 'vision' ? 'image' : kind === 'voice' ? 'audio' : null)
  /** 按模态过滤模型：无模态信息（未知）时放行，避免网关拿不到目录时误伤。 */
  const modelOptionsFor = (kind: string, providerId: string): AssignModelOption[] => {
    const all = providerModels(providerId)
    const modality = kindInputModality(kind)
    if (modality === null) return all
    return all.filter((m) => m.input === null || m.input.includes(modality))
  }
  const defaultReasoning = (supported: string[] | null | undefined): string => {
    if (!Array.isArray(supported) || supported.length === 0) return 'high'
    if (supported.includes('high')) return 'high'
    const nonOff = supported.find((l) => l !== 'off')
    return nonOff ?? 'off'
  }

  const load = () => {
    setError(null)
    void Promise.all([
      fetch('/evoresearch/fs/model-settings-get', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then((r) => r.json()),
      fetch('/evoresearch/fs/llm-providers', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then((r) => r.json()),
      fetch('/evoresearch/fs/models-catalog', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then((r) => r.json()).catch(() => ({ ok: false })),
    ]).then(([ms, lp, cat]) => {
      const providerList: LlmProviderEditor[] = lp.ok === true ? (lp.value?.providers ?? []).map((p: Record<string, unknown>) => ({
        id: String(p.id ?? ''),
        displayName: String(p.displayName ?? ''),
        baseURL: String(p.baseURL ?? ''),
        apiKeyEnv: String(p.apiKeyEnv ?? ''),
        apiKey: String(p.apiKey ?? ''),
        api: String(p.api ?? 'openai-completions'),
        models: (Array.isArray(p.models) ? p.models : []).map((m: Record<string, unknown>) => ({
          id: String(m.id ?? ''),
          name: String(m.name ?? ''),
          contextWindow: m.contextWindow == null ? null : Number(m.contextWindow),
          reasoningEfforts: (m.reasoningEfforts === undefined ? null : m.reasoningEfforts) as LlmModelRow['reasoningEfforts'],
          supportedReasoning: null,
        })),
      })) : []
      const groups: Array<{ provider?: { id?: string }; models?: Array<{ id?: string; name?: string; supportedReasoning?: string[] | null; input?: string[] | null }> }> = cat.ok === true ? (cat.value?.groups ?? []) : []
      setProviders(providerList)
      setCatalog(groups)
      const raw = (ms.ok === true ? ms.value : {}) as Record<string, unknown>
      const rawCode = (raw.code ?? {}) as Record<string, unknown>
      const ids = new Set(providerList.map((p) => p.id))
      const modelsOf = (providerId: string): AssignModelOption[] => {
        const group = groups.find((g) => g.provider?.id === providerId)
        const live = (group?.models ?? []).filter((m) => m.id !== undefined && m.id !== '')
        if (live.length > 0) return live.map((m) => ({ id: m.id as string, name: m.name ?? (m.id as string), supportedReasoning: Array.isArray(m.supportedReasoning) ? m.supportedReasoning : null, input: Array.isArray(m.input) ? m.input as string[] : null }))
        return (providerList.find((p) => p.id === providerId)?.models ?? []).map((m) => ({ id: m.id, name: m.name !== '' ? m.name : m.id, supportedReasoning: m.supportedReasoning, input: null }))
      }
      const entries: Array<[string, Record<string, unknown>]> = [
        ['simple', (rawCode.simple ?? {}) as Record<string, unknown>],
        ['medium', (rawCode.medium ?? {}) as Record<string, unknown>],
        ['complex', (rawCode.complex ?? {}) as Record<string, unknown>],
        ['vision', (raw.vision ?? {}) as Record<string, unknown>],
        ['image', (raw.image ?? {}) as Record<string, unknown>],
        ['voice', (raw.voice ?? {}) as Record<string, unknown>],
      ]
      const next: Record<string, AssignSetting> = {}
      const migratedMap: Record<string, string> = {}
      for (const [key, cur] of entries) {
        let provider = String(cur.provider ?? '')
        let model = String(cur.model ?? '')
        if (provider !== '' && !ids.has(provider)) {
          const first = providerList[0]
          if (first !== undefined) {
            migratedMap[key] = provider
            provider = first.id
            const models = modelsOf(first.id)
            if (models.length > 0 && !models.some((m) => m.id === model)) {
              const hit = [...models].sort((a, b) => referenceScore(model, b.id) - referenceScore(model, a.id))[0]
              model = hit !== undefined ? hit.id : ''
            }
          }
        }
        next[key] = {
          provider,
          model,
          reasoningEffort: '',
        }
        // 尚未配置的分配（常见于图片识别/语音识别）：自动预选第一个 Provider，
        // 并按该分配要求的输入模态挑一个合适的默认模型，避免"看着有选项其实没选中"。
        if (next[key].provider === '' && providerList.length > 0) {
          provider = providerList[0].id
          next[key].provider = provider
          const modality = kindInputModality(key)
          const candidates = modality === null ? modelsOf(provider) : modelsOf(provider).filter((m) => m.input === null || m.input.includes(modality))
          const hit = candidates.find((m) => m.id === model) ?? candidates[0]
          if (hit !== undefined) {
            model = hit.id
            next[key].model = model
          }
        }
        if (model !== '') {
          const sup = modelsOf(provider).find((m) => m.id === model)?.supportedReasoning ?? null
          const stored = typeof cur.reasoningEffort === 'string' ? cur.reasoningEffort : ''
          next[key].reasoningEffort = Array.isArray(sup) && sup.length > 0
            ? (sup.includes(stored) ? stored : defaultReasoning(sup))
            : (stored !== '' ? stored : defaultReasoning(null))
        }
      }
      setAssign(next)
      setMigrated(migratedMap)
    }).catch((e: unknown) => setError((e as Error)?.message ?? '加载失败'))
  }
  useEffect(load, [])

  const setField = (key: string, field: keyof AssignSetting, value: string) => {
    setAssign((prev) => (prev === null ? prev : { ...prev, [key]: { ...(prev[key] ?? {}), [field]: value } }))
  }
  const changeProvider = (key: string, providerId: string) => {
    const models = modelOptionsFor(key, providerId)
    setAssign((prev) => (prev === null ? prev : { ...prev, [key]: { ...(prev[key] ?? {}), provider: providerId, model: models[0]?.id ?? '', reasoningEffort: defaultReasoning(models[0]?.supportedReasoning) } }))
  }
  const changeModel = (key: string, modelId: string) => {
    const m = assign !== null ? modelOptionsFor(key, assign[key]?.provider ?? '').find((x) => x.id === modelId) : undefined
    setAssign((prev) => (prev === null ? prev : { ...prev, [key]: { ...(prev[key] ?? {}), model: modelId, reasoningEffort: defaultReasoning(m?.supportedReasoning) } }))
  }
  const offeredLevels = (key: string): Array<[string, string]> => {
    const v = assign?.[key]
    if (v === undefined) return REASONING_LEVELS
    const m = providerModels(v.provider).find((x) => x.id === v.model)
    const sup = m?.supportedReasoning
    if (Array.isArray(sup) && sup.length > 0) return REASONING_LEVELS.filter(([level]) => sup.includes(level))
    return REASONING_LEVELS
  }
  const applyTier = (tier: string) => {
    if (saving !== null || assign === null) return
    const v = assign[tier]
    if (v === undefined || v.provider === '' || v.model === '') { setError(t('assignSaveFailed')); return }
    setSaving(`apply:${tier}`)
    setError(null)
    void fetch('/evoresearch/fs/model-settings-apply', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tier }),
    }).then((r) => r.json()).then((json) => {
      if (json.ok) toast(t('modelSettingsSaved'), 'success')
      else setError(json.error?.message ?? t('assignSaveFailed'))
    }).catch((e: unknown) => setError((e as Error)?.message ?? t('assignSaveFailed')))
      .finally(() => setSaving(null))
  }
  const saveCard = (keys: string[]) => {
    if (saving !== null || assign === null) return
    const cardKey = keys.join('+')
    setSaving(cardKey)
    setError(null)
    const patch: Record<string, unknown> = keys[0] === 'simple'
      ? { code: {
          simple: { provider: assign.simple?.provider ?? '', model: assign.simple?.model ?? '', reasoningEffort: assign.simple?.reasoningEffort ?? '' },
          medium: { provider: assign.medium?.provider ?? '', model: assign.medium?.model ?? '', reasoningEffort: assign.medium?.reasoningEffort ?? '' },
          complex: { provider: assign.complex?.provider ?? '', model: assign.complex?.model ?? '', reasoningEffort: assign.complex?.reasoningEffort ?? '' },
        } }
      : { [keys[0]]: assign[keys[0]] }
    void (async () => {
      try {
        const saved = await fetch('/evoresearch/fs/model-settings-set', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ patch }),
        }).then((r) => r.json())
        if (saved.ok !== true) throw new Error(saved.error?.message ?? t('assignSaveFailed'))
        // 按 Provider 聚合推理强度写回：同一 Provider 的多档修改合并成一次保存，
        // 避免后写的模型列表覆盖先写的条目。
        const providerLists = new Map<string, Array<{ id: string; name: string; contextWindow: number | null; reasoningEfforts: LlmModelRow['reasoningEfforts'] }>>()
        for (const key of keys) {
          const v = assign[key]
          if (v === undefined || v.provider === '' || v.model === '') continue
          const provider = providers.find((p) => p.id === v.provider)
          if (provider === undefined) continue
          if (!providerLists.has(v.provider)) {
            providerLists.set(v.provider, provider.models.map((m) => ({ id: m.id, name: m.name, contextWindow: m.contextWindow, reasoningEfforts: m.reasoningEfforts })))
          }
          const list = providerLists.get(v.provider) as Array<{ id: string; name: string; contextWindow: number | null; reasoningEfforts: LlmModelRow['reasoningEfforts'] }>
          const level = typeof v.reasoningEffort === 'string' ? v.reasoningEffort : ''
          if (level !== '') {
            const idx = list.findIndex((m) => m.id === v.model)
            const supported = providerModels(v.provider).find((m) => m.id === v.model)?.supportedReasoning ?? null
            const efforts = applyModelReasoning(level, supported)
            if (idx >= 0) list[idx] = { ...list[idx], reasoningEfforts: efforts }
            else list.push({ id: v.model, name: v.model, contextWindow: null, reasoningEfforts: efforts })
          }
        }
        const failures: string[] = []
        for (const [pid, list] of providerLists) {
          const wb = await fetch('/evoresearch/fs/llm-provider-save', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              provider: pid,
              patch: { models: list.map((m) => ({
                id: m.id,
                name: m.name !== '' && m.name !== m.id ? m.name : undefined,
                reasoningEfforts: m.reasoningEfforts === null || m.reasoningEfforts === undefined ? undefined : m.reasoningEfforts,
              })) },
            }),
          }).then((r) => r.json())
          if (wb.ok !== true) failures.push(pid)
        }
        if (failures.length > 0) setError(`分配已保存，但推理强度写回 Provider 失败：${failures.join('、')}`)
        else toast(t('assignSaved'), 'success')
        load()
      } catch (e: unknown) {
        setError((e as Error)?.message ?? t('assignSaveFailed'))
      } finally {
        setSaving(null)
      }
    })()
  }

  const renderSelect = (key: string, field: 'provider' | 'model' | 'reasoningEffort', options: Array<[string, string]>, onChange: (v: string) => void) => {
    const v = assign?.[key]
    if (v === undefined) return null
    const current = String(v[field] ?? '')
    const exists = current === '' || options.some(([value]) => value === current)
    const label = field === 'provider' ? t('providerLabel') : field === 'model' ? t('modelLabel') : t('reasoningEffort')
    const missing = current !== '' ? t('assignmentMissing').replace('{value}', current) : ''
    return jsxs('label', {
      className: 'evo-setting-field',
      children: [
        jsx('span', { className: 'evo-setting-field-label', children: label }),
        jsx(Dropdown, {
          value: current,
          className: 'evo-select-compact',
          onChange,
          options: [
            ...(!exists && current !== '' ? [{ value: current, label: `${current}（${missing}）` }] : []),
            ...options.map(([value, optionLabel]) => ({ value, label: optionLabel })),
          ],
        }),
      ],
    })
  }

  const providerOptions = providers.map((p) => [p.id, p.displayName !== '' ? p.displayName : p.id] as [string, string])
  const providerLabel = (id: string): string => {
    const p = providers.find((x) => x.id === id)
    return p !== undefined && p.displayName !== '' ? p.displayName : id
  }
  const tierMeta: Record<string, { name: string; desc: string }> = {
    simple: { name: t('tierSimple'), desc: t('tierSimpleDesc') },
    medium: { name: t('tierMedium'), desc: t('tierMediumDesc') },
    complex: { name: t('tierComplex'), desc: t('tierComplexDesc') },
  }

  /** 连通性测试：对卡片内已选模型逐个发极短请求（相同 provider+model 只测一次）。 */
  const testCard = (keys: string[]) => {
    if (saving !== null || assign === null) return
    const cardKey = keys.join('+')
    const targets = keys
      .map((k) => ({ key: k, v: assign[k] }))
      .filter((x): x is { key: string; v: AssignSetting } => x.v !== undefined && x.v.provider !== '' && x.v.model !== '')
    if (targets.length === 0) {
      setTestState((s) => ({ ...s, [cardKey]: { busy: false, ok: false, message: t('testModelNone') } }))
      return
    }
    const unique: Array<{ key: string; v: AssignSetting }> = []
    const seen = new Set<string>()
    for (const x of targets) {
      const sig = `${x.v.provider}\u0000${x.v.model}`
      if (!seen.has(sig)) { seen.add(sig); unique.push(x) }
    }
    setTestState((s) => ({ ...s, [cardKey]: { busy: true, ok: false, message: t('testModelBusy') } }))
    void (async () => {
      const parts: string[] = []
      for (let i = 0; i < unique.length; i++) {
        const { key, v } = unique[i]!
        const label = unique.length > 1 ? `${tierMeta[key]?.name ?? key}·${v.model}` : v.model
        setTestState((s) => ({ ...s, [cardKey]: { busy: true, ok: false, message: `${t('testModelBusy')}：${label}` } }))
        let detail = ''
        try {
          const json = await fetch('/evoresearch/fs/llm-model-test', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ provider: v.provider, model: v.model, reasoningEffort: v.reasoningEffort ?? '' }),
          }).then((r) => r.json())
          const value = (json?.value ?? {}) as { ok?: boolean; latencyMs?: number; error?: string }
          const ok = json?.ok === true && value.ok === true
          detail = ok ? (value.latencyMs !== undefined ? `✓ ${value.latencyMs}ms` : '✓') : `✗ ${value.error ?? json?.error?.message ?? ''}`
        } catch (e: unknown) {
          detail = `✗ ${(e as Error)?.message ?? ''}`
        }
        parts.push(`${label} ${detail}`)
      }
      setTestState((s) => ({ ...s, [cardKey]: { busy: false, ok: parts.every((p) => p.includes('✓')), message: parts.join('；') } }))
    })()
  }

  return jsxs('div', {
    className: 'evo-setting',
    children: [
      jsxs('div', {
        className: 'evo-setting-label',
        children: [jsx(Server, {}), jsx('span', { children: t('modelStepAssignments') })],
      }),
      jsx('div', { className: 'evo-setting-hint', children: t('modelAssignmentsHint') }),
      error !== null && jsx('div', { className: 'evo-panel-error', children: error }),
      assign === null
        ? jsx('div', { className: 'evo-setting-hint', children: 'Loading…' })
        : providers.length === 0
          ? jsx('div', { className: 'evo-setting-hint', children: t('noLlmProviders') })
          : jsxs(Fragment, { children: [
              jsxs('div', { className: 'evo-tier-card evo-assign-card', children: [
                jsxs('div', { className: 'evo-assign-head', children: [
                  jsx(Code2, {}),
                  jsx('span', { className: 'evo-assign-head-title', children: t('settingsCodeModel') }),
                  jsx('span', { className: 'evo-assign-head-desc', children: t('codeModelHint') }),
                ] }),
                ['simple', 'medium', 'complex'].map((tier) => jsxs('div', { className: 'evo-assign-tier', children: [
                  jsxs('div', { className: 'evo-assign-tier-head', children: [
                    jsx('span', { className: 'evo-assign-tier-name', children: tierMeta[tier].name }),
                    jsx('span', { className: 'evo-assign-tier-desc', children: tierMeta[tier].desc }),
                  ] }),
                  jsxs('div', { className: 'evo-assign-grid tier', children: [
                    renderSelect(tier, 'provider', providerOptions, (v) => changeProvider(tier, v)),
                    renderSelect(tier, 'model', providerModels(assign[tier].provider).map((m) => [m.id, m.name] as [string, string]), (v) => changeModel(tier, v)),
                    renderSelect(tier, 'reasoningEffort', offeredLevels(tier), (v) => setField(tier, 'reasoningEffort', v)),
                    jsx('button', {
                      type: 'button',
                      className: 'evo-btn evo-btn-run',
                      disabled: saving !== null,
                      onClick: () => applyTier(tier),
                      children: jsxs(Fragment, { children: [jsx(Cpu, {}), jsx('span', { children: t('applyAsDefault') })] }),
                    }),
                  ] }),
                  migrated[tier] !== undefined && jsx('div', { className: 'evo-assign-migrate', children: t('migratedProviderHint').replace('{old}', migrated[tier]).replace('{new}', providerLabel(assign[tier].provider)) }),
                ] }, tier)),
                jsxs('div', { className: 'evo-assign-actions', children: [
                  jsx('button', {
                    type: 'button',
                    className: 'evo-btn',
                    disabled: saving !== null || testState['simple+medium+complex']?.busy === true,
                    onClick: () => testCard(['simple', 'medium', 'complex']),
                    children: jsxs(Fragment, { children: [jsx(Zap, {}), jsx('span', { children: testState['simple+medium+complex']?.busy === true ? t('testModelBusy') : t('testModel') })] }),
                  }),
                  jsx('button', {
                    type: 'button',
                    className: 'evo-btn evo-btn-ok',
                    disabled: saving !== null,
                    onClick: () => saveCard(['simple', 'medium', 'complex']),
                    children: jsxs(Fragment, { children: [jsx(Cpu, {}), jsx('span', { children: saving !== null ? t('saving') : t('save') })] }),
                  }),
                ] }),
                testState['simple+medium+complex'] !== undefined && testState['simple+medium+complex']!.message !== ''
                  && jsx('div', { className: `evo-assign-test ${testState['simple+medium+complex']!.ok ? 'ok' : 'fail'}`, children: testState['simple+medium+complex']!.message }),
              ] }),
              (['vision', 'image', 'voice'] as const).map((kind) => {
                const meta = kind === 'vision'
                  ? { icon: Eye, title: t('settingsVision'), hint: t('visionHint') }
                  : kind === 'image'
                    ? { icon: ImageIcon, title: t('settingsImage'), hint: t('imageHint') }
                    : { icon: Mic, title: t('settingsVoice'), hint: t('voiceHint') }
                const Icon = meta.icon
                const modelOptions = modelOptionsFor(kind, assign[kind].provider)
                const modelHasProfile = modelOptions.find((m) => m.id === assign[kind].model)?.supportedReasoning != null
                const modalityEmpty = kindInputModality(kind) !== null && modelOptions.length === 0
                return jsxs('div', { className: 'evo-tier-card evo-assign-card', children: [
                  jsxs('div', { className: 'evo-assign-head', children: [
                    jsx(Icon, {}),
                    jsx('span', { className: 'evo-assign-head-title', children: meta.title }),
                    jsx('span', { className: 'evo-assign-head-desc', children: meta.hint }),
                  ] }),
                  jsxs('div', { className: 'evo-assign-grid', children: [
                    renderSelect(kind, 'provider', providerOptions, (v) => changeProvider(kind, v)),
                    renderSelect(kind, 'model', modelOptions.map((m) => [m.id, m.name] as [string, string]), (v) => changeModel(kind, v)),
                    renderSelect(kind, 'reasoningEffort', offeredLevels(kind), (v) => setField(kind, 'reasoningEffort', v)),
                  ] }),
                  modalityEmpty && jsx('div', { className: 'evo-assign-hint', children: kind === 'vision' ? t('noVisionModels') : t('noVoiceModels') }),
                  modelHasProfile === false && !modalityEmpty && jsx('div', { className: 'evo-assign-hint', children: t('assignmentReasoningHint') }),
                  migrated[kind] !== undefined && jsx('div', { className: 'evo-assign-migrate', children: t('migratedProviderHint').replace('{old}', migrated[kind]).replace('{new}', providerLabel(assign[kind].provider)) }),
                  jsxs('div', { className: 'evo-assign-actions', children: [
                    jsx('button', {
                      type: 'button',
                      className: 'evo-btn',
                      disabled: saving !== null || testState[kind]?.busy === true,
                      onClick: () => testCard([kind]),
                      children: jsxs(Fragment, { children: [jsx(Zap, {}), jsx('span', { children: testState[kind]?.busy === true ? t('testModelBusy') : t('testModel') })] }),
                    }),
                    jsx('button', {
                      type: 'button',
                      className: 'evo-btn evo-btn-ok',
                      disabled: saving !== null,
                      onClick: () => saveCard([kind]),
                      children: jsxs(Fragment, { children: [jsx(Cpu, {}), jsx('span', { children: saving !== null ? t('saving') : t('save') })] }),
                    }),
                  ] }),
                  testState[kind] !== undefined && testState[kind]!.message !== ''
                    && jsx('div', { className: `evo-assign-test ${testState[kind]!.ok ? 'ok' : 'fail'}`, children: testState[kind]!.message }),
                ] }, kind)
              }),
            ] }),
    ],
  })
}

/** 清除数据（设置面板）：三类数据可多选，二次确认后执行；成功后刷新页面。 */
function DataClearSection() {
  const [checked, setChecked] = useState({ projects: false, models: false, prefs: false })
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const anyChecked = checked.projects || checked.models || checked.prefs

  const rows: Array<{ key: 'projects' | 'models' | 'prefs'; title: string; desc: string }> = [
    { key: 'projects', title: t('clearProjects'), desc: t('clearProjectsDesc') },
    { key: 'models', title: t('clearModels'), desc: t('clearModelsDesc') },
    { key: 'prefs', title: t('clearPrefs'), desc: t('clearPrefsDesc') },
  ]

  const execute = () => {
    if (!anyChecked || busy) return
    if (!confirming) {
      setConfirming(true)
      setError(null)
      setTimeout(() => setConfirming(false), 5000)
      return
    }
    setBusy(true)
    setError(null)
    const scopes: string[] = []
    if (checked.projects) scopes.push('projects')
    if (checked.models) scopes.push('models')
    if (checked.prefs) {
      // 本地偏好（主题/语言/布局/输入历史等）只存在浏览器 localStorage
      const keys: string[] = []
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i)
        if (key !== null && key.startsWith('evoresearch-')) keys.push(key)
      }
      for (const key of keys) localStorage.removeItem(key)
    }
    const finish = (ok: boolean, message?: string, notice?: string) => {
      setBusy(false)
      if (!ok) {
        setError(message ?? t('dataClearError'))
        setConfirming(false)
        return
      }
      if (notice !== undefined && notice !== '') toast(notice, 'error')
      else toast(t('dataCleared'), 'success')
      setTimeout(() => { window.location.reload() }, 600)
    }
    if (scopes.length === 0) {
      finish(true)
      return
    }
    void fetch('/evoresearch/fs/data-clear', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scopes }),
    }).then((res) => res.json()).then((json) => {
      if (json.ok !== true) throw new Error(json.error?.message ?? t('dataClearError'))
      const warnings = Array.isArray(json.value?.warnings) ? json.value.warnings as string[] : []
      finish(true, undefined, warnings.length > 0 ? `${t('dataClearPartial')} ${warnings.join('、')}` : undefined)
    }).catch((e: unknown) => finish(false, (e as Error)?.message ?? t('dataClearError')))
  }

  return jsxs('div', {
    className: 'evo-setting',
    children: [
      jsxs('div', {
        className: 'evo-setting-label',
        children: [jsx(Trash2, {}), jsx('span', { children: t('settingsData') })],
      }),
      jsx('div', { className: 'evo-setting-hint', children: t('clearDataHint') }),
      jsx('div', { className: 'evo-clear-rows', children: rows.map((row) => jsxs('label', {
        className: `evo-clear-row${checked[row.key] ? ' checked' : ''}`,
        children: [
          jsx('input', {
            type: 'checkbox',
            checked: checked[row.key],
            onChange: (e: { currentTarget: HTMLInputElement }) => {
              const next = e.currentTarget.checked
              setChecked((prev) => ({ ...prev, [row.key]: next }))
              setConfirming(false)
            },
          }),
          jsxs('span', { className: 'evo-clear-row-text', children: [
            jsx('span', { className: 'evo-clear-row-title', children: row.title }),
            jsx('span', { className: 'evo-clear-row-desc', children: row.desc }),
          ] }),
        ],
      }, row.key)) }),
      confirming && jsx('div', { className: 'evo-panel-error', children: t('clearDataWarning') }),
      error !== null && jsx('div', { className: 'evo-panel-error', children: error }),
      jsx('button', {
        type: 'button',
        className: `evo-btn evo-btn-danger${confirming ? ' confirming' : ''}`,
        disabled: !anyChecked || busy,
        onClick: execute,
        children: jsxs(Fragment, { children: [jsx(Trash2, {}), jsx('span', { children: busy ? t('clearDataBusy') : confirming ? t('clearDataConfirm') : t('clearDataBtn') })] }),
      }),
    ],
  })
}

/** 模型提供商（§25.2 扩展）：编辑 provider 的 API URL / Key / 模型列表；推理强度在模型分配里设置。 */
const REASONING_LEVELS: Array<[string, string]> = [
  ['off', t('effortOff')],
  ['minimal', t('effortMinimal')],
  ['low', t('effortLow')],
  ['medium', t('effortMedium')],
  ['high', t('effortHigh')],
  ['xhigh', t('effortXhigh')],
  ['max', t('effortMax')],
]

interface LlmModelRow {
  id: string
  name: string
  contextWindow: number | null
  reasoningEfforts: Record<string, string | null> | false | null
  supportedReasoning: string[] | null
}

interface LlmProviderEditor {
  id: string
  /** Provider ID 编辑草稿：非空且与 id 不同时，保存会执行重命名。 */
  newId?: string
  displayName: string
  baseURL: string
  apiKeyEnv: string
  apiKey: string
  api: string
  models: LlmModelRow[]
}

/** 编辑距离（用于把名字最接近的参照模型排到前面）。 */
function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  const dp: number[] = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i += 1) {
    let prev = dp[0]
    dp[0] = i
    for (let j = 1; j <= n; j += 1) {
      const tmp = dp[j]
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = tmp
    }
  }
  return dp[n]
}

/** 模型名与参照名的相似度：公共前缀优先，其次编辑距离，子串包含加分。 */
function referenceScore(modelId: string, refId: string): number {
  const x = modelId.toLowerCase()
  const y = refId.toLowerCase()
  if (x === y) return Number.MAX_SAFE_INTEGER
  let prefix = 0
  const max = Math.min(x.length, y.length)
  while (prefix < max && x[prefix] === y[prefix]) prefix += 1
  let score = prefix * 10
  score += Math.max(0, 100 - levenshtein(x, y))
  if (x.includes(y) || y.includes(x)) score += 30
  return score
}

/**
 * 设置模型推理强度 → reasoningEfforts（off=不支持推理；单档=off+该档）。
 * 当模型在官方档案里登记了 supported（如 deepseek-v4-flash 的 off/high/max），
 * 就重述档案支持的全部档位，避免只写单档把模型其余能力钉死（例如 max 消失）。
 */
function applyModelReasoning(level: string, supported?: string[] | null): Record<string, string | null> | false | null {
  if (level === '') return null
  if (level === 'off') return false
  if (Array.isArray(supported) && supported.length > 0) {
    const dict: Record<string, string | null> = {}
    for (const l of supported) dict[l] = l === 'off' ? null : l
    return dict
  }
  return { off: null, [level]: level }
}

/** 模型提供商配置（§25.2 扩展）：API URL / 明文 Key / 模型列表 / 推理强度。 */
function LlmProviderSection() {
  const [providers, setProviders] = useState<LlmProviderEditor[] | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [savedId, setSavedId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [addingBusy, setAddingBusy] = useState(false)
  const [probeWarning, setProbeWarning] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [draft, setDraft] = useState({ id: '', displayName: '', baseURL: '', apiKey: '', api: 'openai-completions', manualModels: '' })

  const load = () => {
    setError(null)
    void fetch('/evoresearch/fs/llm-providers', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
      .then((r) => r.json())
      .then((providersJson) => {
        if (providersJson.ok) {
          setProviders((providersJson.value?.providers ?? []).map((p: Record<string, unknown>) => ({
            id: String(p.id ?? ''),
            displayName: String(p.displayName ?? ''),
            baseURL: String(p.baseURL ?? ''),
            apiKeyEnv: String(p.apiKeyEnv ?? ''),
            apiKey: String(p.apiKey ?? ''),
            api: String(p.api ?? 'openai-completions'),
            models: (Array.isArray(p.models) ? p.models : []).map((m: Record<string, unknown>) => ({
              id: String(m.id ?? ''),
              name: String(m.name ?? ''),
              contextWindow: m.contextWindow == null ? null : Number(m.contextWindow),
              reasoningEfforts: (m.reasoningEfforts === undefined ? null : m.reasoningEfforts) as LlmModelRow['reasoningEfforts'],
              supportedReasoning: null,
            })),
          })))
        } else setError(providersJson.error?.message ?? '加载失败')
      })
      .catch((e: unknown) => setError((e as Error)?.message ?? '加载失败'))
  }
  useEffect(load, [])

  const updateProvider = (id: string, patch: Partial<LlmProviderEditor>) => {
    setProviders((prev) => (prev ?? []).map((p) => (p.id === id ? { ...p, ...patch } : p)))
  }

  /** 模型条目转写回 Provider 配置的 patch 字段（保留推理强度设置）。 */
  const modelPatch = (m: LlmModelRow): Record<string, unknown> => ({
    id: m.id,
    name: m.name !== '' && m.name !== m.id ? m.name : undefined,
    reasoningEfforts: m.reasoningEfforts === null || m.reasoningEfforts === undefined ? undefined : m.reasoningEfforts,
  })

  /** 获取全部 Provider 的可用模型：统一并集，立即写回各 Provider 配置。 */
  const fetchAllModels = () => {
    if (busyId !== null) return
    setBusyId('__all__')
    setError(null)
    void (async () => {
      try {
        const json = await fetch('/evoresearch/fs/models-catalog', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then((r) => r.json())
        if (json.ok !== true) throw new Error(json.error?.message ?? t('llmFetchFailed'))
        const groups: Array<{ provider?: { id?: string }; models?: Array<{ id?: string; name?: string; contextWindow?: number | null; supportedReasoning?: string[] | null }> }> = json.value?.groups ?? []
        const cur = providers ?? []
        const nextByProvider = new Map<string, LlmModelRow[]>()
        let total = 0
        for (const p of cur) {
          const live = groups.find((g) => g.provider?.id === p.id)?.models ?? []
          const existing = new Map(p.models.map((m) => [m.id, m]))
          const next = live
            .filter((m) => m.id !== undefined && m.id !== '')
            .map((m) => {
              const old = existing.get(m.id as string)
              return {
                id: m.id as string,
                name: m.name ?? String(m.id),
                contextWindow: m.contextWindow ?? null,
                reasoningEfforts: old?.reasoningEfforts ?? null,
                supportedReasoning: Array.isArray(m.supportedReasoning) ? m.supportedReasoning : null,
              }
            })
          if (next.length > 0) {
            nextByProvider.set(p.id, next)
            total += next.length
          }
        }
        if (total === 0) {
          toast(t('llmFetchDone').replace('{n}', '0'), 'success')
          return
        }
        const failures: string[] = []
        for (const [pid, list] of nextByProvider) {
          const saved = await fetch('/evoresearch/fs/llm-provider-save', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ provider: pid, patch: { models: list.map(modelPatch) } }),
          }).then((r) => r.json())
          if (saved.ok !== true) failures.push(pid)
        }
        if (failures.length > 0) throw new Error(`${t('llmFetchFailed')}: ${failures.join('、')}`)
        setProviders((prev) => (prev ?? []).map((p) => (nextByProvider.has(p.id) ? { ...p, models: nextByProvider.get(p.id) as LlmModelRow[] } : p)))
        toast(t('llmFetchDone').replace('{n}', String(total)), 'success')
      } catch (e: unknown) {
        setError((e as Error)?.message ?? t('llmFetchFailed'))
      } finally {
        setBusyId(null)
      }
    })()
  }

  /** 排除模型：从包含它的全部 Provider 的模型列表中移除并持久化。 */
  const excludeModel = (modelId: string) => {
    if (busyId !== null || providers === null) return
    const affected = providers.filter((p) => p.models.some((m) => m.id === modelId))
    if (affected.length === 0) return
    setBusyId(`exclude:${modelId}`)
    setError(null)
    void (async () => {
      try {
        const failures: string[] = []
        const remaining = new Map<string, LlmModelRow[]>()
        for (const p of affected) {
          const rest = p.models.filter((m) => m.id !== modelId)
          remaining.set(p.id, rest)
          const saved = await fetch('/evoresearch/fs/llm-provider-save', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ provider: p.id, patch: { models: rest.map(modelPatch) } }),
          }).then((r) => r.json())
          if (saved.ok !== true) failures.push(p.id)
        }
        if (failures.length > 0) throw new Error(`${t('modelExcludeFailed')}: ${failures.join('、')}`)
        setProviders((prev) => (prev ?? []).map((p) => (remaining.has(p.id) ? { ...p, models: remaining.get(p.id) as LlmModelRow[] } : p)))
        toast(t('modelExcluded').replace('{id}', modelId).replace('{n}', String(affected.length)), 'success')
      } catch (e: unknown) {
        setError((e as Error)?.message ?? t('modelExcludeFailed'))
      } finally {
        setBusyId(null)
      }
    })()
  }

  const slugifyId = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  const autoProviderId = (displayName: string, baseURL: string, existing: Array<{ id: string }>): string => {
    const used = new Set(existing.map((p) => p.id))
    let host = ''
    try { host = new URL(baseURL).hostname } catch { host = baseURL.replace(/^https?:\/\//, '').split('/')[0] ?? '' }
    let slug = slugifyId(displayName) || slugifyId(host)
    if (slug === '') slug = `provider-${Date.now().toString(36)}`
    let id = slug
    let n = 2
    while (used.has(id)) id = `${slug}-${n++}`
    return id
  }

  const createProvider = async () => {
    if (addingBusy) return
    const baseURL = draft.baseURL.trim()
    if (baseURL === '') { setError(t('apiUrlRequired')); return }
    const apiKey = draft.apiKey.trim()
    const api = draft.api || 'openai-completions'
    const displayName = draft.displayName.trim()
    const id = draft.id.trim() !== '' ? draft.id.trim() : autoProviderId(displayName, baseURL, providers ?? [])
    setAddingBusy(true)
    setError(null)
    setProbeWarning(null)
    try {
      const probe = await fetch('/evoresearch/fs/llm-provider-probe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ baseURL, apiKey, api }),
      }).then((r) => r.json()).catch(() => ({ ok: false, error: { message: '网络请求失败' } }))
      const listed: Array<{ id?: string; name?: string }> = probe.ok === true ? (probe.value?.models ?? []) : []
      if (probe.ok !== true) {
        setProbeWarning(t('llmProbeWarn').replace('{msg}', probe.error?.message ?? t('llmProbeFailed')))
      } else if (listed.length === 0) {
        setProbeWarning(t('llmProbeEmpty'))
      }
      const manual = draft.manualModels.split(/[,，;；]/).map((s) => s.trim()).filter(Boolean)
      const seen = new Set<string>()
      const models: Array<Record<string, string>> = []
      for (const m of listed) {
        const mid = String(m.id ?? '').trim()
        if (mid !== '' && !seen.has(mid)) {
          seen.add(mid)
          models.push({ id: mid, name: String(m.name ?? mid) })
        }
      }
      for (const mid of manual) {
        if (!seen.has(mid)) {
          seen.add(mid)
          models.push({ id: mid })
        }
      }
      if (models.length === 0) {
        setAddingBusy(false)
        return
      }
      const save = await fetch('/evoresearch/fs/llm-provider-save', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: id,
          patch: {
            create: true,
            displayName: displayName !== '' ? displayName : id,
            baseURL,
            apiKey,
            api,
            models,
          },
        }),
      }).then((r) => r.json())
      if (save.ok !== true) throw new Error(save.error?.message ?? t('llmSaveFailed'))
      toast(t('llmSaved'), 'success')
      setAdding(false)
      setDraft({ id: '', displayName: '', baseURL: '', apiKey: '', api: 'openai-completions', manualModels: '' })
      load()
    } catch (e: unknown) {
      setError((e as Error)?.message ?? t('llmSaveFailed'))
    } finally {
      setAddingBusy(false)
    }
  }

  const removeProvider = (id: string) => {
    if (busyId !== null) return
    setBusyId(id)
    setError(null)
    void fetch('/evoresearch/fs/llm-provider-save', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: id, patch: { remove: true } }),
    }).then((r) => r.json()).then((json) => {
      setBusyId(null)
      if (json.ok) {
        toast(t('llmRemoved'), 'success')
        setSavedId(null)
        load()
      } else setError(json.error?.message ?? t('llmSaveFailed'))
    }).catch((e: unknown) => {
      setBusyId(null)
      setError((e as Error)?.message ?? t('llmSaveFailed'))
    })
  }

  const save = (id: string) => {
    const provider = providers?.find((p) => p.id === id)
    if (provider === undefined || busyId !== null) return
    const newId = (provider.newId ?? '').trim()
    if (newId !== '' && newId !== id && /[^A-Za-z0-9._-]/.test(newId)) {
      setError('Provider ID 只能包含字母、数字、点、下划线与连字符')
      return
    }
    if (newId !== '' && newId !== id && (providers ?? []).some((p) => p.id === newId)) {
      setError(`Provider ID 已存在: ${newId}`)
      return
    }
    setBusyId(id)
    setError(null)
    const patch = {
      ...(newId !== '' && newId !== id ? { newId } : {}),
      displayName: provider.displayName,
      baseURL: provider.baseURL,
      apiKey: provider.apiKey,
      models: provider.models.map((m) => {
        const entry: Record<string, unknown> = { id: m.id }
        if (m.name !== '' && m.name !== m.id) entry.name = m.name
        if (m.reasoningEfforts !== null && m.reasoningEfforts !== undefined) entry.reasoningEfforts = m.reasoningEfforts
        return entry
      }),
    }
    void fetch('/evoresearch/fs/llm-provider-save', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: id, patch }),
    }).then((r) => r.json()).then((json) => {
      setBusyId(null)
      if (json.ok) {
        const savedAs = newId !== '' && newId !== id ? newId : id
        setSavedId(savedAs)
        toast(newId !== '' && newId !== id ? t('llmSavedRenamed') : t('llmSaved'), 'success')
        if (newId !== '' && newId !== id) load()
      } else setError(json.error?.message ?? t('llmSaveFailed'))
    }).catch((e: unknown) => {
      setBusyId(null)
      setError((e as Error)?.message ?? t('llmSaveFailed'))
    })
  }

  // 统一「已获取模型」：合并全部 Provider 的模型列表，按名称字母序排列。
  const allModels = new Map<string, { id: string; name: string; count: number }>()
  for (const p of providers ?? []) {
    for (const m of p.models) {
      const hit = allModels.get(m.id)
      if (hit !== undefined) hit.count += 1
      else allModels.set(m.id, { id: m.id, name: m.name !== '' ? m.name : m.id, count: 1 })
    }
  }
  const modelPills = [...allModels.values()].sort((a, b) => {
    const x = a.id.toLowerCase()
    const y = b.id.toLowerCase()
    return x < y ? -1 : x > y ? 1 : 0
  })

  return jsxs('div', {
    className: 'evo-setting',
    children: [
      jsxs('div', {
        className: 'evo-setting-label',
        children: [jsx(Server, {}), jsx('span', { children: t('modelStepProviders') })],
      }),
      jsx('div', { className: 'evo-setting-hint', children: t('llmServiceHint') }),
      jsx('div', {
        className: 'evo-llm-providers',
        children: [
          jsx('button', {
            type: 'button',
            className: 'evo-btn evo-btn-ok evo-llm-add',
            disabled: addingBusy,
            onClick: () => { setAdding((v) => !v); setError(null); setProbeWarning(null) },
            children: jsxs(Fragment, { children: [jsx(Plus, {}), jsx('span', { children: adding ? t('cancel') : t('llmAddProvider') })] }),
          }),
          adding && jsxs('div', {
            className: 'evo-llm-provider evo-llm-new',
            children: [
              jsx('div', { className: 'evo-tier-head', children: jsx('span', { className: 'evo-tier-name', children: t('llmNewProvider') }) }),
              jsxs('div', {
                className: 'evo-llm-new-grid',
                children: [
                  jsx(ModelField, { className: 'evo-llm-span2', label: t('apiUrlLabel'), value: draft.baseURL, placeholder: 'http://127.0.0.1:3000/v1', onChange: (v) => setDraft((d) => ({ ...d, baseURL: v })) }),
                  jsxs('label', {
                    className: 'evo-setting-field evo-llm-span2',
                    children: [
                      jsx('span', { className: 'evo-setting-field-label', children: t('apiKeyLabel') }),
                      jsx('input', {
                        type: 'text',
                        className: 'evo-panel-input evo-llm-key-input',
                        value: draft.apiKey,
                        spellCheck: false,
                        autoComplete: 'off',
                        placeholder: t('apiKeyLabel'),
                        onInput: (e: { currentTarget: HTMLInputElement }) => {
                          const v = e.currentTarget.value
                          setDraft((d) => ({ ...d, apiKey: v }))
                        },
                      }),
                    ],
                  }),
                  jsxs('label', {
                    className: 'evo-setting-field',
                    children: [
                      jsx('span', { className: 'evo-setting-field-label', children: t('llmApiProtocol') }),
                      jsx(Dropdown, {
                        value: draft.api,
                        className: 'evo-llm-new-select',
                        onChange: (v: string) => setDraft((d) => ({ ...d, api: v })),
                        options: [
                          { value: 'openai-completions', label: 'openai-completions' },
                          { value: 'openai-responses', label: 'openai-responses' },
                          { value: 'anthropic-messages', label: 'anthropic-messages' },
                        ],
                      }),
                    ],
                  }),
                  jsx(ModelField, { label: t('llmProviderName'), value: draft.displayName, placeholder: t('llmProviderNamePlaceholder'), onChange: (v) => setDraft((d) => ({ ...d, displayName: v })) }),
                  jsxs('label', {
                    className: 'evo-setting-field',
                    children: [
                      jsx('span', { className: 'evo-setting-field-label', children: t('llmProviderId') }),
                      jsx('input', {
                        type: 'text',
                        className: 'evo-panel-input',
                        value: draft.id,
                        placeholder: t('llmProviderIdAuto'),
                        spellCheck: false,
                        onInput: (e: { currentTarget: HTMLInputElement }) => {
                          const v = e.currentTarget.value
                          setDraft((d) => ({ ...d, id: v }))
                        },
                      }),
                      jsx('span', { className: 'evo-setting-hint', children: t('llmProviderIdHint') }),
                    ],
                  }),
                  jsx(ModelField, { label: t('llmManualModels'), value: draft.manualModels, placeholder: t('llmManualModelsPlaceholder'), onChange: (v) => setDraft((d) => ({ ...d, manualModels: v })) }),
                ],
              }),
              probeWarning !== null && jsx('div', { className: 'evo-llm-probe-warn', children: probeWarning }),
              jsx('div', { className: 'evo-llm-actions', children: [
                jsx('button', {
                  type: 'button',
                  className: 'evo-btn evo-btn-ok',
                  disabled: addingBusy,
                  onClick: createProvider,
                  children: jsxs(Fragment, { children: [jsx(Plus, {}), jsx('span', { children: addingBusy ? t('llmProbeBusy') : t('llmCreateProvider') })] }),
                }),
                jsx('button', {
                  type: 'button',
                  className: 'evo-btn',
                  disabled: addingBusy,
                  onClick: () => { setAdding(false); setProbeWarning(null) },
                  children: t('cancel'),
                }),
              ] }),
            ],
          }),
          providers === null
            ? jsx('div', { className: 'evo-setting-hint', children: 'Loading…' })
            : providers.length === 0
              ? jsx('div', { className: 'evo-setting-hint', children: t('noLlmProviders') })
              : providers.map((provider) => {
              const busy = busyId !== null
              return jsxs('div', {
                className: 'evo-llm-provider',
                children: [
                  jsxs('div', { className: 'evo-tier-head', children: [
                    jsx('span', { className: 'evo-tier-name', children: provider.displayName !== '' ? provider.displayName : provider.id }),
                    provider.models.length > 0 && jsx('span', { className: 'evo-tier-desc', children: t('fetchedModelsCount').replace('{n}', String(provider.models.length)) }),
                    jsx('span', { className: 'evo-tier-desc', children: provider.api }),
                    jsx('span', { style: { flex: 1 } }),
                    jsx('button', {
                      type: 'button',
                      className: 'evo-panel-del',
                      title: t('llmDeleteProvider'),
                      'aria-label': t('llmDeleteProvider'),
                      disabled: busy,
                      onClick: () => { setError(null); setConfirmDeleteId(provider.id) },
                      children: jsx(Trash2, {}),
                    }),
                  ] }),
                  jsxs('div', { className: 'evo-llm-edit-grid', children: [
                    jsx(ModelField, { label: t('apiUrlLabel'), value: provider.baseURL, onChange: (v) => updateProvider(provider.id, { baseURL: v }) }),
                    jsxs('label', {
                      className: 'evo-setting-field',
                      children: [
                        jsx('span', { className: 'evo-setting-field-label', children: t('apiKeyLabel') }),
                        jsx('input', {
                          type: 'text',
                          className: 'evo-panel-input evo-llm-key-input',
                          value: provider.apiKey,
                          spellCheck: false,
                          autoComplete: 'off',
                          placeholder: t('apiKeyLabel'),
                          onInput: (e: { currentTarget: HTMLInputElement }) => updateProvider(provider.id, { apiKey: e.currentTarget.value }),
                        }),
                      ],
                    }),
                    jsx(ModelField, { label: t('llmProviderName'), value: provider.displayName, onChange: (v) => updateProvider(provider.id, { displayName: v }) }),
                    jsxs('label', {
                      className: 'evo-setting-field',
                      children: [
                        jsx('span', { className: 'evo-setting-field-label', children: t('llmProviderId') }),
                        jsx('input', {
                          type: 'text',
                          className: 'evo-panel-input',
                          value: provider.newId ?? provider.id,
                          spellCheck: false,
                          autoComplete: 'off',
                          onInput: (e: { currentTarget: HTMLInputElement }) => updateProvider(provider.id, { newId: e.currentTarget.value }),
                        }),
                        (provider.newId ?? '').trim() !== '' && (provider.newId ?? '').trim() !== provider.id
                          && jsx('span', { className: 'evo-setting-hint', children: t('llmProviderIdEditHint') }),
                      ],
                    }),
                  ] }),
                  jsx('div', { className: 'evo-setting-hint', children: t('llmKeyHint') }),
                  jsxs('div', { className: 'evo-llm-actions', children: [
                    jsx('button', {
                      type: 'button',
                      className: 'evo-btn evo-btn-ok',
                      disabled: busy,
                      onClick: () => save(provider.id),
                      children: jsxs(Fragment, { children: [jsx(Cpu, {}), jsx('span', { children: busy ? t('saving') : t('save') })] }),
                    }),
                  ] }),
                  savedId === provider.id && jsx('div', { className: 'evo-setting-hint', children: t('llmSaved') }),
                ],
              }, provider.id)
            }),
        ],
      }),
      jsxs('div', {
        className: 'evo-llm-fetched',
        children: [
          jsxs('div', { className: 'evo-llm-fetched-head', children: [
            jsx('span', { className: 'evo-llm-fetched-title', children: t('modelListLabel') }),
            jsx('span', { className: 'evo-llm-fetched-count', children: t('fetchedModelsCount').replace('{n}', String(modelPills.length)) }),
            jsx('button', {
              type: 'button',
              className: 'evo-btn evo-btn-run',
              disabled: busyId !== null,
              onClick: fetchAllModels,
              children: jsxs(Fragment, { children: [jsx(Server, {}), jsx('span', { children: busyId === '__all__' ? t('fetchModelsBusy') : t('fetchModels') })] }),
            }),
          ] }),
          jsx('div', { className: 'evo-setting-hint', children: t('fetchedModelsDesc') }),
          modelPills.length === 0
            ? jsx('div', { className: 'evo-setting-hint', children: t('fetchedModelsEmpty') })
            : jsx('div', {
                className: 'evo-llm-model-pills',
                children: modelPills.map((m) => jsxs('span', {
                  className: 'evo-llm-model-pill',
                  title: m.name !== m.id ? `${m.id}（${m.name}）` : m.id,
                  children: [
                    jsx('span', { className: 'evo-llm-model-id', children: m.id }),
                    m.count > 1 && jsx('span', {
                      className: 'evo-llm-model-n',
                      title: t('fetchedModelsCount').replace('{n}', String(m.count)),
                      children: String(m.count),
                    }),
                    jsx('button', {
                      type: 'button',
                      className: 'evo-llm-model-x',
                      title: t('excludeModel'),
                      'aria-label': `${t('excludeModel')}: ${m.id}`,
                      disabled: busyId !== null,
                      onClick: () => excludeModel(m.id),
                      children: jsx(X, {}),
                    }),
                  ],
                }, m.id)),
              }),
        ],
      }),
      error !== null && jsx('div', { className: 'evo-panel-error', children: error }),
      confirmDeleteId !== null && jsx(ConfirmDialog, {
        title: t('llmDeleteProvider'),
        message: t('llmDeleteProviderConfirm').replace('{id}', confirmDeleteId),
        confirmLabel: t('delete'),
        danger: true,
        onConfirm: () => removeProvider(confirmDeleteId),
        onClose: () => setConfirmDeleteId(null),
      }),
    ],
  })
}

type SettingsTab = 'general' | 'models' | 'data'

const TABS: Array<{ id: SettingsTab; label: string; icon: any }> = [
  { id: 'general', label: t('settingsGeneral'), icon: Cpu },
  { id: 'models', label: t('settingsModels'), icon: Server },
  { id: 'data', label: t('settingsData'), icon: Trash2 },
]

export function SettingsDialog({ onClose, sessionId }: SettingsDialogProps) {
  const [tab, setTab] = useState<SettingsTab>('general')
  const shellRef = useRef<HTMLDivElement | null>(null)
  // §30.2：打开聚焦首个可操作元素，关闭恢复触发按钮焦点
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
        className: 'evo-modal evo-settings-modal evo-modal-full',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': t('settings'),
        children: [
          // 左上角「返回」（图标 + 文字）→ 退回原页面
          jsxs('div', {
            className: 'evo-modal-head evo-settings-head',
            children: [
              jsx('button', {
                type: 'button',
                className: 'evo-btn-back',
                onClick: onClose,
                title: t('back'),
                'aria-label': t('back'),
                children: jsxs(Fragment, { children: [jsx(ArrowLeft, {}), jsx('span', { children: t('back') })] }),
              }),
              jsx('div', { className: 'evo-modal-title', children: t('settings') }),
              jsx('div', { style: { width: 74 } }),
            ],
          }),
          jsxs('div', {
            className: 'evo-settings-body',
            children: [
              // 左侧 tab 导航
              jsx('nav', {
                className: 'evo-settings-nav',
                role: 'tablist',
                'aria-label': t('settings'),
                children: TABS.map((item) => {
                  const Icon = item.icon
                  return jsx('button', {
                    type: 'button',
                    role: 'tab',
                    className: 'evo-settings-tab',
                    'data-active': tab === item.id || undefined,
                    'aria-selected': tab === item.id || undefined,
                    onClick: () => setTab(item.id),
                    children: jsxs(Fragment, { children: [jsx(Icon, {}), jsx('span', { children: item.label })] }),
                  }, item.id)
                }),
              }),
              // 右侧配置
              jsx('div', {
                className: 'evo-settings-content',
                children: tab === 'general'
                  ? jsxs(Fragment, { children: [
                      jsx(PermissionSection, { sessionId }),
                      jsx(PluginListSection, {}),
                      jsx(AboutSection, {}),
                    ] })
                  : tab === 'models'
                    ? jsxs(Fragment, { children: [
                        jsx(LlmProviderSection, {}),
                        jsx(ModelAssignSection, {}),
                      ] })
                    : jsx(DataClearSection, {}),
              }),
            ],
          }),
        ],
      }),
    ],
  })
}
