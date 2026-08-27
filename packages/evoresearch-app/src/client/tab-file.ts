/**
 * 中央工作区「文件 tab」：按文件类型适配显示。
 *
 * - .md / .markdown：渲染 / 编辑 双模式（预览用 renderMarkdown，编辑用 textarea，
 *   两者可切换；保存写回磁盘）。
 * - 其它文本：纯 textarea 编辑。
 * - PDF：index.ts 已用 iframe 独立 tab（kind=pdf），不走这里。
 *
 * 数据经 /evoresearch/fs/read + /write（host 侧 workspace-api.ts）。
 * 内容单一数据源：tab.draft（父级 WorkspaceTab）；本组件打开时若 draft 为空
 * 自动读取文件内容回填，输入/渲染后再同步回 draft。
 */
import { jsx, jsxs, Fragment } from 'react/jsx-runtime'
import { useState, useEffect } from 'react'
import { t } from './i18n'
import { renderMarkdown } from './markdown'
import { Eye, PencilLine, Save } from 'lucide-react'

const MD_EXT = new Set(['.md', '.markdown'])

export interface TabFileEditorProps {
  path: string
  root: string
  draft?: string
  onDraft: (text: string) => void
  onSave: () => void
}

/** 工作区文件 tab（按类型适配：md 渲染/编辑、其它文本编辑）。 */
export function TabFileEditor({ path, root, draft, onDraft, onSave }: TabFileEditorProps) {
  const [loaded, setLoaded] = useState(draft !== undefined && draft !== '')
  const [mode, setMode] = useState<'edit' | 'preview'>('preview')
  const [readError, setReadError] = useState<string | null>(null)
  const isMarkdown = MD_EXT.has(path.slice(path.lastIndexOf('.')).toLowerCase())

  // 打开时自动读取文件内容（draft 为空才读；避免覆盖父级已填充的 draft）
  useEffect(() => {
    if (loaded || draft !== undefined && draft !== '') { setLoaded(true); return }
    let cancelled = false
    void fetch('/evoresearch/fs/read', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path }),
    }).then((res) => res.json()).then((json) => {
      if (cancelled) return
      if (json.ok === true) { onDraft(String(json.value.text ?? '')); setLoaded(true); setReadError(null) }
      else setReadError(json.error?.message ?? '读取失败')
    }).catch((e) => { if (!cancelled) setReadError(String(e)) })
    return () => { cancelled = true }
  }, [path])

  const name = path.slice(Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/')) + 1) || path
  const text = draft ?? ''

  // ── 通用头部：文件路径 + 保存 ──
  const head = jsxs('div', {
    className: 'evo-tab-editor-head',
    children: [
      jsx('span', { className: 'evo-tab-editor-path', children: path }),
      jsx('span', { style: { flex: 1 } }),
      // md 渲染/编辑切换（仅 markdown）
      isMarkdown && jsxs(Fragment, {
        children: [
          jsx('button', {
            type: 'button',
            className: `evo-btn evo-btn-run${mode === 'preview' ? ' evo-btn-active' : ''}`,
            title: '渲染预览',
            onClick: () => setMode('preview'),
            children: jsxs(Fragment, { children: [jsx(Eye, {}), jsx('span', { children: '预览' })] }),
          }),
          jsx('button', {
            type: 'button',
            className: `evo-btn evo-btn-run${mode === 'edit' ? ' evo-btn-active' : ''}`,
            title: '编辑源码',
            onClick: () => setMode('edit'),
            children: jsxs(Fragment, { children: [jsx(PencilLine, {}), jsx('span', { children: '编辑' })] }),
          }),
        ],
      }),
      jsx('button', {
        type: 'button',
        className: 'evo-btn evo-btn-run',
        onClick: onSave,
        children: jsxs(Fragment, { children: [jsx(Save, {}), jsx('span', { children: t('save') })] }),
      }),
    ],
  })

  return jsxs('div', {
    className: 'evo-tab-body evo-tab-editor-body evo-tab-file-body',
    children: [
      head,
      readError !== null && jsx('div', { className: 'evo-panel-error', children: readError }),
      !loaded
        ? jsx('div', { className: 'evo-panel-hint', children: t('loading') })
        : isMarkdown
          ? (mode === 'preview'
            ? jsx('div', { className: 'evo-tab-file-preview evo-md', dangerouslySetInnerHTML: { __html: renderMarkdown(text) } })
            : jsx('textarea', {
                className: 'evo-tab-editor evo-tab-file-edit',
                value: text,
                spellCheck: false,
                onInput: (e) => onDraft(e.currentTarget.value),
                onKeyDown: (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); onSave() } },
              }))
          : jsx('textarea', {
              className: 'evo-tab-editor evo-tab-file-edit',
              value: text,
              spellCheck: false,
              onInput: (e) => onDraft(e.currentTarget.value),
              onKeyDown: (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); onSave() } },
            }),
    ],
  })
}
