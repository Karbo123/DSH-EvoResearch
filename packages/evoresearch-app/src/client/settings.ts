/**
 * 设置面板：左侧 tab 导航 + 右侧配置 + 左上角「返回」（图标 + 文字）。
 * - 通用：权限模式 / 默认模型 / 插件清单 / 关于（主题与语言在顶栏，不重复）；
 * - 模型设置：1）模型服务（Provider 与每模型推理强度）；2）模型分配（代码三档 /
 *   图片识别 / 图片生成 / 语音识别，从 Provider 模型列表选择并设置推理强度）；
 * - 清除数据。
 */
import { jsx, jsxs, Fragment } from 'react/jsx-runtime'
import { useState, useEffect, useRef } from 'react'
import { ArrowLeft, Cpu, Info, Puzzle, ShieldCheck as ShieldCheckIcon, Code2, Eye, Image as ImageIcon, Mic, Trash2, Server, Plus } from 'lucide-react'
import { t } from './i18n'
import { toast } from './toast'

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
  url?: string
  keyEnv?: string
  voiceProvider?: string
}

function ModelField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return jsxs('label', {
    className: 'evo-setting-field',
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


/** 模型分配（模型设置第 2 步）：从模型服务 Provider 的模型列表中选择各任务模型并设置推理强度。 */
function ModelAssignSection() {
  const [assign, setAssign] = useState<Record<string, AssignSetting> | null>(null)
  const [providers, setProviders] = useState<LlmProviderEditor[]>([])
  const [catalog, setCatalog] = useState<Array<{ provider?: { id?: string }; models?: Array<{ id?: string; name?: string; supportedReasoning?: string[] | null }> }>>([])
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [migrated, setMigrated] = useState<Record<string, string>>({})
  const [openAdvanced, setOpenAdvanced] = useState<Record<string, boolean>>({})

  const providerModels = (providerId: string): Array<{ id: string; name: string; supportedReasoning: string[] | null }> => {
    const group = catalog.find((g) => g.provider?.id === providerId)
    const live = (group?.models ?? []).filter((m) => m.id !== undefined && m.id !== '')
    if (live.length > 0) {
      return live.map((m) => ({ id: m.id as string, name: m.name ?? (m.id as string), supportedReasoning: Array.isArray(m.supportedReasoning) ? m.supportedReasoning : null }))
    }
    return (providers.find((p) => p.id === providerId)?.models ?? []).map((m) => ({ id: m.id, name: m.name !== '' ? m.name : m.id, supportedReasoning: m.supportedReasoning }))
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
        reasoning: String(p.reasoning ?? ''),
        models: (Array.isArray(p.models) ? p.models : []).map((m: Record<string, unknown>) => ({
          id: String(m.id ?? ''),
          name: String(m.name ?? ''),
          contextWindow: m.contextWindow == null ? null : Number(m.contextWindow),
          reasoningEfforts: (m.reasoningEfforts === undefined ? null : m.reasoningEfforts) as LlmModelRow['reasoningEfforts'],
          supportedReasoning: null,
          reasoningRef: '',
        })),
      })) : []
      const groups: Array<{ provider?: { id?: string }; models?: Array<{ id?: string; name?: string; supportedReasoning?: string[] | null }> }> = cat.ok === true ? (cat.value?.groups ?? []) : []
      setProviders(providerList)
      setCatalog(groups)
      const raw = (ms.ok === true ? ms.value : {}) as Record<string, unknown>
      const rawCode = (raw.code ?? {}) as Record<string, unknown>
      const ids = new Set(providerList.map((p) => p.id))
      const modelsOf = (providerId: string): Array<{ id: string; name: string; supportedReasoning: string[] | null }> => {
        const group = groups.find((g) => g.provider?.id === providerId)
        const live = (group?.models ?? []).filter((m) => m.id !== undefined && m.id !== '')
        if (live.length > 0) return live.map((m) => ({ id: m.id as string, name: m.name ?? (m.id as string), supportedReasoning: Array.isArray(m.supportedReasoning) ? m.supportedReasoning : null }))
        return (providerList.find((p) => p.id === providerId)?.models ?? []).map((m) => ({ id: m.id, name: m.name !== '' ? m.name : m.id, supportedReasoning: m.supportedReasoning }))
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
          reasoningEffort: typeof cur.reasoningEffort === 'string' ? cur.reasoningEffort : '',
          url: typeof cur.url === 'string' ? cur.url : '',
          keyEnv: typeof cur.keyEnv === 'string' ? cur.keyEnv : '',
          voiceProvider: typeof cur.voiceProvider === 'string' ? cur.voiceProvider : 'api',
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
    const models = providerModels(providerId)
    setAssign((prev) => (prev === null ? prev : { ...prev, [key]: { ...(prev[key] ?? {}), provider: providerId, model: models[0]?.id ?? '', reasoningEffort: '' } }))
  }
  const changeModel = (key: string, modelId: string) => {
    setAssign((prev) => (prev === null ? prev : { ...prev, [key]: { ...(prev[key] ?? {}), model: modelId, reasoningEffort: '' } }))
  }
  const offeredLevels = (key: string): Array<[string, string]> => {
    const v = assign?.[key]
    if (v === undefined) return REASONING_LEVELS
    const m = providerModels(v.provider).find((x) => x.id === v.model)
    const sup = m?.supportedReasoning
    if (Array.isArray(sup) && sup.length > 0) return REASONING_LEVELS.filter(([level]) => level === '' || sup.includes(level))
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
            const efforts = applyModelReasoning(level)
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

  const renderSelect = (key: string, field: 'provider' | 'model' | 'reasoningEffort', options: Array<[string, string]>, onChange: (v: string) => void, hint?: string) => {
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
        jsx('select', {
          className: 'evo-panel-input evo-select-compact',
          value: current,
          onChange: (e: { currentTarget: HTMLSelectElement }) => {
            const val = e.currentTarget.value
            onChange(val)
          },
          children: [
            !exists && jsx('option', { value: current, children: `${current}（${missing}）` }, current),
            ...options.map(([value, optionLabel]) => jsx('option', { value, children: optionLabel }, value)),
          ],
        }),
        hint !== undefined && jsx('span', { className: 'evo-setting-field-label', children: hint }),
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
                    className: 'evo-btn evo-btn-ok',
                    disabled: saving !== null,
                    onClick: () => saveCard(['simple', 'medium', 'complex']),
                    children: jsxs(Fragment, { children: [jsx(Cpu, {}), jsx('span', { children: saving !== null ? t('saving') : t('save') })] }),
                  }),
                ] }),
              ] }),
              (['vision', 'image', 'voice'] as const).map((kind) => {
                const meta = kind === 'vision'
                  ? { icon: Eye, title: t('settingsVision'), hint: t('visionHint') }
                  : kind === 'image'
                    ? { icon: ImageIcon, title: t('settingsImage'), hint: t('imageHint') }
                    : { icon: Mic, title: t('settingsVoice'), hint: t('voiceHint') }
                const Icon = meta.icon
                const modelHasProfile = providerModels(assign[kind].provider).find((m) => m.id === assign[kind].model)?.supportedReasoning != null
                return jsxs('div', { className: 'evo-tier-card evo-assign-card', children: [
                  jsxs('div', { className: 'evo-assign-head', children: [
                    jsx(Icon, {}),
                    jsx('span', { className: 'evo-assign-head-title', children: meta.title }),
                    jsx('span', { className: 'evo-assign-head-desc', children: meta.hint }),
                  ] }),
                  jsxs('div', { className: 'evo-assign-grid', children: [
                    renderSelect(kind, 'provider', providerOptions, (v) => changeProvider(kind, v)),
                    renderSelect(kind, 'model', providerModels(assign[kind].provider).map((m) => [m.id, m.name] as [string, string]), (v) => changeModel(kind, v)),
                    renderSelect(kind, 'reasoningEffort', offeredLevels(kind), (v) => setField(kind, 'reasoningEffort', v), modelHasProfile ? undefined : t('assignmentReasoningHint')),
                  ] }),
                  (kind === 'vision' || kind === 'voice') && jsxs(Fragment, { children: [
                    jsx('button', {
                      type: 'button',
                      className: 'evo-assign-advanced-toggle',
                      onClick: () => setOpenAdvanced((prev) => ({ ...prev, [kind]: !(prev[kind] ?? false) })),
                      children: jsxs(Fragment, { children: [jsx('span', { className: `evo-assign-chevron${openAdvanced[kind] === true ? ' open' : ''}`, children: '›' }), jsx('span', { children: t('advancedOptions') })] }),
                    }),
                    openAdvanced[kind] === true && jsxs('div', { className: 'evo-assign-advanced', children: [
                      kind === 'voice' && jsxs('label', {
                        className: 'evo-setting-field',
                        children: [
                          jsx('span', { className: 'evo-setting-field-label', children: t('providerLabel') }),
                          jsx('select', {
                            className: 'evo-panel-input evo-select-compact',
                            value: assign[kind].voiceProvider ?? 'api',
                            onChange: (e: { currentTarget: HTMLSelectElement }) => {
                              const val = e.currentTarget.value
                              setField(kind, 'voiceProvider', val)
                            },
                            children: [
                              jsx('option', { value: 'api', children: t('voiceProviderApi') }, 'api'),
                              jsx('option', { value: 'local', children: t('voiceProviderLocal') }, 'local'),
                            ],
                          }),
                        ],
                      }),
                      jsx(ModelField, { label: t('urlLabel'), value: assign[kind].url ?? '', onChange: (x) => setField(kind, 'url', x) }),
                      jsx(ModelField, { label: t('keyEnvLabel'), value: assign[kind].keyEnv ?? '', onChange: (x) => setField(kind, 'keyEnv', x) }),
                    ] }),
                  ] }),
                  migrated[kind] !== undefined && jsx('div', { className: 'evo-assign-migrate', children: t('migratedProviderHint').replace('{old}', migrated[kind]).replace('{new}', providerLabel(assign[kind].provider)) }),
                  jsxs('div', { className: 'evo-assign-actions', children: [
                    jsx('button', {
                      type: 'button',
                      className: 'evo-btn evo-btn-ok',
                      disabled: saving !== null,
                      onClick: () => saveCard([kind]),
                      children: jsxs(Fragment, { children: [jsx(Cpu, {}), jsx('span', { children: saving !== null ? t('saving') : t('save') })] }),
                    }),
                  ] }),
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

/** 模型服务（§25.2 扩展）：编辑 provider 的 API URL / Key / 推理强度并持久化。 */
const REASONING_LEVELS: Array<[string, string]> = [
  ['', t('reasoningInherit')],
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
  reasoningRef: string
}

interface LlmProviderEditor {
  id: string
  displayName: string
  baseURL: string
  apiKeyEnv: string
  apiKey: string
  api: string
  reasoning: string
  models: LlmModelRow[]
}

interface ReasoningReference {
  id: string
  name: string
  provider: string
  supportedReasoning: string[]
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

/** 从 reasoningEfforts 还原已选择的单一强度（false=关闭；多档自定义时返回空串）。 */
function modelReasoningLevel(efforts: Record<string, string | null> | false | null): string {
  if (efforts === false) return 'off'
  if (efforts === null || typeof efforts !== 'object') return ''
  const levels = Object.entries(efforts).filter(([level, wire]) => level !== 'off' && wire !== null && wire !== undefined)
  return levels.length === 1 ? levels[0][0] : ''
}

/** 设置模型推理强度 → reasoningEfforts（off=不支持推理；单档=off+该档；空=继承/清除）。 */
function applyModelReasoning(level: string): Record<string, string | null> | false | null {
  if (level === '') return null
  if (level === 'off') return false
  return { off: null, [level]: level }
}

/** 模型服务配置（§25.2 扩展）：API URL / 明文 Key / 模型列表 / 推理强度。 */
function LlmProviderSection() {
  const [providers, setProviders] = useState<LlmProviderEditor[] | null>(null)
  const [references, setReferences] = useState<ReasoningReference[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [savedId, setSavedId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [addingBusy, setAddingBusy] = useState(false)
  const [probeWarning, setProbeWarning] = useState<string | null>(null)
  const [draft, setDraft] = useState({ id: '', displayName: '', baseURL: '', apiKey: '', api: 'openai-completions', manualModels: '' })

  /** 把远端目录应用到一个（或全部）provider 的模型列表：远端为准，仅保留仍存在的模型已有的推理强度设置。 */
  const applyCatalog = (groups: Array<{ provider?: { id?: string }; models?: Array<{ id?: string; name?: string; contextWindow?: number | null; supportedReasoning?: string[] | null }> }>, onlyId?: string) => {
    setProviders((prev) => (prev ?? []).map((p) => {
      if (onlyId !== undefined && p.id !== onlyId) return p
      const group = groups.find((g) => g.provider?.id === p.id)
      const live = group?.models ?? []
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
      if (next.length === 0) return p
      return { ...p, models: next }
    }))
  }

  const load = () => {
    setError(null)
    void Promise.all([
      fetch('/evoresearch/fs/llm-providers', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then((r) => r.json()),
      fetch('/evoresearch/fs/models-catalog', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then((r) => r.json()).catch(() => ({ ok: false })),
    ])
      .then(([providersJson, catalogJson]) => {
        if (providersJson.ok) {
          setProviders((providersJson.value?.providers ?? []).map((p: Record<string, unknown>) => ({
            id: String(p.id ?? ''),
            displayName: String(p.displayName ?? ''),
            baseURL: String(p.baseURL ?? ''),
            apiKeyEnv: String(p.apiKeyEnv ?? ''),
            apiKey: String(p.apiKey ?? ''),
            api: String(p.api ?? 'openai-completions'),
            reasoning: String(p.reasoning ?? ''),
            models: (Array.isArray(p.models) ? p.models : []).map((m: Record<string, unknown>) => ({
              id: String(m.id ?? ''),
              name: String(m.name ?? ''),
              contextWindow: m.contextWindow == null ? null : Number(m.contextWindow),
              reasoningEfforts: (m.reasoningEfforts === undefined ? null : m.reasoningEfforts) as LlmModelRow['reasoningEfforts'],
              supportedReasoning: null,
              reasoningRef: '',
            })),
          })))
        } else setError(providersJson.error?.message ?? '加载失败')
        if (catalogJson.ok === true) {
          applyCatalog(catalogJson.value?.groups ?? [])
          setReferences(Array.isArray(catalogJson.value?.references) ? catalogJson.value.references : [])
        }
      })
      .catch((e: unknown) => setError((e as Error)?.message ?? '加载失败'))
  }
  useEffect(load, [])

  const updateProvider = (id: string, patch: Partial<LlmProviderEditor>) => {
    setProviders((prev) => (prev ?? []).map((p) => (p.id === id ? { ...p, ...patch } : p)))
  }

  const setModelReasoning = (providerId: string, modelId: string, level: string) => {
    setProviders((prev) => (prev ?? []).map((p) => {
      if (p.id !== providerId) return p
      return { ...p, models: p.models.map((m) => (m.id === modelId ? { ...m, reasoningEfforts: applyModelReasoning(level) } : m)) }
    }))
  }

  const setModelReasoningRef = (providerId: string, modelId: string, refId: string) => {
    setProviders((prev) => (prev ?? []).map((p) => {
      if (p.id !== providerId) return p
      return { ...p, models: p.models.map((m) => (m.id === modelId ? { ...m, reasoningRef: refId } : m)) }
    }))
  }

  const fetchModels = (id: string) => {
    if (busyId !== null) return
    setBusyId(id)
    setError(null)
    void fetch('/evoresearch/fs/models-catalog', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
      .then((r) => r.json())
      .then((json) => {
        if (json.ok !== true) throw new Error(json.error?.message ?? t('llmFetchFailed'))
        const groups: Array<{ provider?: { id?: string }; models?: Array<{ id?: string }> }> = json.value?.groups ?? []
        const live = groups.find((g) => g.provider?.id === id)?.models ?? []
        applyCatalog(groups, id)
        if (Array.isArray(json.value?.references)) setReferences(json.value.references)
        toast(t('llmFetchDone').replace('{n}', String(live.length)), 'success')
      })
      .catch((e: unknown) => setError((e as Error)?.message ?? t('llmFetchFailed')))
      .finally(() => setBusyId(null))
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
    if (!window.confirm(t('llmDeleteProviderConfirm').replace('{id}', id))) return
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
    setBusyId(id)
    setError(null)
    const patch = {
      displayName: provider.displayName,
      baseURL: provider.baseURL,
      apiKey: provider.apiKey,
      reasoning: provider.reasoning,
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
        setSavedId(id)
        toast(t('llmSaved'), 'success')
      } else setError(json.error?.message ?? t('llmSaveFailed'))
    }).catch((e: unknown) => {
      setBusyId(null)
      setError((e as Error)?.message ?? t('llmSaveFailed'))
    })
  }

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
              jsx(ModelField, { label: t('llmProviderId'), value: draft.id, placeholder: t('llmProviderIdAuto'), onChange: (v) => setDraft((d) => ({ ...d, id: v })) }),
              jsx(ModelField, { label: t('llmProviderName'), value: draft.displayName, onChange: (v) => setDraft((d) => ({ ...d, displayName: v })) }),
              jsx(ModelField, { label: t('apiUrlLabel'), value: draft.baseURL, onChange: (v) => setDraft((d) => ({ ...d, baseURL: v })) }),
              jsxs('label', {
                className: 'evo-setting-field',
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
                  jsx('select', {
                    className: 'evo-panel-input evo-select-compact',
                    value: draft.api,
                    onChange: (e: { currentTarget: HTMLSelectElement }) => {
                      const v = e.currentTarget.value
                      setDraft((d) => ({ ...d, api: v }))
                    },
                    children: [
                      jsx('option', { value: 'openai-completions', children: 'openai-completions' }, 'openai-completions'),
                      jsx('option', { value: 'openai-responses', children: 'openai-responses' }, 'openai-responses'),
                      jsx('option', { value: 'anthropic-messages', children: 'anthropic-messages' }, 'anthropic-messages'),
                    ],
                  }),
                ],
              }),
              jsx(ModelField, { label: t('llmManualModels'), value: draft.manualModels, placeholder: t('llmManualModelsPlaceholder'), onChange: (v) => setDraft((d) => ({ ...d, manualModels: v })) }),
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
              const busy = busyId === provider.id
              return jsxs('div', {
                className: 'evo-llm-provider',
                children: [
                  jsxs('div', { className: 'evo-tier-head', children: [
                    jsx('span', { className: 'evo-tier-name', children: `${t('llmProviderId')}: ${provider.id}` }),
                    jsx('span', { className: 'evo-tier-desc', children: provider.api }),
                    jsx('span', { style: { flex: 1 } }),
                    jsx('button', {
                      type: 'button',
                      className: 'evo-panel-del',
                      title: t('llmDeleteProvider'),
                      'aria-label': t('llmDeleteProvider'),
                      disabled: busy,
                      onClick: () => removeProvider(provider.id),
                      children: jsx(Trash2, {}),
                    }),
                  ] }),
                  jsx(ModelField, { label: t('llmProviderName'), value: provider.displayName, onChange: (v) => updateProvider(provider.id, { displayName: v }) }),
                  jsx(ModelField, { label: t('apiUrlLabel'), value: provider.baseURL, onChange: (v) => updateProvider(provider.id, { baseURL: v }) }),
                  jsxs('label', {
                    className: 'evo-setting-field',
                    children: [
                      jsxs('span', { className: 'evo-setting-field-label', children: [
                        t('apiKeyLabel'),
                        provider.apiKeyEnv !== '' && jsx('span', { className: 'evo-setting-field-env', children: `(${provider.apiKeyEnv})` }),
                      ] }),
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
                  jsx('div', { className: 'evo-setting-hint', children: t('llmKeyHint') }),
                  jsxs('label', {
                    className: 'evo-setting-field',
                    children: [
                      jsx('span', { className: 'evo-setting-field-label', children: t('providerDefaultReasoning') }),
                      jsx('select', {
                        className: 'evo-panel-input evo-select-compact',
                        value: provider.reasoning,
                        onChange: (e: { currentTarget: HTMLSelectElement }) => updateProvider(provider.id, { reasoning: e.currentTarget.value }),
                        children: REASONING_LEVELS.map(([level, label]) => jsx('option', { value: level, children: label }, level)),
                      }),
                    ],
                  }),
                  provider.models.length > 0 && jsxs('div', {
                    className: 'evo-llm-models',
                    children: [
                      jsx('div', { className: 'evo-setting-field-label', children: t('modelReasoningLabel') }),
                      provider.models.map((m) => {
                        const registered = m.supportedReasoning !== null
                        const ref = registered ? null : (references.find((r) => r.id === m.reasoningRef) ?? null)
                        const offered = registered ? m.supportedReasoning : ref !== null ? ref.supportedReasoning : null
                        return jsxs('div', {
                          className: 'evo-llm-model',
                          children: [
                            jsxs('div', {
                              className: 'evo-llm-model-row',
                              children: [
                                jsx('span', { className: 'evo-llm-model-id', title: m.id, children: m.id }),
                                jsx('span', { className: 'evo-llm-model-ctx', children: m.contextWindow != null ? `${m.contextWindow}` : '' }),
                                jsx('select', {
                                  className: 'evo-panel-input evo-select-compact',
                                  value: modelReasoningLevel(m.reasoningEfforts),
                                  onChange: (e: { currentTarget: HTMLSelectElement }) => setModelReasoning(provider.id, m.id, e.currentTarget.value),
                                  children: REASONING_LEVELS.map(([level, label]) => {
                                    const unsupported = offered !== null && level !== '' && !offered.includes(level)
                                    return unsupported ? null : jsx('option', { value: level, children: label }, level)
                                  }),
                                }),
                              ],
                            }),
                            !registered && jsxs('div', {
                              className: 'evo-llm-ref-row',
                              children: [
                                jsx('span', { className: 'evo-llm-ref-label', children: t('llmReasoningRef') }),
                                jsx('select', {
                                  className: 'evo-panel-input evo-select-compact evo-llm-ref-select',
                                  title: t('llmReasoningRefHint'),
                                  value: m.reasoningRef,
                                  onChange: (e: { currentTarget: HTMLSelectElement }) => setModelReasoningRef(provider.id, m.id, e.currentTarget.value),
                                  children: [
                                    jsx('option', { value: '', children: t('llmReasoningRefNone') }, ''),
                                    ...[...references]
                                      .sort((a, b) => referenceScore(m.id, b.id) - referenceScore(m.id, a.id))
                                      .map((r) => jsx('option', { value: r.id, children: `${r.id}（${r.provider}）` }, r.id)),
                                  ],
                                }),
                              ],
                            }),
                          ],
                        }, m.id)
                      }),
                    ],
                  }),
                  jsxs('div', { className: 'evo-llm-actions', children: [
                    jsx('button', {
                      type: 'button',
                      className: 'evo-btn evo-btn-run',
                      disabled: busy,
                      onClick: () => fetchModels(provider.id),
                      children: jsxs(Fragment, { children: [jsx(Server, {}), jsx('span', { children: busy && busyId === provider.id ? t('fetchModelsBusy') : t('fetchModels') })] }),
                    }),
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
      error !== null && jsx('div', { className: 'evo-panel-error', children: error }),
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
