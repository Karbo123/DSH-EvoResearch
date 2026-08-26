/**
 * AutoRelatedWork 原 Flask app.py 的 TypeScript 兼容门面。
 *
 * 这个文件只做 API 编排和 snake_case wire schema 转换；实际 Scholar 传输、
 * 解析、缓存、递归和多源补全统一复用 autorelatedwork-search.ts，避免出现
 * 两套“看起来相同但细节不同”的搜索实现。
 */
import { searchCrossref, searchOpenAlex } from './academic-search.js'
import {
  autoRelatedWorkPaperFromRecord,
  autoRelatedWorkCompleteness,
  autoRelatedWorkMissingFields,
  cleanAutoRelatedWorkPaper,
  createAutoRelatedWorkFetch,
  enrichAutoRelatedWorkArxiv,
  enrichAutoRelatedWorkBibtex,
  enrichAutoRelatedWorkAuthors,
  enrichAutoRelatedWorkReferences,
  enrichAutoRelatedWorkPapers,
  enrichAutoRelatedWorkWave1,
  enrichAutoRelatedWorkWave2,
  recursiveCollectAutoRelatedWork,
  scoreAutoRelatedWorkRelevance,
  scrapeAutoRelatedWorkAuthorProfile,
  searchAutoRelatedWork,
  searchAutoRelatedWorkScholar,
  AutoRelatedWorkCacheStore,
  type AutoRelatedWorkConfig,
  type AutoRelatedWorkCredentials,
  type AutoRelatedWorkPaper,
} from './autorelatedwork-search.js'
import type { AcademicAuthorProfile } from './academic-search.js'

export type { AutoRelatedWorkConfig, AutoRelatedWorkCredentials } from './autorelatedwork-search.js'

interface JsonObject { [key: string]: unknown }

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function bounded(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback
  return Math.min(max, Math.max(min, n))
}

function sourceCount(papers: AutoRelatedWorkPaper[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const paper of papers) {
    const source = paper.source ?? 'unknown'
    counts[source] = (counts[source] ?? 0) + 1
  }
  return counts
}

function paperKey(paper: AutoRelatedWorkPaper): string {
  // 原 app.py 的 _merge_papers 只按完整归一化标题去重；DOI 不能改变
  // Google Scholar 优先顺序，也不能让两个不同标题因错误 DOI 合并。
  return paper.title.toLocaleLowerCase().replace(/[^a-z0-9]/g, '')
}

function mergePapers(groups: AutoRelatedWorkPaper[][], limit: number): AutoRelatedWorkPaper[] {
  const seen = new Set<string>()
  const result: AutoRelatedWorkPaper[] = []
  for (const group of groups) for (const paper of group) {
    const key = paperKey(paper)
    if (key === '' || seen.has(key)) continue
    seen.add(key)
    result.push(paper)
    if (result.length >= limit) return result
  }
  return result
}

function sourceToPaper(source: JsonObject, provider: string): AutoRelatedWorkPaper | undefined {
  const title = stringValue(source.title)
  if (title === undefined) return undefined
  const authorsDetailed = Array.isArray(source.authorsDetailed) ? source.authorsDetailed.filter(isObject) : []
  const authors = Array.isArray(source.authors)
    ? source.authors.filter((item): item is string => typeof item === 'string')
    : authorsDetailed.map((item) => stringValue(item.name)).filter((item): item is string => item !== undefined)
  const url = stringValue(source.url) ?? (Array.isArray(source.externalUrls) ? stringValue(source.externalUrls[0]) : undefined)
  return autoRelatedWorkPaperFromRecord({
    ...source,
    title,
    authors,
    ...(authorsDetailed.length > 0 ? { authorsDetailed } : {}),
    ...(url !== undefined ? { url, externalUrls: Array.isArray(source.externalUrls) ? source.externalUrls : [url] } : {}),
    ...(typeof source.publishedAt === 'string' && source.year === undefined ? { year: Number(source.publishedAt.slice(0, 4)) } : {}),
    _source: provider,
    source: provider,
  })
}

function timestamp(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19)
}

function cleanWithReport(paper: AutoRelatedWorkPaper, includeInternal = true, stage?: AutoRelatedWorkEnrichStage): Record<string, unknown> {
  const clean = cleanAutoRelatedWorkPaper(paper)
  const score = Math.round(autoRelatedWorkCompleteness(clean) * 100) / 100
  clean._completeness = score
  clean._missing_fields = autoRelatedWorkMissingFields(clean)
  if (stage !== undefined) {
    clean._enrich_stage = stage
    clean._cache_complete = stage === 'done'
  }
  if (!includeInternal) {
    delete clean._completeness
    delete clean._missing_fields
  }
  return clean
}

function sourceCounts(groups: AutoRelatedWorkPaper[][]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const group of groups) for (const paper of group) {
    const source = paper.source ?? 'unknown'
    counts[source] = (counts[source] ?? 0) + 1
  }
  return counts
}

function paperCitedCount(paper: AutoRelatedWorkPaper): number {
  return paper.citedBy?.count ?? paper.citedByCount ?? 0
}

function paperYear(paper: AutoRelatedWorkPaper): number {
  return paper.year ?? 0
}

function paperTitleSimilarity(query: string, title: string): number {
  const tokens = (value: string): Set<string> => new Set(value.toLocaleLowerCase().match(/[a-z0-9]+/g) ?? [])
  const left = tokens(query); const right = tokens(title)
  if (left.size === 0 || right.size === 0) return 0
  let shared = 0
  for (const token of left) if (right.has(token)) shared += 1
  let score = shared / new Set([...left, ...right]).size
  if (query.toLocaleLowerCase() !== '' && title.toLocaleLowerCase().includes(query.toLocaleLowerCase())) score = Math.max(score, 0.5)
  return score
}

/** app.py `_sort_by_gs_then_relevance` with stable group semantics. */
function sortByScholarThenRelevance(query: string, papers: AutoRelatedWorkPaper[]): AutoRelatedWorkPaper[] {
  const scholar = papers.filter((paper) => paper.source === 'GoogleScholar')
  const others = papers.filter((paper) => paper.source !== 'GoogleScholar').map((paper, index) => ({ paper, index }))
  others.sort((left, right) => {
    const a = [paperTitleSimilarity(query, left.paper.title), paperCitedCount(left.paper), left.paper.authors.length, paperYear(left.paper)]
    const b = [paperTitleSimilarity(query, right.paper.title), paperCitedCount(right.paper), right.paper.authors.length, paperYear(right.paper)]
    for (let i = 0; i < a.length; i += 1) if (a[i]! !== b[i]!) return b[i]! - a[i]!
    return left.index - right.index
  })
  return [...scholar, ...others.map((item) => item.paper)]
}

function sortByAIRelevance(papers: AutoRelatedWorkPaper[]): AutoRelatedWorkPaper[] {
  return papers.map((paper, index) => ({ paper, index })).sort((left, right) => {
    const a = [left.paper.aiRelevance ?? -1, paperCitedCount(left.paper), left.paper.authors.length, paperYear(left.paper)]
    const b = [right.paper.aiRelevance ?? -1, paperCitedCount(right.paper), right.paper.authors.length, paperYear(right.paper)]
    for (let i = 0; i < a.length; i += 1) if (a[i]! !== b[i]!) return b[i]! - a[i]!
    return left.index - right.index
  }).map((item) => item.paper)
}

/** 对齐 app.py `_apply_paper_cache`：搜索结果优先，缓存只填空字段。 */
function applyAutoRelatedWorkPaperCache(papers: AutoRelatedWorkPaper[], dataRoot: string | undefined, enabled: boolean): void {
  if (!enabled || dataRoot === undefined) return
  const cache = new AutoRelatedWorkCacheStore(`${dataRoot.replace(/[\\/]$/, '')}/plugins/cache/scholar_cache.db`)
  try {
    for (const paper of papers) {
      const raw = cache.getPaper(paper.title)
      if (raw === undefined) continue
      const cached = autoRelatedWorkPaperFromRecord(raw)
      const isEmpty = (value: unknown): boolean => value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0) || (isObject(value) && Object.keys(value).length === 0)
      const fill = <K extends keyof AutoRelatedWorkPaper>(key: K): void => {
        if (isEmpty(paper[key]) && !isEmpty(cached[key])) paper[key] = cached[key] as AutoRelatedWorkPaper[K]
      }
      // app.py copies every non-empty non-internal cached field, not merely the
      // handful needed for completeness. This matters for URLs, BibTeX, author
      // Scholar IDs, versions and field-source provenance on a resumed run.
      for (const key of ['authorsStr', 'externalUrls', 'snippet', 'year', 'url', 'additionalUrls', 'domain', 'doi', 'venue', 'abstract', 'citedByCount', 'citedBy', 'citedByURL', 'allVersionsCount', 'allVersionsURL', 'allVersions', 'relatedArticlesURL', 'viewHTMLURLs', 'clusterId', 'dataCid', 'scholarCid', 'authorsTruncated', 'bibtex', 'institutions', 'authorScholarIds', 'authorsDetailed', 'authorProfiles', 'emails', 'references', 'rawReferences', 'depth', 'aiRelevance', 'aiRelevanceReason'] as Array<keyof AutoRelatedWorkPaper>) fill(key)
      for (const [key, value] of Object.entries(cached.fieldSources)) paper.fieldSources[key] ??= value
      if (cached.cacheComplete === true || cached.enrichStage === 'done') { paper.cacheComplete = true; paper.enrichStage = 'done'; paper.resumeDone = true }
      else if (paper.enrichStage === undefined) paper.enrichStage = cached.enrichStage ?? 'search'
    }
  } finally { cache.close() }
}

const AUTO_RELATED_WORK_ENRICH_STAGES = ['search', 'wave1', 'wave2', 'refs', 'done'] as const
type AutoRelatedWorkEnrichStage = typeof AUTO_RELATED_WORK_ENRICH_STAGES[number]

function persistAutoRelatedWorkStage(papers: AutoRelatedWorkPaper[], dataRoot: string | undefined, stage: AutoRelatedWorkEnrichStage, enabled = true): void {
  if (dataRoot === undefined || !enabled) return
  const cache = new AutoRelatedWorkCacheStore(`${dataRoot.replace(/[\\/]$/, '')}/plugins/cache/scholar_cache.db`)
  try {
    const stageIndex = AUTO_RELATED_WORK_ENRICH_STAGES.indexOf(stage)
    for (const paper of papers) {
      if (paper.resumeDone === true) continue
      const currentIndex = typeof paper.enrichStage === 'string' ? AUTO_RELATED_WORK_ENRICH_STAGES.indexOf(paper.enrichStage as AutoRelatedWorkEnrichStage) : -1
      if (currentIndex > stageIndex) continue
      const clean = cleanWithReport(paper)
      paper.enrichStage = stage
      paper.cacheComplete = stage === 'done'
      cache.putPaper({ ...clean, title: paper.title, _cache_complete: stage === 'done', _enrich_stage: stage })
    }
  } finally { cache.close() }
}

function persistAutoRelatedWorkPapers(papers: AutoRelatedWorkPaper[], dataRoot: string | undefined, complete: boolean, enabled = true): void {
  persistAutoRelatedWorkStage(papers, dataRoot, complete ? 'done' : 'wave1', enabled)
}

export interface AutoRelatedWorkCompatSearchOptions {
  query: string
  maxResults?: number
  searchType?: 'general' | 'cites' | 'related'
  citesId?: string
  config?: AutoRelatedWorkConfig
  credentials?: AutoRelatedWorkCredentials
  dataRoot?: string
  fetchImpl?: typeof fetch
  signal?: AbortSignal
  /** 原版 /api/search 的“快速”参数：只返回已获得的元数据，不跑深补全。 */
  fast?: boolean
}

export interface AutoRelatedWorkCompatSearchResult {
  papers: Array<Record<string, unknown>>
  search_info: Record<string, unknown>
  warnings: string[]
}

/**
 * 复刻 app.py `/api/search`：Google Scholar 优先，Crossref/OpenAlex 并行补足，
 * 再按标题/DOI 去重。与原版一样，Scholar 失败不会阻塞公开学术 API 结果。
 */
export async function searchAutoRelatedWorkCompat(options: AutoRelatedWorkCompatSearchOptions): Promise<AutoRelatedWorkCompatSearchResult> {
  const query = options.query.trim()
  if (query === '') throw new Error('查询词不能为空')
  const maxResults = bounded(options.maxResults, 10, 1, 50)
  const startedAt = Date.now()
  const warnings: string[] = []
  const searchType = options.searchType ?? options.config?.searchType ?? 'general'
  const config = { ...(options.config ?? {}), searchType, ...(options.citesId !== undefined ? { citesId: options.citesId } : {}), ...(options.fast === true ? { fast: true, enrich: false } : {}) }
  const fetchImpl = createAutoRelatedWorkFetch(options.fetchImpl ?? fetch, { query, config, credentials: options.credentials, dataRoot: options.dataRoot, signal: options.signal })
  const [scholarResult, crossrefResult, openAlexResult] = await Promise.allSettled([
    searchAutoRelatedWorkScholar({ query, limit: Math.min(maxResults, 20), maxResults: Math.min(maxResults, 20), searchType, citesId: options.citesId, config: { ...config, fast: true, enrich: false }, credentials: options.credentials, dataRoot: options.dataRoot, fetchImpl, signal: options.signal }),
    searchCrossref({ query, limit: Math.min(maxResults, 25), fetchImpl, signal: options.signal, baseURL: config.crossrefURL }),
    searchOpenAlex({ query, limit: Math.min(maxResults, 25), fetchImpl, signal: options.signal, baseURL: config.openAlexURL }),
  ])
  const gs: AutoRelatedWorkPaper[] = scholarResult.status === 'fulfilled'
    ? scholarResult.value.papers.map((paper) => autoRelatedWorkPaperFromRecord({ ...(paper as unknown as Record<string, unknown>), source: 'GoogleScholar', _source: 'GoogleScholar' }))
    : []
  if (scholarResult.status === 'rejected') warnings.push(`Google Scholar 搜索异常: ${scholarResult.reason instanceof Error ? scholarResult.reason.message.slice(0, 100) : String(scholarResult.reason).slice(0, 100)}`)
  const crossref = crossrefResult.status === 'fulfilled'
    ? crossrefResult.value.sources.map((source) => sourceToPaper(source as unknown as JsonObject, 'Crossref')).filter((item): item is AutoRelatedWorkPaper => item !== undefined)
    : []
  if (crossrefResult.status === 'rejected') warnings.push(`Crossref 搜索异常: ${crossrefResult.reason instanceof Error ? crossrefResult.reason.message.slice(0, 100) : String(crossrefResult.reason).slice(0, 100)}`)
  const openAlex = openAlexResult.status === 'fulfilled'
    ? openAlexResult.value.sources.map((source) => sourceToPaper(source as unknown as JsonObject, 'OpenAlex')).filter((item): item is AutoRelatedWorkPaper => item !== undefined)
    : []
  if (openAlexResult.status === 'rejected') warnings.push(`OpenAlex 搜索异常: ${openAlexResult.reason instanceof Error ? openAlexResult.reason.message.slice(0, 100) : String(openAlexResult.reason).slice(0, 100)}`)
  let papers = mergePapers([gs, crossref, openAlex], maxResults)
  applyAutoRelatedWorkPaperCache(papers, options.dataRoot, config.cacheEnabled !== false)
  const cacheEnabled = config.cacheEnabled !== false
  persistAutoRelatedWorkStage(papers, options.dataRoot, 'search', cacheEnabled)
  if (papers.length > 0 && options.fast !== true) {
    const pending = papers.filter((paper) => paper.cacheComplete !== true)
    const enrichOptions = { query, config: { ...config, fetchArxiv: true, fetchArxivHTML: false, recursiveDepth: 0, includeAuthorProfiles: false, deepseekAuthorFallback: true }, credentials: options.credentials, dataRoot: options.dataRoot, fetchImpl, signal: options.signal }
    await enrichAutoRelatedWorkWave1(pending, enrichOptions, { bibtex: true, unpaywall: false })
    persistAutoRelatedWorkStage(papers, options.dataRoot, 'wave1', cacheEnabled)
    // BibTeX is authoritative in the Python app and is applied only after all
    // independent Wave 1 requests have completed.
    await enrichAutoRelatedWorkWave2(pending, { ...enrichOptions, config: { ...enrichOptions.config, fetchArxivHTML: true } }, true)
    persistAutoRelatedWorkStage(papers, options.dataRoot, 'wave2', cacheEnabled)
  }
  const searchInfo: Record<string, unknown> = {
    query,
    type: searchType,
    timestamp: timestamp(),
    fetched: papers.length,
    elapsed_s: Math.round((Date.now() - startedAt) / 100) / 10,
    sources: sourceCounts([gs, crossref, openAlex]),
  }
  papers = sortByScholarThenRelevance(query, papers)
  return { papers: papers.map((paper) => cleanWithReport(paper)), search_info: searchInfo, warnings }
}

export interface AutoRelatedWorkCompatEnrichResult {
  papers: Array<Record<string, unknown>>
  report: Record<string, unknown>
  elapsed_s: number
  warnings: string[]
}

/** 复刻 app.py `/api/enrich` 的 JSON 形态。 */
export async function enrichAutoRelatedWorkCompat(input: {
  papers: Array<Record<string, unknown>>
  rounds?: number
  query?: string
  config?: AutoRelatedWorkConfig
  credentials?: AutoRelatedWorkCredentials
  dataRoot?: string
  fetchImpl?: typeof fetch
  signal?: AbortSignal
}): Promise<AutoRelatedWorkCompatEnrichResult> {
  if (!Array.isArray(input.papers) || input.papers.length === 0) throw new Error('论文列表为空')
  const startedAt = Date.now()
  const papers = input.papers.map((paper) => autoRelatedWorkPaperFromRecord(paper))
  const rounds = bounded(input.rounds, 3, 1, 10)
  const result = await enrichAutoRelatedWorkPapers(papers, {
    query: input.query ?? '',
    // 原 /api/enrich 由 enrich_fields.py 负责：Crossref → OpenAlex → DBLP
    // → DeepSeek，arXiv/Scholar 只属于搜索阶段；显式关闭它们避免 TS
    // 兼容层偷偷改变请求数量与字段来源。
    config: { ...(input.config ?? {}), maxEnrichmentRounds: rounds, fetchArxiv: false, fetchArxivHTML: false, fetchSemanticScholar: false, fetchUnpaywall: false, deepseekAuthorFallback: false, recursiveDepth: 0, includeAuthorProfiles: false, webFallback: true },
    credentials: input.credentials,
    dataRoot: input.dataRoot,
    fetchImpl: input.fetchImpl,
    signal: input.signal,
  })
  const report = {
    initial_scores: result.report.initialScores,
    final_scores: result.report.finalScores,
    rounds: result.report.rounds.map((item) => ({ round: item.round, fixes: item.fixes, avg_score: item.averageScore })),
    avg_score: result.report.averageScore,
  }
  return { papers: result.papers.map((paper) => cleanWithReport(paper)), report, elapsed_s: Math.round((Date.now() - startedAt) / 100) / 10, warnings: [] }
}

export interface AutoRelatedWorkAuthorCandidate {
  candidate_id: string
  name: string
  affiliation: string | null
  h_index: number | null
  citation_count: number | null
  paper_count: number | null
  interests: string[] | null
  scholar_id: string | null
  ss_author_id: string | null
  openalex_author_id: string | null
  homepage: string | null
  orcid: string | null
  email: string | null
  aliases: string[] | null
  sources: string[]
}

function candidateId(source: string, id: string | undefined, name: string): string {
  return id === undefined || id === '' ? `name:${name || '?'}` : `${source}:${id}`
}

function candidateSource(value: JsonObject, provider: 'SemanticScholar' | 'OpenAlex' | 'GoogleScholar'): AutoRelatedWorkAuthorCandidate | undefined {
  const name = stringValue(value.name)
  if (name === undefined) return undefined
  const firstInstitution = Array.isArray(value.last_known_institutions) ? value.last_known_institutions[0] : undefined
  const affiliation = provider === 'OpenAlex'
    ? isObject(firstInstitution) ? stringValue(firstInstitution.display_name) : undefined
    : Array.isArray(value.affiliations) ? stringValue(value.affiliations[0]) : stringValue(value.affiliation)
  const id = provider === 'SemanticScholar' ? stringValue(value.authorId) : provider === 'OpenAlex' ? stringValue(value.id)?.split('/').pop() : stringValue(value.scholar_id)
  const concepts = Array.isArray(value.x_concepts) ? value.x_concepts.filter(isObject).sort((a, b) => (numberValue(b.score) ?? 0) - (numberValue(a.score) ?? 0)).slice(0, 5).map((item) => stringValue(item.display_name)).filter((item): item is string => item !== undefined) : []
  const aliases = Array.isArray(value.aliases) ? value.aliases.filter((item): item is string => typeof item === 'string') : Array.isArray(value.display_name_alternatives) ? value.display_name_alternatives.filter((item): item is string => typeof item === 'string') : []
  const ext = isObject(value.externalIds) ? value.externalIds : isObject(value.ids) ? value.ids : {}
  const orcid = stringValue(ext.ORCID) ?? stringValue(ext.orcid)
  const h = provider === 'OpenAlex' ? numberValue(isObject(value.summary_stats) ? value.summary_stats.h_index : undefined) : numberValue(value.hIndex)
  const citation = provider === 'OpenAlex' ? numberValue(value.cited_by_count) : numberValue(value.citationCount) ?? numberValue(value.cited_by)
  const count = provider === 'OpenAlex' ? numberValue(value.works_count) : numberValue(value.paperCount)
  return {
    candidate_id: candidateId(provider === 'SemanticScholar' ? 'ss' : provider === 'OpenAlex' ? 'oa' : 'gs', id, name),
    name, affiliation: affiliation ?? null, h_index: h ?? null, citation_count: citation ?? null, paper_count: count ?? null,
    interests: concepts.length > 0 ? concepts : typeof value.interests === 'string' ? [value.interests] : null,
    scholar_id: provider === 'GoogleScholar' ? id ?? null : null,
    ss_author_id: provider === 'SemanticScholar' ? id ?? null : null,
    openalex_author_id: provider === 'OpenAlex' ? id ?? null : null,
    homepage: stringValue(value.homepage) ?? null, orcid: orcid ?? null, email: stringValue(value.email) ?? null,
    aliases: aliases.length > 0 ? aliases : null,
    sources: [provider],
  }
}

function sameCandidate(left: AutoRelatedWorkAuthorCandidate, right: AutoRelatedWorkAuthorCandidate): boolean {
  const tokens = (name: string) => new Set(name.toLocaleLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').split(/\s+/).filter(Boolean))
  const a = tokens(left.name); const b = tokens(right.name)
  if (a.size === 0 || b.size === 0 || !([...a].every((item) => b.has(item)) || [...b].every((item) => a.has(item)))) return false
  if (!left.affiliation || !right.affiliation) return true
  const stop = new Set(['of', 'the', 'and', 'at', 'for', 'university', 'institute'])
  const aa = new Set(left.affiliation.toLocaleLowerCase().match(/[a-z0-9]+/g)?.filter((item) => !stop.has(item)) ?? [])
  const bb = new Set(right.affiliation.toLocaleLowerCase().match(/[a-z0-9]+/g)?.filter((item) => !stop.has(item)) ?? [])
  return [...aa].some((item) => bb.has(item))
}

function mergeAuthorCandidates(groups: AutoRelatedWorkAuthorCandidate[][]): AutoRelatedWorkAuthorCandidate[] {
  const result: AutoRelatedWorkAuthorCandidate[] = []
  for (const group of groups) for (const item of group) {
    const current = result.find((candidate) => sameCandidate(candidate, item))
    if (current === undefined) { result.push(item); continue }
    current.sources = [...new Set([...current.sources, ...item.sources])]
    if (current.ss_author_id === null) current.ss_author_id = item.ss_author_id
    if (current.openalex_author_id === null) current.openalex_author_id = item.openalex_author_id
    if (current.scholar_id === null) current.scholar_id = item.scholar_id
    for (const key of ['h_index', 'citation_count', 'paper_count'] as const) if ((item[key] ?? -1) > (current[key] ?? -1)) current[key] = item[key]
    if (current.affiliation === null) current.affiliation = item.affiliation
    if (current.homepage === null) current.homepage = item.homepage
    if (current.orcid === null) current.orcid = item.orcid
    if (current.email === null) current.email = item.email
    if (current.interests === null) current.interests = item.interests
    if (current.aliases === null) current.aliases = item.aliases
  }
  return result.sort((a, b) => (b.citation_count ?? -1) - (a.citation_count ?? -1))
}

async function requestJSON(fetchImpl: typeof fetch, url: string, init: RequestInit = {}, signal?: AbortSignal): Promise<JsonObject> {
  const response = await fetchImpl(url, { ...init, signal })
  const body = await response.text()
  if (!response.ok) throw new Error(`${response.status} ${body.slice(0, 120)}`)
  const value = JSON.parse(body) as unknown
  if (!isObject(value)) throw new Error('作者 API 返回的不是 JSON 对象')
  return value
}

/** 复刻 `/api/author-candidates`：SS + OpenAlex + Scholar 三源合并。 */
export async function searchAutoRelatedWorkAuthorCandidates(input: { query: string; config?: AutoRelatedWorkConfig; credentials?: AutoRelatedWorkCredentials; fetchImpl?: typeof fetch; signal?: AbortSignal }): Promise<{ candidates: AutoRelatedWorkAuthorCandidate[]; search_info: Record<string, unknown>; warnings: string[] }> {
  const query = input.query.trim()
  if (query === '') throw new Error('查询词不能为空')
  const fetchImpl = createAutoRelatedWorkFetch(input.fetchImpl ?? fetch, { query, config: input.config ?? {}, credentials: input.credentials, signal: input.signal })
  const startedAt = Date.now(); const warnings: string[] = []
  const ssBase = 'https://api.semanticscholar.org/graph/v1'
  const oaBase = input.config?.openAlexURL?.replace(/\/+$/, '') || 'https://api.openalex.org'
  const [ss, oa, gs] = await Promise.allSettled([
    requestJSON(fetchImpl, `${ssBase}/author/search?query=${encodeURIComponent(query)}&limit=5&fields=name,affiliations,homepage,externalIds,hIndex,citationCount,paperCount,aliases`, input.credentials?.semanticScholarApiKey === undefined ? {} : { headers: { 'x-api-key': input.credentials.semanticScholarApiKey } }, input.signal),
    requestJSON(fetchImpl, `${oaBase}/authors?search=${encodeURIComponent(query)}&per-page=5&select=id,display_name,display_name_alternatives,orcid,works_count,cited_by_count,summary_stats,last_known_institutions,x_concepts,ids`, {}, input.signal),
    searchAutoRelatedWorkScholar({ query, searchType: 'author', maxResults: 2, config: input.config ?? {}, credentials: input.credentials, fetchImpl, signal: input.signal }),
  ])
  const ssRows = ss.status === 'fulfilled' && Array.isArray(ss.value.data) ? ss.value.data.filter(isObject).map((item) => candidateSource(item, 'SemanticScholar')).filter((item): item is AutoRelatedWorkAuthorCandidate => item !== undefined) : []
  const oaRows = oa.status === 'fulfilled' && Array.isArray(oa.value.results) ? oa.value.results.filter(isObject).map((item) => candidateSource(item, 'OpenAlex')).filter((item): item is AutoRelatedWorkAuthorCandidate => item !== undefined) : []
  const gsRows = gs.status === 'fulfilled' ? gs.value.authors.map((item) => candidateSource({ name: item.name, scholar_id: item.scholarId, affiliation: item.affiliation, interests: item.interests, cited_by: item.citedBy }, 'GoogleScholar')).filter((item): item is AutoRelatedWorkAuthorCandidate => item !== undefined) : []
  for (const [label, result] of [['Semantic Scholar', ss], ['OpenAlex', oa], ['Google Scholar', gs] ] as const) if (result.status === 'rejected') warnings.push(`${label} 作者搜索失败`)
  const candidates = mergeAuthorCandidates([gsRows, ssRows, oaRows])
  // 原 author_candidates() 会对前三个带 Scholar ID 的卡片再次抓完整档案，
  // 用档案补齐 h-index/引用/论文数/机构/兴趣/主页/邮箱。
  const scholarCandidates = candidates.filter((candidate) => candidate.scholar_id !== null).slice(0, 3)
  await Promise.all(scholarCandidates.map(async (candidate) => {
    try {
      const profile = await scrapeAutoRelatedWorkAuthorProfile(candidate.scholar_id!, { query, config: input.config, credentials: input.credentials, fetchImpl, signal: input.signal })
      if (profile === undefined) return
      const stats = profile.citationStats ?? {}
      if (candidate.h_index === null && typeof stats.hIndexAll === 'number') candidate.h_index = stats.hIndexAll
      if (typeof stats.citationsAll === 'number') candidate.citation_count = Math.max(candidate.citation_count ?? 0, stats.citationsAll)
      if (candidate.paper_count === null && typeof profile.totalPapers === 'number') candidate.paper_count = profile.totalPapers
      candidate.affiliation ??= profile.affiliation ?? null
      candidate.homepage ??= profile.homepage ?? null
      candidate.email ??= profile.email ?? null
      candidate.interests ??= profile.interests ?? null
    } catch { warnings.push(`Google Scholar 作者档案补全失败: ${candidate.name}`) }
  }))
  candidates.sort((a, b) => (b.citation_count ?? -1) - (a.citation_count ?? -1))
  return { candidates, search_info: { query, timestamp: timestamp(), count: candidates.length, elapsed_s: Math.round((Date.now() - startedAt) / 100) / 10 }, warnings }
}

interface AuthorPapersInput {
  name?: string
  scholarId?: string
  ssAuthorId?: string
  openAlexAuthorId?: string
  candidateInfo?: JsonObject
  maxResults?: number
  deepseekEnrich?: boolean
  config?: AutoRelatedWorkConfig
  credentials?: AutoRelatedWorkCredentials
  dataRoot?: string
  fetchImpl?: typeof fetch
  signal?: AbortSignal
}

interface AuthorPapersLoaded {
  name: string
  scholarId: string
  ssId: string
  oaId: string
  profile: AcademicAuthorProfile | undefined
  profileWire: JsonObject
  groups: AutoRelatedWorkPaper[][]
  papers: AutoRelatedWorkPaper[]
  limit: number
  warnings: string[]
}

function profilePaperToWire(value: unknown): Record<string, unknown> | undefined {
  if (!isObject(value) || typeof value.title !== 'string' || value.title.trim() === '') return undefined
  return {
    title: value.title,
    ...(typeof value.paperId === 'string' ? { paper_id: value.paperId } : typeof value.paper_id === 'string' ? { paper_id: value.paper_id } : {}),
    ...(typeof value.year === 'number' ? { year: value.year } : {}),
    ...(typeof value.citedByCount === 'number' ? { cited_count: value.citedByCount } : typeof value.cited_count === 'number' ? { cited_count: value.cited_count } : {}),
    ...(typeof value.authorsStr === 'string' ? { authors_str: value.authorsStr } : typeof value.authors_str === 'string' ? { authors_str: value.authors_str } : {}),
    ...(typeof value.authorsStr === 'string' ? { authors_str: value.authorsStr } : typeof value.authors_str === 'string' ? { authors_str: value.authors_str } : {}),
    ...(typeof value.venue === 'string' ? { venue: value.venue } : {}),
  }
}

/** 将内部 camelCase 作者档案转换为原 author.py 的 snake_case wire schema。 */
function authorProfileToWire(profile: AcademicAuthorProfile | undefined, input: AuthorPapersInput, name: string, scholarId: string, ssId: string, oaId: string): JsonObject {
  const candidate = input.candidateInfo ?? {}
  const stats = profile?.citationStats ?? (isObject(candidate.citation_stats) ? candidate.citation_stats : {})
  const toWireStats: JsonObject = {}
  for (const [key, value] of Object.entries(stats)) {
    const wireKey = key === 'hIndexAll' ? 'h_index_all' : key === 'hIndexRecent' ? 'h_index_recent' : key === 'i10IndexAll' ? 'i10_index_all' : key === 'i10IndexRecent' ? 'i10_index_recent' : key === 'citationsAll' ? 'citations_all' : key === 'citationsRecent' ? 'citations_recent' : key
    if (typeof value === 'number' && Number.isFinite(value)) toWireStats[wireKey] = value
  }
  if (toWireStats.citations_all === undefined && typeof candidate.citation_count === 'number') toWireStats.citations_all = candidate.citation_count
  if (toWireStats.h_index_all === undefined && typeof candidate.h_index === 'number') toWireStats.h_index_all = candidate.h_index
  const allPapers = (profile?.allPapers ?? []).map(profilePaperToWire).filter((item): item is Record<string, unknown> => item !== undefined)
  const topCited = (profile?.topCitedPapers ?? []).map(profilePaperToWire).filter((item): item is Record<string, unknown> => item !== undefined)
  const topRecent = (profile?.topRecentPapers ?? []).map(profilePaperToWire).filter((item): item is Record<string, unknown> => item !== undefined)
  return {
    name: profile?.name ?? name,
    scholar_id: scholarId || null,
    ss_author_id: ssId || null,
    openalex_author_id: oaId || null,
    url: profile?.url ?? (scholarId ? `https://scholar.google.com/citations?user=${encodeURIComponent(scholarId)}&hl=en` : null),
    affiliation: profile?.affiliation ?? (typeof candidate.affiliation === 'string' ? candidate.affiliation : null),
    email: profile?.email ?? (typeof candidate.email === 'string' ? candidate.email : null),
    homepage: profile?.homepage ?? (typeof candidate.homepage === 'string' ? candidate.homepage : null),
    interests: profile?.interests ?? (Array.isArray(candidate.interests) ? candidate.interests : null),
    citation_stats: Object.keys(toWireStats).length > 0 ? toWireStats : null,
    total_papers: profile?.totalPapers ?? (typeof candidate.paper_count === 'number' ? candidate.paper_count : allPapers.length),
    top_cited_papers: topCited.length > 0 ? topCited : null,
    top_recent_papers: topRecent.length > 0 ? topRecent : null,
    all_papers: allPapers.length > 0 ? allPapers : null,
    orcid: typeof candidate.orcid === 'string' ? candidate.orcid : null,
    aliases: Array.isArray(candidate.aliases) ? candidate.aliases : null,
  }
}

async function loadAuthorProfile(input: AuthorPapersInput): Promise<{ name: string; scholarId: string; ssId: string; oaId: string; profile: AcademicAuthorProfile | undefined; profileWire: JsonObject }> {
  const name = input.name?.trim() ?? ''
  const scholarId = input.scholarId?.trim() ?? ''
  const ssId = input.ssAuthorId?.trim() ?? ''
  const oaId = input.openAlexAuthorId?.trim() ?? ''
  if (scholarId === '' && ssId === '' && oaId === '') throw new Error('缺少作者 ID')
  const fetchImpl = createAutoRelatedWorkFetch(input.fetchImpl ?? fetch, { query: name, config: input.config ?? {}, credentials: input.credentials, signal: input.signal })
  let profile: AcademicAuthorProfile | undefined
  if (scholarId) {
    try {
      profile = await scrapeAutoRelatedWorkAuthorProfile(scholarId, { query: name, config: input.config, credentials: input.credentials, fetchImpl, signal: input.signal })
    } catch { /* 与 Flask 一样回退到候选卡信息 */ }
  }
  const profileWire = authorProfileToWire(profile, input, name, scholarId, ssId, oaId)
  return { name, scholarId, ssId, oaId, profile, profileWire }
}

async function loadAuthorPaperGroups(input: AuthorPapersInput, loaded: { name: string; profile: AcademicAuthorProfile | undefined }): Promise<{ groups: AutoRelatedWorkPaper[][]; warnings: string[] }> {
  const limit = bounded(input.maxResults, 50, 1, 100)
  const warnings: string[] = []
  const { name, profile } = loaded
  const fetchImpl = createAutoRelatedWorkFetch(input.fetchImpl ?? fetch, { query: name, config: input.config ?? {}, credentials: input.credentials, signal: input.signal })
  const ssId = input.ssAuthorId?.trim() ?? ''
  const oaId = input.openAlexAuthorId?.trim() ?? ''
  const groups: AutoRelatedWorkPaper[][] = []
  if (ssId) {
    try {
      const body = await requestJSON(fetchImpl, `https://api.semanticscholar.org/graph/v1/author/${encodeURIComponent(ssId)}/papers?fields=title,year,externalIds,venue,abstract,authors&limit=${Math.min(limit, 100)}`, input.credentials?.semanticScholarApiKey === undefined ? {} : { headers: { 'x-api-key': input.credentials.semanticScholarApiKey } }, input.signal)
      groups.push((Array.isArray(body.data) ? body.data : []).filter(isObject).map((item) => sourceToPaper({ ...item, doi: isObject(item.externalIds) ? item.externalIds.DOI : undefined, authors: Array.isArray(item.authors) ? item.authors.map((author) => isObject(author) ? author.name : undefined).filter((author): author is string => typeof author === 'string') : [] }, 'SemanticScholar')).filter((item): item is AutoRelatedWorkPaper => item !== undefined))
    } catch { warnings.push('Semantic Scholar 作者论文获取失败') }
  }
  if (oaId) {
    try {
      const base = input.config?.openAlexURL?.replace(/\/+$/, '') || 'https://api.openalex.org'
      const body = await requestJSON(fetchImpl, `${base}/works?filter=authorships.author.id:${encodeURIComponent(oaId)}&per-page=${Math.min(limit, 200)}&sort=cited_by_count:desc&select=id,doi,title,publication_year,cited_by_count,authorships,primary_location`, {}, input.signal)
      groups.push((Array.isArray(body.results) ? body.results : []).filter(isObject).map((item) => {
        const primary = isObject(item.primary_location) ? item.primary_location : {}
        const source = isObject(primary.source) ? primary.source : {}
        return sourceToPaper({ ...item, url: stringValue(item.doi) ?? stringValue(item.id), authors: Array.isArray(item.authorships) ? item.authorships.map((auth) => isObject(auth) && isObject(auth.author) ? auth.author.display_name : undefined).filter((author): author is string => typeof author === 'string') : [], venue: source.display_name, year: item.publication_year }, 'OpenAlex')
      }).filter((item): item is AutoRelatedWorkPaper => item !== undefined))
    } catch { warnings.push('OpenAlex 作者论文获取失败') }
  }
  const profilePapers = profile?.allPapers ?? []
  if (profilePapers.length > 0) groups.unshift(profilePapers.map((item) => sourceToPaper({ ...item, authors: name === '' ? [] : [name], year: item.year, citedByCount: item.citedByCount }, 'GoogleScholar')).filter((item): item is AutoRelatedWorkPaper => item !== undefined))
  return { groups, warnings }
}

async function loadAuthorPapers(input: AuthorPapersInput): Promise<AuthorPapersLoaded> {
  const loadedProfile = await loadAuthorProfile(input)
  const loadedGroups = await loadAuthorPaperGroups(input, loadedProfile)
  const limit = bounded(input.maxResults, 50, 1, 100)
  const papers = mergePapers(loadedGroups.groups, limit)
  return { ...loadedProfile, groups: loadedGroups.groups, papers, limit, warnings: loadedGroups.warnings }
}

/** 复刻 `/api/author-papers` 的非流式核心结果；SSE 包装由 Host/Client 层负责。 */
export async function searchAutoRelatedWorkAuthorPapers(input: AuthorPapersInput): Promise<{ author_profile: JsonObject; papers: Array<Record<string, unknown>>; search_info: Record<string, unknown>; warnings: string[] }> {
  const loaded = await loadAuthorPapers(input)
  if (loaded.papers.length > 0) {
    try {
      await enrichAutoRelatedWorkPapers(loaded.papers, { query: loaded.name, config: { ...(input.config ?? {}), deepseekEnrich: input.deepseekEnrich !== false && input.config?.deepseekEnrich !== false, includeAuthorProfiles: false }, credentials: input.credentials, dataRoot: input.dataRoot, fetchImpl: input.fetchImpl, signal: input.signal })
    } catch { loaded.warnings.push('作者论文字段补全失败') }
  }
  return { author_profile: loaded.profileWire, papers: loaded.papers.map((paper) => cleanWithReport(paper)), search_info: { query: loaded.name, type: 'author', timestamp: timestamp(), fetched: loaded.papers.length, sources: sourceCounts(loaded.groups) }, warnings: loaded.warnings }
}

/** 复刻 `/api/cache-refine`，按批处理 partial cache 并写回 done。 */
export async function refineAutoRelatedWorkCache(input: { dataRoot: string; batch?: number; deepseekEnrich?: boolean; config?: AutoRelatedWorkConfig; credentials?: AutoRelatedWorkCredentials; fetchImpl?: typeof fetch; signal?: AbortSignal }): Promise<{ refined: number; remaining_partial: number; elapsed_s: number }> {
  const startedAt = Date.now(); const cache = new AutoRelatedWorkCacheStore(`${input.dataRoot.replace(/[\\/]$/, '')}/plugins/cache/scholar_cache.db`)
  try {
    const partial = cache.getPartialPapers(bounded(input.batch, 30, 1, 100))
    if (partial.length === 0) return { refined: 0, remaining_partial: 0, elapsed_s: 0 }
    const papers = partial.map(autoRelatedWorkPaperFromRecord)
    await enrichAutoRelatedWorkPapers(papers, { query: '', config: { ...(input.config ?? {}), deepseekEnrich: input.deepseekEnrich === true }, credentials: input.credentials, fetchImpl: input.fetchImpl, signal: input.signal })
    let refined = 0
    for (const paper of papers) if (cache.putPaper({ ...cleanAutoRelatedWorkPaper(paper), title: paper.title, _cache_complete: true, _enrich_stage: 'done' })) refined += 1
    return { refined, remaining_partial: cache.countPartial(), elapsed_s: Math.round((Date.now() - startedAt) / 100) / 10 }
  } finally { cache.close() }
}

export interface AutoRelatedWorkCompatRuntimeInput {
  config?: AutoRelatedWorkConfig
  credentials?: AutoRelatedWorkCredentials
  dataRoot?: string
  fetchImpl?: typeof fetch
  signal?: AbortSignal
}

export interface AutoRelatedWorkSSEEvent {
  event: 'progress' | 'partial_result' | 'author_profile' | 'result' | 'error'
  data: Record<string, unknown>
}

function progress(phase: string, message: string, value: number): AutoRelatedWorkSSEEvent {
  return { event: 'progress', data: { phase, message, progress: value } }
}

async function runBounded<T>(values: T[], maxWorkers: number, task: (value: T) => Promise<void>): Promise<void> {
  let cursor = 0
  const workers = Math.min(Math.max(1, Math.floor(maxWorkers)), Math.max(1, values.length))
  await Promise.all(Array.from({ length: workers }, async () => {
    while (true) {
      const index = cursor++
      if (index >= values.length) return
      try { await task(values[index]!) } catch { /* one paper never aborts the batch */ }
    }
  }))
}

function pipelinePartial(papers: AutoRelatedWorkPaper[], query: string, sources: Record<string, number>, startedAt: number, status: string): AutoRelatedWorkSSEEvent {
  return {
    event: 'partial_result',
    data: {
      papers: papers.map((paper) => cleanWithReport(paper)),
      search_info: { query, timestamp: timestamp(), fetched: papers.length, elapsed_s: Math.round((Date.now() - startedAt) / 100) / 10, sources, status },
    },
  }
}

function resultData(papers: AutoRelatedWorkPaper[], query: string, sources: Record<string, number>, startedAt: number, extra: Record<string, unknown> = {}, warnings: string[] = []): Record<string, unknown> {
  return {
    papers: papers.map((paper) => cleanWithReport(paper, true, paper.enrichStage)),
    search_info: { query, timestamp: timestamp(), fetched: papers.length, elapsed_s: Math.round((Date.now() - startedAt) / 100) / 10, sources, ...((extra.type !== undefined) ? { type: extra.type } : {}) },
    warnings,
    ...extra,
  }
}

/** 为 /api/author-enrich 复刻原 author.py 的“标题反查作者 Scholar ID”兜底。 */
async function fillAuthorIdsFromTitles(papers: AutoRelatedWorkPaper[], input: AutoRelatedWorkCompatRuntimeInput): Promise<void> {
  const options = { query: '', config: input.config, credentials: input.credentials, dataRoot: input.dataRoot, fetchImpl: input.fetchImpl, signal: input.signal }
  await Promise.all(papers.map(async (paper) => {
    if (Object.keys(paper.authorScholarIds).length > 0 || paper.title === '') return
    try {
      const result = await searchAutoRelatedWorkScholar({ ...options, query: paper.title, searchType: 'general', maxResults: 1 })
      const found = result.papers[0]?.authorScholarIds
      if (found !== undefined) paper.authorScholarIds = { ...found }
    } catch { /* 原版按标题查找失败时保留空映射。 */ }
  }))
}

/** 完整 `/api/author-enrich` JSON 行为。 */
export async function enrichAutoRelatedWorkAuthorsCompat(input: { papers: Array<Record<string, unknown>> } & AutoRelatedWorkCompatRuntimeInput): Promise<{ papers: Array<Record<string, unknown>>; report: Record<string, unknown>; elapsed_s: number; warnings: string[] }> {
  if (!Array.isArray(input.papers) || input.papers.length === 0) throw new Error('论文列表为空')
  const startedAt = Date.now(); const warnings: string[] = []
  const papers = input.papers.map(autoRelatedWorkPaperFromRecord)
  await fillAuthorIdsFromTitles(papers, input)
  try {
    const report = await enrichAutoRelatedWorkAuthors(papers, { query: '', config: input.config, credentials: input.credentials, dataRoot: input.dataRoot, fetchImpl: input.fetchImpl, signal: input.signal })
    return { papers: papers.map((paper) => cleanWithReport(paper)), report, elapsed_s: Math.round((Date.now() - startedAt) / 100) / 10, warnings }
  } catch (error) {
    warnings.push(`作者补全失败: ${error instanceof Error ? error.message.slice(0, 100) : String(error).slice(0, 100)}`)
    return { papers: papers.map((paper) => cleanWithReport(paper)), report: { skipped: false }, elapsed_s: Math.round((Date.now() - startedAt) / 100) / 10, warnings }
  }
}

/** `/api/author-papers` 的真实事件流；不要先收集成数组，否则浏览器无法像原 Flask 一样逐阶段显示。 */
export async function* autoRelatedWorkAuthorPapersEvents(input: AuthorPapersInput): AsyncGenerator<AutoRelatedWorkSSEEvent> {
  const startedAt = Date.now()
  const name = input.name?.trim() ?? ''
  if ((input.scholarId?.trim() ?? '') === '' && (input.ssAuthorId?.trim() ?? '') === '' && (input.openAlexAuthorId?.trim() ?? '') === '') {
    yield { event: 'error', data: { message: '缺少作者 ID' } }
    return
  }
  try {
    yield progress('author', `获取 ${name} 的作者档案...`, 5)
    const author = await loadAuthorProfile(input)
    yield { event: 'author_profile', data: { profile: author.profileWire } }

    yield progress('search', '按作者 ID 拉取本人论文...', 20)
    const grouped = await loadAuthorPaperGroups(input, author)
    const limit = bounded(input.maxResults, 50, 1, 100)
    const papers = mergePapers(grouped.groups, limit)
    const sources = sourceCounts(grouped.groups)
    const warnings = grouped.warnings
    if (papers.length === 0) {
      yield { event: 'result', data: { type: 'author', author_profile: author.profileWire, papers: [], search_info: { query: name, type: 'author', timestamp: timestamp(), fetched: 0, elapsed_s: Math.round((Date.now() - startedAt) / 100) / 10, sources }, warnings: [...warnings, '未找到该作者的论文'] } }
      return
    }

    yield { event: 'partial_result', data: { papers: papers.map((paper) => cleanWithReport(paper)), search_info: { query: name, type: 'author', timestamp: timestamp(), fetched: papers.length, elapsed_s: Math.round((Date.now() - startedAt) / 100) / 10, sources, status: 'author_papers_fetched' } } }
    const deepseek = input.deepseekEnrich !== false && input.config?.deepseekEnrich !== false
    const deepseekKey = input.credentials?.deepseekApiKey?.trim()
    yield progress('enrich', 'Wave 1/2：多源字段补全中...', 35)
    const enriched = await enrichAutoRelatedWorkPapers(papers, {
      query: name,
      config: { ...(input.config ?? {}), maxEnrichmentRounds: input.config?.maxEnrichmentRounds ?? 3, deepseekEnrich: deepseek, includeAuthorProfiles: false, recursiveDepth: 0 },
      credentials: input.credentials, dataRoot: input.dataRoot, fetchImpl: input.fetchImpl, signal: input.signal,
    })
    yield progress('enrich', '抓取参考文献...', 70)
    await enrichAutoRelatedWorkReferences(enriched.papers, { query: name, config: { ...(input.config ?? {}), deepseekEnrich: deepseek }, credentials: input.credentials, dataRoot: input.dataRoot, fetchImpl: input.fetchImpl, signal: input.signal }, 30)
    if (deepseek && deepseekKey !== undefined && deepseekKey !== '') {
      yield progress('relevance', `AI 语义相关度评分（${enriched.papers.length} 篇）...`, 78)
      const scored = await Promise.all(enriched.papers.map(async (paper) => ({ paper, score: await scoreAutoRelatedWorkRelevance(paper, name, { query: name, config: input.config, credentials: input.credentials, dataRoot: input.dataRoot, fetchImpl: input.fetchImpl, signal: input.signal }) })))
      for (const item of scored) if (item.score !== undefined) { item.paper.aiRelevance = item.score.score; item.paper.aiRelevanceReason = item.score.reason }
      if (scored.some((item) => item.score !== undefined)) enriched.papers.sort((a, b) => (b.aiRelevance ?? -1) - (a.aiRelevance ?? -1))
    }
    yield progress('finalize', `完成！${enriched.papers.length} 篇论文`, 100)
    yield { event: 'result', data: { ...resultData(enriched.papers, name, sources, startedAt, { type: 'author', author_profile: author.profileWire, report: { initial_scores: enriched.report.initialScores, final_scores: enriched.report.finalScores, rounds: enriched.report.rounds.map((item) => ({ round: item.round, fixes: item.fixes, avg_score: item.averageScore })), avg_score: enriched.report.averageScore } }, warnings) } }
  } catch (error) {
    yield { event: 'error', data: { message: `作者论文流水线异常: ${error instanceof Error ? error.message : String(error)}` } }
  }
}

/** `/api/pipeline` 的 SSE 事件协议。事件顺序与原 Flask 端点一致。 */
export async function* autoRelatedWorkPipelineEvents(input: {
  query: string; maxResults?: number; rounds?: number; deepseekEnrich?: boolean; authorEnrich?: boolean; searchType?: 'general' | 'cites' | 'related' | 'author'; fast?: boolean
} & AutoRelatedWorkCompatRuntimeInput): AsyncGenerator<AutoRelatedWorkSSEEvent> {
  const query = input.query.trim()
  if (query === '') { yield { event: 'error', data: { message: '查询词不能为空' } }; return }
  const startedAt = Date.now(); const warnings: string[] = []
  yield progress('search', '并行搜索 Crossref + OpenAlex + Google Scholar...', 5)
  try {
    const quick = await searchAutoRelatedWorkCompat({ query, maxResults: input.maxResults, config: { ...(input.config ?? {}), searchType: input.searchType ?? 'general' }, credentials: input.credentials, dataRoot: input.dataRoot, fetchImpl: input.fetchImpl, signal: input.signal, fast: true })
    warnings.push(...quick.warnings)
    const papers = quick.papers.map(autoRelatedWorkPaperFromRecord)
    const sourceMap = (quick.search_info.sources as Record<string, number> | undefined) ?? sourceCounts(papers.map((paper) => [paper]))
    yield progress('search', `合并去重后: ${papers.length} 篇论文`, 30)
    if (papers.length === 0) {
      yield { event: 'result', data: { papers: [], search_info: { ...quick.search_info, elapsed_s: Math.round((Date.now() - startedAt) / 100) / 10, sources: sourceMap }, warnings } }
      return
    }
    const cacheEnabled = (input.config?.cacheEnabled ?? true) !== false
    persistAutoRelatedWorkStage(papers, input.dataRoot, 'search', cacheEnabled)
    yield pipelinePartial(papers, query, sourceMap, startedAt, 'search_done')
    if (input.fast === true) {
      yield progress('finalize', `快速模式：用已有元数据整理 ${papers.length} 篇...`, 85)
      papers.sort((left, right) => {
        const a = [paperCitedCount(left), left.authors.length, paperYear(left)]
        const b = [paperCitedCount(right), right.authors.length, paperYear(right)]
        for (let index = 0; index < a.length; index += 1) if (a[index]! !== b[index]!) return b[index]! - a[index]!
        return 0
      })
      for (const paper of papers) if (paper.resumeDone !== true) { paper.enrichStage = 'wave1'; paper.cacheComplete = false }
      persistAutoRelatedWorkStage(papers, input.dataRoot, 'wave1', cacheEnabled)
      yield progress('finalize', `完成！${papers.length} 篇论文`, 100)
      yield { event: 'result', data: resultData(papers, query, sourceMap, startedAt, {}, warnings) }
      return
    }
    const pending = papers.filter((paper) => paper.resumeDone !== true)
    const enrichConfig: AutoRelatedWorkConfig = {
      ...(input.config ?? {}),
      maxEnrichmentRounds: input.rounds ?? input.config?.maxEnrichmentRounds ?? 3,
      fetchArxiv: input.config?.fetchArxiv !== false,
      fetchArxivHTML: input.config?.fetchArxivHTML !== false,
      fetchBibtex: input.config?.fetchBibtex !== false,
      fetchSemanticScholar: input.config?.fetchSemanticScholar !== false,
      fetchUnpaywall: input.config?.fetchUnpaywall !== false,
      deepseekEnrich: input.deepseekEnrich !== false,
      deepseekAuthorFallback: true,
      includeAuthorProfiles: false,
      recursiveDepth: 0,
    }
    yield progress('enrich', 'Wave 1: 全源并行补全中...', 35)
    await enrichAutoRelatedWorkWave1(pending, { query, config: enrichConfig, credentials: input.credentials, dataRoot: input.dataRoot, fetchImpl: input.fetchImpl, signal: input.signal }, { bibtex: true, unpaywall: true })
    persistAutoRelatedWorkStage(papers, input.dataRoot, 'wave1', cacheEnabled)
    yield pipelinePartial(papers, query, sourceMap, startedAt, 'Wave1')

    yield progress('enrich', 'Wave 2: arXiv 详情 + DeepSeek AI...', 60)
    await enrichAutoRelatedWorkWave2(pending, { query, config: { ...enrichConfig, fetchArxivHTML: true }, credentials: input.credentials, dataRoot: input.dataRoot, fetchImpl: input.fetchImpl, signal: input.signal }, input.deepseekEnrich !== false)
    const deepseekConfigured = (input.credentials?.deepseekApiKey?.trim() ?? '') !== ''
    if (!deepseekConfigured) yield progress('enrich', 'DeepSeek 未配置，跳过 AI 补全', 68)
    persistAutoRelatedWorkStage(papers, input.dataRoot, 'wave2', cacheEnabled)
    yield pipelinePartial(papers, query, sourceMap, startedAt, 'Wave2')

    yield progress('enrich', `抓取参考文献（${pending.length} 篇并行）...`, 70)
    await enrichAutoRelatedWorkReferences(pending, { query, config: enrichConfig, credentials: input.credentials, dataRoot: input.dataRoot, fetchImpl: input.fetchImpl, signal: input.signal }, 30)
    persistAutoRelatedWorkStage(papers, input.dataRoot, 'refs', cacheEnabled)
    yield pipelinePartial(papers, query, sourceMap, startedAt, 'References')

    let authorReport: Record<string, unknown> | undefined
    if (input.authorEnrich === true) {
      yield progress('author', '作者 Google Scholar 档案补全...', 75)
      try {
        await fillAuthorIdsFromTitles(papers, { ...input, config: enrichConfig })
        authorReport = await enrichAutoRelatedWorkAuthors(papers, { query, config: enrichConfig, credentials: input.credentials, dataRoot: input.dataRoot, fetchImpl: input.fetchImpl, signal: input.signal }) as unknown as Record<string, unknown>
      } catch (error) { warnings.push(`作者档案补全异常: ${error instanceof Error ? error.message.slice(0, 100) : String(error).slice(0, 100)}`) }
    }
    if (input.deepseekEnrich !== false && deepseekConfigured) {
      yield progress('relevance', `AI 语义相关度评分（${papers.length} 篇）...`, 78)
      await runBounded(papers, Math.max(5, Math.min(16, papers.length)), async (paper) => {
        const score = await scoreAutoRelatedWorkRelevance(paper, query, { query, config: enrichConfig, credentials: input.credentials, dataRoot: input.dataRoot, fetchImpl: input.fetchImpl, signal: input.signal })
        if (score !== undefined) { paper.aiRelevance = score.score; paper.aiRelevanceReason = score.reason }
      })
      const scoredCount = papers.filter((paper) => paper.aiRelevance !== undefined).length
      if (scoredCount > 0) yield progress('relevance', `相关度评分完成（${scoredCount}/${papers.length} 篇），重新排序...`, 81)
      else { warnings.push('相关度评分失败: 所有论文均未返回有效评分'); yield progress('relevance', '相关度评分全部失败，退回默认排序。', 81) }
    } else if (!deepseekConfigured) {
      yield progress('enrich', 'DeepSeek 未配置，跳过 AI 相关度评分', 68)
    }
    yield progress('finalize', '按相关性排序中...', 83)
    const finalPapers = papers.some((paper) => paper.aiRelevance !== undefined) ? sortByAIRelevance(papers) : sortByScholarThenRelevance(query, papers)
    for (const paper of finalPapers) if (paper.resumeDone !== true) { paper.enrichStage = 'done'; paper.cacheComplete = true }
    persistAutoRelatedWorkStage(finalPapers, input.dataRoot, 'done', cacheEnabled)
    yield progress('finalize', '正在整理结果...', 85)
    yield progress('finalize', `完成！${finalPapers.length} 篇论文`, 100)
    const extra: Record<string, unknown> = {
      ...(authorReport !== undefined ? { author_report: authorReport } : {}),
      ...(input.searchType !== undefined && input.searchType !== 'general' ? { type: input.searchType } : {}),
    }
    yield { event: 'result', data: resultData(finalPapers, query, sourceMap, startedAt, extra, warnings) }
  } catch (error) {
    yield { event: 'error', data: { message: `流水线异常: ${error instanceof Error ? error.message : String(error)}` } }
  }
}

/** `/api/related-search`：种子搜索 + 引用图递归 + 共享补全。 */
export async function* autoRelatedWorkRelatedSearchEvents(input: {
  query: string; depth?: number; width?: number; maxResults?: number; maxTotal?: number; deepseekEnrich?: boolean; fast?: boolean; gsSeed?: boolean
} & AutoRelatedWorkCompatRuntimeInput): AsyncGenerator<AutoRelatedWorkSSEEvent> {
  const query = input.query.trim()
  if (query === '') { yield { event: 'error', data: { message: '查询词不能为空' } }; return }
  const startedAt = Date.now(); const warnings: string[] = []
  const depth = bounded(input.depth, 3, 1, 5); const width = bounded(input.width, 5, 1, 20); const maxTotal = bounded(input.maxTotal, 150, 1, 400)
  yield progress('search', `搜索种子论文「${query}」...`, 4)
  try {
    const quick = await searchAutoRelatedWorkCompat({ query, maxResults: bounded(input.maxResults, 10, 1, 20), config: { ...(input.config ?? {}), ...(input.gsSeed === true ? {} : { netScholar: input.config?.netScholar ?? 'direct' }) }, credentials: input.credentials, dataRoot: input.dataRoot, fetchImpl: input.fetchImpl, signal: input.signal, fast: true })
    warnings.push(...quick.warnings)
    const seeds = quick.papers.map(autoRelatedWorkPaperFromRecord)
    if (seeds.length === 0) { yield { event: 'result', data: { type: 'related', papers: [], search_info: { query, type: 'related', timestamp: timestamp(), fetched: 0, elapsed_s: Math.round((Date.now() - startedAt) / 100) / 10, depth, width }, warnings: [...warnings, '未找到种子论文'] } }; return }
    yield progress('search', `种子 ${seeds.length} 篇，按引用递归 ${depth} 层（每篇 top-${width}）...`, 12)
    const graph = await recursiveCollectAutoRelatedWork(seeds, { query, config: input.config, credentials: input.credentials, dataRoot: input.dataRoot, fetchImpl: input.fetchImpl, signal: input.signal, depth, width, maxTotal, fetchRefs: true, onRecursiveProgress: (level, count, total) => input.config?.fast !== true && undefined })
    const sources = sourceCounts(graph.papers.map((paper) => [paper]))
    yield progress('search', `引用图构建完成：${graph.papers.length} 篇论文、${graph.edges.length} 条引用`, 28)
    yield { event: 'partial_result', data: { papers: graph.papers.map((paper) => ({ ...cleanWithReport(paper), _depth: paper.depth ?? 0 })), search_info: { query, type: 'related', timestamp: timestamp(), fetched: graph.papers.length, elapsed_s: Math.round((Date.now() - startedAt) / 100) / 10, sources, depth, width, edges: graph.edges.length, status: 'graph_built' } } }
    if (input.fast === true) {
      yield { event: 'result', data: resultData(graph.papers, query, sources, startedAt, { type: 'related', edges: graph.edges, graph_info: { depth, width, n_edges: graph.edges.length } }, warnings) }
      return
    }
    yield progress('enrich', '引用图论文字段补全中...', 35)
    const enriched = await enrichAutoRelatedWorkPapers(graph.papers, { query, config: { ...(input.config ?? {}), maxEnrichmentRounds: 1, deepseekEnrich: input.deepseekEnrich !== false, includeAuthorProfiles: false, recursiveDepth: 0 }, credentials: input.credentials, dataRoot: input.dataRoot, fetchImpl: input.fetchImpl, signal: input.signal })
    yield progress('finalize', `完成！${enriched.papers.length} 篇论文`, 100)
    yield { event: 'result', data: resultData(enriched.papers, query, sources, startedAt, { type: 'related', edges: graph.edges, graph_info: { depth, width, n_edges: graph.edges.length } }, warnings) }
  } catch (error) { yield { event: 'error', data: { message: `相关文献递归搜索异常: ${error instanceof Error ? error.message : String(error)}` } } }
}

/** `/api/enrich-stream`：保持 progress/result/error 事件协议。 */
export async function* autoRelatedWorkEnrichStreamEvents(input: { papers: Array<Record<string, unknown>>; rounds?: number; authorEnrich?: boolean; query?: string } & AutoRelatedWorkCompatRuntimeInput): AsyncGenerator<AutoRelatedWorkSSEEvent> {
  if (!Array.isArray(input.papers) || input.papers.length === 0) { yield { event: 'error', data: { message: '论文列表为空' } }; return }
  yield progress('Crossref', 'Crossref 字段补全...', 10)
  try {
    const output = await enrichAutoRelatedWorkCompat({ papers: input.papers, rounds: input.rounds, query: input.query, config: { ...(input.config ?? {}), deepseekEnrich: input.config?.deepseekEnrich !== false, fetchSemanticScholar: false }, credentials: input.credentials, dataRoot: input.dataRoot, fetchImpl: input.fetchImpl, signal: input.signal })
    if (input.authorEnrich === true) yield progress('Author', '作者档案补全...', 80)
    yield progress('Finalize', '整理结果...', 90)
    yield { event: 'result', data: { papers: output.papers, report: output.report, warnings: output.warnings } }
  } catch (error) { yield { event: 'error', data: { message: error instanceof Error ? error.message : String(error) } } }
}

/** 非流式 Remote 调用使用的事件收集器；HTTP 路由仍逐事件写出。 */
export async function collectAutoRelatedWorkEvents(generator: AsyncGenerator<AutoRelatedWorkSSEEvent>): Promise<AutoRelatedWorkSSEEvent[]> {
  const events: AutoRelatedWorkSSEEvent[] = []
  for await (const event of generator) events.push(event)
  return events
}

async function autoRelatedWorkHealthProbe(url: string): Promise<{ ok: boolean; status?: number; error?: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5_000)
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { accept: 'text/html', 'user-agent': 'EvoResearch/0.1 AutoRelatedWork' } })
    return { ok: response.ok, status: response.status }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message.slice(0, 120) : String(error).slice(0, 120) }
  } finally { clearTimeout(timer) }
}

/** 与 app.py /api/health 对齐，同时不把 API key/代理密码回显给浏览器。 */
export async function autoRelatedWorkHealth(config: AutoRelatedWorkConfig = {}, credentials: AutoRelatedWorkCredentials = {}): Promise<Record<string, unknown>> {
  const scholarBase = (config.scholarURL?.trim() || 'https://scholar.google.com').replace(/\/+$/, '')
  const direct = await autoRelatedWorkHealthProbe(`${scholarBase}/scholar?q=health&hl=en&num=1`)
  return {
    status: 'ok',
    time: timestamp(),
    config: {
      ...config,
      proxy_configured: Boolean(config.qgServers?.some((item) => item.trim() !== '') || config.localProxy),
      deepseek_configured: Boolean(credentials.deepseekApiKey?.trim() || config.deepseekURL),
      semantic_scholar_configured: Boolean(credentials.semanticScholarApiKey?.trim()),
      google_direct: direct.ok,
      google_status: direct.status ?? null,
      google_error: direct.error ?? null,
    },
  }
}
