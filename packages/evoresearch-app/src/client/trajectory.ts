/**
 * 轨迹面板（§轨迹：复刻 DSH 官方 Trajectory 视图，EvoResearch 设计风格）。
 *
 * 数据源：session.events 原始事件日志（客户端镜像，随流式实时追加）：
 *   turn/start → turn/end、step/start → step/end、assistant/chunk(usage)、
 *   assistant/message、tool/call → tool/result。
 *
 * 交互（用户反馈后重构）：点击行本身即展开/收起，无全局展开按钮；
 * 工具栏保留条长模式（按耗时 / 按回合）与搜索；展开的详情用 Markdown
 * 渲染完整对话文本与工具参数/结果。
 * 按回合：条长归一化表示会话进度——共 n 个回合时，第 k 回合为 (k/n)×100%
 * （首回合 1/n，末回合 100%）；同一回合内的 step/call 行沿用所在回合的进度。
 */
import { jsx, jsxs, Fragment } from 'react/jsx-runtime'
import { useMemo, useState, useSyncExternalStore } from 'react'
import { t } from './i18n'
import { renderMarkdown } from './markdown'
import { ChevronDown, ChevronRight, Search, Timer, Zap, MessageSquareText, Wrench, CheckCircle2, XCircle, CircleDashed, CornerDownRight, User } from 'lucide-react'

interface TrajCall {
  callId: string
  name: string
  args: string
  start: number
  end: number | null
  result: string
  isError: boolean
}
interface TrajStep {
  turn: number
  step: number
  start: number
  end: number | null
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number; reasoning: number } | null
  text: string
  calls: TrajCall[]
}
interface TrajTurn {
  turn: number
  userText: string
  start: number
  end: number | null
  steps: TrajStep[]
}

function resultTextOf(data: any): string {
  const block = Array.isArray(data?.message?.content) ? data.message.content.find((b: any) => b?.type === 'tool-result') : undefined
  const content = block?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map((c: any) => (typeof c === 'string' ? c : String(c?.text ?? ''))).join('\n')
  return ''
}

/** 事件日志 → 轨迹结构（turn/step/call 三级，含时序与用量）。 */
export function buildTrajectory(events: any[]): TrajTurn[] {
  const turns: TrajTurn[] = []
  let openTurn: TrajTurn | null = null
  let openStep: TrajStep | null = null
  let openCall: TrajCall | null = null
  const stepByKey = new Map<string, TrajStep>()
  const callByKey = new Map<string, TrajCall>()
  for (const ev of events ?? []) {
    if (ev === null || typeof ev !== 'object') continue
    const type = ev.type
    const data = ev.data ?? {}
    const time = typeof ev.time === 'number' ? ev.time : Date.now()
    const turnN = typeof data.turn === 'number' ? data.turn : (openTurn?.turn ?? 1)
    const stepN = typeof data.step === 'number' ? data.step : (openStep?.step ?? 1)
    if (type === 'turn/start') {
      openTurn = { turn: turnN, userText: '', start: time, end: null, steps: [] }
      turns.push(openTurn)
      openStep = null
      openCall = null
      continue
    }
    if (type === 'user/message') {
      const text = Array.isArray(data?.content) ? data.content.filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('\n') : ''
      if (openTurn !== null && openTurn.userText === '') openTurn.userText = text
      continue
    }
    if (type === 'step/start') {
      const key = `${turnN}:${stepN}`
      const step: TrajStep = { turn: turnN, step: stepN, start: time, end: null, usage: null, text: '', calls: [] }
      stepByKey.set(key, step)
      openStep = step
      openCall = null
      if (openTurn === null || openTurn.turn !== turnN) {
        openTurn = { turn: turnN, userText: '', start: time, end: null, steps: [] }
        turns.push(openTurn)
      }
      if (!openTurn.steps.includes(step)) openTurn.steps.push(step)
      continue
    }
    if (type === 'assistant/chunk') {
      const chunk = data?.chunk
      if (chunk?.type === 'usage' && openStep !== null) {
        const prev = openStep.usage ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 }
        openStep.usage = {
          input: prev.input + (chunk.usage?.inputTokens ?? 0),
          output: prev.output + (chunk.usage?.outputTokens ?? 0),
          cacheRead: prev.cacheRead + (chunk.usage?.cacheReadTokens ?? 0),
          cacheWrite: prev.cacheWrite + (chunk.usage?.cacheWriteTokens ?? 0),
          reasoning: prev.reasoning + (chunk.usage?.reasoningTokens ?? 0),
        }
      }
      continue
    }
    if (type === 'assistant/message') {
      const text = Array.isArray(data?.message?.content)
        ? data.message.content.filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('\n')
        : ''
      const step = openStep ?? stepByKey.get(`${turnN}:${stepN}`)
      if (step !== undefined && step.text === '') step.text = text
      continue
    }
    if (type === 'tool/call') {
      const call: TrajCall = {
        callId: String(data.callId ?? ''),
        name: String(data.name ?? 'tool'),
        args: typeof data.arguments === 'string' ? data.arguments : JSON.stringify(data.arguments ?? {}),
        start: time,
        end: null,
        result: '',
        isError: false,
      }
      callByKey.set(call.callId, call)
      openCall = call
      const step = openStep ?? stepByKey.get(`${turnN}:${stepN}`)
      if (step !== undefined && !step.calls.includes(call)) step.calls.push(call)
      continue
    }
    if (type === 'tool/result') {
      const callId = data?.message?.source?.callId
      const call = (openCall !== null && openCall.callId === callId) ? openCall : callByKey.get(callId)
      if (call !== undefined) {
        call.end = time
        call.result = resultTextOf(data)
        const block = Array.isArray(data?.message?.content) ? data.message.content.find((b: any) => b?.type === 'tool-result') : undefined
        call.isError = block?.isError === true || data?.error !== undefined
      }
      openCall = null
      continue
    }
    if (type === 'step/end') {
      const step = openStep ?? stepByKey.get(`${turnN}:${stepN}`)
      if (step !== undefined) step.end = time
      openStep = null
      continue
    }
    if (type === 'turn/end') {
      if (openTurn !== null) openTurn.end = time
      openTurn = null
      openStep = null
      continue
    }
  }
  return turns
}

function fmtDuration(start: number, end: number | null): string {
  const ms = (end ?? Date.now()) - start
  if (ms < 0) return '—'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  const min = Math.floor(ms / 60000)
  return `${min}m ${Math.round((ms % 60000) / 1000)}s`
}

function fmtTokens(usage: { input: number; output: number } | null): string {
  if (usage === null) return ''
  return `${usage.input}→${usage.output}`
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}…`
}

/** 轨迹面板：点击行展开/收起，详情 Markdown 渲染。 */
export function TrajectoryPanel({ session }: { session: any }) {
  const notifier = session?.notifier
  const eventsLen = useSyncExternalStore(
    (onChange: () => void) => (notifier?.subscribe(onChange) ?? (() => {})),
    () => (session?.events?.length ?? 0),
  )
  const turns = useMemo(() => buildTrajectory(session?.events ?? []), [session, eventsLen])

  const [barMode, setBarMode] = useState<'duration' | 'turn'>('duration')
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const maxDuration = useMemo(() => {
    let max = 1
    for (const turn of turns) {
      for (const step of turn.steps) {
        max = Math.max(max, (step.end ?? Date.now()) - step.start)
        for (const call of step.calls) max = Math.max(max, (call.end ?? Date.now()) - call.start)
      }
    }
    return max
  }, [turns])

  // 按回合：条长不再表示耗时，而是归一化的会话进度——总回合数为 n 时，
  // 第 k 个回合的条长为 (k/n)×100%（首回合 1/n，末回合 100%）；同一回合内的
  // step/call 行沿用所在回合的进度。3% 下限仅为可见性兜底，不改变归一化语义。
  const totalTurns = turns.length
  const barWidth = (start: number, end: number | null, turnPct?: number): string => {
    if (barMode === 'turn') return `${Math.max(3, Math.round(turnPct ?? 100))}%`
    const dur = Math.max(0, (end ?? Date.now()) - start)
    return `${Math.max(3, Math.round((dur / maxDuration) * 100))}%`
  }
  const durationMs = (start: number, end: number | null): number => Math.max(0, (end ?? Date.now()) - start)

  const q = query.trim().toLowerCase()
  const matchCall = (call: TrajCall): boolean =>
    q === '' || call.name.toLowerCase().includes(q) || call.args.toLowerCase().includes(q) || call.result.toLowerCase().includes(q)
  const matchStep = (step: TrajStep): boolean => q === '' || step.text.toLowerCase().includes(q) || step.calls.some(matchCall)
  const matchTurn = (turn: TrajTurn): boolean => q === '' || turn.userText.toLowerCase().includes(q) || turn.steps.some(matchStep)

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }
  const jumpToChat = () => {
    window.dispatchEvent(new CustomEvent('evo-traj-jump-chat'))
  }

  const totalTokens = useMemo(() => {
    let input = 0
    let output = 0
    for (const turn of turns) for (const step of turn.steps) {
      if (step.usage === null) continue
      input += step.usage.input
      output += step.usage.output
    }
    return { input, output }
  }, [turns])

  return jsxs('div', {
    className: 'evo-traj',
    children: [
      // ── 工具栏：时长模式 + 汇总 + 搜索（无全局展开按钮，点击行即展开）──
      jsxs('div', {
        className: 'evo-traj-toolbar',
        children: [
          jsx(Timer, {}),
          jsxs('div', {
            className: 'evo-traj-seg',
            children: [
              jsx('button', {
                type: 'button',
                className: 'evo-traj-chip',
                'data-on': barMode === 'duration' || undefined,
                title: t('trajActualTimeHint'),
                onClick: () => setBarMode('duration'),
                children: t('trajActualTime'),
              }),
              jsx('button', {
                type: 'button',
                className: 'evo-traj-chip',
                'data-on': barMode === 'turn' || undefined,
                title: t('trajByTurnHint'),
                onClick: () => setBarMode('turn'),
                children: t('trajByTurn'),
              }),
            ],
          }),
          jsx('span', { style: { flex: 1 } }),
          jsx('span', { className: 'evo-traj-totals', children: `Σ ${totalTokens.input}→${totalTokens.output} tokens` }),
          jsxs('div', {
            className: 'evo-traj-search',
            children: [
              jsx(Search, {}),
              jsx('input', {
                type: 'text',
                className: 'evo-traj-search-input',
                placeholder: t('trajSearch'),
                value: query,
                onInput: (e) => setQuery(e.currentTarget.value),
              }),
            ],
          }),
        ],
      }),
      // ── 时间线 ──
      jsx('div', {
        className: 'evo-traj-body',
        children: turns.length === 0
          ? jsx('div', { className: 'evo-traj-empty', children: t('trajEmpty') })
          : turns.map((turn, ti) => {
              if (!matchTurn(turn)) return null
              const turnKey = `t${turn.turn}`
              const turnOpen = expanded.has(turnKey) || q !== ''
              // 按回合：第 k 个回合（k = ti+1）的归一化进度 = (k/n)×100%
              const turnPct = totalTurns === 0 ? 100 : ((ti + 1) / totalTurns) * 100
              return jsxs('div', {
                className: 'evo-traj-turn',
                children: [
                  jsxs('div', {
                    className: 'evo-traj-row evo-traj-turn-row',
                    title: t('trajClickExpand'),
                    onClick: () => toggle(turnKey),
                    children: [
                      turnOpen ? jsx(ChevronDown, {}) : jsx(ChevronRight, {}),
                      jsx(MessageSquareText, {}),
                      jsx('span', { className: 'evo-traj-label', children: `${t('turn')} ${turn.turn}` }),
                      jsx('span', { className: 'evo-traj-usertext', children: truncate(turn.userText, 60) }),
                      jsx('span', { className: 'evo-traj-bar', children: jsx('span', { className: 'evo-traj-bar-fill', style: { width: barWidth(turn.start, turn.end, turnPct) } }) }),
                      jsx('span', { className: 'evo-traj-dur', children: fmtDuration(turn.start, turn.end) }),
                    ],
                  }),
                  turnOpen && jsxs('div', {
                    className: 'evo-traj-turn-body',
                    children: [
                      turn.userText !== '' && jsxs('div', {
                        className: 'evo-traj-quote',
                        children: [
                          jsxs('div', { className: 'evo-traj-quote-head', children: [jsx(User, {}), jsx('span', { children: t('trajUserMessage') })] }),
                          jsx('div', { className: 'evo-md', dangerouslySetInnerHTML: { __html: renderMarkdown(turn.userText) } }),
                        ],
                      }),
                      turn.steps.map((step) => {
                        if (!matchStep(step)) return null
                        const stepKey = `${turnKey}:s${step.step}`
                        const stepOpen = expanded.has(stepKey) || q !== ''
                        const slow = durationMs(step.start, step.end) > 3000
                        return jsxs('div', {
                          className: 'evo-traj-step',
                          children: [
                            jsxs('div', {
                              className: 'evo-traj-row evo-traj-step-row',
                              title: t('trajClickExpand'),
                              onClick: () => toggle(stepKey),
                              children: [
                                stepOpen ? jsx(ChevronDown, {}) : jsx(ChevronRight, {}),
                                jsx(Zap, {}),
                                jsx('span', { className: 'evo-traj-label', children: `${t('step')} ${step.step}` }),
                                step.usage !== null && jsx('span', { className: 'evo-traj-tokens', children: fmtTokens(step.usage) }),
                                jsx('span', { className: 'evo-traj-steptext', children: truncate(step.text, 70) }),
                                jsx('span', { className: 'evo-traj-bar', children: jsx('span', { className: 'evo-traj-bar-fill', style: { width: barWidth(step.start, step.end, turnPct) } }) }),
                                jsx('span', { className: `evo-traj-dur${slow ? ' slow' : ''}`, children: fmtDuration(step.start, step.end) }),
                              ],
                            }),
                            stepOpen && jsxs('div', {
                              className: 'evo-traj-step-body',
                              children: [
                                // 完整对话文本（Markdown 渲染）
                                step.text !== '' && jsxs('div', {
                                  className: 'evo-traj-detail',
                                  children: [
                                    jsxs('div', {
                                      className: 'evo-traj-detail-head',
                                      children: [
                                        jsx('span', { children: t('trajStepText') }),
                                        jsx('span', { style: { flex: 1 } }),
                                        jsx('button', {
                                          type: 'button',
                                          className: 'evo-traj-goto',
                                          title: t('trajGotoChat'),
                                          onClick: (e: { stopPropagation(): void }) => { e.stopPropagation(); jumpToChat() },
                                          children: jsxs(Fragment, { children: [jsx(CornerDownRight, {}), jsx('span', { children: t('trajGotoChat') })] }),
                                        }),
                                      ],
                                    }),
                                    jsx('div', { className: 'evo-md', dangerouslySetInnerHTML: { __html: renderMarkdown(step.text) } }),
                                    step.usage !== null && jsx('div', {
                                      className: 'evo-traj-meta',
                                      children: `${t('trajTokens')}: ${step.usage.input}→${step.usage.output}（${t('trajCacheRead')} ${step.usage.cacheRead}，${t('trajReasoning')} ${step.usage.reasoning}）`,
                                    }),
                                  ],
                                }),
                                step.calls.map((call) => {
                                  if (!matchCall(call)) return null
                                  const callOpen = expanded.has(call.callId)
                                  const statusIcon = call.end === null ? jsx(CircleDashed, {}) : call.isError ? jsx(XCircle, {}) : jsx(CheckCircle2, {})
                                  const callSlow = durationMs(call.start, call.end) > 3000
                                  return jsxs('div', {
                                    className: 'evo-traj-call',
                                    children: [
                                      jsxs('div', {
                                        className: 'evo-traj-row evo-traj-call-row',
                                        title: t('trajClickExpand'),
                                        onClick: () => toggle(call.callId),
                                        children: [
                                          callOpen ? jsx(ChevronDown, {}) : jsx(ChevronRight, {}),
                                          jsx(Wrench, {}),
                                          jsx('span', { className: 'evo-traj-label', children: call.name }),
                                          jsx('span', { className: 'evo-traj-args', children: truncate(call.args, 60) }),
                                          jsx('span', { className: `evo-traj-status${call.isError ? ' error' : ''}`, children: statusIcon }),
                                          jsx('span', { className: 'evo-traj-bar', children: jsx('span', { className: 'evo-traj-bar-fill', style: { width: barWidth(call.start, call.end, turnPct) } }) }),
                                          jsx('span', { className: `evo-traj-dur${callSlow ? ' slow' : ''}`, children: fmtDuration(call.start, call.end) }),
                                        ],
                                      }),
                                      callOpen && jsxs('div', {
                                        className: 'evo-traj-call-detail',
                                        children: [
                                          call.args !== '' && jsxs(Fragment, {
                                            children: [
                                              jsx('div', { className: 'evo-traj-detail-head', children: t('trajArgs') }),
                                              jsx('pre', { className: 'evo-traj-detail-pre', children: truncate(call.args, 2000) }),
                                            ],
                                          }),
                                          (call.result !== '' || call.end === null) && jsxs(Fragment, {
                                            children: [
                                              jsx('div', { className: 'evo-traj-detail-head', children: t('trajResult') }),
                                              jsx('pre', { className: `evo-traj-detail-pre${call.isError ? ' error' : ''}`, children: call.end === null ? '…' : truncate(call.result, 3000) }),
                                            ],
                                          }),
                                        ],
                                      }),
                                    ],
                                  }, call.callId)
                                }),
                              ],
                            }),
                          ],
                        }, stepKey)
                      }),
                    ],
                  }),
                ],
              }, turnKey)
            }),
      }),
    ],
  })
}
