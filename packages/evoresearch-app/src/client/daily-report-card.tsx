/**
 * 日报卡片（Part C：实验日报 — 手动 + 自动触发）。
 *
 * 入口：实验工作区 Tab 工具栏的「日报」按钮打开本抽屉。
 * 数据来自后端的 DailyReportService：
 * - daily-report-generate  { projectDir, slugs?, llm? } -> DailyReportResult
 * - daily-report-list      {} -> list
 * - daily-report-read      { reportId } -> { markdown }
 * - daily-report-get-schedule {} -> schedule | null
 * - daily-report-set-schedule { schedule } -> { ok, nextRunAt }
 * - daily-report-toggle    { force? } -> { ok, enabled }
 */
import { jsx, jsxs, Fragment } from 'react/jsx-runtime'
import { useEffect, useState } from 'react'
import { t } from './i18n'
import { FileText, X as XIcon, Copy, Check, Clock, Calendar, RefreshCw, Eye, Sparkles } from 'lucide-react'

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

interface DailyReportResult {
  reportId: string
  path: string
  markdown: string
  generatedAt: number
  trigger: 'manual' | 'auto'
}
interface DailyReportSchedule {
  enabled: boolean
  mode: 'interval' | 'daily' | 'weekly'
  intervalMinutes?: number
  cron?: string
  projectDir: string
  slugs?: string[]
  lastRunAt?: number
  nextRunAt?: number
}

export function DailyReportCard({ workspaceDir, onClose, onError }: {
  workspaceDir: string
  onClose: () => void
  onError: (msg: string) => void
}) {
  const [generating, setGenerating] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [schedule, setSchedule] = useState<DailyReportSchedule | null>(null)
  const [scheduleBusy, setScheduleBusy] = useState(false)
  const [mode, setMode] = useState<'interval' | 'daily' | 'weekly'>('interval')
  const [intervalMinutes, setIntervalMinutes] = useState('60')
  const [dailyTime, setDailyTime] = useState('09:00')
  const [weeklyTime, setWeeklyTime] = useState('09:00')
  const [weeklyDay, setWeeklyDay] = useState('1')
  const [list, setList] = useState<Array<{ reportId: string; path: string; generatedAt: number; trigger: string }>>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [selectedContent, setSelectedContent] = useState<string | null>(null)

  const loadSchedule = () => {
    void api<DailyReportSchedule | null>('daily-report-get-schedule', {})
      .then((s) => {
        setSchedule(s)
        if (s !== null) {
          setMode(s.mode)
          if (s.intervalMinutes !== undefined) setIntervalMinutes(String(s.intervalMinutes))
          if (s.cron !== undefined) {
            // parse HH:MM from cron if present: "M H * * * / M H * * W"
            const parts = s.cron.split(' ')
            if (parts.length >= 2) {
              const h = parts[1], m = parts[0]
              const hh = String(h).padStart(2, '0')
              const mm = String(m).padStart(2, '0')
              if (s.mode === 'daily') setDailyTime(`${hh}:${mm}`)
              if (s.mode === 'weekly') { setWeeklyTime(`${hh}:${mm}`); if (parts[4] !== '*') setWeeklyDay(parts[4]) }
            }
          }
        }
      })
      .catch(() => {})
  }
  const loadList = () => {
    void api<Array<{ reportId: string; path: string; generatedAt: number; trigger: string }>>('daily-report-list', {})
      .then(setList)
      .catch(() => {})
  }

  useEffect(() => { loadSchedule(); loadList() }, [workspaceDir])

  const doGenerate = () => {
    setGenerating(true)
    void api<DailyReportResult>('daily-report-generate', { projectDir: workspaceDir })
      .then((r) => {
        setPreview(r.markdown)
        loadList()
      })
      .catch((e: any) => onError(String(e?.message ?? e)))
      .finally(() => setGenerating(false))
  }

  const doToggle = () => {
    setScheduleBusy(true)
    void api<{ ok: boolean; enabled: boolean }>('daily-report-toggle', {})
      .then((r) => {
        setSchedule((prev) => prev === null ? { enabled: r.enabled, mode: 'interval', projectDir: workspaceDir } : { ...prev, enabled: r.enabled })
      })
      .catch((e: any) => onError(String(e?.message ?? e)))
      .finally(() => setScheduleBusy(false))
  }

  const doSaveSchedule = () => {
    let cron: string | undefined
    let iv: number | undefined
    if (mode === 'interval') {
      iv = Number(intervalMinutes)
      if (!Number.isFinite(iv) || iv <= 0) { onError(t('dailyInvalidInterval')); return }
    } else if (mode === 'daily') {
      const [h, m] = dailyTime.split(':').map(Number)
      if (!Number.isFinite(h) || !Number.isFinite(m)) { onError(t('dailyInvalidTime')); return }
      cron = `${m} ${h} * * *`
    } else {
      const [h, m] = weeklyTime.split(':').map(Number)
      if (!Number.isFinite(h) || !Number.isFinite(m)) { onError(t('dailyInvalidTime')); return }
      cron = `${m} ${h} * * ${weeklyDay}`
    }
    setScheduleBusy(true)
    const next: DailyReportSchedule = {
      enabled: schedule?.enabled ?? true,
      mode,
      projectDir: workspaceDir,
      ...(iv !== undefined ? { intervalMinutes: iv } : {}),
      ...(cron !== undefined ? { cron } : {}),
    }
    void api<{ ok: true; nextRunAt: number | null }>('daily-report-set-schedule', { schedule: next } as any)
      .then((r) => {
        setSchedule({ ...next, nextRunAt: r.nextRunAt ?? undefined })
      })
      .catch((e: any) => onError(String(e?.message ?? e)))
      .finally(() => setScheduleBusy(false))
  }

  const doView = (reportId: string) => {
    setSelected(reportId)
    setSelectedContent(null)
    void api<{ markdown: string } | null>('daily-report-read', { reportId })
      .then((r) => {
        if (r !== null) { setSelectedContent(r.markdown); setPreview(r.markdown) }
        else onError(t('dailyReportNotFound'))
      })
      .catch((e: any) => onError(String(e?.message ?? e)))
  }

  const doCopy = () => {
    if (preview === null) return
    void navigator.clipboard.writeText(preview).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }).catch(() => onError(t('copyFailed')))
  }

  return jsxs('div', {
    className: 'evo-report-drawer',
    children: [
      jsx('div', { className: 'evo-report-mask', onClick: onClose }),
      jsxs('div', {
        className: 'evo-report-card',
        children: [
          jsxs('div', {
            className: 'evo-report-head',
            children: [
              jsx(FileText, {}),
              jsx('span', { children: t('dailyReportTitle') }),
              jsx('span', { style: { flex: 1 } }),
              jsx('button', { type: 'button', className: 'evo-panel-act', onClick: onClose, children: jsx(XIcon, {}) }),
            ],
          }),
          jsxs('div', {
            className: 'evo-report-body',
            children: [
              // generate
              jsxs('div', {
                className: 'evo-report-section',
                children: [
                  jsx('button', {
                    type: 'button',
                    className: 'evo-panel-add evo-report-generate',
                    disabled: generating,
                    onClick: doGenerate,
                    children: jsxs(Fragment, { children: [generating ? jsx(RefreshCw, { className: 'evo-spin' }) : jsx(Sparkles, {}), jsx('span', { children: generating ? t('dailyGenerating') : t('dailyGenerateNow') })] }),
                  }),
                  preview !== null && jsxs('div', {
                    className: 'evo-report-preview-wrap',
                    children: [
                      jsxs('div', {
                        className: 'evo-report-preview-head',
                        children: [
                          jsx('span', { className: 'evo-panel-row-label', children: t('dailyPreview') }),
                          jsx('button', {
                            type: 'button',
                            className: 'evo-panel-act',
                            onClick: doCopy,
                            title: t('copy'),
                            children: copied ? jsx(Check, {}) : jsx(Copy, {}),
                          }),
                        ],
                      }),
                      jsx('pre', { className: 'evo-report-preview', children: preview }),
                    ],
                  }),
                ],
              }),
              // schedule
              jsxs('div', {
                className: 'evo-report-section',
                children: [
                  jsxs('div', {
                    className: 'evo-report-section-head',
                    children: [
                      jsx(Clock, {}),
                      jsx('span', { children: t('dailySchedule') }),
                      jsx('span', { style: { flex: 1 } }),
                      jsx('label', {
                        className: 'evo-ews-check',
                        children: [
                          jsx('input', {
                            type: 'checkbox',
                            checked: schedule?.enabled ?? false,
                            disabled: scheduleBusy,
                            onChange: doToggle,
                          }),
                          t('dailyEnable'),
                        ],
                      }),
                    ],
                  }),
                  jsxs('div', {
                    className: 'evo-report-modes',
                    children: [
                      jsx('button', { type: 'button', className: 'evo-traj-chip', 'data-on': mode === 'interval' || undefined, onClick: () => setMode('interval'), children: t('dailyModeInterval') }),
                      jsx('button', { type: 'button', className: 'evo-traj-chip', 'data-on': mode === 'daily' || undefined, onClick: () => setMode('daily'), children: t('dailyModeDaily') }),
                      jsx('button', { type: 'button', className: 'evo-traj-chip', 'data-on': mode === 'weekly' || undefined, onClick: () => setMode('weekly'), children: t('dailyModeWeekly') }),
                    ],
                  }),
                  mode === 'interval' && jsxs('div', {
                    className: 'evo-panel-form',
                    children: [
                      jsx('input', {
                        type: 'number',
                        className: 'evo-panel-input',
                        value: intervalMinutes,
                        min: 1,
                        onInput: (e) => setIntervalMinutes(e.currentTarget.value),
                      }),
                      jsx('span', { className: 'evo-panel-hint', children: t('dailyMinutes') }),
                    ],
                  }),
                  mode === 'daily' && jsx('input', {
                    type: 'time',
                    className: 'evo-panel-input',
                    value: dailyTime,
                    onInput: (e) => setDailyTime(e.currentTarget.value),
                  }),
                  mode === 'weekly' && jsxs('div', {
                    className: 'evo-panel-form',
                    children: [
                      jsx('select', {
                        className: 'evo-panel-input',
                        value: weeklyDay,
                        onChange: (e) => setWeeklyDay(e.currentTarget.value),
                        children: [
                          jsx('option', { value: '1', children: t('weekdayMon') }),
                          jsx('option', { value: '2', children: t('weekdayTue') }),
                          jsx('option', { value: '3', children: t('weekdayWed') }),
                          jsx('option', { value: '4', children: t('weekdayThu') }),
                          jsx('option', { value: '5', children: t('weekdayFri') }),
                          jsx('option', { value: '6', children: t('weekdaySat') }),
                          jsx('option', { value: '0', children: t('weekdaySun') }),
                        ],
                      }),
                      jsx('input', {
                        type: 'time',
                        className: 'evo-panel-input',
                        value: weeklyTime,
                        onInput: (e) => setWeeklyTime(e.currentTarget.value),
                      }),
                    ],
                  }),
                  jsxs('div', {
                    className: 'evo-panel-form',
                    children: [
                      jsx('button', {
                        type: 'button',
                        className: 'evo-panel-add',
                        disabled: scheduleBusy,
                        onClick: doSaveSchedule,
                        children: jsx('span', { children: scheduleBusy ? t('saving') : t('save') }),
                      }),
                      schedule?.nextRunAt !== undefined && schedule.nextRunAt !== null && jsx('span', { className: 'evo-panel-hint', children: `${t('nextRun')}: ${fmtTime(schedule.nextRunAt)}` }),
                    ],
                  }),
                ],
              }),
              // history
              jsxs('div', {
                className: 'evo-report-section',
                children: [
                  jsxs('div', {
                    className: 'evo-report-section-head',
                    children: [
                      jsx(Calendar, {}),
                      jsx('span', { children: t('dailyHistory') }),
                      jsx('span', { style: { flex: 1 } }),
                      jsx('button', { type: 'button', className: 'evo-panel-act', title: t('refresh'), onClick: loadList, children: jsx(RefreshCw, {}) }),
                    ],
                  }),
                  list.length === 0
                    ? jsx('div', { className: 'evo-panel-hint', children: t('dailyNoReports') })
                    : jsx('div', {
                        className: 'evo-report-list',
                        children: list.map((row) => jsxs('div', {
                          className: 'evo-report-row',
                          'data-active': selected === row.reportId || undefined,
                          children: [
                            jsxs('div', {
                              className: 'evo-report-row-main',
                              children: [
                                jsx('span', { className: 'evo-report-row-time', children: fmtTime(row.generatedAt) }),
                                jsx('span', { className: `evo-report-badge ${row.trigger}`, children: row.trigger === 'auto' ? t('dailyAuto') : t('dailyManual') }),
                              ],
                            }),
                            jsx('button', {
                              type: 'button',
                              className: 'evo-panel-act',
                              title: t('dailyView'),
                              onClick: () => doView(row.reportId),
                              children: jsx(Eye, {}),
                            }),
                          ],
                        }, row.reportId)),
                      }),
                  selectedContent !== null && jsx('pre', { className: 'evo-report-preview', children: selectedContent }),
                ],
              }),
            ],
          }),
        ],
      }),
    ],
  })
}
