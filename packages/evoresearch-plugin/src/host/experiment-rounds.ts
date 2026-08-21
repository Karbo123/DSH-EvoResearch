/**
 * 四阶段科研回合服务（Part B：observe → propose → act → reflect）。
 *
 * 设计原则（借鉴 Proteus）：
 * - 只有"文件"跨阶段存活——阶段间不共享上下文，只共享工作区文件；
 * - 每阶段的产出自动留痕到账本（纪律 1）。
 *
 * 目录布局：<project>/experiments/<slug>/rounds/<roundId>/<phase>.md
 * 状态持久化：<expDir>/.evoresearch-rounds.json（原子写 tmp+rename）
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { ExperimentWorkspaceService } from './experiment-workspace.js'

export type RoundPhaseId = 'observe' | 'propose' | 'act' | 'reflect'
export type RoundPhaseStatus = 'pending' | 'running' | 'done'

export interface RoundPhase {
  id: RoundPhaseId
  prompt: string
  status: RoundPhaseStatus
  outputFile?: string
}

export interface ExperimentRound {
  roundId: string
  slug: string
  projectDir: string
  startedAt: number
  phases: RoundPhase[]
  currentIndex: number
  status: 'running' | 'done' | 'cancelled'
}

interface RoundsState {
  version: 1
  nextSeq: number
  current: ExperimentRound | null
  history: ExperimentRound[]
}

export const PHASE_ORDER: readonly RoundPhaseId[] = ['observe', 'propose', 'act', 'reflect'] as const

const PHASE_PROMPTS: Record<RoundPhaseId, string> = {
  observe: '观察现状：总结当前实验的已完成工作、数据与现象，记录关键观察。',
  propose: '提出下一步：基于观察，提出下一步要验证的假设或要做的实验（可列 1-3 个选项）。',
  act: '动手做：执行提议的实验动作（改代码/跑实验/记录结果与日志）。',
  reflect: '沉淀结论：总结本轮得到了什么、遗留什么、下一步是什么（结论/遗留问题/下一步）。',
}

const PHASE_TEMPLATES: Record<RoundPhaseId, string> = {
  observe: `# 观察（observe）

## 已完成
（记录已完成的工作）

## 现象与数据
（关键数据/现象）

## 开放问题
（待澄清的问题）
`,
  propose: `# 提议（propose）

## 候选假设/方案
1. 
2. 
3. 

## 选择与理由
（本轮选择哪一个，为什么）

## 预期结果与验证方式
`,
  act: `# 行动（act）

## 做了什么
（改了哪些文件/跑了哪些命令）

## 结果
（日志摘要/产物位置）

## 产物
- artifacts/：
`,
  reflect: `# 反思（reflect）

## 结论
（本轮得到了什么）

## 遗留问题
（还有什么没搞清）

## 下一步
（下一轮打算做什么）
`,
}

const STATE_FILE = '.evoresearch-rounds.json'

export interface ExperimentRoundsConfig {
  readonly dataRoot: string
  /** 可选实验工作区服务（测试注入） */
  readonly workspace?: ExperimentWorkspaceService
  /** 可选账本服务（用于每阶段留痕） */
  readonly ledger?: { trial(projectDir: string, slug: string, payload: { kind: string; note: string; state?: Record<string, unknown>; createdAt: number }): unknown }
}

export class ExperimentRoundsService {
  readonly dataRoot: string
  private readonly workspace: ExperimentWorkspaceService
  private ledger?: ExperimentRoundsConfig['ledger']

  constructor(config: ExperimentRoundsConfig | string) {
    if (typeof config === 'string') {
      this.dataRoot = config
      this.workspace = new ExperimentWorkspaceService({ dataRoot: config })
    } else {
      this.dataRoot = config.dataRoot
      this.workspace = config.workspace ?? new ExperimentWorkspaceService({ dataRoot: config.dataRoot })
      this.ledger = config.ledger
    }
  }

  /** 注入/替换账本服务（host/index 组装时调用） */
  setLedger(ledger: ExperimentRoundsConfig['ledger']): void {
    this.ledger = ledger
  }

  private expDirOf(projectDir: string, slug: string): string {
    // 复用 ExperimentWorkspaceService 的校验与定位
    return this.workspace.listDetail(projectDir, slug).dir
  }

  private stateFile(expDir: string): string {
    return path.join(expDir, STATE_FILE)
  }

  private roundsRoot(expDir: string): string {
    return path.join(expDir, 'rounds')
  }

  private roundDir(expDir: string, roundId: string): string {
    return path.join(this.roundsRoot(expDir), roundId)
  }

  private loadState(expDir: string): RoundsState {
    const file = this.stateFile(expDir)
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<RoundsState>
      if (typeof raw?.nextSeq === 'number' && Array.isArray(raw?.history)) {
        return {
          version: 1,
          nextSeq: Math.max(1, Math.floor(raw.nextSeq)),
          current: raw.current !== undefined && raw.current !== null ? (raw.current as ExperimentRound) : null,
          history: raw.history as ExperimentRound[],
        }
      }
    } catch {
      // 不存在或损坏 → 视为空状态
    }
    return { version: 1, nextSeq: 1, current: null, history: [] }
  }

  private saveState(expDir: string, state: RoundsState): void {
    const file = this.stateFile(expDir)
    const tmp = `${file}.tmp-${process.pid}-${Date.now().toString(36)}`
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8')
    fs.renameSync(tmp, file)
  }

  /** 启动一个新回合（四阶段初始化，不执行内容生成，只建目录与占位文件）。 */
  start(projectDir: string, slug: string): ExperimentRound {
    const expDir = this.expDirOf(projectDir, slug)
    const state = this.loadState(expDir)
    if (state.current !== null && state.current.status === 'running') {
      throw new Error(`已有进行中的回合: ${state.current.roundId}，请先完成或取消`)
    }
    const seq = state.nextSeq
    const roundId = `round-${seq}`
    const startedAt = Date.now()
    const dir = this.roundDir(expDir, roundId)
    fs.mkdirSync(dir, { recursive: true })

    const phases: RoundPhase[] = PHASE_ORDER.map((id, idx) => ({
      id,
      prompt: PHASE_PROMPTS[id]!,
      status: idx === 0 ? 'running' : 'pending',
      outputFile: path.join(dir, `${id}.md`),
    }))

    // 写入每阶段模板骨架（若文件不存在则创建）
    for (const phase of phases) {
      const file = phase.outputFile!
      if (!fs.existsSync(file)) {
        fs.writeFileSync(file, PHASE_TEMPLATES[phase.id]!, 'utf8')
      }
    }

    const round: ExperimentRound = {
      roundId,
      slug,
      projectDir,
      startedAt,
      phases,
      currentIndex: 0,
      status: 'running',
    }

    state.current = round
    state.nextSeq = seq + 1
    this.saveState(expDir, state)
    return round
  }

  /** 得到当前回合（未完成时返回，完成/无时返回 null）。 */
  current(projectDir: string, slug: string): ExperimentRound | null {
    const expDir = this.expDirOf(projectDir, slug)
    const state = this.loadState(expDir)
    if (state.current !== null && state.current.status === 'running') return state.current
    return null
  }

  /** 列出全部回合（含历史），按 startedAt 倒序（前端可选）。 */
  list(projectDir: string, slug: string): ExperimentRound[] {
    const expDir = this.expDirOf(projectDir, slug)
    const state = this.loadState(expDir)
    const all = [...state.history]
    if (state.current !== null) all.push(state.current)
    // running 在最前，其余按 startedAt 倒序
    return all.sort((a, b) => b.startedAt - a.startedAt)
  }

  /**
   * 标记某阶段完成（输出文件写入后调用），阶段全部完成则回合 done。
   * 会自动把内容写文件，并尝试调 ledger.trial 留痕（失败不阻塞）。
   */
  completePhase(projectDir: string, slug: string, phaseId: string, outputText: string): { ok: true; round: ExperimentRound } {
    const expDir = this.expDirOf(projectDir, slug)
    const state = this.loadState(expDir)
    const round = state.current
    if (round === null || round.status !== 'running') {
      throw new Error('当前没有进行中的回合')
    }
    if (!PHASE_ORDER.includes(phaseId as RoundPhaseId)) {
      throw new Error(`非法的阶段: ${phaseId}`)
    }
    const expected = round.phases[round.currentIndex]?.id
    if (expected !== phaseId) {
      throw new Error(`当前阶段是 ${expected}，不能完成 ${phaseId}`)
    }
    const phase = round.phases[round.currentIndex]!
    const file = phase.outputFile ?? path.join(this.roundDir(expDir, round.roundId), `${phaseId}.md`)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    // 若调用方传入非空文本则覆盖模板；空文本保留模板
    const text = String(outputText ?? '')
    if (text.trim() !== '') {
      const tmp = `${file}.tmp-${process.pid}`
      fs.writeFileSync(tmp, text, 'utf8')
      fs.renameSync(tmp, file)
    }
    // 标记 done，推进索引
    phase.status = 'done'
    phase.outputFile = file

    if (round.currentIndex < PHASE_ORDER.length - 1) {
      round.currentIndex += 1
      const next = round.phases[round.currentIndex]!
      next.status = 'running'
    } else {
      // 全部完成
      round.status = 'done'
      // 将完成回合归档到 history，current 清空
      state.history.push({ ...round, phases: round.phases.map((p) => ({ ...p })) })
      // 限制历史保留 50 轮（避免无限增长）
      if (state.history.length > 50) state.history.splice(0, state.history.length - 50)
      state.current = null
      this.saveState(expDir, state)
      this.tryLedgerTrial(projectDir, slug, round.roundId, phaseId, text)
      return { ok: true, round: { ...round, phases: round.phases.map((p) => ({ ...p })) } }
    }

    // 仍有后续阶段：保存 current
    // 深拷贝保存避免引用问题
    state.current = { ...round, phases: round.phases.map((p) => ({ ...p })) }
    this.saveState(expDir, state)
    this.tryLedgerTrial(projectDir, slug, round.roundId, phaseId, text)
    // 返回最新 current
    return { ok: true, round: state.current }
  }

  private tryLedgerTrial(projectDir: string, slug: string, roundId: string, phaseId: string, outputText: string): void {
    if (!this.ledger) return
    try {
      const note = `${roundId} ${phaseId}: ${outputText.slice(0, 80).replace(/\s+/g, ' ').trim() || phaseId}`
      const result = this.ledger.trial(projectDir, slug, {
        kind: 'run',
        note,
        state: { roundId, phaseId, outputPreview: outputText.slice(0, 500) },
        createdAt: Date.now(),
      })
      // ledger trial 可能返回 {ok:false...}，忽略
      void result
    } catch {
      // 留痕失败不阻塞阶段完成
    }
  }

  /** 别名：advance ≡ completePhase（满足任务描述 start/advance/log/list 命名）。 */
  advance(projectDir: string, slug: string, phaseId: string, outputText: string): { ok: true; round: ExperimentRound } {
    return this.completePhase(projectDir, slug, phaseId, outputText)
  }

  /** 别名：log ≡ list（返回全部回合历史，含进行中）。 */
  log(projectDir: string, slug: string): ExperimentRound[] {
    return this.list(projectDir, slug)
  }

  /** 取消当前回合（清空 pending 阶段目录）。 */
  cancel(projectDir: string, slug: string): { ok: true } {
    const expDir = this.expDirOf(projectDir, slug)
    const state = this.loadState(expDir)
    const round = state.current
    if (round === null || round.status !== 'running') {
      throw new Error('当前没有进行中的回合可取消')
    }
    const dir = this.roundDir(expDir, round.roundId)
    // 删除整个回合目录（其余阶段文件一起清理）
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      // 删除失败不阻塞状态清理
    }
    const cancelled: ExperimentRound = { ...round, status: 'cancelled', phases: round.phases.map((p) => ({ ...p })) }
    state.history.push(cancelled)
    if (state.history.length > 50) state.history.splice(0, state.history.length - 50)
    state.current = null
    this.saveState(expDir, state)
    return { ok: true }
  }
}
