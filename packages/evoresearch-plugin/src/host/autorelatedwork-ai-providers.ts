/**
 * AutoRelatedWork ai_providers.py 的 TypeScript 等价模块。
 *
 * 这里只负责 OpenAI-compatible provider 的 URL 规范化、预设、模型发现和
 * 默认模型选择；不会把 API key 写入 settings 或日志。
 */

export interface AutoRelatedWorkAIProviderPreset {
  label: string
  base: string
  models: string[]
  default: string
  supportsModelList: boolean
}

export const AUTO_RELATED_WORK_PROVIDER_PRESETS: Record<string, AutoRelatedWorkAIProviderPreset> = {
  deepseek: { label: 'DeepSeek', base: 'https://api.deepseek.com/v1', models: ['deepseek-v4-flash', 'deepseek-v4-pro', 'deepseek-chat', 'deepseek-reasoner'], default: 'deepseek-v4-flash', supportsModelList: true },
  openai: { label: 'OpenAI', base: 'https://api.openai.com/v1', models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1', 'o4-mini'], default: 'gpt-4o-mini', supportsModelList: true },
  moonshot: { label: 'Moonshot (Kimi)', base: 'https://api.moonshot.cn/v1', models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k', 'kimi-k2-0711-preview'], default: 'moonshot-v1-8k', supportsModelList: true },
  openrouter: { label: 'OpenRouter', base: 'https://openrouter.ai/api/v1', models: ['google/gemini-2.0-flash-001', 'openai/gpt-4o-mini', 'deepseek/deepseek-chat', 'anthropic/claude-3.5-haiku'], default: 'google/gemini-2.0-flash-001', supportsModelList: true },
  dashscope: { label: '通义千问 (DashScope)', base: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models: ['qwen-turbo', 'qwen-plus', 'qwen-max', 'qwen-flash'], default: 'qwen-turbo', supportsModelList: false },
  zhipu: { label: '智谱 GLM', base: 'https://open.bigmodel.cn/api/paas/v4', models: ['glm-4-flash', 'glm-4-air', 'glm-4-plus', 'glm-4.6'], default: 'glm-4-flash', supportsModelList: false },
  siliconflow: { label: 'SiliconFlow', base: 'https://api.siliconflow.cn/v1', models: ['Qwen/Qwen2.5-7B-Instruct', 'deepseek-ai/DeepSeek-V3', 'THUDM/glm-4-9b-chat'], default: 'Qwen/Qwen2.5-7B-Instruct', supportsModelList: true },
  ollama: { label: 'Ollama (本地)', base: 'http://localhost:11434/v1', models: ['llama3.2', 'qwen2.5', 'mistral'], default: 'llama3.2', supportsModelList: true },
  custom: { label: '自定义 (OpenAI 兼容)', base: '', models: [], default: '', supportsModelList: true },
}

const FAST_MODEL_WORDS = ['flash', 'mini', 'lite', 'turbo', 'fast', 'haiku', 'small', '8k', 'nano']

export function autoRelatedWorkChatURLFromBase(base: string): string {
  const value = (base || '').trim().replace(/\/+$/, '')
  if (value === '') return ''
  return value.endsWith('/chat/completions') ? value : `${value}/chat/completions`
}

export function autoRelatedWorkBaseFromChatURL(chatURL: string): string {
  const value = (chatURL || '').trim().replace(/\/+$/, '')
  return value.endsWith('/chat/completions') ? value.slice(0, -'/chat/completions'.length) : value
}

export function autoRelatedWorkPickDefaultModel(models: string[], presetDefault = ''): string {
  const unique = [...new Set(models.filter((model) => typeof model === 'string' && model !== ''))]
  if (unique.length === 0) return presetDefault || ''
  if (presetDefault !== '' && unique.includes(presetDefault)) return presetDefault
  const fast = unique.filter((model) => FAST_MODEL_WORDS.some((word) => model.toLocaleLowerCase().includes(word)))
  return fast.length > 0 ? fast.reduce((shortest, model) => model.length < shortest.length ? model : shortest) : presetDefault || unique[0]!
}

function modelList(value: unknown): string[] {
  const items = Array.isArray(value) ? value : isObject(value) ? (Array.isArray(value.data) ? value.data : Array.isArray(value.models) ? value.models : []) : []
  const output: string[] = []
  for (const item of items) {
    const id = typeof item === 'string' ? item : isObject(item) ? item.id ?? item.name ?? item.model : undefined
    if (typeof id === 'string' && id !== '' && !output.includes(id)) output.push(id)
  }
  return output
}

function isObject(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export async function autoRelatedWorkFetchModels(baseURL: string, apiKey = '', fetchImpl: typeof fetch = fetch, timeoutMs = 10_000): Promise<string[]> {
  const base = baseURL.trim().replace(/\/+$/, '')
  if (base === '') return []
  const url = base.endsWith('/models') ? base : `${base}/models`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(url, { headers: { 'user-agent': 'ScholarScraper/1.0', ...(apiKey === '' ? {} : { authorization: `Bearer ${apiKey}` }) }, signal: controller.signal })
    if (!response.ok) return []
    return modelList(JSON.parse(await response.text()) as unknown)
  } catch {
    return []
  } finally { clearTimeout(timer) }
}

export function autoRelatedWorkResolveProvider(baseURL: string): string {
  const value = baseURL.toLocaleLowerCase()
  for (const [key, preset] of Object.entries(AUTO_RELATED_WORK_PROVIDER_PRESETS)) {
    if (key === 'custom') continue
    const host = preset.base.replace(/^https?:\/\//i, '').split('/')[0] ?? ''
    if (host !== '' && value.includes(host)) return key
  }
  return 'custom'
}

export async function autoRelatedWorkListModelsForProvider(options: {
  providerKey: string
  apiKey?: string
  baseOverride?: string
  fetchImpl?: typeof fetch
}): Promise<{ models: string[]; default: string; source: 'api' | 'preset'; base: string; chatURL: string }> {
  const preset = AUTO_RELATED_WORK_PROVIDER_PRESETS[options.providerKey] ?? AUTO_RELATED_WORK_PROVIDER_PRESETS.custom!
  const base = options.baseOverride || preset.base
  let models: string[] = []
  let source: 'api' | 'preset' = 'preset'
  if (preset.supportsModelList && base !== '') {
    models = await autoRelatedWorkFetchModels(base, options.apiKey ?? '', options.fetchImpl)
    if (models.length > 0) source = 'api'
  }
  if (models.length === 0) models = [...preset.models]
  return { models, default: autoRelatedWorkPickDefaultModel(models, preset.default), source, base, chatURL: autoRelatedWorkChatURLFromBase(base) }
}
