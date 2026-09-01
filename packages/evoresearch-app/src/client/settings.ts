/**
 * 设置面板：左侧 tab 导航 + 右侧配置 + 左上角「返回」（图标 + 文字）。
 * - 通用：权限模式 / 默认模型 / 插件清单 / 关于（主题与语言在顶栏，不重复）；
 * - 模型设置：1）模型提供商（Provider 接口配置 + 统一「已获取模型」列表）；
 *   2）模型分配（文本四角色 / 图片识别 / 图片生成，从 Provider
 *   模型列表选择并设置推理强度）；
 * - 清除数据。
 */
import { jsx, jsxs, Fragment } from 'react/jsx-runtime'
import { useState, useEffect, useRef } from 'react'
import { ArrowLeft, Cpu, HardDrive, Info, Puzzle, Code2, Eye, Image as ImageIcon, Trash2, Server, Plus, X, Zap, FolderOpen, ChevronRight, ArrowUp, Home, Copy, Search } from 'lucide-react'
import { t } from './i18n'
import { clientStateClear, clientStateSet } from './client-state'
import { GRAPH_LAYOUT_ALGO_STATE_KEY, getGraphLayoutAlgorithm, type GraphLayoutAlgorithm } from './chatgraph-layout'
import { toast } from './toast'
import { ConfirmDialog } from './session-actions'
import { Dropdown } from './dropdown'

export interface SettingsDialogProps {
  onClose: () => void
}

interface PluginRow { id: string; state: string; version?: string }

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

/** 插件清单（官方插件状态快照）。 */
function pluginStateLabel(state: string): string {
  switch (state) {
    case '0': return t('pluginStatePending')
    case '1': return t('pluginStateLoading')
    case '2': return t('pluginStateActive')
    case '3': return t('pluginStateFailed')
    case '4': return t('pluginStateDisposed')
    case '5': return t('pluginStateUnloading')
    case 'loading': return t('pluginStateIdle')
    default: return state
  }
}

/** 图谱自动布局算法（ChatGraph 三算法切换；持久化于 client-state.json，缺省紧凑树）。 */
function GraphLayoutSection() {
  const [algo, setAlgo] = useState<GraphLayoutAlgorithm>(() => getGraphLayoutAlgorithm())
  const options: Array<{ value: GraphLayoutAlgorithm; name: string; desc: string }> = [
    { value: 'tree', name: t('graphAlgoNameTree'), desc: t('graphAlgoDescTree') },
    { value: 'dagre', name: t('graphAlgoNameDagre'), desc: t('graphAlgoDescDagre') },
    { value: 'relax', name: t('graphAlgoNameRelax'), desc: t('graphAlgoDescRelax') },
  ]
  const selected = options.find((option) => option.value === algo) ?? options[0]!
  return jsxs('div', {
    className: 'evo-setting evo-graph-layout-setting',
    children: [
      jsxs('label', { className: 'evo-setting-field evo-web-search-select', children: [
        jsx('span', { className: 'evo-setting-field-label', children: t('graphAlgoLabel') }),
        jsx(Dropdown, {
          value: algo,
          onChange: (value: string) => {
            const next: GraphLayoutAlgorithm = value === 'relax' || value === 'dagre' ? value : 'tree'
            setAlgo(next)
            clientStateSet(GRAPH_LAYOUT_ALGO_STATE_KEY, next)
          },
          ariaLabel: t('graphAlgoLabel'),
          options: options.map((option) => ({ value: option.value, label: option.name })),
        }),
      ] }),
      jsx('div', { className: 'evo-setting-hint', children: selected.desc }),
    ],
  })
}

function PluginListSection() {
  const [plugins, setPlugins] = useState<PluginRow[] | null>(null)
  useEffect(() => {
    let cancelled = false
    void fetch('/evoresearch/fs/plugins', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }).then((res) => res.json()).then((json) => {
      if (!cancelled && json.ok && Array.isArray(json.value?.plugins)) {
        // 同一插件可能出现多个 fiber 条目（如 dev/hmr），按 id 去重，优先保留运行中状态。
        const seen = new Map<string, { id: string; state: string; version?: string }>()
        for (const p of json.value.plugins as Array<{ id: string; state?: string; version?: string | null }>) {
          const id = String(p.id ?? '')
          const state = String(p.state ?? '')
          const version = typeof p.version === 'string' && p.version !== '' ? p.version : undefined
          const prev = seen.get(id)
          if (prev === undefined || (prev.state === 'loading' && state !== 'loading') || (prev.version === undefined && version !== undefined)) {
            seen.set(id, { id, state, ...(version !== undefined ? { version } : {}) })
          }
        }
        const rows = [...seen.values()].sort((a, b) => a.id.localeCompare(b.id))
        setPlugins(rows)
      }
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])
  return jsxs('div', {
    className: 'evo-setting',
    children: [
      jsxs('div', {
        className: 'evo-setting-label',
        children: [jsx(Puzzle, {}), jsx('span', { children: plugins === null ? t('plugins') : `${t('plugins')} · ${plugins.length}` })],
      }),
      plugins === null
        ? jsx('div', { className: 'evo-setting-hint', children: t('loading') })
        : plugins.length === 0
          ? jsx('div', { className: 'evo-setting-hint', children: t('noModels') })
          : jsx('div', { className: 'evo-plugin-list', children: plugins.map((p) => jsxs('div', {
              className: 'evo-plugin-row',
              children: [
                jsxs('span', { className: 'evo-plugin-main', children: [
                  jsx('span', { className: 'evo-plugin-id', title: p.id, children: p.id }),
                  jsx('span', { className: 'evo-plugin-version', children: p.id === 'cordis:include'
                    ? t('pluginVersionBuiltin')
                    : p.version !== undefined ? `v${p.version}` : t('pluginVersionUnknown') }),
                ] }),
                jsx('span', {
                  className: 'evo-plugin-state',
                  'data-active': p.state === '2' || undefined,
                  'data-failed': p.state === '3' || undefined,
                  children: pluginStateLabel(p.state),
                }),
              ],
            }, p.id)) }),
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

export interface DataPathsSnapshot {
  evoresearchRoot: string
  /** 服务端兼容性事实字段；UI 不再把它们作为独立配置项。 */
  dshHome: string
  evoResearchDataRoot: string
  pluginStateRoot: string
  configPath: string
  restartManaged: boolean
  pending: boolean
}

interface DataDirectoryRow {
  name: string
  path: string
  hidden: boolean
}

interface DataDirectoryListing {
  path: string
  home: string
  crumbs: DataDirectoryRow[]
  entries: DataDirectoryRow[]
  roots: DataDirectoryRow[]
}

type DataPathField = 'evoresearchRoot'

/**
 * 兼容旧版 data-paths-get 响应：旧服务可能没有 evoresearchRoot，
 * 但 dshHome / evoResearchDataRoot 已经是同一个实际数据根。
 */
export function normalizeDataPathsSnapshot(value: Record<string, unknown>): DataPathsSnapshot {
  const candidates = [value.evoresearchRoot, value.evoResearchDataRoot, value.dshHome]
  const root = candidates.find((item): item is string => typeof item === 'string' && item.trim() !== '')
  if (root === undefined) throw new Error(t('dataPathsLoadError'))
  return { ...value, evoresearchRoot: root } as DataPathsSnapshot
}

function DataDirectoryPicker({ field, initialPath, onSelect, onClose }: {
  field: DataPathField
  initialPath: string
  onSelect: (field: DataPathField, value: string) => void
  onClose: () => void
}) {
  const [listing, setListing] = useState<DataDirectoryListing | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = (nextPath?: string) => {
    setBusy(true)
    setError(null)
    void fetch('/evoresearch/fs/data-paths-browse', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(nextPath === undefined ? {} : { path: nextPath }),
    }).then((res) => res.json()).then((json) => {
      const value = json.value as DataDirectoryListing | { error?: string } | undefined
      if (json.ok !== true || value === undefined || 'error' in value) throw new Error(('error' in (value ?? {}) ? value.error : undefined) ?? t('folderPickerLoadError'))
      setListing(value)
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : t('folderPickerLoadError')))
      .finally(() => setBusy(false))
  }

  useEffect(() => { load(initialPath) }, [initialPath])

  return jsxs('div', {
    className: 'evo-modal-mask evo-data-path-picker-mask',
    role: 'presentation',
    children: [
      jsxs('div', {
        className: 'evo-modal evo-modal-sm evo-data-path-picker',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': t('folderPickerTitle'),
        children: [
          jsxs('div', { className: 'evo-modal-head', children: [
            jsx('div', { className: 'evo-modal-title', children: t('folderPickerTitle') }),
            jsx('button', { type: 'button', className: 'evo-icon-btn', title: t('cancel'), 'aria-label': t('cancel'), onClick: onClose, children: jsx(X, {}) }),
          ] }),
          jsx('div', { className: 'evo-data-path-picker-hint', children: t('folderPickerHint') }),
          listing !== null && jsxs(Fragment, { children: [
            jsx('div', { className: 'evo-data-path-roots', children: listing.roots.map((root) => jsx('button', {
              type: 'button', className: 'evo-data-path-root', title: root.path, onClick: () => load(root.path),
              children: root.name,
            }, root.path)) }),
            jsxs('div', { className: 'evo-data-path-crumbs', children: [
              jsx('button', { type: 'button', className: 'evo-data-path-up', title: t('folderUp'), 'aria-label': t('folderUp'), disabled: listing.crumbs.length < 2, onClick: () => load(listing.crumbs.at(-2)?.path), children: jsx(ArrowUp, {}) }),
              listing.crumbs.map((crumb, index) => jsxs(Fragment, { children: [
                index > 0 && jsx(ChevronRight, {}),
                jsx('button', { type: 'button', className: 'evo-data-path-crumb', title: crumb.path, onClick: () => load(crumb.path), children: crumb.name }),
              ] }, crumb.path)),
            ] }),
            jsx('div', { className: 'evo-data-path-current', title: listing.path, children: listing.path }),
            jsx('div', { className: 'evo-data-path-entries', children: listing.entries.length === 0
              ? jsx('div', { className: 'evo-setting-hint', children: t('folderEmpty') })
              : listing.entries.map((entry) => jsxs('button', {
                  type: 'button', className: 'evo-data-path-entry', title: entry.path, onClick: () => load(entry.path),
                  children: [jsx(FolderOpen, {}), jsx('span', { children: entry.name }), jsx(ChevronRight, {})],
                }, entry.path)) }),
            error !== null && jsx('div', { className: 'evo-panel-error', children: error }),
            jsxs('div', { className: 'evo-data-path-picker-actions', children: [
              jsx('button', { type: 'button', className: 'evo-btn evo-btn-ok', disabled: busy, onClick: () => { onSelect(field, listing.path); onClose() }, children: jsxs(Fragment, { children: [jsx(FolderOpen, {}), jsx('span', { children: t('useThisFolder') })] }) }),
              jsx('button', { type: 'button', className: 'evo-btn', disabled: busy, onClick: () => load(listing.home), children: jsxs(Fragment, { children: [jsx(Home, {}), jsx('span', { children: t('folderHome') })] }) }),
            ] }),
          ] }),
          listing === null && busy && jsx('div', { className: 'evo-data-path-picker-loading', children: t('loading') }),
          listing === null && error !== null && jsx('div', { className: 'evo-panel-error', children: error }),
        ],
      }),
    ],
  })
}

function DataPathsSection() {
  const [snapshot, setSnapshot] = useState<DataPathsSnapshot | null>(null)
  const [draft, setDraft] = useState<{ evoresearchRoot: string }>({ evoresearchRoot: '' })
  const [picker, setPicker] = useState<{ field: DataPathField; initialPath: string } | null>(null)
  const [applying, setApplying] = useState<'migrate' | 'reuse' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = () => {
    setError(null)
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 5000)
    void fetch('/evoresearch/fs/data-paths-get', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', signal: controller.signal })
      .then((res) => res.json()).then((json) => {
        const value = json.value as Record<string, unknown> | undefined
        if (json.ok !== true || value === undefined || 'error' in value) throw new Error((typeof value?.error === 'string' ? value.error : undefined) ?? t('dataPathsLoadError'))
        const snapshotValue = normalizeDataPathsSnapshot(value)
        setSnapshot(snapshotValue)
        setDraft({ evoresearchRoot: snapshotValue.evoresearchRoot })
      }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : t('dataPathsLoadError')))
      .finally(() => window.clearTimeout(timeout))
  }

  useEffect(() => { load() }, [])

  const changed = snapshot !== null && snapshot.evoresearchRoot !== draft.evoresearchRoot
  const apply = (mode: 'migrate' | 'reuse') => {
    if (!changed || applying !== null) return
    setApplying(mode)
    setError(null)
    setNotice(null)
    void fetch('/evoresearch/fs/data-paths-apply', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ evoresearchRoot: draft.evoresearchRoot, mode }),
    }).then((res) => res.json()).then((json) => {
      const value = json.value as { error?: string; restartRequired?: boolean; restartRequested?: boolean; paths?: DataPathsSnapshot } | undefined
      if (json.ok !== true || value === undefined || value.error !== undefined) throw new Error(value?.error ?? t('dataPathsApplyError'))
      if (value.paths !== undefined && value.restartRequested === true) {
        setSnapshot(value.paths)
        setNotice(t('dataPathsRestarting'))
        window.setTimeout(() => window.location.reload(), 1800)
      } else if (value.paths !== undefined) {
        // The current process still uses the old paths when no launcher accepted
        // the restart request; keep the displayed snapshot factually current.
        setNotice(value.restartRequired === true ? t('dataPathsManualRestart') : t('dataPathsSaved'))
      }
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : t('dataPathsApplyError')))
      .finally(() => setApplying(null))
  }

  const field = (key: DataPathField, label: string, hint: string) => jsxs('div', { className: 'evo-data-path-row', children: [
    jsxs('div', { className: 'evo-data-path-row-head', children: [
      jsx('span', { className: 'evo-data-path-label', children: label }),
      jsx('button', { type: 'button', className: 'evo-btn evo-btn-small evo-data-path-choose', onClick: () => setPicker({ field: key, initialPath: draft[key] || snapshot?.[key] || '' }), children: jsxs(Fragment, { children: [jsx(FolderOpen, {}), jsx('span', { children: t('chooseFolder') })] }) }),
    ] }),
    jsx('div', { className: 'evo-data-path-value', title: draft[key], children: draft[key] || t('loading') }),
    jsx('div', { className: 'evo-setting-hint', children: hint }),
  ] })

  return jsxs('div', {
    className: 'evo-setting evo-data-paths',
    children: [
      jsxs('div', { className: 'evo-setting-label', children: [jsx(HardDrive, {}), jsx('span', { children: t('dataPathsTitle') })] }),
      jsx('div', { className: 'evo-setting-hint', children: t('dataPathsHint') }),
      snapshot === null && error === null && jsx('div', { className: 'evo-setting-hint', children: t('loading') }),
      snapshot !== null && jsxs(Fragment, { children: [
        field('evoresearchRoot', t('evoResearchRootLabel'), t('evoResearchRootHint')),
        jsxs('div', { className: 'evo-data-path-layout', children: [
          jsx('div', { className: 'evo-data-path-layout-title', children: t('dataPathsLayoutLabel') }),
          jsxs('div', { className: 'evo-data-path-layout-row', children: [
            jsx('span', { className: 'evo-data-path-label', children: t('dshHomeLabel') }),
            jsx('span', { className: 'evo-data-path-value', title: snapshot.evoresearchRoot, children: snapshot.evoresearchRoot }),
          ] }),
          jsxs('div', { className: 'evo-data-path-layout-row', children: [
            jsx('span', { className: 'evo-data-path-label', children: t('evoDataRootLabel') }),
            jsx('span', { className: 'evo-data-path-value', title: snapshot.evoresearchRoot, children: snapshot.evoresearchRoot }),
          ] }),
          jsxs('div', { className: 'evo-data-path-layout-row', children: [
            jsx('span', { className: 'evo-data-path-label', children: t('pluginStateRootLabel') }),
            jsx('span', { className: 'evo-data-path-value', title: snapshot.pluginStateRoot, children: snapshot.pluginStateRoot }),
          ] }),
        ] }),
        snapshot.pending && jsx('div', { className: 'evo-data-path-pending', children: t('dataPathsPending') }),
        changed && jsx('div', { className: 'evo-data-path-change', children: [
          jsx('div', { className: 'evo-setting-hint', children: t('dataPathsChangeHint') }),
          jsxs('div', { className: 'evo-data-path-actions', children: [
            jsx('button', { type: 'button', className: 'evo-btn evo-btn-ok', disabled: applying !== null, onClick: () => apply('migrate'), children: jsxs(Fragment, { children: [jsx(FolderOpen, {}), jsx('span', { children: applying === 'migrate' ? t('dataPathsApplying') : t('dataPathsMigrate') })] }) }),
            jsx('button', { type: 'button', className: 'evo-btn', disabled: applying !== null, onClick: () => apply('reuse'), children: jsxs(Fragment, { children: [jsx(Copy, {}), jsx('span', { children: applying === 'reuse' ? t('dataPathsApplying') : t('dataPathsReuse') })] }) }),
          ] }),
        ] }),
        notice !== null && jsx('div', { className: 'evo-data-path-notice', children: notice }),
      ] }),
      error !== null && jsx('div', { className: 'evo-panel-error', children: error }),
      picker !== null && jsx(DataDirectoryPicker, { field: picker.field, initialPath: picker.initialPath, onSelect: (key, value) => setDraft((previous) => ({ ...previous, [key]: value })), onClose: () => setPicker(null) }),
    ],
  })
}

interface WebSearchProviderRow {
  id: string
  name: string
  description: string
  baseURL: string
  apiKeyEnv?: string
  requiresKey: boolean
  apiKeyOptional?: boolean
  configured: boolean
  freeTier: string
  managed?: boolean
  installable?: boolean
  installed?: boolean
  running?: boolean
  runtimeState?: string
  runtimeEndpoint?: string
  runtimeMessage?: string
}

interface WebSearchSettingsValue {
  activeProvider: string
  providers: WebSearchProviderRow[]
  academicProvider?: string
  academicProviders?: AcademicProviderRow[]
}

interface AcademicCredentialRow { id: string; label: string; env: string; configured: boolean; optional: boolean }
interface AcademicProviderRow {
  id: string
  name: string
  description: string
  configured: boolean
  freeTier: string
  baseURL: string
  settings?: { crossrefURL?: string; scholarURL?: string; semanticScholarURL?: string; recommendURL?: string; s2SortBy?: 'relevance' | 'citations' | 'year'; s2YearMin?: number; s2YearMax?: number; s2OpenAccessOnly?: boolean; localProxy?: string; qgServers?: string[]; qgPort?: number; qgChannel?: string; country?: string; delayMs?: number; enrich?: boolean; maxRetries?: number; maxEnrichmentRounds?: number; includeAuthorProfiles?: boolean; recursiveDepth?: number; recursiveWidth?: number; recursiveMaxTotal?: number; fetchBibtex?: boolean; fetchArxiv?: boolean; fetchArxivHTML?: boolean; deepseekEnrich?: boolean; deepseekURL?: string; deepseekModel?: string }
  credentials: AcademicCredentialRow[]
}

/** 联网搜索 Provider：统一设置入口，密钥只提交到服务端 credentials，不回显。 */
function WebSearchSection() {
  const [settings, setSettings] = useState<WebSearchSettingsValue | null>(null)
  const [draftProviders, setDraftProviders] = useState<Record<string, { baseURL: string; model?: string }>>({})
  const [active, setActive] = useState('none')
  const [apiKey, setApiKey] = useState('')
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState<'load' | 'save' | 'test' | 'backend' | null>('load')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<{ count: number; sources: Array<{ title?: string; url: string }> } | null>(null)

  const load = () => {
    setBusy('load')
    setError(null)
    void fetch('/evoresearch/fs/web-search-settings-get', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
      .then((r) => r.json()).then((json) => {
        if (json.ok !== true || !Array.isArray(json.value?.providers)) throw new Error(json.error?.message ?? t('webSearchLoadFailed'))
        const value = json.value as WebSearchSettingsValue
        setSettings(value)
        setActive(typeof value.activeProvider === 'string' ? value.activeProvider : 'none')
        setDraftProviders(Object.fromEntries(value.providers.map((p) => [p.id, { baseURL: p.baseURL }])))
      }).catch((e: unknown) => setError(e instanceof Error ? e.message : t('webSearchLoadFailed')))
      .finally(() => setBusy(null))
  }
  useEffect(load, [])

  const selected = settings?.providers.find((p) => p.id === active)
  const selectedDraft = active !== 'none' ? (draftProviders[active] ?? { baseURL: selected?.baseURL ?? '' }) : undefined
  const manageBackend = (action: 'start' | 'stop') => {
    if (busy !== null || selected?.managed !== true) return
    setBusy('backend'); setError(null); setNotice(null)
    void fetch(`/evoresearch/fs/web-search-backend-${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
      .then((r) => r.json()).then((json) => {
        if (json.ok !== true) throw new Error(json.error?.message ?? t('webSearchBackendFailed'))
        load()
        setNotice(action === 'start' ? t('webSearchBackendStarted') : t('webSearchBackendStopped'))
      }).catch((e: unknown) => setError(e instanceof Error ? e.message : t('webSearchBackendFailed')))
      .finally(() => setBusy(null))
  }
  const updateURL = (baseURL: string) => {
    if (active === 'none') return
    setDraftProviders((previous) => ({ ...previous, [active]: { ...(previous[active] ?? {}), baseURL } }))
  }
  const save = () => {
    if (busy !== null || settings === null) return
    setBusy('save'); setError(null); setNotice(null)
    void fetch('/evoresearch/fs/web-search-settings-save', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ activeProvider: active, providers: draftProviders, ...(apiKey.trim() !== '' ? { apiKeys: { [active]: apiKey } } : {}) }),
    }).then((r) => r.json()).then((json) => {
      if (json.ok !== true) throw new Error(json.error?.message ?? t('webSearchSaveFailed'))
      setSettings(json.value as WebSearchSettingsValue)
      setApiKey('')
      setNotice(t('webSearchSaved'))
    }).catch((e: unknown) => setError(e instanceof Error ? e.message : t('webSearchSaveFailed')))
      .finally(() => setBusy(null))
  }
  const test = () => {
    if (busy !== null || query.trim() === '') return
    setBusy('test'); setError(null); setNotice(null); setTestResult(null)
    void fetch('/evoresearch/fs/web-search-test', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query }),
    }).then((r) => r.json()).then((json) => {
      if (json.ok !== true) throw new Error(json.error?.message ?? t('webSearchTestFailed'))
      const sources = Array.isArray(json.value?.sources) ? json.value.sources : []
      setTestResult({ count: sources.length, sources: sources.slice(0, 5) })
    }).catch((e: unknown) => setError(e instanceof Error ? e.message : t('webSearchTestFailed')))
      .finally(() => setBusy(null))
  }

  return jsxs('div', {
    className: 'evo-setting evo-web-search-setting',
    children: [
      jsxs('div', { className: 'evo-setting-label', children: [jsx(Search, {}), jsx('span', { children: t('webSearchTitle') })] }),
      jsx('div', { className: 'evo-setting-hint', children: t('webSearchDescription') }),
      settings === null && busy === 'load' && jsx('div', { className: 'evo-setting-hint', children: t('loading') }),
      settings !== null && jsxs(Fragment, { children: [
        jsxs('label', { className: 'evo-setting-field evo-web-search-select', children: [
          jsx('span', { className: 'evo-setting-field-label', children: t('webSearchProviderLabel') }),
          jsx(Dropdown, {
            value: active,
            onChange: (value: string) => { setActive(value); setApiKey(''); setTestResult(null) },
            ariaLabel: t('webSearchProviderLabel'),
            options: [{ value: 'none', label: t('webSearchDisabled') }, ...settings.providers.map((p) => ({ value: p.id, label: `${p.name}${p.configured ? ' · ✓' : ''}` }))],
          }),
        ] }),
        selected !== undefined && selectedDraft !== undefined && jsxs('div', { className: 'evo-web-search-card', children: [
          jsx('div', { className: 'evo-web-search-name', children: selected.name }),
          jsx('div', { className: 'evo-setting-hint', children: selected.description }),
          jsx('div', { className: 'evo-setting-hint', children: `${t('webSearchFreeTier')}: ${selected.freeTier}` }),
          selected.managed === true && jsxs('div', { className: 'evo-web-search-runtime', children: [
            jsxs('div', { className: 'evo-setting-hint', children: [t('webSearchBackendStatus'), ': ', selected.running ? t('webSearchBackendRunning') : selected.runtimeState === 'installing' ? t('webSearchBackendInstalling') : t('webSearchBackendStoppedState'), selected.running && selected.runtimeEndpoint !== undefined ? ` · ${selected.runtimeEndpoint}` : ''] }),
            selected.runtimeMessage !== undefined && jsx('div', { className: 'evo-panel-error', children: selected.runtimeMessage }),
            jsxs('div', { className: 'evo-llm-actions', children: [
              jsx('button', { type: 'button', className: 'evo-btn evo-btn-ok', disabled: busy !== null, onClick: () => manageBackend('start'), children: selected.running ? t('webSearchBackendRestart') : selected.installed ? t('webSearchBackendStart') : t('webSearchBackendInstallStart') }),
              selected.running && jsx('button', { type: 'button', className: 'evo-btn', disabled: busy !== null, onClick: () => manageBackend('stop'), children: t('webSearchBackendStop') }),
            ] }),
          ] }),
          jsx(ModelField, { label: t('webSearchEndpointLabel'), value: selectedDraft.baseURL, placeholder: selected.baseURL || t('webSearchEndpointPlaceholder'), onChange: updateURL }),
          (selected.requiresKey || selected.apiKeyOptional) && jsxs('label', { className: 'evo-setting-field evo-web-search-key', children: [
            jsx('span', { className: 'evo-setting-field-label', children: `${t('webSearchApiKeyLabel')}（${selected.apiKeyEnv ?? ''}${selected.apiKeyOptional ? `，${t('webSearchApiKeyOptional')}` : ''}）` }),
            jsx('input', { type: 'password', className: 'evo-panel-input', value: apiKey, placeholder: selected.configured ? t('webSearchKeyConfigured') : t('webSearchKeyPlaceholder'), autoComplete: 'new-password', onInput: (e: { currentTarget: HTMLInputElement }) => setApiKey(e.currentTarget.value) }),
          ] }),
          jsxs('div', { className: 'evo-llm-actions', children: [
            jsx('button', { type: 'button', className: 'evo-btn evo-btn-ok', disabled: busy !== null, onClick: save, children: busy === 'save' ? t('saving') : t('webSearchSave') }),
          ] }),
        ] }),
        active !== 'none' && jsxs('div', { className: 'evo-web-search-test', children: [
          jsx('div', { className: 'evo-setting-hint', children: t('webSearchTestHint') }),
          jsxs('div', { className: 'evo-web-search-test-row', children: [
            jsx('input', { className: 'evo-panel-input', value: query, placeholder: t('webSearchTestPlaceholder'), 'aria-label': t('webSearchTestPlaceholder'), onInput: (e: { currentTarget: HTMLInputElement }) => setQuery(e.currentTarget.value), onKeyDown: (e: { key: string }) => { if (e.key === 'Enter') test() } }),
            jsx('button', { type: 'button', className: 'evo-btn evo-btn-test', disabled: busy !== null || query.trim() === '', onClick: test, children: busy === 'test' ? t('testing') : t('webSearchTest') }),
          ] }),
          testResult !== null && jsx('div', { className: 'evo-web-search-result', 'aria-live': 'polite', children: [
            jsx('div', { className: 'evo-setting-hint', children: t('webSearchTestResult').replace('{n}', String(testResult.count)) }),
            testResult.sources.map((item) => jsx('a', { href: item.url, target: '_blank', rel: 'noreferrer', children: item.title ?? item.url }, item.url)),
          ] }),
        ] }),
      ] }),
      notice !== null && jsx('div', { className: 'evo-data-path-notice', children: notice }),
      error !== null && jsx('div', { className: 'evo-panel-error', role: 'alert', children: error }),
    ],
  })
}

/** 学术论文专用搜索：与通用联网搜索使用不同的 Provider 配置和测试入口。 */
function AcademicSearchSection() {
  const [settings, setSettings] = useState<WebSearchSettingsValue | null>(null)
  const [active, setActive] = useState('paper-navigator')
  const [drafts, setDrafts] = useState<Record<string, Record<string, unknown>>>({})
  const [keys, setKeys] = useState<Record<string, string>>({})
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState<'load' | 'save' | 'test' | null>('load')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<{ count: number; sources: Array<{ title?: string; url: string }> } | null>(null)

  const load = () => {
    setBusy('load'); setError(null)
    void fetch('/evoresearch/fs/web-search-settings-get', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
      .then((r) => r.json()).then((json) => {
        if (json.ok !== true || !Array.isArray(json.value?.academicProviders)) throw new Error(json.error?.message ?? t('academicLoadFailed'))
        const value = json.value as WebSearchSettingsValue
        const rows = value.academicProviders ?? []
        setSettings(value)
        setActive(typeof value.academicProvider === 'string' ? value.academicProvider : 'paper-navigator')
        setDrafts(Object.fromEntries(rows.map((row) => [row.id, {
          ...(row.settings ?? {}),
          baseURL: row.baseURL,
        }])))
      }).catch((e: unknown) => setError(e instanceof Error ? e.message : t('academicLoadFailed')))
      .finally(() => setBusy(null))
  }
  useEffect(load, [])

  const providers = settings?.academicProviders ?? []
  const selected = providers.find((row) => row.id === active)
  const draft = drafts[active] ?? {}
  const update = (field: string, value: unknown) => setDrafts((previous) => ({ ...previous, [active]: { ...(previous[active] ?? {}), [field]: value } }))
  const save = () => {
    if (busy !== null || settings === null) return
    setBusy('save'); setError(null); setNotice(null)
    void fetch('/evoresearch/fs/web-search-settings-save', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ activeProvider: settings.activeProvider, providers: Object.fromEntries(settings.providers.map((p) => [p.id, { baseURL: p.baseURL }])), academicProvider: active, academicProviders: drafts, academicApiKeys: Object.fromEntries(Object.entries(keys).filter(([, value]) => value.trim() !== '')) }),
    }).then((r) => r.json()).then((json) => {
      if (json.ok !== true) throw new Error(json.error?.message ?? t('academicSaveFailed'))
      setSettings(json.value as WebSearchSettingsValue); setKeys({}); setNotice(t('academicSaved'))
    }).catch((e: unknown) => setError(e instanceof Error ? e.message : t('academicSaveFailed')))
      .finally(() => setBusy(null))
  }
  const test = () => {
    if (busy !== null || query.trim() === '') return
    setBusy('test'); setError(null); setNotice(null); setTestResult(null)
    void fetch('/evoresearch/fs/academic-search-test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query }) })
      .then((r) => r.json()).then((json) => {
        if (json.ok !== true) throw new Error(json.error?.message ?? t('academicTestFailed'))
        const sources = Array.isArray(json.value?.sources) ? json.value.sources : []
        setTestResult({ count: sources.length, sources: sources.slice(0, 5) })
      }).catch((e: unknown) => setError(e instanceof Error ? e.message : t('academicTestFailed')))
      .finally(() => setBusy(null))
  }
  const credentialRows = selected?.credentials ?? []

  return jsxs('div', {
    className: 'evo-setting evo-web-search-setting evo-academic-search-setting',
    children: [
      jsxs('div', { className: 'evo-setting-label', children: [jsx(Search, {}), jsx('span', { children: t('academicSearchTitle') })] }),
      jsx('div', { className: 'evo-setting-hint', children: t('academicSearchDescription') }),
      settings === null && busy === 'load' && jsx('div', { className: 'evo-setting-hint', children: t('loading') }),
      settings !== null && jsxs(Fragment, { children: [
        jsxs('label', { className: 'evo-setting-field evo-web-search-select', children: [
          jsx('span', { className: 'evo-setting-field-label', children: t('academicSearchProviderLabel') }),
          jsx(Dropdown, { value: active, onChange: (value: string) => { setActive(value); setTestResult(null) }, ariaLabel: t('academicSearchProviderLabel'), options: [{ value: 'none', label: t('academicSearchDisabled') }, ...providers.map((p) => ({ value: p.id, label: `${p.name}${p.configured ? ' · ✓' : ''}` }))] }),
        ] }),
        selected !== undefined && jsxs('div', { className: 'evo-web-search-card', children: [
          jsx('div', { className: 'evo-web-search-name', children: selected.name }),
          jsx('div', { className: 'evo-setting-hint', children: selected.description }),
          jsx('div', { className: 'evo-setting-hint', children: `${t('webSearchFreeTier')}: ${selected.freeTier}` }),
          selected.id === 'openalex-crossref' && jsxs(Fragment, { children: [
            jsx(ModelField, { label: t('academicOpenAlexURLLabel'), value: String(draft.baseURL ?? selected.baseURL), onChange: (value) => update('baseURL', value) }),
            jsx(ModelField, { label: t('academicCrossrefURLLabel'), value: String(draft.crossrefURL ?? selected.settings?.crossrefURL ?? ''), onChange: (value) => update('crossrefURL', value) }),
          ] }),
          selected.id === 'paper-navigator' && jsxs(Fragment, { children: [
            jsx(ModelField, { label: 'Semantic Scholar API URL', value: String(draft.baseURL ?? selected.baseURL), onChange: (value) => update('baseURL', value) }),
            jsx(ModelField, { label: 'Semantic Scholar 推荐 API URL', value: String(draft.recommendURL ?? selected.settings?.recommendURL ?? ''), onChange: (value) => update('recommendURL', value) }),
            jsxs('label', { className: 'evo-setting-field evo-web-search-select', children: [
              jsx('span', { className: 'evo-setting-field-label', children: '检索排序' }),
              jsx(Dropdown, { value: String(draft.s2SortBy ?? selected.settings?.s2SortBy ?? 'relevance'), onChange: (value: string) => update('s2SortBy', value), ariaLabel: '检索排序', options: [{ value: 'relevance', label: '语义相关性' }, { value: 'citations', label: '引用量' }, { value: 'year', label: '最新年份' }] }),
            ] }),
            jsx(ModelField, { label: '最早年份（可选）', value: String((draft.s2YearMin ?? selected.settings?.s2YearMin ?? 0) || ''), onChange: (value) => update('s2YearMin', value.trim() === '' ? undefined : Math.max(1900, Math.round(Number(value) || 1900))) }),
            jsx(ModelField, { label: '最晚年份（可选）', value: String((draft.s2YearMax ?? selected.settings?.s2YearMax ?? 0) || ''), onChange: (value) => update('s2YearMax', value.trim() === '' ? undefined : Math.max(1900, Math.round(Number(value) || 1900))) }),
            jsxs('label', { className: 'evo-setting-check', children: [jsx('input', { type: 'checkbox', checked: draft.s2OpenAccessOnly === true, onChange: (e: { currentTarget: HTMLInputElement }) => update('s2OpenAccessOnly', e.currentTarget.checked) }), jsx('span', { children: '仅返回开放获取论文' })] }),
          ] }),
          selected.id === 'autorelatedwork' && jsxs(Fragment, { children: [
            jsx(ModelField, { label: t('academicScholarURLLabel'), value: String(draft.scholarURL ?? selected.settings?.scholarURL ?? selected.baseURL), onChange: (value) => update('scholarURL', value) }),
            jsx(ModelField, { label: t('academicProxyLabel'), value: String(draft.localProxy ?? selected.settings?.localProxy ?? ''), placeholder: t('academicProxyPlaceholder'), onChange: (value) => update('localProxy', value) }),
            jsx(ModelField, { label: t('academicQGServersLabel'), value: Array.isArray(draft.qgServers) ? draft.qgServers.join(', ') : (selected.settings?.qgServers ?? []).join(', '), onChange: (value) => update('qgServers', value.split(',').map((item) => item.trim()).filter(Boolean)) }),
            jsx(ModelField, { label: t('academicQGPortLabel'), value: String(draft.qgPort ?? selected.settings?.qgPort ?? 443), onChange: (value) => update('qgPort', Math.max(1, Math.round(Number(value) || 443))) }),
            jsx(ModelField, { label: t('academicQGChannelLabel'), value: String(draft.qgChannel ?? selected.settings?.qgChannel ?? ''), placeholder: t('academicQGChannelPlaceholder'), onChange: (value) => update('qgChannel', value) }),
            jsx(ModelField, { label: t('academicCountryLabel'), value: String(draft.country ?? selected.settings?.country ?? ''), placeholder: t('academicCountryPlaceholder'), onChange: (value) => update('country', value) }),
            jsx(ModelField, { label: t('academicDelayLabel'), value: String(draft.delayMs ?? selected.settings?.delayMs ?? 1200), onChange: (value) => update('delayMs', Math.max(0, Number(value) || 0)) }),
            jsx(ModelField, { label: t('academicRetryLabel'), value: String(draft.maxRetries ?? selected.settings?.maxRetries ?? 3), onChange: (value) => update('maxRetries', Math.min(6, Math.max(1, Math.round(Number(value) || 3)))) }),
            jsx(ModelField, { label: t('academicEnrichmentRoundsLabel'), value: String(draft.maxEnrichmentRounds ?? selected.settings?.maxEnrichmentRounds ?? 1), onChange: (value) => update('maxEnrichmentRounds', Math.min(3, Math.max(1, Math.round(Number(value) || 1)))) }),
            jsx(ModelField, { label: t('academicRecursiveDepthLabel'), value: String(draft.recursiveDepth ?? selected.settings?.recursiveDepth ?? 0), onChange: (value) => update('recursiveDepth', Math.min(3, Math.max(0, Math.round(Number(value) || 0)))) }),
            jsx(ModelField, { label: t('academicRecursiveWidthLabel'), value: String(draft.recursiveWidth ?? selected.settings?.recursiveWidth ?? 5), onChange: (value) => update('recursiveWidth', Math.min(20, Math.max(1, Math.round(Number(value) || 5)))) }),
            jsx(ModelField, { label: t('academicRecursiveMaxTotalLabel'), value: String(draft.recursiveMaxTotal ?? selected.settings?.recursiveMaxTotal ?? 50), onChange: (value) => update('recursiveMaxTotal', Math.min(100, Math.max(1, Math.round(Number(value) || 50)))) }),
            jsx(ModelField, { label: t('academicDeepseekURLLabel'), value: String(draft.deepseekURL ?? selected.settings?.deepseekURL ?? ''), placeholder: 'https://api.deepseek.com', onChange: (value) => update('deepseekURL', value) }),
            jsx(ModelField, { label: t('academicDeepseekModelLabel'), value: String(draft.deepseekModel ?? selected.settings?.deepseekModel ?? ''), placeholder: 'deepseek-chat', onChange: (value) => update('deepseekModel', value) }),
            jsxs('div', { className: 'evo-setting-check-grid', children: [
              jsxs('label', { className: 'evo-setting-check', children: [jsx('input', { type: 'checkbox', checked: draft.fetchBibtex !== false, onChange: (e: { currentTarget: HTMLInputElement }) => update('fetchBibtex', e.currentTarget.checked) }), jsx('span', { children: t('academicBibtexLabel') })] }),
              jsxs('label', { className: 'evo-setting-check', children: [jsx('input', { type: 'checkbox', checked: draft.fetchArxiv !== false, onChange: (e: { currentTarget: HTMLInputElement }) => update('fetchArxiv', e.currentTarget.checked) }), jsx('span', { children: t('academicArxivLabel') })] }),
              jsxs('label', { className: 'evo-setting-check', children: [jsx('input', { type: 'checkbox', checked: draft.fetchArxivHTML !== false, onChange: (e: { currentTarget: HTMLInputElement }) => update('fetchArxivHTML', e.currentTarget.checked) }), jsx('span', { children: t('academicArxivHTMLLabel') })] }),
              jsxs('label', { className: 'evo-setting-check', children: [jsx('input', { type: 'checkbox', checked: draft.includeAuthorProfiles === true, onChange: (e: { currentTarget: HTMLInputElement }) => update('includeAuthorProfiles', e.currentTarget.checked) }), jsx('span', { children: t('academicAuthorProfilesLabel') })] }),
              jsxs('label', { className: 'evo-setting-check', children: [jsx('input', { type: 'checkbox', checked: draft.deepseekEnrich === true, onChange: (e: { currentTarget: HTMLInputElement }) => update('deepseekEnrich', e.currentTarget.checked) }), jsx('span', { children: t('academicDeepseekEnrichLabel') })] }),
            ] }),
            jsxs('label', { className: 'evo-setting-check', children: [jsx('input', { type: 'checkbox', checked: draft.enrich !== false, onChange: (e: { currentTarget: HTMLInputElement }) => update('enrich', e.currentTarget.checked) }), jsx('span', { children: t('academicEnrichLabel') })] }),
            jsx('div', { className: 'evo-setting-hint', children: t('academicCredentialsHint') }),
            credentialRows.map((credential) => jsxs('label', { className: 'evo-setting-field evo-web-search-key', children: [jsx('span', { className: 'evo-setting-field-label', children: `${credential.label}（${credential.env}，${t('webSearchApiKeyOptional')}）` }), jsx('input', { type: credential.id === 'qgAuthPwd' ? 'password' : 'text', className: 'evo-panel-input', value: keys[credential.id] ?? '', placeholder: credential.configured ? t('webSearchKeyConfigured') : t('webSearchKeyPlaceholder'), autoComplete: 'new-password', onInput: (e: { currentTarget: HTMLInputElement }) => setKeys((previous) => ({ ...previous, [credential.id]: e.currentTarget.value })) })] }, credential.id)),
          ] }),
          jsxs('div', { className: 'evo-llm-actions', children: [jsx('button', { type: 'button', className: 'evo-btn evo-btn-ok', disabled: busy !== null, onClick: save, children: busy === 'save' ? t('saving') : t('academicSave') })] }),
        ] }),
        active !== 'none' && jsxs('div', { className: 'evo-web-search-test', children: [
          jsx('div', { className: 'evo-setting-hint', children: t('academicTestHint') }),
          jsxs('div', { className: 'evo-web-search-test-row', children: [jsx('input', { className: 'evo-panel-input', value: query, placeholder: t('academicTestPlaceholder'), 'aria-label': t('academicTestPlaceholder'), onInput: (e: { currentTarget: HTMLInputElement }) => setQuery(e.currentTarget.value), onKeyDown: (e: { key: string }) => { if (e.key === 'Enter') test() } }), jsx('button', { type: 'button', className: 'evo-btn evo-btn-test', disabled: busy !== null || query.trim() === '', onClick: test, children: busy === 'test' ? t('testing') : t('academicTest') })] }),
          testResult !== null && jsx('div', { className: 'evo-web-search-result', 'aria-live': 'polite', children: [jsx('div', { className: 'evo-setting-hint', children: t('academicTestResult').replace('{n}', String(testResult.count)) }), testResult.sources.map((item) => jsx('a', { href: item.url, target: '_blank', rel: 'noreferrer', children: item.title ?? item.url }, item.url))] }),
        ] }),
      ] }),
      notice !== null && jsx('div', { className: 'evo-data-path-notice', children: notice }),
      error !== null && jsx('div', { className: 'evo-panel-error', role: 'alert', children: error }),
    ],
  })
}

/** 模型分配（文本四角色 + 视觉/图片）：provider / model / reasoningEffort 等。 */
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

/** 模型分配下拉用的模型条目（含输入/输出模态，用于视觉/图片生成过滤）。 */
interface AssignModelOption {
  id: string
  name: string
  supportedReasoning: string[] | null
  input: string[] | null
  output: string[] | null
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
  const [catalog, setCatalog] = useState<Array<{ provider?: { id?: string }; models?: Array<{ id?: string; name?: string; supportedReasoning?: string[] | null; input?: string[] | null; output?: string[] | null }> }>>([])
  const [saving, setSaving] = useState<string | null>(null)
  const [testState, setTestState] = useState<Record<string, TestState>>({})
  const [saveMsg, setSaveMsg] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [migrated, setMigrated] = useState<Record<string, string>>({})
  const loadSeq = useRef(0)
  /** 最近一次“应用/设为默认”选择的角色（多个角色模型相同时也以此为准）。 */
  const [storedDefaultTier, setStoredDefaultTier] = useState<string | null>(null)

  const providerModels = (providerId: string): AssignModelOption[] => {
    const group = catalog.find((g) => g.provider?.id === providerId)
    const live = (group?.models ?? []).filter((m) => m.id !== undefined && m.id !== '')
    if (live.length > 0) {
      return live.map((m) => ({ id: m.id as string, name: m.name ?? (m.id as string), supportedReasoning: Array.isArray(m.supportedReasoning) ? m.supportedReasoning : null, input: Array.isArray(m.input) ? m.input as string[] : null, output: Array.isArray(m.output) ? m.output as string[] : null }))
    }
    return (providers.find((p) => p.id === providerId)?.models ?? []).map((m) => ({ id: m.id, name: m.name !== '' ? m.name : m.id, supportedReasoning: m.supportedReasoning, input: null, output: null }))
  }
  /** 各分配类型要求的输入模态：vision=图片输入；其余不限。 */
  const kindInputModality = (kind: string): string | null => (kind === 'vision' ? 'image' : null)
  /** 各分配类型要求的输出模态：image=图片生成（必须能输出图片）；其余不限。 */
  const kindOutputModality = (kind: string): string | null => (kind === 'image' ? 'image' : null)
  /** 图片生成没有“推理强度”概念：不展示控件，也不保存该字段。 */
  const noReasoningKind = (kind: string): boolean => kind === 'image'
  /** 按模态过滤模型：输入模态未知时放行；图片生成要求明确具备图像输出能力，未知不算。 */
  const modelOptionsFor = (kind: string, providerId: string): AssignModelOption[] => {
    const all = providerModels(providerId)
    const inMod = kindInputModality(kind)
    const outMod = kindOutputModality(kind)
    return all.filter((m) => {
      if (inMod !== null && m.input !== null && !m.input.includes(inMod)) return false
      if (outMod !== null && (!Array.isArray(m.output) || !m.output.includes(outMod))) return false
      return true
    })
  }
  const defaultReasoning = (supported: string[] | null | undefined): string => {
    if (!Array.isArray(supported) || supported.length === 0) return 'high'
    if (supported.includes('high')) return 'high'
    const nonOff = supported.find((l) => l !== 'off')
    return nonOff ?? 'off'
  }

  const load = () => {
    const requestId = ++loadSeq.current
    setError(null)
    void Promise.all([
      fetch('/evoresearch/fs/model-settings-get', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then((r) => r.json()),
      fetch('/evoresearch/fs/llm-providers', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then((r) => r.json()),
      fetch('/evoresearch/fs/models-catalog', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then((r) => r.json()).catch(() => ({ ok: false })),
    ]).then(([ms, lp, cat]) => {
      if (requestId !== loadSeq.current) return
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
      const groups: Array<{ provider?: { id?: string }; models?: Array<{ id?: string; name?: string; supportedReasoning?: string[] | null; input?: string[] | null; output?: string[] | null }> }> = cat.ok === true ? (cat.value?.groups ?? []) : []
      setProviders(providerList)
      setCatalog(groups)
      const raw = (ms.ok === true ? ms.value : {}) as Record<string, unknown>
      setStoredDefaultTier(raw.defaultTier === 'utility' || raw.defaultTier === 'coder' || raw.defaultTier === 'planner' || raw.defaultTier === 'writer' ? raw.defaultTier : null)
      const rawCode = (raw.code ?? {}) as Record<string, unknown>
      const ids = new Set(providerList.map((p) => p.id))
      const modelsOf = (providerId: string): AssignModelOption[] => {
        const group = groups.find((g) => g.provider?.id === providerId)
        const live = (group?.models ?? []).filter((m) => m.id !== undefined && m.id !== '')
        if (live.length > 0) return live.map((m) => ({ id: m.id as string, name: m.name ?? (m.id as string), supportedReasoning: Array.isArray(m.supportedReasoning) ? m.supportedReasoning : null, input: Array.isArray(m.input) ? m.input as string[] : null, output: Array.isArray(m.output) ? m.output as string[] : null }))
        return (providerList.find((p) => p.id === providerId)?.models ?? []).map((m) => ({ id: m.id, name: m.name !== '' ? m.name : m.id, supportedReasoning: m.supportedReasoning, input: null, output: null }))
      }
      const entries: Array<[string, Record<string, unknown>]> = [
        ['utility', (rawCode.utility ?? {}) as Record<string, unknown>],
        ['coder', (rawCode.coder ?? {}) as Record<string, unknown>],
        ['planner', (rawCode.planner ?? {}) as Record<string, unknown>],
        ['writer', (rawCode.writer ?? {}) as Record<string, unknown>],
        ['vision', (raw.vision ?? {}) as Record<string, unknown>],
        ['image', (raw.image ?? {}) as Record<string, unknown>],
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
        // 尚未配置的分配（常见于图片识别）：自动预选第一个 Provider，
        // 并按该分配要求的输入模态挑一个合适的默认模型，避免"看着有选项其实没选中"。
        if (next[key].provider === '' && providerList.length > 0) {
          provider = providerList[0].id
          next[key].provider = provider
          const inMod = kindInputModality(key)
          const outMod = kindOutputModality(key)
          const candidates = modelsOf(provider).filter((m) =>
            (inMod === null || m.input === null || m.input.includes(inMod)) &&
            (outMod === null || (Array.isArray(m.output) && m.output.includes(outMod))),
          )
          const hit = candidates.find((m) => m.id === model) ?? candidates[0]
          if (hit !== undefined) {
            model = hit.id
            next[key].model = model
          }
        }
        if (model !== '') {
          const sup = modelsOf(provider).find((m) => m.id === model)?.supportedReasoning ?? null
          const stored = typeof cur.reasoningEffort === 'string' ? cur.reasoningEffort : ''
          next[key].reasoningEffort = noReasoningKind(key)
            ? ''
            : (Array.isArray(sup) && sup.length > 0
              ? (sup.includes(stored) ? stored : defaultReasoning(sup))
              : (stored !== '' ? stored : defaultReasoning(null)))
        }
      }
      setAssign(next)
      setMigrated(migratedMap)
    }).catch((e: unknown) => {
      if (requestId === loadSeq.current) setError((e as Error)?.message ?? t('loadFailed'))
    })
  }
  useEffect(() => {
    load()
    const onProvidersChanged = () => load()
    window.addEventListener(PROVIDERS_CHANGED_EVENT, onProvidersChanged)
    return () => window.removeEventListener(PROVIDERS_CHANGED_EVENT, onProvidersChanged)
  }, [])

  const setField = (key: string, field: keyof AssignSetting, value: string) => {
    setAssign((prev) => (prev === null ? prev : { ...prev, [key]: { ...(prev[key] ?? {}), [field]: value } }))
  }
  const changeProvider = (key: string, providerId: string) => {
    const models = modelOptionsFor(key, providerId)
    setAssign((prev) => (prev === null ? prev : { ...prev, [key]: { ...(prev[key] ?? {}), provider: providerId, model: models[0]?.id ?? '', reasoningEffort: noReasoningKind(key) ? '' : defaultReasoning(models[0]?.supportedReasoning) } }))
  }
  const changeModel = (key: string, modelId: string) => {
    const m = assign !== null ? modelOptionsFor(key, assign[key]?.provider ?? '').find((x) => x.id === modelId) : undefined
    setAssign((prev) => (prev === null ? prev : { ...prev, [key]: { ...(prev[key] ?? {}), model: modelId, reasoningEffort: noReasoningKind(key) ? '' : defaultReasoning(m?.supportedReasoning) } }))
  }
  const offeredLevels = (key: string): Array<[string, string]> => {
    const v = assign?.[key]
    if (v === undefined) return REASONING_LEVELS
    const m = providerModels(v.provider).find((x) => x.id === v.model)
    const sup = m?.supportedReasoning
    if (Array.isArray(sup) && sup.length > 0) return REASONING_LEVELS.filter(([level]) => sup.includes(level))
    return REASONING_LEVELS
  }
  const saveCard = (keys: string[]) => {
    if (saving !== null || assign === null) return
    const cardKey = keys.join('+')
    setSaving(cardKey)
    setError(null)
    setSaveMsg((s) => ({ ...s, [cardKey]: '' }))
    const patch: Record<string, unknown> = keys[0] === 'utility'
      ? { code: {
          utility: { provider: assign.utility?.provider ?? '', model: assign.utility?.model ?? '', reasoningEffort: assign.utility?.reasoningEffort ?? '' },
          coder: { provider: assign.coder?.provider ?? '', model: assign.coder?.model ?? '', reasoningEffort: assign.coder?.reasoningEffort ?? '' },
          planner: { provider: assign.planner?.provider ?? '', model: assign.planner?.model ?? '', reasoningEffort: assign.planner?.reasoningEffort ?? '' },
          writer: { provider: assign.writer?.provider ?? '', model: assign.writer?.model ?? '', reasoningEffort: assign.writer?.reasoningEffort ?? '' },
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
        // 文本模型卡片：配置即默认——保存后自动把“当前角色”设为默认模型。
        // 以用户最近一次选择的角色为准（修改模型配置不改变角色归属）；
        // 尚未选过角色时才按 coder > planner > utility > writer 的优先级兜底。
        if (keys[0] === 'utility') {
          const stored = storedDefaultTier === 'utility' || storedDefaultTier === 'coder' || storedDefaultTier === 'planner' || storedDefaultTier === 'writer' ? storedDefaultTier : null
          const defaultTier = (stored !== null && assign[stored] !== undefined && assign[stored]?.provider !== '' && assign[stored]?.model !== ''
            ? stored
            : (['coder', 'planner', 'utility', 'writer'] as const).find((tier) => {
            const v = assign[tier]
            return v !== undefined && v.provider !== '' && v.model !== ''
          }))
          if (defaultTier !== undefined) {
            try {
              const applied = await fetch('/evoresearch/fs/model-settings-apply', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ tier: defaultTier }),
              }).then((r) => r.json())
              if (applied.ok !== true) throw new Error(applied.error?.message ?? '')
            } catch { /* 默认档位应用失败不阻塞分配保存 */ }
          }
        }
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
          const level = noReasoningKind(key) ? '' : (typeof v.reasoningEffort === 'string' ? v.reasoningEffort : '')
          // 无论是否设置推理强度，都要把所选模型写进 provider 配置，
          // 否则图片生成这类没有推理档位的模型保存后依然未注册、无法调用。
          const idx = list.findIndex((m) => m.id === v.model)
          const supported = providerModels(v.provider).find((m) => m.id === v.model)?.supportedReasoning ?? null
          const efforts = level !== '' ? applyModelReasoning(level, supported) : null
          if (idx >= 0) {
            if (level !== '') list[idx] = { ...list[idx], reasoningEfforts: efforts }
          } else {
            list.push({ id: v.model, name: v.model, contextWindow: null, reasoningEfforts: efforts })
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
        if (failures.length > 0) setError(t('assignSavedPartialFail').replace('{ids}', failures.join('、')))
        else {
          toast(t('assignSaved'), 'success')
          setSaveMsg((s) => ({ ...s, [cardKey]: t('assignSaved') }))
        }
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
    utility: { name: t('tierUtility'), desc: t('tierUtilityDesc') },
    coder: { name: t('tierCoder'), desc: t('tierCoderDesc') },
    planner: { name: t('tierPlanner'), desc: t('tierPlannerDesc') },
    writer: { name: t('tierWriter'), desc: t('tierWriterDesc') },
  }

  /** 连通性测试：对卡片内已选模型逐个发极短请求（相同 provider+model 只测一次）。 */
  const testCard = (keys: string[]) => {
    if (saving !== null || assign === null) return
    const cardKey = keys.join('+')
    setSaveMsg((s) => ({ ...s, [cardKey]: '' }))
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
            body: JSON.stringify({
              provider: v.provider,
              model: v.model,
              reasoningEffort: v.reasoningEffort ?? '',
              // 单类型卡片带上类型（image=图片生成），后端据此走 Images API 低成本测试
              ...(keys.length === 1 ? { kind: keys[0] } : {}),
            }),
          }).then((r) => r.json())
          const value = (json?.value ?? {}) as { ok?: boolean; latencyMs?: number; error?: string; imageGen?: boolean }
          const ok = json?.ok === true && value.ok === true
          detail = ok
            ? value.imageGen === true
              ? t('testImageGen').replace('{ms}', String(value.latencyMs ?? ''))
              : (value.latencyMs !== undefined ? `✓ ${value.latencyMs}ms` : '✓')
            : `✗ ${value.error ?? json?.error?.message ?? ''}`
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
        ? jsx('div', { className: 'evo-setting-hint', children: t('loading') })
        : providers.length === 0
          ? jsx('div', { className: 'evo-setting-hint', children: t('noLlmProviders') })
          : jsxs(Fragment, { children: [
              jsxs('div', { className: 'evo-tier-card evo-assign-card', children: [
                jsxs('div', { className: 'evo-assign-head', children: [
                  jsx(Code2, {}),
                  jsx('span', { className: 'evo-assign-head-title', children: t('settingsCodeModel') }),
                  jsx('span', { className: 'evo-assign-head-desc', children: t('codeModelHint') }),
                ] }),
                ['utility', 'coder', 'planner', 'writer'].map((tier) => jsxs('div', { className: 'evo-assign-tier', children: [
                  jsxs('div', { className: 'evo-assign-tier-head', children: [
                    jsx('span', { className: 'evo-assign-tier-name', children: tierMeta[tier].name }),
                    jsx('span', { className: 'evo-assign-tier-desc', children: tierMeta[tier].desc }),
                  ] }),
                  jsxs('div', { className: 'evo-assign-grid tier', children: [
                    renderSelect(tier, 'provider', providerOptions, (v) => changeProvider(tier, v)),
                    renderSelect(tier, 'model', providerModels(assign[tier].provider).map((m) => [m.id, m.name] as [string, string]), (v) => changeModel(tier, v)),
                    renderSelect(tier, 'reasoningEffort', offeredLevels(tier), (v) => setField(tier, 'reasoningEffort', v)),
                  ] }),
                  migrated[tier] !== undefined && jsx('div', { className: 'evo-assign-migrate', children: t('migratedProviderHint').replace('{old}', migrated[tier]).replace('{new}', providerLabel(assign[tier].provider)) }),
                ] }, tier)),
                jsxs('div', { className: 'evo-assign-actions', children: [
                  jsx('button', {
                    type: 'button',
                    className: 'evo-btn evo-btn-test',
                    disabled: saving !== null || testState['utility+coder+planner+writer']?.busy === true,
                    onClick: () => testCard(['utility', 'coder', 'planner', 'writer']),
                    children: jsxs(Fragment, { children: [jsx(Zap, {}), jsx('span', { children: testState['utility+coder+planner+writer']?.busy === true ? t('testModelBusy') : t('testModel') })] }),
                  }),
                  jsx('button', {
                    type: 'button',
                    className: 'evo-btn evo-btn-ok',
                    disabled: saving !== null,
                    onClick: () => saveCard(['utility', 'coder', 'planner', 'writer']),
                    children: jsxs(Fragment, { children: [jsx(Cpu, {}), jsx('span', { children: saving !== null ? t('saving') : t('save') })] }),
                  }),
                ] }),
                (() => {
                  const key = 'utility+coder+planner+writer'
                  const saved = saveMsg[key] ?? ''
                  const tst = testState[key]
                  if (saved !== '') return jsx('div', { className: 'evo-assign-test ok', children: saved })
                  if (tst !== undefined && tst.message !== '') return jsx('div', { className: `evo-assign-test ${tst.ok ? 'ok' : 'fail'}`, children: tst.message })
                  return null
                })(),
              ] }),
              (['vision', 'image'] as const).map((kind) => {
                const meta = kind === 'vision'
                  ? { icon: Eye, title: t('settingsVision'), hint: t('visionHint') }
                  : { icon: ImageIcon, title: t('settingsImage'), hint: t('imageHint') }
                const Icon = meta.icon
                const modelOptions = modelOptionsFor(kind, assign[kind].provider)
                const modelHasProfile = modelOptions.find((m) => m.id === assign[kind].model)?.supportedReasoning != null
                const modalityEmpty = (kindInputModality(kind) !== null || kindOutputModality(kind) !== null) && modelOptions.length === 0
                return jsxs('div', { className: 'evo-tier-card evo-assign-card', children: [
                  jsxs('div', { className: 'evo-assign-head', children: [
                    jsx(Icon, {}),
                    jsx('span', { className: 'evo-assign-head-title', children: meta.title }),
                    jsx('span', { className: 'evo-assign-head-desc', children: meta.hint }),
                  ] }),
                  jsxs('div', { className: noReasoningKind(kind) ? 'evo-assign-grid no-reasoning' : 'evo-assign-grid', children: [
                    renderSelect(kind, 'provider', providerOptions, (v) => changeProvider(kind, v)),
                    renderSelect(kind, 'model', modelOptions.map((m) => [m.id, m.name] as [string, string]), (v) => changeModel(kind, v)),
                    !noReasoningKind(kind) && renderSelect(kind, 'reasoningEffort', offeredLevels(kind), (v) => setField(kind, 'reasoningEffort', v)),
                  ] }),
                  modalityEmpty && jsx('div', { className: 'evo-assign-hint', children: kind === 'vision' ? t('noVisionModels') : t('noImageModels') }),
                  modelHasProfile === false && !modalityEmpty && !noReasoningKind(kind) && jsx('div', { className: 'evo-assign-hint', children: t('assignmentReasoningHint') }),
                  migrated[kind] !== undefined && jsx('div', { className: 'evo-assign-migrate', children: t('migratedProviderHint').replace('{old}', migrated[kind]).replace('{new}', providerLabel(assign[kind].provider)) }),
                  jsxs('div', { className: 'evo-assign-actions', children: [
                    jsx('button', {
                      type: 'button',
                      className: 'evo-btn evo-btn-test',
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
                  (() => {
                    const saved = saveMsg[kind] ?? ''
                    const tst = testState[kind]
                    if (saved !== '') return jsx('div', { className: 'evo-assign-test ok', children: saved })
                    if (tst !== undefined && tst.message !== '') return jsx('div', { className: `evo-assign-test ${tst.ok ? 'ok' : 'fail'}`, children: tst.message })
                    return null
                  })(),
                ] }, kind)
              }),
            ] }),
    ],
  })
}

type DataClearPathEffect = 'delete-directory' | 'delete-children' | 'reset-file' | 'browser-storage'

interface DataClearPathEntry {
  id: string
  path: string
  effect: DataClearPathEffect
}

interface DataClearPaths {
  projects: DataClearPathEntry[]
  models: DataClearPathEntry[]
  prefs: DataClearPathEntry[]
}

function isDataClearPaths(value: unknown): value is DataClearPaths {
  if (value === null || typeof value !== 'object') return false
  const raw = value as Record<string, unknown>
  return ['projects', 'models', 'prefs'].every((scope) => Array.isArray(raw[scope]) && (raw[scope] as unknown[]).every((entry) => {
    if (entry === null || typeof entry !== 'object') return false
    const item = entry as Record<string, unknown>
    return typeof item.id === 'string' && typeof item.path === 'string'
      && (item.effect === 'delete-directory' || item.effect === 'delete-children' || item.effect === 'reset-file' || item.effect === 'browser-storage')
  }))
}

function hostPath(base: string, ...parts: string[]): string {
  const separator = base.includes('\\') ? '\\' : '/'
  return [base.replace(/[\\/]+$/, ''), ...parts].join(separator)
}

/**
 * 兼容尚未重启的旧 DSH 进程：旧进程没有 data-clear-paths-get，
 * 但 data-paths-get 仍会返回当前进程实际使用的三个根目录。
 */
export function buildDataClearPathsFallback(paths: Pick<DataPathsSnapshot, 'dshHome' | 'evoResearchDataRoot' | 'pluginStateRoot'>): DataClearPaths {
  const dataRoot = paths.evoResearchDataRoot
  const pluginRoot = paths.pluginStateRoot || hostPath(dataRoot, 'plugins')
  const dshHome = paths.dshHome
  return {
    projects: [
      { id: 'project-directory', path: hostPath(dataRoot, 'projects', '<project-name>'), effect: 'delete-directory' },
      { id: 'session-directory', path: hostPath(dshHome, 'sessions', '<workspace>'), effect: 'delete-directory' },
      { id: 'memories-directory', path: hostPath(pluginRoot, 'memories'), effect: 'delete-directory' },
      { id: 'chat-graphs-directory', path: hostPath(pluginRoot, 'chat-graphs'), effect: 'delete-directory' },
      { id: 'scheduler-file', path: hostPath(pluginRoot, 'scheduler.json'), effect: 'reset-file' },
      { id: 'session-meta-file', path: hostPath(pluginRoot, 'session-meta.json'), effect: 'reset-file' },
    ],
    models: [
      { id: 'model-settings-file', path: hostPath(pluginRoot, 'model-settings.json'), effect: 'reset-file' },
      { id: 'dsh-settings-file', path: hostPath(dshHome, 'settings.yaml'), effect: 'reset-file' },
    ],
    prefs: [
      { id: 'client-state-file', path: hostPath(pluginRoot, 'client-state.json'), effect: 'reset-file' },
      { id: 'browser-local-storage', path: '当前网页的浏览器 localStorage（键名以 evoresearch- 开头）', effect: 'browser-storage' },
    ],
  }
}

function clearPathEffectLabel(effect: DataClearPathEffect): string {
  if (effect === 'delete-directory') return t('clearPathDeleteDirectory')
  if (effect === 'delete-children') return t('clearPathDeleteChildren')
  if (effect === 'browser-storage') return t('clearPathBrowserStorage')
  return t('clearPathResetFile')
}

function clearPathDetail(id: string): string {
  const key = `clearPath${id.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('')}`
  return t(key)
}

/** 清除数据（设置面板）：三类数据可多选，展示真实路径，二次确认后执行。 */
function DataClearSection() {
  const [checked, setChecked] = useState({ projects: false, models: false, prefs: false })
  const [clearPaths, setClearPaths] = useState<DataClearPaths | null>(null)
  const [pathsError, setPathsError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const anyChecked = checked.projects || checked.models || checked.prefs

  useEffect(() => {
    let cancelled = false
    void fetch('/evoresearch/fs/data-clear-paths-get', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }).then((res) => res.json()).then((json) => {
      if (json.ok === true && isDataClearPaths(json.value)) return json.value
      const message = typeof json.error?.message === 'string' ? json.error.message : ''
      if (!message.includes('unknown method data-clear-paths-get')) throw new Error(message || t('clearPathsLoadError'))
      // 新路由加入后，旧 DSH 进程可能仍在内存中运行；从同一进程的
      // data-paths-get 响应生成兼容清单，确保展示的路径仍然是事实路径。
      return fetch('/evoresearch/fs/data-paths-get', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }).then((res) => res.json()).then((pathJson) => {
        const raw = pathJson.value as Record<string, unknown> | undefined
        if (pathJson.ok !== true || raw === undefined || typeof raw.dshHome !== 'string' || typeof raw.evoResearchDataRoot !== 'string' || typeof raw.pluginStateRoot !== 'string') {
          throw new Error(t('clearPathsLoadError'))
        }
        return buildDataClearPathsFallback(raw as Pick<DataPathsSnapshot, 'dshHome' | 'evoResearchDataRoot' | 'pluginStateRoot'>)
      })
    }).then((paths) => {
      if (!cancelled) setClearPaths(paths)
    }).catch((reason: unknown) => {
      if (!cancelled) setPathsError(reason instanceof Error ? reason.message : t('clearPathsLoadError'))
    })
    return () => { cancelled = true }
  }, [])

  const rows: Array<{ key: 'projects' | 'models' | 'prefs'; title: string; desc: string }> = [
    { key: 'projects', title: t('clearProjects'), desc: t('clearProjectsDesc') },
    { key: 'models', title: t('clearModels'), desc: t('clearModelsDesc') },
    { key: 'prefs', title: t('clearPrefs'), desc: t('clearPrefsDesc') },
  ]

  const execute = () => {
    if (!anyChecked || clearPaths === null || busy) return
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
      // 本地偏好（主题/语言/布局/输入历史等）同时清除浏览器缓存与后端 client-state.json
      const keys: string[] = []
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i)
        if (key !== null && key.startsWith('evoresearch-')) keys.push(key)
      }
      for (const key of keys) localStorage.removeItem(key)
      clientStateClear()
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

  const renderPathEntry = (entry: DataClearPathEntry) => jsxs('div', {
    className: 'evo-clear-path-entry',
    children: [
      jsx('span', { className: 'evo-clear-path-effect', children: clearPathEffectLabel(entry.effect) }),
      jsx('code', { className: 'evo-clear-path-value', title: entry.path, children: entry.path }),
      jsx('span', { className: 'evo-clear-path-detail', children: clearPathDetail(entry.id) }),
    ],
  }, `${entry.id}:${entry.path}`)

  const renderPathList = (entries: DataClearPathEntry[], className = 'evo-clear-row-paths') => jsxs('div', {
    className,
    children: entries.map(renderPathEntry),
  })

  return jsxs('div', {
    className: 'evo-setting',
    children: [
      jsxs('div', {
        className: 'evo-setting-label',
        children: [jsx(Trash2, {}), jsx('span', { children: t('settingsData') })],
      }),
      jsx('div', { className: 'evo-setting-hint', children: t('clearDataHint') }),
      pathsError !== null && jsx('div', { className: 'evo-panel-error evo-clear-path-error', children: `${t('clearPathsLoadError')} ${pathsError}` }),
      clearPaths === null && pathsError === null && jsx('div', { className: 'evo-clear-path-loading', children: t('clearPathsLoading') }),
      jsx('div', { className: 'evo-clear-rows', children: rows.map((row) => jsxs('label', {
        className: `evo-clear-row${checked[row.key] ? ' checked' : ''}`,
        children: [
          jsx('input', {
            type: 'checkbox',
            checked: checked[row.key],
            disabled: clearPaths === null || busy,
            onChange: (e: { currentTarget: HTMLInputElement }) => {
              const next = e.currentTarget.checked
              setChecked((prev) => ({ ...prev, [row.key]: next }))
              setConfirming(false)
            },
          }),
          jsxs('span', { className: 'evo-clear-row-text', children: [
            jsx('span', { className: 'evo-clear-row-title', children: row.title }),
            jsx('span', { className: 'evo-clear-row-desc', children: row.desc }),
            clearPaths !== null && renderPathList(clearPaths[row.key]),
          ] }),
        ],
      }, row.key)) }),
      anyChecked && clearPaths !== null && jsxs('div', { className: 'evo-clear-summary', children: [
        jsx('div', { className: 'evo-clear-summary-title', children: t('clearPathsSummary') }),
        rows.filter((row) => checked[row.key]).map((row) => jsxs('div', {
          className: 'evo-clear-summary-group',
          children: [
            jsx('div', { className: 'evo-clear-summary-label', children: row.title }),
            renderPathList(clearPaths[row.key], 'evo-clear-summary-paths'),
          ],
        }, row.key)),
      ] }),
      !anyChecked && clearPaths !== null && jsx('div', { className: 'evo-clear-summary evo-clear-summary-empty', children: t('clearPathsNone') }),
      jsxs('div', { className: 'evo-clear-confirm', children: [
        confirming && jsx('div', { className: 'evo-panel-error', children: t('clearDataWarning') }),
        error !== null && jsx('div', { className: 'evo-panel-error', children: error }),
        jsx('button', {
          type: 'button',
          className: `evo-btn evo-btn-danger${confirming ? ' confirming' : ''}`,
          disabled: !anyChecked || clearPaths === null || busy,
          onClick: execute,
          children: jsxs(Fragment, { children: [jsx(Trash2, {}), jsx('span', { children: busy ? t('clearDataBusy') : confirming ? t('clearDataConfirm') : t('clearDataBtn') })] }),
        }),
      ] }),
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

/** 模型提供商配置变化后，通知同一设置面板内的模型分配组件重新读取目录。 */
const PROVIDERS_CHANGED_EVENT = 'evoresearch:providers-changed'

function notifyProvidersChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(PROVIDERS_CHANGED_EVENT))
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
        } else setError(providersJson.error?.message ?? t('loadFailed'))
      })
      .catch((e: unknown) => setError((e as Error)?.message ?? t('loadFailed')))
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
        notifyProvidersChanged()
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
        notifyProvidersChanged()
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
      }).then((r) => r.json()).catch(() => ({ ok: false, error: { message: t('networkFailed') } }))
      const listed: Array<{ id?: string; name?: string }> = probe.ok === true ? (probe.value?.models ?? []) : []
      if (probe.ok !== true) {
        setError(probe.error?.message ?? t('llmProbeFailed'))
        return
      } else if (listed.length === 0) {
        setProbeWarning(t('llmProbeEmpty'))
      }
      const resolvedBaseURL = typeof probe.value?.baseURL === 'string' && probe.value.baseURL !== ''
        ? probe.value.baseURL
        : baseURL
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
            baseURL: resolvedBaseURL,
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
      notifyProvidersChanged()
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
        notifyProvidersChanged()
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
      setError(t('providerIdChars'))
      return
    }
    if (newId !== '' && newId !== id && (providers ?? []).some((p) => p.id === newId)) {
      setError(t('providerIdExists').replace('{id}', newId))
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
        notifyProvidersChanged()
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
                  jsx(ModelField, { className: 'evo-llm-url', label: t('apiUrlLabel'), value: draft.baseURL, placeholder: 'http://127.0.0.1:3000/v1', onChange: (v) => setDraft((d) => ({ ...d, baseURL: v })) }),
                  jsxs('label', {
                    className: 'evo-setting-field evo-llm-key',
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
                    className: 'evo-setting-field evo-llm-proto',
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
                  jsx(ModelField, { className: 'evo-llm-name', label: t('llmProviderName'), value: draft.displayName, placeholder: t('llmProviderNamePlaceholder'), onChange: (v) => setDraft((d) => ({ ...d, displayName: v })) }),
                  jsxs('label', {
                    className: 'evo-setting-field evo-llm-id',
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
            ? jsx('div', { className: 'evo-setting-hint', children: t('loading') })
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
                    jsx(ModelField, { className: 'evo-llm-url', label: t('apiUrlLabel'), value: provider.baseURL, onChange: (v) => updateProvider(provider.id, { baseURL: v }) }),
                    jsxs('label', {
                      className: 'evo-setting-field evo-llm-key',
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
                    jsx(ModelField, { className: 'evo-llm-name', label: t('llmProviderName'), value: provider.displayName, onChange: (v) => updateProvider(provider.id, { displayName: v }) }),
                    jsxs('label', {
                      className: 'evo-setting-field evo-llm-id',
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
              className: 'evo-btn evo-btn-test',
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

export function SettingsDialog({ onClose }: SettingsDialogProps) {
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
                      jsx(DataPathsSection, {}),
                      jsx(WebSearchSection, {}),
                      jsx(AcademicSearchSection, {}),
                      jsx(GraphLayoutSection, {}),
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
