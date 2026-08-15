/**
 * 斜杠命令注册（复用 DSH 原生命令体系 commands.register）。
 *
 * 与 EvoResearch 的 CommandManager 对齐，覆盖科研工作流常用命令：
 * /project（项目创建与导入）、/memory（科研记忆状态）、/schedule（定时任务）、
 * /channel（通道启停）、/expert（专家团队）、/autoskills（技能提案审核）。
 * /compact、/model、/plan 等由 DSH 平台原生提供，不重复注册。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { CommandDefinition } from '@deepseek-ai/dsh-commands'
import type { WorkspaceService } from './workspace.js'
import type { MemoryRuntime } from './memory/index.js'
import type { SchedulerService } from './scheduler.js'
import type { ChannelManager } from './channels/index.js'
import type { AutoSkillsService } from './autoskills.js'
import type { ExpertService } from './experts.js'

/** 命令宿主：各服务集合。 */
export interface CommandHost {
  readonly workspace: WorkspaceService
  readonly memory: MemoryRuntime
  readonly scheduler: SchedulerService
  readonly channels: ChannelManager
  readonly autoskills: AutoSkillsService
  readonly experts: ExpertService
}

/** 统一成功/失败结果。 */
function ok(text: string): { kind: 'success'; text: string } {
  return { kind: 'success', text }
}

function fail(text: string): { kind: 'error'; text: string } {
  return { kind: 'error', text }
}

/** 注册全部斜杠命令。 */
export function registerCommands(ctx: Context, host: CommandHost): () => void {
  const commands = ctx.get('commands')
  if (!commands) return () => {}
  const disposers: Array<() => void> = []
  const register = (definition: CommandDefinition): void => {
    disposers.push(commands.register(definition))
  }

  // ── /project：科研项目工作区 ──────────────────────────────────────────────
  register({
    name: 'project',
    description: '科研项目工作区管理：/project list | create <name> | import <绝对路径>',
    input: { hint: 'list | create <name> | import <path>' },
    handler: async (invocation) => {
      const input = invocation.rawInput.trim()
      const [sub, ...rest] = input.split(/\s+/)
      if (!sub) {
        const projects = host.workspace.listProjects()
        if (projects.length === 0) return ok('暂无科研项目。使用 /project create <name> 创建。')
        return ok(`科研项目列表:\n${projects.map((p) => `- ${p.name} (${p.path})`).join('\n')}`)
      }
      if (sub === 'create') {
        const name = rest.join('-')
        if (!name) return fail('用法: /project create <name>')
        const project = host.workspace.createProject(name)
        return ok(`已创建项目 ${project.name}\n目录: ${project.path}`)
      }
      if (sub === 'import') {
        const source = rest.join(' ')
        if (!source) return fail('用法: /project import <绝对路径>')
        try {
          const project = host.workspace.importProject(source)
          return ok(`已导入项目 ${project.name}\n目录: ${project.path}`)
        } catch (error) {
          return fail(`导入失败: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
      return fail(`未知子命令 /project ${sub}`)
    },
  })

  // ── /memory：科研记忆状态 ─────────────────────────────────────────────────
  register({
    name: 'memory',
    description: '查看科研记忆状态：类别目录与主题状态',
    handler: () => {
      const counts = host.memory.storeFor('').countByCategory()
      const states = host.memory.storeFor('').listTopicStates()
      const lines = ['科研记忆状态:']
      for (const [category, count] of Object.entries(counts)) {
        lines.push(`  - ${category}: ${count} 轮`)
      }
      if (states.length > 0) {
        lines.push('主题状态:')
        for (const state of states.slice(0, 10)) {
          lines.push(`  [${state.category}] ${state.label}: ${(state.decision || '（暂无决定）').slice(0, 80)}`)
        }
      }
      return ok(lines.join('\n'))
    },
  })

  // ── /schedule：定时任务 ───────────────────────────────────────────────────
  register({
    name: 'schedule',
    description: '定时任务管理：/schedule list | add "<cron>" <提示词> | remove <id>',
    input: { hint: 'list | add "<cron>" <prompt> | remove <id>' },
    handler: async (invocation) => {
      const input = invocation.rawInput.trim()
      const [sub, ...rest] = input.split(/\s+/)
      if (!sub || sub === 'list') {
        const tasks = host.scheduler.list()
        if (tasks.length === 0) return ok('暂无定时任务。示例: /schedule add "0 9 * * 1-5" 每天上午做文献综述')
        const rows = tasks.map((t) => `| ${t.taskId} | ${t.enabled ? '开' : '关'} | ${t.cron} | ${t.name} |`)
        return ok(`| ID | 状态 | Cron | 名称 |\n|---|---|---|---|\n${rows.join('\n')}`)
      }
      if (sub === 'add') {
        // 支持 "/schedule add "0 9 * * 1-5" 提示词" 的引号解析
        const quoted = /^"([^"]+)"\s*([\s\S]*)$/.exec(rest.join(' '))
        const cron = quoted ? quoted[1]! : rest[0]
        const prompt = quoted ? quoted[2]!.trim() : rest.slice(1).join(' ')
        if (!cron || !prompt) return fail('用法: /schedule add "<cron>" <提示词>')
        try {
          const task = host.scheduler.add({ name: prompt.slice(0, 30), cron, prompt, workspaceDir: '' })
          return ok(`已添加任务 ${task.taskId}（cron: ${cron}）`)
        } catch (error) {
          return fail(`cron 表达式非法: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
      if (sub === 'remove') {
        const id = rest[0]
        if (!id) return fail('用法: /schedule remove <id>')
        return host.scheduler.remove(id) ? ok(`已删除任务 ${id}`) : fail(`未找到任务 ${id}`)
      }
      return fail(`未知子命令 /schedule ${sub}`)
    },
  })

  // ── /channel：消息通道 ────────────────────────────────────────────────────
  register({
    name: 'channel',
    description: '消息通道管理：/channel list | start <id> | stop <id>',
    input: { hint: 'list | start <id> | stop <id>' },
    handler: async (invocation) => {
      const input = invocation.rawInput.trim()
      const [sub, id] = input.split(/\s+/)
      if (!sub || sub === 'list') {
        const statuses = host.channels.status()
        if (statuses.length === 0) return ok('暂无可用通道（内置适配器: telegram/slack/qq/wechat/feishu）')
        const rows = statuses.map((s) => `| ${s.id} | ${s.online ? '在线' : '离线'} | ${s.received} | ${s.sent} | ${s.error ?? ''} |`)
        return ok(`| 通道 | 状态 | 收 | 发 | 错误 |\n|---|---|---|---|---|\n${rows.join('\n')}`)
      }
      if (sub === 'start') {
        if (!id) return fail('用法: /channel start <id>')
        const started = await host.channels.start(id)
        return started ? ok(`通道 ${id} 已启动`) : fail(`启动失败或通道不存在: ${id}`)
      }
      if (sub === 'stop') {
        if (!id) return fail('用法: /channel stop <id>')
        return (await host.channels.stop(id)) ? ok(`通道 ${id} 已停止`) : fail(`通道不存在或未运行: ${id}`)
      }
      return fail(`未知子命令 /channel ${sub}`)
    },
  })

  // ── /expert：专家团队 ─────────────────────────────────────────────────────
  register({
    name: 'expert',
    description: '专家团队管理：/expert list | invite <name> | clear',
    input: { hint: 'list | invite <name> | clear' },
    handler: async (invocation) => {
      const input = invocation.rawInput.trim()
      const [sub, name] = input.split(/\s+/)
      if (!sub || sub === 'list') {
        const teams = await host.experts.list()
        if (teams.length === 0) return ok('当前无受邀专家。可用: /expert invite <技能名>')
        const rows = teams.map((t) => `| ${t.name} | ${t.description.slice(0, 60)} |`)
        return ok(`活跃专家:\n\n| 专家 | 说明 |\n|---|---|\n${rows.join('\n')}`)
      }
      if (sub === 'invite') {
        if (!name) return fail('用法: /expert invite <name>')
        const invited = await host.experts.invite(ctx, name)
        return invited ? ok(`已邀请专家 ${name}`) : fail(`未找到技能或邀请失败: ${name}`)
      }
      if (sub === 'clear') {
        await host.experts.clear()
        return ok('已清空活跃专家')
      }
      return fail(`未知子命令 /expert ${sub}`)
    },
  })

  // ── /autoskills：AutoSkills 提案审核 ──────────────────────────────────────
  register({
    name: 'autoskills',
    description: 'AutoSkills 提案审核：/autoskills list | approve <id> | reject <id>',
    input: { hint: 'list | approve <id> | reject <id>' },
    handler: async (invocation) => {
      const input = invocation.rawInput.trim()
      const [sub, id] = input.split(/\s+/)
      if (!sub || sub === 'list') {
        const proposals = host.autoskills.listProposals()
        if (proposals.length === 0) return ok('暂无 AutoSkills 提案')
        const rows = proposals.map((p) => `| ${p.proposalId} | ${p.status} | ${p.name} | ${p.sourceObservationIds.length} |`)
        return ok(`| ID | 状态 | 名称 | 观测数 |\n|---|---|---|---|\n${rows.join('\n')}`)
      }
      if (sub === 'approve') {
        if (!id) return fail('用法: /autoskills approve <id>')
        return host.autoskills.approve(id) ? ok(`已批准提案 ${id}`) : fail(`未找到提案 ${id}`)
      }
      if (sub === 'reject') {
        if (!id) return fail('用法: /autoskills reject <id>')
        return host.autoskills.reject(id) ? ok(`已拒绝提案 ${id}`) : fail(`未找到提案 ${id}`)
      }
      return fail(`未知子命令 /autoskills ${sub}`)
    },
  })

  return () => {
    for (const dispose of disposers) dispose()
  }
}
