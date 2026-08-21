/**
 * AutoSkills：从科研记忆与自然语言轨迹中蒸馏可复用技能，生成待审提案。
 *
 * 兼容旧路径（§42.7/42.8，保留 generateFromObservations 的固定聚类规则），
 * 并新增 EVO-07/08/09 改造：
 * - EVO-07 `generateFromTraces`：直接从自然语言笔记、聊天文本和工具轨迹
 *   发现重复做法（出现频次 ≥ minOccurrences，默认 2），不再依赖
 *   "≥3 条同类 Observation 且 ≥2 条 method/experiment" 的固定门槛；
 * - EVO-08 `updateProposalContent`：Skill 草稿保持 Markdown 可编辑，
 *   用户编辑后 `approve` 才安装（安装内容 = 编辑后的正文）；
 * - EVO-09 `runSkill`：接入真实 DSH Skill 注册表（attach(ctx) 探测
 *   ctx.get('skills')），装载验证并记录可读执行结果；探测不到返回明确错误。
 *
 * 提案持久化到 <dataRoot>/.evoresearch-data/autoskills.json（原子写）；
 * 技能运行记录追加到 <dataRoot>/.evoresearch-data/evolution/skill-runs.jsonl。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { execFileSync } from 'node:child_process'
import { randomUUID, createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { AutoSkillProposal } from '../shared/types.js'
import type { ResearchMemoryStore } from './memory/store.js'
import type { EvolutionSignal } from './evolution/signals.js'

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

/* ------------------------------------------------------------------ */
/* EVO-07：从自然语言笔记/聊天/工具轨迹发现重复做法                      */
/* ------------------------------------------------------------------ */

/** EVO-07 发现输入（不要求结构化失败分类，全部为自然语言/轨迹）。 */
export interface HabitDiscoveryInput {
  /** 自然语言笔记/聊天文本（NotesService.listNotes 的 body 等）。 */
  readonly texts?: readonly string[]
  /** 工具失败信号（tool_repeated_failure；attempts 计入出现次数）。 */
  readonly toolSignals?: readonly EvolutionSignal[]
  /** 最小出现次数（默认 2；EVO-07 不再依赖类别数量门槛）。 */
  readonly minOccurrences?: number
}

/** EVO-07 发现的重复做法。 */
export interface DiscoveredHabit {
  /** 归一化的做法短语（自然语言可读）。 */
  readonly habit: string
  /** 出现次数。 */
  readonly count: number
  /** 来源（文本索引 / 信号 id）。 */
  readonly sources: readonly string[]
  /** 可读说明。 */
  readonly note: string
}

/** 习惯标记词：含这些词的句子视为"做法描述"候选（中英）。 */
const HABIT_MARKERS = /(总是|每次|先|再|记得|必须|不要忘记|别忘了|用|需要|建议|always|remember|never forget|make sure|each time|use|should)/i

/** 元话语前缀：句首这些词只是提醒语气，剥离后才是做法核心（中英）。 */
const HABIT_PREFIX = /^(?:记得|别忘了|不要忘记|务必|一定要|请|建议|always|remember to|make sure to|never forget to|each time)\s*/i

/** 句子/子句切分：按中英文句号、逗号、分号、换行切分。 */
function splitSentences(text: string): string[] {
  return text
    .split(/[\n。；;！!？?，,]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
}

/** 剥离句首元话语前缀（"记得/别忘了/please…"），得到做法核心。 */
function stripHabitPrefix(sentence: string): string {
  return sentence.replace(HABIT_PREFIX, '').trim()
}

/** 归一化做法短语（去标点空白、小写；保留可读性）。 */
function normalizeHabit(text: string): string {
  return text
    .replace(/[，,、.．:：()（）"“”'‘’\-—_/\\]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/**
 * 从自然语言文本与工具轨迹发现重复做法（EVO-07 核心发现函数，纯函数）。
 * 做法短语 = 子句（含习惯标记词，6..200 字符）剥离元话语前缀后的核心文本，
 * 按归一化聚类；工具信号把 `工具 <name> 反复失败` 计入出现次数。
 * 出现 ≥ minOccurrences（默认 2）即视为重复做法——不再依赖固定类别门槛。
 */
export function discoverHabitCandidates(input: HabitDiscoveryInput): DiscoveredHabit[] {
  const minOccurrences = input.minOccurrences ?? 2
  const counts = new Map<string, { habit: string; count: number; sources: string[] }>()
  const record = (habit: string, source: string, weight = 1): void => {
    const key = normalizeHabit(habit)
    if (key.length < 4) return
    const entry = counts.get(key)
    if (entry) {
      entry.count += weight
      if (!entry.sources.includes(source)) entry.sources.push(source)
    } else {
      counts.set(key, { habit: habit.trim(), count: weight, sources: [source] })
    }
  }

  for (const [index, text] of (input.texts ?? []).entries()) {
    for (const sentence of splitSentences(text)) {
      if (sentence.length < 6 || sentence.length > 200) continue
      if (!HABIT_MARKERS.test(sentence)) continue
      const core = stripHabitPrefix(sentence)
      if (core.length < 4) continue
      record(core, `text#${index}`)
    }
  }
  for (const signal of input.toolSignals ?? []) {
    if (signal.type !== 'tool_repeated_failure') continue
    // attempts 计为出现次数（同一条信号只占一个来源）。
    record(`工具 ${signal.toolName} 反复失败`, signal.signalId, Math.max(1, signal.attempts))
  }

  const habits: DiscoveredHabit[] = []
  for (const entry of counts.values()) {
    if (entry.count < minOccurrences) continue
    habits.push({
      habit: entry.habit,
      count: entry.count,
      sources: entry.sources,
      note: `重复做法「${entry.habit}」出现 ${entry.count} 次（来源: ${entry.sources.join(', ')}）`,
    })
  }
  habits.sort((a, b) => b.count - a.count)
  return habits
}

/** 从发现结果生成可编辑 Skill 草稿正文（EVO-08：Markdown，用户批准前可改）。 */
export function habitProposalContent(habit: DiscoveredHabit): string {
  return [
    `# ${habit.habit}`,
    '',
    '## 做法',
    '',
    habit.habit,
    '',
    '## 使用时机',
    '',
    '（由用户编辑补充：什么场景下应该使用这个做法）',
    '',
    '## 步骤',
    '',
    '（由用户编辑补充：做法的具体执行步骤）',
    '',
    '## 来源',
    '',
    `- 出现次数：${habit.count}`,
    `- 来源：${habit.sources.join(', ')}`,
    '',
  ].join('\n')
}

/* ------------------------------------------------------------------ */
/* AutoSkills 服务                                                      */
/* ------------------------------------------------------------------ */

/** EVO-09：DSH SkillRegistry 最小结构（rc.6；探测用）。 */
interface SkillsRegistryLike {
  get?(name: string, options?: unknown): Promise<{ name?: string; description?: string; content?: string; path?: string } | undefined>
  list?(options?: unknown): Promise<Array<{ name: string; description?: string }>>
}

/** EVO-09：技能运行结果（可读）。 */
export interface SkillRunResult {
  readonly ok: boolean
  readonly error?: string
  readonly summary?: string
  readonly at?: number
  readonly proposalId?: string
}

export interface SkillInstallResult {
  readonly ok: boolean
  readonly name?: string
  readonly installedPath?: string
  readonly source?: string
  readonly error?: string
}

/** AutoSkills 服务。 */
export class AutoSkillsService {
  private readonly file: string
  private proposals: AutoSkillProposal[] = []
  private readonly skillsDir: string
  private ctx: Context | undefined
  private skills: SkillsRegistryLike | undefined
  /** 定时挖掘进行中标志（P1-1：防与手动触发并发写 proposals.json）。 */
  private mining = false

  constructor(readonly config: AutoSkillsConfig) {
    this.file = path.join(config.dataRoot, '.evoresearch-data', 'autoskills.json')
    this.skillsDir = config.skillsDir ?? path.join(config.dataRoot, '.evoresearch-data', 'skills')
    this.load()
  }

  /**
   * EVO-09 接线：保存 ctx 并探测 DSH skills 服务（ctx.get('skills')）。
   * 由插件入口（host/index.ts，队长接线）调用；返回 disposer 置空引用。
   */
  attach(ctx: Context): () => void {
    this.ctx = ctx
    this.skills = ctx.get('skills') as SkillsRegistryLike | undefined
    return () => {
      this.ctx = undefined
      this.skills = undefined
    }
  }

  /** DSH skills 服务是否已探测到（EVO-09）。 */
  skillsAvailable(): boolean {
    return this.skills !== undefined
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
   * P1-1 定时挖掘：遍历全部项目工作区，逐项目跑观测聚类 + 笔记挖掘，
   * 汇总新增提案数。与手动触发互斥（mining 标志；save 已是 tmp+rename 原子写）。
   * @param storeFor 按工作区解析记忆库的回调（MemoryRuntime.storeFor）。
   * @param workspaces 项目目录列表（host 入口传 listProjects(dataRoot) 全路径）。
   * @returns { created, skipped } skipped=true 表示已有一次挖掘在进行。
   */
  async mineAllWorkspaces(storeFor: (workspaceDir: string) => ResearchMemoryStore, workspaces: readonly string[]): Promise<{ created: number; skipped: boolean }> {
    if (this.mining) return { created: 0, skipped: true }
    this.mining = true
    try {
      let created = 0
      for (const workspaceDir of workspaces) {
        try {
          const store = storeFor(workspaceDir)
          // 观测聚类（§42.7 固定规则）
          created += this.generateFromObservations(store, workspaceDir)
          // EVO-07 笔记/轨迹挖掘：从项目笔记正文发现重复做法
          const notes = this.readNoteTexts(workspaceDir)
          if (notes.length > 0) {
            created += this.generateFromTraces({ texts: notes, workspaceDir })
          }
        } catch (error) {
          // 单项目失败不阻断其余项目
          console.warn(`[evoresearch:autoskills] 定时挖掘跳过 ${workspaceDir}: ${String(error)}`)
        }
      }
      return { created, skipped: false }
    } finally {
      this.mining = false
    }
  }

  /** 读取某工作区研究笔记正文（P1-1 挖掘输入；目录缺失返回空）。 */
  private readNoteTexts(workspaceDir: string): string[] {
    const notesDir = path.join(workspaceDir || this.config.dataRoot, '.evoresearch-data', 'memories', 'notes')
    const texts: string[] = []
    try {
      for (const entry of fs.readdirSync(notesDir)) {
        if (!entry.endsWith('.md')) continue
        try {
          const stat = fs.statSync(path.join(notesDir, entry))
          if (!stat.isFile() || stat.size > 256 * 1024) continue
          texts.push(fs.readFileSync(path.join(notesDir, entry), 'utf8'))
        } catch { /* 单文件不可读跳过 */ }
      }
    } catch { /* 目录不存在 */ }
    return texts
  }

  /**
   * 从记忆库生成技能提案（§42.7 兼容路径，保留固定聚类规则）：
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

  /**
   * 从自然语言笔记/聊天/工具轨迹发现重复做法并生成 Skill 草稿（EVO-07）：
   * 不再依赖"≥3 条同类 Observation 且 ≥2 条 method/experiment"门槛，改为
   * 归一化做法短语出现 ≥ minOccurrences（默认 2）即提案；同一做法不重复提案
   * （clusterHash = 归一化短语哈希）。
   * @param input 文本/工具信号（由调用方收集；收集点见 api-integration-evo.md）。
   * @returns 新生成的提案数。
   */
  generateFromTraces(input: HabitDiscoveryInput & { workspaceDir?: string }): number {
    const habits = discoverHabitCandidates(input)
    const processedHashes = new Set(
      this.proposals
        .map((p) => p.clusterHash)
        .filter((h): h is string => typeof h === 'string' && h.length > 0),
    )
    let created = 0
    for (const habit of habits) {
      const hash = createHash('sha256').update(`habit:${normalizeHabit(habit.habit)}`).digest('hex').slice(0, 16)
      if (processedHashes.has(hash)) continue
      const name = `habit-${hash.slice(0, 8)}`
      const proposal: AutoSkillProposal = {
        proposalId: `a-${randomUUID().slice(0, 8)}`,
        name,
        description: `从自然语言笔记/工具轨迹发现的重复做法（出现 ${habit.count} 次）：${habit.habit}`,
        action: 'create',
        content: habitProposalContent(habit),
        sourceObservationIds: habit.sources,
        clusterHash: hash,
        workspaceDir: input.workspaceDir,
        status: 'pending',
        createdAt: Date.now(),
      }
      this.proposals.push(proposal)
      processedHashes.add(hash)
      created += 1
    }
    if (created > 0) this.save()
    return created
  }

  /**
   * 编辑 Skill 草稿（EVO-08）：pending 提案的正文保持 Markdown 可编辑，
   * 批准时安装编辑后的内容。
   */
  updateProposalContent(proposalId: string, content: string): boolean {
    const proposal = this.proposals.find((p) => p.proposalId === proposalId)
    if (!proposal || proposal.status !== 'pending') return false
    if (String(content).trim().length === 0) return false
    proposal.content = String(content)
    this.save()
    return true
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

  /**
   * 从 Git 仓库安装一个用户明确指定的 Skill（PLAT-09）。不使用 shell，
   * 只接受仓库中根目录的 SKILL.md，并把来源写入 manifest；目标已存在时
   * 拒绝覆盖，避免更新操作悄悄替换已安装技能。
   */
  installFromGit(source: string, requestedName?: string): SkillInstallResult {
    const url = String(source).trim()
    if (url === '') return { ok: false, error: 'Git Skill 来源不能为空' }
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'evoresearch-skill-'))
    try {
      execFileSync('git', ['clone', '--depth', '1', url, temp], {
        stdio: 'pipe',
        windowsHide: true,
        encoding: 'utf8',
        timeout: 120_000,
      })
      const skillFile = path.join(temp, 'SKILL.md')
      if (!fs.existsSync(skillFile)) return { ok: false, error: 'Git 仓库根目录缺少 SKILL.md' }
      const content = fs.readFileSync(skillFile, 'utf8').trim()
      if (content === '') return { ok: false, error: 'SKILL.md 为空' }
      const frontmatterName = /^name:\s*([^\n\r]+)$/mi.exec(content)?.[1]?.trim()
      const name = slugifySkillName(requestedName ?? frontmatterName ?? path.basename(url, '.git'))
      const dir = path.join(this.skillsDir, name)
      if (fs.existsSync(dir)) return { ok: false, error: `技能已存在: ${name}` }
      fs.mkdirSync(dir, { recursive: true })
      fs.copyFileSync(skillFile, path.join(dir, 'SKILL.md'))
      fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
        name,
        status: 'installed',
        source: url,
        sourceType: 'git',
        installedAt: new Date().toISOString(),
        installedPath: dir,
      }, null, 2), 'utf8')
      return { ok: true, name, installedPath: dir, source: url }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      return { ok: false, error: `Git Skill 安装失败: ${detail.slice(0, 500)}` }
    } finally {
      try { fs.rmSync(temp, { recursive: true, force: true }) } catch { /* 临时目录清理失败不影响安装结果 */ }
    }
  }

  reject(proposalId: string): boolean {
    const proposal = this.proposals.find((p) => p.proposalId === proposalId)
    if (!proposal || proposal.status !== 'pending') return false
    proposal.status = 'rejected'
    this.save()
    return true
  }

  /**
   * 运行一次已批准技能（EVO-09）：接入真实 DSH Skill 注册表执行。
   * - 探测 ctx.get('skills')（attach 时）；探测不到 → 返回 { ok: false, error }；
   * - 读取已安装 SKILL.md，调用 skills.get(name) 确认在注册表装载；
   * - 记录可读执行结果到 evolution/skill-runs.jsonl（追加）。
   * DSH SkillRegistry 不提供模型执行入口（执行 = 模型经 skill 工具读取正文），
   * 因此"执行"= 装载验证 + 生成可读执行指令并留痕。
   */
  async runSkill(proposalId: string): Promise<SkillRunResult> {
    const at = Date.now()
    const proposal = this.proposals.find((p) => p.proposalId === proposalId)
    if (!proposal) return { ok: false, error: `提案不存在: ${proposalId}`, at, proposalId }
    if (proposal.status !== 'approved') return { ok: false, error: `提案 ${proposalId} 未批准，无法运行`, at, proposalId }
    if (!this.skills) {
      return {
        ok: false,
        error: 'DSH skills 服务不可用（插件入口未调用 autoskills.attach(ctx)，或当前运行环境未装配 SkillRegistry）',
        at,
        proposalId,
      }
    }
    const name = slugifySkillName(proposal.name)
    const skillDir = proposal.installedPath ?? path.join(this.skillsDir, name)
    const skillFile = path.join(skillDir, 'SKILL.md')
    if (!fs.existsSync(skillFile)) {
      return { ok: false, error: `技能文件不存在: ${skillFile}（请先批准提案）`, at, proposalId }
    }
    // 装载验证：get 优先，list 兜底。
    let loaded: { name?: string; description?: string; content?: string; path?: string } | undefined
    if (typeof this.skills.get === 'function') {
      try {
        loaded = await this.skills.get(name)
      } catch {
        loaded = undefined
      }
    }
    if (loaded === undefined && typeof this.skills.list === 'function') {
      try {
        const entries = await this.skills.list()
        loaded = entries.find((entry) => entry.name === name)
      } catch {
        loaded = undefined
      }
    }
    if (loaded === undefined) {
      return { ok: false, error: `技能 ${name} 未在 DSH SkillRegistry 中装载（SKILL.md 已安装但注册表不可见）`, at, proposalId }
    }
    const content = fs.readFileSync(skillFile, 'utf8')
    const summary = `技能 ${name} 已在 DSH SkillRegistry 装载（${loaded.path ?? skillDir}，正文 ${content.length} 字符）；` +
      `执行方式：模型通过 skill 工具读取该技能正文后按其步骤执行。`
    // 可读运行结果留痕（追加式）。
    this.appendRunRecord({ at, proposalId, name, loaded: true, summary })
    return { ok: true, summary, at, proposalId }
  }

  /** 追加运行记录（EVO-09 可读结果）。 */
  private appendRunRecord(record: { at: number; proposalId: string; name: string; loaded: boolean; summary: string }): void {
    const file = path.join(this.config.dataRoot, '.evoresearch-data', 'evolution', 'skill-runs.jsonl')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.appendFileSync(file, `${JSON.stringify(record)}\n`, 'utf8')
  }

  /**
   * 同步兼容壳（Remote autoskillsRun 仍走这里）：已批准且 skills 可用时
   * 触发 runSkill 异步执行并返回 true；探测不到 skills 返回 false 并给出
   * 明确告警（EVO-09：探测不到返回明确错误；结构化错误见 runSkill）。
   */
  run(proposalId: string): boolean {
    const proposal = this.proposals.find((p) => p.proposalId === proposalId)
    if (!proposal || proposal.status !== 'approved') return false
    if (!this.skills) {
      console.warn(`[evoresearch:autoskills] 运行技能 ${proposal.name} 失败：DSH skills 服务不可用（插件入口未调用 autoskills.attach(ctx)）`)
      return false
    }
    void this.runSkill(proposalId).then((result) => {
      if (!result.ok) console.warn(`[evoresearch:autoskills] 技能 ${proposal.name} 运行失败: ${result.error ?? '未知错误'}`)
    })
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
