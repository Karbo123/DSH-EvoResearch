/**
 * RA/EA/EMA → Chat Graph bridge (CG-AUTO-01..06, CG-INTEG-09).
 *
 * This is intentionally a small orchestration boundary.  RA and EA create
 * durable research-map objects; EMA writes only to the evolution registry.
 * Experiment process state is represented by resource nodes and ordinary
 * relation edges, never by Chat Graph fork/reference routing edges.
 */
import * as path from 'node:path'
import { projectNameFromWorkspace } from '../core/paths.js'
import type { ChatGraphService, GraphGroup, GraphNode, GraphEdge } from '../chat-graph.js'
import type { ExperimentWorkspaceService } from '../experiment-workspace.js'
import type { CandidateRegistry } from '../evolution/registry.js'

export type CandidateAcceptanceAction = 'open' | 'continue' | 'pin'

export interface ScienceChatGraphBridgeOptions {
  readonly dataRoot: string
  readonly chatGraph: ChatGraphService
  readonly experimentWorkspace?: ExperimentWorkspaceService
  readonly evolution?: CandidateRegistry
  /** Optional host session creator. It is only used for an explicit continue action. */
  readonly createSession?: (workspaceDir: string, initialMessage: string) => Promise<string | null>
}

export interface RaCandidateAddInput {
  readonly workspaceDir: string
  readonly title: string
  readonly text: string
  readonly candidateId?: string
  readonly sourceNodeId?: string
  readonly x?: number
  readonly y?: number
}

export interface EaAttemptAddInput {
  readonly workspaceDir: string
  readonly title: string
  readonly experimentSlug?: string
  readonly runId?: string
  readonly status?: 'available' | 'running' | 'failed' | 'missing'
  readonly logPath?: string
  readonly resultPath?: string
  readonly codePath?: string
  readonly note?: string
  readonly x?: number
  readonly y?: number
}

export interface ScienceBridgeResult {
  readonly ok: boolean
  readonly group?: GraphGroup
  readonly nodes?: readonly GraphNode[]
  readonly edges?: readonly GraphEdge[]
  readonly node?: GraphNode
  readonly candidate?: unknown
  readonly error?: string
}

function cleanText(value: unknown, fallback: string): string {
  const text = String(value ?? '').trim()
  return text === '' ? fallback : text
}

function projectOf(dataRoot: string, workspaceDir: string): string {
  const project = projectNameFromWorkspace(dataRoot, workspaceDir)
  if (project === undefined) throw new Error(`不是项目工作区: ${workspaceDir}`)
  return project
}

function rel(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '')
}

function groupIdOf(project: string, kind: 'exploration' | 'experiment'): string {
  return `science-${kind}-${project}`
}

function ensureGroup(
  service: ChatGraphService,
  project: string,
  kind: 'exploration' | 'experiment',
  title: string,
): GraphGroup {
  const graph = service.get(project)
  const existing = graph.groups?.find((group) => group.id === groupIdOf(project, kind))
  if (existing !== undefined) return existing
  const group: GraphGroup = {
    id: groupIdOf(project, kind),
    title,
    kind,
    collapsed: kind === 'exploration',
    x: kind === 'exploration' ? 40 : 360,
    y: kind === 'exploration' ? 40 : 160,
    width: kind === 'exploration' ? 520 : 640,
    height: kind === 'exploration' ? 260 : 320,
    createdAt: Date.now(),
  }
  const result = service.addGroup(project, group)
  if (!result.ok || result.group === undefined) throw new Error(result.error ?? '无法建立科学分组')
  return result.group
}

function addRelation(service: ChatGraphService, project: string, from: string, to: string, label: string): GraphEdge {
  return service.addEdge(project, {
    from,
    to,
    toPort: 'memory',
    behavior: 'relation',
    enabled: false,
    label,
    createdAt: Date.now(),
  })
}

export class ScienceChatGraphBridge {
  constructor(private readonly options: ScienceChatGraphBridgeOptions) {}

  /** RA candidates are agent-origin nodes in one default collapsed exploration group. */
  raCandidateAdd(input: RaCandidateAddInput): ScienceBridgeResult {
    try {
      const project = projectOf(this.options.dataRoot, input.workspaceDir)
      const group = ensureGroup(this.options.chatGraph, project, 'exploration', 'RA 探索候选')
      const text = cleanText(input.text, input.title)
      const node = this.options.chatGraph.addNode(project, {
        type: 'resource',
        displayKind: 'candidate',
        title: cleanText(input.title, 'RA 候选方向'),
        x: Number.isFinite(input.x) ? Math.round(input.x!) : (group.x ?? 40) + 32,
        y: Number.isFinite(input.y) ? Math.round(input.y!) : (group.y ?? 40) + 52,
        content: text,
        groupId: group.id,
        origin: 'agent',
        status: 'available',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        ...(input.candidateId === undefined ? {} : { locator: `agent:ra:${input.candidateId}` }),
      })
      const edges: GraphEdge[] = []
      if (input.sourceNodeId !== undefined) {
        const source = this.options.chatGraph.get(project).nodes.find((candidate) => candidate.id === input.sourceNodeId)
        if (source !== undefined) edges.push(addRelation(this.options.chatGraph, project, source.id, node.id, 'RA 候选来源'))
      }
      return { ok: true, group, node, nodes: [node], edges }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  /**
   * Explicit user acceptance moves a candidate out of exploration. Continue
   * may materialize a real chat session; open/pin never fabricate one.
   */
  async candidateAccept(input: {
    workspaceDir: string
    nodeId: string
    action?: CandidateAcceptanceAction
    sessionId?: string
  }): Promise<ScienceBridgeResult> {
    try {
      const project = projectOf(this.options.dataRoot, input.workspaceDir)
      const graph = this.options.chatGraph.get(project)
      const current = graph.nodes.find((node) => node.id === input.nodeId && node.origin === 'agent')
      if (current === undefined) return { ok: false, error: 'AI 候选节点不存在' }
      let sessionId = input.sessionId
      if ((input.action ?? 'pin') === 'continue' && sessionId === undefined && this.options.createSession !== undefined) {
        sessionId = (await this.options.createSession(input.workspaceDir, current.content ?? current.title)) ?? undefined
      }
      const patch: Partial<Omit<GraphNode, 'id'>> = {
        origin: 'user',
        displayKind: sessionId === undefined ? 'idea' : 'chat',
        groupId: undefined,
        updatedAt: Date.now(),
        ...(sessionId === undefined ? {} : { type: 'chat' as const, sessionId, workspaceDir: input.workspaceDir }),
      }
      const updatedNode: GraphNode = { ...current, ...patch, id: current.id, type: sessionId === undefined ? current.type : 'chat' }
      const saved = this.options.chatGraph.save(project, { ...graph, nodes: graph.nodes.map((node) => node.id === current.id ? updatedNode : node) })
      if (!saved.ok) return { ok: false, error: saved.error ?? '候选接受失败' }
      return { ok: true, node: updatedNode }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  /** Create an experiment group plus durable experiment/run/log/result/code resource nodes. */
  eaAttemptAdd(input: EaAttemptAddInput): ScienceBridgeResult {
    try {
      const project = projectOf(this.options.dataRoot, input.workspaceDir)
      const group = ensureGroup(this.options.chatGraph, project, 'experiment', 'EA 实验尝试')
      let slug = input.experimentSlug
      if (slug === undefined && this.options.experimentWorkspace !== undefined) {
        slug = this.options.experimentWorkspace.createWorkspace(project, input.title).slug
      }
      const experimentPath = slug === undefined ? undefined : `experiments/${rel(slug)}`
      const baseX = Number.isFinite(input.x) ? Math.round(input.x!) : (group.x ?? 360) + 32
      const baseY = Number.isFinite(input.y) ? Math.round(input.y!) : (group.y ?? 160) + 52
      const status = input.status ?? 'available'
      const nodes: GraphNode[] = []
      const add = (displayKind: GraphNode['displayKind'], title: string, refPath: string, dx: number, dy: number): void => {
        nodes.push(this.options.chatGraph.addNode(project, {
          type: 'resource', displayKind, title, x: baseX + dx, y: baseY + dy,
          ref: { kind: displayKind === 'experiment' ? 'experiment' : displayKind === 'run' ? 'run' : displayKind === 'log' ? 'log' : displayKind === 'result' ? 'result' : 'code', path: rel(refPath) },
          scope: 'project', origin: 'agent', groupId: group.id, status,
          createdAt: Date.now(), updatedAt: Date.now(),
        }))
      }
      if (experimentPath !== undefined) add('experiment', input.title, experimentPath, 0, 0)
      const runPath = experimentPath === undefined ? `experiments/${input.title}/runs/${input.runId ?? 'latest'}` : `${experimentPath}/runs/${input.runId ?? 'latest'}`
      add('run', `运行：${input.runId ?? 'latest'}`, runPath, 208, 0)
      add('log', '运行日志', rel(input.logPath ?? `${experimentPath ?? `experiments/${input.title}`}/stdout.log`), 0, 104)
      add('result', '实验结果', rel(input.resultPath ?? `${experimentPath ?? `experiments/${input.title}`}/artifacts`), 208, 104)
      add('code', '实验代码版本', rel(input.codePath ?? `${experimentPath ?? `experiments/${input.title}`}/code`), 416, 104)
      const edges: GraphEdge[] = []
      const root = nodes.find((node) => node.displayKind === 'experiment') ?? nodes[0]
      if (root !== undefined) {
        for (const node of nodes) if (node.id !== root.id) edges.push(addRelation(this.options.chatGraph, project, root.id, node.id, 'EA 实验资料'))
      }
      // The note is deliberately appended outside the graph: the graph only
      // points at the real LAB_NOTE/raw files and never becomes an execution DAG.
      void input.note
      return { ok: true, group, nodes, edges }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  /** EMA records a Harness candidate only; it never creates a research-map node. */
  emaCandidateRecord(input: { component: string; description: string; diff: string; content?: string }): ScienceBridgeResult {
    try {
      if (this.options.evolution === undefined) return { ok: false, error: 'Evolution registry 不可用' }
      const candidate = this.options.evolution.propose({
        component: cleanText(input.component, 'harness'),
        description: cleanText(input.description, 'Harness 改进候选'),
        diff: cleanText(input.diff, '+ candidate'),
        content: input.content,
      })
      return { ok: true, candidate }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }
}

/** Kept exported for tests and host wiring diagnostics. */
export function experimentResourcePath(workspaceDir: string, relative: string): string {
  return path.resolve(workspaceDir, relative)
}
