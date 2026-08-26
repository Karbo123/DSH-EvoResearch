import test from 'node:test'
import assert from 'node:assert/strict'
import { ConfiguredWebSearchProvider, isAcademicSearchQuery } from '../src/host/web-search.js'
import type { ManagedSearchManager } from '../src/host/web-search-manager.js'

function fakeContext(initial: Record<string, unknown> = {}) {
  let section: Record<string, unknown> = initial
  const stored = new Map<string, string>()
  const replacements: Record<string, unknown>[] = []
  const ctx = {
    get(name: string) {
      if (name === 'settings') return { get: () => section, replace: async (_namespace: string, value: object) => { section = value as Record<string, unknown>; replacements.push(section) } }
      if (name === 'credentials') return { resolve: async (ref: string) => stored.has(ref) ? { value: stored.get(ref) } : undefined, set: async (ref: string, value: string) => { stored.set(ref, value) }, unset: async (ref: string) => { stored.delete(ref) } }
      return undefined
    },
  }
  return { ctx, stored, replacements }
}

test('首次启动默认使用免费的本地 Open-WebSearch', async () => {
  const { ctx } = fakeContext()
  const settings = await new ConfiguredWebSearchProvider(ctx as never).publicSettings()
  assert.equal(settings.activeProvider, 'openwebsearch')
  assert.equal(settings.providers.find((item) => item.id === 'openwebsearch')?.requiresKey, false)
})

test('旧版本未明确配置的 none 会迁移到免费默认，但明确禁用会保留', async () => {
  const legacy = await new ConfiguredWebSearchProvider(fakeContext({ activeProvider: 'none' }).ctx as never).publicSettings()
  assert.equal(legacy.activeProvider, 'openwebsearch')
  const explicit = await new ConfiguredWebSearchProvider(fakeContext({ activeProvider: 'none', userConfigured: true }).ctx as never).publicSettings()
  assert.equal(explicit.activeProvider, 'none')
})

test('新增的本地 MCP 搜索方式显示为可托管 Provider', async () => {
  const settings = await new ConfiguredWebSearchProvider(fakeContext().ctx as never).publicSettings()
  assert.deepEqual(settings.providers.filter((item) => item.id === 'google-ai-mode' || item.id === 'free-search').map((item) => ({ id: item.id, managed: item.managed, runtimeKind: item.runtimeKind })), [
    { id: 'google-ai-mode', managed: true, runtimeKind: 'stdio' },
    { id: 'free-search', managed: true, runtimeKind: 'stdio' },
  ])
})

test('本地 MCP Provider 接受 stdio 配置并转换结构化来源', async () => {
  const { ctx } = fakeContext({ activeProvider: 'google-ai-mode', providers: { 'google-ai-mode': { baseURL: 'stdio://managed/google-ai-mode' } } })
  const manager: ManagedSearchManager = {
    status: async () => ({ id: 'google-ai-mode', managed: true, installable: true, installed: true, running: true, endpoint: '', state: 'ready' }),
    install: async () => undefined,
    start: async () => undefined,
    ensureRunning: async () => undefined,
    stop: async () => undefined,
    dispose: async () => undefined,
    search: async (tool, args) => ({
      result: {
        isError: false,
        content: [{ type: 'text', text: JSON.stringify({ success: true, markdown: 'grounded answer', sources: [{ title: 'MCP source', url: 'https://example.test/mcp', snippet: 'evidence' }], query: args.query, tool }) }],
      },
    }),
  }
  const provider = new ConfiguredWebSearchProvider(ctx as never)
  provider.setManagedManager('google-ai-mode', manager)
  const result = await provider.search({ query: 'mcp search' })
  assert.deepEqual(result, { sources: [{ url: 'https://example.test/mcp', title: 'MCP source', snippet: 'evidence' }], content: 'grounded answer', truncated: false })
})

test('搜索设置保存到 settings，API key 只进入 credentials', async () => {
  const { ctx, stored, replacements } = fakeContext()
  const provider = new ConfiguredWebSearchProvider(ctx as never)
  const publicSettings = await provider.saveSettings({
    activeProvider: 'tavily',
    providers: { tavily: { baseURL: 'https://api.tavily.com' } },
    apiKeys: { tavily: 'secret-key' },
  })
  assert.equal(publicSettings.activeProvider, 'tavily')
  assert.equal(stored.get('TAVILY_API_KEY'), 'secret-key')
  assert.equal(JSON.stringify(replacements[0]).includes('secret-key'), false)
})

test('Tavily JSON 会转换为统一 sources 结构', async () => {
  const previousFetch = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    assert.equal(String(input), 'https://api.tavily.com/search')
    assert.equal((init?.method ?? 'GET'), 'POST')
    return { ok: true, text: async () => JSON.stringify({ results: [{ title: 'Paper', url: 'https://example.test/paper', content: 'structured snippet', published_date: '2026-01-01' }] }) } as Response
  }) as typeof fetch
  const { ctx, stored } = fakeContext({ activeProvider: 'tavily', providers: { tavily: { baseURL: 'https://api.tavily.com' } } })
  stored.set('TAVILY_API_KEY', 'test')
  try {
    const result = await new ConfiguredWebSearchProvider(ctx as never).search({ query: 'weather forecast' })
    assert.deepEqual(result, {
      sources: [{ url: 'https://example.test/paper', title: 'Paper', snippet: 'structured snippet', publishedAt: '2026-01-01' }],
      truncated: false,
    })
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('Brave Search 使用结构化 web.results 响应', async () => {
  const previousFetch = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input))
    assert.equal(url.origin + url.pathname, 'https://api.search.brave.com/res/v1/web/search')
    assert.equal(url.searchParams.get('q'), 'climate policy')
    assert.equal((init?.headers as Record<string, string>)['x-subscription-token'], 'brave-test')
    return { ok: true, text: async () => JSON.stringify({ web: { results: [{ title: 'Climate paper', url: 'https://example.test/climate', description: 'summary', age: '2 days ago' }] } }) } as Response
  }) as typeof fetch
  const { ctx, stored } = fakeContext({ activeProvider: 'brave', providers: { brave: { baseURL: 'https://api.search.brave.com' } } })
  stored.set('BRAVE_SEARCH_API_KEY', 'brave-test')
  try {
    const result = await new ConfiguredWebSearchProvider(ctx as never).search({ query: 'climate policy' })
    assert.deepEqual(result, { sources: [{ url: 'https://example.test/climate', title: 'Climate paper', snippet: 'summary', publishedAt: '2 days ago' }], truncated: false })
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('Serper 使用 organic 结果转换为统一来源', async () => {
  const previousFetch = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    assert.equal(String(input), 'https://google.serper.dev/search')
    assert.equal((init?.headers as Record<string, string>)['x-api-key'], 'serper-test')
    return { ok: true, text: async () => JSON.stringify({ organic: [{ title: 'Search result', link: 'https://example.test/result', snippet: 'result snippet', date: '2026-08-25' }] }) } as Response
  }) as typeof fetch
  const { ctx, stored } = fakeContext({ activeProvider: 'serper', providers: { serper: { baseURL: 'https://google.serper.dev' } } })
  stored.set('SERPER_API_KEY', 'serper-test')
  try {
    const result = await new ConfiguredWebSearchProvider(ctx as never).search({ query: 'structured search' })
    assert.equal(result.sources[0]?.url, 'https://example.test/result')
    assert.equal(result.sources[0]?.snippet, 'result snippet')
    assert.equal(result.truncated, false)
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('SearXNG 请求 format=json 并读取 results', async () => {
  const previousFetch = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input))
    assert.equal(url.origin + url.pathname, 'https://search.example/search')
    assert.equal(url.searchParams.get('format'), 'json')
    assert.equal(url.searchParams.get('q'), 'open science')
    return { ok: true, text: async () => JSON.stringify({ results: [{ title: 'Open science', url: 'https://example.test/open', content: 'open summary', publishedDate: '2026-08-25' }] }) } as Response
  }) as typeof fetch
  const { ctx } = fakeContext({ activeProvider: 'searxng', providers: { searxng: { baseURL: 'https://search.example' } } })
  try {
    const result = await new ConfiguredWebSearchProvider(ctx as never).search({ query: 'open science' })
    assert.deepEqual(result, { sources: [{ url: 'https://example.test/open', title: 'Open science', snippet: 'open summary', publishedAt: '2026-08-25' }], truncated: false })
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('DeepSeek Search 读取 Anthropic web_search_tool_result 结构', async () => {
  const previousFetch = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    assert.equal(String(input), 'https://api.deepseek.com/anthropic/v1/messages')
    assert.equal((init?.headers as Record<string, string>)['x-api-key'], 'deepseek-test')
    const body = JSON.parse(String(init?.body)) as { tools?: Array<{ type?: string }> }
    assert.equal(body.tools?.[0]?.type, 'web_search_20250305')
    return {
      ok: true,
      text: async () => JSON.stringify({ content: [
        { type: 'text', citations: [{ url: 'https://example.test/deep', cited_text: 'DeepSeek citation' }] },
        { type: 'web_search_tool_result', content: [{ type: 'web_search_result', url: 'https://example.test/deep', title: 'Deep result', page_age: '2026-08-25' }] },
      ] }),
    } as Response
  }) as typeof fetch
  const { ctx, stored } = fakeContext({ activeProvider: 'deepseek', providers: { deepseek: { baseURL: 'https://api.deepseek.com/anthropic/v1' } } })
  stored.set('DEEPSEEK_API_KEY', 'deepseek-test')
  try {
    const result = await new ConfiguredWebSearchProvider(ctx as never).search({ query: 'deep result' })
    assert.deepEqual(result, { sources: [{ url: 'https://example.test/deep', title: 'Deep result', snippet: 'DeepSeek citation', publishedAt: '2026-08-25' }], truncated: false })
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('OpenAI Web Search 读取 Responses API 的引用来源', async () => {
  const previousFetch = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    assert.equal(String(input), 'https://api.openai.com/v1/responses')
    assert.equal((init?.headers as Record<string, string>).authorization, 'Bearer openai-test')
    const body = JSON.parse(String(init?.body)) as { model?: string; tools?: Array<{ type?: string }>; tool_choice?: string }
    assert.equal(body.model, 'gpt-5.5')
    assert.equal(body.tools?.[0]?.type, 'web_search')
    assert.equal(body.tool_choice, 'required')
    return {
      ok: true,
      text: async () => JSON.stringify({ output: [
        { type: 'web_search_call', action: { sources: [{ url: 'https://example.test/openai', title: 'OpenAI source' }] } },
        { type: 'message', content: [{ type: 'output_text', text: 'Grounded answer', annotations: [{ type: 'url_citation', url: 'https://example.test/openai', title: 'OpenAI source' }] }] },
      ] }),
    } as Response
  }) as typeof fetch
  const { ctx, stored } = fakeContext({ activeProvider: 'openai', providers: { openai: { baseURL: 'https://api.openai.com/v1' } } })
  stored.set('OPENAI_API_KEY', 'openai-test')
  try {
    const result = await new ConfiguredWebSearchProvider(ctx as never).search({ query: 'OpenAI search' })
    assert.deepEqual(result, { sources: [{ url: 'https://example.test/openai', title: 'OpenAI source' }], content: 'Grounded answer', truncated: false })
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('Parallel Search API 读取 LLM 优化 excerpts', async () => {
  const previousFetch = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    assert.equal(String(input), 'https://api.parallel.ai/v1/search')
    assert.equal((init?.headers as Record<string, string>)['x-api-key'], 'parallel-test')
    const body = JSON.parse(String(init?.body)) as { mode?: string; search_queries?: string[] }
    assert.equal(body.mode, 'basic')
    assert.deepEqual(body.search_queries, ['parallel search'])
    return { ok: true, text: async () => JSON.stringify({ results: [{ title: 'Parallel result', url: 'https://example.test/parallel', excerpts: ['AI-ready excerpt'], publish_date: '2026-08-25' }] }) } as Response
  }) as typeof fetch
  const { ctx, stored } = fakeContext({ activeProvider: 'parallel', providers: { parallel: { baseURL: 'https://api.parallel.ai' } } })
  stored.set('PARALLEL_API_KEY', 'parallel-test')
  try {
    const result = await new ConfiguredWebSearchProvider(ctx as never).search({ query: 'parallel search' })
    assert.deepEqual(result, { sources: [{ url: 'https://example.test/parallel', title: 'Parallel result', snippet: 'AI-ready excerpt', publishedAt: '2026-08-25' }], truncated: false })
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('Exa 使用 highlights 转换为统一来源', async () => {
  const previousFetch = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    assert.equal(String(input), 'https://api.exa.ai/search')
    assert.equal((init?.headers as Record<string, string>)['x-api-key'], 'exa-test')
    return { ok: true, text: async () => JSON.stringify({ results: [{ title: 'Exa result', url: 'https://example.test/exa', highlights: ['Semantic excerpt'], publishedDate: '2026-08-25' }] }) } as Response
  }) as typeof fetch
  const { ctx, stored } = fakeContext({ activeProvider: 'exa', providers: { exa: { baseURL: 'https://api.exa.ai' } } })
  stored.set('EXA_API_KEY', 'exa-test')
  try {
    const result = await new ConfiguredWebSearchProvider(ctx as never).search({ query: 'semantic search' })
    assert.deepEqual(result, { sources: [{ url: 'https://example.test/exa', title: 'Exa result', snippet: 'Semantic excerpt', publishedAt: '2026-08-25' }], truncated: false })
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('Open-WebSearch daemon 读取 data.results', async () => {
  const previousFetch = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    assert.equal(String(input), 'http://127.0.0.1:3210/search')
    const body = JSON.parse(String(init?.body)) as { limit?: number }
    assert.equal(body.limit, 8)
    return { ok: true, text: async () => JSON.stringify({ status: 'ok', data: { results: [{ title: 'Local result', url: 'https://example.test/local', description: 'local summary' }] } }) } as Response
  }) as typeof fetch
  const { ctx } = fakeContext({ activeProvider: 'openwebsearch', providers: { openwebsearch: { baseURL: 'http://127.0.0.1:3210' } } })
  try {
    const result = await new ConfiguredWebSearchProvider(ctx as never).search({ query: 'local search' })
    assert.deepEqual(result, { sources: [{ url: 'https://example.test/local', title: 'Local result', snippet: 'local summary' }], truncated: false })
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('OpenSERP 默认请求 Google JSON endpoint', async () => {
  const previousFetch = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input))
    assert.equal(url.origin + url.pathname, 'http://127.0.0.1:7000/google/search')
    assert.equal(url.searchParams.get('text'), 'google serp')
    assert.equal(url.searchParams.get('format'), 'json')
    return { ok: true, text: async () => JSON.stringify({ results: [{ title: 'Google result', url: 'https://example.test/google', snippet: 'SERP snippet' }] }) } as Response
  }) as typeof fetch
  const { ctx } = fakeContext({ activeProvider: 'openserp', providers: { openserp: { baseURL: 'http://127.0.0.1:7000' } } })
  try {
    const result = await new ConfiguredWebSearchProvider(ctx as never).search({ query: 'google serp' })
    assert.deepEqual(result, { sources: [{ url: 'https://example.test/google', title: 'Google result', snippet: 'SERP snippet' }], truncated: false })
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('Parallel Search MCP 完成 initialize 与 tools/call', async () => {
  const previousFetch = globalThis.fetch
  let call = 0
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    assert.equal(String(input), 'https://search.parallel.ai/mcp')
    call += 1
    const body = JSON.parse(String(init?.body)) as { method?: string; params?: { name?: string; arguments?: { search_queries?: string[] } } }
    if (call === 1) {
      assert.equal(body.method, 'initialize')
      return { ok: true, headers: new Headers({ 'mcp-session-id': 'test-session' }), text: async () => JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }) } as Response
    }
    if (call === 2) {
      assert.equal(body.method, 'notifications/initialized')
      return { ok: true, headers: new Headers(), text: async () => '' } as Response
    }
    assert.equal(body.method, 'tools/call')
    assert.equal(body.params?.name, 'web_search')
    assert.deepEqual(body.params?.arguments?.search_queries, ['mcp search'])
    return { ok: true, headers: new Headers(), text: async () => JSON.stringify({ jsonrpc: '2.0', id: 2, result: { structuredContent: { results: [{ title: 'MCP result', url: 'https://example.test/mcp', excerpts: ['MCP excerpt'], publish_date: '2026-08-25' }] } } }) } as Response
  }) as typeof fetch
  const { ctx } = fakeContext({ activeProvider: 'parallel-mcp', providers: { 'parallel-mcp': { baseURL: 'https://search.parallel.ai/mcp' } } })
  try {
    const result = await new ConfiguredWebSearchProvider(ctx as never).search({ query: 'mcp search' })
    assert.deepEqual(result, { sources: [{ url: 'https://example.test/mcp', title: 'MCP result', snippet: 'MCP excerpt', publishedAt: '2026-08-25' }], truncated: false })
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('web seam 的 maxResults 会截断来源并标记 truncated', async () => {
  const previousFetch = globalThis.fetch
  globalThis.fetch = (async () => ({ ok: true, text: async () => JSON.stringify({ results: [
    { title: 'One', url: 'https://example.test/one' },
    { title: 'Two', url: 'https://example.test/two' },
  ] }) })) as typeof fetch
  const { ctx } = fakeContext({ activeProvider: 'searxng', providers: { searxng: { baseURL: 'https://search.example' } } })
  try {
    const result = await new ConfiguredWebSearchProvider(ctx as never).search({ query: 'two', maxResults: 1 })
    assert.equal(result.sources.length, 1)
    assert.equal(result.truncated, true)
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('SearXNG 不配置服务地址时明确失败', async () => {
  const { ctx } = fakeContext({ activeProvider: 'searxng', providers: { searxng: { baseURL: '' } } })
  await assert.rejects(new ConfiguredWebSearchProvider(ctx as never).search({ query: 'weather' }), /需要配置服务地址/)
})

test('通用 web_search 不再因论文关键词偷偷切换到 OpenAlex', async () => {
  assert.equal(isAcademicSearchQuery('find papers about NLOS imaging reconstruction'), true)
  assert.equal(isAcademicSearchQuery('NLOS imaging reconstruction'), true)
  assert.equal(isAcademicSearchQuery('TypeScript programming language'), false)
  assert.equal(isAcademicSearchQuery('how do I reset a local password?'), false)
  const previousFetch = globalThis.fetch
  const calls: URL[] = []
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input))
    calls.push(url)
    assert.equal(url.hostname, 'api.tavily.com')
    return { ok: true, text: async () => JSON.stringify({ results: [{ title: 'General result', url: 'https://example.test/general', content: 'not academic routing' }] }) } as Response
  }) as typeof fetch
  const { ctx, stored } = fakeContext({ activeProvider: 'tavily', providers: { tavily: { baseURL: 'https://api.tavily.com' } } })
  stored.set('TAVILY_API_KEY', 'test')
  try {
    const result = await new ConfiguredWebSearchProvider(ctx as never).search({ query: 'find papers about NLOS imaging reconstruction' })
    assert.equal(calls.length, 1)
    assert.equal(result.sources.length, 1)
    assert.equal(result.sources[0]?.sourceType, undefined)
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('学术搜索单独读取 OpenAlex → Crossref 配置', async () => {
  const previousFetch = globalThis.fetch
  let openAlexCalls = 0
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input))
    assert.equal(url.hostname, 'api.openalex.org')
    openAlexCalls += 1
    if (openAlexCalls === 1) assert.equal(url.searchParams.get('filter'), 'title.search:deep learning inverse problems')
    return { ok: true, text: async () => JSON.stringify({ results: [
      { id: 'https://openalex.org/W4', doi: '10.1234/tavily.1', title: 'Deep learning for inverse problems', publication_year: 2024, primary_location: { source: { display_name: 'Inverse Problems' } }, authorships: [], open_access: { is_oa: true }, cited_by_count: 12 },
    ] }) } as Response
  }) as typeof fetch
  const { ctx } = fakeContext({ activeProvider: 'tavily', providers: { tavily: { baseURL: 'https://api.tavily.com' } }, academicProvider: 'openalex-crossref', academicProviders: { 'openalex-crossref': { baseURL: 'https://api.openalex.org', crossrefURL: 'https://api.crossref.org' } } })
  try {
    const result = await new ConfiguredWebSearchProvider(ctx as never).searchAcademic('deep learning for inverse problems')
    assert.equal(openAlexCalls, 2)
    assert.equal(result.sources.length, 1)
    assert.equal(result.sources[0]?.sourceType, 'academic')
    assert.equal(result.sources[0]?.title, 'Deep learning for inverse problems')
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('AutoRelatedWork 兼容原 Python .env 的 DS/SEM_SCH/NET 变量', async () => {
  const names = ['DS_API_KEY', 'DS_API_URL', 'DS_MODEL', 'SEM_SCH_KEY', 'NET_GS', 'NET_SEMSCH', 'NET_ARXIV', 'NET_CROSSREF', 'NET_OPENALEX', 'NET_DBLP', 'NET_DEEPSEEK'] as const
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]))
  try {
    process.env.DS_API_KEY = 'legacy-deepseek-key'
    process.env.DS_API_URL = 'https://deepseek.example/v1/chat/completions'
    process.env.DS_MODEL = 'legacy-model'
    process.env.SEM_SCH_KEY = 'legacy-semantic-key'
    process.env.NET_GS = 'local+residential'
    process.env.NET_SEMSCH = 'direct'
    process.env.NET_ARXIV = 'direct'
    process.env.NET_CROSSREF = 'direct'
    process.env.NET_OPENALEX = 'direct'
    process.env.NET_DBLP = 'direct'
    process.env.NET_DEEPSEEK = 'direct'
    const { ctx } = fakeContext({ academicProvider: 'autorelatedwork', academicProviders: { autorelatedwork: { scholarURL: 'https://scholar.google.com', enrich: false } } })
    const provider = new ConfiguredWebSearchProvider(ctx as never)
    const settings = await provider.publicSettings()
    const academic = settings.academicProviders.find((item) => item.id === 'autorelatedwork')!
    assert.equal(academic.credentials.find((item) => item.id === 'deepseekApiKey')?.configured, true)
    assert.equal(academic.credentials.find((item) => item.id === 'semanticScholarApiKey')?.configured, true)
    assert.equal(academic.settings.deepseekURL, 'https://deepseek.example/v1/chat/completions')
    assert.equal(academic.settings.deepseekModel, 'legacy-model')
    assert.equal(academic.settings.netScholar, 'local+residential')
    assert.equal(academic.settings.netSemanticScholar, 'direct')
    assert.equal(academic.settings.netCrossref, 'direct')
    assert.equal(academic.settings.netOpenAlex, 'direct')
    assert.equal(academic.settings.netDeepSeek, 'direct')
  } finally {
    for (const name of names) {
      const value = previous[name]
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
})
