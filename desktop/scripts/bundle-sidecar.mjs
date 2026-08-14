/**
 * sidecar 组装脚本：生成 desktop/sidecar/dist/ 目录（node.exe + app/ + launch.js）。
 *
 * 产物布局（构建期生成，不入库）：
 *   desktop/sidecar/dist/
 *   ├── node.exe          # 官方 Windows x64 Node（LZMA 压缩后 ~35-45MB）
 *   ├── launch.js         # 启动脚本（本目录同层复制）
 *   └── app/              # DSH profile 的 standalone 副本（node_modules 裁剪后）
 *
 * 步骤：
 * 1. 下载官方 Node Windows x64 zip（可用镜像），解压出 node.exe；
 * 2. 用 `npm ci --omit=dev --production` 在临时目录安装
 *    dsh-base + dsh-web-app + @evoscientist/dsh-plugin（含 profiles/evoscientist 的 bundle 声明）；
 * 3. 裁剪：删除 SDK 测试套件、*.map、文档（对应原 EvoScientist build.py 的 deepseek profile 思路）；
 * 4. 复制 launch.js。
 *
 * 用法：node desktop/scripts/bundle-sidecar.mjs [--skip-download]
 *   --skip-download：使用已缓存的 node.exe（多次构建加速）。
 */
import { mkdirSync, copyFileSync, existsSync, rmSync, writeFileSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SIDECAR = join(ROOT, 'desktop', 'sidecar')
const DIST = join(SIDECAR, 'dist')
const NODE_VERSION = 'v22.14.0' // 官方 LTS（与 engines 匹配：node:sqlite 需 ≥22.5）
const NODE_URL = `https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-win-x64.zip`
const CACHE = join(SIDECAR, '.cache')

function step(label, fn) {
  console.log(`[bundle-sidecar] ${label}`)
  return fn()
}

const skipDownload = process.argv.includes('--skip-download')

step('清理旧产物', () => {
  rmSync(DIST, { recursive: true, force: true })
  mkdirSync(DIST, { recursive: true })
})

if (!skipDownload) {
  step(`下载 Node ${NODE_VERSION}（win-x64）`, () => {
    mkdirSync(CACHE, { recursive: true })
    const zip = join(CACHE, 'node.zip')
    const result = spawnSync('powershell', ['-NoProfile', '-Command', `Invoke-WebRequest -Uri '${NODE_URL}' -OutFile '${zip}'`], { stdio: 'inherit' })
    if (result.status !== 0) throw new Error('Node 下载失败（可手动下载后放入 .cache/node.zip 并加 --skip-download）')
  })
} else {
  console.log('[bundle-sidecar] 跳过下载（--skip-download）')
}

step('解压 node.exe', () => {
  const zip = join(CACHE, 'node.zip')
  if (!existsSync(zip)) {
    // 允许直接从已有 Node 安装复制（开发机加速）
    const local = spawnSync('where', ['node'], { encoding: 'utf8' }).stdout.trim().split(/\r?\n/)[0]
    if (local) {
      copyFileSync(local, join(DIST, 'node.exe'))
      return
    }
    throw new Error('缺少 node.zip，请先下载或使用 --skip-download')
  }
  const extractDir = join(CACHE, 'extracted')
  rmSync(extractDir, { recursive: true, force: true })
  const result = spawnSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -Force '${zip}' '${extractDir}'`], { stdio: 'inherit' })
  if (result.status !== 0) throw new Error('解压失败')
  const inner = readdirSync(extractDir)[0]
  copyFileSync(join(extractDir, inner, 'node.exe'), join(DIST, 'node.exe'))
})

step('组装 app/（standalone profile + 依赖）', () => {
  const appDir = join(DIST, 'app')
  mkdirSync(appDir, { recursive: true })
  // 以 profiles/evoscientist 为蓝本生成 standalone package.json（dsh profile 元数据）
  const profilePkg = JSON.parse(readFileUtf8(join(ROOT, 'profiles', 'evoscientist', 'package.json')))
  profilePkg.dependencies['@evoscientist/dsh-plugin'] = `file:${join(ROOT, 'packages', 'evoscientist-plugin')}`
  writeFileSync(join(appDir, 'package.json'), JSON.stringify(profilePkg, null, 2), 'utf8')
  writeFileSync(join(appDir, 'cordis.patch.yml'), readFileUtf8(join(ROOT, 'profiles', 'evoscientist', 'cordis.patch.yml')), 'utf8')
  const result = spawnSync('npm', ['install', '--omit=dev', '--no-audit', '--no-fund', '--production'], {
    cwd: appDir,
    stdio: 'inherit',
  })
  if (result.status !== 0) throw new Error('npm install 失败')
  // 裁剪体积：删除源码映射与文档
  pruneDir(appDir, ['.map', 'README.md', 'LICENSE'])
})

step('复制 launch.js', () => {
  copyFileSync(join(SIDECAR, 'launch.js'), join(DIST, 'launch.js'))
})

console.log('[bundle-sidecar] 完成 → desktop/sidecar/dist/')

function readFileUtf8(p) {
  return readFileSync(p, 'utf8')
}

function pruneDir(dir, suffixes) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      pruneDir(full, suffixes)
    } else if (suffixes.some((s) => name.endsWith(s))) {
      rmSync(full, { force: true })
    }
  }
}
