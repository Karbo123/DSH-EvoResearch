/**
 * EvoResearch 可配置联网搜索 Provider。
 *
 * DSH 的 web seam 只需要一个稳定的 WebSearchProvider；本适配器在每次
 * 搜索时读取设置面板保存的 activeProvider，并把不同服务的 JSON 结果
 * 统一为 DSH 的 sources[] 结构。API key 只进入 credentials 服务，不写入
 * settings.yaml，也不会通过 publicSettings 返回给浏览器。
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { randomUUID } from 'node:crypto'
import { OPENWEBSEARCH_DEFAULT_URL, OpenWebSearchManager, type ManagedSearchBackendId, type ManagedSearchManager, type ManagedSearchBackendStatus } from './web-search-manager.js'
import { CROSSREF_DEFAULT_URL, OPENALEX_DEFAULT_URL, searchAcademic as searchAcademicSources, searchCrossref, searchOpenAlex, type AcademicSearchResult, type AcademicAuthor, type AcademicAuthorProfile, type AcademicReference } from './academic-search.js'
import { AUTORELATEDWORK_DEFAULT_SCHOLAR_URL, searchAutoRelatedWork, type AutoRelatedWorkConfig } from './autorelatedwork-search.js'

export const WEB_SEARCH_SETTINGS_NAMESPACE = 'evoresearch-web-search'
export const WEB_SEARCH_PROVIDER_ID = 'evoresearch-configured'

export const WEB_SEARCH_PROVIDER_IDS = ['searxng', 'tavily', 'brave', 'serper', 'deepseek', 'openai', 'parallel', 'parallel-mcp', 'exa', 'openwebsearch', 'openserp', 'google-ai-mode', 'free-search'] as const
export type WebSearchProviderId = typeof WEB_SEARCH_PROVIDER_IDS[number]
export type ActiveWebSearchProvider = WebSearchProviderId | 'none'

export const ACADEMIC_PROVIDER_IDS = ['openalex-crossref', 'autorelatedwork'] as const
export type AcademicSearchProviderId = typeof ACADEMIC_PROVIDER_IDS[number]
export type ActiveAcademicSearchProvider = AcademicSearchProviderId | 'none'

export interface WebSearchProviderConfig {
  baseURL?: string
  model?: string
}

export interface AcademicSearchProviderConfig extends AutoRelatedWorkConfig {
  baseURL?: string
  crossrefURL?: string
}

export interface WebSearchSettings {
  activeProvider: ActiveWebSearchProvider
  providers: Partial<Record<WebSearchProviderId, WebSearchProviderConfig>>
  academicProvider: ActiveAcademicSearchProvider
  academicProviders: Partial<Record<AcademicSearchProviderId, AcademicSearchProviderConfig>>
  userConfigured?: boolean
}

export interface WebSearchPublicProvider {
  id: WebSearchProviderId
  name: string
  description: string
  baseURL: string
  apiKeyEnv?: string
  requiresKey: boolean
  apiKeyOptional?: boolean
  configured: boolean
  freeTier: string
  managed?: boolean
  installable?: boolean
  runtimeKind?: 'http' | 'stdio'
  installed?: boolean
  running?: boolean
  runtimeState?: ManagedSearchBackendStatus['state']
  runtimeEndpoint?: string
  runtimeMessage?: string
}

export interface WebSearchPublicSettings {
  activeProvider: ActiveWebSearchProvider
  providers: WebSearchPublicProvider[]
  academicProvider: ActiveAcademicSearchProvider
  academicProviders: AcademicSearchPublicProvider[]
}

export interface AcademicSearchPublicProvider {
  id: AcademicSearchProviderId
  name: string
  description: string
  configured: boolean
  freeTier: string
  baseURL: string
  settings: {
    crossrefURL?: string
    scholarURL?: string
    localProxy?: string
    qgServers?: string[]
    qgPort?: number
    qgChannel?: string
    country?: string
    delayMs?: number
    enrich?: boolean
    maxRetries?: number
    maxEnrichmentRounds?: number
    includeAuthorProfiles?: boolean
    recursiveDepth?: number
    recursiveWidth?: number
    recursiveMaxTotal?: number
    fetchBibtex?: boolean
    fetchArxiv?: boolean
    fetchArxivHTML?: boolean
    deepseekEnrich?: boolean
    deepseekURL?: string
    deepseekModel?: string
    netScholar?: AutoRelatedWorkConfig['netScholar']
    netSemanticScholar?: AutoRelatedWorkConfig['netSemanticScholar']
    netSemSch?: AutoRelatedWorkConfig['netSemSch']
    netArxiv?: AutoRelatedWorkConfig['netArxiv']
    netCrossref?: AutoRelatedWorkConfig['netCrossref']
    netOpenAlex?: AutoRelatedWorkConfig['netOpenAlex']
    netDblp?: AutoRelatedWorkConfig['netDblp']
    netUnpaywall?: AutoRelatedWorkConfig['netUnpaywall']
    netDeepSeek?: AutoRelatedWorkConfig['netDeepSeek']
  }
  credentials: Array<{ id: string; label: string; env: string; configured: boolean; optional: boolean }>
}

export interface WebSearchSource {
  url: string
  title?: string
  snippet?: string
  publishedAt?: string
  doi?: string
  authors?: string[]
  venue?: string
  year?: number
  citedByCount?: number
  openAccess?: boolean
  abstract?: string
  pdfUrls?: string[]
  additionalUrls?: string[]
  citedByURL?: string
  allVersionsCount?: number
  allVersionsURL?: string
  relatedArticlesURL?: string
  paperId?: string
  bibtex?: string
  institutions?: string[]
  authorScholarIds?: Record<string, string>
  authorsDetailed?: AcademicAuthor[]
  authorProfiles?: Record<string, AcademicAuthorProfile>
  emails?: string[]
  references?: AcademicReference[]
  sourceType?: 'academic' | 'web'
}

export interface WebSearchResult {
  sources: WebSearchSource[]
  content?: string
  truncated: boolean
}

/**
 * DSH settings namespaces must be registered before get/replace can be used.
 * API keys deliberately do not appear here: they belong to ctx.credentials.
 */
export const WEB_SEARCH_SETTINGS_SCHEMA = z.object({
  activeProvider: z.string().default('openwebsearch'),
  providers: z.dict(z.object({
    baseURL: z.string().default(''),
    model: z.string().default(''),
  })).default({}),
  academicProvider: z.string().default('openalex-crossref'),
  academicProviders: z.dict(z.object({
    baseURL: z.string().default(''),
    crossrefURL: z.string().default(''),
    scholarURL: z.string().default(''),
    localProxy: z.string().default(''),
    qgServers: z.array(z.string()).default([]),
    qgPort: z.number().default(443),
    qgChannel: z.string().default(''),
    country: z.string().default(''),
    delayMs: z.number().default(1200),
    maxRetries: z.number().default(3),
    enrich: z.boolean().default(true),
    maxEnrichmentRounds: z.number().default(1),
    includeAuthorProfiles: z.boolean().default(false),
    recursiveDepth: z.number().default(0),
    recursiveWidth: z.number().default(5),
    recursiveMaxTotal: z.number().default(50),
    fetchBibtex: z.boolean().default(true),
    fetchArxiv: z.boolean().default(true),
    fetchArxivHTML: z.boolean().default(true),
    deepseekEnrich: z.boolean().default(false),
    deepseekURL: z.string().default(''),
    deepseekModel: z.string().default(''),
    netScholar: z.string().default(''),
    netSemanticScholar: z.string().default(''),
    netSemSch: z.string().default(''),
    netArxiv: z.string().default(''),
    netCrossref: z.string().default(''),
    netOpenAlex: z.string().default(''),
    netDblp: z.string().default(''),
    netUnpaywall: z.string().default(''),
    netDeepSeek: z.string().default(''),
    cacheFile: z.string().default(''),
    cacheTTLHours: z.number().default(24),
  })).default({}),
  userConfigured: z.boolean().default(false),
})

interface ProviderMeta {
  name: string
  description: string
  defaultURL: string
  apiKeyEnv?: string
  requiresKey: boolean
  freeTier: string
  managed?: ManagedSearchBackendId
  runtimeKind?: 'http' | 'stdio'
}

const PROVIDER_META: Record<WebSearchProviderId, ProviderMeta> = {
  searxng: {
    name: 'SearXNG',
    description: '开源聚合搜索；可连接自建实例，不需要 API Key。',
    defaultURL: '',
    requiresKey: false,
    freeTier: '自建免费；公共实例取决于实例策略',
  },
  tavily: {
    name: 'Tavily',
    description: '面向 AI Agent 的结构化搜索 API，返回相关性排序结果。',
    defaultURL: 'https://api.tavily.com',
    apiKeyEnv: 'TAVILY_API_KEY',
    requiresKey: true,
    freeTier: '有免费额度，具体以官方账户为准',
  },
  brave: {
    name: 'Brave Search',
    description: '主流独立搜索索引，返回网页结果 JSON。',
    defaultURL: 'https://api.search.brave.com',
    apiKeyEnv: 'BRAVE_SEARCH_API_KEY',
    requiresKey: true,
    freeTier: '有免费额度或试用额度，具体以官方账户为准',
  },
  serper: {
    name: 'Serper',
    description: 'Google 搜索结果 API，适合需要 SERP 排名与摘要的场景。',
    defaultURL: 'https://google.serper.dev',
    apiKeyEnv: 'SERPER_API_KEY',
    requiresKey: true,
    freeTier: '通常提供试用查询额度，具体以官方账户为准',
  },
  deepseek: {
    name: 'DeepSeek Search',
    description: 'DeepSeek 原生 web_search，服务器侧检索并返回结构化来源。',
    defaultURL: 'https://api.deepseek.com/anthropic/v1',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    requiresKey: true,
    freeTier: '按 DeepSeek API 账户计费；不保证免费',
  },
  openai: {
    name: 'OpenAI Web Search',
    description: 'OpenAI Responses API 的托管 web_search；返回带引用的模型回答和来源。',
    defaultURL: 'https://api.openai.com/v1',
    apiKeyEnv: 'OPENAI_API_KEY',
    requiresKey: true,
    freeTier: '付费：每 1,000 次搜索调用 10 美元，另计搜索内容和模型 token',
  },
  parallel: {
    name: 'Parallel Search API',
    description: '面向 AI 的搜索 API，返回 LLM 优化摘要和结构化来源。',
    defaultURL: 'https://api.parallel.ai',
    apiKeyEnv: 'PARALLEL_API_KEY',
    requiresKey: true,
    freeTier: '有注册赠送和月度额度；具体以官方账户为准',
  },
  'parallel-mcp': {
    name: 'Parallel Search MCP',
    description: '官方 MCP 搜索服务；可匿名免费使用，也可选填 API Key 提高限额。',
    defaultURL: 'https://search.parallel.ai/mcp',
    apiKeyEnv: 'PARALLEL_API_KEY',
    requiresKey: false,
    freeTier: '匿名免费低限额；API Key 可提高限额',
  },
  exa: {
    name: 'Exa',
    description: '面向 AI 检索的语义搜索，返回摘要/高亮文本和结构化来源。',
    defaultURL: 'https://api.exa.ai',
    apiKeyEnv: 'EXA_API_KEY',
    requiresKey: true,
    freeTier: '通常有注册赠送和月度额度；具体以官方账户为准',
  },
  openwebsearch: {
    name: 'Open-WebSearch',
    description: 'TypeScript/Node 多引擎搜索；EvoResearch 会自动安装、启动和回收本地服务，无需 API Key。',
    defaultURL: OPENWEBSEARCH_DEFAULT_URL,
    requiresKey: false,
    freeTier: '开源自托管免费；受本机网络和所选引擎限制',
  },
  openserp: {
    name: 'OpenSERP',
    description: '本地自托管 SERP API；默认使用 Google，也支持 Bing、Yandex、百度、DuckDuckGo 和 Ecosia。',
    defaultURL: 'http://127.0.0.1:7000',
    requiresKey: false,
    freeTier: 'MIT 开源、自托管免费；需要单独运行 OpenSERP 服务',
  },
  'google-ai-mode': {
    name: 'Google AI Mode MCP',
    description: 'MIT 开源 TypeScript MCP；EvoResearch 自动安装并托管本地浏览器，通过 Google AI Mode 返回摘要和引用。首次或高频搜索可能需要处理 CAPTCHA。',
    defaultURL: 'stdio://managed/google-ai-mode',
    requiresKey: false,
    freeTier: '开源免费；依赖 Google 公共搜索和本机浏览器，可能受 CAPTCHA/地区限制',
    managed: 'google-ai-mode',
    runtimeKind: 'stdio',
  },
  'free-search': {
    name: 'Free Search MCP',
    description: 'MIT 开源 Python 多引擎 MCP；EvoResearch 通过 uvx 自动运行，免 API Key，并支持 DuckDuckGo、Mojeek、Startpage 等兜底引擎。',
    defaultURL: 'stdio://managed/free-search',
    requiresKey: false,
    freeTier: '开源免费；需要本机安装 uv，搜索引擎可用性取决于网络环境',
    managed: 'free-search',
    runtimeKind: 'stdio',
  },
}

const ACADEMIC_PROVIDER_META: Record<AcademicSearchProviderId, { name: string; description: string; freeTier: string; baseURL: string }> = {
  'openalex-crossref': {
    name: 'OpenAlex → Crossref',
    description: '免费学术元数据检索：优先 OpenAlex，失败或无结果时使用 Crossref 兜底。',
    freeTier: '开放 API 免费；请遵守服务方速率限制',
    baseURL: OPENALEX_DEFAULT_URL,
  },
  autorelatedwork: {
    name: 'AutoRelatedWork',
    description: 'Google Scholar 高相关候选 + BibTeX/arXiv/Semantic Scholar/Crossref/OpenAlex/DBLP/Unpaywall 多源补全；可选代理与作者增强。',
    freeTier: '代码本身免费；Google Scholar 访问可能需要本地 HTTP 代理或 Nexip 等住宅代理，第三方 API 按其限额执行',
    baseURL: AUTORELATEDWORK_DEFAULT_SCHOLAR_URL,
  },
}

const ACADEMIC_CREDENTIALS: Record<AcademicSearchProviderId, Array<{ id: string; label: string; env: string; optional: boolean }>> = {
  'openalex-crossref': [],
  autorelatedwork: [
    { id: 'qgAuthKey', label: 'Residential proxy username / auth key', env: 'PROXY_AUTHKEY', optional: true },
    { id: 'qgAuthPwd', label: 'Residential proxy password', env: 'PROXY_AUTHPWD', optional: true },
    { id: 'semanticScholarApiKey', label: 'Semantic Scholar API Key', env: 'SEMANTIC_SCHOLAR_API_KEY', optional: true },
    { id: 'unpaywallEmail', label: 'Unpaywall email', env: 'UNPAYWALL_EMAIL', optional: true },
    { id: 'deepseekApiKey', label: 'DeepSeek API Key (AI enrichment)', env: 'DEEPSEEK_API_KEY', optional: true },
  ],
}

const DEFAULT_SETTINGS: WebSearchSettings = {
  // Open-WebSearch 是本地 TypeScript/Node daemon，无 API Key；Parallel MCP 仍可作为远程备用项。
  activeProvider: 'openwebsearch',
  providers: Object.fromEntries(WEB_SEARCH_PROVIDER_IDS.map((id) => [id, { baseURL: PROVIDER_META[id].defaultURL }])) as WebSearchSettings['providers'],
  academicProvider: 'openalex-crossref',
  academicProviders: {
    'openalex-crossref': { baseURL: OPENALEX_DEFAULT_URL, crossrefURL: CROSSREF_DEFAULT_URL },
    autorelatedwork: { scholarURL: AUTORELATEDWORK_DEFAULT_SCHOLAR_URL, enrich: true, delayMs: 1200, maxRetries: 3, maxEnrichmentRounds: 1, recursiveDepth: 0, recursiveWidth: 5, recursiveMaxTotal: 50, fetchBibtex: true, fetchArxiv: true, fetchArxivHTML: true, deepseekEnrich: false },
  },
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function cleanURL(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\/+$/, '') : ''
}

/**
 * AutoRelatedWork 原 Python 项目使用短变量名（DS_API_*、SEM_SCH_KEY、
 * NET_*）。Web 集成使用更明确的变量名，但读取两套名称时必须保持旧
 * `.env` 可直接复用；优先采用明确的新名称，且绝不记录返回值。
 */
function environmentValue(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim()
    if (value !== undefined && value !== '') return value
  }
  return undefined
}

function environmentNumber(...names: string[]): number | undefined {
  const value = environmentValue(...names)
  if (value === undefined) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function environmentNetworkMode(...names: string[]): AutoRelatedWorkConfig['netScholar'] | undefined {
  const value = environmentValue(...names)
  return value === 'direct' || value === 'local' || value === 'residential' || value === 'local+residential' ? value : undefined
}

function validProvider(value: unknown): value is WebSearchProviderId {
  return typeof value === 'string' && (WEB_SEARCH_PROVIDER_IDS as readonly string[]).includes(value)
}

/**
 * 旧版兼容导出：用于外部调用方识别学术意图。
 * 当前通用 web_search 不再依据关键词切换 Provider；学术检索必须走
 * 独立的 academicProvider 设置，避免用户选择 Tavily/Open-WebSearch 后
 * 仍被悄悄改道。
 */
export function isAcademicSearchQuery(query: string): boolean {
  const text = query.toLocaleLowerCase()
  if (/(论文|文献|学术|题录|期刊|会议论文|引用|学术搜索|doi|arxiv|pubmed|openalex|crossref|semantic scholar|google scholar|research paper|academic paper|journal article|literature review|preprint|\b(?:paper|papers|article|articles|study|studies|survey|journal|conference|citation|citations)\b)/i.test(text)) return true

  // 用户经常直接输入“主题 + 方法”，而不是再写一遍“论文”。这类
  // 技术查询同样应走题录索引；否则 Open-WebSearch 可能把首个缩写或
  // 普通词送进词典/百科垂直结果（例如 “NLOS imaging reconstruction”）。
  const researchTerms = text.match(/\b(?:imaging|reconstruction|inverse problem|inverse problems|deep learning|machine learning|neural|transformer|diffusion|segmentation|classification|detection|optimization|algorithm|dataset|benchmark|simulation|experiment|method|framework|architecture|computational|wireless|signal processing|computer vision|natural language processing|remote sensing|tomography|radar|lidar|nlos|los)\b/gi) ?? []
  return researchTerms.length >= 2 || (researchTerms.length >= 1 && /\b(?:nlos|los|arxiv|doi)\b/i.test(text))
}

function normalizeSettings(raw: unknown): WebSearchSettings {
  const source = isObject(raw) ? raw : {}
  const requestedProvider: ActiveWebSearchProvider = source.activeProvider === 'none' || validProvider(source.activeProvider)
    ? source.activeProvider
    : DEFAULT_SETTINGS.activeProvider
  // 旧版本把“未配置”持久化成 none。只迁移这个旧默认值；保存过设置后
  // userConfigured=true，用户主动选择 none 就会继续保持禁用。
  const activeProvider: ActiveWebSearchProvider = requestedProvider === 'none' && source.userConfigured !== true
    ? DEFAULT_SETTINGS.activeProvider
    : requestedProvider
  const providers: WebSearchSettings['providers'] = {}
  for (const id of WEB_SEARCH_PROVIDER_IDS) {
    const value = isObject(source.providers) && isObject(source.providers[id]) ? source.providers[id] : {}
    providers[id] = {
      baseURL: cleanURL(value.baseURL) || PROVIDER_META[id].defaultURL,
      ...(typeof value.model === 'string' && value.model.trim() !== '' ? { model: value.model.trim() } : {}),
    }
  }
  const legacyAcademic = source.activeProvider === 'openalex' || source.activeProvider === 'crossref'
    ? 'openalex-crossref'
    : undefined
  const requestedAcademic: ActiveAcademicSearchProvider = source.academicProvider === 'none' || (ACADEMIC_PROVIDER_IDS as readonly string[]).includes(String(source.academicProvider))
    ? source.academicProvider as ActiveAcademicSearchProvider
    : legacyAcademic ?? DEFAULT_SETTINGS.academicProvider
  const academicProvider: ActiveAcademicSearchProvider = requestedAcademic === 'none' && source.userConfigured !== true
    ? DEFAULT_SETTINGS.academicProvider
    : requestedAcademic
  const academicProviders: WebSearchSettings['academicProviders'] = {}
  for (const id of ACADEMIC_PROVIDER_IDS) {
    const value = isObject(source.academicProviders) && isObject(source.academicProviders[id]) ? source.academicProviders[id] : {}
    const legacyOpenAlex = id === 'openalex-crossref' && isObject(source.providers) && isObject(source.providers.openalex) ? source.providers.openalex : {}
    const legacyCrossref = id === 'openalex-crossref' && isObject(source.providers) && isObject(source.providers.crossref) ? source.providers.crossref : {}
    academicProviders[id] = id === 'openalex-crossref'
      ? {
          baseURL: cleanURL(value.baseURL) || cleanURL(legacyOpenAlex.baseURL) || OPENALEX_DEFAULT_URL,
          crossrefURL: cleanURL(value.crossrefURL) || cleanURL(legacyCrossref.baseURL) || CROSSREF_DEFAULT_URL,
        }
      : {
          scholarURL: cleanURL(value.scholarURL) || AUTORELATEDWORK_DEFAULT_SCHOLAR_URL,
          ...(cleanURL(value.localProxy) !== '' ? { localProxy: cleanURL(value.localProxy) } : process.env.LOCAL_PROXY?.trim() ? { localProxy: process.env.LOCAL_PROXY.trim() } : {}),
          ...(Array.isArray(value.qgServers) && value.qgServers.length > 0
            ? { qgServers: value.qgServers.filter((item): item is string => typeof item === 'string' && item.trim() !== '') }
            : process.env.PROXY_SERVER?.trim() ? { qgServers: [process.env.PROXY_SERVER.trim()] } : {}),
          ...(typeof value.qgPort === 'number' && Number.isFinite(value.qgPort) ? { qgPort: Math.round(value.qgPort) } : process.env.PROXY_PORT !== undefined ? { qgPort: Number(process.env.PROXY_PORT) || 443 } : {}),
          ...(typeof value.qgChannel === 'string' && value.qgChannel.trim() !== '' ? { qgChannel: value.qgChannel.trim() } : {}),
          ...(typeof value.country === 'string' && value.country.trim() !== '' ? { country: value.country.trim() } : {}),
          ...(environmentNetworkMode('NET_GS') !== undefined && (typeof value.netScholar !== 'string' || value.netScholar.trim() === '') ? { netScholar: environmentNetworkMode('NET_GS') } : {}),
          ...(environmentNetworkMode('NET_SEMSCH') !== undefined && (typeof value.netSemanticScholar !== 'string' || value.netSemanticScholar.trim() === '') ? { netSemanticScholar: environmentNetworkMode('NET_SEMSCH'), netSemSch: environmentNetworkMode('NET_SEMSCH') } : {}),
          ...(environmentNetworkMode('NET_ARXIV') !== undefined && (typeof value.netArxiv !== 'string' || value.netArxiv.trim() === '') ? { netArxiv: environmentNetworkMode('NET_ARXIV') } : {}),
          ...(environmentNetworkMode('NET_CROSSREF') !== undefined && (typeof value.netCrossref !== 'string' || value.netCrossref.trim() === '') ? { netCrossref: environmentNetworkMode('NET_CROSSREF') } : {}),
          ...(environmentNetworkMode('NET_OPENALEX') !== undefined && (typeof value.netOpenAlex !== 'string' || value.netOpenAlex.trim() === '') ? { netOpenAlex: environmentNetworkMode('NET_OPENALEX') } : {}),
          ...(environmentNetworkMode('NET_DBLP') !== undefined && (typeof value.netDblp !== 'string' || value.netDblp.trim() === '') ? { netDblp: environmentNetworkMode('NET_DBLP') } : {}),
          ...(environmentNetworkMode('NET_DEEPSEEK') !== undefined && (typeof value.netDeepSeek !== 'string' || value.netDeepSeek.trim() === '') ? { netDeepSeek: environmentNetworkMode('NET_DEEPSEEK') } : {}),
          ...(environmentValue('DS_API_URL', 'DEEPSEEK_API_URL') !== undefined && cleanURL(value.deepseekURL) === '' ? { deepseekURL: environmentValue('DS_API_URL', 'DEEPSEEK_API_URL') } : {}),
          ...(environmentValue('DS_MODEL', 'DEEPSEEK_MODEL') !== undefined && (typeof value.deepseekModel !== 'string' || value.deepseekModel.trim() === '') ? { deepseekModel: environmentValue('DS_MODEL', 'DEEPSEEK_MODEL') } : {}),
          ...(typeof value.delayMs === 'number' && Number.isFinite(value.delayMs) ? { delayMs: Math.max(0, Math.round(value.delayMs)) } : { delayMs: 1200 }),
          ...(typeof value.maxRetries === 'number' && Number.isFinite(value.maxRetries) ? { maxRetries: Math.min(Math.max(1, Math.round(value.maxRetries)), 6) } : { maxRetries: 3 }),
          enrich: value.enrich !== false,
          ...(typeof value.maxEnrichmentRounds === 'number' && Number.isFinite(value.maxEnrichmentRounds) ? { maxEnrichmentRounds: Math.min(Math.max(1, Math.round(value.maxEnrichmentRounds)), 3) } : { maxEnrichmentRounds: 1 }),
          includeAuthorProfiles: value.includeAuthorProfiles === true,
          ...(typeof value.recursiveDepth === 'number' && Number.isFinite(value.recursiveDepth) ? { recursiveDepth: Math.min(Math.max(0, Math.round(value.recursiveDepth)), 3) } : { recursiveDepth: 0 }),
          ...(typeof value.recursiveWidth === 'number' && Number.isFinite(value.recursiveWidth) ? { recursiveWidth: Math.min(Math.max(1, Math.round(value.recursiveWidth)), 20) } : { recursiveWidth: 5 }),
          ...(typeof value.recursiveMaxTotal === 'number' && Number.isFinite(value.recursiveMaxTotal) ? { recursiveMaxTotal: Math.min(Math.max(1, Math.round(value.recursiveMaxTotal)), 100) } : { recursiveMaxTotal: 50 }),
          fetchBibtex: value.fetchBibtex !== false,
          fetchArxiv: value.fetchArxiv !== false,
          fetchArxivHTML: value.fetchArxivHTML !== false,
          deepseekEnrich: value.deepseekEnrich === true,
          ...(cleanURL(value.deepseekURL) !== '' ? { deepseekURL: cleanURL(value.deepseekURL) } : {}),
          ...(typeof value.deepseekModel === 'string' && value.deepseekModel.trim() !== '' ? { deepseekModel: value.deepseekModel.trim() } : {}),
          ...(typeof value.cacheFile === 'string' && value.cacheFile.trim() !== '' ? { cacheFile: value.cacheFile.trim() } : {}),
          ...(typeof value.cacheTTLHours === 'number' && Number.isFinite(value.cacheTTLHours) ? { cacheTTLHours: Math.max(1, value.cacheTTLHours) } : { cacheTTLHours: 24 }),
        }
  }
  return { activeProvider, providers, academicProvider, academicProviders, userConfigured: source.userConfigured === true }
}

function requireURL(raw: string, provider: WebSearchProviderId): string {
  const value = cleanURL(raw)
  if (value === '') throw new Error(`${PROVIDER_META[provider].name} 需要配置服务地址`)
  let url: URL
  try { url = new URL(value) } catch { throw new Error(`${PROVIDER_META[provider].name} 服务地址不是有效 URL`) }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('搜索服务地址只允许 http 或 https')
  return value
}

function managedStatusFallback(id: ManagedSearchBackendId): ManagedSearchBackendStatus {
  return { id, managed: true, installable: true, installed: false, running: false, endpoint: '', state: 'stopped' }
}

function appendPath(baseURL: string, path: string): string {
  return `${baseURL.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

function appendVersionedPath(baseURL: string, path: string): string {
  const normalized = baseURL.replace(/\/+$/, '')
  return appendPath(normalized.endsWith('/v1') ? normalized : appendPath(normalized, 'v1'), path)
}

async function resolveCredential(ctx: Context, name: string | undefined): Promise<string | undefined> {
  if (name === undefined || name === '') return undefined
  try {
    const credentials = ctx.get('credentials') as { resolve?(ref: string): Promise<{ value?: string } | undefined> } | undefined
    const hit = credentials?.resolve !== undefined ? await credentials.resolve(name) : undefined
    if (typeof hit?.value === 'string' && hit.value !== '') return hit.value
  } catch { /* 凭据服务不可用时回退环境变量 */ }
  const value = process.env[name]
  return value !== undefined && value !== '' ? value : undefined
}

async function resolveCredentialAliases(ctx: Context, names: string[]): Promise<string | undefined> {
  for (const name of names) {
    const value = await resolveCredential(ctx, name)
    if (value !== undefined) return value
  }
  return undefined
}

async function requestJson(
  input: string,
  init: RequestInit,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20000)
  const abort = () => controller.abort(signal?.reason)
  if (signal !== undefined) {
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
  }
  try {
    const response = await fetch(input, { ...init, signal: controller.signal })
    const text = await response.text()
    if (!response.ok) throw new Error(`${response.status} ${text.slice(0, 240)}`)
    if (text.trim() === '') return {}
    try { return JSON.parse(text) as Record<string, unknown> } catch { throw new Error('服务返回的不是 JSON') }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
  }
}

function source(url: unknown, title?: unknown, snippet?: unknown, publishedAt?: unknown): WebSearchSource | undefined {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return undefined
  return {
    url,
    ...(typeof title === 'string' && title !== '' ? { title } : {}),
    ...(typeof snippet === 'string' && snippet !== '' ? { snippet } : {}),
    ...(typeof publishedAt === 'string' && publishedAt !== '' ? { publishedAt } : {}),
  }
}

function tavilyResult(body: Record<string, unknown>): WebSearchResult {
  const results = Array.isArray(body.results) ? body.results : []
  const sources = results.map((item) => {
    const value = isObject(item) ? item : {}
    return source(value.url, value.title, value.content, value.published_date)
  }).filter((item): item is WebSearchSource => item !== undefined)
  return { sources, truncated: false, ...(typeof body.answer === 'string' && body.answer !== '' ? { content: body.answer } : {}) }
}

function braveResult(body: Record<string, unknown>): WebSearchResult {
  const web = isObject(body.web) && Array.isArray(body.web.results) ? body.web.results : []
  const sources = web.map((item) => {
    const value = isObject(item) ? item : {}
    return source(value.url, value.title, value.description, value.age)
  }).filter((item): item is WebSearchSource => item !== undefined)
  return { sources, truncated: false }
}

function serperResult(body: Record<string, unknown>): WebSearchResult {
  const organic = Array.isArray(body.organic) ? body.organic : []
  const sources = organic.map((item) => {
    const value = isObject(item) ? item : {}
    return source(value.link, value.title, value.snippet, value.date)
  }).filter((item): item is WebSearchSource => item !== undefined)
  return { sources, truncated: false }
}

function searxngResult(body: Record<string, unknown>): WebSearchResult {
  const results = Array.isArray(body.results) ? body.results : []
  const sources = results.map((item) => {
    const value = isObject(item) ? item : {}
    return source(value.url, value.title, value.content, value.publishedDate)
  }).filter((item): item is WebSearchSource => item !== undefined)
  return { sources, truncated: false }
}

function parallelResult(body: Record<string, unknown>): WebSearchResult {
  const results = Array.isArray(body.results) ? body.results : []
  const sources = results.map((item) => {
    const value = isObject(item) ? item : {}
    const excerpts = Array.isArray(value.excerpts) ? value.excerpts.filter((item): item is string => typeof item === 'string') : []
    return source(value.url, value.title, excerpts.join('\n\n'), value.publish_date)
  }).filter((item): item is WebSearchSource => item !== undefined)
  return { sources, truncated: false }
}

function exaResult(body: Record<string, unknown>): WebSearchResult {
  const results = Array.isArray(body.results) ? body.results : []
  const sources = results.map((item) => {
    const value = isObject(item) ? item : {}
    const highlights = Array.isArray(value.highlights) ? value.highlights.filter((item): item is string => typeof item === 'string') : []
    const snippet = highlights.length > 0 ? highlights.join('\n\n') : value.text
    return source(value.url, value.title, snippet, value.publishedDate)
  }).filter((item): item is WebSearchSource => item !== undefined)
  return { sources, truncated: false }
}

function openWebSearchResult(body: Record<string, unknown>): WebSearchResult {
  const envelope = isObject(body.data) ? body.data : body
  const results = Array.isArray(envelope.results) ? envelope.results : []
  const sources = results.map((item) => {
    const value = isObject(item) ? item : {}
    return source(value.url, value.title, value.description, value.publishedAt)
  }).filter((item): item is WebSearchSource => item !== undefined)
  if (body.status === 'error') {
    const error = isObject(body.error) && typeof body.error.message === 'string' ? body.error.message : 'Open-WebSearch 返回错误'
    throw new Error(error)
  }
  return { sources, truncated: false }
}

function openSerpResult(body: Record<string, unknown>): WebSearchResult {
  const results = Array.isArray(body.results) ? body.results : []
  const sources = results.map((item) => {
    const value = isObject(item) ? item : {}
    return source(value.url, value.title, value.snippet, value.publishedAt)
  }).filter((item): item is WebSearchSource => item !== undefined)
  return { sources, truncated: false }
}

function managedMcpResult(body: unknown, name: string): WebSearchResult {
  const envelope = isObject(body) && isObject(body.result) ? body.result : body
  if (!isObject(envelope)) throw new Error(`${name} 返回了无法解析的 MCP 响应`)
  if (envelope.isError === true) throw new Error(`${name} 搜索失败`)
  let payload: Record<string, unknown> | undefined = isObject(envelope.structuredContent) ? envelope.structuredContent : undefined
  const content = Array.isArray(envelope.content) ? envelope.content : []
  if (payload === undefined) {
    for (const block of content) {
      if (!isObject(block) || typeof block.text !== 'string') continue
      try {
        const parsed = JSON.parse(block.text) as unknown
        if (isObject(parsed)) { payload = parsed; break }
      } catch { /* MCP 文本结果可能是 Markdown，继续解析后续块 */ }
    }
  }
  if (payload === undefined) throw new Error(`${name} 没有返回可解析的结构化结果`)
  if (payload.success === false) throw new Error(typeof payload.error === 'string' ? payload.error : `${name} 搜索失败`)
  const rawResults = Array.isArray(payload.results) ? payload.results : Array.isArray(payload.sources) ? payload.sources : []
  const sources = rawResults.map((item) => {
    const value = isObject(item) ? item : {}
    return source(value.url ?? value.link, value.title, value.snippet ?? value.description ?? value.content, value.publishedAt ?? value.published_date)
  }).filter((item): item is WebSearchSource => item !== undefined)
  const markdown = typeof payload.markdown === 'string' ? payload.markdown : typeof payload.answer === 'string' ? payload.answer : undefined
  if (sources.length === 0 && markdown === undefined) throw new Error(`${name} 没有返回搜索来源`)
  return { sources, truncated: false, ...(markdown !== undefined ? { content: markdown } : {}) }
}

function openSerpSearchURL(baseURL: string): string {
  const normalized = baseURL.replace(/\/+$/, '')
  // 支持把服务根地址写成 http://127.0.0.1:7000，也支持直接写到
  // http://127.0.0.1:7000/google，以便以后切换其它 OpenSERP 引擎。
  return /\/(google|yandex|baidu|bing|duckduckgo|ecosia)$/i.test(normalized)
    ? appendPath(normalized, 'search')
    : appendPath(normalized, 'google/search')
}

function deepseekResult(body: Record<string, unknown>): WebSearchResult {
  const content = Array.isArray(body.content) ? body.content : []
  const snippets = new Map<string, string>()
  for (const block of content) {
    if (!isObject(block) || block.type !== 'text' || !Array.isArray(block.citations)) continue
    for (const citation of block.citations) {
      if (!isObject(citation) || typeof citation.url !== 'string' || typeof citation.cited_text !== 'string') continue
      snippets.set(citation.url, citation.cited_text)
    }
  }
  const sources: WebSearchSource[] = []
  for (const block of content) {
    if (!isObject(block) || block.type !== 'web_search_tool_result' || !Array.isArray(block.content)) continue
    for (const item of block.content) {
      if (!isObject(item) || item.type !== 'web_search_result') continue
      const value = source(item.url, item.title, snippets.get(String(item.url)), item.page_age)
      if (value !== undefined) sources.push(value)
    }
  }
  return { sources, truncated: false }
}

function openAIResult(body: Record<string, unknown>): WebSearchResult {
  const output = Array.isArray(body.output) ? body.output : []
  const sources: WebSearchSource[] = []
  const seen = new Set<string>()
  let content = ''
  const addSource = (value: unknown, title?: unknown, snippet?: unknown) => {
    const item = source(value, title, snippet)
    if (item !== undefined && !seen.has(item.url)) {
      seen.add(item.url)
      sources.push(item)
    }
  }
  for (const item of output) {
    if (!isObject(item)) continue
    if (item.type === 'web_search_call') {
      const action = isObject(item.action) ? item.action : {}
      const actionSources = Array.isArray(action.sources) ? action.sources : []
      for (const result of actionSources) {
        const value = isObject(result) ? result : {}
        addSource(value.url, value.title, value.snippet)
      }
    }
    if (item.type !== 'message' || !Array.isArray(item.content)) continue
    for (const block of item.content) {
      if (!isObject(block) || block.type !== 'output_text') continue
      if (typeof block.text === 'string' && block.text !== '') content += `${content === '' ? '' : '\n\n'}${block.text}`
      const annotations = Array.isArray(block.annotations) ? block.annotations : []
      for (const annotation of annotations) {
        if (!isObject(annotation) || annotation.type !== 'url_citation') continue
        addSource(annotation.url, annotation.title)
      }
    }
  }
  return { sources, truncated: false, ...(content !== '' ? { content } : {}) }
}

function mcpPayload(body: Record<string, unknown>): Record<string, unknown> {
  const result = isObject(body.result) ? body.result : body
  const structured = isObject(result.structuredContent) ? result.structuredContent : undefined
  if (structured !== undefined) return structured
  const content = Array.isArray(result.content) ? result.content : []
  for (const block of content) {
    if (!isObject(block) || typeof block.text !== 'string') continue
    try {
      const parsed = JSON.parse(block.text) as unknown
      if (isObject(parsed)) return parsed
    } catch { /* MCP 文本块可能是 Markdown，继续尝试下一个块 */ }
  }
  throw new Error('Parallel Search MCP 没有返回可解析的结构化结果')
}

async function requestMcp(
  input: string,
  payload: Record<string, unknown>,
  options: { apiKey?: string; sessionId?: string; protocolVersion?: string; signal?: AbortSignal } = {},
): Promise<{ body: Record<string, unknown>; sessionId?: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20000)
  const abort = () => controller.abort(options.signal?.reason)
  if (options.signal !== undefined) {
    if (options.signal.aborted) abort()
    else options.signal.addEventListener('abort', abort, { once: true })
  }
  try {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    }
    if (options.apiKey !== undefined) headers.authorization = `Bearer ${options.apiKey}`
    if (options.sessionId !== undefined) headers['Mcp-Session-Id'] = options.sessionId
    if (options.protocolVersion !== undefined) headers['MCP-Protocol-Version'] = options.protocolVersion
    const response = await fetch(input, { method: 'POST', headers, body: JSON.stringify(payload), signal: controller.signal })
    const text = await response.text()
    if (!response.ok) throw new Error(`${response.status} ${text.slice(0, 240)}`)
    if (text.trim() === '') return { body: {}, sessionId: response.headers?.get('mcp-session-id') ?? undefined }
    const candidates = text.trim().startsWith('{') ? [text.trim()] : text.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).reverse()
    for (const candidate of candidates) {
      try {
        const body = JSON.parse(candidate) as unknown
        if (isObject(body)) return { body, sessionId: response.headers?.get('mcp-session-id') ?? undefined }
      } catch { /* 尝试下一个 SSE data 块 */ }
    }
    throw new Error('Parallel Search MCP 返回的不是 JSON-RPC JSON')
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', abort)
  }
}

async function parallelMcpSearch(baseURL: string, key: string | undefined, query: string, signal?: AbortSignal): Promise<WebSearchResult> {
  const protocolVersion = '2025-03-26'
  const init = await requestMcp(baseURL, {
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion, capabilities: {}, clientInfo: { name: 'evoresearch', version: '0.1.0' } },
  }, { apiKey: key, protocolVersion, signal })
  const sessionId = init.sessionId
  if (sessionId === undefined) throw new Error('Parallel Search MCP 没有返回会话 ID')
  await requestMcp(baseURL, { jsonrpc: '2.0', method: 'notifications/initialized', params: {} }, { apiKey: key, sessionId, protocolVersion, signal })
  const call = await requestMcp(baseURL, {
    jsonrpc: '2.0', id: 2, method: 'tools/call',
    params: { name: 'web_search', arguments: { objective: query, search_queries: [query], session_id: randomUUID() } },
  }, { apiKey: key, sessionId, protocolVersion, signal })
  if (isObject(call.body.result) && call.body.result.isError === true) throw new Error('Parallel Search MCP 搜索请求失败')
  return parallelResult(mcpPayload(call.body))
}

export class ConfiguredWebSearchProvider {
  readonly id = WEB_SEARCH_PROVIDER_ID
  private readonly ctx: Context
  private readonly managers: Partial<Record<ManagedSearchBackendId, ManagedSearchManager>>

  constructor(ctx: Context, manager?: OpenWebSearchManager) {
    this.ctx = ctx
    this.managers = manager === undefined ? {} : { openwebsearch: manager }
  }

  setManagedManager(id: Exclude<ManagedSearchBackendId, 'openwebsearch'>, manager: ManagedSearchManager): void {
    this.managers[id] = manager
  }

  private manager(id: ManagedSearchBackendId): ManagedSearchManager | undefined { return this.managers[id] }

  async initializeSelectedBackend(): Promise<void> {
    const config = this.settings()
    const selectedURL = cleanURL(config.providers.openwebsearch?.baseURL) || OPENWEBSEARCH_DEFAULT_URL
    const manager = this.manager('openwebsearch')
    if (manager !== undefined && config.activeProvider === 'openwebsearch' && selectedURL === OPENWEBSEARCH_DEFAULT_URL) await manager.ensureRunning()
  }

  /** 选择由本 Provider 在 search() 时读取；无配置时也保持工具 schema 稳定。 */
  available(): boolean { return true }

  private settings(): WebSearchSettings {
    const settings = this.ctx.get('settings') as { get?(namespace: string): unknown } | undefined
    return normalizeSettings(settings?.get?.(WEB_SEARCH_SETTINGS_NAMESPACE))
  }

  async publicSettings(): Promise<WebSearchPublicSettings> {
    const config = this.settings()
    const providers: WebSearchPublicProvider[] = []
    for (const id of WEB_SEARCH_PROVIDER_IDS) {
      const meta = PROVIDER_META[id]
      const current = config.providers[id] ?? {}
      const keyPresent = meta.apiKeyEnv !== undefined && await resolveCredential(this.ctx, meta.apiKeyEnv) !== undefined
      const managedStatus = meta.managed === undefined ? undefined : await (this.manager(meta.managed)?.status() ?? Promise.resolve(managedStatusFallback(meta.managed)))
      providers.push({
        id,
        name: meta.name,
        description: meta.description,
        baseURL: cleanURL(current.baseURL) || meta.defaultURL,
        ...(meta.apiKeyEnv !== undefined ? { apiKeyEnv: meta.apiKeyEnv } : {}),
        requiresKey: meta.requiresKey,
        ...(meta.apiKeyEnv !== undefined && !meta.requiresKey ? { apiKeyOptional: true } : {}),
        configured: meta.requiresKey ? keyPresent : meta.managed !== undefined ? managedStatus?.installed === true : cleanURL(current.baseURL) !== '',
        freeTier: meta.freeTier,
        ...(meta.managed !== undefined && managedStatus !== undefined ? {
          managed: managedStatus.managed,
          installable: managedStatus.installable,
          installed: managedStatus.installed,
          running: managedStatus.running,
          runtimeState: managedStatus.state,
          runtimeKind: meta.runtimeKind,
          ...(managedStatus.endpoint !== '' ? { runtimeEndpoint: managedStatus.endpoint } : {}),
          ...(managedStatus.message !== undefined ? { runtimeMessage: managedStatus.message } : {}),
        } : {}),
      })
    }
    const academicProviders = await Promise.all(ACADEMIC_PROVIDER_IDS.map(async (id): Promise<AcademicSearchPublicProvider> => {
      const meta = ACADEMIC_PROVIDER_META[id]
      const current = config.academicProviders[id] ?? {}
      const credentials = await Promise.all(ACADEMIC_CREDENTIALS[id].map(async (credential) => ({
        ...credential,
        configured: await resolveCredentialAliases(this.ctx, credential.env === 'SEMANTIC_SCHOLAR_API_KEY'
          ? ['SEMANTIC_SCHOLAR_API_KEY', 'SEM_SCH_KEY']
          : credential.env === 'DEEPSEEK_API_KEY'
            ? ['DEEPSEEK_API_KEY', 'DS_API_KEY']
            : [credential.env]) !== undefined,
      })))
      return {
        id,
        name: meta.name,
        description: meta.description,
        freeTier: meta.freeTier,
        baseURL: cleanURL(id === 'autorelatedwork' ? current.scholarURL : current.baseURL) || meta.baseURL,
        settings: {
          ...(id === 'openalex-crossref' ? { crossrefURL: cleanURL(current.crossrefURL) || CROSSREF_DEFAULT_URL } : {}),
          ...(id === 'autorelatedwork' ? {
            scholarURL: cleanURL(current.scholarURL) || AUTORELATEDWORK_DEFAULT_SCHOLAR_URL,
            ...(cleanURL(current.localProxy) !== '' ? { localProxy: current.localProxy } : {}),
            ...(current.qgServers !== undefined ? { qgServers: current.qgServers } : {}),
            ...(current.qgPort !== undefined ? { qgPort: current.qgPort } : {}),
            ...(current.qgChannel !== undefined ? { qgChannel: current.qgChannel } : {}),
            ...(current.country !== undefined ? { country: current.country } : {}),
            ...(current.delayMs !== undefined ? { delayMs: current.delayMs } : {}),
            enrich: current.enrich !== false,
            ...(current.maxRetries !== undefined ? { maxRetries: current.maxRetries } : {}),
            ...(current.maxEnrichmentRounds !== undefined ? { maxEnrichmentRounds: current.maxEnrichmentRounds } : {}),
            ...(current.includeAuthorProfiles !== undefined ? { includeAuthorProfiles: current.includeAuthorProfiles } : {}),
            ...(current.recursiveDepth !== undefined ? { recursiveDepth: current.recursiveDepth } : {}),
            ...(current.recursiveWidth !== undefined ? { recursiveWidth: current.recursiveWidth } : {}),
            ...(current.recursiveMaxTotal !== undefined ? { recursiveMaxTotal: current.recursiveMaxTotal } : {}),
            fetchBibtex: current.fetchBibtex !== false,
            fetchArxiv: current.fetchArxiv !== false,
            fetchArxivHTML: current.fetchArxivHTML !== false,
            ...(current.deepseekEnrich !== undefined ? { deepseekEnrich: current.deepseekEnrich } : {}),
            ...(cleanURL(current.deepseekURL) !== '' ? { deepseekURL: current.deepseekURL } : {}),
            ...(typeof current.deepseekModel === 'string' && current.deepseekModel.trim() !== '' ? { deepseekModel: current.deepseekModel } : {}),
            ...(current.netScholar !== undefined ? { netScholar: current.netScholar } : {}),
            ...(current.netSemanticScholar !== undefined ? { netSemanticScholar: current.netSemanticScholar } : {}),
            ...(current.netSemSch !== undefined ? { netSemSch: current.netSemSch } : {}),
            ...(current.netArxiv !== undefined ? { netArxiv: current.netArxiv } : {}),
            ...(current.netCrossref !== undefined ? { netCrossref: current.netCrossref } : {}),
            ...(current.netOpenAlex !== undefined ? { netOpenAlex: current.netOpenAlex } : {}),
            ...(current.netDblp !== undefined ? { netDblp: current.netDblp } : {}),
            ...(current.netUnpaywall !== undefined ? { netUnpaywall: current.netUnpaywall } : {}),
            ...(current.netDeepSeek !== undefined ? { netDeepSeek: current.netDeepSeek } : {}),
          } : {}),
        },
        configured: id === 'openalex-crossref' || cleanURL(current.scholarURL) !== '' || credentials.some((credential) => credential.configured),
        credentials,
      }
    }))
    return { activeProvider: config.activeProvider, providers, academicProvider: config.academicProvider, academicProviders }
  }

  async saveSettings(input: { activeProvider: ActiveWebSearchProvider; providers: Record<string, unknown>; academicProvider?: ActiveAcademicSearchProvider; academicProviders?: Record<string, unknown>; apiKeys?: Record<string, unknown>; academicApiKeys?: Record<string, unknown>; clearKeys?: string[] }): Promise<WebSearchPublicSettings> {
    if (input.activeProvider !== 'none' && !validProvider(input.activeProvider)) throw new Error('未知的搜索 Provider')
    if (input.academicProvider !== undefined && input.academicProvider !== 'none' && !(ACADEMIC_PROVIDER_IDS as readonly string[]).includes(input.academicProvider)) throw new Error('未知的学术搜索 Provider')
    const providers: WebSearchSettings['providers'] = {}
    for (const id of WEB_SEARCH_PROVIDER_IDS) {
      const raw = isObject(input.providers?.[id]) ? input.providers[id] : {}
      providers[id] = {
        baseURL: cleanURL(raw.baseURL) || PROVIDER_META[id].defaultURL,
        ...(typeof raw.model === 'string' && raw.model.trim() !== '' ? { model: raw.model.trim() } : {}),
      }
      if (input.activeProvider === id && PROVIDER_META[id].managed === undefined) requireURL(providers[id]?.baseURL ?? '', id)
    }
    const existing = this.settings()
    const academicProvider = input.academicProvider ?? existing.academicProvider
    const academicProviders: WebSearchSettings['academicProviders'] = {}
    for (const id of ACADEMIC_PROVIDER_IDS) {
      const raw = isObject(input.academicProviders?.[id]) ? input.academicProviders[id] : {}
      const previous = existing.academicProviders[id] ?? {}
      academicProviders[id] = id === 'openalex-crossref'
        ? {
            baseURL: cleanURL(raw.baseURL) || cleanURL(previous.baseURL) || OPENALEX_DEFAULT_URL,
            crossrefURL: cleanURL(raw.crossrefURL) || cleanURL(previous.crossrefURL) || CROSSREF_DEFAULT_URL,
          }
        : {
            scholarURL: cleanURL(raw.scholarURL) || cleanURL(previous.scholarURL) || AUTORELATEDWORK_DEFAULT_SCHOLAR_URL,
            ...(cleanURL(raw.localProxy) !== '' ? { localProxy: cleanURL(raw.localProxy) } : cleanURL(previous.localProxy) !== '' ? { localProxy: cleanURL(previous.localProxy) } : {}),
            ...(Array.isArray(raw.qgServers) ? { qgServers: raw.qgServers.filter((item): item is string => typeof item === 'string' && item.trim() !== '') } : previous.qgServers !== undefined ? { qgServers: previous.qgServers } : {}),
            ...(typeof raw.qgPort === 'number' ? { qgPort: Math.round(raw.qgPort) } : previous.qgPort !== undefined ? { qgPort: previous.qgPort } : {}),
            ...(typeof raw.qgChannel === 'string' && raw.qgChannel.trim() !== '' ? { qgChannel: raw.qgChannel.trim() } : previous.qgChannel !== undefined ? { qgChannel: previous.qgChannel } : {}),
            ...(typeof raw.country === 'string' && raw.country.trim() !== '' ? { country: raw.country.trim() } : previous.country !== undefined ? { country: previous.country } : {}),
            ...(typeof raw.delayMs === 'number' ? { delayMs: Math.max(0, Math.round(raw.delayMs)) } : previous.delayMs !== undefined ? { delayMs: previous.delayMs } : { delayMs: 1200 }),
            ...(typeof raw.maxRetries === 'number' ? { maxRetries: Math.min(Math.max(1, Math.round(raw.maxRetries)), 6) } : previous.maxRetries !== undefined ? { maxRetries: previous.maxRetries } : { maxRetries: 3 }),
            enrich: raw.enrich !== false,
            ...(typeof raw.maxEnrichmentRounds === 'number' ? { maxEnrichmentRounds: Math.min(Math.max(1, Math.round(raw.maxEnrichmentRounds)), 3) } : previous.maxEnrichmentRounds !== undefined ? { maxEnrichmentRounds: previous.maxEnrichmentRounds } : { maxEnrichmentRounds: 1 }),
            includeAuthorProfiles: raw.includeAuthorProfiles === true,
            ...(typeof raw.recursiveDepth === 'number' ? { recursiveDepth: Math.min(Math.max(0, Math.round(raw.recursiveDepth)), 3) } : previous.recursiveDepth !== undefined ? { recursiveDepth: previous.recursiveDepth } : { recursiveDepth: 0 }),
            ...(typeof raw.recursiveWidth === 'number' ? { recursiveWidth: Math.min(Math.max(1, Math.round(raw.recursiveWidth)), 20) } : previous.recursiveWidth !== undefined ? { recursiveWidth: previous.recursiveWidth } : { recursiveWidth: 5 }),
            ...(typeof raw.recursiveMaxTotal === 'number' ? { recursiveMaxTotal: Math.min(Math.max(1, Math.round(raw.recursiveMaxTotal)), 100) } : previous.recursiveMaxTotal !== undefined ? { recursiveMaxTotal: previous.recursiveMaxTotal } : { recursiveMaxTotal: 50 }),
            fetchBibtex: raw.fetchBibtex !== false,
            fetchArxiv: raw.fetchArxiv !== false,
            fetchArxivHTML: raw.fetchArxivHTML !== false,
            deepseekEnrich: raw.deepseekEnrich === true,
            ...(cleanURL(raw.deepseekURL) !== '' ? { deepseekURL: cleanURL(raw.deepseekURL) } : cleanURL(previous.deepseekURL) !== '' ? { deepseekURL: cleanURL(previous.deepseekURL) } : {}),
            ...(typeof raw.deepseekModel === 'string' && raw.deepseekModel.trim() !== '' ? { deepseekModel: raw.deepseekModel.trim() } : typeof previous.deepseekModel === 'string' && previous.deepseekModel.trim() !== '' ? { deepseekModel: previous.deepseekModel.trim() } : {}),
            ...(typeof raw.cacheFile === 'string' && raw.cacheFile.trim() !== '' ? { cacheFile: raw.cacheFile.trim() } : previous.cacheFile !== undefined ? { cacheFile: previous.cacheFile } : {}),
            ...(typeof raw.cacheTTLHours === 'number' ? { cacheTTLHours: Math.max(1, raw.cacheTTLHours) } : previous.cacheTTLHours !== undefined ? { cacheTTLHours: previous.cacheTTLHours } : { cacheTTLHours: 24 }),
          }
      if (academicProvider === id && id === 'openalex-crossref') {
        requireURL(academicProviders[id]?.baseURL ?? '', 'searxng')
        requireURL(academicProviders[id]?.crossrefURL ?? '', 'searxng')
      }
      if (academicProvider === id && id === 'autorelatedwork') requireURL(academicProviders[id]?.scholarURL ?? '', 'searxng')
    }
    const settings = this.ctx.get('settings') as { replace?(namespace: string, value: object): Promise<unknown> } | undefined
    if (settings?.replace === undefined) throw new Error('settings 服务不可用')
    await settings.replace(WEB_SEARCH_SETTINGS_NAMESPACE, { activeProvider: input.activeProvider, providers, academicProvider, academicProviders, userConfigured: true })
    const selectedURL = cleanURL(providers.openwebsearch?.baseURL) || OPENWEBSEARCH_DEFAULT_URL
    if (input.activeProvider === 'openwebsearch' && selectedURL === OPENWEBSEARCH_DEFAULT_URL) await this.manager('openwebsearch')?.ensureRunning()
    const credentials = this.ctx.get('credentials') as { set?(ref: string, value: string): Promise<unknown>; unset?(ref: string): Promise<unknown> } | undefined
    for (const id of WEB_SEARCH_PROVIDER_IDS) {
      const ref = PROVIDER_META[id].apiKeyEnv
      if (ref === undefined) continue
      const value = input.apiKeys?.[id]
      if (typeof value === 'string' && value.trim() !== '') {
        if (credentials?.set === undefined) throw new Error('credentials 服务不可用，无法保存 API Key')
        await credentials.set(ref, value.trim())
      }
      if (Array.isArray(input.clearKeys) && input.clearKeys.includes(id) && credentials?.unset !== undefined) await credentials.unset(ref)
    }
    for (const id of ACADEMIC_PROVIDER_IDS) {
      for (const definition of ACADEMIC_CREDENTIALS[id]) {
        const value = input.academicApiKeys?.[definition.id]
        if (typeof value === 'string' && value.trim() !== '') {
          if (credentials?.set === undefined) throw new Error('credentials 服务不可用，无法保存学术搜索凭据')
          await credentials.set(definition.env, value.trim())
        }
        if (Array.isArray(input.clearKeys) && input.clearKeys.includes(`academic:${definition.id}`) && credentials?.unset !== undefined) await credentials.unset(definition.env)
      }
    }
    return this.publicSettings()
  }

  private selectedManagedManager(): ManagedSearchManager {
    const active = this.settings().activeProvider
    const meta = validProvider(active) ? PROVIDER_META[active] : undefined
    const manager = meta?.managed === undefined ? undefined : this.manager(meta.managed)
    if (manager === undefined) throw new Error('当前搜索方式不是 EvoResearch 可托管的本地后端')
    return manager
  }

  async webSearchBackendStatus(): Promise<ManagedSearchBackendStatus> {
    return this.selectedManagedManager().status()
  }

  async webSearchBackendInstall(): Promise<ManagedSearchBackendStatus> {
    const manager = this.selectedManagedManager()
    await manager.install()
    return manager.status()
  }

  async webSearchBackendStart(): Promise<ManagedSearchBackendStatus> {
    const manager = this.selectedManagedManager()
    await manager.ensureRunning()
    return manager.status()
  }

  async webSearchBackendStop(): Promise<ManagedSearchBackendStatus> {
    const manager = this.selectedManagedManager()
    await manager.stop()
    return manager.status()
  }

  async test(query: string, signal?: AbortSignal): Promise<WebSearchResult> {
    const text = query.trim()
    if (text === '') throw new Error('搜索测试词不能为空')
    const config = this.settings()
    const id = config.activeProvider
    if (id === 'none') throw new Error('尚未选择联网搜索 Provider')
    const provider = config.providers[id] ?? {}
    const meta = PROVIDER_META[id]
    const key = await resolveCredential(this.ctx, meta.apiKeyEnv)
    if (meta.requiresKey && meta.apiKeyEnv !== undefined && key === undefined) throw new Error(`${meta.name} 尚未配置 ${meta.apiKeyEnv}`)
    const configuredURL = cleanURL(provider.baseURL) || meta.defaultURL
    const selectedManager = validProvider(id) ? PROVIDER_META[id].managed === undefined ? undefined : this.manager(PROVIDER_META[id].managed) : undefined
    const baseURL = id === 'openwebsearch' && configuredURL === OPENWEBSEARCH_DEFAULT_URL && selectedManager !== undefined
      ? await selectedManager.ensureRunning() as string
      : PROVIDER_META[id].managed !== undefined ? configuredURL : requireURL(configuredURL, id)
    if (id === 'tavily') {
      return tavilyResult(await requestJson(appendPath(baseURL, 'search'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ api_key: key, query: text, max_results: 8, include_answer: false }) }, signal))
    }
    if (id === 'brave') {
      const url = new URL(appendPath(baseURL, 'res/v1/web/search'))
      url.searchParams.set('q', text); url.searchParams.set('count', '8')
      return braveResult(await requestJson(url.toString(), { headers: { accept: 'application/json', 'x-subscription-token': key as string } }, signal))
    }
    if (id === 'serper') {
      return serperResult(await requestJson(appendPath(baseURL, 'search'), { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key as string }, body: JSON.stringify({ q: text, num: 8 }) }, signal))
    }
    if (id === 'deepseek') {
      const body = await requestJson(appendPath(baseURL, 'messages'), { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key as string, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: provider.model || 'deepseek-v4-flash', max_tokens: 4096, messages: [{ role: 'user', content: `Perform a web search for the query: ${text}` }], tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }] }) }, signal)
      const result = deepseekResult(body)
      if (result.sources.length === 0) throw new Error('DeepSeek 没有返回结构化搜索结果')
      return result
    }
    if (id === 'openai') {
      const body = await requestJson(appendPath(baseURL, 'responses'), {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key as string}` },
        body: JSON.stringify({
          model: provider.model || 'gpt-5.5',
          tools: [{ type: 'web_search', search_context_size: 'low' }],
          tool_choice: 'required',
          include: ['web_search_call.action.sources'],
          input: text,
        }),
      }, signal)
      const result = openAIResult(body)
      if (result.sources.length === 0) throw new Error('OpenAI Web Search 没有返回结构化搜索来源')
      return result
    }
    if (id === 'parallel') {
      const body = await requestJson(appendVersionedPath(baseURL, 'search'), { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key as string }, body: JSON.stringify({ objective: text, search_queries: [text], mode: 'basic', max_results: 8 }) }, signal)
      return parallelResult(body)
    }
    if (id === 'parallel-mcp') return parallelMcpSearch(baseURL, key, text, signal)
    if (id === 'exa') {
      const body = await requestJson(appendPath(baseURL, 'search'), { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key as string }, body: JSON.stringify({ query: text, numResults: 8, contents: { highlights: { maxCharacters: 1200 } } }) }, signal)
      return exaResult(body)
    }
    if (id === 'openwebsearch') {
      const body = await requestJson(appendPath(baseURL, 'search'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: text, limit: 8 }) }, signal)
      return openWebSearchResult(body)
    }
    if (id === 'openserp') {
      const url = new URL(openSerpSearchURL(baseURL))
      url.searchParams.set('text', text)
      url.searchParams.set('limit', '8')
      url.searchParams.set('format', 'json')
      return openSerpResult(await requestJson(url.toString(), { headers: { accept: 'application/json' } }, signal))
    }
    if (id === 'google-ai-mode') {
      if (selectedManager?.search === undefined) throw new Error('Google AI Mode MCP 管理服务不可用')
      const body = await selectedManager.search('search_ai', { query: text, headless: true, timeout_ms: 120000 })
      return managedMcpResult(body, 'Google AI Mode MCP')
    }
    if (id === 'free-search') {
      if (selectedManager?.search === undefined) throw new Error('Free Search MCP 管理服务不可用')
      const body = await selectedManager.search('search', { query: text, max_results: 8, format: 'json' })
      return managedMcpResult(body, 'Free Search MCP')
    }
    const url = new URL(appendPath(baseURL, 'search'))
    url.searchParams.set('q', text); url.searchParams.set('format', 'json'); url.searchParams.set('language', 'all')
    return searxngResult(await requestJson(url.toString(), { headers: { accept: 'application/json' } }, signal))
  }

  async search(request: { query: string; maxResults?: number }, signal?: AbortSignal): Promise<WebSearchResult> {
    // 通用联网搜索永远使用用户选择的通用 Provider。论文检索由
    // searchAcademic/search_literature 单独调用，绝不因关键词偷偷换后端。
    const result = await this.test(request.query, signal)
    const max = typeof request.maxResults === 'number' && request.maxResults >= 0 ? request.maxResults : result.sources.length
    return result.sources.length > max ? { ...result, sources: result.sources.slice(0, max), truncated: true } : result
  }

  /**
   * 论文专用检索：读取独立的 academicProvider；通用 SERP 不参与此路由。
   */
  async searchAcademic(query: string, maxResults = 8, signal?: AbortSignal): Promise<AcademicSearchResult> {
    const text = query.trim()
    if (text === '') throw new Error('学术检索词不能为空')
    const config = this.settings()
    if (config.academicProvider === 'none') throw new Error('学术论文搜索已禁用')
    if (config.academicProvider === 'openalex-crossref') {
      const academic = config.academicProviders['openalex-crossref'] ?? {}
      return searchAcademicSources({
        openAlexURL: cleanURL(academic.baseURL) || OPENALEX_DEFAULT_URL,
        crossrefURL: cleanURL(academic.crossrefURL) || CROSSREF_DEFAULT_URL,
        query: text,
        limit: maxResults,
        signal,
      })
    }
    const academic = config.academicProviders.autorelatedwork ?? {}
    const credentials: Parameters<typeof searchAutoRelatedWork>[0]['credentials'] = {
      qgAuthKey: await resolveCredentialAliases(this.ctx, ['PROXY_AUTHKEY']),
      qgAuthPwd: await resolveCredentialAliases(this.ctx, ['PROXY_AUTHPWD']),
      semanticScholarApiKey: await resolveCredentialAliases(this.ctx, ['SEMANTIC_SCHOLAR_API_KEY', 'SEM_SCH_KEY']),
      unpaywallEmail: await resolveCredential(this.ctx, 'UNPAYWALL_EMAIL'),
      deepseekApiKey: await resolveCredentialAliases(this.ctx, ['DEEPSEEK_API_KEY', 'DS_API_KEY']),
      deepseekURL: environmentValue('DEEPSEEK_API_URL', 'DS_API_URL'),
    }
    return searchAutoRelatedWork({ query: text, limit: maxResults, config: academic, credentials, dataRoot: this.dataRoot(), signal })
  }

  /** 当前用户是否启用了联网搜索；web seam 本身仍保持稳定注册。 */
  enabled(): boolean { return this.settings().activeProvider !== 'none' }

  academicEnabled(): boolean { return this.settings().academicProvider !== 'none' }

  private dataRoot(): string | undefined {
    try {
      const memory = this.ctx.get('memory') as { config?: { dataRoot?: string } } | undefined
      return memory?.config?.dataRoot
    } catch { return undefined }
  }
}
