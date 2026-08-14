/**
 * 业务面板（阶段 2）：EvoMemory 记忆面板 + Scheduled 定时任务面板
 * + Research Skills 技能面板 + Workspace 项目面板。
 *
 * 数据经 /evoresearch/fs/* HTTP API（host 侧直连插件 EvoResearchApiService，
 * 绕开浏览器 Remote $mount 通道）。
 */
import { jsx, jsxs, Fragment } from 'react/jsx-runtime'
import { useEffect, useState } from 'react'
import {
  BrainCircuit, Clock, Plus, Trash2, ListChecks, Target, GraduationCap,
  Check, X as XIcon, Play, FolderGit2, FolderUp, RefreshCw,
} from 'lucide-react'

const CATEGORY_LABELS: Record<string, string> = {
  idea: 'Idea', method: 'Method', experiment: 'Experiment',
  related_work: 'Related Work', reproduction: 'Reproduction', project: 'Project', general: 'General',
}

/** 面板外壳（标题 + 内容）。 */
function PanelShell({ icon, title, children }: { icon: any; title: string; children: any }) {
  return jsxs('div', {
    className: 'evo-panel',
    children: [
      jsxs('div', {
        className: 'evo-panel-head',
        children: [jsx(icon, {}), jsx('span', { children: title })],
      }),
      jsx('div', { className: 'evo-panel-body', children }),
    ],
  })
}

function LoadingRow() {
  return jsx('div', { className: 'evo-panel-hint', children: 'Loading…' })
}

/** 简单 POST JSON 封装。 */
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

/** EvoMemory 面板：项目 + 分类统计 + 目标。 */
export function MemoryPanel() {
  const [projects, setProjects] = useState<Array<{ name: string; path?: string }> | null>(null)
  const [catalog, setCatalog] = useState<Array<{ category: string; count: number }> | null>(null)
  const [goals, setGoals] = useState<Array<{ id?: string; title?: string; status?: string; progress?: number }> | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      api<Array<{ name: string; path?: string }>>('projects').catch((e: any) => { if (!cancelled) setError(String(e?.message ?? e)); return [] }),
      api<Array<{ category: string; count: number }>>('memory-catalog', {}).catch(() => []),
      api<Array<{ id?: string; title?: string; status?: string; progress?: number }>>('memory-goals', {}).catch(() => []),
    ]).then(([p, c, g]) => {
      if (cancelled) return
      setProjects(p)
      setCatalog(c)
      setGoals(g)
    })
    return () => { cancelled = true }
  }, [])

  const totalTurns = (catalog ?? []).reduce((sum, item) => sum + item.count, 0)

  const projectsRow = jsxs('div', {
    className: 'evo-panel-row',
    children: [
      jsx('span', { className: 'evo-panel-row-label', children: 'Projects' }),
      projects === null
        ? jsx(LoadingRow, {})
        : (projects ?? []).length === 0
          ? jsx('span', { className: 'evo-panel-hint', children: 'No projects yet' })
          : jsx('div', {
              className: 'evo-panel-tags',
              children: (projects ?? []).map((p) => jsx('span', { className: 'evo-panel-tag', children: p.name }, p.name)),
            }),
    ],
  })

  const catalogRow = jsxs('div', {
    className: 'evo-panel-row',
    children: [
      jsx('span', { className: 'evo-panel-row-label', children: 'Turn Catalog' }),
      catalog === null
        ? jsx(LoadingRow, {})
        : jsx('div', {
            className: 'evo-panel-stats',
            children: [
              jsx('div', { className: 'evo-panel-stat', children: jsxs(Fragment, { children: [jsx('div', { className: 'evo-panel-stat-num', children: totalTurns }), jsx('div', { className: 'evo-panel-stat-label', children: 'turns' })] }) }),
              ...(catalog ?? []).map((item) => jsx('div', {
                className: 'evo-panel-stat',
                children: jsxs(Fragment, {
                  children: [jsx('div', { className: 'evo-panel-stat-num', children: item.count }), jsx('div', { className: 'evo-panel-stat-label', children: CATEGORY_LABELS[item.category] ?? item.category })],
                }),
              }, item.category)),
            ],
          }),
    ],
  })

  const goalsRow = jsxs('div', {
    className: 'evo-panel-row',
    children: [
      jsx('span', { className: 'evo-panel-row-label', children: 'Goals' }),
      goals === null
        ? jsx(LoadingRow, {})
        : (goals ?? []).length === 0
          ? jsx('span', { className: 'evo-panel-hint', children: 'No active goals' })
          : jsx('div', {
              className: 'evo-panel-list',
              children: (goals ?? []).map((g) => jsx('div', {
                className: 'evo-panel-item',
                children: jsxs(Fragment, {
                  children: [
                    jsx(Target, {}),
                    jsx('span', { className: 'evo-panel-item-main', children: g.title ?? g.id ?? 'Goal' }),
                    g.status !== undefined && jsx('span', { className: 'evo-panel-item-badge', children: g.status }),
                    g.progress !== undefined && jsx('span', { className: 'evo-panel-item-num', children: `${Math.round(g.progress * 100)}%` }),
                  ],
                }),
              }, g.id)),
            }),
    ],
  })

  return jsx(PanelShell, {
    icon: BrainCircuit,
    title: 'EvoMemory',
    children: jsxs(Fragment, {
      children: [
        error !== null && jsx('div', { className: 'evo-panel-error', children: error }),
        projectsRow,
        catalogRow,
        goalsRow,
      ],
    }),
  })
}

interface ScheduledTask { id?: string; taskId?: string; name?: string; cron?: string; enabled?: boolean }

/** Scheduled 面板：任务列表 + 添加/删除。 */
export function SchedulePanel() {
  const [tasks, setTasks] = useState<ScheduledTask[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [cron, setCron] = useState('0 9 * * *')
  const [prompt, setPrompt] = useState('')

  const load = () => {
    setTasks(null)
    void api<ScheduledTask[]>('scheduler-list').then(setTasks).catch((e: any) => setError(String(e?.message ?? e)))
  }

  useEffect(() => { load() }, [])

  const addTask = () => {
    if (!name.trim() || !cron.trim() || !prompt.trim()) return
    setAdding(true)
    void api<{ ok: boolean }>('scheduler-add', { name: name.trim(), cron: cron.trim(), prompt: prompt.trim() }).then((result) => {
      setAdding(false)
      if (result.ok) { setName(''); setCron('0 9 * * *'); setPrompt(''); load() }
      else setError('添加失败')
    }).catch((e: any) => { setAdding(false); setError(String(e?.message ?? e)) })
  }

  const removeTask = (id: string) => {
    void api<{ ok: boolean }>('scheduler-remove', { taskId: id }).then((result) => {
      if (result.ok) load()
    }).catch((e: any) => setError(String(e?.message ?? e)))
  }

  return jsx(PanelShell, {
    icon: Clock,
    title: 'Scheduled',
    children: jsxs(Fragment, {
      children: [
        error !== null && jsx('div', { className: 'evo-panel-error', children: error }),
        jsx('div', {
          className: 'evo-panel-form',
          children: [
            jsx('input', { type: 'text', className: 'evo-panel-input', placeholder: 'Task name', value: name, onInput: (e) => setName(e.currentTarget.value) }),
            jsx('input', { type: 'text', className: 'evo-panel-input evo-panel-input-cron', placeholder: 'cron (5 fields)', value: cron, onInput: (e) => setCron(e.currentTarget.value) }),
            jsx('input', { type: 'text', className: 'evo-panel-input', placeholder: 'Prompt (executed at cron time)', value: prompt, onInput: (e) => setPrompt(e.currentTarget.value) }),
            jsx('button', { type: 'button', className: 'evo-panel-add', disabled: adding || !name.trim() || !prompt.trim(), onClick: addTask, children: jsxs(Fragment, { children: [jsx(Plus, {}), jsx('span', { children: 'Add' })] }) }),
          ],
        }),
        tasks === null
          ? jsx(LoadingRow, {})
          : (tasks ?? []).length === 0
            ? jsx('span', { className: 'evo-panel-hint', children: 'No scheduled tasks' })
            : jsx('div', {
                className: 'evo-panel-list',
                children: (tasks ?? []).map((task) => jsx('div', {
                  className: 'evo-panel-item',
                  children: jsxs(Fragment, {
                    children: [
                      jsx(ListChecks, {}),
                      jsx('span', { className: 'evo-panel-item-main', children: task.name ?? task.taskId ?? task.id }),
                      task.cron !== undefined && jsx('code', { className: 'evo-panel-item-code', children: task.cron }),
                      jsx('button', { type: 'button', className: 'evo-panel-del', title: 'Remove', onClick: () => removeTask(task.taskId ?? task.id), children: jsx(Trash2, {}) }),
                    ],
                  }),
                }, task.taskId ?? task.id)),
              }),
      ],
    }),
  })
}

interface SkillProposal {
  proposalId: string
  name: string
  description?: string
  action?: 'create' | 'update'
  content?: string
  sourceObservationIds?: readonly string[]
  status: 'pending' | 'approved' | 'rejected'
  createdAt?: number
}

type SkillFilter = 'all' | 'pending' | 'approved' | 'rejected'

/** Research Skills 面板：AutoSkills 提案列表 + 审核/运行。 */
export function SkillsPanel() {
  const [proposals, setProposals] = useState<SkillProposal[] | null>(null)
  const [filter, setFilter] = useState<SkillFilter>('all')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = () => {
    setProposals(null)
    void api<SkillProposal[]>('skills', filter === 'all' ? {} : { status: filter })
      .then(setProposals)
      .catch((e: any) => setError(String(e?.message ?? e)))
  }

  useEffect(() => { load() }, [filter])

  const act = (proposalId: string, kind: 'approve' | 'reject' | 'run') => {
    setBusy(proposalId)
    void api<{ ok: boolean }>(`skills/${kind}`, { proposalId })
      .then((result) => {
        setBusy(null)
        if (result.ok) load()
        else setError('操作失败')
      })
      .catch((e: any) => { setBusy(null); setError(String(e?.message ?? e)) })
  }

  const tab = (key: SkillFilter, label: string) => jsx('button', {
    type: 'button',
    className: 'evo-insp-subtab',
    'data-active': filter === key || undefined,
    onClick: () => setFilter(key),
    children: label,
  }, key)

  return jsx(PanelShell, {
    icon: GraduationCap,
    title: 'Research Skills',
    children: jsxs(Fragment, {
      children: [
        jsxs('div', {
          className: 'evo-skill-tabs',
          children: [tab('all', 'All'), tab('pending', 'Pending'), tab('approved', 'Approved'), tab('rejected', 'Rejected')],
        }),
        error !== null && jsx('div', { className: 'evo-panel-error', children: error }),
        proposals === null
          ? jsx(LoadingRow, {})
          : proposals.length === 0
            ? jsx('span', { className: 'evo-panel-hint', children: 'No skill proposals yet' })
            : jsx('div', {
                className: 'evo-panel-list',
                children: proposals.map((p) => jsxs('div', {
                  className: 'evo-skill-card',
                  children: [
                    jsxs('div', {
                      className: 'evo-skill-head',
                      children: [
                        jsx('span', { className: 'evo-panel-item-main', children: p.name }),
                        jsx('span', { className: `evo-skill-status ${p.status}`, children: p.status }),
                        p.action !== undefined && jsx('span', { className: 'evo-skill-action', children: p.action }),
                      ],
                    }),
                    p.description !== '' && p.description !== undefined && jsx('div', { className: 'evo-skill-desc', children: p.description }),
                    p.sourceObservationIds !== undefined && p.sourceObservationIds.length > 0
                      && jsx('div', { className: 'evo-skill-src', children: `${p.sourceObservationIds.length} observations` }),
                    p.status === 'pending' && jsxs('div', {
                      className: 'evo-skill-actions',
                      children: [
                        jsx('button', {
                          type: 'button',
                          className: 'evo-btn evo-btn-ok',
                          disabled: busy !== null,
                          onClick: () => act(p.proposalId, 'approve'),
                          children: jsxs(Fragment, { children: [jsx(Check, {}), jsx('span', { children: 'Approve' })] }),
                        }),
                        jsx('button', {
                          type: 'button',
                          className: 'evo-btn evo-btn-danger',
                          disabled: busy !== null,
                          onClick: () => act(p.proposalId, 'reject'),
                          children: jsxs(Fragment, { children: [jsx(XIcon, {}), jsx('span', { children: 'Reject' })] }),
                        }),
                      ],
                    }),
                    p.status === 'approved' && jsx('div', {
                      className: 'evo-skill-actions',
                      children: jsx('button', {
                        type: 'button',
                        className: 'evo-btn evo-btn-run',
                        disabled: busy !== null,
                        onClick: () => act(p.proposalId, 'run'),
                        children: jsxs(Fragment, { children: [jsx(Play, {}), jsx('span', { children: 'Run' })] }),
                      }),
                    }),
                  ],
                }, p.proposalId)),
              }),
      ],
    }),
  })
}

interface ProjectRow { name: string; path?: string }

/** Workspace 面板：项目列表 + Import Project。 */
export function WorkspacePanel() {
  const [projects, setProjects] = useState<ProjectRow[] | null>(null)
  const [sourcePath, setSourcePath] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)

  const load = () => {
    setProjects(null)
    void api<ProjectRow[]>('projects').then(setProjects).catch((e: any) => setError(String(e?.message ?? e)))
  }

  useEffect(() => { load() }, [])

  const doImport = () => {
    if (!sourcePath.trim()) return
    setImporting(true)
    setError(null)
    void api<ProjectRow>('projects-import', {
      sourcePath: sourcePath.trim(),
      ...(name.trim() === '' ? {} : { name: name.trim() }),
    }).then((project) => {
      setImporting(false)
      if (project?.name !== undefined) { setSourcePath(''); setName(''); load() }
      else setError('导入失败')
    }).catch((e: any) => { setImporting(false); setError(String(e?.message ?? e)) })
  }

  return jsx(PanelShell, {
    icon: FolderGit2,
    title: 'Workspace',
    children: jsxs(Fragment, {
      children: [
        error !== null && jsx('div', { className: 'evo-panel-error', children: error }),
        jsxs('div', {
          className: 'evo-panel-form',
          children: [
            jsx('input', {
              type: 'text',
              className: 'evo-panel-input',
              placeholder: 'Project source path (folder)',
              value: sourcePath,
              onInput: (e) => setSourcePath(e.currentTarget.value),
            }),
            jsx('input', {
              type: 'text',
              className: 'evo-panel-input',
              placeholder: 'Project name (optional)',
              value: name,
              onInput: (e) => setName(e.currentTarget.value),
            }),
            jsx('button', {
              type: 'button',
              className: 'evo-panel-add',
              disabled: importing || !sourcePath.trim(),
              onClick: doImport,
              children: jsxs(Fragment, { children: [jsx(FolderUp, {}), jsx('span', { children: 'Import' })] }),
            }),
          ],
        }),
        jsxs('div', {
          className: 'evo-panel-row',
          children: [
            jsx('span', { className: 'evo-panel-row-label', children: 'Projects' }),
            jsx('span', { style: { flex: 1 } }),
            jsx('button', { type: 'button', className: 'evo-icon-btn', title: 'Refresh', onClick: load, children: jsx(RefreshCw, {}) }),
          ],
        }),
        projects === null
          ? jsx(LoadingRow, {})
          : (projects ?? []).length === 0
            ? jsx('span', { className: 'evo-panel-hint', children: 'No projects yet' })
            : jsx('div', {
                className: 'evo-panel-list',
                children: (projects ?? []).map((p) => jsx('div', {
                  className: 'evo-panel-item',
                  children: jsxs(Fragment, {
                    children: [
                      jsx(FolderGit2, {}),
                      jsx('span', { className: 'evo-panel-item-main', children: p.name }),
                      p.path !== undefined && jsx('code', { className: 'evo-panel-item-code', children: p.path }),
                    ],
                  }),
                }, p.name)),
              }),
      ],
    }),
  })
}
