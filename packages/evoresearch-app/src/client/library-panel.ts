/**
 * 文献与稿件面板（LIB-UI）。
 *
 * 两个 Tab：
 * - 文献（Papers）：论文列表（含缺失文件标记）、注册 PDF、目录扫描、四路搜索
 *   （文件名/标题/全文/笔记/参考文献 + 页定位）、论文详情（打开 PDF、按页跳转读
 *   页文本、精读笔记读写、references 读写、BibTeX 查看与导入）；
 * - 稿件（Manuscript）：创建/选择稿件目录、文件树读写（文本编辑）、LaTeX 编译
 *   （结果/错误行/build.log 读取）、引用核对（文本/数字 → 论文页 + 实验文件定位）。
 *
 * 数据经 POST /evoresearch/fs/<kebab-method>（workspace-api.ts 已代理 library- 与
 * manuscript- 两类前缀的 kebab 方法名，kebab→camel 自动转换，直达 api.ts 中
 * library 与 manuscript 两组的 Remote 方法）。
 * project 参数 = 项目名（非路径）：面板按当前会话 cwd 匹配 projects-list 自动解析，
 * 匹配不到时可用下拉框手动选择。
 *
 * ── 注册点（本文件外）──
 * 1. client/threadlist.ts：SideView 加 'library'；MENU 加 { key:'library',
 *    label:t('libraryPanel'), icon:BookOpen }；isActive 加 (key==='library' && view==='library')。
 * 2. client/index.ts：import { LibraryPanel } from './library-panel'；
 *    view==='notes' 分支后加 view==='library' 渲染（cwd 同 notes 面板模式）。
 * 3. client/i18n.ts：libraryPanel 等 i18n 键。
 */
import { jsx, jsxs, Fragment } from 'react/jsx-runtime'
import { useEffect, useState } from 'react'
import { t } from './i18n'
import {
  BookOpen, FileText, Search, RefreshCw, Plus, ArrowLeft, ExternalLink, Save,
  FolderOpen, FileCode2, Play, Quote,
} from 'lucide-react'

// ── 与服务端对齐的纯 JSON 行类型 ─────────────────────────────────────────────

type ExtractionStatus = 'none' | 'ok' | 'no-extractor' | 'failed'

interface PaperSummary {
  paperId: string
  filePath: string
  fileName: string
  fileSize: number
  fileMtime: number
  fileMissing: boolean
  title: string
  authors: string[]
  year?: number
  pageCount: number
  extractionStatus: ExtractionStatus
  extractor: string
  extractError: string
  notes: string
  references: string[]
  bibtex: string
  createdAt: number
  updatedAt: number
}

interface TextLocation {
  page: number
  offset: number
  length: number
  snippet: string
}

interface SearchHit {
  paper: PaperSummary
  score: number
  matchedFields: string[]
  locations: TextLocation[]
}

interface PageTextRow {
  filePath: string
  page: number
  text: string
}

interface ScanPageHit {
  paperId: string
  title: string
  filePath: string
  page: number
  offset: number
  snippet: string
}

interface AddPaperResult {
  paperId: string
  filePath: string
  status: 'added' | 'updated' | 'exists'
  extractionStatus: ExtractionStatus
  extractError?: string
  title: string
  pageCount: number
}

interface IndexResult {
  project: string
  scanDir: string
  added: number
  updated: number
  unchanged: number
  extractionFailed: number
  noExtractor: number
  missing: number
  total: number
}

interface ImportBibtexResult {
  attached: Array<{ paperId: string; title: string }>
  unmatched: Array<{ key: string; type: string; title: string; author: string; year?: string; raw: string }>
}

interface ManuscriptInfo {
  name: string
  dir: string
  mainTex: string
  bib: string
  sectionsDir: string
  figuresDir: string
  hasBuildLog: boolean
  buildLogPath?: string
}

interface LatexErrorRow {
  file: string
  line: number | null
  message: string
  raw: string
}

interface CompileResult {
  ok: boolean
  tool: string | null
  toolPath?: string
  exitCode: number | null
  logPath: string | null
  logTail: string
  errors: LatexErrorRow[]
  message: string
}

interface QuoteCheckResult {
  query: string
  paperHits: Array<{ paperId: string; title: string; filePath: string; page: number; offset: number; snippet: string }>
  fileHits: Array<{ file: string; relative: string; line: number; snippet: string }>
  message: string
}

interface ProjectInfo {
  name: string
  path: string
  dataDir: string
  createdAt: number
}

// ── 工具 ────────────────────────────────────────────────────────────────────

/** 简单 POST JSON 封装（与 research-notes.ts / panels.ts 同款）。 */
async function api<T>(method: string, body: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`/evoresearch/fs/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await res.json()
  if (!json.ok) throw new Error(json.error?.message ?? t('requestFailed'))
  return json.value as T
}

function normForMatch(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

function fmtTime(ts: number): string {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 提取状态徽标。 */
function ExtractionBadge({ status }: { status: ExtractionStatus }) {
  const label = status === 'ok' ? t('libStatusOk')
    : status === 'no-extractor' ? t('libStatusNoExtractor')
      : status === 'failed' ? t('libStatusFailed')
        : t('libStatusNone')
  return jsx('span', { className: `evo-lib-badge ${status}`, children: label })
}

/** 搜索字段勾选（LIB-07：文件名/标题/全文/笔记/参考文献）。 */
const SEARCH_FIELDS = [
  { key: 'filename', label: t('libFieldFilename') },
  { key: 'title', label: t('libFieldTitle') },
  { key: 'fulltext', label: t('libFieldFulltext') },
  { key: 'notes', label: t('libFieldNotes') },
  { key: 'references', label: t('libFieldReferences') },
] as const

// ── 论文详情 ────────────────────────────────────────────────────────────────

function PaperDetail({ project, paperId, initialPage, onBack, onChanged, onError }: {
  project: string
  paperId: string
  initialPage?: number
  onBack: () => void
  onChanged: () => void
  onError: (message: string) => void
}) {
  const [paper, setPaper] = useState<PaperSummary | null>(null)
  const [notesDraft, setNotesDraft] = useState('')
  const [refsDraft, setRefsDraft] = useState('')
  const [bibtex, setBibtex] = useState('')
  const [bibImport, setBibImport] = useState('')
  const [importMsg, setImportMsg] = useState('')
  const [pageInput, setPageInput] = useState(initialPage !== undefined ? String(initialPage) : '')
  const [pageText, setPageText] = useState<PageTextRow | null>(null)
  const [scanQuery, setScanQuery] = useState('')
  const [scanHits, setScanHits] = useState<ScanPageHit[] | null>(null)
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = (withNotes = false) => {
    setBusy(true)
    void api<PaperSummary | null>('library-get', { project, paperId })
      .then((row) => {
        setBusy(false)
        if (row === null) {
          onError(t('paperNotFound').replace('{id}', paperId))
          return
        }
        setPaper(row)
        if (withNotes) { setNotesDraft(row.notes); setRefsDraft(row.references.join('\n')); setBibtex(row.bibtex) }
        if (pageInput !== '' && pageText === null) jump()
      })
      .catch((e: any) => { setBusy(false); onError(String(e?.message ?? e)) })
  }
  useEffect(() => { load(true) }, [paperId])

  const jump = () => {
    const page = Number(pageInput)
    if (!Number.isInteger(page) || page < 1) return
    setPageText(null)
    void api<PageTextRow | null>('library-get-page-text', { project, paperId, page })
      .then((row) => {
        if (row === null) { setPageText(null); onError(t('libNoPageText')) }
        else setPageText(row)
      })
      .catch((e: any) => onError(String(e?.message ?? e)))
  }

  const saveNotes = () => {
    if (saving) return
    setSaving(true)
    void api<PaperSummary>('library-set-notes', { project, paperId, notes: notesDraft })
      .then((row) => { setSaving(false); setPaper(row); onChanged() })
      .catch((e: any) => { setSaving(false); onError(String(e?.message ?? e)) })
  }

  const saveRefs = () => {
    if (saving) return
    setSaving(true)
    const references = refsDraft.split('\n').map((l) => l.trim()).filter((l) => l !== '')
    void api<PaperSummary>('library-set-references', { project, paperId, references })
      .then((row) => { setSaving(false); setPaper(row); onChanged() })
      .catch((e: any) => { setSaving(false); onError(String(e?.message ?? e)) })
  }

  const doImportBibtex = () => {
    if (bibImport.trim() === '') return
    setImportMsg('')
    void api<ImportBibtexResult>('library-import-bibtex', { project, bibtex: bibImport })
      .then((result) => {
        setImportMsg(t('libImported').replace('{n}', String(result.attached.length)).replace('{m}', String(result.unmatched.length)))
        setBibImport('')
        load(true)
      })
      .catch((e: any) => onError(String(e?.message ?? e)))
  }

  const doScan = () => {
    const q = scanQuery.trim()
    if (q === '') return
    setScanHits(null)
    void api<ScanPageHit[]>('library-scan-pages', { project, query: q, paperId })
      .then((hits) => setScanHits(hits.length === 0 ? null : hits))
      .catch((e: any) => onError(String(e?.message ?? e)))
  }

  if (paper === null) {
    return jsx('div', { className: 'evo-panel-hint', children: t('loading') })
  }

  return jsxs('div', {
    className: 'evo-panel-row',
    children: [
      // 头部：返回 + 标题 + 状态徽标 + 打开 PDF
      jsxs('div', {
        className: 'evo-note-detail-head',
        children: [
          jsx('button', {
            type: 'button',
            className: 'evo-panel-act',
            title: t('libBack'),
            'aria-label': t('libBack'),
            disabled: busy,
            onClick: onBack,
            children: jsx(ArrowLeft, {}),
          }),
          jsx('span', { className: 'evo-note-detail-title', children: paper.title }),
          jsx(ExtractionBadge, { status: paper.extractionStatus }),
          paper.fileMissing && jsx('span', { className: 'evo-lib-badge miss', children: t('libFileMissing') }),
          jsx('span', { className: 'evo-note-pager-info', children: `${paper.authors.join(', ')}${paper.year !== undefined ? ` · ${paper.year}` : ''}` }),
          jsxs('div', {
            className: 'evo-note-detail-acts',
            children: [
              jsx('button', {
                type: 'button',
                className: 'evo-panel-act',
                title: t('libOpenPdf'),
                'aria-label': t('libOpenPdf'),
                onClick: () => window.open(`/evoresearch/fs/file?path=${encodeURIComponent(paper.filePath)}`, '_blank'),
                children: jsx(ExternalLink, {}),
              }),
            ],
          }),
        ],
      }),
      // 页定位：页码输入 + 页文本
      jsxs('div', {
        className: 'evo-lib-row',
        children: [
          jsx('span', { className: 'evo-panel-row-label', children: `${t('libPageJump')}（${paper.pageCount} ${t('libPage')}）` }),
          jsx('input', {
            type: 'number',
            min: 1,
            className: 'evo-panel-input evo-lib-num',
            value: pageInput,
            onInput: (e: { currentTarget: { value: string } }) => setPageInput(e.currentTarget.value),
            onKeyDown: (e: { key: string }) => { if (e.key === 'Enter') jump() },
            'aria-label': t('libPageJump'),
          }),
          jsx('button', { type: 'button', className: 'evo-btn evo-btn-sm', onClick: jump, children: t('libPageJumpBtn') }),
          jsx('input', {
            type: 'text',
            className: 'evo-panel-input evo-lib-scan',
            placeholder: t('libScanPageHint'),
            value: scanQuery,
            onInput: (e: { currentTarget: { value: string } }) => setScanQuery(e.currentTarget.value),
            onKeyDown: (e: { key: string }) => { if (e.key === 'Enter') doScan() },
            'aria-label': t('libScanPageHint'),
          }),
          jsx('button', { type: 'button', className: 'evo-btn evo-btn-sm', onClick: doScan, children: jsx(Search, {}) }),
        ],
      }),
      pageText !== null && jsxs('div', {
        className: 'evo-lib-pagetext',
        children: [
          jsx('span', { className: 'evo-panel-row-label', children: `${t('libPageText')} ${pageText.page}` }),
          jsx('pre', { className: 'evo-lib-log', children: pageText.text }),
        ],
      }),
      scanHits !== null && scanHits.length > 0 && jsx('div', {
        className: 'evo-lib-list',
        children: scanHits.map((hit) => jsx('button', {
          type: 'button',
          className: 'evo-note-hit',
          onClick: () => { setPageInput(String(hit.page)); jump() },
          children: jsxs('div', {
            className: 'evo-note-hit-main',
            children: [
              jsx('div', { className: 'evo-note-hit-meta', children: `${t('libPage')} ${hit.page} @ ${hit.offset}` }),
              jsx('div', { className: 'evo-note-hit-snippet', children: hit.snippet }),
            ],
          }),
        }, `scan-${hit.page}-${hit.offset}`)),
      }),
      // 精读笔记（LIB-04）
      jsxs('div', {
        className: 'evo-lib-block',
        children: [
          jsxs('div', {
            className: 'evo-note-doc-head',
            children: [
              jsx('span', { className: 'evo-note-doc-name', children: t('libNotes') }),
              jsxs('div', {
                className: 'evo-note-doc-acts',
                children: [
                  jsx('button', {
                    type: 'button',
                    className: 'evo-btn evo-btn-ok evo-btn-sm',
                    disabled: saving,
                    onClick: saveNotes,
                    children: jsxs(Fragment, { children: [jsx(Save, {}), jsx('span', { children: t('libSaveNotes') })] }),
                  }),
                ],
              }),
            ],
          }),
          jsx('textarea', {
            className: 'evo-note-textarea',
            value: notesDraft,
            onInput: (e: { currentTarget: { value: string } }) => setNotesDraft(e.currentTarget.value),
            'aria-label': t('libNotes'),
          }),
        ],
      }),
      // references（LIB-05：每行一条，标题完整保留）
      jsxs('div', {
        className: 'evo-lib-block',
        children: [
          jsxs('div', {
            className: 'evo-note-doc-head',
            children: [
              jsx('span', { className: 'evo-note-doc-name', children: t('libReferences') }),
              jsxs('div', {
                className: 'evo-note-doc-acts',
                children: [
                  jsx('button', {
                    type: 'button',
                    className: 'evo-btn evo-btn-ok evo-btn-sm',
                    disabled: saving,
                    onClick: saveRefs,
                    children: jsxs(Fragment, { children: [jsx(Save, {}), jsx('span', { children: t('libSaveReferences') })] }),
                  }),
                ],
              }),
            ],
          }),
          jsx('textarea', {
            className: 'evo-note-textarea evo-note-textarea-sm',
            value: refsDraft,
            onInput: (e: { currentTarget: { value: string } }) => setRefsDraft(e.currentTarget.value),
            'aria-label': t('libReferences'),
          }),
        ],
      }),
      // BibTeX（LIB-06：查看 + 导入）
      jsxs('div', {
        className: 'evo-lib-block',
        children: [
          jsxs('div', {
            className: 'evo-note-doc-head',
            children: [
              jsx('span', { className: 'evo-note-doc-name', children: t('libBibtex') }),
              bibtex !== '' && jsx('span', { className: 'evo-note-pager-info', children: `${bibtex.length} chars` }),
            ],
          }),
          bibtex !== '' && jsx('pre', { className: 'evo-lib-log', children: bibtex.slice(0, 4000) }),
          jsx('textarea', {
            className: 'evo-note-textarea evo-note-textarea-sm',
            placeholder: t('libBibtexImportHint'),
            value: bibImport,
            onInput: (e: { currentTarget: { value: string } }) => setBibImport(e.currentTarget.value),
            'aria-label': t('libImportBibtex'),
          }),
          jsxs('div', {
            className: 'evo-goal-proposal-acts',
            children: [
              jsx('button', {
                type: 'button',
                className: 'evo-btn evo-btn-sm',
                disabled: bibImport.trim() === '',
                onClick: doImportBibtex,
                children: t('libImportBibtex'),
              }),
              importMsg !== '' && jsx('span', { className: 'evo-note-pager-info', children: importMsg }),
            ],
          }),
        ],
      }),
    ],
  })
}

// ── 文献 Tab ────────────────────────────────────────────────────────────────

function PapersTab({ project, onError }: { project: string; onError: (message: string) => void }) {
  const [list, setList] = useState<PaperSummary[] | null>(null)
  const [includeMissing, setIncludeMissing] = useState(true)
  const [query, setQuery] = useState('')
  const [fields, setFields] = useState<Set<string>>(new Set(SEARCH_FIELDS.map((f) => f.key)))
  const [hits, setHits] = useState<SearchHit[] | null>(null)
  const [open, setOpen] = useState<{ paperId: string; page?: number } | null>(null)
  const [pdfPath, setPdfPath] = useState('')
  const [scanDir, setScanDir] = useState('')
  const [actionMsg, setActionMsg] = useState('')
  const [loading, setLoading] = useState(false)

  const load = () => {
    setLoading(true)
    void api<PaperSummary[]>('library-list', { project, includeMissing })
      .then((rows) => { setLoading(false); setList(rows) })
      .catch((e: any) => { setLoading(false); onError(String(e?.message ?? e)) })
  }
  useEffect(() => { setHits(null); setList(null); load() }, [project, includeMissing])

  const doSearch = () => {
    const q = query.trim()
    if (q === '') { setHits(null); return }
    setHits(null)
    void api<SearchHit[]>('library-search', { project, query: q, fields: [...fields], limit: 20 })
      .then((rows) => setHits(rows.length === 0 ? null : rows))
      .catch((e: any) => onError(String(e?.message ?? e)))
  }

  const toggleField = (key: string) => {
    setFields((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const doAddPaper = () => {
    const p = pdfPath.trim()
    if (p === '') return
    setActionMsg('')
    void api<AddPaperResult>('library-add-paper', { project, pdfPath: p })
      .then((r) => { setActionMsg(t('paperAddedMsg').replace('{status}', r.status).replace('{title}', r.title).replace('{extraction}', `${r.extractionStatus}${r.extractError ? `: ${r.extractError}` : ''}`)); setPdfPath(''); load() })
      .catch((e: any) => onError(String(e?.message ?? e)))
  }

  const doIndex = () => {
    const dir = scanDir.trim()
    if (dir === '') return
    setActionMsg('')
    void api<IndexResult>('library-index', { project, scanDir: dir })
      .then((r) => {
        setActionMsg(t('libIndexResult').replace('{added}', String(r.added)).replace('{updated}', String(r.updated)).replace('{missing}', String(r.missing)))
        load()
      })
      .catch((e: any) => onError(String(e?.message ?? e)))
  }

  if (open !== null) {
    return jsx(PaperDetail, {
      project,
      paperId: open.paperId,
      initialPage: open.page,
      onBack: () => { setOpen(null); load() },
      onChanged: () => { /* 列表下次进入时刷新 */ },
      onError,
    })
  }

  return jsxs(Fragment, {
    children: [
      // 工具栏：搜索 + 字段勾选 + 刷新
      jsxs('div', {
        className: 'evo-note-toolbar',
        children: [
          jsx('input', {
            type: 'text',
            className: 'evo-note-search',
            placeholder: t('libSearchPlaceholder'),
            value: query,
            onInput: (e: { currentTarget: { value: string } }) => setQuery(e.currentTarget.value),
            onKeyDown: (e: { key: string }) => { if (e.key === 'Enter') doSearch() },
            'aria-label': t('libSearchPlaceholder'),
          }),
          jsx('button', { type: 'button', className: 'evo-panel-add', onClick: doSearch, children: jsx(Search, {}) }),
          jsx('button', { type: 'button', className: 'evo-icon-btn', title: t('refresh'), onClick: load, children: jsx(RefreshCw, {}) }),
          jsx('label', { className: 'evo-lib-check', children: jsxs(Fragment, { children: [jsx('input', { type: 'checkbox', checked: includeMissing, onInput: (e: { currentTarget: { checked: boolean } }) => setIncludeMissing(e.currentTarget.checked) }), jsx('span', { children: t('libIncludeMissing') })] }) }),
        ],
      }),
      jsx('div', {
        className: 'evo-lib-fields',
        children: SEARCH_FIELDS.map((f) => jsx('label', {
          className: 'evo-lib-check',
          children: jsxs(Fragment, { children: [jsx('input', { type: 'checkbox', checked: fields.has(f.key), onInput: () => toggleField(f.key) }), jsx('span', { children: f.label })] }),
        }, f.key)),
      }),
      // 注册 / 扫描
      jsxs('div', {
        className: 'evo-lib-row',
        children: [
          jsx('input', {
            type: 'text',
            className: 'evo-panel-input evo-lib-path',
            placeholder: t('libAddPaperPath'),
            value: pdfPath,
            onInput: (e: { currentTarget: { value: string } }) => setPdfPath(e.currentTarget.value),
            onKeyDown: (e: { key: string }) => { if (e.key === 'Enter') doAddPaper() },
            'aria-label': t('libAddPaperPath'),
          }),
          jsx('button', { type: 'button', className: 'evo-btn evo-btn-sm', onClick: doAddPaper, children: jsxs(Fragment, { children: [jsx(Plus, {}), jsx('span', { children: t('libAddPaper') })] }) }),
          jsx('input', {
            type: 'text',
            className: 'evo-panel-input evo-lib-path',
            placeholder: t('libScanDir'),
            value: scanDir,
            onInput: (e: { currentTarget: { value: string } }) => setScanDir(e.currentTarget.value),
            onKeyDown: (e: { key: string }) => { if (e.key === 'Enter') doIndex() },
            'aria-label': t('libScanDir'),
          }),
          jsx('button', { type: 'button', className: 'evo-btn evo-btn-sm', onClick: doIndex, children: jsxs(Fragment, { children: [jsx(FolderOpen, {}), jsx('span', { children: t('libScanDirBtn') })] }) }),
        ],
      }),
      actionMsg !== '' && jsx('div', { className: 'evo-note-pager-info', children: actionMsg }),
      // 搜索结果（含原文位置）
      hits !== null && hits.length > 0 && jsx('div', {
        className: 'evo-panel-row',
        children: [
          jsx('span', { className: 'evo-panel-row-label', children: `${t('searchResults')}（${hits.length}）` }),
          jsx('div', {
            className: 'evo-panel-list',
            children: hits.map((hit) => jsx('button', {
              type: 'button',
              className: 'evo-note-hit',
              onClick: () => setOpen({ paperId: hit.paper.paperId, page: hit.locations[0]?.page }),
              children: jsxs('div', {
                className: 'evo-note-hit-main',
                children: [
                  jsxs('div', {
                    className: 'evo-note-hit-title',
                    children: [
                      jsx('span', { children: hit.paper.title }),
                      jsx('span', { className: 'evo-lib-badge ok', children: hit.matchedFields.join(' + ') }),
                    ],
                  }),
                  hit.locations.length > 0 && jsx('div', {
                    className: 'evo-note-hit-meta',
                    children: hit.locations.map((loc) => `${t('libPage')} ${loc.page} @${loc.offset}`).join(' · '),
                  }),
                ],
              }),
            }, hit.paper.paperId)),
          }),
        ],
      }),
      // 论文列表
      list === null
        ? jsx('div', { className: 'evo-panel-hint', children: loading ? t('loading') : '' })
        : list.length === 0
          ? jsx('div', { className: 'evo-panel-hint', children: t('libNoPapers') })
          : jsx('div', {
              className: 'evo-panel-list',
              children: list.map((paper) => jsx('button', {
                type: 'button',
                className: 'evo-note-card',
                onClick: () => setOpen({ paperId: paper.paperId }),
                children: jsxs(Fragment, {
                  children: [
                    jsxs('div', {
                      className: 'evo-note-card-head',
                      children: [
                        jsx('span', { className: 'evo-note-card-title', children: paper.title }),
                        jsx(ExtractionBadge, { status: paper.extractionStatus }),
                        paper.fileMissing && jsx('span', { className: 'evo-lib-badge miss', children: t('libFileMissing') }),
                      ],
                    }),
                    jsx('div', {
                      className: 'evo-note-card-meta',
                      children: [
                        jsx('span', { children: paper.fileName }),
                        jsx('span', { children: paper.authors.join(', ') || paper.filePath }),
                        jsx('span', { children: fmtTime(paper.updatedAt) }),
                      ],
                    }),
                  ],
                }),
              }, paper.paperId)),
            }),
    ],
  })
}

// ── 稿件 Tab ────────────────────────────────────────────────────────────────

function ManuscriptTab({ project, onError }: { project: string; onError: (message: string) => void }) {
  const [list, setList] = useState<ManuscriptInfo[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [files, setFiles] = useState<string[] | null>(null)
  const [openFile, setOpenFile] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [savedFlag, setSavedFlag] = useState('')
  const [createName, setCreateName] = useState('')
  const [compile, setCompile] = useState<CompileResult | null>(null)
  const [logText, setLogText] = useState<string | null>(null)
  const [compiling, setCompiling] = useState(false)
  const [quote, setQuote] = useState<QuoteCheckResult | null>(null)
  const [quoteText, setQuoteText] = useState('')
  const [quoteNumber, setQuoteNumber] = useState('')
  const [quoteExp, setQuoteExp] = useState('')
  const [quoteFile, setQuoteFile] = useState('')

  const loadList = () => {
    setList(null)
    void api<ManuscriptInfo[]>('manuscript-list', { project })
      .then(setList)
      .catch((e: any) => onError(String(e?.message ?? e)))
  }
  useEffect(() => { setSelected(null); setCompile(null); loadList() }, [project])

  const open = (dir: string) => {
    setSelected(dir)
    setOpenFile(null)
    setCompile(null)
    setLogText(null)
    setFiles(null)
    void api<string[]>('manuscript-list-files', { project, dir })
      .then(setFiles)
      .catch((e: any) => onError(String(e?.message ?? e)))
  }

  const read = (relPath: string) => {
    if (selected === null) return
    setOpenFile(relPath)
    setSavedFlag('')
    void api<{ path: string; content: string }>('manuscript-read-file', { project, dir: selected, relPath })
      .then((row) => setContent(row.content))
      .catch((e: any) => onError(String(e?.message ?? e)))
  }

  const write = () => {
    if (selected === null || openFile === null) return
    setSavedFlag('')
    void api<{ path: string }>('manuscript-write-file', { project, dir: selected, relPath: openFile, content })
      .then(() => { setSavedFlag(t('libSaved')); setTimeout(() => setSavedFlag(''), 2500) })
      .catch((e: any) => onError(String(e?.message ?? e)))
  }

  const doCreate = () => {
    const name = createName.trim()
    if (name === '') return
    void api<ManuscriptInfo>('manuscript-create', { project, dirName: name })
      .then((info) => { setCreateName(''); loadList(); open(info.name) })
      .catch((e: any) => onError(String(e?.message ?? e)))
  }

  const doCompile = () => {
    if (selected === null || compiling) return
    setCompiling(true)
    setCompile(null)
    setLogText(null)
    void api<CompileResult>('manuscript-compile', { project, dir: selected })
      .then((result) => { setCompiling(false); setCompile(result) })
      .catch((e: any) => { setCompiling(false); onError(String(e?.message ?? e)) })
  }

  const readLog = () => {
    if (selected === null) return
    void api<{ path: string; content: string }>('manuscript-read-file', { project, dir: selected, relPath: 'build.log' })
      .then((row) => setLogText(row.content))
      .catch((e: any) => onError(String(e?.message ?? e)))
  }

  const doQuote = () => {
    const text = quoteText.trim()
    const number = quoteNumber.trim()
    if (text === '' && number === '') return
    setQuote(null)
    void api<QuoteCheckResult>('manuscript-quote-check', {
      project,
      ...(text !== '' ? { text } : {}),
      ...(number !== '' ? { number } : {}),
      ...(quoteExp.trim() !== '' ? { experimentDir: quoteExp.trim() } : {}),
      ...(quoteFile.trim() !== '' ? { resultFile: quoteFile.trim() } : {}),
    })
      .then(setQuote)
      .catch((e: any) => onError(String(e?.message ?? e)))
  }

  return jsxs(Fragment, {
    children: [
      // 工具栏：新建 + 刷新
      jsxs('div', {
        className: 'evo-note-toolbar',
        children: [
          jsx('input', {
            type: 'text',
            className: 'evo-panel-input evo-lib-path',
            placeholder: t('libDirName'),
            value: createName,
            onInput: (e: { currentTarget: { value: string } }) => setCreateName(e.currentTarget.value),
            onKeyDown: (e: { key: string }) => { if (e.key === 'Enter') doCreate() },
            'aria-label': t('libDirName'),
          }),
          jsx('button', { type: 'button', className: 'evo-btn evo-btn-sm', onClick: doCreate, children: jsxs(Fragment, { children: [jsx(Plus, {}), jsx('span', { children: t('libCreateManuscript') })] }) }),
          jsx('button', { type: 'button', className: 'evo-icon-btn', title: t('refresh'), onClick: loadList, children: jsx(RefreshCw, {}) }),
        ],
      }),
      // 稿件列表
      list === null
        ? jsx('div', { className: 'evo-panel-hint', children: t('loading') })
        : list.length === 0
          ? jsx('div', { className: 'evo-panel-hint', children: t('libNoManuscript') })
          : jsx('div', {
              className: 'evo-panel-list',
              children: list.map((m) => jsx('button', {
                type: 'button',
                className: 'evo-note-card',
                'data-active': selected === m.name || undefined,
                onClick: () => open(m.name),
                children: jsxs('div', {
                  className: 'evo-note-card-head',
                  children: [
                    jsx('span', { className: 'evo-note-card-title', children: m.name }),
                    jsx('span', { className: 'evo-lib-badge ok', children: t('libTool') }),
                  ],
                }),
              }, m.name)),
            }),
      // 选中稿件：文件树 + 编辑 + 编译 + 引用核对
      selected !== null && jsxs('div', {
        className: 'evo-panel-row',
        children: [
          jsxs('div', {
            className: 'evo-lib-block',
            children: [
              jsxs('div', {
                className: 'evo-note-doc-head',
                children: [
                  jsx('span', { className: 'evo-note-doc-name', children: selected }),
                  jsxs('div', {
                    className: 'evo-note-doc-acts',
                    children: [
                      jsx('button', {
                        type: 'button',
                        className: 'evo-btn evo-btn-sm',
                        disabled: compiling,
                        onClick: doCompile,
                        children: jsxs(Fragment, { children: [jsx(Play, {}), jsx('span', { children: compiling ? t('libCompiling') : t('libCompile') })] }),
                      }),
                    ],
                  }),
                ],
              }),
              files === null
                ? jsx('div', { className: 'evo-panel-hint', children: t('loading') })
                : jsx('div', {
                    className: 'evo-lib-tree',
                    children: files.map((f) => jsx('button', {
                      type: 'button',
                      className: 'evo-lib-file',
                      'data-active': openFile === f || undefined,
                      onClick: () => read(f),
                      children: jsxs(Fragment, { children: [jsx(FileCode2, {}), jsx('span', { children: f })] }),
                    }, f)),
                  }),
            ],
          }),
          // 编辑区（文本编辑，复用 textarea 模式；不强制复用标签页）
          openFile !== null && jsxs('div', {
            className: 'evo-lib-block',
            children: [
              jsxs('div', {
                className: 'evo-note-doc-head',
                children: [
                  jsx('span', { className: 'evo-note-doc-name', children: openFile }),
                  savedFlag !== '' && jsx('span', { className: 'evo-lib-badge ok', children: savedFlag }),
                  jsxs('div', {
                    className: 'evo-note-doc-acts',
                    children: [
                      jsx('button', {
                        type: 'button',
                        className: 'evo-btn evo-btn-ok evo-btn-sm',
                        onClick: write,
                        children: jsxs(Fragment, { children: [jsx(Save, {}), jsx('span', { children: t('save') })] }),
                      }),
                    ],
                  }),
                ],
              }),
              jsx('textarea', {
                className: 'evo-note-textarea',
                value: content,
                onInput: (e: { currentTarget: { value: string } }) => setContent(e.currentTarget.value),
                'aria-label': openFile,
              }),
            ],
          }),
          // 编译结果
          compile !== null && jsxs('div', {
            className: 'evo-lib-block',
            children: [
              jsxs('div', {
                className: 'evo-note-doc-head',
                children: [
                  jsx('span', { className: `evo-lib-badge ${compile.ok ? 'ok' : 'fail'}`, children: compile.ok ? t('libCompileOk') : t('libCompileFailed') }),
                  compile.tool !== null && jsx('span', { className: 'evo-note-pager-info', children: `${t('libTool')}: ${compile.tool}${compile.logPath !== null ? ` · ${compile.logPath}` : ''}` }),
                  compile.logPath !== null && jsx('button', {
                    type: 'button',
                    className: 'evo-btn evo-btn-sm',
                    onClick: readLog,
                    children: t('libReadLog'),
                  }),
                ],
              }),
              jsx('div', { className: 'evo-note-hit-snippet', children: compile.message }),
              compile.errors.length > 0 && jsx('div', {
                className: 'evo-lib-list',
                children: compile.errors.map((err, i) => jsx('div', {
                  className: 'evo-lib-err',
                  children: `${err.file}:${err.line ?? '?'} — ${err.message}`,
                }, `err-${i}`)),
              }),
              logText !== null && jsx('pre', { className: 'evo-lib-log', children: logText.slice(-12000) }),
            ],
          }),
          // 引用核对（WRITE-07）
          jsxs('div', {
            className: 'evo-lib-block',
            children: [
              jsxs('div', {
                className: 'evo-note-doc-head',
                children: [jsx('span', { className: 'evo-note-doc-name', children: t('libQuoteCheck') })],
              }),
              jsxs('div', {
                className: 'evo-lib-row',
                children: [
                  jsx('input', {
                    type: 'text',
                    className: 'evo-panel-input evo-lib-path',
                    placeholder: t('libQuoteText'),
                    value: quoteText,
                    onInput: (e: { currentTarget: { value: string } }) => setQuoteText(e.currentTarget.value),
                    'aria-label': t('libQuoteText'),
                  }),
                  jsx('input', {
                    type: 'text',
                    className: 'evo-panel-input evo-lib-num',
                    placeholder: t('libQuoteNumber'),
                    value: quoteNumber,
                    onInput: (e: { currentTarget: { value: string } }) => setQuoteNumber(e.currentTarget.value),
                    'aria-label': t('libQuoteNumber'),
                  }),
                  jsx('input', {
                    type: 'text',
                    className: 'evo-panel-input evo-lib-path',
                    placeholder: t('libQuoteExpDir'),
                    value: quoteExp,
                    onInput: (e: { currentTarget: { value: string } }) => setQuoteExp(e.currentTarget.value),
                    'aria-label': t('libQuoteExpDir'),
                  }),
                  jsx('input', {
                    type: 'text',
                    className: 'evo-panel-input evo-lib-path',
                    placeholder: t('libQuoteResultFile'),
                    value: quoteFile,
                    onInput: (e: { currentTarget: { value: string } }) => setQuoteFile(e.currentTarget.value),
                    'aria-label': t('libQuoteResultFile'),
                  }),
                  jsx('button', {
                    type: 'button',
                    className: 'evo-btn evo-btn-sm',
                    onClick: doQuote,
                    children: jsxs(Fragment, { children: [jsx(Quote, {}), jsx('span', { children: t('libQuoteCheckBtn') })] }),
                  }),
                ],
              }),
              quote !== null && jsxs('div', {
                className: 'evo-lib-list',
                children: [
                  jsx('div', { className: 'evo-note-pager-info', children: quote.message }),
                  quote.paperHits.map((h) => jsx('button', {
                    type: 'button',
                    className: 'evo-note-hit',
                    children: jsxs('div', {
                      className: 'evo-note-hit-main',
                      children: [
                        jsx('div', { className: 'evo-note-hit-title', children: h.title }),
                        jsx('div', { className: 'evo-note-hit-meta', children: `${t('libPage')} ${h.page} @ ${h.offset}` }),
                        jsx('div', { className: 'evo-note-hit-snippet', children: h.snippet }),
                      ],
                    }),
                  }, `ph-${h.paperId}-${h.page}-${h.offset}`)),
                  quote.fileHits.map((h) => jsx('button', {
                    type: 'button',
                    className: 'evo-note-hit',
                    children: jsxs('div', {
                      className: 'evo-note-hit-main',
                      children: [
                        jsx('div', { className: 'evo-note-hit-title', children: h.relative }),
                        jsx('div', { className: 'evo-note-hit-meta', children: `line ${h.line}` }),
                        jsx('div', { className: 'evo-note-hit-snippet', children: h.snippet }),
                      ],
                    }),
                  }, `fh-${h.relative}-${h.line}`)),
                ],
              }),
            ],
          }),
        ],
      }),
    ],
  })
}

// ── 面板入口 ────────────────────────────────────────────────────────────────

/** 文献与稿件面板（左侧栏注册点见文件头注释）。 */
export function LibraryPanel({ cwd }: { cwd: string | null }) {
  const [tab, setTab] = useState<'papers' | 'manuscript'>('papers')
  const [error, setError] = useState<string | null>(null)
  const [projects, setProjects] = useState<ProjectInfo[] | null>(null)
  const [project, setProject] = useState<string | null>(null)

  useEffect(() => {
    setProjects(null)
    setProject(null)
    void api<ProjectInfo[]>('projects-list')
      .then((list) => {
        setProjects(list)
        const target = normForMatch(cwd ?? '')
        const hit = list.find((p) => normForMatch(p.path) === target)
        if (hit !== undefined) setProject(hit.name)
        else if (list.length > 0) setProject(list[0]!.name)
      })
      .catch((e: any) => setError(String(e?.message ?? e)))
  }, [cwd])

  const tabBtn = (key: 'papers' | 'manuscript', label: string, icon: any) => jsx('button', {
    type: 'button',
    className: 'evo-insp-subtab',
    'data-active': tab === key || undefined,
    onClick: () => { setTab(key); setError(null) },
    children: jsxs(Fragment, { children: [jsx(icon, {}), jsx('span', { children: label })] }),
  }, key)

  return jsxs('div', {
    className: 'evo-panel',
    children: [
      jsxs('div', {
        className: 'evo-panel-head',
        children: [
          jsx(BookOpen, {}),
          jsx('span', { children: t('libraryPanel') }),
          projects !== null && projects.length > 0 && jsx('select', {
            className: 'evo-lib-project',
            value: project ?? '',
            onChange: (e: { currentTarget: { value: string } }) => setProject(e.currentTarget.value),
            'aria-label': t('libSelectProject'),
            children: projects.map((p) => jsx('option', { value: p.name, children: p.name }, p.name)),
          }),
        ],
      }),
      jsx('div', {
        className: 'evo-panel-body',
        children: [
          jsxs('div', {
            className: 'evo-skill-tabs',
            children: [
              tabBtn('papers', t('libPapers'), FileText),
              tabBtn('manuscript', t('libManuscript'), FileCode2),
            ],
          }),
          error !== null && jsx('div', { className: 'evo-panel-error', children: error }),
          project === null
            ? jsx('div', { className: 'evo-panel-hint', children: t('libNoProject') })
            : tab === 'papers'
              ? jsx(PapersTab, { project, onError: setError })
              : jsx(ManuscriptTab, { project, onError: setError }),
        ],
      }),
    ],
  })
}
