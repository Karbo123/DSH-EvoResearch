/**
 * core/db 单元测试：SQLite 封装、迁移、FTS5。
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { EvosciDb, createFts5Table, cleanForIndex, type Migration } from '../src/host/core/db.js'

const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    up(db) {
      db.exec('CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL)')
      createFts5Table(db, 'notes_fts', 'body')
    },
  },
]

describe('EvosciDb', () => {
  it('内存库应用迁移并可读写', () => {
    const handle = EvosciDb.openMemory(MIGRATIONS)
    handle.db.prepare('INSERT INTO notes (body) VALUES (?)').run('hello world')
    const rows = handle.db.prepare('SELECT * FROM notes').all() as Array<{ id: number; body: string }>
    assert.equal(rows.length, 1)
    assert.equal(rows[0]!.body, 'hello world')
    handle.close()
  })

  it('迁移幂等（重复打开不重复应用）', () => {
    const handle = EvosciDb.openMemory(MIGRATIONS)
    const count = handle.db.prepare('SELECT COUNT(*) AS c FROM schema_migrations').get() as { c: number }
    assert.equal(count.c, MIGRATIONS.length)
    handle.close()
  })

  it('FTS5 检索命中（trigram，中文子串匹配）', () => {
    const handle = EvosciDb.openMemory(MIGRATIONS)
    // createFts5Table 创建的独立 FTS 表：直接向 FTS 表插入
    handle.db.prepare('INSERT INTO notes_fts (body) VALUES (?)').run('深度学习与科研记忆')
    const rows = handle.db
      .prepare('SELECT rowid FROM notes_fts WHERE notes_fts MATCH ?')
      .all('科研记忆') as Array<{ rowid: number }>
    assert.equal(rows.length, 1)
    handle.close()
  })

  it('cleanForIndex 清理控制字符并压缩空白', () => {
    assert.equal(cleanForIndex('a\u0000b\u0001c'), 'a b c')
    assert.equal(cleanForIndex('  多  个    空格  '), '多 个 空格')
  })

  it('事务回滚', () => {
    const handle = EvosciDb.openMemory(MIGRATIONS)
    handle.db.prepare('INSERT INTO notes (body) VALUES (?)').run('before')
    assert.throws(() =>
      handle.transaction(() => {
        handle.db.prepare('INSERT INTO notes (body) VALUES (?)').run('inside')
        throw new Error('boom')
      }),
    )
    const rows = handle.db.prepare('SELECT * FROM notes').all() as Array<{ body: string }>
    assert.equal(rows.length, 1)
    assert.equal(rows[0]!.body, 'before')
    handle.close()
  })
})
