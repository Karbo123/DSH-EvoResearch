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
for (const file of clientFiles) {
  if (VENDOR.has(file)) continue
  const lines = codeOf(file).split('\n')
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
      // styles.ts 的令牌块是色值来源；其他文件只允许登记过的例外色
      if (file !== 'styles.ts' && !PALETTE_EXCEPTIONS.has(file) && !EXCEPTION_HEX.has(hex.toLowerCase())) {
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
  '--r-2xs', '--r-xs', '--r-sm', '--r-md', '--r-lg', '--r-xl', '--r-pill', '--r-blob', '--r-blob-lg', '--r-dot',
  '--font-sans', '--font-serif', '--font-mono',
  '--ease-organic', '--dur-organic', '--dur-morph', '--dur-quick',
  '--shadow-sm', '--shadow-md', '--shadow-lg', '--organic-grain', '--scrim',
  '--titlebar-bg', '--titlebar-border', '--titlebar-fg', '--titlebar-accent',
]
/** 深色必须重定义（形状/字体/动效令牌由 :root 继承，无需重复） */
const REQUIRED_DARK = [
  '--color-background', '--color-surface', '--input-bg', '--hover-bg',
  '--color-text-primary', '--color-text-secondary', '--color-text-tertiary', '--color-text-placeholder',
  '--color-border', '--color-border-light', '--color-text-placeholder',
  '--color-success', '--color-warning', '--color-error', '--color-info',
  '--accent-sage', '--accent-tan', '--accent-mist', '--accent-teal', '--accent-tan-ink', '--accent-teal-ink',
  '--brand', '--brand-hover', '--brand-solid', '--brand-foreground', '--focus-ring',
  '--shadow-sm', '--shadow-md', '--shadow-lg', '--organic-grain', '--scrim',
  '--titlebar-bg', '--titlebar-border', '--titlebar-fg',
  '--graph-canvas', '--graph-node-surface', '--graph-node-title', '--graph-handle',
  '--graph-chat', '--graph-memory', '--graph-global', '--graph-resource', '--graph-trace',
]
const rootBlock = styles.slice(styles.indexOf(':root {'), styles.indexOf('html.dark {'))
const darkBlock = styles.slice(styles.indexOf('html.dark {'), styles.indexOf('* { box-sizing'))
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
// 组件层必须位于业务规则之前（后面的具体规则才能覆盖尺寸）
const firstComponent = styles.indexOf('.evo-pop,')
const firstBiz = styles.indexOf('.evo-topbar {')
if (firstComponent < 0 || firstBiz < 0 || firstComponent > firstBiz) fail('组件层位置异常：应位于业务规则之前')

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
const CONTRAST_PAIRS = [
  ['--color-text-primary', '--color-background'], ['--color-text-primary', '--color-surface'],
  ['--color-text-secondary', '--color-background'], ['--color-text-secondary', '--color-surface'],
  ['--color-text-tertiary', '--color-background'], ['--color-text-tertiary', '--color-surface'],
  ['--color-text-placeholder', '--input-bg'],
  ['--brand', '--color-background'], ['--brand', '--color-surface'], ['--brand', '--hover-bg'],
  ['--color-success', '--color-surface'], ['--color-warning', '--color-background'],
  ['--color-error', '--color-surface'], ['--color-info', '--color-surface'],
  ['--color-user-message', '--color-user-message-bg'],
  ['--brand-foreground', '--brand-solid'],
  ['--accent-tan-ink', '--color-surface'], ['--accent-teal-ink', '--color-surface'],
]
for (const [name, block] of [['浅色', rootBlock], ['深色', darkBlock]]) {
  for (const [fg, bg] of CONTRAST_PAIRS) {
    const f = tokenOf(block, fg)
    const b = tokenOf(block, bg)
    if (f === null || b === null) { fail(`对比度检查缺令牌 ${name} ${fg}/${bg}`); continue }
    const r = contrast(f, b)
    if (r < 4.5) fail(`对比度不足[${name}] ${fg} on ${bg} = ${r.toFixed(2)}（需 ≥ 4.5）`)
    else notes.push(`${name} ${fg}/${bg} ${r.toFixed(2)}`)
  }
}

// ───────────────────────── 结果 ─────────────────────────
if (problems.length > 0) {
  console.error(`[organic-style] 未通过 ${problems.length} 项：`)
  for (const p of problems) console.error(`  ✗ ${p}`)
  process.exit(1)
}
console.log(`[organic-style] 通过：禁止项 0 命中，令牌完整，调色板唯一，对比度 ${notes.length} 对全 AA`)
