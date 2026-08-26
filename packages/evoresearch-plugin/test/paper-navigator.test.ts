import test from 'node:test'
import assert from 'node:assert/strict'
import { recommendPaperNavigator, searchPaperNavigator, searchPaperNavigatorSnippets, traversePaperNavigator } from '../src/host/paper-navigator.js'

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    text: async () => JSON.stringify(body),
    headers: new Headers({ 'content-type': 'application/json' }),
  } as Response
}

function paper(paperId: string, title = `Paper ${paperId}`): Record<string, unknown> {
  return { paperId, title, authors: [{ name: 'Ada Lovelace' }], year: 2024, citationCount: 12, isOpenAccess: true, openAccessPdf: { url: `https://example.test/${paperId}.pdf` } }
}

test('Paper Navigator uses Semantic Scholar semantic search and maps metadata', async () => {
  const requests: URL[] = []
  const result = await searchPaperNavigator({
    query: 'neural operators for inverse problems', limit: 3, openAccessOnly: true,
    fetchImpl: async (input) => {
      const url = new URL(String(input)); requests.push(url)
      return jsonResponse({ data: [paper('s2-1', 'Neural operators for inverse problems')] })
    },
  })
  assert.equal(result.source, 'SemanticScholar')
  assert.equal(result.papers[0]?.title, 'Neural operators for inverse problems')
  assert.equal(result.papers[0]?.pdfUrl, 'https://example.test/s2-1.pdf')
  assert.equal(requests[0]?.pathname, '/graph/v1/paper/search')
  assert.equal(requests[0]?.searchParams.get('openAccessPdf'), 'true')
  assert.match(requests[0]?.searchParams.get('fields') ?? '', /citationCount/)
  const cached = await searchPaperNavigator({ query: 'neural operators for inverse problems', limit: 3, openAccessOnly: true, fetchImpl: async () => {
    throw new Error('缓存命中时不应再次请求')
  } })
  assert.equal(cached.papers[0]?.paperId, 's2-1')
})

test('Semantic Scholar failure falls back to arXiv Atom XML', async () => {
  const urls: string[] = []
  const xml = `<?xml version="1.0"?><feed>
    <entry><id>http://arxiv.org/abs/2401.00001v2</id><title>  An XML paper &amp; method </title>
    <summary>Summary &amp; details</summary><published>2024-01-02T00:00:00Z</published>
    <author><name>Ada Lovelace</name></author></entry>
  </feed>`
  const result = await searchPaperNavigator({ query: 'xml paper', limit: 2, fetchImpl: async (input) => {
    urls.push(String(input))
    if (urls.length === 1) return jsonResponse({ error: 'unavailable' }, false, 400)
    return { ok: true, status: 200, text: async () => xml, headers: new Headers({ 'content-type': 'application/atom+xml' }) } as Response
  } })
  assert.equal(result.fallback, true)
  assert.equal(result.source, 'Arxiv')
  assert.equal(result.papers[0]?.title, 'An XML paper & method')
  assert.equal(result.papers[0]?.externalIds?.ArXiv, '2401.00001')
  assert.equal(urls.length, 2)
  assert.match(urls[1] ?? '', /export\.arxiv\.org\/api\/query/)
})

test('forward and backward graph expansion request portable nested fields', async () => {
  const requests: URL[] = []
  const result = await traversePaperNavigator({ paperId: 's2-root', direction: 'forward', limit: 5, smart: true, fetchImpl: async (input) => {
    const url = new URL(String(input)); requests.push(url)
    return jsonResponse({ data: [{ citingPaper: paper('s2-citer'), contexts: ['supports this'], intents: ['background'], isInfluential: true }] })
  } })
  assert.equal(result.papers[0]?.paperId, 's2-citer')
  assert.equal(result.papers[0]?.isInfluential, true)
  assert.equal(result.papers[0]?.citationContexts, 1)
  assert.match(requests[0]?.searchParams.get('fields') ?? '', /citingPaper\.paperId/)
  assert.doesNotMatch(requests[0]?.searchParams.get('fields') ?? '', /publicationVenue/)
})

test('co-citation counts repeated references across citing papers', async () => {
  let call = 0
  const result = await traversePaperNavigator({ paperId: 'root', direction: 'co-citation', limit: 5, fetchImpl: async (input) => {
    const url = new URL(String(input)); call += 1
    if (url.pathname.endsWith('/root/citations')) return jsonResponse({ data: [{ citingPaper: paper('citer-1') }, { citingPaper: paper('citer-2') }] })
    const citer = url.pathname.includes('citer-1') ? 'ref-common' : 'ref-common'
    return jsonResponse({ data: [{ citedPaper: paper(citer, 'Shared reference') }, { citedPaper: paper(`unique-${call}`) }] })
  } })
  assert.equal(result.papers[0]?.paperId, 'ref-common')
  assert.equal(result.papers[0]?.relatedCount, 2)
})

test('recommendations and snippets map native Semantic Scholar responses', async () => {
  const requests: Array<{ url: string; method: string }> = []
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input); requests.push({ url, method: init?.method ?? 'GET' })
    if (url.includes('/recommendations/')) return jsonResponse({ recommendedPapers: [paper('recommended')] })
    return jsonResponse({ data: [{ snippet: { text: 'relevant evidence', snippetKind: 'abstract' }, paper: paper('s2-1'), score: 0.91 }] })
  }
  const recommendations = await recommendPaperNavigator({ positiveIds: ['s2-seed'], limit: 3, fetchImpl })
  const snippets = await searchPaperNavigatorSnippets({ query: 'relevant evidence', paperId: 's2-1', fetchImpl })
  assert.equal(recommendations[0]?.paperId, 'recommended')
  assert.equal(snippets[0]?.text, 'relevant evidence')
  assert.equal(requests[0]?.method, 'POST')
  assert.match(requests[1]?.url ?? '', /snippet\/search/)
})
