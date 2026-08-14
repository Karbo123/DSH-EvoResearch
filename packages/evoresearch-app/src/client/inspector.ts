/**
 * 右侧 inspector（会话/工作区检查）：
 * 顶部 Tabs（Workspace / Agents / Side chats）+ X 关闭；
 * Workspace 下有 Tree/By type 二级视图与文件树；
 * Agents 显示当前会话的子代理树（POST /evoresearch/fs/agents）。
 */
import { jsx, jsxs, Fragment } from 'react/jsx-runtime'
import { useEffect, useState } from 'react'
import { FolderOpen, Bot, MessagesSquare, X, Download, RefreshCw, ChevronRight } from 'lucide-react'
import { t } from './i18n'
import { WorkspaceFiles } from './workspace-files'

export type InspectorTab = 'workspace' | 'agents' | 'chats'

export interface InspectorProps {
  tab: InspectorTab
  onTab: (t: InspectorTab) => void
  onClose: () => void
  /** 工作区根目录（当前会话 cwd；无会话时为 null）。 */
  cwd: string | null
  /** 当前会话 id（Agents 树根；无会话时为 null）。 */
  sessionId: string | null
}

const TABS = [
  { key: 'workspace', label: t('workspace'), icon: FolderOpen },
  { key: 'agents', label: t('agents'), icon: Bot },
  { key: 'chats', label: t('sideChats'), icon: MessagesSquare },
] as const

interface AgentRow {
  id: string
  mode: 'one-shot' | 'continuable'
  label: string | null
  activity: 'running' | 'idle'
  hasChildren: boolean
  parentId: string | null
  depth: number
}

/** Agents 面板：子代理树（带深度缩进、运行态、模式徽标）。 */
function AgentsPanel({ sessionId }: { sessionId: string | null }) {
  const [agents, setAgents] = useState<AgentRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = () => {
    if (sessionId === null) { setAgents([]); setError(null); return }
    setAgents(null)
    setError(null)
    void fetch('/evoresearch/fs/agents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    }).then((res) => res.json()).then((json) => {
      if (json.ok) setAgents(json.value.agents as AgentRow[])
      else setError(json.error?.message ?? '加载失败')
    }).catch((e) => setError(String(e)))
  }

  useEffect(() => { load() }, [sessionId])

  const shortId = (id: string) => (id.length > 10 ? `${id.slice(0, 10)}…` : id)

  return jsxs('div', {
    className: 'evo-agents',
    children: [
      jsxs('div', {
        className: 'evo-insp-subtabs',
        children: [
          jsx('span', { className: 'evo-insp-subtab-title', children: sessionId === null ? t('noActiveConversation') : 'Agents' }),
          jsx('span', { style: { flex: 1 } }),
          jsx('button', { type: 'button', className: 'evo-icon-btn', title: 'Refresh', onClick: load, children: jsx(RefreshCw, {}) }),
        ],
      }),
      error !== null && jsx('div', { className: 'evo-panel-error', children: error }),
      agents === null
        ? jsx('div', { className: 'evo-insp-empty', children: jsx('div', { children: 'Loading…' }) })
        : agents.length === 0
          ? jsxs('div', {
              className: 'evo-insp-empty',
              children: [jsx(Bot, {}), jsx('div', { children: t('noActiveAgents') })],
            })
          : jsx('div', {
              className: 'evo-agent-list',
              children: agents.map((a) => jsx('div', {
                className: 'evo-agent-row',
                style: { paddingLeft: `${10 + (a.depth - 1) * 18}px` },
                children: jsxs(Fragment, {
                  children: [
                    a.hasChildren
                      ? jsx(ChevronRight, { className: 'evo-agent-chevron' })
                      : jsx('span', { className: 'evo-agent-chevron evo-agent-chevron-empty' }),
                    jsx('span', { className: `evo-agent-dot${a.activity === 'running' ? ' running' : ''}` }),
                    jsx('span', { className: 'evo-agent-name', children: a.label ?? shortId(a.id) }),
                    jsx('span', { className: `evo-agent-mode${a.mode === 'continuable' ? ' continuable' : ''}`, children: a.mode }),
                    a.activity === 'running' && jsx('span', { className: 'evo-agent-activity', children: 'running' }),
                  ],
                }),
              }, a.id)),
            }),
    ],
  })
}

export function Inspector({ tab, onTab, onClose, cwd, sessionId }: InspectorProps) {
  const [subTab, setSubTab] = useState<'tree' | 'bytype'>('tree')

  return jsxs('div', {
    className: 'evo-insp',
    children: [
      jsxs('div', {
        className: 'evo-insp-tabs',
        children: [
          ...TABS.map((tabDef) => {
            const Icon = tabDef.icon
            return jsx('button', {
              type: 'button',
              className: 'evo-insp-tab',
              'data-active': tab === tabDef.key || undefined,
              onClick: () => onTab(tabDef.key),
              children: jsxs(Fragment, { children: [jsx(Icon, {}), jsx('span', { children: tabDef.label })] }),
            }, tabDef.key)
          }),
          jsx('button', {
            type: 'button',
            className: 'evo-icon-btn evo-insp-close',
            onClick: onClose,
            title: 'Close inspector',
            children: jsx(X, {}),
          }),
        ],
      }),
      jsx('div', {
        className: 'evo-insp-body',
        children: tab === 'workspace'
          ? jsxs(Fragment, {
              children: [
                jsxs('div', {
                  className: 'evo-insp-subtabs',
                  children: [
                    jsx('button', {
                      type: 'button',
                      className: 'evo-insp-subtab',
                      'data-active': subTab === 'tree' || undefined,
                      onClick: () => setSubTab('tree'),
                      children: 'Tree',
                    }),
                    jsx('button', {
                      type: 'button',
                      className: 'evo-insp-subtab',
                      'data-active': subTab === 'bytype' || undefined,
                      onClick: () => setSubTab('bytype'),
                      children: 'By type',
                    }),
                    jsx('span', { style: { flex: 1 } }),
                    jsx('button', { type: 'button', className: 'evo-icon-btn', title: 'Refresh', children: jsx(RefreshCw, {}) }),
                    jsx('button', { type: 'button', className: 'evo-icon-btn', title: 'Download', children: jsx(Download, {}) }),
                  ],
                }),
                jsx(WorkspaceFiles, { root: cwd }),
              ],
            })
          : tab === 'agents'
            ? jsx(AgentsPanel, { sessionId })
            : jsxs('div', {
                className: 'evo-insp-empty',
                children: [jsx(MessagesSquare, {}), jsx('div', { children: t('noSideChats') })],
              }),
      }),
    ],
  })
}
