/**
 * EvoResearchApiService 单元测试：验证 Typert Remote 服务在最小 cordis 上下文中
 * 可构造（服务 + gateway 绑定注册无冲突），且 @Remote 装饰器标记的方法
 * 能被 remoteMethods 发现（wire 可调用 —— 这是浏览器端 ctx.remote.evoresearch.*
 * 能工作的前提，弥补无法在无浏览器环境下做 HTTP 端到端验证的缺口）。
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import { EvoResearchApiService, type HostServices } from '../src/host/api.js'
import type { WorkspaceService } from '../src/host/workspace.js'
import type { MemoryRuntime } from '../src/host/memory/index.js'
import type { SchedulerService } from '../src/host/scheduler.js'
import type { ChannelManager } from '../src/host/channels/index.js'
import type { AutoSkillsService } from '../src/host/autoskills.js'
import type { ExpertService } from '../src/host/experts.js'

/** 构造最小 fake 服务集合（构造 ApiService 时仅存储引用，不调用方法）。 */
function fakeServices(): HostServices {
  const stub = {} as unknown
  return {
    workspace: stub as WorkspaceService,
    memory: stub as MemoryRuntime,
    scheduler: stub as SchedulerService,
    channels: stub as ChannelManager,
    autoskills: stub as AutoSkillsService,
    experts: stub as ExpertService,
  }
}

describe('EvoResearchApiService', () => {
  it('可在最小 cordis 上下文构造（服务 + gateway 绑定注册）', () => {
    const ctx = new Context()
    const service = new EvoResearchApiService(ctx, fakeServices())
    assert.ok(service)
    // TypertRemoteService 绑定：typertRemote 元数据可读
    const binding = (service as unknown as { typertRemote?: { serviceKey?: string; namespace?: string } }).typertRemote
    assert.equal(binding?.serviceKey, 'evoresearch')
    assert.equal(binding?.namespace, 'evoresearch')
  })

  it('@Remote 标记的方法可被 remoteMethods 发现（Client wire 可调用）', () => {
    const ctx = new Context()
    const service = new EvoResearchApiService(ctx, fakeServices())
    const methods = remoteMethods(service)
    const names = methods.map((m) => m.exportName ?? m.method)
    // 核心方法必须在 wire 上可见
    for (const expected of ['projectsList', 'memoryCatalog', 'memoryStates', 'memoryTurns', 'memoryGoals', 'schedulerList', 'schedulerAdd', 'channelsStatus', 'autoskillsList', 'expertsList', 'threadsSearch']) {
      assert.ok(names.includes(expected), `缺少 Remote 方法 ${expected}（实际: ${names.join(', ')}）`)
    }
  })

  it('Remote 方法调用返回 JSON 结果（projectsList 空列表）', async (t) => {
    const ctx = new Context()
    // 用真实 WorkspaceService（临时目录，无项目）验证 Remote 方法的实际行为
    const { WorkspaceService } = await import('../src/host/workspace.js')
    const fs = await import('node:fs')
    const os = await import('node:os')
    const path = await import('node:path')
    const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'evoresearch-api-'))
    // 测试卫生（BASE-02）：用例结束（含失败路径）清理临时目录
    t.after(() => {
      fs.rmSync(dataRoot, { recursive: true, force: true })
    })
    const workspace = new WorkspaceService({ dataRoot })
    const service = new EvoResearchApiService(ctx, {
      workspace,
      memory: {} as MemoryRuntime,
      scheduler: {} as SchedulerService,
      channels: {} as ChannelManager,
      autoskills: {} as AutoSkillsService,
      experts: {} as ExpertService,
    })
    const result = service.projectsList()
    assert.ok(Array.isArray(result))
    assert.equal(result.length, 0)
    // 创建项目后应能列出
    service.projectCreate({ name: 'demo' })
    const after = service.projectsList() as Array<{ name: string }>
    assert.equal(after.length, 1)
    assert.equal(after[0]?.name, 'demo')
  })
})
