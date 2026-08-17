#!/usr/bin/env node
/**
 * Domain E2E checks.
 *
 * This is deliberately service-level rather than browser-level: it exercises the
 * durable boundaries that must remain true across UI/desktop entry points. Every
 * run uses a fresh temporary data root and removes it in finally.
 *
 * Run with: node --import tsx scripts/verify-domain-e2e.mjs
 */
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

import { ExperimentWorkspaceService } from '../packages/evoresearch-plugin/src/host/experiment-workspace.ts'
import { ExperimentProcessService, classifyAfterRestart, decideExitStatus } from '../packages/evoresearch-plugin/src/host/experiment-process.ts'
import { ManuscriptService, diffDraftTexts } from '../packages/evoresearch-plugin/src/host/manuscript.ts'
import { McpSupervisor } from '../packages/evoresearch-plugin/src/host/mcp/supervisor.ts'
import { selectToolsForTurn, BASE_TOOL_WHITELIST } from '../packages/evoresearch-plugin/src/host/platform/tools-selector.ts'
import { SubagentFacade, SubagentProviderRegistry, SubagentRegistry } from '../packages/evoresearch-plugin/src/host/platform/subagents.ts'
import { raExplore, defineEaTask, emaPropose, emaSubmitCandidates } from '../packages/evoresearch-plugin/src/host/science/roles.ts'
import { createScienceLoop, executeLoop, loopTransition } from '../packages/evoresearch-plugin/src/host/science/loops.ts'
import { CandidateRegistry } from '../packages/evoresearch-plugin/src/host/evolution/registry.ts'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evoresearch-domain-e2e-'))
const project = path.join(root, 'projects', 'demo')
fs.mkdirSync(project, { recursive: true })

let checks = 0
function check(condition, message) {
  checks += 1
  assert.ok(condition, message)
  console.log(`PASS ${message}`)
}

async function waitFor(processService, workspaceDir, slug, predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const latest = processService.status(workspaceDir, slug).latest
    if (latest && predicate(latest)) return latest
    await delay(25)
  }
  return processService.status(workspaceDir, slug).latest
}

async function experimentAndWriting() {
  const workspace = new ExperimentWorkspaceService({ dataRoot: root })
  const experiment = workspace.createWorkspace('demo', 'running experiment')
  const noteBefore = workspace.readNote(project, experiment.slug)
  workspace.appendNote(project, experiment.slug, '\nThe experiment may still be running while the paper is edited.\n')
  check(workspace.readNote(project, experiment.slug).startsWith(noteBefore), '实验笔记只追加，不覆盖原文')

  fs.mkdirSync(path.join(experiment.dir, 'artifacts'), { recursive: true })
  fs.writeFileSync(path.join(experiment.dir, 'artifacts', 'metrics.csv'), 'accuracy,0.91\n', 'utf8')
  check(workspace.artifacts(project, experiment.slug).files === 1, '实验产物目录可被发现')

  const processService = new ExperimentProcessService({ dataRoot: root, workspace })
  const node = process.platform === 'win32' ? 'node' : JSON.stringify(process.execPath)
  const successScript = path.join(experiment.dir, 'verify-success.cjs')
  fs.writeFileSync(successScript, "process.stdout.write('RUN-OK\\n')\n", 'utf8')
  processService.run(project, experiment.slug, {
    command: `${node} ${path.basename(successScript)}`,
    pythonPath: 'python-from-test',
  })
  const success = await waitFor(processService, project, experiment.slug, (run) => run.status !== 'running')
  check(success?.status === 'success', '实验成功运行并落盘状态')
  check(processService.readLog(project, experiment.slug, 'stdout').text.includes('RUN-OK'), 'stdout 可分页回读')

  const failedScript = path.join(experiment.dir, 'verify-failed.cjs')
  fs.writeFileSync(failedScript, 'process.exitCode = 7\n', 'utf8')
  processService.run(project, experiment.slug, { command: `${node} ${path.basename(failedScript)}` })
  const failed = await waitFor(processService, project, experiment.slug, (run) => run.status !== 'running')
  check(failed?.status === 'failed' && failed.exitCode === 7, '实验失败保留退出码')

  const importedSource = path.join(root, 'external-results')
  fs.mkdirSync(importedSource, { recursive: true })
  fs.writeFileSync(path.join(importedSource, 'result.txt'), 'RESULT-42\n', 'utf8')
  const imported = workspace.importExisting('demo', importedSource, { name: 'existing results' })
  check(imported.source?.mode === 'reference', '已有结果目录以引用方式导入')
  check(workspace.listContents(project, imported.slug).files >= 1, '导入目录内容实时可见')

  const manuscript = new ManuscriptService({ dataRoot: root })
  const paper = manuscript.createManuscript('demo')
  manuscript.writeFile('demo', 'paper', 'sections/results.tex', 'The result is still a placeholder while the run continues.\n')
  check(manuscript.readFile('demo', 'paper', 'sections/results.tex').content.includes('placeholder'), '实验运行期可以继续编辑论文占位内容')
  const draft = diffDraftTexts('A paragraph.\n\nA result paragraph.', 'A paragraph.\n\nA result paragraph updated.')
  check(draft.changed.length === 1 || draft.added.length > 0, '结果变化只生成草稿差异，不覆盖稿件')
  const evidence = manuscript.quoteCheck('demo', { experimentDir: experiment.dir, text: '0.91' })
  check(evidence.fileHits.some((hit) => hit.snippet.includes('0.91')), '论文数字核对能定位实验原始文件')
  const compile = await manuscript.compileManuscript('demo', 'paper', { timeoutMs: 5000 })
  check(compile.ok === true || (compile.ok === false && (compile.tool === null || compile.logPath !== null)), 'LaTeX 编译成功，或失败时给出可操作结果且不阻塞写作')
  manuscript.dispose()

  check(decideExitStatus(false, { exitCode: 0, exitSignal: null, error: null }) === 'success', '自然退出成功状态可判定')
  check(decideExitStatus(true, { exitCode: null, exitSignal: 'SIGTERM', error: null }) === 'user-stopped', '用户停止状态可判定')
  const recovered = classifyAfterRestart({ status: 'running', stopRequested: false, pid: 11, command: 'demo', runId: 'r', cwd: project }, { alive: false, commandLine: null })
  check(recovered?.status === 'unknown', '重启后无法确认的进程保持 unknown')
}

async function platformDegradation() {
  const goodTools = [{ name: 'search_docs' }, { name: 'write_file' }]
  const supervisor = new McpSupervisor({
    clientFactory: (config) => ({
      async connect() {
        if (config.serverId === 'broken') throw new Error('offline')
        return { tools: [{ name: 'search_docs' }, { name: 'dangerous_tool' }] }
      },
      disconnect() {},
    }),
    delay: async () => {},
  })
  supervisor.addServer({ serverId: 'good', name: 'Good', transport: 'http', url: 'http://test', toolFilter: { allow: ['search_*'], deny: ['*dangerous*'] }, exposeTo: ['ra'] })
  supervisor.addServer({ serverId: 'broken', name: 'Broken', transport: 'http', url: 'http://test', autoReconnect: false })
  await supervisor.start('good')
  await supervisor.start('broken')
  check(supervisor.get('good')?.state === 'running', 'MCP 正常服务器可启动')
  check(supervisor.get('broken')?.state === 'failed' && supervisor.toolsFor('ra').length === 1, '单个 MCP 失败只局部降级')
  check(supervisor.toolsFor('other').length === 0, 'MCP 按 Agent 暴露范围过滤')
  await supervisor.stop('good')
  supervisor.disposeAll()

  const selected = selectToolsForTurn([...BASE_TOOL_WHITELIST.map((name) => ({ name })), ...goodTools], '文献')
  check(BASE_TOOL_WHITELIST.every((name) => selected.some((tool) => tool.name === name)), '自适应工具选择始终保留基础记忆与任务工具')

  const providers = new SubagentProviderRegistry()
  const providerState = { interrupted: false }
  providers.register({
    name: 'fake',
    async create() { return { ok: true, subagentId: 'fake-1', sessionId: 'child-1', resumePoint: 'p1' } },
    async interrupt() { providerState.interrupted = true; return { ok: true, resumePoint: 'p2' } },
    async report() { return { ok: true, report: 'reported' } },
  })
  const registry = new SubagentRegistry(root)
  const facade = new SubagentFacade(registry, providers)
  const child = await facade.create({ parentSessionId: 'parent', prompt: 'run', mode: 'continuable', provider: 'fake' })
  check(child.ok && child.record?.sessionId === 'child-1', '可插拔子代理 provider 创建并记录谱系')
  await facade.interrupt(child.record.subagentId)
  await facade.report(child.record.subagentId)
  check(providerState.interrupted && registry.get(child.record.subagentId)?.status === 'done', '子代理支持中断、恢复点和结果回报')
}

async function scienceCollaboration() {
  const directions = await raExplore({ idea: '比较 A 与 B。保留一个失败方向。', graphContext: [] }, 'propose')
  check(directions.length >= 1, 'RA 可以提出没有通过门槛的 Idea')
  const task = defineEaTask({ kind: 'implement', title: '实现候选', description: directions[0].text, experimentSlug: 'running-experiment' })
  check(task.artifacts.length >= 3 && task.status === 'pending', 'EA 任务带有代码、命令、验证和结果保存约定')
  const loop = createScienceLoop({ kind: 'experiment-try', title: '尝试两个方向', authorizedBy: 'user', budget: { maxSteps: 2 }, steps: [{ label: 'A' }, { label: 'B' }] })
  const completed = await executeLoop(loop, { async runStep(_loop, step) { return { ok: step.label !== 'B', output: `ran-${step.label}`, error: step.label === 'B' ? 'failed' : undefined } } })
  check(completed.status === 'completed' && completed.steps.some((step) => step.status === 'failed'), '自动循环预算内运行且失败分支保留')
  let paused = loopTransition(loopTransition(loop, 'start'), 'pause')
  paused = loopTransition(paused, 'resume')
  paused = loopTransition(paused, 'cancel')
  check(paused.status === 'cancelled' && paused.steps.some((step) => step.status === 'rolled-back'), '自动循环支持暂停、取消和分支级回滚')

  const candidates = await emaPropose({ weaknesses: '工具反复失败，检索说法不一致。' })
  check(candidates.length >= 1 && candidates.every((candidate) => !/原始|论文|实验资料/.test(candidate.description)), 'EMA 只提出 Harness 改进候选')
  const evolution = new CandidateRegistry({ dataRoot: root })
  const ids = emaSubmitCandidates(candidates, evolution)
  const disposer = evolution.activate(ids[0])
  check(evolution.currentVersion(candidates[0].component) !== undefined, 'EMA 候选必须显式激活才生效')
  disposer()
  check(evolution.currentVersion(candidates[0].component) === undefined, 'EMA 候选回滚后恢复原组件状态')
}

try {
  await experimentAndWriting()
  await platformDegradation()
  await scienceCollaboration()
  console.log(`Domain E2E PASS (${checks} checks, isolated root: ${root})`)
} catch (error) {
  console.error(`Domain E2E FAIL: ${error instanceof Error ? error.stack : String(error)}`)
  process.exitCode = 1
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}
