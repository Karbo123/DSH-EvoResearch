/**
 * EvoMemory 模型工具注册：科研记忆的按需读取与长期 Observation 维护。
 *
 * 对齐 EvoScientist memory/research/tools.py：
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
import type { ResearchCategory } from '../../shared/types.js'

/** 工具上下文：MemoryRuntime 提供的存储门面。 */
export interface MemoryToolHost {
  storeFor(workspaceDir: string): ResearchMemoryStore
  observationsDirFor(workspaceDir: string): string
}

/** 从工具执行上下文推断工作区。 */
function workspaceOf(exec: ToolRunContext): string {
  const agent = (exec as { agent?: { ctx?: { session?: { header?: { cwd?: string } } } } }).agent
  return agent?.ctx?.session?.header?.cwd ?? ''
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
    description: '读取项目记忆文件（profile、observations 等 Markdown 文件）的内容。路径必须位于项目 .evosci-data/memories 目录内。',
    parameters: paramsSchema({ path: { type: 'string', description: '记忆文件相对路径，如 profile/SOUL.md 或 observations/global/O-xxx.md' } }, ['path']),
    output: { schema: { type: 'object', properties: { content: { type: 'string' } } }, render: textRender },
    execute: async (args, exec) => {
      const input = args as { path: string }
      const workspace = workspaceOf(exec)
      const memoriesRoot = host.observationsDirFor(workspace).replace(/[\\/]observations$/, '')
      const target = path.resolve(memoriesRoot, input.path)
      if (!target.startsWith(memoriesRoot + path.sep) && target !== memoriesRoot) {
        return { error: '路径越界：只允许读取 .evosci-data/memories 内的文件' }
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

  return () => {
    for (const dispose of disposers) dispose()
  }
}
