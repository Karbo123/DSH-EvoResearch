/**
 * 项目环境服务（§环境管理 + §7.5 共享环境池；§15.8 ENV-03..07）。
 *
 * 两类环境并存：
 * - 项目私有 legacy 环境：<projectDir>/.venv（uv 默认目标，随项目迁移，git 忽略；
 *   ENV-06：保留为兼容环境，未经用户确认不删除——删除只经显式 remove()）。
 * - 共享环境池（§7.5）：<dataRoot>/.evoresearch-data/envs/<指纹>/——
 *   指纹 = 操作系统(platform+arch) + Python 版本 + 依赖文件内容哈希
 *   （uv.lock / requirements.txt / pyproject.toml，缺文件以空串参与）。
 *   相同依赖的多个 worktree 复用同一个池环境；依赖变化 → 新指纹 → 新环境，
 *   旧实验通过运行账本（experiment-process 的 .evoresearch-run.json 中记录的
 *   pythonPath 绝对路径）仍能找到原解释器（ENV-05）。
 * - ENV-07：临时装包不得静默污染共享池——createDerivedEnv() 创建私有派生环境
 *   （目标目录内新建 venv；可选从池环境「列出→重装」克隆已装包）。
 *
 * 既有约定（legacy，保持不动）：
 * - 配置记录：<projectDir>/.evoresearch-data/env.json（pythonVersion/createdAt）
 * - UV 解析：EVORESEARCH_UV 环境变量 → <dataRoot>/.tools/bin/uv.exe（部署目录内安装，
 *   随程序迁移，不写用户目录）→ ~/.local/bin 等既有安装 → PATH 上的 uv
 * - 版本指定：uv venv --python <version> --python-preference managed（uv 自动下载
 *   官方 CPython，默认 3.12）
 *
 * 自动切换（两通道，均按"每次执行的 agent 会话 cwd"解析）：
 * 1. shellEnv 注册 DSH_VENV / DSH_VENV_PYTHON / DSH_VENV_SCRIPTS / DSH_UV——
 *    每次 bash/pwsh 工具执行都注入当前项目环境的真实路径；
 * 2. systemPrompt.context 按会话注入 <project_env> 指引——模型知道该用哪个解释器。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { homedir } from 'node:os'
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'

/** 项目环境状态（wire JSON）。 */
export interface ProjectEnvInfo {
  readonly projectDir: string
  readonly uv: string | null
  readonly envDir: string
  readonly pythonPath: string
  readonly exists: boolean
  readonly pythonVersion: string
  readonly packages: readonly string[]
  readonly creating: boolean
}

/** 共享池环境信息（wire JSON，ENV-04/05）。 */
export interface PoolEnvInfo {
  readonly envDir: string
  readonly pythonPath: string
  /** 环境指纹（16 位 hex）。 */
  readonly fingerprint: string
  readonly exists: boolean
  /** envFor 本次调用是否新建了环境（复用为 false）。 */
  readonly created: boolean
  readonly createdAt: number
  readonly pythonVersion: string
  readonly packages: readonly string[]
}

const DEFAULT_PYTHON_VERSION = '3.12'
const CREATE_TIMEOUT_MS = 15 * 60 * 1000
const INSTALL_TIMEOUT_MS = 10 * 60 * 1000

// ── 共享环境池（§7.5 / ENV-03..07）─────────────────────────────────────────

/** 参与指纹的依赖文件（按此顺序参与哈希；缺文件以空串计）。 */
const DEP_FILES: readonly string[] = ['uv.lock', 'requirements.txt', 'pyproject.toml']
/** 池根相对 dataRoot：.evoresearch-data/envs/。 */
const POOL_REL = path.join('.evoresearch-data', 'envs')
/** 指纹格式：16 位小写 hex（防路径注入）。 */
const POOL_FP_PATTERN = /^[0-9a-f]{16}$/

/** 解析 `uv pip list` 输出中的包名（表头两行后逐行取首列）。 */
export function parsePipList(stdout: string): string[] {
  return stdout
    .split(/\r?\n/)
    .slice(2)
    .map((line) => line.trim().split(/\s+/)[0] ?? '')
    .filter((name) => name !== '')
}

/** 运行命令并收集 stdout（失败返回空字符串，不抛；短命令同步）。 */
function runCapture(exe: string, args: string[], timeoutMs = 60000): string {
  try {
    const result = spawnSync(exe, args, { encoding: 'utf8', timeout: timeoutMs, windowsHide: true, env: { ...process.env, UV_NO_PROGRESS: '1' } })
    if (result.status !== 0) return ''
    return (result.stdout ?? '').trim()
  } catch {
    return ''
  }
}

interface RunResult { status: number | null; stdout: string; stderr: string }

/** 运行结果（wire 安全；供注入 runner 使用）。 */
export interface UvRunResult {
  readonly status: number | null
  readonly stdout: string
  readonly stderr: string
}

/** 注入的 UV 执行器（测试用）。 */
export type UvRunner = (exe: string, args: string[], timeoutMs: number) => Promise<UvRunResult>

/** 异步运行命令（长任务不阻塞事件循环）。 */
function runAsync(exe: string, args: string[], timeoutMs: number): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(exe, args, { windowsHide: true, env: { ...process.env, UV_NO_PROGRESS: '1' } })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      resolve({ status: null, stdout, stderr: `${stderr}\n(超时 ${timeoutMs}ms)` })
    }, timeoutMs)
    child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ status: null, stdout, stderr: String(error?.message ?? error) })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ status: code, stdout, stderr })
    })
  })
}

/** 下载文件（带超时与重定向跟随）。 */
async function downloadFile(url: string, dest: string, timeoutMs = 5 * 60 * 1000): Promise<void> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: 'follow' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const buffer = Buffer.from(await res.arrayBuffer())
    fs.writeFileSync(dest, buffer)
  } finally {
    clearTimeout(timer)
  }
}

/** 递归查找指定文件名（返回首个匹配的绝对路径，未找到返回 null）。 */
function findFile(dir: string, name: string): string | null {
  let entries: fs.Dirent[] = []
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return null
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      const found = findFile(full, name)
      if (found !== null) return found
    } else if (entry.name === name) {
      return full
    }
  }
  return null
}

/**
 * 解析 UV 可执行文件（null = 未安装）。
 * 顺序：EVORESEARCH_UV → 部署目录 <dataRoot>/.tools/bin（本产品安装，随程序迁移）
 * → 官方脚本位置 ~/.local/bin → 静默安装器位置 %LOCALAPPDATA%\Programs\uv
 * → 旧版 ~/.dsh/bin → PATH。部署目录优先：不往用户目录写工具二进制。
 */
function uvPathOf(dataRoot: string): string | null {
  const fromEnv = process.env.EVORESEARCH_UV
  if (fromEnv !== undefined && fromEnv !== '' && fs.existsSync(fromEnv)) return fromEnv
  const candidates = [
    path.join(dataRoot, '.tools', 'bin', 'uv.exe'),
    path.join(homedir(), '.local', 'bin', 'uv.exe'),
    path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'uv', 'uv.exe'),
    path.join(homedir(), '.dsh', 'bin', 'uv.exe'),
  ]
  for (const candidate of candidates) if (fs.existsSync(candidate)) return candidate
  const which = runCapture('where.exe', ['uv'])
  return which !== '' ? which.split(/\r?\n/)[0]!.trim() : null
}

/** 项目环境服务。 */
export class ProjectEnvService {
  /** 池环境创建去重（并发同指纹只建一次）。 */
  private readonly envForCache = new Map<string, Promise<PoolEnvInfo>>()

  /**
   * @param dataRoot 部署根目录。
   * @param options.uvPath 注入 UV 路径（测试用；缺省走既有解析/自动安装链）。
   * @param options.run 注入 UV 执行器（测试用；缺省真实 spawn）。
   */
  constructor(readonly dataRoot: string, private readonly options: { uvPath?: string | null; run?: UvRunner } = {}) {}

  /** 解析 UV 可执行文件（null = 未安装）。 */
  uvPath(): string | null {
    return uvPathOf(this.dataRoot)
  }

  /** 把给定 uv.exe 复制到部署目录 <dataRoot>/.tools/bin（幂等；失败静默）。 */
  private copyUvIntoDeploy(uvExe: string): void {
    try {
      const binDir = path.join(this.dataRoot, '.tools', 'bin')
      fs.mkdirSync(binDir, { recursive: true })
      fs.copyFileSync(uvExe, path.join(binDir, 'uv.exe'))
    } catch {
      // 复制失败不影响：下次仍可从原位置解析
    }
  }

  /**
   * 确保 UV 可用：已安装直接返回；未安装则自动安装（客户开箱即用，无需手动操作）。
   * 安装链路（按序尝试，成功即止）：
   * 1. 官方 PowerShell 安装脚本（irm astral.sh/uv/install.ps1 | iex → ~/.local/bin）；
   * 2. 官方 zip 下载 + Windows 自带 tar.exe 解压 → ~/.local/bin/uv.exe（无 PowerShell 依赖）。
   * 幂等、可重入（并发调用只执行一次）。
   */
  private ensurePromise: Promise<{ ok: boolean; uv: string | null; installed: boolean; error?: string }> | null = null
  uvEnsure(): Promise<{ ok: boolean; uv: string | null; installed: boolean; error?: string }> {
    if (this.ensurePromise !== null) return this.ensurePromise
    this.ensurePromise = (async () => {
      const existing = uvPathOf(this.dataRoot)
      if (existing !== null) return { ok: true, uv: existing, installed: false }
      let lastError = ''
      // 1) 官方脚本（固定装到 ~/.local/bin；成功后复制进部署目录，保证下次从部署目录解析）
      try {
        const script = 'irm https://astral.sh/uv/install.ps1 | iex'
        const result = await runAsync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], 5 * 60 * 1000)
        const found = uvPathOf(this.dataRoot)
        if (result.status === 0 && found !== null) {
          this.copyUvIntoDeploy(found)
          return { ok: true, uv: found, installed: true }
        }
        lastError = (result.stderr.trim() || result.stdout.trim() || `exit ${String(result.status)}`).slice(0, 300)
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error)
      }
      // 2) 官方 zip + tar.exe（Windows 10+ 自带 bsdtar，可解 zip；无 PowerShell 依赖；
      //    直接装进部署目录 <dataRoot>/.tools/bin——不写用户目录）
      try {
        const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64'
        const tmp = os.tmpdir()
        const zip = path.join(tmp, `uv-${process.pid}-${Date.now()}.zip`)
        const extractDir = path.join(tmp, `uv-extract-${process.pid}-${Date.now()}`)
        await downloadFile(`https://github.com/astral-sh/uv/releases/latest/download/uv-${arch}-pc-windows-msvc.zip`, zip)
        fs.mkdirSync(extractDir, { recursive: true })
        const tarResult = await runAsync('tar.exe', ['-xf', zip, '-C', extractDir], 2 * 60 * 1000)
        fs.rmSync(zip, { force: true })
        if (tarResult.status !== 0) throw new Error(`tar 解压失败: ${(tarResult.stderr || tarResult.stdout).slice(0, 200)}`)
        const uvExe = findFile(extractDir, 'uv.exe')
        if (uvExe === null) throw new Error('zip 内未找到 uv.exe')
        const binDir = path.join(this.dataRoot, '.tools', 'bin')
        fs.mkdirSync(binDir, { recursive: true })
        fs.copyFileSync(uvExe, path.join(binDir, 'uv.exe'))
        fs.rmSync(extractDir, { recursive: true, force: true })
        const found = uvPathOf(this.dataRoot)
        if (found !== null) return { ok: true, uv: found, installed: true }
        lastError = '解压安装完成但未找到 uv.exe'
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error)
      }
      return { ok: false, uv: null, installed: false, error: lastError || '所有安装方式均失败' }
    })().finally(() => { this.ensurePromise = null })
    return this.ensurePromise
  }

  envDirOf(projectDir: string): string {
    return path.join(projectDir, '.venv')
  }

  pythonOf(envDir: string): string {
    return path.join(envDir, 'Scripts', 'python.exe')
  }

  /** 读取环境配置记录（.evoresearch-data/env.json）。 */
  envConfig(projectDir: string): { pythonVersion: string; createdAt: number } {
    const file = path.join(projectDir, '.evoresearch-data', 'env.json')
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { pythonVersion?: string; createdAt?: number }
      return { pythonVersion: raw.pythonVersion ?? '', createdAt: raw.createdAt ?? 0 }
    } catch {
      return { pythonVersion: '', createdAt: 0 }
    }
  }

  private writeEnvConfig(projectDir: string, pythonVersion: string): void {
    const dir = path.join(projectDir, '.evoresearch-data')
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, 'env.json')
    const tmp = `${file}.tmp-${process.pid}`
    fs.writeFileSync(tmp, JSON.stringify({ pythonVersion, createdAt: Date.now() }, null, 2), 'utf8')
    fs.renameSync(tmp, file)
  }

  /** 环境状态（含版本与已装包）。 */
  status(projectDir: string): ProjectEnvInfo {
    const uv = this.uvPath()
    const envDir = this.envDirOf(projectDir)
    const pythonPath = this.pythonOf(envDir)
    const exists = fs.existsSync(pythonPath)
    let pythonVersion = ''
    let packages: string[] = []
    if (exists) {
      pythonVersion = runCapture(pythonPath, ['--version'])
      if (uv !== null) {
        packages = runCapture(uv, ['pip', 'list', '--python', envDir], 120000)
          .split(/\r?\n/)
          .slice(2) // 跳过表头
          .map((line) => line.trim().split(/\s+/)[0] ?? '')
          .filter((name) => name !== '')
      }
    }
    return {
      projectDir,
      uv,
      envDir,
      pythonPath,
      exists,
      pythonVersion,
      packages,
      creating: false,
    }
  }

  /**
   * 创建/重建项目环境：uv venv <project>/.venv --python <version> --python-preference managed。
   * 异步（uv 下载 CPython 首次较慢，不阻塞事件循环）。uv 缺失时自动安装。
   */
  async create(projectDir: string, pythonVersion?: string): Promise<ProjectEnvInfo> {
    const ensured = await this.uvEnsure()
    if (!ensured.ok || ensured.uv === null) {
      throw new Error(`UV 不可用且自动安装失败: ${ensured.error ?? '未安装'}`)
    }
    const uv = ensured.uv
    const envDir = this.envDirOf(projectDir)
    const version = (pythonVersion ?? '').trim() || this.envConfig(projectDir).pythonVersion || DEFAULT_PYTHON_VERSION
    const args = ['venv', envDir, '--python', version, '--python-preference', 'managed']
    const result = await runAsync(uv, args, CREATE_TIMEOUT_MS)
    if (result.status !== 0) {
      throw new Error(`环境创建失败: ${result.stderr.trim().slice(0, 500) || `exit ${String(result.status)}`}`)
    }
    this.writeEnvConfig(projectDir, version)
    return this.status(projectDir)
  }

  /** 安装依赖：uv pip install --python <env> <packages...>（异步）。 */
  async install(projectDir: string, packages: string[]): Promise<{ ok: boolean; output: string }> {
    const ensured = await this.uvEnsure()
    if (!ensured.ok || ensured.uv === null) {
      throw new Error(`UV 不可用且自动安装失败: ${ensured.error ?? '未安装'}`)
    }
    const uv = ensured.uv
    const envDir = this.envDirOf(projectDir)
    if (!fs.existsSync(this.pythonOf(envDir))) throw new Error('项目环境尚未创建')
    const names = packages.map((p) => p.trim()).filter((p) => p !== '')
    if (names.length === 0) throw new Error('未指定要安装的包')
    const result = await runAsync(uv, ['pip', 'install', '--python', envDir, ...names], INSTALL_TIMEOUT_MS)
    if (result.status !== 0) {
      throw new Error(`安装失败: ${result.stderr.trim().slice(0, 500) || `exit ${String(result.status)}`}`)
    }
    return { ok: true, output: result.stdout.trim().slice(-800) }
  }

  /** 删除项目环境（.venv 目录）。 */
  remove(projectDir: string): { ok: boolean } {
    const envDir = this.envDirOf(projectDir)
    if (fs.existsSync(envDir)) fs.rmSync(envDir, { recursive: true, force: true })
    const config = path.join(projectDir, '.evoresearch-data', 'env.json')
    if (fs.existsSync(config)) fs.rmSync(config, { force: true })
    return { ok: true }
  }

  // ── 共享环境池（§7.5；ENV-03..07）──────────────────────────────────────

  /** 解析 UV 路径：构造函数注入优先，否则既有链（自动安装兜底）。 */
  private async resolveUv(): Promise<string> {
    const injected = this.options.uvPath
    if (typeof injected === 'string' && injected.trim() !== '') return injected
    const ensured = await this.uvEnsure()
    if (!ensured.ok || ensured.uv === null) {
      throw new Error(`UV 不可用且自动安装失败: ${ensured.error ?? '未安装'}`)
    }
    return ensured.uv
  }

  /** 执行 UV：注入 runner 优先（测试），否则真实 spawn。 */
  private async runUv(args: string[], timeoutMs: number): Promise<UvRunResult> {
    const injected = this.options.run
    if (injected !== undefined) return injected('<uv>', args, timeoutMs)
    const uv = await this.resolveUv()
    return runAsync(uv, args, timeoutMs)
  }

  /** 池根目录（<dataRoot>/.evoresearch-data/envs）。 */
  poolRoot(): string {
    return path.join(this.dataRoot, POOL_REL)
  }

  /** 指纹 → 池环境目录（ENV-04；指纹格式校验防路径注入）。 */
  poolDirOf(fingerprint: string): string {
    const fp = String(fingerprint ?? '')
    if (!POOL_FP_PATTERN.test(fp)) throw new Error(`非法的环境指纹: ${fingerprint}`)
    return path.join(this.poolRoot(), fp)
  }

  /** 依赖文件内容哈希（ENV-03；缺失文件记空串参与指纹）。 */
  dependencyDigests(projectDir: string): Record<string, string> {
    const out: Record<string, string> = {}
    for (const name of DEP_FILES) {
      try {
        const content = fs.readFileSync(path.join(projectDir, name))
        out[name] = createHash('sha256').update(content).digest('hex')
      } catch {
        out[name] = ''
      }
    }
    return out
  }

  /** 环境指纹计算（ENV-03 纯函数）：OS(platform+arch) + Python 版本 + 依赖文件内容。 */
  computeEnvFingerprint(input: { platform?: string; arch?: string; pythonVersion: string; digests: Record<string, string> }): string {
    const parts = [
      input.platform ?? process.platform,
      input.arch ?? process.arch,
      input.pythonVersion,
    ]
    for (const name of DEP_FILES) parts.push(input.digests[name] ?? '')
    return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 16)
  }

  /**
   * 项目环境指纹（ENV-03）：Python 版本取 .evoresearch-data/env.json 记录
   * （未记录用默认 3.12——与 create() 的版本选择逻辑一致，保证确定性）。
   */
  fingerprint(projectDir: string): string {
    const version = this.envConfig(projectDir).pythonVersion || DEFAULT_PYTHON_VERSION
    return this.computeEnvFingerprint({ pythonVersion: version, digests: this.dependencyDigests(projectDir) })
  }

  /**
   * 池环境（ENV-04）：返回与项目指纹匹配的共享环境，不存在则创建。
   * 相同依赖（同指纹）的多个 worktree 复用同一个环境；并发调用只创建一次。
   * 依赖变化 → 新指纹 → 新环境目录（ENV-05）；旧环境保留，旧实验经运行账本
   * （.evoresearch-run.json 的 pythonPath）仍能找到原解释器。
   */
  async envFor(projectDir: string): Promise<PoolEnvInfo> {
    const fingerprint = this.fingerprint(projectDir)
    const cached = this.envForCache.get(fingerprint)
    if (cached !== undefined) return cached
    const task = (async () => {
      const envDir = this.poolDirOf(fingerprint)
      const pythonPath = this.pythonOf(envDir)
      const version = this.envConfig(projectDir).pythonVersion || DEFAULT_PYTHON_VERSION
      if (fs.existsSync(pythonPath)) {
        return this.poolInfoOf(envDir, fingerprint, version, false, false)
      }
      const result = await this.runUv(['venv', envDir, '--python', version, '--python-preference', 'managed'], CREATE_TIMEOUT_MS)
      if (result.status !== 0) {
        throw new Error(`池环境创建失败: ${result.stderr.trim().slice(0, 500) || `exit ${String(result.status)}`}`)
      }
      return this.poolInfoOf(envDir, fingerprint, version, false, true)
    })()
    this.envForCache.set(fingerprint, task)
    try {
      return await task
    } finally {
      this.envForCache.delete(fingerprint)
    }
  }

  /** 单个池环境信息（按指纹；目录不存在返回 exists=false）。 */
  poolInfo(fingerprint: string): PoolEnvInfo {
    const envDir = this.poolDirOf(fingerprint)
    const pythonPath = this.pythonOf(envDir)
    const exists = fs.existsSync(pythonPath)
    return this.poolInfoOf(envDir, fingerprint, '', exists, false)
  }

  /** 池环境列表（新 → 旧；供 UI 与"旧实验找原解释器"追溯）。 */
  poolList(): PoolEnvInfo[] {
    const root = this.poolRoot()
    let entries: fs.Dirent[] = []
    try {
      entries = fs.readdirSync(root, { withFileTypes: true })
    } catch {
      return []
    }
    const out: PoolEnvInfo[] = []
    for (const entry of entries) {
      if (!entry.isDirectory() || !POOL_FP_PATTERN.test(entry.name)) continue
      out.push(this.poolInfoOf(path.join(root, entry.name), entry.name, '', true, false))
    }
    return out.sort((a, b) => b.createdAt - a.createdAt)
  }

  private poolInfoOf(envDir: string, fingerprint: string, fallbackVersion: string, probeVersion: boolean, created: boolean): PoolEnvInfo {
    const pythonPath = this.pythonOf(envDir)
    const exists = fs.existsSync(pythonPath)
    let createdAt = 0
    let pythonVersion = fallbackVersion
    let packages: string[] = []
    try {
      const stat = fs.statSync(envDir)
      createdAt = stat.birthtimeMs || stat.ctimeMs
    } catch {
      // 目录不存在
    }
    if (exists && probeVersion) {
      pythonVersion = runCapture(pythonPath, ['--version'])
      const uv = this.uvPath()
      if (uv !== null) {
        packages = runCapture(uv, ['pip', 'list', '--python', envDir], 120000)
          .split(/\r?\n/)
          .slice(2)
          .map((line) => line.trim().split(/\s+/)[0] ?? '')
          .filter((name) => name !== '')
      }
    }
    return { envDir, pythonPath, fingerprint, exists, created, createdAt, pythonVersion, packages }
  }

  /**
   * 派生私有环境（ENV-07）：临时装包不得静默污染共享池——
   * 在目标目录（默认 <projectDir>/.venv，或显式传 worktree 的 .venv）新建独立
   * venv；可选 fromFingerprint：把池环境的已装包「列出 → 重装」进派生环境
   * （复制目录不可靠，故采用重装；包名列表来自 uv pip list）。
   * 派生环境不与任何指纹绑定，装包只影响它自己。
   */
  async createDerivedEnv(
    projectDir: string,
    opts: { targetDir?: string; pythonVersion?: string; fromFingerprint?: string } = {},
  ): Promise<{ envDir: string; pythonPath: string; fingerprint: string | null }> {
    const target = typeof opts.targetDir === 'string' && opts.targetDir.trim() !== ''
      ? path.resolve(opts.targetDir)
      : path.join(projectDir, '.venv')
    if (fs.existsSync(this.pythonOf(target))) {
      throw new Error(`目标目录已有环境: ${target}`)
    }
    fs.mkdirSync(path.dirname(target), { recursive: true })
    const version = (opts.pythonVersion ?? '').trim() || this.envConfig(projectDir).pythonVersion || DEFAULT_PYTHON_VERSION
    const result = await this.runUv(['venv', target, '--python', version, '--python-preference', 'managed'], CREATE_TIMEOUT_MS)
    if (result.status !== 0) {
      throw new Error(`派生环境创建失败: ${result.stderr.trim().slice(0, 500) || `exit ${String(result.status)}`}`)
    }
    if (typeof opts.fromFingerprint === 'string' && opts.fromFingerprint !== '') {
      const base = this.poolDirOf(opts.fromFingerprint)
      if (!fs.existsSync(this.pythonOf(base))) throw new Error(`基础池环境不存在: ${opts.fromFingerprint}`)
      const list = await this.runUv(['pip', 'list', '--python', base], INSTALL_TIMEOUT_MS)
      const packages = parsePipList(list.stdout)
      if (packages.length > 0) {
        const inst = await this.runUv(['pip', 'install', '--python', target, ...packages], INSTALL_TIMEOUT_MS)
        if (inst.status !== 0) {
          throw new Error(`派生环境装包失败: ${inst.stderr.trim().slice(0, 500) || `exit ${String(inst.status)}`}`)
        }
      }
    }
    return { envDir: target, pythonPath: this.pythonOf(target), fingerprint: opts.fromFingerprint ?? null }
  }
}
