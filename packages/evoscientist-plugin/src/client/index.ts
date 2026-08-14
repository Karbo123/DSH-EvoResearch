/**
 * EvoScientist Client 插件（浏览器端 WebUI 扩展）。
 *
 * 注册三个低风险 Slot：
 * - sidebar.footer.action：侧栏底部「科研」入口按钮；
 * - shell.overlay：科研面板（项目 / 记忆 / 定时任务 / 通道 / AutoSkills 提案）；
 * - conversation.input.dock：当前会话的科研记忆提示条（Memory · N sources）。
 *
 * i18n：经 ctx.locale.register 注册中英字典，组件通过 slots 注入的 `t` prop 取文案。
 * 数据全部来自 Host 侧 EvosciApiService（ctx.remote.evosci.*，Typert Remote），
 * 不持有任何 Host 内部对象。样式使用内联 style + DSH 主题 CSS 变量。
 */
import type { Context } from '@deepseek-ai/cordis'
import * as React from 'react'

/** Client 插件依赖（包名，由 client-modules 注入）。 */
export const inject = [
  '@deepseek-ai/dsh-client-runtime',
  '@deepseek-ai/dsh-api-remotes',
  '@deepseek-ai/dsh-client-locale',
]

/** i18n 命名空间。 */
export const NS = 'evosci'

/** 中英字典（未覆盖键回退英文，与 DSH client-locale 行为一致）。 */
const DICT: Record<string, Record<string, string>> = {
  'zh-CN': {
    'panel.title': 'EvoScientist 科研面板',
    'tab.projects': '项目',
    'tab.memory': '记忆',
    'tab.scheduler': '定时任务',
    'tab.channels': '通道',
    'tab.autoskills': '技能提案',
    'action.createProject': '创建项目',
    'project.placeholder': '新项目名',
    'action.addTask': '添加任务',
    'task.cronPlaceholder': 'cron（如 0 9 * * 1-5）',
    'task.promptPlaceholder': '任务提示词',
    'memory.catalogTitle': '科研记忆类别目录',
    'channels.receivedSent': '收{n} 发{m}',
    'action.stop': '停止',
    'action.start': '启动',
    'action.approve': '批准',
    'action.reject': '拒绝',
    'action.close': '关闭',
    'state.empty': '（空）',
    'dock.summary': '科研记忆：{states} 个主题 · {hits} 条相关历史',
    'entry.title': '科研项目 / 记忆 / 定时任务 / 通道 / 技能提案',
    'entry.label': '科研',
    'task.enabled': '开',
    'task.disabled': '关',
  },
  en: {
    'panel.title': 'EvoScientist Research Panel',
    'tab.projects': 'Projects',
    'tab.memory': 'Memory',
    'tab.scheduler': 'Scheduler',
    'tab.channels': 'Channels',
    'tab.autoskills': 'Skill Proposals',
    'action.createProject': 'Create Project',
    'project.placeholder': 'New project name',
    'action.addTask': 'Add Task',
    'task.cronPlaceholder': 'cron (e.g. 0 9 * * 1-5)',
    'task.promptPlaceholder': 'Task prompt',
    'memory.catalogTitle': 'Research memory categories',
    'channels.receivedSent': 'rcv {n} snt {m}',
    'action.stop': 'Stop',
    'action.start': 'Start',
    'action.approve': 'Approve',
    'action.reject': 'Reject',
    'action.close': 'Close',
    'state.empty': '(empty)',
    'dock.summary': 'Research memory: {states} topics · {hits} related hits',
    'entry.title': 'Projects / Memory / Scheduler / Channels / Skill proposals',
    'entry.label': 'Research',
    'task.enabled': 'on',
    'task.disabled': 'off',
  },
}

/** t 函数形态（与 DSH client-locale 的 translate 一致：{var} 插值）。 */
export type Translate = (key: string, vars?: Record<string, string | number>) => string

/** 面板打开事件名（插件内部通信）。 */
const PANEL_EVENT = 'evosci:panel'

/** 打开科研面板。 */
export function openResearchPanel(): void {
  window.dispatchEvent(new CustomEvent(PANEL_EVENT))
}

/** 基础面板样式（DSH 主题变量）。 */
const panelStyle: React.CSSProperties = {
  position: 'fixed',
  inset: '10% 20%',
  background: 'var(--dsw-alias-bg-base, #ffffff)',
  border: '1px solid var(--dsw-alias-border-l2, #ddd)',
  borderRadius: 12,
  boxShadow: '0 8px 40px rgba(0,0,0,0.25)',
  zIndex: 1000,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
}

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '12px 16px',
  borderBottom: '1px solid var(--dsw-alias-border-l1, #eee)',
}

const tabsStyle: React.CSSProperties = { display: 'flex', gap: 8, padding: '0 16px', borderBottom: '1px solid var(--dsw-alias-border-l1, #eee)' }

const bodyStyle: React.CSSProperties = { padding: 16, overflow: 'auto', flex: 1, fontSize: 13, lineHeight: 1.6 }

const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px dashed var(--dsw-alias-border-l1, #eee)' }

/** 标签页类型。 */
type Tab = 'projects' | 'memory' | 'scheduler' | 'channels' | 'autoskills'

/** 科研面板（overlay）。 */
function ResearchPanel({ ctx, onClose, t }: { ctx: Context; onClose: () => void; t: Translate }) {
  const [tab, setTab] = React.useState<Tab>('projects')
  const [projects, setProjects] = React.useState<unknown[]>([])
  const [catalog, setCatalog] = React.useState<Array<{ category: string; count: number }>>([])
  const [tasks, setTasks] = React.useState<unknown[]>([])
  const [channels, setChannels] = React.useState<unknown[]>([])
  const [proposals, setProposals] = React.useState<unknown[]>([])
  const [newProject, setNewProject] = React.useState('')
  const [newCron, setNewCron] = React.useState('0 9 * * 1-5')
  const [newPrompt, setNewPrompt] = React.useState('')

  const refresh = React.useCallback(() => {
    const remote = (ctx as unknown as { remote?: Record<string, unknown> }).remote as Record<string, unknown> | undefined
    if (!remote) return
    const evosci = remote.evosci as Record<string, (args?: unknown) => Promise<unknown>> | undefined
    if (!evosci) return
    void evosci.projectsList?.().then((value) => setProjects(Array.isArray(value) ? value : []))
    void evosci.memoryCatalog?.({}).then((value) => setCatalog(Array.isArray(value) ? (value as Array<{ category: string; count: number }>) : []))
    void evosci.schedulerList?.().then((value) => setTasks(Array.isArray(value) ? value : []))
    void evosci.channelsStatus?.().then((value) => setChannels(Array.isArray(value) ? value : []))
    void evosci.autoskillsList?.({}).then((value) => setProposals(Array.isArray(value) ? value : []))
  }, [ctx])

  React.useEffect(() => {
    refresh()
    const timer = window.setInterval(refresh, 10_000)
    return () => window.clearInterval(timer)
  }, [refresh])

  const call = async (name: string, args?: unknown): Promise<void> => {
    const remote = (ctx as unknown as { remote?: Record<string, unknown> }).remote as Record<string, unknown> | undefined
    const evosci = remote?.evosci as Record<string, (a?: unknown) => Promise<unknown>> | undefined
    if (evosci?.[name]) await evosci[name](args)
    refresh()
  }

  const tabButton = (id: Tab, label: string): React.ReactElement =>
    React.createElement(
      'button',
      {
        key: id,
        onClick: () => setTab(id),
        style: {
          padding: '6px 12px',
          border: 'none',
          borderRadius: 6,
          cursor: 'pointer',
          background: tab === id ? 'var(--dsw-alias-state-business-primary, #4a7dff)' : 'transparent',
          color: tab === id ? '#fff' : 'var(--dsw-alias-label-secondary, #666)',
          fontSize: 13,
        },
      },
      label,
    )

  const body = (): React.ReactElement => {
    const list = (items: unknown[], render: (item: unknown, index: number) => React.ReactElement): React.ReactElement =>
      items.length === 0
        ? React.createElement('div', { style: { color: 'var(--dsw-alias-label-caption, #999)' } }, t('state.empty'))
        : React.createElement(React.Fragment, null, items.map(render))

    if (tab === 'projects') {
      return React.createElement(
        React.Fragment,
        null,
        React.createElement(
          'div',
          { style: { display: 'flex', gap: 8, marginBottom: 12 } },
          React.createElement('input', {
            placeholder: t('project.placeholder'),
            value: newProject,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => setNewProject(e.target.value),
            style: { flex: 1, padding: '6px 10px', borderRadius: 6, border: '1px solid var(--dsw-alias-border-l2, #ddd)' },
          }),
          React.createElement(
            'button',
            { onClick: () => { if (newProject.trim()) { void call('projectCreate', { name: newProject.trim() }); setNewProject('') } }, style: { padding: '6px 12px', borderRadius: 6, border: 'none', cursor: 'pointer', background: 'var(--dsw-alias-state-business-primary, #4a7dff)', color: '#fff' } },
            t('action.createProject'),
          ),
        ),
        list(projects, (project, index) => {
          const p = project as { name?: string; path?: string }
          return React.createElement('div', { key: index, style: rowStyle }, React.createElement('strong', null, p.name ?? ''), React.createElement('span', { style: { color: 'var(--dsw-alias-label-caption, #999)' } }, p.path ?? ''))
        }),
      )
    }
    if (tab === 'memory') {
      return React.createElement(
        React.Fragment,
        null,
        React.createElement('div', { style: { fontWeight: 600, marginBottom: 8 } }, t('memory.catalogTitle')),
        list(catalog, (entry, index) => {
          const e = entry as { category?: string; count?: number }
          return React.createElement('div', { key: index, style: rowStyle }, React.createElement('span', null, e.category ?? ''), React.createElement('span', { style: { color: 'var(--dsw-alias-label-caption, #999)' } }, `${e.count ?? 0} 轮`))
        }),
      )
    }
    if (tab === 'scheduler') {
      return React.createElement(
        React.Fragment,
        null,
        React.createElement(
          'div',
          { style: { display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' } },
          React.createElement('input', { placeholder: t('task.cronPlaceholder'), value: newCron, onChange: (e: React.ChangeEvent<HTMLInputElement>) => setNewCron(e.target.value), style: { flex: 1, minWidth: 160, padding: '6px 10px', borderRadius: 6, border: '1px solid var(--dsw-alias-border-l2, #ddd)' } }),
          React.createElement('input', { placeholder: t('task.promptPlaceholder'), value: newPrompt, onChange: (e: React.ChangeEvent<HTMLInputElement>) => setNewPrompt(e.target.value), style: { flex: 2, minWidth: 240, padding: '6px 10px', borderRadius: 6, border: '1px solid var(--dsw-alias-border-l2, #ddd)' } }),
          React.createElement(
            'button',
            { onClick: () => { if (newPrompt.trim()) { void call('schedulerAdd', { name: newPrompt.slice(0, 30), cron: newCron, prompt: newPrompt }); setNewPrompt('') } }, style: { padding: '6px 12px', borderRadius: 6, border: 'none', cursor: 'pointer', background: 'var(--dsw-alias-state-business-primary, #4a7dff)', color: '#fff' } },
            t('action.addTask'),
          ),
        ),
        list(tasks, (task, index) => {
          const tsk = task as { taskId?: string; cron?: string; name?: string; enabled?: boolean }
          return React.createElement('div', { key: index, style: rowStyle }, React.createElement('span', null, `${tsk.cron ?? ''} ${tsk.name ?? ''}`), React.createElement('span', { style: { color: 'var(--dsw-alias-label-caption, #999)' } }, tsk.enabled ? t('task.enabled') : t('task.disabled')))
        }),
      )
    }
    if (tab === 'channels') {
      return list(channels, (channel, index) => {
        const c = channel as { id?: string; name?: string; online?: boolean; received?: number; sent?: number }
        return React.createElement(
          'div',
          { key: index, style: rowStyle },
          React.createElement('span', { style: { color: c.online ? '#2e7d32' : 'var(--dsw-alias-label-caption, #999)' } }, c.online ? '●' : '○'),
          React.createElement('span', null, c.name ?? c.id ?? ''),
          React.createElement('span', { style: { color: 'var(--dsw-alias-label-caption, #999)' } }, t('channels.receivedSent', { n: c.received ?? 0, m: c.sent ?? 0 })),
          React.createElement(
            'button',
            { onClick: () => void call(c.online ? 'channelStop' : 'channelStart', { id: c.id }), style: { marginLeft: 'auto', padding: '4px 10px', borderRadius: 6, border: 'none', cursor: 'pointer', background: 'var(--dsw-alias-interactive-bg-hover, #eee)' } },
            c.online ? t('action.stop') : t('action.start'),
          ),
        )
      })
    }
    return list(proposals, (proposal, index) => {
      const p = proposal as { proposalId?: string; name?: string; status?: string; description?: string }
      return React.createElement(
        'div',
        { key: index, style: rowStyle },
        React.createElement('span', null, `${p.name ?? ''} [${p.status ?? ''}]`),
        React.createElement('span', { style: { color: 'var(--dsw-alias-label-caption, #999)' }, title: p.description ?? '' }, (p.description ?? '').slice(0, 40)),
        React.createElement(
          'button',
          { onClick: () => void call('autoskillsApprove', { proposalId: p.proposalId }), style: { marginLeft: 'auto', padding: '4px 10px', borderRadius: 6, border: 'none', cursor: 'pointer', background: '#2e7d32', color: '#fff' } },
          t('action.approve'),
        ),
        React.createElement(
          'button',
          { onClick: () => void call('autoskillsReject', { proposalId: p.proposalId }), style: { padding: '4px 10px', borderRadius: 6, border: 'none', cursor: 'pointer', background: 'var(--dsw-alias-interactive-bg-hover, #eee)' } },
          t('action.reject'),
        ),
      )
    })
  }

  return React.createElement(
    'div',
    { style: panelStyle },
    React.createElement(
      'div',
      { style: headerStyle },
      React.createElement('strong', null, t('panel.title')),
      React.createElement(
        'button',
        { onClick: onClose, style: { border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 16 } },
        t('action.close'),
      ),
    ),
    React.createElement('div', { style: tabsStyle }, tabButton('projects', t('tab.projects')), tabButton('memory', t('tab.memory')), tabButton('scheduler', t('tab.scheduler')), tabButton('channels', t('tab.channels')), tabButton('autoskills', t('tab.autoskills'))),
    React.createElement('div', { style: bodyStyle }, body()),
  )
}

/** 记忆提示条（composer 上方 dock）。 */
function MemoryDock({ sessionId, ctx, t }: { sessionId: string; ctx: Context; t: Translate }) {
  const [summary, setSummary] = React.useState<string>('')
  React.useEffect(() => {
    let cancelled = false
    const remote = (ctx as unknown as { remote?: Record<string, unknown> }).remote as Record<string, unknown> | undefined
    const evosci = remote?.evosci as Record<string, (a?: unknown) => Promise<unknown>> | undefined
    if (!evosci?.memoryPacket) return
    void evosci.memoryPacket({ sessionId }).then((value) => {
      if (cancelled) return
      const packet = value as { catalog?: unknown[]; states?: unknown[]; hits?: unknown[] } | null
      if (packet) {
        const states = Array.isArray(packet.states) ? packet.states.length : 0
        const hits = Array.isArray(packet.hits) ? packet.hits.length : 0
        setSummary(t('dock.summary', { states, hits }))
      } else {
        setSummary('')
      }
    })
    return () => { cancelled = true }
  }, [sessionId, ctx, t])

  if (!summary) return React.createElement(React.Fragment, null)
  return React.createElement(
    'div',
    { style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary, #888)', padding: '0 4px 4px', cursor: 'pointer' }, onClick: openResearchPanel, title: t('entry.title') },
    `🧠 ${summary}`,
  )
}

/** 侧栏底部入口按钮。 */
function SidebarEntry({ onClick, t }: { onClick: () => void; t: Translate }): React.ReactElement {
  return React.createElement(
    'button',
    {
      onClick,
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 10px',
        border: 'none',
        background: 'transparent',
        color: 'var(--dsw-alias-label-secondary, #666)',
        cursor: 'pointer',
        fontSize: 13,
      },
      title: t('entry.title'),
    },
    `🔬 ${t('entry.label')}`,
  )
}

/** Client 插件 apply：注册三个 Slot 与 i18n 字典。 */
export function apply(ctx: Context): void {
  const slots = ctx.get('slots')
  if (!slots) return

  // i18n 字典注册（生命周期随插件）
  const locale = ctx.get('locale')
  if (locale) {
    ctx.effect(() => locale.register(NS, DICT))
  }

  // 1) 侧栏底部入口
  slots.inject('sidebar.footer.action', () =>
    slots.register(
      { name: 'sidebar.footer.action', id: 'evosci-research', order: 90, locale: NS },
      (props: { t?: Translate }) => {
        const t = props.t ?? ((key: string) => key)
        const [open, setOpen] = React.useState(false)
        React.useEffect(() => {
          const listener = (): void => setOpen(true)
          window.addEventListener(PANEL_EVENT, listener)
          return () => window.removeEventListener(PANEL_EVENT, listener)
        }, [])
        return React.createElement(
          React.Fragment,
          null,
          React.createElement(SidebarEntry, { onClick: () => setOpen(true), t }),
          open ? React.createElement(ResearchPanel, { ctx, onClose: () => setOpen(false), t }) : null,
        )
      },
    ),
  )

  // 2) 科研面板 overlay（独立注册，保证入口与面板解耦）
  slots.inject('shell.overlay', () =>
    slots.register(
      { name: 'shell.overlay', id: 'evosci-research-panel', order: 100, locale: NS },
      (props: { t?: Translate }) => {
        const t = props.t ?? ((key: string) => key)
        const [open, setOpen] = React.useState(false)
        React.useEffect(() => {
          const listener = (): void => setOpen(true)
          window.addEventListener(PANEL_EVENT, listener)
          return () => window.removeEventListener(PANEL_EVENT, listener)
        }, [])
        return open ? React.createElement(ResearchPanel, { ctx, onClose: () => setOpen(false), t }) : null
      },
    ),
  )

  // 3) 会话记忆提示条（composer 上方 dock）
  slots.inject('conversation.input.dock', () =>
    slots.register(
      {
        name: 'conversation.input.dock',
        id: 'evosci-memory-dock',
        order: 90,
        locale: NS,
        inject: (sessionId: string) => ({ sessionId }),
      },
      (props: { sessionId?: string; t?: Translate }) =>
        props.sessionId
          ? React.createElement(MemoryDock, { sessionId: props.sessionId, ctx, t: props.t ?? ((key: string) => key) })
          : React.createElement(React.Fragment, null),
    ),
  )
}

export default { apply, inject }
