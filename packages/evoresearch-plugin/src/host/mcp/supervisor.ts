/**
 * MCP supervisor（PLAT-11/12）。
 *
 * PLAT-11：stdio / HTTP / Streamable HTTP 三种传输的服务器生命周期——
 * 启动（connect 握手 + tools/list）、停止、自动重连（指数退避 + 次数上限）、
 * 释放；每个服务器注册返回 disposer，disposeAll() 插件卸载全部释放。
 * Windows 注意：stdio 传输 spawn 时 windowsHide: true；测试一律注入假 client
 * factory（不依赖真实进程/网络）。
 *
 * PLAT-12：工具通配符过滤（allow/deny，支持 * 前缀/后缀/包含）、按 Agent
 * 暴露范围（exposeTo 空 = 全部）、配置热更新（updateConfig：configVersion+1
 * 并重连重载工具）；服务器失败只禁用该服务器的工具（局部降级），普通聊天
 * 与原文检索不受影响。
 *
 * PLAT-21：MCP 部分——断线重连/无法重连局部降级、插件卸载无副作用。
 */
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'

/* ------------------------------------------------------------------ */
/* 配置与状态                                                            */
/* ------------------------------------------------------------------ */

/** MCP 传输类型（PLAT-11）。 */
export type McpTransport = 'stdio' | 'http' | 'streamable-http'

/** 服务器状态。 */
export type McpServerState = 'stopped' | 'starting' | 'running' | 'stopping' | 'failed' | 'reconnecting'

/** 工具通配符过滤（PLAT-12：allow 空 = 全允许；deny 优先）。 */
export interface McpToolFilter {
  readonly allow?: readonly string[]
  readonly deny?: readonly string[]
}

/** MCP 服务器配置。 */
export interface McpServerConfig {
  readonly serverId: string
  readonly name: string
  readonly transport: McpTransport
  /** stdio：启动命令与参数。 */
  readonly command?: string
  readonly args?: readonly string[]
  readonly env?: Readonly<Record<string, string>>
  /** http / streamable-http：端点 URL。 */
  readonly url?: string
  /** 自动重连（默认 true）。 */
  readonly autoReconnect?: boolean
  /** 最大重连次数（默认 3；超限进入 failed = 局部降级）。 */
  readonly maxReconnectAttempts?: number
  /** 工具通配符过滤（PLAT-12）。 */
  readonly toolFilter?: McpToolFilter
  /** 按 Agent 暴露范围（PLAT-12：空 = 全部 Agent）。 */
  readonly exposeTo?: readonly string[]
}

/** 工具信息（tools/list 结果的最小形态）。 */
export interface McpToolInfo {
  readonly name: string
  readonly description?: string
  readonly inputSchema?: unknown
}

/** 服务器状态视图（纯 JSON）。 */
export interface McpServerStatus {
  readonly serverId: string
  readonly name: string
  readonly transport: McpTransport
  readonly state: McpServerState
  /** 过滤后可见工具（按配置 toolFilter；未连接时为空）。 */
  readonly tools: readonly McpToolInfo[]
  readonly error?: string
  readonly lastConnectedAt?: number
  readonly reconnectAttempts: number
  /** 配置版本（热更新递增，PLAT-12）。 */
  readonly configVersion: number
}

/* ------------------------------------------------------------------ */
/* 纯函数：通配符匹配与工具过滤（PLAT-12，可测）                          */
/* ------------------------------------------------------------------ */

/**
 * 通配符匹配：`name` 精确、`prefix*` 前缀、`*suffix` 后缀、`*mid*` 包含；
 * 无 * 时精确相等。
 */
export function matchWildcard(name: string, pattern: string): boolean {
  if (!pattern.includes('*')) return name === pattern
  const escaped = pattern
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')
  return new RegExp(`^${escaped}$`).test(name)
}

/** 工具名是否通过过滤（deny 优先于 allow；allow 空 = 全允许）。 */
export function matchesToolFilter(name: string, filter: McpToolFilter | undefined): boolean {
  if (!filter) return true
  if (filter.deny?.some((pattern) => matchWildcard(name, pattern))) return false
  if (filter.allow && filter.allow.length > 0) {
    return filter.allow.some((pattern) => matchWildcard(name, pattern))
  }
  return true
}

/** 按 Agent 暴露范围过滤（exposeTo 空 = 全部；PLAT-12）。 */
export function toolExposedToAgent(config: McpServerConfig, agentId: string | undefined): boolean {
  if (agentId === undefined) return true
  const exposeTo = config.exposeTo
  if (!exposeTo || exposeTo.length === 0) return true
  return exposeTo.includes(agentId)
}

/** 对工具列表应用通配符过滤（PLAT-12）。 */
export function filterTools(tools: readonly McpToolInfo[], filter: McpToolFilter | undefined): McpToolInfo[] {
  return tools.filter((tool) => matchesToolFilter(tool.name, filter))
}

/* ------------------------------------------------------------------ */
/* MCP client（传输实现；可注入 factory 便于测试）                        */
/* ------------------------------------------------------------------ */

/** MCP 客户端最小契约（连接返回工具列表；断开释放）。 */
export interface McpClientLike {
  connect(): Promise<{ tools: readonly McpToolInfo[] }>
  disconnect(): void
}

/** 客户端工厂（默认实现见 stdioClient/httpClient；测试注入假实现）。 */
export type McpClientFactory = (config: McpServerConfig) => McpClientLike

/** 最小 JSON-RPC 请求。 */
interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: number
  method: string
  params?: unknown
}

interface JsonRpcResponse {
  jsonrpc?: '2.0'
  id?: unknown
  result?: unknown
  error?: { code?: unknown; message?: string }
}

/** 从 JSON-RPC result 提取工具列表（tools/list 的 result.tools[]）。 */
function toolsFromResult(result: unknown): McpToolInfo[] {
  const r = result as { tools?: readonly unknown[] } | undefined
  if (!r || !Array.isArray(r.tools)) return []
  const tools: McpToolInfo[] = []
  for (const tool of r.tools) {
    const t = tool as { name?: unknown; description?: unknown; inputSchema?: unknown }
    if (typeof t?.name !== 'string') continue
    tools.push({
      name: t.name,
      description: typeof t.description === 'string' ? t.description : undefined,
      inputSchema: t.inputSchema,
    })
  }
  return tools
}

/** 解析一行 JSON-RPC 响应。 */
function parseRpcLine(line: string): JsonRpcResponse | undefined {
  try {
    return JSON.parse(line) as JsonRpcResponse
  } catch {
    return undefined
  }
}

/** stdio 传输：spawn 命令，经 stdin/stdout 走 JSON-RPC（initialize → tools/list）。 */
export function stdioClient(config: McpServerConfig): McpClientLike {
  let child: ChildProcess | null = null
  const connect = (): Promise<{ tools: readonly McpToolInfo[] }> =>
    new Promise((resolve, reject) => {
      if (!config.command) {
        reject(new Error(`stdio 服务器缺少 command: ${config.serverId}`))
        return
      }
      let settled = false
      let buffer = ''
      let nextId = 1
      const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
      const send = (method: string, params?: unknown): Promise<unknown> =>
        new Promise((resolveId, rejectId) => {
          const id = nextId
          nextId += 1
          pending.set(id, {
            resolve: (value) => resolveId(value),
            reject: (error) => rejectId(error),
          })
          child?.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params } as JsonRpcRequest)}\n`)
        })
      child = spawn(config.command, [...(config.args ?? [])], {
        env: { ...process.env, ...config.env },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      })
      child.on('error', (error) => {
        if (!settled) {
          settled = true
          reject(error)
        }
      })
      child.stderr?.on('data', () => { /* 诊断可接；不阻塞协议 */ })
      child.stdout?.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf8')
        let newlineIndex: number
        while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newlineIndex)
          buffer = buffer.slice(newlineIndex + 1)
          const response = parseRpcLine(line)
          if (!response) continue
          if (typeof response.id === 'number' && pending.has(response.id)) {
            const entry = pending.get(response.id)!
            pending.delete(response.id)
            if (response.error) {
              entry.reject(new Error(String(response.error.message ?? 'JSON-RPC 错误')))
            } else {
              entry.resolve(response.result)
            }
          }
        }
      })
      void (async () => {
        try {
          const init = await send('initialize', {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'evoresearch', version: '0.1.0' },
          })
          void init
          // notifications/initialized 无 id（fire-and-forget）
          child?.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`)
          const list = await send('tools/list', {})
          if (!settled) {
            settled = true
            resolve({ tools: toolsFromResult(list) })
          }
        } catch (error) {
          if (!settled) {
            settled = true
            reject(error instanceof Error ? error : new Error(String(error)))
          }
        }
      })()
    })
  return {
    connect,
    disconnect() {
      try {
        child?.kill()
      } catch {
        // 已退出
      }
      child = null
    },
  }
}

/** HTTP / Streamable HTTP 传输：POST JSON-RPC 到端点（一次性 tools/list）。 */
export function httpClient(config: McpServerConfig, fetchFn: typeof fetch = fetch): McpClientLike {
  let aborted = false
  const connect = async (): Promise<{ tools: readonly McpToolInfo[] }> => {
    if (!config.url) throw new Error(`http 服务器缺少 url: ${config.serverId}`)
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'evoresearch', version: '0.1.0' },
      },
    }
    const response = await fetchFn(config.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify(request),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${config.url}`)
    const text = await response.text()
    // Streamable HTTP 可能返回 SSE 帧；逐行找 JSON。
    const line = text.split(/\r?\n/).map((l) => l.replace(/^data:\s*/, '').trim()).find((l) => l.startsWith('{'))
    if (!line) throw new Error(`无法解析 MCP 响应: ${config.url}`)
    const parsed = parseRpcLine(line)
    if (parsed?.error) throw new Error(String(parsed.error.message ?? 'JSON-RPC 错误'))
    // initialize 后拉 tools/list
    const listRequest: JsonRpcRequest = { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }
    const listResponse = await fetchFn(config.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify(listRequest),
    })
    const listText = await listResponse.text()
    const listLine = listText.split(/\r?\n/).map((l) => l.replace(/^data:\s*/, '').trim()).find((l) => l.startsWith('{'))
    const listParsed = listLine ? parseRpcLine(listLine) : undefined
    if (listParsed?.error) throw new Error(String(listParsed.error.message ?? 'JSON-RPC 错误'))
    return { tools: toolsFromResult(listParsed?.result) }
  }
  return {
    connect: async () => {
      if (aborted) throw new Error('连接已释放')
      return connect()
    },
    disconnect() {
      aborted = true
    },
  }
}

/** 默认客户端工厂（stdio / http / streamable-http 同 http 实现）。 */
export function defaultMcpClientFactory(config: McpServerConfig): McpClientLike {
  if (config.transport === 'stdio') return stdioClient(config)
  return httpClient(config)
}

/* ------------------------------------------------------------------ */
/* Supervisor                                                           */
/* ------------------------------------------------------------------ */

export interface McpSupervisorOptions {
  /** 客户端工厂（测试注入假实现；缺省 defaultMcpClientFactory）。 */
  readonly clientFactory?: McpClientFactory
  readonly now?: () => number
  /** 重连退避等待（测试注入立即 resolve）。 */
  readonly delay?: (ms: number) => Promise<void>
  /** 配置持久化根目录；未提供时仅进程内运行（便于纯函数测试）。 */
  readonly dataRoot?: string
}

/** 重连退避（毫秒）：1s, 2s, 4s, ... 上限 30s。 */
export function reconnectBackoffMs(attempt: number): number {
  return Math.min(1000 * 2 ** Math.max(0, attempt - 1), 30000)
}

/** MCP supervisor（PLAT-11/12）。 */
export class McpSupervisor {
  private readonly clientFactory: McpClientFactory
  private readonly now: () => number
  private readonly delay: (ms: number) => Promise<void>
  private readonly configFile: string | undefined
  private readonly restored: Array<{ config: McpServerConfig; desiredState: 'running' | 'stopped' }> = []
  private readonly servers = new Map<string, {
    config: McpServerConfig
    status: McpServerStatus
    client: McpClientLike
    disposed: boolean
    reconnectTimer: ReturnType<typeof setTimeout> | null
    desiredState: 'running' | 'stopped'
  }>()

  constructor(options: McpSupervisorOptions = {}) {
    this.clientFactory = options.clientFactory ?? defaultMcpClientFactory
    this.now = options.now ?? Date.now
    this.delay = options.delay ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
    this.configFile = options.dataRoot === undefined
      ? undefined
      : path.join(options.dataRoot, 'plugins', 'mcp-servers.json')
    this.loadPersisted()
  }

  private loadPersisted(): void {
    if (this.configFile === undefined) return
    try {
      const raw = JSON.parse(fs.readFileSync(this.configFile, 'utf8')) as { servers?: unknown }
      if (!Array.isArray(raw.servers)) return
      for (const item of raw.servers) {
        const value = item as { config?: unknown; desiredState?: unknown }
        const config = value.config as McpServerConfig | undefined
        if (config === undefined || typeof config.serverId !== 'string' || typeof config.name !== 'string') continue
        if (config.transport !== 'stdio' && config.transport !== 'http' && config.transport !== 'streamable-http') continue
        this.restored.push({ config, desiredState: value.desiredState === 'stopped' ? 'stopped' : 'running' })
      }
    } catch {
      // 损坏的 MCP 配置只影响 MCP；普通聊天、记忆与原文资料继续可用。
    }
  }

  private savePersisted(): void {
    if (this.configFile === undefined) return
    try {
      fs.mkdirSync(path.dirname(this.configFile), { recursive: true })
      const servers = [...this.servers.values()].map((record) => ({ config: record.config, desiredState: record.desiredState }))
      const tmp = `${this.configFile}.tmp-${process.pid}`
      fs.writeFileSync(tmp, JSON.stringify({ version: 1, servers }, null, 2), 'utf8')
      fs.renameSync(tmp, this.configFile)
    } catch {
      // 配置落盘失败不能破坏已经运行的连接；下次仍可通过 API 重新添加。
    }
  }

  private makeRecord(config: McpServerConfig, desiredState: 'running' | 'stopped' = 'running') {
    return {
      config,
      status: {
        serverId: config.serverId,
        name: config.name,
        transport: config.transport,
        state: 'stopped' as McpServerState,
        tools: [],
        reconnectAttempts: 0,
        configVersion: 1,
      },
      client: this.clientFactory(config),
      disposed: desiredState === 'stopped',
      reconnectTimer: null,
      desiredState,
    }
  }

  /** 应用启动时恢复保存的配置；只恢复上次期望处于 running 的连接。 */
  async restore(): Promise<readonly McpServerStatus[]> {
    const pending = this.restored.splice(0)
    const statuses: McpServerStatus[] = []
    for (const item of pending) {
      if (this.servers.has(item.config.serverId)) continue
      const record = this.makeRecord(item.config, item.desiredState)
      this.servers.set(item.config.serverId, record)
      if (item.desiredState === 'running') statuses.push(await this.start(item.config.serverId))
      else statuses.push(record.status)
    }
    return statuses
  }

  /** 注册服务器（自动启动；返回状态与 disposer）。 */
  addServer(config: McpServerConfig): { status: McpServerStatus; dispose: () => void } {
    if (this.servers.has(config.serverId)) {
      const existing = this.servers.get(config.serverId)!
      return { status: existing.status, dispose: () => { void this.removeServer(config.serverId) } }
    }
    const record = this.makeRecord(config, 'running')
    record.disposed = false
    this.servers.set(config.serverId, record)
    this.savePersisted()
    void this.start(config.serverId)
    return { status: record.status, dispose: () => { void this.removeServer(config.serverId) } }
  }

  /** 启动/重连（含退避重试；失败超限 → failed 局部降级）。 */
  async start(serverId: string): Promise<McpServerStatus> {
    const record = this.servers.get(serverId)
    if (!record) throw new Error(`MCP 服务器不存在: ${serverId}`)
    if (record.disposed) return record.status
    record.desiredState = 'running'
    record.status = { ...record.status, state: 'starting', error: undefined }
    for (let attempt = 1; ; attempt += 1) {
      if (record.disposed) break
      try {
        const { tools } = await record.client.connect()
        if (record.disposed) break
        record.status = {
          ...record.status,
          state: 'running',
          tools: filterTools(tools, record.config.toolFilter),
          error: undefined,
          lastConnectedAt: this.now(),
          reconnectAttempts: attempt - 1,
        }
        return record.status
      } catch (error) {
        if (record.disposed) break
        const message = error instanceof Error ? error.message : String(error)
        const maxAttempts = record.config.maxReconnectAttempts ?? 3
        if (record.config.autoReconnect !== false && attempt <= maxAttempts) {
          record.status = {
            ...record.status,
            state: 'reconnecting',
            error: message,
            reconnectAttempts: attempt,
          }
          await this.delay(reconnectBackoffMs(attempt))
          continue
        }
        record.status = {
          ...record.status,
          state: 'failed',
          error: message,
          reconnectAttempts: attempt - 1,
          tools: [], // 局部降级：该服务器工具不可见，其他服务器与聊天不受影响
        }
        return record.status
      }
    }
    return record.status
  }

  /** 停止（断开连接；状态 stopped；不清除配置）。 */
  async stop(serverId: string): Promise<McpServerStatus> {
    const record = this.servers.get(serverId)
    if (!record) throw new Error(`MCP 服务器不存在: ${serverId}`)
    record.disposed = true
    record.desiredState = 'stopped'
    if (record.reconnectTimer) {
      clearTimeout(record.reconnectTimer)
      record.reconnectTimer = null
    }
    try {
      record.client.disconnect()
    } catch {
      // 释放失败不阻断
    }
    record.status = { ...record.status, state: 'stopped', tools: [], error: undefined }
    this.savePersisted()
    return record.status
  }

  /** 从 stopped 状态重新启动（重建 client，避免复用已释放的传输）。 */
  async startServer(serverId: string): Promise<McpServerStatus> {
    const record = this.servers.get(serverId)
    if (!record) throw new Error(`MCP 服务器不存在: ${serverId}`)
    if (record.disposed) {
      try { record.client.disconnect() } catch { /* 已释放 */ }
      record.client = this.clientFactory(record.config)
      record.disposed = false
    }
    record.desiredState = 'running'
    this.savePersisted()
    return this.start(serverId)
  }

  /** 重启（stop + start，复用同一 client？重连需要新 client——stop 置 disposed 后新 start 用旧 client 可能已断开。重建 client）。 */
  async restart(serverId: string): Promise<McpServerStatus> {
    const record = this.servers.get(serverId)
    if (!record) throw new Error(`MCP 服务器不存在: ${serverId}`)
    record.disposed = true
    record.desiredState = 'running'
    try {
      record.client.disconnect()
    } catch {
      // ignore
    }
    record.client = this.clientFactory(record.config)
    record.disposed = false
    record.status = { ...record.status, state: 'stopped', tools: [], error: undefined }
    return this.startServer(serverId)
  }

  /** 移除（停止 + 释放 + 删除记录）。 */
  async removeServer(serverId: string): Promise<boolean> {
    const record = this.servers.get(serverId)
    if (!record) return false
    record.disposed = true
    if (record.reconnectTimer) {
      clearTimeout(record.reconnectTimer)
      record.reconnectTimer = null
    }
    try {
      record.client.disconnect()
    } catch {
      // ignore
    }
    this.servers.delete(serverId)
    this.savePersisted()
    return true
  }

  /** 配置热更新（PLAT-12：合并配置、configVersion+1、重建 client 并重连）。 */
  async updateConfig(serverId: string, patch: Partial<Omit<McpServerConfig, 'serverId'>>): Promise<McpServerStatus> {
    const record = this.servers.get(serverId)
    if (!record) throw new Error(`MCP 服务器不存在: ${serverId}`)
    record.disposed = true
    try {
      record.client.disconnect()
    } catch {
      // ignore
    }
    record.config = { ...record.config, ...patch }
    record.status = { ...record.status, configVersion: record.status.configVersion + 1, tools: [], state: 'stopped' }
    record.client = this.clientFactory(record.config)
    record.disposed = false
    record.desiredState = 'running'
    this.savePersisted()
    return this.start(serverId)
  }

  /** 状态列表。 */
  list(): McpServerStatus[] {
    return [...this.servers.values()].map((record) => record.status)
  }

  get(serverId: string): McpServerStatus | undefined {
    return this.servers.get(serverId)?.status
  }

  /** 某 Agent 可见的工具（PLAT-12：exposeTo + 通配符过滤；仅 running）。 */
  toolsFor(agentId?: string): McpToolInfo[] {
    const tools: McpToolInfo[] = []
    for (const record of this.servers.values()) {
      if (record.status.state !== 'running') continue
      if (!toolExposedToAgent(record.config, agentId)) continue
      tools.push(...record.status.tools)
    }
    return tools
  }

  /** 插件卸载：全部停止并释放（PLAT-21 无副作用；幂等）。 */
  disposeAll(): void {
    for (const record of this.servers.values()) {
      record.disposed = true
      if (record.reconnectTimer) {
        clearTimeout(record.reconnectTimer)
        record.reconnectTimer = null
      }
      try {
        record.client.disconnect()
      } catch {
        // ignore
      }
      record.status = { ...record.status, state: 'stopped', tools: [], error: undefined }
    }
    this.servers.clear()
  }
}
