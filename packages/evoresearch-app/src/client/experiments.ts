/**
 * 实验管理面板（§5.1 Git 式分支/回退/checkpoint；§7 自由形式实验管理）。
 *
 * 左侧栏「实验」入口进入。顶部 Tab 切换两个体验：
 * - Tab 1「实验工作区」（EXP-UI）：自由目录 + LAB_NOTE.md + 运行/日志/复盘/产物
 *   （见 client/experiment-workspace.ts 的 ExperimentWorkspacePanel）；
 * - Tab 2「旧时间线」：manifest 分支/阶段/检查点（LegacyExperimentsPanel）。
 *
 * 旧时间线数据经 /evoresearch/fs/experiments-* HTTP API（host 侧
 * ExperimentService）。展示：实验列表 → 详情（分支 chips + 阶段时间线 +
 * 检查点操作：回退（需 confirm）/ 分支 / 跳转会话）。
 */
import { jsx, jsxs, Fragment } from 'react/jsx-runtime'
import { useEffect, useState } from 'react'
import { t } from './i18n'
import { FlaskConical, Plus, Trash2, RefreshCw, GitBranch, RotateCcw, Camera, Check, X as XIcon, MessageSquare, ChevronRight, ChevronDown, FolderKanban, NotepadText } from 'lucide-react'
import { ExperimentWorkspacePanel } from './experiment-workspace'

interface CheckpointRow {
  id: string
  name: string
  note: string
  createdAt: number
  phaseId: string
  snapshotDir: string
  files: number
  bytes: number
  sessionId?: string
  rolledBack?: boolean
}
interface PhaseRow {
  id: string
  name: string
  description: string
  createdAt: number
  checkpoints: CheckpointRow[]
}
interface BranchRow {
  id: string
  name: string
  fromCheckpointId?: string
  createdAt: number
  phases: PhaseRow[]
}
interface ExperimentRow {
  id: string
  name: string
  description: string
  workspaceDir: string
  createdAt: number
  updatedAt: number
  branches: BranchRow[]
  currentBranchId: string
  sessionIds: string[]
}
interface ExperimentSummaryRow {
  id: string
  name: string
  description: string
  createdAt: number
  updatedAt: number
  branchCount: number
  phaseCount: number
  checkpointCount: number
  currentBranchId: string
}

/** 简单 POST JSON 封装（与 panels.ts 同款）。 */
async function api<T>(method: string, body: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`/evoresearch/fs/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await res.json()
  if (!json.ok) throw new Error(json.error?.message ?? '请求失败')
  return json.value as T
}

function fmtTime(ts: number): string {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** 内联输入行（名称 + 确认/取消）。 */
function InlineInput({ placeholder, onConfirm, onCancel, busy }: {
  placeholder: string
  onConfirm: (value: string) => void
  onCancel: () => void
  busy?: boolean
}) {
  const [value, setValue] = useState('')
  return jsxs('div', {
    className: 'evo-exp-inline',
    children: [
      jsx('input', {
        type: 'text',
        className: 'evo-panel-input',
        placeholder,
        value,
        autoFocus: true,
        disabled: busy,
        onInput: (e) => setValue(e.currentTarget.value),
        onKeyDown: (e) => { if (e.key === 'Enter') onConfirm(value); if (e.key === 'Escape') onCancel() },
      }),
      jsx('button', {
        type: 'button',
        className: 'evo-exp-inline-ok',
        disabled: busy || value.trim() === '',
        onClick: () => onConfirm(value),
        children: jsx(Check, {}),
      }),
      jsx('button', {
        type: 'button',
        className: 'evo-exp-inline-cancel',
        disabled: busy,
        onClick: onCancel,
        children: jsx(XIcon, {}),
      }),
    ],
  })
}

/** 实验详情（分支 + 阶段时间线 + 检查点操作）。 */
function ExperimentDetail({ row, workspaceDir, sessionId, onOpenSession, onReload, onError }: {
  row: ExperimentSummaryRow
  workspaceDir: string
  sessionId: string | null
  onOpenSession: (id: string) => void
  onReload: () => void
  onError: (message: string) => void
}) {
  const [detail, setDetail] = useState<ExperimentRow | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [addingPhase, setAddingPhase] = useState(false)
  const [checkpointFor, setCheckpointFor] = useState<string | null>(null)
  const [cpName, setCpName] = useState('')
  const [cpNote, setCpNote] = useState('')
  const [branchFrom, setBranchFrom] = useState<string | null>(null)
  const [branchName, setBranchName] = useState('')
  const [confirmRollback, setConfirmRollback] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const [expandedPhases, setExpandedPhases] = useState<Set<string>>(new Set())

  const load = () => {
    setDetail(null)
    void api<ExperimentRow>('experiments-get', { workspaceDir, id: row.id })
      .then((d) => { setDetail(d); setExpandedPhases(new Set(d.branches.find((b) => b.id === d.currentBranchId)?.phases.map((p) => p.id) ?? [])) })
      .catch((e: any) => onError(String(e?.message ?? e)))
  }
  useEffect(() => { load() }, [row.id])

  const withBusy = async (fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
      load()
      onReload()
    } catch (e: any) {
      onError(String(e?.message ?? e))
    }
    setBusy(false)
  }

  const doAddPhase = (name: string) => {
    setAddingPhase(false)
    void withBusy(async () => {
      await api('experiments-phase', { workspaceDir, id: row.id, name })
    })
  }
  const doCheckpoint = (phaseId: string, name: string) => {
    setCheckpointFor(null); setCpName(''); setCpNote('')
    void withBusy(async () => {
      await api('experiments-checkpoint', { workspaceDir, id: row.id, name, note: cpNote, phaseId, ...(sessionId === null ? {} : { sessionId }) })
    })
  }
  const doRollback = (checkpointId: string) => {
    setConfirmRollback(null)
    void withBusy(async () => {
      const result = await api<{ restored: number }>('experiments-rollback', { workspaceDir, id: row.id, checkpointId, confirm: true })
      setNotice(`${t('rollbackDone')}：${result.restored} ${t('filesRestored')}`)
      setTimeout(() => setNotice(null), 5000)
    })
  }
  const doBranch = (fromCheckpointId: string, name: string) => {
    setBranchFrom(null); setBranchName('')
    void withBusy(async () => {
      await api('experiments-branch', { workspaceDir, id: row.id, fromCheckpointId, name })
    })
  }
  const doSwitchBranch = (branchId: string) => {
    void withBusy(async () => {
      await api('experiments-switch', { workspaceDir, id: row.id, branchId })
    })
  }
  const doDelete = () => {
    setConfirmDelete(false)
    setBusy(true)
    void api('experiments-delete', { workspaceDir, id: row.id })
      .then(() => onReload())
      .catch((e: any) => onError(String(e?.message ?? e)))
      .finally(() => setBusy(false))
  }

  if (detail === null) {
    return jsxs('div', {
      children: [
        notice !== null && jsx('div', { className: 'evo-exp-notice', children: notice }),
        jsx('div', { className: 'evo-panel-hint', children: t('loading') }),
      ],
    })
  }

  const currentBranch = detail.branches.find((b) => b.id === detail.currentBranchId) ?? detail.branches[0]
  const togglePhase = (phaseId: string) => {
    setExpandedPhases((prev) => {
      const next = new Set(prev)
      if (next.has(phaseId)) next.delete(phaseId)
      else next.add(phaseId)
      return next
    })
  }

  return jsxs('div', {
    className: 'evo-exp-detail',
    children: [
      notice !== null && jsx('div', { className: 'evo-exp-notice', children: notice }),
      // 实验头部：名称 + 描述 + 删除
      jsxs('div', {
        className: 'evo-exp-head',
        children: [
          jsx('span', { className: 'evo-exp-title', children: detail.name }),
          detail.description !== '' && jsx('span', { className: 'evo-exp-desc', children: detail.description }),
          jsx('span', { style: { flex: 1 } }),
          confirmDelete
            ? jsx('button', { type: 'button', className: 'evo-tl-del-confirm evo-exp-del', disabled: busy, onClick: doDelete, children: t('deleteQ') })
            : jsx('button', {
                type: 'button',
                className: 'evo-tl-del',
                title: t('deleteExperiment'),
                'aria-label': t('deleteExperiment'),
                disabled: busy,
                onClick: () => { setConfirmDelete(true); setTimeout(() => setConfirmDelete(false), 5000) },
                children: jsx(Trash2, {}),
              }),
        ],
      }),
      // 分支 chips（切换当前分支）
      jsxs('div', {
        className: 'evo-exp-branches',
        children: [
          jsx('span', { className: 'evo-exp-branch-label', children: t('branches') }),
          detail.branches.map((branch) => jsxs('button', {
            type: 'button',
            className: 'evo-exp-branch-chip',
            'data-active': branch.id === detail.currentBranchId || undefined,
            disabled: busy,
            title: branch.fromCheckpointId === undefined ? undefined : `${t('fromCheckpoint')} ${branch.fromCheckpointId}`,
            onClick: () => { if (branch.id !== detail.currentBranchId) doSwitchBranch(branch.id) },
            children: [
              jsx(GitBranch, {}),
              jsx('span', { children: branch.name }),
            ],
          }, branch.id)),
        ],
      }),
      // 阶段时间线（当前分支）
      jsx('div', {
        className: 'evo-exp-phases',
        children: [
          jsxs('div', {
            className: 'evo-exp-phases-head',
            children: [
              jsx('span', { children: t('phases') }),
              jsx('span', { style: { flex: 1 } }),
              addingPhase
                ? jsx(InlineInput, {
                    placeholder: t('phaseName'),
                    confirmLabel: t('create'),
                    busy,
                    onConfirm: doAddPhase,
                    onCancel: () => setAddingPhase(false),
                  })
                : jsx('button', {
                    type: 'button',
                    className: 'evo-panel-add',
                    disabled: busy,
                    onClick: () => setAddingPhase(true),
                    children: jsxs(Fragment, { children: [jsx(Plus, {}), jsx('span', { children: t('newPhase') })] }),
                  }),
            ],
          }),
          currentBranch.phases.length === 0 && jsx('div', { className: 'evo-panel-hint', children: t('noPhasesYet') }),
          currentBranch.phases.map((phase) => jsxs('div', {
            className: 'evo-exp-phase',
            children: [
              jsxs('button', {
                type: 'button',
                className: 'evo-exp-phase-head',
                onClick: () => togglePhase(phase.id),
                children: [
                  expandedPhases.has(phase.id) ? jsx(ChevronDown, {}) : jsx(ChevronRight, {}),
                  jsx('span', { className: 'evo-exp-phase-name', children: phase.name }),
                  jsx('span', { className: 'evo-exp-phase-meta', children: `${phase.checkpoints.length} ${t('checkpoints')} · ${fmtTime(phase.createdAt)}` }),
                ],
              }),
              expandedPhases.has(phase.id) && jsxs('div', {
                className: 'evo-exp-phase-body',
                children: [
                  phase.checkpoints.length === 0 && jsx('div', { className: 'evo-panel-hint', children: t('noCheckpointsYet') }),
                  phase.checkpoints.map((cp) => jsxs('div', {
                    className: 'evo-exp-cp',
                    'data-rolled': cp.rolledBack === true || undefined,
                    children: [
                      jsxs('div', {
                        className: 'evo-exp-cp-main',
                        children: [
                          jsx(Camera, {}),
                          jsxs('div', {
                            className: 'evo-exp-cp-info',
                            children: [
                              jsxs('div', {
                                className: 'evo-exp-cp-title',
                                children: [
                                  jsx('span', { children: cp.name }),
                                  cp.rolledBack === true && jsx('span', { className: 'evo-exp-cp-rolled', children: t('rolledBack') }),
                                ],
                              }),
                              jsx('div', { className: 'evo-exp-cp-sub', children: `${fmtTime(cp.createdAt)} · ${cp.files} ${t('files')} · ${fmtBytes(cp.bytes)}` }),
                              cp.note !== '' && jsx('div', { className: 'evo-exp-cp-note', children: cp.note }),
                            ],
                          }),
                        ],
                      }),
                      jsxs('div', {
                        className: 'evo-exp-cp-acts',
                        children: [
                          cp.sessionId !== undefined && jsx('button', {
                            type: 'button',
                            className: 'evo-tl-row-act',
                            title: t('openSession'),
                            'aria-label': t('openSession'),
                            onClick: () => onOpenSession(cp.sessionId as string),
                            children: jsx(MessageSquare, {}),
                          }),
                          confirmRollback === cp.id
                            ? jsx('button', {
                                type: 'button',
                                className: 'evo-tl-del-confirm',
                                disabled: busy,
                                onClick: () => doRollback(cp.id),
                                children: t('confirmQ'),
                              })
                            : jsx('button', {
                                type: 'button',
                                className: 'evo-tl-row-act',
                                title: t('rollbackTo'),
                                'aria-label': t('rollbackTo'),
                                disabled: busy,
                                onClick: () => { setConfirmRollback(cp.id); setTimeout(() => setConfirmRollback((v) => (v === cp.id ? null : v)), 5000) },
                                children: jsx(RotateCcw, {}),
                              }),
                          branchFrom === cp.id
                            ? jsx('div', { className: 'evo-exp-branch-from', children: jsx(InlineInput, {
                                placeholder: t('branchName'),
                                confirmLabel: t('create'),
                                busy,
                                onConfirm: (name) => doBranch(cp.id, name),
                                onCancel: () => setBranchFrom(null),
                              }) })
                            : jsx('button', {
                                type: 'button',
                                className: 'evo-tl-row-act',
                                title: t('branchFrom'),
                                'aria-label': t('branchFrom'),
                                disabled: busy,
                                onClick: () => setBranchFrom(cp.id),
                                children: jsx(GitBranch, {}),
                              }),
                        ],
                      }),
                    ],
                  }, cp.id)),
                  jsx('button', {
                    type: 'button',
                    className: 'evo-panel-add',
                    disabled: busy,
                    onClick: () => { setCheckpointFor(phase.id); setCpName(''); setCpNote('') },
                    children: jsxs(Fragment, { children: [jsx(Camera, {}), jsx('span', { children: t('createCheckpoint') })] }),
                  }),
                  checkpointFor === phase.id && jsxs('div', {
                    className: 'evo-exp-cp-form',
                    children: [
                      jsx('input', {
                        type: 'text',
                        className: 'evo-panel-input',
                        placeholder: t('checkpointName'),
                        value: cpName,
                        disabled: busy,
                        onInput: (e) => setCpName(e.currentTarget.value),
                      }),
                      jsx('input', {
                        type: 'text',
                        className: 'evo-panel-input',
                        placeholder: t('checkpointNote'),
                        value: cpNote,
                        disabled: busy,
                        onInput: (e) => setCpNote(e.currentTarget.value),
                      }),
                      jsx('button', {
                        type: 'button',
                        className: 'evo-exp-inline-ok',
                        disabled: busy || cpName.trim() === '',
                        onClick: () => doCheckpoint(phase.id, cpName),
                        children: jsx(Check, {}),
                      }),
                      jsx('button', {
                        type: 'button',
                        className: 'evo-exp-inline-cancel',
                        disabled: busy,
                        onClick: () => setCheckpointFor(null),
                        children: jsx(XIcon, {}),
                      }),
                    ],
                  }),
                ],
              }),
            ],
          }, phase.id)),
        ],
      }),
    ],
  })
}

/** 旧时间线面板：列表 + 新建 + 详情（manifest 分支/阶段/检查点）。 */
function LegacyExperimentsPanel({ cwd, sessionId, onOpenSession }: {
  cwd: string | null
  sessionId: string | null
  onOpenSession: (id: string) => void
}) {
  const [list, setList] = useState<ExperimentSummaryRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const workspaceDir = cwd ?? ''

  const load = (fresh = false) => {
    // 刷新（fresh=false）保留旧列表，避免详情/提示随加载态卸载
    if (fresh) setList(null)
    setError(null)
    void api<ExperimentSummaryRow[]>('experiments-list', { workspaceDir })
      .then(setList)
      .catch((e: any) => setError(String(e?.message ?? e)))
  }
  useEffect(() => { load(true) }, [cwd])

  const workspaceUnbound = error !== null && error.includes('超出部署根目录')

  const doCreate = () => {
    if (newName.trim() === '') return
    setCreating(true)
    setError(null)
    void api<ExperimentRow>('experiments-create', { workspaceDir, name: newName.trim(), description: newDesc.trim() })
      .then((created) => {
        setNewName(''); setNewDesc(''); setCreating(false)
        setExpandedId(created.id)
        load()
      })
      .catch((e: any) => { setCreating(false); setError(String(e?.message ?? e)) })
  }

  return jsxs('div', {
    className: 'evo-panel',
    children: [
      jsxs('div', {
        className: 'evo-panel-head',
        children: [jsx(FlaskConical, {}), jsx('span', { children: t('experiments') })],
      }),
      jsx('div', { className: 'evo-panel-body', children: [
        workspaceUnbound && jsx('div', { className: 'evo-panel-hint', children: t('experimentNoWorkspace') }),
        error !== null && !workspaceUnbound && jsx('div', { className: 'evo-panel-error', children: error }),
        // 新建实验
        jsxs('div', {
          className: 'evo-panel-form',
          children: [
            jsx('input', {
              type: 'text',
              className: 'evo-panel-input',
              placeholder: t('experimentName'),
              value: newName,
              disabled: creating,
              onInput: (e) => setNewName(e.currentTarget.value),
            }),
            jsx('input', {
              type: 'text',
              className: 'evo-panel-input',
              placeholder: t('experimentDesc'),
              value: newDesc,
              disabled: creating,
              onInput: (e) => setNewDesc(e.currentTarget.value),
            }),
            jsx('button', {
              type: 'button',
              className: 'evo-panel-add',
              disabled: creating || newName.trim() === '',
              onClick: doCreate,
              children: jsxs(Fragment, { children: [jsx(Plus, {}), jsx('span', { children: creating ? t('creating') : t('newExperiment') })] }),
            }),
          ],
        }),
        // 实验列表
        jsxs('div', {
          className: 'evo-panel-row',
          children: [
            jsx('span', { className: 'evo-panel-row-label', children: t('experiments') }),
            jsx('span', { style: { flex: 1 } }),
            jsx('button', { type: 'button', className: 'evo-icon-btn', title: t('refresh'), onClick: load, children: jsx(RefreshCw, {}) }),
          ],
        }),
        list === null
          ? jsx('div', { className: 'evo-panel-hint', children: t('loading') })
          : list.length === 0
            ? jsx('div', { className: 'evo-panel-hint', children: t('noExperimentsYet') })
            : jsx('div', {
                className: 'evo-panel-list',
                children: list.map((row) => jsxs('div', {
                  className: 'evo-exp-item',
                  'data-active': expandedId === row.id || undefined,
                  children: [
                    jsxs('button', {
                      type: 'button',
                      className: 'evo-exp-item-head',
                      onClick: () => setExpandedId((v) => (v === row.id ? null : row.id)),
                      children: [
                        jsx(FlaskConical, {}),
                        jsxs('div', {
                          className: 'evo-exp-item-info',
                          children: [
                            jsx('span', { className: 'evo-exp-item-name', children: row.name }),
                            jsx('div', { className: 'evo-exp-item-sub', children: `${row.phaseCount} ${t('phases')} · ${row.checkpointCount} ${t('checkpoints')} · ${row.branchCount} ${t('branches')}` }),
                          ],
                        }),
                      ],
                    }),
                    expandedId === row.id && jsx(ExperimentDetail, {
                      row,
                      workspaceDir,
                      sessionId,
                      onOpenSession,
                      onReload: load,
                      onError: (message) => setError(message),
                    }),
                  ],
                }, row.id)),
              }),
      ] }),
    ],
  })
}

/**
 * 实验入口面板（Tab 切换，EXP-UI 改动最小方案）：
 * - Tab 1「实验工作区」：新体验（ExperimentWorkspacePanel，§7 自由目录+笔记+运行）；
 * - Tab 2「旧时间线」：原 ExperimentsPanel 完整保留（manifest/分支/阶段/检查点，
 *   rollback 已接 confirm）。
 * 保持导出名 ExperimentsPanel，index.ts 的注册与传参（cwd/sessionId/onOpenSession）
 * 无需改动。
 */
export function ExperimentsPanel(props: {
  cwd: string | null
  sessionId: string | null
  onOpenSession: (id: string) => void
}) {
  const [tab, setTab] = useState<'workspace' | 'legacy'>('workspace')
  return jsxs('div', {
    className: 'evo-panel',
    children: [
      jsxs('div', {
        className: 'evo-ews-tabs',
        children: [
          jsx('button', {
            type: 'button',
            className: 'evo-ews-tab',
            'data-active': tab === 'workspace' || undefined,
            onClick: () => setTab('workspace'),
            children: jsxs(Fragment, { children: [jsx(NotepadText, {}), jsx('span', { children: t('expWsTab') })] }),
          }),
          jsx('button', {
            type: 'button',
            className: 'evo-ews-tab',
            'data-active': tab === 'legacy' || undefined,
            onClick: () => setTab('legacy'),
            children: jsxs(Fragment, { children: [jsx(FolderKanban, {}), jsx('span', { children: t('expWsLegacyTab') })] }),
          }),
        ],
      }),
      tab === 'workspace'
        ? jsx(ExperimentWorkspacePanel, props)
        : jsx(LegacyExperimentsPanel, props),
    ],
  })
}
