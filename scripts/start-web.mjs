/**
 * EvoResearch Web launcher.
 *
 * The DSH child receives the two resolved paths on every start. The settings
 * panel writes the bootstrap document and a restart request; this process
 * notices that request and recreates the child with the new environment.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { spawn, execFile } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findAvailablePort, parsePort } from './web-port.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const defaultEvoResearchRoot = join(root, '.tmp-dev', '.evoresearch-data')
const configEnv = process.env.EVORESEARCH_PATHS_CONFIG
const restartEnv = process.env.EVORESEARCH_RESTART_FILE
const configPath = resolve(configEnv && configEnv.trim() !== '' ? configEnv : join(root, '.evoresearch-paths.json'))
const restartFile = resolve(restartEnv && restartEnv.trim() !== '' ? restartEnv : join(root, '.evoresearch-restart.json'))
const profileSource = join(root, 'profiles', 'evoresearch')
const dshVersion = '@deepseek-ai/dsh@0.1.0-rc.8'

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
  const evoresearchRoot = configured.evoresearchRoot
    || (envRoot && envRoot.trim() !== '' ? envRoot.trim() : undefined)
    || defaultEvoResearchRoot
  const rootPath = resolve(evoresearchRoot)
  return { evoresearchRoot: rootPath, dshHome: rootPath, evoResearchDataRoot: rootPath }
}

function ensureProfile(dshHome) {
  if (!existsSync(profileSource)) throw new Error(`找不到 EvoResearch profile: ${profileSource}`)
  const profileDir = join(dshHome, 'profiles', 'evoresearch')
  mkdirSync(dirname(profileDir), { recursive: true })
  if (!existsSync(profileDir)) {
    try {
      symlinkSync(profileSource, profileDir, process.platform === 'win32' ? 'junction' : 'dir')
      return
    } catch (error) {
      throw new Error(`无法在新数据目录创建 profile 链接，请检查目录权限: ${error.message}`)
    }
  }
  const appModule = join(profileDir, 'node_modules', '@evoresearch', 'dsh-app')
  const pluginModule = join(profileDir, 'node_modules', '@evoresearch', 'dsh-plugin')
  if (!existsSync(appModule) || !existsSync(pluginModule)) {
    throw new Error(`目标 DSH_HOME 的 profile 不完整: ${profileDir}。请使用“迁移数据”，或删除目标目录后重试。`)
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
