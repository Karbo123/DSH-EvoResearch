/**
 * 研究笔记面板（NOTE-UI）。
 *
 * 功能：当前项目（cwd）的
 * - 笔记列表（标题 + 正文预览 + 来源标记 note/observation + 旧 frontmatter 标记）；
 * - 阅读视图（正文按范围分页 offset/nextOffset；段落定位；frontmatter 默认折叠）；
 * - 编辑 / 新建（标题可选 + 正文必需，零 frontmatter）；
 * - 草稿两段式（草稿列表 → 预览 → 应用；conflict 提示"文件已被用户修改"+ 强制覆盖确认）；
 * - 背景资料（RESEARCH_MAP / USER_PROFILE / RESEARCH_TASTE / PROJECT_PROFILE
 *   查看与直接编辑；缺失显示"尚未创建"而非报错）。
 *
 * 数据经 POST /evoresearch/fs/<method>（与 panels.ts / experiments.ts 同款封装）。
 * 端点（notes-list / notes-read / notes-create / notes-write / notes-delete /
 * notes-search / notes-rebuild-index / notes-clear-index / notes-background-read /
 * notes-background-read-all / notes-background-write / notes-draft-update /
 * notes-draft-list / notes-draft-read / notes-draft-apply / notes-draft-discard）
 * 由 EvoResearchApiService 的 notes* Remote 方法与 fs 路由转发。
 *
 * ── 接线点（队长整合，参照 ExperimentsPanel）──
 * 1. client/threadlist.ts：`export type SideView = ... | 'experiments' | 'notes'`，
 *    并在 VIEWS 数组加 `{ key: 'notes', label: t('notesPanel'), icon: StickyNote }`；
 * 2. client/index.ts：import { ResearchNotesPanel } from './research-notes'，
 *    在 `view === 'experiments' ? jsx(ExperimentsPanel, {...}) :` 后加
 *    `: view === 'notes' ? jsx(ResearchNotesPanel, { cwd: current === undefined ? null : (sessions.byId[current]?.cwd ?? null) }) :`。
 */
import { jsx, jsxs, Fragment } from 'react/jsx-runtime'
import { useEffect, useState } from 'react'
import { t } from './i18n'
import {
  StickyNote, Map as MapIcon, FileText, FileClock, Search, Plus, RefreshCw,
  PenLine, Trash2, Check, X as XIcon, ChevronLeft, ChevronRight, ArrowLeft,
  NotebookPen,
} from 'lucide-react'
import { renderMarkdown } from './markdown'

/** 阅读分页大小（字符）。 */
const READ_PAGE = 4000
/** 列表分页大小。 */
const LIST_PAGE = 100

// ── 与服务端 NotesService 对齐的纯 JSON 行类型 ──────────────────────────────

type NoteSource = 'note' | 'observation'
type BackgroundKind = 'researchMap' | 'userProfile' | 'researchTaste' | 'projectProfile'

interface NoteSummaryRow {
  noteId: string
  fileName: string
  title: string
  bodyPreview: string
  source: NoteSource
  hasFrontmatter: boolean
  legacyDir?: string
  updatedAt: number
  byteSize: number
  paragraphCount: number
}

interface NoteReadRow extends NoteSummaryRow {
  body: string
  totalLength: number
  offset: number
  nextOffset: number | null
  frontmatter?: Record<string, unknown>
}

interface NoteSearchHitRow {
  noteId: string
  fileName: string
  title: string
  source: NoteSource
  paragraphIndex: number
  offset: number
  snippet: string
  score: number
  updatedAt: number
}

interface BackgroundDocRow {
  kind: BackgroundKind
  fileName: string
  exists: boolean
  content: string
  updatedAt: number
  byteSize: number
}

interface DraftMetaRow {
  draftId: string
  kind: BackgroundKind
  fileName: string
  note: string
  baseHash: string | null
  targetExisted: boolean
  createdAt: number
}

interface DraftDocRow extends DraftMetaRow {
  draft: string
}

/** 简单 POST JSON 封装（与 panels.ts / experiments.ts 同款）。 */
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

function fmtTime(ts: number): string {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 来源徽标：新笔记 / 旧 Observation。 */
function SourceBadge({ source }: { source: NoteSource }) {
  return jsx('span', {
    className: `evo-note-badge ${source === 'observation' ? 'legacy' : 'note'}`,
    children: source === 'observation' ? t('legacyObservation') : t('researchNote'),
  })
}

/** 旧 frontmatter 折叠块（NOTE-04 / §12.3：默认隐藏，可展开查看）。 */
function FrontmatterBlock({ frontmatter }: { frontmatter: Record<string, unknown> }) {
  const [open, setOpen] = useState(false)
  const entries = Object.entries(frontmatter)
  if (entries.length === 0) return null
  return jsxs('div', {
    className: 'evo-note-fm',
    children: [
      jsx('button', {
        type: 'button',
        className: 'evo-note-fm-toggle',
        onClick: () => setOpen((v) => !v),
        children: `${t('frontmatter')}（${entries.length}）${open ? ' ▾' : ' ▸'}`,
      }),
      open && jsx('div', {
        className: 'evo-note-fm-grid',
        children: entries.map(([key, value]) => jsxs(Fragment, {
          children: [
            jsx('span', { className: 'evo-note-fm-key', children: key }),
            jsx('span', { children: String(value) }),
          ],
        }, key)),
      }),
    ],
  })
}

/** 阅读视图：标题 + 元信息 + 分页正文 + frontmatter 折叠 + 操作。 */
function NoteReader({ workspaceDir, noteId, initialOffset, onBack, onChanged, onError }: {
  workspaceDir: string
  noteId: string
  initialOffset: number
  onBack: () => void
  onChanged: () => void
  onError: (message: string) => void
}) {
  const [read, setRead] = useState<NoteReadRow | null>(null)
  const [offset, setOffset] = useState(Math.max(0, initialOffset))
  const [editing, setEditing] = useState(false)
  const [draftBody, setDraftBody] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = (at: number) => {
    setRead(null)
    setBusy(true)
    void api<NoteReadRow>('notes-read', { workspaceDir, noteId, offset: at, limit: READ_PAGE })
      .then((row) => { setRead(row); setOffset(row.offset) })
      .catch((e: any) => onError(String(e?.message ?? e)))
      .finally(() => setBusy(false))
  }
  useEffect(() => { load(initialOffset) }, [noteId])

  const save = () => {
    if (draftBody.trim() === '' || saving) return
    setSaving(true)
    void api<NoteReadRow>('notes-write', { workspaceDir, noteId, body: draftBody })
      .then(() => { setSaving(false); setEditing(false); onChanged(); load(0) })
      .catch((e: any) => { setSaving(false); onError(String(e?.message ?? e)) })
  }

  /** 进入编辑：重新拉取完整正文（当前视图只是分页切片，不能直接作为保存底稿）。 */
  const startEdit = () => {
    if (busy) return
    setBusy(true)
    void api<NoteReadRow>('notes-read', { workspaceDir, noteId })
      .then((row) => { setBusy(false); setDraftBody(row.body); setEditing(true) })
      .catch((e: any) => { setBusy(false); onError(String(e?.message ?? e)) })
  }

  const remove = () => {
    if (busy) return
    setBusy(true)
    void api<{ ok: boolean }>('notes-delete', { workspaceDir, noteId })
      .then((result) => {
        setBusy(false)
        if (result.ok) { onChanged(); onBack() }
      })
      .catch((e: any) => { setBusy(false); onError(String(e?.message ?? e)) })
  }

  if (editing) {
    return jsxs('div', {
      className: 'evo-note-editor',
      children: [
        jsx('textarea', {
          className: 'evo-note-textarea',
          value: draftBody,
          autoFocus: true,
          onInput: (e: { currentTarget: { value: string } }) => setDraftBody(e.currentTarget.value),
        }),
        jsxs('div', {
          className: 'evo-goal-proposal-acts',
          children: [
            jsx('button', { type: 'button', className: 'evo-btn evo-btn-ok evo-btn-sm', disabled: saving || draftBody.trim() === '', onClick: save, children: t('save') }),
            jsx('button', { type: 'button', className: 'evo-btn evo-btn-sm', disabled: saving, onClick: () => setEditing(false), children: t('cancel') }),
          ],
        }),
      ],
    })
  }

  if (read === null) {
    return jsx('div', { className: 'evo-panel-hint', children: t('loading') })
  }

  const prevDisabled = read.offset <= 0
  const nextDisabled = read.nextOffset === null

  return jsxs('div', {
    className: 'evo-note-detail',
    children: [
      // 头部：返回 + 标题 + 徽标 + 操作
      jsxs('div', {
        className: 'evo-note-detail-head',
        children: [
          jsx('button', {
            type: 'button',
            className: 'evo-panel-act',
            title: t('notesBack'),
            'aria-label': t('notesBack'),
            disabled: busy,
            onClick: onBack,
            children: jsx(ArrowLeft, {}),
          }),
          jsx('span', { className: 'evo-note-detail-title', children: read.title }),
          jsx(SourceBadge, { source: read.source }),
          read.hasFrontmatter && jsx('span', { className: 'evo-note-badge fm', children: t('frontmatter') }),
          jsx('span', { className: 'evo-note-pager-info', children: `${read.paragraphCount} ${t('paragraphs')} · ${read.byteSize} B` }),
          jsxs('div', {
            className: 'evo-note-detail-acts',
            children: [
              jsx('button', {
                type: 'button',
                className: 'evo-panel-act',
                title: t('edit'),
                'aria-label': t('edit'),
                disabled: busy,
                onClick: startEdit,
                children: jsx(PenLine, {}),
              }),
              confirmDelete
                ? jsx('button', {
                    type: 'button',
                    className: 'evo-panel-act evo-del-confirm',
                    disabled: busy,
                    onClick: remove,
                    children: t('deleteQ'),
                  })
                : jsx('button', {
                    type: 'button',
                    className: 'evo-panel-act evo-del',
                    title: t('deleteNote'),
                    'aria-label': t('deleteNote'),
                    disabled: busy,
                    onClick: () => { setConfirmDelete(true); setTimeout(() => setConfirmDelete((v) => (v ? false : v)), 5000) },
                    children: jsx(Trash2, {}),
                  }),
            ],
          }),
        ],
      }),
      read.hasFrontmatter && read.frontmatter !== undefined && jsx(FrontmatterBlock, { frontmatter: read.frontmatter }),
      // 正文（Markdown 渲染；分页切片由服务端返回）
      jsx('div', {
        className: 'evo-md evo-note-body',
        dangerouslySetInnerHTML: { __html: renderMarkdown(read.body) },
      }),
      // 分页：上一页 / 下一页 + 段落定位信息
      jsxs('div', {
        className: 'evo-note-pager',
        children: [
          jsx('button', {
            type: 'button',
            className: 'evo-btn evo-btn-sm',
            disabled: prevDisabled || busy,
            onClick: () => load(Math.max(0, read.offset - READ_PAGE)),
            children: jsxs(Fragment, { children: [jsx(ChevronLeft, {}), jsx('span', { children: t('prevPage') })] }),
          }),
          jsx('span', {
            className: 'evo-note-pager-info',
            children: `${t('paragraphLocation')} ${read.offset + 1}-${read.offset + read.body.length} / ${read.totalLength} ${t('chars')}`,
          }),
          jsx('button', {
            type: 'button',
            className: 'evo-btn evo-btn-sm',
            disabled: nextDisabled || busy,
            onClick: () => { if (read.nextOffset !== null) load(read.nextOffset) },
            children: jsxs(Fragment, { children: [jsx('span', { children: t('nextPage') }), jsx(ChevronRight, {})] }),
          }),
        ],
      }),
    ],
  })
}

/** 笔记 Tab：列表 + 搜索（段落定位）+ 新建 + 阅读/编辑。 */
function NotesTab({ workspaceDir, onError }: { workspaceDir: string; onError: (message: string) => void }) {
  const [list, setList] = useState<NoteSummaryRow[] | null>(null)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<NoteSearchHitRow[] | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [openOffset, setOpenOffset] = useState(0)
  const [creating, setCreating] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newBody, setNewBody] = useState('')
  const [listOffset, setListOffset] = useState(0)
  const [loading, setLoading] = useState(false)

  const load = (fresh = false) => {
    if (fresh) { setList(null); setListOffset(0) }
    setLoading(true)
    void api<NoteSummaryRow[]>('notes-list', { workspaceDir, limit: LIST_PAGE, offset: fresh ? 0 : listOffset })
      .then((rows) => {
        setLoading(false)
        setList((prev) => (fresh ? rows : [...(prev ?? []), ...rows]))
        if (fresh) setListOffset(rows.length)
        else setListOffset(listOffset + rows.length)
      })
      .catch((e: any) => { setLoading(false); onError(String(e?.message ?? e)) })
  }
  useEffect(() => { load(true) }, [workspaceDir])

  const doSearch = () => {
    const q = query.trim()
    if (q === '') { setHits(null); return }
    setHits(null)
    void api<NoteSearchHitRow[]>('notes-search', { workspaceDir, query: q, limit: 30 })
      .then(setHits)
      .catch((e: any) => onError(String(e?.message ?? e)))
  }

  const doCreate = () => {
    if (newBody.trim() === '' || creating) return
    setCreating(true)
    void api<NoteSummaryRow>('notes-create', { workspaceDir, ...(newTitle.trim() === '' ? {} : { title: newTitle.trim() }), body: newBody })
      .then((created) => {
        setCreating(false)
        setNewTitle(''); setNewBody('')
        load(true)
        setOpenId(created.noteId); setOpenOffset(0)
      })
      .catch((e: any) => { setCreating(false); onError(String(e?.message ?? e)) })
  }

  if (openId !== null) {
    return jsx(NoteReader, {
      workspaceDir,
      noteId: openId,
      initialOffset: openOffset,
      onBack: () => { setOpenId(null); setOpenOffset(0) },
      onChanged: () => load(true),
      onError,
    })
  }

  return jsxs(Fragment, {
    children: [
      // 工具栏：搜索 + 刷新
      jsxs('div', {
        className: 'evo-note-toolbar',
        children: [
          jsx('input', {
            type: 'text',
            className: 'evo-note-search',
            placeholder: t('searchNotes'),
            value: query,
            onInput: (e: { currentTarget: { value: string } }) => setQuery(e.currentTarget.value),
            onKeyDown: (e: { key: string }) => { if (e.key === 'Enter') doSearch() },
            'aria-label': t('searchNotes'),
          }),
          jsx('button', { type: 'button', className: 'evo-panel-add', onClick: doSearch, children: jsx(Search, {}) }),
          jsx('button', { type: 'button', className: 'evo-icon-btn', title: t('refresh'), onClick: () => load(true), children: jsx(RefreshCw, {}) }),
        ],
      }),
      // 新建笔记（标题可选 + 正文必需）
      jsxs('div', {
        className: 'evo-note-editor',
        children: [
          jsx('input', {
            type: 'text',
            className: 'evo-panel-input',
            placeholder: t('noteTitleOptional'),
            value: newTitle,
            disabled: creating,
            onInput: (e: { currentTarget: { value: string } }) => setNewTitle(e.currentTarget.value),
          }),
          jsx('textarea', {
            className: 'evo-note-textarea evo-note-textarea-sm',
            placeholder: t('noteBodyRequired'),
            value: newBody,
            disabled: creating,
            onInput: (e: { currentTarget: { value: string } }) => setNewBody(e.currentTarget.value),
          }),
          jsx('button', {
            type: 'button',
            className: 'evo-panel-add',
            disabled: creating || newBody.trim() === '',
            onClick: doCreate,
            children: jsxs(Fragment, { children: [jsx(Plus, {}), jsx('span', { children: creating ? t('creating') : t('newNote') })] }),
          }),
        ],
      }),
      // 搜索结果（段落定位）
      hits !== null && hits.length > 0 && jsxs('div', {
        className: 'evo-panel-row',
        children: [
          jsx('span', { className: 'evo-panel-row-label', children: `${t('searchResults')}（${hits.length}）` }),
          jsx('div', {
            className: 'evo-panel-list',
            children: hits.map((hit) => jsx('button', {
              type: 'button',
              className: 'evo-note-hit',
              onClick: () => { setOpenId(hit.noteId); setOpenOffset(hit.offset) },
              children: jsxs('div', {
                className: 'evo-note-hit-main',
                children: [
                  jsxs('div', {
                    className: 'evo-note-hit-title',
                    children: [jsx('span', { children: hit.title }), jsx(SourceBadge, { source: hit.source })],
                  }),
                  jsx('div', { className: 'evo-note-hit-snippet', children: hit.snippet }),
                  jsx('div', { className: 'evo-note-hit-meta', children: `${t('paragraphLocation')} ${hit.paragraphIndex + 1} · ${t('jumpToParagraph')}` }),
                ],
              }),
            }, `${hit.noteId}#${hit.paragraphIndex}`)),
          }),
        ],
      }),
      // 笔记列表
      list === null
        ? jsx('div', { className: 'evo-panel-hint', children: t('loading') })
        : list.length === 0
          ? jsx('div', { className: 'evo-panel-hint', children: t('noNotesYet') })
          : jsx('div', {
              className: 'evo-panel-list',
              children: list.map((note) => jsx('button', {
                type: 'button',
                className: 'evo-note-card',
                onClick: () => { setOpenId(note.noteId); setOpenOffset(0) },
                children: jsxs(Fragment, {
                  children: [
                    jsxs('div', {
                      className: 'evo-note-card-head',
                      children: [
                        jsx('span', { className: 'evo-note-card-title', children: note.title }),
                        jsx(SourceBadge, { source: note.source }),
                        note.hasFrontmatter && jsx('span', { className: 'evo-note-badge fm', children: t('frontmatter') }),
                      ],
                    }),
                    note.bodyPreview !== '' && jsx('div', { className: 'evo-note-card-preview', children: note.bodyPreview }),
                    jsxs('div', {
                      className: 'evo-note-card-meta',
                      children: [
                        jsx('span', { children: fmtTime(note.updatedAt) }),
                        note.paragraphCount > 0 && jsx('span', { children: `${note.paragraphCount} ${t('paragraphs')}` }),
                      ],
                    }),
                  ],
                }),
              }, note.noteId)),
            }),
      (list ?? []).length === LIST_PAGE && jsx('button', {
        type: 'button',
        className: 'evo-btn evo-btn-run',
        disabled: loading,
        onClick: () => load(false),
        children: t('loadEarlier'),
      }),
    ],
  })
}

/** 单个背景资料文档（查看 / 直接编辑；缺失显示"尚未创建"）。 */
function DocBlock({ workspaceDir, kind, onError }: { workspaceDir: string; kind: BackgroundKind; onError: (message: string) => void }) {
  const [doc, setDoc] = useState<BackgroundDocRow | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)

  const load = () => {
    setDoc(null)
    void api<BackgroundDocRow>('notes-background-read', { workspaceDir, kind })
      .then((row) => { setDoc(row); setDraft(row.content) })
      .catch((e: any) => onError(String(e?.message ?? e)))
  }
  useEffect(() => { load() }, [kind])

  const save = () => {
    if (saving) return
    setSaving(true)
    void api<{ ok: boolean }>('notes-background-write', { workspaceDir, kind, content: draft })
      .then((result) => {
        setSaving(false)
        if (result.ok) { setEditing(false); load() }
        else onError(t('saveFailed'))
      })
      .catch((e: any) => { setSaving(false); onError(String(e?.message ?? e)) })
  }

  if (editing) {
    return jsxs('div', {
      className: 'evo-note-doc',
      children: [
        jsxs('div', {
          className: 'evo-note-doc-head',
          children: [jsx('span', { className: 'evo-note-doc-name', children: doc?.fileName ?? '' })],
        }),
        jsx('textarea', {
          className: 'evo-note-textarea',
          value: draft,
          autoFocus: true,
          onInput: (e: { currentTarget: { value: string } }) => setDraft(e.currentTarget.value),
        }),
        jsxs('div', {
          className: 'evo-goal-proposal-acts',
          children: [
            jsx('button', { type: 'button', className: 'evo-btn evo-btn-ok evo-btn-sm', disabled: saving, onClick: save, children: t('save') }),
            jsx('button', { type: 'button', className: 'evo-btn evo-btn-sm', disabled: saving, onClick: () => setEditing(false), children: t('cancel') }),
          ],
        }),
      ],
    })
  }

  return jsxs('div', {
    className: 'evo-note-doc',
    children: [
      jsxs('div', {
        className: 'evo-note-doc-head',
        children: [
          jsx('span', { className: 'evo-note-doc-name', children: doc?.fileName ?? '' }),
          doc?.exists === true && doc.updatedAt > 0 && jsx('span', { className: 'evo-note-pager-info', children: fmtTime(doc.updatedAt) }),
          jsxs('div', {
            className: 'evo-note-doc-acts',
            children: [
              jsx('button', {
                type: 'button',
                className: 'evo-panel-act',
                title: t('edit'),
                'aria-label': t('edit'),
                onClick: () => { setDraft(doc?.content ?? ''); setEditing(true) },
                children: jsx(PenLine, {}),
              }),
            ],
          }),
        ],
      }),
      doc === null
        ? jsx('div', { className: 'evo-panel-hint', children: t('loading') })
        : doc.exists
          ? jsx('div', { className: 'evo-note-doc-body evo-md', dangerouslySetInnerHTML: { __html: renderMarkdown(doc.content) } })
          : jsx('div', { className: 'evo-note-doc-missing', children: t('notCreatedYet') }),
    ],
  })
}

/** 背景资料 Tab：USER_PROFILE / RESEARCH_TASTE / PROJECT_PROFILE。 */
function BackgroundTab({ workspaceDir, onError }: { workspaceDir: string; onError: (message: string) => void }) {
  return jsxs('div', {
    className: 'evo-panel-row',
    children: [
      jsx('span', { className: 'evo-panel-hint', children: t('backgroundHint') }),
      jsx('div', { className: 'evo-panel-list', children: (['userProfile', 'researchTaste', 'projectProfile'] as BackgroundKind[]).map((kind) => jsx(DocBlock, { workspaceDir, kind, onError }, kind)) }),
    ],
  })
}

/** 草稿 Tab：草稿列表 → 预览 → 应用（conflict 提示 + 强制覆盖确认）/ 丢弃。 */
function DraftsTab({ workspaceDir, onError }: { workspaceDir: string; onError: (message: string) => void }) {
  const [drafts, setDrafts] = useState<DraftMetaRow[] | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [preview, setPreview] = useState<DraftDocRow | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [conflict, setConflict] = useState<string | null>(null)
  const [forcing, setForcing] = useState<string | null>(null)

  const load = () => {
    setDrafts(null)
    void api<DraftMetaRow[]>('notes-draft-list', { workspaceDir })
      .then(setDrafts)
      .catch((e: any) => onError(String(e?.message ?? e)))
  }
  useEffect(() => { load() }, [workspaceDir])

  const expand = (draftId: string) => {
    if (expanded === draftId) { setExpanded(null); setPreview(null); setConflict(null); return }
    setExpanded(draftId)
    setConflict(null)
    void api<DraftDocRow>('notes-draft-read', { workspaceDir, draftId })
      .then(setPreview)
      .catch((e: any) => onError(String(e?.message ?? e)))
  }

  const apply = (draftId: string, force: boolean) => {
    setBusy(draftId)
    setConflict(null)
    void api<{ ok: boolean; conflict?: boolean; error?: string }>('notes-draft-apply', { workspaceDir, draftId, ...(force ? { force: true } : {}) })
      .then((result) => {
        setBusy(null)
        if (result.ok) { setExpanded(null); setPreview(null); load() }
        else if (result.conflict) {
          setConflict(draftId)
          setForcing(draftId)
        } else {
          onError(result.error ?? t('applyFailed'))
        }
      })
      .catch((e: any) => { setBusy(null); onError(String(e?.message ?? e)) })
  }

  const discard = (draftId: string) => {
    setBusy(draftId)
    void api<{ ok: boolean }>('notes-draft-discard', { workspaceDir, draftId })
      .then(() => {
        setBusy(null)
        if (expanded === draftId) { setExpanded(null); setPreview(null) }
        load()
      })
      .catch((e: any) => { setBusy(null); onError(String(e?.message ?? e)) })
  }

  return jsxs(Fragment, {
    children: [
      jsx('span', { className: 'evo-panel-hint', children: t('draftsHint') }),
      drafts === null
        ? jsx('div', { className: 'evo-panel-hint', children: t('loading') })
        : drafts.length === 0
          ? jsx('div', { className: 'evo-panel-hint', children: t('noDrafts') })
          : jsx('div', {
              className: 'evo-panel-list',
              children: drafts.map((d) => jsxs('div', {
                className: 'evo-note-draft',
                children: [
                  jsxs('div', {
                    className: 'evo-note-draft-head',
                    children: [
                      jsx('button', {
                        type: 'button',
                        className: 'evo-skill-name-btn',
                        onClick: () => expand(d.draftId),
                        children: jsx('span', { className: 'evo-note-draft-target', children: d.fileName }),
                      }),
                      jsx('span', { className: 'evo-note-draft-note', title: d.note, children: d.note !== '' ? d.note : fmtTime(d.createdAt) }),
                      jsx('span', { className: 'evo-note-pager-info', children: fmtTime(d.createdAt) }),
                    ],
                  }),
                  expanded === d.draftId && jsxs('div', {
                    className: 'evo-note-draft-body',
                    children: [
                      preview !== null && jsx('div', {
                        className: 'evo-note-draft-text',
                        children: preview.draft,
                      }),
                      conflict === d.draftId && jsxs('div', {
                        className: 'evo-note-conflict',
                        children: [
                          jsx('span', { children: t('draftConflict') }),
                          forcing === d.draftId && jsx('button', {
                            type: 'button',
                            className: 'evo-btn evo-btn-danger evo-btn-sm',
                            style: { marginLeft: 8 },
                            disabled: busy === d.draftId,
                            onClick: () => apply(d.draftId, true),
                            children: t('forceApply'),
                          }),
                        ],
                      }),
                      jsxs('div', {
                        className: 'evo-note-draft-acts',
                        children: [
                          jsx('button', {
                            type: 'button',
                            className: 'evo-btn evo-btn-ok evo-btn-sm',
                            disabled: busy === d.draftId,
                            onClick: () => apply(d.draftId, false),
                            children: jsxs(Fragment, { children: [jsx(Check, {}), jsx('span', { children: t('applyDraft') })] }),
                          }),
                          jsx('button', {
                            type: 'button',
                            className: 'evo-btn evo-btn-danger evo-btn-sm',
                            disabled: busy === d.draftId,
                            onClick: () => discard(d.draftId),
                            children: jsxs(Fragment, { children: [jsx(XIcon, {}), jsx('span', { children: t('discardDraft') })] }),
                          }),
                        ],
                      }),
                    ],
                  }),
                ],
              }, d.draftId)),
            }),
    ],
  })
}

/** 研究笔记面板入口（左侧栏/主视图注册点见文件头注释）。 */
export function ResearchNotesPanel({ cwd }: { cwd: string | null }) {
  const [tab, setTab] = useState<'notes' | 'map' | 'background' | 'drafts'>('notes')
  const [error, setError] = useState<string | null>(null)
  const workspaceDir = cwd ?? ''

  const tabBtn = (key: typeof tab, label: string, icon: any) => jsx('button', {
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
        children: [jsx(NotebookPen, {}), jsx('span', { children: t('notesPanel') })],
      }),
      jsx('div', {
        className: 'evo-panel-body',
        children: [
          jsxs('div', {
            className: 'evo-skill-tabs',
            children: [
              tabBtn('notes', t('notesList'), StickyNote),
              tabBtn('map', t('researchMap'), MapIcon),
              tabBtn('background', t('backgroundDocs'), FileText),
              tabBtn('drafts', t('drafts'), FileClock),
            ],
          }),
          error !== null && jsx('div', { className: 'evo-panel-error', children: error }),
          cwd === null
            ? jsx('div', { className: 'evo-panel-hint', children: t('notesNoWorkspace') })
            : tab === 'notes'
              ? jsx(NotesTab, { workspaceDir, onError: setError })
              : tab === 'map'
                ? jsx(DocBlock, { workspaceDir, kind: 'researchMap', onError: setError })
                : tab === 'background'
                  ? jsx(BackgroundTab, { workspaceDir, onError: setError })
                  : jsx(DraftsTab, { workspaceDir, onError: setError }),
        ],
      }),
    ],
  })
}
