/**
 * 科学自演化编排（SCI-01..10）单元测试。
 *
 * SCI-10：RA/EA/EMA 协作流程、Idea 失败保留、实验失败复用、EMA 候选回退，
 * 纯函数级 + 假服务注入；ExperimentWorkspaceService 用真实临时目录验证
 * 追加语义（BASE-02：mkdtemp + 统一清理）。
 */
import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  SCIENCE_DUTIES,
  findScienceDuty,
  rolesForDuty,
  raExplore,
  defaultRaReasoner,
  defineEaTask,
  eaTaskTransition,
  eaTaskPrompt,
  emaPropose,
  emaSubmitCandidates,
  graphNodesToContext,
} from '../src/host/science/roles.js'
import { ScienceMemory } from '../src/host/science/memory.js'
import {
  ideaTreeFromGraph,
  experimentTreeFromDirs,
  createScienceLoop,
  loopTransition,
  executeLoop,
  experimentAppender,
} from '../src/host/science/loops.js'
import { emptyGraph } from '../src/host/chat-graph.js'
import { CandidateRegistry } from '../src/host/evolution/registry.js'
import { ExperimentWorkspaceService } from '../src/host/experiment-workspace.js'
import { WorkspaceService } from '../src/host/workspace.js'
import type { ScienceLoop } from '../src/host/science/loops.js'

/** 临时数据根（BASE-02：测试结束统一清理）。 */
const tmpRoots: string[] = []
function tmpRoot(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `evoresearch-sci-${prefix}-`))
  tmpRoots.push(dir)
  return dir
}
after(() => {
  for (const dir of tmpRoots) fs.rmSync(dir, { recursive: true, force: true })
})

/* ------------------------------------------------------------------ */
/* SCI-01：职责定义与六类角色映射                                       */
/* ------------------------------------------------------------------ */

describe('SCI-01 RA/EA/EMA 职责与角色映射', () => {
  it('三类职责定义完整，边界清晰（RA 不设门槛/EA 记录产物/EMA 不碰科研内容）', () => {
    assert.deepEqual(SCIENCE_DUTIES.map((d) => d.duty), ['RA', 'EA', 'EMA'])
    const ra = findScienceDuty('RA')
    assert.ok(ra.forbidden.includes('不宣布'))
    assert.ok(ra.forbidden.includes('不实现代码'))
    assert.ok(ra.scope.includes('Idea'))
    const ea = findScienceDuty('EA')
    assert.ok(ea.scope.includes('复现'))
    assert.ok(ea.scope.includes('失败复盘'))
    const ema = findScienceDuty('EMA')
    assert.ok(ema.forbidden.includes('不直接改写'))
    assert.ok(ema.systemPrompt.includes('diff'))
  })

  it('映射现有六类角色（teams.ts）：RA→research/planner，EA→code/debug/data_analysis，EMA 无直接映射', () => {
    assert.deepEqual(rolesForDuty('RA').map((r) => r.id), ['research', 'planner'])
    assert.deepEqual(rolesForDuty('EA').map((r) => r.id), ['code', 'debug', 'data_analysis'])
    assert.deepEqual(rolesForDuty('EMA'), [])
  })
})

/* ------------------------------------------------------------------ */
/* SCI-02：RA 接口                                                      */
/* ------------------------------------------------------------------ */

describe('SCI-02 RA Idea 探索接口', () => {
  it('缺省启发式 reasoner：propose/compare/question/extend 输出候选方向（无门槛）', async () => {
    const input = {
      idea: '对比 A 和 B 两种方法。这个方法能不能扩展？如果加入正则化会怎样。',
      graphContext: [
        { nodeId: 'n1', title: '基线讨论' },
        { nodeId: 'n2', title: '方法草图' },
      ],
      history: '之前讨论过数据集 C。',
    }
    const proposes = await raExplore(input, 'propose')
    assert.ok(proposes.length >= 1)
    assert.ok(proposes.every((d) => d.kind === 'propose' && d.text.length > 0))
    const compares = await raExplore(input, 'compare')
    assert.ok(compares.length >= 1)
    assert.ok(compares.every((d) => d.kind === 'compare'))
    const questions = await raExplore(input, 'question')
    assert.ok(questions.length >= 1)
    assert.ok(questions.every((d) => d.kind === 'question'))
    const extends_ = await raExplore(input, 'extend')
    assert.ok(extends_.length >= 1)
    assert.ok(extends_.every((d) => d.kind === 'extend'))
    // 带 Graph 上下文的 propose 会附一条综合方向（引用节点）
    const withSources = proposes.find((d) => (d.sources?.length ?? 0) > 0)
    assert.ok(withSources)
  })

  it('branch 操作：每个 Graph 节点一个分支起点候选（含 branchFrom）', async () => {
    const directions = await raExplore(
      { idea: '继续探索', graphContext: [{ nodeId: 'n1', title: '方向一' }, { nodeId: 'n2', title: '方向二' }] },
      'branch',
    )
    assert.ok(directions.length >= 2)
    assert.ok(directions.some((d) => d.branchFrom === 'n1'))
    assert.ok(directions.some((d) => d.branchFrom === 'n2'))
  })

  it('注入 reasoner（LLM/子代理替换点）', async () => {
    const directions = await raExplore({ idea: 'x' }, 'propose', async (input) => [
      { id: 'custom-1', kind: 'propose' as const, text: `自定义方向：${input.idea}` },
    ])
    assert.equal(directions.length, 1)
    assert.equal(directions[0]?.text, '自定义方向：x')
  })

  it('graphNodesToContext 只取只读叶字段', () => {
    const nodes = [
      { id: 'n1', type: 'chat' as const, title: '会话', x: 0, y: 0 },
      { id: 'n2', type: 'memory' as const, title: '记忆', x: 1, y: 1, content: '内容' },
    ]
    const context = graphNodesToContext(nodes)
    assert.equal(context.length, 2)
    assert.equal(context[1]?.content, '内容')
  })
})

/* ------------------------------------------------------------------ */
/* SCI-03：EA 接口                                                      */
/* ------------------------------------------------------------------ */

describe('SCI-03 EA 任务定义', () => {
  it('六类任务定义完整；校验标题/描述/类型', () => {
    for (const kind of ['reproduce', 'implement', 'hyperparameter', 'ablation', 'analysis', 'postmortem'] as const) {
      const task = defineEaTask({ kind, title: `任务-${kind}`, description: '描述', experimentSlug: 'exp-1' })
      assert.equal(task.kind, kind)
      assert.equal(task.status, 'pending')
      assert.ok(task.artifacts.length >= 1)
      assert.equal(task.experimentSlug, 'exp-1')
    }
    assert.throws(() => defineEaTask({ kind: 'reproduce', title: '', description: 'd' }))
    assert.throws(() => defineEaTask({ kind: 'reproduce', title: 't', description: '' }))
    assert.throws(() => defineEaTask({ kind: 'nope' as never, title: 't', description: 'd' }))
  })

  it('任务状态迁移；done/failed 终态', () => {
    const task = defineEaTask({ kind: 'implement', title: 't', description: 'd' })
    const running = eaTaskTransition(task, 'running')
    assert.equal(running.status, 'running')
    const done = eaTaskTransition(running, 'done')
    assert.equal(done.status, 'done')
    assert.equal(eaTaskTransition(done, 'failed').status, 'done') // 终态不变
  })

  it('eaTaskPrompt 含实验目录与产物约定（投递文本）', () => {
    const task = defineEaTask({ kind: 'postmortem', title: '复盘', description: '分析失败', experimentSlug: 'exp-1' })
    const prompt = eaTaskPrompt(task)
    assert.ok(prompt.includes('experiments/exp-1'))
    assert.ok(prompt.includes('失败日志'))
    assert.ok(prompt.includes('根因分析'))
  })
})

/* ------------------------------------------------------------------ */
/* SCI-04：EMA 接口                                                     */
/* ------------------------------------------------------------------ */

describe('SCI-04 EMA 只输出 Harness 候选', () => {
  it('缺省 reasoner：弱点聚合 → 组件候选（一次一组件、不碰科研内容）', async () => {
    const weaknesses = [
      '## 工具 bash 重复失败 5 次。建议检查该工具的调用参数。',
      '## 同一检索「uv」需要换 3 次说法才能命中。建议改进查询改写。',
      '## 用户移除了 2 次上下文材料。建议调整上下文长度分配。',
    ].join('\n')
    const candidates = await emaPropose({ weaknesses })
    assert.ok(candidates.length >= 3)
    const components = candidates.map((c) => c.component)
    assert.ok(components.includes('skill'))
    assert.ok(components.includes('query-rewrite'))
    assert.ok(components.includes('token-allocation'))
    // 同一轮一个组件只提一个候选（EVO-04）
    assert.equal(new Set(components).size, components.length)
    // 候选不包含任何科研正文修改（只有组件说明 + diff）
    for (const candidate of candidates) {
      assert.ok(candidate.description.length > 0)
      assert.ok(candidate.diff.includes('--- before'))
      assert.ok(candidate.rationale)
    }
  })

  it('失败样本直接映射组件候选', async () => {
    const candidates = await emaPropose({
      failureSamples: [
        { sampleId: 'f1', component: 'query-rewrite', input: 'q1', expected: 'e1' },
        { sampleId: 'f2', component: 'skill', input: 'q2', expected: 'e2' },
      ],
    })
    const components = candidates.map((c) => c.component)
    assert.ok(components.includes('query-rewrite'))
    assert.ok(components.includes('skill'))
  })

  it('emaSubmitCandidates 提交到 t15 候选注册表（隔离，不影响当前版本）', async () => {
    const root = tmpRoot('ema-registry')
    const registry = new CandidateRegistry({ dataRoot: root })
    const candidates = await emaPropose({ weaknesses: '## 工具 bash 重复失败。' })
    const ids = emaSubmitCandidates(candidates, registry)
    assert.equal(ids.length, candidates.length)
    for (const id of ids) {
      const candidate = registry.getCandidate(id)
      assert.equal(candidate?.status, 'proposed')
    }
  })
})

/* ------------------------------------------------------------------ */
/* SCI-05/06：Ideation / Experimentation 记忆                           */
/* ------------------------------------------------------------------ */

describe('SCI-05/06 科学记忆（Markdown + 定位链接）', () => {
  it('add/list/read/write/remove；路径 <ws>/.evoresearch-data/memories/science/<kind>/', () => {
    const root = tmpRoot('mem')
    const memory = new ScienceMemory(root)
    const entry = memory.add('ideation', {
      title: '分支方向：对比学习',
      body: '把对比学习用在序列数据上。',
      links: [{ label: '讨论来源', target: 'session-1', kind: 'chat' }],
      status: 'promising',
    }, root)
    assert.equal(entry.kind, 'ideation')
    assert.ok(entry.body.startsWith('# 分支方向：对比学习'))
    assert.ok(entry.body.includes('待验证'))
    const file = path.join(root, 'plugins', 'memories', 'science', 'ideation', entry.fileName)
    assert.ok(fs.existsSync(file))
    // 零 frontmatter：文件不以 --- 开头
    assert.ok(!fs.readFileSync(file, 'utf8').startsWith('---'))

    const listed = memory.list('ideation', root)
    assert.equal(listed.length, 1)
    assert.equal(listed[0]?.links.length, 1)
    assert.equal(listed[0]?.links[0]?.target, 'session-1')

    // 用户编辑导航文字（整文件写）
    const edited = memory.write('ideation', entry.fileName, '# 分支方向：对比学习（修订）\n\n改为关注负样本。', root)
    assert.equal(edited?.title, '分支方向：对比学习（修订）')
    // 编辑后自动定位链接仍在（索引维护）
    assert.equal(edited?.links[0]?.target, 'session-1')

    // 删除
    assert.equal(memory.remove('ideation', entry.fileName, root), true)
    assert.equal(memory.list('ideation', root).length, 0)
    assert.equal(memory.remove('ideation', entry.fileName, root), false)
  })

  it('experimentation 记忆：保存成功/失败/有效做法/待重试（status 模板 + appendBody 只追加）', () => {
    const root = tmpRoot('mem-exp')
    const memory = new ScienceMemory(root)
    const failed = memory.add('experimentation', {
      title: '超参尝试：lr=1e-3 发散',
      body: '训练 100 步后 loss 发散。',
      links: [{ label: '失败日志', target: 'exp-a/.evoresearch-run.json', kind: 'log' }],
      status: 'failed',
    }, root)
    assert.ok(failed.body.includes('失败原因'))
    // 追加复盘（只追加不覆盖）
    const appended = memory.appendBody('experimentation', failed.fileName, '原因：学习率过大，改为 warmup。', root)
    assert.ok(appended?.body.includes('loss 发散'))
    assert.ok(appended?.body.includes('改为 warmup'))
    // 待重试条目
    const retry = memory.add('experimentation', { title: '重试：lr=1e-4 + warmup', status: 'retry' }, root)
    assert.ok(retry.body.includes('待重新尝试'))
    // 链接保留（日志/结果定位入口）
    assert.equal(retry.links.length, 0)
    const list = memory.list('experimentation', root)
    assert.equal(list.length, 2)
  })

  it('不同 kind 目录隔离', () => {
    const root = tmpRoot('mem-kinds')
    const memory = new ScienceMemory(root)
    memory.add('ideation', { title: 'Idea A' }, root)
    memory.add('experimentation', { title: '实验 B' }, root)
    assert.equal(memory.list('ideation', root).length, 1)
    assert.equal(memory.list('experimentation', root).length, 1)
    assert.ok(memory.dirOf(root, 'ideation').includes(path.join('science', 'ideation')))
    assert.ok(memory.dirOf(root, 'experimentation').includes(path.join('science', 'experimentation')))
  })
})

/* ------------------------------------------------------------------ */
/* SCI-07：tree 视图（派生）                                            */
/* ------------------------------------------------------------------ */

describe('SCI-07 Idea/Experiment tree 视图', () => {
  it('ideaTreeFromGraph：context 边成树，memory 节点作叶子，多根', () => {
    const graph = emptyGraph()
    graph.nodes = [
      { id: 'a', type: 'chat', title: '根讨论', x: 0, y: 0 },
      { id: 'b', type: 'chat', title: '分支一', x: 1, y: 1 },
      { id: 'c', type: 'chat', title: '分支二', x: 2, y: 2 },
      { id: 'm1', type: 'memory', title: '参考笔记', x: 3, y: 3, content: '…' },
      { id: 'orphan', type: 'chat', title: '独立会话', x: 4, y: 4 },
    ]
    graph.edges = [
      { id: 'e1', from: 'a', to: 'b', toPort: 'context' },
      { id: 'e2', from: 'a', to: 'c', toPort: 'context' },
      { id: 'e3', from: 'b', to: 'm1', toPort: 'memory' },
    ]
    const trees = ideaTreeFromGraph(graph)
    assert.equal(trees.length, 2) // 根讨论 + 独立会话
    const root = trees.find((t) => t.title === '根讨论')
    assert.equal(root?.children.length, 2)
    const branchB = root?.children.find((c) => c.title === '分支一')
    assert.equal(branchB?.children.length, 1)
    assert.equal(branchB?.children[0]?.title, '参考笔记')
    assert.equal(branchB?.children[0]?.kind, 'idea')
  })

  it('ideaTreeFromGraph：指定根节点展开', () => {
    const graph = emptyGraph()
    graph.nodes = [
      { id: 'a', type: 'chat', title: '根', x: 0, y: 0 },
      { id: 'b', type: 'chat', title: '子', x: 1, y: 1 },
    ]
    graph.edges = [{ id: 'e1', from: 'a', to: 'b', toPort: 'context' }]
    const trees = ideaTreeFromGraph(graph, 'a')
    assert.equal(trees.length, 1)
    assert.equal(trees[0]?.title, '根')
    assert.equal(trees[0]?.children[0]?.title, '子')
  })

  it('experimentTreeFromDirs：扁平根 + parentOf 分组', () => {
    const dirs = [
      { slug: 'exp-a', dir: '/x/experiments/exp-a', createdAt: 1 },
      { slug: 'exp-b', dir: '/x/experiments/exp-b', createdAt: 2 },
    ]
    const flat = experimentTreeFromDirs(dirs)
    assert.equal(flat.length, 2)
    assert.ok(flat.every((t) => t.kind === 'experiment'))
    // parentOf 注入：exp-b 挂在 exp-a 下
    const grouped = experimentTreeFromDirs(dirs, (slug) => (slug === 'exp-b' ? 'exp-a' : undefined))
    assert.equal(grouped.length, 1)
    assert.equal(grouped[0]?.children.length, 1)
    assert.equal(grouped[0]?.children[0]?.title, 'exp-b')
  })
})

/* ------------------------------------------------------------------ */
/* SCI-08/09：自动循环（状态机 + 执行壳 + 追加）                         */
/* ------------------------------------------------------------------ */

describe('SCI-08 循环状态机（纯函数）', () => {
  it('start → step-done×N → completed；预算截断步骤数', () => {
    let loop = createScienceLoop({
      kind: 'idea-explore',
      title: '探索',
      authorizedBy: 'user-1',
      budget: { maxSteps: 2 },
      steps: [{ label: '方向一' }, { label: '方向二' }, { label: '方向三（超预算）' }],
    })
    assert.equal(loop.steps.length, 2) // 预算截断
    assert.equal(loop.status, 'idle')
    loop = loopTransition(loop, 'start')
    assert.equal(loop.status, 'running')
    assert.equal(loop.steps[0]?.status, 'running')
    loop = loopTransition(loop, 'step-done', 'step-1', { output: '结果一' })
    assert.equal(loop.steps[0]?.status, 'done')
    assert.equal(loop.steps[1]?.status, 'running')
    loop = loopTransition(loop, 'step-done', 'step-2', { output: '结果二' })
    assert.equal(loop.status, 'completed')
    assert.ok(loop.finalReport?.includes('2/2'))
    // 终态不可迁移
    assert.equal(loopTransition(loop, 'pause').status, 'completed')
  })

  it('cancel：当前 running 步骤回滚（分支回滚），完成数保留', () => {
    let loop = createScienceLoop({
      kind: 'experiment-try',
      title: '实验尝试',
      authorizedBy: 'user-1',
      steps: [{ label: 's1' }, { label: 's2' }],
    })
    loop = loopTransition(loop, 'start')
    loop = loopTransition(loop, 'step-done', 'step-1')
    loop = loopTransition(loop, 'cancel')
    assert.equal(loop.status, 'cancelled')
    assert.equal(loop.steps[1]?.status, 'rolled-back')
    assert.equal(loop.steps[0]?.status, 'done')
    assert.ok(loop.finalReport?.includes('已回滚'))
  })

  it('step-failed：失败保留并继续下一轮；全部结束后 completed（含失败数）', () => {
    let loop = createScienceLoop({
      kind: 'experiment-try',
      title: 't',
      authorizedBy: 'u',
      steps: [{ label: 'a' }, { label: 'b' }, { label: 'c' }],
    })
    loop = loopTransition(loop, 'start')
    loop = loopTransition(loop, 'step-failed', 'step-1', { error: '崩溃' })
    assert.equal(loop.steps[0]?.status, 'failed')
    assert.equal(loop.steps[0]?.error, '崩溃')
    assert.equal(loop.steps[1]?.status, 'running') // 继续
    loop = loopTransition(loop, 'step-done', 'step-2')
    loop = loopTransition(loop, 'step-failed', 'step-3', { error: '超时' })
    assert.equal(loop.status, 'completed')
    assert.ok(loop.finalReport?.includes('1 成功 / 2 失败保留'))
  })

  it('pause/resume/rollback-step/complete', () => {
    let loop = createScienceLoop({ kind: 'idea-explore', title: 't', authorizedBy: 'u', steps: [{ label: 'a' }] })
    loop = loopTransition(loop, 'start')
    loop = loopTransition(loop, 'pause')
    assert.equal(loop.status, 'paused')
    loop = loopTransition(loop, 'resume')
    assert.equal(loop.status, 'running')
    loop = loopTransition(loop, 'complete', undefined, { output: '手动完成' })
    assert.equal(loop.status, 'completed')
    // rollback-step：done 步骤可回滚
    const loop2 = createScienceLoop({ kind: 'idea-explore', title: 't2', authorizedBy: 'u', steps: [{ label: 'a' }, { label: 'b' }] })
    let l2 = loopTransition(loop2, 'start')
    l2 = loopTransition(l2, 'step-done', 'step-1')
    l2 = loopTransition(l2, 'rollback-step', 'step-1')
    assert.equal(l2.steps[0]?.status, 'rolled-back')
    // 未知步骤回滚 no-op
    assert.equal(loopTransition(l2, 'rollback-step', 'step-x').steps[0]?.status, 'rolled-back')
  })
})

describe('SCI-09 循环执行壳与追加语义', () => {
  it('executeLoop：全成功 → 每步追加产出（追加不覆盖），completed 带结果回报', async () => {
    const root = tmpRoot('loop-run')
    const workspace = new ExperimentWorkspaceService({ dataRoot: root })
    new WorkspaceService({ dataRoot: root }).createProject('demo')
    const info = workspace.createWorkspace('demo', 'exp-1')
    const projectDir = path.join(root, 'projects', 'demo')
    const appender = experimentAppender(workspace, projectDir)
    const loop = createScienceLoop({
      kind: 'experiment-try',
      title: '尝试',
      authorizedBy: 'user-1',
      steps: [
        { label: '跑基线', appendTo: { kind: 'experiment', ref: 'exp-1' } },
        { label: '跑变体', appendTo: { kind: 'experiment', ref: 'exp-1' } },
      ],
    })
    const runner = {
      async runStep(_loop: ScienceLoop, step: { label: string }) {
        return { ok: true, output: `## 步骤结果：${step.label}\n- 指标：0.9` }
      },
    }
    const result = await executeLoop(loop, runner, appender)
    assert.equal(result.status, 'completed')
    assert.equal(result.steps.filter((s) => s.status === 'done').length, 2)
    // 追加语义：LAB_NOTE 包含两段且都保留
    const note = workspace.readNote(projectDir, 'exp-1')
    assert.ok(note.includes('跑基线'))
    assert.ok(note.includes('跑变体'))
  })

  it('executeLoop：中途失败保留并继续；取消 → 当前步骤回滚', async () => {
    const root = tmpRoot('loop-fail')
    const workspace = new ExperimentWorkspaceService({ dataRoot: root })
    new WorkspaceService({ dataRoot: root }).createProject('demo')
    workspace.createWorkspace('demo', 'exp-2')
    const projectDir = path.join(root, 'projects', 'demo')
    const appender = experimentAppender(workspace, projectDir)
    const loop = createScienceLoop({
      kind: 'experiment-try',
      title: 't',
      authorizedBy: 'u',
      steps: [{ label: 'a' }, { label: 'b' }, { label: 'c' }],
    })
    const runner = {
      async runStep(_loop: ScienceLoop, step: { label: string }) {
        if (step.label === 'b') return { ok: false, error: '段错误' }
        return { ok: true, output: `ok:${step.label}` }
      },
    }
    const result = await executeLoop(loop, runner, appender)
    assert.equal(result.status, 'completed')
    assert.equal(result.steps.find((s) => s.label === 'b')?.status, 'failed')
    assert.ok(result.finalReport?.includes('失败保留'))
    // 取消路径
    const loop2 = createScienceLoop({
      kind: 'idea-explore',
      title: 't2',
      authorizedBy: 'u',
      steps: [{ label: 'a' }, { label: 'b' }],
    })
    let cancelled = false
    const result2 = await executeLoop(loop2, runner, appender, {
      shouldCancel: () => cancelled,
    })
    // 先完成第一步后触发取消
    cancelled = true
    const result3 = await executeLoop(createScienceLoop({
      kind: 'idea-explore',
      title: 't3',
      authorizedBy: 'u',
      steps: [{ label: 'a' }, { label: 'b' }],
    }), runner, appender, { shouldCancel: () => cancelled })
    assert.equal(result3.status, 'cancelled')
    assert.equal(result2.status, 'completed') // 首个循环未被取消
  })

  it('实验追加器：graph-node 目标返回 ok:false（由上层 Graph 接线）', () => {
    const root = tmpRoot('loop-appender')
    const workspace = new ExperimentWorkspaceService({ dataRoot: root })
    const appender = experimentAppender(workspace, root)
    assert.deepEqual(appender.append({ kind: 'graph-node', ref: 'n1' }, 'x'), { ok: false })
    assert.deepEqual(appender.append({ kind: 'experiment', ref: 'nope' }, 'x'), { ok: false })
  })
})

/* ------------------------------------------------------------------ */
/* SCI-10：协作流程综合（RA→EA→EMA + 失败保留 + 复用 + 回退）             */
/* ------------------------------------------------------------------ */

describe('SCI-10 协作流程与失败保留/复用/回退', () => {
  it('RA 方向 → EA 任务 → EMA 候选 → 注册表激活 → 回滚（EMA 候选回退）', async () => {
    const root = tmpRoot('sci-flow')
    const registry = new CandidateRegistry({ dataRoot: root })
    const applied: string[] = []
    const registryWithApply = new CandidateRegistry({
      dataRoot: root,
      apply: (component) => {
        applied.push(component)
        return () => { applied.push(`${component}:disposed`) }
      },
    })

    // 1) RA 提出方向
    const directions = await raExplore({ idea: '对比 A 和 B 两种方法。', history: '之前失败过 C。' }, 'propose')
    assert.ok(directions.length >= 1)
    // 2) 取第一个方向定义 EA 任务（复现）
    const task = defineEaTask({
      kind: 'reproduce',
      title: '复现 A',
      description: directions[0]!.text,
      experimentSlug: 'repro-a',
    })
    assert.equal(task.status, 'pending')
    // 3) EMA 依据弱点提出候选并提交注册表
    const candidates = await emaPropose({ weaknesses: '## 工具 bash 重复失败 5 次。' })
    const ids = emaSubmitCandidates(candidates, registryWithApply)
    assert.ok(ids.length >= 1)
    const candidate = registryWithApply.getCandidate(ids[0]!)
    assert.equal(candidate?.component, 'skill')
    // 4) 激活 → 回滚（EMA 候选回退）
    const disposer = registryWithApply.activate(ids[0]!)
    assert.equal(registryWithApply.currentVersion('skill'), candidate?.version)
    assert.ok(applied.includes('skill'))
    disposer()
    assert.ok(applied.includes('skill:disposed'))
    assert.equal(registryWithApply.currentVersion('skill'), undefined)
    assert.equal(registryWithApply.getCandidate(ids[0]!)?.status, 'rolled-back')
  })

  it('Idea 失败保留：RA 讨论失败方向 → Ideation 记忆保留（不删除、可回读）', () => {
    const root = tmpRoot('sci-idea-fail')
    const memory = new ScienceMemory(root)
    const directions = [
      { id: 'd1', kind: 'propose' as const, text: '方向 A：对比学习' },
      { id: 'd2', kind: 'propose' as const, text: '方向 B：生成式预训练' },
    ]
    // 用户搁置方向 B（失败保留：Idea 不设通过门槛，只是保留）
    const entry = memory.add('ideation', {
      title: '方向 B：生成式预训练（暂缓）',
      body: directions[1]!.text,
      links: [{ label: '讨论', target: 'session-9', kind: 'chat' }],
      status: 'failed',
    }, root)
    assert.ok(entry.body.includes('失败原因'))
    // 之后仍能列出与回读（保留不删除）
    const listed = memory.list('ideation', root)
    assert.equal(listed.length, 1)
    assert.ok(listed[0]!.body.includes('生成式预训练'))
    assert.equal(listed[0]!.links[0]?.target, 'session-9')
  })

  it('实验失败复用：失败复盘 → Experimentation 记忆 → 重试任务（链接回失败日志与结果）', () => {
    const root = tmpRoot('sci-exp-reuse')
    const memory = new ScienceMemory(root)
    // 第一次失败复盘（EA postmortem）
    const postmortem = memory.add('experimentation', {
      title: 'lr=1e-3 训练发散复盘',
      body: 'loss 发散，根因：学习率过大。',
      links: [
        { label: '失败日志', target: 'exp-lr/.evoresearch-run.json', kind: 'log' },
        { label: '运行命令', target: 'exp-lr/run.ps1', kind: 'code' },
      ],
      status: 'failed',
    }, root)
    assert.equal(postmortem.links.length, 2)
    // 复用经验：重试任务（hyperparameter，引用失败实验）
    const retryTask = defineEaTask({
      kind: 'hyperparameter',
      title: '重试：lr=1e-4 + warmup',
      description: `复用复盘：${postmortem.title}；失败日志 ${postmortem.links[0]!.target}`,
      experimentSlug: 'exp-lr-retry',
    })
    assert.ok(retryTask.description.includes('训练发散复盘')) // 复用复盘（链接回失败日志）
    // 重试成功后记录有效做法（成功方向，链接回结果）
    const success = memory.add('experimentation', {
      title: '有效做法：小学习率 + warmup',
      body: 'lr=1e-4 + warmup 稳定收敛。',
      links: [{ label: '结果指标', target: 'exp-lr-retry/artifacts/metrics.csv', kind: 'result' }],
      status: 'success',
    }, root)
    assert.ok(success.body.includes('成功方向'))
    // 待重试条目（复用失败经验的下一步）
    const retryNote = memory.add('experimentation', {
      title: '待重试：lr=5e-4 检查点恢复',
      status: 'retry',
    }, root)
    assert.ok(retryNote.body.includes('待重新尝试'))
    // 三类条目都保留（失败/成功/待重试）
    assert.equal(memory.list('experimentation', root).length, 3)
  })
})
