/**
 * 中央工作区「Monaco 文件编辑器」：VSCode 同源编辑器内核（monaco-editor）。
 *
 * 提供：语法高亮（按扩展名映射语言）、行号/多光标/撤销树、VSCode 键位
 * （Ctrl+S 保存走外层回调）、增量编辑。md/markdown 不走这里（由 tab-file.ts
 * 的 Milkdown 所见即所得承担）。
 *
 * Worker：构建期把 editor.worker 打包为 IIFE 字符串（__MONACO_WORKER_SOURCE__），
 * 运行时经 Blob URL 提供给 MonacoEnvironment.getWorker —— 插件保持单一
 * client.js 端点，不依赖额外静态资源路由（与 chatgraph worker 同模式）。
 * 样式：editor.main.css 由构建期生成 monaco-css.ts，installCss 注入。
 */
import { jsx } from 'react/jsx-runtime'
import { useEffect, useRef } from 'react'

declare const __MONACO_WORKER_SOURCE__: string

type MonacoNamespace = any

let monacoNs: MonacoNamespace | null = null
let monacoLoading: Promise<MonacoNamespace> | null = null

/** 懒加载 Monaco 主库（一次性）；同时挂好 Blob URL worker 环境。 */
function loadMonaco(): Promise<MonacoNamespace> {
  if (monacoNs !== null) return Promise.resolve(monacoNs)
  if (monacoLoading !== null) return monacoLoading
  const selfAny = self as any
  selfAny.MonacoEnvironment = {
    ...selfAny.MonacoEnvironment,
    getWorker: () => new Worker(URL.createObjectURL(new Blob([__MONACO_WORKER_SOURCE__], { type: 'text/javascript' }))),
  }
  monacoLoading = import('monaco-editor/esm/vs/editor/editor.main.js').then((mod: any) => {
    monacoNs = mod.monaco ?? mod.default ?? mod
    return monacoNs
  })
  return monacoLoading
}

/** 扩展名 → Monaco language id（覆盖科研常见类型；未识别走 plaintext 基础编辑）。 */
const EXT_LANGUAGE: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  py: 'python', ipynb: 'python', r: 'r', jl: 'julia', m: 'matlab',
  json: 'json', jsonc: 'json', yaml: 'yaml', yml: 'yaml', toml: 'ini', ini: 'ini', cfg: 'ini',
  css: 'css', scss: 'scss', less: 'less', html: 'html', htm: 'html', xml: 'xml', svg: 'xml',
  tex: 'latex', bib: 'latex',
  sql: 'sql', sh: 'shell', bash: 'shell', zsh: 'shell', ps1: 'powershell', bat: 'bat',
  rs: 'rust', go: 'go', java: 'java', c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp', cs: 'csharp',
  rb: 'ruby', php: 'php', lua: 'lua', pl: 'perl', swift: 'swift', kt: 'kotlin',
  csv: 'plaintext', tsv: 'plaintext', txt: 'plaintext', log: 'plaintext',
  diff: 'diff', patch: 'diff',
}

export function languageOf(path: string): string {
  const name = path.slice(Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/')) + 1).toLowerCase()
  if (name === 'dockerfile') return 'dockerfile'
  if (name === 'makefile') return 'makefile'
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : ''
  return EXT_LANGUAGE[ext] ?? 'plaintext'
}

export interface TabMonacoEditorProps {
  path: string
  /** 初始内容（TabFileEditor 已读好文件）；null 时显示空内容。 */
  value: string | null
  onDraft: (text: string) => void
  onSaveRef: { current: () => void }
}

/** Monaco 编辑器（monaco 单例；每个文件路径一个稳定 model，跨 tab 复用保留撤销历史）。 */
export function TabMonacoEditor({ path, value, onDraft, onSaveRef }: TabMonacoEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<any>(null)
  const onDraftRef = useRef(onDraft)
  onDraftRef.current = onDraft
  const valueRef = useRef(value)
  valueRef.current = value

  useEffect(() => {
    const host = hostRef.current
    if (host === null) return
    let disposed = false
    let themeObserver: MutationObserver | null = null

    void loadMonaco().then((monaco) => {
      if (disposed || hostRef.current === null) return
      // 主题跟随应用明暗（html.dark ↔ vs-dark / vs）
      const applyTheme = () => monaco.editor.setTheme(document.documentElement.classList.contains('dark') ? 'vs-dark' : 'vs')
      applyTheme()
      themeObserver = new MutationObserver(applyTheme)
      themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })

      // 每个文件一个稳定 model（URI 唯一）：切 tab 回来恢复光标与撤销历史
      const uri = monaco.Uri.parse(`evo-file:///${path.replace(/\\/g, '/')}`)
      let model = monaco.editor.getModel(uri)
      if (model === null) model = monaco.editor.createModel(valueRef.current ?? '', languageOf(path), uri)
      else if (valueRef.current !== null && model.getValue() !== valueRef.current) model.setValue(valueRef.current)

      const editor = monaco.editor.create(host, {
        model,
        automaticLayout: true,
        minimap: { enabled: false },
        fontSize: 13,
        lineNumbers: 'on',
        scrollBeyondLastLine: false,
        tabSize: 2,
        renderWhitespace: 'selection',
        smoothScrolling: true,
        fixedOverflowWidgets: true,
      })
      editorRef.current = editor
      editor.onDidChangeModelContent(() => onDraftRef.current(model.getValue()))
      // Ctrl+S 走外层保存回调（Monaco 键位系统内注册）
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => onSaveRef.current())
    })

    return () => {
      disposed = true
      themeObserver?.disconnect()
      // 仅销毁编辑器实例；model 保留供跨 tab/重启复用
      editorRef.current?.dispose?.()
      editorRef.current = null
    }
  }, [path])

  // draft 被外部覆盖（重新读文件）时回写 model
  useEffect(() => {
    if (value === null) return
    const model = editorRef.current?.getModel?.()
    if (model != null && model.getValue() !== value) model.setValue(value)
  }, [value, path])

  return jsx('div', { ref: hostRef, className: 'evo-tab-monaco' })
}
