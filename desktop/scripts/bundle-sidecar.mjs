/**
 * sidecar 组装脚本：生成 desktop/sidecar/dist/ 目录（node.exe + app/ + launch.js）。
 *
 * 产物布局（构建期生成，不入库）：
 *   desktop/sidecar/dist/
 *   ├── node(.exe)        # 官方 Node（按当前平台下载：win-x64 / linux-x64 / darwin-{x64,arm64}）
 *   ├── launch.js         # 启动脚本（本目录同层复制）
 *   └── app/              # DSH profile 的 standalone 副本（node_modules 裁剪后）
 *
 * 步骤：
 * 1. 下载官方 Node 当前平台发行包，解压出 node 二进制；
 * 2. 用 `npm ci --omit=dev --production` 在临时目录安装
 *    dsh-base + dsh-web-app + @evoresearch/dsh-plugin（含 profiles/evoresearch 的 bundle 声明）；
 * 3. 裁剪：删除 SDK 测试套件、*.map、文档（deepseek profile 思路）；
 * 4. 复制 launch.js。
 *
 * 用法：node desktop/scripts/bundle-sidecar.mjs [--skip-download]
 *   --skip-download：使用已缓存的 node.exe（多次构建加速）。
 */
import { mkdirSync, copyFileSync, existsSync, rmSync, writeFileSync, readdirSync, readFileSync, statSync, chmodSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SIDECAR = join(ROOT, 'desktop', 'sidecar')
const DIST = join(SIDECAR, 'dist')
const NODE_VERSION = 'v24.19.0' // Node LTS（Krypton）；DSH rc.6 需要 ≥23（node:zlib zstd / node:sqlite）
// 按 host 平台选择官方发行包（CI 三平台桌面各跑一次本脚本，各自嵌入对应平台的 Node）
const NODE_DIST = (() => {
  switch (process.platform) {
    case 'win32': return { pkg: `node-${NODE_VERSION}-win-x64.zip`, sub: '' }
    case 'darwin': return process.arch === 'arm64'
      ? { pkg: `node-${NODE_VERSION}-darwin-arm64.tar.gz`, binary: 'node', sub: `node-${NODE_VERSION}-darwin-arm64/bin` }
      : { pkg: `node-${NODE_VERSION}-darwin-x64.tar.gz`, binary: 'node', sub: `node-${NODE_VERSION}-darwin-x64/bin` }
    default: return process.arch === 'arm64'
      ? { pkg: `node-${NODE_VERSION}-linux-arm64.tar.gz`, binary: 'node', sub: `node-${NODE_VERSION}-linux-arm64/bin` }
      : { pkg: `node-${NODE_VERSION}-linux-x64.tar.gz`, binary: 'node', sub: `node-${NODE_VERSION}-linux-x64/bin` }
  }
})()
const IS_WINDOWS = process.platform === 'win32'
const NODE_BINARY = IS_WINDOWS ? 'node.exe' : 'node'
const NODE_URL = `https://nodejs.org/dist/${NODE_VERSION}/${NODE_DIST.pkg}`
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

const archiveName = IS_WINDOWS ? 'node.zip' : NODE_DIST.pkg

if (!skipDownload) {
  step(`下载 Node ${NODE_VERSION}（${NODE_DIST.pkg}）`, () => {
    mkdirSync(CACHE, { recursive: true })
    // 统一用 curl（三平台 GitHub runner / Win10+ 均自带），避免 PowerShell 平台耦合
    const result = spawnSync('curl', ['-fL', '-o', join(CACHE, archiveName), NODE_URL], { stdio: 'inherit' })
    if (result.status !== 0) throw new Error('Node 下载失败（可手动下载后放入 .cache/ 并加 --skip-download）')
  })
} else {
  console.log('[bundle-sidecar] 跳过下载（--skip-download）')
}

step(`解压 ${NODE_BINARY}`, () => {
  const archive = join(CACHE, archiveName)
  if (!existsSync(archive)) {
    // 允许直接从已有 Node 安装复制（开发机加速）
    const local = IS_WINDOWS
      ? spawnSync('where', ['node'], { encoding: 'utf8' }).stdout.trim().split(/\r?\n/)[0]
      : spawnSync('sh', ['-c', 'command -v node'], { encoding: 'utf8' }).stdout.trim().split(/\r?\n/)[0]
    if (local) {
      copyFileSync(local, join(DIST, NODE_BINARY))
      return
    }
    throw new Error(`缺少 ${archiveName}，请先下载或使用 --skip-download`)
  }
  const extractDir = join(CACHE, 'extracted')
  rmSync(extractDir, { recursive: true, force: true })
  mkdirSync(extractDir, { recursive: true })
  // Windows 用系统自带 bsdtar（C:\Windows\System32\tar.exe，可解 zip）——
  // 不能裸调 `tar`：PATH 上 Git 的 GNU tar 会把 D:\... 当远程主机（"Cannot connect to D"）；
  // POSIX 用通用 tar -z
  const tarExe = IS_WINDOWS ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar'
  const extractArgs = IS_WINDOWS ? ['-xf', archive, '-C', extractDir] : ['-xzf', archive, '-C', extractDir]
  const result = spawnSync(tarExe, extractArgs, { stdio: 'inherit' })
  if (result.status !== 0) throw new Error('解压失败')
  if (IS_WINDOWS) {
    // win zip：node.exe 在版本目录内 node-vX.Y.Z-win-x64/node.exe（原 PowerShell
    // 方案靠"取首个子目录"定位；bsdtar 解包后同样按版本目录兜底）
    const versionDir = `node-${NODE_VERSION}-win-x64`
    copyFileSync(join(extractDir, versionDir, 'node.exe'), join(DIST, 'node.exe'))
  } else {
    // tar.gz：<pkg>/bin/node
    copyFileSync(join(extractDir, NODE_DIST.sub, 'node'), join(DIST, 'node'))
  }
})

step('组装 app/（DSH_HOME 布局 + 依赖）', () => {
  const appDir = join(DIST, 'app')
  const profileDir = join(appDir, 'profiles', 'evoresearch')
  mkdirSync(profileDir, { recursive: true })
  // 1) 部署清单（npm install 依赖声明）：放 app 根，node_modules 供 profiles 向上解析
  const deployPkg = {
    name: 'evoresearch-sidecar',
    version: '0.1.0-rc.1',
    private: true,
    dependencies: {
      '@deepseek-ai/dsh': '^0.1.0-rc.8', // dsh CLI（launch.js 直接调用其 bin）
      '@deepseek-ai/dsh-base': '^0.1.0-rc.8',
      '@deepseek-ai/dsh-web-app': '^0.1.0-rc.8', // 表面行复用其 /startup（web-startup 行）
      '@evoresearch/dsh-app': `file:${join(ROOT, 'packages', 'evoresearch-app')}`,
      '@evoresearch/dsh-plugin': `file:${join(ROOT, 'packages', 'evoresearch-plugin')}`,
    },
  }
  writeFileSync(join(appDir, 'package.json'), JSON.stringify(deployPkg, null, 2), 'utf8')
  // 2) profile 元数据（dsh --profile evoresearch 时读取）
  const profilePkg = JSON.parse(readFileUtf8(join(ROOT, 'profiles', 'evoresearch', 'package.json')))
  delete profilePkg.dependencies // 依赖由 app 根提供（profile 向上解析）
  writeFileSync(join(profileDir, 'package.json'), JSON.stringify(profilePkg, null, 2), 'utf8')
  writeFileSync(join(profileDir, 'cordis.patch.yml'), readFileUtf8(join(ROOT, 'profiles', 'evoresearch', 'cordis.patch.yml')), 'utf8')
  // 3) 安装依赖（--install-links：file: 依赖复制为真实目录而非 junction，
  //    保证打包后 app/node_modules/@evoresearch/* 是自包含目录）
  // NODE_OPTIONS=--max-old-space-size=4096：macOS runner 上 npm reify 阶段
  // 曾触发 V8 OOM（崩溃栈被 stdout 截断只剩帧 51+）；放宽堆上限兜底
  const result = spawnSync('npm', ['install', '--omit=dev', '--no-audit', '--no-fund', '--production', '--prefer-online', '--install-links'], {
    cwd: appDir,
    encoding: 'utf8',
    shell: true, // Windows 下 npm 是 npm.cmd，spawnSync 需要 shell 解析
    env: { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --max-old-space-size=4096`.trim() },
  })
  if (result.status !== 0) {
    console.error('[bundle-sidecar] npm install 失败，输出:')
    console.error(result.stdout?.slice(-4000))
    console.error(result.stderr?.slice(-4000))
    throw new Error('npm install 失败')
  }
  // 4) 清理 npm 嵌套安装生成的 profiles/node_modules（dsh 的 healProfilesModuleFallback
  //    要求该路径不存在或为它管理的 symlink；真实目录会导致启动报错）
  const nestedProfilesModules = join(appDir, 'profiles', 'node_modules')
  if (existsSync(nestedProfilesModules)) {
    rmSync(nestedProfilesModules, { recursive: true, force: true })
    console.log('[bundle-sidecar] 已清理 profiles/node_modules（嵌套安装产物）')
  }
  // 体积裁剪（deepseek profile 思路）：
  // 1) 删除未使用的 provider SDK（保留 openai/pi-ai 与 @deepseek-ai 核心）；
  // 2) 原生模块只保留当前平台的 prebuilds（node-pty/sharp 的其它平台产物占 ~65MB）。
  const nodeModules = join(appDir, 'node_modules')
  // provider SDK 裁剪：anthropic/google/mistral/aws 适配器按需惰性 import，
  // 不选这些 provider 就不加载（deepseek profile 语义）。
  // 保留：openai（pi-ai 用）、@deepseek-ai、@opentelemetry（遥测）、sharp（附件图片）。
  prunePackages(nodeModules, ['@anthropic-ai', '@google', '@mistralai', '@aws-sdk', '@aws-crypto', '@smithy', '@protobufjs'])
  pruneNativePrebuilds(nodeModules)
  // 裁剪体积：删除源码映射与文档
  pruneDir(appDir, ['.map', 'README.md', 'LICENSE', '.md', '.d.ts', 'debug.log'])
})

step('复制 launch.js', () => {
  copyFileSync(join(SIDECAR, 'launch.js'), join(DIST, 'launch.js'))
})

// POSIX 二进制需要可执行位（tar 保留；从本地 Node 复制的场景兜底）
if (!IS_WINDOWS) {
  try { chmodSync(join(DIST, 'node'), 0o755) } catch { /* 已可执行则忽略 */ }
}

console.log('[bundle-sidecar] 完成 → desktop/sidecar/dist/')

function readFileUtf8(p) {
  return readFileSync(p, 'utf8')
}

function pruneDir(dir, suffixes) {
  let entries = []
  try {
    entries = readdirSync(dir)
  } catch {
    return // 目录消失（符号链接目标已被裁剪等），跳过
  }
  for (const name of entries) {
    const full = join(dir, name)
    let stat
    try {
      stat = statSync(full)
    } catch {
      continue // .bin 下指向已删除包的悬空符号链接：stat 失败即跳过
    }
    if (stat.isDirectory()) {
      pruneDir(full, suffixes)
    } else if (suffixes.some((s) => name.endsWith(s))) {
      rmSync(full, { force: true })
    }
  }
}

/** 删除指定包目录（整体，含 @scope 下的子包），并清理 .bin 里指向它们的悬空链接。 */
function prunePackages(nodeModules, packages) {
  for (const name of packages) {
    const target = join(nodeModules, name)
    if (existsSync(target)) {
      const size = dirSize(target)
      rmSync(target, { recursive: true, force: true })
      console.log(`[bundle-sidecar] 裁剪 ${name}（-${Math.round(size / 1024 / 1024)} MB）`)
    }
  }
  // tauri resources 打包要求 glob 全部存在：删包后 .bin 的悬空符号链接会让
  // `../sidecar/dist/**/*` 收集失败（"resource path doesn't exist"），一并移除
  const binDir = join(nodeModules, '.bin')
  if (existsSync(binDir)) {
    for (const entry of readdirSync(binDir)) {
      const full = join(binDir, entry)
      try {
        statSync(full) // 悬空链接 stat 抛 ENOENT
      } catch {
        rmSync(full, { force: true })
        console.log(`[bundle-sidecar] 清理悬空 .bin 链接 ${entry}`)
      }
    }
  }
}

/** 当前平台的 prebuild 目录名（node-pty / @img/sharp 命名约定）。 */
function nativePrebuildPlatform() {
  switch (process.platform) {
    case 'win32': return `win32-${process.arch === 'arm64' ? 'arm64' : 'x64'}`
    case 'darwin': return `darwin-${process.arch === 'arm64' ? 'arm64' : 'x64'}`
    default: return `linux-${process.arch === 'arm64' ? 'arm64' : 'x64'}`
  }
}

/** 原生模块 prebuilds 只保留当前平台（node-pty / @img/sharp 等）。 */
function pruneNativePrebuilds(nodeModules) {
  const keep = nativePrebuildPlatform()
  // node-pty prebuilds：只留当前平台
  const pty = join(nodeModules, 'node-pty', 'prebuilds')
  if (existsSync(pty)) {
    for (const entry of readdirSync(pty)) {
      const full = join(pty, entry)
      if (!statSync(full).isDirectory()) continue
      if (entry === keep) continue
      rmSync(full, { recursive: true, force: true })
      console.log(`[bundle-sidecar] 裁剪 node-pty prebuild ${entry}`)
    }
  }
  // @img/sharp：只删非当前平台的 sharp 包（保留当前平台与工具包如 colour）
  const img = join(nodeModules, '@img')
  if (existsSync(img)) {
    for (const entry of readdirSync(img)) {
      if (!/@?sharp/.test(entry)) continue
      if (entry.includes(keep) || !/(linux|darwin|win32)/.test(entry)) continue
      const full = join(img, entry)
      if (!statSync(full).isDirectory()) continue
      const size = dirSize(full)
      rmSync(full, { recursive: true, force: true })
      console.log(`[bundle-sidecar] 裁剪 @img/${entry}（-${Math.round(size / 1024 / 1024)} MB）`)
    }
  }
}

/** 目录总字节数。 */
function dirSize(dir) {
  let total = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) total += dirSize(full)
    else if (entry.isFile()) total += statSync(full).size
  }
  return total
}
