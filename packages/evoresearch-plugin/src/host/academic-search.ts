/**
 * 无 API Key 的学术文献检索。
 *
 * 普通网页搜索和论文检索是两个不同的问题：Open-WebSearch 能提供网页
 * SERP，但它不保证题录质量，也可能把短词送到词典垂直结果。论文检索
 * 优先使用 OpenAlex 的学术元数据索引，Crossref 作为同样免费的兜底。
 * 这里不安装 Python/浏览器，也不把 API key 写入项目数据目录。
 */

export const OPENALEX_DEFAULT_URL = 'https://api.openalex.org'
export const CROSSREF_DEFAULT_URL = 'https://api.crossref.org'

/** 论文作者的结构化补充信息。来源可能是 arXiv HTML 或 Scholar 主页。 */
export interface AcademicAuthor {
  name: string
  affiliations?: string[]
  scholarId?: string
  scholarURL?: string
  email?: string
  corresponding?: boolean
  /** 与 AutoRelatedWork author.py 的作者卡片字段保持一致。 */
  citationStats?: Record<string, number>
  interests?: string[] | string
}

/** Google Scholar 作者主页的可选摘要。 */
export interface AcademicAuthorProfile {
  scholarId: string
  name?: string
  url: string
  affiliation?: string
  email?: string
  homepage?: string
  interests?: string[]
  citationStats?: Record<string, number>
  totalPapers?: number
  topCitedPapers?: Array<{ title: string; year?: number; citedByCount?: number; venue?: string; paperId?: string; authorsStr?: string }>
  topRecentPapers?: Array<{ title: string; year?: number; citedByCount?: number; venue?: string; paperId?: string; authorsStr?: string }>
  allPapers?: Array<{ title: string; year?: number; citedByCount?: number; venue?: string; paperId?: string; authorsStr?: string }>
}

/** 引用递归返回的精简参考文献。 */
export interface AcademicReference {
  title: string
  url?: string
  doi?: string
  authors?: string[]
  venue?: string
  year?: number
  citedByCount?: number
  source?: string
  influential?: boolean
  citationIntents?: string[]
  citationContexts?: number
}

/** AutoRelatedWork 原始 Python 引擎的完整论文输出兼容字段。 */
export interface AcademicFieldSources {
  [field: string]: string
}

export interface AcademicVersions {
  count?: number
  url?: string
}

export interface AcademicSource {
  url: string
  title: string
  snippet?: string
  authorsStr?: string
  externalUrls?: string[]
  domain?: string
  publishedAt?: string
  doi?: string
  authors?: string[]
  venue?: string
  year?: number
  citedByCount?: number
  /** 与原始 scholar_search.py 的 cited_by 对象一一对应。 */
  citedBy?: { count?: number; url?: string }
  openAccess?: boolean
  abstract?: string
  pdfUrls?: string[]
  additionalUrls?: string[]
  citedByURL?: string
  allVersionsCount?: number
  allVersionsURL?: string
  allVersions?: AcademicVersions
  relatedArticlesURL?: string
  viewHTMLURLs?: string[]
  clusterId?: string
  dataCid?: string
  authorsTruncated?: boolean
  paperId?: string
  bibtex?: string
  institutions?: string[]
  authorScholarIds?: Record<string, string>
  authorsDetailed?: AcademicAuthor[]
  authorProfiles?: Record<string, AcademicAuthorProfile>
  emails?: string[]
  references?: AcademicReference[]
  fieldSources?: AcademicFieldSources
  completeness?: number
  missingFields?: string[]
  enrichStage?: 'search' | 'wave1' | 'wave2' | 'refs' | 'done'
  cacheComplete?: boolean
  sourceType: 'academic'
}

export interface AcademicSearchResult {
  provider: 'OpenAlex' | 'Crossref' | 'AutoRelatedWork'
  query: string
  sources: AcademicSource[]
  totalAvailable?: number
  elapsedMs?: number
  searchType?: 'general' | 'cites' | 'related' | 'author'
}

interface FetchLike {
  (input: string | URL | Request, init?: RequestInit): Promise<Response>
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function cleanURL(value: string, fallback: string): string {
  const trimmed = value.trim().replace(/\/+$/, '')
  return trimmed === '' ? fallback : trimmed
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function firstDate(value: unknown): string | undefined {
  if (!isObject(value)) return undefined
  const parts = value['date-parts']
  if (!Array.isArray(parts) || !Array.isArray(parts[0])) return undefined
  const date = parts[0].filter((part): part is number => typeof part === 'number' && Number.isFinite(part))
  if (date.length === 0) return undefined
  return date.map((part, index) => index === 0 ? String(part).padStart(4, '0') : String(part).padStart(2, '0')).join('-')
}

/** 只留下主题词；时间/程度/连接词不应把 OpenAlex 的标题检索带偏。 */
export function academicQueryTerms(query: string): string {
  const intentWords = new Set([
    'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'in', 'into',
    'is', 'it', 'of', 'on', 'or', 'the', 'to', 'toward', 'towards', 'using', 'with',
    'recent', 'recently', 'latest', 'new', 'advances', 'advance', 'progress',
    'current', 'overview', 'state-of-the-art', 'state', 'art', 'applications',
    'search', 'find', 'please', 'about', 'information', 'info', 'can', 'you', 'me',
    'paper', 'papers', 'article', 'articles', 'literature', 'publication', 'publications',
    'research', 'study', 'studies',
  ])
  const normalized = query
    .replace(/[“”「」『』]/g, ' ')
    .replace(/[，。；、：！？（）【】]/g, ' ')
    .trim()
  const tokens = normalized.split(/\s+/).filter((token) => token !== '')
  const kept: string[] = []
  const seen = new Set<string>()
  for (const token of tokens) {
    const key = token.toLocaleLowerCase()
    if (intentWords.has(key) || seen.has(key)) continue
    seen.add(key)
    kept.push(token)
  }
  return kept.join(' ') || normalized
}

function normalizeDoi(value: unknown): string | undefined {
  const raw = stringValue(value)
  if (raw === undefined) return undefined
  const doi = raw.replace(/^https?:\/\/doi\.org\//i, '').replace(/^doi:\s*/i, '').trim()
  return /^10\.\d{4,9}\/\S+$/i.test(doi) ? doi : undefined
}

function doiURL(doi: string | undefined): string | undefined {
  return doi === undefined ? undefined : `https://doi.org/${doi}`
}

function normalizeSourceURL(value: unknown): string | undefined {
  const url = stringValue(value)
  return url !== undefined && /^https?:\/\//i.test(url) ? url : undefined
}

function authorNames(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      if (!isObject(item)) return undefined
      const author = isObject(item.author) ? item.author : item
      return stringValue(author.display_name) ?? stringValue(item.name)
    })
    .filter((name): name is string => name !== undefined)
    .slice(0, 6)
}

function academicSnippet(options: {
  authors?: string[]
  venue?: string
  year?: number
  doi?: string
  citedByCount?: number
  openAccess?: boolean
  description?: string
}): string | undefined {
  const parts: string[] = []
  if (options.year !== undefined) parts.push(String(options.year))
  if (options.authors !== undefined && options.authors.length > 0) parts.push(`作者：${options.authors.join(', ')}`)
  if (options.venue !== undefined && options.venue !== '') parts.push(`期刊/会议：${options.venue}`)
  if (options.doi !== undefined) parts.push(`DOI：${options.doi}`)
  if (options.openAccess === true) parts.push('开放获取')
  if (options.citedByCount !== undefined) parts.push(`被引：${options.citedByCount}`)
  if (options.description !== undefined && options.description !== '') parts.push(options.description)
  return parts.length === 0 ? undefined : parts.join(' · ')
}

function openAlexSource(value: unknown): AcademicSource | undefined {
  if (!isObject(value)) return undefined
  const title = stringValue(value.title)
  if (title === undefined) return undefined
  const primary = isObject(value.primary_location) ? value.primary_location : {}
  const source = isObject(primary.source) ? primary.source : {}
  const doi = normalizeDoi(value.doi)
  const url = doiURL(doi) ?? normalizeSourceURL(primary.landing_page_url) ?? normalizeSourceURL(value.id)
  if (url === undefined) return undefined
  const year = numberValue(value.publication_year)
  const venue = stringValue(source.display_name)
  const authors = authorNames(value.authorships)
  const openAccess = isObject(value.open_access) && value.open_access.is_oa === true
  const citedByCount = numberValue(value.cited_by_count)
  return {
    url,
    title,
    ...(academicSnippet({ authors, venue, year, doi, citedByCount, openAccess }) !== undefined
      ? { snippet: academicSnippet({ authors, venue, year, doi, citedByCount, openAccess }) }
      : {}),
    ...(stringValue(value.publication_date) !== undefined ? { publishedAt: stringValue(value.publication_date) } : year !== undefined ? { publishedAt: String(year) } : {}),
    ...(doi !== undefined ? { doi } : {}),
    ...(authors.length > 0 ? { authors } : {}),
    ...(venue !== undefined ? { venue } : {}),
    ...(year !== undefined ? { year } : {}),
    ...(citedByCount !== undefined ? { citedByCount } : {}),
    openAccess,
    sourceType: 'academic',
  }
}

function crossrefSource(value: unknown): AcademicSource | undefined {
  if (!isObject(value)) return undefined
  const type = stringValue(value.type)
  if (type === 'component' || type === 'dataset' || type === 'journal-issue' || type === 'reference-entry') return undefined
  const rawTitle = Array.isArray(value.title) ? value.title[0] : value.title
  const title = stringValue(rawTitle)
  if (title === undefined) return undefined
  const doi = normalizeDoi(value.DOI)
  const url = doiURL(doi) ?? normalizeSourceURL(value.URL) ?? normalizeSourceURL(isObject(value.resource) && isObject(value.resource.primary) ? value.resource.primary.URL : undefined)
  if (url === undefined) return undefined
  const rawVenue = Array.isArray(value['container-title']) ? value['container-title'][0] : value['container-title']
  const venue = stringValue(rawVenue)
  const authors = Array.isArray(value.author)
    ? value.author.map((author) => isObject(author) ? [stringValue(author.given), stringValue(author.family)].filter((part): part is string => part !== undefined).join(' ') : '').filter((name) => name !== '').slice(0, 6)
    : []
  const publishedAt = firstDate(value.published) ?? firstDate(value['published-print']) ?? firstDate(value['published-online']) ?? firstDate(value.issued)
  const year = publishedAt === undefined ? undefined : Number(publishedAt.slice(0, 4))
  const citedByCount = numberValue(value['is-referenced-by-count'])
  const description = stringValue(value.abstract)?.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500)
  return {
    url,
    title,
    ...(academicSnippet({ authors, venue, year, doi, citedByCount, description }) !== undefined
      ? { snippet: academicSnippet({ authors, venue, year, doi, citedByCount, description }) }
      : {}),
    ...(publishedAt !== undefined ? { publishedAt } : {}),
    ...(doi !== undefined ? { doi } : {}),
    ...(authors.length > 0 ? { authors } : {}),
    ...(venue !== undefined ? { venue } : {}),
    ...(year !== undefined && Number.isFinite(year) ? { year } : {}),
    ...(citedByCount !== undefined ? { citedByCount } : {}),
    sourceType: 'academic',
  }
}

function dedupeSources(sources: AcademicSource[], limit: number): AcademicSource[] {
  const seen = new Set<string>()
  return sources.filter((item) => {
    const key = (item.doi ?? item.url).toLocaleLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, limit)
}

function rankSources(query: string, sources: AcademicSource[]): AcademicSource[] {
  const terms = academicQueryTerms(query).toLocaleLowerCase().split(/\s+/).filter(Boolean)
  const score = (item: AcademicSource): number => {
    const title = item.title.toLocaleLowerCase()
    const matches = terms.filter((term) => title.includes(term)).length
    const phraseBonus = terms.length > 1 && title.includes(terms.join(' ')) ? 2 : 0
    const citationBonus = item.citedByCount === undefined ? 0 : Math.min(Math.log10(item.citedByCount + 1), 3) / 10
    return matches * 10 + phraseBonus + citationBonus
  }
  return sources.slice().sort((a, b) => score(b) - score(a))
}

async function requestJson(fetchImpl: FetchLike, input: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15_000)
  const abort = () => controller.abort(signal?.reason)
  if (signal !== undefined) {
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
  }
  try {
    const response = await fetchImpl(input, { headers: { accept: 'application/json', 'user-agent': 'EvoResearch/0.1 (academic-search)' }, signal: controller.signal })
    const text = await response.text()
    if (!response.ok) throw new Error(`${response.status} ${text.slice(0, 200)}`)
    const body = JSON.parse(text) as unknown
    if (!isObject(body)) throw new Error('学术服务返回的不是 JSON 对象')
    return body
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
  }
}

function openAlexURL(baseURL: string, query: string, limit: number, titleOnly: boolean): string {
  const url = new URL(`${cleanURL(baseURL, OPENALEX_DEFAULT_URL)}/works`)
  const terms = academicQueryTerms(query)
  if (titleOnly && terms !== '') url.searchParams.set('filter', `title.search:${terms}`)
  else url.searchParams.set('search', query)
  url.searchParams.set('per-page', String(Math.min(Math.max(limit, 1), 25)))
  url.searchParams.set('sort', 'relevance_score:desc')
  url.searchParams.set('select', 'id,doi,title,publication_year,publication_date,authorships,primary_location,open_access,cited_by_count,type')
  return url.toString()
}

export async function searchOpenAlex(options: { baseURL?: string; query: string; limit?: number; fetchImpl?: FetchLike; signal?: AbortSignal }): Promise<AcademicSearchResult> {
  const query = options.query.trim()
  if (query === '') throw new Error('学术检索词不能为空')
  const limit = Math.min(Math.max(Math.floor(options.limit ?? 8), 1), 25)
  const fetchImpl = options.fetchImpl ?? fetch
  const first = await requestJson(fetchImpl, openAlexURL(options.baseURL ?? '', query, Math.max(limit, 10), true), options.signal)
  const firstItems = Array.isArray(first.results) ? first.results.map(openAlexSource).filter((item): item is AcademicSource => item !== undefined) : []
  // 标题精确检索优先，结果太少时再用 OpenAlex 的全文相关性索引补足；两者
  // 都是题录数据，避免回退到会产生词典/SEO 结果的通用网页 SERP。
  let sources = firstItems
  if (sources.length < Math.min(3, limit)) {
    const fallback = await requestJson(fetchImpl, openAlexURL(options.baseURL ?? '', query, Math.max(limit * 2, 10), false), options.signal)
    const fallbackItems = Array.isArray(fallback.results) ? fallback.results.map(openAlexSource).filter((item): item is AcademicSource => item !== undefined) : []
    sources = dedupeSources([...sources, ...fallbackItems], limit)
  }
  return { provider: 'OpenAlex', query, sources: rankSources(query, dedupeSources(sources, limit)) }
}

export async function searchCrossref(options: { baseURL?: string; query: string; limit?: number; fetchImpl?: FetchLike; signal?: AbortSignal }): Promise<AcademicSearchResult> {
  const query = options.query.trim()
  if (query === '') throw new Error('学术检索词不能为空')
  const limit = Math.min(Math.max(Math.floor(options.limit ?? 8), 1), 25)
  const fetchImpl = options.fetchImpl ?? fetch
  const url = new URL(`${cleanURL(options.baseURL ?? '', CROSSREF_DEFAULT_URL)}/works`)
  url.searchParams.set('query.bibliographic', query)
  url.searchParams.set('rows', String(limit))
  url.searchParams.set('select', 'DOI,title,URL,type,author,container-title,published,published-print,published-online,issued,abstract,is-referenced-by-count,resource')
  const body = await requestJson(fetchImpl, url.toString(), options.signal)
  const message = isObject(body.message) ? body.message : {}
  const items = Array.isArray(message.items) ? message.items.map(crossrefSource).filter((item): item is AcademicSource => item !== undefined) : []
  return { provider: 'Crossref', query, sources: rankSources(query, dedupeSources(items, limit)) }
}

export async function searchAcademic(options: { openAlexURL?: string; crossrefURL?: string; query: string; limit?: number; fetchImpl?: FetchLike; signal?: AbortSignal }): Promise<AcademicSearchResult> {
  let openAlexError: unknown
  try {
    const result = await searchOpenAlex(options)
    if (result.sources.length > 0) return result
    openAlexError = new Error('OpenAlex 没有匹配的论文')
  } catch (error) {
    openAlexError = error
  }
  try {
    const result = await searchCrossref({ baseURL: options.crossrefURL, query: options.query, limit: options.limit, fetchImpl: options.fetchImpl, signal: options.signal })
    if (result.sources.length > 0) return result
    throw new Error('Crossref 没有匹配的论文')
  } catch (crossrefError) {
    const first = openAlexError instanceof Error ? openAlexError.message : String(openAlexError)
    const second = crossrefError instanceof Error ? crossrefError.message : String(crossrefError)
    throw new Error(`学术检索失败（OpenAlex: ${first}；Crossref: ${second}）`)
  }
}
