/**
 * 科研记忆 模型工具注册：科研记忆的按需读取与长期 Observation 维护。
 *
 * 对齐 EvoResearch memory/research/tools.py：
 * - search_research_history：按查询检索历史轮次（压缩前的精确原文由 read_research_turn 读取）；
 * - read_research_turn：读取某一轮完整原文；
 * - search_observations / read_memory：长期 Observation 与记忆文件读取；
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
import type { ResearchCategory, GoalProposal } from '../../shared/types.js'

/** 工具上下文：MemoryRuntime 提供的存储门面。 */
export interface MemoryToolHost {
  storeFor(workspaceDir: string): ResearchMemoryStore
  observationsDirFor(workspaceDir: string): string
  profileDirFor(workspaceDir: string): string
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
      '检索本项目历史对话轮次（Turn Catalog）与长期 Observation 的混合召回结果。' +
      '适合在回答科研问题前查找旧想法、方法、实验结论；需要精确原文时再调用 read_research_turn。',
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
      const { retrieve } = await import('./retrieval.js')
      const hits = await retrieve(store, input.query, {
        categories: input.categories,
        limit: Math.min(input.limit ?? 8, 20),
      })
      return {
        hits: hits.map((hit) => ({ kind: hit.kind, id: hit.id, snippet: hit.snippet.slice(0, 300), score: Number(hit.score.toFixed(4)) })),
      }
    },
  })

  // ── read_research_turn ────────────────────────────────────────────────────
  register({
    name: 'read_research_turn',
    description: '读取某一轮对话的完整原文（用户消息 + 模型回答 + 分类与主题），用于阅读压缩前的精确历史。',
    parameters: paramsSchema({ turn_id: { type: 'string', description: '轮次 id（来自 search_research_history 或记忆包的 read_more 提示）' } }, ['turn_id']),
    output: { schema: { type: 'object', properties: { turn: { type: 'object' } } }, render: textRender },
    execute: async (args, exec) => {
      const input = args as { turn_id: string }
      const store = host.storeFor(workspaceOf(exec))
      const turn = store.getTurn(input.turn_id)
      if (!turn) return { error: `未找到轮次 ${input.turn_id}` }
      return {
        turn: {
          turnId: turn.turnId,
          userText: turn.userText,
          assistantText: turn.assistantText,
          categories: turn.categories,
          topicKeys: turn.topicKeys,
          status: turn.status,
          createdAt: turn.createdAt,
          workingSummary: turn.workingSummary,
        },
      }
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
    description: '读取项目记忆文件（profile、observations 等 Markdown 文件）的内容。路径必须位于项目 .evoresearch-data/memories 目录内。',
    parameters: paramsSchema({ path: { type: 'string', description: '记忆文件相对路径，如 profile/SOUL.md 或 observations/global/O-xxx.md' } }, ['path']),
    output: { schema: { type: 'object', properties: { content: { type: 'string' } } }, render: textRender },
    execute: async (args, exec) => {
      const input = args as { path: string }
      const workspace = workspaceOf(exec)
      const memoriesRoot = host.observationsDirFor(workspace).replace(/[\\/]observations$/, '')
      const target = path.resolve(memoriesRoot, input.path)
      if (!target.startsWith(memoriesRoot + path.sep) && target !== memoriesRoot) {
        return { error: '路径越界：只允许读取 .evoresearch-data/memories 内的文件' }
      }
      if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) {
        return { error: `文件不存在: ${input.path}` }
      }
      const content = fs.readFileSync(target, 'utf8')
      // 二进制探测：null 字节视为不可读
      if (content.includes('\u0000')) return { error: '二进制文件无法直接读取' }
      return { content: content.slice(0, 6000) }
    },
  })

  // ── create_observation / update_observation / supersede_observation ──────
  register({
    name: 'create_observation',
    description: '创建一条长期 Observation（Markdown 记忆文件）。用于沉淀跨会话有效的研究结论、决定、偏好。',
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

  // ── link_observations（§21.5）：Observation 关联关系（双向） ──────────────
  register({
    name: 'link_observations',
    description:
      '建立/更新 Observation 之间的关联关系（双向）。适合表达"实验 X 相关于方法 Y"等' +
      '结构化联系；重复调用会合并去重，不会覆盖已有关联。',
    parameters: paramsSchema(
      {
        observation_id: { type: 'string', description: '主观测 id' },
        related_ids: { type: 'array', items: { type: 'string' }, description: '要关联的观测 id 列表' },
      },
      ['observation_id', 'related_ids'],
    ),
    output: { schema: { type: 'object', properties: { ok: { type: 'boolean' }, related: { type: 'array', items: { type: 'string' } } } }, render: textRender },
    execute: async (args, exec) => {
      const input = args as { observation_id: string; related_ids: string[] }
      const workspace = workspaceOf(exec)
      const store = host.storeFor(workspace)
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
