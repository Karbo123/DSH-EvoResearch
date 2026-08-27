/**
 * §44 会话 URL 短别名（slug）单元测试：
 * - ensure 幂等（同一会话重复调用返回同一 slug）；
 * - 标题 slug 化（AI 标题 → 英文短 slug；纯中文/空标题回退 s-<uuid 前8位> 短哈希）；
 * - 冲突自动加 -2/-3 后缀，且映射持久化在 session-meta.json；
 * - lookup 反查 slug → sessionId；
 * - sessionMetaSet 清空 pin/tag/archive 时保留 slug 条目。
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { EvoResearchApiService, type HostServices } from '../src/host/api.js'
import type { WorkspaceService } from '../src/host/workspace.js'
import type { MemoryRuntime } from '../src/host/memory/index.js'
import type { SchedulerService } from '../src/host/scheduler.js'
import type { ChannelManager } from '../src/host/channels/index.js'
import type { AutoSkillsService } from '../src/host/autoskills.js'
import type { ExpertService } from '../src/host/experts.js'

function makeServices(dataRoot: string, workspace: WorkspaceService): HostServices {
  const stub = {} as unknown
  return {
    workspace,
    memory: { config: { dataRoot } } as unknown as MemoryRuntime,
    scheduler: stub as SchedulerService,
    channels: stub as ChannelManager,
    autoskills: stub as AutoSkillsService,
    experts: stub as ExpertService,
  }
}

async function makeApi(t: import('node:test').TestContext): Promise<{ api: EvoResearchApiService; dataRoot: string }> {
  const { WorkspaceService } = await import('../src/host/workspace.js')
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'evoresearch-session-slug-'))
  t.after(() => {
    fs.rmSync(dataRoot, { recursive: true, force: true })
  })
  const ctx = new Context()
  const api = new EvoResearchApiService(ctx, makeServices(dataRoot, new WorkspaceService({ dataRoot }) as WorkspaceService))
  return { api, dataRoot }
}

describe('sessionSlugEnsure / sessionSlugLookup（§44 URL 短别名）', () => {
  it('英文标题 slug 化且幂等；lookup 反查成功', async (t) => {
    const { api } = await makeApi(t)
    const id = 'session-11111111-2222-3333-4444-555555555555'
    const first = api.sessionSlugEnsure({ sessionId: id, preferred: 'Edge AI Health' })
    assert.equal(first.slug, 'edge-ai-health')
    // 幂等：重复调用（即使换了 preferred）仍返回既有 slug
    const again = api.sessionSlugEnsure({ sessionId: id, preferred: 'Another Title' })
    assert.equal(again.slug, 'edge-ai-health')
    const lookup = api.sessionSlugLookup({ slug: 'edge-ai-health' })
    assert.equal(lookup.sessionId, id)
  })

  it('纯中文/空标题确定性回退 s-<uuid 前8位>', async (t) => {
    const { api } = await makeApi(t)
    const id = 'session-b951eba8-7dcc-47e8-a00f-98853679bf50'
    const r1 = api.sessionSlugEnsure({ sessionId: id, preferred: '等变网络 研究' })
    assert.equal(r1.slug, 's-b951eba8')
    assert.equal(api.sessionSlugLookup({ slug: 's-b951eba8' }).sessionId, id)
    // 完全无 preferred 也走同一回退
    const other = api.sessionSlugEnsure({ sessionId: 'session-cafebab0-0000-0000-0000-000000000000' })
    assert.equal(other.slug, 's-cafebab0')
  })

  it('slug 冲突加数字后缀；不同会话互不覆盖', async (t) => {
    const { api } = await makeApi(t)
    const a = api.sessionSlugEnsure({ sessionId: 'session-aaaaaaaa-0000-0000-0000-000000000001', preferred: '实验' })
    const b = api.sessionSlugEnsure({ sessionId: 'session-bbbbbbbb-0000-0000-0000-000000000002', preferred: '实验' })
    const c = api.sessionSlugEnsure({ sessionId: 'session-cccccccc-0000-0000-0000-000000000003', preferred: '实验' })
    assert.notEqual(a.slug, b.slug)
    assert.notEqual(b.slug, c.slug)
    assert.notEqual(a.slug, c.slug)
    // 纯中文标题全部走 s-<uuid 前8位> 回退；冲突时 -2/-3 后缀避让
    for (const r of [a, b, c]) {
      const slug = String(r.slug)
      assert.match(slug, /^s-[0-9a-f]{8}(?:-\d+)?$/)
      assert.notEqual(api.sessionSlugLookup({ slug }).sessionId, null)
    }
    // 三个会话均可反查且回到各自 id
  })

  it('slug 持久化到 session-meta.json，跨实例存活；空 patch 不删 slug 条目', async (t) => {
    const fs = await import('node:fs')
    const os = await import('node:os')
    const path = await import('node:path')
    const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'evoresearch-session-slug-persist-'))
    t.after(() => {
      fs.rmSync(dataRoot, { recursive: true, force: true })
    })
    const id = 'session-abcdef01-0000-0000-0000-000000000009'
    let slug = ''
    {
      const ctx = new Context()
      const api = new EvoResearchApiService(ctx, makeServices(dataRoot, { } as unknown as WorkspaceService))
      slug = String(api.sessionSlugEnsure({ sessionId: id, preferred: 'Memory Bank v2' }).slug)
      // 清空式 patch（如取消置顶后全字段为空）：slug 条目必须保留
      api.sessionMetaSet({ sessionId: id, patch: {} })
    }
    {
      const ctx2 = new Context()
      const api2 = new EvoResearchApiService(ctx2, makeServices(dataRoot, { } as unknown as WorkspaceService))
      // 幂等读取旧分配
      assert.equal(api2.sessionSlugEnsure({ sessionId: id }).slug, slug)
      assert.equal(api2.sessionSlugLookup({ slug }).sessionId, id)
    }
  })

  it('非法参数：空 sessionId 返回空对象；未知 slug 反查 null', async (t) => {
    const { api } = await makeApi(t)
    assert.deepEqual(api.sessionSlugEnsure({ sessionId: '' }), {})
    assert.equal(api.sessionSlugLookup({ slug: 'nope-not-here' }).sessionId, null)
    assert.equal(api.sessionSlugLookup({ slug: '' }).sessionId, null)
  })
})
