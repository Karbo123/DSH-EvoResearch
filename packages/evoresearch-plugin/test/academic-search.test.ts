import test from 'node:test'
import assert from 'node:assert/strict'
import { academicQueryTerms, searchAcademic, searchCrossref, searchOpenAlex } from '../src/host/academic-search.js'

function response(body: unknown, ok = true, status = 200): Response {
  return { ok, status, text: async () => JSON.stringify(body) } as Response
}

test('学术查询会去掉 recent/advances 等意图词，避免全文索引退化为单词搜索', () => {
  assert.equal(academicQueryTerms('recent advances in computational imaging'), 'computational imaging')
  assert.equal(academicQueryTerms('deep learning for inverse problems'), 'deep learning inverse problems')
  assert.equal(academicQueryTerms('NLOS imaging reconstruction'), 'NLOS imaging reconstruction')
})

test('OpenAlex 使用 title.search 并保留论文元数据', async () => {
  const previousFetch = globalThis.fetch
  const requests: URL[] = []
  globalThis.fetch = (async (input: string | URL | Request) => {
    requests.push(new URL(String(input)))
    return response({ results: [{
      id: 'https://openalex.org/W1',
      doi: 'https://doi.org/10.1234/example.1',
      title: 'Computational imaging with deep learning',
      publication_year: 2024,
      publication_date: '2024-05-01',
      authorships: [{ author: { display_name: 'Ada Lovelace' } }],
      primary_location: { landing_page_url: 'https://journal.example/paper', source: { display_name: 'Journal of Imaging' } },
      open_access: { is_oa: true },
      cited_by_count: 12,
      type: 'article',
    }] })
  }) as typeof fetch
  try {
    const result = await searchOpenAlex({ query: 'recent advances in computational imaging', limit: 8 })
    assert.equal(requests[0]?.searchParams.get('filter'), 'title.search:computational imaging')
    assert.equal(result.provider, 'OpenAlex')
    assert.equal(result.sources[0]?.doi, '10.1234/example.1')
    assert.equal(result.sources[0]?.venue, 'Journal of Imaging')
    assert.deepEqual(result.sources[0]?.authors, ['Ada Lovelace'])
    assert.equal(result.sources[0]?.openAccess, true)
    assert.match(result.sources[0]?.snippet ?? '', /DOI：10\.1234\/example\.1/)
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('Crossref 过滤补充材料并转换 DOI/题录', async () => {
  const previousFetch = globalThis.fetch
  globalThis.fetch = (async () => response({ message: { items: [
    { type: 'component', DOI: '10.1234/supp', title: ['supplement'] },
    { type: 'journal-article', DOI: '10.1234/paper', title: ['A real paper'], author: [{ given: 'Grace', family: 'Hopper' }], 'container-title': ['Science Journal'], published: { 'date-parts': [[2023, 2, 3]] }, 'is-referenced-by-count': 7 },
  ] } })) as typeof fetch
  try {
    const result = await searchCrossref({ query: 'real paper' })
    assert.equal(result.sources.length, 1)
    assert.equal(result.sources[0]?.url, 'https://doi.org/10.1234/paper')
    assert.equal(result.sources[0]?.year, 2023)
    assert.deepEqual(result.sources[0]?.authors, ['Grace Hopper'])
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('OpenAlex 失败时自动使用 Crossref 兜底，仍不调用通用 SERP', async () => {
  const previousFetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = (async (input: string | URL | Request) => {
    calls += 1
    const url = new URL(String(input))
    if (url.hostname === 'api.openalex.org') return response({ error: 'offline' }, false, 503)
    assert.equal(url.hostname, 'api.crossref.org')
    return response({ message: { items: [{ type: 'journal-article', DOI: '10.1234/fallback', title: ['Fallback paper'] }] } })
  }) as typeof fetch
  try {
    const result = await searchAcademic({ query: 'fallback paper' })
    assert.equal(result.provider, 'Crossref')
    assert.equal(result.sources[0]?.doi, '10.1234/fallback')
    assert.equal(calls, 2)
  } finally {
    globalThis.fetch = previousFetch
  }
})
