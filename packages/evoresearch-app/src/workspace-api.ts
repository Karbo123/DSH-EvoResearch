/**
 * 工作区文件 API（HTTP 路由，/evoresearch/fs/*）。
 *
 * 与官方 Remote 通道（$mount）解耦：参照 dsh-better-sidebar 的模式，
 * 经 ctx.webServer.register 提供 JSON API 与媒体路由，浏览器 fetch 调用。
 * 所有操作带信任栅栏（回环 + webRuntime.trustedHosts），写操作限制在
 * 请求声明的根目录内（isWithin 校验）。
 */
import { opendir, readFile, readdir, rm, stat, writeFile, mkdir } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { zstdDecompressSync } from 'node:zlib'
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { IncomingMessage, ServerResponse } from 'node:http'

/** 统计字节流中的行数（事件数近似；超长文件在调用侧已设上限）。 */
function countLines(buffer: Uint8Array): number {
  let count = 0
  for (const byte of buffer) if (byte === 10) count += 1
  return count + (buffer.length > 0 && buffer[buffer.length - 1] !== 10 ? 1 : 0)
}

const MEDIA_TYPES: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp', '.ico': 'image/x-icon', '.avif': 'image/avif',
  '.pdf': 'application/pdf', '.html': 'text/html', '.htm': 'text/html',
  '.md': 'text/markdown', '.txt': 'text/plain', '.json': 'application/json',
  '.ts': 'text/plain', '.tsx': 'text/plain', '.js': 'text/plain', '.mjs': 'text/plain',
  '.css': 'text/css', '.yml': 'text/plain', '.yaml': 'text/plain', '.rs': 'text/plain',
}

const MAX_READ_BYTES = 1 << 22 // 4 MiB 文本上限
const MAX_BODY_BYTES = 1 << 23 // 8 MiB 写请求上限（含 5MiB 文件上传的 base64）

interface FsEntry { name: string; path: string; isDir: boolean; hidden: boolean }

/** 目录优先、大小写不敏感排序（VSCode explorer 顺序）。 */
function compareEntries(a: FsEntry, b: FsEntry): number {
  if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
}

/** 规范化调用方路径为绝对路径（非绝对 → fs-error）。 */
function requireAbsolute(path: string): string {
  if (!path.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(path)) throw httpError(400, 'fs-error', `"${path}" 不是绝对路径`)
  return resolve(path)
}

/** target 是否位于 base 下（含相等；统一分隔符后比较；Windows 额外容忍大小写）。 */
function isWithin(target: string, base: string): boolean {
  const norm = (p: string) => {
    const unified = p.replace(/\\/g, '/')
    return process.platform === 'win32' ? unified.toLowerCase() : unified
  }
  const t = norm(target)
  const b = norm(base).replace(/\/+$/, '')
  return t === b || t.startsWith(`${b}/`)
}

function httpError(status: number, code: string, message: string): Error {
  const error = new Error(message) as Error & { status: number; code: string }
  error.status = status
  error.code = code
  return error
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk as Buffer)
    total += buffer.length
    if (total > MAX_BODY_BYTES) throw httpError(400, 'bad-request', '请求体过大')
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.trim() === '') return {}
  try { return JSON.parse(text) as Record<string, unknown> } catch { throw httpError(400, 'bad-request', 'JSON 解析失败') }
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function writeOk(res: ServerResponse, value: unknown): void {
  writeJson(res, 200, { ok: true, value })
}

function writeError(res: ServerResponse, error: unknown): void {
  const err = error as Error & { status?: number; code?: string }
  writeJson(res, err.status ?? 500, { ok: false, error: { code: err.code ?? 'internal', message: err.message ?? String(error) } })
}

function requireString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key]
  if (typeof value !== 'string' || value === '') throw httpError(400, 'bad-request', `缺少或非法 "${key}"`)
  return value
}

function writeSseHeaders(res: ServerResponse): void {
  res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' })
}

async function writeSseEvents(res: ServerResponse, events: unknown): Promise<void> {
  writeSseHeaders(res)
  const writeItem = async (item: unknown): Promise<boolean> => {
    if (item === null || typeof item !== 'object') return true
    const event = (item as { event?: unknown }).event
    const data = (item as { data?: unknown }).data
    if (typeof event !== 'string') return true
    if (res.destroyed || res.writableEnded) return false
    const accepted = res.write(`event: ${event}\ndata: ${JSON.stringify(data ?? {})}\n\n`)
    if (!accepted) await new Promise<void>((resolve) => res.once('drain', resolve))
    return !res.destroyed && !res.writableEnded
  }
  try {
    if (events !== null && typeof events === 'object' && Symbol.asyncIterator in events) {
      for await (const item of events as AsyncIterable<unknown>) if (!await writeItem(item)) break
    } else if (Array.isArray(events)) {
      for (const item of events) if (!await writeItem(item)) break
    }
  } finally {
    if (!res.writableEnded) res.end()
  }
}

const moduleRequire = createRequire(import.meta.url)

/** 从插件实际解析到的 package.json 读取版本；找不到时返回 undefined，不猜版本。 */
export function pluginPackageVersion(entry: any): string | undefined {
  const specifier = typeof entry?.options?.name === 'string' ? entry.options.name : ''
  if (specifier === '' || specifier.startsWith('cordis:')) return undefined
  const parts = specifier.split('/')
  const packageName = specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
  if (packageName === undefined || packageName === '') return undefined

  // loader 的 baseUrl 才是实际 profile 的解析上下文；仅使用 cwd 在
  // 从任意目录启动、或 DSH_HOME 位于另一目录时会漏掉 profile 依赖。
  const roots = [process.cwd()]
  const dshHome = process.env.DSH_HOME?.trim()
  if (dshHome !== undefined && dshHome !== '') roots.push(join(resolve(dshHome), 'profiles', 'evoresearch'))
  const baseUrls = [
    entry?.parent?.tree?.ctx?.baseUrl,
    entry?.parent?.ctx?.baseUrl,
    entry?.ctx?.baseUrl,
  ]
  for (const value of baseUrls) {
    if (typeof value !== 'string' || value === '') continue
    try {
      const basePath = value.startsWith('file:') ? fileURLToPath(value) : value
      roots.push(basePath)
    } catch { /* 无法转换的 baseUrl 由其他解析根兜底 */ }
  }

  const uniqueRoots = [...new Set(roots)]
  const resolvers = [moduleRequire]
  for (const root of uniqueRoots) {
    try { resolvers.push(createRequire(join(root, '__evoresearch-plugin-version__.cjs'))) } catch { /* 忽略无效解析根 */ }
  }
  const modulePaths: string[] = []
  const seenModules = new Set<string>()
  const addResolved = (resolved: string | undefined) => {
    if (resolved !== undefined && !seenModules.has(resolved)) {
      seenModules.add(resolved)
      modulePaths.push(resolved)
    }
  }
  for (const resolver of resolvers) {
    // package.json 是最准确的来源；这里使用公开的 package.json export，
    // 不从 lockfile 或包名字符串猜测版本。
    try { addResolved(resolver.resolve(`${packageName}/package.json`)) } catch { /* 某些旧包未导出 package.json */ }
    try { addResolved(resolver.resolve(specifier)) } catch { /* 继续尝试其他解析上下文 */ }
    for (const root of uniqueRoots) {
      try { addResolved(resolver.resolve(`${packageName}/package.json`, { paths: [root] })) } catch { /* 该搜索根未安装此包 */ }
      try { addResolved(resolver.resolve(specifier, { paths: [root] })) } catch { /* 该搜索根未安装此包 */ }
    }
  }

  for (const modulePath of modulePaths) {
    let directory = dirname(modulePath)
    while (true) {
      try {
        const pkg = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) as { name?: unknown; version?: unknown }
        if (pkg.name === packageName && typeof pkg.version === 'string' && pkg.version !== '') return pkg.version
      } catch { /* 继续向上查找包根 */ }
      const parent = dirname(directory)
      if (parent === directory) break
      directory = parent
    }
  }
  return undefined
}

/** 通过 DSH 凭据服务 / 环境变量解析 provider 的 API key（用于直接探测模型端点）。 */
async function resolveProviderApiKey(ctx: any, ref: string | undefined): Promise<string | undefined> {
  if (ref === undefined) return undefined
  try {
    const credentials = ctx.get('credentials')
    const hit = credentials?.resolve !== undefined ? await credentials.resolve(ref) : undefined
    if (hit?.value !== undefined && hit.value !== '') return hit.value
  } catch { /* 凭据服务不可用则回退环境变量 */ }
  const fromEnv = process.env[ref]
  return fromEnv !== undefined && fromEnv !== '' ? fromEnv : undefined
}

/** 探测 OpenAI 兼容模型端点：GET <baseURL>/models → 模型列表（失败抛错由调用方回退）。 */
async function fetchEndpointModels(
  baseURL: string,
  apiKey: string | undefined,
): Promise<Array<{ id: string; name?: string; contextWindow?: number; endpoints?: string[]; outputModalities?: string[] }>> {
  const url = `${baseURL.replace(/\/+$/, '')}/models`
  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
      ...(apiKey !== undefined ? { authorization: `Bearer ${apiKey}` } : {}),
    },
    signal: AbortSignal.timeout(8000),
  })
  if (!response.ok) throw new Error(`${url} answered ${response.status}`)
  const body = await response.json() as { data?: Array<Record<string, unknown>> }
  return (body.data ?? [])
    .filter((m) => typeof m?.id === 'string' && m.id !== '')
    .map((m) => {
      const endpoints = Array.isArray(m.supported_endpoint_types) ? (m.supported_endpoint_types as unknown[]).filter((x): x is string => typeof x === 'string') : undefined
      const outputModalities = Array.isArray(m.output_modalities) ? (m.output_modalities as unknown[]).filter((x): x is string => typeof x === 'string') : undefined
      return {
        id: m.id as string,
        name: typeof m.name === 'string' ? m.name : undefined,
        contextWindow: typeof m.context_window === 'number' ? m.context_window : (typeof m.contextWindow === 'number' ? m.contextWindow : null),
        ...(endpoints !== undefined && endpoints.length > 0 ? { endpoints } : {}),
        ...(outputModalities !== undefined && outputModalities.length > 0 ? { outputModalities } : {}),
      }
    })
}

/**
 * 为 OpenAI 兼容服务生成探测候选地址。
 *
 * 保留用户输入的地址作为第一候选：有些网关把 /models 直接挂在根路径，
 * 不能无条件追加 /v1。只有原地址不以 /v1 结尾时才追加第二候选。
 */
export function providerBaseUrlCandidates(baseURL: string): string[] {
  const normalized = baseURL.trim().replace(/\/+$/, '')
  if (/\/v1$/i.test(normalized)) return [normalized]
  return [normalized, `${normalized}/v1`]
}

/** 探测 provider，并返回真正成功的 baseURL，供保存配置时使用。 */
export async function probeProviderEndpoint(baseURL: string, apiKey?: string): Promise<{
  baseURL: string
  models: Array<{ id: string; name?: string; contextWindow?: number; endpoints?: string[]; outputModalities?: string[] }>
}> {
  let lastError: unknown
  for (const candidate of providerBaseUrlCandidates(baseURL)) {
    try {
      return { baseURL: candidate, models: await fetchEndpointModels(candidate, apiKey) }
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

/** 图片生成模型的常见命名特征（网关没有模态元数据时的兜底判定，避免把纯文本/视觉模型列进图片生成）。 */
const IMAGE_GEN_NAME_PATTERNS: RegExp[] = [
  /\bgpt-image/i,
  /\bdall-?e/i,
  /\bimagen\b/i,
  /\bflux\b/i,
  /\bstable-?diffusion/i,
  /\bsdxl\b/i,
  /\bmidjourney/i,
  /\bnano-?banana/i,
  /\brecraft/i,
  /\bideogram/i,
  /\bcogview/i,
  /\bpixart/i,
  /\bkolors\b/i,
  /\bseedream/i,
  /\bplayground-v/i,
  /\bimage(?:-|_)?(?:gen|generation)/i,
  /\bt2i\b/i,
  /\btext-?to-?image/i,
]

/**
 * 判定模型是否具备图片生成（输出图片）能力：
 * 1) 网关显式声明输出模态（output_modalities）——声明了但没有 image 即明确排除；
 * 2) 网关端点类型（supported_endpoint_types）含 image 类端点（如 new-api 的 images）；
 * 3) 兜底按模型名特征匹配。
 * 返回 null 表示未知（前端不据此放行图片生成）。
 */
function imageOutputModalities(id: string, endpoints: string[] | undefined, outputModalities: string[] | undefined): string[] | null {
  if (Array.isArray(outputModalities) && outputModalities.length > 0) {
    return outputModalities.includes('image') ? ['image'] : []
  }
  if (Array.isArray(endpoints) && endpoints.some((e) => /image/i.test(e))) return ['image']
  return IMAGE_GEN_NAME_PATTERNS.some((re) => re.test(id)) ? ['image'] : null
}

/**
 * 把目录里发现但尚未写入配置的模型注册进 llm-pi-ai provider。
 * pi-ai 适配器要求模型必须出现在 provider 的 models 配置里才能调用，
 * 而目录（网关 /models）与配置是两份数据——网关新增模型后不注册就会报
 * “pi-ai provider ... has no configured model ...”。注册只追加 {id}（其余字段
 * 由路由默认补齐，与既有模型一致），幂等，写入失败不阻塞调用方。
 */
async function ensureProviderModel(ctx: any, provider: string, modelId: string, displayName?: string): Promise<void> {
  const settings = ctx.get('settings')
  if (settings?.replace === undefined) return
  const section = llmPiAiSection(settings)
  const profile = section.providers[provider] as Record<string, unknown> | undefined
  if (profile === undefined) return
  const models = Array.isArray(profile.models) ? (profile.models as Array<Record<string, unknown>>) : []
  if (models.some((m) => m?.id === modelId)) return
  const next = [...models, { id: modelId, ...(displayName !== undefined && displayName !== '' ? { name: displayName } : {}) }]
  await withWriteRetry(() => settings.replace('llm-pi-ai', {
    providers: { ...section.providers, [provider]: { ...profile, models: next } },
  })).catch(() => { /* 注册失败不阻塞测试/保存 */ })
}

/** pi-ai 内置目录的完整推理档位顺序（与 getSupportedThinkingLevels 一致）。 */
const PI_THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

/** 按 pi-ai 语义从目录条目推导支持的推理档位（与 getSupportedThinkingLevels 完全一致）。 */
function piSupportedLevels(entry: Record<string, unknown>): string[] {
  if (entry.reasoning !== true) return ['off']
  const map = (entry.thinkingLevelMap ?? {}) as Record<string, unknown>
  return PI_THINKING_LEVELS.filter((level) => {
    const mapped = map[level]
    if (mapped === null) return false
    if (level === 'xhigh' || level === 'max') return mapped !== undefined
    return true
  })
}

/**
 * 读取 pi-ai 内置官方厂商档案（dist/providers/data/*.json），
 * 得到全部已登记模型 + 各自支持的推理档位，作为“参照官方档位”的候选名单。
 * 目录读不到时返回 null，由调用方回退到 llm 服务注册目录。
 */
interface ReasoningReference { id: string; name: string; provider: string; supportedReasoning: string[]; input: string[] }

async function loadBuiltinReasoningReferences(): Promise<ReasoningReference[] | null> {
  const candidates: string[] = []
  if (typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME !== '') {
    candidates.push(join(process.env.DSH_HOME, 'profiles/node_modules/@earendil-works/pi-ai/dist/providers/data'))
  }
  candidates.push(join(process.cwd(), 'profiles/node_modules/@earendil-works/pi-ai/dist/providers/data'))
  for (const dir of candidates) {
    try {
      const files = await readdir(dir)
      const refs: ReasoningReference[] = []
      const seen = new Set<string>()
      for (const file of files) {
        if (!file.endsWith('.json') || file === '.manifest.json') continue
        let text: string
        try { text = await readFile(join(dir, file), 'utf8') } catch { continue }
        let groups: unknown
        try { groups = JSON.parse(text) } catch { continue }
        if (groups === null || typeof groups !== 'object') continue
        const provider = file.replace(/\.json$/, '')
        for (const models of Object.values(groups as Record<string, unknown>)) {
          if (models === null || typeof models !== 'object') continue
          for (const [id, entry] of Object.entries(models as Record<string, unknown>)) {
            if (entry === null || typeof entry !== 'object') continue
            const levels = piSupportedLevels(entry as Record<string, unknown>)
            if (levels.length === 0) continue
            if (seen.has(id)) continue
            seen.add(id)
            const entryObj = entry as Record<string, unknown>
            refs.push({
              id,
              name: typeof entryObj.name === 'string' ? entryObj.name as string : id,
              provider,
              supportedReasoning: levels,
              input: Array.isArray(entryObj.input) ? (entryObj.input as unknown[]).filter((x): x is string => typeof x === 'string') : [],
            })
          }
        }
      }
      if (refs.length > 0) return refs
    } catch { /* 该候选目录不可读 → 尝试下一个 */ }
  }
  return null
}

/**
 * 读取 pi-ai 内置厂商档案，按模型名收集输入模态（不限是否有推理档位）。
 * 用户要求模态按“模型名称”而不是 provider/URL 查找：官方档案里同名模型
 * 声明的模态，就是该模型实际能力的权威参照。目录读不到时返回 null。
 */
async function loadBuiltinInputs(): Promise<Map<string, string[]> | null> {
  const candidates: string[] = []
  if (typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME !== '') {
    candidates.push(join(process.env.DSH_HOME, 'profiles/node_modules/@earendil-works/pi-ai/dist/providers/data'))
  }
  candidates.push(join(process.cwd(), 'profiles/node_modules/@earendil-works/pi-ai/dist/providers/data'))
  for (const dir of candidates) {
    try {
      const files = await readdir(dir)
      const map = new Map<string, string[]>()
      for (const file of files) {
        if (!file.endsWith('.json') || file === '.manifest.json') continue
        let text: string
        try { text = await readFile(join(dir, file), 'utf8') } catch { continue }
        let groups: unknown
        try { groups = JSON.parse(text) } catch { continue }
        if (groups === null || typeof groups !== 'object') continue
        for (const models of Object.values(groups as Record<string, unknown>)) {
          if (models === null || typeof models !== 'object') continue
          for (const [id, entry] of Object.entries(models as Record<string, unknown>)) {
            if (entry === null || typeof entry !== 'object') continue
            const input = (entry as Record<string, unknown>).input
            if (!Array.isArray(input)) continue
            const modalities = input.filter((x): x is string => typeof x === 'string')
            if (modalities.length === 0 || map.has(id)) continue
            map.set(id, modalities)
          }
        }
      }
      if (map.size > 0) return map
    } catch { /* 该候选目录不可读 → 尝试下一个 */ }
  }
  return null
}

/** 回退方案：从 llm 服务已注册 provider 的目录里收集带推理元数据的模型。 */
async function llmServiceReasoningReferences(llm: any, providers: Array<{ id: string }>): Promise<ReasoningReference[]> {
  const refs: ReasoningReference[] = []
  const seen = new Set<string>()
  for (const provider of providers) {
    let models: Array<{ id?: string; name?: string }> = []
    try { models = (await llm.listModels(provider.id)) ?? [] } catch { continue }
    for (const m of models) {
      const id = typeof m.id === 'string' ? m.id : ''
      if (id === '' || seen.has(id)) continue
      try {
        const info = await llm.resolveModelInfo(provider.id, id, AbortSignal.timeout(5000))
        const efforts = info?.reasoning?.efforts
        if (Array.isArray(efforts) && efforts.length > 0) {
          seen.add(id)
          refs.push({
            id,
            name: typeof m.name === 'string' && m.name !== '' ? m.name : id,
            provider: provider.id,
            supportedReasoning: efforts.map((e: { id?: unknown }) => (typeof e?.id === 'string' ? e.id : '')).filter((rid: string) => rid !== ''),
            input: Array.isArray(info?.inputModalities) ? (info.inputModalities as unknown[]).filter((x): x is string => typeof x === 'string') : [],
          })
        }
      } catch { /* 该模型无目录元数据 → 跳过 */ }
    }
  }
  return refs
}

/** 读取 llm-pi-ai 命名空间的当前配置（优先原始用户层，避免把解析默认值写回文件）。 */
function llmPiAiSection(settings: any): { providers: Record<string, any> } {
  try {
    const raw = settings?.document?.['llm-pi-ai']
    if (raw !== undefined && raw !== null && typeof raw === 'object') {
      return { providers: (raw as { providers?: Record<string, any> }).providers ?? {} }
    }
  } catch { /* 原始层不可读 → 回退解析层 */ }
  try {
    const resolved = settings?.get?.('llm-pi-ai') as { providers?: Record<string, any> } | undefined
    return { providers: resolved?.providers ?? {} }
  } catch {
    return { providers: {} }
  }
}

/**
 * 为 provider 保存操作创建可写副本。
 * DSH settings 的 document/resolved 配置可能被冻结；保存路由不能原地
 * 新增、删除或修改 provider，否则新增 provider 会抛出 "object is not extensible"。
 */
export function cloneLlmProviders(source: unknown): Record<string, any> {
  if (source === null || typeof source !== 'object' || Array.isArray(source)) return {}
  const providers: Record<string, any> = {}
  for (const [id, value] of Object.entries(source as Record<string, unknown>)) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      providers[id] = value
      continue
    }
    const profile = { ...(value as Record<string, unknown>) }
    if (Array.isArray(profile.models)) {
      profile.models = profile.models.map((model) => (
        model !== null && typeof model === 'object' && !Array.isArray(model)
          ? { ...(model as Record<string, unknown>) }
          : model
      ))
    }
    providers[id] = profile
  }
  return providers
}

/** 规范化模型条目：只保留 id / name / contextWindow / maxTokens / reasoningEfforts，丢弃空字段。 */
function sanitizeModelEntry(m: unknown): { id: string; name?: string; contextWindow?: number; maxTokens?: number; reasoningEfforts?: Record<string, string | null> | false } | null {
  const entry = m as { id?: unknown; name?: unknown; contextWindow?: unknown; maxTokens?: unknown; reasoningEfforts?: unknown } | null
  if (entry === null || typeof entry !== 'object' || typeof entry.id !== 'string' || entry.id === '') return null
  const out: { id: string; name?: string; contextWindow?: number; maxTokens?: number; reasoningEfforts?: Record<string, string | null> | false } = { id: entry.id }
  if (typeof entry.name === 'string' && entry.name !== '') out.name = entry.name
  if (typeof entry.contextWindow === 'number' && Number.isFinite(entry.contextWindow) && entry.contextWindow > 0) out.contextWindow = entry.contextWindow
  if (typeof entry.maxTokens === 'number' && Number.isFinite(entry.maxTokens) && entry.maxTokens > 0) out.maxTokens = entry.maxTokens
  if (entry.reasoningEfforts === false) {
    out.reasoningEfforts = false
  } else if (entry.reasoningEfforts !== undefined && entry.reasoningEfforts !== null && typeof entry.reasoningEfforts === 'object') {
    const efforts: Record<string, string | null> = {}
    for (const [level, wire] of Object.entries(entry.reasoningEfforts)) {
      if (wire === null || wire === undefined) efforts[level] = null
      else if (typeof wire === 'string' && wire !== '') efforts[level] = wire
    }
    if (Object.keys(efforts).length > 0) out.reasoningEfforts = efforts
  }
  return out
}

/** 有限并发地映射数组：保证并发数不超过 limit，任一失败直接抛出。 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor
      cursor += 1
      if (index >= items.length) return
      out[index] = await fn(items[index], index)
    }
  })
  await Promise.all(workers)
  return out
}

/**
 * 瞬态 Windows 文件锁（Defender / 文件监视器在 rename 提交瞬间短暂占用目标文件）
 * 下重试原子写入；EPERM / EBUSY / EACCES / ENOENT 视为可重试码。
 * 不修改第三方依赖，保证其他用户构建后同样生效。
 */
async function withWriteRetry<T>(fn: () => Promise<T>, attempts = 8): Promise<T> {
  let lastError: unknown
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn()
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code
      if (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES' && code !== 'ENOENT') throw error
      lastError = error
      await new Promise((r) => setTimeout(r, 100 + i * 120))
    }
  }
  throw lastError
}

/** 信任栅栏：回环 Host 或 webRuntime.trustedHosts 允许的权威。 */
function trusted(req: IncomingMessage, trustedHosts: string[]): boolean {
  const host = req.headers.host ?? ''
  const hostname = host.split(':')[0].toLowerCase()
  if (hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1') return true
  return trustedHosts.some((authority) => {
    const a = authority.split(':')[0].toLowerCase()
    return a === hostname
  })
}

/**
 * CSRF 栅栏：浏览器跨站请求必带 Origin；同源请求（或非浏览器客户端）
 * 的 Origin 要么缺失要么与本站 Host 一致。仅校验 Host 时，恶意网页可以
 * 用受害者浏览器向 /fs/read|write 发起跨站调用读取任意本机文件。
 */
function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin
  if (origin === undefined) return true // 非浏览器客户端 / 同源 GET 导航
  const host = (req.headers.host ?? '').toLowerCase()
  try {
    return new URL(origin).host.toLowerCase() === host
  } catch {
    return false
  }
}

/** 注册 /evoresearch/fs/* 路由。 */
export function registerWorkspaceApi(ctx: any): void {
  const webServer = ctx.get('webServer')
  if (webServer === undefined) return

  ctx.effect(() => webServer.register({
    kind: 'prefix',
    path: '/evoresearch/fs',
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      const trustedHosts: string[] = ctx.get('webRuntime')?.trustedHosts ?? []
      if (!trusted(req, trustedHosts) || !sameOrigin(req)) {
        writeJson(res, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } })
        return
      }
      const url = new URL(req.url ?? '/', 'http://dsh.internal')
      const pathname = url.pathname
      const method = pathname.startsWith('/evoresearch/fs/') ? pathname.slice('/evoresearch/fs/'.length) : undefined
      const evoresearch = ctx.get('evoresearch') as Record<string, (args?: unknown) => unknown> | undefined

      try {
        // GET /evoresearch/fs/file?path= → 媒体/文本文件流
        if (req.method === 'GET' && method === 'file') {
          const target = requireAbsolute(url.searchParams.get('path') ?? '')
          const buffer = await readFile(target)
          const type = MEDIA_TYPES[extname(target).toLowerCase()] ?? 'application/octet-stream'
          // §27.2：SVG/HTML 等可执行内容预览响应必须加 sandbox CSP 与 nosniff
          const headers: Record<string, string> = { 'content-type': type, 'content-length': String(buffer.length) }
          if (type === 'text/html' || type === 'image/svg+xml') {
            headers['content-security-policy'] = 'sandbox'
            headers['x-content-type-options'] = 'nosniff'
          }
          res.writeHead(200, headers)
          res.end(buffer)
          return
        }
        // GET /evoresearch/fs/mode → 当前默认权限预设
        if (req.method === 'GET' && method === 'mode') {
          const permission = ctx.get('permissionPresets')
          writeOk(res, { preset: permission?.defaultPreset ?? null })
          return
        }
        // AutoRelatedWork 与原 Flask API 对齐的只读 GET 端点。
        if (req.method === 'GET' && (method === 'auto-related-work/health' || method === 'auto-related-work/config' || method === 'auto-related-work/cache-stats')) {
          const serviceMethod = method === 'auto-related-work/health' ? 'autoRelatedWorkHealth' : method === 'auto-related-work/config' ? 'autoRelatedWorkConfigGet' : 'autoRelatedWorkCacheStats'
          if (evoresearch?.[serviceMethod] === undefined) throw httpError(400, 'method-error', 'AutoRelatedWork 服务不可用')
          writeOk(res, await evoresearch[serviceMethod]())
          return
        }
        if (req.method !== 'POST') {
          writeJson(res, 405, { ok: false, error: { code: 'method-error', message: 'method not allowed' } })
          return
        }
        const payload = await readJsonBody(req)

        // POST /evoresearch/fs/list {root} → 单层目录
        if (method === 'list') {
          const root = requireAbsolute(requireString(payload, 'root'))
          let level
          try { level = await opendir(root) } catch (error) {
            throw httpError(400, 'fs-error', `无法列出 "${root}": ${(error as Error).message}`)
          }
          const entries: FsEntry[] = []
          for await (const dirent of level) {
            entries.push({
              name: dirent.name,
              path: join(root, dirent.name),
              isDir: dirent.isDirectory(),
              hidden: dirent.name.startsWith('.'),
            })
          }
          entries.sort(compareEntries)
          writeOk(res, { root, entries })
          return
        }

        // POST /evoresearch/fs/read {path} → 文本内容
        if (method === 'read') {
          const target = requireAbsolute(requireString(payload, 'path'))
          const buffer = await readFile(target)
          if (buffer.length > MAX_READ_BYTES) throw httpError(400, 'fs-error', '文件过大（>4MiB）')
          writeOk(res, { path: target, text: buffer.toString('utf8') })
          return
        }

        // POST /evoresearch/fs/list-tree {root} → 递归目录（移植规范 §27.1：
        // 上限 2000 项、深度 12、目录优先、隐藏 dotfile 与常见构建产物不列）
        if (method === 'list-tree') {
          const root = requireAbsolute(requireString(payload, 'root'))
          const SKIP_DIRS = new Set(['.git', '.evosci-data', '.evoresearch-data', 'node_modules', '.venv', '__pycache__', '.next', 'dist', 'build', '.cache', '.idea', '.vscode'])
          const SKIP_FILES = new Set(['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'])
          const MAX_ITEMS = 2000
          const MAX_DEPTH = 12
          const entries: Array<{ path: string; isDir: boolean }> = []
          const walk = async (dir: string, depth: number): Promise<void> => {
            if (depth > MAX_DEPTH || entries.length >= MAX_ITEMS) return
            let level
            try { level = await opendir(dir) } catch { return }
            const items: Array<{ name: string; isDir: boolean }> = []
            for await (const dirent of level) {
              if (dirent.name.startsWith('.')) continue
              if (dirent.isDirectory() && SKIP_DIRS.has(dirent.name)) continue
              if (!dirent.isDirectory() && SKIP_FILES.has(dirent.name)) continue
              items.push({ name: dirent.name, isDir: dirent.isDirectory() })
            }
            items.sort((a, b) => (a.isDir !== b.isDir ? (a.isDir ? -1 : 1) : a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })))
            for (const item of items) {
              if (entries.length >= MAX_ITEMS) return
              const full = join(dir, item.name)
              entries.push({ path: full, isDir: item.isDir })
              if (item.isDir) await walk(full, depth + 1)
            }
          }
          await walk(root, 0)
          writeOk(res, { root, entries, truncated: entries.length >= MAX_ITEMS })
          return
        }

        // POST /evoresearch/fs/write {root, path, text} → 写文件（限制在 root 内；
        // text 允许空串——新建空文件/清空内容均是合法操作；自动创建父目录）
        if (method === 'write') {
          const root = requireAbsolute(requireString(payload, 'root'))
          const target = requireAbsolute(requireString(payload, 'path'))
          if (!isWithin(target, root)) throw httpError(403, 'forbidden', `写入路径超出根目录: ${target}`)
          if (typeof payload.text !== 'string') throw httpError(400, 'bad-request', '缺少或非法 "text"')
          await mkdir(dirname(target), { recursive: true })
          await writeFile(target, payload.text, 'utf8')
          writeOk(res, { path: target })
          return
        }

        // POST /evoresearch/fs/upload {root, path(相对), data(base64)} → 上传单文件（§27.2：
        // 相对路径可含子目录、单文件 ≤5MB、路径越界/穿越拒绝）
        if (method === 'upload') {
          const root = requireAbsolute(requireString(payload, 'root'))
          const rel = requireString(payload, 'path')
          if (rel.includes('..') || rel.startsWith('/') || /^[A-Za-z]:/.test(rel)) throw httpError(400, 'fs-error', '非法相对路径')
          const target = resolve(root, rel)
          if (!isWithin(target, root)) throw httpError(403, 'forbidden', '上传路径超出根目录')
          const data = requireString(payload, 'data')
          const bytes = Buffer.from(data, 'base64')
          if (bytes.length > 5 * 1024 * 1024) throw httpError(400, 'fs-error', '单文件最大 5MB')
          await mkdir(dirname(target), { recursive: true })
          await writeFile(target, bytes)
          writeOk(res, { path: target })
          return
        }

        // POST /evoresearch/fs/zip {root} → workspace ZIP 下载（§27.2：隐藏 dotfile 与
        // 常见构建产物不打包；总大小上限 50MB）
        if (method === 'zip') {
          const root = requireAbsolute(requireString(payload, 'root'))
          const { zipSync } = await import('fflate')
          const SKIP_DIRS = new Set(['.git', '.evosci-data', '.evoresearch-data', 'node_modules', '.venv', '__pycache__', '.next', 'dist', 'build', '.cache'])
          const files: Record<string, Uint8Array> = {}
          let total = 0
          const walk = async (dir: string, prefix: string): Promise<void> => {
            let level
            try { level = await opendir(dir) } catch { return }
            for await (const dirent of level) {
              if (dirent.name.startsWith('.') || SKIP_DIRS.has(dirent.name)) continue
              const full = join(dir, dirent.name)
              const rel = prefix === '' ? dirent.name : `${prefix}/${dirent.name}`
              if (dirent.isDirectory()) {
                await walk(full, rel)
              } else if (dirent.isFile()) {
                try {
                  const data = await readFile(full)
                  total += data.length
                  if (total > 50 * 1024 * 1024) throw httpError(400, 'fs-error', 'workspace 过大（>50MB），请缩小范围')
                  files[rel] = data
                } catch (error) {
                  if ((error as Error & { status?: number }).status !== undefined) throw error
                }
              }
            }
          }
          await walk(root, '')
          const zipped = zipSync(files)
          writeOk(res, { data: Buffer.from(zipped).toString('base64'), count: Object.keys(files).length })
          return
        }

        // POST /evoresearch/plugins → 插件清单（loader entries 快照）
        if (method === 'plugins') {
          const entries = []
          for (const entry of ctx.get('loader')?.entries?.() ?? []) {
            entries.push({
              id: entry.options?.name ?? entry.name ?? String(entry),
              state: entry.fiber === undefined ? 'loading' : String(entry.fiber.state ?? ''),
              version: pluginPackageVersion(entry) ?? null,
            })
          }
          writeOk(res, { plugins: entries })
          return
        }

        // POST /evoresearch/models → 当前默认模型（含匹配到的代码档与推理强度）；
        // /models/select → 保存默认模型
        if (method === 'models') {
          const agentDefaultModel = ctx.get('agentDefaultModel')
          const selection = agentDefaultModel?.currentSelection?.() ?? { provider: null, model: null }
          // 推理强度：当前选择命中 model-settings 的代码档时带回 tier / reasoningEffort，
          // 便于输入框下方展示“模型 · 推理等级”；未命中（自定义模型）时置空。
          let tier: string | null = null
          let reasoningEffort: string | null = null
          try {
            const evoresearch = ctx.get('evoresearch') as { modelSettingsGet?: () => Promise<unknown> } | undefined
            if (evoresearch?.modelSettingsGet !== undefined) {
              const settings = await evoresearch.modelSettingsGet() as { code?: Record<string, { provider?: string; model?: string; reasoningEffort?: string }>; defaultTier?: string } | undefined
              const code = settings?.code ?? {}
              // 角色是权威：用户最近一次实际选择的角色决定“当前”归属，
              // 不按模型名重新匹配——即使多个角色模型相同、或之后在设置面板里
              // 修改了各角色对应的模型，角色身份保持不变（defaultTier 在应用角色时持久化）。
              const stored = typeof settings?.defaultTier === 'string' && ['utility', 'coder', 'planner', 'writer'].includes(settings.defaultTier)
                ? settings.defaultTier
                : null
              if (stored !== null) {
                const cfg = code[stored]
                if (cfg !== undefined && cfg.provider !== undefined && cfg.provider !== '' && cfg.model !== undefined && cfg.model !== '') {
                  tier = stored
                  reasoningEffort = cfg.reasoningEffort ?? null
                }
              }
              // 未记录角色或当前模型已变化（不再匹配已存角色）时，回退到按模型匹配。
              if (tier === null) {
                for (const t of ['utility', 'coder', 'planner', 'writer'] as const) {
                  const cfg = code[t]
                  if (cfg !== undefined && cfg.provider === selection.provider && cfg.model === selection.model) {
                    tier = t
                    reasoningEffort = cfg.reasoningEffort ?? null
                    break
                  }
                }
              }
            }
          } catch { /* 模型设置读取失败不影响当前模型展示 */ }
          writeOk(res, { ...selection, tier, reasoningEffort })
          return
        }
        if (method === 'models/select') {
          const agentDefaultModel = ctx.get('agentDefaultModel')
          if (agentDefaultModel?.saveSelection === undefined) throw httpError(400, 'method-error', 'agentDefaultModel 不可用')
          const provider = requireString(payload, 'provider')
          const model = requireString(payload, 'model')
          // 若选中的模型尚未出现在 llm-pi-ai 的 provider.models 配置里，自动补写，
          // 否则 pi-ai 请求时无法解析该模型（settings.yaml 是唯一的路由来源）。
          // 配置写入失败不阻塞默认模型的保存。
          try {
            const settings = ctx.get('settings')
            const section = settings?.get?.('llm-pi-ai') as { providers?: Record<string, { models?: Array<{ id?: string }> }> } | undefined
            const profile = section?.providers?.[provider]
            if (settings?.update !== undefined && profile !== undefined) {
              const configured = profile.models ?? []
              if (!configured.some((m) => m.id === model)) {
                await withWriteRetry(() => settings.update('llm-pi-ai', {
                  providers: { [provider]: { models: [...configured, { id: model }] } },
                }))
              }
            }
          } catch { /* 模型目录写入失败不影响默认模型保存 */ }
          await agentDefaultModel.saveSelection({
            provider,
            model,
          })
          writeOk(res, { saved: true })
          return
        }

        // POST /evoresearch/models-catalog → 模型目录（§25.2 模型选择器）：
        // 实时探测各 provider 的 <baseURL>/models 端点（优先 llm.discoverModels，
        // 自动带 DSH 凭据；失败则直接 fetch）。端点可用时以远端列表为唯一来源，
        // 本地配置只作为端点不可达时的回退目录，避免把过时/错误的手写模型混进选择器。
        // 顺带用 llm.resolveModelInfo 解析每个模型支持的推理档位（pi-ai 目录元数据），
        // 失败不影响列表，前端据此禁用该模型不支持的档位。
        if (method === 'models-catalog') {
          const llm = ctx.get('llm')
          if (llm?.listProviders === undefined) throw httpError(400, 'method-error', 'llm 服务不可用')
          const settings = ctx.get('settings')
          let profiles: Record<string, { baseURL?: string; apiKeyEnv?: string }> = {}
          let settingsRead = false
          try {
            const section = settings?.get?.('llm-pi-ai') as { providers?: Record<string, { baseURL?: string; apiKeyEnv?: string }> } | undefined
            profiles = section?.providers ?? {}
            settingsRead = true
          } catch { /* 设置服务不可用 → 回退全部注册 provider */ }
          const allProviders = llm.listProviders()
          // 模型选择器只展示用户在「模型提供商」里自己配置的 provider；
          // DSH 内置的 deepseek-official（官方 api.deepseek.com）不在配置里，因此不展示。
          // 仅当设置服务不可读时才回退为全部注册 provider。
          const providers = settingsRead
            ? allProviders.filter((p: { id: string }) => profiles[p.id] !== undefined)
            : allProviders
          // 参照官方档位候选名单：优先 pi-ai 内置厂商档案，读不到时回退 llm 服务注册目录
          const references = (await loadBuiltinReasoningReferences())
            ?? (await llmServiceReasoningReferences(llm, allProviders))
          const referenceById = new Map<string, ReasoningReference>()
          for (const ref of references) {
            if (!referenceById.has(ref.id)) referenceById.set(ref.id, ref)
          }
          // 输入模态按模型名从官方档案查找（用户要求不按 provider/URL 查）
          const inputById = (await loadBuiltinInputs()) ?? new Map<string, string[]>()
          const groups: unknown[] = []
          for (const provider of providers) {
            const profile = profiles[provider.id]
            let raw: Array<{ id: string; name: string; contextWindow: number | null; input: string[] | null; endpoints?: string[]; outputModalities?: string[] }> = []
            try {
              let listed: Array<{ id?: string; name?: string; contextWindow?: number; supported_endpoint_types?: unknown; output_modalities?: unknown }> | null = null
              // 1) DSH 模型发现：经 llm.discoverModels 读取端点（自动带凭据）
              if (llm.discoverModels !== undefined && profile?.baseURL !== undefined) {
                try {
                  const discovered = await llm.discoverModels('llm-pi-ai', { provider: provider.id, baseURL: profile.baseURL })
                  listed = discovered ?? null
                } catch { /* 端点拒绝 → 直接探测回退 */ }
              }
              // 2) 直接 fetch 回退（不依赖 discovery 注册）
              if (listed === null && profile?.baseURL !== undefined) {
                try {
                  const apiKey = await resolveProviderApiKey(ctx, profile.apiKeyEnv)
                  listed = (await probeProviderEndpoint(profile.baseURL, apiKey)).models
                } catch { /* 端点无目录 */ }
              }
              const seen = new Set<string>()
              if (listed !== null && listed.length > 0) {
                // 3) 远端为准：端点返回的模型就是唯一目录
                for (const m of listed) {
                  const id = typeof m.id === 'string' ? m.id : ''
                  if (id === '' || seen.has(id)) continue
                  seen.add(id)
                  const endpoints = Array.isArray(m.supported_endpoint_types) ? (m.supported_endpoint_types as unknown[]).filter((x): x is string => typeof x === 'string') : undefined
                  const outputModalities = Array.isArray(m.output_modalities) ? (m.output_modalities as unknown[]).filter((x): x is string => typeof x === 'string') : undefined
                  raw.push({
                    id,
                    name: typeof m.name === 'string' && m.name !== '' ? m.name : id,
                    contextWindow: typeof m.contextWindow === 'number' ? m.contextWindow : null,
                    input: null,
                    ...(endpoints !== undefined && endpoints.length > 0 ? { endpoints } : {}),
                    ...(outputModalities !== undefined && outputModalities.length > 0 ? { outputModalities } : {}),
                  })
                }
              } else {
                // 4) 端点不可达 → 回退配置内目录（仅此情况使用本地配置）
                const configured = await llm.listModels(provider.id)
                for (const m of (configured ?? []) as Array<{ id?: string; name?: string; contextWindow?: number; inputModalities?: string[]; supported_endpoint_types?: unknown; output_modalities?: unknown }>) {
                  const id = typeof m.id === 'string' ? m.id : ''
                  if (id === '' || seen.has(id)) continue
                  seen.add(id)
                  const endpoints = Array.isArray(m.supported_endpoint_types) ? (m.supported_endpoint_types as unknown[]).filter((x): x is string => typeof x === 'string') : undefined
                  const outputModalities = Array.isArray(m.output_modalities) ? (m.output_modalities as unknown[]).filter((x): x is string => typeof x === 'string') : undefined
                  raw.push({
                    id,
                    name: typeof m.name === 'string' && m.name !== '' ? m.name : id,
                    contextWindow: typeof m.contextWindow === 'number' ? m.contextWindow : null,
                    input: Array.isArray(m.inputModalities) ? m.inputModalities.filter((x): x is string => typeof x === 'string') : null,
                    ...(endpoints !== undefined && endpoints.length > 0 ? { endpoints } : {}),
                    ...(outputModalities !== undefined && outputModalities.length > 0 ? { outputModalities } : {}),
                  })
                }
              }
            } catch { /* 该 provider 无目录 */ }
            if (raw.length === 0) continue
            // 5) 逐模型解析支持的推理档位（有限并发 + 超时；目录元数据缺失时返回 null）
            const models = await mapWithConcurrency(raw, 6, async (m) => {
              let supportedReasoning: string[] | null = null
              let input: string[] | null = null
              let output: string[] | null = null
              try {
                const info = await llm.resolveModelInfo(provider.id, m.id, AbortSignal.timeout(5000))
                const efforts = info?.reasoning?.efforts
                if (Array.isArray(efforts) && efforts.length > 0) {
                  supportedReasoning = efforts.map((e: { id?: unknown }) => (typeof e?.id === 'string' ? e.id : '')).filter((id: string) => id !== '')
                }
                if (Array.isArray(info?.inputModalities) && info.inputModalities.length > 0) {
                  input = (info.inputModalities as unknown[]).filter((x): x is string => typeof x === 'string')
                }
                if (Array.isArray(info?.outputModalities) && info.outputModalities.length > 0) {
                  output = (info.outputModalities as unknown[]).filter((x): x is string => typeof x === 'string')
                }
              } catch { /* 无目录元数据或解析失败 → 不限制档位 */ }
              if (supportedReasoning === null) {
                // 网关/自定义路由拿不到自身目录元数据时，严格按名字在 pi-ai 内置档案里
                // 找同名模型（例如 new-api 上的 deepseek-v4-flash → off/high/max）。
                // 只在名字真正被收录时才给出提示；未收录的模型交给前端“参照官方档位”选择。
                const hit = referenceById.get(m.id)
                if (hit !== undefined) supportedReasoning = hit.supportedReasoning
              }
              // pi-ai 对没有官方档案的 provider（如 new-api）无法询问网关模态，
              // 会一律返回默认 ["text"]。此时按模型名在官方档案里查同名模型，
              // 只要档案声明了模态就以其为准（例如 mimo-v2-omni → text+image）。
              const nameHit = inputById.get(m.id)
              if (nameHit !== undefined && nameHit.length > 0) {
                if (input === null || input.length === 0 || (input.length === 1 && input[0] === 'text')) {
                  input = nameHit
                }
              }
              if (output === null) {
                output = imageOutputModalities(m.id, m.endpoints, m.outputModalities)
              }
              return { ...m, supportedReasoning, input, output }
            })
            if (models.length > 0) {
              groups.push({ provider: { id: provider.id, name: provider.name ?? provider.id }, models })
            }
          }
          writeOk(res, { groups, references })
          return
        }

        // POST /evoresearch/fs/llm-provider-probe → 探测候选 provider 的模型端点：
        // 供“添加模型提供商”在创建前拉取一次可用模型（openai-completions /
        // openai-responses 可探测；其余协议返回 listed=false，由用户手工填写模型）。
        if (method === 'llm-provider-probe') {
          const baseURL = requireString(payload, 'baseURL')
          const api = typeof payload.api === 'string' && payload.api !== '' ? payload.api : 'openai-completions'
          const apiKey = typeof payload.apiKey === 'string' && payload.apiKey !== '' ? payload.apiKey : undefined
          if (api !== 'openai-completions' && api !== 'openai-responses') {
            writeOk(res, { listed: false, models: [] })
            return
          }
          let models: Array<{ id: string; name: string; contextWindow: number | null }> = []
          let resolvedBaseURL = baseURL
          try {
            const result = await probeProviderEndpoint(baseURL, apiKey)
            resolvedBaseURL = result.baseURL
            const fetched = result.models
            const seen = new Set<string>()
            for (const m of fetched) {
              if (m.id !== '' && !seen.has(m.id)) {
                seen.add(m.id)
                models.push({ id: m.id, name: m.name ?? m.id, contextWindow: m.contextWindow ?? null })
              }
            }
          } catch (error) {
            throw httpError(400, 'probe-failed', `模型端点探测失败: ${(error as Error)?.message ?? String(error)}`)
          }
          writeOk(res, { listed: true, baseURL: resolvedBaseURL, models })
          return
        }

        // POST /evoresearch/fs/llm-model-test → 模型连通性测试：
        // 用当前选中的 provider + model（可带推理强度）发一条极短请求，
        // 拿到任意输出 token 即视为可用；失败返回错误原因与耗时。
        if (method === 'llm-model-test') {
          const provider = requireString(payload, 'provider')
          const model = requireString(payload, 'model')
          const reasoningEffort = typeof payload.reasoningEffort === 'string' && payload.reasoningEffort !== '' ? payload.reasoningEffort : undefined
          const llm = ctx.get('llm')
          if (llm?.stream === undefined) throw httpError(400, 'method-error', 'llm 服务不可用')
          // 网关目录里发现但尚未写入配置的模型（例如新加的 gpt-image-2）：
          // 先自动注册进 provider 配置，避免 pi-ai 报“no configured model”。
          await ensureProviderModel(ctx, provider, model)
          // 图片生成模型：chat 流式测试不适用，直接走 OpenAI Images API，
          // 用最小尺寸 + 低质量 + n=1 的低成本请求验证可用性（避免生成大图烧钱）。
          const imageGen = payload.kind === 'image' || IMAGE_GEN_NAME_PATTERNS.some((re) => re.test(model))
          if (imageGen) {
            const settings = ctx.get('settings')
            const profile = llmPiAiSection(settings).providers[provider] as Record<string, unknown> | undefined
            const baseURL = typeof profile?.baseURL === 'string' && profile.baseURL !== '' ? profile.baseURL : ''
            const apiKey = await resolveProviderApiKey(ctx, typeof profile?.apiKeyEnv === 'string' ? profile.apiKeyEnv : undefined)
            if (baseURL === '') {
              writeOk(res, { ok: false, latencyMs: 0, imageGen: true, error: 'Provider 未配置接口地址' })
              return
            }
            const controller = new AbortController()
            const timer = setTimeout(() => controller.abort(), 15000)
            const started = Date.now()
            const post = (body: unknown) => fetch(`${baseURL.replace(/\/+$/, '')}/images/generations`, {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                ...(apiKey !== undefined && apiKey !== '' ? { authorization: `Bearer ${apiKey}` } : {}),
              },
              body: JSON.stringify(body),
              signal: controller.signal,
            })
            try {
              let resp = await post({ model, prompt: 'ping', n: 1, size: '1792x768', quality: 'low', response_format: 'b64_json' })
              if (!resp.ok && resp.status === 400) {
                const errText = await resp.text().catch(() => '')
                // 个别网关不接受 quality/size/response_format 参数：去掉重试，
                // 避免把参数问题误报成“模型不可用”。
                if (/quality|size|response_format/i.test(errText)) {
                  resp = await post({ model, prompt: 'ping', n: 1 })
                } else {
                  resp = new Response(errText, { status: resp.status })
                }
              }
              const text = await resp.text().catch(() => '')
              let ok = resp.ok
              if (ok) {
                try {
                  const parsed = JSON.parse(text)
                  ok = Array.isArray(parsed?.data) && parsed.data.length > 0
                } catch { ok = false }
              }
              // 提取网关错误里的可读 message（如 new-api 的权限/配置错误），避免把整段 JSON 抛给用户
              let errorText = text.slice(0, 300)
              if (!ok) {
                try {
                  const parsed = JSON.parse(text)
                  const msg = parsed?.error?.message
                  if (typeof msg === 'string' && msg !== '') errorText = msg
                } catch { /* 非 JSON 错误体原样展示 */ }
              }
              writeOk(res, {
                ok,
                latencyMs: Date.now() - started,
                imageGen: true,
                sample: ok ? '已生成 1 张 1792×768 低清测试图' : errorText,
                ...(ok ? {} : { error: errorText }),
              })
            } catch (error) {
              writeOk(res, { ok: false, latencyMs: Date.now() - started, imageGen: true, error: (error as Error)?.message ?? String(error) })
            } finally {
              clearTimeout(timer)
              controller.abort()
            }
            return
          }
          // 推理档位只有在该模型当前配置已声明时才随请求发送；未声明（保存后才会
          // 写入）时只测连通性，避免把“档位还没保存”误报成“模型连不上”。
          let testedEffort = reasoningEffort
          if (testedEffort !== undefined && llm.resolveModelInfo !== undefined) {
            try {
              const info = await llm.resolveModelInfo(provider, model, AbortSignal.timeout(5000))
              const efforts = info?.reasoning?.efforts
              if (!Array.isArray(efforts) || !efforts.some((e: { id?: unknown }) => e?.id === testedEffort)) testedEffort = undefined
            } catch { testedEffort = undefined }
          }
          const controller = new AbortController()
          const timer = setTimeout(() => controller.abort(), 20000)
          const started = Date.now()
          let text = ''
          try {
            const stream = llm.stream({
              provider,
              model,
              messages: [{ role: 'user', content: [{ type: 'text', text: 'ping' }], source: { kind: 'user' } }],
              maxTokens: 8,
              signal: controller.signal,
              ...(testedEffort !== undefined ? { reasoningEffort: testedEffort } : {}),
            }) as AsyncIterable<unknown>
            for await (const chunk of stream) {
              const c = chunk as { type?: string; text?: string; error?: unknown; reason?: { kind?: string; failure?: { message?: string } } } | null
              if (c !== null && typeof c === 'object') {
                if (c.type === 'error') {
                  throw c.error instanceof Error ? c.error : new Error(String(c.error ?? '模型调用失败'))
                }
                if (c.type === 'finish' && c.reason?.kind === 'error') {
                  throw new Error(c.reason.failure?.message ?? '模型调用失败')
                }
                if (typeof c.text === 'string' && c.text !== '') {
                  text += c.text
                  break
                }
              }
            }
            writeOk(res, { ok: true, latencyMs: Date.now() - started, sample: text.slice(0, 120), reasoningTested: testedEffort !== undefined })
          } catch (error) {
            writeOk(res, { ok: false, latencyMs: Date.now() - started, error: (error as Error)?.message ?? String(error), reasoningTested: testedEffort !== undefined })
          } finally {
            clearTimeout(timer)
            controller.abort()
          }
          return
        }

        // POST /evoresearch/fs/llm-providers → 模型提供商配置（设置面板）：
        // 返回 llm-pi-ai 各 provider 的 baseURL / 明文 API Key / 默认推理强度 /
        // 已配置模型（含每模型 reasoningEfforts），供前端展示与编辑。
        if (method === 'llm-providers') {
          const settings = ctx.get('settings')
          const { providers } = llmPiAiSection(settings)
          const out: unknown[] = []
          for (const [id, profile] of Object.entries(providers)) {
            const p = profile as Record<string, unknown> | null
            if (p === null || typeof p !== 'object') continue
            const apiKeyEnv = typeof p.apiKeyEnv === 'string' && p.apiKeyEnv !== '' ? p.apiKeyEnv : null
            const apiKey = apiKeyEnv !== null ? await resolveProviderApiKey(ctx, apiKeyEnv) : null
            out.push({
              id,
              displayName: typeof p.displayName === 'string' && p.displayName !== '' ? p.displayName : id,
              baseURL: typeof p.baseURL === 'string' ? p.baseURL : null,
              apiKeyEnv,
              apiKey: apiKey ?? null,
              api: typeof p.api === 'string' ? p.api : null,
              reasoning: typeof p.reasoning === 'string' ? p.reasoning : null,
              models: (Array.isArray(p.models) ? p.models : []).map((m: { id?: string; name?: string; contextWindow?: number; reasoningEfforts?: unknown }) => ({
                id: m.id ?? '',
                name: m.name ?? m.id ?? '',
                contextWindow: m.contextWindow ?? null,
                reasoningEfforts: m.reasoningEfforts ?? null,
              })).filter((m: { id: string }) => m.id !== ''),
            })
          }
          writeOk(res, { providers: out })
          return
        }

        // POST /evoresearch/fs/llm-provider-save → 保存模型提供商配置：
        // baseURL / displayName / api / reasoning / models 写回 settings.yaml
        // （settings.replace），API Key 明文写回 .credentials.yaml（credentials.set）。
        // Provider 不存在时自动创建（patch.create=true，自动生成 apiKeyEnv 引用）；
        // patch.remove=true 时删除该 provider 并清除其凭据。
        if (method === 'llm-provider-save') {
          const settings = ctx.get('settings')
          if (settings?.replace === undefined) throw httpError(400, 'method-error', 'settings 服务不可用')
          let provider = requireString(payload, 'provider')
          const patch = (payload.patch ?? {}) as Record<string, unknown>
          const section = { providers: cloneLlmProviders(llmPiAiSection(settings).providers) }
          let profile = section.providers[provider] as Record<string, unknown> | undefined
          if (patch.remove === true) {
            const removed = profile
            if (removed === undefined) throw httpError(400, 'bad-request', `Provider 不存在: ${provider}`)
            delete section.providers[provider]
            await withWriteRetry(() => settings.replace('llm-pi-ai', { providers: section.providers }))
            const ref = typeof removed.apiKeyEnv === 'string' && removed.apiKeyEnv !== '' ? removed.apiKeyEnv : undefined
            if (ref !== undefined) {
              const credentials = ctx.get('credentials')
              if (credentials?.unset !== undefined) {
                await withWriteRetry(() => credentials.unset(ref)).catch(() => { /* 凭据不存在时忽略 */ })
              }
            }
            writeOk(res, { removed: true })
            return
          }
          if (profile === undefined) {
            if (patch.create !== true) throw httpError(400, 'bad-request', `Provider 不存在: ${provider}（首次创建请带 create=true）`)
            if (provider.trim() === '' || /[^A-Za-z0-9._-]/.test(provider)) {
              throw httpError(400, 'bad-request', 'Provider ID 只能包含字母、数字、点、下划线与连字符')
            }
            const ref = `EVORESEARCH_LLM_${provider.toUpperCase().replace(/[^A-Z0-9_]/g, '_')}`
            profile = {
              displayName: provider,
              apiKeyEnv: ref,
              api: 'openai-completions',
            }
            section.providers[provider] = profile
          }
          // Provider ID 重命名（patch.newId）：迁移 providers 键、自动凭据引用、
          // 默认模型选择（agent-default-model）与模型分配（model-settings.json）
          // 中的 provider 引用，避免改名后各处仍指向旧 ID。
          if (typeof patch.newId === 'string') {
            const newId = patch.newId.trim()
            if (newId === '') throw httpError(400, 'bad-request', 'Provider ID 不能为空')
            if (newId !== provider) {
              if (/[^A-Za-z0-9._-]/.test(newId)) throw httpError(400, 'bad-request', 'Provider ID 只能包含字母、数字、点、下划线与连字符')
              if (section.providers[newId] !== undefined) throw httpError(400, 'bad-request', `Provider ID 已存在: ${newId}`)
              const oldId = provider
              section.providers[newId] = profile
              delete section.providers[oldId]
              provider = newId
              // 自动生成的凭据引用随 ID 一起迁移（保留原值）；自定义引用保持不变。
              const autoRef = (id: string): string => `EVORESEARCH_LLM_${id.toUpperCase().replace(/[^A-Z0-9_]/g, '_')}`
              const oldRef = typeof profile.apiKeyEnv === 'string' ? profile.apiKeyEnv : ''
              if (oldRef !== '' && oldRef === autoRef(oldId)) {
                const credentials = ctx.get('credentials')
                const newRef = autoRef(newId)
                try {
                  const hit = credentials?.resolve !== undefined ? await credentials.resolve(oldRef) : undefined
                  const value = hit?.value
                  if (typeof value === 'string' && value !== '') {
                    if (credentials?.set !== undefined) await withWriteRetry(() => credentials.set(newRef, value))
                    if (credentials?.unset !== undefined) await withWriteRetry(() => credentials.unset(oldRef)).catch(() => {})
                  }
                } catch { /* 凭据服务不可用则仅更新引用 */ }
                profile.apiKeyEnv = newRef
              }
              // 默认模型选择同步改名
              try {
                const doc = settings?.document
                const def = (doc?.['agent-default-model'] ?? settings?.get?.('agent-default-model')) as { provider?: string; model?: string } | undefined
                if (def !== undefined && typeof def.provider === 'string' && def.provider === oldId) {
                  await withWriteRetry(() => settings.replace('agent-default-model', { provider: newId, model: typeof def.model === 'string' ? def.model : '' }))
                }
              } catch { /* 默认模型选择不存在则忽略 */ }
              // 模型分配（model-settings.json）中的 provider 引用同步改名
              const evo = ctx.get('evoresearch') as { modelSettingsGet?: () => unknown; modelSettingsSet?: (a: { patch: Record<string, unknown> }) => unknown } | undefined
              if (evo?.modelSettingsGet !== undefined && evo?.modelSettingsSet !== undefined) {
                try {
                  const ms = (await evo.modelSettingsGet()) as Record<string, unknown> | undefined
                  if (ms !== undefined && typeof ms === 'object') {
                    const patchMs: Record<string, unknown> = {}
                    const code = (ms.code ?? {}) as Record<string, { provider?: string } | undefined>
                    // 新旧键都检查：历史文件可能仍存旧三档键（后端读取时会迁移，但文件未重写前旧键仍在）。
                    const codeKeys = ['utility', 'coder', 'planner', 'writer', 'simple', 'medium', 'complex']
                    const codeChanged = codeKeys.some((tier) => code[tier]?.provider === oldId)
                    if (codeChanged) {
                      patchMs.code = Object.fromEntries(codeKeys
                        .filter((tier) => code[tier] !== undefined)
                        .map((tier) => [tier, { ...code[tier], ...(code[tier]?.provider === oldId ? { provider: newId } : {}) }]))
                    }
                    for (const key of ['vision', 'image']) {
                      const entry = ms[key] as Record<string, unknown> | undefined
                      if (entry !== undefined && typeof entry === 'object' && entry.provider === oldId) {
                        patchMs[key] = { ...entry, provider: newId }
                      }
                    }
                    if (Object.keys(patchMs).length > 0) await evo.modelSettingsSet({ patch: patchMs })
                  }
                } catch { /* 模型分配同步失败不阻塞保存 */ }
              }
            }
          }
          if (patch.displayName !== undefined) profile.displayName = typeof patch.displayName === 'string' && patch.displayName !== '' ? patch.displayName : provider
          if (patch.baseURL !== undefined) profile.baseURL = typeof patch.baseURL === 'string' ? patch.baseURL.trim() : ''
          if (patch.api !== undefined) profile.api = typeof patch.api === 'string' ? patch.api.trim() : 'openai-completions'
          if (patch.reasoning !== undefined) {
            if (typeof patch.reasoning === 'string' && patch.reasoning !== '') profile.reasoning = patch.reasoning
            else delete profile.reasoning
          }
          if (patch.models !== undefined) {
            const models = Array.isArray(patch.models)
              ? patch.models.map(sanitizeModelEntry).filter((m: { id: string } | null): m is { id: string } => m !== null)
              : []
            if (models.length > 0) profile.models = models
            else delete profile.models
          }
          await withWriteRetry(() => settings.replace('llm-pi-ai', { providers: section.providers }))
          // API Key：明文写回凭据文件；空串表示清除该凭据。
          if (patch.apiKey !== undefined) {
            const ref = profile.apiKeyEnv
            if (typeof ref !== 'string' || ref === '') throw httpError(400, 'bad-request', '该 Provider 未配置 apiKeyEnv，无法保存 API Key')
            const credentials = ctx.get('credentials')
            const key = typeof patch.apiKey === 'string' ? patch.apiKey.trim() : ''
            if (key === '') {
              if (credentials?.unset === undefined) throw httpError(400, 'method-error', 'credentials 服务不可用')
              await withWriteRetry(() => credentials.unset(ref))
            } else {
              if (credentials?.set === undefined) throw httpError(400, 'method-error', 'credentials 服务不可用')
              await withWriteRetry(() => credentials.set(ref, key))
            }
          }
          writeOk(res, { saved: true })
          return
        }

        // /evoresearch/fs/mode：POST {sessionId, preset} → 切换权限预设
        if (method === 'mode') {
          const permission = ctx.get('permissionPresets')
          if (permission === undefined) throw httpError(400, 'method-error', 'permission 服务不可用')
          const sessionId = requireString(payload, 'sessionId')
          const preset = requireString(payload, 'preset')
          const session = ctx.get('sessions')?.get?.(sessionId)
          if (session === undefined) throw httpError(400, 'bad-request', `会话不存在: ${sessionId}`)
          permission.set(session, preset)
          writeOk(res, { preset })
          return
        }

        // AutoRelatedWork：这是原 D:\auto-related-work/backend/app.py 的
        // 完整 JSON/SSE 兼容入口。密钥只随本次请求传给 Host，不写入浏览器。
        if (typeof method === 'string' && method.startsWith('auto-related-work/')) {
          const operation = method.slice('auto-related-work/'.length)
          const jsonMethods: Record<string, string> = {
            config: 'autoRelatedWorkConfigSet', search: 'autoRelatedWorkSearch', enrich: 'autoRelatedWorkEnrich',
            'author-enrich': 'autoRelatedWorkAuthorEnrich', 'author-candidates': 'autoRelatedWorkAuthorCandidates',
            'author-papers': 'autoRelatedWorkAuthorPapers', pipeline: 'autoRelatedWorkPipeline',
            'related-search': 'autoRelatedWorkRelatedSearch', 'enrich-stream': 'autoRelatedWorkEnrichStream',
            'cache-refine': 'autoRelatedWorkCacheRefine', 'cache-clear': 'autoRelatedWorkCacheClear',
          }
          if (operation === 'health' || operation === 'config' || operation === 'cache-stats' || operation === 'cache-clear' || operation === 'cache-refine' || jsonMethods[operation] !== undefined) {
            const stream = operation === 'pipeline' || operation === 'related-search' || operation === 'enrich-stream' || operation === 'author-papers'
            const streamMethods: Record<string, string> = { pipeline: 'autoRelatedWorkPipelineStream', 'related-search': 'autoRelatedWorkRelatedSearchStream', 'enrich-stream': 'autoRelatedWorkEnrichStreamLive', 'author-papers': 'autoRelatedWorkAuthorPapersStream' }
            const serviceMethod = operation === 'health' ? 'autoRelatedWorkHealth' : operation === 'cache-stats' ? 'autoRelatedWorkCacheStats' : stream ? streamMethods[operation] : jsonMethods[operation]
            if (serviceMethod === undefined || evoresearch?.[serviceMethod] === undefined) throw httpError(400, 'method-error', 'AutoRelatedWork 服务不可用')
            try {
              const value = await evoresearch[serviceMethod](payload)
              if (stream) await writeSseEvents(res, value)
              else writeOk(res, value)
            } catch (error) { writeError(res, error) }
            return
          }
        }

        // ── 业务面板数据（直连插件 EvoResearchApiService，绕开 Remote $mount）──
        if (method === 'web-search-settings-get') {
          if (evoresearch?.webSearchSettingsGet === undefined) throw httpError(400, 'method-error', '联网搜索服务不可用')
          writeOk(res, await (evoresearch.webSearchSettingsGet as () => Promise<unknown>)())
          return
        }
        if (method === 'web-search-settings-save') {
          if (evoresearch?.webSearchSettingsSet === undefined) throw httpError(400, 'method-error', '联网搜索服务不可用')
          try {
            const activeProvider = typeof payload.activeProvider === 'string' ? payload.activeProvider : 'none'
            const providers = payload.providers !== null && typeof payload.providers === 'object' ? payload.providers as Record<string, unknown> : {}
            const academicProvider = typeof payload.academicProvider === 'string' ? payload.academicProvider : undefined
            const academicProviders = payload.academicProviders !== null && typeof payload.academicProviders === 'object' ? payload.academicProviders as Record<string, unknown> : undefined
            const apiKeys = payload.apiKeys !== null && typeof payload.apiKeys === 'object' ? payload.apiKeys as Record<string, unknown> : undefined
            const academicApiKeys = payload.academicApiKeys !== null && typeof payload.academicApiKeys === 'object' ? payload.academicApiKeys as Record<string, unknown> : undefined
            const clearKeys = Array.isArray(payload.clearKeys) ? payload.clearKeys.filter((x): x is string => typeof x === 'string') : undefined
            writeOk(res, await (evoresearch.webSearchSettingsSet as (a: { activeProvider: string; providers: Record<string, unknown>; academicProvider?: string; academicProviders?: Record<string, unknown>; apiKeys?: Record<string, unknown>; academicApiKeys?: Record<string, unknown>; clearKeys?: string[] }) => Promise<unknown>)({ activeProvider, providers, academicProvider, academicProviders, apiKeys, academicApiKeys, clearKeys }))
          } catch (error) {
            writeError(res, error)
          }
          return
        }
        if (method === 'web-search-test') {
          if (evoresearch?.webSearchTest === undefined) throw httpError(400, 'method-error', '联网搜索服务不可用')
          try {
            writeOk(res, await (evoresearch.webSearchTest as (a: { query: string }) => Promise<unknown>)({ query: requireString(payload, 'query') }))
          } catch (error) {
            writeError(res, error)
          }
          return
        }
        if (method === 'academic-search-test') {
          if (evoresearch?.academicSearchTest === undefined) throw httpError(400, 'method-error', '学术搜索服务不可用')
          try {
            writeOk(res, await (evoresearch.academicSearchTest as (a: { query: string }) => Promise<unknown>)({ query: requireString(payload, 'query') }))
          } catch (error) {
            writeError(res, error)
          }
          return
        }
        if (method === 'academic-search-related' || method === 'academic-search-recommendations' || method === 'academic-search-snippets') {
          const serviceMethod = method === 'academic-search-related' ? 'academicSearchRelated'
            : method === 'academic-search-recommendations' ? 'academicSearchRecommendations' : 'academicSearchSnippets'
          if (evoresearch?.[serviceMethod] === undefined) throw httpError(400, 'method-error', '学术搜索服务不可用')
          const args: Record<string, unknown> = { ...payload }
          try {
            writeOk(res, await (evoresearch[serviceMethod] as (a: Record<string, unknown>) => Promise<unknown>)(args))
          } catch (error) {
            writeError(res, error)
          }
          return
        }
        if (method === 'web-search-backend-status' || method === 'web-search-backend-install' || method === 'web-search-backend-start' || method === 'web-search-backend-stop') {
          const methodName = method === 'web-search-backend-status'
            ? 'webSearchBackendStatus'
            : method === 'web-search-backend-install'
              ? 'webSearchBackendInstall'
              : method === 'web-search-backend-start' ? 'webSearchBackendStart' : 'webSearchBackendStop'
          if (evoresearch?.[methodName] === undefined) throw httpError(400, 'method-error', '联网搜索后端管理服务不可用')
          try {
            writeOk(res, await (evoresearch[methodName] as () => Promise<unknown>)())
          } catch (error) {
            writeError(res, error)
          }
          return
        }
        if (method === 'projects') {
          if (evoresearch?.projectsList === undefined) throw httpError(400, 'method-error', 'evoresearch 服务不可用')
          writeOk(res, await (evoresearch.projectsList as () => Promise<unknown>)())
          return
        }
        // 新建项目（§5.4）：合法名直接使用，非法名自动 slug 化；目录 + git init + README
        if (method === 'projects-create') {
          if (evoresearch?.projectCreate === undefined) throw httpError(400, 'method-error', 'evoresearch 服务不可用')
          const name = requireString(payload, 'name')
          if (name.trim().length === 0) throw httpError(400, 'bad-name', '项目名不能为空')
          try {
            const project = await (evoresearch.projectCreate as (a: { name: string }) => Promise<unknown>).call(evoresearch, { name: name.trim() })
            writeOk(res, project)
          } catch (error) {
            writeError(res, error)
          }
          return
        }
        if (method === 'memory-catalog') {
          if (evoresearch?.memoryCatalog === undefined) throw httpError(400, 'method-error', 'evoresearch 服务不可用')
          writeOk(res, await (evoresearch.memoryCatalog as (a: { workspaceDir?: string }) => Promise<unknown>)({ workspaceDir: payload.workspaceDir as string | undefined }))
          return
        }
        // Memory History 时间线（§26.5）：research_turns 分页列表（可按 sessionId 过滤）
        if (method === 'memory-turns') {
          if (evoresearch?.memoryTurns === undefined) throw httpError(400, 'method-error', 'evoresearch 服务不可用')
          const args: { workspaceDir?: string; sessionId?: string; limit?: number; offset?: number } = {}
          if (typeof payload.workspaceDir === 'string') args.workspaceDir = payload.workspaceDir
          if (typeof payload.sessionId === 'string') args.sessionId = payload.sessionId
          if (typeof payload.limit === 'number') args.limit = Math.min(Math.max(Math.floor(payload.limit), 1), 200)
          if (typeof payload.offset === 'number') args.offset = Math.max(Math.floor(payload.offset), 0)
          writeOk(res, await (evoresearch.memoryTurns as (a: typeof args) => Promise<unknown>)(args))
          return
        }
        // Identity 记忆文件（§26.5）：memories/profile 下 Markdown
        if (method === 'memory-profile') {
          if (evoresearch?.memoryProfile === undefined) throw httpError(400, 'method-error', 'evoresearch 服务不可用')
          const args: { workspaceDir?: string } = {}
          if (typeof payload.workspaceDir === 'string') args.workspaceDir = payload.workspaceDir
          writeOk(res, await (evoresearch.memoryProfile as (a: typeof args) => Promise<unknown>)(args))
          return
        }
        // §29：会话元数据（置顶/标签色/归档）——后端存储，随项目数据迁移
        if (method === 'session-meta-get') {
          if (evoresearch?.sessionMetaGet === undefined) throw httpError(400, 'method-error', 'evoresearch 服务不可用')
          writeOk(res, await (evoresearch.sessionMetaGet as () => Promise<unknown>)())
          return
        }
        if (method === 'session-meta-set') {
          if (evoresearch?.sessionMetaSet === undefined) throw httpError(400, 'method-error', 'evoresearch 服务不可用')
          const sessionId = requireString(payload, 'sessionId')
          const patch: Record<string, unknown> = {}
          if (typeof payload.pinned === 'boolean') patch.pinned = payload.pinned
          if (payload.tagColor === null || typeof payload.tagColor === 'string') patch.tagColor = payload.tagColor
          if (typeof payload.archived === 'boolean') patch.archived = payload.archived
          try {
            const result = await (evoresearch.sessionMetaSet as (a: { sessionId: string; patch: Record<string, unknown> }) => Promise<{ ok: boolean }>).call(evoresearch, { sessionId, patch })
            writeOk(res, result)
          } catch (error) {
            writeError(res, error)
          }
          return
        }
        // §44：会话 URL 短别名（?t=<slug>）——分配/反查，随 session-meta 持久化
        if (method === 'session-slug-ensure') {
          if (evoresearch?.sessionSlugEnsure === undefined) throw httpError(400, 'method-error', 'evoresearch 服务不可用')
          const sessionId = requireString(payload, 'sessionId')
          const args: { sessionId: string; preferred?: string } = { sessionId }
          if (typeof payload.preferred === 'string' && payload.preferred.trim() !== '') args.preferred = payload.preferred.slice(0, 200)
          try {
            const result = await (evoresearch.sessionSlugEnsure as (a: typeof args) => Promise<{ slug?: string }>).call(evoresearch, args)
            writeOk(res, result)
          } catch (error) {
            writeError(res, error)
          }
          return
        }
        if (method === 'session-slug-lookup') {
          if (evoresearch?.sessionSlugLookup === undefined) throw httpError(400, 'method-error', 'evoresearch 服务不可用')
          try {
            const result = await (evoresearch.sessionSlugLookup as (a: { slug: string }) => Promise<{ sessionId: string | null }>).call(evoresearch, { slug: requireString(payload, 'slug') })
            writeOk(res, result)
          } catch (error) {
            writeError(res, error)
          }
          return
        }
        // §29：项目元数据（归档/标签色）——后端存储，随项目数据迁移
        if (method === 'project-meta-get') {
          if (evoresearch?.projectMetaGet === undefined) throw httpError(400, 'method-error', 'evoresearch 服务不可用')
          writeOk(res, await (evoresearch.projectMetaGet as () => Promise<unknown>)())
          return
        }
        if (method === 'project-meta-set') {
          if (evoresearch?.projectMetaSet === undefined) throw httpError(400, 'method-error', 'evoresearch 服务不可用')
          const projectPath = requireString(payload, 'path')
          const patch: Record<string, unknown> = {}
          if (typeof payload.archived === 'boolean') patch.archived = payload.archived
          if (payload.tagColor === null || typeof payload.tagColor === 'string') patch.tagColor = payload.tagColor
          try {
            const result = await (evoresearch.projectMetaSet as (a: { path: string; patch: Record<string, unknown> }) => Promise<{ ok: boolean }>).call(evoresearch, { path: projectPath, patch })
            writeOk(res, result)
          } catch (error) {
            writeError(res, error)
          }
          return
        }
        // 删除项目时可选：同时删除磁盘上的项目目录（host 端有路径越界保护）
        if (method === 'project-delete-disk') {
          if (evoresearch?.projectDeleteDisk === undefined) throw httpError(400, 'method-error', 'evoresearch 服务不可用')
          const projectPath = requireString(payload, 'path')
          try {
            const result = await (evoresearch.projectDeleteDisk as (a: { path: string }) => Promise<{ ok: boolean; deleted?: boolean; reason?: string }>).call(evoresearch, { path: projectPath })
            writeOk(res, result)
          } catch (error) {
            writeError(res, error)
          }
          return
        }
        // 客户端状态镜像（UI 偏好/历史等）：后端存储，跨浏览器随项目数据迁移
        if (method === 'client-state-get') {
          if (evoresearch?.clientStateGet === undefined) throw httpError(400, 'method-error', 'evoresearch 服务不可用')
          writeOk(res, await (evoresearch.clientStateGet as () => Promise<unknown>)())
          return
        }
        if (method === 'client-state-set') {
          if (evoresearch?.clientStateSet === undefined) throw httpError(400, 'method-error', 'evoresearch 服务不可用')
          const key = requireString(payload, 'key')
          const value = payload.value === null ? null : (typeof payload.value === 'string' ? payload.value : JSON.stringify(payload.value))
          try {
            const result = await (evoresearch.clientStateSet as (a: { key: string; value: string | null }) => Promise<{ ok: boolean }>).call(evoresearch, { key, value })
            writeOk(res, result)
          } catch (error) {
            writeError(res, error)
          }
          return
        }
        if (method === 'client-state-clear') {
          if (evoresearch?.clientStateClear === undefined) throw httpError(400, 'method-error', 'evoresearch 服务不可用')
          try {
            writeOk(res, await (evoresearch.clientStateClear as () => Promise<{ ok: boolean }>).call(evoresearch))
          } catch (error) {
            writeError(res, error)
          }
          return
        }
        // 模型设置（设置面板）：读 / 写 / 应用代码档为默认模型
        if (method === 'model-settings-get') {
          if (evoresearch?.modelSettingsGet === undefined) throw httpError(400, 'method-error', 'evoresearch 服务不可用')
          writeOk(res, await (evoresearch.modelSettingsGet as () => Promise<unknown>)())
          return
        }
        if (method === 'model-settings-set') {
          if (evoresearch?.modelSettingsSet === undefined) throw httpError(400, 'method-error', 'evoresearch 服务不可用')
          const patch = typeof payload.patch === 'object' && payload.patch !== null ? payload.patch : {}
          // 保存分配时同步把涉及的 provider/model 注册进 llm-pi-ai 配置，
          // 保证后续真实调用（尤其图片生成）不会报“no configured model”。
          const entryModels: Array<{ provider: string; model: string }> = []
          const collect = (entry: unknown) => {
            if (entry === null || typeof entry !== 'object') return
            const e = entry as Record<string, unknown>
            if (typeof e.provider === 'string' && e.provider !== '' && typeof e.model === 'string' && e.model !== '') {
              entryModels.push({ provider: e.provider, model: e.model })
            }
          }
          for (const key of ['code', 'vision', 'image']) {
            const entry = (patch as Record<string, unknown>)[key]
            if (key === 'code' && entry !== null && typeof entry === 'object') {
              // 新四角色键 + 旧三档键都收集（旧键由后端读取时迁移，但注册模型仍需覆盖）。
              for (const tier of ['utility', 'coder', 'planner', 'writer', 'simple', 'medium', 'complex']) collect((entry as Record<string, unknown>)[tier])
            } else {
              collect(entry)
            }
          }
          for (const em of entryModels) {
            await ensureProviderModel(ctx, em.provider, em.model).catch(() => {})
          }
          try {
            const result = await (evoresearch.modelSettingsSet as (a: { patch: Record<string, unknown> }) => Promise<{ ok: boolean }>).call(evoresearch, { patch })
            writeOk(res, result)
          } catch (error) {
            writeError(res, error)
          }
          return
        }
        if (method === 'model-settings-apply') {
          if (evoresearch?.modelSettingsApply === undefined) throw httpError(400, 'method-error', 'evoresearch 服务不可用')
          const tier = payload.tier
          // 旧三档键兼容：映射到新四角色（simple→utility、medium→coder、complex→planner）。
          const legacyMap: Record<string, string> = { simple: 'utility', medium: 'coder', complex: 'planner' }
          const role = typeof tier === 'string' && legacyMap[tier] !== undefined ? legacyMap[tier] : tier
          if (role !== 'utility' && role !== 'coder' && role !== 'planner' && role !== 'writer') throw httpError(400, 'bad-tier', 'tier 必须是 utility/coder/planner/writer')
          try {
            const result = await (evoresearch.modelSettingsApply as (a: { tier: string }) => Promise<unknown>).call(evoresearch, { tier: role })
            writeOk(res, result)
          } catch (error) {
            writeError(res, error)
          }
          return
        }
        // 数据路径（设置面板）：返回当前进程实际路径，切换后由 launcher 重启 DSH
        if (method === 'data-paths-get') {
          if (evoresearch?.dataPathsGet === undefined) throw httpError(400, 'method-error', '数据路径服务不可用')
          writeOk(res, await (evoresearch.dataPathsGet as () => Promise<unknown>)())
          return
        }
        if (method === 'data-paths-browse') {
          if (evoresearch?.dataPathsBrowse === undefined) throw httpError(400, 'method-error', '目录选择服务不可用')
          const browsePath = typeof payload.path === 'string' && payload.path.trim() !== '' ? payload.path : undefined
          writeOk(res, await (evoresearch.dataPathsBrowse as (a: { path?: string }) => Promise<unknown>)({ path: browsePath }))
          return
        }
        if (method === 'data-paths-apply') {
          if (evoresearch?.dataPathsApply === undefined) throw httpError(400, 'method-error', '数据路径服务不可用')
          if (typeof payload.evoresearchRoot !== 'string') {
            throw httpError(400, 'bad-request', 'EVORESEARCH_ROOT 必须是路径')
          }
          if (payload.mode !== 'migrate' && payload.mode !== 'reuse') {
            throw httpError(400, 'bad-request', '请选择“迁移数据”或“直接复用”')
          }
          try {
            const result = await (evoresearch.dataPathsApply as (a: { evoresearchRoot: string; mode: 'migrate' | 'reuse' }) => Promise<unknown>)({
              evoresearchRoot: payload.evoresearchRoot,
              mode: payload.mode,
            })
            writeOk(res, result)
          } catch (error) {
            writeError(res, error)
          }
          return
        }
        if (method === 'data-clear-paths-get') {
          if (evoresearch?.dataClearPathsGet === undefined) throw httpError(400, 'method-error', '清除数据路径服务不可用')
          writeOk(res, await (evoresearch.dataClearPathsGet as () => Promise<unknown>)())
          return
        }
        // 清除数据（设置面板）：scopes ∈ projects / models（prefs 为客户端本地偏好）
        if (method === 'data-clear') {
          if (evoresearch?.dataClear === undefined) throw httpError(400, 'method-error', '清除数据服务不可用')
          const scopes = Array.isArray(payload.scopes)
            ? (payload.scopes as unknown[]).filter((s): s is string => typeof s === 'string' && (s === 'projects' || s === 'models'))
            : []
          try {
            const result = await (evoresearch.dataClear as (a: { scopes: string[] }) => Promise<unknown>).call(evoresearch, { scopes })
            writeOk(res, result)
          } catch (error) {
            writeError(res, error)
          }
          return
        }
        // §12.4 Profile 文件编辑：写（新建/保存）/ 删除 / 重命名（名字严格校验）
        if (method === 'memory-profile-write' || method === 'memory-profile-delete' || method === 'memory-profile-rename') {
          const serviceName = method === 'memory-profile-write' ? 'memoryProfileWrite' : method === 'memory-profile-delete' ? 'memoryProfileDelete' : 'memoryProfileRename'
          const fn = evoresearch?.[serviceName] as ((a: Record<string, unknown>) => unknown) | undefined
          if (fn === undefined) throw httpError(400, 'method-error', 'evoresearch 服务不可用')
          const args: Record<string, unknown> = {}
          if (typeof payload.workspaceDir === 'string') args.workspaceDir = payload.workspaceDir
          if (typeof payload.name === 'string') args.name = payload.name
          if (typeof payload.content === 'string') args.content = payload.content
          if (typeof payload.from === 'string') args.from = payload.from
          if (typeof payload.to === 'string') args.to = payload.to
          try {
            writeOk(res, await fn.call(evoresearch, args))
          } catch (error) {
            writeError(res, error)
          }
          return
        }
        // Knowledge（§26.5 轻量版）：Observation 列表
        if (method === 'memory-observations') {
          if (evoresearch?.memoryObservations === undefined) throw httpError(400, 'method-error', 'evoresearch 服务不可用')
          const args: { status?: 'active' | 'superseded'; category?: string; limit?: number } = {}
          if (payload.status === 'active' || payload.status === 'superseded') args.status = payload.status
          if (typeof payload.category === 'string') args.category = payload.category
          if (typeof payload.limit === 'number') args.limit = Math.min(Math.max(Math.floor(payload.limit), 1), 200)
          writeOk(res, await (evoresearch.memoryObservations as (a: typeof args) => Promise<unknown>)(args))
          return
        }
        // P1-2：Observation 类型化关联边（Knowledge 卡片徽标着色数据源）
        if (method === 'memory-observation-edges') {
          if (evoresearch?.memoryObservationEdges === undefined) throw httpError(400, 'method-error', 'evoresearch 服务不可用')
          const args: { observationId?: string; edgeType?: string } = {}
          if (typeof payload.observationId === 'string') args.observationId = payload.observationId
          if (typeof payload.edgeType === 'string') args.edgeType = payload.edgeType
          writeOk(res, await (evoresearch.memoryObservationEdges as (a: typeof args) => unknown)(args))
          return
        }
        if (method === 'memory-goals') {
          if (evoresearch?.memoryGoals === undefined) throw httpError(400, 'method-error', 'evoresearch 服务不可用')
          writeOk(res, await (evoresearch.memoryGoals as (a: { workspaceDir?: string }) => Promise<unknown>)({ workspaceDir: payload.workspaceDir as string | undefined }))
          return
        }
        // Goal 修改提案（§19.6）：列表 / 接受·拒绝
        if (method === 'memory-goal-proposals') {
          if (evoresearch?.goalProposals === undefined) throw httpError(400, 'method-error', 'evoresearch 服务不可用')
          const goalId = requireString(payload, 'goalId')
          writeOk(res, await (evoresearch.goalProposals as (a: { workspaceDir?: string; goalId: string }) => Promise<unknown>)({ workspaceDir: payload.workspaceDir as string | undefined, goalId }))
          return
        }
        if (method === 'memory-goal-proposal-respond') {
          if (evoresearch?.goalProposalRespond === undefined) throw httpError(400, 'method-error', 'evoresearch 服务不可用')
          const proposalId = requireString(payload, 'proposalId')
          const decision = payload.decision
          if (decision !== 'approve' && decision !== 'reject') throw httpError(400, 'bad-decision', 'decision 必须是 approve 或 reject')
          try {
            const result = await (evoresearch.goalProposalRespond as (a: { workspaceDir?: string; proposalId: string; decision: 'approve' | 'reject' }) => Promise<unknown>)({ workspaceDir: payload.workspaceDir as string | undefined, proposalId, decision })
            writeOk(res, result)
          } catch (error) {
            writeError(res, error)
          }
          return
        }
        if (method === 'scheduler-list') {
          if (evoresearch?.schedulerList === undefined) throw httpError(400, 'method-error', 'evoresearch 服务不可用')
          writeOk(res, await (evoresearch.schedulerList as () => Promise<unknown>)())
          return
        }
        if (method === 'scheduler-add') {
          if (evoresearch?.schedulerAdd === undefined) throw httpError(400, 'method-error', 'evoresearch 服务不可用')
          const result = await (evoresearch.schedulerAdd as (a: { name: string; cron: string; prompt: string }) => Promise<{ taskId: string }>)({
            name: requireString(payload, 'name'),
            cron: requireString(payload, 'cron'),
            prompt: requireString(payload, 'prompt'),
          })
          writeOk(res, { ok: true, task: result })
          return
        }
        if (method === 'scheduler-remove') {
          if (evoresearch?.schedulerRemove === undefined) throw httpError(400, 'method-error', 'evoresearch 服务不可用')
          const result = await (evoresearch.schedulerRemove as (a: { taskId: string }) => Promise<{ ok: boolean }>)({ taskId: requireString(payload, 'taskId') })
          writeOk(res, { ok: result.ok === true })
          return
        }
        if (method === 'scheduler-report') {
          if (evoresearch?.schedulerReport === undefined) throw httpError(400, 'method-error', 'evoresearch 服务不可用')
          const result = await (evoresearch.schedulerReport as (a: { taskId: string }) => Promise<{ text?: string; error?: string }>)({ taskId: requireString(payload, 'taskId') })
          if (result.error !== undefined) throw httpError(400, 'method-error', result.error)
          writeOk(res, { text: result.text ?? '' })
          return
        }
        // Run now（§42.3）：立即执行一次任务
        if (method === 'scheduler-run') {
          if (evoresearch?.schedulerRunNow === undefined) throw httpError(400, 'method-error', 'evoresearch 服务不可用')
          const result = await (evoresearch.schedulerRunNow as (a: { taskId: string }) => Promise<{ ok: boolean; error?: string; threadId?: string }>)({ taskId: requireString(payload, 'taskId') })
          if (result.ok !== true) throw httpError(400, 'method-error', result.error ?? '执行失败')
          writeOk(res, { threadId: result.threadId ?? null })
          return
        }

        // ── Agents：当前会话的子代理树（ctx.subagents.listDescendants）──
        if (method === 'agents') {
          const subagents = ctx.get('subagents')
          if (subagents?.listDescendants === undefined) throw httpError(400, 'method-error', 'subagents 服务不可用')
          const sessionId = requireString(payload, 'sessionId')
          const rows = await subagents.listDescendants(sessionId)
          const agents = (rows ?? [])
            .filter((row: { kind?: string }) => row.kind === 'child')
            .map((row: { id: string; mode?: string; label?: string; activity?: string; hasChildren?: boolean; parentId?: string; depth?: number }) => ({
              id: row.id,
              mode: row.mode ?? 'one-shot',
              label: row.label ?? null,
              activity: row.activity ?? 'idle',
              hasChildren: row.hasChildren === true,
              parentId: row.parentId ?? null,
              depth: row.depth ?? 1,
            }))
          writeOk(res, { agents })
          return
        }

        // ── AutoSkills：列表 / 审核 / 运行 ──
        if (method === 'skills') {
          if (evoresearch?.autoskillsList === undefined) throw httpError(400, 'method-error', 'evoresearch 服务不可用')
          const status = typeof payload.status === 'string' && payload.status !== '' ? payload.status : undefined
          writeOk(res, await (evoresearch.autoskillsList as (a: { status?: string }) => Promise<unknown>)(status === undefined ? {} : { status }))
          return
        }
        if (method === 'skills/approve' || method === 'skills/reject' || method === 'skills/run') {
          const serviceMethod = method === 'skills/approve' ? 'autoskillsApprove' : method === 'skills/reject' ? 'autoskillsReject' : 'autoskillsRun'
          const fn = evoresearch?.[serviceMethod] as ((a: { proposalId: string }) => { ok: boolean }) | undefined
          if (fn === undefined) throw httpError(400, 'method-error', 'evoresearch 服务不可用')
          const result = fn.call(evoresearch, { proposalId: requireString(payload, 'proposalId') })
          writeOk(res, { ok: result.ok === true })
          return
        }
        // 候选生成（§42.7）：从观测聚类生成提案（Auto 模式自动安装）
        if (method === 'skills/generate') {
          if (evoresearch?.autoskillsGenerate === undefined) throw httpError(400, 'method-error', 'evoresearch 服务不可用')
          const result = await (evoresearch.autoskillsGenerate as (a: { workspaceDir?: string }) => Promise<{ created: number }>)({ workspaceDir: payload.workspaceDir as string | undefined })
          writeOk(res, { created: result.created })
          return
        }
        // AutoSkills 调度配置（§42.9）：GET 读 / POST 写（写时 reconcile scheduler）
        if (method === 'autoskills-config') {
          const fn = evoresearch?.autoskillsConfig as ((a: Record<string, unknown>) => unknown) | undefined
          if (fn === undefined) throw httpError(400, 'method-error', 'evoresearch 服务不可用')
          const args: Record<string, unknown> = {}
          for (const key of ['enabled', 'mode', 'cadence', 'time']) {
            if (payload[key] !== undefined) args[key] = payload[key]
          }
          // Remote 方法依赖 this.services —— 用 .call 保持 this 绑定
          writeOk(res, await fn.call(evoresearch, args))
          return
        }

        // ── Projects：校验路径 / 导入 ──
        if (method === 'projects-validate') {
          if (evoresearch?.projectValidate === undefined) throw httpError(400, 'method-error', 'evoresearch 服务不可用')
          writeOk(res, await (evoresearch.projectValidate as (a: { path: string }) => Promise<{ ok: true } | { ok: false; error: string }>)({ path: requireString(payload, 'path') }))
          return
        }
        // 自动创建项目（欢迎页首条消息触发）：AI slug + 确定性回退
        if (method === 'projects-auto') {
          if (evoresearch?.projectAutoCreate === undefined) throw httpError(400, 'method-error', 'evoresearch 服务不可用')
          const description = typeof payload.description === 'string' ? payload.description : ''
          try {
            const project = await (evoresearch.projectAutoCreate as (a: { description: string }) => Promise<unknown>).call(evoresearch, { description })
            if (project !== null && typeof project === 'object' && (project as { error?: string }).error !== undefined) {
              throw httpError(400, 'project-error', (project as { error: string }).error)
            }
            writeOk(res, project)
          } catch (error) {
            writeError(res, error)
          }
          return
        }
        // 新建项目/子聊天标题判断：低信息输入返回 null，最多第 10 次返回标题。
        if (method === 'project-title-suggest') {
          if (evoresearch?.projectTitleSuggest === undefined) throw httpError(400, 'method-error', 'evoresearch 服务不可用')
          const inputs = Array.isArray(payload.inputs) ? payload.inputs.filter((value): value is string => typeof value === 'string') : []
          const kind = payload.kind === 'subchat' ? 'subchat' : 'project'
          const attempt = typeof payload.attempt === 'number' ? payload.attempt : inputs.length
          writeOk(res, await (evoresearch.projectTitleSuggest as (a: { inputs: string[]; kind: 'project' | 'subchat'; attempt: number }) => Promise<unknown>).call(evoresearch, { inputs, kind, attempt }))
          return
        }
        if (method === 'projects-import') {
          if (evoresearch?.projectImport === undefined) throw httpError(400, 'method-error', 'evoresearch 服务不可用')
          const sourcePath = requireString(payload, 'sourcePath')
          const name = typeof payload.name === 'string' && payload.name !== '' ? payload.name : undefined
          writeOk(res, await (evoresearch.projectImport as (a: { sourcePath: string; name?: string }) => Promise<unknown>)({ sourcePath, ...(name === undefined ? {} : { name }) }))
          return
        }
        // 项目文件树（工作区「项目文件」入口）：相对路径递归列举。
        if (method === 'project-files-list') {
          if (evoresearch?.projectFilesList === undefined) throw httpError(400, 'method-error', 'evoresearch 服务不可用')
          const projectDir = typeof payload.projectDir === 'string' ? payload.projectDir : undefined
          const depth = typeof payload.depth === 'number' ? payload.depth : undefined
          writeOk(res, await (evoresearch.projectFilesList as (a: { projectDir?: string; depth?: number }) => Promise<unknown>)({ ...(projectDir === undefined ? {} : { projectDir }), ...(depth === undefined ? {} : { depth }) }))
          return
        }
        // 项目文件预览读取（md/文本内嵌预览）。
        if (method === 'project-file-read') {
          if (evoresearch?.projectFileRead === undefined) throw httpError(400, 'method-error', 'evoresearch 服务不可用')
          const projectDir = typeof payload.projectDir === 'string' ? payload.projectDir : undefined
          writeOk(res, await (evoresearch.projectFileRead as (a: { projectDir?: string; relPath: string }) => Promise<unknown>)({ ...(projectDir === undefined ? {} : { projectDir }), relPath: requireString(payload, 'relPath') }))
          return
        }

        // ── Channels：状态 / 启动 / 停止 ──
        if (method === 'channels-status') {
          if (evoresearch?.channelsStatus === undefined) throw httpError(400, 'method-error', 'evoresearch 服务不可用')
          writeOk(res, await (evoresearch.channelsStatus as () => Promise<unknown>)())
          return
        }
        if (method === 'channel-start' || method === 'channel-stop') {
          const serviceMethod = method === 'channel-start' ? 'channelStart' : 'channelStop'
          const fn = evoresearch?.[serviceMethod] as ((a: { id: string }) => Promise<{ ok: boolean }>) | undefined
          if (fn === undefined) throw httpError(400, 'method-error', 'evoresearch 服务不可用')
          const result = await fn({ id: requireString(payload, 'id') })
          writeOk(res, { ok: result.ok === true })
          return
        }

        // ── 专家团队：列表 / 邀请 / 清空 ──
        if (method === 'experts') {
          if (evoresearch?.expertsList === undefined) throw httpError(400, 'method-error', 'evoresearch 服务不可用')
          writeOk(res, await (evoresearch.expertsList as () => Promise<unknown>)())
          return
        }
        if (method === 'expert-invite') {
          if (evoresearch?.expertInvite === undefined) throw httpError(400, 'method-error', 'evoresearch 服务不可用')
          const result = await (evoresearch.expertInvite as (a: { name: string }) => Promise<{ ok: boolean }>)({ name: requireString(payload, 'name') })
          writeOk(res, { ok: result.ok === true })
          return
        }
        if (method === 'expert-clear') {
          if (evoresearch?.expertClear === undefined) throw httpError(400, 'method-error', 'evoresearch 服务不可用')
          const result = await (evoresearch.expertClear as () => Promise<{ ok: boolean }>)()
          writeOk(res, { ok: result.ok === true })
          return
        }

        // ── 斜杠命令目录（动态读取，移植规范 §23.3）──
        if (method === 'commands') {
          if (evoresearch?.commandsList === undefined) throw httpError(400, 'method-error', 'evoresearch 服务不可用')
          writeOk(res, await (evoresearch.commandsList as () => Promise<unknown>)())
          return
        }

        // ── 斜杠命令直接执行（§23.3：结果以文本显示在输入区上方）──
        if (method === 'commands-execute') {
          const commands = ctx.get('commands')
          if (commands?.execute === undefined) throw httpError(400, 'method-error', 'commands 服务不可用')
          const sessionId = requireString(payload, 'sessionId')
          const line = requireString(payload, 'line')
          const agent = ctx.get('agents')?.get?.(sessionId)
          if (agent === undefined) throw httpError(400, 'bad-request', `会话不存在: ${sessionId}`)
          // P2-4：可选图片附件透传（EncodedImageAttachment 形状；仅声明 input.images
          // 的命令会被 executor 接收，其余命令由 executor 拒绝并保留原图）
          const rawImages = Array.isArray(payload.images) ? payload.images : []
          const images = rawImages
            .filter((img: any) => img !== null && typeof img === 'object' && typeof img.mediaType === 'string' && typeof img.data === 'string')
            .map((img: any) => ({ mediaType: String(img.mediaType), data: String(img.data), ...(typeof img.name === 'string' ? { name: img.name } : {}) }))
          const signal = new AbortController().signal
          const result = images.length > 0
            ? await (commands.execute as (agent2: unknown, line2: string, imgs: typeof images, signal2: AbortSignal) => Promise<unknown>)(agent, line, images, signal)
            : await commands.execute(agent, line, signal as never)
          writeOk(res, { matched: result !== undefined, result: result ?? null })
          return
        }

        // ── 全历史搜索（§9.5；前端先搜 DOM，Full history 走这里）──
        if (method === 'threads-search') {
          if (evoresearch?.threadsSearch === undefined) throw httpError(400, 'method-error', 'evoresearch 服务不可用')
          const query = requireString(payload, 'query')
          const limit = typeof payload.limit === 'number' ? Math.min(Math.max(Math.floor(payload.limit), 1), 50) : 50
          writeOk(res, await (evoresearch.threadsSearch as (a: { query: string; limit?: number }) => Promise<unknown>)({ query, limit }))
          return
        }

        // ── 技能目录（§42.6 Marketplace 浏览：三层来源合并，官方 skills.list）──
        if (method === 'skills-catalog') {
          const skills = ctx.get('skills')
          const dynamic: Array<{ name: string; description?: string }> = []
          if (skills?.list !== undefined) {
            try { dynamic.push(...(await skills.list({}))) } catch { /* 动态技能列表不可用时忽略 */ }
          }
          // 内置科研技能目录（参照 EvoScientist 项目的 skills/ + EvoResearch 自身能力）：
          // 即使部署环境未安装任何 DSH skills，科研技能面板也有可浏览的内容。
          const builtin: Array<{ name: string; description: string; whenToUse: string; invocation: { modelInvocable: boolean; userInvocable: boolean } }> = [
            { name: 'find-skills', description: '从开放式技能生态为用户发现代理技能：搜索 skills.sh 并给出通过 skill_manager 工具安装的选项。', whenToUse: '用户想为某项常见任务寻找现成的技能、工具、模板或工作流时。', invocation: { modelInvocable: true, userInvocable: true } },
            { name: 'skill-creator', description: '创建新技能、改进既有技能并度量技能性能：起草 → 制定测试 → 运行评估 → 依反馈重写迭代。', whenToUse: '用户想从零创建技能、优化既有技能、运行 eval 或基准测试技能性能时。', invocation: { modelInvocable: true, userInvocable: true } },
            { name: 'lit-review', description: '对给定主题做学术文献调研：检索论文、摘要并整理成研究综述与相关工作的结构化笔记。', whenToUse: '需要对某个研究方向做文献检索与综述、补齐 related work 或追踪最新论文时。', invocation: { modelInvocable: true, userInvocable: true } },
            { name: 'experiment-design', description: '把开放研究问题转成可检验的实验设计：明确假设、变量、指标、阶段与检查点。', whenToUse: '需要把研究问题落地为可运行的实验计划、梳理阶段与回退点时。', invocation: { modelInvocable: true, userInvocable: true } },
            { name: 'paper-reader', description: '精读一篇论文：解析结构、抽取方法/实验/结论，并写入项目笔记与记忆。', whenToUse: '需要精读一篇论文、做精读笔记或核对论文与代码/实验结果的一致性时。', invocation: { modelInvocable: true, userInvocable: true } },
            { name: 'memory-search', description: '在全局科研记忆中检索既有发现：按目标、分类、观测与知识库定位相关条目。', whenToUse: '需要回顾以前的研究结论、跨项目检索记忆或避免重复研究时。', invocation: { modelInvocable: true, userInvocable: true } },
          ]
          const dedup = new Map<string, { name: string; description?: string }>()
          for (const s of builtin) dedup.set(s.name, s)
          for (const s of dynamic) if (typeof s?.name === 'string' && !dedup.has(s.name)) dedup.set(s.name, s)
          writeOk(res, { skills: [...dedup.values()] })
          return
        }

        // ── 会话信息（§26.8 Current 弹窗）：持久化文件路径/大小/事件数 ──
        if (method === 'session-info') {
          const sessionId = requireString(payload, 'sessionId')
          const sessionsRoot = join(process.env.DSH_HOME ?? process.cwd(), 'sessions')
          let file: string | null = null
          let bytes = 0
          let events: number | null = null
          const candidates: string[] = []
          try {
            const walkSessions = async (dir: string, depth: number): Promise<void> => {
              if (depth > 4) return
              let level
              try { level = await opendir(dir) } catch { return }
              for await (const dirent of level) {
                if (dirent.isDirectory()) {
                  if (dirent.name === sessionId) {
                    // 会话目录内是 session.jsonl / session.jsonl.zstd
                    for (const logName of ['session.jsonl', 'session.jsonl.zstd']) {
                      const log = join(dir, dirent.name, logName)
                      try { await stat(log); candidates.push(log) } catch { /* 跳过 */ }
                    }
                  } else {
                    await walkSessions(join(dir, dirent.name), depth + 1)
                  }
                }
              }
            }
            await walkSessions(sessionsRoot, 0)
          } catch { /* 根目录不存在 */ }
          if (candidates.length > 0) {
            file = candidates[0]
            try {
              const st = await stat(file)
              bytes = st.size
              if (bytes <= 64 * 1024 * 1024) {
                if (file.endsWith('.zstd')) {
                  const raw = zstdDecompressSync(await readFile(file))
                  events = countLines(raw)
                } else {
                  events = countLines(await readFile(file))
                }
              }
            } catch { /* 统计失败则跳过 */ }
          }
          writeOk(res, { file, bytes, events, sessionsRoot })
          return
        }

        // ── 会话删除（附录 B-2/B-9）：移除持久化数据（jsonl/附件等）──
        // 官方 dsh-session 无公开删除 API；live 会话无法从内存 store 摘除，
        // 因此运行中的会话（agent.status === 'running'，官方同款判断）直接拒绝；
        // 其余会话删除持久化目录，live 残留由客户端隐藏集合过滤，重启后彻底消失。
        if (method === 'session-delete') {
          const sessionId = requireString(payload, 'sessionId')
          const agents = ctx.get('agents')
          const status = (agents?.get?.(sessionId) as { status?: string } | undefined)?.status
          if (status === 'running') throw httpError(409, 'session-busy', '会话正在进行中，请先停止后再删除')
          const sessionsRoot = join(process.env.DSH_HOME ?? process.cwd(), 'sessions')
          let removed = 0
          const walkSessions = async (dir: string, depth: number): Promise<void> => {
            if (depth > 4) return
            let level
            try { level = await opendir(dir) } catch { return }
            for await (const dirent of level) {
              if (!dirent.isDirectory()) continue
              if (dirent.name === sessionId) {
                const target = join(dir, dirent.name)
                if (!isWithin(target, sessionsRoot)) continue
                try { await rm(target, { recursive: true, force: true }); removed += 1 } catch { /* 跳过失败目录 */ }
              } else {
                await walkSessions(join(dir, dirent.name), depth + 1)
              }
            }
          }
          await walkSessions(sessionsRoot, 0)
          const live = ctx.get('sessions')?.get?.(sessionId) !== undefined
          writeOk(res, { deleted: removed > 0, live })
          return
        }

        // ── 会话导出（§26.3 / §41.8）：JSON（诊断/迁移）与 Markdown（人读）──
        if (method === 'session-export') {
          const sessionId = requireString(payload, 'sessionId')
          const format = payload.format === 'markdown' ? 'markdown' : 'json'
          const sessions = ctx.get('sessions')
          const live = sessions?.get?.(sessionId)
          let events: Array<{ type?: string; data?: any; time?: number }> = []
          if (live !== undefined && Array.isArray(live.log)) {
            events = live.log as Array<{ type?: string; data?: any; time?: number }>
          } else {
            const persistence = ctx.get('sessionPersistence')
            if (persistence?.load !== undefined) {
              try {
                const loaded = await persistence.load(sessionId)
                events = loaded?.events ?? []
              } catch { /* 持久化读失败 */ }
            }
          }
          const textBlocks = (content: unknown): string => {
            if (typeof content === 'string') return content
            if (Array.isArray(content)) {
              return content.map((b) => (b?.type === 'text' ? String(b.text ?? '') : '')).join('')
            }
            return ''
          }
          // §41.8：JSON 导出为完整诊断格式——先收集 tool/result（按 callId），再组装消息
          const toolResults: Record<string, { text: string; isError: boolean }> = {}
          for (const event of events) {
            if (event?.type !== 'tool/result') continue
            const d = event.data ?? {}
            const block = Array.isArray(d.message?.content) ? d.message.content.find((b: any) => b?.type === 'tool-result') : undefined
            const callId = d.message?.source?.callId ?? block?.toolCallId
            if (callId === undefined || callId === '') continue
            const content = block?.content
            const text = typeof content === 'string'
              ? content
              : Array.isArray(content) ? content.map((c: any) => (typeof c === 'string' ? c : String(c?.text ?? ''))).join('\n') : ''
            toolResults[String(callId)] = { text, isError: block?.isError === true || d.error !== undefined }
          }
          const messages: Array<{ role: string; text: string; time?: number; reasoning?: string; tools?: Array<{ callId: string; name: string; args: string; result?: string; isError?: boolean }> }> = []
          for (const event of events) {
            if (event?.type === 'user/message') {
              const text = textBlocks(event.data?.content)
              if (text !== '') messages.push({ role: 'user', text, time: event.time })
            } else if (event?.type === 'assistant/message') {
              const content = event.data?.message?.content
              if (!Array.isArray(content)) continue
              const text = content.filter((b: any) => b?.type === 'text').map((b: any) => String(b.text ?? '')).join('')
              const reasoning = content.filter((b: any) => b?.type === 'reasoning').map((b: any) => String(b.text ?? '')).join('')
              const toolCalls = content.filter((b: any) => b?.type === 'tool-call')
              if (text === '' && reasoning === '' && toolCalls.length === 0) continue
              const tools = toolCalls.map((b: any) => {
                const callId = String(b.id ?? '')
                const r = toolResults[callId]
                const entry: { callId: string; name: string; args: string; result?: string; isError?: boolean } = { callId, name: b.name ?? '', args: b.arguments ?? '' }
                if (r !== undefined) { entry.result = r.text; entry.isError = r.isError }
                return entry
              })
              const m: { role: string; text: string; time?: number; reasoning?: string; tools?: Array<{ callId: string; name: string; args: string; result?: string; isError?: boolean }> } = { role: 'assistant', text, time: event.time }
              if (reasoning !== '') m.reasoning = reasoning
              if (tools.length > 0) m.tools = tools
              messages.push(m)
            }
          }
          const title = typeof payload.title === 'string' && payload.title !== '' ? payload.title : sessionId.slice(0, 12)
          const safeBase = title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').replace(/\s+/g, '-').slice(0, 80)
          if (format === 'markdown') {
            const sections: string[] = [`# ${title}`, '', `> Thread: ${sessionId}`, '']
            for (const m of messages) {
              sections.push(`## ${m.role === 'user' ? 'User' : 'Assistant'}`, '', m.text, '')
            }
            writeOk(res, { filename: `${safeBase}.md`, content: sections.join('\n') })
          } else {
            const payloadJson = {
              threadId: sessionId,
              title,
              workspace: live?.header?.cwd ?? null,
              exportedAt: new Date().toISOString(),
              messageCount: messages.length,
              messages,
            }
            writeOk(res, { filename: `${safeBase}.json`, content: JSON.stringify(payloadJson, null, 2) })
          }
          return
        }

        // ── Assistant 消息反馈（PLAT-20）：追加式信号，不改写会话原文 ──
        // ── 实验管理（§5.1 Git 式分支/回退/checkpoint）──
        if (method === 'experiments-list' || method === 'experiments-get' || method === 'experiments-create' || method === 'experiments-update'
          || method === 'experiments-phase' || method === 'experiments-checkpoint' || method === 'experiments-rollback'
          || method === 'experiments-branch' || method === 'experiments-switch' || method === 'experiments-delete') {
          const serviceMethod = method === 'experiments-list' ? 'experimentsList'
            : method === 'experiments-get' ? 'experimentsGet'
              : method === 'experiments-create' ? 'experimentsCreate'
                : method === 'experiments-update' ? 'experimentsUpdate'
                  : method === 'experiments-phase' ? 'experimentsAddPhase'
                    : method === 'experiments-checkpoint' ? 'experimentsCheckpoint'
                      : method === 'experiments-rollback' ? 'experimentsRollback'
                        : method === 'experiments-branch' ? 'experimentsBranch'
                          : method === 'experiments-switch' ? 'experimentsSwitchBranch'
                            : 'experimentsDelete'
          const fn = evoresearch?.[serviceMethod] as ((a: Record<string, unknown>) => unknown) | undefined
          if (fn === undefined) throw httpError(400, 'method-error', 'evoresearch 服务不可用')
          const args: Record<string, unknown> = {}
          if (typeof payload.workspaceDir === 'string') args.workspaceDir = payload.workspaceDir
          if (typeof payload.id === 'string') args.id = payload.id
          if (typeof payload.name === 'string') args.name = payload.name
          if (typeof payload.description === 'string') args.description = payload.description
          if (typeof payload.note === 'string') args.note = payload.note
          if (typeof payload.phaseId === 'string') args.phaseId = payload.phaseId
          if (typeof payload.sessionId === 'string') args.sessionId = payload.sessionId
          if (typeof payload.checkpointId === 'string') args.checkpointId = payload.checkpointId
          if (typeof payload.fromCheckpointId === 'string') args.fromCheckpointId = payload.fromCheckpointId
          if (typeof payload.branchId === 'string') args.branchId = payload.branchId
          if (payload.patch !== null && typeof payload.patch === 'object') args.patch = payload.patch
          try {
            writeOk(res, await fn.call(evoresearch, args))
          } catch (error) {
            writeError(res, error)
          }
          return
        }

        // ── 项目环境（§环境管理：env-status/env-create/env-install/env-remove/uv-ensure）──
        if (method === 'uv-ensure') {
          const fn = evoresearch?.uvEnsure as (() => Promise<{ ok: boolean; uv: string | null; installed: boolean; error?: string }>) | undefined
          if (fn === undefined) throw httpError(400, 'method-error', 'evoresearch 服务不可用')
          try {
            writeOk(res, await fn.call(evoresearch))
          } catch (error) {
            writeError(res, error)
          }
          return
        }
        if (method === 'env-status' || method === 'env-create' || method === 'env-install' || method === 'env-remove') {
          const serviceMethod = method === 'env-status' ? 'projectEnvStatus'
            : method === 'env-create' ? 'projectEnvCreate'
              : method === 'env-install' ? 'projectEnvInstall'
                : 'projectEnvRemove'
          const fn = evoresearch?.[serviceMethod] as ((a: Record<string, unknown>) => unknown) | undefined
          if (fn === undefined) throw httpError(400, 'method-error', 'evoresearch 服务不可用')
          const args: Record<string, unknown> = {}
          if (typeof payload.projectDir === 'string') args.projectDir = payload.projectDir
          if (typeof payload.pythonVersion === 'string') args.pythonVersion = payload.pythonVersion
          if (Array.isArray(payload.packages)) args.packages = payload.packages
          try {
            // 创建/安装耗时较长（uv 下载），await 完整结果
            writeOk(res, await fn.call(evoresearch, args))
          } catch (error) {
            writeError(res, error)
          }
          return
        }

        // ── 回溯（rewind-info / rewind-execute / usermsg-edit）──
        if (method === 'rewind-info' || method === 'rewind-execute' || method === 'usermsg-edit') {
          const serviceMethod = method === 'rewind-info' ? 'rewindInfo'
            : method === 'rewind-execute' ? 'rewindExecute'
              : 'usermsgEdit'
          const fn = evoresearch?.[serviceMethod] as ((a: Record<string, unknown>) => unknown) | undefined
          if (fn === undefined) throw httpError(400, 'method-error', 'evoresearch 服务不可用')
          const args: Record<string, unknown> = {}
          if (typeof payload.sessionId === 'string') args.sessionId = payload.sessionId
          if (typeof payload.beforeSeq === 'number') args.beforeSeq = payload.beforeSeq
          if (typeof payload.seq === 'number') args.seq = payload.seq
          if (typeof payload.text === 'string') args.text = payload.text
          try {
            writeOk(res, await fn.call(evoresearch, args))
          } catch (error) {
            writeError(res, error)
          }
          return
        }

        // ── Chat Graph（节点/连线图，按项目存储）──
        // 注：update-node/remove-node/update-edge/remove-edge/move-nodes/add-group/update-group
        // 七个粒度端点已随宿主一并移除（客户端编辑走 graph-save 全量写，仅 remove-group 在用）。
        if (method === 'graph-get' || method === 'graph-save' || method === 'graph-add-node' || method === 'graph-add-edge' || method === 'graph-remove-group' || method === 'graph-inherit' || method === 'graph-fork-from-message' || method === 'graph-preview' || method === 'graph-convert-note' || method === 'graph-memory-create' || method === 'graph-memory-copy' || method === 'graph-memory-collection' || method === 'graph-memory-write' || method === 'graph-sync') {
          const serviceMethod = method === 'graph-get' ? 'graphGet'
            : method === 'graph-save' ? 'graphSave'
              : method === 'graph-add-node' ? 'graphAddNode'
                : method === 'graph-add-edge' ? 'graphAddEdge'
                  : method === 'graph-remove-group' ? 'graphRemoveGroup'
                  : method === 'graph-inherit' ? 'graphInherit'
                    : method === 'graph-fork-from-message' ? 'graphForkFromMessage'
                    : method === 'graph-preview' ? 'graphPreview'
                      : method === 'graph-memory-create' ? 'graphMemoryCreate'
                        : method === 'graph-memory-copy' ? 'graphMemoryCopy'
                          : method === 'graph-memory-collection' ? 'graphMemoryCollection'
                            : method === 'graph-memory-write' ? 'graphMemoryWrite'
                              : method === 'graph-sync' ? 'graphSync'
                                : 'graphConvertNote'
          const fn = evoresearch?.[serviceMethod] as ((a: Record<string, unknown>) => unknown) | undefined
          if (fn === undefined) throw httpError(400, 'method-error', 'evoresearch 服务不可用')
          const args: Record<string, unknown> = {}
          if (typeof payload.workspaceDir === 'string') args.workspaceDir = payload.workspaceDir
          if (payload.graph !== undefined) args.graph = payload.graph
          if (payload.node !== undefined) args.node = payload.node
          if (payload.patch !== undefined) args.patch = payload.patch
          if (payload.edge !== undefined) args.edge = payload.edge
          if (payload.positions !== undefined) args.positions = payload.positions
          if (payload.group !== undefined) args.group = payload.group
          if (typeof payload.fromNodeId === 'string') args.fromNodeId = payload.fromNodeId
          if (typeof payload.toNodeId === 'string') args.toNodeId = payload.toNodeId
          if (typeof payload.nodeId === 'string') args.nodeId = payload.nodeId
          if (typeof payload.sourceSessionId === 'string') args.sourceSessionId = payload.sourceSessionId
          if (typeof payload.sourceEventSeq === 'number') args.sourceEventSeq = payload.sourceEventSeq
          if (typeof payload.edgeId === 'string') args.edgeId = payload.edgeId
          if (typeof payload.groupId === 'string') args.groupId = payload.groupId
          if (typeof payload.operationId === 'string') args.operationId = payload.operationId
          if (typeof payload.title === 'string') args.title = payload.title
          if (payload.scope === 'project' || payload.scope === 'global') args.scope = payload.scope
          if (typeof payload.x === 'number') args.x = payload.x
          if (typeof payload.y === 'number') args.y = payload.y
          if (typeof payload.content === 'string') args.content = payload.content
          // 乐观并发修订号（graph-save 携带，服务端比对防陈旧窗口覆盖）
          if (typeof payload.rev === 'number') args.rev = payload.rev
          try {
            writeOk(res, await fn.call(evoresearch, args))
          } catch (error) {
            writeError(res, error)
          }
          return
        }

        // ── 科学角色与 Chat Graph 边界（RA/EA/EMA）──
        if (method === 'science-ra-candidate-add' || method === 'science-candidate-accept' || method === 'science-ea-attempt-add' || method === 'science-ema-candidate-record') {
          const serviceMethod = method.split('-').map((part, i) => i === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)).join('')
          const fn = evoresearch?.[serviceMethod] as ((a: Record<string, unknown>) => unknown) | undefined
          if (fn === undefined) throw httpError(400, 'method-error', '科学角色桥接服务不可用')
          try { writeOk(res, await fn.call(evoresearch, { ...payload })) }
          catch (error) { writeError(res, error) }
          return
        }

        // ── 科研团队职责层（RA/EA/EMA → 六类角色 + 回合阶段默认角色）──
        if (method === 'science-duties') {
          const fn = evoresearch?.scienceDuties as (() => unknown) | undefined
          if (fn === undefined) throw httpError(400, 'method-error', 'evoresearch 服务不可用')
          try { writeOk(res, fn.call(evoresearch)) }
          catch (error) { writeError(res, error) }
          return
        }

        // ── ContextAssembler（本轮参考与 Context Trace）──
        if (method === 'context-preview' || method === 'context-assemble' || method === 'context-assemble-deep' || method === 'context-effects') {
          const serviceMethod = method === 'context-preview' ? 'contextPreview'
            : method === 'context-assemble' ? 'contextAssemble'
              : method === 'context-assemble-deep' ? 'contextAssembleDeep'
                : 'contextEffects'
          const fn = evoresearch?.[serviceMethod] as ((a: Record<string, unknown>) => unknown) | undefined
          if (fn === undefined) throw httpError(400, 'method-error', 'evoresearch 服务不可用')
          const args: Record<string, unknown> = {}
          for (const key of ['sessionId', 'userQuestion', 'projectName', 'workspaceDir', 'questionId', 'since', 'limit']) {
            if (payload[key] !== undefined) args[key] = payload[key]
          }
          if (payload.options !== undefined) args.options = payload.options
          try {
            writeOk(res, await fn.call(evoresearch, args))
          } catch (error) {
            writeError(res, error)
          }
          return
        }

        // ── 自由文本研究笔记（NOTE-01..09；§整合 notes-* 16 路由，P0）──
        if (method === 'notes-list' || method === 'notes-read' || method === 'notes-create' || method === 'notes-write' || method === 'notes-delete'
          || method === 'notes-search' || method === 'notes-rebuild-index' || method === 'notes-clear-index'
          || method === 'notes-background-read' || method === 'notes-background-read-all' || method === 'notes-background-write'
          || method === 'notes-draft-update' || method === 'notes-draft-list' || method === 'notes-draft-read'
          || method === 'notes-draft-apply' || method === 'notes-draft-discard') {
          const serviceMethod = method.split('-').map((part, i) => i === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)).join('') as string
          const fn = evoresearch?.[serviceMethod] as ((a: Record<string, unknown>) => unknown) | undefined
          if (fn === undefined) throw httpError(400, 'method-error', 'evoresearch 服务不可用')
          const args: Record<string, unknown> = { ...payload }
          try {
            writeOk(res, await fn.call(evoresearch, args))
          } catch (error) {
            writeError(res, error)
          }
          return
        }

        // ── P0-3/P3-1 后台任务：列表 / 取消 / 会话删除级联 ──
        if (method === 'jobs-list' || method === 'jobs-cancel' || method === 'jobs-count-for-session' || method === 'session-delete-cascade') {
          const serviceName = method === 'jobs-list' ? 'jobsList'
            : method === 'jobs-cancel' ? 'jobsCancel'
              : method === 'jobs-count-for-session' ? 'jobsCountForSession'
                : 'sessionDeleteCascade'
          const fn = evoresearch?.[serviceName] as ((a: Record<string, unknown>) => unknown) | undefined
          if (fn === undefined) throw httpError(400, 'method-error', 'evoresearch 服务不可用')
          try {
            writeOk(res, await fn.call(evoresearch, { ...payload }))
          } catch (error) {
            writeError(res, error)
          }
          return
        }

        // ── P0-2 工具结果图片：资产探测 + 读取（直连插件 Remote 方法）──
        if (method === 'artifact-image-detect' || method === 'artifact-image') {
          const serviceName = method === 'artifact-image-detect' ? 'artifactImageDetect' : 'artifactImage'
          const fn = evoresearch?.[serviceName] as ((a: Record<string, unknown>) => unknown) | undefined
          if (fn === undefined) throw httpError(400, 'method-error', 'evoresearch 服务不可用')
          const args: Record<string, unknown> = { ...payload }
          try {
            writeOk(res, await fn.call(evoresearch, args))
          } catch (error) {
            writeError(res, error)
          }
          return
        }

        // ── P2-1 图纸面板：列表 / 单个（直连插件 Remote 方法）──
        if (method === 'figures-list' || method === 'figures-get') {
          const serviceName = method === 'figures-list' ? 'figuresList' : 'figuresGet'
          const fn = evoresearch?.[serviceName] as ((a: Record<string, unknown>) => unknown) | undefined
          if (fn === undefined) throw httpError(400, 'method-error', 'evoresearch 服务不可用')
          const args: Record<string, unknown> = { ...payload }
          try {
            writeOk(res, await fn.call(evoresearch, args))
          } catch (error) {
            writeError(res, error)
          }
          return
        }

        // ── P1 模块路由（§整合 §4：实验工作区/进程、文献、稿件、自进化）──
        if (method.startsWith('experiment-workspace-') || method.startsWith('experiment-run-') || method.startsWith('experiment-log-')
          || method === 'experiment-recover' || method === 'experiment-retrospective-draft' || method === 'experiment-workspace-append-note'
          || method === 'experiment-workspace-artifacts' || method === 'experiment-graph-ref-resolve'
          || method.startsWith('experiment-rounds-') || method.startsWith('experiment-ledger-') || method.startsWith('daily-report-')
          || method.startsWith('library-') || method.startsWith('manuscript-') || method.startsWith('evolution-')
          || method === 'autoskills-generate-from-traces' || method === 'autoskills-update-proposal-content' || method === 'autoskills-run-skill'
          || method.startsWith('context-')) {
          const serviceMethod = method.split('-').map((part, i) => i === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)).join('') as string
          const fn = evoresearch?.[serviceMethod] as ((a: Record<string, unknown>) => unknown) | undefined
          if (fn === undefined) throw httpError(400, 'method-error', 'evoresearch 服务不可用')
          const args: Record<string, unknown> = { ...payload }
          try {
            writeOk(res, await fn.call(evoresearch, args))
          } catch (error) {
            writeError(res, error)
          }
          return
        }

        writeJson(res, 404, { ok: false, error: { code: 'not-found', message: `unknown method ${method ?? ''}` } })
      } catch (error) {
        writeError(res, error)
      }
    },
  }), 'evoresearch: workspace fs api')
}

/** 根目录标签（面包屑/树根显示）。 */
export function rootLabel(path: string): string {
  const base = basename(path)
  return base !== '' ? base : path
}

/** 父目录（文件系统根返回 undefined）。 */
export function parentOf(path: string): string | undefined {
  const parent = dirname(path)
  return parent === path ? undefined : parent
}
