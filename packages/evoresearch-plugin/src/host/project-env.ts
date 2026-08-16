/**
 * 项目环境服务（§环境管理）：每科研项目一个独立 Python 虚拟环境，UV 管理。
 *
 * 约定：
 * - 环境目录：<projectDir>/.venv（uv 默认目标，随项目迁移，git 忽略）
 * - 配置记录：<projectDir>/.evoresearch-data/env.json（pythonVersion/createdAt）
 * - UV 解析：EVORESEARCH_UV 环境变量 → ~/.dsh/bin/uv.exe → PATH 上的 uv
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

const DEFAULT_PYTHON_VERSION = '3.12'
const CREATE_TIMEOUT_MS = 15 * 60 * 1000
const INSTALL_TIMEOUT_MS = 10 * 60 * 1000

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
 * 顺序：EVORESEARCH_UV → 官方脚本位置 ~/.local/bin → 静默安装器位置
 * %LOCALAPPDATA%\Programs\uv → 旧版 ~/.dsh/bin → PATH。
 */
function uvPathOf(): string | null {
  const fromEnv = process.env.EVORESEARCH_UV
  if (fromEnv !== undefined && fromEnv !== '' && fs.existsSync(fromEnv)) return fromEnv
  const candidates = [
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
  constructor(readonly dataRoot: string) {}

  /** 解析 UV 可执行文件（null = 未安装）。 */
  uvPath(): string | null {
    return uvPathOf()
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
      const existing = uvPathOf()
      if (existing !== null) return { ok: true, uv: existing, installed: false }
      let lastError = ''
      // 1) 官方脚本
      try {
        const script = 'irm https://astral.sh/uv/install.ps1 | iex'
        const result = await runAsync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], 5 * 60 * 1000)
        const found = uvPathOf()
        if (result.status === 0 && found !== null) return { ok: true, uv: found, installed: true }
        lastError = (result.stderr.trim() || result.stdout.trim() || `exit ${String(result.status)}`).slice(0, 300)
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error)
      }
      // 2) 官方 zip + tar.exe（Windows 10+ 自带 bsdtar，可解 zip；无 PowerShell 依赖）
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
        const binDir = path.join(homedir(), '.local', 'bin')
        fs.mkdirSync(binDir, { recursive: true })
        fs.copyFileSync(uvExe, path.join(binDir, 'uv.exe'))
        fs.rmSync(extractDir, { recursive: true, force: true })
        const found = uvPathOf()
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
}
