/**
 * sidecar 启动脚本（由桌面壳 spawn；CommonJS，node.exe 直接运行）：
 * 1. 数据根 = exe 同级 <程序目录>/evoresearch-data（壳经 EVORESEARCH_DATA_HOME 传入；
 *    未传入时回退当前目录）——用户数据集中一处、一目了然、随程序目录迁移；
 * 2. 启动 DSH web profile（evoresearch），绑定 127.0.0.1 随机端口；
 * 3. 将端口写入 %LOCALAPPDATA%/EvoResearch/port.json（壳轮询读取）；
 * 4. 进程退出时清理端口文件；Windows 下父进程消失时自动退出（防孤儿）。
 */
'use strict'
const { spawn, execSync } = require('node:child_process')
const { writeFileSync, rmSync, mkdirSync, copyFileSync, existsSync, readdirSync } = require('node:fs')
const { join } = require('node:path')
const { platform } = require('node:os')

const APP_NAME = 'EvoResearch'
// 端口文件路径：优先取壳通过环境变量传入的路径，回退到 %LOCALAPPDATA%/<identifier>
const dataDir = process.env.EVORESEARCH_PORT_FILE
  ? require('node:path').dirname(process.env.EVORESEARCH_PORT_FILE)
  : join(process.env.LOCALAPPDATA || process.env.HOME || '.', 'com.evoresearch.desktop')
const portFile = process.env.EVORESEARCH_PORT_FILE || join(dataDir, 'port.json')

mkdirSync(dataDir, { recursive: true })

/** 数据根：壳传入的 exe 同级 evoresearch-data；未传入（直接运行本脚本）时用当前目录。 */
const dataHome = process.env.EVORESEARCH_DATA_HOME || process.cwd()
mkdirSync(dataHome, { recursive: true })

/**
 * 数据根下的 profiles 接入：DSH 从 $DSH_HOME/profiles 加载 profile，而 profiles/
 * （含 node_modules 依赖）属于程序文件——在数据根创建指向程序目录 profiles 的
 * junction（无需管理员），失败时退化为整体复制。
 */
function ensureProfilesLink() {
  const target = join(dataHome, 'profiles')
  if (existsSync(target)) return
  const source = join(process.cwd(), 'profiles')
  if (!existsSync(source)) return
  try {
    execSync(`cmd /c mklink /J "${target}" "${source}"`, { stdio: 'ignore' })
    console.log(`EvoResearch data home: ${dataHome} (profiles junction → 程序目录)`)
  } catch {
    // junction 不可用（非 NTFS 等）：整体复制（profiles 含依赖，较慢但兜底）
    const { cpSync } = require('node:fs')
    cpSync(source, target, { recursive: true })
    console.log(`EvoResearch data home: ${dataHome} (profiles 复制兜底)`)
  }
}
ensureProfilesLink()

/**
 * 数据根 profiles 的模块自愈：DSH 的 healProfilesModuleFallback 只从 dsh 包的
 * 依赖闭包建 symlink（@deepseek-ai/* 等），不覆盖声明在 app 根的 @evoresearch/*
 * 业务包；而数据根 profiles 是 junction 字面路径，Node 从它向上爬 node_modules
 * 永远到不了程序目录的 app/node_modules —— 缺了这层 link，插件树加载会
 * ERR_MODULE_NOT_FOUND（桌面黑窗根因）。这里在 $DSH_HOME/profiles/node_modules
 * 下为 @evoresearch 的两个包建 junction → 程序目录真实位置（与 heal 的产物共存，
 * heal 不动我们自己管理的链接）。
 */
function ensureEvoModules() {
  const modulesDir = join(dataHome, 'profiles', 'node_modules')
  const evoDir = join(modulesDir, '@evoresearch')
  const sourceScope = join(process.cwd(), 'node_modules', '@evoresearch')
  if (!existsSync(sourceScope)) return
  mkdirSync(evoDir, { recursive: true })
  for (const pkg of ['dsh-app', 'dsh-plugin']) {
    const link = join(evoDir, pkg)
    const target = join(sourceScope, pkg)
    if (!existsSync(target)) continue
    if (existsSync(link)) {
      // 已存在的正确 junction 保持；错误/普通目录则重建
      try {
        const lstat = require('node:fs').lstatSync(link)
        if (lstat.isSymbolicLink() && readlinkSafe(link) === target) continue
        require('node:fs').rmSync(link, { recursive: true, force: true })
      } catch (e) {
        if (e.code !== 'ENOENT') {
          try { require('node:fs').rmSync(link, { recursive: true, force: true }) } catch { /* 只读忽略 */ }
        }
      }
    }
    try {
      execSync(`cmd /c mklink /J "${link}" "${target}"`, { stdio: 'ignore' })
      console.log(`EvoResearch modules link: ${pkg} → ${target}`)
    } catch {
      // junction 不可用（非 NTFS 等）：整体复制（慢但兜底）
      const { cpSync } = require('node:fs')
      cpSync(target, link, { recursive: true })
      console.log(`EvoResearch modules copy fallback: ${pkg}`)
    }
  }
}
ensureEvoModules()

/** 读取 link 的 target（兼容 readlinkSync 抛错场景）。 */
function readlinkSafe(path) {
  try {
    return require('node:fs').readlinkSync(path)
  } catch {
    return ''
  }
}

/** 首次启动：把程序目录内置的 .credentials.yaml 复制进数据根（用户凭据只写数据根）。 */
function ensureCredentials() {
  const source = join(process.cwd(), '.credentials.yaml')
  const target = join(dataHome, '.credentials.yaml')
  if (existsSync(source) && !existsSync(target)) {
    try { copyFileSync(source, target) } catch { /* 只读场景忽略 */ }
  }
}
ensureCredentials()

/** 启动 DSH web 服务（数据根 = DSH_HOME + EVORESEARCH_DATA_ROOT；程序文件在 cwd）。 */
function startDsh() {
  const dshBin = join(process.cwd(), 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  const child = spawn(process.execPath, [dshBin, '--profile', 'evoresearch', '--port', '0'], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    env: {
      ...process.env,
      DSH_HOME: dataHome, // 会话/存储/凭据/profile 数据根
      EVORESEARCH_DATA_ROOT: dataHome, // 插件数据根（projects/.evoresearch-data/.tools）
    },
  })
  child.stdout.on('data', (chunk) => parseOutput(String(chunk)))
  child.stderr.on('data', (chunk) => process.stderr.write(chunk))
  return child
}

/** 从 dsh stdout 解析监听端口（JSON 行 {"port": N}、"Listening on ...:N" 或 "dsh web: http://127.0.0.1:N"）。 */
function parseOutput(chunk) {
  for (const line of chunk.split(/\r?\n/)) {
    const json = /{"port":\s*(\d+)}/.exec(line)
    if (json) {
      writePortFile(json[1])
      continue
    }
    const urlMatch = /http:\/\/127\.0\.0\.1:(\d+)/.exec(line)
    if (urlMatch) {
      writePortFile(urlMatch[1])
      continue
    }
    const listening = /:(\d{4,5})/.exec(line)
    if (listening && line.toLowerCase().includes('listen')) {
      writePortFile(listening[1])
    }
  }
}

/** 写端口文件（幂等）。 */
function writePortFile(port) {
  writeFileSync(portFile, JSON.stringify({ port: Number(port) }), 'utf8')
  console.log(`EvoResearch ready on port ${port}`)
}

const child = startDsh()

child.on('exit', (code) => {
  rmSync(portFile, { force: true })
  process.exit(code || 0)
})

process.on('exit', () => {
  try {
    child.kill()
  } catch {
    // 已退出
  }
})

// Windows 兜底：父进程（桌面壳）消失时自动退出，防孤儿进程
if (platform() === 'win32') {
  const ppid = process.ppid
  const timer = setInterval(() => {
    try {
      const alive = execSync(`tasklist /FI "PID eq ${ppid}" /FO CSV /NH`, { stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .includes(String(ppid))
      if (!alive) {
        clearInterval(timer)
        child.kill()
        process.exit(0)
      }
    } catch {
      // 探测失败时放弃
    }
  }, 5000)
}
