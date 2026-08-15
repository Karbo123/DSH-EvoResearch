// §42.8 auto 模式验证：saveConfig(mode=auto) → 新簇生成 → 自动 approved + 文件
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { readFileSync } from 'node:fs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MEMORY_DIR = process.argv[2]
const OBS_DIR = process.argv[3]
const APP_PORT = process.argv[4]

const { ResearchMemoryStore } = await import(pathToFileURL(join(ROOT, 'packages', 'evoresearch-plugin', 'lib', 'host', 'memory', 'store.js')).href)
const store = ResearchMemoryStore.open(MEMORY_DIR)
for (let i = 1; i <= 3; i++) {
  store.writeObservation(OBS_DIR, {
    observationId: `auto-obs-${i}`,
    title: `自动技能实验 ${i}`,
    body: `自动技能实验 ${i} 的记录。`,
    categories: ['method'],
    primaryCategory: 'method',
    topicKeys: ['auto-demo-topic'],
    entities: [],
    sourceTurnIds: [],
  })
}
store.close()

const post = async (method, body = {}) => (await (await fetch(`http://127.0.0.1:${APP_PORT}/evoresearch/fs/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json())

const cfg = await post('autoskills-config', { enabled: true, mode: 'auto', cadence: 'weekly', time: '03:00' })
const gen = await post('skills/generate')
const list = await post('skills')
const auto = (list.value ?? []).filter((p) => p.name.includes('auto-demo-topic'))
const report = {
  cfg,
  generated: gen,
  autoProposals: auto.map((p) => ({ name: p.name, status: p.status, installedPath: p.installedPath })),
}
// 检查自动安装文件
try {
  const dir = join(MEMORY_DIR, '..', '..', 'skills', 'method-auto-demo-topic')
  const md = readFileSync(join(dir, 'SKILL.md'), 'utf8')
  report.skillInstalled = { hasFrontmatter: md.startsWith('---'), hasName: md.includes('name: method-auto-demo-topic') }
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
  report.manifestStatus = manifest.status
} catch (e) {
  report.fileError = String(e.message)
}
console.log(JSON.stringify(report, null, 1))
process.exit(0)
