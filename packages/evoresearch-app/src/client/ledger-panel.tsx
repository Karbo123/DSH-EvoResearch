/**
 * 实验账本面板（Part A：Git 8 条纪律落地 + A.7/A.8）。
 *
 * 在 experiments.ts 的第三个 Tab「实验账本」中展示：
 * - 实验列表（复用 experiment-workspace-list）
 * - 选中实验后的账本卡片：存在性/初始化、尝试历史、手动留痕、导出、否决、回退
 * - 环境指纹卡片（provenance.json）与实验状态卡片（recentState + 恢复）
 */

import { jsx, jsxs, Fragment } from 'react/jsx-runtime'
import { useEffect, useState } from 'react'
import { t } from './i18n'
import { FlaskConical, RefreshCw, Check, X as XIcon, Camera, Play, Pencil, XCircle, RotateCcw, Download, Copy, History, FileText, Beaker } from 'lucide-react'

interface ExperimentWorkspaceInfo {
  slug: string
  dir: string
  createdAt: number
  updatedAt: number
  hasNote: boolean
  noteBytes: number
  source: { sourcePath: string; mode: 'reference' | 'copy'; importedAt: number } | null
}

interface LedgerCommitInfo {
  sha: string
  message: string
  when: number
  kind: string
}

async function api<T>(method: string, body: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`/evoresearch/fs/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await res.json()
  if (!json.ok) throw new Error(json.error?.message ?? t('requestFailed'))
  const v = json.value as T & { error?: string; ok?: boolean }
  // some remotes return { error: string } inside value on service unavailable
  if (v !== null && typeof v === 'object' && 'error' in (v as Record<string, unknown>) && typeof (v as { error?: unknown }).error === 'string') {
    // but distinguish ok:false shape – let caller handle ok false
    if (!('ok' in (v as Record<string, unknown>))) throw new Error((v as { error: string }).error)
  }
  return json.value as T
}

function fmtTime(ts: number): string {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function kindIcon(kind: string) {
  switch (kind) {
    case 'checkpoint': return jsx(Camera, {})
    case 'rejected': return jsx(XCircle, {})
    case 'run': return jsx(Play, {})
    case 'manual': return jsx(Pencil, {})
    default: return jsx(History, {})
  }
}
function kindLabel(kind: string): string {
  switch (kind) {
    case 'checkpoint': return t('ledgerKindCheckpoint')
    case 'rejected': return t('ledgerKindRejected')
    case 'run': return t('ledgerKindRun')
    case 'manual': return t('ledgerKindManual')
    default: return kind
  }
}

function LedgerExperimentCard({ workspaceDir, slug, onError, onNotice }: {
  workspaceDir: string
  slug: string
  onError: (m: string) => void
  onNotice: (m: string) => void
}) {
  const [exists, setExists] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmInit, setConfirmInit] = useState(false)
  const [confirmOverwrite, setConfirmOverwrite] = useState(false)
  const [log, setLog] = useState<LedgerCommitInfo[] | null>(null)
  const [manualNote, setManualNote] = useState('')
  const [exportDest, setExportDest] = useState('')
  const [rejectNote, setRejectNote] = useState('')
  const [confirmRestore, setConfirmRestore] = useState<string | null>(null)
  const [provenance, setProvenance] = useState<Record<string, unknown> | null>(null)
  const [provError, setProvError] = useState<string | null>(null)
  const [recent, setRecent] = useState<Record<string, unknown> | null>(null)
  const [recentLoading, setRecentLoading] = useState(false)
  const [resumeGuide, setResumeGuide] = useState<{ path: string; markdown: string } | null>(null)

  const loadExists = () => {
    setExists(null)
    void api<{ exists: boolean }>('experiment-ledger-exists', { projectDir: workspaceDir, slug })
      .then((r) => setExists(r.exists))
      .catch((e: unknown) => { onError(String((e as Error)?.message ?? e)); setExists(false) })
  }
  const loadLog = () => {
    setLog(null)
    void api<LedgerCommitInfo[]>('experiment-ledger-log', { projectDir: workspaceDir, slug, limit: 50 })
      .then((rows) => setLog(Array.isArray(rows) ? rows : []))
      .catch(() => setLog([]))
  }
  const loadProvenance = () => {
    setProvError(null)
    void api<Record<string, unknown> | null>('experiment-ledger-provenance', { projectDir: workspaceDir, slug })
      .then((p) => {
        if (p !== null && typeof p === 'object' && 'error' in p) { setProvenance(null); return }
        setProvenance(p)
      })
      .catch((e: unknown) => { setProvError(String((e as Error)?.message ?? e)); setProvenance(null) })
  }
  const loadRecent = () => {
    setRecentLoading(true)
    void api<Record<string, unknown> | null>('experiment-ledger-recent-state', { projectDir: workspaceDir, slug, n: 10 })
      .then((r) => {
        if (r !== null && typeof r === 'object' && 'error' in r) { setRecent(null); return }
        setRecent(r)
      })
      .catch(() => setRecent(null))
      .finally(() => setRecentLoading(false))
  }

  useEffect(() => {
    setResumeGuide(null)
    loadExists()
    loadLog()
    loadProvenance()
    loadRecent()
  }, [slug, workspaceDir])

  const refreshAll = () => { setResumeGuide(null); loadExists(); loadLog(); loadProvenance(); loadRecent() }

  const doInit = (overwrite: boolean) => {
    setBusy(true)
    void api<{ ok: boolean; sha?: string; error?: string }>('experiment-ledger-init', { projectDir: workspaceDir, slug, ...(overwrite ? { overwrite: true } : {}) })
      .then((r) => {
        if ((r as { ok: boolean }).ok === false) throw new Error((r as { error: string }).error ?? t('ledgerInitFailed'))
        onNotice(t('ledgerInitOk'))
        setConfirmInit(false); setConfirmOverwrite(false)
        refreshAll()
      })
      .catch((e: unknown) => onError(String((e as Error)?.message ?? e)))
      .finally(() => setBusy(false))
  }

  const doTrial = () => {
    if (manualNote.trim() === '') return
    setBusy(true)
    void api<{ ok: boolean; sha?: string; error?: string }>('experiment-ledger-trial', {
      projectDir: workspaceDir, slug, payload: { kind: 'manual', note: manualNote.trim(), createdAt: Date.now() },
    })
      .then((r) => {
        if ((r as { ok: boolean }).ok === false) throw new Error((r as { error: string }).error ?? t('ledgerTrialFailed'))
        setManualNote('')
        onNotice(t('ledgerTrialOk'))
        loadLog(); loadRecent()
      })
      .catch((e: unknown) => onError(String((e as Error)?.message ?? e)))
      .finally(() => setBusy(false))
  }

  const doRestore = (sha: string) => {
    setBusy(true)
    void api<{ ok: boolean; restoredFiles?: number; error?: string }>('experiment-ledger-restore', { projectDir: workspaceDir, slug, sha })
      .then((r) => {
        if ((r as { ok: boolean }).ok === false) throw new Error((r as { error: string }).error ?? t('ledgerRestoreFailed'))
        setConfirmRestore(null)
        onNotice(`${t('ledgerRestoreOk')}: ${(r as { restoredFiles: number }).restoredFiles} ${t('filesRestored')}`)
        loadLog()
      })
      .catch((e: unknown) => onError(String((e as Error)?.message ?? e)))
      .finally(() => setBusy(false))
  }

  const doExport = () => {
    if (exportDest.trim() === '') return
    setBusy(true)
    void api<{ ok: boolean; path?: string; error?: string }>('experiment-ledger-export', { projectDir: workspaceDir, slug, dest: exportDest.trim() })
      .then((r) => {
        if ((r as { ok: boolean }).ok === false) throw new Error((r as { error: string }).error ?? t('ledgerExportFailed'))
        onNotice(`${t('ledgerExportOk')}: ${(r as { path: string }).path}`)
      })
      .catch((e: unknown) => onError(String((e as Error)?.message ?? e)))
      .finally(() => setBusy(false))
  }

  const doReject = () => {
    if (rejectNote.trim() === '') return
    setBusy(true)
    void api<{ ok: boolean; rejectedSha?: string; restoredFiles?: number; error?: string }>('experiment-ledger-reject', {
      projectDir: workspaceDir, slug, note: rejectNote.trim(),
    })
      .then((r) => {
        if ((r as { ok: boolean }).ok === false) throw new Error((r as { error: string }).error ?? t('ledgerRejectFailed'))
        setRejectNote('')
        onNotice(t('ledgerRejectOk'))
        loadLog()
      })
      .catch((e: unknown) => onError(String((e as Error)?.message ?? e)))
      .finally(() => setBusy(false))
  }

  const doCopyProvenance = () => {
    if (provenance === null) return
    const text = JSON.stringify(provenance, null, 2)
    void navigator.clipboard.writeText(text).then(() => onNotice(t('copied'))).catch(() => onError(t('ledgerCopyFailed')))
  }

  const doResume = () => {
    if (recent === null) return
    setBusy(true)
    void api<{ ok: boolean; path?: string; error?: string }>('experiment-ledger-write-resume', { projectDir: workspaceDir, slug, state: recent })
      .then((r) => {
        if ((r as { ok: boolean }).ok === false) throw new Error((r as { error: string }).error ?? t('ledgerResumeWriteFailed'))
        const p = (r as { path: string }).path
        const md = `# 恢复指引 · ${slug}\n\n> 由实验账本 recentState 生成\n\n## 上次状态摘要\n\n\`\`\`json\n${JSON.stringify(recent, null, 2)}\n\`\`\`\n\n## 下一步\n- 检查上方状态中的 phase / lastConclusion / nextStep\n- 在 LAB_NOTE.md 记录恢复计划\n- 必要时用账本回退到对应提交\n`
        setResumeGuide({ path: p, markdown: md })
        onNotice(`${t('ledgerResumeOk')}: ${p}`)
      })
      .catch((e: unknown) => onError(String((e as Error)?.message ?? e)))
      .finally(() => setBusy(false))
  }

  return jsxs('div', {
    className: 'evo-ledger-detail',
    children: [
      // 当前状态
      jsxs('div', {
        className: 'evo-ledger-card',
        children: [
          jsxs('div', {
            className: 'evo-ledger-card-head',
            children: [
              jsx(Beaker, {}),
              jsx('span', { children: t('ledgerCurrent') }),
              jsx('span', { style: { flex: 1 } }),
              jsx('button', { type: 'button', className: 'evo-panel-act', title: t('refresh'), onClick: refreshAll, children: jsx(RefreshCw, {}) }),
            ],
          }),
          exists === null
            ? jsx('div', { className: 'evo-panel-hint', children: t('loading') })
            : exists
              ? jsxs('div', {
                className: 'evo-ledger-exists',
                children: [
                  jsx('span', { className: 'evo-ledger-ok', children: `✓ ${t('ledgerExists')}` }),
                  confirmOverwrite
                    ? jsxs('span', {
                      className: 'evo-ledger-confirm',
                      children: [
                        jsx('span', { children: t('ledgerOverwriteHint') }),
                        jsx('button', { type: 'button', className: 'evo-tl-del-confirm', disabled: busy, onClick: () => doInit(true), children: t('confirmQ') }),
                        jsx('button', { type: 'button', className: 'evo-ledger-cancel', disabled: busy, onClick: () => setConfirmOverwrite(false), children: jsx(XIcon, {}) }),
                      ],
                    })
                    : jsx('button', { type: 'button', className: 'evo-panel-act', disabled: busy, onClick: () => setConfirmOverwrite(true), children: t('ledgerRebuild') }),
                ],
              })
              : jsxs('div', {
                className: 'evo-ledger-notfound',
                children: [
                  jsx('span', { className: 'evo-ledger-bad', children: t('ledgerNotFound') }),
                  confirmInit
                    ? jsxs('div', {
                      className: 'evo-ledger-confirm',
                      children: [
                        jsx('span', { children: t('ledgerInitHint') }),
                        jsx('button', { type: 'button', className: 'evo-panel-add', disabled: busy, onClick: () => doInit(false), children: t('confirmQ') }),
                        jsx('button', { type: 'button', className: 'evo-ledger-cancel', disabled: busy, onClick: () => setConfirmInit(false), children: jsx(XIcon, {}) }),
                      ],
                    })
                    : jsx('button', {
                      type: 'button',
                      className: 'evo-panel-add',
                      disabled: busy,
                      onClick: () => setConfirmInit(true),
                      children: jsxs(Fragment, { children: [jsx(History, {}), jsx('span', { children: t('ledgerInit') })] }),
                    }),
                ],
              }),
        ],
      }),

      exists === true && jsxs(Fragment, {
        children: [
          // 环境指纹
          jsxs('div', {
            className: 'evo-ledger-card',
            children: [
              jsxs('div', {
                className: 'evo-ledger-card-head',
                children: [
                  jsx(FileText, {}),
                  jsx('span', { children: t('ledgerProvenance') }),
                  jsx('span', { style: { flex: 1 } }),
                  provenance !== null && jsx('button', { type: 'button', className: 'evo-panel-act', title: t('copy'), onClick: doCopyProvenance, children: jsx(Copy, {}) }),
                ],
              }),
              provError !== null
                ? jsx('div', { className: 'evo-panel-error', children: provError })
                : provenance === null
                  ? jsx('div', { className: 'evo-panel-hint', children: t('ledgerProvenanceMissing') })
                  : jsxs('div', {
                    className: 'evo-ledger-provenance',
                    children: [
                      jsxs('div', {
                        className: 'evo-ledger-prov-grid',
                        children: [
                          jsxs('div', { children: [jsx('span', { className: 'evo-ledger-k', children: 'App' }), jsx('span', { children: String((provenance.app as { version?: string })?.version ?? (provenance as Record<string, unknown>).app ?? '-') })] }),
                          jsxs('div', { children: [jsx('span', { className: 'evo-ledger-k', children: 'DSH' }), jsx('span', { children: String((provenance.dsh as { version?: string })?.version ?? '-') })] }),
                          jsxs('div', { children: [jsx('span', { className: 'evo-ledger-k', children: 'Node' }), jsx('span', { children: String(provenance.node ?? '-') })] }),
                          jsxs('div', { children: [jsx('span', { className: 'evo-ledger-k', children: 'OS' }), jsx('span', { children: String(provenance.os ?? '-') })] }),
                          (provenance.model as { provider?: string; model?: string } | undefined) !== undefined
                            && jsxs('div', { children: [jsx('span', { className: 'evo-ledger-k', children: 'Model' }), jsx('span', { children: `${(provenance.model as { provider: string; model: string }).provider}/${(provenance.model as { provider: string; model: string }).model}` })] }),
                        ],
                      }),
                      jsx('pre', { className: 'evo-ledger-json', children: JSON.stringify(provenance, null, 2) }),
                    ],
                  }),
            ],
          }),

          // 实验状态（recentState）
          jsxs('div', {
            className: 'evo-ledger-card',
            children: [
              jsxs('div', {
                className: 'evo-ledger-card-head',
                children: [
                  jsx(Beaker, {}),
                  jsx('span', { children: t('ledgerRecentState') }),
                  jsx('span', { style: { flex: 1 } }),
                  recent !== null && jsx('button', { type: 'button', className: 'evo-panel-add', disabled: busy, onClick: doResume, children: t('ledgerResume') }),
                ],
              }),
              recentLoading
                ? jsx('div', { className: 'evo-panel-hint', children: t('loading') })
                : recent === null
                  ? jsx('div', { className: 'evo-panel-hint', children: t('ledgerNoRecentState') })
                  : jsxs('div', {
                    className: 'evo-ledger-recent',
                    children: [
                      jsx('pre', { className: 'evo-ledger-json', children: JSON.stringify(recent, null, 2) }),
                      jsx('div', { className: 'evo-panel-hint', children: t('ledgerResumeHint') }),
                      resumeGuide !== null && jsxs('div', {
                        className: 'evo-ledger-resume-guide',
                        children: [
                          jsxs('div', { className: 'evo-panel-hint', style: { fontWeight: 600 }, children: [`✓ ${t('ledgerResumeOk')}: `, jsx('span', { style: { fontFamily: 'ui-monospace, Consolas, monospace', fontSize: '12px' }, children: resumeGuide.path })] }),
                          jsx('pre', { className: 'evo-ledger-json', children: resumeGuide.markdown }),
                          jsx('div', { className: 'evo-panel-hint', children: t('ledgerResumeGuideHint') }),
                        ],
                      }),
                    ],
                  }),
            ],
          }),

          // 尝试历史
          jsxs('div', {
            className: 'evo-ledger-card',
            children: [
              jsxs('div', {
                className: 'evo-ledger-card-head',
                children: [
                  jsx(History, {}),
                  jsx('span', { children: t('ledgerHistory') }),
                  jsx('span', { style: { flex: 1 } }),
                  jsx('button', { type: 'button', className: 'evo-panel-act', title: t('refresh'), onClick: loadLog, children: jsx(RefreshCw, {}) }),
                ],
              }),
              log === null
                ? jsx('div', { className: 'evo-panel-hint', children: t('loading') })
                : log.length === 0
                  ? jsx('div', { className: 'evo-panel-hint', children: t('ledgerNoHistory') })
                  : jsx('div', {
                    className: 'evo-ledger-log',
                    children: log.map((row) => jsxs('div', {
                      className: 'evo-ledger-row',
                      'data-kind': row.kind,
                      children: [
                        jsx('span', { className: 'evo-ledger-kind', children: kindIcon(row.kind) }),
                        jsxs('div', {
                          className: 'evo-ledger-info',
                          children: [
                            jsxs('div', {
                              className: 'evo-ledger-msg',
                              children: [
                                jsx('span', { className: 'evo-ledger-kind-label', children: kindLabel(row.kind) }),
                                jsx('span', { children: row.message }),
                              ],
                            }),
                            jsxs('div', { className: 'evo-ledger-meta', children: [jsx('span', { children: fmtTime(row.when) }), jsx('span', { children: row.sha.slice(0, 7) })] }),
                          ],
                        }),
                        confirmRestore === row.sha
                          ? jsx('button', { type: 'button', className: 'evo-tl-del-confirm', disabled: busy, onClick: () => doRestore(row.sha), children: t('confirmQ') })
                          : jsx('button', {
                            type: 'button',
                            className: 'evo-panel-act',
                            title: t('ledgerRestoreTo'),
                            disabled: busy,
                            onClick: () => { setConfirmRestore(row.sha); setTimeout(() => setConfirmRestore((v) => v === row.sha ? null : v), 5000) },
                            children: jsx(RotateCcw, {}),
                          }),
                      ],
                    }, row.sha)),
                  }),
            ],
          }),

          // 手动留痕
          jsxs('div', {
            className: 'evo-ledger-card',
            children: [
              jsxs('div', { className: 'evo-ledger-card-head', children: [jsx(Pencil, {}), jsx('span', { children: t('ledgerManual') })] }),
              jsxs('div', {
                className: 'evo-panel-form',
                children: [
                  jsx('input', {
                    type: 'text',
                    className: 'evo-panel-input',
                    placeholder: t('ledgerManualPlaceholder'),
                    value: manualNote,
                    disabled: busy,
                    onInput: (e) => setManualNote(e.currentTarget.value),
                    onKeyDown: (e) => { if (e.key === 'Enter') doTrial() },
                  }),
                  jsx('button', { type: 'button', className: 'evo-panel-add', disabled: busy || manualNote.trim() === '', onClick: doTrial, children: jsxs(Fragment, { children: [jsx(Check, {}), jsx('span', { children: t('ledgerTrial') })] }) }),
                ],
              }),
            ],
          }),

          // 否决最近尝试
          jsxs('div', {
            className: 'evo-ledger-card',
            children: [
              jsxs('div', { className: 'evo-ledger-card-head', children: [jsx(XCircle, {}), jsx('span', { children: t('ledgerReject') })] }),
              jsxs('div', {
                className: 'evo-panel-form',
                children: [
                  jsx('input', {
                    type: 'text',
                    className: 'evo-panel-input',
                    placeholder: t('ledgerRejectPlaceholder'),
                    value: rejectNote,
                    disabled: busy,
                    onInput: (e) => setRejectNote(e.currentTarget.value),
                    onKeyDown: (e) => { if (e.key === 'Enter') doReject() },
                  }),
                  jsx('button', { type: 'button', className: 'evo-panel-add', disabled: busy || rejectNote.trim() === '', onClick: doReject, children: jsxs(Fragment, { children: [jsx(XIcon, {}), jsx('span', { children: t('ledgerRejectBtn') })] }) }),
                ],
              }),
              jsx('div', { className: 'evo-panel-hint', children: t('ledgerRejectHint') }),
            ],
          }),

          // 导出
          jsxs('div', {
            className: 'evo-ledger-card',
            children: [
              jsxs('div', { className: 'evo-ledger-card-head', children: [jsx(Download, {}), jsx('span', { children: t('ledgerExport') })] }),
              jsxs('div', {
                className: 'evo-panel-form',
                children: [
                  jsx('input', {
                    type: 'text',
                    className: 'evo-panel-input',
                    placeholder: t('ledgerExportPlaceholder'),
                    value: exportDest,
                    disabled: busy,
                    onInput: (e) => setExportDest(e.currentTarget.value),
                  }),
                  jsx('button', { type: 'button', className: 'evo-panel-add', disabled: busy || exportDest.trim() === '', onClick: doExport, children: jsxs(Fragment, { children: [jsx(Download, {}), jsx('span', { children: t('ledgerExportBtn') })] }) }),
                ],
              }),
            ],
          }),
        ],
      }),
    ],
  })
}

export function LedgerPanel({ cwd }: { cwd: string | null; sessionId: string | null; onOpenSession: (id: string) => void }) {
  const workspaceDir = cwd ?? ''
  const [list, setList] = useState<ExperimentWorkspaceInfo[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)

  const load = (fresh = false) => {
    if (fresh) setList(null)
    setError(null)
    void api<ExperimentWorkspaceInfo[]>('experiment-workspace-list', { workspaceDir })
      .then((rows) => {
        setList(rows)
        if (rows.length > 0 && (selected === null || !rows.some((r) => r.slug === selected))) {
          setSelected(rows[0].slug)
        }
        if (rows.length === 0) setSelected(null)
      })
      .catch((e: unknown) => setError(String((e as Error)?.message ?? e)))
  }
  useEffect(() => { load(true) }, [cwd]) // eslint-disable-line react-hooks/exhaustive-deps

  const workspaceUnbound = error !== null && (error.includes('超出部署根目录') || error.includes('工作区必须是部署根目录'))

  return jsxs('div', {
    className: 'evo-panel',
    children: [
      jsxs('div', {
        className: 'evo-panel-head',
        children: [jsx(History, {}), jsx('span', { children: t('ledgerTitle') })],
      }),
      jsx('div', {
        className: 'evo-panel-body',
        children: [
          workspaceUnbound && jsx('div', { className: 'evo-panel-hint', children: t('expWsNoWorkspace') }),
          error !== null && !workspaceUnbound && jsx('div', { className: 'evo-panel-error', children: error }),
          notice !== null && jsx('div', { className: 'evo-ledger-notice', children: notice }),
          // 工具栏：刷新 + 实验计数
          jsxs('div', {
            className: 'evo-panel-row',
            children: [
              jsx('span', { className: 'evo-panel-row-label', children: t('experiments') }),
              jsx('span', { style: { flex: 1 } }),
              jsx('button', { type: 'button', className: 'evo-icon-btn', title: t('refresh'), onClick: () => load(), children: jsx(RefreshCw, {}) }),
            ],
          }),
          list === null
            ? jsx('div', { className: 'evo-panel-hint', children: t('loading') })
            : list.length === 0
              ? jsx('div', { className: 'evo-panel-hint', children: t('expWsEmpty') })
              : jsxs('div', {
                className: 'evo-ledger-exp-list',
                children: list.map((row) => jsx('button', {
                  type: 'button',
                  className: 'evo-ledger-exp',
                  'data-active': selected === row.slug || undefined,
                  onClick: () => setSelected(row.slug),
                  children: jsxs(Fragment, {
                    children: [
                      jsx(FlaskConical, {}),
                      jsx('span', { className: 'evo-ledger-exp-name', children: row.slug }),
                      jsx('span', { className: 'evo-ledger-exp-time', children: fmtTime(row.updatedAt) }),
                    ],
                  }),
                }, row.slug)),
              }),
          selected !== null && list !== null && list.some((r) => r.slug === selected)
            && jsx(LedgerExperimentCard, {
              key: selected,
              workspaceDir,
              slug: selected,
              onError: (m) => { setError(m); setTimeout(() => setError(null), 6000) },
              onNotice: (m) => { setNotice(m); setTimeout(() => setNotice(null), 5000) },
            }),
        ],
      }),
    ],
  })
}
