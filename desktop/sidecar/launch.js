/**
 * sidecar 启动脚本（由桌面壳 spawn；CommonJS，node.exe 直接运行）：
 * 1. 启动 DSH web profile（evoresearch），绑定 127.0.0.1 随机端口；
 * 2. 将端口写入 %LOCALAPPDATA%/EvoResearch/port.json（壳轮询读取）；
 * 3. 进程退出时清理端口文件；Windows 下父进程消失时自动退出（防孤儿）。
 */
'use strict'
const { spawn, execSync } = require('node:child_process')
const { writeFileSync, rmSync, mkdirSync } = require('node:fs')
const { join } = require('node:path')
const { platform } = require('node:os')

const APP_NAME = 'EvoResearch'
// 端口文件路径：优先取壳通过环境变量传入的路径，回退到 %LOCALAPPDATA%/<identifier>
const dataDir = process.env.EVORESEARCH_PORT_FILE
  ? require('node:path').dirname(process.env.EVORESEARCH_PORT_FILE)
  : join(process.env.LOCALAPPDATA || process.env.HOME || '.', 'com.evoresearch.desktop')
const portFile = process.env.EVORESEARCH_PORT_FILE || join(dataDir, 'port.json')

mkdirSync(dataDir, { recursive: true })

/** 启动 DSH web 服务（当前目录即打包后的 DSH_HOME 根：profiles/ + node_modules/）。 */
function startDsh() {
  const dshBin = join(process.cwd(), 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  const child = spawn(process.execPath, [dshBin, '--profile', 'evoresearch', '--port', '0'], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    env: {
      ...process.env,
      DSH_HOME: process.cwd(), // 独立数据根：profiles/ 与 node_modules 都在 sidecar 内
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
