/**
 * 科研记忆 存储层 —— 每个科研项目独立的 research_memory.db。
 *
 * 表结构核心语义：
 * - research_turns（Turn Catalog）+ FTS5：每轮对话的分类、topic、状态（含 v3 interrupted）；
 * - turn_continuation_messages：「继续」消息幂等映射回原轮；
 * - category_states + FTS5：每个 category/topic 的当前决定、开放问题、来源；
 * - observation_search_index + FTS5：Markdown Observation 文件的镜像索引
 *   （文件是主存储，可 git 管理；索引可删除重建，不修改文件本身）；
 * - research_goals / goal_events：v3 Goal Contract 与追加式事件账本；
 * - tool_execution_receipts / turn_attempts：v3 中断语义与工具收据；
 * - research_index_progress：backfill 断点续做（source_version 指纹）。
 *
 * 关键约定：
 * - 所有时间戳为毫秒 epoch；
 * - FTS5 表由触发器与内容表保持同步（可重建：research_turns_fts 由 rebuild 维护）；
 * - 写操作走事务，PRAGMA synchronous=FULL 保证崩溃对账以持久化边界为准。
 */
import { DatabaseSync } from 'node:sqlite'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { evoresearchDb, type Migration, cleanForIndex } from '../core/db.js'
import {
  type TurnRecord,
  type TurnStatus,
  type ResearchCategory,
  type TopicState,
  type ObservationMeta,
  type GoalContract,
  RESEARCH_CATEGORIES,
} from '../../shared/types.js'

/** research_memory.db 的全部迁移。 */
export const RESEARCH_MEMORY_MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    up(db) {
      db.exec(`
        CREATE TABLE research_turns (
          turn_id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          workspace_dir TEXT NOT NULL DEFAULT '',
          user_text TEXT NOT NULL,
          assistant_text TEXT NOT NULL DEFAULT '',
          categories TEXT NOT NULL DEFAULT '[]',
          topic_keys TEXT NOT NULL DEFAULT '[]',
          status TEXT NOT NULL DEFAULT 'pending',
          continued_from TEXT,
          response_started INTEGER NOT NULL DEFAULT 0,
          interrupt_reason TEXT,
          partial_note TEXT,
          working_summary TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX idx_turns_session ON research_turns(session_id, created_at);
        CREATE INDEX idx_turns_workspace ON research_turns(workspace_dir, created_at);

        CREATE VIRTUAL TABLE research_turns_fts USING fts5(
          user_text, assistant_text,
          content='research_turns', content_rowid='rowid',
          tokenize = 'trigram'
        );
        CREATE TRIGGER research_turns_ai AFTER INSERT ON research_turns BEGIN
          INSERT INTO research_turns_fts(rowid, user_text, assistant_text)
          VALUES (new.rowid, new.user_text, new.assistant_text);
        END;
        CREATE TRIGGER research_turns_ad AFTER DELETE ON research_turns BEGIN
          INSERT INTO research_turns_fts(research_turns_fts, rowid, user_text, assistant_text)
          VALUES ('delete', old.rowid, old.user_text, old.assistant_text);
        END;
        CREATE TRIGGER research_turns_au AFTER UPDATE ON research_turns BEGIN
          INSERT INTO research_turns_fts(research_turns_fts, rowid, user_text, assistant_text)
          VALUES ('delete', old.rowid, old.user_text, old.assistant_text);
          INSERT INTO research_turns_fts(rowid, user_text, assistant_text)
          VALUES (new.rowid, new.user_text, new.assistant_text);
        END;

        CREATE TABLE turn_continuation_messages (
          continuation_msg_id TEXT PRIMARY KEY,
          turn_id TEXT NOT NULL REFERENCES research_turns(turn_id)
        );

        CREATE TABLE category_states (
          category TEXT NOT NULL,
          topic_key TEXT NOT NULL,
          label TEXT NOT NULL,
          decision TEXT NOT NULL DEFAULT '',
          open_questions TEXT NOT NULL DEFAULT '[]',
          source_turn_ids TEXT NOT NULL DEFAULT '[]',
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (category, topic_key)
        );

        CREATE VIRTUAL TABLE category_states_fts USING fts5(
          label, decision, content='category_states', content_rowid='rowid',
          tokenize = 'trigram'
        );
        CREATE TRIGGER category_states_ai AFTER INSERT ON category_states BEGIN
          INSERT INTO category_states_fts(rowid, label, decision)
          VALUES (new.rowid, new.label, new.decision);
        END;
        CREATE TRIGGER category_states_ad AFTER DELETE ON category_states BEGIN
          INSERT INTO category_states_fts(category_states_fts, rowid, label, decision)
          VALUES ('delete', old.rowid, old.label, old.decision);
        END;
        CREATE TRIGGER category_states_au AFTER UPDATE ON category_states BEGIN
          INSERT INTO category_states_fts(category_states_fts, rowid, label, decision)
          VALUES ('delete', old.rowid, old.label, old.decision);
          INSERT INTO category_states_fts(rowid, label, decision)
          VALUES (new.rowid, new.label, new.decision);
        END;

        CREATE TABLE observation_search_index (
          observation_id TEXT PRIMARY KEY,
          file_name TEXT NOT NULL,
          title TEXT NOT NULL,
          content TEXT NOT NULL,
          categories TEXT NOT NULL DEFAULT '[]',
          primary_category TEXT,
          topic_keys TEXT NOT NULL DEFAULT '[]',
          entities TEXT NOT NULL DEFAULT '[]',
          source_turn_ids TEXT NOT NULL DEFAULT '[]',
          status TEXT NOT NULL DEFAULT 'active',
          superseded_by TEXT,
          project_id TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX idx_observations_status ON observation_search_index(status, updated_at);

        CREATE VIRTUAL TABLE observation_search_index_fts USING fts5(
          title, content, content='observation_search_index', content_rowid='rowid',
          tokenize = 'trigram'
        );
        CREATE TRIGGER observation_search_index_ai AFTER INSERT ON observation_search_index BEGIN
          INSERT INTO observation_search_index_fts(rowid, title, content)
          VALUES (new.rowid, new.title, new.content);
        END;
        CREATE TRIGGER observation_search_index_ad AFTER DELETE ON observation_search_index BEGIN
          INSERT INTO observation_search_index_fts(observation_search_index_fts, rowid, title, content)
          VALUES ('delete', old.rowid, old.title, old.content);
        END;
        CREATE TRIGGER observation_search_index_au AFTER UPDATE ON observation_search_index BEGIN
          INSERT INTO observation_search_index_fts(observation_search_index_fts, rowid, title, content)
          VALUES ('delete', old.rowid, old.title, old.content);
          INSERT INTO observation_search_index_fts(rowid, title, content)
          VALUES (new.rowid, new.title, new.content);
        END;

        CREATE TABLE research_goals (
          goal_id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          objective TEXT NOT NULL,
          criteria TEXT NOT NULL DEFAULT '[]',
          constraints TEXT NOT NULL DEFAULT '[]',
          version INTEGER NOT NULL DEFAULT 1,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE goal_events (
          goal_id TEXT NOT NULL REFERENCES research_goals(goal_id),
          event TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX idx_goal_events ON goal_events(goal_id, created_at);

        CREATE TABLE turn_attempts (
          attempt_id TEXT PRIMARY KEY,
          turn_id TEXT NOT NULL REFERENCES research_turns(turn_id),
          status TEXT NOT NULL,
          response_started INTEGER NOT NULL DEFAULT 0,
          started_at INTEGER NOT NULL,
          completed_at INTEGER
        );
        CREATE INDEX idx_attempts_turn ON turn_attempts(turn_id);

        CREATE TABLE tool_execution_receipts (
          tool_call_id TEXT PRIMARY KEY,
          turn_id TEXT,
          status TEXT NOT NULL DEFAULT 'started',
          started_at INTEGER NOT NULL,
          completed_at INTEGER
        );

        CREATE TABLE research_index_progress (
          memory_dir TEXT NOT NULL,
          project_id TEXT NOT NULL,
          source_version TEXT NOT NULL,
          status TEXT NOT NULL,
          progress TEXT NOT NULL DEFAULT '{}',
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (memory_dir, project_id)
        );
      `)
    },
  },
  {
    // v3 Raw Turn Archive：原始轮次分页归档（原始历史永不清除，只裁剪活跃投影）。
    // 对应 EvoResearch store.py 的 turn_segments 表；active 轮次在超预算时归档
    // 到 segments 并生成 Working Summary（完整实现见 recovery 模块）。
    version: 2,
    up(db) {
      db.exec(`
        CREATE TABLE turn_segments (
          segment_id TEXT PRIMARY KEY,
          turn_id TEXT NOT NULL REFERENCES research_turns(turn_id),
          seq INTEGER NOT NULL,
          kind TEXT NOT NULL,
          payload TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX idx_segments_turn ON turn_segments(turn_id, seq);
      `)
    },
  },
]

/** 数据库行（宽松类型，读取后立即转换为领域对象）。 */
type Row = Record<string, unknown>

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' ? value : fallback
}

function parseJsonArray<T>(value: unknown): T[] {
  try {
    const parsed = JSON.parse(asString(value, '[]')) as unknown
    return Array.isArray(parsed) ? (parsed as T[]) : []
  } catch {
    return []
  }
}

/** 从数据库行还原 TurnRecord。 */
function turnFromRow(row: Row): TurnRecord {
  return {
    turnId: asString(row.turn_id),
    sessionId: asString(row.session_id),
    workspaceDir: asString(row.workspace_dir),
    userText: asString(row.user_text),
    assistantText: asString(row.assistant_text),
    categories: parseJsonArray<ResearchCategory>(row.categories),
    topicKeys: parseJsonArray<string>(row.topic_keys),
    status: asString(row.status, 'pending') as TurnStatus,
    createdAt: asNumber(row.created_at),
    updatedAt: asNumber(row.updated_at),
    continuedFrom: row.continued_from === null || row.continued_from === undefined ? undefined : asString(row.continued_from),
    responseStarted: asNumber(row.response_started) === 1,
    interruptReason: row.interrupt_reason === null || row.interrupt_reason === undefined ? undefined : asString(row.interrupt_reason) as TurnRecord['interruptReason'],
    partialNote: row.partial_note === null || row.partial_note === undefined ? undefined : asString(row.partial_note),
    workingSummary: row.working_summary === null || row.working_summary === undefined ? undefined : asString(row.working_summary),
  }
}

/** Observation frontmatter 字段名。 */
interface ObservationFrontmatter {
  title?: string
  categories?: string[]
  primary_category?: string
  topic_keys?: string[]
  entities?: string[]
  source_turn_ids?: string[]
  status?: 'active' | 'superseded'
  superseded_by?: string
  project_id?: string
  created_at?: number
  updated_at?: number
}

/** 解析 Markdown 文件：frontmatter（--- 包裹的 YAML 子集）+ 正文。 */
export function parseObservationFile(content: string): { frontmatter: ObservationFrontmatter; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(content)
  if (!match) return { frontmatter: {}, body: content }
  const frontmatter: ObservationFrontmatter = {}
  for (const line of match[1]!.split(/\r?\n/)) {
    const colon = line.indexOf(':')
    if (colon <= 0) continue
    const key = line.slice(0, colon).trim()
    const raw = line.slice(colon + 1).trim()
    const value: string | string[] = raw.startsWith('[') ? JSON.parse(raw) : raw.replace(/^["']|["']$/g, '')
    if (key === 'categories' || key === 'topic_keys' || key === 'entities' || key === 'source_turn_ids') {
      const list = Array.isArray(value) ? value : [value]
      if (key === 'categories') frontmatter.categories = list
      else if (key === 'topic_keys') frontmatter.topic_keys = list
      else if (key === 'entities') frontmatter.entities = list
      else frontmatter.source_turn_ids = list
    } else if (key === 'status') {
      frontmatter.status = value === 'superseded' ? 'superseded' : 'active'
    } else if (key === 'primary_category' || key === 'superseded_by' || key === 'project_id' || key === 'title') {
      frontmatter[key] = String(value)
    } else if (key === 'created_at' || key === 'updated_at') {
      frontmatter[key] = Number(value)
    }
  }
  return { frontmatter, body: match[2]!.trim() }
}

/** 序列化 Observation Markdown 文件内容。 */
export function renderObservationFile(meta: {
  title: string
  body: string
  categories: readonly ResearchCategory[]
  primaryCategory?: ResearchCategory
  topicKeys: readonly string[]
  entities: readonly string[]
  sourceTurnIds: readonly string[]
  status: 'active' | 'superseded'
  supersededBy?: string
  projectId?: string
  createdAt: number
  updatedAt: number
}): string {
  const lines = [
    '---',
    `title: ${meta.title}`,
    `categories: ${JSON.stringify(meta.categories)}`,
    meta.primaryCategory ? `primary_category: ${meta.primaryCategory}` : null,
    `topic_keys: ${JSON.stringify(meta.topicKeys)}`,
    `entities: ${JSON.stringify(meta.entities)}`,
    `source_turn_ids: ${JSON.stringify(meta.sourceTurnIds)}`,
    `status: ${meta.status}`,
    meta.supersededBy ? `superseded_by: ${meta.supersededBy}` : null,
    meta.projectId ? `project_id: ${meta.projectId}` : null,
    `created_at: ${meta.createdAt}`,
    `updated_at: ${meta.updatedAt}`,
    '---',
    '',
    meta.body,
    '',
  ].filter((line): line is string => line !== null)
  return lines.join('\n')
}

/** 科研记忆 存储门面：封装 research_memory.db 的全部读写。 */
export class ResearchMemoryStore {
  readonly db: evoresearchDb

  private constructor(db: evoresearchDb) {
    this.db = db
  }

  /** 打开项目记忆库（目录不存在时自动创建）。 */
  static open(memoryDir: string): ResearchMemoryStore {
    const file = path.join(memoryDir, 'research_memory.db')
    return new ResearchMemoryStore(evoresearchDb.open(file, RESEARCH_MEMORY_MIGRATIONS))
  }

  /** 内存库（测试用）。 */
  static openMemory(): ResearchMemoryStore {
    return new ResearchMemoryStore(evoresearchDb.openMemory(RESEARCH_MEMORY_MIGRATIONS))
  }

  // ── Turn Catalog ──────────────────────────────────────────────────────────

  /** 记录一轮新对话（pending 状态，收到用户消息时调用）。 */
  createPendingTurn(input: {
    turnId: string
    sessionId: string
    workspaceDir: string
    userText: string
    categories: readonly ResearchCategory[]
    topicKeys: readonly string[]
  }): void {
    const now = Date.now()
    this.db.db
      .prepare(
        `INSERT INTO research_turns
         (turn_id, session_id, workspace_dir, user_text, categories, topic_keys, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      )
      .run(
        input.turnId,
        input.sessionId,
        input.workspaceDir,
        cleanForIndex(input.userText),
        JSON.stringify(input.categories),
        JSON.stringify(input.topicKeys),
        now,
        now,
      )
  }

  /** 更新一轮对话（分类/主题在分类器完成后可回填）。 */
  updateTurn(
    turnId: string,
    patch: {
      assistantText?: string
      categories?: readonly ResearchCategory[]
      topicKeys?: readonly string[]
      status?: TurnStatus
      responseStarted?: boolean
      interruptReason?: 'user_stop' | 'api_failure'
      partialNote?: string
      workingSummary?: string
    },
  ): void {
    const current = this.getTurn(turnId)
    if (!current) return
    this.db.db
      .prepare(
        `UPDATE research_turns SET
           assistant_text = ?, categories = ?, topic_keys = ?, status = ?,
           response_started = ?, interrupt_reason = ?, partial_note = ?, working_summary = ?,
           updated_at = ?
         WHERE turn_id = ?`,
      )
      .run(
        patch.assistantText !== undefined ? cleanForIndex(patch.assistantText) : current.assistantText,
        patch.categories ? JSON.stringify(patch.categories) : JSON.stringify(current.categories),
        patch.topicKeys ? JSON.stringify(patch.topicKeys) : JSON.stringify(current.topicKeys),
        patch.status ?? current.status,
        patch.responseStarted ?? current.responseStarted ? 1 : 0,
        patch.interruptReason ?? current.interruptReason ?? null,
        patch.partialNote ?? current.partialNote ?? null,
        patch.workingSummary ?? current.workingSummary ?? null,
        Date.now(),
        turnId,
      )
  }

  /** 按会话与用户消息文本查询轮次（backfill 幂等检查）。 */
  findTurnBySessionText(sessionId: string, userText: string): TurnRecord | undefined {
    const row = this.db.db
      .prepare('SELECT * FROM research_turns WHERE session_id = ? AND user_text = ? ORDER BY created_at DESC LIMIT 1')
      .get(sessionId, cleanForIndex(userText)) as Row | undefined
    return row ? turnFromRow(row) : undefined
  }

  /** 按 id 读取一轮对话。 */
  getTurn(turnId: string): TurnRecord | undefined {
    const row = this.db.db.prepare('SELECT * FROM research_turns WHERE turn_id = ?').get(turnId) as Row | undefined
    return row ? turnFromRow(row) : undefined
  }

  /** 按会话列出轮次（最新优先）。 */
  listTurns(sessionId?: string, limit = 100, offset = 0): TurnRecord[] {
    const rows = sessionId
      ? (this.db.db
          .prepare('SELECT * FROM research_turns WHERE session_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?')
          .all(sessionId, limit, offset) as Row[])
      : (this.db.db.prepare('SELECT * FROM research_turns ORDER BY created_at DESC LIMIT ? OFFSET ?').all(limit, offset) as Row[])
    return rows.map(turnFromRow)
  }

  /** 未完成（pending/interrupted）的轮次。 */
  listOpenTurns(): TurnRecord[] {
    const rows = this.db.db
      .prepare(`SELECT * FROM research_turns WHERE status IN ('pending', 'interrupted') ORDER BY created_at ASC`)
      .all() as Row[]
    return rows.map(turnFromRow)
  }

  /** 「继续」消息幂等映射回原轮。 */
  linkContinuation(continuationMsgId: string, turnId: string): void {
    this.db.db
      .prepare('INSERT OR IGNORE INTO turn_continuation_messages (continuation_msg_id, turn_id) VALUES (?, ?)')
      .run(continuationMsgId, turnId)
  }

  /** 由「继续」消息 id 反查原轮。 */
  findTurnByContinuation(continuationMsgId: string): TurnRecord | undefined {
    const row = this.db.db
      .prepare(
        `SELECT t.* FROM research_turns t
         JOIN turn_continuation_messages m ON m.turn_id = t.turn_id
         WHERE m.continuation_msg_id = ?`,
      )
      .get(continuationMsgId) as Row | undefined
    return row ? turnFromRow(row) : undefined
  }

  // ── Turn Attempts / 工具收据（v3） ────────────────────────────────────────

  /** 记录一次模型调用尝试。 */
  recordAttempt(input: { attemptId: string; turnId: string }): void {
    this.db.db
      .prepare('INSERT INTO turn_attempts (attempt_id, turn_id, status, started_at) VALUES (?, ?, ?, ?)')
      .run(input.attemptId, input.turnId, 'started', Date.now())
  }

  completeAttempt(attemptId: string, responseStarted: boolean): void {
    this.db.db
      .prepare('UPDATE turn_attempts SET status = ?, response_started = ?, completed_at = ? WHERE attempt_id = ?')
      .run(responseStarted ? 'completed-streamed' : 'completed', responseStarted ? 1 : 0, Date.now(), attemptId)
  }

  /** 记录工具调用开始。 */
  recordToolStarted(toolCallId: string, turnId: string | undefined): void {
    this.db.db
      .prepare('INSERT OR IGNORE INTO tool_execution_receipts (tool_call_id, turn_id, status, started_at) VALUES (?, ?, ?, ?)')
      .run(toolCallId, turnId ?? null, 'started', Date.now())
  }

  /** 记录工具调用完成（ToolMessage 已提交后补记）。 */
  recordToolCompleted(toolCallId: string): void {
    this.db.db
      .prepare("UPDATE tool_execution_receipts SET status = 'completed', completed_at = ? WHERE tool_call_id = ?")
      .run(Date.now(), toolCallId)
  }

  /** 无法确认结果的工具收据（unknown）。 */
  listUnknownTools(): Array<{ toolCallId: string; turnId?: string; startedAt: number }> {
    const rows = this.db.db
      .prepare("SELECT tool_call_id, turn_id, started_at FROM tool_execution_receipts WHERE status = 'started'")
      .all() as Row[]
    return rows.map((row) => ({
      toolCallId: asString(row.tool_call_id),
      turnId: row.turn_id === null || row.turn_id === undefined ? undefined : asString(row.turn_id),
      startedAt: asNumber(row.started_at),
    }))
  }

  // ── Raw Turn Archive（v3：原始轮次分页归档） ──────────────────────────────

  /** 追加一段原始轮次内容（分段归档，原始历史永不清除）。 */
  appendSegment(input: { segmentId: string; turnId: string; kind: 'user' | 'assistant' | 'tool' | 'summary' | 'note'; payload: string }): void {
    const nextSeq = this.nextSegmentSeq(input.turnId)
    this.db.db
      .prepare('INSERT INTO turn_segments (segment_id, turn_id, seq, kind, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(input.segmentId, input.turnId, nextSeq, input.kind, input.payload, Date.now())
  }

  /** 某轮下一个 segment 序号。 */
  private nextSegmentSeq(turnId: string): number {
    const row = this.db.db
      .prepare('SELECT COALESCE(MAX(seq), -1) AS max_seq FROM turn_segments WHERE turn_id = ?')
      .get(turnId) as Row
    return asNumber(row.max_seq) + 1
  }

  /** 读取某轮的归档分段（按 seq 升序）。 */
  listSegments(turnId: string): Array<{ segmentId: string; seq: number; kind: string; payload: string; createdAt: number }> {
    const rows = this.db.db
      .prepare('SELECT * FROM turn_segments WHERE turn_id = ? ORDER BY seq ASC')
      .all(turnId) as Row[]
    return rows.map((row) => ({
      segmentId: asString(row.segment_id),
      seq: asNumber(row.seq),
      kind: asString(row.kind),
      payload: asString(row.payload),
      createdAt: asNumber(row.created_at),
    }))
  }

  /**
   * 整轮归档：把轮次快照写入 segments（用户消息/回答/摘要/打断说明）。
   * research_turns 记录本身保留（活跃投影），segments 为不可变原始档案。
   */
  archiveTurn(turn: TurnRecord): void {
    this.appendSegment({ segmentId: `s-${turn.turnId}-u`, turnId: turn.turnId, kind: 'user', payload: turn.userText })
    if (turn.assistantText) {
      this.appendSegment({ segmentId: `s-${turn.turnId}-a`, turnId: turn.turnId, kind: 'assistant', payload: turn.assistantText })
    }
    if (turn.workingSummary) {
      this.appendSegment({ segmentId: `s-${turn.turnId}-s`, turnId: turn.turnId, kind: 'summary', payload: turn.workingSummary })
    }
    if (turn.partialNote) {
      this.appendSegment({ segmentId: `s-${turn.turnId}-n`, turnId: turn.turnId, kind: 'note', payload: turn.partialNote })
    }
  }

  // ── Topic State ───────────────────────────────────────────────────────────

  /** 合并写入（upsert）一个 topic state。 */
  upsertTopicState(state: TopicState): void {
    this.db.db
      .prepare(
        `INSERT INTO category_states (category, topic_key, label, decision, open_questions, source_turn_ids, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(category, topic_key) DO UPDATE SET
           label = excluded.label, decision = excluded.decision,
           open_questions = excluded.open_questions, source_turn_ids = excluded.source_turn_ids,
           updated_at = excluded.updated_at`,
      )
      .run(
        state.category,
        state.topicKey,
        state.label,
        cleanForIndex(state.decision),
        JSON.stringify(state.openQuestions),
        JSON.stringify(state.sourceTurnIds),
        state.updatedAt,
      )
  }

  /** 列出全部 topic states（可按类别过滤）。 */
  listTopicStates(category?: ResearchCategory): TopicState[] {
    const rows = category
      ? (this.db.db.prepare('SELECT * FROM category_states WHERE category = ? ORDER BY updated_at DESC').all(category) as Row[])
      : (this.db.db.prepare('SELECT * FROM category_states ORDER BY updated_at DESC').all() as Row[])
    return rows.map((row) => ({
      category: asString(row.category) as ResearchCategory,
      topicKey: asString(row.topic_key),
      label: asString(row.label),
      decision: asString(row.decision),
      openQuestions: parseJsonArray<string>(row.open_questions),
      sourceTurnIds: parseJsonArray<string>(row.source_turn_ids),
      updatedAt: asNumber(row.updated_at),
    }))
  }

  // ── Observations ──────────────────────────────────────────────────────────

  /**
   * 写入一个 Observation：主存储是 Markdown 文件（observations/global/ 或
   * observations/projects/<P-id>/），DB 为镜像索引。
   */
  writeObservation(observationsDir: string, input: {
    observationId: string
    title: string
    body: string
    categories: readonly ResearchCategory[]
    primaryCategory?: ResearchCategory
    topicKeys: readonly string[]
    entities: readonly string[]
    sourceTurnIds: readonly string[]
    projectId?: string
  }): ObservationMeta {
    const fileName = `${input.observationId}.md`
    const dir = input.projectId
      ? path.join(observationsDir, 'projects', input.projectId)
      : path.join(observationsDir, 'global')
    fs.mkdirSync(dir, { recursive: true })
    const now = Date.now()
    const content = renderObservationFile({
      title: input.title,
      body: input.body,
      categories: input.categories,
      primaryCategory: input.primaryCategory,
      topicKeys: input.topicKeys,
      entities: input.entities,
      sourceTurnIds: input.sourceTurnIds,
      status: 'active',
      projectId: input.projectId,
      createdAt: now,
      updatedAt: now,
    })
    // 原子写：先写临时文件再改名，避免半成品。
    const target = path.join(dir, fileName)
    const tmp = `${target}.tmp-${process.pid}`
    fs.writeFileSync(tmp, content, 'utf8')
    fs.renameSync(tmp, target)
    const meta: ObservationMeta = {
      observationId: input.observationId,
      fileName,
      title: input.title,
      content,
      categories: input.categories,
      primaryCategory: input.primaryCategory,
      topicKeys: input.topicKeys,
      entities: input.entities,
      sourceTurnIds: input.sourceTurnIds,
      status: 'active',
      projectId: input.projectId,
      createdAt: now,
      updatedAt: now,
    }
    this.upsertObservationIndex(meta)
    return meta
  }

  /** 将 Observation 标记为 superseded（保留旧文件，检索默认只出 ACTIVE）。 */
  supersedeObservation(observationsDir: string, observationId: string, supersededBy: string): void {
    const meta = this.getObservation(observationId)
    if (!meta) return
    fs.writeFileSync(
      path.join(observationsDir, meta.projectId ? 'projects' : 'global', meta.projectId ?? '', meta.fileName),
      renderObservationFile({
        title: meta.title,
        body: meta.content.split('\n---\n')[1] ?? meta.content,
        categories: meta.categories,
        primaryCategory: meta.primaryCategory,
        topicKeys: meta.topicKeys,
        entities: meta.entities,
        sourceTurnIds: meta.sourceTurnIds,
        status: 'superseded',
        supersededBy,
        projectId: meta.projectId,
        createdAt: meta.createdAt,
        updatedAt: Date.now(),
      }),
      'utf8',
    )
    this.db.db
      .prepare('UPDATE observation_search_index SET status = ?, superseded_by = ?, updated_at = ? WHERE observation_id = ?')
      .run('superseded', supersededBy, Date.now(), observationId)
  }

  /** 镜像索引写入（文件写入后同步）。 */
  private upsertObservationIndex(meta: ObservationMeta): void {
    this.db.db
      .prepare(
        `INSERT INTO observation_search_index
         (observation_id, file_name, title, content, categories, primary_category, topic_keys,
          entities, source_turn_ids, status, superseded_by, project_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(observation_id) DO UPDATE SET
           file_name = excluded.file_name, title = excluded.title, content = excluded.content,
           categories = excluded.categories, primary_category = excluded.primary_category,
           topic_keys = excluded.topic_keys, entities = excluded.entities,
           source_turn_ids = excluded.source_turn_ids, status = excluded.status,
           superseded_by = excluded.superseded_by, project_id = excluded.project_id,
           updated_at = excluded.updated_at`,
      )
      .run(
        meta.observationId,
        meta.fileName,
        cleanForIndex(meta.title),
        cleanForIndex(meta.content),
        JSON.stringify(meta.categories),
        meta.primaryCategory ?? null,
        JSON.stringify(meta.topicKeys),
        JSON.stringify(meta.entities),
        JSON.stringify(meta.sourceTurnIds),
        meta.status,
        meta.supersededBy ?? null,
        meta.projectId ?? null,
        meta.createdAt,
        meta.updatedAt,
      )
  }

  /** 按 id 读取 Observation 索引。 */
  getObservation(observationId: string): ObservationMeta | undefined {
    const row = this.db.db
      .prepare('SELECT * FROM observation_search_index WHERE observation_id = ?')
      .get(observationId) as Row | undefined
    if (!row) return undefined
    return {
      observationId: asString(row.observation_id),
      fileName: asString(row.file_name),
      title: asString(row.title),
      content: asString(row.content),
      categories: parseJsonArray<ResearchCategory>(row.categories),
      primaryCategory: row.primary_category === null || row.primary_category === undefined ? undefined : asString(row.primary_category) as ResearchCategory,
      topicKeys: parseJsonArray<string>(row.topic_keys),
      entities: parseJsonArray<string>(row.entities),
      sourceTurnIds: parseJsonArray<string>(row.source_turn_ids),
      status: asString(row.status, 'active') as 'active' | 'superseded',
      supersededBy: row.superseded_by === null || row.superseded_by === undefined ? undefined : asString(row.superseded_by),
      projectId: row.project_id === null || row.project_id === undefined ? undefined : asString(row.project_id),
      createdAt: asNumber(row.created_at),
      updatedAt: asNumber(row.updated_at),
    }
  }

  /** 列出 Observation（默认只出 ACTIVE，支持项目过滤）。 */
  listObservations(options: { status?: 'active' | 'superseded'; projectId?: string; limit?: number } = {}): ObservationMeta[] {
    const clauses: string[] = []
    const params: unknown[] = []
    if (options.status) {
      clauses.push('status = ?')
      params.push(options.status)
    } else {
      clauses.push("status = 'active'")
    }
    if (options.projectId !== undefined) {
      clauses.push('project_id = ?')
      params.push(options.projectId)
    }
    const limit = options.limit ?? 200
    params.push(limit)
    const rows = this.db.db
      .prepare(`SELECT * FROM observation_search_index WHERE ${clauses.join(' AND ')} ORDER BY updated_at DESC LIMIT ?`)
      .all(...(params as Array<string | number | null>)) as Row[]
    return rows.map((row) => this.getObservation(asString(row.observation_id))!).filter(Boolean)
  }

  // ── 检索（FTS5，供 retrieval.ts 使用） ────────────────────────────────────

  /** FTS5 检索轮次，返回 {rowid, score, row}。 */
  searchTurnsFts(query: string, limit: number): Array<{ turn: TurnRecord; score: number }> {
    const rows = this.db.db
      .prepare(
        `SELECT t.*, bm25(research_turns_fts) AS score
         FROM research_turns_fts f
         JOIN research_turns t ON t.rowid = f.rowid
         WHERE research_turns_fts MATCH ?
         ORDER BY score LIMIT ?`,
      )
      .all(query, limit) as Row[]
    return rows.map((row) => ({ turn: turnFromRow(row), score: asNumber(row.score, 0) }))
  }

  /** FTS5 检索 topic states。 */
  searchTopicStatesFts(query: string, limit: number): TopicState[] {
    const rows = this.db.db
      .prepare(
        `SELECT s.* FROM category_states_fts f
         JOIN category_states s ON s.rowid = f.rowid
         WHERE category_states_fts MATCH ?
         ORDER BY bm25(category_states_fts) LIMIT ?`,
      )
      .all(query, limit) as Row[]
    return rows.map((row) => ({
      category: asString(row.category) as ResearchCategory,
      topicKey: asString(row.topic_key),
      label: asString(row.label),
      decision: asString(row.decision),
      openQuestions: parseJsonArray<string>(row.open_questions),
      sourceTurnIds: parseJsonArray<string>(row.source_turn_ids),
      updatedAt: asNumber(row.updated_at),
    }))
  }

  /** FTS5 检索 observations（默认只出 ACTIVE）。 */
  searchObservationsFts(query: string, limit: number): Array<{ observation: ObservationMeta; score: number }> {
    const rows = this.db.db
      .prepare(
        `SELECT o.*, bm25(observation_search_index_fts) AS score
         FROM observation_search_index_fts f
         JOIN observation_search_index o ON o.rowid = f.rowid
         WHERE observation_search_index_fts MATCH ? AND o.status = 'active'
         ORDER BY score LIMIT ?`,
      )
      .all(query, limit) as Row[]
    return rows.map((row) => ({
      observation: this.getObservation(asString(row.observation_id))!,
      score: asNumber(row.score, 0),
    })).filter((entry) => entry.observation !== undefined)
  }

  /**
   * 把用户查询转换为 FTS5 查询串（trigram tokenizer）：
   * 按空白/标点分词 → 剥离 token 内全部非字母数字（FTS 运算符 `-` `*` `"` `(` 等
   * 及 CJK 标点会破坏 MATCH 语法，如 "xxx】" 被解析为列名）→ 过滤 <3 字符
   * （trigram 不支持）→ 双引号短语包裹 → OR 连接。上限 16 token 防超长查询。
   */
  static toFtsQuery(query: string): string {
    const tokens = query
      .split(/[\s\p{P}\p{S}]+/u)
      .map((t) => t.replace(/[^\p{L}\p{N}]+/gu, ''))
      .filter((t) => t.length >= 3)
      .slice(0, 16)
    return tokens.map((t) => `"${t}"`).join(' OR ')
  }

  // ── Goals（v3 Goal Control） ──────────────────────────────────────────────

  /** 创建（或整版替换）Goal Contract。 */
  saveGoal(goal: GoalContract): void {
    this.db.db
      .prepare(
        `INSERT INTO research_goals (goal_id, title, objective, criteria, constraints, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(goal_id) DO UPDATE SET
           title = excluded.title, objective = excluded.objective, criteria = excluded.criteria,
           constraints = excluded.constraints, version = excluded.version, updated_at = excluded.updated_at`,
      )
      .run(
        goal.goalId,
        goal.title,
        goal.objective,
        JSON.stringify(goal.criteria),
        JSON.stringify(goal.constraints),
        goal.version,
        goal.createdAt,
        goal.updatedAt,
      )
  }

  getGoal(goalId: string): GoalContract | undefined {
    const row = this.db.db.prepare('SELECT * FROM research_goals WHERE goal_id = ?').get(goalId) as Row | undefined
    if (!row) return undefined
    return {
      goalId: asString(row.goal_id),
      title: asString(row.title),
      objective: asString(row.objective),
      criteria: parseJsonArray<GoalContract['criteria'][number]>(row.criteria),
      constraints: parseJsonArray<string>(row.constraints),
      version: asNumber(row.version, 1),
      createdAt: asNumber(row.created_at),
      updatedAt: asNumber(row.updated_at),
    }
  }

  /** 列出最近更新的合同（最新优先）。 */
  listRecentGoals(limit = 3): GoalContract[] {
    const rows = this.db.db
      .prepare('SELECT * FROM research_goals ORDER BY updated_at DESC LIMIT ?')
      .all(limit) as Row[]
    return rows
      .map((row) => this.getGoal(asString(row.goal_id)))
      .filter((goal): goal is GoalContract => goal !== undefined)
  }

  /** 追加一条 Goal 事件（幂等：同 goalId+event+时间戳去重）。 */
  appendGoalEvent(goalId: string, event: string, createdAt = Date.now()): void {
    this.db.db.prepare('INSERT OR IGNORE INTO goal_events (goal_id, event, created_at) VALUES (?, ?, ?)').run(goalId, event, createdAt)
  }

  /** 按类别统计轮次数（category_catalog 用）。 */
  countByCategory(): Record<string, number> {
    const rows = this.db.db.prepare('SELECT categories FROM research_turns').all() as Row[]
    const counts: Record<string, number> = {}
    for (const row of rows) {
      for (const category of parseJsonArray<string>(row.categories)) {
        counts[category] = (counts[category] ?? 0) + 1
      }
    }
    for (const category of RESEARCH_CATEGORIES) {
      if (counts[category] === undefined) counts[category] = 0
    }
    return counts
  }

  // ── 索引进度（backfill 断点续做） ─────────────────────────────────────────

  getIndexProgress(memoryDir: string, projectId: string): { status: string; sourceVersion: string } | undefined {
    const row = this.db.db
      .prepare('SELECT status, source_version FROM research_index_progress WHERE memory_dir = ? AND project_id = ?')
      .get(memoryDir, projectId) as Row | undefined
    if (!row) return undefined
    return { status: asString(row.status), sourceVersion: asString(row.source_version) }
  }

  setIndexProgress(memoryDir: string, projectId: string, sourceVersion: string, status: string): void {
    this.db.db
      .prepare(
        `INSERT INTO research_index_progress (memory_dir, project_id, source_version, status, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(memory_dir, project_id) DO UPDATE SET
           source_version = excluded.source_version, status = excluded.status, updated_at = excluded.updated_at`,
      )
      .run(memoryDir, projectId, sourceVersion, status, Date.now())
  }

  /** 关闭数据库。 */
  close(): void {
    this.db.close()
  }
}
