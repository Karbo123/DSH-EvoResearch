/**
 * 自进化（EVO-01..10）单元测试。
 *
 * EVO-10：候选通过（activate + apply 副作用）、候选拒绝（不影响当前版本）、
 * 安装后回滚（disposer 释放副作用 + 恢复前一版本）、插件卸载无副作用
 * （disposeAll 释放全部；disposer 幂等）。
 *
 * 测试隔离（BASE-02）：全部使用 mkdtemp 临时数据根，结束后清理；
 * DSH skills 服务用假对象注入（EVO-09 只探测不依赖真实注册表）。
 */
import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { SignalStore, aggregateWeaknesses, weaknessMarkdown } from '../src/host/evolution/signals.js'
import { CandidateRegistry, unifiedDiff, EVOLUTION_COMPONENTS } from '../src/host/evolution/registry.js'
import { evaluateCandidate } from '../src/host/evolution/evaluator.js'
import { AutoSkillsService, discoverHabitCandidates, habitProposalContent } from '../src/host/autoskills.js'
import type { EvolutionSignal } from '../src/host/evolution/signals.js'

/** 临时数据根（BASE-02：测试结束统一清理）。 */
const tmpRoots: string[] = []
function tmpRoot(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `evoresearch-evo-${prefix}-`))
  tmpRoots.push(dir)
  return dir
}
after(() => {
  for (const dir of tmpRoots) fs.rmSync(dir, { recursive: true, force: true })
})

/** 构造假 ctx（仅提供 skills 服务，EVO-09 探测用）。 */
function fakeCtxWithSkills(skills: unknown): { get(name: string): unknown } {
  return {
    get(name: string): unknown {
      return name === 'skills' ? skills : undefined
    },
  }
}

/** 一个简单 apply 记录器：记录 apply/dispose 调用。 */
function applyRecorder(): {
  recorder: { applied: Array<{ component: string; version: number }>; disposed: Array<{ component: string; version: number }> }
  apply: (component: string, version: { version: number }) => () => void
} {
  const recorder = { applied: [] as Array<{ component: string; version: number }>, disposed: [] as Array<{ component: string; version: number }> }
  return {
    recorder,
    apply(component, version) {
      recorder.applied.push({ component, version: version.version })
      return () => { recorder.disposed.push({ component, version: version.version }) }
    },
  }
}

/* ------------------------------------------------------------------ */
/* EVO-01/02：信号收集与弱点聚合                                        */
/* ------------------------------------------------------------------ */

describe('EVO-01 信号收集（SignalStore JSONL 追加存储）', () => {
  it('recordSignal 追加式落盘，listSignals 回读', () => {
    const root = tmpRoot('signals')
    const store = new SignalStore(root)
    store.recordSignal({ type: 'tool_repeated_failure', toolName: 'bash', attempts: 3, note: 'bash 反复失败' })
    store.recordSignal({ type: 'user_reported_forgetting', missed: '上次的结论', note: '用户指出遗忘' })
    assert.equal(store.count(), 2)
    // JSONL：每行一个对象
    const lines = fs.readFileSync(store.fileOf(), 'utf8').split('\n').filter((l) => l.trim() !== '')
    assert.equal(lines.length, 2)
    const signals = store.listSignals()
    assert.equal(signals.length, 2)
    assert.ok(signals.every((s) => typeof s.signalId === 'string' && typeof s.createdAt === 'number'))
  })

  it('listSignals 支持类型/时间窗/数量过滤', () => {
    const root = tmpRoot('signals-filter')
    const store = new SignalStore(root)
    const t0 = Date.now()
    store.recordSignal({ type: 'tool_repeated_failure', toolName: 'bash', attempts: 2, note: 'a', createdAt: t0 })
    store.recordSignal({ type: 'search_rewrite_needed', query: 'x', note: 'b', createdAt: t0 + 1000 })
    store.recordSignal({ type: 'tool_repeated_failure', toolName: 'fs', attempts: 2, note: 'c', createdAt: t0 + 2000 })
    const tools = store.listSignals({ types: ['tool_repeated_failure'] })
    assert.equal(tools.length, 2)
    const since = store.listSignals({ since: t0 + 1500 })
    assert.equal(since.length, 1)
    const limited = store.listSignals({ limit: 1 })
    assert.equal(limited.length, 1)
  })

  it('坏行不阻塞读取（追加式日志容错）', () => {
    const root = tmpRoot('signals-corrupt')
    const store = new SignalStore(root)
    store.recordSignal({ type: 'habit_repetition', habit: 'x', count: 1, note: 'ok' })
    fs.appendFileSync(store.fileOf(), '{bad json}\n', 'utf8')
    const signals = store.listSignals()
    assert.equal(signals.length, 1)
    assert.equal(signals[0]?.type, 'habit_repetition')
  })
})

describe('EVO-02 弱点聚合为可读 Markdown', () => {
  it('同类信号聚为一簇，不同类分簇', () => {
    const signals: EvolutionSignal[] = [
      { signalId: 's1', type: 'tool_repeated_failure', toolName: 'bash', attempts: 2, note: 'bash 又失败了', createdAt: 1 },
      { signalId: 's2', type: 'tool_repeated_failure', toolName: 'bash', attempts: 3, note: 'bash 还是失败', createdAt: 2 },
      { signalId: 's3', type: 'search_rewrite_needed', query: 'uv 环境', note: '换个说法才搜到', createdAt: 3 },
    ]
    const clusters = aggregateWeaknesses(signals)
    assert.equal(clusters.length, 2)
    const bash = clusters.find((c) => c.key === 'tool:bash')
    assert.ok(bash)
    assert.equal(bash?.count, 2)
    const search = clusters.find((c) => c.key.startsWith('search:'))
    assert.ok(search)
    assert.equal(search?.count, 1)
  })

  it('weaknessMarkdown 输出自然语言可读（含标题/描述/示例）', () => {
    const signals: EvolutionSignal[] = [
      { signalId: 's1', type: 'tool_repeated_failure', toolName: 'bash', attempts: 2, note: 'bash 又失败了', createdAt: 1 },
    ]
    const md = weaknessMarkdown(aggregateWeaknesses(signals), 1234)
    assert.ok(md.includes('# 弱点聚合'))
    assert.ok(md.includes('bash'))
    assert.ok(md.includes('示例'))
    // 空信号 → 明确提示无弱点
    const empty = weaknessMarkdown([], 1234)
    assert.ok(empty.includes('没有收集到明显弱点信号'))
  })
})

/* ------------------------------------------------------------------ */
/* EVO-03/04/06：候选注册表（版本/diff/disposer 回滚）                   */
/* ------------------------------------------------------------------ */

describe('EVO-03 组件独立版本号', () => {
  it('内置组件清单完整；同组件版本递增，组件间互不影响', () => {
    assert.deepEqual([...EVOLUTION_COMPONENTS], ['query-rewrite', 'snippet-ranking', 'graph-neighborhood', 'token-allocation', 'skill'])
    const root = tmpRoot('registry-version')
    const registry = new CandidateRegistry({ dataRoot: root })
    assert.equal(registry.nextVersion('query-rewrite'), 1)
    const v1 = registry.propose({ component: 'query-rewrite', description: '第一版', diff: '-old\n+new' })
    assert.equal(v1.version, 1)
    const v2 = registry.propose({ component: 'query-rewrite', description: '第二版', diff: '-new\n+newer' })
    assert.equal(v2.version, 2)
    // 另一组件从 1 开始
    assert.equal(registry.propose({ component: 'skill', description: '技能 v1', diff: '' }).version, 1)
    assert.equal(registry.versions('query-rewrite').length, 2)
    assert.equal(registry.versions('skill').length, 1)
  })
})

describe('EVO-04 候选一次一组件 + 纯文本 diff', () => {
  it('unifiedDiff 输出统一格式（增/删/改行带 +/- 标记）', () => {
    const before = ['line1', 'old', 'line3'].join('\n')
    const after = ['line1', 'new', 'line3'].join('\n')
    const diff = unifiedDiff(before, after)
    assert.ok(diff.startsWith('--- before\n+++ after'))
    assert.ok(diff.includes('-old'))
    assert.ok(diff.includes('+new'))
    assert.ok(diff.includes('@@'))
    assert.ok(diff.includes(' line1'))
    // 相同文本 → 空 diff 头
    assert.equal(unifiedDiff('a\nb', 'a\nb'), '--- before\n+++ after')
    // 大输入退化不崩溃
    const bigA = Array.from({ length: 3000 }, (_, i) => `line${i}`).join('\n')
    const bigB = `${bigA}\nextra`
    const bigDiff = unifiedDiff(bigA, bigB)
    assert.ok(bigDiff.includes('+extra'))
  })

  it('propose 只接受单组件候选（结构上无多组件入口）', () => {
    const root = tmpRoot('registry-single')
    const registry = new CandidateRegistry({ dataRoot: root })
    const candidate = registry.propose({ component: 'token-allocation', description: '只改 token 分配', diff: '-x\n+y' })
    assert.equal(candidate.component, 'token-allocation')
    assert.equal(candidate.status, 'proposed')
    assert.ok(candidate.description.length > 0)
    assert.ok(candidate.diff.length > 0)
  })
})

describe('EVO-06 激活/回滚/disposer/卸载', () => {
  it('activate 应用副作用并更新当前版本；disposer 回滚释放副作用并恢复前一版本', () => {
    const root = tmpRoot('registry-rollback')
    const { recorder, apply } = applyRecorder()
    const registry = new CandidateRegistry({ dataRoot: root, apply })
    const v1 = registry.propose({ component: 'query-rewrite', description: '旧策略', diff: '-a\n+b' })
    const v2 = registry.propose({ component: 'query-rewrite', description: '新策略', diff: '-b\n+c' })
    // 激活 v1 → 当前版本 1
    const disposer1 = registry.activate(v1.candidateId)
    assert.equal(registry.currentVersion('query-rewrite'), 1)
    assert.equal(registry.getCandidate(v1.candidateId)?.status, 'active')
    assert.equal(recorder.applied.length, 1)
    // 激活 v2 → 当前版本 2，v2 的副作用已注册
    const disposer2 = registry.activate(v2.candidateId)
    assert.equal(registry.currentVersion('query-rewrite'), 2)
    assert.equal(recorder.applied.length, 2)
    assert.equal(recorder.disposed.length, 0)
    // 回滚 v2：副作用释放 + 版本恢复为 1
    disposer2()
    assert.equal(recorder.disposed.length, 1)
    assert.equal(recorder.disposed[0]?.version, 2)
    assert.equal(registry.currentVersion('query-rewrite'), 1)
    assert.equal(registry.getCandidate(v2.candidateId)?.status, 'rolled-back')
    // v1 仍 active
    assert.equal(registry.getCandidate(v1.candidateId)?.status, 'active')
    // disposer 幂等：二次调用不重复释放
    disposer2()
    assert.equal(recorder.disposed.length, 1)
    disposer1()
    assert.equal(registry.currentVersion('query-rewrite'), undefined)
  })

  it('rollback(candidateId) 等价回滚；拒绝不影响当前版本（EVO-05 隔离）', () => {
    const root = tmpRoot('registry-reject')
    const { apply } = applyRecorder()
    const registry = new CandidateRegistry({ dataRoot: root, apply })
    const v1 = registry.propose({ component: 'skill', description: '技能 v1', diff: '' })
    registry.activate(v1.candidateId)
    const v2 = registry.propose({ component: 'skill', description: '技能 v2', diff: '+new' })
    // 拒绝 v2：proposed → rejected，当前版本仍是 1
    assert.equal(registry.reject(v2.candidateId), true)
    assert.equal(registry.getCandidate(v2.candidateId)?.status, 'rejected')
    assert.equal(registry.currentVersion('skill'), 1)
    // 非 proposed 不可拒绝
    assert.equal(registry.reject(v1.candidateId), false)
    // rollback 不存在的候选 / 非 active 候选
    assert.equal(registry.rollback('nope'), false)
    assert.equal(registry.rollback(v2.candidateId), false)
  })

  it('disposeAll 卸载无副作用：全部 disposer 释放、活动清空、二次调用安全', () => {
    const root = tmpRoot('registry-dispose')
    const { recorder, apply } = applyRecorder()
    const registry = new CandidateRegistry({ dataRoot: root, apply })
    const a = registry.propose({ component: 'snippet-ranking', description: 'a', diff: '' })
    const b = registry.propose({ component: 'snippet-ranking', description: 'b', diff: '' })
    registry.activate(a.candidateId)
    registry.activate(b.candidateId)
    assert.equal(registry.activeCount(), 2)
    registry.disposeAll()
    assert.equal(recorder.disposed.length, 2)
    assert.equal(registry.activeCount(), 0)
    assert.equal(registry.currentVersion('snippet-ranking'), undefined)
    // 幂等：再次 disposeAll 不抛错、不重复释放
    registry.disposeAll()
    assert.equal(recorder.disposed.length, 2)
    // 卸载后持久化文件可重新加载（候选仍在，状态为 rolled-back）
    const reloaded = new CandidateRegistry({ dataRoot: root, apply })
    assert.equal(reloaded.activeCount(), 0)
    assert.equal(reloaded.listCandidates().length, 2)
  })
})

/* ------------------------------------------------------------------ */
/* EVO-05：候选评估（失败历史样本比较，隔离不通过）                      */
/* ------------------------------------------------------------------ */

describe('EVO-05 候选评估', () => {
  const samples = [
    { sampleId: 'fail-1', component: 'query-rewrite', input: '查询A', expected: '期望A' },
    { sampleId: 'fail-2', component: 'query-rewrite', input: '查询B', expected: '期望B' },
    { sampleId: 'other-1', component: 'skill', input: '无关', expected: '无关期望' },
  ]

  it('注入评估函数：全过 → ok；部分失败 → 不通过且当前版本不受影响', async () => {
    const root = tmpRoot('evaluator')
    const { apply } = applyRecorder()
    const registry = new CandidateRegistry({ dataRoot: root, apply })
    const v1 = registry.propose({ component: 'query-rewrite', description: '旧', diff: '' })
    registry.activate(v1.candidateId)
    const candidate = registry.propose({ component: 'query-rewrite', description: '新', diff: '+fix', content: 'fix: 期望A 期望B' })

    // 全过
    const pass = await evaluateCandidate(registry, candidate.candidateId, samples, {
      evaluator: async () => ({ ok: true }),
    })
    assert.equal(pass.ok, true)
    assert.equal(pass.total, 2) // 只评估同组件样本
    assert.equal(pass.failed, 0)
    assert.equal(registry.getCandidate(candidate.candidateId)?.evaluation?.ok, true)

    // 部分失败 → ok false；当前版本仍为 v1（候选隔离）
    const fail = await evaluateCandidate(registry, candidate.candidateId, samples, {
      evaluator: async (_c, sample) => ({ ok: sample.sampleId === 'fail-1' }),
    })
    assert.equal(fail.ok, false)
    assert.equal(fail.passed, 1)
    assert.equal(fail.failed, 1)
    assert.equal(registry.currentVersion('query-rewrite'), 1)
    assert.equal(registry.getCandidate(candidate.candidateId)?.status, 'proposed')
  })

  it('缺省启发式：候选内容覆盖期望才通过；阈值生效', async () => {
    const root = tmpRoot('evaluator-default')
    const registry = new CandidateRegistry({ dataRoot: root })
    const candidate = registry.propose({ component: 'query-rewrite', description: 'd', diff: '', content: '期望A' })
    const result = await evaluateCandidate(registry, candidate.candidateId, samples)
    assert.equal(result.total, 2)
    assert.equal(result.passed, 1) // 只覆盖 期望A
    assert.equal(result.ok, false)
    // 阈值 0.5 → ok
    const half = await evaluateCandidate(registry, candidate.candidateId, samples, { threshold: 0.5 })
    assert.equal(half.ok, true)
    // 无同组件样本 → ok false（不误判通过）
    const none = await evaluateCandidate(registry, 'nonexistent', samples).catch(() => null)
    assert.equal(none, null)
  })
})

/* ------------------------------------------------------------------ */
/* EVO-07/08/09：AutoSkills 改造                                        */
/* ------------------------------------------------------------------ */

describe('EVO-07 从自然语言轨迹发现重复做法（无固定类别门槛）', () => {
  it('同一习惯句出现 ≥2 次 → 候选；minOccurrences 门槛可调', () => {
    const texts = [
      '每次实验都要先保存完整日志，再启动训练。',
      '记得每次实验都要先保存完整日志。',
      '无关内容。',
    ]
    const habits = discoverHabitCandidates({ texts, minOccurrences: 2 })
    assert.equal(habits.length, 1)
    assert.equal(habits[0]?.count, 2)
    assert.ok(habits[0]?.habit.includes('保存完整日志'))
    // 门槛 3 → 无候选
    assert.equal(discoverHabitCandidates({ texts, minOccurrences: 3 }).length, 0)
  })

  it('工具失败信号按 attempts 计入出现次数', () => {
    const signals: EvolutionSignal[] = [
      { signalId: 's1', type: 'tool_repeated_failure', toolName: 'bash', attempts: 3, note: 'x', createdAt: 1 },
      { signalId: 's2', type: 'tool_repeated_failure', toolName: 'uv', attempts: 1, note: 'y', createdAt: 2 },
    ]
    const habits = discoverHabitCandidates({ toolSignals: signals, minOccurrences: 2 })
    const bash = habits.find((h) => h.habit.includes('bash'))
    assert.ok(bash)
    assert.equal(bash?.count, 3)
    assert.ok(!habits.some((h) => h.habit.includes('uv'))) // 仅 1 次不构成重复
  })

  it('generateFromTraces 生成 pending Markdown 草稿且不重复提案', () => {
    const root = tmpRoot('autoskills-traces')
    const service = new AutoSkillsService({ dataRoot: root })
    const texts = ['每次实验都要先保存完整日志。', '记得每次实验都要先保存完整日志。']
    assert.equal(service.generateFromTraces({ texts, workspaceDir: root }), 1)
    const proposals = service.listProposals('pending')
    assert.equal(proposals.length, 1)
    const proposal = proposals[0]!
    assert.ok(proposal.content.includes('保存完整日志'))
    assert.ok(proposal.content.includes('## 步骤'))
    assert.ok(proposal.content.includes('## 来源'))
    // 再次生成同轨迹 → 0（去重）
    assert.equal(service.generateFromTraces({ texts }), 0)
  })

  it('habitProposalContent 生成可编辑 Markdown（EVO-08 草稿形态）', () => {
    const habit = { habit: '先写测试再实现', count: 3, sources: ['text#0', 'text#1', 'text#2'], note: 'n' }
    const md = habitProposalContent(habit)
    assert.ok(md.includes('# 先写测试再实现'))
    assert.ok(md.includes('（由用户编辑补充'))
  })
})

describe('EVO-08 Skill 草稿 Markdown 可编辑，批准后才安装', () => {
  it('pending 草稿可编辑，approve 安装编辑后的内容', () => {
    const root = tmpRoot('autoskills-edit')
    const service = new AutoSkillsService({ dataRoot: root })
    service.generateFromTraces({ texts: ['每次都要记录超参数。', '记得每次都要记录超参数。'] })
    const proposal = service.listProposals('pending')[0]!
    const edited = '# 记录超参数\n\n每次实验都要记录超参数到 CSV。\n\n## 步骤\n\n1. 启动前写表头\n2. 每轮追加\n'
    assert.equal(service.updateProposalContent(proposal.proposalId, edited), true)
    // 空内容拒绝
    assert.equal(service.updateProposalContent(proposal.proposalId, '  '), false)
    assert.equal(service.approve(proposal.proposalId), true)
    const skillFile = path.join(root, '.evoresearch-data', 'skills', proposal.name, 'SKILL.md')
    const installed = fs.readFileSync(skillFile, 'utf8')
    assert.ok(installed.includes('每次实验都要记录超参数到 CSV'))
    assert.ok(installed.includes('name: '))
    // 已批准不可再编辑
    assert.equal(service.updateProposalContent(proposal.proposalId, 'x'), false)
  })
})

describe('EVO-09 runSkill 接入真实 DSH Skill 执行', () => {
  it('未接线 ctx（未 attach）→ 返回明确错误', async () => {
    const root = tmpRoot('autoskills-run-missing')
    const service = new AutoSkillsService({ dataRoot: root })
    const result = await service.runSkill('nope')
    assert.equal(result.ok, false)
    assert.ok(result.error?.includes('提案不存在'))
    service.generateFromTraces({ texts: ['每次都要备份。', '记得每次都要备份。'] })
    const proposal = service.listProposals('pending')[0]!
    const unapproved = await service.runSkill(proposal.proposalId)
    assert.equal(unapproved.ok, false)
    assert.ok(unapproved.error?.includes('未批准'))
    service.approve(proposal.proposalId)
    const noSkills = await service.runSkill(proposal.proposalId)
    assert.equal(noSkills.ok, false)
    assert.ok(noSkills.error?.includes('DSH skills 服务不可用'))
  })

  it('attach 后探测到 skills → 装载验证成功并记录可读结果', async () => {
    const root = tmpRoot('autoskills-run-ok')
    const service = new AutoSkillsService({ dataRoot: root })
    service.generateFromTraces({ texts: ['每次都要备份。', '记得每次都要备份。'] })
    const proposal = service.listProposals('pending')[0]!
    service.approve(proposal.proposalId)
    const fakeSkills = {
      get: async (name: string) => ({ name, path: path.join(root, 'skills', name) }),
    }
    const ctx = fakeCtxWithSkills(fakeSkills)
    const detach = service.attach(ctx as never)
    assert.equal(service.skillsAvailable(), true)
    const result = await service.runSkill(proposal.proposalId)
    assert.equal(result.ok, true)
    assert.ok(result.summary?.includes('已在 DSH SkillRegistry 装载'))
    assert.ok(result.summary?.includes(proposal.name))
    // 可读运行记录已追加
    const runs = fs.readFileSync(path.join(root, '.evoresearch-data', 'evolution', 'skill-runs.jsonl'), 'utf8')
      .split('\n').filter((l) => l.trim() !== '')
    assert.equal(runs.length, 1)
    const record = JSON.parse(runs[0]!) as { loaded: boolean; summary: string }
    assert.equal(record.loaded, true)
    assert.ok(record.summary.includes(proposal.name))
    // detach 后 skills 不可用
    detach()
    assert.equal(service.skillsAvailable(), false)
    const after = await service.runSkill(proposal.proposalId)
    assert.equal(after.ok, false)
  })

  it('skills.get 未装载 → 明确错误；list 兜底可装载', async () => {
    const root = tmpRoot('autoskills-run-unloaded')
    const service = new AutoSkillsService({ dataRoot: root })
    service.generateFromTraces({ texts: ['每次都要备份。', '记得每次都要备份。'] })
    const proposal = service.listProposals('pending')[0]!
    service.approve(proposal.proposalId)
    // get 返回 undefined，list 也找不到 → 未装载错误
    service.attach(fakeCtxWithSkills({ get: async () => undefined }) as never)
    const missing = await service.runSkill(proposal.proposalId)
    assert.equal(missing.ok, false)
    assert.ok(missing.error?.includes('未在 DSH SkillRegistry 中装载'))
    // list 兜底：registry 只有 list → 可装载
    service.attach(fakeCtxWithSkills({ list: async () => [{ name: proposal.name }] }) as never)
    const viaList = await service.runSkill(proposal.proposalId)
    assert.equal(viaList.ok, true)
  })

  it('run() 同步兼容壳：未批准 false；无 skills false 且告警；已接线触发异步', async () => {
    const root = tmpRoot('autoskills-run-shell')
    const service = new AutoSkillsService({ dataRoot: root })
    assert.equal(service.run('nope'), false)
    service.generateFromTraces({ texts: ['每次都要备份。', '记得每次都要备份。'] })
    const proposal = service.listProposals('pending')[0]!
    assert.equal(service.run(proposal.proposalId), false) // 未批准
    service.approve(proposal.proposalId)
    assert.equal(service.run(proposal.proposalId), false) // 未 attach → 明确告警 + false
    service.attach(fakeCtxWithSkills({ get: async () => ({ name: proposal.name }) }) as never)
    assert.equal(service.run(proposal.proposalId), true) // 触发异步执行
    // 等待异步留痕完成
    await new Promise((resolve) => setTimeout(resolve, 50))
    const runs = fs.readFileSync(path.join(root, '.evoresearch-data', 'evolution', 'skill-runs.jsonl'), 'utf8')
      .split('\n').filter((l) => l.trim() !== '')
    assert.equal(runs.length, 1)
  })
})
