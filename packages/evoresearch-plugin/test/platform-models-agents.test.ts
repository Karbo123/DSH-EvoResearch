/**
 * 平台模型/子代理/调度/通道（PLAT-13..20）单元测试。
 *
 * 覆盖：多模型 Fallback selector、per-turn 工具选择（基础白名单）、统一审批
 * 策略、子代理谱系记录与 provider 抽象、自然语言 cron 与调度增强、会话诊断
 * 导出。纯函数级 + 假服务注入 + 临时目录（BASE-02 清理）。
 */
import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  selectModel,
  recordFailure,
  recordSuccess,
  emptyFallbackState,
  routeKey,
} from '../src/host/platform/models-selector.js'
import { selectToolsForTurn, BASE_TOOL_WHITELIST } from '../src/host/platform/tools-selector.js'
import { isAcademicSearchQuery } from '../src/host/web-search.js'
import { decideApproval, defaultApprovalPolicy, validateApprovalPolicy } from '../src/host/platform/approval-policy.js'
import { SubagentRegistry, SubagentProviderRegistry, SubagentFacade } from '../src/host/platform/subagents.js'
import type { SubagentProvider } from '../src/host/platform/subagents.js'
import { exportSessionDiagnostics } from '../src/host/platform/diagnostics.js'
import { parseNaturalCron, SchedulerService } from '../src/host/scheduler.js'
import { parseCron } from '../src/host/core/cron.js'

/** 临时数据根（BASE-02：测试结束统一清理）。 */
const tmpRoots: string[] = []
function tmpRoot(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `evoresearch-pma-${prefix}-`))
  tmpRoots.push(dir)
  return dir
}
after(() => {
  for (const dir of tmpRoots) fs.rmSync(dir, { recursive: true, force: true })
})

/* ------------------------------------------------------------------ */
/* PLAT-13：多模型 Fallback selector                                   */
/* ------------------------------------------------------------------ */

describe('PLAT-13 多模型 Fallback/有限重试/切换', () => {
  const routes = {
    primary: { provider: 'p1', model: 'm1' },
    fallbacks: [
      { provider: 'p2', model: 'm2' },
      { provider: 'p3', model: 'm3' },
    ],
  }

  it('selectModel：无失败 → primary；失败计数达到上限 → 切换 fallback', () => {
    let state = emptyFallbackState()
    assert.deepEqual(selectModel(routes, state), routes.primary)
    // 1 次失败（< 2）仍用 primary
    state = recordFailure(state, routes.primary)
    assert.deepEqual(selectModel(routes, state), routes.primary)
    // 2 次失败（= 上限）→ 切换 p2
    state = recordFailure(state, routes.primary)
    assert.deepEqual(selectModel(routes, state), routes.fallbacks[0])
    // p2 也失败 → p3
    state = recordFailure(state, routes.fallbacks[0]!)
    state = recordFailure(state, routes.fallbacks[0]!)
    assert.deepEqual(selectModel(routes, state), routes.fallbacks[1])
    // 全部超限 → 最后手段（fallbacks 末尾）
    state = recordFailure(state, routes.fallbacks[1]!)
    state = recordFailure(state, routes.fallbacks[1]!)
    assert.deepEqual(selectModel(routes, state), routes.fallbacks[1])
  })

  it('recordSuccess 清零失败计数并记录当前路由；无 fallback 且超限 → null', () => {
    let state = emptyFallbackState()
    state = recordFailure(state, routes.primary)
    state = recordFailure(state, routes.primary)
    const switched = recordSuccess(state, routes.fallbacks[0]!, 1000)
    assert.equal(switched.current, routeKey(routes.fallbacks[0]!))
    assert.equal(switched.switchedAt, 1000)
    // primary 失败计数仍在（2）→ 继续用 p2
    assert.deepEqual(selectModel(routes, switched), routes.fallbacks[0])
    // primary 成功后清零 → 回到 primary
    const recovered = recordSuccess(switched, routes.primary, 2000)
    assert.deepEqual(selectModel(routes, recovered), routes.primary)
    // 无 fallback：primary 超限 → null（明确无可用）
    const solo = { primary: routes.primary }
    let soloState = emptyFallbackState()
    soloState = recordFailure(soloState, routes.primary)
    soloState = recordFailure(soloState, routes.primary)
    assert.equal(selectModel(solo, soloState), null)
  })
})

/* ------------------------------------------------------------------ */
/* PLAT-14：per-turn 自适应工具选择                                     */
/* ------------------------------------------------------------------ */

describe('PLAT-14 per-turn 工具选择', () => {
  const available = [
    { name: 'search_research_history', description: '搜索历史' },
    { name: 'read_memory', description: '读取记忆' },
    { name: 'bash', description: '运行 shell 命令' },
    { name: 'fs.read', description: '读文件' },
    { name: 'web_search', description: '联网搜索' },
    { name: 'create_observation', description: '创建观测' },
    { name: 'library_search', description: '文献搜索' },
    { name: 'vision_check', description: '视觉检查' },
  ]

  it('基础白名单恒保留（与查询无关）；相关工具按分数排序', () => {
    const selected = selectToolsForTurn(available, '文献')
    const names = selected.map((t) => t.name)
    // 白名单工具（search_research_history/read_memory/create_observation）恒在
    for (const base of BASE_TOOL_WHITELIST) {
      if (available.some((t) => t.name === base)) {
        assert.ok(names.includes(base), `基础工具 ${base} 被剪掉`)
      }
    }
    // 相关工具：library_search（描述含"文献"）
    assert.ok(names.includes('library_search'))
    // 无关工具（bash/fs.read 与"文献"无关）不出现
    assert.ok(!names.includes('bash'))
    assert.ok(!names.includes('fs.read'))
  })

  it('required 扩展 + maxTools 上限；空查询只保留白名单', () => {
    const selected = selectToolsForTurn(available, '', { required: ['vision_check'] })
    const names = selected.map((t) => t.name)
    assert.ok(names.includes('vision_check'))
    assert.equal(selected.length, 4) // 3 白名单 + vision_check
    // maxTools 限制相关工具数
    const many = selectToolsForTurn(available, '搜索', { maxTools: 4 })
    assert.ok(many.length <= 4)
    assert.ok(many.map((t) => t.name).includes('search_research_history')) // 白名单优先
  })

  it('中文学术自然问句会强制保留文献发现链', () => {
    const academicTools = [
      { name: 'search_literature', description: '题录级检索' },
      { name: 'search_related_literature', description: '引用关系' },
      { name: 'recommend_literature', description: '语义推荐' },
      { name: 'search_paper_snippets', description: '正文片段' },
      { name: 'bash', description: '运行 shell 命令' },
    ]
    const question = '帮我找一下关于神经算子的论文'
    assert.equal(isAcademicSearchQuery(question), true)
    const selected = selectToolsForTurn(academicTools, question, {
      required: academicTools.slice(0, 4).map((tool) => tool.name),
    })
    const names = selected.map((tool) => tool.name)
    assert.deepEqual(names.slice(0, 4), academicTools.slice(0, 4).map((tool) => tool.name))
    assert.ok(!names.includes('bash'))
  })
})

/* ------------------------------------------------------------------ */
/* PLAT-15：统一审批策略                                                */
/* ------------------------------------------------------------------ */

describe('PLAT-15 审批与危险操作策略', () => {
  it('非危险工具 → allow；危险工具默认 ask', () => {
    const policy = defaultApprovalPolicy()
    assert.equal(decideApproval(policy, 'fs.read').decision, 'allow')
    assert.equal(decideApproval(policy, 'fs.read').dangerous, false)
    const ask = decideApproval(policy, 'bash')
    assert.equal(ask.decision, 'ask')
    assert.equal(ask.dangerous, true)
    assert.ok(ask.reason.includes('审批'))
  })

  it('overrides 单工具覆盖：deny/allow；策略校验', () => {
    const policy = { mode: 'ask', overrides: { bash: 'deny', 'fs.write': 'allow' } }
    assert.equal(decideApproval(policy, 'bash').decision, 'deny')
    assert.equal(decideApproval(policy, 'fs.write').decision, 'allow')
    assert.equal(decideApproval(policy, 'git.push').decision, 'ask') // 未覆盖走默认
    // 全局 allow 模式
    assert.equal(decideApproval({ mode: 'allow' }, 'bash').decision, 'allow')
    // 校验
    assert.equal(validateApprovalPolicy({ mode: 'ask' }).ok, true)
    assert.equal(validateApprovalPolicy({ mode: 'nope' as never }).ok, false)
    assert.equal(validateApprovalPolicy({ mode: 'ask', overrides: { bash: 'x' as never } }).ok, false)
  })
})

/* ------------------------------------------------------------------ */
/* PLAT-16/19：子代理谱系记录与可插拔 provider                          */
/* ------------------------------------------------------------------ */

describe('PLAT-16/19 子代理谱系与 provider 抽象', () => {
  it('SubagentRegistry：record/update/get/list/descendants + JSONL 落盘', () => {
    const root = tmpRoot('subagents')
    const registry = new SubagentRegistry(root)
    const parent = registry.record({ parentSessionId: 'session-root', mode: 'async', provider: 'dsh', prompt: '做实验' })
    const child = registry.record({ parentSessionId: parent.subagentId, mode: 'sync', provider: 'dsh', prompt: '分析结果' })
    registry.update(parent.subagentId, { status: 'running', startedAt: 100 })
    registry.update(parent.subagentId, { status: 'done', report: '完成', endedAt: 200 })
    assert.equal(registry.get(parent.subagentId)?.status, 'done')
    assert.equal(registry.get(parent.subagentId)?.report, '完成')
    // 谱系：root 的 descendants 含 parent 与 child
    const descendants = registry.descendants('session-root')
    assert.deepEqual(descendants.map((r) => r.subagentId).sort(), [parent.subagentId, child.subagentId].sort())
    // JSONL 落盘
    const lines = fs.readFileSync(registry.fileOf(), 'utf8').split('\n').filter((l) => l.trim() !== '')
    assert.equal(lines.length, 4) // 2 record + 2 update
    // 重载后仍可读（取最新）
    const reloaded = new SubagentRegistry(root)
    assert.equal(reloaded.get(parent.subagentId)?.status, 'done')
  })

  it('SubagentProviderRegistry：注册/获取/列表/disposeAll；重复注册抛错', () => {
    const registry = new SubagentProviderRegistry()
    const provider: SubagentProvider = {
      name: 'in-process',
      create: async () => ({ ok: true, sessionId: 's-1' }),
    }
    const dispose = registry.register(provider)
    assert.equal(registry.get('in-process'), provider)
    assert.deepEqual(registry.list(), ['in-process'])
    assert.throws(() => registry.register(provider))
    dispose()
    assert.equal(registry.get('in-process'), undefined)
    registry.register(provider)
    registry.disposeAll()
    assert.deepEqual(registry.list(), [])
  })

  it('SubagentFacade：create/continue/interrupt/report 串谱系记录；无 provider 明确错误', async () => {
    const root = tmpRoot('facade')
    const registry = new SubagentRegistry(root)
    const providers = new SubagentProviderRegistry()
    const calls: string[] = []
    providers.register({
      name: 'fake',
      create: async (request) => {
        calls.push(`create:${request.prompt}`)
        return { ok: true, sessionId: 'sub-session' }
      },
      continue: async (id, message) => {
        calls.push(`continue:${id}:${message}`)
        return { ok: true, resumePoint: 'step-2' }
      },
      interrupt: async (id) => {
        calls.push(`interrupt:${id}`)
        return { ok: true }
      },
      report: async (id) => {
        calls.push(`report:${id}`)
        return { ok: true, report: '结果：收敛' }
      },
    })
    const facade = new SubagentFacade(registry, providers)
    // 无 provider → 明确错误
    const noProvider = await facade.create({ parentSessionId: 'p', prompt: 'x', mode: 'sync', provider: 'none' })
    assert.equal(noProvider.ok, false)
    assert.ok(noProvider.error?.includes('provider 不存在'))
    // create
    const created = await facade.create({ parentSessionId: 'session-p', prompt: '跑基线', mode: 'continuable', provider: 'fake' })
    assert.equal(created.ok, true)
    const id = created.record!.subagentId
    assert.equal(registry.get(id)?.status, 'running')
    assert.equal(registry.get(id)?.sessionId, 'sub-session')
    // continue
    await facade.continue(id, '继续')
    assert.equal(registry.get(id)?.resumePoint, 'step-2')
    // interrupt（continuable → interrupted）
    await facade.interrupt(id)
    assert.equal(registry.get(id)?.status, 'interrupted')
    // report（→ done + 回报）
    await facade.report(id)
    assert.equal(registry.get(id)?.status, 'done')
    assert.equal(registry.get(id)?.report, '结果：收敛')
    assert.deepEqual(calls.length, 4)
  })

  it('provider 不支持 continue/report → 明确错误且不改状态', async () => {
    const root = tmpRoot('facade-min')
    const registry = new SubagentRegistry(root)
    const providers = new SubagentProviderRegistry()
    providers.register({ name: 'min', create: async () => ({ ok: true }) })
    const facade = new SubagentFacade(registry, providers)
    const created = await facade.create({ parentSessionId: 'p', prompt: 'x', mode: 'sync', provider: 'min' })
    const id = created.record!.subagentId
    const cont = await facade.continue(id, '继续')
    assert.equal(cont.ok, false)
    assert.ok(cont.error?.includes('不支持 continue'))
    const rep = await facade.report(id)
    assert.equal(rep.ok, false)
    assert.ok(rep.error?.includes('不支持 report'))
  })
})

/* ------------------------------------------------------------------ */
/* PLAT-17：自然语言调度                                                */
/* ------------------------------------------------------------------ */

describe('PLAT-17 自然语言 cron 与调度增强', () => {
  it('parseNaturalCron：常见自然语言 → 5 字段 cron（与 cron 解析器兼容）', () => {
    assert.equal(parseNaturalCron('每天早上9点'), '0 9 * * *')
    assert.equal(parseNaturalCron('每早九点'), '0 9 * * *')
    assert.equal(parseNaturalCron('每天晚上8点'), '0 20 * * *')
    assert.equal(parseNaturalCron('每天中午12点'), '0 12 * * *')
    assert.equal(parseNaturalCron('每周一上午10点'), '0 10 * * 1')
    assert.equal(parseNaturalCron('每周日晚上9点'), '0 21 * * 0')
    assert.equal(parseNaturalCron('每小时'), '0 * * * *')
    assert.equal(parseNaturalCron('每月1号零点'), '0 0 1 * *')
    // 解析结果必须能被现有 cron 解析器接受
    for (const text of ['每天早上9点', '每周一上午10点', '每小时', '每月1号零点']) {
      const cron = parseNaturalCron(text)!
      assert.doesNotThrow(() => parseCron(cron), `cron 非法: ${cron}`)
    }
    // 解析失败 → null
    assert.equal(parseNaturalCron('随便说说'), null)
    assert.equal(parseNaturalCron(''), null)
  })

  it('SchedulerService.addNatural / pause / resume / reportOf', () => {
    const root = tmpRoot('scheduler')
    const service = new SchedulerService({ dataRoot: root })
    const task = service.addNatural({ text: '每早九点', prompt: '检查实验状态', workspaceDir: root })
    assert.equal(task.cron, '0 9 * * *')
    assert.equal(task.enabled, true)
    // pause/resume
    assert.equal(service.pause(task.taskId), true)
    assert.equal(service.list().find((t) => t.taskId === task.taskId)?.enabled, false)
    assert.equal(service.resume(task.taskId), true)
    assert.equal(service.list().find((t) => t.taskId === task.taskId)?.enabled, true)
    // reportOf（未运行 → 无 threadId，但 nextRunAt 可算）
    const report = service.reportOf(task.taskId)
    assert.equal(report.threadId, undefined)
    assert.equal(typeof report.nextRunAt, 'number')
    // 解析失败抛错
    assert.throws(() => service.addNatural({ text: '无法解析', prompt: 'x', workspaceDir: root }))
  })
})

/* ------------------------------------------------------------------ */
/* PLAT-20：会话诊断导出                                               */
/* ------------------------------------------------------------------ */

describe('PLAT-20 会话诊断导出', () => {
  it('exportSessionDiagnostics：消息/工具/结果/中断/压缩齐全，不改原会话', () => {
    const events = [
      { seq: 0, type: 'turn/start', time: 1 },
      { seq: 1, type: 'user/message', time: 2, data: { text: '运行实验' } },
      { seq: 2, type: 'assistant/tool-call', time: 3, data: { toolName: 'bash', arguments: '{"cmd":"train"}' } },
      { seq: 3, type: 'assistant/tool-result', time: 4, data: { toolName: 'bash', arguments: '{"cmd":"train"}', isError: false } },
      { seq: 4, type: 'assistant/message', time: 5, data: { text: '完成' } },
      { seq: 5, type: 'turn/end', time: 6, data: { interrupted: true, reason: 'user_stop' } },
    ]
    const before = JSON.stringify(events)
    const compactions = [{ compactionId: 'c1', trigger: 'auto', status: 'completed', startedAt: 1, summaryText: '摘要' }]
    const diagnostics = exportSessionDiagnostics('s1', events, compactions, 1234)
    assert.equal(diagnostics.exportedAt, 1234)
    assert.equal(diagnostics.messages.length, 2)
    assert.equal(diagnostics.messages[0]?.role, 'user')
    assert.equal(diagnostics.messages[1]?.text, '完成')
    assert.equal(diagnostics.toolCalls.length, 2)
    assert.equal(diagnostics.toolCalls[0]?.hasResult, false)
    assert.equal(diagnostics.toolCalls[1]?.hasResult, true)
    assert.equal(diagnostics.interruptions.length, 1)
    assert.equal(diagnostics.interruptions[0]?.reason, 'user_stop')
    assert.equal(diagnostics.compactions[0]?.summaryText, '摘要')
    assert.equal(diagnostics.rawEventCount, 6)
    // 导出不修改原会话（事件数组原样）
    assert.equal(JSON.stringify(events), before)
  })

})
