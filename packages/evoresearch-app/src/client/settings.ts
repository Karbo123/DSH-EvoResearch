/**
 * 设置面板：左侧 tab 导航 + 右侧配置 + 左上角「返回」（图标 + 文字）。
 * - 通用：权限模式 / 默认模型 / 插件清单 / 关于（主题与语言在顶栏，不重复）；
 * - 代码文本模型：三档（轻量/均衡/深度），可设为默认模型；
 * - 图片识别 / 图片生成 / 语音识别模型：模型与端点配置（参照 ResearchOS 设置面板）。
 */
import { jsx, jsxs, Fragment } from 'react/jsx-runtime'
import { useState, useEffect, useRef } from 'react'
import { ArrowLeft, Cpu, Info, Puzzle, ShieldCheck as ShieldCheckIcon, Code2, Eye, Image as ImageIcon, Mic, Trash2 } from 'lucide-react'
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

/** 模型档位/模型设置表单（代码三档复用；视觉/图片/语音用单档）。 */
interface TierValue { model: string; provider: string; reasoningEffort?: string; url?: string; keyEnv?: string; voiceProvider?: string }

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

/** 代码模型三档设置。 */
function CodeModelSection() {
  const [tiers, setTiers] = useState<Record<string, TierValue> | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [applied, setApplied] = useState<string | null>(null)
  const TIERS = [
    { id: 'simple', label: t('tierSimple'), desc: t('tierSimpleDesc') },
    { id: 'medium', label: t('tierMedium'), desc: t('tierMediumDesc') },
    { id: 'complex', label: t('tierComplex'), desc: t('tierComplexDesc') },
  ]
  const load = () => {
    void fetch('/evoresearch/fs/model-settings-get', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
      .then((r) => r.json()).then((json) => {
        if (json.ok) setTiers(json.value.code)
      }).catch((e: any) => setError(String(e)))
  }
  useEffect(load, [])
  const setTierField = (tierId: string, field: keyof TierValue, value: string) => {
    setTiers((prev) => ({ ...(prev ?? {}), [tierId]: { ...(prev?.[tierId] ?? {}), [field]: value } }))
  }
  const save = () => {
    if (tiers === null || saving) return
    setSaving(true)
    setError(null)
    void fetch('/evoresearch/fs/model-settings-set', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ patch: { code: tiers } }),
    }).then((r) => r.json()).then((json) => {
      setSaving(false)
      if (json.ok) setApplied('saved')
      else setError(json.error?.message ?? '保存失败')
    }).catch((e: any) => { setSaving(false); setError(String(e)) })
  }
  const applyTier = (tierId: string) => {
    if (saving) return
    setError(null)
    void fetch('/evoresearch/fs/model-settings-apply', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tier: tierId }),
    }).then((r) => r.json()).then((json) => {
      if (json.ok) setApplied(`applied:${tierId}`)
      else setError(json.value?.error ?? json.error?.message ?? '应用失败')
    }).catch((e: any) => setError(String(e)))
  }
  return jsxs('div', {
    className: 'evo-setting',
    children: [
      jsxs('div', {
        className: 'evo-setting-label',
        children: [jsx(Code2, {}), jsx('span', { children: t('settingsCodeModel') })],
      }),
      jsx('div', { className: 'evo-setting-hint', children: t('codeModelHint') }),
      tiers === null
        ? jsx('div', { className: 'evo-setting-hint', children: 'Loading…' })
        : jsx('div', { className: 'evo-tier-grid', children: TIERS.map((tier) => {
            const v = tiers[tier.id] ?? { model: '', provider: '', reasoningEffort: 'medium' }
            return jsxs('div', {
              className: 'evo-tier-card',
              children: [
                jsxs('div', { className: 'evo-tier-head', children: [
                  jsx('span', { className: 'evo-tier-name', children: tier.label }),
                  jsx('span', { className: 'evo-tier-desc', children: tier.desc }),
                ] }),
                jsx(ModelField, { label: t('modelLabel'), value: v.model ?? '', onChange: (x) => setTierField(tier.id, 'model', x) }),
                jsx(ModelField, { label: t('providerLabel'), value: v.provider ?? '', onChange: (x) => setTierField(tier.id, 'provider', x) }),
                jsxs('label', {
                  className: 'evo-setting-field',
                  children: [
                    jsx('span', { className: 'evo-setting-field-label', children: t('reasoningEffort') }),
                    jsx('select', {
                      className: 'evo-panel-input evo-sched-select',
                      value: v.reasoningEffort ?? 'medium',
                      onChange: (e: { currentTarget: HTMLSelectElement }) => setTierField(tier.id, 'reasoningEffort', e.currentTarget.value),
                      children: [
                        jsx('option', { value: 'low', children: t('effortLow') }, 'low'),
                        jsx('option', { value: 'medium', children: t('effortMedium') }, 'medium'),
                        jsx('option', { value: 'high', children: t('effortHigh') }, 'high'),
                      ],
                    }),
                  ],
                }),
                jsx('button', {
                  type: 'button',
                  className: 'evo-btn evo-btn-run',
                  onClick: () => applyTier(tier.id),
                  children: jsxs(Fragment, { children: [jsx(Cpu, {}), jsx('span', { children: t('applyAsDefault') })] }),
                }),
              ],
            }, tier.id)
          }) }),
      error !== null && jsx('div', { className: 'evo-panel-error', children: error }),
      applied !== null && jsx('div', { className: 'evo-setting-hint', children: t('modelSettingsSaved') }),
      jsx('button', {
        type: 'button',
        className: 'evo-btn evo-btn-ok',
        disabled: saving || tiers === null,
        onClick: save,
        children: jsxs(Fragment, { children: [jsx(Cpu, {}), jsx('span', { children: saving ? t('saving') : t('save') })] }),
      }),
    ],
  })
}

/** 单模型设置（视觉/图片/语音共用表单）。 */
function SingleModelSection({ kind }: { kind: 'vision' | 'image' | 'voice' }) {
  const [value, setValue] = useState<TierValue | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const load = () => {
    void fetch('/evoresearch/fs/model-settings-get', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
      .then((r) => r.json()).then((json) => { if (json.ok) setValue(json.value[kind]) })
      .catch((e: any) => setError(String(e)))
  }
  useEffect(load, [kind])
  const setField = (field: keyof TierValue, v: string) => setValue((prev) => ({ ...(prev ?? {}), [field]: v }))
  const save = () => {
    if (value === null || saving) return
    setSaving(true)
    setError(null)
    void fetch('/evoresearch/fs/model-settings-set', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ patch: { [kind]: value } }),
    }).then((r) => r.json()).then((json) => {
      setSaving(false)
      if (json.ok) setSaved(true)
      else setError(json.error?.message ?? '保存失败')
    }).catch((e: any) => { setSaving(false); setError(String(e)) })
  }
  const title = kind === 'vision' ? t('settingsVision') : kind === 'image' ? t('settingsImage') : t('settingsVoice')
  const icon = kind === 'vision' ? Eye : kind === 'image' ? ImageIcon : Mic
  const hint = kind === 'vision' ? t('visionHint') : kind === 'image' ? t('imageHint') : t('voiceHint')
  return jsxs('div', {
    className: 'evo-setting',
    children: [
      jsxs('div', {
        className: 'evo-setting-label',
        children: [jsx(icon, {}), jsx('span', { children: title })],
      }),
      jsx('div', { className: 'evo-setting-hint', children: hint }),
      value === null
        ? jsx('div', { className: 'evo-setting-hint', children: 'Loading…' })
        : jsxs(Fragment, { children: [
            kind === 'voice' && jsxs('label', {
              className: 'evo-setting-field',
              children: [
                jsx('span', { className: 'evo-setting-field-label', children: t('providerLabel') }),
                jsx('select', {
                  className: 'evo-panel-input evo-sched-select',
                  value: value.voiceProvider ?? 'api',
                  onChange: (e: { currentTarget: HTMLSelectElement }) => setField('voiceProvider', e.currentTarget.value),
                  children: [
                    jsx('option', { value: 'api', children: t('voiceProviderApi') }, 'api'),
                    jsx('option', { value: 'local', children: t('voiceProviderLocal') }, 'local'),
                  ],
                }),
              ],
            }),
            jsx(ModelField, { label: t('modelLabel'), value: value.model ?? '', onChange: (x) => setField('model', x) }),
            jsx(ModelField, { label: t('providerLabel'), value: value.provider ?? '', onChange: (x) => setField('provider', x) }),
            (kind === 'vision' || kind === 'voice') && jsx(ModelField, { label: t('urlLabel'), value: value.url ?? '', onChange: (x) => setField('url', x) }),
            (kind === 'vision' || kind === 'voice') && jsx(ModelField, { label: t('keyEnvLabel'), value: value.keyEnv ?? '', onChange: (x) => setField('keyEnv', x) }),
          ] }),
      error !== null && jsx('div', { className: 'evo-panel-error', children: error }),
      saved && jsx('div', { className: 'evo-setting-hint', children: t('modelSettingsSaved') }),
      jsx('button', {
        type: 'button',
        className: 'evo-btn evo-btn-ok',
        disabled: saving || value === null,
        onClick: save,
        children: jsxs(Fragment, { children: [jsx(Cpu, {}), jsx('span', { children: saving ? t('saving') : t('save') })] }),
      }),
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
    const finish = (ok: boolean, message?: string) => {
      setBusy(false)
      if (!ok) {
        setError(message ?? t('dataClearError'))
        setConfirming(false)
        return
      }
      toast(t('dataCleared'), 'success')
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
      finish(true)
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

type SettingsTab = 'general' | 'code' | 'vision' | 'image' | 'voice' | 'data'

const TABS: Array<{ id: SettingsTab; label: string; icon: any }> = [
  { id: 'general', label: t('settingsGeneral'), icon: Cpu },
  { id: 'code', label: t('settingsCodeModel'), icon: Code2 },
  { id: 'vision', label: t('settingsVision'), icon: Eye },
  { id: 'image', label: t('settingsImage'), icon: ImageIcon },
  { id: 'voice', label: t('settingsVoice'), icon: Mic },
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
                  : tab === 'code'
                    ? jsx(CodeModelSection, {})
                    : tab === 'data'
                      ? jsx(DataClearSection, {})
                      : jsx(SingleModelSection, { kind: tab }),
              }),
            ],
          }),
        ],
      }),
    ],
  })
}
