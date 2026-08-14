/**
 * v3 启动对账（recovery）单元测试。
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { ResearchMemoryStore } from '../src/host/memory/store.js'
import { reconcileStore, rotateBackup, reconcileMemoryDir } from '../src/host/memory/recovery.js'

describe('rotateBackup', () => {
  it('双份轮换备份：依次创建 v3.1、v3.2，之后覆盖较旧一份', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evosci-recover-'))
    const memoryDir = path.join(dir, 'memories')
    fs.mkdirSync(memoryDir, { recursive: true })
    const dbFile = path.join(memoryDir, 'research_memory.db')
    fs.writeFileSync(dbFile, 'db-content-1', 'utf8')
    const backupDir = path.join(dir, 'backups')

    assert.equal(rotateBackup(memoryDir, backupDir), true)
    assert.ok(fs.existsSync(path.join(backupDir, 'research_memory.v3.1.db')))
    assert.equal(rotateBackup(memoryDir, backupDir), true)
    assert.ok(fs.existsSync(path.join(backupDir, 'research_memory.v3.2.db')))
    // 第三次：覆盖较旧一份（仍保持两份）
    fs.writeFileSync(dbFile, 'db-content-2', 'utf8')
    assert.equal(rotateBackup(memoryDir, backupDir), true)
    const backups = fs.readdirSync(backupDir).filter((f) => f.endsWith('.db'))
    assert.equal(backups.length, 2)
  })

  it('源库不存在时返回 false', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evosci-recover-'))
    assert.equal(rotateBackup(path.join(dir, 'nope'), path.join(dir, 'b')), false)
  })
})

describe('reconcileStore', () => {
  it('健康库：悬挂 pending 轮次标记为 interrupted（api_failure）', () => {
    const store = ResearchMemoryStore.openMemory()
    store.createPendingTurn({ turnId: 't-stale', sessionId: 's1', workspaceDir: '', userText: '旧请求', categories: [], topicKeys: [] })
    // 伪造陈旧 updated_at（直接改库）
    store.db.db.prepare('UPDATE research_turns SET updated_at = ? WHERE turn_id = ?').run(Date.now() - 2 * 60 * 60 * 1000, 't-stale')
    const result = reconcileStore(store, { stalePendingMs: 60 * 60 * 1000 })
    assert.equal(result.dbHealthy, true)
    assert.equal(result.markedInterrupted, 1)
    assert.equal(store.getTurn('t-stale')?.status, 'interrupted')
    assert.equal(store.getTurn('t-stale')?.interruptReason, 'api_failure')
    store.close()
  })

  it('未归档轮次补写归档（user 段缺失）', () => {
    const store = ResearchMemoryStore.openMemory()
    store.createPendingTurn({ turnId: 't1', sessionId: 's1', workspaceDir: '', userText: '问题', categories: [], topicKeys: [] })
    store.updateTurn('t1', { status: 'completed', assistantText: '回答' })
    // 模拟 turn/end 与归档之间崩溃：无 segments
    const result = reconcileStore(store)
    assert.equal(result.archivedMissing, 1)
    const segments = store.listSegments('t1')
    assert.equal(segments.length, 2)
    assert.deepEqual(segments.map((s) => s.kind), ['user', 'assistant'])
    // 幂等：再次对账不重复归档
    const again = reconcileStore(store)
    assert.equal(again.archivedMissing, 0)
    store.close()
  })

  it('损坏库：跳过全部写操作', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evosci-recover-'))
    const memoryDir = path.join(dir, 'memories')
    fs.mkdirSync(memoryDir, { recursive: true })
    // 直接写坏文件（非 SQLite 格式）
    fs.writeFileSync(path.join(memoryDir, 'research_memory.db'), 'not a sqlite database at all', 'utf8')
    const result = reconcileMemoryDir(memoryDir)
    assert.ok(result)
    assert.equal(result.dbHealthy, false)
    assert.equal(result.skipped, true)
    assert.equal(result.backedUp, false)
    // 未产生备份
    assert.equal(fs.existsSync(path.join(dir, 'backups')), false)
  })

  it('库不存在时 reconcileMemoryDir 返回 undefined', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evosci-recover-'))
    assert.equal(reconcileMemoryDir(path.join(dir, 'no-memories')), undefined)
  })
})
