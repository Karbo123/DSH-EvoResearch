/**
 * P1-2：Observation 类型化关联边单元测试（内存库为主）。
 *
 * 覆盖：
 * - 迁移 v7（observation_links 表存在，RESEARCH_MEMORY_MIGRATIONS 长度 = 7）；
 * - setObservationLink：有向边写入 + 双端 frontmatter 同步（from 端带边类型，
 *   to 端反向可发现性固定 relates）；
 * - 同边重复设置换类型 → UPDATE 生效；
 * - supersedeObservation 自动写 supersedes 边；
 * - renderObservationFile / parseObservationFile 的 edge_types 往返一致。
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  RESEARCH_MEMORY_MIGRATIONS,
  ResearchMemoryStore,
  parseObservationFile,
  renderObservationFile,
} from '../src/host/memory/store.js'

/** 写一条最小观测（内存库索引即可满足 getObservation）。 */
function seedObservation(store: ResearchMemoryStore, dir: string, observationId: string): void {
  store.writeObservation(dir, {
    observationId,
    title: `观测 ${observationId}`,
    body: `${observationId} 的正文`,
    categories: ['general'],
    topicKeys: [],
    entities: [],
    sourceTurnIds: [],
  })
}

describe('P1-2 类型化关联边', () => {
  it('迁移 v7：observation_links 表存在', () => {
    assert.equal(RESEARCH_MEMORY_MIGRATIONS.length, 7)
    const store = ResearchMemoryStore.openMemory()
    const row = store.db.db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'observation_links'").get() as { n: number }
    assert.equal(row.n, 1)
    // 空表可查询
    const count = store.db.db.prepare('SELECT COUNT(*) AS n FROM observation_links').get() as { n: number }
    assert.equal(count.n, 0)
    store.close()
  })

  it('setObservationLink：写边 + 双端 frontmatter 对齐', (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evoresearch-edges-'))
    t.after(() => {
      fs.rmSync(dir, { recursive: true, force: true })
    })
    const store = ResearchMemoryStore.openMemory()
    seedObservation(store, dir, 'O-A')
    seedObservation(store, dir, 'O-B')
    // 端点缺失 / 自环 → 拒绝
    assert.equal(store.setObservationLink(dir, 'O-A', 'O-missing', 'contradicts').ok, false)
    assert.equal(store.setObservationLink(dir, 'O-A', 'O-A', 'contradicts').ok, false)
    // 正常建立 contradicts 边
    const result = store.setObservationLink(dir, 'O-A', 'O-B', 'contradicts')
    assert.equal(result.ok, true)
    // 有向边一条
    const links = store.listObservationLinks()
    assert.equal(links.length, 1)
    assert.equal(links[0]?.fromId, 'O-A')
    assert.equal(links[0]?.toId, 'O-B')
    assert.equal(links[0]?.edgeType, 'contradicts')
    // from 端 edgeTypes 与 relatedObservationIds 同序对齐
    const a = store.getObservation('O-A')
    assert.deepEqual(a?.relatedObservationIds, ['O-B'])
    assert.deepEqual(a?.edgeTypes, ['contradicts'])
    // to 端反向可发现性：relatedObservationIds 含 from，类型固定 relates
    const b = store.getObservation('O-B')
    assert.ok(b?.relatedObservationIds.includes('O-A'))
    assert.deepEqual(b?.edgeTypes, ['relates'])
    // 过滤：按观测 id 命中两端任一方向；按类型过滤
    assert.equal(store.listObservationLinks({ observationId: 'O-B' }).length, 1)
    assert.equal(store.listObservationLinks({ observationId: 'O-C' }).length, 0)
    assert.equal(store.listObservationLinks({ edgeType: 'supersedes' }).length, 0)
    assert.equal(store.listObservationLinks({ observationId: 'O-A', edgeType: 'contradicts' }).length, 1)
    store.close()
  })

  it('重复 set 同边换类型 → UPDATE 生效', (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evoresearch-edges-'))
    t.after(() => {
      fs.rmSync(dir, { recursive: true, force: true })
    })
    const store = ResearchMemoryStore.openMemory()
    seedObservation(store, dir, 'O-A')
    seedObservation(store, dir, 'O-B')
    store.setObservationLink(dir, 'O-A', 'O-B', 'complements')
    store.setObservationLink(dir, 'O-A', 'O-B', 'contradicts')
    // upsert：仍只有一条边，类型已更新
    const links = store.listObservationLinks()
    assert.equal(links.length, 1)
    assert.equal(links[0]?.edgeType, 'contradicts')
    // frontmatter 类型同步替换（不产生重复 id）
    const a = store.getObservation('O-A')
    assert.deepEqual(a?.relatedObservationIds, ['O-B'])
    assert.deepEqual(a?.edgeTypes, ['contradicts'])
    store.close()
  })

  it('supersedeObservation 自动写 supersedes 边', (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evoresearch-edges-'))
    t.after(() => {
      fs.rmSync(dir, { recursive: true, force: true })
    })
    const store = ResearchMemoryStore.openMemory()
    seedObservation(store, dir, 'O-old')
    seedObservation(store, dir, 'O-new')
    store.supersedeObservation(dir, 'O-old', 'O-new')
    const links = store.listObservationLinks({ edgeType: 'supersedes' })
    assert.equal(links.length, 1)
    assert.equal(links[0]?.fromId, 'O-old')
    assert.equal(links[0]?.toId, 'O-new')
    // 取代后旧观测的 edgeTypes 从边表派生
    const old = store.getObservation('O-old')
    assert.equal(old?.status, 'superseded')
    assert.deepEqual(old?.edgeTypes, ['supersedes'])
    store.close()
  })

  it('frontmatter 往返：render 带 edge_types 再 parse 回来一致', () => {
    const content = renderObservationFile({
      title: '标题',
      body: '正文',
      categories: ['idea'],
      topicKeys: [],
      entities: [],
      sourceTurnIds: [],
      relatedObservationIds: ['O-x', 'O-y'],
      edgeTypes: ['contradicts', 'complements'],
      status: 'active',
      createdAt: 1,
      updatedAt: 2,
    })
    const parsed = parseObservationFile(content)
    assert.deepEqual(parsed.frontmatter.related_observation_ids, ['O-x', 'O-y'])
    assert.deepEqual(parsed.frontmatter.edge_types, ['contradicts', 'complements'])
    // 无关联时不输出 edge_types 行
    const plain = renderObservationFile({
      title: '标题',
      body: '正文',
      categories: ['idea'],
      topicKeys: [],
      entities: [],
      sourceTurnIds: [],
      status: 'active',
      createdAt: 1,
      updatedAt: 2,
    })
    assert.ok(!plain.includes('edge_types'))
    assert.ok(!plain.includes('related_observation_ids'))
    const plainParsed = parseObservationFile(plain)
    assert.equal(plainParsed.frontmatter.edge_types, undefined)
  })

  it('setObservationLink 后文件落盘含 edge_types 且可解析', (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evoresearch-edges-'))
    t.after(() => {
      fs.rmSync(dir, { recursive: true, force: true })
    })
    const store = ResearchMemoryStore.openMemory()
    seedObservation(store, dir, 'O-A')
    seedObservation(store, dir, 'O-B')
    store.setObservationLink(dir, 'O-A', 'O-B', 'contradicts')
    const file = fs.readFileSync(path.join(dir, 'global', 'O-A.md'), 'utf8')
    const parsed = parseObservationFile(file)
    assert.deepEqual(parsed.frontmatter.related_observation_ids, ['O-B'])
    assert.deepEqual(parsed.frontmatter.edge_types, ['contradicts'])
    store.close()
  })
})
