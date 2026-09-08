import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'

export const OPENWEBSEARCH_DEFAULT_URL = 'http://127.0.0.1:3210'
const OPENWEBSEARCH_VERSION = '2.1.11'
const OPENWEBSEARCH_PACKAGE = 'open-websearch'
const MCP_SEARCH_TIMEOUT_MS = 30_000
/** 引擎可用性缓存有效期；过期后下次搜索/状态拉取时懒触发重探。 */
const ENGINE_PROBE_TTL_MS = 10 * 60_000
/** 引擎使用记录保留条数（持久化于 plugins/web-search-engine-usage.json）。 */
const ENGINE_USAGE_KEEP = 200

/** 读取引擎使用记录；损坏/缺失一律返回空数组（展示用途，不值得为它报错）。 */
function loadEngineUsage(file: string): ManagedSearchEngineUsage[] {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((u): u is ManagedSearchEngineUsage =>
      typeof u === 'object' && u !== null && typeof (u as ManagedSearchEngineUsage).query === 'string'
      && Array.isArray((u as ManagedSearchEngineUsage).engines) && typeof (u as ManagedSearchEngineUsage).at === 'number',
    ).slice(0, ENGINE_USAGE_KEEP)
  } catch {
    return []
  }
}

/** 引擎使用记录落盘（同步写：搜索低频，量小；失败静默——徽标属增强展示）。 */
function persistEngineUsage(file: string, list: ManagedSearchEngineUsage[]): void {
  try {
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, JSON.stringify(list, undefined, 2))
  } catch { /* 展示用途，写失败不影响搜索 */ }
}

export type ManagedSearchBackendId = 'openwebsearch' | 'google-ai-mode' | 'free-search'

/** open-websearch 内置的全部引擎 id（build/engines 目录，v2.1.11）。 */
export const OPENWEBSEARCH_ALL_ENGINES = [
  'baidu', 'bing', 'brave', 'csdn', 'duckduckgo', 'exa', 'github', 'juejin', 'linuxdo', 'sogou', 'startpage', 'web', 'zhihu',
] as const

/** 引擎可用性探测结果缓存。 */
export interface ManagedSearchEngineProbe {
  healthy: string[]
  dead: string[]
  probedAt: number
}

/** 一次搜索实际使用的引擎登记（供前端展示"本次用了哪些引擎"）。 */
export interface ManagedSearchEngineUsage {
  query: string
  engines: string[]
  at: number
}

export interface ManagedSearchBackendStatus {
  id: ManagedSearchBackendId
  managed: true
  installable: true
  installed: boolean
  running: boolean
  endpoint: string
  state: 'ready' | 'installing' | 'starting' | 'stopped' | 'error'
  message?: string
  /** 引擎可用性探测（服务运行中才有意义；未探测时缺省）。 */
  engines?: ManagedSearchEngineProbe
}

export interface ManagedSearchManager {
  status(): Promise<ManagedSearchBackendStatus>
  install(): Promise<void>
  start(): Promise<string | undefined>
  ensureRunning(): Promise<string | undefined>
  stop(): Promise<void>
  dispose(): Promise<void>
  search?(tool: string, args: Record<string, unknown>): Promise<unknown>
  /** 引擎可用性探测（仅多引擎托管后端实现；返回缓存/新探测结果）。 */
  probeEngines?(force?: boolean): Promise<ManagedSearchEngineProbe>
  /** 最近一次探测的可用引擎列表（未探测过返回 undefined）。 */
  healthyEngines?(): string[] | undefined
  /** 登记一次搜索实际使用的引擎。 */
  recordEngineUsage?(query: string, engines: string[]): void
  /** 最近的引擎使用记录（新→旧）。 */
  recentEngineUsage?(): ManagedSearchEngineUsage[]
}

function npmCommand(): string {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm'
}

function packageEntry(root?: string): string | undefined {
  try {
    const require = createRequire(import.meta.url)
    return require.resolve(`${OPENWEBSEARCH_PACKAGE}/build/index.js`, root === undefined ? undefined : { paths: [root] })
  } catch {
    return undefined
  }
}

function canUsePort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer()
    server.once('error', () => resolve(false))
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)))
  })
}

async function availablePort(preferred: number): Promise<number> {
  for (let port = preferred; port < preferred + 32; port += 1) {
    if (await canUsePort(port)) return port
  }
  throw new Error('没有找到可用的 Open-WebSearch 端口')
}

async function health(endpoint: string, timeoutMs = 900): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${endpoint.replace(/\/+$/, '')}/health`, { signal: controller.signal })
    return response.ok
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

function run(command: string, args: string[], cwd: string): Promise<void> {
  if (process.platform === 'win32') {
    return new Promise((resolve, reject) => {
      // Windows 的 npm.cmd 在 WSL 启动的 Node 环境中不能直接 execFile；
      // 与网页启动器保持一致，经 ComSpec 启动，兼容源码开发和桌面 sidecar。
      const child = spawn(process.env.ComSpec ?? 'C:\\Windows\\System32\\cmd.exe', ['/d', '/s', '/c', [command, ...args].join(' ')], {
        cwd,
        windowsHide: true,
        // 捕获 stderr：安装失败只报"退出码 1"毫无线索（ registry 不可达/版本不存在等全被吞）
        stdio: ['ignore', 'ignore', 'pipe'],
      })
      let stderrTail = ''
      child.stderr?.on('data', (chunk: unknown) => { stderrTail = (stderrTail + String(chunk)).slice(-600) })
      child.once('error', reject)
      child.once('exit', (code) => code === 0
        ? resolve()
        : reject(new Error(`${command} 退出码 ${String(code)}${stderrTail.trim() !== '' ? `：${stderrTail.trim()}` : ''}`)))
    })
  }
  return new Promise((resolve, reject) => {
    // POSIX：execFile 非 0 退出的 error.message 自带 stderr 尾部，无需另收
    execFile(command, args, { cwd, windowsHide: true }, (error) => error ? reject(error) : resolve())
  })
}

export class OpenWebSearchManager {
  private child: ChildProcess | undefined
  private endpoint = OPENWEBSEARCH_DEFAULT_URL
  private state: ManagedSearchBackendStatus['state'] = 'stopped'
  private message: string | undefined
  private operation: Promise<string> | undefined
  private readonly installRoot: string
  /** 引擎使用记录持久化文件（<dataRoot>/plugins/web-search-engine-usage.json）：内存缓冲会随进程重启丢失，历史会话的徽标依赖它。 */
  private readonly usageFile: string
  private engineProbe: ManagedSearchEngineProbe | undefined
  private engineProbeOp: Promise<ManagedSearchEngineProbe> | undefined

  constructor(dataRoot: string) {
    this.installRoot = join(dataRoot, 'web-search-backends', 'open-websearch')
    this.usageFile = join(dataRoot, 'plugins', 'web-search-engine-usage.json')
    this.recentUsage = loadEngineUsage(this.usageFile)
  }

  private entry(): string | undefined {
    return packageEntry() ?? packageEntry(this.installRoot)
  }

  private installed(): boolean {
    return this.entry() !== undefined
  }

  /** 最近一次引擎探测结果（未探测过返回 undefined）。 */
  healthyEngines(): string[] | undefined {
    return this.engineProbe === undefined ? undefined : this.engineProbe.healthy
  }

  private recentUsage: ManagedSearchEngineUsage[] = []

  recordEngineUsage(query: string, engines: string[]): void {
    this.recentUsage.unshift({ query, engines, at: Date.now() })
    if (this.recentUsage.length > ENGINE_USAGE_KEEP) this.recentUsage.length = ENGINE_USAGE_KEEP
    persistEngineUsage(this.usageFile, this.recentUsage)
  }

  recentEngineUsage(): ManagedSearchEngineUsage[] {
    return this.recentUsage
  }

  private async searchOnce(endpoint: string, engine: string, timeoutMs: number): Promise<boolean> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(`${endpoint.replace(/\/+$/, '')}/search`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: engine, limit: 1, engines: [engine] }),
        signal: controller.signal,
      })
      if (!response.ok) return false
      const body = await response.json() as { status?: string; data?: { results?: unknown[] } }
      if (body.status === 'error') return false
      return (body.data?.results?.length ?? 0) > 0
    } catch {
      return false
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * 引擎可用性探测：用引擎自身名字作查询（如 github 引擎查 "github"），
   * 返回 ≥1 条结果即记为可用。并发探测全部内置引擎；缓存 TTL 内直接复用。
   * 并发限 2 且失败重试一次：高并发探测会触发 sogou 等引擎的反爬限流，造成误判。
   */
  async probeEngines(force = false): Promise<ManagedSearchEngineProbe> {
    const live = this.child !== undefined && this.child.exitCode === null ? await health(this.endpoint) : await health(OPENWEBSEARCH_DEFAULT_URL)
    if (!live) return this.engineProbe ?? { healthy: [], dead: [], probedAt: 0 }
    if (!force && this.engineProbe !== undefined && Date.now() - this.engineProbe.probedAt < ENGINE_PROBE_TTL_MS) return this.engineProbe
    if (this.engineProbeOp !== undefined) return this.engineProbeOp
    this.engineProbeOp = (async () => {
      const healthy: string[] = []
      const dead: string[] = []
      const queue = [...OPENWEBSEARCH_ALL_ENGINES]
      const worker = async (): Promise<void> => {
        for (;;) {
          const engine = queue.shift()
          if (engine === undefined) return
          const first = await this.searchOnce(this.endpoint, engine, 15_000)
          if (first) { healthy.push(engine); continue }
          // 失败不立即判死：稍候重试一次，排除瞬时限流/抖动
          await new Promise((resolve) => setTimeout(resolve, 900))
          if (await this.searchOnce(this.endpoint, engine, 15_000)) healthy.push(engine)
          else dead.push(engine)
        }
      }
      await Promise.all([worker(), worker()])
      this.engineProbe = { healthy, dead, probedAt: Date.now() }
      return this.engineProbe
    })().finally(() => { this.engineProbeOp = undefined })
    return this.engineProbeOp
  }

  async status(): Promise<ManagedSearchBackendStatus> {
    const installed = this.installed()
    const live = this.child !== undefined && this.child.exitCode === null
      ? await health(this.endpoint)
      : await health(OPENWEBSEARCH_DEFAULT_URL)
    if (live && this.child === undefined) this.endpoint = OPENWEBSEARCH_DEFAULT_URL
    return {
      id: 'openwebsearch',
      managed: true,
      installable: true,
      installed,
      running: live,
      endpoint: this.endpoint,
      state: live ? 'ready' : this.state,
      ...(this.message !== undefined ? { message: this.message } : {}),
      ...(live && this.engineProbe !== undefined ? { engines: this.engineProbe } : {}),
    }
  }

  async install(): Promise<void> {
    if (this.installed()) return
    this.state = 'installing'
    this.message = undefined
    mkdirSync(this.installRoot, { recursive: true })
    // 关键：在本目录钉一个私有 package.json，把 npm 的项目根固定在 installRoot。
    // 否则 npm 沿目录树向上找 package.json，开发机会把包装进仓库根/.tmp-dev
    // （装完 packageEntry(installRoot) 仍找不到可执行文件，等于安装失败）。
    writeFileSync(join(this.installRoot, 'package.json'), JSON.stringify({
      name: 'evoresearch-open-websearch-host',
      version: '0.0.0',
      private: true,
    }), 'utf8')
    try {
      await run(npmCommand(), ['install', '--no-save', '--no-package-lock', `${OPENWEBSEARCH_PACKAGE}@${OPENWEBSEARCH_VERSION}`], this.installRoot)
      if (!this.installed()) throw new Error('Open-WebSearch 安装完成，但未找到可执行文件')
      this.state = 'stopped'
    } catch (error) {
      this.state = 'error'
      this.message = `自动安装 Open-WebSearch 失败：${error instanceof Error ? error.message : String(error)}`
      throw new Error(this.message)
    }
  }

  async start(): Promise<string> {
    if (this.operation !== undefined) return this.operation
    this.operation = this.startInternal().finally(() => { this.operation = undefined })
    return this.operation
  }

  private async startInternal(): Promise<string> {
    if (await health(this.endpoint)) {
      this.state = 'ready'
      return this.endpoint
    }
    await this.install()
    const entry = this.entry()
    if (entry === undefined) throw new Error('Open-WebSearch 未安装')
    const port = await availablePort(3210)
    this.endpoint = `http://127.0.0.1:${port}`
    this.state = 'starting'
    const child = spawn(process.execPath, [entry, 'serve', '--host', '127.0.0.1', '--port', String(port)], {
      cwd: this.installRoot,
      // 默认引擎与 requestJson 请求侧一致：sogou 对中文查询相关性最好，bing 兜底
      env: { ...process.env, OPEN_WEBSEARCH_DAEMON_PORT: String(port), MODE: 'http', SEARCH_ENGINES: 'sogou,bing' },
      stdio: 'ignore',
      windowsHide: true,
    })
    this.child = child
    child.once('exit', () => {
      if (this.child === child) {
        this.child = undefined
        this.state = 'stopped'
      }
    })
    const deadline = Date.now() + 30000
    while (Date.now() < deadline) {
      if (await health(this.endpoint)) {
        this.state = 'ready'
        // 服务就绪后后台探测引擎可用性（不阻塞搜索首次调用）
        void this.probeEngines(true).catch(() => { /* 探测失败保持缓存为空，搜索走默认引擎 */ })
        return this.endpoint
      }
      if (child.exitCode !== null) break
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    await this.stop()
    this.state = 'error'
    this.message = 'Open-WebSearch 启动超时；请检查本机 Node 运行时和网络访问'
    throw new Error(this.message)
  }

  async ensureRunning(): Promise<string> {
    return this.start()
  }

  async stop(): Promise<void> {
    const child = this.child
    this.child = undefined
    if (child === undefined || child.exitCode !== null) return
    if (process.platform === 'win32' && child.pid !== undefined) {
      await new Promise<void>((resolve) => execFile('taskkill', ['/pid', String(child.pid), '/t', '/f'], () => resolve()))
    } else {
      child.kill('SIGTERM')
    }
    this.state = 'stopped'
  }

  async dispose(): Promise<void> {
    await this.stop()
  }
}

interface ManagedMcpDefinition {
  id: Exclude<ManagedSearchBackendId, 'openwebsearch'>
  packageName: string
  version: string
  toolName: string
  installCommand: 'npm' | 'uvx'
  commandArgs: string[]
  entryPath?: string
  description: string
}

const MANAGED_MCP_DEFINITIONS: Record<Exclude<ManagedSearchBackendId, 'openwebsearch'>, ManagedMcpDefinition> = {
  'google-ai-mode': {
    id: 'google-ai-mode',
    packageName: 'google-ai-mode-mcp',
    version: '1.0.3',
    toolName: 'search_ai',
    installCommand: 'npm',
    commandArgs: [],
    entryPath: 'dist/index.js',
    description: 'Google AI Mode（本地浏览器 MCP；可能触发 Google CAPTCHA）',
  },
  'free-search': {
    id: 'free-search',
    packageName: 'free-search-mcp',
    version: '0.9.2',
    toolName: 'search',
    installCommand: 'uvx',
    commandArgs: ['--from', 'free-search-mcp==0.9.2', 'free-search-mcp'],
    description: 'Free Search MCP（本地 Python 多引擎；免 API Key，需 uv）',
  },
}

function commandAvailable(command: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(command, ['--version'], { windowsHide: true, stdio: 'ignore' })
    child.once('error', () => resolve(false))
    child.once('exit', (code) => resolve(code === 0))
  })
}

function uvxExecutable(): string {
  if (process.platform !== 'win32') return 'uvx'
  const userProfile = process.env.USERPROFILE
  const userLocal = userProfile === undefined ? undefined : join(userProfile, '.local', 'bin', 'uvx.exe')
  return userLocal !== undefined && existsSync(userLocal) ? userLocal : 'uvx.exe'
}

/**
 * 管理采用 stdio 传输的第三方 MCP 搜索服务。子进程只存在于当前 DSH
 * 实例生命周期内，依赖和浏览器配置全部放到 EvoResearch 数据根下。
 * MCP stdio transport 使用 JSONL；第三方服务的 stderr 永远不进入协议流。
 */
export class ManagedMcpSearchManager implements ManagedSearchManager {
  private child: ChildProcess | undefined
  private state: ManagedSearchBackendStatus['state'] = 'stopped'
  private message: string | undefined
  private operation: Promise<string | undefined> | undefined
  private buffer = ''
  private nextId = 1
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
  private readonly definition: ManagedMcpDefinition
  private readonly installRoot: string

  constructor(dataRoot: string, id: Exclude<ManagedSearchBackendId, 'openwebsearch'>) {
    this.definition = MANAGED_MCP_DEFINITIONS[id]
    this.installRoot = join(dataRoot, 'web-search-backends', id)
  }

  private npmEntry(): string | undefined {
    if (this.definition.installCommand !== 'npm' || this.definition.entryPath === undefined) return undefined
    try {
      const require = createRequire(import.meta.url)
      // Desktop sidecars bundle Node MCP dependencies in app/node_modules;
      // prefer that immutable copy before looking in the user data root.
      try { return require.resolve(`${this.definition.packageName}/${this.definition.entryPath}`) } catch { /* use managed install root */ }
      return require.resolve(`${this.definition.packageName}/${this.definition.entryPath}`, { paths: [this.installRoot] })
    } catch {
      return undefined
    }
  }

  private async installed(): Promise<boolean> {
    if (this.definition.installCommand === 'npm') return this.npmEntry() !== undefined
    return commandAvailable(uvxExecutable())
  }

  private resolvePending(error: Error): void {
    for (const entry of this.pending.values()) entry.reject(error)
    this.pending.clear()
  }

  private onStdout(chunk: Buffer): void {
    this.buffer += chunk.toString('utf8')
    let newline = this.buffer.indexOf('\n')
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).trim()
      this.buffer = this.buffer.slice(newline + 1)
      newline = this.buffer.indexOf('\n')
      if (line === '') continue
      let response: { id?: unknown; result?: unknown; error?: { message?: string } }
      try { response = JSON.parse(line) as typeof response } catch { continue }
      if (typeof response.id !== 'number') continue
      const pending = this.pending.get(response.id)
      if (pending === undefined) continue
      this.pending.delete(response.id)
      if (response.error !== undefined) pending.reject(new Error(response.error.message ?? 'MCP JSON-RPC error'))
      else pending.resolve(response.result)
    }
  }

  private request(method: string, params: Record<string, unknown> = {}, timeoutMs = 20000): Promise<unknown> {
    const child = this.child
    const stdin = child?.stdin
    if (stdin === undefined || stdin === null || stdin.destroyed) return Promise.reject(new Error(`${this.definition.packageName} 未运行`))
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${this.definition.packageName} MCP 请求超时`))
      }, timeoutMs)
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value) },
        reject: (error) => { clearTimeout(timer); reject(error) },
      })
      stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`, (error) => {
        if (error) {
          this.pending.delete(id)
          reject(error)
        }
      })
    })
  }

  async status(): Promise<ManagedSearchBackendStatus> {
    const installed = await this.installed()
    const running = this.child !== undefined && this.child.exitCode === null
    return {
      id: this.definition.id,
      managed: true,
      installable: true,
      installed,
      running,
      endpoint: '',
      state: running ? 'ready' : this.state,
      ...(this.message !== undefined ? { message: this.message } : {}),
    }
  }

  async install(): Promise<void> {
    if (await this.installed()) return
    this.state = 'installing'
    this.message = undefined
    mkdirSync(this.installRoot, { recursive: true })
    try {
      if (this.definition.installCommand === 'npm') {
        // npm otherwise walks up to the monorepo package.json when this is a
        // fresh directory and installs the backend in the wrong node_modules.
        const manifest = join(this.installRoot, 'package.json')
        if (!existsSync(manifest)) writeFileSync(manifest, JSON.stringify({ private: true, name: `evoresearch-${this.definition.id}` }) + '\n')
        await run(npmCommand(), ['install', '--no-save', '--no-package-lock', `${this.definition.packageName}@${this.definition.version}`], this.installRoot)
      } else if (!await commandAvailable(uvxExecutable())) {
        throw new Error('未找到 uvx；请先安装 uv，或选择 Open-WebSearch / API 搜索方式')
      }
      if (!await this.installed()) throw new Error(`${this.definition.packageName} 安装完成，但未找到可执行环境`)
      this.state = 'stopped'
    } catch (error) {
      this.state = 'error'
      this.message = `自动安装 ${this.definition.packageName} 失败：${error instanceof Error ? error.message : String(error)}`
      throw new Error(this.message)
    }
  }

  async start(): Promise<string | undefined> {
    if (this.operation !== undefined) return this.operation
    this.operation = this.startInternal().finally(() => { this.operation = undefined })
    return this.operation
  }

  private async startInternal(): Promise<string | undefined> {
    if (this.child !== undefined && this.child.exitCode === null) return undefined
    await this.install()
    mkdirSync(this.installRoot, { recursive: true })
    const entry = this.definition.installCommand === 'npm' ? this.npmEntry() : undefined
    if (this.definition.installCommand === 'npm' && entry === undefined) throw new Error(`${this.definition.packageName} 未安装`)
    const executable = entry === undefined
      ? uvxExecutable()
      : process.execPath
    // Windows cannot spawn a .js file as a native executable (EFTYPE). Use
    // the active Node binary explicitly for npm-installed MCP entrypoints.
    const args = entry === undefined ? this.definition.commandArgs.slice() : [entry]
    this.state = 'starting'
    const child = spawn(executable, args, {
      cwd: this.installRoot,
      env: {
        ...process.env,
        ...(this.definition.id === 'google-ai-mode' ? {
          GOOGLE_AI_HEADLESS: 'true',
          GOOGLE_AI_PROFILE_DIR: join(this.installRoot, 'browser-profile'),
          GOOGLE_AI_DATA_DIR: join(this.installRoot, 'runtime-data'),
        } : {}),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    this.child = child
    child.stdout?.on('data', (chunk: Buffer) => this.onStdout(chunk))
    child.stderr?.on('data', () => undefined)
    child.once('error', (error) => {
      this.resolvePending(error instanceof Error ? error : new Error(String(error)))
      if (this.child === child) this.child = undefined
      this.state = 'error'
    })
    child.once('exit', (code) => {
      this.resolvePending(new Error(`${this.definition.packageName} 已退出（${String(code ?? 'unknown')}）`))
      if (this.child === child) this.child = undefined
      this.state = code === 0 ? 'stopped' : 'error'
    })
    try {
      await this.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'evoresearch', version: '0.1.0' } })
      const stdin = this.child?.stdin
      if (stdin !== undefined && stdin !== null) stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
      const tools = await this.request('tools/list') as { tools?: unknown[] }
      if (!Array.isArray(tools?.tools) || !tools.tools.some((tool) => isToolNamed(tool, this.definition.toolName))) throw new Error(`MCP 未提供 ${this.definition.toolName} 工具`)
      this.state = 'ready'
      return undefined
    } catch (error) {
      await this.stop()
      this.state = 'error'
      this.message = `${this.definition.packageName} 启动失败：${error instanceof Error ? error.message : String(error)}`
      throw new Error(this.message)
    }
  }

  async ensureRunning(): Promise<string | undefined> { return this.start() }

  async search(tool: string, args: Record<string, unknown>): Promise<unknown> {
    await this.ensureRunning()
    const result = await this.request('tools/call', { name: tool, arguments: args }, MCP_SEARCH_TIMEOUT_MS) as { isError?: boolean; content?: unknown[]; structuredContent?: unknown }
    if (result?.isError === true) throw new Error(`${this.definition.packageName} 搜索失败`)
    return result
  }

  async stop(): Promise<void> {
    const child = this.child
    this.child = undefined
    if (child === undefined || child.exitCode !== null) return
    this.resolvePending(new Error(`${this.definition.packageName} 已停止`))
    if (process.platform === 'win32' && child.pid !== undefined) await new Promise<void>((resolve) => execFile('taskkill', ['/pid', String(child.pid), '/t', '/f'], () => resolve()))
    else child.kill('SIGTERM')
    this.state = 'stopped'
  }

  async dispose(): Promise<void> { await this.stop() }
}

function isToolNamed(value: unknown, name: string): boolean {
  return typeof value === 'object' && value !== null && 'name' in value && (value as { name?: unknown }).name === name
}
