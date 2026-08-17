// 生成 Markdown 渲染静态页（典型模型回复）→ headless 截图 → 供视觉模型评审行距
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import WebSocket from 'ws'
const require = createRequire(import.meta.url)
const MarkdownIt = require('markdown-it')
const md = new MarkdownIt({ html: true, linkify: true, breaks: false })

// 模拟一段典型模型回复（多段、列表、引用、代码、标题）
const sample = `## 科研方向分析

基于现有文献，我建议聚焦以下方向：

### 候选方向

1. 检索增强生成（RAG）的鲁棒性研究
2. 多智能体科研协作框架

> 注意：实验前请先确认数据集划分一致。

具体来说，第一阶段的重点是：

- 构建基准数据集
- 实现基线方法
- 评估指标对齐

\`\`\`python
def evaluate(model, data):
    return model.score(data)
\`\`\`

最后，还需要考虑消融实验的对照设计。

---

以上是初步建议，详细方案如下：

**要点一**：先跑通端到端流程。

**要点二**：再逐步加入模块化改进。`

const html = md.render(sample)
const css = `
:root { --color-text-primary: #e8e3d8; --color-text-secondary: #b5b0a4; --color-text-tertiary: #908d83; --color-border: #3a372f; --color-border-light: #332f2a; --color-background: #1c1a17; --color-surface: #242220; --hover-bg: #332f2a; --brand: #3b9cb0; }
body { background: #1c1a17; color: #e8e3d8; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 14px; padding: 24px; max-width: 760px; margin: 0 auto; }
.evo-md { font-size: 14px; line-height: 1.35; word-break: break-word; }
.evo-md > :first-child { margin-top: 0 !important; }
.evo-md > :last-child { margin-bottom: 0 !important; }
.evo-md p { margin: 0 0 4px; white-space: pre-wrap; }
.evo-md h1, .evo-md h2, .evo-md h3, .evo-md h4, .evo-md h5, .evo-md h6 { margin: 9px 0 4px; font-weight: 600; line-height: 1.3; }
.evo-md h1 { font-size: 19px; margin-top: 18px; }
.evo-md h2 { font-size: 17px; }
.evo-md h3 { font-size: 15px; }
.evo-md ul, .evo-md ol { margin: 0 0 6px; padding-left: 22px; }
.evo-md li { margin: 2px 0; }
.evo-md li > p { margin: 0; }
.evo-md blockquote { margin: 0 0 6px; padding: 2px 10px; border-left: 3px solid #3a372f; color: #b5b0a4; }
.evo-md blockquote p { margin: 1px 0; white-space: normal; }
.evo-md code { font-family: Consolas, monospace; font-size: 12.5px; background: #332f2a; border-radius: 4px; padding: 1px 5px; }
.evo-md pre { margin: 8px 0; padding: 9px 11px; background: #171512; border: 1px solid #332f2a; border-radius: 8px; overflow-x: auto; }
.evo-md pre code { background: none; padding: 0; font-size: 12.5px; line-height: 1.5; display: block; white-space: pre; }
.evo-md hr { border: none; border-top: 1px solid #3a372f; margin: 12px 0; }
`
const page = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><div class="evo-md">${html}</div></body></html>`
const outFile = 'D:\\DSH-Research\\.tmp-port\\md-sample.html'
writeFileSync(outFile, page, 'utf8')
console.log('html written:', html.length, 'bytes')

// headless 截图
const debugPort = 47423
const profile = `D:\\DSH-Research\\.tmp-e2e\\edge-hd13-${Date.now()}`
mkdirSync(profile, { recursive: true })
const edge = spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`,
  '--window-size=1440,1400', 'about:blank',
], { stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let targets = null
for (let i = 0; i < 30; i++) {
  try { const l = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json(); if (l.some((t) => t.type === 'page')) { targets = l; break } } catch { /* retry */ }
  await sleep(1000)
}
if (!targets) { console.log('NOT UP'); process.exit(1) }
const page2 = targets.find((t) => t.type === 'page')
const ws = new WebSocket(page2.webSocketDebuggerUrl)
await new Promise((r) => ws.on('open', r))
let id = 0
const pending = new Map()
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const mid = ++id
    pending.set(mid, { resolve, reject })
    ws.send(JSON.stringify({ id: mid, method, params }))
  })
}
ws.on('message', (m) => {
  const d = JSON.parse(m.toString())
  if (d.id && pending.has(d.id)) {
    const p = pending.get(d.id)
    pending.delete(d.id)
    d.error ? p.reject(new Error(JSON.stringify(d.error))) : p.resolve(d.result)
  }
})
await new Promise((r) => ws.on('open', r))
await send('Page.enable')
await send('Page.navigate', { url: 'file:///D:/DSH-Research/.tmp-port/md-sample.html' })
await sleep(3000)
const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
writeFileSync('D:\\DSH-Research\\.tmp-port\\visual-md-sample.png', Buffer.from(shot.data, 'base64'))
console.log('saved visual-md-sample.png')
ws.close()
edge.kill()
process.exit(0)


