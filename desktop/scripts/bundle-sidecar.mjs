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
 *    dsh-base + dsh-web-app + @evoresearch/dsh-plugin（含 profiles/evoresearch 的 bundle 声明）；
 * 3. 裁剪：删除 SDK 测试套件、*.map、文档（对应上游 EvoScientist build.py 的 deepseek profile 思路）；
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
const NODE_VERSION = 'v24.19.0' // Node LTS（Krypton）；DSH rc.6 需要 ≥23（node:zlib zstd / node:sqlite）
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
      '@deepseek-ai/dsh': '^0.1.0-rc.6', // dsh CLI（launch.js 直接调用其 bin）
      '@deepseek-ai/dsh-base': '^0.1.0-rc.6',
      '@deepseek-ai/dsh-web-app': '^0.1.0-rc.6',
      '@evoresearch/dsh-plugin': `file:${join(ROOT, 'packages', 'evoresearch-plugin')}`,
    },
  }
  writeFileSync(join(appDir, 'package.json'), JSON.stringify(deployPkg, null, 2), 'utf8')
  // 2) profile 元数据（dsh --profile evoresearch 时读取）
  const profilePkg = JSON.parse(readFileUtf8(join(ROOT, 'profiles', 'evoresearch', 'package.json')))
  delete profilePkg.dependencies // 依赖由 app 根提供（profile 向上解析）
  writeFileSync(join(profileDir, 'package.json'), JSON.stringify(profilePkg, null, 2), 'utf8')
  writeFileSync(join(profileDir, 'cordis.patch.yml'), readFileUtf8(join(ROOT, 'profiles', 'evoresearch', 'cordis.patch.yml')), 'utf8')
  // 3) 安装依赖
  const result = spawnSync('npm', ['install', '--omit=dev', '--no-audit', '--no-fund', '--production'], {
    cwd: appDir,
    encoding: 'utf8',
    shell: true, // Windows 下 npm 是 npm.cmd，spawnSync 需要 shell 解析
  })
  if (result.status !== 0) {
    console.error('[bundle-sidecar] npm install 失败，输出:')
    console.error(result.stdout?.slice(-2000))
    console.error(result.stderr?.slice(-2000))
    throw new Error('npm install 失败')
  }
  // 4) 清理 npm 嵌套安装生成的 profiles/node_modules（dsh 的 healProfilesModuleFallback
  //    要求该路径不存在或为它管理的 symlink；真实目录会导致启动报错）
  const nestedProfilesModules = join(appDir, 'profiles', 'node_modules')
  if (existsSync(nestedProfilesModules)) {
    rmSync(nestedProfilesModules, { recursive: true, force: true })
    console.log('[bundle-sidecar] 已清理 profiles/node_modules（嵌套安装产物）')
  }
  // 体积裁剪（deepseek profile 思路，对应上游 EvoScientist build.py 的 --profile deepseek）：
  // 1) 删除未使用的 provider SDK（保留 openai/pi-ai 与 @deepseek-ai 核心）；
  // 2) 原生模块只保留 win32-x64 prebuilds（node-pty/sharp 的 linux/darwin 产物占 ~65MB）。
  const nodeModules = join(appDir, 'node_modules')
  // provider SDK 裁剪：anthropic/google/mistral/aws 适配器按需惰性 import，
  // 不选这些 provider 就不加载（与上游 EvoScientist build.py --profile deepseek 语义一致）。
  // 保留：openai（pi-ai 用）、@deepseek-ai、@opentelemetry（遥测）、sharp（附件图片）。
  prunePackages(nodeModules, ['@anthropic-ai', '@google', '@mistralai', '@aws-sdk', '@aws-crypto', '@smithy', '@protobufjs'])
  pruneNativePrebuilds(nodeModules)
  // 裁剪体积：删除源码映射与文档
  pruneDir(appDir, ['.map', 'README.md', 'LICENSE', '.md', '.d.ts', 'debug.log'])
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

/** 删除指定包目录（整体，含 @scope 下的子包）。 */
function prunePackages(nodeModules, packages) {
  for (const name of packages) {
    const target = join(nodeModules, name)
    if (existsSync(target)) {
      const size = dirSize(target)
      rmSync(target, { recursive: true, force: true })
      console.log(`[bundle-sidecar] 裁剪 ${name}（-${Math.round(size / 1024 / 1024)} MB）`)
    }
  }
}

/** 原生模块 prebuilds 只保留 win32-x64（node-pty / @img/sharp 等）。 */
function pruneNativePrebuilds(nodeModules) {
  // node-pty prebuilds：只留 win32-x64
  const pty = join(nodeModules, 'node-pty', 'prebuilds')
  if (existsSync(pty)) {
    for (const entry of readdirSync(pty)) {
      const full = join(pty, entry)
      if (!statSync(full).isDirectory()) continue
      if (entry === 'win32-x64') continue
      rmSync(full, { recursive: true, force: true })
      console.log(`[bundle-sidecar] 裁剪 node-pty prebuild ${entry}`)
    }
  }
  // @img/sharp：只删 linux/darwin 平台包（保留 win32-x64 与工具包如 colour）
  const img = join(nodeModules, '@img')
  if (existsSync(img)) {
    for (const entry of readdirSync(img)) {
      if (!/sharp.*(linux|darwin)/.test(entry)) continue
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
