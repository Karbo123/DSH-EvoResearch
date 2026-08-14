/**
 * 专家团队：把已安装技能邀请为会话内专家（active_teams）。
 *
 * 对齐 EvoScientist middleware/active_team.py 与 `/expert` 命令：
 * - 专家 = 已安装技能（通过 ctx.skills.list() 发现）；
 * - 邀请状态持久化到 <dataRoot>/.evosci-data/active-teams.json；
 * - 每次 run 把 active_teams 注入 configurable（由 host 入口随会话创建传递）。
 */
import type { Context } from '@deepseek-ai/cordis'
import * as fs from 'node:fs'
import * as path from 'node:path'

/** 活跃专家记录。 */
export interface ActiveTeam {
  readonly name: string
  readonly description: string
  readonly invitedAt: number
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
    this.file = path.join(config.dataRoot, '.evosci-data', 'active-teams.json')
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

  /** 列出活跃专家。 */
  async list(ctx?: Context): Promise<ActiveTeam[]> {
    if (ctx) {
      // 与已安装技能对账：已卸载的专家自动移除
      const skills = ctx.get('skills')
      if (skills) {
        const summaries = await skills.list()
        const names = new Set(summaries.map((s: { name?: string }) => s.name))
        const before = this.teams.length
        this.teams = this.teams.filter((team) => names.has(team.name))
        if (this.teams.length !== before) this.save()
      }
    }
    return [...this.teams]
  }

  /** 邀请一位专家（技能名）。 */
  async invite(ctx: Context, name: string): Promise<boolean> {
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
}
