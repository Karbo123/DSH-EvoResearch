/**
 * 自然有机风（Natural Organic）风格守卫 —— CI 用，可机械校验的"禁止项 + 令牌 + 对比度"三关。
 *
 * 为什么需要它：风格漂移往往是"某次改动顺手写了一个 #066679 或 border-radius: 8px"造成的。
 * 本脚本把风格规则变成可执行断言：
 *   ① 禁止项扫描（纯黑 / 冷色主调 / 霓虹高饱和 / 线性渐变 / 重阴影 / 正圆直角 / 被禁字体）
 *   ② 令牌完整性（浅深两套色盘、形状、字体、动效、纹理令牌必须齐备）
 *   ③ 调色板唯一性（全站 hex 必须出自令牌调色板或登记过的例外：标签盘 / Monaco 主题）
 *   ④ 文本对比度（WCAG 2.1 AA ≥ 4.5:1）
 * 用法：node scripts/check-organic-style.mjs
 * 方案与验收：docs/06-natural-organic.md
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CLIENT = join(ROOT, 'packages', 'evoresearch-app', 'src', 'client')
const STYLES = join(CLIENT, 'styles.ts')

/** 第三方 vendor 样式：不参与色值归属校验（可见色已由令牌覆盖） */
const VENDOR = new Set(['monaco-css.ts', 'xyflow-css.ts', 'chatgraph-fonts.ts'])
/** 允许自带色值的文件：会话标签盘 / Monaco 主题（均为登记过的大地色，见下） */
const PALETTE_EXCEPTIONS = new Set(['threadlist.ts', 'tab-monaco.ts'])

const problems = []
const notes = []
const fail = (msg) => problems.push(msg)

// ───────────────────────── 读取源码 ─────────────────────────
const styles = readFileSync(STYLES, 'utf8')
const clientFiles = readdirSync(CLIENT).filter((f) => /\.tsx?$/.test(f))

/** 去注释（换成空格，保留换行与列位置）：风格规则只管代码，不管文档里引用的历史色值 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length))
}
const stylesCode = stripComments(styles)
const codeOf = (file) => (file === 'styles.ts' ? stylesCode : stripComments(readFileSync(join(CLIENT, file), 'utf8')))
/** 静态资源（svg 等）也按同一条调色板规则校验 */
const ASSET_DIR = join(ROOT, 'packages', 'evoresearch-app', 'frontend')
const assetFiles = readdirSync(ASSET_DIR).filter((f) => f.endsWith('.svg')).map((f) => `../frontend/${f}`)
const assetCodeOf = (rel) => readFileSync(join(ASSET_DIR, rel.replace('../frontend/', '')), 'utf8')

// ───────────────────────── ① 禁止项扫描 ─────────────────────────
/** [正则, 说明, 豁免判断(行文本) => 是否豁免] */
const FORBIDDEN = [
  [/#000000\b|#000\b|rgb\(0 0 0|rgba\(0,\s*0,\s*0|:\s*black\b/, '纯黑（含纯黑阴影/遮罩）', () => false],
  [/\bInter\b|\bRoboto\b|\bGeist\b/, '被禁字体（Inter / Roboto / Geist）', () => false],
  [/linear-gradient/, '线性渐变（风格禁止 bg-gradient-to-*；画布光斑改用 radial）', () => false],
  [/border-radius:\s*(?:50|100)%/, '正圆（改用 --r-dot blob）', () => false],
  [/border-radius:\s*[0-5]px|border-radius:\s*0\b(?!\s*0)/, '直角/尖锐小圆角（改用 --r-2xs 及以上）', (l) => /evo-modal-full|pre code/.test(l)],
  [/box-shadow:[^;]*\b(?:4[0-9]|[5-9][0-9]|1[0-9]{2})px/, '重阴影（shadow-xl 级；统一用 --shadow-sm/md/lg）', (l) => /--shadow-lg/.test(l)],
  [/font-family:\s*-apple-system|-apple-system[^;]*Roboto/, '系统默认字体栈（改用 --font-sans）', () => false],
]
for (const [re, label, exempt] of FORBIDDEN) {
  const lines = stylesCode.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (re.test(line) && !exempt(line)) fail(`禁止项[${label}] styles.ts:${i + 1}: ${line.trim().slice(0, 110)}`)
  }
}

// 冷色主调（蓝/紫/青 色相 190°–300°，饱和度 > 12%）：全站（vendor 除外）逐 hex 校验
const hexToRgb = (h) => {
  const s = h.replace('#', '')
  const n = s.length === 3 ? s.split('').map((c) => c + c).join('') : s
  return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16))
}
const hueSat = (h) => {
  const [r, g, b] = hexToRgb(h).map((v) => v / 255)
  const mx = Math.max(r, g, b)
  const mn = Math.min(r, g, b)
  const l = (mx + mn) / 2
  const d = mx - mn
  if (d === 0) return [null, 0, l]
  let hue
  if (mx === r) hue = ((g - b) / d) % 6
  else if (mx === g) hue = (b - r) / d + 2
  else hue = (r - g) / d + 4
  hue = Math.round(((hue * 60) + 360) % 360)
  const sat = (l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn)) * 100
  return [hue, sat, l]
}

/** 登记过的例外色值（标签盘 8 色 + Monaco 主题 + Win11 关闭约定色） */
const EXCEPTION_HEX = new Set([
  '#c0563a', '#cf8b3a', '#bda43f', '#7d9163', '#5f8b7d', '#9c6b4f', '#8a7355', '#cbb184',
  '#3b3226', '#8a8072', '#8a5f2b', '#5d7a45', '#8f6019', '#a4472f', '#3f6f63', '#7d5a2e',
  '#6b5f50', '#fffdf9', '#b5a894', '#5b6d43', '#e3e8d6', '#efe5d8', '#f7f1e7', '#5c4033',
  '#e9e0d4', '#e2d8c8', '#c9bca8', '#f0e9dd', '#9d9182', '#d4a373', '#a3bd82', '#d9b45e',
  '#d9836b', '#8fbfab', '#cf9a6a', '#c2b6a4', '#201c17', '#6f6455', '#a9bf8e', '#3f4a33',
  '#352d24', '#262119', '#c08a5e', '#3a3228', '#241f19', '#7d7260', '#c42b1c', '#221d18',
  '#d8cdbb', '#efe6d8', '#faf6f1', '#16130f', '#1e1b16', '#292420', '#17140f',
])
/** 调色板白名单 = 令牌层定义的全部色值（浅 + 深）∪ 登记例外。
    规则：styles.ts 之外出现的任何 hex 必须是"令牌里有的"或"登记过的"，杜绝随手写色。 */
const tokenPalette = new Set(
  [...styles.slice(styles.indexOf(':root {'), styles.indexOf('* { box-sizing')).matchAll(/:\s*(#[0-9a-fA-F]{3,8})\s*[;)]/g)].map((m) => m[1].toLowerCase()),
)
const allowedHex = new Set([...tokenPalette, ...EXCEPTION_HEX])
for (const file of [...clientFiles, ...assetFiles]) {
  if (VENDOR.has(file)) continue
  const lines = (file.startsWith('../frontend/') ? assetCodeOf(file) : codeOf(file)).split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    const found = lines[i].match(/#[0-9a-fA-F]{3,8}\b/g) ?? []
    for (const hex of found) {
      const [hue, sat, light] = hueSat(hex)
      const where = `${file}:${i + 1}`
      if (hue !== null && hue >= 190 && hue <= 300 && sat > 12) {
        fail(`禁止项[冷色主调 色相 ${hue}°] ${where}: ${hex}`)
        continue
      }
      // 高饱和只在中等明度区间判定（#fffdf9 这类近白色 L 接近 1，HSL 饱和度无意义）
      if (sat > 78 && light > 0.12 && light < 0.9) {
        fail(`禁止项[霓虹高饱和 ${sat.toFixed(0)}%] ${where}: ${hex}`)
        continue
      }
      // styles.ts 的令牌块是唯一色值来源；其他文件只允许令牌值或登记例外
      if (file !== 'styles.ts' && !PALETTE_EXCEPTIONS.has(file) && !allowedHex.has(hex.toLowerCase())) {
        fail(`色值漂移[未登记] ${where}: ${hex}（请改用令牌或加入调色板）`)
      }
    }
  }
}

// ───────────────────────── ② 令牌完整性 ─────────────────────────
/** 浅色必须全量定义 */
const REQUIRED_ROOT = [
  '--color-background', '--color-surface', '--color-text-primary', '--color-text-secondary',
  '--color-text-tertiary', '--color-border', '--color-border-light',
  '--color-success', '--color-warning', '--color-error', '--color-info',
  '--accent-sage', '--accent-tan', '--accent-mist', '--accent-teal',
  '--brand', '--brand-hover', '--brand-solid', '--brand-foreground', '--focus-ring',
  '--surface-raised', '--strip-bg', '--input-bg', '--hover-bg',
  '--r-2xs', '--r-xs', '--r-sm', '--r-md', '--r-lg', '--r-xl', '--r-pill', '--r-blob', '--r-blob-lg', '--r-dot',
  '--r-pebble-sm', '--r-pebble', '--r-bubble-ai', '--r-bubble-user', '--sprig',
  '--font-sans', '--font-serif', '--font-mono',
  '--ease-organic', '--dur-organic', '--dur-morph', '--dur-quick',
  '--shadow-sm', '--shadow-md', '--shadow-lg', '--organic-grain', '--scrim',
  '--titlebar-bg', '--titlebar-border', '--titlebar-fg', '--titlebar-accent', '--strip-bg', '--surface-raised',
]
/** 深色必须重定义（形状/字体/动效令牌由 :root 继承，无需重复） */
const REQUIRED_DARK = [
  '--color-background', '--color-surface', '--input-bg', '--hover-bg',
  '--color-text-primary', '--color-text-secondary', '--color-text-tertiary', '--color-text-placeholder',
  '--color-border', '--color-border-light', '--color-text-placeholder',
  '--color-success', '--color-warning', '--color-error', '--color-info',
  '--accent-sage', '--accent-tan', '--accent-mist', '--accent-teal', '--accent-tan-ink', '--accent-teal-ink',
  '--brand', '--brand-hover', '--brand-solid', '--brand-foreground', '--focus-ring',
  '--surface-raised', '--strip-bg', '--input-bg', '--hover-bg',
  '--shadow-sm', '--shadow-md', '--shadow-lg', '--organic-grain', '--scrim',
  '--titlebar-bg', '--titlebar-border', '--titlebar-fg',
  '--graph-canvas', '--graph-node-surface', '--graph-node-title', '--graph-handle',
  '--graph-chat', '--graph-memory', '--graph-global', '--graph-resource', '--graph-trace',
]
const rootBlock = styles.slice(styles.indexOf(':root {'), styles.indexOf('html.dark {'))
const darkBlock = styles.slice(styles.indexOf('html.dark {'), styles.indexOf('* { box-sizing'))
/** 令牌块结束行号（用于"裸圆角字面量"检查时豁免令牌定义本身） */
const darkEndLine = styles.slice(0, styles.indexOf('* { box-sizing')).split('\n').length
for (const tok of REQUIRED_ROOT) {
  if (!rootBlock.includes(`${tok}:`)) fail(`令牌缺失[浅色] ${tok}`)
}
for (const tok of REQUIRED_DARK) {
  if (!darkBlock.includes(`${tok}:`)) fail(`令牌缺失[深色] ${tok}`)
}

// 组件层（组件复用）：分组选择器里必须出现这些类名
const REQUIRED_COMPONENTS = ['.evo-pop', '.evo-pop-item', '.evo-btn-primary', '.evo-btn-outline', '.evo-field', '.evo-chip', '.evo-card', '.evo-avatar', '.evo-dot', '.evo-serif']
for (const cls of REQUIRED_COMPONENTS) {
  if (!styles.includes(`${cls},`) && !styles.includes(`${cls} `) && !styles.includes(`${cls}{`) && !styles.includes(`${cls} {`)) {
    fail(`组件层缺失 ${cls}（同类控件应在组件层统一定义）`)
  }
}
// 组件层必须自带完整外观：.evo-btn 基础态必须有底色与描边，否则会回退成浏览器默认按钮
// （历史回归：漏了 border/background，界面上出现 2px 黑边灰底的系统按钮）。
const btnGroup = styles.slice(styles.indexOf('.evo-btn,'), styles.indexOf('.evo-btn:hover'))
if (!/background:/.test(btnGroup) || !/border:/.test(btnGroup)) {
  fail('组件层 .evo-btn 基础态缺少 background/border（会回退浏览器默认外观）')
}
// 禁止 hover 改圆角（Organic Morphing 在密集界面里读起来像渲染抖动，已废弃该动效）
{
  const codeLines = stylesCode.split('\n')
  for (let i = 0; i < codeLines.length; i += 1) {
    if (/:hover[^{]*\{[^}]*border-radius/.test(codeLines[i])) {
      fail(`禁止 hover 改圆角 styles.ts:${i + 1}: ${codeLines[i].trim().slice(0, 90)}`)
    }
  }
}
// 禁止裸圆角字面量（令牌块之外必须用 --r-* / --graph-node-radius 令牌）
{
  const codeLines = stylesCode.split('\n')
  for (let i = 0; i < codeLines.length; i += 1) {
    const line = codeLines[i]
    if (i < darkEndLine) continue
    // 豁免：全屏面板（本身就是视口）与 <pre> 内联代码（直角是代码块几何的一部分）
    if (/evo-modal-full|pre code/.test(line)) continue
    if (/border(?:-(?:top|bottom|left|right)){0,2}-radius:\s*(?:\d+(?:\.\d+)?(?:px|rem)|\d+%|0)\s*[;}]/.test(line)) {
      fail(`裸圆角字面量 styles.ts:${i + 1}: ${line.trim().slice(0, 90)}（请用 --r-* 令牌）`)
    }
  }
}

// 组件层必须位于业务规则之前（后面的具体规则才能覆盖尺寸）
const firstComponent = styles.indexOf('.evo-pop,')
const firstBiz = styles.indexOf('.evo-topbar {')
if (firstComponent < 0 || firstBiz < 0 || firstComponent > firstBiz) fail('组件层位置异常：应位于业务规则之前')

// ───────────────────────── ③ 回归守卫（踩过的坑不再复发） ─────────────────────────
/** ① 图标类名不得带 evo-pop-item：该类给 <img> 加 display:flex，Chromium 下替换元素
    内容不绘制 → 弹出菜单里的应用图标整排消失（实测踩过）。 */
for (const file of clientFiles) {
  if (VENDOR.has(file)) continue
  const lines = readFileSync(join(CLIENT, file), 'utf8').split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    if (/evo-pop-item[^'"]*icon/.test(lines[i])) {
      fail(`回归[图标被误挂 evo-pop-item] ${file}:${i + 1}（<img> 会因 display:flex 不绘制）`)
    }
  }
}
/** ② 列表标记按父容器（ul/ol）判定：li[data-list-type] 会被 Milkdown 有序列表输入规则
    留下的默认值（bullet）带偏，把 "1. " 显示成圆点（实测踩过）。 */
if (/li\[data-list-type=/.test(stylesCode)) {
  fail('回归[列表标记按 li 属性判定] styles.ts：应使用 ul > li / ol > li 容器判定')
}
for (const need of ['.evo-composer-editor-host .milkdown .ProseMirror ul > li', '.evo-composer-editor-host .milkdown .ProseMirror ol > li']) {
  if (!styles.includes(need)) fail(`缺失[列表标记规则] ${need}`)
}

// ───────────────────────── ④ 文本对比度（AA ≥ 4.5） ─────────────────────────
const lum = (h) => {
  const [r, g, b] = hexToRgb(h).map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a, b) => {
  const la = lum(a)
  const lb = lum(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}
const tokenOf = (block, name) => {
  const m = block.match(new RegExp(`\\${name}:\\s*(#[0-9a-fA-F]{3,8})`))
  return m === null ? null : m[1]
}
/** 令牌值解析：支持 #hex 与 color-mix(in srgb, var(--X) p%, transparent) 半透明洗
 *  （半透明色按"叠加在最亮实心面"的最坏情况合成，这样洗色不会成为对比度盲区）。 */
const resolveColor = (value, block, base) => {
  if (value === null) return null
  const v = value.trim()
  if (/^#[0-9a-fA-F]{3,8}$/.test(v)) return v
  const mix = v.match(/^color-mix\(in srgb,\s*var\((--[a-z-]+)\)\s+([\d.]+)%,\s*transparent\)$/i)
  if (mix !== null && base !== null) {
    const inner = tokenOf(block, mix[1])
    if (inner === null) return null
    const p = Number(mix[2]) / 100
    const a = hexToRgb(inner)
    const b = hexToRgb(base)
    const out = a.map((x, i) => Math.round(x * p + b[i] * (1 - p)))
    return '#' + out.map((x) => x.toString(16).padStart(2, '0')).join('')
  }
  return null
}
/** 文本令牌 × 实心面令牌：主/次/三/占位/语义色在所有可能出现文字的面上都要 AA。
 *  hover 洗色按"叠在最亮实心面"的合成结果一并校验（避免"抬亮表面后次要文字掉 AA"）。 */
const TEXT_TOKENS = [
  '--color-text-primary', '--color-text-secondary', '--color-text-tertiary', '--color-text-placeholder',
  '--brand', '--color-success', '--color-warning', '--color-error', '--color-info',
  '--accent-tan-ink', '--accent-teal-ink',
]
const SURFACE_TOKENS = ['--color-background', '--color-surface', '--surface-raised']
for (const [name, block] of [['浅色', rootBlock], ['深色', darkBlock]]) {
  const raised = tokenOf(block, '--surface-raised')
  for (const fg of TEXT_TOKENS) {
    for (const bg of SURFACE_TOKENS) {
      const f = tokenOf(block, fg)
      const b = tokenOf(block, bg)
      if (f === null || b === null) { fail(`对比度检查缺令牌 ${name} ${fg}/${bg}`); continue }
      const r = contrast(f, b)
      if (r < 4.5) fail(`对比度不足[${name}] ${fg} on ${bg} = ${r.toFixed(2)}（需 ≥ 4.5）`)
      else notes.push(`${name} ${fg}/${bg} ${r.toFixed(2)}`)
    }
    // 悬停洗色：合成到最亮实心面上再判
    const hoverRaw = block.slice(block.indexOf('--hover-bg:'))
    const hoverVal = (hoverRaw.match(/^--hover-bg:\s*([^;]+);/) ?? [])[1] ?? null
    const hoverComposite = resolveColor(hoverVal, block, raised)
    if (hoverComposite !== null) {
      const f = tokenOf(block, fg)
      const r = contrast(f, hoverComposite)
      if (r < 4.5) fail(`对比度不足[${name} 悬停面 ${hoverComposite}] ${fg} = ${r.toFixed(2)}（需 ≥ 4.5）`)
      else notes.push(`${name} ${fg}/hover ${r.toFixed(2)}`)
    }
  }
  const pair = [['--color-user-message', '--color-user-message-bg'], ['--brand-foreground', '--brand-solid']]
  for (const [fg, bg] of pair) {
    const f = tokenOf(block, fg)
    const b = tokenOf(block, bg)
    if (f === null || b === null) { fail(`对比度检查缺令牌 ${name} ${fg}/${bg}`); continue }
    const r = contrast(f, b)
    if (r < 4.5) fail(`对比度不足[${name}] ${fg} on ${bg} = ${r.toFixed(2)}（需 ≥ 4.5）`)
    else notes.push(`${name} ${fg}/${bg} ${r.toFixed(2)}`)
  }
}

// ───────────────────────── ⑤ 深色层次阶梯（可辨性） ─────────────────────────
/** CIE Lab 明度：两个大色块"看不出是两个颜色"的本质是 ΔL* 太小。
 *  这里把"页面 / 卡片 / 浮层 / 输入 / 页签条"的相邻关系写成可失败断言：
 *  深色主题相邻面 ΔL* ≥ 4.5（实测标定值见 docs/06 §10），浅色主题的实心面差异
 *  由阴影与描边承担，只要求页面↔条 ≥ 3.5。 */
const lstar = (h) => {
  const [r, g, b] = hexToRgb(h).map((v) => v / 255)
  const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  const Y = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  return 116 * f(Y) - 16
}
const LADDER_CHECKS = [
  ['深色', darkBlock, [
    ['--color-background', '--color-surface', 4.5, '页面 → 卡片'],
    ['--color-surface', '--surface-raised', 4.5, '卡片 → 浮层'],
    ['--color-background', '--strip-bg', 4.5, '页面 → 页签条'],
    ['--input-bg', '--color-surface', 4.5, '输入（凹陷）→ 卡片'],
  ]],
  ['浅色', rootBlock, [
    ['--color-background', '--strip-bg', 3.5, '页面 → 页签条'],
    ['--hover-bg', '--color-background', 3.5, '悬停面 → 页面'],
  ]],
]
for (const [name, block, pairs] of LADDER_CHECKS) {
  for (const [a, b, min, label] of pairs) {
    const ca = tokenOf(block, a)
    const cb = tokenOf(block, b)
    if (ca === null || cb === null) { fail(`层次检查缺令牌 ${name} ${a}/${b}`); continue }
    const d = Math.abs(lstar(ca) - lstar(cb))
    if (d < min) fail(`层次过近[${name}] ${label}：ΔL*=${d.toFixed(1)}（需 ≥ ${min}）——大色块会看不出是两个颜色`)
    else notes.push(`${name} ${label} ΔL*=${d.toFixed(1)}`)
  }
}

// ───────────────────────── 结果 ─────────────────────────
if (problems.length > 0) {
  console.error(`[organic-style] 未通过 ${problems.length} 项：`)
  for (const p of problems) console.error(`  ✗ ${p}`)
  process.exit(1)
}
console.log(`[organic-style] 通过：禁止项 0 命中，令牌完整，调色板唯一，对比度 ${notes.length} 对全 AA`)
