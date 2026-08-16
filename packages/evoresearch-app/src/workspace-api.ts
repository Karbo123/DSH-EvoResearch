/**
 * 工作区文件 API（HTTP 路由，/evoresearch/fs/*）。
 *
 * 与官方 Remote 通道（$mount）解耦：参照 dsh-better-sidebar 的模式，
 * 经 ctx.webServer.register 提供 JSON API 与媒体路由，浏览器 fetch 调用。
 * 所有操作带信任栅栏（回环 + webRuntime.trustedHosts），写操作限制在
 * 请求声明的根目录内（isWithin 校验）。
 */
import { opendir, readFile, rm, stat, writeFile, mkdir } from 'node:fs/promises'
import { zstdDecompressSync } from 'node:zlib'
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path'
import { homedir } from 'node:os'
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

/** target 是否位于 base 下（含相等；容忍分隔符与 Windows 大小写）。 */
function isWithin(target: string, base: string): boolean {
  const t = target.toLowerCase().replace(/\//g, '\\')
  const b = base.toLowerCase().replace(/\//g, '\\')
  return t === b || t.startsWith(b.endsWith('\\') ? b : `${b}\\`)
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

/** 注册 /evoresearch/fs/* 路由。 */
export function registerWorkspaceApi(ctx: any): void {
  const webServer = ctx.get('webServer')
  if (webServer === undefined) return

  ctx.effect(() => webServer.register({
    kind: 'prefix',
    path: '/evoresearch/fs',
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      const trustedHosts: string[] = ctx.get('webRuntime')?.trustedHosts ?? []
      if (!trusted(req, trustedHosts)) {
        writeJson(res, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } })
        return
      }
      const url = new URL(req.url ?? '/', 'http://dsh.internal')
      const pathname = url.pathname
      const method = pathname.startsWith('/evoresearch/fs/') ? pathname.slice('/evoresearch/fs/'.length) : undefined

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
            })
          }
          writeOk(res, { plugins: entries })
          return
        }

        // POST /evoresearch/models → 当前默认模型；/models/select → 保存默认模型
        if (method === 'models') {
          const agentDefaultModel = ctx.get('agentDefaultModel')
          writeOk(res, agentDefaultModel?.currentSelection?.() ?? { provider: null, model: null })
          return
        }
        if (method === 'models/select') {
          const agentDefaultModel = ctx.get('agentDefaultModel')
          if (agentDefaultModel?.saveSelection === undefined) throw httpError(400, 'method-error', 'agentDefaultModel 不可用')
          await agentDefaultModel.saveSelection({
            provider: requireString(payload, 'provider'),
            model: requireString(payload, 'model'),
          })
          writeOk(res, { saved: true })
          return
        }

        // POST /evoresearch/models-catalog → 模型目录（§25.2 模型选择器：
        // llm.listProviders() + 各 adapter listModels()）
        if (method === 'models-catalog') {
          const llm = ctx.get('llm')
          if (llm?.listProviders === undefined) throw httpError(400, 'method-error', 'llm 服务不可用')
          const providers = llm.listProviders()
          const groups: unknown[] = []
          for (const provider of providers) {
            let models: unknown[] = []
            try {
              const listed = await llm.listModels(provider.id)
              models = (listed ?? []).map((m: { id?: string; name?: string; contextWindow?: number }) => ({
                id: m.id ?? '',
                name: m.name ?? m.id ?? '',
                contextWindow: m.contextWindow ?? null,
              }))
            } catch { /* 该 provider 无目录 */ }
            if (models.length > 0) {
              groups.push({ provider: { id: provider.id, name: provider.name ?? provider.id }, models })
            }
          }
          writeOk(res, { groups })
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

        // ── 业务面板数据（直连插件 EvoResearchApiService，绕开 Remote $mount）──
        const evoresearch = ctx.get('evoresearch') as Record<string, (args?: unknown) => unknown> | undefined
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
        // 模型设置（设置面板）：读 / 写 / 应用代码档为默认模型
        if (method === 'model-settings-get') {
          if (evoresearch?.modelSettingsGet === undefined) throw httpError(400, 'method-error', 'evoresearch 服务不可用')
          writeOk(res, await (evoresearch.modelSettingsGet as () => Promise<unknown>)())
          return
        }
        if (method === 'model-settings-set') {
          if (evoresearch?.modelSettingsSet === undefined) throw httpError(400, 'method-error', 'evoresearch 服务不可用')
          const patch = typeof payload.patch === 'object' && payload.patch !== null ? payload.patch : {}
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
          if (tier !== 'simple' && tier !== 'medium' && tier !== 'complex') throw httpError(400, 'bad-tier', 'tier 必须是 simple/medium/complex')
          try {
            const result = await (evoresearch.modelSettingsApply as (a: { tier: string }) => Promise<unknown>).call(evoresearch, { tier })
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
        if (method === 'projects-import') {
          if (evoresearch?.projectImport === undefined) throw httpError(400, 'method-error', 'evoresearch 服务不可用')
          const sourcePath = requireString(payload, 'sourcePath')
          const name = typeof payload.name === 'string' && payload.name !== '' ? payload.name : undefined
          writeOk(res, await (evoresearch.projectImport as (a: { sourcePath: string; name?: string }) => Promise<unknown>)({ sourcePath, ...(name === undefined ? {} : { name }) }))
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
          const signal = new AbortController().signal
          const result = await commands.execute(agent, line, signal)
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
          if (skills?.list === undefined) throw httpError(400, 'method-error', 'skills 服务不可用')
          const list = await skills.list({})
          writeOk(res, { skills: Array.isArray(list) ? list : [] })
          return
        }

        // ── 会话信息（§26.8 Current 弹窗）：持久化文件路径/大小/事件数 ──
        if (method === 'session-info') {
          const sessionId = requireString(payload, 'sessionId')
          const sessionsRoot = join(process.env.DSH_HOME ?? join(os.homedir(), '.dsh'), 'sessions')
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
          const sessionsRoot = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'sessions')
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

        // ── 项目环境（§环境管理：env-status/env-create/env-install/env-remove）──
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
