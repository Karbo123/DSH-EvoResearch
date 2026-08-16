/**
 * 轨迹面板（§轨迹：复刻 DSH 官方 Trajectory 视图，EvoResearch 设计风格）。
 *
 * 数据源：session.events 原始事件日志（客户端镜像，随流式实时追加）：
 *   turn/start → turn/end（回合边界）
 *   step/start → step/end（模型步骤边界）
 *   assistant/chunk(usage)（token 用量累计）
 *   assistant/message（步骤最终文本）
 *   tool/call → tool/result（工具调用与结果）
 *
 * 功能（与 DSH 轨迹一致）：实际时间/等宽两种时长模式、展开/收起回合、
 * 展开/收起调用、轨迹搜索、每步 token 用量、调用参数与结果折叠查看、
 * 实时流式更新。
 */
import { jsx, jsxs, Fragment } from 'react/jsx-runtime'
import { useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { t } from './i18n'
import { ChevronDown, ChevronRight, Search, Timer, Zap, MessageSquareText, Wrench, CheckCircle2, XCircle, CircleDashed } from 'lucide-react'

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

/** 截断长 JSON（参数/结果预览）。 */
function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}…`
}

/** 轨迹面板（toolbar + 回合/步骤/调用时间线）。 */
export function TrajectoryPanel({ session }: { session: any }) {
  const notifier = session?.notifier
  const eventsLen = useSyncExternalStore(
    (onChange: () => void) => (notifier?.subscribe(onChange) ?? (() => {})),
    () => (session?.events?.length ?? 0),
  )
  const turns = useMemo(() => buildTrajectory(session?.events ?? []), [session, eventsLen])

  const [actualTime, setActualTime] = useState(true)
  const [turnsOpen, setTurnsOpen] = useState(true)
  const [callsOpen, setCallsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [openCalls, setOpenCalls] = useState<Set<string>>(new Set())
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

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

  const barWidth = (start: number, end: number | null): string => {
    if (!actualTime) return '100%'
    const dur = Math.max(0, (end ?? Date.now()) - start)
    return `${Math.max(3, Math.round((dur / maxDuration) * 100))}%`
  }

  const q = query.trim().toLowerCase()
  const matchCall = (call: TrajCall): boolean =>
    q === '' || call.name.toLowerCase().includes(q) || call.args.toLowerCase().includes(q) || call.result.toLowerCase().includes(q)
  const matchStep = (step: TrajStep): boolean => q === '' || step.text.toLowerCase().includes(q) || step.calls.some(matchCall)
  const matchTurn = (turn: TrajTurn): boolean => q === '' || turn.userText.toLowerCase().includes(q) || turn.steps.some(matchStep)

  const toggleCall = (callId: string) => {
    setOpenCalls((prev) => {
      const next = new Set(prev)
      if (next.has(callId)) next.delete(callId)
      else next.add(callId)
      return next
    })
  }
  const toggleCollapse = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
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
      // ── 工具栏 ──
      jsxs('div', {
        className: 'evo-traj-toolbar',
        children: [
          jsx(Timer, {}),
          jsx('button', {
            type: 'button',
            className: 'evo-traj-chip',
            'data-on': actualTime || undefined,
            onClick: () => setActualTime(true),
            children: t('trajActualTime'),
          }),
          jsx('button', {
            type: 'button',
            className: 'evo-traj-chip',
            'data-on': !actualTime || undefined,
            onClick: () => setActualTime(false),
            children: t('trajEqualWidth'),
          }),
          jsx('span', { className: 'evo-traj-sep' }),
          jsx('button', {
            type: 'button',
            className: 'evo-traj-chip',
            onClick: () => setTurnsOpen((v) => !v),
            children: turnsOpen ? t('trajCollapseTurns') : t('trajExpandTurns'),
          }),
          jsx('button', {
            type: 'button',
            className: 'evo-traj-chip',
            onClick: () => setCallsOpen((v) => !v),
            children: callsOpen ? t('trajCollapseCalls') : t('trajExpandCalls'),
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
          : turns.map((turn) => {
              const turnVisible = matchTurn(turn)
              if (!turnVisible) return null
              const turnKey = `t${turn.turn}`
              const turnOpen = turnsOpen && !collapsed.has(turnKey)
              return jsxs('div', {
                className: 'evo-traj-turn',
                children: [
                  jsxs('div', {
                    className: 'evo-traj-row evo-traj-turn-row',
                    onClick: () => toggleCollapse(turnKey),
                    children: [
                      turnOpen ? jsx(ChevronDown, {}) : jsx(ChevronRight, {}),
                      jsx(MessageSquareText, {}),
                      jsx('span', { className: 'evo-traj-label', children: `${t('turn')} ${turn.turn}` }),
                      jsx('span', { className: 'evo-traj-usertext', children: truncate(turn.userText, 60) }),
                      jsx('span', { className: 'evo-traj-bar', children: jsx('span', { className: 'evo-traj-bar-fill', style: { width: barWidth(turn.start, turn.end) } }) }),
                      jsx('span', { className: 'evo-traj-dur', children: fmtDuration(turn.start, turn.end) }),
                    ],
                  }),
                  turnOpen && turn.steps.map((step) => {
                    const stepKey = `${turnKey}:s${step.step}`
                    const stepVisible = matchStep(step)
                    if (!stepVisible) return null
                    const stepOpen = !collapsed.has(stepKey)
                    return jsxs('div', {
                      className: 'evo-traj-step',
                      children: [
                        jsxs('div', {
                          className: 'evo-traj-row evo-traj-step-row',
                          onClick: () => toggleCollapse(stepKey),
                          children: [
                            stepOpen ? jsx(ChevronDown, {}) : jsx(ChevronRight, {}),
                            jsx(Zap, {}),
                            jsx('span', { className: 'evo-traj-label', children: `${t('step')} ${step.step}` }),
                            step.usage !== null && jsx('span', { className: 'evo-traj-tokens', children: fmtTokens(step.usage) }),
                            jsx('span', { className: 'evo-traj-steptext', children: truncate(step.text, 70) }),
                            jsx('span', { className: 'evo-traj-bar', children: jsx('span', { className: 'evo-traj-bar-fill', style: { width: barWidth(step.start, step.end) } }) }),
                            jsx('span', { className: 'evo-traj-dur', children: fmtDuration(step.start, step.end) }),
                          ],
                        }),
                        stepOpen && step.calls.map((call) => {
                          if (!matchCall(call)) return null
                          const callOpen = callsOpen || openCalls.has(call.callId)
                          const statusIcon = call.end === null ? jsx(CircleDashed, {}) : call.isError ? jsx(XCircle, {}) : jsx(CheckCircle2, {})
                          return jsxs('div', {
                            className: 'evo-traj-call',
                            children: [
                              jsxs('div', {
                                className: 'evo-traj-row evo-traj-call-row',
                                onClick: () => toggleCall(call.callId),
                                children: [
                                  callOpen ? jsx(ChevronDown, {}) : jsx(ChevronRight, {}),
                                  jsx(Wrench, {}),
                                  jsx('span', { className: 'evo-traj-label', children: call.name }),
                                  jsx('span', { className: 'evo-traj-args', children: truncate(call.args, 60) }),
                                  jsx('span', { className: 'evo-traj-status', children: statusIcon }),
                                  jsx('span', { className: 'evo-traj-bar', children: jsx('span', { className: 'evo-traj-bar-fill', style: { width: barWidth(call.start, call.end) } }) }),
                                  jsx('span', { className: 'evo-traj-dur', children: fmtDuration(call.start, call.end) }),
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
                    }, stepKey)
                  }),
                ],
              }, turnKey)
            }),
      }),
    ],
  })
}
