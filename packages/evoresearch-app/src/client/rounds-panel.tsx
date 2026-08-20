/**
 * 科研回合面板（Part B：observe → propose → act → reflect 四阶段回合模板）。
 *
 * 每个实验（experiment workspace 的 slug）可拥有多个回合，当前仅展示
 * "正在进行中的回合"（current），完成后自动归档。回合结构与文件
 * 落盘由后端的 ExperimentRoundsService 负责；前端仅调接口并展示进度。
 *
 * 后端接口（若未实现则优雅降级为"服务不可用"提示）：
 * - experiment-rounds-current  { projectDir, slug } -> ExperimentRound | null
 * - experiment-rounds-start    { projectDir, slug } -> ExperimentRound
 * - experiment-rounds-complete { projectDir, slug, phaseId, outputText } -> { ok, round }
 * - experiment-rounds-cancel   { projectDir, slug } -> { ok }
 */
import { jsx, jsxs, Fragment } from 'react/jsx-runtime'
import { useEffect, useState } from 'react'
import { t } from './i18n'
import { FlaskConical, Play, X as XIcon, Check, Eye, Loader2, Sparkles, RotateCcw } from 'lucide-react'

export interface RoundPhase {
  id: 'observe' | 'propose' | 'act' | 'reflect'
  prompt: string
  status: 'pending' | 'running' | 'done'
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

async function api<T>(method: string, body: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`/evoresearch/fs/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await res.json()
  if (!json.ok) throw new Error(json.error?.message ?? t('requestFailed'))
  return json.value as T
}

function fmtTime(ts: number): string {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const PHASE_META: Record<RoundPhase['id'], { labelKey: string; step: string }> = {
  observe: { labelKey: 'roundsObserve', step: '①' },
  propose: { labelKey: 'roundsPropose', step: '②' },
  act: { labelKey: 'roundsAct', step: '③' },
  reflect: { labelKey: 'roundsReflect', step: '④' },
}

const PHASE_PROMPT_KEYS: Record<RoundPhase['id'], string> = {
  observe: 'roundsPromptObserve',
  propose: 'roundsPromptPropose',
  act: 'roundsPromptAct',
  reflect: 'roundsPromptReflect',
}

export function RoundsPanel({ workspaceDir, slug, onError, onNotice }: {
  workspaceDir: string
  slug: string
  onError: (msg: string) => void
  onNotice: (msg: string) => void
}) {
  const [round, setRound] = useState<ExperimentRound | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [viewFile, setViewFile] = useState<{ phaseId: string; content: string } | null>(null)
  const [serviceMissing, setServiceMissing] = useState(false)

  const load = () => {
    setLoading(true)
    void api<ExperimentRound | null>('experiment-rounds-current', { projectDir: workspaceDir, slug })
      .then((r) => {
        setRound(r)
        setServiceMissing(false)
        if (r !== null) {
          const nextDrafts: Record<string, string> = {}
          for (const p of r.phases) {
            if (drafts[p.id] === undefined) nextDrafts[p.id] = ''
          }
          if (Object.keys(nextDrafts).length > 0) setDrafts((prev) => ({ ...nextDrafts, ...prev }))
        }
      })
      .catch((e: any) => {
        const msg = String(e?.message ?? e)
        if (msg.includes('不可用') || msg.includes('not found') || msg.includes('unknown method')) {
          setServiceMissing(true)
        } else {
          onError(msg)
        }
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [workspaceDir, slug])

  const doStart = () => {
    setBusy(true)
    void api<ExperimentRound>('experiment-rounds-start', { projectDir: workspaceDir, slug })
      .then((r) => {
        setRound(r)
        setDrafts({})
        setViewFile(null)
        onNotice(t('roundsStarted'))
      })
      .catch((e: any) => onError(String(e?.message ?? e)))
      .finally(() => setBusy(false))
  }

  const doComplete = (phaseId: string) => {
    const text = drafts[phaseId]?.trim() ?? ''
    if (text === '') {
      onError(t('roundsNeedContent'))
      return
    }
    setBusy(true)
    void api<{ ok: true; round: ExperimentRound }>('experiment-rounds-complete', { projectDir: workspaceDir, slug, phaseId, outputText: text })
      .then((res) => {
        setRound(res.round)
        setDrafts((prev) => ({ ...prev, [phaseId]: '' }))
        onNotice(t('roundsPhaseDone'))
        if (res.round.status === 'done') {
          onNotice(t('roundsAllDone'))
        }
      })
      .catch((e: any) => onError(String(e?.message ?? e)))
      .finally(() => setBusy(false))
  }

  const doCancel = () => {
    setBusy(true)
    void api<{ ok: true }>('experiment-rounds-cancel', { projectDir: workspaceDir, slug })
      .then(() => {
        setRound(null)
        setDrafts({})
        setViewFile(null)
        onNotice(t('roundsCancelled'))
      })
      .catch((e: any) => onError(String(e?.message ?? e)))
      .finally(() => setBusy(false))
  }

  const doView = (phase: RoundPhase) => {
    if (phase.outputFile === undefined || phase.outputFile === '') {
      // fallback: try read via workspace file api
      onError(t('roundsNoOutputFile'))
      return
    }
    void api<{ content: string }>('experiment-workspace-read-note', { workspaceDir, slug })
      .catch(() => null)
    // actual phase file: use generic read via fetch file endpoint
    // We read via /evoresearch/fs/read if outputFile is absolute
    const target = phase.outputFile
    void fetch('/evoresearch/fs/read', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: target }),
    }).then(async (res) => {
      const json = await res.json()
      if (json.ok) setViewFile({ phaseId: phase.id, content: json.value.text ?? json.value.content ?? '' })
      else onError(json.error?.message ?? t('loadFailed'))
    }).catch((e: any) => onError(String(e?.message ?? e)))
  }

  if (loading) {
    return jsxs('div', {
      className: 'evo-ews-section evo-rounds-card',
      children: [
        jsxs('div', { className: 'evo-ews-section-head', children: [jsx(FlaskConical, {}), jsx('span', { children: t('roundsTitle') })] }),
        jsx('div', { className: 'evo-panel-hint', children: t('loading') }),
      ],
    })
  }

  if (serviceMissing) {
    return jsxs('div', {
      className: 'evo-ews-section evo-rounds-card',
      children: [
        jsxs('div', { className: 'evo-ews-section-head', children: [jsx(FlaskConical, {}), jsx('span', { children: t('roundsTitle') })] }),
        jsx('div', { className: 'evo-panel-hint', children: t('roundsServiceMissing') }),
      ],
    })
  }

  if (round === null) {
    return jsxs('div', {
      className: 'evo-ews-section evo-rounds-card',
      children: [
        jsxs('div', {
          className: 'evo-ews-section-head',
          children: [
            jsx(FlaskConical, {}),
            jsx('span', { children: t('roundsTitle') }),
          ],
        }),
        jsx('div', { className: 'evo-panel-hint', children: t('roundsEmptyHint') }),
        jsx('button', {
          type: 'button',
          className: 'evo-panel-add',
          disabled: busy,
          onClick: doStart,
          children: jsxs(Fragment, { children: [jsx(Play, {}), jsx('span', { children: busy ? t('loading') : t('roundsStart') })] }),
        }),
      ],
    })
  }

  const isDone = round.status === 'done'

  return jsxs('div', {
    className: 'evo-ews-section evo-rounds-card',
    children: [
      jsxs('div', {
        className: 'evo-ews-section-head',
        children: [
          jsx(FlaskConical, {}),
          jsx('span', { children: t('roundsTitle') }),
          jsx('span', { className: 'evo-rounds-id', children: `${round.roundId.slice(0, 8)} · ${fmtTime(round.startedAt)}` }),
          jsx('span', { style: { flex: 1 } }),
          !isDone && jsx('button', {
            type: 'button',
            className: 'evo-panel-del',
            title: t('roundsCancel'),
            disabled: busy,
            onClick: doCancel,
            children: jsx(XIcon, {}),
          }),
        ],
      }),
      // progress bar
      jsx('div', {
        className: 'evo-rounds-progress',
        children: round.phases.map((phase) => {
          const meta = PHASE_META[phase.id]
          const isDonePhase = phase.status === 'done'
          const isRunning = phase.status === 'running' || (!isDone && round.phases[round.currentIndex]?.id === phase.id && phase.status !== 'done')
          return jsxs('div', {
            className: 'evo-rounds-step',
            'data-status': phase.status,
            'data-current': isRunning || undefined,
            children: [
              jsx('div', { className: 'evo-rounds-step-num', children: meta.step }),
              jsx('span', { className: 'evo-rounds-step-label', children: t(meta.labelKey) }),
              isDonePhase && jsx(Check, { className: 'evo-rounds-step-check' }),
              isRunning && !isDonePhase && jsx(Loader2, { className: 'evo-rounds-step-spin' }),
            ],
          }, phase.id)
        }),
      }),
      isDone && jsx('div', { className: 'evo-panel-hint evo-rounds-done-hint', children: t('roundsDoneHint') }),
      // phases detail
      jsx('div', {
        className: 'evo-rounds-phases',
        children: round.phases.map((phase) => {
          const meta = PHASE_META[phase.id]
          const isCurrent = round.phases[round.currentIndex]?.id === phase.id
          const isDonePhase = phase.status === 'done'
          const draft = drafts[phase.id] ?? ''
          return jsxs('div', {
            className: 'evo-rounds-phase',
            'data-status': phase.status,
            'data-current': isCurrent || undefined,
            children: [
              jsxs('div', {
                className: 'evo-rounds-phase-head',
                children: [
                  jsx('span', { className: 'evo-rounds-phase-num', children: meta.step }),
                  jsx('span', { className: 'evo-rounds-phase-name', children: t(meta.labelKey) }),
                  jsx('span', { className: 'evo-rounds-phase-status', children: t(phase.status === 'done' ? 'roundsStatusDone' : phase.status === 'running' ? 'roundsStatusRunning' : 'roundsStatusPending') }),
                  isDonePhase && phase.outputFile !== undefined && phase.outputFile !== '' && jsx('button', {
                    type: 'button',
                    className: 'evo-panel-act',
                    title: t('roundsViewOutput'),
                    onClick: () => doView(phase),
                    children: jsx(Eye, {}),
                  }),
                ],
              }),
              jsx('div', { className: 'evo-panel-hint evo-rounds-prompt', children: t(PHASE_PROMPT_KEYS[phase.id]) }),
              isDonePhase
                ? jsx('div', { className: 'evo-rounds-done-row', children: jsxs(Fragment, { children: [
                    jsx('span', { className: 'evo-panel-hint', children: t('roundsPhaseDoneHint') }),
                    jsx('button', { type: 'button', className: 'evo-panel-act', onClick: () => doView(phase), children: jsxs(Fragment, { children: [jsx(Eye, {}), jsx('span', { children: t('roundsViewOutput') })] }) }),
                  ] }) })
                : isCurrent && !isDone
                  ? jsxs('div', {
                      className: 'evo-rounds-editor',
                      children: [
                        jsx('textarea', {
                          className: 'evo-panel-input evo-rounds-textarea',
                          placeholder: t('roundsInputPlaceholder'),
                          value: draft,
                          disabled: busy,
                          onInput: (e) => setDrafts((prev) => ({ ...prev, [phase.id]: e.currentTarget.value })),
                        }),
                        jsxs('div', {
                          className: 'evo-rounds-acts',
                          children: [
                            jsx('button', {
                              type: 'button',
                              className: 'evo-panel-add',
                              disabled: busy || draft.trim() === '',
                              onClick: () => doComplete(phase.id),
                              children: jsxs(Fragment, { children: [jsx(Check, {}), jsx('span', { children: t('roundsCompletePhase') })] }),
                            }),
                            jsx('button', {
                              type: 'button',
                              className: 'evo-panel-act evo-rounds-ai-btn',
                              title: t('roundsAiDraftHint'),
                              disabled: true,
                              children: jsxs(Fragment, { children: [jsx(Sparkles, {}), jsx('span', { children: t('roundsAiDraft') })] }),
                            }),
                          ],
                        }),
                      ],
                    })
                  : jsx('div', { className: 'evo-panel-hint', children: t('roundsWaitingPrev') }),
            ],
          }, phase.id)
        }),
      }),
      viewFile !== null && jsxs('div', {
        className: 'evo-rounds-view',
        children: [
          jsxs('div', {
            className: 'evo-rounds-view-head',
            children: [
              jsx('span', { children: `${t(PHASE_META[viewFile.phaseId as RoundPhase['id']]?.labelKey ?? viewFile.phaseId)} · ${t('roundsViewOutput')}` }),
              jsx('button', { type: 'button', className: 'evo-panel-act', onClick: () => setViewFile(null), children: jsx(XIcon, {}) }),
            ],
          }),
          jsx('pre', { className: 'evo-rounds-view-body', children: viewFile.content }),
        ],
      }),
      isDone && jsx('button', {
        type: 'button',
        className: 'evo-panel-add',
        disabled: busy,
        onClick: doStart,
        children: jsxs(Fragment, { children: [jsx(RotateCcw, {}), jsx('span', { children: t('roundsStartNew') })] }),
      }),
    ],
  })
}
