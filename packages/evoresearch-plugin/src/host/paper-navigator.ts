/**
 * EvoScientist/EvoSkills `paper-navigator` 的 TypeScript 学术检索内核。
 *
 * 这个模块只负责可验证的检索与图扩展，不负责 LLM 的 rubric/triage。这样
 * 它既能被 agent tool 调用，也能被文献面板调用；上层可以在每轮搜索后做
 * 自己的相关性判断。Semantic Scholar 是主索引，arXiv 是无 key/限流时的
 * 兜底；引用、推荐和 snippet 使用 S2 原生关系接口。
 */

export const PAPER_NAVIGATOR_S2_URL = 'https://api.semanticscholar.org/graph/v1'
export const PAPER_NAVIGATOR_RECOMMEND_URL = 'https://api.semanticscholar.org/recommendations/v1'
export const PAPER_NAVIGATOR_ARXIV_URL = 'https://export.arxiv.org/api/query'

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>
type CachedResponse = { expiresAt: number; value: unknown }
const PAPER_NAVIGATOR_CACHE = new Map<string, CachedResponse>()
const PAPER_NAVIGATOR_CACHE_TTL_MS = 10 * 60 * 1000
const PAPER_NAVIGATOR_CACHE_MAX = 256

export interface PaperNavigatorPaper {
  paperId?: string
  corpusId?: string | number
  externalIds?: Record<string, string>
  title: string
  authors: string[]
  year?: number
  citationCount?: number
  influentialCitationCount?: number
  tldr?: string
  abstract?: string
  venue?: string
  url?: string
  pdfUrl?: string
  openAccess?: boolean
  source: 'SemanticScholar' | 'Arxiv'
  isInfluential?: boolean
  citationContexts?: number
  citationIntents?: string[]
  relatedCount?: number
  smartScore?: number
}

export interface PaperNavigatorSearchOptions {
  query: string
  limit?: number
  yearMin?: number
  yearMax?: number
  openAccessOnly?: boolean
  sortBy?: 'relevance' | 'citations' | 'year'
  s2URL?: string
  arxivURL?: string
  apiKey?: string
  fetchImpl?: FetchLike
  signal?: AbortSignal
}

export interface PaperNavigatorSearchResult {
  provider: 'PaperNavigator'
  query: string
  papers: PaperNavigatorPaper[]
  source: 'SemanticScholar' | 'Arxiv'
  fallback?: boolean
  warning?: string
  elapsedMs: number
}

export type PaperNavigatorDirection = 'forward' | 'backward' | 'co-citation'

export interface PaperNavigatorRelatedOptions {
  paperId: string
  direction?: PaperNavigatorDirection
  limit?: number
  yearMin?: number
  yearMax?: number
  minCitations?: number
  smart?: boolean
  s2URL?: string
  apiKey?: string
  fetchImpl?: FetchLike
  signal?: AbortSignal
}

export interface PaperNavigatorRecommendationOptions {
  positiveIds: string[]
  negativeIds?: string[]
  limit?: number
  perSeed?: boolean
  s2URL?: string
  recommendURL?: string
  apiKey?: string
  fetchImpl?: FetchLike
  signal?: AbortSignal
}

export interface PaperNavigatorSnippetOptions {
  query: string
  paperId?: string
  limit?: number
  s2URL?: string
  apiKey?: string
  fetchImpl?: FetchLike
  signal?: AbortSignal
}

export interface PaperNavigatorSnippet {
  paper?: PaperNavigatorPaper
  text: string
  kind?: string
  score?: number
}

const S2_FIELDS = 'paperId,corpusId,externalIds,title,authors,year,citationCount,influentialCitationCount,tldr,isOpenAccess,openAccessPdf,publicationVenue,abstract'
const RELATED_FIELDS = 'paperId,corpusId,externalIds,title,authors,year,citationCount,influentialCitationCount,isOpenAccess,openAccessPdf,publicationVenue,abstract'
// Nested citation objects are stricter than /paper/search: publicationVenue has
// caused 400s on older Graph API deployments. The venue is optional for graph
// expansion, so keep the portable field set here.
const CITATION_FIELDS = 'paperId,corpusId,externalIds,title,authors,year,citationCount,influentialCitationCount,isOpenAccess,openAccessPdf'

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function limitOf(value: number | undefined, fallback = 10): number {
  return Math.min(Math.max(Math.floor(value ?? fallback), 1), 100)
}

function endpoint(base: string | undefined, fallback: string): string {
  return (base?.trim() || fallback).replace(/\/+$/, '')
}

function headers(apiKey?: string): Record<string, string> {
  return {
    accept: 'application/json',
    'user-agent': 'EvoResearch/0.1 (paper-navigator)',
    ...(apiKey?.trim() ? { 'x-api-key': apiKey.trim() } : {}),
  }
}

function abortError(signal?: AbortSignal): Error {
  return signal?.reason instanceof Error ? signal.reason : new Error('学术检索已取消')
}

async function wait(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw abortError(signal)
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    const onAbort = () => { clearTimeout(timer); reject(abortError(signal)) }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

async function requestJSON(fetchImpl: FetchLike, url: string, init: RequestInit, signal?: AbortSignal, retries = 2): Promise<unknown> {
  let last: unknown
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (signal?.aborted) throw abortError(signal)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 20_000)
    const onAbort = () => controller.abort(signal?.reason)
    signal?.addEventListener('abort', onAbort, { once: true })
    try {
      const response = await fetchImpl(url, { ...init, signal: controller.signal })
      const bodyText = await response.text()
      if (response.ok) {
        if (bodyText.trim() === '') return {}
        if (/^</.test(bodyText.trim()) || response.headers.get('content-type')?.includes('xml')) return bodyText
        return JSON.parse(bodyText) as unknown
      }
      const error = Object.assign(new Error(`${response.status} ${bodyText.slice(0, 240)}`), { status: response.status })
      last = error
      if ((response.status === 429 || response.status >= 500) && attempt < retries) {
        const retryAfter = Number(response.headers.get('retry-after') ?? '')
        await wait(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 10_000) : 350 * (attempt + 1), signal)
        continue
      }
      throw error
    } catch (error) {
      last = error
      if (signal?.aborted) throw abortError(signal)
      const status = typeof error === 'object' && error !== null && 'status' in error && typeof (error as { status?: unknown }).status === 'number'
        ? (error as { status: number }).status
        : undefined
      if (status !== undefined && status !== 429 && status < 500) throw error
      if (attempt >= retries) throw error
      if (error instanceof SyntaxError) throw error
      await wait(350 * (attempt + 1), signal)
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
  }
  throw last instanceof Error ? last : new Error(String(last))
}

async function requestCachedJSON(fetchImpl: FetchLike, url: string, init: RequestInit, signal: AbortSignal | undefined, key: string, cache = true): Promise<unknown> {
  if (cache) {
    const hit = PAPER_NAVIGATOR_CACHE.get(key)
    if (hit !== undefined) {
      if (hit.expiresAt > Date.now()) return hit.value
      PAPER_NAVIGATOR_CACHE.delete(key)
    }
  }
  const value = await requestJSON(fetchImpl, url, init, signal)
  if (cache) {
    if (PAPER_NAVIGATOR_CACHE.size >= PAPER_NAVIGATOR_CACHE_MAX) {
      const first = PAPER_NAVIGATOR_CACHE.keys().next().value
      if (typeof first === 'string') PAPER_NAVIGATOR_CACHE.delete(first)
    }
    PAPER_NAVIGATOR_CACHE.set(key, { expiresAt: Date.now() + PAPER_NAVIGATOR_CACHE_TTL_MS, value })
  }
  return value
}

function paperURL(value: Record<string, unknown>): string | undefined {
  const ids = object(value.externalIds)
  const arxiv = text(ids?.ArXiv)
  if (arxiv) return `https://arxiv.org/abs/${arxiv}`
  const doi = text(ids?.DOI)
  if (doi) return `https://doi.org/${doi.replace(/^https?:\/\/doi\.org\//i, '')}`
  const oa = object(value.openAccessPdf)
  return text(oa?.url) ?? (text(value.paperId) ? `https://www.semanticscholar.org/paper/${value.paperId}` : undefined)
}

function toPaper(value: unknown, source: PaperNavigatorPaper['source'] = 'SemanticScholar'): PaperNavigatorPaper | undefined {
  const row = object(value)
  const title = text(row?.title)
  if (!row || !title) return undefined
  const authors = Array.isArray(row.authors)
    ? row.authors.map((item) => object(item)?.name).filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    : []
  const venueValue = object(row.publicationVenue)
  const oa = object(row.openAccessPdf)
  return {
    ...(text(row.paperId) ? { paperId: text(row.paperId) } : {}),
    ...(typeof row.corpusId === 'number' || typeof row.corpusId === 'string' ? { corpusId: row.corpusId } : {}),
    ...(object(row.externalIds) ? { externalIds: Object.fromEntries(Object.entries(object(row.externalIds)!).filter(([, item]) => typeof item === 'string')) as Record<string, string> } : {}),
    title,
    authors,
    ...(number(row.year) !== undefined ? { year: number(row.year) } : {}),
    ...(number(row.citationCount) !== undefined ? { citationCount: number(row.citationCount) } : {}),
    ...(number(row.influentialCitationCount) !== undefined ? { influentialCitationCount: number(row.influentialCitationCount) } : {}),
    ...(object(row.tldr) && text(object(row.tldr)?.text) ? { tldr: text(object(row.tldr)?.text) } : {}),
    ...(text(row.abstract) ? { abstract: text(row.abstract) } : {}),
    ...(text(venueValue?.name) ? { venue: text(venueValue?.name) } : text(row.venue) ? { venue: text(row.venue) } : {}),
    ...(paperURL(row) ? { url: paperURL(row) } : {}),
    ...(text(oa?.url) ? { pdfUrl: text(oa?.url) } : {}),
    openAccess: row.isOpenAccess === true || text(oa?.url) !== undefined,
    source,
    ...(row.isInfluential === true ? { isInfluential: true } : {}),
    ...(number(row._contextCount) !== undefined ? { citationContexts: number(row._contextCount) } : {}),
    ...(Array.isArray(row._citationIntents) ? { citationIntents: row._citationIntents.filter((item): item is string => typeof item === 'string') } : {}),
    ...(number(row._relatedCount) !== undefined ? { relatedCount: number(row._relatedCount) } : {}),
  }
}

function arxivXML(value: string, tag: string): string | undefined {
  const match = value.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'))
  return match?.[1]?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function decodeXML(value: string): string {
  return value.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
}

function parseArxiv(body: string, yearMin?: number, yearMax?: number): PaperNavigatorPaper[] {
  const entries = body.match(/<entry>[\s\S]*?<\/entry>/gi) ?? []
  return entries.flatMap((entry): PaperNavigatorPaper[] => {
    const id = arxivXML(entry, 'id')
    const title = arxivXML(entry, 'title')
    const summary = arxivXML(entry, 'summary')
    const published = arxivXML(entry, 'published')
    const year = published ? Number(published.slice(0, 4)) : undefined
    const authors = [...entry.matchAll(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/gi)].map((match) => decodeXML(match[1]!.replace(/\s+/g, ' ').trim()))
    if (!title || !id || (yearMin !== undefined && (year === undefined || year < yearMin)) || (yearMax !== undefined && (year === undefined || year > yearMax))) return []
    const cleanId = id.replace(/v\d+$/, '')
    return [{ title: decodeXML(title), authors, ...(year !== undefined ? { year } : {}), ...(summary ? { abstract: decodeXML(summary) } : {}), url: cleanId, pdfUrl: cleanId.replace('/abs/', '/pdf/') + '.pdf', openAccess: true, source: 'Arxiv', externalIds: { ArXiv: cleanId.split('/').pop() ?? cleanId }, paperId: `arxiv:${cleanId.split('/').pop() ?? cleanId}` } satisfies PaperNavigatorPaper]
  })
}

export async function searchPaperNavigator(options: PaperNavigatorSearchOptions): Promise<PaperNavigatorSearchResult> {
  const query = options.query.trim()
  if (!query) throw new Error('学术检索词不能为空')
  const limit = limitOf(options.limit)
  const fetchImpl = options.fetchImpl ?? fetch
  const startedAt = Date.now()
  const url = new URL(`${endpoint(options.s2URL, PAPER_NAVIGATOR_S2_URL)}/paper/search`)
  url.searchParams.set('query', query)
  url.searchParams.set('limit', String(options.sortBy === 'relevance' || options.sortBy === undefined ? limit : 100))
  url.searchParams.set('fields', S2_FIELDS)
  if (options.yearMin !== undefined || options.yearMax !== undefined) url.searchParams.set('year', `${options.yearMin ?? ''}-${options.yearMax ?? ''}`)
  if (options.openAccessOnly) url.searchParams.set('openAccessPdf', 'true')
  try {
    const body = object(await requestCachedJSON(fetchImpl, url.toString(), { headers: headers(options.apiKey) }, options.signal, `search:${url.toString()}`))
    let papers = (Array.isArray(body?.data) ? body.data.map((item) => toPaper(item)).filter((item): item is PaperNavigatorPaper => item !== undefined) : [])
    if (options.sortBy === 'citations') papers.sort((a, b) => (b.citationCount ?? 0) - (a.citationCount ?? 0))
    if (options.sortBy === 'year') papers.sort((a, b) => (b.year ?? 0) - (a.year ?? 0))
    return { provider: 'PaperNavigator', query, papers: papers.slice(0, limit), source: 'SemanticScholar', elapsedMs: Date.now() - startedAt }
  } catch (error) {
    const arxivURL = new URL(endpoint(options.arxivURL, PAPER_NAVIGATOR_ARXIV_URL))
    arxivURL.searchParams.set('search_query', `all:${query}`)
    arxivURL.searchParams.set('start', '0')
    arxivURL.searchParams.set('max_results', String(limit))
    const body = await requestJSON(fetchImpl, arxivURL.toString(), { headers: { accept: 'application/atom+xml', 'user-agent': 'EvoResearch/0.1 (paper-navigator)' } }, options.signal)
    const papers = parseArxiv(typeof body === 'string' ? body : '', options.yearMin, options.yearMax).slice(0, limit)
    if (papers.length === 0) throw error
    return { provider: 'PaperNavigator', query, papers, source: 'Arxiv', fallback: true, warning: `Semantic Scholar 不可用，已回退到 arXiv：${error instanceof Error ? error.message : String(error)}`, elapsedMs: Date.now() - startedAt }
  }
}

async function paperGraph(options: PaperNavigatorRelatedOptions, direction: 'forward' | 'backward'): Promise<PaperNavigatorPaper[]> {
  const base = endpoint(options.s2URL, PAPER_NAVIGATOR_S2_URL)
  const nested = direction === 'forward' ? 'citingPaper' : 'citedPaper'
  const url = new URL(`${base}/paper/${encodeURIComponent(options.paperId)}/${direction === 'forward' ? 'citations' : 'references'}`)
  url.searchParams.set('fields', `${direction === 'forward' ? 'contexts,isInfluential,' : ''}${nested}.${CITATION_FIELDS}`)
  url.searchParams.set('limit', String(Math.min(limitOf(options.limit, 20), 100)))
  const body = object(await requestCachedJSON(options.fetchImpl ?? fetch, url.toString(), { headers: headers(options.apiKey) }, options.signal, `graph:${url.toString()}`))
  const data = Array.isArray(body?.data) ? body.data : []
  const papers: PaperNavigatorPaper[] = []
  for (const item of data) {
    const row = object(item)
    const paper = toPaper(row?.[nested])
    if (!paper) continue
    const contexts = Array.isArray(row?.contexts) ? row.contexts.length : 0
    const intents = Array.isArray(row?.intents) ? row.intents.filter((v): v is string => typeof v === 'string') : []
    paper.isInfluential = row?.isInfluential === true
    paper.citationContexts = contexts
    paper.citationIntents = intents
    paper.smartScore = (paper.isInfluential ? 1 : 0) + Math.min(contexts, 10) * 0.2 + Math.log1p(paper.citationCount ?? 0) * 0.05
    if (options.minCitations !== undefined && (paper.citationCount ?? 0) < options.minCitations) continue
    if (options.yearMin !== undefined && (paper.year ?? 0) < options.yearMin) continue
    if (options.yearMax !== undefined && (paper.year ?? 9999) > options.yearMax) continue
    papers.push(paper)
  }
  if (options.smart) papers.sort((a, b) => (b.smartScore ?? 0) - (a.smartScore ?? 0))
  else papers.sort((a, b) => (b.citationCount ?? 0) - (a.citationCount ?? 0))
  return papers.slice(0, limitOf(options.limit, 20))
}

export async function traversePaperNavigator(options: PaperNavigatorRelatedOptions): Promise<{ papers: PaperNavigatorPaper[]; direction: PaperNavigatorDirection }> {
  const direction = options.direction ?? 'forward'
  if (direction !== 'co-citation') return { papers: await paperGraph(options, direction), direction }
  const citers = await paperGraph({ ...options, direction: 'forward', limit: Math.min(limitOf(options.limit, 20) * 3, 50) }, 'forward')
  const counts = new Map<string, { paper: PaperNavigatorPaper; count: number }>()
  for (const citer of citers.slice(0, 10)) {
    if (!citer.paperId) continue
    try {
      const refs = await paperGraph({ ...options, paperId: citer.paperId, direction: 'backward', limit: 100, smart: false }, 'backward')
      for (const ref of refs) {
        if (!ref.paperId || ref.paperId === options.paperId) continue
        const current = counts.get(ref.paperId)
        if (current) current.count += 1
        else counts.set(ref.paperId, { paper: ref, count: 1 })
      }
    } catch { /* 单个 citer 失败不影响其他共引结果 */ }
  }
  return { direction, papers: [...counts.values()].sort((a, b) => b.count - a.count).slice(0, limitOf(options.limit, 15)).map((item) => ({ ...item.paper, relatedCount: item.count })) }
}

async function resolveS2Id(id: string, options: PaperNavigatorRecommendationOptions): Promise<string> {
  const value = id.trim()
  if (value) return value
  throw new Error('论文 ID 不能为空')
}

export async function recommendPaperNavigator(options: PaperNavigatorRecommendationOptions): Promise<PaperNavigatorPaper[]> {
  const positives = options.positiveIds.map((id) => id.trim()).filter(Boolean)
  if (positives.length === 0) throw new Error('至少需要一个正向论文 ID')
  const negatives = (options.negativeIds ?? []).map((id) => id.trim()).filter(Boolean)
  const limit = limitOf(options.limit, 10)
  const fetchImpl = options.fetchImpl ?? fetch
  const base = endpoint(options.recommendURL, PAPER_NAVIGATOR_RECOMMEND_URL)
  const s2Base = endpoint(options.s2URL, PAPER_NAVIGATOR_S2_URL)
  const resolve = async (id: string) => resolveS2Id(id, options)
  const pos = await Promise.all(positives.map(resolve))
  const neg = await Promise.all(negatives.map(resolve))
  const request = async (ids: string[]) => {
    const url = new URL(`${base}/papers/`)
    url.searchParams.set('fields', RELATED_FIELDS)
    url.searchParams.set('limit', String(Math.min(limit, 500)))
    const bodyPayload = { positivePaperIds: ids, ...(neg.length > 0 ? { negativePaperIds: neg } : {}) }
    const body = object(await requestCachedJSON(fetchImpl, url.toString(), { method: 'POST', headers: headers(options.apiKey), body: JSON.stringify(bodyPayload) }, options.signal, `recommend:${url.toString()}:${JSON.stringify(bodyPayload)}`))
    return (Array.isArray(body?.recommendedPapers) ? body.recommendedPapers.map((item) => toPaper(item)).filter((item): item is PaperNavigatorPaper => item !== undefined) : [])
  }
  const groups = options.perSeed === true && pos.length > 1 ? await Promise.all(pos.map((id) => request([id]))) : [await request(pos)]
  const seen = new Set<string>()
  const result: PaperNavigatorPaper[] = []
  for (const group of groups) for (const paper of group) {
    const key = paper.paperId ?? paper.title.toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    if (!key || seen.has(key)) continue
    seen.add(key); result.push(paper)
    if (result.length >= limit) return result
  }
  // Keep the variable in the call graph: S2 IDs are accepted as-is, while
  // the URL is intentionally reserved for future ID resolution variants.
  void s2Base
  return result
}

export async function searchPaperNavigatorSnippets(options: PaperNavigatorSnippetOptions): Promise<PaperNavigatorSnippet[]> {
  const query = options.query.trim()
  if (!query) throw new Error('片段检索词不能为空')
  const url = new URL(`${endpoint(options.s2URL, PAPER_NAVIGATOR_S2_URL)}/snippet/search`)
  url.searchParams.set('query', query)
  url.searchParams.set('limit', String(Math.min(limitOf(options.limit, 10), 100)))
  if (options.paperId?.trim()) url.searchParams.set('paperIds', options.paperId.trim())
  const body = object(await requestCachedJSON(options.fetchImpl ?? fetch, url.toString(), { headers: headers(options.apiKey) }, options.signal, `snippet:${url.toString()}`))
  return (Array.isArray(body?.data) ? body.data : []).map((value) => {
    const row = object(value)
    const snippet = object(row?.snippet)
    const paper = toPaper(row?.paper)
    const content = text(snippet?.text) ?? text(row?.text)
    if (!content) return undefined
    return { ...(paper ? { paper } : {}), text: content, ...(text(snippet?.snippetKind) ? { kind: text(snippet?.snippetKind) } : {}), ...(number(row?.score) !== undefined ? { score: number(row?.score) } : {}) }
  }).filter((item): item is PaperNavigatorSnippet => item !== undefined)
}
