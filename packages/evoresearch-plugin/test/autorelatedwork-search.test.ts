import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AutoRelatedWorkCacheStore,
  autoRelatedWorkBackoff,
  autoRelatedWorkCompleteness,
  autoRelatedWorkMatchAuthor,
  autoRelatedWorkMissingFields,
  autoRelatedWorkSemanticScholarQueries,
  buildAutoRelatedWorkScholarURL,
  parseAutoRelatedWorkBibtex,
  parseAutoRelatedWorkScholarAuthorResults,
  parseAutoRelatedWorkScholarResults,
  parseAutoRelatedWorkScholarTotalCount,
  recursiveCollectAutoRelatedWork,
  searchAutoRelatedWork,
  searchAutoRelatedWorkScholar,
  autoRelatedWorkTitlesMatch,
  enrichAutoRelatedWorkPapers,
  scoreAutoRelatedWorkRelevance,
  type AutoRelatedWorkPaper,
} from '../src/host/autorelatedwork-search.js'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { autoRelatedWorkAuthorPapersEvents, autoRelatedWorkPipelineEvents, enrichAutoRelatedWorkCompat, searchAutoRelatedWorkCompat } from '../src/host/autorelatedwork-compat.js'
import { autoRelatedWorkPaperFromRecord, cleanAutoRelatedWorkPaper } from '../src/host/autorelatedwork-search.js'

// AGENTS.md：临时产物统一放 .tmp-dev/。测试以相对 cwd 的 .tmp-dev 作为缓存目录，
// 在无此目录的干净 worktree 中运行前需先建立（与主仓库 .tmp-dev 约定一致）。
mkdirSync('.tmp-dev', { recursive: true })

function response(body: string, ok = true, status = 200): Response {
  return { ok, status, text: async () => body } as Response
}

function jsonResponse(value: unknown): Response {
  return response(JSON.stringify(value))
}

function fixturePaper(overrides: Partial<AutoRelatedWorkPaper> = {}): AutoRelatedWorkPaper {
  const authors = overrides.authors ?? ['Ada Lovelace']
  return {
    title: 'Fixture Paper',
    authors,
    externalUrls: [],
    additionalUrls: [],
    pdfUrls: [],
    institutions: [],
    authorScholarIds: {},
    authorsDetailed: overrides.authorsDetailed ?? authors.map((name) => ({ name })),
    authorProfiles: {},
    emails: [],
    references: [],
    fieldSources: {},
    ...overrides,
  }
}

test('AutoRelatedWork 解析 Google Scholar 题录骨架、引用和 PDF 链接', () => {
  const html = `
    <div class="gs_ri" data-cid="123">
      <h3 class="gs_rt"><a href="https://arxiv.org/abs/2401.00001">A Better Neural Renderer</a></h3>
      <div class="gs_a"><a href="https://scholar.google.com/citations?user=ABC">A Lovelace</a>, B Hopper - Imaging Journal, 2024</div>
      <div class="gs_rs">A useful abstract fragment …</div>
      <div class="gs_fl"><a href="https://scholar.google.com/scholar?cites=456">Cited by 12</a><a href="https://scholar.google.com/scholar?cluster=123">All 4 versions</a></div>
      <a href="https://arxiv.org/pdf/2401.00001.pdf">[PDF] arxiv.org</a>
    </div>
    <div class="gs_ri"><h3 class="gs_rt"><a href="https://example.test/paper">Second Paper</a></h3><div class="gs_a">C Author - Venue, 2023</div></div>`
  const papers = parseAutoRelatedWorkScholarResults(html)
  assert.equal(papers.length, 2)
  assert.equal(papers[0]?.title, 'A Better Neural Renderer')
  assert.deepEqual(papers[0]?.authors, ['A Lovelace'])
  assert.equal(papers[0]?.citedByCount, 12)
  assert.equal(papers[0]?.allVersionsCount, 4)
  assert.equal(papers[0]?.paperId, '456')
  assert.deepEqual(papers[0]?.pdfUrls, ['https://arxiv.org/pdf/2401.00001.pdf'])
  assert.equal(papers[0]?.authorScholarIds.ABC, 'A Lovelace')
})

test('AutoRelatedWork BibTeX 和标题重叠校验保留完整作者/题名', () => {
  const parsed = parseAutoRelatedWorkBibtex('@article{x, title={Deep {Learning} for Imaging}, author={Lovelace, Ada and Hopper, Grace}, journal={Science}, year={2024}, doi={10.1234/example}}')
  assert.equal(parsed.title, 'Deep Learning for Imaging')
  assert.deepEqual(parsed.authors, ['Lovelace, Ada', 'Hopper, Grace'])
  assert.equal(parsed.venue, 'Science')
  assert.equal(parsed.doi, '10.1234/example')
  assert.equal(autoRelatedWorkTitlesMatch('Attention Is All You Need', 'Attention is all you need for machine translation'), true)
  assert.equal(autoRelatedWorkTitlesMatch('Deep Residual Learning', 'Completely Different Topic'), false)
})

test('AutoRelatedWork 搜索入口支持测试注入、缓存前的 Scholar 直连与关闭补全', async () => {
  let calls = 0
  const html = '<div class="gs_ri"><h3 class="gs_rt"><a href="https://example.test/paper">Neural Imaging Paper</a></h3><div class="gs_a">Ada Lovelace - Journal, 2024</div></div>'
  const result = await searchAutoRelatedWork({
    query: 'Neural Imaging Paper',
    limit: 3,
    config: { scholarURL: 'https://scholar.google.com', enrich: false, delayMs: 0 },
    fetchImpl: async (input) => { calls += 1; assert.match(String(input), /scholar\.google\.com\/scholar/); return response(html) },
  })
  assert.equal(calls, 1)
  assert.equal(result.provider, 'AutoRelatedWork')
  assert.equal(result.sources[0]?.title, 'Neural Imaging Paper')
  assert.equal(result.sources[0]?.sourceType, 'academic')
})

test('AutoRelatedWork 独立搜索严格复刻 scholar_search 的请求边界', async () => {
  const urls: string[] = []
  const html = '<div class="gs_ri"><h3 class="gs_rt"><a href="https://example.test/paper">Standalone Boundary Paper</a></h3><div class="gs_a">Ada Lovelace - Journal, 2024</div></div>'
  await searchAutoRelatedWork({
    query: 'Standalone Boundary Paper', limit: 1,
    config: { enrich: true, fetchBibtex: false, fetchArxiv: false, fetchArxivHTML: false, fetchSemanticScholar: false, deepseekEnrich: false, recursiveDepth: 0, delayMs: 0 },
    fetchImpl: async (input) => { urls.push(String(input)); return input.toString().includes('/scholar?') ? response(html) : jsonResponse({}) },
  })
  assert.equal(urls.length, 1)
  assert.match(urls[0] ?? '', /scholar\.google\.com\/scholar/)
  assert.equal(urls.some((url) => /crossref|openalex|dblp|semanticscholar|unpaywall/i.test(url)), false)
})

test('AutoRelatedWork 独立入口的查询缓存命中不会重复请求 Scholar', async () => {
  const dir = mkdtempSync(join('.tmp-dev', 'autorelatedwork-query-cache-test-'))
  try {
    const cacheFile = join(dir, 'queries.json')
    let calls = 0
    const html = '<div class="gs_ri"><h3 class="gs_rt"><a href="https://example.test/paper">Cached Boundary Paper</a></h3><div class="gs_a">Ada Lovelace - Journal, 2024</div></div>'
    const input = {
      query: 'Cached Boundary Paper', limit: 1,
      config: { enrich: false, cacheFile, delayMs: 0 },
      fetchImpl: async () => { calls += 1; return response(html) },
    }
    const first = await searchAutoRelatedWork(input)
    const second = await searchAutoRelatedWork(input)
    assert.equal(calls, 1)
    assert.deepEqual(second.sources.map((source) => source.title), first.sources.map((source) => source.title))
    assert.equal(existsSync(cacheFile), true)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('AutoRelatedWork cacheEnabled=false 时不读写查询缓存或论文缓存', async () => {
  const dir = mkdtempSync(join('.tmp-dev', 'autorelatedwork-cache-disabled-test-'))
  try {
    const cacheFile = join(dir, 'queries.json')
    const html = '<div class="gs_ri"><h3 class="gs_rt"><a href="https://example.test/paper">No Cache Paper</a></h3><div class="gs_a">Ada Lovelace - Journal, 2024</div></div>'
    await searchAutoRelatedWork({
      query: 'No Cache Paper', limit: 1,
      config: { enrich: false, cacheFile, cacheEnabled: false, delayMs: 0 }, dataRoot: dir,
      fetchImpl: async () => response(html),
    })
    assert.equal(existsSync(cacheFile), false)
    assert.equal(existsSync(join(dir, 'plugins')), false)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('AutoRelatedWork 完整模式会获取 BibTeX，并接入 arXiv 摘要/机构/邮箱', async () => {
  const calls: string[] = []
  const scholarHTML = `<div class="gs_ri" data-cid="CID-1"><h3 class="gs_rt"><a href="https://arxiv.org/abs/2401.00001">Neural Imaging Paper</a></h3><div class="gs_a">A Lovelace - Journal, 2024</div></div>`
  const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>http://arxiv.org/abs/2401.00001</id><title>Neural Imaging Paper</title><summary>Complete abstract from arXiv with enough detail for the result.</summary><published>2024-01-01T00:00:00Z</published><author><name>Ada Lovelace</name></author><author><name>Grace Hopper</name></author></entry></feed>`
  const arxivHTML = `<div class="ltx_authors"><span class="ltx_personname">Ada Lovelace<sup>1*</sup></span><span class="ltx_personname">Grace Hopper<sup>1</sup></span><span class="ltx_affiliation">1 University of Example</span><a href="mailto:ada@example.edu">email</a></div><div class="ltx_abstract">Abstract</div>`
  const bib = '@article{x, title={Neural Imaging Paper}, author={Lovelace, Ada and Hopper, Grace}, journal={Imaging Journal}, year={2024}, doi={10.1234/neural}}'
  const result = await searchAutoRelatedWork({
    query: 'Neural Imaging Paper',
    limit: 1,
    config: { delayMs: 0, maxRetries: 1, maxEnrichmentRounds: 1, fetchBibtex: true, fetchArxiv: true, fetchArxivHTML: true },
    fetchImpl: async (input) => {
      const url = String(input); calls.push(url)
      if (url.includes('output=cite')) return response('<a href="https://scholar.google.com/scholar.bib?cid=CID-1">BibTeX</a>')
      if (url.includes('scholar.bib')) return response(bib)
      if (url.includes('export.arxiv.org/api')) return response(atom)
      if (url.includes('arxiv.org/html/')) return response(arxivHTML)
      if (url.includes('/scholar?')) return response(scholarHTML)
      return response('{}')
    },
  })
  const source = result.sources[0]!
  assert.equal(source.bibtex, bib)
  assert.equal(source.title, 'Neural Imaging Paper')
  assert.deepEqual(source.authors, ['Lovelace, Ada', 'Hopper, Grace'])
  assert.equal(source.venue, 'Imaging Journal')
  assert.equal(source.year, 2024)
  assert.equal(source.doi, '10.1234/neural')
  assert.equal(source.authorsTruncated, undefined)
  assert.equal(source.fieldSources?.title, 'BibTeX')
  assert.equal(source.fieldSources?.authors, 'BibTeX')
  assert.equal(source.fieldSources?.venue, 'BibTeX')
  assert.equal(source.fieldSources?.year, 'BibTeX')
  assert.equal(source.fieldSources?.doi, 'BibTeX')
  assert.equal(source.abstract, 'Complete abstract from arXiv with enough detail for the result.')
  assert.deepEqual(source.emails, ['ada@example.edu'])
  assert.ok(source.institutions?.includes('University of Example'))
  assert.ok(calls.some((url) => url.includes('output=cite')))
  assert.ok(calls.some((url) => url.includes('export.arxiv.org/api')))
})

test('AutoRelatedWork 的 recursiveDepth 会按 Semantic Scholar 引用关系扩展并保留 references', async () => {
  const seedHTML = '<div class="gs_ri"><h3 class="gs_rt"><a href="https://example.test/seed">Seed Paper</a></h3><div class="gs_a">Ada Lovelace - Venue, 2024</div></div>'
  const result = await searchAutoRelatedWork({
    query: 'Seed Paper',
    limit: 1,
    // 与 auto-related-work recursive_search.py 一致：depth=1 仅保留种子，
    // depth=2 才展开一层引用。
    config: { enrich: false, delayMs: 0, recursiveDepth: 2, recursiveWidth: 1, recursiveMaxTotal: 3 },
    fetchImpl: async (input) => {
      const url = String(input)
      if (url.includes('/scholar?')) return response(seedHTML)
      if (url.includes('/paper/search')) return response(JSON.stringify({ data: [{ title: 'Seed Paper', paperId: 'seed-id' }] }))
      if (url.includes('/references')) return response(JSON.stringify({ data: [{ citedPaper: { title: 'Referenced Paper', year: 2020, externalIds: { DOI: '10.1234/ref' }, authors: [{ name: 'Grace Hopper' }], citationCount: 8 } }] }))
      return response('{}')
    },
  })
  assert.equal(result.sources.length, 2)
  assert.equal(result.sources[0]?.references?.[0]?.title, 'Referenced Paper')
  assert.equal(result.sources[1]?.doi, '10.1234/ref')
})

test('AutoRelatedWork 复刻 Scholar 的总数、原始字段和完整 URL 元数据', () => {
  const html = `<div class="gs_ri" data-cid="CID-X"><h3 class="gs_rt"><a href="https://example.test/paper">Exact Paper</a></h3><div class="gs_a"><a href="https://scholar.google.com/citations?user=U1">Ada Lovelace</a> - Journal, 2024</div><div class="gs_rs">Snippet</div><div class="gs_fl"><a href="/scholar?cites=42">Cited by 12</a><a href="/scholar?cluster=43">All 4 versions</a><a href="/scholar?q=related:42:scholar.google.com/">Related articles</a><a href="https://scholar.googleusercontent.com/view?a=1">[HTML]</a></div></div><div>About 12,345 results</div>`
  const paper = parseAutoRelatedWorkScholarResults(html)[0]!
  assert.equal(parseAutoRelatedWorkScholarTotalCount(html), 12345)
  assert.equal(paper.dataCid, 'CID-X')
  assert.equal(paper.paperId, '42')
  assert.deepEqual(paper.externalUrls, ['https://example.test/paper'])
  assert.equal(paper.citedBy?.count, 12)
  assert.equal(paper.allVersions?.count, 4)
  assert.equal(paper.relatedArticlesURL, 'https://scholar.google.com/scholar?q=related:42:scholar.google.com/')
  assert.deepEqual(paper.viewHTMLURLs, ['https://scholar.googleusercontent.com/view?a=1'])
})

test('AutoRelatedWork 复刻原始纯逻辑：作者匹配、完整性和缺失字段', () => {
  assert.equal(autoRelatedWorkMatchAuthor('SR Choi', ['Choi, Sanghyuk Roy']), 'Choi, Sanghyuk Roy')
  assert.equal(autoRelatedWorkMatchAuthor('Wang, Zhendong', ['Z Wang']), 'Z Wang')
  assert.equal(autoRelatedWorkMatchAuthor('Kaiming He', ['Jian Sun']), undefined)
  const paper = { title: 'T', authors: [{ name: 'A', affiliations: ['X'] }, { name: 'B' }], abstract: 'x '.repeat(200), institutions: ['X'], venue: 'V', doi: '10.1234/x', year: 2024, bibtex: '@article{x}' }
  assert.ok(autoRelatedWorkCompleteness(paper) > 0.8)
  assert.deepEqual(autoRelatedWorkMissingFields({}), ['title', 'authors', 'abstract', 'institutions', 'venue', 'doi', 'year', 'bibtex'])
})

test('AutoRelatedWork 复刻 Scholar 搜索类型、分页和作者结果', async () => {
  assert.equal(new URL(buildAutoRelatedWorkScholarURL('https://scholar.google.com', 'general', 'A paper')).searchParams.get('q'), 'A paper')
  assert.match(buildAutoRelatedWorkScholarURL('https://scholar.google.com', 'cites', '', '123'), /cites=123/)
  assert.match(buildAutoRelatedWorkScholarURL('https://scholar.google.com', 'related', '', '123'), /q=related%3A123%3Ascholar.google.com%2F/)
  assert.match(buildAutoRelatedWorkScholarURL('https://scholar.google.com', 'author', 'Ada Lovelace'), /view_op=search_authors/)
  const authorHTML = `<div class="gsc_1usr"><h3><a href="/citations?user=ABC">Ada Lovelace</a></h3><div class="gsc_oai_aff">Example University</div><div class="gsc_oai_int">Computing</div><div class="gsc_oai_cby">Cited by 123</div></div>`
  assert.deepEqual(parseAutoRelatedWorkScholarAuthorResults(authorHTML), [{ name: 'Ada Lovelace', scholarId: 'ABC', affiliation: 'Example University', interests: 'Computing', citedBy: 123 }])
  let calls = 0
  const result = await searchAutoRelatedWorkScholar({ query: 'paper', searchType: 'general', maxResults: 2, config: { delayMs: 0 }, fetchImpl: async (input) => {
    calls += 1
    const url = String(input)
    const start = new URL(url).searchParams.get('start')
    const title = start === '2' ? 'Second' : 'First'
    return response(`<div class="gs_ri"><h3 class="gs_rt"><a href="https://example.test/${title}">${title}</a></h3><div class="gs_a">Author - Venue, 2024</div></div><div>About 2 results</div>`)
  } })
  assert.equal(calls, 1)
  assert.equal(result.papers.length, 1)
  assert.equal(result.total, 2)
})

test('AutoRelatedWork Semantic Scholar 查询回退和递归 depth/edge 语义与原版一致', () => {
  assert.deepEqual(autoRelatedWorkSemanticScholarQueries('A very long paper title for neural rendering'), ['A very long paper title for neural rendering', 'A very long paper title', 'very'])
})

test('AutoRelatedWork 递归收集保留层级、边并支持 fetchRefs=false', async () => {
  const seed = parseAutoRelatedWorkScholarResults('<div class="gs_ri"><h3 class="gs_rt"><a href="https://example.test/seed">Seed</a></h3><div class="gs_a">A - V, 2024</div></div>')[0]!
  const child = { ...seed, title: 'Child', authors: ['B'], authorsDetailed: [{ name: 'B' }], externalUrls: [], references: [], fieldSources: {}, depth: undefined }
  seed.references = [{ title: 'Child', authors: ['B'], source: 'fixture' }]
  const exact = await recursiveCollectAutoRelatedWork([seed], { query: 'Seed', fetchRefs: false, depth: 2, width: 1, maxTotal: 3, config: {}, fetchImpl: async () => response('{}') })
  assert.deepEqual(exact.papers.map((paper) => [paper.title, paper.depth]), [['Seed', 0], ['Child', 1]])
  assert.deepEqual(exact.edges, [['seed', 'child']])
  assert.equal(child.title, 'Child')
})

test('AutoRelatedWork 递归 maxTotal 达到上限时不产生悬空引用边', async () => {
  const seed = fixturePaper({ title: 'Root Reference Paper', rawReferences: [
    { title: 'First Reference', authors: ['A'], citedByCount: 5, source: 'fixture' },
    { title: 'Second Reference', authors: ['B'], citedByCount: 4, source: 'fixture' },
  ] })
  const result = await recursiveCollectAutoRelatedWork([seed], { query: 'Root Reference Paper', depth: 2, width: 2, maxTotal: 2, fetchRefs: false, config: {}, fetchImpl: async () => response('{}') })
  assert.deepEqual(result.papers.map((paper) => paper.title), ['Root Reference Paper', 'First Reference'])
  assert.deepEqual(result.edges, [['rootreferencepaper', 'firstreference']])
  const keys = new Set(result.papers.map((paper) => paper.title.toLocaleLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 60)))
  assert.equal(result.edges.every(([parent, child]) => keys.has(parent) && keys.has(child)), true)
})

test('AutoRelatedWork cache store 保留 complete/partial、作者索引、统计和 clear 语义', () => {
  mkdirSync('.tmp-dev', { recursive: true })
  const dir = mkdtempSync(join('.tmp-dev', 'autorelatedwork-cache-test-'))
  try {
    const cache = new AutoRelatedWorkCacheStore(join(dir, 'cache.json'))
    assert.equal(cache.putPaper({ title: 'Partial', enrichStage: 'wave1' }), true)
    assert.equal(cache.putPaper({ title: 'Complete', enrichStage: 'done' }), true)
    assert.equal(cache.putPaper({ title: 'Complete', enrichStage: 'search' }), false)
    assert.equal(cache.putAuthor({ name: 'Ada Lovelace', scholarId: 'ABC' }), true)
    assert.equal(cache.getAuthorByScholarId('ABC')?.name, 'Ada Lovelace')
    assert.equal(cache.stats().papersPartial, 1)
    assert.equal(cache.getPartialPapers(1)[0]?.title, 'Partial')
    cache.clear()
    assert.equal(cache.stats().papers, 0)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('AutoRelatedWork author-papers SSE 保持原 Flask 的 progress → profile → partial → result 顺序', async () => {
  const events: Array<{ event: string; data: Record<string, unknown> }> = []
  for await (const event of autoRelatedWorkAuthorPapersEvents({
    name: 'Ada Lovelace', ssAuthorId: 'SS-1', maxResults: 1, deepseekEnrich: false,
    config: { maxEnrichmentRounds: 1, fetchSemanticScholar: false, fetchArxiv: false, fetchArxivHTML: false, delayMs: 0 },
    fetchImpl: async (input) => {
      const url = String(input)
      if (url.includes('/author/SS-1/papers')) return response(JSON.stringify({ data: [{ title: 'A Paper', year: 2024, authors: [{ name: 'Ada Lovelace' }] }] }))
      return response('{}')
    },
  })) events.push(event)
  assert.deepEqual(events.map((event) => event.event), ['progress', 'author_profile', 'progress', 'partial_result', 'progress', 'progress', 'progress', 'result'])
  assert.equal(events[1]?.data.profile && (events[1].data.profile as Record<string, unknown>).scholar_id, null)
  assert.equal((events.at(-1)?.data.author_profile as Record<string, unknown>).ss_author_id, 'SS-1')
})

test('AutoRelatedWork 从原 Flask clean schema 重新装载时保留 url、引用数和版本信息', () => {
  const paper = autoRelatedWorkPaperFromRecord({
    title: 'Round Trip', authors: [{ name: 'Ada Lovelace' }], url: 'https://example.test/paper', cited_count: 12,
    versions: { count: 4, url: 'https://scholar.google.com/scholar?cluster=1&hl=fr' }, year: 2024,
  })
  const clean = cleanAutoRelatedWorkPaper(paper)
  assert.equal(clean.url, 'https://example.test/paper')
  assert.equal(clean.cited_count, 12)
  assert.deepEqual(clean.versions, { count: 4, url: 'https://scholar.google.com/scholar?cluster=1&hl=en' })
})

test('AutoRelatedWork clean schema 保留 Python 的 authors_str-only 回退', () => {
  const clean = cleanAutoRelatedWorkPaper({ title: 'No Parsed Authors', authors_str: 'A, B - Venue, 2024 - example.org' })
  assert.equal((clean.authors as Array<Record<string, unknown>>)[0]?.name, 'A, B - Venue, 2024 - example.org')
})

test('AutoRelatedWork clean schema 的固定字段与 Python null 语义一致', () => {
  const clean = cleanAutoRelatedWorkPaper({})
  const expected = ['title', 'authors', 'year', 'paper_id', 'abstract', 'venue', 'institutions', 'emails', 'url', 'domain', 'additional_urls', 'doi', 'cited_count', 'cited_by_url', 'versions', 'related_articles_url', 'view_html_urls', 'pdf_urls', 'bibtex', '_author_scholar_ids', '_field_sources']
  assert.deepEqual(Object.keys(clean).sort(), expected.sort())
  assert.equal(clean.authors && (clean.authors as Array<Record<string, unknown>>)[0]?.name, 'Unknown')
  assert.equal(clean.cited_by_url, null)
})

test('AutoRelatedWork clean schema 将作者 citation_stats 保持为原版 snake_case', () => {
  const clean = cleanAutoRelatedWorkPaper({
    title: 'Author Stats',
    authors: [{ name: 'Ada Lovelace', citation_stats: { citations_all: 120, h_index_all: 8 }, scholar_id: 'ABC' }],
  })
  const author = (clean.authors as Array<Record<string, unknown>>)[0]!
  assert.deepEqual(author.citation_stats, { citations_all: 120, h_index_all: 8 })
  assert.equal(author.scholar_id, 'ABC')
})

test('AutoRelatedWork Crossref/OpenAlex 只补已有作者机构，不替换作者列表', async () => {
  const crossrefPaper = fixturePaper({ title: 'Crossref Fixture', authors: ['Ada Lovelace', 'Grace Hopper'], authorsDetailed: [{ name: 'Ada Lovelace' }, { name: 'Grace Hopper' }] })
  const openAlexPaper = fixturePaper({ title: 'OpenAlex Fixture', authors: ['Ada Lovelace', 'Grace Hopper'], authorsDetailed: [{ name: 'Ada Lovelace' }, { name: 'Grace Hopper' }] })
  const fetchImpl = async (input: string | URL | Request): Promise<Response> => {
    const url = String(input)
    if (url.includes('api.crossref.org/works?query.title=Crossref')) return jsonResponse({ message: { items: [{ DOI: '10.1234/crossref', title: ['Crossref Fixture'], 'container-title': ['Venue'], author: [{ given: 'Alan', family: 'Turing', affiliation: [{ name: 'Unrelated Institute' }] }] }] } })
    if (url.includes('api.openalex.org/works?') && url.includes('OpenAlex')) return jsonResponse({ results: [{ title: 'OpenAlex Fixture', doi: 'https://doi.org/10.1234/openalex', abstract_inverted_index: Object.fromEntries('This is a sufficiently long abstract fixture that should be restored from OpenAlex metadata for testing purposes'.split(' ').map((word, index) => [word, [index]])), primary_location: { source: { display_name: 'Venue' } }, authorships: [{ author: { display_name: 'Alan Turing' }, institutions: [{ display_name: 'Unrelated Institute' }] }] }] })
    return jsonResponse({})
  }
  await enrichAutoRelatedWorkPapers([crossrefPaper, openAlexPaper], { query: 'fixture', config: { maxEnrichmentRounds: 1, fetchSemanticScholar: false, fetchUnpaywall: false, deepseekEnrich: false }, fetchImpl })
  assert.deepEqual(crossrefPaper.authors, ['Ada Lovelace', 'Grace Hopper'])
  assert.deepEqual(openAlexPaper.authors, ['Ada Lovelace', 'Grace Hopper'])
  assert.equal(crossrefPaper.authorsDetailed.some((author) => author.name === 'Alan Turing'), false)
  assert.equal(openAlexPaper.authorsDetailed.some((author) => author.name === 'Alan Turing'), false)
})

test('AutoRelatedWork DBLP 按原顺序追加缺失作者而不重排已有作者', async () => {
  const paper = fixturePaper({ title: 'DBLP Fixture', authors: ['Ada Lovelace'], authorsDetailed: [{ name: 'Ada Lovelace' }] })
  const fetchImpl = async (input: string | URL | Request): Promise<Response> => {
    const url = String(input)
    if (url.includes('dblp.org/search/publ/api')) return jsonResponse({ result: { hits: { hit: [{ info: { title: 'DBLP Fixture', venue: 'Conference', authors: { author: [{ text: 'Ada Lovelace' }, { text: 'Grace Hopper' }, { text: 'Alan Turing' }] }, doi: '10.1234/dblp' } }] } } })
    return jsonResponse({})
  }
  await enrichAutoRelatedWorkPapers([paper], { query: 'fixture', config: { maxEnrichmentRounds: 1, fetchSemanticScholar: false, fetchUnpaywall: false, deepseekEnrich: false }, fetchImpl })
  assert.deepEqual(paper.authors, ['Ada Lovelace', 'Grace Hopper', 'Alan Turing'])
  assert.deepEqual(paper.authorsDetailed.map((author) => author.name), ['Ada Lovelace', 'Grace Hopper', 'Alan Turing'])
})

test('AutoRelatedWork Semantic Scholar 的摘要长度门槛与原版一致', async () => {
  const called: string[] = []
  const fetchImpl = async (input: string | URL | Request): Promise<Response> => {
    const url = String(input); called.push(url)
    if (url.includes('semanticscholar.org/graph/v1/paper/search')) return jsonResponse({ data: [{ title: 'Semantic Fixture', abstract: 'Semantic Scholar abstract', authors: [{ name: 'Ada Lovelace' }] }] })
    return jsonResponse({})
  }
  const short = fixturePaper({ title: 'Semantic Fixture' })
  await enrichAutoRelatedWorkPapers([short], { query: 'fixture', config: { maxEnrichmentRounds: 1, fetchSemanticScholar: true, fetchUnpaywall: false, deepseekEnrich: false }, fetchImpl })
  assert.equal(short.abstract, 'Semantic Scholar abstract')
  assert.equal(called.some((url) => url.includes('semanticscholar.org')), true)

  called.length = 0
  const long = fixturePaper({ title: 'Semantic Fixture', abstract: 'x'.repeat(201) })
  await enrichAutoRelatedWorkPapers([long], { query: 'fixture', config: { maxEnrichmentRounds: 1, fetchSemanticScholar: true, fetchUnpaywall: false, deepseekEnrich: false }, fetchImpl })
  assert.equal(called.some((url) => url.includes('semanticscholar.org')), false)
})

test('AutoRelatedWork Unpaywall 未配置 email 时使用原版默认值', async () => {
  const urls: string[] = []
  const paper = fixturePaper({ title: 'Unpaywall Fixture', doi: '10.1234/unpaywall' })
  const fetchImpl = async (input: string | URL | Request): Promise<Response> => {
    const url = String(input); urls.push(url)
    if (url.includes('unpaywall.org/v2/')) return jsonResponse({ is_oa: true, oa_locations: [{ url_for_pdf: 'https://example.test/paper.pdf' }] })
    return jsonResponse({})
  }
  await enrichAutoRelatedWorkPapers([paper], { query: 'fixture', config: { maxEnrichmentRounds: 1, fetchSemanticScholar: false, fetchUnpaywall: true, deepseekEnrich: false }, fetchImpl })
  const unpaywallURL = urls.find((url) => url.includes('unpaywall.org/v2/'))
  assert.match(unpaywallURL ?? '', /email=scholar.tool.user%40gmail.com/)
  assert.deepEqual(paper.pdfUrls, ['https://example.test/paper.pdf'])
})

test('AutoRelatedWork DeepSeek 两个阶段都尊重原版覆盖率跳过条件', async () => {
  const urls: string[] = []
  const paper = fixturePaper({ title: 'DeepSeek Skip Fixture', authorsDetailed: [{ name: 'Ada Lovelace', affiliations: ['Example University'] }], institutions: ['Example University'] })
  const fetchImpl = async (input: string | URL | Request): Promise<Response> => { urls.push(String(input)); return jsonResponse({}) }
  await enrichAutoRelatedWorkPapers([paper], { query: 'fixture', config: { maxEnrichmentRounds: 1, fetchSemanticScholar: false, fetchUnpaywall: false, deepseekEnrich: true, deepseekAuthorFallback: true }, credentials: { deepseekApiKey: 'fixture-key', deepseekURL: 'https://deepseek.test/v1/chat/completions' }, fetchImpl })
  assert.equal(urls.some((url) => url.includes('deepseek.test')), false)
})

test('AutoRelatedWork DeepSeek 相关度评分兼容完整 JSON 与截断 score 回退', async () => {
  const paper = fixturePaper({ title: 'Relevance Fixture' })
  const success = await scoreAutoRelatedWorkRelevance(paper, 'relevance fixture', {
    query: 'relevance fixture', credentials: { deepseekApiKey: 'fixture-key', deepseekURL: 'https://deepseek.test/v1/chat/completions' },
    fetchImpl: async () => jsonResponse({ choices: [{ message: { content: '{"score": 92, "reason": "高度相关"}' } }] }),
  })
  assert.deepEqual(success, { score: 92, reason: '高度相关' })
  const truncated = await scoreAutoRelatedWorkRelevance(paper, 'relevance fixture', {
    query: 'relevance fixture', credentials: { deepseekApiKey: 'fixture-key', deepseekURL: 'https://deepseek.test/v1/chat/completions' },
    fetchImpl: async () => jsonResponse({ choices: [{ message: { content: '{"score": 71' } }] }),
  })
  assert.deepEqual(truncated, { score: 71, reason: '' })
})

test('AutoRelatedWork `/api/enrich` 不调用 Semantic Scholar、Unpaywall 或第二阶段 DeepSeek', async () => {
  const urls: string[] = []
  const paper = fixturePaper({ title: 'Compat Enrich Fixture', authors: ['Ada Lovelace'], authorsDetailed: [{ name: 'Ada Lovelace' }] })
  const fetchImpl = async (input: string | URL | Request): Promise<Response> => {
    const url = String(input); urls.push(url)
    if (url.includes('api.crossref.org/works?query.title=')) return jsonResponse({ message: { items: [{ DOI: '10.1234/compat', title: ['Compat Enrich Fixture'], 'container-title': ['Venue'], author: [] }] } })
    if (url.includes('api.openalex.org/works?')) return jsonResponse({ results: [{ title: 'Compat Enrich Fixture', abstract_inverted_index: Object.fromEntries('This is a sufficiently long compatibility abstract fixture for the endpoint test'.split(' ').map((word, index) => [word, [index]])), primary_location: { source: { display_name: 'Venue' } }, authorships: [] }] })
    if (url.includes('deepseek.test')) return jsonResponse({ choices: [{ message: { content: '{"affiliations":{},"emails":[],"doi":""}' } }] })
    return jsonResponse({})
  }
  await enrichAutoRelatedWorkCompat({ papers: [paper as unknown as Record<string, unknown>], rounds: 1, config: { fetchSemanticScholar: true, fetchUnpaywall: true, deepseekEnrich: true, deepseekAuthorFallback: true }, credentials: { deepseekApiKey: 'fixture-key', deepseekURL: 'https://deepseek.test/v1/chat/completions' }, fetchImpl })
  assert.equal(urls.some((url) => url.includes('semanticscholar.org')), false)
  assert.equal(urls.some((url) => url.includes('unpaywall.org')), false)
  assert.equal(urls.filter((url) => url.includes('deepseek.test')).length, 1)
})

test('AutoRelatedWork 完整 pipeline 严格经过 search → Wave1 → Wave2 → References → done', async () => {
  mkdirSync('.tmp-dev', { recursive: true })
  const dir = mkdtempSync(join('.tmp-dev', 'autorelatedwork-pipeline-test-'))
  try {
    const calls: string[] = []
    const scholarHTML = '<div class="gs_ri"><h3 class="gs_rt"><a href="https://example.test/paper">Pipeline Paper</a></h3><div class="gs_a">Ada Lovelace - Journal, 2024</div></div>'
    const events: Array<{ event: string; data: Record<string, unknown> }> = []
    for await (const event of autoRelatedWorkPipelineEvents({
      query: 'Pipeline Paper',
      maxResults: 1,
      deepseekEnrich: false,
      config: { fetchArxiv: false, fetchArxivHTML: false, fetchBibtex: false, fetchSemanticScholar: false, fetchUnpaywall: false, delayMs: 0, maxRetries: 1 },
      dataRoot: dir,
      fetchImpl: async (input) => {
        const url = String(input)
        calls.push(url)
        if (url.includes('scholar.google.com/scholar')) return response(scholarHTML)
        if (url.includes('api.crossref.org')) return jsonResponse({ message: { items: [] } })
        if (url.includes('api.openalex.org')) return jsonResponse({ results: [] })
        if (url.includes('dblp.org')) return jsonResponse({ result: { hits: { hit: [] } } })
        if (url.includes('api.semanticscholar.org')) return jsonResponse({ data: [] })
        return jsonResponse({})
      },
    })) events.push(event)

    assert.ok(calls.some((url) => url.includes('scholar.google.com/scholar')))
    assert.ok(calls.some((url) => url.includes('api.crossref.org')))
    assert.ok(calls.some((url) => url.includes('api.openalex.org')))
    assert.deepEqual(events.filter((event) => event.event === 'partial_result').map((event) => event.data.search_info && (event.data.search_info as Record<string, unknown>).status), ['search_done', 'Wave1', 'Wave2', 'References'])
    assert.equal(events.at(-1)?.event, 'result')
    assert.equal(events.some((event) => event.event === 'error'), false)
    const result = events.at(-1)!.data
    assert.equal('report' in result, false)
    const paper = (result.papers as Array<Record<string, unknown>>)[0]!
    assert.equal(paper._enrich_stage, 'done')
    assert.equal(paper._cache_complete, true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('AutoRelatedWork 兼容搜索的阶段缓存停在 Wave2，且 cacheEnabled=false 完全禁用', async () => {
  const dir = mkdtempSync(join('.tmp-dev', 'autorelatedwork-compat-cache-test-'))
  const scholarHTML = '<div class="gs_ri"><h3 class="gs_rt"><a href="https://example.test/paper">Compat Cache Paper</a></h3><div class="gs_a">Ada Lovelace - Journal, 2024</div></div>'
  const fetchImpl = async (input: string | URL | Request): Promise<Response> => {
    const url = String(input)
    if (url.includes('scholar.google.com/scholar')) return response(scholarHTML)
    if (url.includes('api.crossref.org')) return jsonResponse({ message: { items: [] } })
    if (url.includes('api.openalex.org')) return jsonResponse({ results: [] })
    if (url.includes('dblp.org')) return jsonResponse({ result: { hits: { hit: [] } } })
    return jsonResponse({})
  }
  try {
    await searchAutoRelatedWorkCompat({
      query: 'Compat Cache Paper', maxResults: 1, dataRoot: dir,
      config: { fetchArxiv: false, fetchArxivHTML: false, fetchBibtex: false, fetchSemanticScholar: false, fetchUnpaywall: false, deepseekEnrich: false, maxEnrichmentRounds: 1, delayMs: 0 },
      fetchImpl,
    })
    const cache = new AutoRelatedWorkCacheStore(join(dir, 'plugins', 'cache', 'scholar_cache.db'))
    try {
      const cached = cache.getPaper('Compat Cache Paper')
      assert.equal(cached?._enrich_stage, 'wave2')
      assert.equal(cached?._cache_complete, false)
    } finally { cache.close() }

    const disabled = mkdtempSync(join('.tmp-dev', 'autorelatedwork-compat-cache-disabled-'))
    try {
      await searchAutoRelatedWorkCompat({
        query: 'Compat Cache Disabled', maxResults: 1, dataRoot: disabled, fast: true,
        config: { cacheEnabled: false, delayMs: 0 }, fetchImpl: async () => response(scholarHTML.replace('Compat Cache Paper', 'Compat Cache Disabled')),
      })
      assert.equal(existsSync(join(disabled, 'plugins')), false)
    } finally { rmSync(disabled, { recursive: true, force: true }) }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
