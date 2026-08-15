/**
 * AutoSkills：从科研记忆中蒸馏可复用技能，生成待审提案。
 *
 * 对齐 EvoResearch memory/autoskills/：
 * - 以 Observation 为聚类来源：按 topic_key/categories 分组，组内 ≥2 条时生成技能提案；
 * - 提案生命周期：pending → approved/rejected（approve 后写入技能目录，可一键运行）；
 * - 提案持久化到 <dataRoot>/.evoresearch-data/autoskills.json（原子写）。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AutoSkillProposal } from '../shared/types.js'
import type { ResearchMemoryStore } from './memory/store.js'

/** AutoSkills 配置。 */
export interface AutoSkillsConfig {
  readonly dataRoot: string
  /** 技能目录（approve 后写入，可由 dsh-skill 挂载）。 */
  readonly skillsDir?: string
}

/** AutoSkills 服务。 */
export class AutoSkillsService {
  private readonly file: string
  private proposals: AutoSkillProposal[] = []
  private readonly skillsDir: string

  constructor(readonly config: AutoSkillsConfig) {
    this.file = path.join(config.dataRoot, '.evoresearch-data', 'autoskills.json')
    this.skillsDir = config.skillsDir ?? path.join(config.dataRoot, '.evoresearch-data', 'skills')
    this.load()
  }

  private load(): void {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as { proposals?: unknown }
      if (Array.isArray(raw.proposals)) {
        this.proposals = raw.proposals.filter((p): p is AutoSkillProposal => {
          const proposal = p as AutoSkillProposal
          return typeof proposal?.proposalId === 'string' && typeof proposal?.name === 'string'
        })
      }
    } catch {
      this.proposals = []
    }
  }

  private save(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    fs.writeFileSync(tmp, JSON.stringify({ proposals: this.proposals }, null, 2), 'utf8')
    fs.renameSync(tmp, this.file)
  }

  listProposals(status?: AutoSkillProposal['status']): AutoSkillProposal[] {
    const list = status ? this.proposals.filter((p) => p.status === status) : this.proposals
    return [...list].sort((a, b) => b.createdAt - a.createdAt)
  }

  /**
   * 从记忆库生成技能提案（聚类：相同 topic_key 的 Observation ≥2 条）。
   * @param store 项目记忆库。
   * @returns 新生成的提案数。
   */
  generateFromObservations(store: ResearchMemoryStore): number {
    const observations = store.listObservations({ limit: 500 })
    const groups = new Map<string, string[]>()
    for (const observation of observations) {
      for (const topicKey of observation.topicKeys) {
        const key = `${observation.primaryCategory ?? 'general'}:${topicKey}`
        const list = groups.get(key) ?? []
        list.push(observation.observationId)
        groups.set(key, list)
      }
    }
    let created = 0
    for (const [key, sourceIds] of groups) {
      if (sourceIds.length < 2) continue
      if (this.proposals.some((p) => p.status === 'pending' && p.name === key)) continue
      const [category] = key.split(':')
      const proposal: AutoSkillProposal = {
        proposalId: `a-${randomUUID().slice(0, 8)}`,
        name: key,
        description: `从 ${sourceIds.length} 条「${category}」主题观测中蒸馏出的可复用技能`,
        action: 'create',
        content: `# ${key}\n\n从以下观测蒸馏（来源 ${sourceIds.join(', ')}）。\n\n（技能正文由模型在审核时完善）`,
        sourceObservationIds: sourceIds,
        status: 'pending',
        createdAt: Date.now(),
      }
      this.proposals.push(proposal)
      created += 1
    }
    if (created > 0) this.save()
    return created
  }

  /** 批准提案：写入技能目录（SKILL.md），供 dsh-skill 挂载。 */
  approve(proposalId: string): boolean {
    const proposal = this.proposals.find((p) => p.proposalId === proposalId)
    if (!proposal || proposal.status !== 'pending') return false
    proposal.status = 'approved'
    const name = proposal.name.replace(/[^a-z0-9-_]/gi, '-').toLowerCase()
    const dir = path.join(this.skillsDir, name)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'SKILL.md'), proposal.content, 'utf8')
    this.save()
    return true
  }

  reject(proposalId: string): boolean {
    const proposal = this.proposals.find((p) => p.proposalId === proposalId)
    if (!proposal || proposal.status !== 'pending') return false
    proposal.status = 'rejected'
    this.save()
    return true
  }

  /** 运行一次已批准技能（第一版：记录运行事件，真实执行由后续版本接 dsh-skill）。 */
  run(proposalId: string): boolean {
    const proposal = this.proposals.find((p) => p.proposalId === proposalId)
    if (!proposal || proposal.status !== 'approved') return false
    // TODO(科研记忆): 通过 ctx.skills 装载技能并触发一次技能执行
    console.log(`[evoresearch:autoskills] 运行技能 ${proposal.name}（待接入 dsh-skill 执行）`)
    return true
  }

  /**
   * 更新调度配置（§42.9）：enabled / mode(review|auto) / cadence(nightly|weekly|monthly) /
   * time(HH:MM 本地)。返回 cron 等价式（供 scheduler reconcile）。
   */
  saveConfig(config: { enabled?: boolean; mode?: string; cadence?: string; time?: string }): { cron: string | null } {
    const file = path.join(this.config.dataRoot, '.evoresearch-data', 'autoskills-config.json')
    const merged = { ...this.readConfig(), ...config }
    fs.writeFileSync(file, JSON.stringify(merged, null, 2), 'utf8')
    // cron 推导：nightly=每天；weekly=周日(0)；monthly=每月 1 日
    if (merged.enabled !== true) return { cron: null }
    const time = /^(\d{1,2}):(\d{1,2})$/.exec(String(merged.time ?? '03:00'))
    const hour = time ? Math.min(23, Number(time[1])) : 3
    const minute = time ? Math.min(59, Number(time[2])) : 0
    const cadence = merged.cadence ?? 'weekly'
    if (cadence === 'nightly') return { cron: `${minute} ${hour} * * *` }
    if (cadence === 'monthly') return { cron: `${minute} ${hour} 1 * *` }
    return { cron: `${minute} ${hour} * * 0` }
  }

  readConfig(): { enabled?: boolean; mode?: string; cadence?: string; time?: string } {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(this.config.dataRoot, '.evoresearch-data', 'autoskills-config.json'), 'utf8'))
      return typeof raw === 'object' && raw !== null ? raw : {}
    } catch {
      return {}
    }
  }
}
