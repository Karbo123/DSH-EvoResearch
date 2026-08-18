/**
 * 自动命名/自动建项目回归测试：
 * - 问候与「询问助手能做什么」不触发命名（也不应调用模型凭空取名）；
 * - 只有包含具体研究主题的输入才允许模型生成标题；
 * - 空/低信息描述建项目目录时走确定性回退，不产生无关英文目录名。
 */
import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { WorkspaceService } from '../src/host/workspace.js'
import { EvoResearchApiService, type HostServices } from '../src/host/api.js'
import type { MemoryRuntime } from '../src/host/memory/index.js'
import type { SchedulerService } from '../src/host/scheduler.js'
import type { ChannelManager } from '../src/host/channels/index.js'
import type { AutoSkillsService } from '../src/host/autoskills.js'
import type { ExpertService } from '../src/host/experts.js'
import { isLowInformationInput } from '../src/host/core/title.js'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'evoresearch-title-'))
after(() => {
  fs.rmSync(TMP, { recursive: true, force: true })
})

function fakeStream(text: string, markCalled: () => void) {
  return {
    stream: async function* () {
      markCalled()
      yield { type: 'text', text }
    },
  }
}

function apiService(ctx: Context, workspace: WorkspaceService): EvoResearchApiService {
  const stub = {} as unknown
  const services = {
    workspace,
    memory: { config: {} } as MemoryRuntime,
    scheduler: stub as SchedulerService,
    channels: stub as ChannelManager,
    autoskills: stub as AutoSkillsService,
    experts: stub as ExpertService,
  } as unknown as HostServices
  return new EvoResearchApiService(ctx, services)
}

describe('低信息输入判定', () => {
  it('问候与助手能力询问都是低信息', () => {
    for (const text of ['你好', '您好！', 'hello', '好的', '谢谢', '你可以干嘛？', '你能做什么', '你有什么功能', '介绍一下你自己', '你是谁', 'what can you do']) {
      assert.equal(isLowInformationInput(text), true, text)
    }
  })

  it('包含具体研究主题的输入不是低信息', () => {
    for (const text of ['调研边缘AI健康', '帮我搜索最新论文', '跑一个 RAG 实验']) {
      assert.equal(isLowInformationInput(text), false, text)
    }
  })
})

describe('projectTitleSuggest 自动命名', () => {
  it('首条问候不命名且不调用模型', async () => {
    const ctx = new Context()
    let called = false
    ctx.provide('llm', fakeStream('{"title":"科研项目咨询助手"}', () => { called = true }))
    const service = apiService(ctx, new WorkspaceService({ dataRoot: path.join(TMP, 'greet') }))
    const result = await service.projectTitleSuggest({ inputs: ['你好'], kind: 'project', attempt: 1 })
    assert.deepEqual(result, { title: null, final: false })
    assert.equal(called, false)
  })

  it('询问助手能力与问候组合不命名', async () => {
    const ctx = new Context()
    let called = false
    ctx.provide('llm', fakeStream('{"title":"科研项目咨询助手"}', () => { called = true }))
    const service = apiService(ctx, new WorkspaceService({ dataRoot: path.join(TMP, 'meta') }))
    const result = await service.projectTitleSuggest({ inputs: ['你好', '你可以干嘛？'], kind: 'project', attempt: 2 })
    assert.deepEqual(result, { title: null, final: false })
    assert.equal(called, false)
  })

  it('有意义输入才调用模型得到标题', async () => {
    const ctx = new Context()
    ctx.provide('llm', fakeStream('{"title":"边缘AI健康调研"}', () => {}))
    const service = apiService(ctx, new WorkspaceService({ dataRoot: path.join(TMP, 'meaningful') }))
    const result = await service.projectTitleSuggest({ inputs: ['调研边缘AI健康可穿戴设备'], kind: 'project', attempt: 1 })
    assert.deepEqual(result, { title: '边缘AI健康调研', final: true })
  })

  it('第 10 次全部低信息时给通用占位名', async () => {
    const ctx = new Context()
    const service = apiService(ctx, new WorkspaceService({ dataRoot: path.join(TMP, 'fallback') }))
    const result = await service.projectTitleSuggest({ inputs: ['你好', '你可以干嘛？'], kind: 'project', attempt: 10 })
    assert.deepEqual(result, { title: '未命名科研项目', final: true })
  })
})

describe('autoCreateProject 目录名生成', () => {
  it('低信息描述不调用模型，确定性回退 project', async () => {
    const ctx = new Context()
    let called = false
    ctx.provide('llm', fakeStream('{"slug":"edge-ai-health"}', () => { called = true }))
    const workspace = new WorkspaceService({ dataRoot: path.join(TMP, 'auto-low') })
    const project = await workspace.autoCreateProject(ctx, { provider: 'new-api', model: 'deepseek-v4-flash' }, '你好')
    assert.equal(project.name, 'project')
    assert.equal(called, false)
  })

  it('空描述同样回退 project', async () => {
    const ctx = new Context()
    let called = false
    ctx.provide('llm', fakeStream('{"slug":"edge-ai-health"}', () => { called = true }))
    const workspace = new WorkspaceService({ dataRoot: path.join(TMP, 'auto-empty') })
    const project = await workspace.autoCreateProject(ctx, { provider: 'new-api', model: 'deepseek-v4-flash' }, '')
    assert.equal(project.name, 'project')
    assert.equal(called, false)
  })

  it('有意义描述使用模型生成的 slug', async () => {
    const ctx = new Context()
    ctx.provide('llm', fakeStream('{"slug":"edge-ai-health"}', () => {}))
    const workspace = new WorkspaceService({ dataRoot: path.join(TMP, 'auto-ai') })
    const project = await workspace.autoCreateProject(ctx, { provider: 'new-api', model: 'deepseek-v4-flash' }, '调研边缘AI健康可穿戴设备')
    assert.equal(project.name, 'edge-ai-health')
  })

  it('名称碰撞自动追加数字后缀', async () => {
    const ctx = new Context()
    ctx.provide('llm', fakeStream('{"slug":"edge-ai-health"}', () => {}))
    const workspace = new WorkspaceService({ dataRoot: path.join(TMP, 'auto-collision') })
    workspace.createProject('edge-ai-health')
    const project = await workspace.autoCreateProject(ctx, { provider: 'new-api', model: 'deepseek-v4-flash' }, '调研边缘AI健康')
    assert.equal(project.name, 'edge-ai-health-2')
  })
})
