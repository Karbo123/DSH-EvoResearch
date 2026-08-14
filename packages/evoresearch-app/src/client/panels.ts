/**
 * 业务面板（阶段 2）：EvoMemory 记忆面板 + Scheduled 定时任务面板。
 *
 * 数据经 ctx.remote.evoresearch.*（Typert Remote，host 插件 EvoResearchApiService）。
 */

import { jsx, jsxs, Fragment } from 'react/jsx-runtime'
import { useEffect, useState } from 'react'
import { BrainCircuit, Clock, Plus, Trash2, ListChecks, Target } from 'lucide-react'

/** Remote 命名空间（apply 注入）。 */
export interface EvoRemote {
  projectsList(): Promise<Array<{ name: string; path?: string }>>
  memoryCatalog(args: { workspaceDir?: string }): Promise<Array<{ category: string; count: number }>>
  memoryGoals(args: { workspaceDir?: string }): Promise<Array<{ id?: string; title?: string; status?: string; progress?: number }>>
  schedulerList(): Promise<Array<{ id: string; name?: string; cron?: string; enabled?: boolean; lastRunAt?: string; lastResult?: string }>>
  schedulerAdd(args: { name: string; cron: string; command: string }): Promise<{ ok: boolean }>
  schedulerRemove(args: { id: string }): Promise<{ ok: boolean }>
}

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

/** EvoMemory 面板：项目 + 分类统计 + 目标。 */
export function MemoryPanel({ remote }: { remote: EvoRemote }) {
  const [projects, setProjects] = useState<Array<{ name: string; path?: string }> | null>(null)
  const [catalog, setCatalog] = useState<Array<{ category: string; count: number }> | null>(null)
  const [goals, setGoals] = useState<Array<{ id?: string; title?: string; status?: string; progress?: number }> | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      remote.projectsList().catch((e: any) => { if (!cancelled) setError(String(e?.message ?? e)); return [] }),
      remote.memoryCatalog({}).catch(() => []),
      remote.memoryGoals({}).catch(() => []),
    ]).then(([p, c, g]) => {
      if (cancelled) return
      setProjects(p as any)
      setCatalog(c as any)
      setGoals(g as any)
    })
    return () => { cancelled = true }
  }, [remote])

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

/** Scheduled 面板：任务列表 + 添加/删除。 */
export function SchedulePanel({ remote }: { remote: EvoRemote }) {
  const [tasks, setTasks] = useState<Array<{ id: string; name?: string; cron?: string; enabled?: boolean }> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [cron, setCron] = useState('0 9 * * *')
  const [command, setCommand] = useState('')

  const load = () => {
    setTasks(null)
    void remote.schedulerList().then((list) => setTasks(list)).catch((e: any) => setError(String(e?.message ?? e)))
  }

  useEffect(() => { load() }, [remote])

  const addTask = () => {
    if (!name.trim() || !cron.trim()) return
    setAdding(true)
    void remote.schedulerAdd({ name: name.trim(), cron: cron.trim(), command: command.trim() || '/memory' }).then((result) => {
      setAdding(false)
      if (result.ok) { setName(''); setCron('0 9 * * *'); setCommand(''); load() }
      else setError('添加失败')
    }).catch((e: any) => { setAdding(false); setError(String(e?.message ?? e)) })
  }

  const removeTask = (id: string) => {
    void remote.schedulerRemove({ id }).then((result) => {
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
            jsx('input', { type: 'text', className: 'evo-panel-input', placeholder: 'Command (default /memory)', value: command, onInput: (e) => setCommand(e.currentTarget.value) }),
            jsx('button', { type: 'button', className: 'evo-panel-add', disabled: adding || !name.trim(), onClick: addTask, children: jsxs(Fragment, { children: [jsx(Plus, {}), jsx('span', { children: 'Add' })] }) }),
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
                      jsx('span', { className: 'evo-panel-item-main', children: task.name ?? task.id }),
                      task.cron !== undefined && jsx('code', { className: 'evo-panel-item-code', children: task.cron }),
                      jsx('button', { type: 'button', className: 'evo-panel-del', title: 'Remove', onClick: () => removeTask(task.id), children: jsx(Trash2, {}) }),
                    ],
                  }),
                }, task.id)),
              }),
      ],
    }),
  })
}
