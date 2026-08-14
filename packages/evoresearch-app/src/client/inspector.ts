/**
 * 右侧 inspector（会话/工作区检查）：
 * 顶部 Tabs（Workspace / Agents / Side chats）+ X 关闭；
 * Workspace 下有 Tree/By type 二级视图与空态。
 */
import { jsx, jsxs, Fragment } from 'react/jsx-runtime'
import { useState } from 'react'
import { FolderOpen, Bot, MessagesSquare, X, Download, RefreshCw, Files } from 'lucide-react'
import { t } from './i18n'

export type InspectorTab = 'workspace' | 'agents' | 'chats'

export interface InspectorProps {
  tab: InspectorTab
  onTab: (t: InspectorTab) => void
  onClose: () => void
  /** 会话上下文（workspace 视图可显示当前工作区） */
  workspaceName: string | null
}

const TABS = [
  { key: 'workspace', label: t('workspace'), icon: FolderOpen },
  { key: 'agents', label: t('agents'), icon: Bot },
  { key: 'chats', label: t('sideChats'), icon: MessagesSquare },
] as const

export function Inspector({ tab, onTab, onClose, workspaceName }: InspectorProps) {
  const [subTab, setSubTab] = useState<'tree' | 'bytype'>('tree')

  return jsxs('div', {
    className: 'evo-insp',
    children: [
      jsxs('div', {
        className: 'evo-insp-tabs',
        children: [
          ...TABS.map((t) => {
            const Icon = t.icon
            return jsx('button', {
              type: 'button',
              className: 'evo-insp-tab',
              'data-active': tab === t.key || undefined,
              onClick: () => onTab(t.key),
              children: jsxs(Fragment, { children: [jsx(Icon, {}), jsx('span', { children: t.label })] }),
            }, t.key)
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
                jsxs('div', {
                  className: 'evo-insp-empty',
                  children: [
                    jsx(Files, {}),
                    jsx('div', { children: workspaceName === null ? t('noFilesYet') : `Workspace: ${workspaceName}` }),
                  ],
                }),
              ],
            })
          : jsxs('div', {
              className: 'evo-insp-empty',
              children: [
                jsx(tab === 'agents' ? Bot : MessagesSquare, {}),
                jsx('div', { children: tab === 'agents' ? t('noActiveAgents') : t('noSideChats') }),
              ],
            }),
      }),
    ],
  })
}
