/**
 * 「+」新建标签菜单内嵌的工作区文件选择器：
 * 懒加载目录树（/evoresearch/fs/list），点击文件 → 打开编辑器/PDF 标签。
 * 文本类文件走编辑器，.pdf 走预览；其它文件也尝试用编辑器打开（只读文本）。
 */
import { jsx, jsxs, Fragment } from 'react/jsx-runtime'
import { useState, useEffect } from 'react'
import { t } from './i18n'
import { ChevronRight, ChevronDown, Folder, FileText, FileCode2, Image as ImageIcon, File, FolderOpen, RefreshCw } from 'lucide-react'

interface FsEntry { name: string; path: string; isDir: boolean; hidden: boolean }

const TEXT_EXT = new Set(['.md', '.txt', '.json', '.ts', '.tsx', '.js', '.mjs', '.cjs', '.css', '.yml', '.yaml', '.rs', '.toml', '.py', '.html', '.htm', '.svg', '.xml', '.sql', '.csv'])
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.avif'])

function kindOf(name: string): 'text' | 'pdf' | 'image' | 'other' {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase()
  if (TEXT_EXT.has(ext)) return 'text'
  if (ext === '.pdf') return 'pdf'
  if (IMAGE_EXT.has(ext)) return 'image'
  return 'other'
}

function FileIcon({ name }: { name: string }) {
  const kind = kindOf(name)
  const icon = kind === 'image' ? ImageIcon : kind === 'text' ? FileCode2 : File
  return jsx(icon, {})
}

function TreeNode({ entry, depth, onPick }: { entry: FsEntry; depth: number; onPick: (path: string) => void }) {
  const [expanded, setExpanded] = useState(false)
  const [children, setChildren] = useState<FsEntry[] | null>(null)
  const [loading, setLoading] = useState(false)

  const toggle = async () => {
    if (!entry.isDir) { onPick(entry.path); return }
    if (children !== null) { setExpanded((v) => !v); return }
    setLoading(true)
    try {
      const res = await fetch('/evoresearch/fs/list', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ root: entry.path }),
      })
      const json = await res.json()
      setChildren(json.ok ? json.value.entries : [])
      setExpanded(true)
    } catch { setChildren([]) }
    setLoading(false)
  }

  return jsxs(Fragment, {
    children: [
      jsx('button', {
        type: 'button',
        className: 'evo-tab-tree-row',
        style: { paddingLeft: 8 + depth * 13 },
        onClick: () => void toggle(),
        title: entry.path,
        children: jsxs(Fragment, {
          children: [
            entry.isDir
              ? (expanded ? jsx(ChevronDown, {}) : jsx(ChevronRight, {}))
              : jsx('span', { className: 'evo-tab-tree-arrow' }),
            entry.isDir ? jsx(Folder, {}) : jsx(FileIcon, { name: entry.name }),
            jsx('span', { className: 'evo-tab-tree-name', children: entry.name }),
          ],
        }),
      }),
      expanded && (children ?? []).map((child) => jsx(TreeNode, { entry: child, depth: depth + 1, onPick }, child.path)),
      expanded && children !== null && children.length === 0 && jsx('div', {
        className: 'evo-tab-tree-empty',
        style: { paddingLeft: 24 + depth * 13 },
        children: t('emptyDir'),
      }),
    ],
  })
}

/** 工作区文件选择器（嵌入 + 菜单）。 */
export function WorkspaceTabPicker({ root, onPick }: { root: string; onPick: (path: string) => void }) {
  const [entries, setEntries] = useState<FsEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = () => {
    setEntries(null)
    setError(null)
    void fetch('/evoresearch/fs/list', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ root }),
    }).then((res) => res.json()).then((json) => {
      if (json.ok) setEntries(json.value.entries)
      else setError(json.error?.message ?? t('loadFailed'))
    }).catch((e: any) => setError(String(e?.message ?? e)))
  }

  useEffect(() => { load() }, [root])

  return jsxs('div', {
    className: 'evo-tab-tree',
    children: [
      jsxs('div', {
        className: 'evo-tab-tree-head',
        children: [
          jsx(FolderOpen, {}),
          jsx('span', { className: 'evo-tab-tree-root', children: root }),
          jsx('span', { style: { flex: 1 } }),
          jsx('button', {
            type: 'button',
            className: 'evo-tab-tree-refresh',
            title: t('refresh'),
            onClick: load,
            children: jsx(RefreshCw, {}),
          }),
        ],
      }),
      error !== null && jsx('div', { className: 'evo-tab-tree-error', children: error }),
      entries === null
        ? jsx('div', { className: 'evo-tab-tree-empty', children: t('loading') })
        : entries.length === 0
          ? jsx('div', { className: 'evo-tab-tree-empty', children: t('noFilesYet') })
          : entries.map((entry) => jsx(TreeNode, { entry, depth: 0, onPick }, entry.path)),
    ],
  })
}
