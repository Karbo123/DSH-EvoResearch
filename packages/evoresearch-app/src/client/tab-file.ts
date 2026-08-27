/**
 * 中央工作区「文件 tab」：按文件类型适配显示。
 *
 * - .md / .markdown：Milkdown 所见即所得实时编辑器（与对话输入框同款：
 *   格式化工具条常开、敲 Markdown 语法即刻渲染），保存写回磁盘。
 * - 其它文本：纯 textarea 编辑。
 * - PDF：index.ts 已用 iframe 独立 tab（kind=pdf），不走这里。
 *
 * 数据经 /evoresearch/fs/read + /write（host 侧 workspace-api.ts）。
 * 编辑器内部为 Markdown 真相源；markdownUpdated 同步回 tab.draft（父级单一数据源）。
 */
import { jsx, jsxs, Fragment } from 'react/jsx-runtime'
import { useState, useEffect, useRef } from 'react'
import { t } from './i18n'
import { Editor, rootCtx, defaultValueCtx, commandsCtx, editorViewCtx } from '@milkdown/core'
import { TextSelection } from '@milkdown/prose/state'
import {
  commonmark,
  wrapInHeadingCommand, toggleStrongCommand, toggleEmphasisCommand,
  insertHrCommand, wrapInBlockquoteCommand, wrapInBulletListCommand, wrapInOrderedListCommand,
  toggleLinkCommand, toggleInlineCodeCommand, createCodeBlockCommand,
} from '@milkdown/preset-commonmark'
import { gfm, insertTableCommand, toggleStrikethroughCommand } from '@milkdown/preset-gfm'
import { history as milkdownHistory } from '@milkdown/plugin-history'
import { listener, listenerCtx } from '@milkdown/plugin-listener'
import { Dropdown } from './dropdown'
import { TabMonacoEditor } from './tab-monaco'
import { Heading1, Bold, Italic, Strikethrough, Minus, Quote, List, ListOrdered, Table2, Link as LinkIcon, Code, Code2, Save } from 'lucide-react'

const MD_EXT = new Set(['.md', '.markdown'])

export interface TabFileEditorProps {
  path: string
  root: string
  draft?: string
  onDraft: (text: string) => void
  onSave: () => void
}

/** Typora 式代码块退出：光标位于代码块内空行按 Enter 跳出（与 composer 同款）。 */
function tryExitCodeBlock(view: any): boolean {
  const { state } = view
  if (!state.selection.empty) return false
  const { $from } = state.selection
  const parent = $from.parent
  if (parent.type.name !== 'code_block') return false
  const start = $from.start()
  const cursor = $from.pos
  const before = state.doc.textBetween(start, cursor)
  if (!before.endsWith('\n')) return false
  let b = before
  while (b.endsWith('\n')) b = b.slice(0, -1)
  let a = state.doc.textBetween(cursor, $from.end())
  while (a.startsWith('\n')) a = a.slice(1)
  const schema = state.schema
  const pos = $from.before()
  const nodes: Array<any> = []
  if (b !== '') nodes.push(schema.nodes.code_block.create(parent.attrs, schema.text(b)))
  nodes.push(schema.nodes.paragraph.create(null))
  if (a !== '') nodes.push(schema.nodes.code_block.create(parent.attrs, schema.text(a)))
  const tr = state.tr.replaceWith(pos, pos + parent.nodeSize, nodes)
  let paraPos = pos
  if (b !== '') paraPos += 2 + b.length
  const resolved = tr.doc.resolve(Math.min(paraPos + 1, tr.doc.content.size))
  tr.setSelection(TextSelection.near(resolved))
  view.dispatch(tr)
  view.focus()
  return true
}

/** Milkdown 所见即所得编辑器（文件 tab 版，与对话输入框同款交互）。 */
function MarkdownLive({ initial, onMarkdown, onSave }: { initial: string; onMarkdown: (md: string) => void; onSave: () => void }) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<unknown>(null)
  const onMarkdownRef = useRef(onMarkdown)
  onMarkdownRef.current = onMarkdown
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkDraft, setLinkDraft] = useState('')
  const [headingValue, setHeadingValue] = useState('0')

  const runCommand = (command: any, payload?: any) => {
    const instance = editorRef.current as { action(fn: (ctx: any) => void): void } | null
    instance?.action((ctx: any) => {
      const key = typeof command === 'string' ? command : (command?.key ?? command)
      ctx.get(commandsCtx).call(key, payload)
    })
  }
  const HEADING_OPTIONS = [
    { value: '0', label: t('mdParagraph') },
    ...Array.from({ length: 6 }, (_unused, i) => ({ value: String(i + 1), label: `H${i + 1}` })),
  ]

  useEffect(() => {
    const host = hostRef.current
    if (host === null) return
    let disposed = false
    const onKeydownCapture = (event: KeyboardEvent) => {
      if (event.isComposing || event.key !== 'Enter' || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return
      const instance = editorRef.current as { action(fn: (ctx: any) => void): void } | null
      if (instance === null) return
      const exited = instance.action((ctx: any) => tryExitCodeBlock(ctx.get(editorViewCtx)))
      if (exited) {
        event.preventDefault()
        event.stopImmediatePropagation()
      }
    }
    // 捕获阶段拦截（ProseMirror 的 keydown 处理不检查 defaultPrevented）
    host.addEventListener('keydown', onKeydownCapture, true)
    const editor = Editor.make()
      .config((ctx: any) => {
        ctx.set(rootCtx, host)
        ctx.set(defaultValueCtx, initial)
        ctx.get(listenerCtx)
          .markdownUpdated((_ctx: unknown, md: string) => {
            onMarkdownRef.current(md)
          })
      })
      .use(commonmark)
      .use(gfm)
      .use(milkdownHistory)
      .use(listener)
      .create()
    void editor.then((instance: any) => {
      if (disposed) { void instance.destroy(); return }
      editorRef.current = instance
    })
    return () => {
      disposed = true
      void editor.then((instance: any) => instance.destroy())
      host.removeEventListener('keydown', onKeydownCapture, true)
    }
  }, [])

  return jsx('div', {
    className: 'evo-composer-editor evo-tab-md-live',
    'data-markdown-toolbar-open': true,
    onKeyDown: (e: { key?: string; ctrlKey?: boolean; metaKey?: boolean; preventDefault: () => void }) => {
      if ((e.ctrlKey === true || e.metaKey === true) && e.key === 's') { e.preventDefault(); onSave() }
    },
    children: jsxs(Fragment, {
      children: [
        // ── 格式化工具条（常开；与输入框同一套按钮/命令）──
        jsxs('div', {
          className: 'evo-md-toolbar',
          children: [
            jsx(Dropdown, {
              value: headingValue,
              className: 'evo-md-heading',
              icon: Heading1,
              onChange: (v: string) => { setHeadingValue(v); runCommand(wrapInHeadingCommand, Number(v)) },
              options: HEADING_OPTIONS,
            }),
            jsx('button', { type: 'button', className: 'evo-md-btn', title: t('mdBold'), 'aria-label': t('mdBold'), onMouseDown: (e: { preventDefault: () => void }) => e.preventDefault(), onClick: () => runCommand(toggleStrongCommand), children: jsx(Bold, {}) }),
            jsx('button', { type: 'button', className: 'evo-md-btn', title: t('mdItalic'), 'aria-label': t('mdItalic'), onMouseDown: (e: { preventDefault: () => void }) => e.preventDefault(), onClick: () => runCommand(toggleEmphasisCommand), children: jsx(Italic, {}) }),
            jsx('button', { type: 'button', className: 'evo-md-btn', title: t('mdStrike'), 'aria-label': t('mdStrike'), onMouseDown: (e: { preventDefault: () => void }) => e.preventDefault(), onClick: () => runCommand(toggleStrikethroughCommand), children: jsx(Strikethrough, {}) }),
            jsx('span', { className: 'evo-md-sep' }),
            jsx('button', { type: 'button', className: 'evo-md-btn', title: t('mdQuote'), 'aria-label': t('mdQuote'), onMouseDown: (e: { preventDefault: () => void }) => e.preventDefault(), onClick: () => runCommand(wrapInBlockquoteCommand), children: jsx(Quote, {}) }),
            jsx('button', { type: 'button', className: 'evo-md-btn', title: t('mdBulletList'), 'aria-label': t('mdBulletList'), onMouseDown: (e: { preventDefault: () => void }) => e.preventDefault(), onClick: () => runCommand(wrapInBulletListCommand), children: jsx(List, {}) }),
            jsx('button', { type: 'button', className: 'evo-md-btn', title: t('mdOrderedList'), 'aria-label': t('mdOrderedList'), onMouseDown: (e: { preventDefault: () => void }) => e.preventDefault(), onClick: () => runCommand(wrapInOrderedListCommand), children: jsx(ListOrdered, {}) }),
            jsx('button', { type: 'button', className: 'evo-md-btn', title: t('mdHr'), 'aria-label': t('mdHr'), onMouseDown: (e: { preventDefault: () => void }) => e.preventDefault(), onClick: () => runCommand(insertHrCommand), children: jsx(Minus, {}) }),
            jsx('span', { className: 'evo-md-sep' }),
            jsx('button', { type: 'button', className: 'evo-md-btn', title: t('mdTable'), 'aria-label': t('mdTable'), onMouseDown: (e: { preventDefault: () => void }) => e.preventDefault(), onClick: () => runCommand(insertTableCommand, { row: 2, col: 2 }), children: jsx(Table2, {}) }),
            linkOpen
              ? jsx('input', {
                  className: 'evo-md-link-input',
                  autoFocus: true,
                  value: linkDraft,
                  placeholder: t('mdLinkPlaceholder'),
                  onChange: (e: { currentTarget: { value: string } }) => setLinkDraft(e.currentTarget.value),
                  onBlur: () => { setLinkOpen(false); setLinkDraft('') },
                  onKeyDown: (e: { key: string; currentTarget: { value: string }; preventDefault: () => void }) => {
                    if (e.key === 'Enter') {
                      const href = e.currentTarget.value.trim()
                      if (href !== '') runCommand(toggleLinkCommand, { href })
                      setLinkOpen(false)
                      setLinkDraft('')
                      e.preventDefault()
                    }
                    if (e.key === 'Escape') { setLinkOpen(false); setLinkDraft('') }
                  },
                })
              : jsx('button', { type: 'button', className: 'evo-md-btn', title: t('mdLink'), 'aria-label': t('mdLink'), onMouseDown: (e: { preventDefault: () => void }) => e.preventDefault(), onClick: () => setLinkOpen(true), children: jsx(LinkIcon, {}) }),
            jsx('button', { type: 'button', className: 'evo-md-btn', title: t('mdCode'), 'aria-label': t('mdCode'), onMouseDown: (e: { preventDefault: () => void }) => e.preventDefault(), onClick: () => runCommand(toggleInlineCodeCommand), children: jsx(Code, {}) }),
            jsx('button', { type: 'button', className: 'evo-md-btn', title: t('mdCodeBlock'), 'aria-label': t('mdCodeBlock'), onMouseDown: (e: { preventDefault: () => void }) => e.preventDefault(), onClick: () => runCommand(createCodeBlockCommand, ''), children: jsx(Code2, {}) }),
          ],
        }),
        // ── Milkdown host（ProseMirror 所见即所得）──
        jsx('div', { ref: hostRef, className: 'evo-composer-editor-host evo-milkdown' }),
      ],
    }),
  })
}

/** 工作区文件 tab（按类型适配：md → Milkdown 实时编辑，其它文本 → Monaco 代码编辑器）。 */
export function TabFileEditor({ path, draft, onDraft, onSave }: TabFileEditorProps) {
  const [content, setContent] = useState<string | null>(null)
  const [readError, setReadError] = useState<string | null>(null)
  const isMarkdown = MD_EXT.has(path.slice(path.lastIndexOf('.')).toLowerCase())
  // Monaco addCommand 需要稳定引用（注册一次），经 ref 转发最新 onSave
  const saveRef = useRef(onSave)
  saveRef.current = onSave

  // 打开时自动读取文件内容（draft 已有值则直接采用，避免覆盖未保存编辑）
  useEffect(() => {
    if (draft !== undefined && draft !== '') { setContent(draft); return }
    let cancelled = false
    void fetch('/evoresearch/fs/read', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path }),
    }).then((res) => res.json()).then((json) => {
      if (cancelled) return
      if (json.ok === true) { setContent(String(json.value.text ?? '')); setReadError(null) }
      else setReadError(json.error?.message ?? '读取失败')
    }).catch((e) => { if (!cancelled) setReadError(String(e)) })
    return () => { cancelled = true }
  }, [path])

  const name = path.slice(Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/')) + 1) || path

  // ── 头部：路径 + 保存 ──
  const head = jsxs('div', {
    className: 'evo-tab-editor-head',
    children: [
      jsx('span', { className: 'evo-tab-editor-path', title: path, children: isMarkdown ? name : path }),
      jsx('span', { style: { flex: 1 } }),
      jsx('button', {
        type: 'button',
        className: 'evo-btn evo-btn-run',
        onClick: onSave,
        children: jsxs(Fragment, { children: [jsx(Save, {}), jsx('span', { children: t('save') })] }),
      }),
    ],
  })

  if (isMarkdown) {
    return jsxs('div', {
      className: 'evo-tab-body evo-tab-editor-body evo-tab-file-body',
      children: [
        head,
        readError !== null && jsx('div', { className: 'evo-panel-error', children: readError }),
        content === null
          ? jsx('div', { className: 'evo-panel-hint', children: t('loading') })
          : jsx(MarkdownLive, { initial: content, onMarkdown: onDraft, onSave }),
      ],
    })
  }

  return jsxs('div', {
    className: 'evo-tab-body evo-tab-editor-body evo-tab-file-body',
    children: [
      head,
      readError !== null && jsx('div', { className: 'evo-panel-error', children: readError }),
      content === null
        ? jsx('div', { className: 'evo-panel-hint', children: t('loading') })
        : jsx(TabMonacoEditor, { path, value: content, onDraft, onSaveRef: saveRef }),
    ],
  })
}
