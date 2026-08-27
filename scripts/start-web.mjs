/**
 * EvoResearch Web launcher.
 *
 * The DSH child receives the two resolved paths on every start. The settings
 * panel writes the bootstrap document and a restart request; this process
 * notices that request and recreates the child with the new environment.
 */
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { spawn, execFile, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findAvailablePort, parsePort } from './web-port.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * git 分支名 -> 文件系统安全的一段（用于数据根目录名）。
 * git 分支名不能含空格与 ~^:?*[\，但仍可能含其它可打印字符，
 * 统一收敛为 [A-Za-z0-9._-]，避免目录名怪异或跨平台问题。
 */
function sanitizeBranch(branch) {
  return branch.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '') || 'worktree'
}

/**
 * 检测本次启动是否发生在 git worktree 中（而非主仓库）。
 *
 * 设计目标：多 worktree 并行独立开发/验收时，每个 worktree 使用各自
 * 独立的数据根，避免多个 DSH 实例去抢同一份 .tmp-dev\.evoresearch-data。
 *
 * 判定方式：
 *  - 用 --git-common-dir 拿到主仓库的 .git 公共目录，其父目录即主仓库根。
 *  - 用 --show-toplevel 拿到当前 cwd 所属的（子）仓库顶目录。
 *  - 若当前顶目录 != 主仓库根，则说明正运行在某个 worktree 里。
 * 返回 { mainRoot, branch, isolatedRoot, isWorktree }；主仓库返回 isWorktree=false。
 */
function worktreeId(topLevel) {
  return createHash('sha1').update(resolve(topLevel)).digest('hex').slice(0, 8)
}

function detectWorktreeIsolation() {
  try {
    const commonDir = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: root, encoding: 'utf8' }).trim()
    const topLevel = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8' }).trim()
    const branch = execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8' }).trim()
    const mainRoot = resolve(root, commonDir, '..')
    const currentRoot = resolve(topLevel)
    const isWorktree = currentRoot !== mainRoot
    if (!isWorktree) {
      return { mainRoot, branch, isolatedRoot: null, isWorktree: false }
    }
    const id = worktreeId(currentRoot)
    const label = sanitizeBranch(branch || 'detached')
    return {
      mainRoot,
      branch: branch || `detached-${id}`,
      isolatedRoot: join(mainRoot, '.tmp-dev', `.evoresearch-data-${label}-${id}`),
      isWorktree: true,
    }
  } catch {
    return { mainRoot: root, branch: '', isolatedRoot: null, isWorktree: false }
  }
}

const wt = detectWorktreeIsolation()
// 主仓库默认根不变；worktree 则落到主仓库 .tmp-dev 下按分支命名的独立根。
const defaultEvoResearchRoot = wt.isolatedRoot
  || join(wt.mainRoot, '.tmp-dev', '.evoresearch-data')
if (wt.isolatedRoot) {
  console.log(`[evoresearch] ★ worktree 环境（分支 ${wt.branch}）→ 数据根隔离到 ${wt.isolatedRoot}`)
  console.log(`[evoresearch] 这样可以并行开发/验收多个独立功能，互不冲突。`)
}
// 主仓库可读取 EVORESEARCH_ROOT；worktree 默认忽略继承值以保持隔离。
// 只有显式 --root 能让 worktree 有意共享自定义数据根。
const explicitEnvRoot = (process.env.EVORESEARCH_ROOT || '').trim()
const explicitLauncherRoot = option('--root', '').trim()
const configEnv = process.env.EVORESEARCH_PATHS_CONFIG
const restartEnv = process.env.EVORESEARCH_RESTART_FILE
const configPath = resolve(configEnv && configEnv.trim() !== '' ? configEnv : join(root, '.evoresearch-paths.json'))
const restartFile = resolve(restartEnv && restartEnv.trim() !== '' ? restartEnv : join(root, '.evoresearch-restart.json'))
// 每个 worktree 加载自己的 profile 和构建产物，确保代码验收对应当前分支。
// worktree 的依赖安装/构建由开发者按 §4.1 在该 worktree 内完成。
const profileSource = join(root, 'profiles', 'evoresearch')
const dshVersion = '@deepseek-ai/dsh@0.1.1-rc.2'

function option(name, fallback) {
  const index = process.argv.indexOf(name)
  return index >= 0 && process.argv[index + 1] !== undefined ? process.argv[index + 1] : fallback
}

const requestedPort = parsePort(option('--port', process.env.EVORESEARCH_PORT || '3081'))

function readConfiguredPaths() {
  try {
    const raw = JSON.parse(readFileSync(configPath, 'utf8'))
    const legacyRoot = typeof raw.evoResearchDataRoot === 'string' && raw.evoResearchDataRoot.trim() !== ''
      ? raw.evoResearchDataRoot
      : typeof raw.dshHome === 'string' && raw.dshHome.trim() !== '' ? raw.dshHome : undefined
    return {
      evoresearchRoot: typeof raw.evoresearchRoot === 'string' && raw.evoresearchRoot.trim() !== ''
        ? resolve(raw.evoresearchRoot)
        : legacyRoot !== undefined ? resolve(legacyRoot) : undefined,
    }
  } catch {
    return {}
  }
}

function resolvePaths() {
  const configured = readConfiguredPaths()
  const envRoot = process.env.EVORESEARCH_ROOT
    || process.env.EVORESEARCH_DATA_ROOT
    || process.env.DSH_HOME
  let evoresearchRoot
  if (explicitLauncherRoot !== '') {
    // 显式 --root 最高优先级（包括 worktree 共享数据的有意覆盖）。
    evoresearchRoot = explicitLauncherRoot
  } else if (wt.isolatedRoot) {
    // worktree 默认优先隔离；避免继承的 EVORESEARCH_ROOT 让多个 worktree 共享数据。
    evoresearchRoot = wt.isolatedRoot
  } else {
    // 主仓库允许通过环境变量或配置文件指定根，否则使用开发默认根。
    evoresearchRoot = explicitEnvRoot
      || configured.evoresearchRoot
      || (envRoot && envRoot.trim() !== '' ? envRoot.trim() : undefined)
      || defaultEvoResearchRoot
  }
  const rootPath = resolve(evoresearchRoot)
  return { evoresearchRoot: rootPath, dshHome: rootPath, evoResearchDataRoot: rootPath }
}

function ensureProfile(dshHome) {
  if (!existsSync(profileSource)) throw new Error(`找不到 EvoResearch profile: ${profileSource}`)
  const profileDir = join(dshHome, 'profiles', 'evoresearch')
  mkdirSync(dirname(profileDir), { recursive: true })

  if (existsSync(profileDir)) {
    const actual = resolve(realpathSync(profileDir))
    const expected = resolve(realpathSync(profileSource))
    const sameTarget = process.platform === 'win32'
      ? actual.toLowerCase() === expected.toLowerCase()
      : actual === expected
    if (!sameTarget) {
      // 旧版 worktree 根可能仍链接主仓库 profile；只替换 dataRoot 内的链接。
      rmSync(profileDir, { recursive: true, force: true })
    }
  }

  if (!existsSync(profileDir)) {
    try {
      symlinkSync(profileSource, profileDir, process.platform === 'win32' ? 'junction' : 'dir')
    } catch (error) {
      throw new Error(`无法在数据目录创建当前 worktree 的 profile 链接，请检查目录权限: ${error.message}`)
    }
  }

  const appModule = join(profileDir, 'node_modules', '@evoresearch', 'dsh-app')
  const pluginModule = join(profileDir, 'node_modules', '@evoresearch', 'dsh-plugin')
  if (!existsSync(appModule) || !existsSync(pluginModule)) {
    throw new Error(`当前 worktree 的 profile 依赖不完整: ${profileSource}。请在当前 worktree 执行 npm install 和 npm run build。`)
  }
}

function startChild(paths, port) {
  mkdirSync(paths.dshHome, { recursive: true })
  mkdirSync(paths.evoResearchDataRoot, { recursive: true })
  ensureProfile(paths.dshHome)
  const npxCli = process.env.EVORESEARCH_NPX_CLI
  const hasNpxCli = npxCli !== undefined && npxCli.trim() !== ''
  const command = hasNpxCli
    ? process.execPath
    : process.platform === 'win32'
      ? (process.env.ComSpec ?? 'cmd.exe')
      : 'npx'
  const args = hasNpxCli
    ? [npxCli, '--yes', dshVersion, '--profile', 'evoresearch', '--port', String(port)]
    : process.platform === 'win32'
      ? ['/d', '/s', '/c', `npx.cmd --yes ${dshVersion} --profile evoresearch --port ${port}`]
      : ['--yes', dshVersion, '--profile', 'evoresearch', '--port', String(port)]
  return spawn(command, args, {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
    env: {
      ...process.env,
      EVORESEARCH_ROOT: paths.evoresearchRoot,
      DSH_HOME: paths.evoresearchRoot,
      EVORESEARCH_DATA_ROOT: paths.evoresearchRoot,
      EVORESEARCH_PATHS_CONFIG: configPath,
      EVORESEARCH_RESTART_FILE: restartFile,
    },
  })
}

async function startChildOnAvailablePort(paths, preferredPort) {
  const port = await findAvailablePort(preferredPort)
  if (port !== preferredPort) {
    const label = preferredPort === requestedPort ? 'requested' : 'preferred'
    console.log(`[evoresearch] ${label} port ${preferredPort} was busy; selected ${port}`)
  }
  return { child: startChild(paths, port), port }
}

function stopChild(child) {
  return new Promise((done) => {
    if (child === undefined) {
      done()
      return
    }
    if (child.exitCode !== null || child.signalCode !== null) {
      done()
      return
    }
    let finished = false
    const finish = () => {
      if (finished) return
      finished = true
      done()
    }
    child.once('exit', finish)
    child.kill()
    const timer = setTimeout(() => {
      if (process.platform === 'win32' && child.pid !== undefined) {
        execFile('taskkill', ['/pid', String(child.pid), '/t', '/f'], () => finish())
      } else {
        child.kill('SIGKILL')
        finish()
      }
    }, 5000)
    timer.unref()
  })
}

let child
let activePort
let restarting = false
let lastRequest = ''

function requestToken() {
  try {
    const raw = JSON.parse(readFileSync(restartFile, 'utf8'))
    return typeof raw.requestedAt === 'string' ? raw.requestedAt : ''
  } catch {
    return ''
  }
}

async function restartChild() {
  if (restarting) return
  restarting = true
  try {
    if (child !== undefined) await stopChild(child)
    rmSync(restartFile, { force: true })
    const started = await startChildOnAvailablePort(resolvePaths(), activePort ?? requestedPort)
    child = started.child
    activePort = started.port
    child.once('exit', onChildExit)
    console.log(`[evoresearch] Web launcher ready: http://127.0.0.1:${activePort}`)
  } catch (error) {
    console.error(`[evoresearch] Web 重启失败: ${error.message}`)
    process.exitCode = 1
  } finally {
    restarting = false
  }
}

function onChildExit(code, signal) {
  if (restarting) return
  const exitCode = code === undefined || code === null ? 'null' : code
  const exitSignal = signal === undefined || signal === null ? 'null' : signal
  console.error(`[evoresearch] DSH 已退出（code=${exitCode}, signal=${exitSignal}）`)
  process.exit(code === 0 ? 0 : 1)
}

function shutdown(signal) {
  clearInterval(watch)
  void stopChild(child).finally(() => process.exit(signal === 'SIGINT' ? 130 : 143))
}

const watch = setInterval(() => {
  const token = requestToken()
  if (token !== '' && token !== lastRequest) {
    lastRequest = token
    void restartChild()
  }
}, 250)
watch.unref()

async function bootstrap() {
  try {
    const paths = resolvePaths()
    const started = await startChildOnAvailablePort(paths, requestedPort)
    child = started.child
    activePort = started.port
    child.once('exit', onChildExit)
    process.on('SIGINT', () => shutdown('SIGINT'))
    process.on('SIGTERM', () => shutdown('SIGTERM'))
    console.log(`[evoresearch] Web launcher ready: http://127.0.0.1:${activePort}`)
    console.log(`[evoresearch] EVORESEARCH_ROOT=${paths.evoresearchRoot}`)
    console.log(`[evoresearch] DSH_HOME=EVORESEARCH_ROOT`)
    console.log(`[evoresearch] EVORESEARCH_DATA_ROOT=EVORESEARCH_ROOT`)
  } catch (error) {
    console.error(`[evoresearch] Web 启动失败: ${error.message}`)
    process.exitCode = 1
  }
}

void bootstrap()
