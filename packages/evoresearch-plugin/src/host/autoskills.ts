/**
 * AutoSkills：从科研记忆中蒸馏可复用技能，生成待审提案。
 *
 * 对齐 EvoResearch memory/autoskills/：
 * - 候选生成（§42.7）：Observation 按 primary_category + topic_key 分组为候选簇；
 *   簇要求 ≥3 条 Observation 且其中 ≥2 条 procedural（method/experiment）；
 *   cluster hash 由排序后的 Observation IDs 稳定生成；已处理簇不重复提案；
 * - 提案生命周期（§42.8）：pending → approved/rejected；approve 写入
 *   skills/<name>/SKILL.md（YAML frontmatter：name/description/allowed-tools）+
 *   manifest.json（proposal id/name/description/status/operation/时间/cluster hash/
 *   source IDs/workspace/project/安装路径）；Review 模式等用户批准，Auto 模式
 *   生成后自动安装；拒绝保留审计记录；
 * - 提案持久化到 <dataRoot>/.evoresearch-data/autoskills.json（原子写）。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import type { AutoSkillProposal } from '../shared/types.js'
import type { ResearchMemoryStore } from './memory/store.js'

/** 视为 procedural 的类别（§42.7：方法/实验类观测可蒸馏为可执行技能）。 */
const PROCEDURAL_CATEGORIES = new Set(['method', 'experiment'])
/** skill 名最长 64 字符的 lowercase kebab-case（§42.8）。 */
const NAME_MAX = 64

/** AutoSkills 配置。 */
export interface AutoSkillsConfig {
  readonly dataRoot: string
  /** 技能目录（approve 后写入，可由 dsh-skill 挂载）。 */
  readonly skillsDir?: string
}

/** 稳定生成 cluster hash（排序后 IDs 的 SHA-256 前 16 位，§42.7）。 */
function clusterHashOf(ids: readonly string[]): string {
  return createHash('sha256').update([...ids].sort().join('\n')).digest('hex').slice(0, 16)
}

/** skill 名规范化为 lowercase kebab-case（≤64 字符，§42.8）。 */
export function slugifySkillName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, NAME_MAX)
  return slug || 'skill'
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
   * 从记忆库生成技能提案（§42.7 候选生成）：
   * 按 primary_category + topic_key 分组，簇 ≥3 条且 ≥2 条 procedural 才提案；
   * cluster hash 稳定去重（已 pending/approved/rejected/processed 的簇不重复提案）。
   * @param store 项目记忆库。
   * @param workspaceDir 所属工作区（写入提案 manifest）。
   * @returns 新生成的提案数。
   */
  generateFromObservations(store: ResearchMemoryStore, workspaceDir = ''): number {
    const observations = store.listObservations({ limit: 500 })
    const groups = new Map<string, string[]>()
    for (const observation of observations) {
      if (observation.status !== 'active') continue
      for (const topicKey of observation.topicKeys) {
        const key = `${observation.primaryCategory ?? 'general'}:${topicKey}`
        const list = groups.get(key) ?? []
        list.push(observation.observationId)
        groups.set(key, list)
      }
    }
    // 已处理簇哈希（去重，§42.7：pending/approved/rejected/processed 均不再提案）
    const processedHashes = new Set(
      this.proposals
        .map((p) => p.clusterHash)
        .filter((h): h is string => typeof h === 'string' && h.length > 0),
    )
    const config = this.readConfig()
    const autoMode = config.enabled === true && config.mode === 'auto'
    let created = 0
    for (const [key, sourceIds] of groups) {
      if (sourceIds.length < 3) continue
      const procedural = sourceIds.filter((id) => {
        const obs = observations.find((o) => o.observationId === id)
        return obs !== undefined && PROCEDURAL_CATEGORIES.has(obs.primaryCategory ?? '')
      }).length
      if (procedural < 2) continue
      const hash = clusterHashOf(sourceIds)
      if (processedHashes.has(hash)) continue
      const [category] = key.split(':')
      const proposal: AutoSkillProposal = {
        proposalId: `a-${randomUUID().slice(0, 8)}`,
        name: key,
        description: `从 ${sourceIds.length} 条「${category}」主题观测（含 ${procedural} 条方法/实验）蒸馏出的可复用技能`,
        action: 'create',
        content: `# ${slugifySkillName(key)}\n\n由 ${sourceIds.length} 条观测蒸馏（来源: ${sourceIds.join(', ')}）。`,
        sourceObservationIds: sourceIds,
        clusterHash: hash,
        workspaceDir,
        status: 'pending',
        createdAt: Date.now(),
      }
      this.proposals.push(proposal)
      processedHashes.add(hash)
      created += 1
      // §42.8：Auto 模式生成后自动安装
      if (autoMode) this.approve(proposal.proposalId)
    }
    if (created > 0) this.save()
    return created
  }

  /** 批准提案（§42.8）：写入 skills/<name>/SKILL.md（合规 frontmatter）+ manifest.json。 */
  approve(proposalId: string): boolean {
    const proposal = this.proposals.find((p) => p.proposalId === proposalId)
    if (!proposal || proposal.status !== 'pending') return false
    const name = slugifySkillName(proposal.name)
    const dir = path.join(this.skillsDir, name)
    fs.mkdirSync(dir, { recursive: true })
    const now = new Date().toISOString()
    // SKILL.md：YAML frontmatter（仅允许 name/description/allowed-tools）+ 正文（无 TODO 占位）
    const skillMd = [
      '---',
      `name: ${name}`,
      `description: ${(proposal.description ?? '').slice(0, 1024).replace(/\n+/g, ' ')}`,
      'allowed-tools:',
      '  - bash',
      '  - fs',
      '---',
      '',
      proposal.content.trim(),
      '',
    ].join('\n')
    fs.writeFileSync(path.join(dir, 'SKILL.md'), skillMd, 'utf8')
    // manifest.json：审计/状态/来源/安装路径
    const manifest = {
      proposalId: proposal.proposalId,
      name,
      description: proposal.description,
      status: 'approved',
      operation: proposal.action,
      createdAt: new Date(proposal.createdAt).toISOString(),
      approvedAt: now,
      clusterHash: proposal.clusterHash ?? null,
      sourceObservationIds: proposal.sourceObservationIds,
      targetSkill: proposal.targetSkill ?? null,
      workspaceDir: proposal.workspaceDir ?? null,
      projectId: proposal.projectId ?? null,
      installedPath: dir,
    }
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')
    proposal.status = 'approved'
    proposal.name = name
    proposal.installedPath = dir
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
