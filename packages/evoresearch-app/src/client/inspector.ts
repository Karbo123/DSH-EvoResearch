/**
 * 右侧 inspector（会话/工作区检查）：
 * 顶部 Tabs（Workspace / Agents / Side chats）+ X 关闭；
 * Workspace 下有 Tree/By type 二级视图与文件树；
 * Agents 显示当前会话的子代理树（POST /evoresearch/fs/agents）；
 * Side chats 显示当前 workspace 的侧边会话（fork 继承 + 空白，§22.3-22.4）。
 */
import { jsx, jsxs, Fragment } from 'react/jsx-runtime'
import { useEffect, useState } from 'react'
import { FolderOpen, Bot, MessagesSquare, X, Download, RefreshCw, ChevronRight, GitBranch, FilePlus2, MessageSquare, Trash2 } from 'lucide-react'
import { t } from './i18n'
import { WorkspaceFiles } from './workspace-files'

export type InspectorTab = 'workspace' | 'agents' | 'chats'

export interface SideChatRow {
  id: string
  title: string
  kind: 'fork' | 'blank'
}

export interface InspectorProps {
  tab: InspectorTab
  onTab: (t: InspectorTab) => void
  onClose: () => void
  /** 工作区根目录（当前会话 cwd；无会话时为 null）。 */
  cwd: string | null
  /** 当前会话 id（Agents 树根；无会话时为 null）。 */
  sessionId: string | null
  /** 当前 workspace 的侧边会话列表。 */
  sideChats: SideChatRow[]
  onNewSideChat: (kind: 'inherit' | 'blank') => void
  onOpenSideChat: (id: string) => void
  /** 删除侧聊会话（host 删除持久化数据；返回是否成功）。 */
  onDeleteSideChat: (id: string) => Promise<{ ok: boolean; error?: string }>
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

export function Inspector({ tab, onTab, onClose, cwd, sessionId, sideChats, onNewSideChat, onOpenSideChat, onDeleteSideChat }: InspectorProps) {
  // 两段式删除确认：第一次点击进入确认态，5 秒无操作还原
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false)
  const armDelete = (id: string) => {
    setConfirmDelete(id)
    setTimeout(() => setConfirmDelete((v) => (v === id ? null : v)), 5000)
  }
  const runDelete = (id: string) => {
    void onDeleteSideChat(id)
    setConfirmDelete(null)
  }
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
                className: 'evo-sidechats',
                children: [
                  jsxs('div', {
                    className: 'evo-insp-subtabs',
                    children: [
                      jsx('button', {
                        type: 'button',
                        className: 'evo-insp-subtab evo-sidechat-new',
                        disabled: sessionId === null,
                        title: 'New side chat（继承当前会话历史）',
                        onClick: () => onNewSideChat('inherit'),
                        children: jsxs(Fragment, { children: [jsx(GitBranch, {}), jsx('span', { children: 'Inherit' })] }),
                      }),
                      jsx('button', {
                        type: 'button',
                        className: 'evo-insp-subtab evo-sidechat-new',
                        disabled: sessionId === null,
                        title: 'New blank side chat（仅继承 workspace）',
                        onClick: () => onNewSideChat('blank'),
                        children: jsxs(Fragment, { children: [jsx(FilePlus2, {}), jsx('span', { children: 'Blank' })] }),
                      }),
                      jsx('span', { style: { flex: 1 } }),
                      jsx('button', { type: 'button', className: 'evo-icon-btn', title: 'Refresh', onClick: () => { window.dispatchEvent(new CustomEvent('evo-sidechats-refresh')) }, children: jsx(RefreshCw, {}) }),
                      // 删除当前 workspace 全部 Side Chat（§22.4，两段式确认）
                      (sideChats ?? []).length > 0 && (confirmDeleteAll
                        ? jsx('button', {
                            type: 'button',
                            className: 'evo-icon-btn evo-del-confirm',
                            title: 'Confirm delete all side chats — cannot be undone',
                            'aria-label': 'Confirm delete all side chats',
                            onClick: () => {
                              setConfirmDeleteAll(false)
                              for (const sc of sideChats ?? []) void onDeleteSideChat(sc.id)
                            },
                            children: 'Delete all?',
                          })
                        : jsx('button', {
                            type: 'button',
                            className: 'evo-icon-btn evo-del',
                            title: 'Delete all side chats',
                            'aria-label': 'Delete all side chats',
                            onClick: () => { setConfirmDeleteAll(true); setTimeout(() => setConfirmDeleteAll(false), 5000) },
                            children: jsx(Trash2, {}),
                          })),
                    ],
                  }),
                  (sideChats ?? []).length === 0
                    ? jsxs('div', {
                        className: 'evo-insp-empty',
                        children: [jsx(MessagesSquare, {}), jsx('div', { children: t('noSideChats') })],
                      })
                    : jsx('div', {
                        className: 'evo-sidechat-list',
                        children: (sideChats ?? []).map((sc) => jsxs('div', {
                          className: 'evo-sidechat-tab',
                          children: [
                            sc.kind === 'fork' ? jsx(GitBranch, {}) : jsx(FilePlus2, {}),
                            jsx('button', {
                              type: 'button',
                              className: 'evo-sidechat-tab-main',
                              onClick: () => onOpenSideChat(sc.id),
                              children: sc.title,
                            }),
                            confirmDelete === sc.id
                              ? jsx('button', {
                                  type: 'button',
                                  className: 'evo-icon-btn evo-del-confirm',
                                  title: 'Confirm delete — this cannot be undone',
                                  'aria-label': 'Confirm delete side chat',
                                  onClick: () => runDelete(sc.id),
                                  children: 'Delete?',
                                })
                              : jsx('button', {
                                  type: 'button',
                                  className: 'evo-icon-btn evo-del',
                                  title: 'Delete side chat',
                                  'aria-label': 'Delete side chat',
                                  onClick: () => armDelete(sc.id),
                                  children: jsx(Trash2, {}),
                                }),
                          ],
                        }, sc.id)),
                      }),
                ],
              }),
      }),
    ],
  })
}
