/**
 * 文献工具组注册（P2-2）：模型侧的文献检索 / 综合检索 / 网络论文导入。
 *
 * 对齐 memory/tools.ts 的注册模式（paramsSchema/textRender/wire snake_case）：
 * - search_library：本项目本地文献库检索（文件名/标题/全文/笔记/references），
 *   命中附页码定位片段；
 * - search_literature：本地文献库 + （平台具备联网检索时）网络查询，合并去重
 *   返回题录级候选；网络失败绝不抛错（单条降级为 web_error）；
 * - import_literature：下载论文 PDF 并入库（原文落盘、索引可重建）。
 *   付费墙/非 PDF 明确失败，不伪造导入。
 *
 * 平台 web_search 可用性由组装层注入（adapters.tools.get('web_search') 探测），
 * 本模块只依赖 LibraryToolsDeps 门面，便于测试替身注入。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { LibraryIndexer, LibrarySearch } from './index.js'
import type { SearchHit } from './types.js'
import { projectDir, projectNameFromWorkspace } from '../core/paths.js'
import type { AcademicSearchResult } from '../academic-search.js'

/** 工具上下文依赖门面（组装层注入；测试可整体替换）。 */
export interface LibraryToolsDeps {
  /** 部署根目录（projects/ 所在目录）。 */
  dataRoot: string
  /** 本地文献检索服务。 */
  librarySearch: LibrarySearch
  /** 文献索引服务（addPaper 入库）。 */
  libraryIndexer: LibraryIndexer
  /** 平台 web_search 可用性探测（组装层经 adapters.tools.get('web_search') 注入）。 */
  hasWebSearch(): boolean
  /** 学术 Provider 是否可用；独立于通用 web_search 工具。 */
  hasAcademicSearch?(): boolean
  /**
   * 调一次平台 web_search。content 为文本块拼接后的结果文本。
   * 平台工具入参形态以部署为准：默认 { query: string }。
   */
  invokeWebSearch(query: string): Promise<string>
  /** 测试注入 fetch；缺省用全局 fetch。 */
  fetchImpl?: typeof fetch
  /** 论文专用检索；优先使用 OpenAlex，Crossref 作为无 Key 兜底。 */
  invokeAcademicSearch?(query: string, limit: number): Promise<AcademicSearchResult>
  /** Semantic Scholar 论文图扩展：前向引用、参考文献或共引。 */
  invokeAcademicRelated?(input: { paperId: string; direction?: 'forward' | 'backward' | 'co-citation'; limit?: number; smart?: boolean; minCitations?: number }): Promise<AcademicSearchResult>
  /** Semantic Scholar 个性化推荐。 */
  invokeAcademicRecommendations?(input: { positiveIds: string[]; negativeIds?: string[]; limit?: number; perSeed?: boolean }): Promise<AcademicSearchResult>
  /** Semantic Scholar 论文片段检索。 */
  invokeAcademicSnippets?(input: { query: string; paperId?: string; limit?: number }): Promise<unknown>
}

/** ctx.tools 最小结构（避免直接依赖运行时类型）。 */
interface ToolsServiceLike {
  register(definition: ToolDefinition): () => void
}

/** 导入 PDF 的体积上限（50MB）。 */
const MAX_PDF_BYTES = 50 * 1024 * 1024

/** search_literature 输出总条数上限（local_hits + web_results 合计）。 */
const LITERATURE_RESULT_CAP = 16

/** 从工具执行上下文推断工作区（同 memory/tools.ts：agent 直接持有 session）。 */
function workspaceOf(exec: ToolRunContext): string {
  const agent = (exec as { agent?: { session?: { header?: { cwd?: string } }; ctx?: { session?: { header?: { cwd?: string } } } } }).agent
  try {
    return agent?.session?.header?.cwd ?? ''
  } catch {
    return ''
  }
}

/** 构造一个 JSON Schema 参数定义。 */
function paramsSchema(properties: Record<string, unknown>, required: readonly string[] = []): Record<string, unknown> {
  return { type: 'object', properties, required, additionalProperties: false }
}

/** 文本输出渲染。 */
function textRender(_args: unknown, value: unknown): Array<{ type: 'text'; text: string }> {
  return [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }]
}

/**
 * 文件名安全 slug：仅保留 [a-z0-9_-]，≤64 字符；
 * 全部字符被过滤时回退 'paper'。
 */
function slugifyFileName(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '')
  return /[a-z0-9]/.test(slug) ? slug : 'paper'
}

/** 在目录内为 slug.pdf 找一个未占用的路径（已存在则加 -2/-3 后缀）。 */
function uniquePdfPath(dir: string, slug: string): string {
  let candidate = path.join(dir, `${slug}.pdf`)
  let n = 2
  while (fs.existsSync(candidate) && n <= 100) {
    candidate = path.join(dir, `${slug}-${n}.pdf`)
    n += 1
  }
  return candidate
}

/** SearchHit → wire JSON（snake_case；locations 截前 3 处、只留 page/snippet）。 */
function hitToWire(hit: SearchHit): Record<string, unknown> {
  return {
    paper_id: hit.paper.paperId,
    title: hit.paper.title,
    file_name: hit.paper.fileName,
    score: Number(hit.score.toFixed(4)),
    matched_fields: hit.matchedFields,
    ...(hit.locations.length > 0
      ? {
          locations: hit.locations
            .slice(0, 3)
            .map((loc) => ({ page: loc.page, snippet: loc.snippet })),
        }
      : {}),
  }
}

/**
 * 注册文献工具组（本地/综合检索、引用图扩展、推荐、片段检索、导入）。
 * @returns 解除注册的 disposer（tools 服务缺失时为空函数）。
 */
export function registerLibraryTools(ctx: Context, deps: LibraryToolsDeps): () => void {
  let tools: ToolsServiceLike | undefined
  try {
    tools = ctx.get('tools') as ToolsServiceLike | undefined
  } catch {
    tools = undefined
  }
  if (!tools) return () => {}
  const disposers: Array<() => void> = []

  const register = (definition: ToolDefinition): void => {
    disposers.push(tools.register(definition))
  }

  // ── search_library ───────────────────────────────────────────────────────
  register({
    name: 'search_library',
    description:
      '检索本项目本地文献库（已索引 PDF 的 文件名/标题/全文/笔记/参考文献）。命中附页码定位；' +
      '配合 read_memory 无法读 PDF——用 library 页文本定位（libraryGetPageText 接口由面板使用），' +
      '模型侧主要消费题录与片段。',
    parameters: paramsSchema(
      {
        query: { type: 'string', description: '检索关键词（支持中文与英文，多词任一命中即返回）' },
        limit: { type: 'number', description: '返回条数上限，默认 8，最大 20' },
      },
      ['query'],
    ),
    output: {
      schema: {
        type: 'object',
        properties: {
          project: { type: 'string' },
          hits: { type: 'array', items: { type: 'object' } },
        },
      },
      render: textRender,
    },
    execute: async (args, exec) => {
      const input = args as { query: string; limit?: number }
      const workspace = workspaceOf(exec)
      const project = projectNameFromWorkspace(deps.dataRoot, workspace)
      if (!project) return { error: '当前会话不在科研项目内，无法定位文献库' }
      const limit = Math.min(Math.max(Math.floor(input.limit ?? 8), 1), 20)
      const hits = deps.librarySearch.search(project, input.query, { limit })
      return { project, hits: hits.map(hitToWire) }
    },
  })

  // ── search_literature ────────────────────────────────────────────────────
  register({
    name: 'search_literature',
    description:
      '文献综合检索：本地文献库 + （启用联网时）优先使用 OpenAlex/Crossref 的学术题录检索，' +
      '避免通用网页搜索把词典和 SEO 页面混入论文结果；返回题录级候选。' +
      '当用户要求查找论文、文献综述或某主题的相关研究时，应优先调用本工具；' +
      '用户说『把第 N 篇下进来』后用 import_literature 落库。',
    parameters: paramsSchema(
      {
        queries: {
          type: 'array',
          items: { type: 'string' },
          description: '检索词列表（1..4 条；中英文均可，建议同义变体分开给）',
        },
        limit_per_query: { type: 'number', description: '每条检索词的返回条数上限，默认 5' },
      },
      ['queries'],
    ),
    output: {
      schema: {
        type: 'object',
        properties: {
          local_hits: { type: 'array', items: { type: 'object' } },
          web_results: { type: 'array', items: { type: 'object' } },
          note: { type: 'string' },
        },
      },
      render: textRender,
    },
    execute: async (args, exec) => {
      const input = args as { queries?: unknown; limit_per_query?: number }
      const queries = (Array.isArray(input.queries) ? input.queries : [])
        .map((q) => String(q ?? '').trim())
        .filter((q) => q !== '')
        .slice(0, 4)
      if (queries.length === 0) {
        return { error: 'queries 至少需要 1 条检索词（最多 4 条）' }
      }
      const perQuery = Math.min(Math.max(Math.floor(input.limit_per_query ?? 5), 1), 20)
      const notes: string[] = []

      // 本地部分：与 search_library 同逻辑；跨查询按 paper_id 去重。
      const workspace = workspaceOf(exec)
      const project = projectNameFromWorkspace(deps.dataRoot, workspace)
      const localHits: Array<Record<string, unknown>> = []
      if (!project) {
        notes.push('当前会话不在科研项目内，已跳过本地文献库检索')
      } else {
        const seen = new Set<string>()
        for (const q of queries) {
          if (localHits.length >= LITERATURE_RESULT_CAP) break
          for (const hit of deps.librarySearch.search(project, q, { limit: perQuery })) {
            if (localHits.length >= LITERATURE_RESULT_CAP) break
            if (seen.has(hit.paper.paperId)) continue
            seen.add(hit.paper.paperId)
            localHits.push(hitToWire(hit))
          }
        }
      }

      // 网络部分：礼貌并发=1（顺序逐条）；单条失败降级为 web_error，绝不抛错。
      const webResults: Array<
        { kind: 'academic'; query: string; provider: string; results: unknown[] } |
        { kind: 'web'; query: string; excerpt: string } |
        { kind: 'web_error' | 'academic_error'; query: string; error: string }
      > = []
      const academicSearch = deps.invokeAcademicSearch
      const academicAvailable = academicSearch !== undefined && (deps.hasAcademicSearch?.() ?? deps.hasWebSearch())
      if (!deps.hasWebSearch() && !academicAvailable) {
        notes.push('未配置网络检索（平台 web_search 工具不可用），仅返回本地文献库结果')
      } else if (academicAvailable) {
        for (const q of queries) {
          if (localHits.length + webResults.length >= LITERATURE_RESULT_CAP) break
          try {
            const result = await academicSearch(q, perQuery)
            webResults.push({ kind: 'academic', query: q, provider: result.provider, results: result.sources })
          } catch (error) {
            webResults.push({
              kind: 'academic_error',
              query: q,
              error: error instanceof Error ? error.message : String(error),
            })
          }
        }
      } else {
        for (const q of queries) {
          if (localHits.length + webResults.length >= LITERATURE_RESULT_CAP) break
          try {
            const text = await deps.invokeWebSearch(q)
            webResults.push({ kind: 'web', query: q, excerpt: String(text ?? '').slice(0, 400) })
          } catch (error) {
            webResults.push({
              kind: 'web_error',
              query: q,
              error: error instanceof Error ? error.message : String(error),
            })
          }
        }
      }

      return { local_hits: localHits, web_results: webResults, note: notes.join('；') }
    },
  })

  // ── search_related_literature ───────────────────────────────────────────
  register({
    name: 'search_related_literature',
    description:
      '从一篇 Semantic Scholar 论文出发查找关联文献：forward=被引文献，' +
      'backward=该论文引用的参考文献，co-citation=与该论文共同被引用的文献。' +
      '优先返回有影响力、引用上下文更丰富的候选；paper_id 必须是 Semantic Scholar paperId 或可识别的外部论文 ID。',
    parameters: paramsSchema(
      {
        paper_id: { type: 'string', description: 'Semantic Scholar paperId（也可使用 DOI:...、ARXIV:... 等 S2 支持的 ID）' },
        direction: { type: 'string', enum: ['forward', 'backward', 'co-citation'], description: '关联方向，默认 forward' },
        limit: { type: 'number', description: '返回条数上限，默认 15，最大 100' },
        smart: { type: 'boolean', description: '是否按影响力与引用上下文排序，而不是单纯按引用量排序' },
        min_citations: { type: 'number', description: '最低被引数过滤（可选）' },
      },
      ['paper_id'],
    ),
    output: {
      schema: { type: 'object', properties: { provider: { type: 'string' }, query: { type: 'string' }, search_type: { type: 'string' }, sources: { type: 'array', items: { type: 'object' } } } },
      render: textRender,
    },
    execute: async (args) => {
      if (deps.invokeAcademicRelated === undefined) return { error: '当前未启用 Paper Navigator 学术检索 Provider' }
      const input = args as { paper_id?: string; direction?: string; limit?: number; smart?: boolean; min_citations?: number }
      const paperId = String(input.paper_id ?? '').trim()
      if (paperId === '') return { error: 'paper_id 不能为空' }
      const direction = input.direction === 'backward' || input.direction === 'co-citation' ? input.direction : 'forward'
      try {
        return await deps.invokeAcademicRelated({
          paperId,
          direction,
          ...(input.limit !== undefined ? { limit: Math.min(Math.max(Math.floor(input.limit), 1), 100) } : {}),
          ...(input.smart !== undefined ? { smart: input.smart } : {}),
          ...(input.min_citations !== undefined ? { minCitations: Math.max(0, Math.floor(input.min_citations)) } : {}),
        })
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) }
      }
    },
  })

  // ── recommend_literature ────────────────────────────────────────────────
  register({
    name: 'recommend_literature',
    description: '根据一篇或多篇已选论文向量推荐语义相近的论文，可用 negative_ids 排除不相关方向。',
    parameters: paramsSchema(
      {
        positive_ids: { type: 'array', items: { type: 'string' }, description: '正向论文 ID 列表' },
        negative_ids: { type: 'array', items: { type: 'string' }, description: '负向论文 ID 列表（可选）' },
        limit: { type: 'number', description: '返回条数上限，默认 10，最大 100' },
        per_seed: { type: 'boolean', description: '多篇正向论文是否分别推荐后合并去重' },
      },
      ['positive_ids'],
    ),
    output: { schema: { type: 'object', properties: { provider: { type: 'string' }, query: { type: 'string' }, sources: { type: 'array', items: { type: 'object' } } } }, render: textRender },
    execute: async (args) => {
      if (deps.invokeAcademicRecommendations === undefined) return { error: '当前未启用 Paper Navigator 学术检索 Provider' }
      const input = args as { positive_ids?: unknown; negative_ids?: unknown; limit?: number; per_seed?: boolean }
      const positiveIds = (Array.isArray(input.positive_ids) ? input.positive_ids : []).map(String).map((id) => id.trim()).filter(Boolean).slice(0, 20)
      if (positiveIds.length === 0) return { error: 'positive_ids 至少需要一个论文 ID' }
      try {
        return await deps.invokeAcademicRecommendations({
          positiveIds,
          ...(Array.isArray(input.negative_ids) ? { negativeIds: input.negative_ids.map(String).map((id) => id.trim()).filter(Boolean).slice(0, 20) } : {}),
          ...(input.limit !== undefined ? { limit: Math.min(Math.max(Math.floor(input.limit), 1), 100) } : {}),
          ...(input.per_seed !== undefined ? { perSeed: input.per_seed } : {}),
        })
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) }
      }
    },
  })

  // ── search_paper_snippets ───────────────────────────────────────────────
  register({
    name: 'search_paper_snippets',
    description: '检索 Semantic Scholar 论文正文片段；可限定 paper_id，用于判断候选论文是否真正讨论了目标概念。',
    parameters: paramsSchema(
      {
        query: { type: 'string', description: '正文片段检索词' },
        paper_id: { type: 'string', description: '可选，限定在一篇论文内检索' },
        limit: { type: 'number', description: '片段数上限，默认 10，最大 100' },
      },
      ['query'],
    ),
    output: { schema: { type: 'array', items: { type: 'object' } }, render: textRender },
    execute: async (args) => {
      if (deps.invokeAcademicSnippets === undefined) return { error: '当前未启用 Paper Navigator 学术检索 Provider' }
      const input = args as { query?: string; paper_id?: string; limit?: number }
      const query = String(input.query ?? '').trim()
      if (query === '') return { error: 'query 不能为空' }
      try {
        return await deps.invokeAcademicSnippets({
          query,
          ...(input.paper_id?.trim() ? { paperId: input.paper_id.trim() } : {}),
          ...(input.limit !== undefined ? { limit: Math.min(Math.max(Math.floor(input.limit), 1), 100) } : {}),
        })
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) }
      }
    },
  })

  // ── import_literature ────────────────────────────────────────────────────
  register({
    name: 'import_literature',
    description:
      '下载论文 PDF 并入库本地文献库（原文落盘、索引可重建）。付费墙/非 PDF 会明确失败，' +
      '不伪造导入；此时可请用户提供本地 PDF 路径走 library-add-paper。',
    parameters: paramsSchema(
      {
        url: { type: 'string', description: '论文 PDF 直链（http/https）' },
        title: { type: 'string', description: '论文标题（可选；用于命名落盘文件）' },
      },
      ['url'],
    ),
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          paper_id: { type: 'string' },
          file_path: { type: 'string' },
          extraction_status: { type: 'string' },
          title: { type: 'string' },
          error: { type: 'string' },
        },
      },
      render: textRender,
    },
    execute: async (args, exec) => {
      const input = args as { url?: string; title?: string }
      try {
        // 1) URL 校验（http/https）
        const rawUrl = String(input.url ?? '').trim()
        let parsed: URL
        try {
          parsed = new URL(rawUrl)
        } catch {
          return { ok: false, error: `无法解析的 URL: ${rawUrl}` }
        }
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
          return { ok: false, error: `仅支持 http(s) 链接: ${rawUrl}` }
        }

        // 2) 请求（跟随重定向）
        const doFetch = deps.fetchImpl ?? ((url: string, init?: RequestInit) => fetch(url, init))
        const res = await doFetch(parsed.toString(), { redirect: 'follow' })
        if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }

        // 3) PDF 判定：content-type 或 URL 路径后缀先做粗筛，再校验魔数
        const contentType = (res.headers.get?.('content-type') ?? '').toLowerCase()
        const urlLooksPdf = parsed.pathname.toLowerCase().endsWith('.pdf')
        if (!contentType.includes('pdf') && !urlLooksPdf) {
          return {
            ok: false,
            error: `响应不是 PDF 文件（content-type: ${contentType || '未知'}），可能是付费墙或 HTML 页面`,
          }
        }
        const buffer = Buffer.from(await res.arrayBuffer())
        if (buffer.byteLength > MAX_PDF_BYTES) return { ok: false, error: '文件过大（>50MB）' }
        if (buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
          return { ok: false, error: '响应不是有效 PDF（可能是付费墙/HTML 页面）' }
        }

        // 4) 项目定位与落盘（library-papers/，文件名 slug 化 + 冲突后缀）
        const workspace = workspaceOf(exec)
        const project = projectNameFromWorkspace(deps.dataRoot, workspace)
        if (!project) return { ok: false, error: '当前会话不在科研项目内，无法定位文献库' }
        const dir = path.join(projectDir(deps.dataRoot, project), 'library-papers')
        fs.mkdirSync(dir, { recursive: true })
        const urlBase = parsed.pathname.split('/').filter(Boolean).pop() ?? ''
        let nameSource = input.title?.trim() || ''
        if (nameSource === '') {
          try {
            nameSource = decodeURIComponent(urlBase)
          } catch {
            nameSource = urlBase
          }
        }
        const savedPath = uniquePdfPath(dir, slugifyFileName(nameSource || 'paper'))
        fs.writeFileSync(savedPath, buffer)

        // 5) 入库（原文件原地保留，镜像索引可重建）
        const added = await deps.libraryIndexer.addPaper(project, savedPath)
        return {
          ok: true,
          paper_id: added.paperId,
          file_path: added.filePath,
          extraction_status: added.extractionStatus,
          title: added.title,
        }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
  })

  return () => {
    for (const dispose of disposers) dispose()
  }
}
