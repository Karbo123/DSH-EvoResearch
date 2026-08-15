// §42.7/42.8 验证：造观测 → 生成提案（阈值/哈希）→ approve（SKILL.md+manifest）→ auto 模式
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { readFileSync } from 'node:fs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MEMORY_DIR = process.argv[2]
const OBS_DIR = process.argv[3]
const APP_PORT = process.argv[4]

const { ResearchMemoryStore } = await import(pathToFileURL(join(ROOT, 'packages', 'evoresearch-plugin', 'lib', 'host', 'memory', 'store.js')).href)
const store = ResearchMemoryStore.open(MEMORY_DIR)
const now = Date.now()
const report = {}

// 造 4 条同主题观测（experiment×3 + idea×1 → procedural=3 ≥2，总数 4 ≥3）
const ids = ['as-obs-1', 'as-obs-2', 'as-obs-3', 'as-obs-4']
const specs = [
  { cat: 'experiment', title: '蒸馏实验 A' },
  { cat: 'experiment', title: '蒸馏实验 B' },
  { cat: 'experiment', title: '蒸馏实验 C' },
  { cat: 'idea', title: '蒸馏想法 D' },
]
for (let i = 0; i < 4; i++) {
  store.writeObservation(OBS_DIR, {
    observationId: ids[i],
    title: specs[i].title,
    body: `${specs[i].title} 的记录。`,
    categories: [specs[i].cat],
    primaryCategory: specs[i].cat,
    topicKeys: ['distill-topic'],
    entities: [],
    sourceTurnIds: [],
  })
}
store.close()

// 生成提案（HTTP）
const gen1 = await (await fetch(`http://127.0.0.1:${APP_PORT}/evoresearch/fs/skills/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json()
report.generated = gen1
// 列表：检查 clusterHash/阈值
const list = await (await fetch(`http://127.0.0.1:${APP_PORT}/evoresearch/fs/skills`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json()
const fresh = (list.value ?? []).filter((p) => p.name.includes('distill-topic'))
report.proposals = fresh.map((p) => ({ name: p.name, clusterHash: p.clusterHash, status: p.status, sources: p.sourceObservationIds.length }))
// 重复生成：哈希去重应 0
const gen2 = await (await fetch(`http://127.0.0.1:${APP_PORT}/evoresearch/fs/skills/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json()
report.generatedAgain = gen2
// approve
const pid = fresh[0]?.proposalId
report.approve = pid ? await (await fetch(`http://127.0.0.1:${APP_PORT}/evoresearch/fs/skills/approve`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ proposalId: pid }) })).json() : 'no-proposal'
// 检查文件
const { AutoSkillsService } = await import(pathToFileURL(join(ROOT, 'packages', 'evoresearch-plugin', 'lib', 'host', 'autoskills.js')).href)
const svc = new AutoSkillsService({ dataRoot: join(MEMORY_DIR, '..', '..') })
const skillName = fresh[0] ? String(fresh[0].name).replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/^-+|-+$/g, '').slice(0, 64) : 'none'
const skillDir = join(svc['skillsDir'] ?? join(MEMORY_DIR, '..', '.evoresearch-data', 'skills'), skillName)
try {
  const skillMd = readFileSync(join(skillDir, 'SKILL.md'), 'utf8')
  report.skillMd = { hasFrontmatter: skillMd.startsWith('---'), hasName: skillMd.includes(`name: ${skillName}`), hasTodo: skillMd.includes('TODO') }
  const manifest = JSON.parse(readFileSync(join(skillDir, 'manifest.json'), 'utf8'))
  report.manifest = { status: manifest.status, hasClusterHash: typeof manifest.clusterHash === 'string', hasInstalledPath: typeof manifest.installedPath === 'string', hasSources: Array.isArray(manifest.sourceObservationIds) }
} catch (e) {
  report.fileError = String(e.message)
}
console.log(JSON.stringify(report, null, 1))
process.exit(0)
