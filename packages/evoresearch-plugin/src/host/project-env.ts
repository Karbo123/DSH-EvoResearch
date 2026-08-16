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

/** 项目环境服务。 */
export class ProjectEnvService {
  constructor(readonly dataRoot: string) {}

  /** 解析 UV 可执行文件（null = 未安装）。 */
  uvPath(): string | null {
    const fromEnv = process.env.EVORESEARCH_UV
    if (fromEnv !== undefined && fromEnv !== '' && fs.existsSync(fromEnv)) return fromEnv
    const local = path.join(homedir(), '.dsh', 'bin', 'uv.exe')
    if (fs.existsSync(local)) return local
    const which = runCapture('where.exe', ['uv'])
    return which !== '' ? which.split(/\r?\n/)[0]!.trim() : null
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
   * 异步（uv 下载 CPython 首次较慢，不阻塞事件循环）。
   */
  async create(projectDir: string, pythonVersion?: string): Promise<ProjectEnvInfo> {
    const uv = this.uvPath()
    if (uv === null) throw new Error('uv 未安装（请安装 UV 或设置 EVORESEARCH_UV）')
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
    const uv = this.uvPath()
    if (uv === null) throw new Error('uv 未安装')
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
