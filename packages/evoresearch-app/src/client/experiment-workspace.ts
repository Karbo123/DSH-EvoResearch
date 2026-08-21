/**
 * 实验工作区面板（§7 自由形式实验管理；EXP-UI）。
 *
 * 与旧 ExperimentsPanel（manifest 分支/阶段/检查点时间线）并存：
 * 由 client/experiments.ts 顶部 Tab 切换——Tab 1 本面板（实验工作区：
 * 自由目录 + LAB_NOTE.md + 运行/日志/复盘/产物），Tab 2 旧时间线。
 *
 * 数据经 /evoresearch/fs/experiment-workspace-* / experiment-run-* /
 * experiment-log-* / experiment-recover / experiment-retrospective-draft /
 * experiment-workspace-append-note / -artifacts 等 HTTP API（workspace-api.ts
 * kebab → camel 路由到 host 侧 ExperimentWorkspaceService / ExperimentProcessService）。
 *
 * 面板功能（对应 t6/t12 服务）：
 * - 列表 + 新建（project=当前工作区）+ 导入（reference 优先，copy 可选勾选）；
 * - 详情：LAB_NOTE.md 查看/编辑（append 选项）、目录树、产物树；
 * - 运行管理：启动（command/cwd/pythonPath/env JSON）、状态轮询（2.5s 定时刷新）、
 *   日志 offset 分页 + 自动追加、停止（两段确认）；
 * - 复盘草稿：生成（可选保存 .draft 文件）。
 */
import { jsx, jsxs, Fragment } from 'react/jsx-runtime'
import { useEffect, useRef, useState } from 'react'
import { t } from './i18n'
import { FlaskConical, Plus, Download, RefreshCw, FileText, FolderTree, Play, Square, Terminal, FileClock, Folder, File, ChevronDown, Check, X as XIcon, Pencil } from 'lucide-react'
import { RoundsPanel } from './rounds-panel'
import { DailyReportCard } from './daily-report-card'

// ── wire 类型（与 host 服务返回一致）────────────────────────────────────────

interface ExperimentWorkspaceSource {
  sourcePath: string
  mode: 'reference' | 'copy'
  importedAt: number
}
interface ExperimentWorkspaceInfo {
  slug: string
  dir: string
  createdAt: number
  updatedAt: number
  hasNote: boolean
  noteBytes: number
  source: ExperimentWorkspaceSource | null
}
interface ExperimentWorkspaceEntry {
  name: string
  relPath: string
  type: 'dir' | 'file' | 'symlink'
  size: number
  children?: ExperimentWorkspaceEntry[]
}
interface ExperimentWorkspaceTree {
  root: string
  sourcePath: string | null
  missingSource: boolean
  entries: ExperimentWorkspaceEntry[]
  dirs: number
  files: number
  totalBytes: number
  truncated: boolean
}
type RunStatus = 'running' | 'success' | 'failed' | 'user-stopped' | 'unknown'
interface RunRecord {
  runId: string
  command: string
  argv: string[]
  cwd: string
  pythonPath: string | null
  gitCommit: string | null
  startedAt: number
  pid: number | null
  status: RunStatus
  exitCode: number | null
  exitSignal: string | null
  error: string | null
  stopRequested: boolean
  stoppedBy: 'user' | null
  endedAt: number | null
  stdoutLog: string
  stderrLog: string
  recoveredAt: number | null
  recoveredNote: string | null
}
interface RunStatusResult {
  runs: RunRecord[]
  running: RunRecord | null
  latest: RunRecord | null
}
interface LogSlice {
  text: string
  nextOffset: number
  eof: boolean
  size: number
}

/** 简单 POST JSON 封装（与 experiments.ts / panels.ts 同款；兼容 { error } 载荷）。 */
async function api<T>(method: string, body: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`/evoresearch/fs/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await res.json() as { ok: boolean; value?: unknown; error?: { message?: string } }
  if (!json.ok) throw new Error(json.error?.message ?? t('requestFailed'))
  const v = json.value as T & { error?: string; ok?: boolean }
  if (v !== null && typeof v === 'object' && 'error' in (v as Record<string, unknown>) && typeof (v as { error?: unknown }).error === 'string') {
    if (!('ok' in (v as Record<string, unknown>))) throw new Error((v as { error: string }).error)
  }
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

const STATUS_TEXT: Record<RunStatus, string> = {
  running: 'expWsRunning',
  success: 'expWsSuccess',
  failed: 'expWsFailed',
  'user-stopped': 'expWsUserStopped',
  unknown: 'expWsUnknown',
}

// ── 目录树（experimentWorkspaceTree / artifacts 共用）───────────────────────

function TreeView({ entries, depth }: { entries: ExperimentWorkspaceEntry[]; depth?: number }) {
  const indent = depth ?? 0
  return jsx(Fragment, {
    children: entries.map((entry) => jsxs('div', {
      className: 'evo-ews-tree-row',
      'data-dir': entry.type === 'dir' || undefined,
      style: { paddingLeft: `${8 + indent * 14}px` },
      title: entry.relPath,
      children: [
        entry.type === 'dir' ? jsx(Folder, {}) : jsx(File, {}),
        jsx('span', { className: 'evo-ews-tree-name', children: entry.name }),
        entry.type === 'file' && jsx('span', { className: 'evo-ews-tree-size', children: fmtBytes(entry.size) }),
      ],
    }, `${entry.relPath}-${indent}`)),
  })
}

function TreeBlock({ entries, truncated }: { entries: ExperimentWorkspaceEntry[]; truncated?: boolean }) {
  return jsxs('div', {
    className: 'evo-ews-tree',
    children: [
      entries.length === 0 && jsx('div', { className: 'evo-panel-hint', children: t('expWsEmptyTree') }),
      entries.map((entry) => jsxs('div', {
        children: [
          jsxs('div', {
            className: 'evo-ews-tree-row',
            'data-dir': entry.type === 'dir' || undefined,
            children: [
              entry.type === 'dir' ? jsx(Folder, {}) : jsx(File, {}),
              jsx('span', { className: 'evo-ews-tree-name', children: entry.name }),
              entry.type === 'file' && jsx('span', { className: 'evo-ews-tree-size', children: fmtBytes(entry.size) }),
            ],
          }),
          entry.children !== undefined && entry.children.length > 0 && jsx('div', {
            className: 'evo-ews-tree-children',
            children: jsx(TreeView, { entries: entry.children, depth: 1 }),
          }),
        ],
      }, entry.relPath)),
      truncated === true && jsx('div', { className: 'evo-panel-hint', children: t('expWsTruncated') }),
    ],
  })
}

// ── 运行区（启动 / 状态 / 日志 / 停止）──────────────────────────────────────

function RunSection({ workspaceDir, slug, onError, onNotice }: {
  workspaceDir: string
  slug: string
  onError: (message: string) => void
  onNotice: (message: string) => void
}) {
  const [command, setCommand] = useState('')
  const [cwd, setCwd] = useState('')
  const [pythonPath, setPythonPath] = useState('')
  const [envJson, setEnvJson] = useState('')
  const [starting, setStarting] = useState(false)
  const [status, setStatus] = useState<RunStatusResult | null>(null)
  const [confirmStop, setConfirmStop] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [logStream, setLogStream] = useState<'stdout' | 'stderr'>('stdout')
  const [logText, setLogText] = useState<{ stdout: string; stderr: string }>({ stdout: '', stderr: '' })
  const [logLoaded, setLogLoaded] = useState<{ stdout: boolean; stderr: boolean }>({ stdout: false, stderr: false })
  const [autoRefresh, setAutoRefresh] = useState(true)
  const autoRefreshRef = useRef(true)
  const offsetRef = useRef<{ stdout: number; stderr: number }>({ stdout: 0, stderr: 0 })
  const busyRef = useRef<{ stdout: boolean; stderr: boolean }>({ stdout: false, stderr: false })

  const refreshStatus = (silent = true) => {
    void api<RunStatusResult>('experiment-run-status', { workspaceDir, slug })
      .then(setStatus)
      .catch(() => { if (!silent) onError(t('expWsStatusFailed')) })
  }
  const refreshLogs = (stream: 'stdout' | 'stderr') => {
    if (busyRef.current[stream]) return
    busyRef.current[stream] = true
    const offset = offsetRef.current[stream]
    void api<LogSlice>('experiment-log-read', { workspaceDir, slug, stream, offset, limit: 8192 })
      .then((slice) => {
        offsetRef.current[stream] = slice.nextOffset
        setLogText((prev) => ({ ...prev, [stream]: prev[stream] + slice.text }))
        if (slice.text !== '') setLogLoaded((prev) => ({ ...prev, [stream]: true }))
      })
      .catch(() => { /* 轮询静默 */ })
      .finally(() => { busyRef.current[stream] = false })
  }

  // 初始加载 + 定时刷新（2.5s）：状态 + 日志追加（autoRefresh 经 ref 读取，避免闭包过期）
  useEffect(() => {
    refreshStatus(false)
    refreshLogs('stdout')
    refreshLogs('stderr')
    const id = setInterval(() => {
      refreshStatus(true)
      if (autoRefreshRef.current) {
        refreshLogs('stdout')
        refreshLogs('stderr')
      }
    }, 2500)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug])

  const doStart = () => {
    if (command.trim() === '') return
    let env: Record<string, string> | undefined
    if (envJson.trim() !== '') {
      try {
        const parsed = JSON.parse(envJson)
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('bad')
        env = parsed as Record<string, string>
      } catch {
        onError(t('expWsEnvInvalid'))
        return
      }
    }
    setStarting(true)
    void api<{ run: RunRecord }>('experiment-run-start', {
      workspaceDir, slug, command: command.trim(),
      ...(cwd.trim() !== '' ? { cwd: cwd.trim() } : {}),
      ...(pythonPath.trim() !== '' ? { pythonPath: pythonPath.trim() } : {}),
      ...(env !== undefined ? { env } : {}),
    })
      .then(() => {
        setCommand(''); setCwd(''); setPythonPath(''); setEnvJson('')
        onNotice(t('expWsStarted'))
        refreshStatus(false)
        refreshLogs('stdout')
        refreshLogs('stderr')
      })
      .catch((e: any) => onError(String(e?.message ?? e)))
      .finally(() => setStarting(false))
  }

  const doStop = () => {
    setConfirmStop(false)
    setStopping(true)
    void api<{ ok: boolean }>('experiment-run-stop', { workspaceDir, slug })
      .then(() => { refreshStatus(false) })
      .catch((e: any) => onError(String(e?.message ?? e)))
      .finally(() => setStopping(false))
  }

  const active = status?.running ?? null
  const latest = status?.latest ?? null

  return jsxs('div', {
    className: 'evo-ews-section',
    children: [
      jsxs('div', {
        className: 'evo-ews-section-head',
        children: [
          jsx(Terminal, {}),
          jsx('span', { children: t('expWsRuns') }),
          active !== null && jsxs('span', {
            className: 'evo-ews-status-badge',
            'data-status': 'running',
            children: [jsx('span', { className: 'evo-tl-running' }), t('expWsRunning')],
          }),
          latest !== null && active === null && jsx('span', {
            className: 'evo-ews-status-badge',
            'data-status': latest.status,
            children: t(STATUS_TEXT[latest.status] ?? 'expWsUnknown'),
          }),
        ],
      }),
      // 启动表单
      jsxs('div', {
        className: 'evo-ews-run-form',
        children: [
          jsx('input', {
            type: 'text',
            className: 'evo-panel-input',
            placeholder: t('expWsCommand'),
            value: command,
            disabled: starting,
            onInput: (e) => setCommand(e.currentTarget.value),
            onKeyDown: (e) => { if (e.key === 'Enter') doStart() },
          }),
          jsxs('div', { className: 'evo-panel-form', children: [
            jsx('input', {
              type: 'text',
              className: 'evo-panel-input',
              placeholder: t('expWsCwd'),
              value: cwd,
              disabled: starting,
              onInput: (e) => setCwd(e.currentTarget.value),
            }),
            jsx('input', {
              type: 'text',
              className: 'evo-panel-input',
              placeholder: t('expWsPython'),
              value: pythonPath,
              disabled: starting,
              onInput: (e) => setPythonPath(e.currentTarget.value),
            }),
          ] }),
          jsx('input', {
            type: 'text',
            className: 'evo-panel-input',
            placeholder: t('expWsEnvJson'),
            value: envJson,
            disabled: starting,
            onInput: (e) => setEnvJson(e.currentTarget.value),
          }),
          jsxs('div', {
            className: 'evo-panel-form',
            children: [
              jsx('button', {
                type: 'button',
                className: 'evo-panel-add',
                disabled: starting || command.trim() === '',
                onClick: doStart,
                children: jsxs(Fragment, { children: [jsx(Play, {}), jsx('span', { children: starting ? t('expWsStarting') : t('expWsRun') })] }),
              }),
              active !== null && (confirmStop
                ? jsx('button', {
                    type: 'button',
                    className: 'evo-tl-del-confirm',
                    disabled: stopping,
                    onClick: doStop,
                    children: t('expWsStopConfirm'),
                  })
                : jsx('button', {
                    type: 'button',
                    className: 'evo-panel-del',
                    title: t('expWsStop'),
                    disabled: stopping,
                    onClick: () => { setConfirmStop(true); setTimeout(() => setConfirmStop(false), 5000) },
                    children: jsx(Square, {}),
                  })),
            ],
          }),
        ],
      }),
      // 最近运行摘要
      latest !== null && jsx('div', {
        className: 'evo-ews-run-meta',
        children: `$ ${latest.command} · ${t(STATUS_TEXT[latest.status] ?? 'expWsUnknown')} · ${t('expWsExit')} ${latest.exitCode ?? '—'} · ${fmtTime(latest.startedAt)}${latest.endedAt !== null ? ` → ${fmtTime(latest.endedAt)}` : ''}${latest.pid !== null ? ` · pid ${latest.pid}` : ''}`,
      }),
      // 日志
      jsxs('div', {
        className: 'evo-ews-log-acts',
        children: [
          jsx('span', { className: 'evo-panel-row-label', children: t('expWsLogs') }),
          jsxs('div', {
            className: 'evo-traj-seg',
            children: [
              jsx('button', { type: 'button', className: 'evo-traj-chip', 'data-on': logStream === 'stdout' || undefined, onClick: () => setLogStream('stdout'), children: t('expWsStdout') }),
              jsx('button', { type: 'button', className: 'evo-traj-chip', 'data-on': logStream === 'stderr' || undefined, onClick: () => setLogStream('stderr'), children: t('expWsStderr') }),
            ],
          }),
          jsx('span', { style: { flex: 1 } }),
          jsx('label', { className: 'evo-ews-check', children: [jsx('input', { type: 'checkbox', checked: autoRefresh, onChange: (e) => { setAutoRefresh(e.currentTarget.checked); autoRefreshRef.current = e.currentTarget.checked } }), t('expWsLogAuto')] }),
          jsx('button', { type: 'button', className: 'evo-panel-act', title: t('refresh'), onClick: () => refreshLogs(logStream), children: jsx(RefreshCw, {}) }),
          jsx('button', { type: 'button', className: 'evo-panel-act', title: t('expWsLogMore'), onClick: () => refreshLogs(logStream), children: jsx(ChevronDown, {}) }),
        ],
      }),
      !logLoaded[logStream] && logText[logStream] === ''
        ? jsx('div', { className: 'evo-panel-hint', children: t('expWsNoLogs') })
        : jsx('div', { className: 'evo-ews-log-view', children: logText[logStream] === '' ? t('expWsNoLogs') : logText[logStream] }),
    ],
  })
}

// ── 实验详情（笔记 / 运行 / 树 / 产物 / 复盘）──────────────────────────────

function WorkspaceDetail({ workspaceDir, slug, onReload, onError, onNotice }: {
  workspaceDir: string
  slug: string
  onReload: () => void
  onError: (message: string) => void
  onNotice: (message: string) => void
}) {
  const [info, setInfo] = useState<ExperimentWorkspaceInfo | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [appendMode, setAppendMode] = useState(false)
  const [noteDraft, setNoteDraft] = useState('')
  const [savingNote, setSavingNote] = useState(false)
  const [tree, setTree] = useState<ExperimentWorkspaceTree | null>(null)
  const [artifacts, setArtifacts] = useState<{ dir: string; exists: boolean; entries: ExperimentWorkspaceEntry[] } | null>(null)
  const [retro, setRetro] = useState<{ draft: string; draftPath: string | null } | null>(null)
  const [retroBusy, setRetroBusy] = useState(false)
  const [saveDraft, setSaveDraft] = useState(false)

  const loadInfo = () => {
    void api<ExperimentWorkspaceInfo>('experiment-workspace-detail', { workspaceDir, slug })
      .then(setInfo)
      .catch((e: any) => onError(String(e?.message ?? e)))
  }
  const loadNote = () => {
    void api<{ content: string }>('experiment-workspace-read-note', { workspaceDir, slug })
      .then((r) => { setNote(r.content); setNoteDraft(r.content) })
      .catch(() => setNote(null))
  }
  const loadTree = () => {
    void api<ExperimentWorkspaceTree>('experiment-workspace-tree', { workspaceDir, slug })
      .then(setTree)
      .catch((e: any) => onError(String(e?.message ?? e)))
  }
  const loadArtifacts = () => {
    void api<{ dir: string; exists: boolean; entries: ExperimentWorkspaceEntry[] }>('experiment-workspace-artifacts', { workspaceDir, slug })
      .then(setArtifacts)
      .catch((e: any) => onError(String(e?.message ?? e)))
  }

  useEffect(() => { loadInfo(); loadNote(); loadTree(); loadArtifacts() }, [slug])

  const doSaveNote = () => {
    setSavingNote(true)
    void api<{ ok: boolean }>('experiment-workspace-write-note', { workspaceDir, slug, content: noteDraft, append: appendMode })
      .then(() => {
        setEditing(false)
        onNotice(t('expWsSaved'))
        loadNote(); loadInfo()
      })
      .catch((e: any) => onError(String(e?.message ?? e)))
      .finally(() => setSavingNote(false))
  }
  const doRetro = () => {
    setRetroBusy(true)
    void api<{ draft: string; draftPath: string | null }>('experiment-retrospective-draft', { workspaceDir, slug, saveDraft })
      .then((r) => { setRetro(r); if (r.draftPath !== null) onNotice(t('expWsRetroSaved')) })
      .catch((e: any) => onError(String(e?.message ?? e)))
      .finally(() => setRetroBusy(false))
  }

  return jsxs('div', {
    className: 'evo-exp-detail',
    children: [
      // 笔记
      jsxs('div', {
        className: 'evo-ews-section',
        children: [
          jsxs('div', {
            className: 'evo-ews-section-head',
            children: [
              jsx(FileText, {}),
              jsx('span', { children: t('expWsNote') }),
              info !== null && info.hasNote && jsx('span', { className: 'evo-ews-badge', children: fmtBytes(info.noteBytes) }),
              jsx('span', { style: { flex: 1 } }),
              editing
                ? jsxs(Fragment, { children: [
                    jsx('button', { type: 'button', className: 'evo-exp-inline-ok', disabled: savingNote, onClick: doSaveNote, children: jsx(Check, {}) }),
                    jsx('button', { type: 'button', className: 'evo-exp-inline-cancel', disabled: savingNote, onClick: () => setEditing(false), children: jsx(XIcon, {}) }),
                  ] })
                : jsx('button', {
                    type: 'button',
                    className: 'evo-panel-act',
                    title: t('expWsEditNote'),
                    onClick: () => { setEditing(true); setNoteDraft(note ?? '') },
                    children: jsx(Pencil, {}),
                  }),
            ],
          }),
          note === null && !editing && jsx('div', { className: 'evo-panel-hint', children: t('expWsNoNote') }),
          editing
            ? jsxs('div', {
                className: 'evo-note-editor',
                children: [
                  jsx('textarea', {
                    className: 'evo-note-textarea evo-note-textarea-sm',
                    value: noteDraft,
                    disabled: savingNote,
                    onInput: (e) => setNoteDraft(e.currentTarget.value),
                  }),
                  jsxs('div', { className: 'evo-panel-form', children: [
                    jsx('label', { className: 'evo-ews-check', children: [jsx('input', { type: 'checkbox', checked: appendMode, onChange: (e) => setAppendMode(e.currentTarget.checked) }), t('expWsAppend')] }),
                    jsx('button', {
                      type: 'button',
                      className: 'evo-panel-add',
                      disabled: savingNote,
                      onClick: doSaveNote,
                      children: jsxs(Fragment, { children: [jsx(Check, {}), jsx('span', { children: t('expWsSave') })] }),
                    }),
                  ] }),
                ],
              })
            : note !== null && jsx('div', { className: 'evo-ews-note-view', children: note }),
        ],
      }),
      // 运行管理
      jsx(RunSection, { workspaceDir, slug, onError, onNotice }),
      // 科研回合（Part B：四阶段模板）
      jsx(RoundsPanel, { workspaceDir, slug, onError, onNotice }),
      // 目录树
      jsxs('div', {
        className: 'evo-ews-section',
        children: [
          jsxs('div', {
            className: 'evo-ews-section-head',
            children: [
              jsx(FolderTree, {}),
              jsx('span', { children: t('expWsTree') }),
              jsx('span', { style: { flex: 1 } }),
              jsx('button', { type: 'button', className: 'evo-panel-act', title: t('refresh'), onClick: loadTree, children: jsx(RefreshCw, {}) }),
            ],
          }),
          tree === null
            ? jsx('div', { className: 'evo-panel-hint', children: t('loading') })
            : tree.missingSource
              ? jsx('div', { className: 'evo-panel-hint', children: t('expWsTreeMissing') })
              : jsx(TreeBlock, { entries: tree.entries, truncated: tree.truncated }),
        ],
      }),
      // 产物
      jsxs('div', {
        className: 'evo-ews-section',
        children: [
          jsxs('div', {
            className: 'evo-ews-section-head',
            children: [
              jsx(FlaskConical, {}),
              jsx('span', { children: t('expWsArtifacts') }),
              jsx('span', { style: { flex: 1 } }),
              jsx('button', { type: 'button', className: 'evo-panel-act', title: t('refresh'), onClick: loadArtifacts, children: jsx(RefreshCw, {}) }),
            ],
          }),
          artifacts === null
            ? jsx('div', { className: 'evo-panel-hint', children: t('loading') })
            : !artifacts.exists || artifacts.entries.length === 0
              ? jsx('div', { className: 'evo-panel-hint', children: t('expWsNoArtifacts') })
              : jsx(TreeBlock, { entries: artifacts.entries }),
        ],
      }),
      // 复盘草稿
      jsxs('div', {
        className: 'evo-ews-section',
        children: [
          jsxs('div', {
            className: 'evo-ews-section-head',
            children: [
              jsx(FileClock, {}),
              jsx('span', { children: t('expWsRetro') }),
              jsx('span', { style: { flex: 1 } }),
              jsx('label', { className: 'evo-ews-check', children: [jsx('input', { type: 'checkbox', checked: saveDraft, onChange: (e) => setSaveDraft(e.currentTarget.checked) }), t('expWsRetroSave')] }),
              jsx('button', {
                type: 'button',
                className: 'evo-panel-add',
                disabled: retroBusy,
                onClick: doRetro,
                children: jsxs(Fragment, { children: [jsx(FileClock, {}), jsx('span', { children: retroBusy ? t('loading') : t('expWsRetroGen') })] }),
              }),
            ],
          }),
          retro === null
            ? jsx('div', { className: 'evo-panel-hint', children: t('expWsRetroHint') })
            : jsx('div', { className: 'evo-ews-retro', children: retro.draft }),
        ],
      }),
    ],
  })
}

// ── 面板主体：列表 + 新建 + 导入 + 详情 ─────────────────────────────────────

/** 实验工作区面板（EXP-UI Tab 1）。 */
export function ExperimentWorkspacePanel({ cwd, onOpenSession }: {
  cwd: string | null
  sessionId: string | null
  onOpenSession: (id: string) => void
}) {
  const [list, setList] = useState<ExperimentWorkspaceInfo[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [importing, setImporting] = useState(false)
  const [srcDir, setSrcDir] = useState('')
  const [importName, setImportName] = useState('')
  const [copyMode, setCopyMode] = useState(false)
  const [expandedSlug, setExpandedSlug] = useState<string | null>(null)
  const [reportOpen, setReportOpen] = useState(false)
  const [duplicate, setDuplicate] = useState<{ slug: string; name: string } | null>(null)
  const workspaceDir = cwd ?? ''

  const load = (fresh = false) => {
    if (fresh) setList(null)
    setError(null)
    void api<ExperimentWorkspaceInfo[]>('experiment-workspace-list', { workspaceDir })
      .then(setList)
      .catch((e: any) => setError(String(e?.message ?? e)))
  }
  useEffect(() => { load(true) }, [cwd])

  const workspaceUnbound = error !== null && (error.includes('超出部署根目录') || error.includes('工作区必须是部署根目录'))

  const parseDupSlug = (msg: string): string | null => {
    const m = String(msg).match(/实验已存在:\s*(.+)/)
    return m !== null && m[1] !== undefined ? m[1].trim() : null
  }

  const doCreate = (opts?: { overwrite?: boolean }) => {
    const name = newName.trim()
    if (name === '') return
    setCreating(true)
    setError(null)
    if (opts?.overwrite !== true) setDuplicate(null)
    void api<ExperimentWorkspaceInfo>('experiment-workspace-create', { project: workspaceDir, name, ...(opts?.overwrite === true ? { overwrite: true } : {}) })
      .then((created) => {
        setNewName(''); setCreating(false); setDuplicate(null)
        setExpandedSlug(created.slug)
        setNotice(opts?.overwrite === true ? t('expWsOverwriteOk') : t('expWsCreated'))
        setTimeout(() => setNotice(null), 4000)
        load()
      })
      .catch((e: any) => {
        setCreating(false)
        const msg = String(e?.message ?? e)
        const dup = parseDupSlug(msg)
        if (dup !== null) {
          setDuplicate({ slug: dup, name })
          setError(msg)
        } else {
          setError(msg)
        }
      })
  }
  const doOverwrite = () => doCreate({ overwrite: true })
  const doImport = () => {
    if (srcDir.trim() === '') return
    setImporting(true)
    setError(null)
    void api<ExperimentWorkspaceInfo>('experiment-workspace-import', {
      project: workspaceDir,
      sourceDir: srcDir.trim(),
      ...(importName.trim() !== '' ? { name: importName.trim() } : {}),
      ...(copyMode ? { copy: true } : {}),
    })
      .then((created) => {
        setSrcDir(''); setImportName(''); setImporting(false)
        setExpandedSlug(created.slug)
        setNotice(copyMode ? t('expWsImportedCopy') : t('expWsImportedRef'))
        setTimeout(() => setNotice(null), 4000)
        load()
      })
      .catch((e: any) => { setImporting(false); setError(String(e?.message ?? e)) })
  }

  return jsxs('div', {
    className: 'evo-panel',
    children: [
      jsxs('div', {
        className: 'evo-panel-head',
        children: [
          jsx(FlaskConical, {}),
          jsx('span', { children: t('expWsTitle') }),
          jsx('span', { style: { flex: 1 } }),
          jsx('button', {
            type: 'button',
            className: 'evo-panel-add evo-ews-report-btn',
            title: t('dailyReportTitle'),
            onClick: () => setReportOpen(true),
            children: jsxs(Fragment, { children: [jsx(FileText, {}), jsx('span', { children: t('dailyReportTitle') })] }),
          }),
        ],
      }),
      jsx('div', { className: 'evo-panel-body', children: [
        workspaceUnbound && jsx('div', { className: 'evo-panel-hint', children: t('expWsNoWorkspace') }),
        error !== null && !workspaceUnbound && jsx('div', { className: 'evo-panel-error', children: error }),
        notice !== null && jsx('div', { className: 'evo-exp-notice', children: notice }),
        // 新建实验工作区（A.5 防污染：同名默认拒绝，提供换名/覆盖）
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
              onKeyDown: (e) => { if (e.key === 'Enter') doCreate() },
            }),
            jsx('button', {
              type: 'button',
              className: 'evo-panel-add',
              disabled: creating || newName.trim() === '',
              onClick: () => doCreate(),
              children: jsxs(Fragment, { children: [jsx(Plus, {}), jsx('span', { children: creating ? t('creating') : t('newExperiment') })] }),
            }),
          ],
        }),
        duplicate !== null && jsxs('div', {
          className: 'evo-ews-dup',
          children: [
            jsxs('div', { className: 'evo-panel-hint', children: [jsx('strong', { children: `${t('expWsExists').replace('{slug}', duplicate.slug)} ` }), t('expWsExistsHint')] }),
            jsx('div', { className: 'evo-panel-hint', style: { fontSize: '11.5px', opacity: 0.85 }, children: t('expWsOverwriteHint') }),
            jsxs('div', {
              className: 'evo-panel-form',
              children: [
                jsx('button', { type: 'button', className: 'evo-panel-act', disabled: creating, onClick: () => { setDuplicate(null); setError(null) }, children: t('expWsRename') }),
                jsx('button', { type: 'button', className: 'evo-tl-del-confirm', disabled: creating, onClick: doOverwrite, children: t('expWsOverwrite') }),
              ],
            }),
          ],
        }),
        // 导入已有目录（引用优先，copy 可选）
        jsxs('div', {
          className: 'evo-panel-form',
          children: [
            jsx('input', {
              type: 'text',
              className: 'evo-panel-input',
              placeholder: t('expWsSourceDir'),
              value: srcDir,
              disabled: importing,
              onInput: (e) => setSrcDir(e.currentTarget.value),
            }),
            jsx('input', {
              type: 'text',
              className: 'evo-panel-input',
              placeholder: t('expWsImportName'),
              value: importName,
              disabled: importing,
              onInput: (e) => setImportName(e.currentTarget.value),
            }),
            jsx('button', {
              type: 'button',
              className: 'evo-panel-add',
              disabled: importing || srcDir.trim() === '',
              onClick: doImport,
              children: jsxs(Fragment, { children: [jsx(Download, {}), jsx('span', { children: importing ? t('expWsImporting') : t('expWsImport') })] }),
            }),
          ],
        }),
        jsx('label', { className: 'evo-ews-check', children: [jsx('input', { type: 'checkbox', checked: copyMode, onChange: (e) => setCopyMode(e.currentTarget.checked) }), t('expWsCopyFiles')] }),
        // 列表
        jsxs('div', {
          className: 'evo-panel-row',
          children: [
            jsx('span', { className: 'evo-panel-row-label', children: t('experiments') }),
            jsx('span', { style: { flex: 1 } }),
            jsx('button', { type: 'button', className: 'evo-icon-btn', title: t('refresh'), onClick: () => load(), children: jsx(RefreshCw, {}) }),
          ],
        }),
        list === null
          ? jsx('div', { className: 'evo-panel-hint', children: t('loading') })
          : list.length === 0
            ? jsx('div', { className: 'evo-panel-hint', children: t('expWsEmpty') })
            : jsx('div', {
                className: 'evo-panel-list',
                children: list.map((row) => jsxs('div', {
                  className: 'evo-exp-item',
                  'data-active': expandedSlug === row.slug || undefined,
                  children: [
                    jsxs('button', {
                      type: 'button',
                      className: 'evo-exp-item-head',
                      onClick: () => setExpandedSlug((v) => (v === row.slug ? null : row.slug)),
                      children: [
                        jsx(FlaskConical, {}),
                        jsxs('div', {
                          className: 'evo-exp-item-info',
                          children: [
                            jsx('span', { className: 'evo-exp-item-name', children: row.slug }),
                            jsxs('div', {
                              className: 'evo-ews-item-sub',
                              children: [
                                row.hasNote ? jsx('span', { className: 'evo-ews-badge', children: t('expWsNote') }) : null,
                                row.source !== null && jsx('span', { className: `evo-ews-badge ${row.source.mode}`, children: row.source.mode === 'reference' ? t('expWsRef') : t('expWsCopied') }),
                                jsx('span', { children: fmtTime(row.updatedAt) }),
                              ],
                            }),
                          ],
                        }),
                      ],
                    }),
                    expandedSlug === row.slug && jsx(WorkspaceDetail, {
                      key: row.slug,
                      workspaceDir,
                      slug: row.slug,
                      onReload: () => load(),
                      onError: (message) => setError(message),
                      onNotice: (message) => { setNotice(message); setTimeout(() => setNotice(null), 4000) },
                    }),
                  ],
                }, row.slug)),
              }),
      ] }),
      reportOpen && jsx(DailyReportCard, {
        workspaceDir,
        onClose: () => setReportOpen(false),
        onError: (message) => setError(message),
      }),
    ],
  })
}
