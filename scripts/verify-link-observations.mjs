// 验证 link_observations：造两个观测 → 链接 → 断言双向关系（文件 frontmatter + 索引 + API 返回）
import { mkdirSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MEMORY_DIR = process.argv[2]
const OBS_DIR = process.argv[3]

const { ResearchMemoryStore } = await import(pathToFileURL(join(ROOT, 'packages', 'evoresearch-plugin', 'lib', 'host', 'memory', 'store.js')).href)
const store = ResearchMemoryStore.open(MEMORY_DIR)

const now = Date.now()
// 造两个观测（writeObservation 写文件 + 索引）
const o1 = store.writeObservation(OBS_DIR, {
  observationId: 'obs-link-a',
  title: '链接测试 A',
  body: '实验 A 的结果记录。',
  categories: ['experiment'],
  primaryCategory: 'experiment',
  topicKeys: ['link-test'],
  entities: [],
  sourceTurnIds: [],
})
const o2 = store.writeObservation(OBS_DIR, {
  observationId: 'obs-link-b',
  title: '链接测试 B',
  body: '方法 B 的说明记录。',
  categories: ['method'],
  primaryCategory: 'method',
  topicKeys: ['link-test'],
  entities: [],
  sourceTurnIds: [],
})
console.log('created:', o1.observationId, o2.observationId)

// 链接 A → B
const r = store.linkObservations(OBS_DIR, 'obs-link-a', ['obs-link-b'])
console.log('link result:', JSON.stringify(r))

// 断言 1：A 的 related 含 B
const a = store.getObservation('obs-link-a')
const b = store.getObservation('obs-link-b')
console.log('A.related:', JSON.stringify(a.relatedObservationIds))
console.log('B.related:', JSON.stringify(b.relatedObservationIds))
const okA = (a.relatedObservationIds ?? []).includes('obs-link-b')
const okB = (b.relatedObservationIds ?? []).includes('obs-link-a')
console.log('bidirectional:', okA && okB ? 'OK' : 'FAIL')

// 断言 2：文件 frontmatter 含 related_observation_ids
const aFile = readFileSync(join(OBS_DIR, 'global', 'obs-link-a.md'), 'utf8')
const bFile = readFileSync(join(OBS_DIR, 'global', 'obs-link-b.md'), 'utf8')
console.log('A frontmatter has related:', aFile.includes('related_observation_ids'))
console.log('B frontmatter has related:', bFile.includes('related_observation_ids'))
console.log('A file sample:', aFile.split('\n').filter((l) => l.includes('related') || l.includes('updated_at')).join(' | '))

// 断言 3：合并去重（重复链接不产生重复项）
const r2 = store.linkObservations(OBS_DIR, 'obs-link-a', ['obs-link-b'])
console.log('relink count:', r2.related.length, '(expect 1)')

// 自动计数断言（BASE-02/t22 约定：pass/total 跟随实际 check() 调用数）
let pass = 0
let total = 0
const check = (name, cond, detail = '') => {
  total += 1
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`)
  if (cond) pass += 1
}
check('创建两个 Observation', o1.observationId === 'obs-link-a' && o2.observationId === 'obs-link-b')
check('链接返回 related=[obs-link-b]', r.ok === true && r.related.length === 1 && r.related[0] === 'obs-link-b')
check('A.related 含 B', okA)
check('B.related 含 A（双向）', okB)
check('A 文件 frontmatter 含 related_observation_ids', aFile.includes('related_observation_ids'))
check('B 文件 frontmatter 含 related_observation_ids', bFile.includes('related_observation_ids'))
check('重复链接合并去重（仍 1 条）', r2.related.length === 1)
console.log(`\n${pass}/${total} passed`)
store.close()
process.exit(pass === total ? 0 : 1)
