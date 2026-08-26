/**
 * AutoRelatedWork 的 Node/TypeScript 移植。
 *
 * 设计来源（只读参考）：D:/auto-related-work/backend/src。
 * 这里保留它最影响检索质量的流水线：Google Scholar 高相关候选、BibTeX
 * 修正、arXiv/Semantic Scholar/Crossref/OpenAlex/DBLP/Unpaywall 补全、
 * 标题重叠校验、去重、延迟/重试和可选磁盘缓存。Google Scholar 的作者
 * 主页/递归参考文献属于重型二次流程，设置中提供能力开关，避免一次
 * 普通搜索偷偷发起大量请求。
 *
 * 不依赖 Python、Flask 或浏览器。住宅代理（当前可用配置为 Nexip）/本地代理参数作为配置传入；
 * 当前 Node fetch 能力不支持自动代理时，错误会明确指出需要的配置。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { connect as connectTCP, type Socket } from 'node:net'
import { connect as connectTLS, type TLSSocket } from 'node:tls'
import { randomInt } from 'node:crypto'
import { createRequire } from 'node:module'

import type { AcademicAuthor, AcademicAuthorProfile, AcademicReference, AcademicSearchResult, AcademicSource } from './academic-search.js'

export const AUTORELATEDWORK_DEFAULT_SCHOLAR_URL = 'https://scholar.google.com'
export const AUTORELATEDWORK_DEFAULT_CACHE_FILE = 'autorelatedwork-cache.json'
/** Python 版 enrich_fields.py 的默认礼貌邮箱；不是用户凭据。 */
export const AUTORELATEDWORK_DEFAULT_UNPAYWALL_EMAIL = 'scholar.tool.user@gmail.com'

export interface AutoRelatedWorkConfig {
  scholarURL?: string
  /** 传统 HTTP 代理地址，例如 http://127.0.0.1:7892。 */
  localProxy?: string
  /** 住宅代理端点轮换；由 Node 运行环境支持时使用。 */
  qgServers?: string[]
  qgPort?: number
  qgChannel?: string
  country?: string
  delayMs?: number
  maxRetries?: number
  enrich?: boolean
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
  cacheFile?: string
  cacheTTLHours?: number
  /** 与原始 scholar_search.py 一致的检索模式。 */
  searchType?: 'general' | 'cites' | 'related' | 'author'
  citesId?: string
  maxScholarPages?: number
  maxScholarResults?: number
  fast?: boolean
  cacheEnabled?: boolean
  bibtexRounds?: number
  /** 原版 Scholar 请求的 socket/HTTP 超时（毫秒）。 */
  scholarTimeoutMs?: number
  /** 允许补全阶段最后一轮执行 Scholar web fallback。 */
  webFallback?: boolean
  /** arXiv 作者块缺失或机构覆盖率不足时启用 DeepSeek 作者解析。 */
  arxivAIFallback?: boolean
  /** 通过环境变量/配置指定各公开 API 的地址，便于测试和自托管镜像。 */
  semanticScholarURL?: string
  openAlexURL?: string
  crossrefURL?: string
  dblpURL?: string
  /** 与原版 RuntimeConfig 的网络访问模式对齐。 */
  netScholar?: 'direct' | 'local' | 'residential' | 'local+residential'
  netSemanticScholar?: 'direct' | 'local' | 'residential' | 'local+residential'
  /** 原版 RuntimeConfig 的公开数据源网络模式。 */
  netSemSch?: 'direct' | 'local' | 'residential' | 'local+residential'
  netArxiv?: 'direct' | 'local' | 'residential' | 'local+residential'
  netCrossref?: 'direct' | 'local' | 'residential' | 'local+residential'
  netOpenAlex?: 'direct' | 'local' | 'residential' | 'local+residential'
  netDblp?: 'direct' | 'local' | 'residential' | 'local+residential'
  netUnpaywall?: 'direct' | 'local' | 'residential' | 'local+residential'
  netDeepSeek?: 'direct' | 'local' | 'residential' | 'local+residential'
  /** Flask enrich_fields.py 的 /api/enrich 不调用 Semantic Scholar；默认搜索仍开启。 */
  fetchSemanticScholar?: boolean
  /** `/api/enrich` 兼容模式可关闭 Unpaywall；完整搜索默认开启。 */
  fetchUnpaywall?: boolean
  /** 原 app.py 的第二个 DeepSeek 作者回退阶段；纯 `/api/enrich` 默认关闭。 */
  deepseekAuthorFallback?: boolean
}

export interface AutoRelatedWorkCredentials {
  qgAuthKey?: string
  qgAuthPwd?: string
  semanticScholarApiKey?: string
  unpaywallEmail?: string
  deepseekApiKey?: string
  deepseekURL?: string
}

export interface AutoRelatedWorkOptions {
  query: string
  limit?: number
  config?: AutoRelatedWorkConfig
  credentials?: AutoRelatedWorkCredentials
  dataRoot?: string
  fetchImpl?: FetchLike
  signal?: AbortSignal
  /** 逐层递归/补全进度；不会改变返回值。 */
  onProgress?: (event: { stage: string; index?: number; total?: number; message?: string }) => void
}

interface FetchLike {
  (input: string | URL | Request, init?: RequestInit): Promise<Response>
}

export interface AutoRelatedWorkPaper {
  title: string
  authors: string[]
  authorsStr?: string
  externalUrls: string[]
  snippet?: string
  year?: number
  url?: string
  additionalUrls: string[]
  domain?: string
  doi?: string
  venue?: string
  abstract?: string
  citedByCount?: number
  citedBy?: { count?: number; url?: string }
  citedByURL?: string
  pdfUrls: string[]
  paperId?: string
  /** Google Scholar data-cid，仅供二次请求 BibTeX 使用。 */
  scholarCid?: string
  allVersionsCount?: number
  allVersionsURL?: string
  allVersions?: { count?: number; url?: string }
  relatedArticlesURL?: string
  viewHTMLURLs: string[]
  clusterId?: string
  dataCid?: string
  authorsTruncated?: boolean
  bibtex?: string
  institutions: string[]
  authorScholarIds: Record<string, string>
  authorsDetailed: AcademicAuthor[]
  authorProfiles: Record<string, AcademicAuthorProfile>
  emails: string[]
  references: AcademicReference[]
  source?: string
  fieldSources: Record<string, string>
  completeness?: number
  missingFields?: string[]
  enrichStage?: 'search' | 'wave1' | 'wave2' | 'refs' | 'done'
  cacheComplete?: boolean
  depth?: number
  /** 原 pipeline 的 DeepSeek 相关度结果（内部字段，清洗后透传）。 */
  aiRelevance?: number
  aiRelevanceReason?: string
  /** recursive_search.py 的内部引用缓存；永远不直接写入公开结果。 */
  rawReferences?: AcademicReference[]
  /** app.py `_apply_paper_cache` 的内部断点续传标记。 */
  resumeDone?: boolean
}

type AutoPaper = AutoRelatedWorkPaper

interface CacheEntry {
  storedAt: number
  result: AcademicSearchResult
}

interface CacheDocument {
  version: 1
  entries: Record<string, CacheEntry>
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function cleanURL(value: string | undefined, fallback: string): string {
  const result = (value ?? '').trim().replace(/\/+$/, '')
  return result === '' ? fallback : result
}

function splitHostPort(value: string, defaultPort: number): { host: string; port: number } {
  const raw = value.trim().replace(/^https?:\/\//i, '').replace(/\/$/, '')
  const index = raw.lastIndexOf(':')
  if (index > 0 && /^\d+$/.test(raw.slice(index + 1))) return { host: raw.slice(0, index), port: Number(raw.slice(index + 1)) }
  return { host: raw, port: defaultPort }
}

function connectSocket(host: string, port: number, timeoutMs = 20_000): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connectTCP({ host, port })
    const timer = setTimeout(() => { socket.destroy(); reject(new Error(`连接 ${host}:${port} 超时`)) }, timeoutMs)
    const fail = (error: Error) => { clearTimeout(timer); reject(error) }
    socket.once('connect', () => { clearTimeout(timer); resolve(socket) })
    socket.once('error', fail)
  })
}

interface ScholarHTTPResponse {
  status: number
  body: string
  headers: Record<string, string>
}

/**
 * 与 scholar_search.py 的 _GSSession 对齐。
 *
 * 这里的 cookie 是进程级会话 cookie（不是用户凭据），用于把同一轮
 * Scholar 请求保持在同一浏览器会话；请求间隔是共享的，避免分页、BibTeX
 * 和作者主页并发时各自以为自己是第一个请求而触发 CAPTCHA。
 */
class AutoRelatedWorkScholarSession {
  private readonly cookies = new Map<string, string>()
  private readonly queue: Promise<void> = Promise.resolve()
  private minIntervalMs = 1_000
  private lastRequestAt = 0
  private consecutiveOK = 0
  private serial: Promise<void> = Promise.resolve()

  cookieHeader(): string {
    return [...this.cookies.entries()].map(([key, value]) => `${key}=${value}`).join('; ')
  }

  async waitAndMark(): Promise<void> {
    // 串行化“检查间隔 + 写入 lastRequestAt”，但不串行化实际网络请求。
    let release!: () => void
    const previous = this.serial
    this.serial = new Promise<void>((resolve) => { release = resolve })
    await previous
    try {
      const wait = this.minIntervalMs - (Date.now() - this.lastRequestAt)
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait + Math.round(Math.random() * 300)))
      this.lastRequestAt = Date.now()
    } finally {
      release()
    }
  }

  updateHeaders(headers: Record<string, string>): void {
    const raw = headers['set-cookie'] ?? ''
    // Fetch/原始 socket 在不同 Node 版本里可能把多个 Set-Cookie 合成
    // 逗号串，也可能保留数组；这里只读取 cookie=值的第一段，行为与
    // Python 版本按分号切分的实现一致。
    for (const item of raw.split(/,(?=[^;,=\s]+\s*=)/)) {
      const first = item.trim().split(';', 1)[0] ?? ''
      const equal = first.indexOf('=')
      if (equal <= 0) continue
      this.cookies.set(first.slice(0, equal).trim(), first.slice(equal + 1).trim())
    }
  }

  reportOK(): void {
    this.consecutiveOK += 1
    if (this.consecutiveOK >= 5 && this.minIntervalMs > 800) {
      this.minIntervalMs = Math.max(800, this.minIntervalMs * 0.85)
      this.consecutiveOK = 0
    }
  }

  reportBlocked(): void {
    this.consecutiveOK = 0
    this.minIntervalMs = Math.min(8_000, this.minIntervalMs * 1.8)
  }
}

const autoRelatedWorkScholarSession = new AutoRelatedWorkScholarSession()

function headerMap(raw: string): Record<string, string> {
  const output: Record<string, string> = {}
  for (const line of raw.split('\r\n').slice(1)) {
    const separator = line.indexOf(':')
    if (separator <= 0) continue
    const key = line.slice(0, separator).trim().toLocaleLowerCase()
    const value = line.slice(separator + 1).trim()
    output[key] = output[key] === undefined ? value : `${output[key]},${value}`
  }
  return output
}

async function connectTunnel(socket: Socket, targetHost: string, targetPort: number, authorization?: string, timeoutMs = 20_000): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let data = Buffer.alloc(0)
    let settled = false
    let timer: ReturnType<typeof setTimeout>
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.off('data', onData)
      socket.off('error', onError)
      if (error === undefined) resolve()
      else reject(error)
    }
    const onData = (chunk: Buffer) => {
      data = Buffer.concat([data, chunk])
      const end = data.indexOf('\r\n\r\n')
      if (end < 0) return
      const status = data.subarray(0, end).toString('latin1').split('\r\n')[0] ?? ''
      if (!/^HTTP\/\d(?:\.\d)?\s+2\d\d\b/i.test(status)) finish(new Error(`CONNECT ${targetHost}:${targetPort} 失败：${status}`))
      else finish()
    }
    const onError = (error: Error) => finish(error)
    timer = setTimeout(() => {
      socket.destroy()
      finish(new Error(`CONNECT ${targetHost}:${targetPort} 超时`))
    }, timeoutMs)
    socket.on('data', onData)
    socket.on('error', onError)
    // Python 原版只发送 CONNECT + Host。某些住宅代理会把
    // `Connection: keep-alive` 误当成对上游隧道的复用要求，随后直接重置
    // 连接；保持请求头与原版一致也能兼容 Nexip/QG 的 CONNECT 实现。
    const headers = [`CONNECT ${targetHost}:${targetPort} HTTP/1.1`, `Host: ${targetHost}:${targetPort}`]
    if (authorization !== undefined) headers.push(`Proxy-Authorization: Basic ${authorization}`)
    socket.write(`${headers.join('\r\n')}\r\n\r\n`)
  })
}

/** Nexip 使用 sid-rot 作为用户名中的会话占位符；每次新建隧道都换一个 sid。 */
function rotateResidentialProxySession(authKey: string): string {
  if (!authKey.includes('sid-rot')) return authKey
  return authKey.replaceAll('sid-rot', `sid-${randomInt(10_000_000, 100_000_000)}`)
}

function decodeChunkedBody(body: Buffer): Buffer {
  const output: Buffer[] = []
  let offset = 0
  while (offset < body.length) {
    const lineEnd = body.indexOf('\r\n', offset)
    if (lineEnd < 0) return body
    const size = Number.parseInt(body.subarray(offset, lineEnd).toString('ascii').split(';')[0] ?? '', 16)
    if (!Number.isFinite(size)) return body
    if (size === 0) break
    const start = lineEnd + 2
    output.push(body.subarray(start, start + size))
    offset = start + size + 2
  }
  return Buffer.concat(output)
}

function tlsGetOverSocket(socket: Socket, host: string, path: string, cookieHeader = '', referer?: string, timeoutMs = 25_000): Promise<ScholarHTTPResponse> {
  return new Promise((resolve, reject) => {
    const tlsSocket: TLSSocket = connectTLS({ socket, servername: host, rejectUnauthorized: false })
    const chunks: Buffer[] = []
    const timer = setTimeout(() => tlsSocket.destroy(new Error('Google Scholar 请求超时')), timeoutMs)
    tlsSocket.once('secureConnect', () => {
      tlsSocket.write([
        `GET ${path} HTTP/1.1`,
        `Host: ${host}`,
        'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
        'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language: en-US,en;q=0.9',
        'Accept-Encoding: identity',
        ...(referer === undefined ? [] : [`Referer: ${referer}`]),
        ...(cookieHeader === '' ? [] : [`Cookie: ${cookieHeader}`]),
        'Connection: close',
        '', '',
      ].join('\r\n'))
    })
    tlsSocket.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    tlsSocket.once('error', (error) => { clearTimeout(timer); reject(error) })
    tlsSocket.once('close', () => {
      clearTimeout(timer)
      const response = Buffer.concat(chunks)
      const separator = response.indexOf('\r\n\r\n')
      if (separator < 0) return reject(new Error('Google Scholar 返回了不完整的 HTTP 响应'))
      const header = response.subarray(0, separator).toString('latin1')
      const status = Number(header.match(/^HTTP\/\d(?:\.\d)?\s+(\d+)/i)?.[1] ?? 0)
      const body = response.subarray(separator + 4)
      const decodedBody = /transfer-encoding:\s*chunked/i.test(header) ? decodeChunkedBody(body) : body
      resolve({ status, body: decodedBody.toString('utf8'), headers: headerMap(header) })
    })
  })
}

async function scholarViaConnect(url: string, config: AutoRelatedWorkConfig, credentials: AutoRelatedWorkCredentials, serverIndex = 0): Promise<string> {
  const target = new URL(url)
  const qgServers = (config.qgServers ?? []).map((item) => item.trim()).filter(Boolean)
  const qgServer = qgServers.length === 0 ? undefined : qgServers[serverIndex % qgServers.length]
  const localProxy = config.localProxy?.trim()
  const qg = qgServer === undefined ? undefined : splitHostPort(qgServer, config.qgPort ?? 443)
  const local = localProxy === undefined || localProxy === '' ? undefined : splitHostPort(localProxy, 7892)
  if (qg === undefined && local === undefined) throw new Error('未配置 CONNECT 代理')
  const socket = await connectSocket(local?.host ?? qg!.host, local?.port ?? qg!.port)
  try {
    if (qg !== undefined) {
      if (local !== undefined) await connectTunnel(socket, qg.host, qg.port)
      const authKey = rotateResidentialProxySession(credentials.qgAuthKey ?? '')
      const rawCredential = `${authKey}:${credentials.qgAuthPwd ?? ''}${config.country === undefined || config.country === '' ? '' : `:A${config.country}`}${config.qgChannel === undefined || config.qgChannel === '' ? '' : `:C${config.qgChannel}:T120`}`
      await connectTunnel(socket, target.hostname, Number(target.port || 443), Buffer.from(rawCredential).toString('base64'))
    } else {
      await connectTunnel(socket, target.hostname, Number(target.port || 443))
    }
    const response = await tlsGetOverSocket(
      socket,
      target.hostname,
      `${target.pathname}${target.search}`,
      autoRelatedWorkScholarSession.cookieHeader(),
      undefined,
      config.scholarTimeoutMs ?? 25_000,
    )
    autoRelatedWorkScholarSession.updateHeaders(response.headers)
    if (response.status < 200 || response.status >= 300) throw new Error(`${response.status} ${response.body.slice(0, 180)}`)
    const isSearch = target.pathname === '/scholar' && target.searchParams.has('q') && target.searchParams.get('output') !== 'cite'
    if (isSearch && !/<h3\b[^>]*class=["'][^"']*\bgs_rt\b/i.test(response.body)) {
      autoRelatedWorkScholarSession.reportBlocked()
      throw new Error('Google Scholar 返回空结果/静默封禁页面')
    }
    autoRelatedWorkScholarSession.reportOK()
    return response.body
  } finally {
    if (!socket.destroyed) socket.destroy()
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function decodeHTML(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
}

function stripHTML(value: string): string {
  return decodeHTML(value.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeText(value: string): string {
  return decodeHTML(value)
    .replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff\u00ad]/g, '')
    .replace(/[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/g, ' ')
    // scholar_search.py 的简化 LaTeX 还原规则；顺序与 Python 版本一致。
    .replace(/\{\\[\"]([a-zA-Z])\}/g, '$1')
    .replace(/\{\\[^}]*([a-zA-Z])\}/g, '$1')
    .replace(/\\&/g, '&').replace(/\\%/g, '%').replace(/\\{/g, '{').replace(/\\}/g, '}')
    .replace(/[{}]/g, '')
    .replace(/ {2,}/g, ' ')
    .replace(/(\w):([A-Za-z])/g, '$1: $2')
    .trim()
}

function attr(tag: string, name: string): string | undefined {
  const match = tag.match(new RegExp(`\\b${escapeRegExp(name)}\\s*=\\s*["']([^"']*)["']`, 'i'))
  return match === null ? undefined : decodeHTML(match[1] ?? '')
}

function innerTag(html: string, tagName: string, className?: string): string | undefined {
  const classPart = className === undefined ? '' : `[^>]*class=["'][^"']*\\b${escapeRegExp(className)}\\b[^"']*["']`
  const match = html.match(new RegExp(`<${tagName}\\b${classPart}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i'))
  return match === null ? undefined : match[1]
}

function absoluteURL(raw: string, base: string): string | undefined {
  try {
    const value = new URL(raw, base).toString()
    return /^https?:\/\//i.test(value) ? value : undefined
  } catch {
    return undefined
  }
}

function parseAuthors(row: string): { names: string[]; scholarIds: Record<string, string> } {
  const scholarIds: Record<string, string> = {}
  const names: string[] = []
  for (const match of row.matchAll(/<a\b[^>]*href=["']([^"']*citations\?[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = decodeHTML(match[1] ?? '')
    const name = stripHTML(match[2] ?? '')
    const id = href.match(/[?&]user=([A-Za-z0-9_-]+)/i)?.[1]
    if (name !== '') {
      names.push(name)
      if (id !== undefined) scholarIds[id] = name
    }
  }
  const plain = stripHTML(row)
  const authorPart = plain.split(/\s+-\s+/)[0] ?? plain
  if (names.length === 0 && authorPart !== '') {
    names.push(...authorPart.split(/,|\s+·\s+/).map((item) => item.trim()).filter(Boolean).slice(0, 12))
  }
  return { names: [...new Set(names)], scholarIds }
}

/** Python 版 _backoff 的等价实现：base^attempt + [0, 30%] jitter。 */
export function autoRelatedWorkBackoff(attempt: number, base = 2, maxWait = 30): number {
  const wait = Math.min(base ** attempt, maxWait)
  return wait + Math.random() * wait * 0.3
}

/** Python 版 _strip_control_chars 的可序列化等价实现。 */
export function autoRelatedWorkStripControlChars<T>(value: T): T {
  if (typeof value !== 'string') return value
  return value.replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff\u00ad]/g, '').replace(/[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/g, ' ') as T
}

/** Python 版 _match_author：子集与双向首字母匹配，容忍 Last, First。 */
export function autoRelatedWorkMatchAuthor(name: string | undefined | null, candidates: Array<string | undefined | null>): string | undefined {
  const tokens = (value: string | undefined | null): Set<string> => new Set((value ?? '').toLocaleLowerCase().replace(/[^\p{L}\p{N}_\s]/gu, '').split(/\s+/).filter(Boolean))
  const initialsMatch = (short: Set<string>, full: Set<string>): boolean => {
    const firstLetters = new Set([...full].map((item) => item[0]))
    for (const token of short) {
      if (full.has(token)) continue
      if ([...token].every((char) => firstLetters.has(char))) continue
      return false
    }
    return short.size > 0
  }
  const left = tokens(name)
  if (left.size === 0) return undefined
  for (const candidate of candidates) {
    if (candidate == null) continue
    const right = tokens(candidate)
    if (right.size === 0) continue
    if ([...left].every((item) => right.has(item)) || [...right].every((item) => left.has(item))) return candidate
    if (initialsMatch(left, right) || initialsMatch(right, left)) return candidate
  }
  return undefined
}

/** Python 版 _titles_match 的默认规则。 */
export function autoRelatedWorkTitlesMatchExact(left: string | undefined | null, right: string | undefined | null, minWordOverlap = 0.55): boolean {
  if (!left || !right) return false
  const words = (value: string) => new Set(value.toLocaleLowerCase().match(/[a-z0-9]+/g) ?? [])
  const a = words(left); const b = words(right)
  if (a.size === 0 || b.size === 0) return false
  let shared = 0
  for (const item of a) if (b.has(item)) shared += 1
  const overlap = shared / new Set([...a, ...b]).size
  return overlap >= minWordOverlap || (shared >= 3 && shared / Math.min(a.size, b.size) >= 0.6)
}

/** scholar_search.py `_titles_overlap` 的规则（Semantic Scholar 专用）。
 * enrich_fields.py 的 `_titles_match` 使用 0.6 的短标题阈值，二者不能混用。
 */
function autoRelatedWorkTitlesOverlap(left: string | undefined | null, right: string | undefined | null, minOverlap = 0.35): boolean {
  if (!left || !right) return false
  const words = (value: string) => new Set(value.toLocaleLowerCase().match(/[a-z0-9]+/g) ?? [])
  const a = words(left); const b = words(right)
  if (a.size === 0 || b.size === 0) return false
  let shared = 0
  for (const item of a) if (b.has(item)) shared += 1
  const overlap = shared / new Set([...a, ...b]).size
  return overlap >= minOverlap || (shared >= 3 && shared / Math.min(a.size, b.size) >= 0.5)
}

/** Python enrich_fields.py 的完整性评分。 */
export function autoRelatedWorkCompleteness(paper: Record<string, unknown>): number {
  const checks: number[] = [paper.title ? 1 : 0]
  const authors = Array.isArray(paper.authors) ? paper.authors : []
  if (authors.length === 0) checks.push(0)
  else if (isObject(authors[0])) {
    const withAff = authors.filter((item) => isObject(item) && Array.isArray(item.affiliations) && item.affiliations.length > 0).length
    checks.push(0.5 + 0.5 * withAff / authors.length)
  } else checks.push(0.5)
  const abstract = typeof paper.abstract === 'string' ? paper.abstract : ''
  checks.push(abstract === '' ? 0 : abstract.length > 300 ? 1 : abstract.length > 100 ? 0.6 : 0.3)
  const institutions = Array.isArray(paper.institutions) ? paper.institutions : []
  checks.push(Math.min(1, institutions.length / 3))
  checks.push(paper.venue ? 1 : 0.3)
  checks.push(paper.doi ? 1 : 0.2)
  checks.push(paper.year ? 1 : 0)
  checks.push(paper.bibtex ? 1 : 0)
  return checks.reduce((sum, value) => sum + value, 0) / checks.length
}

/** Python enrich_fields.py 的缺失字段报告。 */
export function autoRelatedWorkMissingFields(paper: Record<string, unknown>): string[] {
  const missing: string[] = []
  if (!paper.title) missing.push('title')
  const authors = Array.isArray(paper.authors) ? paper.authors : []
  if (authors.length === 0) missing.push('authors')
  else if (isObject(authors[0])) {
    const withAff = authors.filter((item) => isObject(item) && Array.isArray(item.affiliations) && item.affiliations.length > 0).length
    if (withAff === 0) missing.push('affiliations')
    else if (withAff < authors.length * 0.5) missing.push(`affiliations(部分: ${withAff}/${authors.length})`)
  }
  const abstract = typeof paper.abstract === 'string' ? paper.abstract : ''
  if (!abstract) missing.push('abstract')
  else if (abstract.length < 150) missing.push('abstract(短)')
  if (!Array.isArray(paper.institutions) || paper.institutions.length === 0) missing.push('institutions')
  if (!paper.venue) missing.push('venue')
  if (!paper.doi) missing.push('doi')
  if (!paper.year) missing.push('year')
  if (!paper.bibtex) missing.push('bibtex')
  return missing
}

function parseNumberFromText(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const match = value.match(/\d[\d,.]*/)
  if (match === null) return undefined
  const raw = match[0].replace(/,/g, '')
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : undefined
}

/** Google Scholar HTML parser, based on auto-related-work's gs_rt/gs_a/gs_fl strategy. */
export function parseAutoRelatedWorkScholarTotalCount(html: string): number | undefined {
  const resultWords = '(?:results?|resultados?|r[ée]sultats?|Ergebnisse?|risultati?)'
  const plain = stripHTML(html)
  const match = plain.match(new RegExp(`(?:About|Aproximadamente|Environ|Ungef\\.hr|Ca\\.?)\\s*([\\d.,]+)\\s*${resultWords}`, 'i'))
  if (match?.[1] === undefined) return undefined
  let value = match[1]
  if (value.includes(',') && value.includes('.')) value = value.split('.')[0]!.replaceAll(',', '')
  else if ((value.match(/\./g) ?? []).length > 1 || (value.match(/,/g) ?? []).length > 1) value = value.replaceAll(/[.,]/g, '')
  else {
    for (const separator of [',', '.']) {
      if (!value.includes(separator)) continue
      const tail = value.split(separator)[1] ?? ''
      value = tail.length === 3 ? value.replaceAll(separator, '') : value.split(separator)[0]!
      break
    }
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

export function parseAutoRelatedWorkScholarResults(html: string, baseURL = AUTORELATEDWORK_DEFAULT_SCHOLAR_URL): AutoPaper[] {
  const papers: AutoPaper[] = []
  const titles = [...html.matchAll(/<h3\b[^>]*class=["'][^"']*\bgs_rt\b[^"']*["'][^>]*>[\s\S]*?<\/h3>/gi)]
  for (let index = 0; index < titles.length; index += 1) {
    const start = titles[index]?.index ?? 0
    const end = titles[index + 1]?.index ?? html.length
    const block = html.slice(start, end)
    const h3 = titles[index]?.[0] ?? ''
    const links = [...h3.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)]
    const title = normalizeText(stripHTML(links[0]?.[2] ?? h3).replace(/^\[[^\]]+\]\s*/, ''))
    if (title === '') continue
    const urls = links.map((match) => absoluteURL(attr(match[0] ?? '', 'href') ?? '', baseURL)).filter((item): item is string => item !== undefined && !item.includes('scholar.google.'))
    const authorsRow = innerTag(block, 'div', 'gs_a') ?? ''
    const parsedAuthors = parseAuthors(authorsRow)
    const snippet = text(stripHTML(innerTag(block, 'div', 'gs_rs') ?? ''))
    const meta = stripHTML(authorsRow)
    const year = number(meta.match(/\b(?:19|20)\d{2}\b/)?.[0])
    const citedAnchor = block.match(/<a\b[^>]*href=["']([^"']*[?&]cites=\d+[^"']*)["'][^>]*>([\s\S]*?)<\/a>/i)
    const citedURL = citedAnchor === null ? undefined : absoluteURL(citedAnchor[1] ?? '', baseURL)
    const versionsAnchor = block.match(/<a\b[^>]*href=["']([^"']*cluster=\d+[^"']*)["'][^>]*>([\s\S]*?)<\/a>/i)
    const versionsURL = versionsAnchor === null ? undefined : absoluteURL(versionsAnchor[1] ?? '', baseURL)
    const pdfUrls = [...block.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)]
      .map((match) => ({ href: absoluteURL(attr(match[0] ?? '', 'href') ?? '', baseURL), label: stripHTML(match[2] ?? '') }))
      .filter((item): item is { href: string; label: string } => item.href !== undefined && /\[PDF\]/i.test(item.label))
      .map((item) => item.href)
    // `data-cid` 通常在 h3 的祖先 gs_ri 上，而 block 从 h3 开始；向前
    // 看一小段避免漏掉它，也避免把前一条结果的 cid 带进来。
    const dataCid = block.match(/\bdata-cid=["']([^"']+)["']/i)?.[1]
      ?? html.slice(Math.max(0, start - 3000), start).match(/<div\b[^>]*data-cid=["']([^"']+)["'][^>]*>/gi)?.at(-1)?.match(/data-cid=["']([^"']+)["']/i)?.[1]
    const paperId = citedURL?.match(/[?&]cites=(\d+)/i)?.[1] ?? versionsURL?.match(/[?&]cluster=(\d+)/i)?.[1]
    const clusterId = versionsURL?.match(/[?&]cluster=(\d+)/i)?.[1]
    const domain = urls[0] === undefined ? undefined : (() => { try { return new URL(urls[0]).hostname } catch { return undefined } })()
    const relatedURL = block.match(/<a\b[^>]*href=["']([^"']*q=related:[^"']*)["']/i)?.[1]
    const viewHTMLURLs = [...block.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)]
      .map((match) => absoluteURL(attr(match[0] ?? '', 'href') ?? '', baseURL))
      .filter((item): item is string => item !== undefined && item.includes('scholar.googleusercontent.com'))
    papers.push({
      title,
      authors: parsedAuthors.names,
      ...(meta !== '' ? { authorsStr: meta } : {}),
      externalUrls: urls,
      ...(snippet !== undefined ? { snippet } : {}),
      ...(year !== undefined ? { year } : {}),
      ...(urls[0] !== undefined ? { url: urls[0] } : {}),
      additionalUrls: urls.slice(1),
      ...(domain !== undefined ? { domain } : {}),
      ...(citedURL !== undefined ? { citedByURL: citedURL } : {}),
      ...(parseNumberFromText(citedAnchor === null ? undefined : stripHTML(citedAnchor[2] ?? '')) !== undefined ? { citedByCount: parseNumberFromText(stripHTML(citedAnchor?.[2] ?? '')) } : {}),
      pdfUrls: [...new Set(pdfUrls)],
      ...(paperId !== undefined ? { paperId } : {}),
      ...(versionsURL !== undefined ? { allVersionsURL: versionsURL } : {}),
      ...(parseNumberFromText(versionsAnchor === null ? undefined : stripHTML(versionsAnchor[2] ?? '')) !== undefined ? { allVersionsCount: parseNumberFromText(stripHTML(versionsAnchor?.[2] ?? '')) } : {}),
      ...(relatedURL !== undefined ? { relatedArticlesURL: absoluteURL(relatedURL, baseURL) } : {}),
      viewHTMLURLs,
      ...(clusterId !== undefined ? { clusterId } : {}),
      ...(citedURL !== undefined ? { citedBy: { count: parseNumberFromText(stripHTML(citedAnchor?.[2] ?? '')), url: citedURL } } : { citedBy: {} }),
      ...(versionsURL !== undefined ? { allVersions: { count: parseNumberFromText(stripHTML(versionsAnchor?.[2] ?? '')), url: versionsURL } } : { allVersions: {} }),
      ...(dataCid !== undefined && dataCid !== '' ? { dataCid } : {}),
      institutions: [],
      authorScholarIds: parsedAuthors.scholarIds,
      authorsDetailed: parsedAuthors.names.map((name) => ({ name })),
      authorProfiles: {},
      emails: [],
      references: [],
      fieldSources: {},
      source: 'GoogleScholar',
      ...(dataCid !== undefined && dataCid !== '' ? { scholarCid: dataCid } : {}),
    })
    const parsed = papers[papers.length - 1]!
    for (const [key, value] of Object.entries(parsed)) {
      if (key === 'fieldSources' || key.startsWith('_') || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) continue
      parsed.fieldSources[key] = 'GoogleScholar'
    }
    // data-cid 仅用于 cite/BibTeX，不应冒充原始 paper_id。
  }
  return papers
}

/** BibTeX parser copied in spirit from auto-related-work; nested braces are supported. */
export function parseAutoRelatedWorkBibtex(bibtex: string): Partial<AutoPaper> {
  const field = (name: string): string | undefined => {
    const match = bibtex.match(new RegExp(`${name}\\s*=\\s*\\{`, 'i'))
    if (match === null || match.index === undefined) return undefined
    const start = match.index + match[0].length - 1
    let depth = 0
    for (let i = start; i < bibtex.length; i += 1) {
      if (bibtex[i] === '{') depth += 1
      if (bibtex[i] === '}') {
        depth -= 1
        if (depth === 0) return normalizeText(bibtex.slice(start + 1, i))
      }
    }
    return undefined
  }
  const authors = field('author')?.split(/\s+and\s+/i).map((item) => item.trim()).filter((item) => item.toLowerCase() !== 'others' && item !== '')
  const title = field('title')
  const venue = field('journal') ?? field('booktitle')
  const year = Number(field('year'))
  const doi = field('doi')
  return {
    ...(title !== undefined ? { title } : {}),
    ...(authors !== undefined && authors.length > 0 ? { authors } : {}),
    ...(venue !== undefined ? { venue } : {}),
    ...(Number.isFinite(year) ? { year } : {}),
    ...(doi !== undefined ? { doi } : {}),
    ...( /\band\s+others\b/i.test(bibtex) ? { authorsTruncated: true } : {}),
    bibtex,
  }
}

/** Bidirectional token/Jaccard matching from enrich_fields.py. */
export function autoRelatedWorkTitlesMatch(left: string | undefined, right: string | undefined, minWordOverlap = 0.55): boolean {
  if (left === undefined || right === undefined) return false
  const words = (value: string) => new Set(value.toLocaleLowerCase().match(/[a-z0-9]+/g) ?? [])
  const a = words(left); const b = words(right)
  if (a.size === 0 || b.size === 0) return false
  let shared = 0
  for (const word of a) if (b.has(word)) shared += 1
  const union = new Set([...a, ...b]).size
  return shared / union >= minWordOverlap || (shared >= 3 && shared / Math.min(a.size, b.size) >= 0.6)
}

function normalizeDOI(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const doi = value.replace(/^https?:\/\/doi\.org\//i, '').replace(/^doi:\s*/i, '').trim()
  return /^10\.\d{4,9}\/\S+$/i.test(doi) ? doi : undefined
}

function invertAbstract(value: unknown): string | undefined {
  if (!isObject(value)) return undefined
  const positions = new Map<number, string>()
  for (const [word, raw] of Object.entries(value)) {
    if (!Array.isArray(raw)) continue
    for (const pos of raw) if (typeof pos === 'number') positions.set(pos, word)
  }
  const result = [...positions.entries()].sort((a, b) => a[0] - b[0]).map((item) => item[1]).join(' ')
  return result.trim() === '' ? undefined : normalizeText(result)
}

function queryVariants(query: string): string[] {
  const variants = [query.trim()]
  const lower = query.toLocaleLowerCase()
  for (const separator of [' for ', ' via ', ' using ', ' with ', ' in ', ' on ']) {
    const index = lower.indexOf(separator)
    if (index > 18) variants.push(query.slice(0, index).replace(/[,:]\s*$/, '').trim())
  }
  if (query.includes(':')) variants.push(query.split(':')[0]!.trim())
  return [...new Set(variants.filter((item) => item.length >= 3))]
}

function scholarURL(baseURL: string, query: string, limit: number): string {
  const url = new URL(`${cleanURL(baseURL, AUTORELATEDWORK_DEFAULT_SCHOLAR_URL)}/scholar`)
  url.searchParams.set('q', query)
  url.searchParams.set('hl', 'en')
  url.searchParams.set('num', String(Math.min(Math.max(limit, 1), 20)))
  return url.toString()
}

export interface AutoRelatedWorkScholarAuthorResult {
  name: string
  scholarId?: string
  affiliation?: string
  interests?: string
  citedBy?: number
}

export interface AutoRelatedWorkScholarSearchResult {
  searchType: 'general' | 'cites' | 'related' | 'author'
  papers: AutoPaper[]
  authors: AutoRelatedWorkScholarAuthorResult[]
  total?: number
  status?: string
  elapsedMs: number
}

export function buildAutoRelatedWorkScholarURL(baseURL: string, searchType: 'general' | 'cites' | 'related' | 'author', query = '', citesId = '', start = 0, num = 10): string {
  const base = cleanURL(baseURL, AUTORELATEDWORK_DEFAULT_SCHOLAR_URL)
  const url = new URL(searchType === 'author' ? `${base}/citations` : `${base}/scholar`)
  if (searchType === 'author') {
    url.searchParams.set('view_op', 'search_authors')
    url.searchParams.set('mauthors', query)
  } else if (searchType === 'general') url.searchParams.set('q', query)
  else if (searchType === 'cites') url.searchParams.set('cites', citesId)
  else url.searchParams.set('q', `related:${citesId}:scholar.google.com/`)
  url.searchParams.set('hl', 'en')
  if (start > 0) url.searchParams.set('start', String(start))
  if (num !== 10) url.searchParams.set('num', String(num))
  return url.toString()
}

export function parseAutoRelatedWorkScholarAuthorResults(html: string): AutoRelatedWorkScholarAuthorResult[] {
  const results: AutoRelatedWorkScholarAuthorResult[] = []
  for (const block of html.matchAll(/<(?:div|li)\b[^>]*class=["'][^"']*(?:gsc_1usr|gs_ai)[^"']*["'][^>]*>([\s\S]*?)(?=<(?:div|li)\b[^>]*class=["'][^"']*(?:gsc_1usr|gs_ai)[^"']*["']|$)/gi)) {
    const value = block[1] ?? ''
    const nameMatch = value.match(/<(?:h3|div|a)\b[^>]*class=["'][^"']*(?:gs_ai_name|gsc_oai_name)[^"']*["'][^>]*>(?:[\s\S]*?<a\b[^>]*>)?([\s\S]*?)<\/a>/i)
      ?? value.match(/<h3\b[^>]*>\s*<a\b[^>]*>([\s\S]*?)<\/a>/i)
    const name = stripHTML(nameMatch?.[1] ?? '')
    if (name === '') continue
    const href = value.match(/href=["'][^"']*[?&]user=([^&"']+)/i)?.[1]
    const affiliation = text(stripHTML(value.match(/class=["'][^"']*(?:gsc_oai_aff|gs_ai_aff)[^"']*["'][^>]*>([\s\S]*?)<\//i)?.[1] ?? ''))
    const interests = text(stripHTML(value.match(/class=["'][^"']*(?:gsc_oai_int|gs_ai_int)[^"']*["'][^>]*>([\s\S]*?)<\//i)?.[1] ?? ''))
    const citedBy = parseNumberFromText(stripHTML(value.match(/class=["'][^"']*(?:gsc_oai_cby|gs_ai_cby)[^"']*["'][^>]*>([\s\S]*?)<\//i)?.[1] ?? ''))
    results.push({ name, ...(href !== undefined ? { scholarId: decodeHTML(href) } : {}), ...(affiliation !== undefined ? { affiliation } : {}), ...(interests !== undefined ? { interests } : {}), ...(citedBy !== undefined ? { citedBy } : {}) })
  }
  return results
}

/**
 * 与原始 scholar_search.scholar_search 对齐的搜索编排：支持 general/cites/
 * related/author、start/num 分页、总数解析和多端点竞速。普通
 * searchAutoRelatedWork 仍负责后续补全；需要引用/作者模式时直接调用此 API。
 */
export async function searchAutoRelatedWorkScholar(options: AutoRelatedWorkOptions & { searchType?: 'general' | 'cites' | 'related' | 'author'; citesId?: string; maxResults?: number }): Promise<AutoRelatedWorkScholarSearchResult> {
  const config = options.config ?? {}
  const searchType = options.searchType ?? config.searchType ?? 'general'
  const query = options.query.trim()
  const citesId = options.citesId ?? config.citesId ?? ''
  if ((searchType === 'general' || searchType === 'author') && query === '') throw new Error('Scholar 检索词不能为空')
  if ((searchType === 'cites' || searchType === 'related') && citesId.trim() === '') throw new Error('cites/related 检索必须提供 citesId')
  const fetchImpl = createAutoRelatedWorkFetch(options.fetchImpl ?? fetch, options)
  const maxResults = options.maxResults ?? config.maxScholarResults ?? options.limit ?? 10
  const boundedMax = maxResults <= 0 ? Number.POSITIVE_INFINITY : Math.max(1, Math.floor(maxResults))
  const pageSize = Math.min(10, Number.isFinite(boundedMax) ? boundedMax : 10)
  const maxPages = Math.max(1, Math.floor(config.maxScholarPages ?? (Number.isFinite(boundedMax) ? Math.ceil(boundedMax / pageSize) : 20)))
  const startedAt = Date.now()
  const papers: AutoPaper[] = []
  const authors: AutoRelatedWorkScholarAuthorResult[] = []
  let total: number | undefined
  let status: string | undefined
  let lastError: unknown
  for (let page = 0; page < maxPages && papers.length < boundedMax && authors.length < boundedMax; page += 1) {
    const start = page * pageSize
    const url = buildAutoRelatedWorkScholarURL(cleanURL(config.scholarURL, AUTORELATEDWORK_DEFAULT_SCHOLAR_URL), searchType, query, citesId, start, pageSize)
    try {
      const html = await requestScholarHTMLRace(url, options, fetchImpl, page)
      if (/recaptcha|sorry\/index|unusual traffic/i.test(html)) throw new Error('Google Scholar 返回 CAPTCHA/异常流量页面')
      status = 'HTTP 200'
      if (searchType === 'author') {
        authors.push(...parseAutoRelatedWorkScholarAuthorResults(html))
        if (authors.length >= boundedMax) break
      } else {
        const parsed = parseAutoRelatedWorkScholarResults(html, cleanURL(config.scholarURL, AUTORELATEDWORK_DEFAULT_SCHOLAR_URL))
        papers.push(...parsed)
        total ??= parseAutoRelatedWorkScholarTotalCount(html)
        if (parsed.length < pageSize || papers.length >= boundedMax) break
      }
      options.onProgress?.({ stage: 'scholar', index: page + 1, total: searchType === 'author' ? authors.length : papers.length, message: `Scholar 第 ${page + 1} 页` })
    } catch (error) {
      lastError = error
      if (page + 1 >= maxPages) break
      await new Promise<void>((resolve) => setTimeout(resolve, Math.min(30_000, autoRelatedWorkBackoff(page, 2, 30) * 1_000)))
    }
  }
  if (papers.length === 0 && authors.length === 0 && lastError !== undefined) throw lastError instanceof Error ? lastError : new Error(String(lastError))
  const uniquePapers = dedupePapers(papers, Number.isFinite(boundedMax) ? boundedMax : papers.length)
  const uniqueAuthors = authors.filter((item, index, list) => list.findIndex((other) => other.scholarId === item.scholarId && other.name === item.name) === index).slice(0, Number.isFinite(boundedMax) ? boundedMax : undefined)
  return { searchType, papers: uniquePapers, authors: uniqueAuthors, ...(total !== undefined ? { total } : {}), ...(status !== undefined ? { status } : {}), elapsedMs: Date.now() - startedAt }
}

async function requestText(fetchImpl: FetchLike, input: string, signal?: AbortSignal, init: RequestInit = {}): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20_000)
  const abort = () => controller.abort(signal?.reason)
  if (signal !== undefined) {
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
  }
  try {
    const response = await fetchImpl(input, { ...init, signal: controller.signal })
    const body = await response.text()
    if (!response.ok) throw new Error(`${response.status} ${body.slice(0, 180)}`)
    return body
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
  }
}

type AutoRelatedWorkNetworkService = 'scholar' | 'semanticScholar' | 'arxiv' | 'crossref' | 'openAlex' | 'dblp' | 'unpaywall' | 'deepseek'

function networkMode(config: AutoRelatedWorkConfig, service: AutoRelatedWorkNetworkService): NonNullable<AutoRelatedWorkConfig['netScholar']> | undefined {
  const explicit = service === 'scholar' ? config.netScholar
    : service === 'semanticScholar' ? config.netSemanticScholar ?? config.netSemSch
      : service === 'arxiv' ? config.netArxiv
        : service === 'crossref' ? config.netCrossref
          : service === 'openAlex' ? config.netOpenAlex
            : service === 'dblp' ? config.netDblp
              : service === 'unpaywall' ? config.netUnpaywall
                : config.netDeepSeek
  if (explicit !== undefined) return explicit
  // app.py 的默认值是：Scholar local+residential，公开学术 API local，
  // DeepSeek direct。没有任何代理配置时安全地退回 direct，避免发布版
  // 因本机没有 127.0.0.1:7892 而把所有公开 API 变成启动错误。
  if (service === 'deepseek') return 'direct'
  const hasLocal = Boolean(config.localProxy?.trim())
  const hasResidential = config.qgServers?.some((server) => server.trim() !== '') ?? false
  if (service === 'scholar') return hasLocal && hasResidential ? 'local+residential' : hasLocal ? 'local' : hasResidential ? 'residential' : 'direct'
  return hasLocal ? 'local' : hasResidential ? 'residential' : 'direct'
}

function networkServiceForURL(input: string): AutoRelatedWorkNetworkService | undefined {
  try {
    const host = new URL(input).hostname.toLocaleLowerCase()
    if (host.includes('scholar.google') || host === 'google.com' || host.endsWith('.google.com')) return 'scholar'
    if (host === 'api.semanticscholar.org' || host.endsWith('.semanticscholar.org')) return 'semanticScholar'
    if (host === 'export.arxiv.org' || host === 'arxiv.org' || host.endsWith('.arxiv.org')) return 'arxiv'
    if (host === 'api.crossref.org' || host.endsWith('.crossref.org')) return 'crossref'
    if (host === 'api.openalex.org' || host.endsWith('.openalex.org')) return 'openAlex'
    if (host === 'dblp.org' || host.endsWith('.dblp.org')) return 'dblp'
    if (host === 'api.unpaywall.org' || host.endsWith('.unpaywall.org')) return 'unpaywall'
    if (host === 'api.deepseek.com' || host.endsWith('.deepseek.com')) return 'deepseek'
  } catch { /* invalid/custom URLs remain on the injected fetch implementation */ }
  return undefined
}

function shouldUseConfiguredNetwork(fetchImpl: FetchLike, input: string, config: AutoRelatedWorkConfig): boolean {
  // Tests and callers may intentionally inject a fetch implementation. Do not
  // bypass that seam with a real socket, which also keeps fixture tests offline.
  if (fetchImpl !== fetch) return false
  const service = networkServiceForURL(input)
  return service !== undefined && networkMode(config, service) !== undefined && networkMode(config, service) !== 'direct'
}

function configuredProxyTarget(config: AutoRelatedWorkConfig, credentials: AutoRelatedWorkCredentials, service: AutoRelatedWorkNetworkService): { mode: NonNullable<AutoRelatedWorkConfig['netScholar']>; local?: { host: string; port: number }; residential?: { host: string; port: number } } | undefined {
  const mode = networkMode(config, service)
  if (mode === undefined || mode === 'direct') return undefined
  const localProxy = config.localProxy?.trim()
  const server = (config.qgServers ?? []).map((item) => item.trim()).find(Boolean)
  // A configured endpoint is not automatically part of every mode.  Keeping
  // both values here made `local` accidentally become local+residential and
  // made `residential` still connect through the local proxy.  That was mostly
  // invisible in fixture tests because they inject fetch, but it breaks the
  // real Nexip/Clash transport at the second CONNECT hop.
  const local = (mode === 'local' || mode === 'local+residential') && localProxy !== undefined && localProxy !== ''
    ? splitHostPort(localProxy, 7892)
    : undefined
  const residential = (mode === 'residential' || mode === 'local+residential') && server !== undefined
    ? splitHostPort(server, config.qgPort ?? 443)
    : undefined
  if ((mode === 'local' || mode === 'local+residential') && local === undefined) throw new Error(`${service} 网络模式为 ${mode}，但未配置 LOCAL_PROXY`)
  if ((mode === 'residential' || mode === 'local+residential') && residential === undefined) throw new Error(`${service} 网络模式为 ${mode}，但未配置住宅代理端点`)
  if ((mode === 'residential' || mode === 'local+residential') && (credentials.qgAuthKey === undefined || credentials.qgAuthPwd === undefined)) throw new Error(`${service} 网络模式需要住宅代理认证信息`)
  return { mode, local, residential }
}

function parseRawHTTPResponse(raw: Buffer): { status: number; headers: Record<string, string>; body: string } {
  const separator = raw.indexOf('\r\n\r\n')
  if (separator < 0) throw new Error('代理返回了不完整的 HTTP 响应')
  const headerText = raw.subarray(0, separator).toString('latin1')
  const bodyRaw = raw.subarray(separator + 4)
  const headers = headerMap(headerText)
  let body = bodyRaw
  if (/transfer-encoding:\s*chunked/i.test(headerText)) body = decodeChunkedBody(bodyRaw)
  const length = Number(headers['content-length'])
  if (Number.isFinite(length) && length >= 0 && body.length > length) body = body.subarray(0, length)
  return { status: Number(headerText.match(/^HTTP\/\d(?:\.\d)?\s+(\d+)/i)?.[1] ?? 0), headers, body: body.toString('utf8') }
}

function tlsRequestOverSocket(socket: Socket, host: string, method: string, path: string, headers: Record<string, string>, body = '', timeoutMs = 25_000): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  return new Promise((resolve, reject) => {
    const tlsSocket: TLSSocket = connectTLS({ socket, servername: host, rejectUnauthorized: false })
    const chunks: Buffer[] = []
    let settled = false
    const timer = setTimeout(() => finish(new Error(`${host} 请求超时`)), timeoutMs)
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      tlsSocket.removeAllListeners()
      if (error === undefined) {
        try { resolve(parseRawHTTPResponse(Buffer.concat(chunks))) } catch (parseError) { reject(parseError) }
      } else { tlsSocket.destroy(); reject(error) }
    }
    tlsSocket.once('secureConnect', () => {
      const requestHeaders: Record<string, string> = {
        Host: host,
        'User-Agent': 'EvoResearch/0.1 AutoRelatedWork',
        Accept: '*/*',
        'Accept-Encoding': 'identity',
        Connection: 'close',
        ...headers,
      }
      if (body !== '' && requestHeaders['Content-Length'] === undefined && requestHeaders['content-length'] === undefined) requestHeaders['Content-Length'] = String(Buffer.byteLength(body))
      const lines = [`${method.toUpperCase()} ${path} HTTP/1.1`, ...Object.entries(requestHeaders).map(([key, value]) => `${key}: ${value}`), '', body]
      tlsSocket.write(lines.join('\r\n'))
    })
    tlsSocket.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    tlsSocket.once('error', (error) => finish(error))
    tlsSocket.once('close', () => finish())
  })
}

async function configuredNetworkFetch(fetchImpl: FetchLike, input: string | URL | Request, init: RequestInit, options: { config: AutoRelatedWorkConfig; credentials?: AutoRelatedWorkCredentials; signal?: AbortSignal }): Promise<Response> {
  const url = String(input)
  if (!shouldUseConfiguredNetwork(fetchImpl, url, options.config)) return fetchImpl(input, init)
  const service = networkServiceForURL(url)
  if (service === undefined) return fetchImpl(input, init)
  const target = new URL(url)
  const proxy = configuredProxyTarget(options.config, options.credentials ?? {}, service)
  if (proxy === undefined) return fetchImpl(input, init)
  const socket = await connectSocket(proxy.local?.host ?? proxy.residential!.host, proxy.local?.port ?? proxy.residential!.port, 20_000)
  try {
    if (proxy.residential !== undefined) {
      if (proxy.local !== undefined) await connectTunnel(socket, proxy.residential.host, proxy.residential.port)
      const key = rotateResidentialProxySession(options.credentials?.qgAuthKey ?? '')
      const rawCredential = `${key}:${options.credentials?.qgAuthPwd ?? ''}${options.config.country === undefined || options.config.country === '' ? '' : `:A${options.config.country}`}${options.config.qgChannel === undefined || options.config.qgChannel === '' ? '' : `:C${options.config.qgChannel}:T120`}`
      await connectTunnel(socket, target.hostname, Number(target.port || 443), Buffer.from(rawCredential).toString('base64'))
    } else await connectTunnel(socket, target.hostname, Number(target.port || 443))
    const headers: Record<string, string> = {}
    if (init.headers !== undefined) new Headers(init.headers).forEach((value, key) => { headers[key] = value })
    const method = init.method ?? 'GET'
    const body = typeof init.body === 'string' ? init.body : init.body === undefined ? '' : Buffer.from(init.body as ArrayBuffer).toString('utf8')
    const response = await tlsRequestOverSocket(socket, target.hostname, method, `${target.pathname}${target.search}`, headers, body, 30_000)
    return new Response(response.body, { status: response.status, headers: response.headers })
  } finally { if (!socket.destroyed) socket.destroy() }
}

export function createAutoRelatedWorkFetch(fetchImpl: FetchLike, options: AutoRelatedWorkOptions): FetchLike {
  return (input, init = {}) => configuredNetworkFetch(fetchImpl, input, init, { config: options.config ?? {}, credentials: options.credentials, signal: options.signal })
}

async function requestJSON(fetchImpl: FetchLike, input: string, signal?: AbortSignal, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const body = await requestText(fetchImpl, input, signal, { headers: { accept: 'application/json', 'user-agent': 'EvoResearch/0.1 AutoRelatedWork', ...(init.headers ?? {}) }, ...init })
  const parsed = JSON.parse(body) as unknown
  if (!isObject(parsed)) throw new Error('AutoRelatedWork 数据源返回的不是 JSON 对象')
  return parsed
}

function scholarAccessConfigured(config: AutoRelatedWorkConfig): boolean {
  const mode = config.netScholar
  if (mode === 'direct') return false
  const hasLocal = Boolean(config.localProxy?.trim())
  const hasResidential = config.qgServers?.some((server) => server.trim() !== '') ?? false
  if (mode === 'local') return hasLocal
  if (mode === 'residential') return hasResidential
  return hasLocal || hasResidential
}

function effectiveScholarConfig(config: AutoRelatedWorkConfig): AutoRelatedWorkConfig {
  if (config.netScholar === undefined || config.netScholar === 'local+residential') return config
  if (config.netScholar === 'direct') return { ...config, localProxy: undefined, qgServers: [] }
  if (config.netScholar === 'local') return { ...config, qgServers: [] }
  return { ...config, localProxy: undefined }
}

async function requestScholarHTML(
  url: string,
  options: AutoRelatedWorkOptions,
  fetchImpl: FetchLike,
  serverIndex = 0,
): Promise<string> {
  const config = effectiveScholarConfig(options.config ?? {})
  const credentials = options.credentials ?? {}
  const isScholar = /(?:scholar\.google|google\.com)/i.test(url)
  if (isScholar) await autoRelatedWorkScholarSession.waitAndMark()
  if (scholarAccessConfigured(config)) {
    try {
      return await scholarViaConnect(url, config, credentials, serverIndex)
    } catch (error) {
      if (isScholar) autoRelatedWorkScholarSession.reportBlocked()
      throw error
    }
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.scholarTimeoutMs ?? 20_000)
  const abort = () => controller.abort(options.signal?.reason)
  if (options.signal !== undefined) {
    if (options.signal.aborted) abort()
    else options.signal.addEventListener('abort', abort, { once: true })
  }
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
        ...(autoRelatedWorkScholarSession.cookieHeader() === '' ? {} : { cookie: autoRelatedWorkScholarSession.cookieHeader() }),
      },
    })
    const body = await response.text()
    const headers: Record<string, string> = {}
    response.headers?.forEach((value, key) => { headers[key.toLocaleLowerCase()] = value })
    autoRelatedWorkScholarSession.updateHeaders(headers)
    if (!response.ok) throw new Error(`${response.status} ${body.slice(0, 180)}`)
    if (isScholar && /(?:recaptcha|sorry\/index|unusual traffic)/i.test(body)) {
      autoRelatedWorkScholarSession.reportBlocked()
      throw new Error('Google Scholar 返回 CAPTCHA/异常流量页面')
    }
    const scholarTarget = new URL(url)
    const isScholarSearch = isScholar && scholarTarget.pathname === '/scholar' && scholarTarget.searchParams.has('q') && scholarTarget.searchParams.get('output') !== 'cite'
    if (isScholarSearch && !/<h3\b[^>]*class=["'][^"']*\bgs_rt\b/i.test(body)) {
      autoRelatedWorkScholarSession.reportBlocked()
      throw new Error('Google Scholar 返回空结果/静默封禁页面')
    }
    if (isScholar) autoRelatedWorkScholarSession.reportOK()
    return body
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', abort)
  }
}

async function requestScholarHTMLRace(url: string, options: AutoRelatedWorkOptions, fetchImpl: FetchLike, round: number): Promise<string> {
  const config = effectiveScholarConfig(options.config ?? {})
  const servers = (config.qgServers ?? []).map((item) => item.trim()).filter(Boolean)
  // scholar_search.py 的 http_fetch_loop 固定用两个并发请求竞速，即使
  // 只有一个住宅端点也如此；失败后再进入下一轮并轮换端点。之前在
  // `servers.length === 1` 时退化成单请求，导致 Nexip 的瞬时断连无法
  // 获得原版的第二次机会。
  if (!scholarAccessConfigured(config)) return requestScholarHTML(url, options, fetchImpl, round)
  const raceCount = 2
  const attempts = Array.from({ length: raceCount }, (_, index) => requestScholarHTML(url, options, fetchImpl, (round + index) % Math.max(1, servers.length)))
  try {
    return await Promise.any(attempts)
  } catch (error) {
    throw new Error(attempts.length === 0 ? '没有可用的住宅代理端点' : `所有 Scholar 端点均失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

function scholarLink(html: string, baseURL: string, pattern: RegExp): string | undefined {
  const match = html.match(pattern)
  return match === null ? undefined : absoluteURL(decodeHTML(match[1] ?? ''), baseURL)
}

/** 通过 Scholar 的 info 页面获取结构化 BibTeX；这是参考项目完整模式的关键步骤。 */
async function fetchScholarBibtex(paper: AutoPaper, options: AutoRelatedWorkOptions, fetchImpl: FetchLike): Promise<string | undefined> {
  if (paper.scholarCid === undefined || paper.scholarCid === '') return undefined
  const baseURL = cleanURL(options.config?.scholarURL, AUTORELATEDWORK_DEFAULT_SCHOLAR_URL)
  const infoURL = `${baseURL}/scholar?q=info:${encodeURIComponent(paper.scholarCid)}:scholar.google.com/&output=cite&hl=en`
  const bibOptions: AutoRelatedWorkOptions = {
    ...options,
    config: { ...(options.config ?? {}), qgChannel: options.config?.qgChannel ?? `bib${randomInt(100_000, 999_999)}` },
  }
  try {
    const citeHTML = await requestScholarHTML(infoURL, bibOptions, fetchImpl)
    const bibURL = scholarLink(citeHTML, baseURL, /href=["']([^"']*scholar\.bib[^"']*)["']/i)
    if (bibURL === undefined) return undefined
    const body = await requestScholarHTML(bibURL, bibOptions, fetchImpl, 1)
    const value = body.trim()
    return (value.startsWith('@') && value.length > 30) || (/\bauthor\b/i.test(value) && /\btitle\b/i.test(value) && value.length > 50)
      ? value
      : undefined
  } catch {
    return undefined
  }
}

/** 原始 enrich_bibtex：每轮两个独立 channel 竞速，失败后进入下一轮。 */
async function fetchScholarBibtexParallel(paper: AutoPaper, options: AutoRelatedWorkOptions, fetchImpl: FetchLike): Promise<string | undefined> {
  const rounds = Math.max(1, Math.floor(options.config?.bibtexRounds ?? 12))
  for (let round = 0; round < rounds; round += 1) {
    const attempts = [0, 1].map(() => fetchScholarBibtex(paper, options, fetchImpl))
    try {
      return await Promise.any(attempts)
    } catch {
      // 下一轮会重新生成 proxy session/channel；与 Python 版本相同。
    }
  }
  return undefined
}

/** Fetch-only BibTeX primitive used by the pipeline's parallel Wave 1. */
export async function fetchAutoRelatedWorkBibtex(paper: AutoPaper, options: AutoRelatedWorkOptions): Promise<string | undefined> {
  if (paper.scholarCid === undefined || paper.scholarCid === '' || paper.bibtex !== undefined) return paper.bibtex
  const fetchImpl = createAutoRelatedWorkFetch(options.fetchImpl ?? fetch, options)
  try {
    return await retry(async () => {
      const bibtex = await fetchScholarBibtexParallel(paper, options, fetchImpl)
      if (bibtex === undefined) throw new Error('BibTeX 链接不可用')
      return bibtex
    }, Math.min(Math.max(Math.floor(options.config?.bibtexRounds ?? 12), 1), 12), Math.max(200, Math.floor(options.config?.delayMs ?? 1200)), options.signal)
  } catch { return undefined }
}

function applyBibtex(paper: AutoPaper, bibtex: string): void {
  const parsed = parseAutoRelatedWorkBibtex(bibtex)
  paper.bibtex = bibtex
  paper.fieldSources.bibtex = 'GoogleScholar'
  if (typeof parsed.title === 'string' && parsed.title !== '') { paper.title = parsed.title; paper.fieldSources.title = 'BibTeX' }
  if (Array.isArray(parsed.authors) && parsed.authors.length > 0) {
    paper.authors = parsed.authors
    paper.authorsDetailed = parsed.authors.map((name) => ({ name }))
    paper.fieldSources.authors = 'BibTeX'
  }
  if (typeof parsed.venue === 'string' && parsed.venue !== '') { paper.venue = parsed.venue; paper.fieldSources.venue = 'BibTeX' }
  if (typeof parsed.year === 'number' && Number.isFinite(parsed.year)) { paper.year = parsed.year; paper.fieldSources.year = 'BibTeX' }
  if (typeof parsed.doi === 'string') { paper.doi = normalizeDOI(parsed.doi) ?? parsed.doi; paper.fieldSources.doi = 'BibTeX' }
  if (parsed.authorsTruncated === true) paper.authorsTruncated = true
}

/** 供 Flask 兼容 API 复用的 Scholar BibTeX 阶段。 */
export async function enrichAutoRelatedWorkBibtex(papers: AutoPaper[], options: AutoRelatedWorkOptions, maxRounds = 1): Promise<void> {
  const fetchImpl = createAutoRelatedWorkFetch(options.fetchImpl ?? fetch, options)
  for (const paper of papers) {
    if (paper.bibtex !== undefined || paper.scholarCid === undefined) continue
    try {
      const value = await retry(async () => {
        const bibtex = await fetchScholarBibtexParallel(paper, options, fetchImpl)
        if (bibtex === undefined) throw new Error('BibTeX 链接不可用')
        return bibtex
      }, Math.min(Math.max(Math.floor(maxRounds), 1), 12), Math.max(200, Math.floor(options.config?.delayMs ?? 1200)), options.signal)
      applyBibtex(paper, value)
    } catch { /* 与原版一样，单篇 BibTeX 失败不阻塞整个批次。 */ }
  }
}

/** 原 app.py `_score_paper_relevance` 的 JSON 兼容实现。 */
export async function scoreAutoRelatedWorkRelevance(paper: AutoPaper, query: string, options: AutoRelatedWorkOptions): Promise<{ score: number; reason: string } | undefined> {
  const key = options.credentials?.deepseekApiKey?.trim()
  if (key === undefined || key === '') return undefined
  const lines = [
    paper.title === '' ? undefined : `Title: ${paper.title}`,
    paper.authors.length === 0 ? undefined : `Authors: ${paper.authors.slice(0, 10).join(', ')}`,
    paper.year === undefined ? undefined : `Year: ${paper.year}`,
    paper.venue === undefined ? undefined : `Venue: ${paper.venue}`,
    paper.abstract === undefined ? undefined : `Abstract: ${paper.abstract.slice(0, 800)}`,
    paper.institutions.length === 0 ? undefined : `Institutions: ${paper.institutions.slice(0, 5).join('; ')}`,
    paper.domain === undefined ? undefined : `Domain: ${paper.domain}`,
    paper.doi === undefined ? undefined : `DOI: ${paper.doi}`,
  ].filter((line): line is string => line !== undefined).join('\n')
  const prompt = [
    'You are an academic paper relevance scoring system.', '', `Search Query: "${query}"`, '', 'Paper Information:', lines, '',
    'Scoring Rules:', '- 90-100: Paper\'s primary topic directly matches the search query', '- 70-89: Paper is highly relevant with substantial topical overlap', '- 50-69: Paper is moderately relevant, shares key themes or methods', '- 30-49: Paper is tangentially related, mentions the topic peripherally', '- 10-29: Paper has minimal relation to the query', '- 0-9: Paper is essentially unrelated', '',
    'Evaluation criteria (in order of importance):', '1. Keyword match: Do title/abstract contain the exact query terms?', '2. Topic alignment: Does the paper address the same research problem?', '3. Methodological similarity: Same methods or techniques?', '4. Domain/field alignment: Same application domain?', '',
    'Return ONLY valid JSON (no markdown, no explanation):', '{"score": <integer 0-100>, "reason": "<one sentence in Chinese>"}',
  ].join('\n')
  try {
    const body = await requestJSON(createAutoRelatedWorkFetch(options.fetchImpl ?? fetch, options), deepseekCompletionURL(options.config ?? {}, options.credentials), options.signal, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: options.config?.deepseekModel?.trim() || 'deepseek-chat', messages: [{ role: 'system', content: 'You are a precise academic paper relevance scorer. Return only JSON.' }, { role: 'user', content: prompt }], temperature: 0 }),
    })
    const choices = Array.isArray(body.choices) ? body.choices : []
    const message = isObject(choices[0]) && isObject(choices[0].message) ? choices[0].message : {}
    const content = typeof message.content === 'string' ? message.content : ''
    const parsedText = content.match(/\{[\s\S]*\}/)?.[0]
    const scoreMatch = content.match(/"score"\s*:\s*(\d+)/)
    if (parsedText === undefined && scoreMatch === undefined) return undefined
    const parsed = parsedText === undefined ? {} : JSON.parse(parsedText) as Record<string, unknown>
    const score = Math.max(0, Math.min(100, Math.floor(Number(parsed.score ?? scoreMatch?.[1] ?? 0))))
    return { score, reason: typeof parsed.reason === 'string' ? parsed.reason : (content.match(/"reason"\s*:\s*"([^"]*)"/)?.[1] ?? '') }
  } catch { return undefined }
}

/** 供 Flask 兼容 API 复用的 arXiv API/HTML 两个初始阶段。 */
export async function enrichAutoRelatedWorkArxiv(papers: AutoPaper[], options: AutoRelatedWorkOptions): Promise<void> {
  const fetchImpl = createAutoRelatedWorkFetch(options.fetchImpl ?? fetch, options)
  if (options.config?.fetchArxiv !== false) for (const paper of papers) await enrichFromArxiv(paper, options, fetchImpl)
  if (options.config?.fetchArxivHTML !== false) for (const paper of papers) await enrichFromArxivHTML(paper, options, fetchImpl)
}

async function parallelPaperStage(papers: AutoPaper[], stage: (paper: AutoPaper) => Promise<void>, maxWorkers = 4): Promise<void> {
  // Python's _par_enrich uses a bounded ThreadPoolExecutor.  Promise.all over
  // the whole result set changes both observable request pressure and the
  // order in which competing providers mutate one paper, so keep the same
  // bounded worker-pool shape here.
  let cursor = 0
  const workers = Math.min(Math.max(1, Math.floor(maxWorkers)), Math.max(1, papers.length))
  await Promise.all(Array.from({ length: workers }, async () => {
    while (true) {
      const index = cursor++
      if (index >= papers.length) return
      const paper = papers[index]!
      try { await stage(paper) } catch { /* one source/paper never aborts the batch */ }
    }
  }))
}

/**
 * The app.py pipeline's Wave 1.  Each source is independent and therefore
 * starts as a sibling task; BibTeX is deliberately included in the same wave
 * and its authoritative overwrite is performed by the caller after this
 * function resolves.  The flags distinguish `/api/search` from the full SSE
 * pipeline, whose Wave 1 additionally includes Unpaywall.
 */
export async function enrichAutoRelatedWorkWave1(
  papers: AutoPaper[],
  options: AutoRelatedWorkOptions,
  flags: { bibtex?: boolean; unpaywall?: boolean } = {},
): Promise<void> {
  const fetchImpl = createAutoRelatedWorkFetch(options.fetchImpl ?? fetch, options)
  const tasks: Promise<void>[] = []
  // app.py groups arXiv/Crossref/OpenAlex/Unpaywall into one eight-worker
  // task, with those providers serial per paper.  DBLP and Semantic Scholar
  // are separate six-/four-worker tasks and can race that group.  Preserve
  // that structure because it determines source precedence and request load.
  tasks.push(parallelPaperStage(papers, async (paper) => {
    if (options.config?.fetchArxiv !== false) await enrichFromArxiv(paper, options, fetchImpl)
    await enrichCrossrefPaper(paper, options, fetchImpl)
    await enrichOpenAlexPaper(paper, options, fetchImpl)
    if (flags.unpaywall === true && options.config?.fetchUnpaywall !== false) await enrichUnpaywallPaper(paper, options, fetchImpl)
  }, 8))
  tasks.push(parallelPaperStage(papers, (paper) => enrichDblpPaper(paper, options, fetchImpl), 6))
  if (options.config?.fetchSemanticScholar !== false) tasks.push(parallelPaperStage(papers, (paper) => enrichSemanticScholarPaper(paper, options, fetchImpl), 4))
  if (flags.bibtex === true && options.config?.fetchBibtex !== false) {
    // Fetch in Wave 1, but defer the authoritative field overwrite until all
    // independent providers have completed (the same two-step behavior as
    // app.py's `_wave1_bibtex` followed by `_enrich_from_bibtex`).
    tasks.push(parallelPaperStage(papers, async (paper) => {
      const bibtex = await fetchAutoRelatedWorkBibtex(paper, options)
      if (bibtex !== undefined) { paper.bibtex = bibtex; paper.fieldSources.bibtex = 'GoogleScholar' }
    }, 5))
  }
  await Promise.all(tasks)
  if (flags.bibtex === true && options.config?.fetchBibtex !== false) {
    for (const paper of papers) if (paper.bibtex !== undefined) applyBibtex(paper, paper.bibtex)
  }
}

/** app.py pipeline Wave 2: arXiv HTML and the two DeepSeek enrichment passes. */
export async function enrichAutoRelatedWorkWave2(
  papers: AutoPaper[],
  options: AutoRelatedWorkOptions,
  deepseekEnrich = true,
): Promise<void> {
  const fetchImpl = createAutoRelatedWorkFetch(options.fetchImpl ?? fetch, options)
  const tasks: Promise<void>[] = []
  if (options.config?.fetchArxivHTML !== false) tasks.push(parallelPaperStage(papers, (paper) => enrichFromArxivHTML(paper, options, fetchImpl), 4))
  const hasKey = (options.credentials?.deepseekApiKey?.trim() ?? '') !== ''
  if (deepseekEnrich && hasKey) {
    tasks.push(parallelPaperStage(papers, async (paper) => {
      await enrichWithDeepSeekMetadata(paper, options, fetchImpl)
      if (options.config?.deepseekAuthorFallback !== false) await enrichWithDeepSeekAuthorFallback(paper, options, fetchImpl)
    }, Math.max(3, Math.min(12, papers.length))))
  }
  await Promise.all(tasks)
}

function arxivIdForPaper(paper: AutoPaper): string | undefined {
  const values = [paper.url, ...paper.externalUrls, ...paper.additionalUrls, paper.bibtex, paper.snippet, paper.authorsStr].filter((value): value is string => typeof value === 'string')
  for (const value of values) {
    const match = value.match(/(?:arxiv\.org\/(?:abs|pdf|html)\/|arxiv\s*[:\-]\s*)(\d{4}\.\d{4,5})(?:v\d+)?/i)
    if (match?.[1] !== undefined) return match[1]
  }
  return undefined
}

function xmlText(block: string, tag: string): string | undefined {
  const match = block.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))
  return match === null ? undefined : stripHTML(match[1] ?? '')
}

function parseArxivEntry(body: string): { id?: string; title?: string; abstract?: string; year?: number; authors: string[] } | undefined {
  const entry = body.match(/<entry\b[^>]*>([\s\S]*?)<\/entry>/i)?.[1]
  if (entry === undefined) return undefined
  const id = xmlText(entry, 'id')?.match(/arxiv\.org\/abs\/([^?\s]+)/i)?.[1]
  const title = xmlText(entry, 'title')
  const abstract = xmlText(entry, 'summary')
  const published = xmlText(entry, 'published')
  const authors = [...entry.matchAll(/<author\b[^>]*>([\s\S]*?)<\/author>/gi)]
    .map((match) => xmlText(match[1] ?? '', 'name')).filter((name): name is string => name !== undefined)
  const year = published === undefined ? undefined : Number(published.slice(0, 4))
  return { ...(id !== undefined ? { id } : {}), ...(title !== undefined ? { title } : {}), ...(abstract !== undefined ? { abstract } : {}), ...(year !== undefined && Number.isFinite(year) ? { year } : {}), authors }
}

async function enrichFromArxiv(paper: AutoPaper, options: AutoRelatedWorkOptions, fetchImpl: FetchLike): Promise<void> {
  const arxivId = arxivIdForPaper(paper)
  if (arxivId === undefined) return
  const apiURL = `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(arxivId)}&max_results=1`
  try {
    const entry = parseArxivEntry(await requestText(fetchImpl, apiURL, options.signal, { headers: { accept: 'application/atom+xml', 'user-agent': 'EvoResearch/0.1' } }))
    if (entry === undefined) return
    const arxivURL = `https://arxiv.org/abs/${arxivId}`
    if (!paper.externalUrls.some((url) => /arxiv\.org\/abs\//i.test(url))) paper.externalUrls.unshift(arxivURL)
    if (paper.url === undefined) paper.url = arxivURL
    if (paper.authors.length < entry.authors.length) {
      paper.authors = entry.authors
      paper.authorsDetailed = entry.authors.map((name) => ({ name }))
      paper.fieldSources.authors = 'arXiv'
    }
    // scholar_search.py 总是用 arXiv 的完整摘要覆盖搜索结果页的 snippet；
    // 这里不能用“仅在 undefined 时填充”，否则先前较短的摘要会阻止
    // 原版的完整字段进入结果。
    if (entry.abstract !== undefined) { paper.abstract = entry.abstract; paper.fieldSources.abstract = 'arXiv' }
    if (paper.year === undefined && entry.year !== undefined) { paper.year = entry.year; paper.fieldSources.year = 'arXiv' }
  } catch { /* arXiv 是可选补全源 */ }
}

async function enrichFromArxivHTML(paper: AutoPaper, options: AutoRelatedWorkOptions, fetchImpl: FetchLike): Promise<void> {
  const arxivId = arxivIdForPaper(paper)
  if (arxivId === undefined) return
  for (const url of [`https://arxiv.org/html/${arxivId}v1`, `https://arxiv.org/html/${arxivId}`]) {
    try {
      const html = await requestText(fetchImpl, url, options.signal, { headers: { accept: 'text/html', 'user-agent': 'EvoResearch/0.1' } })
      const details = parseArxivHTMLDetails(html)
      if (details.authors.length > 0 || details.institutions.length > 0 || details.emails.length > 0) {
        mergeAuthorDetails(paper, details.authors)
        paper.institutions = [...new Set([...paper.institutions, ...details.institutions])]
        paper.emails = [...new Set([...paper.emails, ...details.emails])]
        if (details.institutions.length > 0) paper.fieldSources.institutions = 'arXiv HTML'
        if (details.emails.length > 0) paper.fieldSources.emails = 'arXiv HTML'
        if (details.authors.length > 0) paper.fieldSources.authorsDetailed = 'arXiv HTML'
      }
      const withAffiliations = paper.authorsDetailed.filter((author) => (author.affiliations?.length ?? 0) > 0).length
      const needsAIFallback = options.config?.arxivAIFallback !== false
        && paper.authorsDetailed.length > 0
        && (details.authors.length === 0 || withAffiliations < paper.authorsDetailed.length * 0.5 || paper.institutions.length <= 1)
      if (needsAIFallback) {
        const aiAuthors = await aiParseArxivAuthors(html, paper.title, options, fetchImpl)
        if (aiAuthors.length > 0) {
          mergeAuthorDetails(paper, aiAuthors)
          paper.fieldSources.authorsDetailed = 'DeepSeek AI'
          if (paper.institutions.length > 0) paper.fieldSources.institutions = 'DeepSeek AI'
          if (paper.emails.length > 0) paper.fieldSources.emails = 'DeepSeek AI'
        }
      }
      if (paper.authorsDetailed.length === 0 && paper.institutions.length === 0 && paper.emails.length === 0) continue
      return
    } catch { /* old arXiv records may not have an HTML5 rendering */ }
  }
}

function parseArxivHTMLDetails(html: string): { authors: AcademicAuthor[]; institutions: string[]; emails: string[] } {
  // 这是 scholar_search.py `_enrich_author_affiliations` 的同构实现。
  // 不能只读取带 ltx_affiliation class 的 span：arXiv HTML5 还会把
  // “1 University ...” 作为普通文本节点输出，且存在单 span 压缩作者格式。
  const authors: AcademicAuthor[] = []
  const institutions = new Set<string>()
  const emails = [...html.matchAll(/href=["']mailto:([^"']+)["']/gi)]
    .map((match) => decodeHTML(match[1] ?? '').trim()).filter(Boolean)
  const authStart = html.search(/class=["'][^"']*ltx_authors[^"']*["']/i)
  if (authStart < 0) return { authors, institutions: [], emails: [...new Set(emails)] }
  const relativeAbstract = html.slice(authStart).search(/class=["'][^"']*ltx_abstract[^"']*["']/i)
  const abstractStart = relativeAbstract < 0 ? -1 : authStart + relativeAbstract
  const sectionEnd = abstractStart < 0 ? authStart + 30_000 : abstractStart
  const section = decodeHTML(html.slice(authStart, sectionEnd))
  const plain = section.replace(/<[^>]+>/g, '\n').replace(/\n\s*\n+/g, '\n').trim()
  const lines = plain.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const isInstitution = (value: string): boolean => {
    const item = value.trim()
    if (item === '' || item.length < 2 || /^https?:\/\//i.test(item) || /^\d+$/.test(item)) return false
    if (/^[A-Z]{2,8}$/.test(item)) return true
    if (/University|College|Institute|Laboratory|Research|Center|School|Department|Faculty|Division|Technologies|Inc\.|Ltd|LLC|Corp|Tencent|Google|Meta|Microsoft|Amazon|Apple|IBM|Intel|NVIDIA|Adobe|AI\s|Lab\b|Science|Technology|Innovation|Foundation|Hospital|Academy/i.test(item)) return true
    const words = item.split(/\s+/).filter(Boolean)
    return words.length >= 3 || (words.length === 1 && words[0]!.length >= 7)
  }
  const affiliationMap = new Map<string, string>()
  for (const line of lines) {
    const inline = line.match(/^(\d{1,2})\s+(\S.{1,120})$/)
    if (inline !== null && isInstitution(inline[2]!)) affiliationMap.set(inline[1]!, inline[2]!.trim())
  }
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (/^\d{1,2}$/.test(lines[index]!) && !affiliationMap.has(lines[index]!)) {
      const next = lines[index + 1]!
      if (isInstitution(next)) affiliationMap.set(lines[index]!, next)
    }
  }
  for (const value of affiliationMap.values()) institutions.add(value)

  const authSectionEnd = abstractStart < 0 ? authStart + 8_000 : abstractStart
  const authSection = html.slice(authStart, authSectionEnd)
  const personBlocks = [...authSection.matchAll(/<span\b[^>]*class=["'][^"']*ltx_personname[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi)]
  const cleanName = (value: string): string => decodeHTML(value).replace(/\s+/g, ' ').trim()
    .replace(/\d[\d,\s]*[*†‡§¶#∗♡♠♦♣©®™⊕⋆]+$/u, '').replace(/[\d,\s]*[*†‡§¶#∗♡♠♦♣©®™⊕⋆]+$/u, '').replace(/,$/, '').trim()
  const isPerson = (value: string): boolean => {
    const item = value.replace(/[\d,\s]*[*†‡§¶#∗♡♠♦♣©®™⊕⋆]+$/u, '').trim()
    const words = item.split(/\s+/).filter(Boolean)
    return item.length >= 2 && !/^[A-Z]{2,8}$/.test(item) && !/https?/i.test(item) && !(words.length >= 2 && words.length <= 4 && words.every((word) => /^[A-Z]/.test(word)) && !/University|College|Institute|School|Lab|Research|Technology|Academy|Hospital|Company|Center|Centre|Department|实验室|大学|学院|研究所|研究院|中心/i.test(item))
  }

  // 压缩格式：一个 ltx_personname 中用 & 连接多个作者，每个作者后面
  // 可能紧跟普通文本形式的机构。
  if (personBlocks.length === 1 && /(?:&amp;|\s&\s|<br\b)/i.test(personBlocks[0]![1] ?? '')) {
    const raw = decodeHTML((personBlocks[0]![1] ?? '').replace(/<\s*br\b[^>]*>/gi, '\n').replace(/<[^>]+>/g, ''))
    const seen = new Set<string>()
    for (const entry of raw.split('&')) {
      const entryLines = entry.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)
      if (entryLines.length === 0) continue
      const name = cleanName(entryLines[0]!)
      if (!isPerson(name) || seen.has(name)) continue
      seen.add(name)
      const affiliations = entryLines.slice(1).filter((item) => !/^\d+$/.test(item) && !/^[A-Z][a-z]+\s+[A-Z][a-z]+$/.test(item))
      authors.push({ name, ...(affiliations.length > 0 ? { affiliations: [...new Set(affiliations)] } : {}) })
    }
    if (authors.length > 0) {
      if (/[*†‡§¶#∗]/u.test(raw) && emails.length > 0) authors[0] = { ...authors[0]!, corresponding: true, email: emails[0] }
      return { authors, institutions: [...new Set([...institutions, ...authors.flatMap((author) => author.affiliations ?? [])])], emails: [...new Set(emails)] }
    }
  }

  const seenNames = new Set<string>()
  for (const match of personBlocks) {
    const raw = match[1] ?? ''
    const sup = [...raw.matchAll(/<sup\b[^>]*>([\s\S]*?)<\/sup>/gi)].map((item) => stripHTML(item[1] ?? '')).join(' ')
    const name = cleanName(stripHTML(raw.replace(/<sup\b[\s\S]*?<\/sup>/gi, '')))
    if (!isPerson(name) || seenNames.has(name)) continue
    seenNames.add(name)
    const ids = [...sup.matchAll(/\b(\d+)\b/g)].map((item) => item[1]!).filter((id) => affiliationMap.has(id))
    const affs = ids.map((id) => affiliationMap.get(id)!).filter(Boolean)
    const detail: AcademicAuthor = { name, ...(/[*†‡§¶#∗]/u.test(sup) ? { corresponding: true } : {}) }
    if (affs.length > 0) detail.affiliations = [...new Set(affs)]
    else if (affiliationMap.size === 1) detail.affiliations = [...affiliationMap.values()]
    authors.push(detail)
  }
  if (emails.length > 0) {
    const index = authors.findIndex((author) => author.corresponding === true)
    if (index >= 0) authors[index] = { ...authors[index]!, email: emails[0] }
    else if (authors.length === 1) authors[0] = { ...authors[0]!, email: emails[0] }
  }
  return { authors, institutions: [...institutions], emails: [...new Set(emails)] }
}

function authorNamesMatch(left: string, right: string): boolean {
  return autoRelatedWorkMatchAuthor(left, [right]) !== undefined
}

function mergeAuthorDetails(paper: AutoPaper, details: AcademicAuthor[]): void {
  if (details.length === 0) return
  const existing: AcademicAuthor[] = paper.authorsDetailed.length > 0 ? paper.authorsDetailed : paper.authors.map((name): AcademicAuthor => ({ name }))
  for (const detail of details) {
    const index = existing.findIndex((item) => authorNamesMatch(item.name, detail.name))
    if (index < 0) {
      existing.push(detail)
      continue
    }
    const current = existing[index]!
    existing[index] = {
      ...current,
      ...detail,
      ...((current.affiliations?.length ?? 0) > 0 || (detail.affiliations?.length ?? 0) > 0
        ? { affiliations: [...new Set([...(current.affiliations ?? []), ...(detail.affiliations ?? [])])] }
        : {}),
      ...(current.email ?? detail.email ? { email: current.email ?? detail.email } : {}),
      ...(current.scholarId ?? detail.scholarId ? { scholarId: current.scholarId ?? detail.scholarId } : {}),
      ...(current.scholarURL ?? detail.scholarURL ? { scholarURL: current.scholarURL ?? detail.scholarURL } : {}),
      ...(current.corresponding === true || detail.corresponding === true ? { corresponding: true } : {}),
    }
  }
  paper.authorsDetailed = existing
  paper.institutions = [...new Set([...paper.institutions, ...details.flatMap((item) => item.affiliations ?? [])])]
  paper.emails = [...new Set([...paper.emails, ...details.map((item) => item.email).filter((item): item is string => item !== undefined)])]
}

function deepseekCompletionURL(config: AutoRelatedWorkConfig, credentials?: AutoRelatedWorkCredentials): string {
  const raw = cleanURL(credentials?.deepseekURL ?? config.deepseekURL, 'https://api.deepseek.com')
  if (/\/chat\/completions$/i.test(raw)) return raw
  return `${raw.replace(/\/v1$/i, '')}/v1/chat/completions`
}

/** 原版 _ai_parse_authors / _ai_same_paper 共用的 OpenAI-compatible JSON 调用。 */
async function deepseekJSON(
  prompt: string,
  options: AutoRelatedWorkOptions,
  fetchImpl: FetchLike,
  maxTokens: number,
): Promise<Record<string, unknown> | undefined> {
  const key = options.credentials?.deepseekApiKey?.trim()
  if (key === undefined || key === '') return undefined
  try {
    const body = await requestJSON(fetchImpl, deepseekCompletionURL(options.config ?? {}, options.credentials), options.signal, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: options.config?.deepseekModel?.trim() || 'deepseek-chat',
        temperature: 0,
        max_tokens: maxTokens,
        messages: [{ role: 'system', content: 'Return only valid JSON. Do not include Markdown or explanation.' }, { role: 'user', content: prompt }],
      }),
    })
    const choices = Array.isArray(body.choices) ? body.choices : []
    const message = isObject(choices[0]) && isObject(choices[0].message) ? choices[0].message : {}
    const content = typeof message.content === 'string' ? message.content : ''
    const json = content.match(/\{[\s\S]*\}/)?.[0]
    if (json === undefined) return undefined
    const parsed = JSON.parse(json) as unknown
    return isObject(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

async function aiSamePaper(titleA: string, titleB: string, options: AutoRelatedWorkOptions, fetchImpl: FetchLike): Promise<boolean | undefined> {
  const result = await deepseekJSON([
    'Are these two strings referring to the SAME academic paper?',
    'Consider abbreviations, subtitles, and minor wording differences.',
    'Return exactly {"same":true} or {"same":false}.',
    `Title A: ${titleA}`,
    `Title B: ${titleB}`,
  ].join('\n'), options, fetchImpl, 200)
  return typeof result?.same === 'boolean' ? result.same : undefined
}

async function aiParseArxivAuthors(html: string, title: string, options: AutoRelatedWorkOptions, fetchImpl: FetchLike): Promise<AcademicAuthor[]> {
  const chunk = html.slice(0, 8_000).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 3_000)
  const result = await deepseekJSON([
    'Extract structured author information from this academic paper metadata.',
    'Return exactly {"authors":[{"name":"Full Name","affiliations":["Institution"],"is_corresponding":false,"email":"if found"}]} .',
    'Each author must be a human name. Affiliations must be organizations, never people.',
    'Remove *, dagger, section symbols, numbers and other markers from names.',
    'Set is_corresponding=true only for an explicit correspondence marker or email.',
    `Paper title: ${title}`,
    `Metadata text: ${chunk}`,
  ].join('\n'), options, fetchImpl, 2_000)
  if (!Array.isArray(result?.authors)) return []
  return result.authors.map((value): AcademicAuthor | undefined => {
    if (!isObject(value) || text(value.name) === undefined) return undefined
    const affiliations = Array.isArray(value.affiliations) ? value.affiliations.filter((item): item is string => typeof item === 'string' && item.trim() !== '').map((item) => item.trim()).slice(0, 8) : []
    const email = text(value.email)
    return {
      name: text(value.name)!,
      ...(affiliations.length > 0 ? { affiliations } : {}),
      ...(value.is_corresponding === true ? { corresponding: true } : {}),
      ...(email !== undefined && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? { email } : {}),
    }
  }).filter((value): value is AcademicAuthor => value !== undefined)
}

function parseScholarProfilePaperRows(html: string): Array<{ title: string; year?: number; citedByCount?: number; venue?: string; paperId?: string; authorsStr?: string }> {
  const rows: Array<{ title: string; year?: number; citedByCount?: number; venue?: string; paperId?: string; authorsStr?: string }> = []
  for (const match of html.matchAll(/<tr\b[^>]*class=["'][^"']*gsc_a_tr[^"']*["'][^>]*>([\s\S]*?)<\/tr>/gi)) {
    const row = match[1] ?? ''
    const title = stripHTML(row.match(/<a\b[^>]*class=["'][^"']*gsc_a_at[^"']*["'][^>]*>([\s\S]*?)<\/a>/i)?.[1] ?? '')
    if (title === '') continue
    const gray = [...row.matchAll(/class=["'][^"']*gs_gray[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi)].map((item) => stripHTML(item[1] ?? '')).filter(Boolean)
    const citedRaw = stripHTML(row.match(/class=["'][^"']*gsc_a_c[^"']*["'][^>]*>([\s\S]*?)<\//i)?.[1] ?? '')
    const citedByCount = citedRaw === '*' ? 0 : parseNumberFromText(citedRaw) ?? 0
    const year = parseNumberFromText(stripHTML(row.match(/class=["'][^"']*gsc_a_y[^"']*["'][^>]*>([\s\S]*?)<\//i)?.[1] ?? ''))
    const paperId = row.match(/[?&]cites=(\d+)/i)?.[1]
    rows.push({ title, ...(year !== undefined ? { year } : {}), citedByCount, ...(gray[0] !== undefined ? { authorsStr: gray[0] } : {}), ...(gray[1] !== undefined ? { venue: gray[1] } : {}), ...(paperId !== undefined ? { paperId } : {}) })
  }
  return rows
}

function parseScholarProfile(html: string, scholarId: string): AcademicAuthorProfile | undefined {
  const rawName = text(stripHTML(html.match(/id=["']gsc_prf_in["'][^>]*>([\s\S]*?)<\//i)?.[1] ?? ''))
  const name = rawName?.split(',')[0]?.trim() || rawName
  if (name === undefined) return undefined
  const affiliation = [...html.matchAll(/class=["'][^"']*gsc_prf_il[^"']*["'][^>]*>([\s\S]*?)<\//gi)]
    .map((item) => stripHTML(item[1] ?? '')).find((item) => item !== '' && !item.includes('@') && !/verified email/i.test(item))
  const verifiedDomain = html.match(/Verified email at\s*<[^>]*>([^<]+)<\/[^>]*>/i)?.[1] ?? html.match(/Verified email at\s+([^<\s]+)/i)?.[1]
  const email = [...html.matchAll(/(?:mailto:|>)([\w.+-]+@[\w.-]+\.[A-Za-z]{2,})(?:<|["'])/gi)].map((item) => item[1]).find((item) => item !== undefined && !/google|gstatic|noreply|example/i.test(item))
    ?? text(stripHTML(html.match(/class=["'][^"']*gsc_prf_em[^"']*["'][^>]*>([\s\S]*?)<\//i)?.[1] ?? ''))
    ?? [...html.matchAll(/([\w.+-]+@[\w-]+\.[\w.-]+)/gi)].map((item) => item[1]).find((item) => item !== undefined && !/google|gstatic|noreply|example/i.test(item))
  const homepage = [...html.matchAll(/<a\b[^>]*class=["'][^"']*gsc_prf_ila[^"']*["'][^>]*href=["']([^"']+)["']/gi)]
    .map((item) => decodeHTML(item[1] ?? '')).find((item) => /^https?:\/\//i.test(item) && !/scholar\.google/i.test(item))
  const interests = [...html.matchAll(/id=["']gsc_prf_int["'][\s\S]*?<\/div>/i)][0]?.[0]
    ? [...(html.match(/id=["']gsc_prf_int["'][\s\S]*?<\/div>/i)?.[0] ?? '').matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)].map((item) => stripHTML(item[1] ?? '')).filter(Boolean)
    : []
  const citationStats: Record<string, number> = {}
  const statsBlock = html.match(/id=["']gsc_rsb_st["'][\s\S]*?<\/table>/i)?.[0]
    ?? [...html.matchAll(/<table\b[\s\S]*?<\/table>/gi)].map((item) => item[0]).find((item) => /h-index/i.test(stripHTML(item)))
    ?? ''
  for (const row of statsBlock.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...(row[1] ?? '').matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((item) => stripHTML(item[1] ?? ''))
    const label = cells[0]?.toLocaleLowerCase() ?? ''
    const all = Number(cells[1]); const recent = Number(cells[2])
    if (!Number.isFinite(all)) continue
    if (label.includes('citation') || label.includes('引用')) citationStats.citationsAll = all
    else if (label.includes('h-index')) citationStats.hIndexAll = all
    else if (label.includes('i10-index')) citationStats.i10IndexAll = all
    if (Number.isFinite(recent)) {
      if (label.includes('citation') || label.includes('引用')) citationStats.citationsRecent = recent
      else if (label.includes('h-index')) citationStats.hIndexRecent = recent
      else if (label.includes('i10-index')) citationStats.i10IndexRecent = recent
    }
  }
  const papers = parseScholarProfilePaperRows(html)
  // author.py excludes uncited rows from top_cited_papers and undated rows
  // from top_recent_papers.  Its de-duplication only removes repeated rows
  // that have a paper_id, while preserving rows without one.
  const dedupeProfilePapers = (values: typeof papers): typeof papers => {
    const seen = new Set<string>()
    return values.filter((paper) => {
      if (paper.paperId === undefined) return true
      if (seen.has(paper.paperId)) return false
      seen.add(paper.paperId)
      return true
    }).map((paper) => Object.fromEntries(Object.entries(paper).filter(([key, value]) => key === 'title' || (value !== undefined && value !== ''))) as typeof paper)
  }
  const topCitedPapers = dedupeProfilePapers(papers.filter((paper) => (paper.citedByCount ?? 0) > 0).sort((a, b) => (b.citedByCount ?? 0) - (a.citedByCount ?? 0))).slice(0, 5)
  const topRecentPapers = dedupeProfilePapers(papers.filter((paper) => paper.year !== undefined).sort((a, b) => (b.year ?? 0) - (a.year ?? 0))).slice(0, 5)
  const allPapers = dedupeProfilePapers(papers).slice(0, 200)
  return {
    scholarId,
    name,
    url: `https://scholar.google.com/citations?user=${encodeURIComponent(scholarId)}&hl=en`,
    ...(affiliation !== undefined ? { affiliation } : {}),
    ...(email ?? verifiedDomain ? { email: email ?? verifiedDomain } : {}),
    ...(homepage !== undefined ? { homepage } : {}),
    ...(interests.length > 0 ? { interests: [...new Set(interests)] } : {}),
    ...(Object.keys(citationStats).length > 0 ? { citationStats } : {}),
    ...(papers.length > 0 ? { totalPapers: papers.length, topCitedPapers, topRecentPapers, allPapers } : {}),
  }
}

export function parseAutoRelatedWorkScholarAuthorProfile(html: string, scholarId: string): AcademicAuthorProfile | undefined {
  return parseScholarProfile(html, scholarId)
}

const autoRelatedWorkAuthorCache = new Map<string, AcademicAuthorProfile | null>()

/** 原始 author.py 的单作者缓存读取/抓取行为。 */
export async function scrapeAutoRelatedWorkAuthorProfile(userId: string, options: AutoRelatedWorkOptions): Promise<AcademicAuthorProfile | undefined> {
  const id = userId.trim()
  if (id === '') return undefined
  const cached = autoRelatedWorkAuthorCache.get(id)
  if (cached !== undefined) return cached ?? undefined
  const persistentCache = options.dataRoot === undefined ? undefined : new AutoRelatedWorkCacheStore(join(options.dataRoot, 'plugins', 'cache', 'scholar_cache.db'))
  try {
    const persistent = persistentCache?.getAuthorByScholarId(id)
    if (persistent !== undefined) {
      const profile = persistent as unknown as AcademicAuthorProfile
      autoRelatedWorkAuthorCache.set(id, profile)
      return profile
    }
  } finally {
    // The profile lookup may be followed immediately by settings-panel data
    // migration/clear.  Do not retain a WAL handle across that boundary.
    persistentCache?.close()
  }
  const fetchImpl = options.fetchImpl ?? fetch
  const config = options.config ?? {}
  let html: string | undefined
  for (const sortby of ['pubdate', '']) {
    const url = `${cleanURL(config.scholarURL, AUTORELATEDWORK_DEFAULT_SCHOLAR_URL)}/citations?user=${encodeURIComponent(id)}&hl=en&sortby=${sortby}&pagesize=100&view_op=list_works`
    for (let attempt = 0; attempt < 5 && html === undefined; attempt += 1) {
      try {
        const value = await requestScholarHTML(url, options, fetchImpl, attempt)
        const valid = /id=["'](?:gsc_prf_in|gsc_rsb_st|gsc_a_b)["']|class=["'][^"']*gsc_prf/i.test(value)
        if (valid && !(/sorry/i.test(value) && value.length < 15_000)) html = value
      } catch { /* 与 Python 一样继续重试/切换排序 */ }
      if (html === undefined && attempt < 4) await new Promise<void>((resolve) => setTimeout(resolve, Math.round(Math.min(10, autoRelatedWorkBackoff(attempt, 1.6, 10)) * 1_000)))
    }
    if (html !== undefined) break
  }
  const profile = html === undefined ? undefined : parseScholarProfile(html, id)
  autoRelatedWorkAuthorCache.set(id, profile ?? null)
  if (profile !== undefined) {
    const writer = options.dataRoot === undefined ? undefined : new AutoRelatedWorkCacheStore(join(options.dataRoot, 'plugins', 'cache', 'scholar_cache.db'))
    try { writer?.putAuthor(profile as unknown as Record<string, unknown>) } finally { writer?.close() }
  }
  return profile
}

/** 原始 author.py 的逐篇作者关联：不会替换已有值，只填补空字段。 */
export async function enrichAutoRelatedWorkPaperAuthors(paper: AutoPaper, options: AutoRelatedWorkOptions): Promise<boolean> {
  const result = await enrichAutoRelatedWorkPaperAuthorsDetailed(paper, options)
  return result.changed
}

async function enrichAutoRelatedWorkPaperAuthorsDetailed(paper: AutoPaper, options: AutoRelatedWorkOptions): Promise<{ changed: boolean; authorsEnriched: number }> {
  const entries = Object.entries(paper.authorScholarIds)
  if (entries.length === 0 || paper.authorsDetailed.length === 0) return { changed: false, authorsEnriched: 0 }
  let changed = false
  let authorsEnriched = 0
  for (const [scholarId, searchName] of entries) {
    const profile = await scrapeAutoRelatedWorkAuthorProfile(scholarId, options)
    if (profile === undefined) continue
    const profileName = profile.name ?? searchName
    const index = paper.authorsDetailed.findIndex((author) => autoRelatedWorkMatchAuthor(author.name, [profileName, searchName]) !== undefined)
    if (index < 0) continue
    const current = paper.authorsDetailed[index]!
    const next: AcademicAuthor = {
      ...current,
      scholarId,
      scholarURL: profile.url,
      ...(profile.affiliation !== undefined ? { affiliations: [...new Set([...(current.affiliations ?? []), profile.affiliation])] } : {}),
      ...(current.email === undefined && profile.email !== undefined ? { email: profile.email } : {}),
      // author.py always refreshes citation_stats when a profile is found;
      // affiliations/email/interests retain their original fill-only rules.
      ...(profile.citationStats !== undefined ? { citationStats: profile.citationStats } : {}),
      ...(current.interests === undefined && profile.interests !== undefined ? { interests: profile.interests } : {}),
    }
    if (JSON.stringify(next) !== JSON.stringify(current)) { paper.authorsDetailed[index] = next; changed = true; authorsEnriched += 1 }
    paper.authorProfiles[scholarId] = profile
  }
  paper.institutions = [...new Set([...paper.institutions, ...paper.authorsDetailed.flatMap((author) => author.affiliations ?? [])])]
  paper.emails = [...new Set([...paper.emails, ...paper.authorsDetailed.map((author) => author.email).filter((item): item is string => item !== undefined)])]
  return { changed, authorsEnriched }
}

/** 原始 author.py 的批量阶段统计。 */
export async function enrichAutoRelatedWorkAuthors(papers: AutoPaper[], options: AutoRelatedWorkOptions): Promise<{ papersEnriched: number; totalAuthorsEnriched: number; profilesLookedUp: number; totalUniqueAuthors: number }> {
  // author.py falls back to a title search when a paper did not carry
  // `_author_scholar_ids`.  Keep this inside the shared bulk function so the
  // pipeline, `/api/author-enrich`, and direct library calls agree.
  const fetchImpl = options.fetchImpl ?? fetch
  const titleLookupCache = new Map<string, Record<string, string>>()
  await Promise.all(papers.map(async (paper) => {
    if (Object.keys(paper.authorScholarIds).length > 0 || paper.title === '') return
    const key = paper.title.toLocaleLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 60)
    if (titleLookupCache.has(key)) { paper.authorScholarIds = { ...titleLookupCache.get(key)! }; return }
    try {
      const result = await searchAutoRelatedWorkScholar({ query: paper.title, searchType: 'general', maxResults: 1, config: options.config, credentials: options.credentials, dataRoot: options.dataRoot, fetchImpl, signal: options.signal })
      const ids = result.papers[0]?.authorScholarIds ?? {}
      titleLookupCache.set(key, ids)
      paper.authorScholarIds = { ...ids }
    } catch { titleLookupCache.set(key, {}) }
  }))
  const ids = [...new Set(papers.flatMap((paper) => Object.keys(paper.authorScholarIds)))].sort()
  // The Python implementation caps the prefetch pool at four workers.  A
  // Promise.all here changes Scholar rate-limit behavior and observable order.
  const profiles = new Map<string, AcademicAuthorProfile | undefined>()
  let cursor = 0
  const workers = Math.min(4, Math.max(1, ids.length))
  await Promise.all(Array.from({ length: workers }, async () => {
    while (true) {
      const index = cursor++
      if (index >= ids.length) return
      const id = ids[index]!
      try { profiles.set(id, await scrapeAutoRelatedWorkAuthorProfile(id, options)) } catch { profiles.set(id, undefined) }
    }
  }))
  let papersEnriched = 0
  let totalAuthorsEnriched = 0
  let lookedUp = 0
  for (const profile of profiles.values()) if (profile !== undefined) lookedUp += 1
  for (const paper of papers) {
    const result = await enrichAutoRelatedWorkPaperAuthorsDetailed(paper, options)
    if (result.changed) papersEnriched += 1
    totalAuthorsEnriched += result.authorsEnriched
  }
  return { papersEnriched, totalAuthorsEnriched, profilesLookedUp: lookedUp, totalUniqueAuthors: ids.length }
}

async function enrichAuthorProfiles(paper: AutoPaper, options: AutoRelatedWorkOptions, fetchImpl: FetchLike): Promise<void> {
  await enrichAutoRelatedWorkPaperAuthors(paper, { ...options, fetchImpl })
}

function referenceKey(reference: AcademicReference): string {
  return (reference.doi ?? reference.title).toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

// 对齐 references.py 的进程级记忆缓存：只缓存成功拿到的非空引用，
// 限速/网络故障的空结果不能把后续重试永久短路。
const autoRelatedWorkReferencesCache = new Map<string, AcademicReference[]>()
const autoRelatedWorkSemanticIdCache = new Map<string, string | null>()

function paperReferenceCacheKey(paper: AutoPaper): string {
  const doi = paper.doi?.replace(/^https?:\/\/doi\.org\//i, '').trim().toLocaleLowerCase()
  return doi !== undefined && doi !== '' ? `doi:${doi}` : `t:${paper.title.toLocaleLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 60)}`
}

async function requestSemanticScholarJSON(fetchImpl: FetchLike, input: string, options: AutoRelatedWorkOptions, init: RequestInit): Promise<Record<string, unknown>> {
  let last: unknown
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await requestJSON(fetchImpl, input, options.signal, init)
    } catch (error) {
      last = error
      const message = error instanceof Error ? error.message : String(error)
      if (attempt >= 2) break
      const waitMs = /\b429\b/.test(message) ? 2_000 * (attempt + 1) : 1_000
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, waitMs)
        const abort = () => { clearTimeout(timer); reject(options.signal?.reason ?? new Error('请求已取消')) }
        if (options.signal?.aborted) abort()
        else options.signal?.addEventListener('abort', abort, { once: true })
      })
    }
  }
  throw last instanceof Error ? last : new Error(String(last))
}

function doiURLForReference(doi: string | undefined): string | undefined {
  return doi === undefined ? undefined : `https://doi.org/${doi}`
}

function referenceFromSemantic(value: unknown, citationSignals?: unknown): AcademicReference | undefined {
  if (!isObject(value)) return undefined
  const title = text(value.title)
  if (title === undefined) return undefined
  const ids = isObject(value.externalIds) ? value.externalIds : {}
  const doi = normalizeDOI(text(ids.DOI))
  const authors = Array.isArray(value.authors) ? value.authors.map((item) => isObject(item) ? text(item.name) ?? '' : '').filter(Boolean) : []
  const signals = isObject(citationSignals) ? citationSignals : isObject(value._ref_signals) ? value._ref_signals : {}
  const influential = signals.isInfluential === true || signals.is_influential === true
  const intents = Array.isArray(signals.intents) ? signals.intents.filter((item): item is string => typeof item === 'string') : []
  const contexts = Array.isArray(signals.contexts) ? signals.contexts.length : number(signals.n_contexts)
  return {
    title,
    ...(doiURLForReference(doi) !== undefined ? { url: doiURLForReference(doi) } : {}),
    ...(doi !== undefined ? { doi } : {}),
    ...(authors.length > 0 ? { authors } : {}),
    ...(text(value.venue) !== undefined ? { venue: text(value.venue) } : {}),
    ...(number(value.year) !== undefined ? { year: number(value.year) } : {}),
    ...(number(value.citationCount) !== undefined ? { citedByCount: number(value.citationCount) } : {}),
    ...(influential ? { influential: true } : {}),
    ...(intents.length > 0 ? { citationIntents: intents } : {}),
    ...(contexts !== undefined ? { citationContexts: contexts } : {}),
    source: 'SemanticScholar',
  }
}

async function referencesFromSemanticScholar(paper: AutoPaper, options: AutoRelatedWorkOptions, fetchImpl: FetchLike, limit: number): Promise<AcademicReference[]> {
  let paperId: string | undefined
  if (paper.doi !== undefined) paperId = `DOI:${paper.doi}`
  else {
    const arxivId = arxivIdForPaper(paper)
    if (arxivId !== undefined) paperId = `ARXIV:${arxivId}`
  }
  if (paperId === undefined) {
    const base = cleanURL(options.config?.semanticScholarURL, 'https://api.semanticscholar.org/graph/v1')
    const key = paper.title.toLocaleLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 60)
    const cached = autoRelatedWorkSemanticIdCache.get(key)
    if (cached !== undefined) paperId = cached ?? undefined
    else {
      const search = await requestSemanticScholarJSON(fetchImpl, `${base}/paper/search?query=${encodeURIComponent(paper.title)}&limit=3&fields=title,paperId`, options, options.credentials?.semanticScholarApiKey === undefined ? {} : { headers: { 'x-api-key': options.credentials.semanticScholarApiKey } })
      const candidates = Array.isArray(search.data) ? search.data : []
      const match = candidates.find((item) => isObject(item) && autoRelatedWorkTitlesMatchExact(paper.title, text(item.title), 0.6))
      if (isObject(match)) paperId = text(match.paperId)
      autoRelatedWorkSemanticIdCache.set(key, paperId ?? null)
    }
  }
  if (paperId === undefined) return []
  const fields = 'title,year,venue,externalIds,authors,citationCount,contexts,intents,isInfluential'
  const base = cleanURL(options.config?.semanticScholarURL, 'https://api.semanticscholar.org/graph/v1')
  const body = await requestSemanticScholarJSON(fetchImpl, `${base}/paper/${encodeURIComponent(paperId)}/references?fields=${fields}&limit=${Math.min(limit, 100)}`, options, options.credentials?.semanticScholarApiKey === undefined ? {} : { headers: { 'x-api-key': options.credentials.semanticScholarApiKey } })
  return (Array.isArray(body.data) ? body.data : []).map((item) => isObject(item) ? referenceFromSemantic(item.citedPaper, item) : undefined).filter((item): item is AcademicReference => item !== undefined)
}

async function referencesFromOpenAlex(paper: AutoPaper, options: AutoRelatedWorkOptions, fetchImpl: FetchLike, limit: number): Promise<AcademicReference[]> {
  const base = cleanURL(options.config?.openAlexURL, 'https://api.openalex.org')
  const work = paper.paperId?.match(/^W\d+$/i)?.[0] ?? (paper.doi === undefined ? undefined : `https://doi.org/${paper.doi}`)
  if (work === undefined) return []
  const body = await requestJSON(fetchImpl, `${base}/works/${encodeURIComponent(work)}?select=referenced_works`, options.signal)
  const ids = Array.isArray(body.referenced_works) ? body.referenced_works.filter((item): item is string => typeof item === 'string').slice(0, limit) : []
  if (ids.length === 0) return []
  const filter = ids.map((id) => id.split('/').pop()).filter(Boolean).join('|')
  const details = await requestJSON(fetchImpl, `${base}/works?filter=openalex:${encodeURIComponent(filter)}&per-page=${Math.min(limit, 50)}&select=id,doi,title,publication_year,primary_location,authorships,cited_by_count`, options.signal)
  return (Array.isArray(details.results) ? details.results : []).map((item): AcademicReference | undefined => {
    if (!isObject(item) || text(item.title) === undefined) return undefined
    const doi = normalizeDOI(text(item.doi))
    const primary = isObject(item.primary_location) ? item.primary_location : {}
    const venue = isObject(primary.source) ? text(primary.source.display_name) : undefined
    const authors = Array.isArray(item.authorships) ? item.authorships.map((auth) => isObject(auth) && isObject(auth.author) ? text(auth.author.display_name) ?? '' : '').filter(Boolean) : []
    return { title: text(item.title)!, ...(doi !== undefined ? { doi, url: `https://doi.org/${doi}` } : { url: text(item.id) }), ...(authors.length > 0 ? { authors } : {}), ...(venue !== undefined ? { venue } : {}), ...(number(item.publication_year) !== undefined ? { year: number(item.publication_year) } : {}), ...(number(item.cited_by_count) !== undefined ? { citedByCount: number(item.cited_by_count) } : {}), source: 'OpenAlex' }
  }).filter((item): item is AcademicReference => item !== undefined)
}

async function referencesFromCrossref(paper: AutoPaper, options: AutoRelatedWorkOptions, fetchImpl: FetchLike, limit: number): Promise<AcademicReference[]> {
  if (paper.doi === undefined) return []
  const base = cleanURL(options.config?.crossrefURL, 'https://api.crossref.org')
  const body = await requestJSON(fetchImpl, `${base}/works/${paper.doi.replace(/\s/g, '%20')}`, options.signal, { headers: { 'user-agent': 'EvoResearch/0.1 (academic references)' } })
  const message = isObject(body.message) ? body.message : {}
  const references = Array.isArray(message.reference) ? message.reference : []
  return references.slice(0, limit).map((item): AcademicReference | undefined => {
    if (!isObject(item)) return undefined
    const title = text(item['article-title']) ?? text(item['volume-title']) ?? text(item.unstructured)
    if (title === undefined) return undefined
    const doi = normalizeDOI(text(item.DOI))
    const year = text(item.year)?.match(/\d{4}/)?.[0]
    return { title, ...(doi !== undefined ? { doi, url: `https://doi.org/${doi}` } : {}), ...(text(item['journal-title']) !== undefined ? { venue: text(item['journal-title']) } : {}), ...(year !== undefined ? { year: Number(year) } : {}), ...(text(item.author) !== undefined ? { authors: [text(item.author)!] } : {}), source: 'Crossref' }
  }).filter((item): item is AcademicReference => item !== undefined)
}

function rankAcademicReferences(references: AcademicReference[], limit: number): AcademicReference[] {
  return references.slice().sort((a, b) => {
    const score = (item: AcademicReference) => (item.influential === true ? 100 : 0) + (item.citationContexts ?? 0) * 8 + (item.citationIntents?.includes('methodology') ? 30 : 0) + (item.citationIntents?.includes('result') ? 20 : 0) + (item.citationIntents?.includes('background') ? 5 : 0) + Math.min(15, Math.log10((item.citedByCount ?? 0) + 1) * 4)
    return score(b) - score(a)
  }).slice(0, limit)
}

async function fetchPaperReferences(paper: AutoPaper, options: AutoRelatedWorkOptions, fetchImpl: FetchLike, limit: number): Promise<AcademicReference[]> {
  const key = paperReferenceCacheKey(paper)
  const cached = autoRelatedWorkReferencesCache.get(key)
  if (cached !== undefined) return cached
  for (const provider of [referencesFromSemanticScholar, referencesFromOpenAlex, referencesFromCrossref]) {
    try {
      const references = await provider(paper, options, fetchImpl, limit)
      if (references.length > 0) {
        const ranked = rankAcademicReferences(references, limit)
        autoRelatedWorkReferencesCache.set(key, ranked)
        return ranked
      }
    } catch { /* 逐级回退，限速或缺少 DOI 不应让递归整体失败 */ }
  }
  return []
}

/** 原 pipeline 的独立 References 阶段：只挂载参考文献，不展开子论文。 */
export async function enrichAutoRelatedWorkReferences(papers: AutoPaper[], options: AutoRelatedWorkOptions, limit = 30): Promise<void> {
  const fetchImpl = createAutoRelatedWorkFetch(options.fetchImpl ?? fetch, options)
  // references.py.attach_references is called through app.py's six-worker
  // _par_enrich pool.  Keep the fill-only semantics and the same bound.
  await parallelPaperStage(papers, async (paper) => {
    if (paper.references.length > 0) return
    try {
      const references = await fetchPaperReferences(paper, options, fetchImpl, limit)
      if (references.length > 0) {
        paper.references = references.map((reference) => ({
          title: reference.title,
          authors: reference.authors ?? [],
          ...(reference.venue !== undefined ? { venue: reference.venue } : {}),
          ...(reference.year !== undefined ? { year: reference.year } : {}),
          ...(reference.doi !== undefined ? { doi: reference.doi } : {}),
        }))
        paper.fieldSources.references = 'References'
      }
    } catch { /* 单篇引用抓取失败不阻塞其余论文。 */ }
  }, 6)
}

/**
 * enrich_fields.py 的最后一轮 Scholar web fallback。
 *
 * 这不是通用 SERP：它只对完整性严重不足的论文请求 Scholar 标题结果，
 * 并且只接受 `gs_a` 元数据行里的机构关键词，避免把普通网页标题/词典
 * 结果误当成作者机构。
 */
async function enrichFromScholarWebFallback(paper: AutoPaper, options: AutoRelatedWorkOptions, fetchImpl: FetchLike): Promise<void> {
  if (paper.institutions.length > 0 || paper.title === '') return
  const base = cleanURL(options.config?.scholarURL, AUTORELATEDWORK_DEFAULT_SCHOLAR_URL)
  const url = `${base}/scholar?q=${encodeURIComponent(paper.title)}&hl=en&num=3`
  try {
    const html = await requestScholarHTML(url, options, fetchImpl, 0)
    const institutionPattern = /(?:University|College|Institute|Research|Lab|School|Department|Center|Centre|Faculty|大学|学院|研究所|实验室|中心|研究院)(?:\s+(?:of|for|at)\s+)?[\p{L}\w\s,.'’&-]+/giu
    const institutions = new Set<string>()
    for (const row of html.matchAll(/class=["'][^"']*\bgs_a\b[^"']*["'][^>]*>([\s\S]*?)<\//gi)) {
      const rowText = stripHTML(row[1] ?? '')
      for (const candidate of rowText.match(institutionPattern) ?? []) {
        const value = candidate.replace(/[\s,.-]+$/g, '').trim()
        if (value.length > 5 && value.length < 180) institutions.add(value)
      }
    }
    if (institutions.size > 0) {
      paper.institutions = [...institutions]
      paper.fieldSources.institutions = 'Google Scholar web fallback'
    }
  } catch {
    // fallback 是最后的 best-effort 步骤，不能覆盖已有补全结果。
  }
}

/**
 * 对已经拿到的论文运行与 enrich_fields.enrich_papers 对齐的多轮补全。
 * 公开导出它，供 EvoResearch Remote/API 和缓存 refine 使用，而不是只在
 * Google Scholar 搜索入口里隐藏一份无法复用的逻辑。
 */
export async function enrichAutoRelatedWorkPapers(
  papers: AutoPaper[],
  options: AutoRelatedWorkOptions = { query: '' },
): Promise<{ papers: AutoPaper[]; report: { initialScores: number[]; finalScores: number[]; rounds: Array<{ round: number; fixes: number; averageScore: number }>; averageScore: number } }> {
  const fetchImpl = createAutoRelatedWorkFetch(options.fetchImpl ?? fetch, options)
  const rounds = Math.min(Math.max(Math.floor(options.config?.maxEnrichmentRounds ?? 3), 1), 10)
  const initialScores = papers.map((paper) => autoRelatedWorkCompleteness({ ...paper, authors: paper.authorsDetailed }))
  const roundReports: Array<{ round: number; fixes: number; averageScore: number }> = []
  for (let round = 1; round <= rounds; round += 1) {
    const before = papers.map((paper) => autoRelatedWorkCompleteness({ ...paper, authors: paper.authorsDetailed }))
    // enrich_fields.py 先筛掉已达到 85% 的论文；当整批已完整时直接结束，
    // 不能因为 TS 补全器的“幂等请求”而额外访问外部服务。
    const todo = new Set(papers.map((paper, index) => paper.cacheComplete !== true && before[index]! < 0.85 ? paper : undefined).filter((paper): paper is AutoPaper => paper !== undefined))
    if (todo.size === 0) break
    // 与 enrich_fields.py 的 `/api/enrich` 一样按策略阶段运行，而不是
    // 对每篇论文把所有来源揉成一次并发请求。这个顺序决定“已有字段是否
    // 允许被覆盖”、作者列表是否追加，以及同一轮的完整度统计。
    const runStrategy = async (strategy: (paper: AutoPaper) => Promise<void>): Promise<number> => {
      const strategyBefore = new Map(papers.map((paper) => [paper, autoRelatedWorkCompleteness({ ...paper, authors: paper.authorsDetailed })]))
      for (const paper of papers) if (todo.has(paper)) await strategy(paper)
      const improved = papers.filter((paper) => (autoRelatedWorkCompleteness({ ...paper, authors: paper.authorsDetailed }) > (strategyBefore.get(paper) ?? 0) + 0.02)).length
      // enrich_fields.py 每个策略只把“完整度提升超过 0.02”的论文
      // 计数一次；报告中的 fixes 不是字段数，也不是请求数。
      return improved
    }
    let roundFixes = 0
    roundFixes += await runStrategy((paper) => enrichCrossrefPaper(paper, options, fetchImpl))
    roundFixes += await runStrategy((paper) => enrichOpenAlexPaper(paper, options, fetchImpl))
    roundFixes += await runStrategy((paper) => enrichDblpPaper(paper, options, fetchImpl))
    if (options.config?.fetchSemanticScholar !== false) roundFixes += await runStrategy((paper) => enrichSemanticScholarPaper(paper, options, fetchImpl))
    if (options.config?.fetchUnpaywall !== false) roundFixes += await runStrategy((paper) => enrichUnpaywallPaper(paper, options, fetchImpl))
    if (options.config?.deepseekEnrich !== false) roundFixes += await runStrategy((paper) => enrichWithDeepSeekMetadata(paper, options, fetchImpl))
    if (options.config?.deepseekAuthorFallback === true) roundFixes += await runStrategy((paper) => enrichWithDeepSeekAuthorFallback(paper, options, fetchImpl))
    const after = papers.map((paper) => autoRelatedWorkCompleteness({ ...paper, authors: paper.authorsDetailed }))
    roundReports.push({ round, fixes: roundFixes, averageScore: after.length === 0 ? 0 : after.reduce((sum, value) => sum + value, 0) / after.length })
    options.onProgress?.({ stage: round === 1 ? 'wave1' : 'wave2', index: round, total: papers.length, message: `字段补全第 ${round}/${rounds} 轮` })
    // Python 版只在下一轮开头发现 todo 为空时结束；不要提前改变
    // report.rounds 的长度。
  }
  if (options.config?.webFallback === true && roundReports.length === rounds) {
    for (const paper of papers) {
      const score = autoRelatedWorkCompleteness({ ...paper, authors: paper.authorsDetailed })
      if (score < 0.5) await enrichFromScholarWebFallback(paper, options, fetchImpl)
    }
  }
  if (options.config?.includeAuthorProfiles === true) await enrichAutoRelatedWorkAuthors(papers, options)
  if ((options.config?.recursiveDepth ?? 0) > 0) {
    const refs = await recursiveCollectAutoRelatedWork(papers, { ...options, depth: options.config?.recursiveDepth, width: options.config?.recursiveWidth, maxTotal: options.config?.recursiveMaxTotal })
    papers.splice(0, papers.length, ...refs.papers)
  }
  for (const paper of papers) finalizeAutoRelatedWorkPaper(paper, true)
  const finalScores = papers.map((paper) => paper.completeness ?? autoRelatedWorkCompleteness({ ...paper, authors: paper.authorsDetailed }))
  return {
    papers,
    report: {
      initialScores,
      finalScores,
      rounds: roundReports,
      averageScore: finalScores.length === 0 ? 0 : finalScores.reduce((sum, value) => sum + value, 0) / finalScores.length,
    },
  }
}

async function enrichWithDeepSeekMetadata(paper: AutoPaper, options: AutoRelatedWorkOptions, fetchImpl: FetchLike): Promise<void> {
  const key = options.credentials?.deepseekApiKey?.trim()
  if (key === undefined || key === '') return
  const authors: AcademicAuthor[] = paper.authorsDetailed.length > 0 ? paper.authorsDetailed : paper.authors.map((name): AcademicAuthor => ({ name }))
  if (authors.length === 0) return
  const withAffiliations = authors.filter((author) => (author.affiliations?.length ?? 0) > 0).length
  if (withAffiliations >= authors.length * 0.6 && paper.institutions.length > 0) return
  const abstract = paper.abstract ?? paper.snippet ?? ''
  const authorText = authors.map((author) => {
    const aff = author.affiliations ?? []
    return `- ${author.name}${aff.length > 0 ? ` (known: ${aff.join(', ')})` : ''}`
  }).join('\n')
  const prompt = [
    'You are an expert academic metadata extractor. Given incomplete paper data, fill in missing fields using your knowledge of academic institutions, research groups, and publication venues.',
    '',
    'Rules:',
    '1. Institutions: For each author, infer their likely institution based on their name, the paper topic, co-authors, and venue. Use full official names.',
    '2. Emails: Only include if you are highly confident (based on known patterns like firstname.lastname@institution.edu).',
    '3. DOI: If you can determine the DOI from the title and venue, include it.',
    '4. If no information can be reliably inferred, return empty values.',
    '',
    'Return ONLY valid JSON (no markdown, no explanation):',
    '{"affiliations": {"Author Name": ["Institution Name"]}, "emails": ["if confident"], "doi": "if known"}',
    '',
    `Title: ${paper.title}`,
    abstract === '' ? '' : `Abstract: ${abstract.slice(0, 500)}`,
    paper.venue === undefined ? '' : `Published in: ${paper.venue}`,
    paper.domain === undefined ? '' : `Domain: ${paper.domain}`,
    `Authors:\n${authorText}`,
  ].filter(Boolean).join('\n')
  try {
    const body = await requestJSON(fetchImpl, deepseekCompletionURL(options.config ?? {}, options.credentials), options.signal, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: options.config?.deepseekModel?.trim() || 'deepseek-chat', temperature: 0, max_tokens: 1500, messages: [{ role: 'system', content: 'You are a precise academic metadata extractor. Return only JSON.' }, { role: 'user', content: prompt }] }),
    })
    const choices = Array.isArray(body.choices) ? body.choices : []
    const message = isObject(choices[0]) && isObject(choices[0].message) ? choices[0].message : {}
    const content = typeof message.content === 'string' ? message.content : ''
    const json = content.match(/\{[\s\S]*\}/)?.[0]
    if (json === undefined) return
    const parsed = JSON.parse(json) as unknown
    if (!isObject(parsed)) return
    const affiliations = isObject(parsed.affiliations) ? parsed.affiliations : {}
    const details: AcademicAuthor[] = []
    for (const [name, values] of Object.entries(affiliations)) {
      if (!Array.isArray(values)) continue
      const clean = values.filter((item): item is string => typeof item === 'string' && item.trim() !== '').map((item) => item.trim()).slice(0, 5)
      if (clean.length > 0) details.push({ name, affiliations: clean })
    }
    mergeAuthorDetails(paper, details)
    if (Array.isArray(parsed.emails)) {
      const emails = parsed.emails.filter((item): item is string => typeof item === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item))
      if (emails.length > 0 && paper.emails.length === 0) { paper.emails = [...new Set(emails)]; paper.fieldSources.emails = 'DeepSeek AI' }
    }
    if (paper.doi === undefined && typeof parsed.doi === 'string') { paper.doi = normalizeDOI(parsed.doi); if (paper.doi !== undefined) paper.fieldSources.doi = 'DeepSeek AI' }
  } catch { /* AI 补全明确是可选增强 */ }
}

/** 与 scholar_search.py `_ai_fallback_enrichment` 一一对应的第二个 AI 阶段。 */
async function enrichWithDeepSeekAuthorFallback(paper: AutoPaper, options: AutoRelatedWorkOptions, fetchImpl: FetchLike): Promise<void> {
  const key = options.credentials?.deepseekApiKey?.trim()
  if (key === undefined || key === '') return
  const existing = paper.authorsDetailed.length > 0 ? paper.authorsDetailed : paper.authors.map((name): AcademicAuthor => ({ name }))
  if (existing.length === 0) return
  const withAffiliations = existing.filter((author) => (author.affiliations?.length ?? 0) > 0).length
  if (withAffiliations >= existing.length * 0.5 && paper.institutions.length > 0) return
  const authorsStr = paper.authorsStr ?? ''
  const bibtex = paper.bibtex ?? ''
  const abstract = paper.abstract ?? paper.snippet ?? ''
  const url = paper.externalUrls[0] ?? ''
  const prompt = [
    'Extract author affiliations from this academic paper data.',
    'Return ONLY valid JSON (no explanation):',
    '{"affiliations":{"Author Name":["Institution"]}}',
    '',
    'Critical rules:',
    '- Use EXACT author names as they appear in the BibTeX (Last, First format)',
    "- Look for institution names in the 'authors_str' field (after ' - ' separator)",
    "- The 'authors_str' format is: 'AuthorNames - Journal/Publisher, Year - domain'",
    "- Example: 'B Ghojogh, A Ghodsi - arXiv preprint, 2023 - arxiv.org' means both authors are from arxiv.org (if no other institution is mentioned, leave affiliations empty)",
    '- If the URL domain is a known publisher (springer.com, ieee.org, acm.org, nature.com, etc.), that is the publisher, not the authors’ institution',
    '- Only include a REAL institution name if it is explicitly mentioned (university, company, research lab)',
    '- If nothing can be determined, return empty affiliations for all authors',
    '',
    `Paper URL: ${url}`,
    `Authors string: ${authorsStr.slice(0, 400)}`,
    `BibTeX: ${bibtex.slice(0, 1000)}`,
    `Abstract (first 500 chars): ${abstract.slice(0, 500)}`,
  ].join('\n')
  try {
    const body = await requestJSON(fetchImpl, deepseekCompletionURL(options.config ?? {}, options.credentials), options.signal, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: options.config?.deepseekModel?.trim() || 'deepseek-chat', temperature: 0, max_tokens: 1500, messages: [{ role: 'system', content: 'You extract structured author data from academic papers. Return only JSON.' }, { role: 'user', content: prompt }] }),
    })
    const choices = Array.isArray(body.choices) ? body.choices : []
    const message = isObject(choices[0]) && isObject(choices[0].message) ? choices[0].message : {}
    const content = typeof message.content === 'string' ? message.content : ''
    const json = content.match(/\{[\s\S]*\}/)?.[0]
    if (json === undefined) return
    const parsed = JSON.parse(json) as unknown
    if (!isObject(parsed)) return
    const map = isObject(parsed.affiliations) ? parsed.affiliations : {}
    const corresponding = Array.isArray(parsed.corresponding_authors) ? parsed.corresponding_authors.filter((item): item is string => typeof item === 'string') : []
    const updated = existing.map((author) => {
      const match = autoRelatedWorkMatchAuthor(author.name, Object.keys(map))
      const values = match === undefined || !Array.isArray(map[match]) ? [] : map[match].filter((item): item is string => typeof item === 'string' && item.trim() !== '').map((item) => item.trim())
      const isCorresponding = corresponding.some((name) => autoRelatedWorkMatchAuthor(author.name, [name]) !== undefined)
      return { name: author.name, ...(values.length > 0 ? { affiliations: values } : {}), ...(isCorresponding ? { corresponding: true } : {}) }
    })
    paper.authorsDetailed = updated
    paper.institutions = [...new Set(updated.flatMap((author) => author.affiliations ?? []))]
    paper.fieldSources.authorsDetailed = 'DeepSeek AI'
    if (Array.isArray(parsed.emails) && paper.emails.length === 0) {
      const emails = parsed.emails.filter((item): item is string => typeof item === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item))
      if (emails.length > 0) { paper.emails = [...new Set(emails)]; paper.fieldSources.emails = 'DeepSeek AI' }
    }
  } catch { /* AI 回退是 best-effort，不能阻塞主流程 */ }
}

function paperFromReference(reference: AcademicReference): AutoPaper {
  const authors = reference.authors ?? []
  return {
    title: reference.title,
    authors,
    externalUrls: reference.url === undefined ? [] : [reference.url],
    ...(reference.url !== undefined ? { url: reference.url } : {}),
    ...(reference.doi !== undefined ? { doi: reference.doi } : {}),
    ...(reference.venue !== undefined ? { venue: reference.venue } : {}),
    ...(reference.year !== undefined ? { year: reference.year } : {}),
    ...(reference.citedByCount !== undefined ? { citedByCount: reference.citedByCount } : {}),
    additionalUrls: [],
    viewHTMLURLs: [],
    pdfUrls: [],
    institutions: [],
    authorScholarIds: {},
    authorsDetailed: authors.map((name) => ({ name })),
    authorProfiles: {},
    emails: [],
    references: [],
    fieldSources: {},
  }
}

function paperDedupeKey(paper: AutoPaper): string {
  return (paper.doi ?? paper.title).toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

/** 按参考项目的 depth/width/max_total 语义构建引用图；depth=0 时不发起额外请求。 */
async function expandAcademicReferences(seed: AutoPaper[], options: AutoRelatedWorkOptions, fetchImpl: FetchLike): Promise<AutoPaper[]> {
  // 与 recursive_search.py 一致：depth=1 只有种子，depth=3 展开两层。
  const depth = Math.min(Math.max(Math.floor(options.config?.recursiveDepth ?? 0), 0), 5)
  if (depth <= 0) return seed
  const width = Math.min(Math.max(Math.floor(options.config?.recursiveWidth ?? 5), 1), 20)
  const maxTotal = Math.min(Math.max(Math.floor(options.config?.recursiveMaxTotal ?? 50), seed.length), 400)
  const collected = await recursiveCollectAutoRelatedWork(seed, {
    ...options,
    fetchImpl,
    depth,
    width,
    maxTotal,
    onRecursiveProgress: (level, newCount, total) => options.onProgress?.({ stage: 'references', index: level, total, message: `递归第 ${level}/${depth} 层新增 ${newCount} 篇` }),
  })
  // recursive_search.py keeps the full provider payload in _raw_references
  // for ranking, while the public paper schema exposes the compact references
  // list.  Do this projection only after graph expansion: raw provider
  // signals must never leak into the API response or become child papers.
  for (const paper of collected.papers) {
    if (paper.references.length > 0 || paper.rawReferences === undefined) continue
    paper.references = paper.rawReferences.map((reference) => ({
      title: reference.title,
      authors: reference.authors ?? [],
      ...(reference.venue !== undefined ? { venue: reference.venue } : {}),
      ...(reference.year !== undefined ? { year: reference.year } : {}),
      ...(reference.doi !== undefined ? { doi: reference.doi } : {}),
    }))
    paper.fieldSources.references = 'References'
  }
  return collected.papers
}

export interface AutoRelatedWorkRecursiveOptions {
  depth?: number
  width?: number
  maxTotal?: number
  fetchRefs?: boolean
  /** 递归专用进度回调；避免与 AutoRelatedWorkOptions 的事件回调重名。 */
  onRecursiveProgress?: (level: number, newCount: number, total: number) => void
  cancel?: () => boolean
}

/** recursive_search.py 的等价 API，保留发现层级和非悬空引用边。 */
export async function recursiveCollectAutoRelatedWork(seedPapers: AutoPaper[], options: AutoRelatedWorkOptions & AutoRelatedWorkRecursiveOptions): Promise<{ papers: AutoPaper[]; edges: Array<[string, string]> }> {
  const fetchImpl = createAutoRelatedWorkFetch(options.fetchImpl ?? fetch, options)
  const depth = Math.max(0, Math.floor(options.depth ?? 3))
  const width = Math.max(1, Math.floor(options.width ?? 5))
  const maxTotal = Math.max(seedPapers.length, Math.floor(options.maxTotal ?? 200))
  const keyOf = (title: string | undefined) => (title ?? '').toLocaleLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 60)
  const seen = new Map<string, AutoPaper>(); const order: string[] = []; const edges = new Set<string>(); let current: AutoPaper[] = []
  for (const paper of seedPapers) {
    const key = keyOf(paper.title)
    if (key === '' || seen.has(key)) continue
    paper.depth = 0; seen.set(key, paper); order.push(key); current.push(paper)
  }
  options.onRecursiveProgress?.(0, current.length, seen.size)
  for (let level = 1; level < depth && current.length > 0 && seen.size < maxTotal; level += 1) {
    if (options.cancel?.() === true) break
    const fetched = await Promise.all(current.map(async (parent) => {
      if (options.fetchRefs === false) return { parent, references: parent.rawReferences ?? parent.references }
      try { return { parent, references: await fetchPaperReferences(parent, options, fetchImpl, 50) } } catch { return { parent, references: [] } }
    }))
    const next: AutoPaper[] = []
    for (const { parent, references } of fetched) {
      if (options.cancel?.() === true || seen.size >= maxTotal) break
      parent.rawReferences = references
      const parentKey = keyOf(parent.title)
      for (const reference of rankAcademicReferences(references, width)) {
        const child = paperFromReference(reference); const childKey = keyOf(child.title)
        if (childKey === '') continue
        if (seen.has(childKey)) { edges.add(`${parentKey}\u0000${childKey}`); continue }
        if (seen.size >= maxTotal) break
        child.depth = level; seen.set(childKey, child); order.push(childKey); next.push(child); edges.add(`${parentKey}\u0000${childKey}`)
      }
    }
    options.onRecursiveProgress?.(level, next.length, seen.size); current = next
  }
  return { papers: order.map((key) => seen.get(key)!), edges: [...edges].map((item) => item.split('\u0000') as [string, string]).sort((a, b) => a.join('\u0000').localeCompare(b.join('\u0000'))) }
}

async function retry<T>(fn: () => Promise<T>, attempts: number, delay: number, signal?: AbortSignal): Promise<T> {
  let error: unknown
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try { return await fn() } catch (reason) {
      error = reason
      if (attempt + 1 >= attempts) break
      const wait = Math.min(8_000, Math.max(200, delay) * (2 ** attempt)) + Math.round(Math.random() * 180)
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, wait)
        if (signal !== undefined) signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason) }, { once: true })
      })
    }
  }
  throw error instanceof Error ? error : new Error(String(error))
}

class AutoRelatedWorkJSONCache {
  private readonly file: string
  private doc: CacheDocument = { version: 1, entries: {} }
  private loaded = false

  constructor(file: string) { this.file = file }

  private load(): void {
    if (this.loaded) return
    this.loaded = true
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as unknown
      if (isObject(raw) && raw.version === 1 && isObject(raw.entries)) this.doc = raw as unknown as CacheDocument
    } catch { /* 缓存损坏/不存在不应阻塞检索 */ }
  }

  get(key: string, ttlHours: number): AcademicSearchResult | undefined {
    this.load()
    const item = this.doc.entries[key]
    if (item === undefined || Date.now() - item.storedAt > Math.max(1, ttlHours) * 3_600_000) return undefined
    return item.result
  }

  put(key: string, result: AcademicSearchResult): void {
    this.load()
    this.doc.entries[key] = { storedAt: Date.now(), result }
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      writeFileSync(this.file, JSON.stringify(this.doc), 'utf8')
    } catch { /* 只读/不可写数据根时退化为内存结果 */ }
  }
}

/**
 * AutoRelatedWork cache_db.py 的 Node 实现。
 *
 * 正式运行时优先使用 Node 22 的内置 `node:sqlite`，表结构和 complete/
 * partial 语义与 Python 版一致；测试或旧版 Node 没有该内置模块时才退化
 * 到同接口的原子 JSON 存储。这样不会把“JSON 替代 SQLite”误当成正式行为，
 * 同时保留开发环境在旧 Node 下运行单元测试的能力。
 */
export class AutoRelatedWorkCacheStore {
  private readonly file: string
  private readonly sqlite: any | undefined
  private doc: { version: 1; papers: Record<string, { title: string; data: Record<string, unknown>; updated: number; complete: boolean }>; authors: Record<string, { name: string; data: Record<string, unknown>; updated: number; scholarId?: string }> } = { version: 1, papers: {}, authors: {} }
  private loaded = false

  constructor(file: string) {
    this.file = file
    if (/\.db$/i.test(file)) {
      try {
        mkdirSync(dirname(file), { recursive: true })
        const DatabaseSync = createRequire(import.meta.url)('node:sqlite').DatabaseSync as new (path: string) => any
        const db = new DatabaseSync(file)
        db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;')
        db.exec(`CREATE TABLE IF NOT EXISTS papers (title_key TEXT PRIMARY KEY, title TEXT, data TEXT, updated REAL, complete INTEGER DEFAULT 0);`)
        db.exec(`CREATE TABLE IF NOT EXISTS authors (name_key TEXT PRIMARY KEY, name TEXT, data TEXT, updated REAL, scholar_id TEXT);`)
        try { db.exec('ALTER TABLE papers ADD COLUMN complete INTEGER DEFAULT 0') } catch { /* already exists */ }
        try { db.exec('CREATE INDEX IF NOT EXISTS idx_authors_scholar ON authors(scholar_id)') } catch { /* best effort */ }
        this.sqlite = db
      } catch {
        // Node <22 或受限桌面运行时：下面的 JSON fallback 仍保持 API 可用。
        this.sqlite = undefined
      }
    } else this.sqlite = undefined
  }

  /** Release the native SQLite handle when a short-lived cache facade is done. */
  close(): void {
    try { this.sqlite?.close?.() } catch { /* best effort; JSON fallback has no handle */ }
  }

  private titleKey(title: unknown): string { return typeof title === 'string' ? title.toLocaleLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 60) : '' }
  private nameKey(name: unknown): string { return typeof name === 'string' ? name.toLocaleLowerCase().replace(/[^\p{L}\p{N}_\s]/gu, '').replace(/\s+/g, ' ').trim() : '' }
  private fresh(updated: number, maxAgeDays?: number): boolean { return maxAgeDays === undefined || Date.now() - updated <= maxAgeDays * 86_400_000 }

  private load(): void {
    if (this.sqlite !== undefined || this.loaded) return
    this.loaded = true
    try {
      const value = JSON.parse(readFileSync(this.file, 'utf8')) as unknown
      if (isObject(value) && value.version === 1 && isObject(value.papers) && isObject(value.authors)) this.doc = value as typeof this.doc
    } catch { /* 不存在/损坏时从空缓存开始 */ }
  }
  private persist(): void {
    mkdirSync(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp-${process.pid}`
    writeFileSync(tmp, JSON.stringify(this.doc), 'utf8')
    try { renameSync(tmp, this.file) } catch { /* 只读数据根退化为内存缓存 */ }
  }
  getPaper(title: string, maxAgeDays?: number): Record<string, unknown> | undefined {
    const key = this.titleKey(title)
    if (key === '') return undefined
    if (this.sqlite !== undefined) {
      const row = this.sqlite.prepare('SELECT data, updated FROM papers WHERE title_key = ?').get(key) as { data?: string; updated?: number } | undefined
      if (row?.data === undefined || !this.fresh(Number(row.updated ?? 0), maxAgeDays)) return undefined
      try { return JSON.parse(row.data) as Record<string, unknown> } catch { return undefined }
    }
    this.load(); const item = this.doc.papers[key]
    return item !== undefined && this.fresh(item.updated, maxAgeDays) ? item.data : undefined
  }
  putPaper(paper: Record<string, unknown>): boolean {
    const title = typeof paper.title === 'string' ? paper.title : ''; const key = this.titleKey(title)
    if (key === '') return false
    const complete = paper.cacheComplete === true || paper._cache_complete === true || paper.enrichStage === 'done' || paper._enrich_stage === 'done'
    const now = Date.now(); const payload = JSON.stringify({ ...paper })
    if (this.sqlite !== undefined) {
      const existing = this.sqlite.prepare('SELECT complete FROM papers WHERE title_key = ?').get(key) as { complete?: number } | undefined
      if (existing?.complete === 1 && !complete) return false
      this.sqlite.prepare(`INSERT INTO papers(title_key,title,data,updated,complete) VALUES(?,?,?,?,?) ON CONFLICT(title_key) DO UPDATE SET title=excluded.title,data=excluded.data,updated=excluded.updated,complete=excluded.complete`).run(key, title, payload, now, complete ? 1 : 0)
      return true
    }
    this.load(); const existing = this.doc.papers[key]
    if (existing?.complete === true && !complete) return false
    this.doc.papers[key] = { title, data: { ...paper }, updated: now, complete }
    this.persist(); return true
  }
  putPapers(papers: Array<Record<string, unknown>>): number { return papers.reduce((count, paper) => count + (this.putPaper(paper) ? 1 : 0), 0) }
  getPartialPapers(limit = 50): Record<string, unknown>[] {
    const bounded = Math.max(0, Math.floor(limit))
    if (this.sqlite !== undefined) {
      return (this.sqlite.prepare('SELECT data FROM papers WHERE complete = 0 ORDER BY updated ASC LIMIT ?').all(bounded) as Array<{ data?: string }>).flatMap((row) => { try { return row.data === undefined ? [] : [JSON.parse(row.data) as Record<string, unknown>] } catch { return [] } })
    }
    this.load(); return Object.values(this.doc.papers).filter((item) => !item.complete).sort((a, b) => a.updated - b.updated).slice(0, bounded).map((item) => item.data)
  }
  countPartial(): number {
    if (this.sqlite !== undefined) return Number((this.sqlite.prepare('SELECT COUNT(*) AS count FROM papers WHERE complete = 0').get() as { count?: number }).count ?? 0)
    this.load(); return Object.values(this.doc.papers).filter((item) => !item.complete).length
  }
  getAuthor(name: string, maxAgeDays?: number): Record<string, unknown> | undefined {
    const key = this.nameKey(name)
    if (key === '') return undefined
    if (this.sqlite !== undefined) {
      const row = this.sqlite.prepare('SELECT data, updated FROM authors WHERE name_key = ?').get(key) as { data?: string; updated?: number } | undefined
      if (row?.data === undefined || !this.fresh(Number(row.updated ?? 0), maxAgeDays)) return undefined
      try { return JSON.parse(row.data) as Record<string, unknown> } catch { return undefined }
    }
    this.load(); const item = this.doc.authors[key]
    return item !== undefined && this.fresh(item.updated, maxAgeDays) ? item.data : undefined
  }
  getAuthorByScholarId(scholarId: string, maxAgeDays?: number): Record<string, unknown> | undefined {
    if (this.sqlite !== undefined) {
      const row = this.sqlite.prepare('SELECT data, updated FROM authors WHERE scholar_id = ?').get(scholarId) as { data?: string; updated?: number } | undefined
      if (row?.data === undefined || !this.fresh(Number(row.updated ?? 0), maxAgeDays)) return undefined
      try { return JSON.parse(row.data) as Record<string, unknown> } catch { return undefined }
    }
    this.load(); const item = Object.values(this.doc.authors).find((entry) => entry.scholarId === scholarId)
    return item !== undefined && this.fresh(item.updated, maxAgeDays) ? item.data : undefined
  }
  putAuthor(profile: Record<string, unknown>): boolean {
    const name = typeof profile.name === 'string' ? profile.name : ''; const key = this.nameKey(name)
    if (key === '') return false
    const scholarId = typeof profile.scholarId === 'string' ? profile.scholarId : typeof profile.scholar_id === 'string' ? profile.scholar_id : undefined
    const payload = JSON.stringify({ ...profile }); const now = Date.now()
    if (this.sqlite !== undefined) {
      this.sqlite.prepare(`INSERT INTO authors(name_key,name,data,updated,scholar_id) VALUES(?,?,?,?,?) ON CONFLICT(name_key) DO UPDATE SET name=excluded.name,data=excluded.data,updated=excluded.updated,scholar_id=excluded.scholar_id`).run(key, name, payload, now, scholarId ?? null)
      return true
    }
    this.load(); this.doc.authors[key] = { name, data: { ...profile }, updated: now, ...(scholarId === undefined ? {} : { scholarId }) }
    this.persist(); return true
  }
  stats(): { papers: number; papersComplete: number; papersPartial: number; authors: number; dbSizeBytes: number } {
    let papers = 0; let complete = 0; let authors = 0
    if (this.sqlite !== undefined) {
      papers = Number((this.sqlite.prepare('SELECT COUNT(*) AS count FROM papers').get() as { count?: number }).count ?? 0)
      complete = Number((this.sqlite.prepare('SELECT COUNT(*) AS count FROM papers WHERE complete = 1').get() as { count?: number }).count ?? 0)
      authors = Number((this.sqlite.prepare('SELECT COUNT(*) AS count FROM authors').get() as { count?: number }).count ?? 0)
    } else {
      this.load(); const values = Object.values(this.doc.papers); papers = values.length; complete = values.filter((item) => item.complete).length; authors = Object.keys(this.doc.authors).length
    }
    let size = 0; try { size = readFileSync(this.file).byteLength } catch { /* empty */ }
    return { papers, papersComplete: complete, papersPartial: papers - complete, authors, dbSizeBytes: size }
  }
  clear(): void {
    if (this.sqlite !== undefined) { this.sqlite.exec('DELETE FROM papers; DELETE FROM authors;'); return }
    this.load(); this.doc.papers = {}; this.doc.authors = {}; this.persist()
  }
}

export function autoRelatedWorkPaperToSource(paper: AutoPaper): AcademicSource {
  const url = paper.url ?? (paper.doi === undefined ? `https://scholar.google.com/scholar?q=${encodeURIComponent(paper.title)}` : `https://doi.org/${paper.doi}`)
  const details = [
    paper.year === undefined ? undefined : String(paper.year),
    paper.authors.length === 0 ? undefined : `作者：${paper.authors.join(', ')}`,
    paper.venue === undefined ? undefined : `期刊/会议：${paper.venue}`,
    paper.doi === undefined ? undefined : `DOI：${paper.doi}`,
    paper.citedByCount === undefined ? undefined : `被引：${paper.citedByCount}`,
    paper.institutions.length === 0 ? undefined : `机构：${paper.institutions.join(', ')}`,
  ].filter((item): item is string => item !== undefined)
  const description = [paper.abstract ?? paper.snippet, details.join(' · ')].filter((item): item is string => item !== undefined && item !== '').join(' · ')
  return {
    url,
    title: paper.title,
    ...(description !== '' ? { snippet: description } : {}),
    ...(paper.authorsStr !== undefined ? { authorsStr: paper.authorsStr } : {}),
    ...(paper.externalUrls.length > 0 ? { externalUrls: paper.externalUrls } : {}),
    ...(paper.domain !== undefined ? { domain: paper.domain } : {}),
    ...(paper.abstract !== undefined ? { abstract: paper.abstract } : {}),
    ...(paper.year !== undefined ? { year: paper.year, publishedAt: String(paper.year) } : {}),
    ...(paper.doi !== undefined ? { doi: paper.doi } : {}),
    ...(paper.authors.length > 0 ? { authors: paper.authors } : {}),
    ...(paper.venue !== undefined ? { venue: paper.venue } : {}),
    ...(paper.citedByCount !== undefined ? { citedByCount: paper.citedByCount } : {}),
    ...(paper.citedBy !== undefined ? { citedBy: paper.citedBy } : {}),
    ...(paper.pdfUrls.length > 0 ? { pdfUrls: paper.pdfUrls } : {}),
    ...(paper.additionalUrls.length > 0 ? { additionalUrls: paper.additionalUrls } : {}),
    ...(paper.citedByURL !== undefined ? { citedByURL: paper.citedByURL } : {}),
    ...(paper.allVersionsCount !== undefined ? { allVersionsCount: paper.allVersionsCount } : {}),
    ...(paper.allVersionsURL !== undefined ? { allVersionsURL: paper.allVersionsURL } : {}),
    ...(paper.allVersions !== undefined ? { allVersions: paper.allVersions } : {}),
    ...(paper.relatedArticlesURL !== undefined ? { relatedArticlesURL: paper.relatedArticlesURL } : {}),
    ...(paper.viewHTMLURLs.length > 0 ? { viewHTMLURLs: paper.viewHTMLURLs } : {}),
    ...(paper.clusterId !== undefined ? { clusterId: paper.clusterId } : {}),
    ...(paper.dataCid !== undefined ? { dataCid: paper.dataCid } : {}),
    ...(paper.authorsTruncated === true ? { authorsTruncated: true } : {}),
    ...(paper.paperId !== undefined ? { paperId: paper.paperId } : {}),
    ...(paper.bibtex !== undefined ? { bibtex: paper.bibtex } : {}),
    ...(paper.institutions.length > 0 ? { institutions: paper.institutions } : {}),
    ...(Object.keys(paper.authorScholarIds).length > 0 ? { authorScholarIds: paper.authorScholarIds } : {}),
    ...(paper.authorsDetailed.length > 0 ? { authorsDetailed: paper.authorsDetailed } : {}),
    ...(Object.keys(paper.authorProfiles).length > 0 ? { authorProfiles: paper.authorProfiles } : {}),
    ...(paper.emails.length > 0 ? { emails: paper.emails } : {}),
    ...(paper.references.length > 0 ? { references: paper.references } : {}),
    ...(Object.keys(paper.fieldSources).length > 0 ? { fieldSources: paper.fieldSources } : {}),
    ...(paper.completeness !== undefined ? { completeness: paper.completeness } : {}),
    ...(paper.missingFields !== undefined ? { missingFields: paper.missingFields } : {}),
    ...(paper.enrichStage !== undefined ? { enrichStage: paper.enrichStage } : {}),
    ...(paper.cacheComplete !== undefined ? { cacheComplete: paper.cacheComplete } : {}),
    sourceType: 'academic',
  }
}

/**
 * 把 AutoRelatedWork 原版 `_clean_paper`/Flask API 的输入重新装载为内部
 * 论文对象。原项目的 API 会把已经清理过的 snake_case 作者字段再次交给
 * enrich_fields；不能只读取 TS 自己的 camelCase 字段，否则 `/api/enrich`
 * 一类调用会静默丢掉作者、引用和字段来源。
 */
export function autoRelatedWorkPaperFromRecord(value: Record<string, unknown>): AutoRelatedWorkPaper {
  const rawAuthors = Array.isArray(value.authors) ? value.authors : Array.isArray(value.authors_parsed) ? value.authors_parsed : []
  const authorsDetailed: AcademicAuthor[] = rawAuthors.map((item): AcademicAuthor | undefined => {
    if (typeof item === 'string') return { name: item }
    if (!isObject(item) || typeof item.name !== 'string' || item.name.trim() === '') return undefined
    const affiliations = Array.isArray(item.affiliations) ? item.affiliations.filter((aff): aff is string => typeof aff === 'string' && aff.trim() !== '') : []
    const citationStatsRaw = isObject(item.citation_stats) ? item.citation_stats : isObject(item.citationStats) ? item.citationStats : undefined
    const citationStats = citationStatsRaw === undefined ? undefined : Object.fromEntries(Object.entries(citationStatsRaw).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1])))
    return {
      name: item.name.trim(),
      ...(affiliations.length > 0 ? { affiliations } : {}),
      ...(typeof item.scholar_id === 'string' && item.scholar_id !== '' ? { scholarId: item.scholar_id } : typeof item.scholarId === 'string' && item.scholarId !== '' ? { scholarId: item.scholarId } : {}),
      ...(typeof item.email === 'string' && item.email !== '' ? { email: item.email } : {}),
      ...(item.is_corresponding === true || item.corresponding === true ? { corresponding: true } : {}),
      ...(citationStats !== undefined ? { citationStats } : {}),
      ...(Array.isArray(item.interests) ? { interests: item.interests.filter((interest): interest is string => typeof interest === 'string') } : typeof item.interests === 'string' ? { interests: item.interests } : {}),
    }
  }).filter((item): item is AcademicAuthor => item !== undefined)
  const authors = authorsDetailed.map((item) => item.name)
  const explicitURL = typeof value.url === 'string' && /^https?:\/\//i.test(value.url) ? [value.url] : []
  const externalUrls = (Array.isArray(value.externalUrls) ? value.externalUrls : Array.isArray(value.external_urls) ? value.external_urls : explicitURL)
    .filter((item): item is string => typeof item === 'string' && /^https?:\/\//i.test(item))
  const url = typeof value.url === 'string' && value.url !== '' ? value.url : externalUrls[0]
  const authorScholarIds = isObject(value.authorScholarIds) ? Object.fromEntries(Object.entries(value.authorScholarIds).filter((item): item is [string, string] => typeof item[0] === 'string' && typeof item[1] === 'string')) : isObject(value._author_scholar_ids) ? Object.fromEntries(Object.entries(value._author_scholar_ids).filter((item): item is [string, string] => typeof item[0] === 'string' && typeof item[1] === 'string')) : {}
  const citedBy = isObject(value.citedBy) ? value.citedBy : isObject(value.cited_by) ? value.cited_by : typeof value.cited_count === 'number' || typeof value.cited_by_url === 'string' ? { count: value.cited_count, url: value.cited_by_url } : {}
  const allVersions = isObject(value.allVersions) ? value.allVersions : isObject(value.all_versions) ? value.all_versions : isObject(value.versions) ? value.versions : {}
  const fieldSources = isObject(value.fieldSources) ? { ...value.fieldSources } : isObject(value._field_sources) ? { ...value._field_sources } : {}
  const toStringArray = (input: unknown): string[] => Array.isArray(input) ? input.filter((item): item is string => typeof item === 'string' && item.trim() !== '') : []
  const references = Array.isArray(value.references) ? value.references.filter(isObject).map((item) => ({
    title: typeof item.title === 'string' ? item.title : '',
    ...(typeof item.url === 'string' ? { url: item.url } : {}),
    ...(typeof item.doi === 'string' ? { doi: item.doi } : {}),
    ...(Array.isArray(item.authors) ? { authors: item.authors.filter((author): author is string => typeof author === 'string') } : {}),
    ...(typeof item.venue === 'string' ? { venue: item.venue } : {}),
    ...(typeof item.year === 'number' ? { year: item.year } : {}),
    ...(typeof item.citedByCount === 'number' ? { citedByCount: item.citedByCount } : {}),
    ...(typeof item.source === 'string' ? { source: item.source } : typeof item._source === 'string' ? { source: item._source } : {}),
    ...(item.influential === true || item.is_influential === true ? { influential: true } : {}),
    ...(Array.isArray(item.citationIntents) ? { citationIntents: item.citationIntents.filter((v): v is string => typeof v === 'string') } : Array.isArray(item.intents) ? { citationIntents: item.intents.filter((v): v is string => typeof v === 'string') } : {}),
    ...(typeof item.citationContexts === 'number' ? { citationContexts: item.citationContexts } : typeof item.n_contexts === 'number' ? { citationContexts: item.n_contexts } : {}),
  })).filter((item) => item.title !== '') : []
  const rawReferences = Array.isArray(value._raw_references) ? value._raw_references.filter(isObject).map((item) => ({
    title: typeof item.title === 'string' ? item.title : '',
    ...(typeof item.url === 'string' ? { url: item.url } : {}),
    ...(typeof item.doi === 'string' ? { doi: item.doi } : {}),
    ...(Array.isArray(item.authors) ? { authors: item.authors.map((author) => typeof author === 'string' ? author : isObject(author) && typeof author.name === 'string' ? author.name : '').filter(Boolean) } : {}),
    ...(typeof item.venue === 'string' ? { venue: item.venue } : {}),
    ...(typeof item.year === 'number' ? { year: item.year } : {}),
    ...(typeof item.cited_count === 'number' ? { citedByCount: item.cited_count } : typeof item.citedByCount === 'number' ? { citedByCount: item.citedByCount } : {}),
    ...(typeof item._source === 'string' ? { source: item._source } : typeof item.source === 'string' ? { source: item.source } : {}),
    ...(item._ref_signals !== undefined ? { influential: isObject(item._ref_signals) && item._ref_signals.is_influential === true, citationIntents: isObject(item._ref_signals) && Array.isArray(item._ref_signals.intents) ? item._ref_signals.intents.filter((v): v is string => typeof v === 'string') : [], citationContexts: isObject(item._ref_signals) && typeof item._ref_signals.n_contexts === 'number' ? item._ref_signals.n_contexts : 0 } : {}),
  })).filter((item) => item.title !== '') : []
  const title = typeof value.title === 'string' ? value.title.trim() : ''
  return {
    title,
    authors,
    ...(typeof value.authorsStr === 'string' ? { authorsStr: value.authorsStr } : typeof value.authors_str === 'string' ? { authorsStr: value.authors_str } : {}),
    externalUrls,
    ...(typeof value.snippet === 'string' ? { snippet: value.snippet } : {}),
    ...(typeof value.year === 'number' ? { year: value.year } : {}),
    ...(url !== undefined ? { url } : {}),
    additionalUrls: toStringArray(value.additionalUrls ?? value.additional_urls),
    ...(typeof value.domain === 'string' ? { domain: value.domain } : {}),
    ...(typeof value.doi === 'string' ? { doi: value.doi } : {}),
    ...(typeof value.venue === 'string' ? { venue: value.venue } : {}),
    ...(typeof value.abstract === 'string' ? { abstract: value.abstract } : {}),
    ...(typeof value.citedByCount === 'number' ? { citedByCount: value.citedByCount } : typeof citedBy.count === 'number' ? { citedByCount: citedBy.count } : {}),
    ...(Object.keys(citedBy).length > 0 ? { citedBy: { ...(typeof citedBy.count === 'number' ? { count: citedBy.count } : {}), ...(typeof citedBy.url === 'string' ? { url: citedBy.url } : {}) } } : {}),
    ...(typeof value.citedByURL === 'string' ? { citedByURL: value.citedByURL } : typeof citedBy.url === 'string' ? { citedByURL: citedBy.url } : {}),
    pdfUrls: toStringArray(value.pdfUrls ?? value.pdf_urls),
    ...(typeof value.paperId === 'string' ? { paperId: value.paperId } : typeof value.paper_id === 'string' ? { paperId: value.paper_id } : {}),
    ...(typeof value.scholarCid === 'string' ? { scholarCid: value.scholarCid } : typeof value.dataCid === 'string' ? { scholarCid: value.dataCid } : typeof value.data_cid === 'string' ? { scholarCid: value.data_cid } : {}),
    ...(typeof value.allVersionsCount === 'number' ? { allVersionsCount: value.allVersionsCount } : typeof allVersions.count === 'number' ? { allVersionsCount: allVersions.count } : {}),
    ...(typeof value.allVersionsURL === 'string' ? { allVersionsURL: value.allVersionsURL } : typeof allVersions.url === 'string' ? { allVersionsURL: allVersions.url } : {}),
    ...(Object.keys(allVersions).length > 0 ? { allVersions: { ...(typeof allVersions.count === 'number' ? { count: allVersions.count } : {}), ...(typeof allVersions.url === 'string' ? { url: allVersions.url } : {}) } } : {}),
    ...(typeof value.relatedArticlesURL === 'string' ? { relatedArticlesURL: value.relatedArticlesURL } : typeof value.related_articles_url === 'string' ? { relatedArticlesURL: value.related_articles_url } : {}),
    viewHTMLURLs: toStringArray(value.viewHTMLURLs ?? value.view_html_urls),
    ...(typeof value.clusterId === 'string' ? { clusterId: value.clusterId } : typeof value.cluster_id === 'string' ? { clusterId: value.cluster_id } : {}),
    ...(typeof value.dataCid === 'string' ? { dataCid: value.dataCid } : typeof value.data_cid === 'string' ? { dataCid: value.data_cid } : {}),
    ...(value.authorsTruncated === true ? { authorsTruncated: true } : {}),
    ...(typeof value.bibtex === 'string' ? { bibtex: value.bibtex } : {}),
    institutions: toStringArray(value.institutions),
    authorScholarIds,
    authorsDetailed,
    authorProfiles: isObject(value.authorProfiles) ? value.authorProfiles as Record<string, AcademicAuthorProfile> : {},
    emails: toStringArray(value.emails),
    references,
    ...(rawReferences.length > 0 ? { rawReferences } : {}),
    ...(typeof value.source === 'string' ? { source: value.source } : typeof value._source === 'string' ? { source: value._source } : {}),
    fieldSources: fieldSources as Record<string, string>,
    ...(typeof value.completeness === 'number' ? { completeness: value.completeness } : typeof value._completeness === 'number' ? { completeness: value._completeness } : {}),
    ...(Array.isArray(value.missingFields) ? { missingFields: value.missingFields.filter((item): item is string => typeof item === 'string') } : Array.isArray(value._missing_fields) ? { missingFields: value._missing_fields.filter((item): item is string => typeof item === 'string') } : {}),
    ...(typeof value.enrichStage === 'string' ? { enrichStage: value.enrichStage as AutoRelatedWorkPaper['enrichStage'] } : typeof value._enrich_stage === 'string' ? { enrichStage: value._enrich_stage as AutoRelatedWorkPaper['enrichStage'] } : {}),
    ...(value.cacheComplete === true || value._cache_complete === true ? { cacheComplete: true } : {}),
    ...(typeof value.depth === 'number' ? { depth: value.depth } : typeof value._depth === 'number' ? { depth: value._depth } : {}),
    ...(typeof value.aiRelevance === 'number' ? { aiRelevance: value.aiRelevance } : typeof value._ai_relevance === 'number' ? { aiRelevance: value._ai_relevance } : {}),
    ...(typeof value.aiRelevanceReason === 'string' ? { aiRelevanceReason: value.aiRelevanceReason } : typeof value._ai_relevance_reason === 'string' ? { aiRelevanceReason: value._ai_relevance_reason } : {}),
    ...(value._resume_done === true ? { resumeDone: true } : {}),
  }
}

function forceEnglishScholarURL(value: string | undefined): string | undefined {
  if (value === undefined || !value.includes('scholar.google')) return value
  // Python 版只替换已有 hl 参数，不会给原本没有 hl 的 URL 添加新参数。
  return value.replace(/([?&])hl=[^&]*/i, '$1hl=en')
}

/**
 * 与 Python `scholar_search._clean_paper` 字段级兼容的输出。内部 Web seam
 * 使用 camelCase 的精简来源；原项目 API/批处理客户端则需要这里的固定
 * snake_case schema（缺失字段也必须返回 null）。
 */
export function cleanAutoRelatedWorkPaper(input: AutoRelatedWorkPaper | Record<string, unknown>): Record<string, unknown> {
  const paper = 'authorsDetailed' in input ? input as AutoRelatedWorkPaper : autoRelatedWorkPaperFromRecord(input)
  // Python `_clean_paper` falls back from `authors_parsed` to `authors_str`.
  // Keep that slightly odd but observable behavior for direct Flask-schema
  // callers: an authors_str-only record becomes one fixed-schema author,
  // rather than silently turning into the synthetic `Unknown` author.
  const rawAuthors: unknown[] = paper.authorsDetailed.length > 0
    ? paper.authorsDetailed
    : paper.authors.length > 0
      ? paper.authors
      : paper.authorsStr !== undefined
        ? [paper.authorsStr]
        : ['Unknown']
  const cleanAuthor = (value: unknown): Record<string, unknown> => {
    const item = typeof value === 'string' ? { name: value } : isObject(value) ? value : { name: 'Unknown' }
    const institutionKeywords = /university|college|institute|school|lab|laboratory|department|center|centre|research|technology|academy|hospital|foundation|company|corporation|corp\b|inc\b|ltd\b|大学|学院|研究所|研究院|中心|实验室|医院|科技|公司/i
    const affiliations = Array.isArray(item.affiliations) ? item.affiliations.filter((aff): aff is string => typeof aff === 'string').map((aff) => {
      let value = autoRelatedWorkStripControlChars(aff).trim()
      value = value.replace(/[\d,\s]*[*†‡§¶#∗♡♠♦♣©®™⊕⋆]+\s*$/u, '').trim()
      value = value.replace(/^\d+\s*/, '').trim()
      return value
    }).filter((aff) => aff.length >= 2 && !/^https?:\/\//i.test(aff) && !aff.includes('@') && !/^\d+$/.test(aff) && !/^\d/.test(aff)).filter((aff) => {
      const words = aff.split(/\s+/).filter(Boolean)
      const looksLikeName = words.length >= 2 && words.length <= 4 && words.every((word) => /^[A-Z]/.test(word))
      return !looksLikeName || institutionKeywords.test(aff)
    }) : []
    const name = typeof item.name === 'string' ? autoRelatedWorkStripControlChars(item.name) : 'Unknown'
    return {
      name,
      affiliations: affiliations.length > 0 ? affiliations : null,
      is_corresponding: item.corresponding === true || item.is_corresponding === true ? true : null,
      email: typeof item.email === 'string' && item.email !== '' ? item.email : null,
      scholar_id: typeof item.scholarId === 'string' ? item.scholarId : typeof item.scholar_id === 'string' ? item.scholar_id : null,
      citation_stats: isObject(item.citationStats) ? item.citationStats : isObject(item.citation_stats) ? item.citation_stats : null,
      interests: Array.isArray(item.interests) ? item.interests : typeof item.interests === 'string' ? item.interests : null,
    }
  }
  const authors = rawAuthors.map(cleanAuthor)
  const institutions = new Set<string>()
  for (const raw of [...paper.institutions, ...authors.flatMap((item) => Array.isArray(item.affiliations) ? item.affiliations as string[] : [])]) {
    for (const part of String(raw).split(/\s+\d+\s*/).map((item) => item.replace(/^\d+\s*/, '').trim())) if (part.length >= 2 && !part.startsWith('http') && !part.includes('@') && !/^\d+$/.test(part)) institutions.add(part)
  }
  const externalUrls = paper.externalUrls
  const url = externalUrls[0] ?? null
  let domain: string | null = null
  try { domain = url === null ? null : new URL(url).host } catch { domain = null }
  const additionalUrls = externalUrls.length > 1 ? externalUrls.slice(1) : null
  let doi = normalizeDOI(paper.doi)
  if (doi === undefined) for (const external of externalUrls) {
    const match = external.match(/doi\.org\/(10\.\d{4,9}\/[^?#\s]+)/i)
    if (match?.[1] !== undefined) { doi = normalizeDOI(match[1]); break }
  }
  const citedBy = paper.citedBy ?? {}
  const versions = paper.allVersions ?? {}
  const fieldSources: Record<string, string> = { ...paper.fieldSources }
  const rawToOutput: Record<string, string[]> = {
    externalUrls: ['url', 'domain', 'additional_urls'], external_urls: ['url', 'domain', 'additional_urls'],
    citedBy: ['cited_count', 'cited_by_url'], cited_by: ['cited_count', 'cited_by_url'],
    allVersions: ['versions'], all_versions: ['versions'], authorsDetailed: ['authors'], authors_parsed: ['authors'], snippet: ['abstract'],
  }
  for (const [raw, outputs] of Object.entries(rawToOutput)) if (fieldSources[raw] !== undefined) for (const output of outputs) fieldSources[output] ??= fieldSources[raw]!
  for (const key of ['authorsDetailed', 'externalUrls', 'authorScholarIds']) delete fieldSources[key]
  const source = paper.source
  if (source !== undefined) for (const key of ['title', 'authors', 'abstract', 'year', 'venue', 'doi', 'paper_id', 'institutions', 'emails', 'url', 'domain', 'bibtex', 'cited_count', 'cited_by_url', 'versions', 'additional_urls', 'related_articles_url', 'view_html_urls', 'pdf_urls']) fieldSources[key] ??= source
  const result: Record<string, unknown> = {
    title: normalizeText(paper.title),
    authors,
    year: paper.year || null,
    paper_id: paper.paperId ?? null,
    abstract: paper.abstract || paper.snippet ? normalizeText(paper.abstract || paper.snippet || '') : null,
    venue: paper.venue ? normalizeText(paper.venue) : null,
    institutions: institutions.size > 0 ? [...institutions].sort() : null,
    emails: paper.emails.length > 0 ? paper.emails : null,
    url,
    domain,
    additional_urls: additionalUrls,
    doi: doi ?? null,
    cited_count: citedBy.count || paper.citedByCount || null,
    cited_by_url: forceEnglishScholarURL(citedBy.url ?? paper.citedByURL) ?? null,
    versions: versions.count || versions.url ? { count: versions.count || null, url: forceEnglishScholarURL(versions.url) ?? null } : null,
    related_articles_url: forceEnglishScholarURL(paper.relatedArticlesURL) ?? null,
    view_html_urls: paper.viewHTMLURLs.length > 0 ? paper.viewHTMLURLs.map((item) => forceEnglishScholarURL(item)) : null,
    pdf_urls: paper.pdfUrls.length > 0 ? paper.pdfUrls : null,
    bibtex: paper.bibtex ?? null,
    _author_scholar_ids: Object.keys(paper.authorScholarIds).length > 0 ? paper.authorScholarIds : null,
    _field_sources: Object.keys(fieldSources).length > 0 ? fieldSources : null,
    ...(paper.references.length > 0 ? { references: paper.references } : {}),
    ...(paper.depth !== undefined ? { _depth: paper.depth } : {}),
    ...(paper.aiRelevance !== undefined ? { _ai_relevance: paper.aiRelevance } : {}),
    ...(paper.aiRelevanceReason !== undefined ? { _ai_relevance_reason: paper.aiRelevanceReason } : {}),
  }
  return result
}

function mergePaper(paper: AutoPaper, patch: Partial<AutoPaper>): void {
  if (patch.title !== undefined && autoRelatedWorkTitlesMatch(paper.title, patch.title)) paper.title = patch.title
  if (patch.authors !== undefined && (paper.authors.length === 0 || patch.authors.length > paper.authors.length)) paper.authors = patch.authors
  if (paper.venue === undefined && patch.venue !== undefined) paper.venue = patch.venue
  if (paper.year === undefined && patch.year !== undefined) paper.year = patch.year
  if (paper.doi === undefined && patch.doi !== undefined) paper.doi = patch.doi
  if (paper.abstract === undefined && patch.abstract !== undefined && patch.abstract.length >= 40) paper.abstract = patch.abstract
  if (paper.citedByCount === undefined && patch.citedByCount !== undefined) paper.citedByCount = patch.citedByCount
  if (patch.url !== undefined && paper.url === undefined) paper.url = patch.url
  if (patch.pdfUrls !== undefined) paper.pdfUrls = [...new Set([...paper.pdfUrls, ...patch.pdfUrls])]
  if (patch.institutions !== undefined) paper.institutions = [...new Set([...paper.institutions, ...patch.institutions])]
  if (patch.authorsDetailed !== undefined) mergeAuthorDetails(paper, patch.authorsDetailed)
  if (patch.emails !== undefined) paper.emails = [...new Set([...paper.emails, ...patch.emails])]
  if (patch.references !== undefined) paper.references = patch.references
}

function mergePaperWithSource(paper: AutoPaper, patch: Partial<AutoPaper>, source: string): void {
  const before = new Map(Object.entries(paper).map(([key, value]) => [key, JSON.stringify(value)]))
  mergePaper(paper, patch)
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'fieldSources' || key.startsWith('_') || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) continue
    if (before.get(key) !== JSON.stringify(paper[key as keyof AutoPaper])) paper.fieldSources[key] = source
    else if (paper.fieldSources[key] === undefined) paper.fieldSources[key] = source
  }
}

/** 原始 _make_sem_sch_queries：完整标题、截断/介词前缀、冒号核心词、首个有效词。 */
export function autoRelatedWorkSemanticScholarQueries(title: string): string[] {
  const queries: string[] = []
  const full = title.trim().slice(0, 80)
  if (full !== '') queries.push(full)
  for (const separator of [' for ', ' via ', ' using ', ' with ', ' in ', ' on ']) {
    const index = full.toLocaleLowerCase().indexOf(separator)
    if (index > 20) {
      const value = full.slice(0, index).replace(/[,：:]$/, '').trim()
      if (value.length >= 10 && !queries.includes(value)) queries.push(value)
      break
    }
  }
  if (full.includes(':')) {
    const [core, ...rest] = full.split(':')
    const coreValue = core!.trim()
    if (coreValue.length >= 4 && !queries.includes(coreValue)) queries.push(coreValue)
    let description = rest.join(':').trim()
    for (const separator of [' for ', ' via ', ' using ']) {
      const index = description.toLocaleLowerCase().indexOf(separator)
      if (index > 8) { description = description.slice(0, index); break }
    }
    if (description.length >= 10 && !queries.includes(description)) queries.push(description)
  }
  const firstWord = full.match(/[A-Za-z]{4,}/g)?.find((word) => !['this', 'that', 'with', 'from', 'using'].includes(word.toLocaleLowerCase()))
  if (firstWord !== undefined && !queries.includes(firstWord)) queries.push(firstWord)
  return queries
}

async function semanticScholarSearchForPaper(title: string, options: AutoRelatedWorkOptions, fetchImpl: FetchLike): Promise<Record<string, unknown> | undefined> {
  const headers = options.credentials?.semanticScholarApiKey === undefined ? {} : { headers: { 'x-api-key': options.credentials.semanticScholarApiKey } }
  const base = cleanURL(options.config?.semanticScholarURL, 'https://api.semanticscholar.org/graph/v1')
  for (const [index, query] of autoRelatedWorkSemanticScholarQueries(title).entries()) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const body = await requestJSON(fetchImpl, `${base}/paper/search?query=${encodeURIComponent(query)}&limit=1&fields=title,abstract,authors,citationCount,venue,openAccessPdf`, options.signal, headers)
        const item = Array.isArray(body.data) && isObject(body.data[0]) ? body.data[0] : undefined
        if (item === undefined) break
        const candidate = text(item.title)
        if (candidate !== undefined && !autoRelatedWorkTitlesOverlap(title, candidate, 0.35)) {
          // 与 Python 的模糊区一致：没有可调用的 AI matcher 时保持保守，
          // 不能因为只共享几个词就把别的论文的摘要挂过来。
          if (!autoRelatedWorkTitlesOverlap(title, candidate, 0.2)) break
          const same = await aiSamePaper(title, candidate, options, fetchImpl)
          if (same !== true) break
        }
        return item
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (!/429/.test(message) || attempt >= 2) break
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, 5_000 * (attempt + 1))
          if (options.signal !== undefined) options.signal.addEventListener('abort', () => { clearTimeout(timer); reject(options.signal!.reason) }, { once: true })
        })
      }
    }
    if (index < autoRelatedWorkSemanticScholarQueries(title).length - 1) await new Promise<void>((resolve) => setTimeout(resolve, 800))
  }
  return undefined
}

/** 只给已有作者补机构；Crossref/OpenAlex 不得凭空替换或新增作者列表。 */
function mergeMatchedAuthorAffiliations(paper: AutoPaper, incoming: AcademicAuthor[], includeAllInstitutions: boolean): boolean {
  if (incoming.length === 0 || paper.authorsDetailed.length === 0) return false
  let changed = false
  const matchedInstitutions = new Set<string>()
  const allInstitutions = new Set<string>()
  for (const detail of incoming) {
    for (const affiliation of detail.affiliations ?? []) allInstitutions.add(affiliation)
    const index = paper.authorsDetailed.findIndex((author) => autoRelatedWorkMatchAuthor(author.name, [detail.name]) !== undefined)
    if (index < 0) continue
    const current = paper.authorsDetailed[index]!
    const affiliations = [...new Set([...(current.affiliations ?? []), ...(detail.affiliations ?? [])])]
    for (const affiliation of affiliations) matchedInstitutions.add(affiliation)
    if (affiliations.length !== (current.affiliations?.length ?? 0)) {
      paper.authorsDetailed[index] = { ...current, affiliations }
      changed = true
    }
  }
  const institutions = includeAllInstitutions ? allInstitutions : matchedInstitutions
  if (institutions.size > 0) {
    const merged = [...new Set([...paper.institutions, ...institutions])]
    if (merged.length !== paper.institutions.length) { paper.institutions = merged; changed = true }
  }
  return changed
}

async function enrichCrossrefPaper(paper: AutoPaper, options: AutoRelatedWorkOptions, fetchImpl: FetchLike): Promise<void> {
  // 原版在已有 DOI 时整个跳过 Crossref，而不是继续用它补 venue/作者机构。
  if (paper.doi !== undefined || paper.title === '') return
  const url = `${cleanURL(options.config?.crossrefURL, 'https://api.crossref.org')}/works?query.title=${encodeURIComponent(paper.title)}&rows=1&select=DOI,title,container-title,published,author,type`
  try {
    const body = await requestJSON(fetchImpl, url, options.signal, { headers: { 'user-agent': 'ScholarScraper/1.0 (mailto:research@example.com)' } })
    const item = isObject(body.message) && Array.isArray(body.message.items) ? body.message.items[0] : undefined
    if (!isObject(item)) return
    const candidateTitle = Array.isArray(item.title) ? text(item.title[0]) : text(item.title)
    if (candidateTitle !== undefined && !autoRelatedWorkTitlesMatch(paper.title, candidateTitle)) return
    const doi = normalizeDOI(text(item.DOI))
    if (doi !== undefined && paper.doi === undefined) { paper.doi = doi; paper.fieldSources.doi = 'Crossref' }
    const venue = Array.isArray(item['container-title']) ? text(item['container-title'][0]) : text(item['container-title'])
    if (venue !== undefined && paper.venue === undefined) { paper.venue = normalizeText(venue); paper.fieldSources.venue = 'Crossref' }
    const needInstitutions = paper.institutions.length === 0 || paper.institutions.length <= 1
    if (needInstitutions && Array.isArray(item.author)) {
      const details: AcademicAuthor[] = item.author.map((author): AcademicAuthor | undefined => {
        if (!isObject(author)) return undefined
        const name = [text(author.given), text(author.family)].filter((value): value is string => value !== undefined).join(' ')
        const affiliations = Array.isArray(author.affiliation) ? author.affiliation.map((value) => isObject(value) ? text(value.name) : undefined).filter((value): value is string => value !== undefined) : []
        return name === '' ? undefined : { name, ...(affiliations.length > 0 ? { affiliations } : {}) }
      }).filter((value): value is AcademicAuthor => value !== undefined)
      if (mergeMatchedAuthorAffiliations(paper, details, false)) {
        paper.fieldSources.authorsDetailed = 'Crossref'
        paper.fieldSources.institutions = 'Crossref'
      }
    }
  } catch { /* 单个补全源失败不阻塞其他源 */ }
}

async function enrichOpenAlexPaper(paper: AutoPaper, options: AutoRelatedWorkOptions, fetchImpl: FetchLike): Promise<void> {
  if (paper.title === '') return
  const needAbstract = paper.abstract === undefined || paper.abstract.length < 100
  const needInstitutions = paper.institutions.length === 0 || paper.institutions.length <= 1
  const needDoi = paper.doi === undefined
  const needVenue = paper.venue === undefined
  if (!needAbstract && !needInstitutions && !needDoi && !needVenue) return
  const url = `${cleanURL(options.config?.openAlexURL, 'https://api.openalex.org')}/works?search=${encodeURIComponent(paper.title)}&per-page=1&select=id,doi,title,abstract_inverted_index,publication_year,publication_date,primary_location,authorships,cited_by_count,open_access`
  try {
    const body = await requestJSON(fetchImpl, url, options.signal, { headers: { 'user-agent': 'mailto:research@example.com' } })
    const item = Array.isArray(body.results) ? body.results[0] : undefined
    if (!isObject(item)) return
    const candidateTitle = text(item.title)
    if (candidateTitle !== undefined && !autoRelatedWorkTitlesMatch(paper.title, candidateTitle)) return
    if (needDoi) {
      const doi = normalizeDOI(text(item.doi))
      if (doi !== undefined) { paper.doi = doi; paper.fieldSources.doi = 'OpenAlex' }
    }
    if (needAbstract) {
      const abstract = invertAbstract(item.abstract_inverted_index)
      if (abstract !== undefined && abstract.length > 100) { paper.abstract = autoRelatedWorkStripControlChars(abstract); paper.fieldSources.abstract = 'OpenAlex' }
    }
    const primary = isObject(item.primary_location) ? item.primary_location : {}
    const source = isObject(primary.source) ? primary.source : {}
    if (needVenue && text(source.display_name) !== undefined) { paper.venue = normalizeText(text(source.display_name)!); paper.fieldSources.venue = 'OpenAlex' }
    const cited = number(item.cited_by_count)
    if (cited !== undefined && (paper.citedBy?.count ?? 0) === 0) { paper.citedBy = { ...(paper.citedBy ?? {}), count: cited }; paper.fieldSources.citedBy = 'OpenAlex' }
    const openAccess = isObject(item.open_access) ? item.open_access : {}
    const pdfURL = text(primary.pdf_url) ?? text(openAccess.oa_url)
    if (pdfURL !== undefined && pdfURL.endsWith('.pdf') && !paper.pdfUrls.includes(pdfURL)) { paper.pdfUrls.push(pdfURL); paper.fieldSources.pdfUrls = 'OpenAlex' }
    if (needInstitutions && Array.isArray(item.authorships)) {
      const details: AcademicAuthor[] = item.authorships.map((auth): AcademicAuthor | undefined => {
        if (!isObject(auth) || !isObject(auth.author)) return undefined
        const name = text(auth.author.display_name)
        const affiliations = Array.isArray(auth.institutions) ? auth.institutions.map((inst) => isObject(inst) ? text(inst.display_name) : undefined).filter((value): value is string => value !== undefined) : []
        return name === undefined ? undefined : { name, ...(affiliations.length > 0 ? { affiliations } : {}) }
      }).filter((value): value is AcademicAuthor => value !== undefined)
      if (mergeMatchedAuthorAffiliations(paper, details, true)) {
        paper.fieldSources.authorsDetailed = 'OpenAlex'
        paper.fieldSources.institutions = 'OpenAlex'
      }
    }
  } catch { /* optional */ }
}

async function enrichDblpPaper(paper: AutoPaper, options: AutoRelatedWorkOptions, fetchImpl: FetchLike): Promise<void> {
  if (paper.title === '' || (paper.authors.length > 1 && paper.venue !== undefined)) return
  const url = `${cleanURL(options.config?.dblpURL, 'https://dblp.org')}/search/publ/api?q=${encodeURIComponent(paper.title)}&format=json&h=1`
  try {
    const body = await requestJSON(fetchImpl, url, options.signal, { headers: { 'user-agent': 'ScholarScraper/1.0' } })
    const hit = isObject(body.result) && isObject(body.result.hits) && Array.isArray(body.result.hits.hit) ? body.result.hits.hit[0] : undefined
    const info = isObject(hit) && isObject(hit.info) ? hit.info : undefined
    if (info === undefined) return
    const candidateTitle = text(info.title)
    if (candidateTitle !== undefined && !autoRelatedWorkTitlesMatch(paper.title, candidateTitle)) return
    if (paper.venue === undefined && text(info.venue) !== undefined) { paper.venue = normalizeText(text(info.venue)!); paper.fieldSources.venue = 'DBLP' }
    const authorsRaw = isObject(info.authors) ? info.authors.author : []
    const names = (Array.isArray(authorsRaw) ? authorsRaw : [authorsRaw]).map((value) => isObject(value) ? text(value.text) ?? '' : '').filter(Boolean)
    if (names.length > 0 && paper.authors.length <= 1) {
      const detailList = paper.authorsDetailed.length > 0 ? paper.authorsDetailed : paper.authors.map((name) => ({ name }))
      let added = false
      for (const name of names) {
        if (paper.authors.some((existing) => autoRelatedWorkMatchAuthor(name, [existing]) !== undefined)) continue
        paper.authors.push(name)
        detailList.push({ name })
        added = true
      }
      if (paper.authorsDetailed.length === 0 || added) paper.authorsDetailed = detailList
      if (added) { paper.fieldSources.authorsDetailed = 'DBLP'; paper.fieldSources.authors = 'DBLP' }
    }
    if (paper.doi === undefined) {
      const doi = normalizeDOI(text(info.doi))
      if (doi !== undefined) { paper.doi = doi; paper.fieldSources.doi = 'DBLP' }
    }
  } catch { /* optional */ }
}

async function enrichSemanticScholarPaper(paper: AutoPaper, options: AutoRelatedWorkOptions, fetchImpl: FetchLike): Promise<void> {
  if (options.config?.fetchSemanticScholar === false || (paper.abstract !== undefined && paper.abstract.length > 200)) return
  try {
    const item = await semanticScholarSearchForPaper(paper.title, options, fetchImpl)
    if (!isObject(item)) return
    const abstract = text(item.abstract)
    if (abstract !== undefined) { paper.abstract = autoRelatedWorkStripControlChars(abstract); paper.fieldSources.abstract = 'SemanticScholar' }
    const authors = Array.isArray(item.authors) ? item.authors.map((author) => isObject(author) ? text(author.name) ?? '' : '').filter(Boolean) : []
    if (authors.length > paper.authors.length) {
      paper.authors = authors
      paper.authorsDetailed = authors.map((name) => ({ name }))
      paper.fieldSources.authors = 'SemanticScholar'
      paper.fieldSources.authorsDetailed = 'SemanticScholar'
    }
    const cited = number(item.citationCount)
    if (cited !== undefined && (paper.citedBy?.count ?? 0) === 0) { paper.citedBy = { ...(paper.citedBy ?? {}), count: cited }; paper.fieldSources.citedBy = 'SemanticScholar' }
    const venue = text(item.venue)
    if (venue !== undefined && paper.venue === undefined) { paper.venue = normalizeText(venue); paper.fieldSources.venue = 'SemanticScholar' }
    const openAccess = isObject(item.openAccessPdf) ? item.openAccessPdf : {}
    const pdfURL = text(openAccess.url)
    if (pdfURL !== undefined && !paper.pdfUrls.includes(pdfURL)) { paper.pdfUrls.push(pdfURL); paper.fieldSources.pdfUrls = 'SemanticScholar' }
  } catch { /* optional */ }
}

async function enrichUnpaywallPaper(paper: AutoPaper, options: AutoRelatedWorkOptions, fetchImpl: FetchLike): Promise<void> {
  if (paper.doi === undefined) return
  try {
    const email = options.credentials?.unpaywallEmail?.trim() || AUTORELATEDWORK_DEFAULT_UNPAYWALL_EMAIL
    const endpoint = `https://api.unpaywall.org/v2/${encodeURIComponent(paper.doi).replace(/%2F/gi, '/')}?email=${encodeURIComponent(email)}`
    const body = await requestJSON(fetchImpl, endpoint, options.signal, { headers: { 'user-agent': 'ScholarScraper/1.0' } })
    const locations = Array.isArray(body.oa_locations) ? body.oa_locations : []
    for (const location of locations) {
      const url = isObject(location) ? text(location.url_for_pdf) ?? text(location.url_for_landing_page) : undefined
      if (url !== undefined && !paper.pdfUrls.includes(url)) { paper.pdfUrls.push(url); paper.fieldSources.pdfUrls = 'Unpaywall' }
    }
  } catch { /* 404/no OA is normal */ }
}

function dedupePapers(papers: AutoPaper[], limit: number): AutoPaper[] {
  const seen = new Set<string>()
  const result: AutoPaper[] = []
  for (const paper of papers) {
    const key = (paper.doi ?? paper.title).toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    if (key === '' || seen.has(key)) continue
    seen.add(key); result.push(paper)
    if (result.length >= limit) break
  }
  return result
}

function cacheKey(query: string, limit: number, config: AutoRelatedWorkConfig): string {
  return JSON.stringify({ query: query.toLocaleLowerCase().trim(), limit, type: config.searchType ?? 'general', citesId: config.citesId ?? '', enrich: config.enrich !== false, bibtex: config.fetchBibtex !== false, arxiv: config.fetchArxiv !== false, arxivHTML: config.fetchArxivHTML !== false, profiles: config.includeAuthorProfiles === true, deepseek: config.deepseekEnrich !== false, depth: config.recursiveDepth ?? 0, width: config.recursiveWidth ?? 5, maxTotal: config.recursiveMaxTotal ?? 50 })
}

function finalizeAutoRelatedWorkPaper(paper: AutoPaper, complete: boolean): void {
  const normalized = { ...paper, authors: paper.authorsDetailed }
  paper.completeness = Math.round(autoRelatedWorkCompleteness(normalized) * 100) / 100
  paper.missingFields = autoRelatedWorkMissingFields(normalized)
  paper.enrichStage = complete ? 'done' : 'search'
  paper.cacheComplete = complete
}

/** AutoRelatedWork 搜索入口。 */
export async function searchAutoRelatedWork(options: AutoRelatedWorkOptions): Promise<AcademicSearchResult> {
  const query = options.query.trim()
  if (query === '') throw new Error('学术检索词不能为空')
  const config = options.config ?? {}
  const limit = Math.min(Math.max(Math.floor(options.limit ?? 8), 1), 20)
  const fetchImpl = createAutoRelatedWorkFetch(options.fetchImpl ?? fetch, options)
  const configuredCacheFile = config.cacheFile
  const cacheEnabled = config.cacheEnabled !== false
  const cacheFile = configuredCacheFile !== undefined && /\.db$/i.test(configuredCacheFile)
    ? `${configuredCacheFile}.queries.json`
    : configuredCacheFile ?? (options.dataRoot === undefined ? undefined : join(options.dataRoot, 'plugins', AUTORELATEDWORK_DEFAULT_CACHE_FILE))
  const cache = cacheEnabled && cacheFile !== undefined ? new AutoRelatedWorkJSONCache(cacheFile) : undefined
  // Do not keep a native SQLite handle open while Scholar/metadata requests are
  // running.  The standalone entry only writes the final result, so defer the
  // short-lived handle until the very end.  This is important on Windows:
  // keeping a WAL handle alive across a cached return prevents the data root
  // from being moved or cleared by the settings panel.
  const paperCacheFile = cacheEnabled && options.dataRoot !== undefined ? (
    configuredCacheFile !== undefined && /\.db$/i.test(configuredCacheFile)
      ? configuredCacheFile
      : join(options.dataRoot, 'plugins', 'cache', 'scholar_cache.db')
  ) : undefined
  const key = cacheKey(query, limit, config)
  if (cache !== undefined) {
    const hit = cache.get(key, config.cacheTTLHours ?? 24)
    if (hit !== undefined) return hit
  }
  const scholarBase = cleanURL(config.scholarURL, AUTORELATEDWORK_DEFAULT_SCHOLAR_URL)
  const startedAt = Date.now()
  const delay = Math.max(0, Math.floor(config.delayMs ?? 1200))
  const attempts = Math.min(Math.max(Math.floor(config.maxRetries ?? 3), 1), 6)
  let papers: AutoPaper[] = []
  let lastError: unknown
  let totalAvailable: number | undefined
  const searchType = config.searchType ?? 'general'
  if (searchType !== 'general') {
    const advanced = await searchAutoRelatedWorkScholar({ ...options, searchType, citesId: config.citesId, maxResults: limit })
    papers = advanced.papers
    totalAvailable = advanced.total
  } else {
    const variants = queryVariants(query)
    for (let variantIndex = 0; variantIndex < variants.length; variantIndex += 1) {
      const variant = variants[variantIndex]!
      try {
        const fetchScholar = () => requestScholarHTMLRace(scholarURL(scholarBase, variant, limit), options, fetchImpl, variantIndex)
        const html = await retry(fetchScholar, attempts, delay, options.signal)
        if (/recaptcha|sorry\/index|unusual traffic/i.test(html)) throw new Error('Google Scholar 返回 CAPTCHA/异常流量页面')
        totalAvailable ??= parseAutoRelatedWorkScholarTotalCount(html)
        papers = dedupePapers([...papers, ...parseAutoRelatedWorkScholarResults(html, scholarBase)], limit)
        options.onProgress?.({ stage: 'scholar', index: variantIndex + 1, total: papers.length, message: `Scholar 查询变体 ${variantIndex + 1}/${variants.length}` })
        if (papers.length >= limit) break
      } catch (error) {
        lastError = error
      }
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }
  if (papers.length === 0) throw new Error(`AutoRelatedWork Google Scholar 检索失败：${lastError instanceof Error ? lastError.message : '没有返回论文结果'}`)
  const shouldEnrich = config.fast !== true && config.enrich !== false
  if (shouldEnrich) {
    // 1. Scholar 的 BibTeX 是最可靠的标题/作者/venue 校正来源。没有
    // data-cid（某些镜像或简化 HTML）时自然跳过，不把失败当成致命错误。
    if (config.fetchBibtex !== false) {
      for (const paper of papers) {
        try {
          const bibtex = await retry(async () => {
            const value = await fetchScholarBibtexParallel(paper, options, fetchImpl)
            if (value === undefined) throw new Error('BibTeX 链接不可用')
            return value
          }, Math.min(Math.max(Math.floor(config.maxRetries ?? 3), 1), 6), Math.max(200, delay), options.signal)
          applyBibtex(paper, bibtex)
        } catch { /* Scholar 的 cite 页面经常单独触发限速，继续其他补全 */ }
      }
    }
    // 2. arXiv API 提供完整摘要/作者；HTML5 页面提供机构、通讯作者和邮箱。
    if (config.fetchArxiv !== false) for (const paper of papers) await enrichFromArxiv(paper, options, fetchImpl)
    if (config.fetchArxivHTML !== false) for (const paper of papers) await enrichFromArxivHTML(paper, options, fetchImpl)
    // 3. The standalone scholar_search.search() deliberately stops after
    // Scholar/BibTeX/arXiv/Semantic Scholar/AI fallback.  Crossref/OpenAlex/
    // DBLP/Unpaywall belong to app.py's /api/search compatibility facade and
    // must not silently change this entry point's request graph.
    if (config.fetchSemanticScholar !== false) for (const paper of papers) await enrichSemanticScholarPaper(paper, options, fetchImpl)
    if (config.deepseekEnrich !== false) for (const paper of papers) await enrichWithDeepSeekAuthorFallback(paper, options, fetchImpl)
  }
  if (config.includeAuthorProfiles === true && shouldEnrich) for (const paper of papers) await enrichAuthorProfiles(paper, options, fetchImpl)
  if (config.webFallback === true && shouldEnrich) {
    for (const paper of papers) {
      if (autoRelatedWorkCompleteness({ ...paper, authors: paper.authorsDetailed }) < 0.5) await enrichFromScholarWebFallback(paper, options, fetchImpl)
    }
  }
  // Fast mode in scholar_search.py returns the search-page records only; it
  // must not start the optional recursive reference graph either.  `enrich`
  // is separate from the recursive feature in the EvoResearch API, so an
  // explicit recursiveDepth still works when field enrichment is disabled.
  if (config.fast !== true) papers = await expandAcademicReferences(papers, options, fetchImpl)
  for (const paper of papers) finalizeAutoRelatedWorkPaper(paper, shouldEnrich)
  const result: AcademicSearchResult = { provider: 'AutoRelatedWork', query, sources: papers.map(autoRelatedWorkPaperToSource), ...(totalAvailable !== undefined ? { totalAvailable } : {}), elapsedMs: Date.now() - startedAt, ...(searchType !== 'general' ? { searchType } : {}) }
  if (paperCacheFile !== undefined) {
    const paperCache = new AutoRelatedWorkCacheStore(paperCacheFile)
    try {
      for (const source of result.sources) paperCache.putPaper(source as unknown as Record<string, unknown>)
    } finally {
      paperCache.close()
    }
  }
  cache?.put(key, result)
  return result
}
