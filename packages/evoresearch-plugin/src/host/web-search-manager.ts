import { createRequire } from 'node:module'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'

export const OPENWEBSEARCH_DEFAULT_URL = 'http://127.0.0.1:3210'
const OPENWEBSEARCH_VERSION = '2.1.11'
const OPENWEBSEARCH_PACKAGE = 'open-websearch'
const MCP_SEARCH_TIMEOUT_MS = 30_000

export type ManagedSearchBackendId = 'openwebsearch' | 'google-ai-mode' | 'free-search'

export interface ManagedSearchBackendStatus {
  id: ManagedSearchBackendId
  managed: true
  installable: true
  installed: boolean
  running: boolean
  endpoint: string
  state: 'ready' | 'installing' | 'starting' | 'stopped' | 'error'
  message?: string
}

export interface ManagedSearchManager {
  status(): Promise<ManagedSearchBackendStatus>
  install(): Promise<void>
  start(): Promise<string | undefined>
  ensureRunning(): Promise<string | undefined>
  stop(): Promise<void>
  dispose(): Promise<void>
  search?(tool: string, args: Record<string, unknown>): Promise<unknown>
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
        stdio: 'ignore',
      })
      child.once('error', reject)
      child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} 退出码 ${String(code)}`)))
    })
  }
  return new Promise((resolve, reject) => {
    const child = execFile(command, args, { cwd, windowsHide: true }, (error) => error ? reject(error) : resolve())
    child.stderr?.on('data', () => undefined)
  })
}

export class OpenWebSearchManager {
  private child: ChildProcess | undefined
  private endpoint = OPENWEBSEARCH_DEFAULT_URL
  private state: ManagedSearchBackendStatus['state'] = 'stopped'
  private message: string | undefined
  private operation: Promise<string> | undefined
  private readonly installRoot: string

  constructor(dataRoot: string) {
    this.installRoot = join(dataRoot, 'web-search-backends', 'open-websearch')
  }

  private entry(): string | undefined {
    return packageEntry() ?? packageEntry(this.installRoot)
  }

  private installed(): boolean {
    return this.entry() !== undefined
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
    }
  }

  async install(): Promise<void> {
    if (this.installed()) return
    this.state = 'installing'
    this.message = undefined
    mkdirSync(this.installRoot, { recursive: true })
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
      env: { ...process.env, OPEN_WEBSEARCH_DAEMON_PORT: String(port), MODE: 'http' },
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
