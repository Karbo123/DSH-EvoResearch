/**
 * 专家团队：把已安装技能邀请为会话内专家（active_teams）。
 *
 * 对齐 EvoResearch middleware/active_team.py 与 `/expert` 命令：
 * - 专家 = 已安装技能（通过 ctx.skills.list() 发现）；
 * - 邀请状态持久化到 <dataRoot>/plugins/active-teams.json；
 * - 每次 run 把 active_teams 注入 configurable（由 host 入口随会话创建传递）。
 */
import type { Context } from '@deepseek-ai/cordis'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { findTeamRole, TEAM_ROLES } from './teams.js'

/** 活跃专家记录。 */
export interface ActiveTeam {
  readonly name: string
  readonly description: string
  readonly invitedAt: number
}

export interface ExpertContextSource {
  readonly path: string
  readonly text: string
}

/** 专家服务配置。 */
export interface ExpertConfig {
  readonly dataRoot: string
}

/** 专家团队服务。 */
export class ExpertService {
  private readonly file: string
  private teams: ActiveTeam[] = []

  constructor(readonly config: ExpertConfig) {
    this.file = path.join(config.dataRoot, 'plugins', 'active-teams.json')
    this.load()
  }

  private load(): void {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as { teams?: unknown }
      if (Array.isArray(raw.teams)) {
        this.teams = raw.teams.filter((t): t is ActiveTeam => {
          const team = t as ActiveTeam
          return typeof team?.name === 'string'
        })
      }
    } catch {
      this.teams = []
    }
  }

  private save(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    fs.writeFileSync(tmp, JSON.stringify({ teams: this.teams }, null, 2), 'utf8')
    fs.renameSync(tmp, this.file)
  }

  /** 列出活跃专家（内置团队 + 已邀请技能）。 */
  async list(ctx?: Context): Promise<ActiveTeam[]> {
    // 内置团队始终可见（未邀请时不在 activeTeams，但可作为候选）
    const builtin = TEAM_ROLES.map((role) => ({
      name: role.id,
      description: role.description,
      invitedAt: 0,
    }))
    if (ctx) {
      // 与已安装技能对账：已卸载的专家自动移除
      const skills = ctx.get('skills')
      if (skills) {
        const summaries = await skills.list()
        const names = new Set(summaries.map((s: { name?: string }) => s.name))
        const before = this.teams.length
        this.teams = this.teams.filter((team) => names.has(team.name) || findTeamRole(team.name) !== undefined)
        if (this.teams.length !== before) this.save()
      }
    }
    // 内置团队（已邀请的排在前面）
    const invitedBuiltin = this.teams
      .filter((team) => findTeamRole(team.name) !== undefined)
      .map((team) => ({
        ...team,
        description: findTeamRole(team.name)?.description ?? team.description,
      }))
    const invitedSkills = this.teams.filter((team) => findTeamRole(team.name) === undefined)
    return [...invitedBuiltin, ...invitedSkills, ...builtin.filter((b) => !this.teams.some((t) => t.name === b.name))]
  }

  /** 邀请一位专家：优先内置团队（无需技能目录），否则查已安装技能。 */
  async invite(ctx: Context, name: string): Promise<boolean> {
    // 内置团队直接邀请（角色预设总是可用）
    if (findTeamRole(name)) {
      if (!this.teams.some((team) => team.name === name)) {
        const role = findTeamRole(name)!
        this.teams.push({ name, description: role.description, invitedAt: Date.now() })
        this.save()
      }
      return true
    }
    const skills = ctx.get('skills')
    if (skills) {
      const summaries = await skills.list()
      const skill = summaries.find((s: { name?: string }) => s.name === name)
      if (!skill) return false
      if (!this.teams.some((team) => team.name === name)) {
        this.teams.push({
          name,
          description: typeof skill === 'object' && skill !== null && 'description' in skill && typeof (skill as { description?: unknown }).description === 'string'
            ? (skill as { description: string }).description
            : '',
          invitedAt: Date.now(),
        })
        this.save()
      }
      return true
    }
    // skills 服务不可用时：仍记录邀请（不校验存在性）
    if (!this.teams.some((team) => team.name === name)) {
      this.teams.push({ name, description: '', invitedAt: Date.now() })
      this.save()
    }
    return true
  }

  /** 清空活跃专家。 */
  async clear(): Promise<void> {
    this.teams = []
    this.save()
  }

  /** 当前活跃专家名列表（随 run 注入 configurable.active_teams）。 */
  activeTeamNames(): string[] {
    return this.teams.map((team) => team.name)
  }

  /**
   * 读取当前项目的自然语言专家说明（PLAT-10）。项目文件优先，部署根目录
   * 作为跨项目兜底；只读取明确的 AGENTS.md，不把任意目录内容注入模型。
   */
  agentsContext(workspaceDir?: string, maxChars = 24000): { text: string; sources: ExpertContextSource[] } {
    const candidates: string[] = []
    if (workspaceDir !== undefined && workspaceDir !== '') {
      candidates.push(path.join(workspaceDir, 'AGENTS.md'))
      candidates.push(path.join(workspaceDir, '.evoresearch-data', 'AGENTS.md'))
    }
    candidates.push(path.join(this.config.dataRoot, 'AGENTS.md'))
    const sources: ExpertContextSource[] = []
    let total = 0
    for (const file of [...new Set(candidates)]) {
      try {
        const stat = fs.statSync(file)
        if (!stat.isFile() || stat.size === 0) continue
        const remaining = maxChars - total
        if (remaining <= 0) break
        const text = fs.readFileSync(file, 'utf8').slice(0, remaining).trim()
        if (text === '') continue
        sources.push({ path: file, text })
        total += text.length
      } catch {
        // AGENTS.md 是可选背景资料，缺失或不可读不应阻塞聊天。
      }
    }
    return {
      text: sources.length === 0
        ? ''
        : `<agent_guidance>\n${sources.map((source) => `## ${source.path}\n${source.text}`).join('\n\n')}\n</agent_guidance>`,
      sources,
    }
  }
}
