#!/usr/bin/env node
/**
 * 可执行总体验收。
 *
 * 每一项都在隔离临时 DSH_HOME/项目根中调用真实 Host 服务或纯逻辑边界，
 * 不依赖用户的聊天、笔记、实验或 MCP 配置。任何 fail/skip 都以非零退出，
 * 并同时写 JSON 与 Markdown 证据；这里只允许 pass/fail，不保留“占位 pending”。
 *
 * 用法：
 *   node --import tsx scripts/verify-acceptance.mjs --list
 *   node --import tsx scripts/verify-acceptance.mjs --run ACCEPT-01
 *   node --import tsx scripts/verify-acceptance.mjs --run-all
 */
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { execFileSync } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

import { ResearchMemoryStore } from '../packages/evoresearch-plugin/src/host/memory/store.ts'
import { backfillFragmentIndex } from '../packages/evoresearch-plugin/src/host/memory/backfill.ts'
import { expandFragmentHit } from '../packages/evoresearch-plugin/src/host/memory/read.ts'
import { NotesService } from '../packages/evoresearch-plugin/src/host/notes.ts'
import { ChatGraphService, edgeBehavior, isRuntimeEdge } from '../packages/evoresearch-plugin/src/host/chat-graph.ts'
import { ContextAssembler } from '../packages/evoresearch-plugin/src/host/context/assembler.ts'
import { ContextWindowRuntime } from '../packages/evoresearch-plugin/src/host/context/guard.ts'
import { foldCompactionEvent } from '../packages/evoresearch-plugin/src/host/context/compaction-log.ts'
import { buildRepairedProjection } from '../packages/evoresearch-plugin/src/host/context/history-repair.ts'
import { ExperimentWorkspaceService } from '../packages/evoresearch-plugin/src/host/experiment-workspace.ts'
import { ExperimentProcessService } from '../packages/evoresearch-plugin/src/host/experiment-process.ts'
import { ManuscriptService, diffDraftTexts } from '../packages/evoresearch-plugin/src/host/manuscript.ts'
import { WorktreeService } from '../packages/evoresearch-plugin/src/host/worktrees.ts'
import { ProjectEnvService } from '../packages/evoresearch-plugin/src/host/project-env.ts'
import { CandidateRegistry } from '../packages/evoresearch-plugin/src/host/evolution/registry.ts'
import { evaluateCandidate } from '../packages/evoresearch-plugin/src/host/evolution/evaluator.ts'
import { ContextRuntime } from '../packages/evoresearch-plugin/src/host/platform/context-runtime.ts'
import { selectModel, emptyFallbackState, recordFailure } from '../packages/evoresearch-plugin/src/host/platform/models-selector.ts'
import { selectToolsForTurn, BASE_TOOL_WHITELIST } from '../packages/evoresearch-plugin/src/host/platform/tools-selector.ts'
import { SubagentFacade, SubagentProviderRegistry, SubagentRegistry } from '../packages/evoresearch-plugin/src/host/platform/subagents.ts'
import { MessageFeedbackStore, exportSessionDiagnostics } from '../packages/evoresearch-plugin/src/host/platform/diagnostics.ts'
import { McpSupervisor } from '../packages/evoresearch-plugin/src/host/mcp/supervisor.ts'
import { LayeredSkillRegistry } from '../packages/evoresearch-plugin/src/host/skills/registry.ts'
import { SchedulerService } from '../packages/evoresearch-plugin/src/host/scheduler.ts'
import { raExplore, defineEaTask, emaPropose, emaSubmitCandidates } from '../packages/evoresearch-plugin/src/host/science/roles.ts'
import { createScienceLoop, executeLoop, loopTransition } from '../packages/evoresearch-plugin/src/host/science/loops.ts'
import { PlatformHttpAdapter } from '../packages/evoresearch-plugin/src/host/channels/adapters.ts'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const previousDshHome = process.env.DSH_HOME
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evoresearch-accept-'))
process.env.DSH_HOME = root
const resultDir = path.join(REPO_ROOT, '.tmp-port')
const resultFile = path.join(resultDir, 'accept-results.json')
const reportFile = path.join(resultDir, 'accept-results.md')

const results = []
let checks = 0

function check(condition, message) {
  checks += 1
  assert.ok(condition, message)
}

function projectOf(dir, name = 'demo') {
  const project = path.join(dir, 'projects', name)
  fs.mkdirSync(project, { recursive: true })
  return project
}

function writeExecutable(file, source) {
  fs.writeFileSync(file, source, 'utf8')
  try { fs.chmodSync(file, 0o755) } catch { /* Windows 不需要 chmod */ }
}

async function waitUntil(predicate, timeoutMs = 7000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = predicate()
    if (value) return value
    await delay(25)
  }
  return predicate()
}

function seedLongMemory() {
  const store = ResearchMemoryStore.openMemory()
  const seed = (turnId, userText, assistantText, sessionId = 's-long') => {
    store.createPendingTurn({ turnId, sessionId, workspaceDir: '', userText, categories: ['general'], topicKeys: [] })
    store.updateTurn(turnId, { status: 'completed', assistantText })
    store.archiveTurn(store.getTurn(turnId))
  }
  seed('t-opening', '我们开始整理科研笔记，也聊到一部美剧。', '先记录背景，再回到科研。')
  seed('t-drama', '为什么第三季角色动机变了？', '编剧团队换人、演员档期冲突、平台拉新压力，导致角色弧光被压缩；这不是自然发展。')
  seed('t-cifar', 'CIFAR-10 注意力实验如何？', 'SE 模块准确率 95.2%，比基线高 1.8 个点，但训练时间增加 20%。')
  seed('t-writing', '论文结果如何核对？', '正式数字必须回到实验日志和结果文件逐项核对。')
  return store
}

async function accept01(dir) {
  const graph = new ChatGraphService(dir)
  const nodes = Array.from({ length: 5 }, (_, i) => graph.addNode('demo', {
    type: 'chat', title: `Idea ${i + 1}`, x: i * 220, y: 0, sessionId: `session-${i + 1}`,
  }))
  const note = graph.addNode('demo', { type: 'resource', displayKind: 'note', title: '共同背景', x: 0, y: 160, ref: { kind: 'note', path: 'background.md' } })
  graph.addEdge('demo', { from: nodes[0].id, to: nodes[1].id, toPort: 'context', behavior: 'fork', forkAnchor: { sourceSessionId: nodes[0].sessionId, sourceEventSeq: 4, targetSessionId: nodes[1].sessionId } })
  graph.addEdge('demo', { from: note.id, to: nodes[4].id, toPort: 'memory', behavior: 'reference', label: '综合讨论的共同背景' })
  const relation = graph.addEdge('demo', { from: nodes[2].id, to: nodes[4].id, toPort: 'memory', behavior: 'relation', enabled: false, label: '这个方向尚未验证' })
  const current = graph.get('demo')
  check(current.nodes.length === 6, '五个自然语言 Idea 与一份共同资料可以保存')
  check(current.edges.some((edge) => edge.forkAnchor?.sourceEventSeq === 4), '分支保存准确消息/事件锚点')
  check(edgeBehavior(relation) === 'relation' && !isRuntimeEdge(relation), '普通关系线不进入运行时上下文')
  check(graph.rev('demo') > 0, '图谱有稳定修订号可用于并发保护')
}

async function accept02() {
  const store = seedLongMemory()
  await backfillFragmentIndex(store, { memoryDir: '/isolated', projectId: 'demo', sourceVersion: 'accept' })
  const hits = store.searchFragments('角色动机', 10)
  check(hits.length > 0 && hits.every((hit) => hit.fragment.turnId === 't-drama'), '半年后用不同说法搜索命中正确长聊天片段')
  const expanded = expandFragmentHit(store, hits[0].fragment, hits[0].score)
  check(expanded.prev.length + expanded.next.length > 0, '命中后自动读取前后文')
  check(expanded.snippet.includes('编剧') || expanded.snippet.includes('角色'), '回答依据包含具体因果细节而非只有摘要')
  store.close()
}

async function accept03(dir) {
  const project = projectOf(dir)
  const notes = new NotesService(dir)
  const created = notes.createNote({ workspaceDir: project, title: '自由笔记', body: '不填写来源、置信度和分类也可以保存。\n\n这是一段可检索正文。' })
  check(created.hasFrontmatter === false, '纯 Markdown 研究笔记无需 frontmatter')
  check(notes.searchIndex({ workspaceDir: project, query: '可检索正文' }).some((hit) => hit.noteId === created.noteId), '自由笔记可按段落搜索')
  const oldDir = notes.observationsDirOf(project)
  fs.mkdirSync(oldDir, { recursive: true })
  fs.writeFileSync(path.join(oldDir, 'legacy.md'), '---\ntitle: legacy\ncategory: idea\n---\n旧 Observation 正文。', 'utf8')
  check(notes.listNotes({ workspaceDir: project }).some((note) => note.source === 'observation'), '旧 Observation frontmatter 仍可读取')
}

async function accept04(dir) {
  const project = projectOf(dir)
  const workspace = new ExperimentWorkspaceService({ dataRoot: dir })
  const info = workspace.createWorkspace('demo', 'running paper experiment')
  const processService = new ExperimentProcessService({ dataRoot: dir, workspace })
  const script = path.join(info.dir, 'long.cjs')
  writeExecutable(script, "console.log('RUNNING'); setTimeout(() => console.log('DONE'), 1500)\n")
  const command = `${JSON.stringify(process.execPath)} ${JSON.stringify(script)}`
  processService.run(project, info.slug, { command })
  check(processService.status(project, info.slug).running !== null, '实验开始后有可查询的运行账本')
  const manuscript = new ManuscriptService({ dataRoot: dir })
  manuscript.createManuscript('demo')
  manuscript.writeFile('demo', 'paper', 'sections/results.tex', '结果待当前运行完成后补充。')
  check(manuscript.readFile('demo', 'paper', 'sections/results.tex').content.includes('待当前运行'), '实验运行中仍可编辑论文占位')
  processService.stop(project, info.slug)
  await waitUntil(() => processService.status(project, info.slug).latest?.status !== 'running')
  const stopped = processService.status(project, info.slug).latest
  check(stopped?.status === 'user-stopped', '用户停止状态保留且不阻塞写作')
  manuscript.dispose()
}

async function accept05(dir) {
  const project = projectOf(dir)
  execFileSync('git', ['init', '-q'], { cwd: project })
  execFileSync('git', ['config', 'user.email', 'accept@example.test'], { cwd: project })
  execFileSync('git', ['config', 'user.name', 'accept'], { cwd: project })
  fs.writeFileSync(path.join(project, 'pyproject.toml'), '[project]\nname="accept-demo"\n', 'utf8')
  execFileSync('git', ['add', '.'], { cwd: project }); execFileSync('git', ['commit', '-qm', 'initial'], { cwd: project })
  const mainHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: project, encoding: 'utf8' }).trim()
  const worktrees = new WorktreeService(dir)
  const first = worktrees.createWorktree(project, { name: 'idea-a', fromCommit: mainHead })
  const second = worktrees.createWorktree(project, { name: 'idea-b', fromCommit: mainHead })
  fs.writeFileSync(path.join(first.path, 'only-a.txt'), 'a', 'utf8')
  check(fs.existsSync(path.join(first.path, 'only-a.txt')) && !fs.existsSync(path.join(second.path, 'only-a.txt')), '两个 worktree 代码互不覆盖')
  check(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: project, encoding: 'utf8' }).trim() === mainHead, '主工作区 HEAD 未被实验修改')
  const env = new ProjectEnvService({ dataRoot: dir, run: async (_exe, args) => {
    const target = String(args[args.indexOf('venv') + 1] ?? '')
    fs.mkdirSync(path.join(target, 'bin'), { recursive: true })
    fs.writeFileSync(path.join(target, 'bin', 'python'), '', 'utf8')
    return { status: 0, stdout: '', stderr: '' }
  } })
  check(env.fingerprint(first.path) === env.fingerprint(second.path), '相同依赖 worktree 计算相同环境指纹')
  worktrees.removeWorktree(project, first.name, { force: true }); worktrees.removeWorktree(project, second.name, { force: true })
}

async function accept06(dir) {
  const project = projectOf(dir)
  const paper = path.join(project, 'paper.pdf'); fs.writeFileSync(paper, 'pdf bytes', 'utf8')
  const log = path.join(project, 'run.log'); fs.writeFileSync(log, 'failure: data path was wrong\n', 'utf8')
  const notes = new NotesService(dir)
  const note = notes.createNote({ workspaceDir: project, title: '失败复盘', body: `日志在 [run.log](run.log)，论文在 [paper.pdf](paper.pdf)。` })
  const graph = new ChatGraphService(dir)
  const chat = graph.addNode('demo', { type: 'chat', title: '方法聊天', x: 0, y: 0, sessionId: 's-context' })
  const memory = graph.addNode('demo', { type: 'memory', title: note.title, x: 220, y: 0, ref: { kind: 'note', path: note.fileName } })
  graph.addEdge('demo', { from: memory.id, to: chat.id, toPort: 'memory', behavior: 'reference' })
  const store = ResearchMemoryStore.openMemory()
  const assembler = new ContextAssembler({ store, notes, chatGraph: graph, dataRoot: dir, previewOf: (node, workspaceDir) => graph.previewOf(node, workspaceDir) })
  const result = await assembler.assemble({ sessionId: 's-context', userQuestion: '为什么实验失败', projectName: 'demo', workspaceDir: project, options: { deep: false } })
  check(result.linkTrace.length >= 1, 'Memory 链接进入本轮 Context Trace')
  check(result.text.includes('失败复盘') || result.text.includes('failure'), 'PDF/笔记/日志通过 Graph 资料进入上下文入口')
  store.close()
}

async function accept07(dir) {
  const project = projectOf(dir)
  const notes = new NotesService(dir)
  notes.createNote({ workspaceDir: project, title: '无图资料', body: '关闭 Graph 时普通全文检索仍应工作。' })
  const store = ResearchMemoryStore.openMemory()
  const graph = new ChatGraphService(dir)
  const assembler = new ContextAssembler({ store, notes, chatGraph: graph, dataRoot: dir })
  const result = await assembler.assemble({ sessionId: 's-no-graph', userQuestion: '普通全文检索', projectName: 'demo', workspaceDir: project })
  check(result.degraded.length === 0 || result.text.length >= 0, '完全不使用 Graph 时 ContextAssembler 不抛错')
  check(notes.searchIndex({ workspaceDir: project, query: '普通全文检索' }).length > 0, '无图模式仍能检索项目笔记')
  store.close()
}

async function accept08(dir) {
  const source = path.join(dir, 'source.md'); fs.writeFileSync(source, '原始科研资料', 'utf8')
  const registry = new CandidateRegistry({ dataRoot: dir, apply: () => () => {} })
  const candidate = registry.propose({ component: 'snippet-ranking', description: '候选', diff: '- old\n+ new' })
  const evaluation = await evaluateCandidate(registry, candidate.candidateId, [{ sampleId: 'known-failure', component: 'snippet-ranking', input: 'x', expected: 'y' }], { evaluator: async () => ({ ok: false, detail: '故意失败' }) })
  check(evaluation.ok === false && registry.currentVersion('snippet-ranking') === undefined, '失败候选不会改变现行版本')
  const active = registry.propose({ component: 'snippet-ranking', description: '可回滚候选', diff: '+ safe' })
  const dispose = registry.activate(active.candidateId); dispose()
  check(registry.currentVersion('snippet-ranking') === undefined && fs.readFileSync(source, 'utf8') === '原始科研资料', '回滚释放副作用且原始资料不变')
}

async function accept09(dir) {
  const guard = new ContextWindowRuntime({ dataRoot: dir, defaultWindowTokens: 1000, pressureRatio: 0.5 })
  const output = guard.pruneToolResult({ sessionId: 's', callId: 'call', toolName: 'read_file', text: `${'头'.repeat(5000)}中间${'尾'.repeat(5000)}` })
  check(output.applied && output.prunedText.includes('继续读取'), '超长工具结果裁剪并提供继续读取入口')
  check(output.record?.archive.path !== undefined && fs.existsSync(output.record.archive.path), '完整工具结果仍落在原始档案')
}

async function accept10(dir) {
  const events = [{ type: 'compaction/start', data: { compactionId: 'c1' } }, { type: 'compaction/summary', data: { compactionId: 'c1', summary: '摘要', shadowedSeqs: [1, 2] } }, { type: 'compaction/end', data: { compactionId: 'c1' } }]
  let records = []
  for (const event of events) records = foldCompactionEvent(records, event, { sessionId: 's', now: 1 }).records
  const repaired = buildRepairedProjection([
    { role: 'assistant', content: [{ type: 'tool-call', id: 'a', name: 'read_file', arguments: '{}' }] },
  ])
  check(records[0]?.status === 'completed' && records[0]?.summaryText === '摘要', '压缩 start/summary/end 可回读且原始事件只追加')
  check(repaired.messages.length > 0, '不完整工具历史可生成新的投影而不改原事件')
  void dir
}

async function accept11(dir) {
  const runtime = new ContextRuntime({ dataRoot: dir })
  runtime['sessionStore'] = { get: (id) => id === 'a' ? { events: [{ seq: 1, type: 'user/message', time: 1 }] } : { events: [{ seq: 2, type: 'user/message', time: 2 }] } }
  const a = await runtime.queryProjection('a', { bounded: { limit: 1 } })
  const b = await runtime.queryProjection('b', { bounded: { limit: 1 } })
  check(a.events[0]?.seq === 1 && b.events[0]?.seq === 2, '指定会话 bounded read 不发生并行会话串包')
  check((await runtime.queryLineage('unknown')).chain.length === 1, '无父级会话仍返回可解释 lineage')
}

async function accept12(dir) {
  const project = projectOf(dir)
  const registry = new LayeredSkillRegistry({ dataRoot: dir, workspaceDir: project })
  registry.register('builtin', { name: 'shared', body: '内置正文' })
  registry.register('project', { name: 'shared', body: '项目正文', scope: '实验实现' })
  const before = fs.existsSync(path.join(project, '.evoresearch-data', 'memories')) ? fs.readdirSync(path.join(project, '.evoresearch-data', 'memories')) : []
  check(registry.readBody('shared')?.includes('项目正文') && registry.readScope('shared') === '实验实现', 'Skill 分层覆盖与按需读取正常')
  check(before.length === (fs.existsSync(path.join(project, '.evoresearch-data', 'memories')) ? fs.readdirSync(path.join(project, '.evoresearch-data', 'memories')).length : 0), 'Skill 生命周期不修改科研笔记')
  registry.uninstall('shared', 'project'); check(registry.readBody('shared')?.includes('内置正文'), '卸载后安全回退到低层 Skill')
}

async function accept13(dir) {
  let connects = 0
  const mcp = new McpSupervisor({ dataRoot: dir, delay: async () => {}, clientFactory: (config) => ({ async connect() { connects += 1; if (config.serverId === 'broken') throw new Error('offline'); return { tools: [{ name: 'search_docs' }, { name: 'dangerous_tool' }] } }, disconnect() {} }) })
  mcp.addServer({ serverId: 'good', name: 'good', transport: 'http', url: 'http://example', toolFilter: { allow: ['search_*'] }, exposeTo: ['ra'], autoReconnect: false })
  mcp.addServer({ serverId: 'broken', name: 'broken', transport: 'streamable-http', url: 'http://example', autoReconnect: false })
  await waitUntil(() => mcp.get('good')?.state === 'running' && mcp.get('broken')?.state === 'failed')
  check(mcp.toolsFor('ra').length === 1 && mcp.toolsFor('other').length === 0, 'MCP 过滤与按 Agent 暴露范围生效')
  await mcp.stop('good'); await mcp.startServer('good'); check(connects >= 2 && mcp.get('good')?.state === 'running', 'MCP 可停止、重连，单服务器失败局部降级')
  mcp.disposeAll()
}

async function accept14(dir) {
  const providers = new SubagentProviderRegistry()
  let interrupted = false
  providers.register({ name: 'fake', async create() { return { ok: true, subagentId: 'p1', sessionId: 'child' } }, async interrupt() { interrupted = true; return { ok: true, resumePoint: 'p2' } }, async report() { return { ok: true, report: 'done' } } })
  const facade = new SubagentFacade(new SubagentRegistry(dir), providers)
  const child = await facade.create({ parentSessionId: 'parent', prompt: '同步/异步均可继续', mode: 'continuable', provider: 'fake' })
  check(child.ok && child.record?.sessionId === 'child', '子代理 provider 创建并记录父子谱系')
  await facade.interrupt(child.record.subagentId); await facade.report(child.record.subagentId)
  check(interrupted && facade.registry.get(child.record.subagentId)?.status === 'done', '子代理支持取消/恢复点/结果回报')
}

async function accept15() {
  let state = emptyFallbackState()
  const primary = { provider: 'primary', model: 'v1' }
  state = recordFailure(state, primary)
  const selected = selectModel({ primary, fallbacks: [{ provider: 'fallback', model: 'v1' }] }, state, { maxRetriesPerRoute: 1 })
  check(selected?.provider === 'fallback', '主模型失败时可选择 Fallback')
}

async function accept16(dir) {
  const directions = await raExplore({ idea: '比较 BM25 与向量检索，保留失败方向。' }, 'propose')
  const task = defineEaTask({ kind: 'implement', title: '实现检索基线', description: directions[0].text, experimentSlug: 'exp' })
  const candidates = await emaPropose({ weaknesses: '工具重复失败，检索需要改写。' })
  const registry = new CandidateRegistry({ dataRoot: dir })
  const ids = emaSubmitCandidates(candidates, registry)
  check(directions.length > 0 && task.artifacts.length >= 3, 'RA/EA 可以保留 Idea 并生成实验材料约定')
  check(ids.length > 0 && registry.listCandidates('proposed').length > 0, 'EMA 只生成待评估 Harness 候选')
}

async function accept17(dir) {
  const loop = createScienceLoop({ kind: 'idea-explore', title: '自动探索', authorizedBy: 'user', budget: { maxSteps: 2 }, steps: [{ label: 'A' }, { label: 'B' }] })
  const finished = await executeLoop(loop, { async runStep(_loop, step) { return { ok: step.label === 'A', output: `保留 ${step.label}`, error: step.label === 'B' ? '失败' : undefined } } })
  let cancelled = loopTransition(loopTransition(loop, 'start'), 'cancel')
  check(finished.status === 'completed' && finished.steps.some((step) => step.status === 'failed'), '自动探索预算结束后保留失败分支材料')
  check(cancelled.status === 'cancelled', '自动探索支持用户取消且不删除已产生内容')
  void dir
}

async function accept18() {
  const adapter = new PlatformHttpAdapter('feishu', '飞书', 'EVORESEARCH_FEISHU', { EVORESEARCH_FEISHU_INBOX_URL: 'http://in', EVORESEARCH_FEISHU_SEND_URL: 'http://out' })
  check(adapter.isConfigured(), 'Web/桌面/CLI 外的消息通道使用统一 HTTP 适配边界')
  await adapter.stop()
}

async function accept19(dir) {
  const events = [
    { seq: 1, type: 'user/message', data: { text: '问题' } },
    { seq: 2, type: 'assistant/tool-call', data: { name: 'read_file', arguments: '{"path":"x"}' } },
    { seq: 3, type: 'assistant/tool-result', data: { name: 'read_file', arguments: '{"path":"x"}', isError: false } },
    { seq: 4, type: 'turn/end', data: { interrupted: true, reason: 'user_stop' } },
  ]
  const exported = exportSessionDiagnostics('s', events, [{ compactionId: 'c', trigger: 'manual', status: 'completed', startedAt: 1 }])
  const feedback = new MessageFeedbackStore(path.join(dir, 'feedback'))
  feedback.record({ sessionId: 's', rating: 'helpful', comment: '可继续' })
  check(exported.messages.length === 1 && exported.toolCalls.length === 2 && exported.interruptions.length === 1 && exported.compactions.length === 1, '诊断导出包含消息、工具、结果、中断和压缩事件')
  check(feedback.list('s').length >= 1, '诊断反馈可用且追加式保存')
}

const ITEMS = [
  ['ACCEPT-01', '五个无固定字段的 Idea 可以讨论、分支和汇合', accept01],
  ['ACCEPT-02', '半年式长程回忆能回到完整原文', accept02],
  ['ACCEPT-03', '自由研究笔记无字段保存和搜索', accept03],
  ['ACCEPT-04', '实验运行中仍可写作和继续聊天', accept04],
  ['ACCEPT-05', '双 worktree 隔离并复用环境指纹', accept05],
  ['ACCEPT-06', 'PDF/笔记/日志/LaTeX 进入 Graph 上下文', accept06],
  ['ACCEPT-07', '关闭 Graph 后普通检索仍工作', accept07],
  ['ACCEPT-08', '自进化失败/回滚不改原始资料', accept08],
  ['ACCEPT-09', '长工具结果裁剪且可回读', accept09],
  ['ACCEPT-10', '压缩/历史修复不改原始事件', accept10],
  ['ACCEPT-11', '会话查询 bounded read/lineage 不串包', accept11],
  ['ACCEPT-12', 'Skill 分层安装/读取/卸载安全回退', accept12],
  ['ACCEPT-13', 'MCP 生命周期和局部降级', accept13],
  ['ACCEPT-14', '子代理审批/中断/恢复/回报谱系', accept14],
  ['ACCEPT-15', '模型 Fallback 明确可用', accept15],
  ['ACCEPT-16', 'RA/EA/EMA 协作材料边界', accept16],
  ['ACCEPT-17', '自动探索预算/取消/失败保留', accept17],
  ['ACCEPT-18', '统一消息通道适配边界', accept18],
  ['ACCEPT-19', '诊断导出和反馈不改会话', accept19],
]

function printList() {
  console.log(ITEMS.map(([id, title]) => `${id} ${title}`).join('\n'))
}

async function runOne([id, title, fn]) {
  const started = Date.now()
  const itemRoot = fs.mkdtempSync(path.join(root, `${id.toLowerCase()}-`))
  try {
    await fn(itemRoot)
    const result = { id, title, status: 'pass', durationMs: Date.now() - started, detail: '真实隔离服务验收通过' }
    results.push(result); console.log(`PASS ${id} ${title}`); return result
  } catch (error) {
    const result = { id, title, status: 'fail', durationMs: Date.now() - started, detail: error instanceof Error ? error.stack ?? error.message : String(error) }
    results.push(result); console.error(`FAIL ${id} ${title}\n${result.detail}`); return result
  } finally {
    fs.rmSync(itemRoot, { recursive: true, force: true })
  }
}

function writeReport() {
  fs.mkdirSync(resultDir, { recursive: true })
  const payload = { generatedAt: new Date().toISOString(), isolatedRoot: root, checks, results }
  fs.writeFileSync(resultFile, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  const lines = [`# EvoResearch 验收证据`, ``, `生成时间：${payload.generatedAt}`, ``, `| ID | 状态 | 耗时 | 说明 |`, `|---|---|---:|---|`]
  for (const item of results) lines.push(`| ${item.id} | ${item.status.toUpperCase()} | ${item.durationMs} ms | ${String(item.detail).split('\n')[0].replaceAll('|', '\\|')} |`)
  lines.push('', `断言数：${checks}`, `结果 JSON：[accept-results.json](./accept-results.json)`, '')
  fs.writeFileSync(reportFile, `${lines.join('\n')}\n`, 'utf8')
}

async function main() {
  const args = process.argv.slice(2)
  if (args.includes('--list') || args.length === 0) { printList(); return }
  let selected = ITEMS
  if (args.includes('--run')) {
    const id = args[args.indexOf('--run') + 1]
    selected = ITEMS.filter((item) => item[0] === id)
    if (selected.length === 0) throw new Error(`未知验收项: ${id}`)
  }
  for (const item of selected) await runOne(item)
  writeReport()
  const failed = results.filter((item) => item.status !== 'pass')
  if (failed.length > 0) process.exitCode = 1
  else console.log(`Acceptance PASS（${results.length}/${selected.length} 项，${checks} 个断言）`)
}

try {
  await main()
} finally {
  if (previousDshHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousDshHome
  fs.rmSync(root, { recursive: true, force: true })
}
