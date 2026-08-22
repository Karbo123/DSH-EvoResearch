/**
 * 科研记忆 模型工具注册：科研记忆的按需读取与长期 Observation 维护。
 *
 * 对齐 EvoResearch memory/research/tools.py：
 * - search_research_history：按查询检索历史轮次（RET-03：返回可定位片段，
 *   含位置与前后文；无片段索引时回退旧混合召回）；
 * - find_in_conversation（RET-04）：在指定会话内继续查找；
 * - read_conversation_range（RET-05）：按位置向前/向后翻页读取会话原文；
 * - read_research_turn：读取某一轮完整原文（RET-06：含 assistant/工具片段/中断信息）；
 * - search_observations / read_memory（RET-07：offset/cursor 分页）：长期记忆文件读取；
 * - create_observation / update_observation / supersede_observation：长期记忆维护
 *   （supersede 保留旧文件标记 status: superseded，检索默认只出 ACTIVE）。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { ResearchMemoryStore } from './store.js'
import { parseObservationFile } from './store.js'
import { turnDetail, readConversationRange, readMemoryFilePaged, expandFragmentHit } from './read.js'
import type { ResearchCategory, GoalProposal, ObservationEdgeType } from '../../shared/types.js'

/** 工具上下文：MemoryRuntime 提供的存储门面。 */
export interface MemoryToolHost {
  storeFor(workspaceDir: string): ResearchMemoryStore
  observationsDirFor(workspaceDir: string): string
  profileDirFor(workspaceDir: string): string
  /** 新的自然语言笔记入口；未接入时 create_observation 退回旧兼容格式。 */
  createResearchNote?: (workspaceDir: string, title: string | undefined, body: string) => unknown
}

/** 从工具执行上下文推断工作区。 */
function workspaceOf(exec: ToolRunContext): string {
  // Agent 直接持有 session（dsh-agent runtime-types）；经 agent.ctx.session 读取会因 cordis
  // 未注入 'session' 抛 "cannot get property session without inject"。
  const agent = (exec as { agent?: { session?: { header?: { cwd?: string } }; ctx?: { session?: { header?: { cwd?: string } } } } }).agent
  try {
    return agent?.session?.header?.cwd ?? ''
  } catch {
    return ''
  }
}

/** 构造一个 JSON Schema 参数定义。 */
function paramsSchema(properties: Record<string, unknown>, required: readonly string[] = []): Record<string, unknown> {
  return { type: 'object', properties, required, additionalProperties: false }
}

/** 文本输出渲染。 */
function textRender(_args: unknown, value: unknown): Array<{ type: 'text'; text: string }> {
  return [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }]
}

/**
 * 注册全部记忆工具。
 * @returns 解除注册的 disposer。
 */
export function registerMemoryTools(ctx: Context, host: MemoryToolHost): () => void {
  const tools = ctx.get('tools')
  if (!tools) return () => {}
  const disposers: Array<() => void> = []

  const register = (definition: ToolDefinition): void => {
    disposers.push(tools.register(definition))
  }

  // ── search_research_history ───────────────────────────────────────────────
  register({
    name: 'search_research_history',
    description:
      '检索本项目历史对话轮次（RET-03：优先返回可定位片段——含回到会话原文的位置 ' +
      '(seg_seq/char_offset) 与命中前后的相邻消息；片段索引未建立时回退为轮次/Observation ' +
      '混合召回）。命中片段后可用 read_conversation_range 沿位置前后翻页读完整原文。',
    parameters: paramsSchema(
      {
        query: { type: 'string', description: '检索关键词（支持中文）' },
        categories: {
          type: 'array',
          items: { type: 'string', enum: ['idea', 'method', 'experiment', 'related_work', 'reproduction', 'project', 'general'] },
          description: '类别过滤（不硬过滤，仅加权），可省略',
        },
        limit: { type: 'number', description: '返回条数，默认 8，最大 20' },
      },
      ['query'],
    ),
    output: {
      schema: {
        type: 'object',
        properties: {
          hits: {
            type: 'array',
            items: { type: 'object', properties: { kind: { type: 'string' }, id: { type: 'string' }, snippet: { type: 'string' }, score: { type: 'number' } } },
          },
        },
      },
      render: textRender,
    },
    execute: async (args, exec) => {
      const input = args as { query: string; categories?: ResearchCategory[]; limit?: number }
      const store = host.storeFor(workspaceOf(exec))
      const limit = Math.min(input.limit ?? 8, 20)
      // RET-03：片段级检索（FTS5 优先，失败自动退化 LIKE 原文扫描，RET-09）
      const fragments = store.searchFragments(input.query, limit * 3, { mode: 'auto' })
      if (fragments.length > 0) {
        const hits = fragments.slice(0, limit).map(({ fragment, score }) => expandFragmentHit(store, fragment, score))
        return { hits }
      }
      // 兼容回退：片段索引未建立（旧库未回填）时沿用旧混合召回
      const { retrieve } = await import('./retrieval.js')
      const hits = await retrieve(store, input.query, {
        categories: input.categories,
        limit,
      })
      return {
        hits: hits.map((hit) => ({ kind: hit.kind, id: hit.id, snippet: hit.snippet.slice(0, 300), score: Number(hit.score.toFixed(4)) })),
      }
    },
  })

  // ── find_in_conversation（RET-04） ────────────────────────────────────────
  register({
    name: 'find_in_conversation',
    description:
      '在指定会话内继续查找关键词（指定会话内的二次搜索，RET-04）。' +
      '返回可定位片段（位置 + 前后相邻消息）；适合在已定位到某次对话后深挖细节。',
    parameters: paramsSchema(
      {
        session_id: { type: 'string', description: '会话 id（来自检索命中或 read_conversation_range）' },
        query: { type: 'string', description: '查找关键词' },
        limit: { type: 'number', description: '返回条数，默认 8，最大 20' },
      },
      ['session_id', 'query'],
    ),
    output: {
      schema: { type: 'object', properties: { hits: { type: 'array', items: { type: 'object' } } } },
      render: textRender,
    },
    execute: async (args, exec) => {
      const input = args as { session_id: string; query: string; limit?: number }
      const store = host.storeFor(workspaceOf(exec))
      const limit = Math.min(input.limit ?? 8, 20)
      const fragments = store.searchFragments(input.query, limit, { sessionId: input.session_id, mode: 'auto' })
      return { hits: fragments.map(({ fragment, score }) => expandFragmentHit(store, fragment, score)) }
    },
  })

  // ── read_conversation_range（RET-05） ─────────────────────────────────────
  register({
    name: 'read_conversation_range',
    description:
      '按位置向前/向后翻页读取会话原文（RET-05）。' +
      'anchor 来自检索命中的 position（turn_id + seg_seq）：围绕锚点返回前后各若干条消息；' +
      '不带 anchor 时返回该会话最近消息（offset 向前翻旧页）。位置字段与 ' +
      'search_research_history / find_in_conversation 的命中一致。',
    parameters: paramsSchema(
      {
        session_id: { type: 'string', description: '会话 id' },
        anchor: {
          type: 'object',
          description: '锚点（可选）：检索命中的位置',
          properties: { turn_id: { type: 'string' }, seg_seq: { type: 'number' } },
        },
        before: { type: 'number', description: '锚点模式：锚前条数（默认 2）' },
        after: { type: 'number', description: '锚点模式：锚后条数（默认 2）' },
        limit: { type: 'number', description: '无锚点模式：返回最近 N 条（默认 20）' },
        offset: { type: 'number', description: '无锚点模式：偏移（向前翻旧页）' },
      },
      ['session_id'],
    ),
    output: {
      schema: {
        type: 'object',
        properties: {
          items: { type: 'array', items: { type: 'object' } },
          anchor_index: { type: 'number' },
          has_more_before: { type: 'boolean' },
          has_more_after: { type: 'boolean' },
          total: { type: 'number' },
        },
      },
      render: textRender,
    },
    execute: async (args, exec) => {
      const input = args as {
        session_id: string
        anchor?: { turn_id: string; seg_seq: number }
        before?: number
        after?: number
        limit?: number
        offset?: number
      }
      const store = host.storeFor(workspaceOf(exec))
      const result = readConversationRange(store, input.session_id, {
        anchor: input.anchor ? { turnId: input.anchor.turn_id, segSeq: input.anchor.seg_seq } : undefined,
        before: input.before,
        after: input.after,
        limit: input.limit,
        offset: input.offset,
      })
      return {
        items: result.items.map((item) => ({
          turn_id: item.turnId,
          seg_seq: item.segSeq,
          kind: item.kind,
          text: item.text,
        })),
        anchor_index: result.anchorIndex,
        has_more_before: result.hasMoreBefore,
        has_more_after: result.hasMoreAfter,
        total: result.total,
      }
    },
  })

  // ── read_research_turn ────────────────────────────────────────────────────
  register({
    name: 'read_research_turn',
    description:
      '读取某一轮对话的完整原文（RET-06：用户消息 + 模型最终回答 + 原始工具片段 ' +
      '（含调用参数/结果与长结果文件位置）+ 中断说明；旧字段保持兼容）。',
    parameters: paramsSchema({ turn_id: { type: 'string', description: '轮次 id（来自 search_research_history 或记忆包的 read_more 提示）' } }, ['turn_id']),
    output: { schema: { type: 'object', properties: { turn: { type: 'object' }, segments: { type: 'array' } } }, render: textRender },
    execute: async (args, exec) => {
      const input = args as { turn_id: string }
      const store = host.storeFor(workspaceOf(exec))
      const detail = turnDetail(store, input.turn_id)
      if (!detail) return { error: `未找到轮次 ${input.turn_id}` }
      return detail
    },
  })

  // ── search_observations ───────────────────────────────────────────────────
  register({
    name: 'search_observations',
    description: '检索长期 Observation（Markdown 记忆文件索引，默认只返回 active 记录）。',
    parameters: paramsSchema(
      { query: { type: 'string', description: '检索关键词' }, limit: { type: 'number', description: '返回条数，默认 10' } },
      ['query'],
    ),
    output: { schema: { type: 'array', items: { type: 'object' } }, render: textRender },
    execute: async (args, exec) => {
      const input = args as { query: string; limit?: number }
      const store = host.storeFor(workspaceOf(exec))
      const limit = Math.min(input.limit ?? 10, 30)
      const results = store.searchObservationsFts(input.query, limit)
      return results.map(({ observation, score }) => ({
        observationId: observation.observationId,
        title: observation.title,
        categories: observation.categories,
        status: observation.status,
        score: Number(Math.abs(score).toFixed(4)),
        updatedAt: observation.updatedAt,
      }))
    },
  })

  // ── read_memory ───────────────────────────────────────────────────────────
  register({
    name: 'read_memory',
    description:
      '读取项目记忆文件（profile、observations 等 Markdown 文件）的内容。路径必须位于项目 ' +
      '.evoresearch-data/memories 目录内。RET-07：支持 offset/limit 分页——长笔记用返回的 ' +
      'has_more/offset 继续读取，不再固定截断。',
    parameters: paramsSchema(
      {
        path: { type: 'string', description: '记忆文件相对路径，如 profile/SOUL.md 或 observations/global/O-xxx.md' },
        offset: { type: 'number', description: '字符偏移（翻页游标，默认 0）' },
        limit: { type: 'number', description: '本页字符数（默认 6000，最大 20000）' },
      },
      ['path'],
    ),
    output: { schema: { type: 'object', properties: { content: { type: 'string' } } }, render: textRender },
    execute: async (args, exec) => {
      const input = args as { path: string; offset?: number; limit?: number }
      const workspace = workspaceOf(exec)
      const memoriesRoot = host.observationsDirFor(workspace).replace(/[\\/]observations$/, '')
      const result = readMemoryFilePaged(memoriesRoot, input.path, input.offset ?? 0, input.limit ?? 6000)
      if ('error' in result) return result
      return result
    },
  })

  // ── create_research_note / create_observation / update_observation / supersede_observation ──
  register({
    name: 'create_research_note',
    description:
      '创建自由格式研究笔记（Markdown）。正文可以是灵感、长讨论、论文精读、实验复盘或未验证猜想；' +
      '不要求来源、分类、实体、置信度或固定字段。',
    parameters: paramsSchema(
      {
        title: { type: 'string', description: '可选标题' },
        content: { type: 'string', description: 'Markdown 正文' },
      },
      ['content'],
    ),
    output: { schema: { type: 'object', properties: { note_id: { type: 'string' }, file_name: { type: 'string' } } }, render: textRender },
    execute: async (args, exec) => {
      const input = args as { title?: string; content: string }
      const workspace = workspaceOf(exec)
      if (host.createResearchNote === undefined) {
        return { error: '自由文本研究笔记服务未接入，请稍后重试' }
      }
      const created = host.createResearchNote(workspace, input.title, input.content) as { noteId?: string; fileName?: string }
      return { note_id: created.noteId, file_name: created.fileName }
    },
  })

  register({
    name: 'create_observation',
    description:
      '创建长期研究笔记。优先使用自由 Markdown，不要求来源、分类、实体或置信度；' +
      '旧 Observation 字段仅为兼容旧调用保留。',
    parameters: paramsSchema(
      {
        title: { type: 'string', description: '观察标题（简短）' },
        content: { type: 'string', description: '观察正文（Markdown）' },
        categories: { type: 'array', items: { type: 'string', enum: ['idea', 'method', 'experiment', 'related_work', 'reproduction', 'project', 'general'] }, description: '科研类别，可省略' },
        topic_keys: { type: 'array', items: { type: 'string' }, description: '主题 key，可省略' },
        entities: { type: 'array', items: { type: 'string' }, description: '涉及的实体/术语，可省略' },
      },
      ['title', 'content'],
    ),
    output: { schema: { type: 'object', properties: { observation_id: { type: 'string' } } }, render: textRender },
    execute: async (args, exec) => {
      const input = args as { title: string; content: string; categories?: ResearchCategory[]; topic_keys?: string[]; entities?: string[] }
      const workspace = workspaceOf(exec)
      // NOTE-02：新调用不再被固定元数据绑住；没有明确旧字段时写入零 frontmatter 笔记。
      if (host.createResearchNote !== undefined && input.categories === undefined && input.topic_keys === undefined && input.entities === undefined) {
        const created = host.createResearchNote(workspace, input.title, input.content) as { noteId?: string; fileName?: string }
        return { note_id: created.noteId, file_name: created.fileName, format: 'markdown-note' }
      }
      const store = host.storeFor(workspace)
      const observationId = `O-${randomUUID().replace(/-/g, '').slice(0, 16)}`
      const meta = store.writeObservation(host.observationsDirFor(workspace), {
        observationId,
        title: input.title,
        body: input.content,
        categories: input.categories ?? ['general'],
        primaryCategory: input.categories?.[0],
        topicKeys: input.topic_keys ?? [],
        entities: input.entities ?? [],
        sourceTurnIds: [],
      })
      return { observation_id: meta.observationId }
    },
  })

  register({
    name: 'update_observation',
    description: '更新一条 Observation 的正文（保留 frontmatter 元数据）。',
    parameters: paramsSchema(
      { observation_id: { type: 'string' }, content: { type: 'string', description: '新的正文（Markdown）' } },
      ['observation_id', 'content'],
    ),
    output: { schema: { type: 'object', properties: { ok: { type: 'boolean' } } }, render: textRender },
    execute: async (args, exec) => {
      const input = args as { observation_id: string; content: string }
      const workspace = workspaceOf(exec)
      const store = host.storeFor(workspace)
      const existing = store.getObservation(input.observation_id)
      if (!existing) return { ok: false, error: '未找到 Observation' }
      const parsed = parseObservationFile(existing.content)
      const now = Date.now()
      store.writeObservation(host.observationsDirFor(workspace), {
        observationId: existing.observationId,
        title: parsed.frontmatter.title ?? existing.title,
        body: input.content,
        categories: existing.categories,
        primaryCategory: existing.primaryCategory,
        topicKeys: existing.topicKeys,
        entities: existing.entities,
        sourceTurnIds: existing.sourceTurnIds,
        projectId: existing.projectId,
      })
      return { ok: true }
    },
  })

  register({
    name: 'supersede_observation',
    description: '将一条 Observation 标记为已取代（status: superseded），保留旧文件但默认不再进入检索。',
    parameters: paramsSchema(
      { observation_id: { type: 'string', description: '被取代的 observation id' }, superseded_by: { type: 'string', description: '取代它的新 observation id' } },
      ['observation_id', 'superseded_by'],
    ),
    output: { schema: { type: 'object', properties: { ok: { type: 'boolean' } } }, render: textRender },
    execute: async (args, exec) => {
      const input = args as { observation_id: string; superseded_by: string }
      const workspace = workspaceOf(exec)
      const store = host.storeFor(workspace)
      store.supersedeObservation(host.observationsDirFor(workspace), input.observation_id, input.superseded_by)
      return { ok: true }
    },
  })

  // ── propose_goal_contract_update（§19.6 / §21.5） ─────────────────────────
  // 只创建待确认 Proposal，不直接修改合同；用户在 Goal 面板接受/拒绝后生效。
  register({
    name: 'propose_goal_contract_update',
    description:
      '为长程目标合同提出修改提案（§19.6）。不直接修改合同——生成待确认 Proposal，' +
      '用户在界面接受后才应用为新版本。适合在目标推进中需要调整目标/成功标准/约束时使用。',
    parameters: paramsSchema(
      {
        goal_id: { type: 'string', description: '目标合同 id（来自 memory-goals 列表）' },
        title: { type: 'string', description: '提案标题（一句话概括修改）' },
        summary: { type: 'string', description: '修改理由与说明' },
        changes: {
          type: 'object',
          description: '待应用的部分合同字段（可只提供要修改的字段）',
          properties: {
            title: { type: 'string', description: '新目标标题（可选）' },
            objective: { type: 'string', description: '新目标原文（可选）' },
            criteria: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, text: { type: 'string' }, satisfied: { type: 'boolean' }, evidence: { type: 'array', items: { type: 'string' } } } }, description: '新成功标准列表（可选，整体替换）' },
            constraints: { type: 'array', items: { type: 'string' }, description: '新约束列表（可选，整体替换）' },
          },
        },
      },
      ['goal_id', 'title', 'changes'],
    ),
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          proposal_id: { type: 'string' },
          status: { type: 'string' },
        },
      },
      render: textRender,
    },
    execute: async (args, exec) => {
      const input = args as { goal_id: string; title: string; summary?: string; changes: GoalProposal['changes'] }
      const workspace = workspaceOf(exec)
      const store = host.storeFor(workspace)
      const proposal = store.createGoalProposal({
        goalId: input.goal_id,
        title: input.title,
        summary: input.summary ?? '',
        changes: input.changes ?? {},
      })
      return { ok: true, proposal_id: proposal.proposalId, status: proposal.status }
    },
  })

  // ── link_observations（§21.5 + P1-2）：Observation 关联关系（双向，可带边类型） ──
  register({
    name: 'link_observations',
    description:
      '建立/更新 Observation 之间的关联关系（双向）。适合表达"实验 X 相关于方法 Y"等' +
      '结构化联系；重复调用会合并去重，不会覆盖已有关联。P1-2：可用 edge_type 声明' +
      '关联类型（relates 相关 / complements 互补 / contradicts 矛盾 / supersedes 取代）；' +
      '新实验与旧结论冲突时必须显式声明 contradicts。',
    parameters: paramsSchema(
      {
        observation_id: { type: 'string', description: '主观测 id' },
        related_ids: { type: 'array', items: { type: 'string' }, description: '要关联的观测 id 列表' },
        edge_type: {
          type: 'string',
          enum: ['relates', 'complements', 'contradicts', 'supersedes'],
          description: '关联类型：relates 相关（默认）/ complements 互补 / contradicts 矛盾 / supersedes 取代。新实验与旧结论冲突时必须显式声明 contradicts',
        },
      },
      ['observation_id', 'related_ids'],
    ),
    output: { schema: { type: 'object', properties: { ok: { type: 'boolean' }, related: { type: 'array', items: { type: 'string' } } } }, render: textRender },
    execute: async (args, exec) => {
      const input = args as { observation_id: string; related_ids: string[]; edge_type?: string }
      const workspace = workspaceOf(exec)
      const store = host.storeFor(workspace)
      // P1-2：显式给出非 relates 的边类型时走类型化关联边（有向边 + frontmatter 同步）；
      // 缺省或 relates 时保持原 linkObservations 路径（兼容旧调用）。
      if (input.edge_type !== undefined && input.edge_type !== 'relates') {
        const edgeType = input.edge_type as ObservationEdgeType
        for (const relatedId of input.related_ids) {
          store.setObservationLink(host.observationsDirFor(workspace), input.observation_id, relatedId, edgeType)
        }
        return { ok: true, related: input.related_ids, edge_type: edgeType }
      }
      const result = store.linkObservations(host.observationsDirFor(workspace), input.observation_id, input.related_ids)
      return result
    },
  })

  // ── update_profile（§12.2）：维护 Identity Profile 文件（只写稳定信息） ─────
  register({
    name: 'update_profile',
    description:
      '新建或整体更新 Identity Profile 记忆文件（memories/profile/，§12）。' +
      '只写入稳定、未来仍有价值的信息（身份/偏好/习惯/项目约定），不要写入一次性日志、' +
      '临时路径或未验证的猜测。可用文件名：SOUL.md、USER_PROFILE.md、RESEARCH_TASTE.md、' +
      'PROJECT_PROFILE.md 或其他 <name>.md（≤64KB）。',
    parameters: paramsSchema(
      {
        file: { type: 'string', description: '文件名（必须以 .md 结尾，如 SOUL.md）' },
        content: { type: 'string', description: '完整文件内容（整体替换）' },
      },
      ['file', 'content'],
    ),
    output: { schema: { type: 'object', properties: { ok: { type: 'boolean' } } }, render: textRender },
    execute: async (args, exec) => {
      const input = args as { file: string; content: string }
      const name = input.file.trim()
      if (path.basename(name) !== name || !/^[A-Za-z0-9_.-]{1,80}\.md$/.test(name)) {
        return { ok: false }
      }
      const workspace = workspaceOf(exec)
      const dir = host.profileDirFor(workspace)
      fs.mkdirSync(dir, { recursive: true })
      const full = path.join(dir, name)
      const content = String(input.content ?? '').slice(0, 64 * 1024)
      const tmp = `${full}.tmp-${process.pid}`
      fs.writeFileSync(tmp, content, 'utf8')
      fs.renameSync(tmp, full)
      return { ok: true }
    },
  })

  return () => {
    for (const dispose of disposers) dispose()
  }
}
