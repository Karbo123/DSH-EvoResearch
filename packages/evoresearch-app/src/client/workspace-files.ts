/**
 * 工作区文件浏览器（Inspector → Workspace tab）。
 *
 * 目录树懒加载（点击文件夹展开），文本文件内联编辑（Ctrl+S / 保存按钮，
 * 写操作限制在根目录内），图片/PDF/HTML 内联预览。
 * 数据经 /evoresearch/fs/* HTTP API（host 侧 workspace-api.ts）。
 */
import { jsx, jsxs, Fragment } from 'react/jsx-runtime'
import { useState, useEffect, useRef } from 'react'
import { t } from './i18n'
import { ChevronRight, ChevronDown, Folder, FileText, FileCode2, Image as ImageIcon, File, RefreshCw, ArrowUp, Save, Upload, Archive, ExternalLink } from 'lucide-react'

interface FsEntry { name: string; path: string; isDir: boolean; hidden: boolean }

const TEXT_EXT = new Set(['.md', '.txt', '.json', '.ts', '.tsx', '.js', '.mjs', '.cjs', '.css', '.yml', '.yaml', '.rs', '.toml', '.py', '.html', '.htm', '.svg', '.xml', '.env', '.sql'])
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.avif'])

function fileKind(name: string): 'text' | 'image' | 'pdf' | 'html' | 'other' {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase()
  if (TEXT_EXT.has(ext)) return 'text'
  if (IMAGE_EXT.has(ext)) return 'image'
  if (ext === '.pdf') return 'pdf'
  if (ext === '.html' || ext === '.htm') return 'html'
  return 'other'
}

function FileIcon({ name }: { name: string }) {
  const kind = fileKind(name)
  const icon = kind === 'image' ? ImageIcon : kind === 'other' ? File : FileCode2
  return jsx(icon, {})
}

export interface WorkspaceFilesProps {
  /** 工作区根目录（当前会话 cwd；无会话时为 null）。 */
  root: string | null
}

/** 目录树节点（懒加载）。 */
function TreeNode({ entry, root, depth, onOpenFile }: {
  entry: FsEntry
  root: string
  depth: number
  onOpenFile: (path: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [children, setChildren] = useState<FsEntry[] | null>(null)
  const [loading, setLoading] = useState(false)

  const toggle = async () => {
    if (!entry.isDir) { onOpenFile(entry.path); return }
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
        className: `evo-fs-row${entry.hidden ? ' evo-fs-hidden' : ''}`,
        style: { paddingLeft: 8 + depth * 14 },
        onClick: () => void toggle(),
        children: jsxs(Fragment, {
          children: [
            entry.isDir
              ? (expanded ? jsx(ChevronDown, {}) : jsx(ChevronRight, {}))
              : jsx('span', { className: 'evo-fs-arrow' }),
            entry.isDir ? jsx(Folder, {}) : jsx(FileIcon, { name: entry.name }),
            jsx('span', { className: 'evo-fs-name', children: entry.name }),
          ],
        }),
      }),
      expanded && (children ?? []).map((child) => jsx(TreeNode, {
        entry: child,
        root,
        depth: depth + 1,
        onOpenFile,
      }, child.path)),
      expanded && children !== null && children.length === 0 && jsx('div', {
        className: 'evo-fs-empty',
        style: { paddingLeft: 24 + depth * 14 },
        children: t('emptyFolder'),
      }),
    ],
  })
}

/** 文件查看/编辑面板。 */
function FileViewer({ path, root, onBack }: { path: string; root: string; onBack: () => void }) {
  const kind = fileKind(path)
  const [text, setText] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setText(null); setDirty(false); setError(null)
    if (kind !== 'text') return
    let cancelled = false
    void fetch('/evoresearch/fs/read', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path }),
    }).then((res) => res.json()).then((json) => {
      if (cancelled) return
      if (json.ok) { setText(json.value.text); setError(null) }
      else setError(json.error?.message ?? '读取失败')
    }).catch((e) => { if (!cancelled) setError(String(e)) })
    return () => { cancelled = true }
  }, [path, kind])

  const save = async () => {
    if (text === null || !dirty) return
    setSaving(true)
    try {
      const res = await fetch('/evoresearch/fs/write', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ root, path, text }),
      })
      const json = await res.json()
      if (json.ok) { setDirty(false); setError(null) }
      else setError(json.error?.message ?? '保存失败')
    } catch (e) { setError(String(e)) }
    setSaving(false)
  }

  const name = path.slice(path.lastIndexOf('\\') + 1).slice(path.lastIndexOf('/') + 1) || path

  return jsxs('div', {
    className: 'evo-fs-viewer',
    children: [
      jsxs('div', {
        className: 'evo-fs-viewer-head',
        children: [
          jsx('button', { type: 'button', className: 'evo-icon-btn', onClick: onBack, title: t('back'), children: jsx(ArrowUp, {}) }),
          jsx('span', { className: 'evo-fs-viewer-name', children: name }),
          (kind === 'pdf' || kind === 'text') && jsx('button', {
            type: 'button',
            className: 'evo-icon-btn',
            title: t('openInTab'),
            'aria-label': t('openInTab'),
            onClick: () => {
              window.dispatchEvent(new CustomEvent('evo-open-tab', { detail: { path, root, kind: kind === 'pdf' ? 'pdf' : 'editor' } }))
            },
            children: jsx(ExternalLink, {}),
          }),
          kind === 'text' && jsx('button', {
            type: 'button',
            className: 'evo-fs-save',
            disabled: !dirty || saving || text === null,
            onClick: () => void save(),
            children: jsxs(Fragment, { children: [jsx(Save, {}), jsx('span', { children: dirty ? t('save') : t('saved') })] }),
          }),
        ],
      }),
      error !== null && jsx('div', { className: 'evo-panel-error', children: error }),
      kind === 'text' && (text === null ? jsx('div', { className: 'evo-panel-hint', children: t('loading') }) : jsx('textarea', {
        className: 'evo-fs-editor',
        value: text,
        spellCheck: false,
        onInput: (e) => { setText(e.currentTarget.value); setDirty(true) },
        onKeyDown: (e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); void save() }
        },
      })),
      kind === 'image' && jsx('img', { className: 'evo-fs-image', src: `/evoresearch/fs/file?path=${encodeURIComponent(path)}`, alt: name }),
      kind === 'pdf' && jsx('iframe', { className: 'evo-fs-frame', src: `/evoresearch/fs/file?path=${encodeURIComponent(path)}`, title: name, sandbox: '' }),
      (kind === 'html' || kind === 'other') && jsx('div', {
        className: 'evo-panel-hint',
        children: kind === 'html' ? 'HTML 预览：' : '预览不支持此文件类型',
      }),
      (kind === 'html') && jsx('iframe', { className: 'evo-fs-frame', src: `/evoresearch/fs/file?path=${encodeURIComponent(path)}`, title: name, sandbox: '' }),
    ],
  })
}

/** 文件浏览器主体：根面包屑 + 树 + 文件查看。 */
export function WorkspaceFiles({ root }: WorkspaceFilesProps) {
  const [base, setBase] = useState<string | null>(root)
  const [entries, setEntries] = useState<FsEntry[] | null>(null)
  const [openPath, setOpenPath] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [rev, setRev] = useState(0)

  useEffect(() => { setBase(root); setOpenPath(null) }, [root])

  // ── 上传（§27.2 多文件/相对目录）与 workspace ZIP 下载 ──
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const dirInputRef = useRef<HTMLInputElement | null>(null)
  const [uploading, setUploading] = useState(false)
  const [zipBusy, setZipBusy] = useState(false)
  const uploadFiles = (files: Array<File & { webkitRelativePath?: string }>) => {
    if (base === null || files.length === 0) return
    setUploading(true)
    setError(null)
    let pending = files.length
    let failed = false
    for (const file of files) {
      const reader = new FileReader()
      reader.onload = () => {
        const dataUrl = String(reader.result ?? '')
        const data = dataUrl.slice(dataUrl.indexOf(',') + 1)
        const rel = (file.webkitRelativePath ?? '').split('/').slice(1).join('/') || file.name
        void fetch('/evoresearch/fs/upload', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ root: base, path: rel, data }),
        }).then((r) => r.json()).then((json) => {
          if (json.ok !== true) failed = true
          pending -= 1
          if (pending === 0) {
            setUploading(false)
            if (failed) setError('部分文件上传失败（可能超出 5MB 或路径非法）')
            setRev((v) => v + 1)
          }
        }).catch(() => {
          failed = true
          pending -= 1
          if (pending === 0) { setUploading(false); setError('上传失败'); setRev((v) => v + 1) }
        })
      }
      reader.readAsDataURL(file)
    }
  }
  const downloadZip = () => {
    if (base === null) return
    setZipBusy(true)
    setError(null)
    void fetch('/evoresearch/fs/zip', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ root: base }),
    }).then((r) => r.json()).then((json) => {
      setZipBusy(false)
      if (json.ok !== true) { setError(json.error?.message ?? '打包失败'); return }
      const bytes = Uint8Array.from(atob(json.value.data as string), (c) => c.charCodeAt(0))
      const blob = new Blob([bytes], { type: 'application/zip' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${base.split('\\').pop() ?? 'workspace'}.zip`
      document.body.appendChild(anchor)
      anchor.click()
      document.body.removeChild(anchor)
      setTimeout(() => URL.revokeObjectURL(url), 5000)
    }).catch((e) => { setZipBusy(false); setError(String(e)) })
  }

  useEffect(() => {
    if (base === null) { setEntries(null); return }
    let cancelled = false
    setEntries(null)
    void fetch('/evoresearch/fs/list', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ root: base }),
    }).then((res) => res.json()).then((json) => {
      if (cancelled) return
      if (json.ok) { setEntries(json.value.entries); setError(null) }
      else setError(json.error?.message ?? '列表失败')
    }).catch((e) => { if (!cancelled) setError(String(e)) })
    return () => { cancelled = true }
  }, [base, rev])

  if (base === null) {
    return jsx('div', { className: 'evo-insp-empty', children: jsx('div', { children: t('noActiveWorkspace') }) })
  }

  if (openPath !== null) {
    return jsx(FileViewer, { path: openPath, root: base, onBack: () => setOpenPath(null) })
  }

  const parent = base.slice(0, base.lastIndexOf('\\')) || base.slice(0, base.lastIndexOf('/'))

  return jsxs('div', {
    className: 'evo-fs',
    children: [
      jsxs('div', {
        className: 'evo-fs-toolbar',
        children: [
          jsx('button', { type: 'button', className: 'evo-icon-btn', onClick: () => setRev((v) => v + 1), title: t('refresh'), children: jsx(RefreshCw, {}) }),
          jsx('button', {
            type: 'button',
            className: 'evo-icon-btn',
            onClick: () => fileInputRef.current?.click(),
            disabled: uploading,
            title: uploading ? t('uploading') : t('uploadFiles'),
            'aria-label': t('uploadFiles'),
            children: jsx(Upload, {}),
          }),
          jsx('button', {
            type: 'button',
            className: 'evo-icon-btn',
            onClick: () => dirInputRef.current?.click(),
            disabled: uploading,
            title: t('uploadFolder'),
            'aria-label': t('uploadFolder'),
            children: jsx(Folder, {}),
          }),
          jsx('button', {
            type: 'button',
            className: 'evo-icon-btn',
            onClick: () => void downloadZip(),
            disabled: zipBusy,
            title: zipBusy ? t('zipping') : t('downloadWorkspaceZip'),
            'aria-label': t('downloadWorkspaceZip'),
            children: jsx(Archive, {}),
          }),
          jsx('input', {
            ref: fileInputRef,
            type: 'file',
            multiple: true,
            hidden: true,
            onChange: (e) => { uploadFiles(Array.from(e.currentTarget.files ?? [])); e.currentTarget.value = '' },
          }),
          jsx('input', {
            ref: dirInputRef,
            type: 'file',
            webkitdirectory: '',
            hidden: true,
            onChange: (e) => { uploadFiles(Array.from(e.currentTarget.files ?? [])); e.currentTarget.value = '' },
          }),
          jsx('span', { className: 'evo-fs-crumb', children: base }),
        ],
      }),
      error !== null && jsx('div', { className: 'evo-panel-error', children: error }),
      entries === null ? jsx('div', { className: 'evo-panel-hint', children: t('loading') }) : jsx('div', {
        className: 'evo-fs-tree',
        children: entries.map((entry) => jsx(TreeNode, {
          entry,
          root: base,
          depth: 0,
          onOpenFile: setOpenPath,
        }, entry.path)),
      }),
    ],
  })
}
