/**
 * SQLite 封装（基于 Node 内置 node:sqlite，零原生依赖）。
 *
 * 技术选型说明（见 docs/00-decisions.md）：
 * - 使用 Node 22.5+ 内置的 `node:sqlite`（DatabaseSync），自带 FTS5 全文检索，
 *   无需 better-sqlite3 等原生模块 —— 对桌面端打包体积与兼容性最友好；
 * - 每个科研项目独立一个 research_memory.db，文件随项目目录走（项目即 git 仓库）；
 * - 统一的轻量迁移机制：schema_migrations 表记录已应用版本，按序执行迁移。
 */
import { DatabaseSync } from 'node:sqlite'
import * as path from 'node:path'
import * as fs from 'node:fs'

/** 一条数据库迁移：version 必须单调递增。 */
export interface Migration {
  readonly version: number
  readonly up: (db: DatabaseSync) => void
}

/** 打开的数据库句柄（封装 DatabaseSync 常用操作）。 */
export class evoresearchDb {
  readonly db: DatabaseSync
  private readonly migrations: readonly Migration[]

  private constructor(db: DatabaseSync, migrations: readonly Migration[]) {
    this.db = db
    this.migrations = migrations
  }

  /**
   * 打开（或创建）一个数据库文件并应用迁移。
   * @param file 数据库文件绝对路径；父目录不存在时自动创建。
   * @param migrations 迁移列表（按 version 升序）。
   */
  static open(file: string, migrations: readonly Migration[]): evoresearchDb {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const db = new DatabaseSync(file)
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA synchronous = FULL')
    db.exec('PRAGMA foreign_keys = ON')
    const handle = new evoresearchDb(db, [...migrations].sort((a, b) => a.version - b.version))
    handle.migrate()
    return handle
  }

  /** 打开内存数据库（测试用）。 */
  static openMemory(migrations: readonly Migration[]): evoresearchDb {
    const db = new DatabaseSync(':memory:')
    db.exec('PRAGMA foreign_keys = ON')
    const handle = new evoresearchDb(db, [...migrations].sort((a, b) => a.version - b.version))
    handle.migrate()
    return handle
  }

  /** 应用尚未执行的迁移（幂等，支持断点续做）。 */
  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      )
    `)
    const applied = new Set(
      (this.db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: number }>).map((r) => r.version),
    )
    const tx = this.db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
    for (const migration of this.migrations) {
      if (applied.has(migration.version)) continue
      this.db.exec('BEGIN')
      try {
        migration.up(this.db)
        tx.run(migration.version, Date.now())
        this.db.exec('COMMIT')
      } catch (error) {
        this.db.exec('ROLLBACK')
        throw error
      }
    }
  }

  /** 在事务中执行一组操作。 */
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN')
    try {
      const result = fn()
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  close(): void {
    this.db.close()
  }
}

/**
 * 创建 FTS5 虚拟表。
 * @param db 数据库句柄。
 * @param table FTS 表名。
 * @param columns 参与全文检索的列（如 "user_text, assistant_text"）。
 * @param options.contentTable 可选：外部内容表名（需配合触发器同步，如 store.ts 的做法）；
 *   缺省时 FTS 表为独立表，直接向 FTS 表 INSERT。
 *
 * tokenizer 选择 trigram：对连续中文文本按 3-gram 切分（unicode61 会把整段
 * 中文当作一个 token，无法子串检索）；trigram 支持中英文子串级匹配，
 * 代价是查询 token 至少 3 个字符（短 token 在 toFtsQuery 中被过滤）。
 */
export function createFts5Table(
  db: DatabaseSync,
  table: string,
  columns: string,
  options: { contentTable?: string } = {},
): void {
  const contentClause = options.contentTable
    ? `, content='${options.contentTable}', content_rowid='rowid'`
    : ''
  db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS ${table} USING fts5(${columns}${contentClause}, tokenize = 'trigram')`)
}

/** 对一段文本做轻量预处理（去控制字符、压缩空白），供 FTS 索引使用。 */
export function cleanForIndex(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
