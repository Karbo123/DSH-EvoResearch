/**
 * 平台 Skill 分层注册表与 MCP supervisor（PLAT-08..12 + PLAT-21 剩余）测试。
 *
 * 覆盖：五层注册/优先级覆盖/按需读取/变更监听/卸载回退、本地与 Git 安装
 * （来源记录）、AGENTS.md 适用范围、DSH provider 对接；MCP 生命周期
 * （启动/停止/重连/释放/热更新）、通配符过滤与按 Agent 暴露、失败局部降级；
 * PLAT-21：Skill 安装/更新/卸载不污染项目资料、MCP 断线重连/无法重连局部
 * 降级、插件卸载无副作用（假服务注入 + 临时目录，BASE-02 清理）。
 */
import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { LayeredSkillRegistry, SKILL_LAYER_PRIORITY } from '../src/host/skills/registry.js'
import type { GitRunner } from '../src/host/skills/registry.js'
import {
  McpSupervisor,
  matchWildcard,
  matchesToolFilter,
  filterTools,
  reconnectBackoffMs,
} from '../src/host/mcp/supervisor.js'
import type { McpClientFactory, McpServerConfig, McpToolInfo } from '../src/host/mcp/supervisor.js'

/** 临时数据根（BASE-02：测试结束统一清理）。 */
const tmpRoots: string[] = []
function tmpRoot(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `evoresearch-sm-${prefix}-`))
  tmpRoots.push(dir)
  return dir
}
after(() => {
  for (const dir of tmpRoots) fs.rmSync(dir, { recursive: true, force: true })
})

/** 假 git runner：clone 时创建技能目录；rev-parse 返回固定 commit。 */
function fakeGit(): GitRunner {
  return async (args, _cwd) => {
    if (args[0] === 'clone') {
      const target = args[args.length - 1]!
      fs.mkdirSync(target, { recursive: true })
      fs.writeFileSync(path.join(target, 'SKILL.md'), '---\nname: fake-git-skill\ndescription: 来自 Git\n---\n\n# 正文\n')
      return { code: 0, stdout: '' }
    }
    if (args[0] === '-C' && args[2] === 'rev-parse') {
      return { code: 0, stdout: 'abc123def456\n' }
    }
    return { code: 1, stdout: '', stderr: 'unknown git command' }
  }
}

/** 等待 mtime 轮询（fs.watchFile interval 200ms）。 */
function settle(ms = 400): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/* ------------------------------------------------------------------ */
/* PLAT-08：五层注册表                                                   */
/* ------------------------------------------------------------------ */

describe('PLAT-08 分层 Skill 注册表', () => {
  it('五层优先级：custom > project > workspace > global > builtin；高层覆盖低层', () => {
    assert.deepEqual([...SKILL_LAYER_PRIORITY], ['custom', 'project', 'workspace', 'global', 'builtin'])
    const root = tmpRoot('layers')
    const registry = new LayeredSkillRegistry({ dataRoot: root })
    registry.register('builtin', { name: 'demo', description: '内置版', body: '# 内置\n' })
    registry.register('global', { name: 'demo', description: '全局版', body: '# 全局\n' })
    registry.register('custom', { name: 'demo', description: '自定义版', body: '# 自定义\n' })
    // resolve 取 custom（最高优先级）
    const resolved = registry.resolve('demo')
    assert.equal(resolved?.layer, 'custom')
    assert.equal(resolved?.description, '自定义版')
    // 精确层读取
    assert.equal(registry.get('demo', 'global')?.description, '全局版')
    assert.equal(registry.readBody('demo', 'global')?.includes('全局'), true)
    // list 返回全部层
    const all = registry.list()
    assert.equal(all.filter((e) => e.name === 'demo').length, 3)
    assert.equal(registry.list('builtin').length, 1)
  })

  it('按需读取 body；scope 来自 frontmatter 或 AGENTS.md（PLAT-10）', () => {
    const root = tmpRoot('scope')
    const registry = new LayeredSkillRegistry({ dataRoot: root })
    registry.register('global', { name: 'fm-skill', description: 'd', body: '# 正文\n', scope: '用于文献精读' })
    assert.equal(registry.readScope('fm-skill'), '用于文献精读')
    // AGENTS.md 兜底
    const dir = path.join(root, 'skills', 'agents-skill')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'SKILL.md'), '# 无 frontmatter\n', 'utf8')
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), '## 适用范围\n适用于实验日志整理。\n', 'utf8')
    assert.equal(registry.readScope('agents-skill'), '适用于实验日志整理。')
  })

  it('变更监听（mtime → 回调；返回 disposer；卸载后无残留）', async () => {
    const root = tmpRoot('watch')
    const registry = new LayeredSkillRegistry({ dataRoot: root })
    registry.register('global', { name: 'watched', body: '# v1\n' })
    let hits = 0
    const dispose = registry.watch('watched', () => { hits += 1 })
    const bodyPath = path.join(root, 'skills', 'watched', 'SKILL.md')
    fs.writeFileSync(bodyPath, '# v2\n', 'utf8')
    await settle()
    assert.ok(hits >= 1, `变更监听未触发（hits=${hits}）`)
    dispose()
    const before = hits
    fs.writeFileSync(bodyPath, '# v3\n', 'utf8')
    await settle()
    assert.equal(hits, before) // disposer 后不再回调
  })

  it('卸载 + 安全回退：高层卸载后 resolve 回退到低层同名技能', () => {
    const root = tmpRoot('fallback')
    const registry = new LayeredSkillRegistry({ dataRoot: root })
    registry.register('builtin', { name: 'retro', body: '# 内置\n' })
    registry.register('global', { name: 'retro', body: '# 全局\n' })
    assert.equal(registry.resolve('retro')?.layer, 'global')
    const result = registry.uninstall('retro', 'global')
    assert.equal(result.ok, true)
    assert.equal(result.fallback?.layer, 'builtin') // 安全回退
    assert.equal(registry.resolve('retro')?.layer, 'builtin')
    // 卸载不存在的 → ok false
    assert.equal(registry.uninstall('retro', 'custom').ok, false)
  })
})

/* ------------------------------------------------------------------ */
/* PLAT-09：本地路径与 Git 安装                                          */
/* ------------------------------------------------------------------ */

describe('PLAT-09 本地与 Git 安装（来源记录）', () => {
  it('installFromLocal：复制 + source.json（kind/localPath/version/files）+ 卸载', () => {
    const root = tmpRoot('local-install')
    const sourceDir = path.join(root, 'vendor', 'my-skill')
    fs.mkdirSync(path.join(sourceDir, 'scripts'), { recursive: true })
    fs.mkdirSync(path.join(sourceDir, '.git'), { recursive: true })
    fs.writeFileSync(path.join(sourceDir, 'SKILL.md'), '# my-skill\n\n本地技能\n', 'utf8')
    fs.writeFileSync(path.join(sourceDir, 'scripts', 'run.py'), 'print(1)', 'utf8')
    fs.writeFileSync(path.join(sourceDir, '.git', 'config'), 'ignored', 'utf8') // 应跳过
    const registry = new LayeredSkillRegistry({ dataRoot: root })
    const entry = registry.installFromLocal('global', sourceDir)
    assert.equal(entry.name, 'my-skill')
    assert.equal(entry.source?.kind, 'local')
    assert.equal(entry.source?.localPath, sourceDir)
    assert.equal(entry.source?.version, 'local')
    // .git 被跳过；文件清单含 SKILL.md 与 scripts/run.py
    assert.ok(!fs.existsSync(path.join(root, 'skills', 'my-skill', '.git')))
    assert.ok(entry.source?.files?.includes('SKILL.md'))
    assert.ok(entry.source?.files?.includes('scripts/run.py'))
    const sources = registry.sources('my-skill')
    assert.equal(sources.length, 1)
    // 卸载后目录删除、resolve 无回退
    const removed = registry.uninstall('my-skill', 'global')
    assert.equal(removed.ok, true)
    assert.equal(registry.resolve('my-skill'), undefined)
  })

  it('installFromGit：clone + commit 记录 + 文件清单；非技能仓库报错', async () => {
    const root = tmpRoot('git-install')
    const registry = new LayeredSkillRegistry({ dataRoot: root, git: fakeGit() })
    const entry = await registry.installFromGit('custom', 'https://github.com/example/skill-repo.git')
    assert.equal(entry.name, 'skill-repo')
    assert.equal(entry.source?.kind, 'git')
    assert.equal(entry.source?.url, 'https://github.com/example/skill-repo.git')
    assert.equal(entry.source?.commit, 'abc123def456')
    assert.equal(entry.version, 'abc123def456')
    assert.ok(entry.source?.files?.includes('SKILL.md'))
    assert.equal(registry.readBody('skill-repo')?.includes('来自 Git'), true)
    // 无 SKILL.md 的仓库 → 安装失败且目录清理
    const badGit: GitRunner = async (args) => {
      if (args[0] === 'clone') {
        fs.mkdirSync(args[args.length - 1]!, { recursive: true })
        fs.writeFileSync(path.join(args[args.length - 1]!, 'README.md'), 'not a skill', 'utf8')
        return { code: 0, stdout: '' }
      }
      return { code: 0, stdout: 'x' }
    }
    const badRegistry = new LayeredSkillRegistry({ dataRoot: tmpRoot('git-bad'), git: badGit })
    await assert.rejects(() => badRegistry.installFromGit('custom', 'https://github.com/example/not-skill.git'))
  })

  it('PLAT-21：安装/更新/卸载不污染项目资料（技能目录外文件不动）', () => {
    const root = tmpRoot('no-pollute')
    const projectDir = path.join(root, 'projects', 'demo')
    fs.mkdirSync(path.join(projectDir, 'notes'), { recursive: true })
    const researchFile = path.join(projectDir, 'notes', 'idea.md')
    fs.writeFileSync(researchFile, '# 我的研究笔记\n', 'utf8')
    const registry = new LayeredSkillRegistry({ dataRoot: root, workspaceDir: projectDir })
    registry.register('workspace', { name: 'lab-skill', body: '# lab\n' })
    // 更新（重新注册同名）
    registry.register('workspace', { name: 'lab-skill', body: '# lab v2\n' })
    registry.uninstall('lab-skill', 'workspace')
    // 项目资料原样
    assert.equal(fs.readFileSync(researchFile, 'utf8'), '# 我的研究笔记\n')
    assert.ok(fs.existsSync(path.join(projectDir, 'notes', 'idea.md')))
    // workspace 技能目录已清
    assert.equal(registry.resolve('lab-skill'), undefined)
  })
})

/* ------------------------------------------------------------------ */
/* PLAT-08/10：DSH provider 对接                                        */
/* ------------------------------------------------------------------ */

describe('PLAT-08 DSH ctx.skills provider 对接', () => {
  it('registerDshProvider：五层聚合为候选；dispose 注销', async () => {
    const root = tmpRoot('dsh-provider')
    const registry = new LayeredSkillRegistry({ dataRoot: root })
    registry.register('builtin', { name: 'demo', description: '内置', body: '# 内置\n' })
    registry.register('global', { name: 'demo', description: '全局', body: '# 全局\n' })
    let registered: { name?: string; list?: Function; get?: Function } | undefined
    const fakeSkills = {
      registerProvider: (create: (control: unknown) => unknown) => {
        registered = create({ signal: new AbortController().signal, invalidate: () => {} }) as never
        return () => { registered = undefined }
      },
    }
    const dispose = registry.registerDshProvider({ get: (name) => (name === 'skills' ? fakeSkills : undefined) })
    assert.ok(registered, 'provider 未注册')
    assert.equal(registered?.name, 'evoresearch-layered')
    const observation = await (registered!.list as () => Promise<{ candidates: Array<{ name: string; rank: number; path: string }> }>)()
    assert.equal(observation.candidates.length, 2)
    // 两个 demo（builtin rank=4 / global rank=3）；rank 越小优先级越高
    const ranks = observation.candidates.map((c) => c.rank).sort((a, b) => a - b)
    assert.deepEqual(ranks, [3, 4])
    assert.ok(observation.candidates.every((c) => c.name === 'demo'))
    // get 按 locator 读取 body
    const skill = await (registered!.get as (c: { locator: { layer: string; name: string } }) => Promise<{ content: string }>)({
      locator: { layer: 'builtin', name: 'demo' },
    })
    assert.equal(skill.content.includes('内置'), true)
    dispose()
    assert.equal(registered, undefined)
  })

  it('DSH skills 不可用 → 本地注册表独立运行（降级不抛）', () => {
    const root = tmpRoot('dsh-missing')
    const registry = new LayeredSkillRegistry({ dataRoot: root })
    const dispose = registry.registerDshProvider({ get: () => undefined })
    dispose()
    registry.register('global', { name: 'ok', body: '# ok\n' })
    assert.equal(registry.resolve('ok')?.layer, 'global')
  })
})

/* ------------------------------------------------------------------ */
/* PLAT-12：通配符过滤与按 Agent 暴露                                    */
/* ------------------------------------------------------------------ */

describe('PLAT-12 工具通配符过滤与按 Agent 暴露', () => {
  it('matchWildcard：精确/前缀/后缀/包含；matchesToolFilter deny 优先', () => {
    assert.equal(matchWildcard('fs.read', 'fs.read'), true)
    assert.equal(matchWildcard('fs.read', 'fs.*'), true)
    assert.equal(matchWildcard('fs.read', '*read'), true)
    assert.equal(matchWildcard('fs.read', '*.read'), true)
    assert.equal(matchWildcard('fs.read', '*.*'), true)
    assert.equal(matchWildcard('fs.read', 'other'), false)
    assert.equal(matchesToolFilter('bash', { allow: ['bash', 'fs.*'] }), true)
    assert.equal(matchesToolFilter('fs.read', { allow: ['bash', 'fs.*'] }), true)
    assert.equal(matchesToolFilter('web.search', { allow: ['bash', 'fs.*'] }), false)
    // deny 优先
    assert.equal(matchesToolFilter('fs.rm', { allow: ['fs.*'], deny: ['fs.rm*'] }), false)
    // 无过滤 = 全允许
    assert.equal(matchesToolFilter('anything', undefined), true)
  })

  it('filterTools 应用通配符；toolsFor 按 Agent 暴露范围（running 才可见）', async () => {
    const tools: McpToolInfo[] = [
      { name: 'fs.read' },
      { name: 'fs.write' },
      { name: 'bash.run' },
    ]
    const filtered = filterTools(tools, { allow: ['fs.*'] })
    assert.deepEqual(filtered.map((t) => t.name), ['fs.read', 'fs.write'])
    // supervisor 集成
    const factory: McpClientFactory = (config) => ({
      connect: async () => {
        if (config.serverId === 'srv-a') return { tools }
        return { tools: [{ name: 'db.query' }] }
      },
      disconnect: () => {},
    })
    const supervisor = new McpSupervisor({ clientFactory: factory, delay: async () => {} })
    await supervisor.addServer({
      serverId: 'srv-a',
      name: 'A',
      transport: 'stdio',
      command: 'node',
      args: ['server.js'],
      toolFilter: { allow: ['fs.*'] },
      exposeTo: ['agent-1'],
    }).status
    await supervisor.addServer({
      serverId: 'srv-b',
      name: 'B',
      transport: 'http',
      url: 'http://localhost:9999/mcp',
    }).status
    // 等待两个服务器 running
    await settle(100)
    const forAgent1 = supervisor.toolsFor('agent-1')
    assert.deepEqual(forAgent1.map((t) => t.name).sort(), ['db.query', 'fs.read', 'fs.write'])
    const forAgent2 = supervisor.toolsFor('agent-2')
    assert.deepEqual(forAgent2.map((t) => t.name), ['db.query']) // srv-a 只暴露给 agent-1
    const all = supervisor.toolsFor()
    assert.deepEqual(all.map((t) => t.name).sort(), ['db.query', 'fs.read', 'fs.write'])
  })
})

/* ------------------------------------------------------------------ */
/* PLAT-11/21：MCP 生命周期（启动/停止/重连/热更新/释放）                 */
/* ------------------------------------------------------------------ */

describe('PLAT-11 MCP 生命周期与 PLAT-21 降级', () => {
  it('启动成功 → running + 工具过滤；停止 → stopped + 工具清空', async () => {
    const factory: McpClientFactory = () => ({
      connect: async () => ({ tools: [{ name: 'a.run' }, { name: 'b.run' }] }),
      disconnect: () => {},
    })
    const supervisor = new McpSupervisor({ clientFactory: factory, delay: async () => {} })
    supervisor.addServer({ serverId: 's1', name: 'S1', transport: 'stdio', command: 'node', args: ['x.js'] })
    await settle(50)
    // 状态以 get() 为准（addServer 返回的是启动前快照）
    assert.equal(supervisor.get('s1')?.state, 'running')
    assert.equal(supervisor.get('s1')?.tools.length, 2)
    await supervisor.stop('s1')
    assert.equal(supervisor.get('s1')?.state, 'stopped')
    assert.equal(supervisor.get('s1')?.tools.length, 0)
  })

  it('断线重连：首次失败 → reconnecting → 重试成功（reconnectAttempts 记录）', async () => {
    let attempts = 0
    const factory: McpClientFactory = () => ({
      connect: async () => {
        attempts += 1
        if (attempts === 1) throw new Error('连接拒绝')
        return { tools: [{ name: 'db.query' }] }
      },
      disconnect: () => {},
    })
    const supervisor = new McpSupervisor({ clientFactory: factory, delay: async () => {} })
    supervisor.addServer({ serverId: 's1', name: 'S1', transport: 'http', url: 'http://x/mcp' })
    // 第一次连接失败 → 自动重连成功（reconnectAttempts 记录）
    await settle(50)
    assert.equal(supervisor.get('s1')?.state, 'running')
    assert.equal(supervisor.get('s1')?.reconnectAttempts, 1)
    assert.equal(supervisor.get('s1')?.tools.length, 1)
  })

  it('无法重连（超限）→ failed 局部降级：该服务器工具不可见，其他服务器正常', async () => {
    const factory: McpClientFactory = (config) => ({
      connect: async () => {
        if (config.serverId === 'bad') throw new Error('持续失败')
        return { tools: [{ name: 'good.run' }] }
      },
      disconnect: () => {},
    })
    const supervisor = new McpSupervisor({ clientFactory: factory, delay: async () => {} })
    supervisor.addServer({ serverId: 'bad', name: 'BAD', transport: 'stdio', command: 'node', maxReconnectAttempts: 2 })
    supervisor.addServer({ serverId: 'good', name: 'GOOD', transport: 'stdio', command: 'node' })
    await settle(100)
    assert.equal(supervisor.get('bad')?.state, 'failed')
    assert.ok(supervisor.get('bad')?.error)
    assert.equal(supervisor.get('bad')?.tools.length, 0)
    assert.equal(supervisor.get('good')?.state, 'running')
    // 局部降级：toolsFor 只含 good 的工具
    assert.deepEqual(supervisor.toolsFor().map((t) => t.name), ['good.run'])
    // 普通工具不受影响（supervisor 之外无依赖）
  })

  it('配置热更新（PLAT-12）：configVersion+1、重连重载、新过滤生效', async () => {
    let calls = 0
    const factory: McpClientFactory = (config) => ({
      connect: async () => {
        calls += 1
        const tools = config.toolFilter?.allow?.includes('a.*')
          ? [{ name: 'a.run' }, { name: 'b.run' }]
          : [{ name: 'a.run' }, { name: 'b.run' }, { name: 'c.run' }]
        return { tools }
      },
      disconnect: () => {},
    })
    const supervisor = new McpSupervisor({ clientFactory: factory, delay: async () => {} })
    const { status } = supervisor.addServer({ serverId: 's1', name: 'S1', transport: 'stdio', command: 'node' })
    await settle(50)
    assert.equal(status.configVersion, 1)
    assert.equal(calls, 1)
    // 热更新：加过滤 allow a.*
    const updated = await supervisor.updateConfig('s1', { toolFilter: { allow: ['a.*'] } })
    assert.equal(updated.configVersion, 2)
    assert.deepEqual(updated.tools.map((t) => t.name), ['a.run'])
    assert.equal(calls, 2)
  })

  it('removeServer 释放；disposeAll 卸载无副作用（幂等，disconnect 全部调用）', async () => {
    const disconnected: string[] = []
    const factory: McpClientFactory = (config) => ({
      connect: async () => ({ tools: [{ name: 'x.run' }] }),
      disconnect: () => { disconnected.push(config.serverId) },
    })
    const supervisor = new McpSupervisor({ clientFactory: factory, delay: async () => {} })
    supervisor.addServer({ serverId: 's1', name: 'S1', transport: 'stdio', command: 'node' })
    supervisor.addServer({ serverId: 's2', name: 'S2', transport: 'stdio', command: 'node' })
    await settle(50)
    await supervisor.removeServer('s1')
    assert.ok(disconnected.includes('s1'))
    assert.equal(supervisor.list().length, 1)
    supervisor.disposeAll()
    assert.ok(disconnected.includes('s2'))
    assert.equal(supervisor.list().length, 0)
    // 幂等
    supervisor.disposeAll()
    assert.equal(supervisor.list().length, 0)
  })

  it('reconnectBackoffMs 指数退避有上限', () => {
    assert.equal(reconnectBackoffMs(1), 1000)
    assert.equal(reconnectBackoffMs(2), 2000)
    assert.equal(reconnectBackoffMs(3), 4000)
    assert.equal(reconnectBackoffMs(10), 30000)
  })
})
