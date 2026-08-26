import test from 'node:test'
import assert from 'node:assert/strict'
import { cloneLlmProviders, pluginPackageVersion, probeProviderEndpoint, providerBaseUrlCandidates } from '../src/workspace-api'

test('provider URL 候选按原地址、/v1 顺序生成，并避免重复 /v1', () => {
  assert.deepEqual(providerBaseUrlCandidates('http://127.0.0.1:3000'), [
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3000/v1',
  ])
  assert.deepEqual(providerBaseUrlCandidates('http://127.0.0.1:3000///'), [
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3000/v1',
  ])
  assert.deepEqual(providerBaseUrlCandidates('http://127.0.0.1:3000/v1/'), [
    'http://127.0.0.1:3000/v1',
  ])
})

test('provider 探测先请求原地址，失败后才请求 /v1，并返回成功地址', async () => {
  const previousFetch = globalThis.fetch
  const requested: string[] = []
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input)
    requested.push(url)
    if (!url.endsWith('/v1/models')) return { ok: false, status: 404 } as Response
    return {
      ok: true,
      json: async () => ({ data: [{ id: 'gpt-test' }] }),
    } as Response
  }) as typeof fetch
  try {
    const result = await probeProviderEndpoint('http://provider.test', 'key')
    assert.deepEqual(requested, [
      'http://provider.test/models',
      'http://provider.test/v1/models',
    ])
    assert.equal(result.baseURL, 'http://provider.test/v1')
    assert.deepEqual(result.models.map((model) => model.id), ['gpt-test'])
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('provider 已带 /v1 时只探测一次', async () => {
  const previousFetch = globalThis.fetch
  const requested: string[] = []
  globalThis.fetch = (async (input: string | URL | Request) => {
    requested.push(String(input))
    return {
      ok: true,
      json: async () => ({ data: [{ id: 'gpt-test' }] }),
    } as Response
  }) as typeof fetch
  try {
    const result = await probeProviderEndpoint('http://provider.test/v1', 'key')
    assert.deepEqual(requested, ['http://provider.test/v1/models'])
    assert.equal(result.baseURL, 'http://provider.test/v1')
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('provider 原地址和 /v1 都失败时抛出最后一次探测错误', async () => {
  const previousFetch = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input)
    return { ok: false, status: url.includes('/v1/') ? 401 : 404 } as Response
  }) as typeof fetch
  try {
    await assert.rejects(
      probeProviderEndpoint('http://provider.test', 'key'),
      /http:\/\/provider\.test\/v1\/models answered 401/,
    )
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('provider 保存使用可写副本，支持在冻结配置上新增 provider', () => {
  const existingModel = Object.freeze({ id: 'existing-model', name: 'Existing model' })
  const existing = Object.freeze({
    displayName: 'Existing',
    apiKeyEnv: 'EXISTING_KEY',
    models: Object.freeze([existingModel]),
  })
  const source = Object.freeze({ existing })
  const providers = cloneLlmProviders(source)

  assert.doesNotThrow(() => {
    providers.newapi = {
      displayName: 'NewAPI',
      apiKeyEnv: 'EVORESEARCH_LLM_NEWAPI',
      api: 'openai-completions',
    }
    providers.existing.displayName = 'Renamed'
    delete providers.existing.apiKeyEnv
    providers.existing.models.push({ id: 'added-model' })
  })
  assert.equal(providers.newapi.displayName, 'NewAPI')
  assert.equal(providers.existing.displayName, 'Renamed')
  assert.deepEqual(source.existing.models, [existingModel])
})

test('插件版本从 profile 中实际加载的 package.json 读取', () => {
  const previous = process.env.DSH_HOME
  try {
    for (const dshHome of ['D:\\DSH-Research\\profiles\\evoresearch', 'D:\\DSH-Research\\.tmp-dev\\.evoresearch-data']) {
      process.env.DSH_HOME = dshHome
      assert.equal(pluginPackageVersion({ options: { name: '@deepseek-ai/cordis-plugin-hmr' } }), '1.0.16')
      assert.equal(pluginPackageVersion({ options: { name: '@deepseek-ai/cordis-plugin-timer' } }), '1.1.3')
    }
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
  }
})
