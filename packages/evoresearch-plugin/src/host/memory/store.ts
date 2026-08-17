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
 * - FTS5 表由触发器与内容表保持同步（可重建：rebuildFtsIndexes() 一键重建）；
 * - 写操作走事务，PRAGMA synchronous=FULL 保证崩溃对账以持久化边界为准。
 *
 * MEM-09 数据角色约定（最终兜底原文 vs 可重建镜像）：
 * - DSH session log（<DSH_HOME>/sessions/.../session.jsonl[.zstd]）是对话原文的
 *   最终兜底：完整保留 user/assistant/chunk/tool 事件，永不删除、不可被摘要替代；
 * - 本数据库（research_memory.db 及其 FTS 索引）只是方便检索的镜像，不是唯一副本：
 *   轮次原文缺失时可由 recovery.ts 从 session log 经 session-text.ts 还原补回
 *   （recoverMissingAssistantText / reconcileStore），FTS 索引可用
 *   rebuildFtsIndexes() 重建，数据库本身可整体删除后由归档流程重建；
 * - Raw Turn Archive（turn_segments）与 archives/ 目录是二次落盘副本，同样可重建。
 */
import { DatabaseSync } from 'node:sqlite'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { evoresearchDb, type Migration, cleanForIndex } from '../core/db.js'
import type { ToolEventItem, TurnArchiveEvent } from '../session-text.js'
import {
  type TurnRecord,
  type TurnStatus,
  type ResearchCategory,
  type TopicState,
  type ObservationMeta,
  type GoalContract,
  type GoalProposal,
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
  {
    // §19.6：Goal Contract 修改提案（只建待确认提案；接受时应用为新版本合同）。
    version: 3,
    up(db) {
      db.exec(`
        CREATE TABLE goal_proposals (
          proposal_id TEXT PRIMARY KEY,
          goal_id TEXT NOT NULL REFERENCES research_goals(goal_id),
          title TEXT NOT NULL,
          summary TEXT NOT NULL DEFAULT '',
          changes TEXT NOT NULL DEFAULT '{}',
          status TEXT NOT NULL DEFAULT 'pending',
          created_at INTEGER NOT NULL
        );
        CREATE INDEX idx_goal_proposals ON goal_proposals(goal_id, status, created_at);
      `)
    },
  },
  {
    // §21.5：link_observations —— Observation 关联关系（双向）。
    version: 4,
    up(db) {
      db.exec(`
        ALTER TABLE observation_search_index ADD COLUMN related_observation_ids TEXT NOT NULL DEFAULT '[]';
      `)
    },
  },
  {
    // §36.2/§17.4：工具收据审计——补 tool_name 与参数/结果 digest。
    version: 5,
    up(db) {
      db.exec(`
        ALTER TABLE tool_execution_receipts ADD COLUMN tool_name TEXT;
        ALTER TABLE tool_execution_receipts ADD COLUMN arguments_digest TEXT;
        ALTER TABLE tool_execution_receipts ADD COLUMN result_digest TEXT;
      `)
    },
  },
  {
    // RET-01/RET-02：消息/自然段级片段索引（turn_fragments）+ FTS 镜像 + 断点进度。
    // 片段只用于搜索，不改变原始文本；位置 = (session_id, seg_seq, char_offset)，
    // seg_seq 指向 Raw Turn Archive（turn_segments.seq），可经 read_conversation_range
    // 回到原文前后文。索引可重建：清空 turn_fragments 后由 backfillFragmentIndex /
    // buildTurnFragments 重灌（RET-09：FTS 不可用时退化为 LIKE 原文扫描）。
    version: 6,
    up(db) {
      db.exec(`
        CREATE TABLE turn_fragments (
          fragment_id TEXT PRIMARY KEY,
          turn_id TEXT NOT NULL REFERENCES research_turns(turn_id),
          session_id TEXT NOT NULL,
          seg_seq INTEGER NOT NULL,
          kind TEXT NOT NULL,
          frag_index INTEGER NOT NULL DEFAULT 0,
          char_offset INTEGER NOT NULL DEFAULT 0,
          char_len INTEGER NOT NULL DEFAULT 0,
          content TEXT NOT NULL,
          source_seqs TEXT NOT NULL DEFAULT '[]',
          created_at INTEGER NOT NULL
        );
        CREATE INDEX idx_fragments_turn ON turn_fragments(turn_id, seg_seq, frag_index);
        CREATE INDEX idx_fragments_session ON turn_fragments(session_id, seg_seq, frag_index);

        CREATE VIRTUAL TABLE turn_fragments_fts USING fts5(
          content,
          content='turn_fragments', content_rowid='rowid',
          tokenize = 'trigram'
        );
        CREATE TRIGGER turn_fragments_ai AFTER INSERT ON turn_fragments BEGIN
          INSERT INTO turn_fragments_fts(rowid, content) VALUES (new.rowid, new.content);
        END;
        CREATE TRIGGER turn_fragments_ad AFTER DELETE ON turn_fragments BEGIN
          INSERT INTO turn_fragments_fts(turn_fragments_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
        END;
        CREATE TRIGGER turn_fragments_au AFTER UPDATE ON turn_fragments BEGIN
          INSERT INTO turn_fragments_fts(turn_fragments_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
          INSERT INTO turn_fragments_fts(rowid, content) VALUES (new.rowid, new.content);
        END;

        CREATE TABLE fragment_index_progress (
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
]

/** 数据库行（宽松类型，读取后立即转换为领域对象）。 */
type Row = Record<string, unknown>

/**
 * MEM-06 长文本落盘阈值：工具调用参数/结果超过该字节数时，完整内容写入
 * <workspace>/.evoresearch-data/archives/<turnId>/ 文件，数据库只存可检索前缀 + 文件位置。
 */
export const LONG_TEXT_THRESHOLD = 64 * 1024

/** 长文本入库的可检索前缀长度（保留开头，保证搜索可用）。 */
export const LONG_TEXT_INDEX_CHARS = 32 * 1024

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' ? value : fallback
}

/** §36.2 审计摘要：稳定值 SHA-256 前 16 位。 */
function digestOf(value: unknown): string {
  let text: string
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value)
  } catch {
    text = String(value)
  }
  return createHash('sha256').update(text).digest('hex').slice(0, 16)
}

function parseJsonArray<T>(value: unknown): T[] {
  try {
    const parsed = JSON.parse(asString(value, '[]')) as unknown
    return Array.isArray(parsed) ? (parsed as T[]) : []
  } catch {
    return []
  }
}

function parseJsonObject<T>(value: unknown): T {
  try {
    const parsed = JSON.parse(asString(value, '{}')) as unknown
    return typeof parsed === 'object' && parsed !== null ? (parsed as T) : ({} as T)
  } catch {
    return {} as T
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

/** 从数据库行还原 TurnFragment（RET-01）。 */
function fragmentFromRow(row: Row): TurnFragment {
  const kind = asString(row.kind, 'assistant') as TurnFragment['kind']
  return {
    fragmentId: asString(row.fragment_id),
    turnId: asString(row.turn_id),
    sessionId: asString(row.session_id),
    segSeq: asNumber(row.seg_seq),
    kind,
    fragIndex: asNumber(row.frag_index),
    charOffset: asNumber(row.char_offset),
    charLen: asNumber(row.char_len),
    content: asString(row.content),
    sourceSeqs: parseJsonArray<number>(row.source_seqs),
    createdAt: asNumber(row.created_at),
  }
}

/**
 * 消息/自然段级切分（RET-01）：只用于搜索，不改变原始文本。
 * 切分策略：空行段落优先；归档文本经 cleanForIndex 压缩空白后无空行，
 * 退化为句末标点（。！？；.!?;）切句；单句超长再按 MAX_PIECE 截断。
 * 返回每段的序号与在原文（trim 后）中的字符偏移。
 */
function splitFragments(text: string): Array<{ index: number; offset: number; text: string }> {
  const trimmed = text.trim()
  if (trimmed === '') return []
  const SENTENCE_END = new Set(['。', '！', '？', '；', '.', '!', '?', ';', '\n'])
  const MAX_PIECE = 2000
  const pieces: Array<{ index: number; offset: number; text: string }> = []
  let start = 0
  let cut = 0
  for (let i = 0; i < trimmed.length; i++) {
    if (!SENTENCE_END.has(trimmed[i]!)) continue
    cut = i + 1 // 句末标点留在前一段
    if (cut - start >= 20 || i === trimmed.length - 1) {
      const piece = trimmed.slice(start, cut).trim()
      if (piece !== '') pieces.push({ index: pieces.length, offset: start, text: piece })
      start = cut
    }
  }
  if (start < trimmed.length) {
    const tail = trimmed.slice(start).trim()
    if (tail !== '') pieces.push({ index: pieces.length, offset: start, text: tail })
  }
  // 超长片段按 MAX_PIECE 再切（防止单句过长成为不可用的巨段）
  const result: Array<{ index: number; offset: number; text: string }> = []
  for (const piece of pieces) {
    if (piece.text.length <= MAX_PIECE) {
      result.push(piece)
      continue
    }
    for (let i = 0; i < piece.text.length; i += MAX_PIECE) {
      result.push({ index: result.length, offset: piece.offset + i, text: piece.text.slice(i, i + MAX_PIECE) })
    }
  }
  return result
}

/** 工具事件的可读文本（片段索引用）。 */
function toolReadableText(tool: ToolEventItem): string {
  const parts: string[] = [`[tool:${tool.kind}]`]
  if (tool.name !== undefined) parts.push(tool.name)
  if (tool.arguments !== undefined) parts.push(tool.arguments.slice(0, 4000))
  if (tool.result !== undefined) parts.push('⇒ ' + tool.result.slice(0, 4000))
  if (tool.error !== undefined) parts.push(`(error: ${tool.error.slice(0, 500)})`)
  return parts.join(' ')
}

/** 工具段 payload（JSON）的可读文本（会话阅读视图/片段索引用）。 */
function toolPayloadReadableText(payload: string): string {
  const parsed = JSON.parse(payload) as {
    kind?: unknown
    callId?: unknown
    name?: unknown
    arguments?: unknown
    result?: unknown
    error?: unknown
  }
  const parts: string[] = [`[tool:${String(parsed.kind ?? '')}]`]
  if (typeof parsed.name === 'string') parts.push(parsed.name)
  if (typeof parsed.arguments === 'string') parts.push(parsed.arguments.slice(0, 4000))
  if (typeof parsed.result === 'string') parts.push('⇒ ' + parsed.result.slice(0, 4000))
  if (parsed.error !== undefined) parts.push(`(error: ${String(parsed.error).slice(0, 500)})`)
  return parts.join(' ')
}

/** LIKE 模式转义（% _ \ 字面匹配，RET-09 回退路径）。 */
function escapeLikePattern(text: string): string {
  return text.replace(/[\\%_]/g, (ch) => `\\${ch}`)
}

/** Observation frontmatter 字段名。 */
interface ObservationFrontmatter {
  title?: string
  categories?: string[]
  primary_category?: string
  topic_keys?: string[]
  entities?: string[]
  source_turn_ids?: string[]
  related_observation_ids?: string[]
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
    if (key === 'categories' || key === 'topic_keys' || key === 'entities' || key === 'source_turn_ids' || key === 'related_observation_ids') {
      const list = Array.isArray(value) ? value : [value]
      if (key === 'categories') frontmatter.categories = list
      else if (key === 'topic_keys') frontmatter.topic_keys = list
      else if (key === 'entities') frontmatter.entities = list
      else if (key === 'source_turn_ids') frontmatter.source_turn_ids = list
      else frontmatter.related_observation_ids = list
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
  relatedObservationIds?: readonly string[]
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
    meta.relatedObservationIds && meta.relatedObservationIds.length > 0 ? `related_observation_ids: ${JSON.stringify(meta.relatedObservationIds)}` : null,
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

/**
 * RET-01：消息/自然段级片段索引行（只用于搜索，不改变原始文本）。
 * 位置回到会话原文：session_id（会话）+ seg_seq（Raw Turn Archive 段序号，
 * turn_segments.seq）+ char_offset/char_len（段内偏移）。
 */
export interface TurnFragment {
  readonly fragmentId: string
  readonly turnId: string
  readonly sessionId: string
  readonly segSeq: number
  readonly kind: 'user' | 'assistant' | 'tool' | 'summary' | 'note'
  /** 段内自然段序号（0 = 整段/未分段）。 */
  readonly fragIndex: number
  /** 片段在段 payload 中的起始偏移（字符）。 */
  readonly charOffset: number
  readonly charLen: number
  readonly content: string
  /** 来源 DSH 事件 seq（工具片段为工具事件 seq；其余为空）。 */
  readonly sourceSeqs: readonly number[]
  readonly createdAt: number
}

/** 科研记忆 存储门面：封装 research_memory.db 的全部读写。 */
export class ResearchMemoryStore {
  readonly db: evoresearchDb
  /** 原始档案目录（长工具结果/参数落盘位置；内存库测试可显式传入）。 */
  readonly archivesDir: string | undefined
  /** 持久化源目录；恢复备份必须从这里复制数据库，而不是从备份目录复制。 */
  readonly memoryDir: string | undefined

  private constructor(db: evoresearchDb, archivesDir?: string, memoryDir?: string) {
    this.db = db
    this.archivesDir = archivesDir
    this.memoryDir = memoryDir
  }

  /** 打开项目记忆库（目录不存在时自动创建）；archives 目录 = memories 的兄弟目录。 */
  static open(memoryDir: string): ResearchMemoryStore {
    const file = path.join(memoryDir, 'research_memory.db')
    const archivesDir = path.join(memoryDir, '..', 'archives')
    return new ResearchMemoryStore(evoresearchDb.open(file, RESEARCH_MEMORY_MIGRATIONS), archivesDir, memoryDir)
  }

  /** 内存库（测试用）；可选传入 archivesDir 以测试长文本落盘。 */
  static openMemory(archivesDir?: string): ResearchMemoryStore {
    return new ResearchMemoryStore(evoresearchDb.openMemory(RESEARCH_MEMORY_MIGRATIONS), archivesDir)
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

  /** 记录工具调用开始（§36.2：带工具名与参数 digest 审计）。 */
  recordToolStarted(toolCallId: string, turnId: string | undefined, toolName?: string, argumentsValue?: unknown): void {
    this.db.db
      .prepare(
        `INSERT OR IGNORE INTO tool_execution_receipts (tool_call_id, turn_id, status, started_at, tool_name, arguments_digest)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(toolCallId, turnId ?? null, 'started', Date.now(), toolName ?? null, argumentsValue === undefined ? null : digestOf(argumentsValue))
  }

  /** 记录工具调用完成（ToolMessage 已提交后补记；§36.2 写结果 digest）。 */
  recordToolCompleted(toolCallId: string, resultValue?: unknown): void {
    this.db.db
      .prepare("UPDATE tool_execution_receipts SET status = 'completed', completed_at = ?, result_digest = ? WHERE tool_call_id = ?")
      .run(Date.now(), resultValue === undefined ? null : digestOf(resultValue), toolCallId)
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

  /**
   * 追加一段原始轮次内容（分段归档，原始历史永不清除）。
   * MEM-07 幂等：按 segment_id INSERT OR IGNORE，同一段重复追加不会产生重复行
   * （segment_id 由调用方按确定性规则生成，如 archiveTurn 的 s-<turnId>-<suffix>）。
   * @returns 是否实际插入（false = 已存在，幂等跳过）。
   */
  appendSegment(input: { segmentId: string; turnId: string; kind: 'user' | 'assistant' | 'tool' | 'summary' | 'note'; payload: string }): boolean {
    const nextSeq = this.nextSegmentSeq(input.turnId)
    const result = this.db.db
      .prepare('INSERT OR IGNORE INTO turn_segments (segment_id, turn_id, seq, kind, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(input.segmentId, input.turnId, nextSeq, input.kind, input.payload, Date.now())
    return result.changes > 0
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
   * 整轮归档：把轮次快照写入 segments（用户消息/回答/工具事件/摘要/打断说明）。
   * research_turns 记录本身保留（活跃投影），segments 为不可变原始档案。
   *
   * MEM-06：extra.tools 中的工具调用与结果按原事件顺序（seq 升序）写入
   * kind='tool' 的 segment；参数/结果超过 LONG_TEXT_THRESHOLD 时完整内容写入
   * archives/ 目录文件，payload 只保留可检索前缀 + 文件位置。
   *
   * MEM-07 幂等：所有 segment_id 确定性生成 + appendSegment 的 INSERT OR IGNORE，
   * 重复执行（含崩溃后重跑）不会产生重复 segment；已归档但缺某段（如对账补回
   * assistantText 后缺 assistant 段）时重跑会自动补齐缺失段。
   * @returns 本次实际插入的 segment 数（0 = 全部已存在）。
   */
  archiveTurn(turn: TurnRecord, extra: { tools?: readonly ToolEventItem[]; events?: readonly TurnArchiveEvent[] } = {}): number {
    let inserted = 0
    const events = extra.events !== undefined && extra.events.length > 0
      ? [...extra.events]
      : this.legacyArchiveEvents(turn, extra.tools ?? [])
    const usedIds = new Set<string>()
    let assistantIndex = 0
    let toolIndex = 0
    for (const event of events.sort((a, b) => a.order - b.order)) {
      if (event.kind === 'user') {
        const id = `s-${turn.turnId}-u`
        if (usedIds.has(id)) continue
        usedIds.add(id)
        inserted += this.appendSegment({ segmentId: id, turnId: turn.turnId, kind: 'user', payload: event.text ?? turn.userText }) ? 1 : 0
        continue
      }
      if (event.kind === 'assistant') {
        const text = event.text ?? ''
        if (text === '') continue
        const id = assistantIndex === 0 ? `s-${turn.turnId}-a` : `s-${turn.turnId}-a-${event.step ?? assistantIndex}`
        assistantIndex += 1
        if (usedIds.has(id)) continue
        usedIds.add(id)
        inserted += this.appendSegment({ segmentId: id, turnId: turn.turnId, kind: 'assistant', payload: text }) ? 1 : 0
        continue
      }
      const tool = event.tool
      if (tool === undefined) continue
      const base = `s-${turn.turnId}-t-${tool.seq}`
      const id = usedIds.has(base) ? `${base}-${toolIndex}` : base
      usedIds.add(id)
      toolIndex += 1
      const payload = this.toolSegmentPayload(turn.turnId, tool)
      inserted += this.appendSegment({ segmentId: id, turnId: turn.turnId, kind: 'tool', payload }) ? 1 : 0
    }
    // 兼容旧 accumulator：如果事件投影没有正文，仍补齐 TurnRecord 中的原文。
    if (turn.userText && !events.some((event) => event.kind === 'user')) {
      inserted += this.appendSegment({ segmentId: `s-${turn.turnId}-u`, turnId: turn.turnId, kind: 'user', payload: turn.userText }) ? 1 : 0
    }
    if (turn.assistantText && !events.some((event) => event.kind === 'assistant')) {
      inserted += this.appendSegment({ segmentId: `s-${turn.turnId}-a`, turnId: turn.turnId, kind: 'assistant', payload: turn.assistantText }) ? 1 : 0
    }
    if (turn.workingSummary) {
      inserted += this.appendSegment({ segmentId: `s-${turn.turnId}-s`, turnId: turn.turnId, kind: 'summary', payload: turn.workingSummary }) ? 1 : 0
    }
    if (turn.partialNote) {
      inserted += this.appendSegment({ segmentId: `s-${turn.turnId}-n`, turnId: turn.turnId, kind: 'note', payload: turn.partialNote }) ? 1 : 0
    }
    return inserted
  }

  /** 旧调用没有有序事件时保持历史行为，同时按工具 seq 排序。 */
  private legacyArchiveEvents(turn: TurnRecord, tools: readonly ToolEventItem[]): TurnArchiveEvent[] {
    const events: TurnArchiveEvent[] = []
    if (turn.userText) events.push({ order: Number.NEGATIVE_INFINITY, kind: 'user', text: turn.userText })
    if (turn.assistantText) events.push({ order: 0, kind: 'assistant', step: 0, text: turn.assistantText })
    for (const tool of [...tools].sort((a, b) => a.seq - b.seq)) {
      events.push({ order: tool.seq + 1, kind: 'tool', tool })
    }
    return events
  }

  /**
   * 工具事件 segment 的 payload（JSON）：含事件原序 seq、callId、名称/参数/结果；
   * 超长参数或结果 → 完整内容落盘 archives/，payload 只存可检索前缀 + 文件位置。
   */
  private toolSegmentPayload(turnId: string, tool: ToolEventItem): string {
    const payload: Record<string, unknown> = { seq: tool.seq, kind: tool.kind, callId: tool.callId }
    if (tool.name !== undefined) payload.name = tool.name
    if (tool.arguments !== undefined) {
      const stored = this.stashLongText(turnId, `t${tool.seq}-args`, tool.arguments)
      payload.arguments = stored.text
      if (stored.file !== undefined) payload.argumentsFile = stored.file
    }
    if (tool.result !== undefined) {
      const stored = this.stashLongText(turnId, `t${tool.seq}-result`, tool.result)
      payload.result = stored.text
      if (stored.file !== undefined) payload.resultFile = stored.file
    }
    if (tool.error !== undefined) payload.error = tool.error
    return JSON.stringify(payload)
  }

  /** 超长文本落盘：完整内容写入 archives/<turnId>/，返回可检索前缀与文件位置。 */
  private stashLongText(turnId: string, tag: string, text: string): { text: string; file?: string } {
    if (text.length <= LONG_TEXT_THRESHOLD || this.archivesDir === undefined) return { text }
    const dir = path.join(this.archivesDir, turnId)
    fs.mkdirSync(dir, { recursive: true })
    const safeTag = tag.replace(/[^A-Za-z0-9_-]/g, '_')
    const file = path.join(dir, `${safeTag}.txt`)
    fs.writeFileSync(file, text, 'utf8')
    const prefix = text.slice(0, LONG_TEXT_INDEX_CHARS)
    return { text: `${prefix}\n…（完整内容 ${text.length} 字符已归档: ${file}）`, file }
  }

  // ── Fragment Index（RET-01/02/09：消息/自然段级片段索引） ───────────────────

  /** 从归档 segments 重建某轮的片段索引（幂等：先清后建，返回片段数）。 */
  buildTurnFragments(turnId: string): number {
    const turn = this.getTurn(turnId)
    if (!turn) return 0
    const segments = this.listSegments(turnId)
    if (segments.length === 0) return 0
    return this.replaceTurnFragments(
      turnId,
      turn.sessionId,
      segments.map((segment) => this.fragmentPartForSegment(segment)),
    )
  }

  /**
   * 从轮次原文（userText/assistantText/tools）建片段索引——无归档（Raw Turn
   * Archive 缺 user 段）时由 RET-02 从 DSH session log 还原后调用（兜底路径）。
   * seg_seq 使用合成序号（0=user, 1=assistant, 2+=tools），位置仍可读。
   */
  buildTurnFragmentsFromParts(input: {
    turnId: string
    sessionId: string
    userText: string
    assistantText: string
    tools?: readonly ToolEventItem[]
  }): number {
    const parts: Array<{ segSeq: number; kind: 'user' | 'assistant' | 'tool'; text: string }> = []
    if (input.userText) parts.push({ segSeq: 0, kind: 'user', text: input.userText })
    if (input.assistantText) parts.push({ segSeq: 1, kind: 'assistant', text: input.assistantText })
    for (const tool of input.tools ?? []) {
      parts.push({ segSeq: 2 + parts.length, kind: 'tool', text: toolReadableText(tool) })
    }
    return this.replaceTurnFragments(input.turnId, input.sessionId, parts)
  }

  /** 某轮的片段数（RET-02 断点续做：>0 视为已索引）。 */
  countTurnFragments(turnId: string): number {
    const row = this.db.db.prepare('SELECT COUNT(*) AS n FROM turn_fragments WHERE turn_id = ?').get(turnId) as Row
    return asNumber(row.n)
  }

  /** 读取某轮的片段（按 seg_seq, frag_index 升序）。 */
  listTurnFragments(turnId: string): TurnFragment[] {
    const rows = this.db.db
      .prepare('SELECT * FROM turn_fragments WHERE turn_id = ? ORDER BY seg_seq ASC, frag_index ASC')
      .all(turnId) as Row[]
    return rows.map(fragmentFromRow)
  }

  /** 整轮重建：事务内删除旧片段并插入新片段（可重复执行）。 */
  private replaceTurnFragments(
    turnId: string,
    sessionId: string,
    parts: ReadonlyArray<{ segSeq: number; kind: 'user' | 'assistant' | 'tool' | 'summary' | 'note'; text: string }>,
  ): number {
    const now = Date.now()
    const insert = this.db.db.prepare(
      `INSERT INTO turn_fragments (fragment_id, turn_id, session_id, seg_seq, kind, frag_index, char_offset, char_len, content, source_seqs, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    return this.db.transaction(() => {
      this.db.db.prepare('DELETE FROM turn_fragments WHERE turn_id = ?').run(turnId)
      let count = 0
      for (const part of parts) {
        for (const piece of splitFragments(part.text)) {
          insert.run(
            `fr-${turnId}-${part.segSeq}-${piece.index}`,
            turnId,
            sessionId,
            part.segSeq,
            part.kind,
            piece.index,
            piece.offset,
            piece.text.length,
            piece.text,
            '[]',
            now,
          )
          count += 1
        }
      }
      return count
    })
  }

  /** segment → 片段文本（工具段解析 JSON 为可读文本；超长截断）。 */
  private fragmentPartForSegment(segment: { seq: number; kind: string; payload: string }): {
    segSeq: number
    kind: 'user' | 'assistant' | 'tool' | 'summary' | 'note'
    text: string
  } {
    if (segment.kind === 'tool') {
      try {
        return { segSeq: segment.seq, kind: 'tool', text: toolPayloadReadableText(segment.payload) }
      } catch {
        return { segSeq: segment.seq, kind: 'tool', text: segment.payload.slice(0, 8000) }
      }
    }
    const kind = segment.kind === 'user' || segment.kind === 'assistant' || segment.kind === 'summary' || segment.kind === 'note'
      ? segment.kind
      : 'assistant'
    return { segSeq: segment.seq, kind, text: segment.payload }
  }

  /**
   * 片段检索（RET-03/RET-09）：FTS5 优先，失败自动退化为 LIKE 原文扫描；
   * 可按会话过滤（find_in_conversation，RET-04）。mode 显式指定时不做自动退化。
   */
  searchFragments(
    query: string,
    limit: number,
    options: { sessionId?: string; mode?: 'auto' | 'fts' | 'like' } = {},
  ): Array<{ fragment: TurnFragment; score: number }> {
    const mode = options.mode ?? 'auto'
    const ftsQuery = ResearchMemoryStore.toFtsQuery(query)
    if (mode !== 'like' && ftsQuery.length > 0) {
      try {
        const sql = options.sessionId
          ? `SELECT f.*, bm25(turn_fragments_fts) AS score
             FROM turn_fragments_fts t
             JOIN turn_fragments f ON f.rowid = t.rowid
             WHERE turn_fragments_fts MATCH ? AND f.session_id = ?
             ORDER BY score LIMIT ?`
          : `SELECT f.*, bm25(turn_fragments_fts) AS score
             FROM turn_fragments_fts t
             JOIN turn_fragments f ON f.rowid = t.rowid
             WHERE turn_fragments_fts MATCH ?
             ORDER BY score LIMIT ?`
        const rows = options.sessionId
          ? (this.db.db.prepare(sql).all(ftsQuery, options.sessionId, limit) as Row[])
          : (this.db.db.prepare(sql).all(ftsQuery, limit) as Row[])
        return rows.map((row) => ({ fragment: fragmentFromRow(row), score: Math.abs(asNumber(row.score, 0)) }))
      } catch (error) {
        if (mode === 'fts') throw error
        // auto：FTS5 不可用/查询失败 → 退化为 LIKE 原文扫描（RET-09）
      }
    }
    return this.searchFragmentsLike(query, limit, options.sessionId)
  }

  /** LIKE 原文扫描回退路径（RET-09；对 % _ 转义，不破坏查询语义）。 */
  searchFragmentsLike(query: string, limit: number, sessionId?: string): Array<{ fragment: TurnFragment; score: number }> {
    const tokens = query
      .split(/[\s\p{P}\p{S}]+/u)
      .map((token) => token.replace(/[^\p{L}\p{N}]+/gu, ''))
      .filter((token) => token !== '')
      .slice(0, 16)
    // Trigram FTS cannot match short CJK terms. Require all query terms in the
    // raw text so a two-term Chinese query does not become an impossible
    // literal substring search (for example: "编剧 档期").
    if (tokens.length > 1) {
      const predicates = tokens.map(() => `content LIKE ? ESCAPE '\\'`).join(' AND ')
      const params = tokens.map((token) => `%${escapeLikePattern(token)}%`)
      const sql = sessionId
        ? `SELECT * FROM turn_fragments WHERE ${predicates} AND session_id = ? ORDER BY length(content) ASC, created_at DESC LIMIT ?`
        : `SELECT * FROM turn_fragments WHERE ${predicates} ORDER BY length(content) ASC, created_at DESC LIMIT ?`
      const rows = (this.db.db.prepare(sql).all(...params, ...(sessionId === undefined ? [] : [sessionId]), limit) as Row[])
      if (rows.length > 0) return rows.map((row) => ({ fragment: fragmentFromRow(row), score: 0.5 + tokens.length / 100 }))
    }
    const pattern = `%${escapeLikePattern(query)}%`
    const rows = sessionId
      ? (this.db.db
          .prepare(`SELECT * FROM turn_fragments WHERE content LIKE ? ESCAPE '\\' AND session_id = ? ORDER BY length(content) ASC, created_at DESC LIMIT ?`)
          .all(pattern, sessionId, limit) as Row[])
      : (this.db.db
          .prepare(`SELECT * FROM turn_fragments WHERE content LIKE ? ESCAPE '\\' ORDER BY length(content) ASC, created_at DESC LIMIT ?`)
          .all(pattern, limit) as Row[])
    return rows.map((row) => ({ fragment: fragmentFromRow(row), score: 0.5 }))
  }

  /** 轮次级 LIKE 回退（RET-09：FTS 不可用时仍可搜 research_turns 原文）。 */
  searchTurnsLike(query: string, limit: number): Array<{ turn: TurnRecord; score: number }> {
    const pattern = `%${escapeLikePattern(query)}%`
    const rows = this.db.db
      .prepare(`SELECT * FROM research_turns WHERE user_text LIKE ? ESCAPE '\\' OR assistant_text LIKE ? ESCAPE '\\' ORDER BY created_at DESC LIMIT ?`)
      .all(pattern, pattern, limit) as Row[]
    return rows.map((row) => ({ turn: turnFromRow(row), score: 0.5 }))
  }

  /** Observation 级 LIKE 回退（RET-09）。 */
  searchObservationsLike(query: string, limit: number): Array<{ observation: ObservationMeta; score: number }> {
    const pattern = `%${escapeLikePattern(query)}%`
    const rows = this.db.db
      .prepare(`SELECT * FROM observation_search_index WHERE title LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\' ORDER BY updated_at DESC LIMIT ?`)
      .all(pattern, pattern, limit) as Row[]
    return rows
      .map((row) => ({ observation: this.getObservation(asString(row.observation_id))!, score: 0.5 }))
      .filter((entry) => entry.observation !== undefined)
  }

  /**
   * 会话级原文序列（RET-05/08 的阅读视图）：按时间升序把该会话各轮归档段
   * 拍平成列表；工具段解析为可读文本。位置 = (turnId, segSeq)。
   */
  conversationSegments(sessionId: string, limitTurns = 200): Array<{ turnId: string; segSeq: number; kind: string; text: string; turnCreatedAt: number }> {
    const turns = this.listTurns(sessionId, limitTurns).reverse() // listTurns 最新优先 → 升序
    const items: Array<{ turnId: string; segSeq: number; kind: string; text: string; turnCreatedAt: number }> = []
    for (const turn of turns) {
      for (const segment of this.listSegments(turn.turnId)) {
        let text = segment.payload
        if (segment.kind === 'tool') {
          try {
            text = toolPayloadReadableText(segment.payload)
          } catch {
            text = segment.payload.slice(0, 8000)
          }
        }
        items.push({ turnId: turn.turnId, segSeq: segment.seq, kind: segment.kind, text, turnCreatedAt: turn.createdAt })
      }
    }
    return items
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
    relatedObservationIds?: readonly string[]
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
      relatedObservationIds: input.relatedObservationIds,
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
      relatedObservationIds: input.relatedObservationIds ?? [],
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
        relatedObservationIds: meta.relatedObservationIds,
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

  /**
   * link_observations（§21.5）：建立/更新 Observation 关联关系（双向）。
   * 合并去重写入关联 id 列表，更新文件 frontmatter 与索引，updated_at 刷新。
   */
  linkObservations(observationsDir: string, observationId: string, relatedIds: readonly string[]): { ok: boolean; related: readonly string[] } {
    const meta = this.getObservation(observationId)
    if (!meta) return { ok: false, related: [] }
    const merged = Array.from(new Set([...(meta.relatedObservationIds ?? []), ...relatedIds]))
    const now = Date.now()
    this.rewriteObservationFile(observationsDir, meta, { relatedObservationIds: merged, updatedAt: now })
    // 反向：让每个 related 观测也包含本观测 id（双向链接）
    for (const otherId of merged) {
      const other = this.getObservation(otherId)
      if (!other || other.observationId === observationId) continue
      const otherMerged = Array.from(new Set([...(other.relatedObservationIds ?? []), observationId]))
      this.rewriteObservationFile(observationsDir, other, { relatedObservationIds: otherMerged, updatedAt: now })
    }
    return { ok: true, related: merged }
  }

  /** 重写观测文件 + 索引（链接/更新共用）。 */
  private rewriteObservationFile(observationsDir: string, meta: ObservationMeta, patch: Partial<ObservationMeta>): void {
    const next: ObservationMeta = { ...meta, ...patch }
    const dir = meta.projectId ? path.join(observationsDir, 'projects', meta.projectId) : path.join(observationsDir, 'global')
    fs.writeFileSync(
      path.join(dir, meta.fileName),
      renderObservationFile({
        title: next.title,
        body: next.content.split('\n---\n')[1] ?? next.content,
        categories: next.categories,
        primaryCategory: next.primaryCategory,
        topicKeys: next.topicKeys,
        entities: next.entities,
        sourceTurnIds: next.sourceTurnIds,
        relatedObservationIds: next.relatedObservationIds,
        status: next.status,
        supersededBy: next.supersededBy,
        projectId: next.projectId,
        createdAt: next.createdAt,
        updatedAt: next.updatedAt,
      }),
      'utf8',
    )
    this.upsertObservationIndex(next)
  }

  /** 镜像索引写入（文件写入后同步）。 */
  private upsertObservationIndex(meta: ObservationMeta): void {
    this.db.db
      .prepare(
        `INSERT INTO observation_search_index
         (observation_id, file_name, title, content, categories, primary_category, topic_keys,
          entities, source_turn_ids, related_observation_ids, status, superseded_by, project_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(observation_id) DO UPDATE SET
           file_name = excluded.file_name, title = excluded.title, content = excluded.content,
           categories = excluded.categories, primary_category = excluded.primary_category,
           topic_keys = excluded.topic_keys, entities = excluded.entities,
           source_turn_ids = excluded.source_turn_ids, related_observation_ids = excluded.related_observation_ids,
           status = excluded.status,
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
        JSON.stringify(meta.relatedObservationIds ?? []),
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
      relatedObservationIds: parseJsonArray<string>(row.related_observation_ids),
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
   * 一键重建全部 FTS5 索引（MEM-09/RET-09：索引可重建）。
   * FTS5 外部内容表的触发器保持同步；索引损坏或回滚后执行标准 rebuild 即可恢复，
   * 不触碰内容表（research_turns / category_states / observation_search_index / turn_fragments）。
   */
  rebuildFtsIndexes(): void {
    for (const table of ['research_turns_fts', 'category_states_fts', 'observation_search_index_fts', 'turn_fragments_fts'] as const) {
      this.db.db.exec(`INSERT INTO ${table}(${table}) VALUES('rebuild')`)
    }
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

  // ── Goal 修改提案（§19.6） ────────────────────────────────────────────────

  /** 读取单个提案。 */
  getGoalProposal(proposalId: string): GoalProposal | undefined {
    const row = this.db.db.prepare('SELECT * FROM goal_proposals WHERE proposal_id = ?').get(proposalId) as Row | undefined
    if (!row) return undefined
    return {
      proposalId: asString(row.proposal_id),
      goalId: asString(row.goal_id),
      title: asString(row.title),
      summary: asString(row.summary),
      changes: parseJsonObject<GoalProposal['changes']>(row.changes),
      status: asString(row.status) as GoalProposal['status'],
      createdAt: asNumber(row.created_at),
    }
  }

  /** 列出某合同的提案（最新优先）。 */
  listGoalProposals(goalId: string): GoalProposal[] {
    const rows = this.db.db
      .prepare('SELECT * FROM goal_proposals WHERE goal_id = ? ORDER BY created_at DESC')
      .all(goalId) as Row[]
    return rows
      .map((row) => this.getGoalProposal(asString(row.proposal_id)))
      .filter((p): p is GoalProposal => p !== undefined)
  }

  /** 创建待确认提案（§19.6：不直接修改合同）。 */
  createGoalProposal(args: { goalId: string; title: string; summary?: string; changes: GoalProposal['changes'] }): GoalProposal {
    const goal = this.getGoal(args.goalId)
    if (!goal) throw new Error(`目标合同不存在: ${args.goalId}`)
    const proposal: GoalProposal = {
      proposalId: randomUUID(),
      goalId: args.goalId,
      title: args.title,
      summary: args.summary ?? '',
      changes: args.changes,
      status: 'pending',
      createdAt: Date.now(),
    }
    this.db.db
      .prepare(
        `INSERT INTO goal_proposals (proposal_id, goal_id, title, summary, changes, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(proposal.proposalId, proposal.goalId, proposal.title, proposal.summary, JSON.stringify(proposal.changes), proposal.status, proposal.createdAt)
    return proposal
  }

  /**
   * 接受/拒绝提案。接受时把 changes 合并进当前合同并生成新版本（version+1）；
   * 拒绝仅标记状态。返回更新后的提案与（接受时的）新合同。
   */
  respondGoalProposal(proposalId: string, decision: 'approve' | 'reject'): { proposal: GoalProposal; goal?: GoalContract } {
    const proposal = this.getGoalProposal(proposalId)
    if (!proposal) throw new Error(`提案不存在: ${proposalId}`)
    if (proposal.status !== 'pending') throw new Error(`提案已处理（${proposal.status}）`)
    const goal = this.getGoal(proposal.goalId)
    if (!goal) throw new Error(`目标合同不存在: ${proposal.goalId}`)
    const now = Date.now()
    let updatedGoal: GoalContract | undefined
    if (decision === 'approve') {
      const changes = proposal.changes
      updatedGoal = {
        goalId: goal.goalId,
        title: changes.title ?? goal.title,
        objective: changes.objective ?? goal.objective,
        criteria: changes.criteria ?? goal.criteria,
        constraints: changes.constraints ?? goal.constraints,
        version: goal.version + 1,
        createdAt: goal.createdAt,
        updatedAt: now,
      }
      this.saveGoal(updatedGoal)
    }
    this.db.db
      .prepare(`UPDATE goal_proposals SET status = ?, created_at = created_at WHERE proposal_id = ?`)
      .run(decision === 'approve' ? 'approved' : 'rejected', proposalId)
    return { proposal: { ...proposal, status: decision === 'approve' ? 'approved' : 'rejected' }, goal: updatedGoal }
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

  /** RET-02：片段索引断点进度（镜像 research_index_progress 机制）。 */
  getFragmentIndexProgress(memoryDir: string, projectId: string): { status: string; sourceVersion: string; progress: Record<string, unknown> } | undefined {
    const row = this.db.db
      .prepare('SELECT status, source_version, progress FROM fragment_index_progress WHERE memory_dir = ? AND project_id = ?')
      .get(memoryDir, projectId) as Row | undefined
    if (!row) return undefined
    return {
      status: asString(row.status),
      sourceVersion: asString(row.source_version),
      progress: parseJsonObject<Record<string, unknown>>(row.progress),
    }
  }

  setFragmentIndexProgress(memoryDir: string, projectId: string, sourceVersion: string, status: string, progress: Record<string, unknown>): void {
    this.db.db
      .prepare(
        `INSERT INTO fragment_index_progress (memory_dir, project_id, source_version, status, progress, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(memory_dir, project_id) DO UPDATE SET
           source_version = excluded.source_version, status = excluded.status,
           progress = excluded.progress, updated_at = excluded.updated_at`,
      )
      .run(memoryDir, projectId, sourceVersion, status, JSON.stringify(progress), Date.now())
  }

  /** 关闭数据库。 */
  close(): void {
    this.db.close()
  }
}
