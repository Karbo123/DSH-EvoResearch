/**
 * 业务面板（阶段 2）：EvoMemory 记忆面板 + Scheduled 定时任务面板
 * + Research Skills 技能面板 + Workspace 项目面板。
 *
 * 数据经 /evoresearch/fs/* HTTP API（host 侧直连插件 EvoResearchApiService，
 * 绕开浏览器 Remote $mount 通道）。
 */
import { jsx, jsxs, Fragment } from 'react/jsx-runtime'
import { useEffect, useState } from 'react'
import { t } from './i18n'
import {
  BrainCircuit, Clock, Plus, Trash2, ListChecks, Target, GraduationCap,
  Check, X as XIcon, Play, FolderGit2, FolderUp, RefreshCw, Cable, Users,
  UserPlus, Power, PowerOff, Ban, ExternalLink, Send, Sparkles, PenLine, Pencil,
  Boxes, Download, ChevronDown, ChevronRight,
} from 'lucide-react'

const CATEGORY_LABELS: Record<string, string> = {
  idea: 'catIdea', method: 'catMethod', experiment: 'catExperiment',
  related_work: 'catRelatedWork', reproduction: 'catReproduction', project: 'catProject', general: 'catGeneral',
}

/** 分类标签（i18n 化；未知分类透传原文）。 */
function categoryLabel(category: string): string {
  const key = CATEGORY_LABELS[category]
  return key !== undefined ? t(key) : category
}

/** 面板外壳（标题 + 内容）。 */
function PanelShell({ icon, title, children }: { icon: any; title: string; children: any }) {
  return jsxs('div', {
    className: 'evo-panel',
    children: [
      jsxs('div', {
        className: 'evo-panel-head',
        children: [jsx(icon, {}), jsx('span', { children: title })],
      }),
      jsx('div', { className: 'evo-panel-body', children }),
    ],
  })
}

function LoadingRow() {
  return jsx('div', { className: 'evo-panel-hint', children: t('loading') })
}

/** 简单 POST JSON 封装。 */
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

/** EvoMemory 面板：项目 + 分类统计 + 目标。 */
export function MemoryPanel({ onOpenThread }: { onOpenThread: (id: string) => void }) {
  const [projects, setProjects] = useState<Array<{ name: string; path?: string }> | null>(null)
  const [catalog, setCatalog] = useState<Array<{ category: string; count: number }> | null>(null)
  const [goals, setGoals] = useState<GoalRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expandedGoal, setExpandedGoal] = useState<string | null>(null)
  const [proposals, setProposals] = useState<Record<string, GoalProposalRow[]>>({})
  const [responding, setResponding] = useState<string | null>(null)
  const [tab, setTab] = useState<'overview' | 'history' | 'identity' | 'knowledge'>('overview')
  // History 时间线（§26.5）
  const [turns, setTurns] = useState<Array<{ turnId: string; sessionId: string; userText: string; categories: readonly string[]; status: string; createdAt: number }> | null>(null)
  const [turnOffset, setTurnOffset] = useState(0)
  const TURN_PAGE = 30
  // Identity（§26.5）
  const [profile, setProfile] = useState<Array<{ name: string; text: string; bytes: number }> | null>(null)
  // §12.4 Profile 编辑：编辑态 / 重命名 / 新建 / 删除确认
  const [editing, setEditing] = useState<{ name: string; draft: string } | null>(null)
  const [renaming, setRenaming] = useState<{ from: string; value: string } | null>(null)
  const [newFileName, setNewFileName] = useState('')
  const [confirmDeleteFile, setConfirmDeleteFile] = useState<string | null>(null)
  const [profileBusy, setProfileBusy] = useState(false)
  // Knowledge（§26.5 轻量版）
  const [observations, setObservations] = useState<Array<{ observationId: string; title: string; content: string; categories: readonly string[]; status: string; supersededBy?: string; relatedObservationIds?: readonly string[]; updatedAt: number }> | null>(null)
  const [obsFilter, setObsFilter] = useState<'all' | 'active' | 'superseded'>('all')
  // P1-2：observationId → [{otherId, edgeType}]（互补=青 / 矛盾=橙红 / 取代=灰删除线）
  const [edgeTypes, setEdgeTypes] = useState<Map<string, Array<{ otherId: string; edgeType: string }>> | null>(null)

  const loadTurns = (offset: number) => {
    void api<Array<{ turnId: string; sessionId: string; userText: string; categories: readonly string[]; status: string; createdAt: number }>>('memory-turns', { limit: TURN_PAGE, offset })
      .then((list) => { setTurns(list); setTurnOffset(offset) })
      .catch((e: any) => setError(String(e?.message ?? e)))
  }
  useEffect(() => { if (tab === 'history') loadTurns(0) }, [tab])
  useEffect(() => {
    if (tab !== 'identity') return
    setProfile(null)
    void api<Array<{ name: string; text: string; bytes: number }>>('memory-profile', {})
      .then(setProfile)
      .catch((e: any) => setError(String(e?.message ?? e)))
  }, [tab])

  const reloadProfile = () => {
    void api<Array<{ name: string; text: string; bytes: number }>>('memory-profile', {})
      .then(setProfile)
      .catch((e: any) => setError(String(e?.message ?? e)))
  }

  const saveProfile = () => {
    if (editing === null || profileBusy) return
    setProfileBusy(true)
    setError(null)
    void api<{ ok: boolean }>('memory-profile-write', { name: editing.name, content: editing.draft })
      .then((r) => {
        setProfileBusy(false)
        if (r.ok) { setEditing(null); reloadProfile() }
        else setError(t('saveFailed'))
      })
      .catch((e: any) => { setProfileBusy(false); setError(String(e?.message ?? e)) })
  }

  const createProfileFile = () => {
    const name = newFileName.trim()
    if (name === '' || profileBusy) return
    const full = name.endsWith('.md') ? name : `${name}.md`
    setProfileBusy(true)
    setError(null)
    void api<{ ok: boolean }>('memory-profile-write', { name: full, content: `# ${full.replace(/\.md$/, '')}\n` })
      .then((r) => {
        setProfileBusy(false)
        if (r.ok) { setNewFileName(''); reloadProfile() }
        else setError(t('createFailed'))
      })
      .catch((e: any) => { setProfileBusy(false); setError(String(e?.message ?? e)) })
  }

  const deleteProfileFile = (name: string) => {
    if (profileBusy) return
    setProfileBusy(true)
    setError(null)
    void api<{ ok: boolean }>('memory-profile-delete', { name })
      .then((r) => {
        setProfileBusy(false)
        setConfirmDeleteFile(null)
        if (r.ok) reloadProfile()
      })
      .catch((e: any) => { setProfileBusy(false); setError(String(e?.message ?? e)) })
  }

  const submitRename = () => {
    if (renaming === null || profileBusy) return
    const to = renaming.value.trim()
    if (to === '') return
    const full = to.endsWith('.md') ? to : `${to}.md`
    setProfileBusy(true)
    setError(null)
    void api<{ ok: boolean }>('memory-profile-rename', { from: renaming.from, to: full })
      .then((r) => {
        setProfileBusy(false)
        setRenaming(null)
        if (r.ok) reloadProfile()
      })
      .catch((e: any) => { setProfileBusy(false); setError(String(e?.message ?? e)) })
  }
  useEffect(() => {
    if (tab !== 'knowledge') return
    setObservations(null)
    setEdgeTypes(null)
    void api<Array<{ observationId: string; title: string; content: string; categories: readonly string[]; status: string; supersededBy?: string; updatedAt: number }>>('memory-observations', obsFilter === 'all' ? { limit: 100 } : { status: obsFilter, limit: 100 })
      .then(setObservations)
      .catch((e: any) => setError(String(e?.message ?? e)))
    // P1-2：类型化关联边（互补/矛盾/取代）→ 卡片徽标着色
    void api<Array<{ fromId: string; toId: string; edgeType: string; createdAt: number }>>('memory-observation-edges', {})
      .then((edges) => {
        const byObs = new Map<string, Array<{ otherId: string; edgeType: string }>>()
        for (const e of edges ?? []) {
          const list = (id: string, other: string) => {
            const arr = byObs.get(id) ?? []
            arr.push({ otherId: other, edgeType: e.edgeType })
            byObs.set(id, arr)
          }
          if (typeof e.fromId === 'string' && typeof e.toId === 'string') {
            list(e.fromId, e.toId)
            list(e.toId, e.fromId)
          }
        }
        setEdgeTypes(byObs)
      })
      .catch(() => { /* 边数据缺失时徽标退化为普通 related 样式 */ })
  }, [tab, obsFilter])

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      api<Array<{ name: string; path?: string }>>('projects').catch((e: any) => { if (!cancelled) setError(String(e?.message ?? e)); return [] }),
      api<Array<{ category: string; count: number }>>('memory-catalog', {}).catch(() => []),
      api<GoalRow[]>('memory-goals', {}).catch(() => []),
    ]).then(([p, c, g]) => {
      if (cancelled) return
      setProjects(p)
      setCatalog(c)
      setGoals(g)
    })
    return () => { cancelled = true }
  }, [])

  // 展开目标时加载其提案（§19.6）
  useEffect(() => {
    if (expandedGoal === null) return
    let cancelled = false
    void api<GoalProposalRow[]>('memory-goal-proposals', { goalId: expandedGoal }).then((list) => {
      if (!cancelled) setProposals((prev) => ({ ...prev, [expandedGoal]: list }))
    }).catch(() => {})
    return () => { cancelled = true }
  }, [expandedGoal])

  const respondProposal = (proposalId: string, decision: 'approve' | 'reject') => {
    if (responding !== null) return
    setResponding(proposalId)
    setError(null)
    void api<{ proposal: GoalProposalRow; goal?: GoalRow }>('memory-goal-proposal-respond', { proposalId, decision })
      .then((result) => {
        setResponding(null)
        if (result.proposal !== undefined) {
          // 刷新提案 + 目标列表（接受后合同版本变化）
          setProposals((prev) => ({
            ...prev,
            [result.proposal.goalId]: (prev[result.proposal.goalId] ?? []).map((p) => (p.proposalId === proposalId ? { ...p, status: result.proposal.status } : p)),
          }))
          void api<GoalRow[]>('memory-goals', {}).then(setGoals).catch(() => {})
        }
      })
      .catch((e: any) => { setResponding(null); setError(String(e?.message ?? e)) })
  }

  const totalTurns = (catalog ?? []).reduce((sum, item) => sum + item.count, 0)

  const projectsRow = jsxs('div', {
    className: 'evo-panel-row',
    children: [
      jsx('span', { className: 'evo-panel-row-label', children: t('projects') }),
      projects === null
        ? jsx(LoadingRow, {})
        : (projects ?? []).length === 0
          ? jsx('span', { className: 'evo-panel-hint', children: t('noProjectsYet') })
          : jsx('div', {
              className: 'evo-panel-tags',
              children: (projects ?? []).map((p) => jsx('span', { className: 'evo-panel-tag', children: p.name }, p.name)),
            }),
    ],
  })

  const catalogRow = jsxs('div', {
    className: 'evo-panel-row',
    children: [
      jsx('span', { className: 'evo-panel-row-label', children: t('turnCatalog') }),
      catalog === null
        ? jsx(LoadingRow, {})
        : jsx('div', {
            className: 'evo-panel-stats',
            children: [
              jsx('div', { className: 'evo-panel-stat', children: jsxs(Fragment, { children: [jsx('div', { className: 'evo-panel-stat-num', children: totalTurns }), jsx('div', { className: 'evo-panel-stat-label', children: t('turns') })] }) }),
              ...(catalog ?? []).map((item) => jsx('div', {
                className: 'evo-panel-stat',
                children: jsxs(Fragment, { children: [jsx('div', { className: 'evo-panel-stat-num', children: item.count }), jsx('div', { className: 'evo-panel-stat-label', children: categoryLabel(item.category) })] }),
              }, item.category)),
            ],
          }),
    ],
  })

  const goalsRow = jsxs('div', {
    className: 'evo-panel-row',
    children: [
      jsx('span', { className: 'evo-panel-row-label', children: t('goals') }),
      goals === null
        ? jsx(LoadingRow, {})
        : (goals ?? []).length === 0
          ? jsx('span', { className: 'evo-panel-hint', children: t('noActiveGoals') })
          : jsx('div', {
              className: 'evo-panel-list',
              children: (goals ?? []).map((g) => {
                const key = g.goalId ?? g.id ?? g.title ?? ''
                const expanded = expandedGoal === key
                const criteria = g.criteria ?? []
                const satisfied = criteria.filter((c) => c.satisfied).length
                return jsxs('div', {
                  className: 'evo-panel-item evo-goal-item',
                  'data-open': expanded || undefined,
                  children: [
                    jsxs('button', {
                      type: 'button',
                      className: 'evo-goal-head',
                      'aria-expanded': expanded || undefined,
                      onClick: () => setExpandedGoal((v) => (v === key ? null : key)),
                      children: [
                        jsx(Target, {}),
                        jsx('span', { className: 'evo-panel-item-main', children: g.title ?? g.goalId ?? g.id ?? t('goal') }),
                        g.status !== undefined && jsx('span', { className: 'evo-panel-item-badge', children: g.status }),
                        g.progress !== undefined && jsx('span', { className: 'evo-panel-item-num', children: `${Math.round(g.progress * 100)}%` }),
                        criteria.length > 0 && jsx('span', { className: 'evo-goal-criteria-count', children: `${satisfied}/${criteria.length}` }),
                      ],
                    }),
                    expanded && jsx('div', {
                      className: 'evo-goal-detail',
                      children: [
                        g.objective !== undefined && g.objective !== '' && jsxs('div', {
                          className: 'evo-goal-detail-block',
                          children: [
                            jsx('span', { className: 'evo-goal-detail-label', children: t('goalObjective') }),
                            jsx('span', { className: 'evo-goal-detail-text', children: g.objective }),
                          ],
                        }),
                        criteria.length > 0 && jsxs('div', {
                          className: 'evo-goal-detail-block',
                          children: [
                            jsx('span', { className: 'evo-goal-detail-label', children: `${t('successCriteria')}（${satisfied}/${criteria.length}）` }),
                            jsx('div', { className: 'evo-goal-criteria', children: criteria.map((c) => jsxs('div', {
                              className: `evo-goal-criterion${c.satisfied ? ' done' : ''}`,
                              children: [
                                jsx('span', { className: 'evo-goal-criterion-mark', children: c.satisfied ? '✓' : '○' }),
                                jsx('span', { className: 'evo-goal-criterion-text', children: c.text }),
                                c.evidence.length > 0 && jsx('span', { className: 'evo-goal-evidence', children: `${t('evidenceLabel')} ${c.evidence.length}` }),
                              ],
                            }, c.id)) }),
                          ],
                        }),
                        (g.constraints ?? []).length > 0 && jsxs('div', {
                          className: 'evo-goal-detail-block',
                          children: [
                            jsx('span', { className: 'evo-goal-detail-label', children: t('constraintsLabel') }),
                            jsx('div', { className: 'evo-goal-tags', children: (g.constraints ?? []).map((c) => jsx('span', { className: 'evo-panel-tag', children: c }, c)) }),
                          ],
                        }),
                        (g.version !== undefined || g.updatedAt !== undefined) && jsx('div', {
                          className: 'evo-goal-detail-meta',
                          children: [
                            g.version !== undefined && jsx('span', { children: `${t('version')} ${g.version}` }),
                            g.updatedAt !== undefined && jsx('span', { children: `${t('updatedAt')} ${new Date(g.updatedAt).toLocaleString()}` }),
                          ],
                        }),
                        jsxs('div', {
                          className: 'evo-goal-detail-block',
                          children: [
                            jsx('span', { className: 'evo-goal-detail-label', children: t('proposals') }),
                            (proposals[key] ?? []).filter((p) => p.status === 'pending').length === 0
                              ? jsx('span', { className: 'evo-panel-hint', children: t('noProposals') })
                              : jsx('div', { className: 'evo-goal-proposals', children: (proposals[key] ?? []).filter((p) => p.status === 'pending').map((p) => jsxs('div', {
                                  className: 'evo-goal-proposal',
                                  children: [
                                    jsxs('div', {
                                      className: 'evo-goal-proposal-head',
                                      children: [
                                        jsx('span', { className: 'evo-goal-proposal-title', children: p.title }),
                                        jsx('span', { className: 'evo-goal-proposal-time', children: new Date(p.createdAt).toLocaleString() }),
                                      ],
                                    }),
                                    p.summary !== '' && jsx('div', { className: 'evo-goal-proposal-summary', children: p.summary }),
                                    jsxs('div', {
                                      className: 'evo-goal-proposal-acts',
                                      children: [
                                        jsx('button', {
                                          type: 'button',
                                          className: 'evo-btn evo-btn-ok evo-btn-sm',
                                          disabled: responding !== null,
                                          onClick: () => respondProposal(p.proposalId, 'approve'),
                                          children: jsxs(Fragment, { children: [jsx(Check, {}), jsx('span', { children: t('accept') })] }),
                                        }),
                                        jsx('button', {
                                          type: 'button',
                                          className: 'evo-btn evo-btn-danger evo-btn-sm',
                                          disabled: responding !== null,
                                          onClick: () => respondProposal(p.proposalId, 'reject'),
                                          children: jsxs(Fragment, { children: [jsx(XIcon, {}), jsx('span', { children: t('reject') })] }),
                                        }),
                                      ],
                                    }),
                                  ],
                                }, p.proposalId)) }),
                          ],
                        }),
                      ],
                    }),
                  ],
                }, key)
              }),
            }),
    ],
  })

  return jsx(PanelShell, {
    icon: BrainCircuit,
    title: 'EvoMemory',
    children: jsxs(Fragment, {
      children: [
        jsxs('div', {
          className: 'evo-skill-tabs',
          children: [
            jsx('button', { type: 'button', className: 'evo-insp-subtab', 'data-active': tab === 'overview' || undefined, onClick: () => setTab('overview'), children: t('overview') }),
            jsx('button', { type: 'button', className: 'evo-insp-subtab', 'data-active': tab === 'history' || undefined, onClick: () => setTab('history'), children: t('history') }),
            jsx('button', { type: 'button', className: 'evo-insp-subtab', 'data-active': tab === 'identity' || undefined, onClick: () => setTab('identity'), children: t('identity') }),
            jsx('button', { type: 'button', className: 'evo-insp-subtab', 'data-active': tab === 'knowledge' || undefined, onClick: () => setTab('knowledge'), children: t('knowledge') }),
          ],
        }),
        tab === 'knowledge'
          ? jsxs(Fragment, {
              children: [
                error !== null && jsx('div', { className: 'evo-panel-error', children: error }),
                jsxs('div', {
                  className: 'evo-skill-tabs',
                  children: [['all', t('all')], ['active', t('active')], ['superseded', t('superseded')]].map(([key, label]) => jsx('button', {
                    type: 'button',
                    className: 'evo-insp-subtab',
                    'data-active': obsFilter === key || undefined,
                    onClick: () => setObsFilter(key as 'all' | 'active' | 'superseded'),
                    children: label,
                  }, key)),
                }),
                observations === null
                  ? jsx(LoadingRow, {})
                  : observations.length === 0
                    ? jsx('span', { className: 'evo-panel-hint', children: t('noObservationsYet') })
                    : jsx('div', {
                        className: 'evo-panel-list',
                        children: observations.map((o) => jsxs('div', {
                          className: 'evo-skill-card',
                          children: [
                            jsxs('div', {
                              className: 'evo-skill-head',
                              children: [
                                jsx('span', { className: 'evo-panel-item-main', children: o.title }),
                                o.status === 'superseded' && jsx('span', { className: 'evo-skill-status rejected', children: t('superseded') }),
                              ],
                            }),
                            o.supersededBy !== undefined && jsx('div', { className: 'evo-skill-src', children: `superseded by ${o.supersededBy.slice(0, 18)}` }),
                            o.content !== '' && jsx('div', { className: 'evo-skill-desc', children: o.content.slice(0, 220) }),
                            (o.categories ?? []).length > 0 && jsx('div', { className: 'evo-history-meta', children: (o.categories ?? []).slice(0, 3).map((c) => jsx('span', { className: 'evo-panel-tag', children: categoryLabel(c) }, c)) }),
                            (o.relatedObservationIds ?? []).length > 0 && jsx('div', { className: 'evo-history-meta', children: (o.relatedObservationIds ?? []).map((rid) => {
                              const edge = edgeTypes?.get(o.observationId)?.find((x) => x.otherId === rid)
                              const cls = edge?.edgeType === 'contradicts' ? 'evo-panel-tag evo-edge-contradicts' : edge?.edgeType === 'supersedes' ? 'evo-panel-tag evo-edge-supersedes' : 'evo-panel-tag evo-panel-tag-link'
                              const label = edge?.edgeType === 'contradicts' ? t('edgeContradicts') : edge?.edgeType === 'supersedes' ? t('edgeSupersedes') : `${t('relatedTo')} ${rid.slice(0, 10)}`
                              return jsx('span', { className: cls, title: rid, children: label }, rid)
                            }) }),
                          ],
                        }, o.observationId)),
                      }),
              ],
            })
          : tab === 'identity'
          ? jsxs(Fragment, {
              children: [
                error !== null && jsx('div', { className: 'evo-panel-error', children: error }),
                jsx('div', { className: 'evo-panel-hint', children: t('identityHint') }),
                // §12.4 新建记忆文件
                jsxs('div', {
                  className: 'evo-panel-form',
                  children: [
                    jsx('input', {
                      type: 'text',
                      className: 'evo-panel-input',
                      placeholder: t('profileFileName'),
                      value: newFileName,
                      onInput: (e) => setNewFileName(e.currentTarget.value),
                      onKeyDown: (e: { key: string }) => { if (e.key === 'Enter') createProfileFile() },
                    }),
                    jsx('button', {
                      type: 'button',
                      className: 'evo-panel-add',
                      disabled: profileBusy || newFileName.trim() === '',
                      onClick: createProfileFile,
                      children: jsxs(Fragment, { children: [jsx(Plus, {}), jsx('span', { children: t('newProfileFile') })] }),
                    }),
                  ],
                }),
                profile === null
                  ? jsx(LoadingRow, {})
                  : profile.length === 0
                    ? jsx('span', { className: 'evo-panel-hint', children: t('noIdentityFiles') })
                    : jsx('div', {
                        className: 'evo-panel-list',
                        children: profile.map((f) => {
                          const isEditing = editing?.name === f.name
                          const isRenaming = renaming?.from === f.name
                          return jsxs('div', {
                            className: 'evo-skill-card',
                            children: [
                              jsxs('div', {
                                className: 'evo-skill-head',
                                children: [
                                  jsx('span', { className: 'evo-panel-item-main', children: f.name }),
                                  jsx('span', { className: 'evo-skill-source', children: `${Math.max(1, Math.round(f.bytes / 1024))} KB` }),
                                  !isEditing && !isRenaming && jsxs(Fragment, { children: [
                                    jsx('button', {
                                      type: 'button',
                                      className: 'evo-panel-act',
                                      title: t('edit'),
                                      'aria-label': t('edit'),
                                      onClick: () => setEditing({ name: f.name, draft: f.text }),
                                      children: jsx(PenLine, {}),
                                    }),
                                    jsx('button', {
                                      type: 'button',
                                      className: 'evo-panel-act',
                                      title: t('rename'),
                                      'aria-label': t('rename'),
                                      onClick: () => setRenaming({ from: f.name, value: f.name.replace(/\.md$/, '') }),
                                      children: jsx(Pencil, {}),
                                    }),
                                    confirmDeleteFile === f.name
                                      ? jsx('button', {
                                          type: 'button',
                                          className: 'evo-panel-act evo-del-confirm',
                                          title: t('confirmDeleteTitle'),
                                          onClick: () => deleteProfileFile(f.name),
                                          children: t('deleteQ'),
                                        })
                                      : jsx('button', {
                                          type: 'button',
                                          className: 'evo-panel-act evo-del',
                                          title: t('remove'),
                                          'aria-label': t('remove'),
                                          onClick: () => { setConfirmDeleteFile(f.name); setTimeout(() => setConfirmDeleteFile((v) => (v === f.name ? null : v)), 5000) },
                                          children: jsx(Trash2, {}),
                                        }),
                                  ] }),
                                ],
                              }),
                              isRenaming
                                ? jsxs('div', {
                                    className: 'evo-panel-form evo-profile-rename',
                                    children: [
                                      jsx('input', {
                                        type: 'text',
                                        className: 'evo-panel-input',
                                        value: renaming.value,
                                        autoFocus: true,
                                        onInput: (e) => setRenaming({ from: renaming.from, value: e.currentTarget.value }),
                                        onKeyDown: (e: { key: string }) => { if (e.key === 'Enter') submitRename(); if (e.key === 'Escape') setRenaming(null) },
                                      }),
                                      jsx('button', { type: 'button', className: 'evo-btn evo-btn-ok evo-btn-sm', disabled: profileBusy, onClick: submitRename, children: t('save') }),
                                      jsx('button', { type: 'button', className: 'evo-btn evo-btn-sm', onClick: () => setRenaming(null), children: t('cancel') }),
                                    ],
                                  })
                                  : isEditing
                                    ? jsxs('div', {
                                        className: 'evo-profile-edit',
                                        children: [
                                          jsx('textarea', {
                                            className: 'evo-identity-edit',
                                            value: editing.draft,
                                            rows: 8,
                                            onInput: (e) => setEditing({ name: editing.name, draft: e.currentTarget.value }),
                                          }),
                                          jsxs('div', {
                                            className: 'evo-goal-proposal-acts',
                                            children: [
                                              jsx('button', { type: 'button', className: 'evo-btn evo-btn-ok evo-btn-sm', disabled: profileBusy, onClick: saveProfile, children: t('save') }),
                                              jsx('button', { type: 'button', className: 'evo-btn evo-btn-sm', onClick: () => setEditing(null), children: t('cancel') }),
                                            ],
                                          }),
                                        ],
                                      })
                                    : jsx('pre', { className: 'evo-identity-text', children: f.text }),
                            ],
                          }, f.name)
                        }),
                      }),
              ],
            })
          : tab === 'history'
          ? jsxs(Fragment, {
              children: [
                error !== null && jsx('div', { className: 'evo-panel-error', children: error }),
                turns === null
                  ? jsx(LoadingRow, {})
                  : turns.length === 0
                    ? jsx('span', { className: 'evo-panel-hint', children: t('noResearchTurnsYet') })
                    : jsx('div', {
                        className: 'evo-panel-list',
                        children: turns.map((turn) => jsxs('div', {
                          className: 'evo-history-row',
                          children: [
                            jsx('span', { className: 'evo-history-dot', title: turn.status }),
                            jsxs('div', {
                              className: 'evo-history-main',
                              children: [
                                jsx('div', { className: 'evo-history-text', children: turn.userText.slice(0, 120) || t('emptyPrompt') }),
                                jsxs('div', { className: 'evo-history-meta', children: [
                                  jsx('span', { children: new Date(turn.createdAt).toLocaleString() }),
                                  ...(turn.categories ?? []).slice(0, 3).map((c) => jsx('span', { className: 'evo-panel-tag', children: categoryLabel(c) }, c)),
                                ] }),
                              ],
                            }),
                            jsx('button', {
                              type: 'button',
                              className: 'evo-panel-act',
                              title: t('openThread'),
                              'aria-label': t('openThread'),
                              onClick: () => onOpenThread(turn.sessionId),
                              children: jsx(ExternalLink, {}),
                            }),
                          ],
                        }, turn.turnId)),
                      }),
                (turns ?? []).length === TURN_PAGE && jsx('button', {
                  type: 'button',
                  className: 'evo-btn evo-btn-run',
                  onClick: () => loadTurns(turnOffset + TURN_PAGE),
                  children: t('loadEarlier'),
                }),
              ],
            })
          : jsxs(Fragment, {
              children: [
                error !== null && jsx('div', { className: 'evo-panel-error', children: error }),
                projectsRow,
                catalogRow,
                goalsRow,
              ],
            }),
      ],
    }),
  })
}

interface ScheduledTask { id?: string; taskId?: string; name?: string; cron?: string; enabled?: boolean; lastResultThreadId?: string; nextRunAt?: number | null }

/** Scheduled 面板：任务列表 + Schedule Builder（§42.2 可视化 cron + 模板）+ 打开结果/回报主对话（§26.6）。 */
export function SchedulePanel({ onOpenThread }: { onOpenThread: (id: string) => void }) {
  const [tasks, setTasks] = useState<ScheduledTask[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [reporting, setReporting] = useState<string | null>(null)
  // §42.2 Schedule Builder：daily/weekly/monthly/custom + 模板
  const [mode, setMode] = useState<'daily' | 'weekly' | 'monthly' | 'custom'>('daily')
  const [hour, setHour] = useState(9)
  const [minute, setMinute] = useState(0)
  const [weekday, setWeekday] = useState(1)
  const [dayOfMonth, setDayOfMonth] = useState(1)
  const [cronInput, setCronInput] = useState('0 9 * * *')

  const builtCron = (): string => {
    if (mode === 'custom') return cronInput.trim()
    if (mode === 'daily') return `${minute} ${hour} * * *`
    if (mode === 'weekly') return `${minute} ${hour} * * ${weekday}`
    return `${minute} ${hour} ${dayOfMonth} * *`
  }
  const cronPreview = builtCron()

  const applyTemplate = (t: { name: string; cron: string; prompt: string }) => {
    setName(t.name)
    setPrompt(t.prompt)
    setMode('custom')
    setCronInput(t.cron)
  }
  const TEMPLATES = [
    { name: 'Daily Papers', cron: '0 9 * * *', prompt: '按研究偏好追踪最新论文，并写入 daily-papers.md。' },
    { name: 'Weekly Research Review', cron: '0 17 * * 5', prompt: '总结本周研究进展、决定、阻塞和下一步计划。' },
    { name: 'Weekly Research Plan', cron: '0 8 * * 1', prompt: '生成本周科研计划。' },
    { name: 'Experiment Backlog', cron: '0 10 * * 2', prompt: '把当前开放问题转成可检验的实验 backlog。' },
  ]

  const load = () => {
    setTasks(null)
    void api<ScheduledTask[]>('scheduler-list').then(setTasks).catch((e: any) => setError(String(e?.message ?? e)))
  }

  useEffect(() => { load() }, [])

  const addTask = () => {
    if (!name.trim() || !prompt.trim()) return
    const cronValue = cronPreview
    if (!/^\d{1,2} \d{1,2} (\d{1,2}|\*) (\d{1,2}|\*) (\d{1,2}|\*)$/.test(cronValue)) {
      setError(t('cronInvalid'))
      return
    }
    setAdding(true)
    void api<{ ok: boolean }>('scheduler-add', { name: name.trim(), cron: cronValue, prompt: prompt.trim() }).then((result) => {
      setAdding(false)
      if (result.ok) { setName(''); setPrompt(''); setMode('daily'); load() }
      else setError(t('addFailed'))
    }).catch((e: any) => { setAdding(false); setError(String(e?.message ?? e)) })
  }

  const removeTask = (id: string) => {
    void api<{ ok: boolean }>('scheduler-remove', { taskId: id }).then((result) => {
      if (result.ok) load()
    }).catch((e: any) => setError(String(e?.message ?? e)))
  }

  // §42.3 Run now：立即执行一次任务
  const [runningNow, setRunningNow] = useState<string | null>(null)
  const runNow = (taskId: string) => {
    setRunningNow(taskId)
    void api<{ threadId?: string | null }>('scheduler-run', { taskId })
      .then((result) => {
        setRunningNow(null)
        load()
        if (typeof result.threadId === 'string') onOpenThread(result.threadId)
      })
      .catch((e: any) => { setRunningNow(null); setError(String(e?.message ?? e)) })
  }

  // §26.6 Report to main chat：读取任务结果会话尾部回复 → 以普通用户消息回送当前主对话
  const reportToChat = (taskId: string) => {
    setReporting(taskId)
    void api<{ text?: string; error?: string }>('scheduler-report', { taskId })
      .then((result) => {
        setReporting(null)
        if (typeof result.text === 'string' && result.text !== '') {
          window.dispatchEvent(new CustomEvent('evo-report-to-chat', { detail: { text: result.text } }))
        } else {
          setError(result.error ?? t('taskNotRun'))
        }
      })
      .catch((e: any) => { setReporting(null); setError(String(e?.message ?? e)) })
  }

  return jsx(PanelShell, {
    icon: Clock,
    title: t('scheduled'),
    children: jsxs(Fragment, {
      children: [
        error !== null && jsx('div', { className: 'evo-panel-error', children: error }),
        jsx('div', {
          className: 'evo-panel-form',
          children: [
            jsx('input', { type: 'text', className: 'evo-panel-input', placeholder: t('taskName'), value: name, onInput: (e) => setName(e.currentTarget.value) }),
            // §42.2 Schedule Builder：daily/weekly/monthly/custom
            jsx('div', { className: 'evo-sched-modes', role: 'group', 'aria-label': t('scheduleMode'), children: (['daily', 'weekly', 'monthly', 'custom'] as const).map((m) => jsx('button', {
              type: 'button',
              className: 'evo-insp-subtab',
              'data-active': mode === m || undefined,
              onClick: () => setMode(m),
              children: m === 'daily' ? t('daily') : m === 'weekly' ? t('weekly') : m === 'monthly' ? t('monthly') : t('custom'),
            }, m)) }),
            jsx('div', { className: 'evo-sched-fields', children: [
              mode !== 'custom' && jsx('select', {
                className: 'evo-panel-input evo-sched-select',
                value: String(hour),
                onChange: (e) => setHour(Number(e.currentTarget.value)),
                'aria-label': t('hour'),
                children: Array.from({ length: 24 }, (_, i) => jsx('option', { value: String(i), children: `${String(i).padStart(2, '0')}:00` }, i)),
              }),
              mode !== 'custom' && jsx('select', {
                className: 'evo-panel-input evo-sched-select',
                value: String(minute),
                onChange: (e) => setMinute(Number(e.currentTarget.value)),
                'aria-label': t('minute'),
                children: [0, 15, 30, 45].map((m) => jsx('option', { value: String(m), children: `${String(hour).padStart(2, '0')}:${String(m).padStart(2, '0')}` }, m)),
              }),
              mode === 'weekly' && jsx('select', {
                className: 'evo-panel-input evo-sched-select',
                value: String(weekday),
                onChange: (e) => setWeekday(Number(e.currentTarget.value)),
                'aria-label': t('weekday'),
                children: [[t('weekdayMon'), 1], [t('weekdayTue'), 2], [t('weekdayWed'), 3], [t('weekdayThu'), 4], [t('weekdayFri'), 5], [t('weekdaySat'), 6], [t('weekdaySun'), 0]].map(([label, v]) => jsx('option', { value: String(v), children: label }, v)),
              }),
              mode === 'monthly' && jsx('select', {
                className: 'evo-panel-input evo-sched-select',
                value: String(dayOfMonth),
                onChange: (e) => setDayOfMonth(Number(e.currentTarget.value)),
                'aria-label': t('dayOfMonth'),
                children: Array.from({ length: 28 }, (_, i) => jsx('option', { value: String(i + 1), children: `${t('day')} ${i + 1}` }, i + 1)),
              }),
              mode === 'custom' && jsx('input', {
                type: 'text',
                className: 'evo-panel-input evo-panel-input-cron',
                placeholder: t('cronHint'),
                value: cronInput,
                onInput: (e) => setCronInput(e.currentTarget.value),
                'aria-label': t('customCron'),
              }),
              jsx('code', { className: 'evo-sched-preview', children: cronPreview }),
            ] }),
            jsx('div', { className: 'evo-sched-templates', children: TEMPLATES.map((t) => jsx('button', {
              type: 'button',
              className: 'evo-sched-template',
              title: t.prompt,
              onClick: () => applyTemplate(t),
              children: t.name,
            }, t.name)) }),
            jsx('input', { type: 'text', className: 'evo-panel-input', placeholder: t('promptHint'), value: prompt, onInput: (e) => setPrompt(e.currentTarget.value) }),
            jsx('button', { type: 'button', className: 'evo-panel-add', disabled: adding || !name.trim() || !prompt.trim(), onClick: addTask, children: jsxs(Fragment, { children: [jsx(Plus, {}), jsx('span', { children: t('add') })] }) }),
          ],
        }),
        tasks === null
          ? jsx(LoadingRow, {})
          : (tasks ?? []).length === 0
            ? jsx('span', { className: 'evo-panel-hint', children: t('noScheduledTasks') })
            : jsx('div', {
                className: 'evo-panel-list',
                children: (tasks ?? []).map((task) => {
                  const taskId = task.taskId ?? task.id
                  const nextAt = typeof task.nextRunAt === 'number' ? new Date(task.nextRunAt).toLocaleString() : null
                  return jsx('div', {
                    className: 'evo-panel-item',
                    children: jsxs(Fragment, {
                      children: [
                        jsx(ListChecks, {}),
                        jsx('span', { className: 'evo-panel-item-main', children: task.name ?? taskId }),
                        task.cron !== undefined && jsx('code', { className: 'evo-panel-item-code', children: task.cron }),
                        nextAt !== null && jsx('span', { className: 'evo-panel-item-num', title: t('nextRun'), children: nextAt }),
                        task.lastResultThreadId !== undefined && jsx('button', {
                          type: 'button',
                          className: 'evo-panel-act',
                          title: t('openResultThread'),
                          'aria-label': t('openResultThread'),
                          onClick: () => onOpenThread(task.lastResultThreadId as string),
                          children: jsx(ExternalLink, {}),
                        }),
                        jsx('button', {
                          type: 'button',
                          className: 'evo-panel-act',
                          title: t('runNow'),
                          'aria-label': t('runNow'),
                          disabled: runningNow === taskId,
                          onClick: () => runNow(taskId),
                          children: jsx(Play, {}),
                        }),
                        jsx('button', {
                          type: 'button',
                          className: 'evo-panel-act',
                          title: t('reportToChat'),
                          'aria-label': t('reportToChat'),
                          disabled: reporting === taskId,
                          onClick: () => reportToChat(taskId),
                          children: jsx(Send, {}),
                        }),
                        jsx('button', { type: 'button', className: 'evo-panel-del', title: t('remove'), onClick: () => removeTask(taskId), children: jsx(Trash2, {}) }),
                      ],
                    }),
                  }, taskId)
                }),
              }),
      ],
    }),
  })
}

interface SkillProposal {
  proposalId: string
  name: string
  description?: string
  action?: 'create' | 'update'
  content?: string
  sourceObservationIds?: readonly string[]
  status: 'pending' | 'approved' | 'rejected'
  createdAt?: number
}

type SkillFilter = 'all' | 'pending' | 'approved' | 'rejected'

interface CatalogSkill {
  name: string
  description?: string
  whenToUse?: string
  invocation?: { modelInvocable?: boolean; userInvocable?: boolean }
  source?: string
}

/** Marketplace（§42.6）：三层技能目录浏览 + 搜索 + 详情。 */
function MarketplaceView() {
  const [skills, setSkills] = useState<CatalogSkill[] | null>(null)
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = () => {
    setSkills(null)
    void api<{ skills: CatalogSkill[] }>('skills-catalog')
      .then((r) => setSkills(r.skills ?? []))
      .catch((e: any) => setError(String(e?.message ?? e)))
  }
  useEffect(() => { load() }, [])
  const q = query.trim().toLowerCase()
  const rows = (skills ?? []).filter((s) => q === '' || (s.name ?? '').toLowerCase().includes(q) || (s.description ?? '').toLowerCase().includes(q))
  return jsxs(Fragment, {
    children: [
      error !== null && jsx('div', { className: 'evo-panel-error', children: error }),
      jsx('div', {
        className: 'evo-panel-form',
        children: [
          jsx('input', {
            type: 'text',
            className: 'evo-panel-input',
            placeholder: t('searchSkills'),
            value: query,
            onInput: (e) => setQuery(e.currentTarget.value),
            'aria-label': t('searchSkills'),
          }),
          jsx('span', { className: 'evo-panel-hint', children: `${rows.length} skills` }),
        ],
      }),
      skills === null
        ? jsx(LoadingRow, {})
        : rows.length === 0
          ? jsx('span', { className: 'evo-panel-hint', children: t('noSkillsFound') })
          : jsx('div', {
              className: 'evo-panel-list',
              children: rows.map((s) => jsxs('div', {
                className: 'evo-skill-card',
                children: [
                  jsxs('div', {
                    className: 'evo-skill-head',
                    children: [
                      jsx('button', {
                        type: 'button',
                        className: 'evo-skill-name-btn',
                        onClick: () => setExpanded((v) => (v === s.name ? null : s.name)),
                        children: jsx('span', { className: 'evo-panel-item-main', children: s.name }),
                      }),
                      s.source !== undefined && jsx('span', { className: 'evo-skill-source', title: s.source, children: s.source.split('/').pop() }),
                    ],
                  }),
                  s.description !== undefined && s.description !== '' && jsx('div', { className: 'evo-skill-desc', children: s.description }),
                  expanded === s.name && jsxs('div', {
                    className: 'evo-skill-detail',
                    children: [
                      s.whenToUse !== undefined && s.whenToUse !== '' && jsx('div', { children: jsxs(Fragment, { children: [jsx('b', { children: t('whenToUse') }), jsx('span', { children: s.whenToUse })] }) }),
                      s.invocation !== undefined && jsx('div', { className: 'evo-skill-src', children: `model ${s.invocation.modelInvocable ? '✓' : '✗'} · user ${s.invocation.userInvocable ? '✓' : '✗'}` }),
                    ],
                  }),
                ],
              }, s.name)),
            }),
    ],
  })
}

/** Research Skills 面板：AutoSkills 提案列表 + 审核/运行。 */
export function SkillsPanel() {
  const [proposals, setProposals] = useState<SkillProposal[] | null>(null)
  const [filter, setFilter] = useState<SkillFilter>('all')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [view, setView] = useState<'proposals' | 'marketplace'>('proposals')
  // §42.9 AutoSkills 调度配置
  const [asEnabled, setAsEnabled] = useState(true)
  const [asMode, setAsMode] = useState('review')
  const [asCadence, setAsCadence] = useState('weekly')
  const [asTime, setAsTime] = useState('03:00')
  const [asCron, setAsCron] = useState<string | null>(null)
  const [asSaving, setAsSaving] = useState(false)
  useEffect(() => {
    void api<{ enabled?: boolean; mode?: string; cadence?: string; time?: string }>('autoskills-config')
      .then((cfg) => {
        if (typeof cfg.enabled === 'boolean') setAsEnabled(cfg.enabled)
        if (typeof cfg.mode === 'string') setAsMode(cfg.mode)
        if (typeof cfg.cadence === 'string') setAsCadence(cfg.cadence)
        if (typeof cfg.time === 'string') setAsTime(cfg.time)
      })
      .catch(() => {})
  }, [])

  const load = () => {
    setProposals(null)
    void api<SkillProposal[]>('skills', filter === 'all' ? {} : { status: filter })
      .then(setProposals)
      .catch((e: any) => setError(String(e?.message ?? e)))
  }

  useEffect(() => { load() }, [filter])

  const [generating, setGenerating] = useState(false)
  const generate = () => {
    if (generating) return
    setGenerating(true)
    setError(null)
    void api<{ created: number }>('skills/generate', {})
      .then((result) => {
        setGenerating(false)
        if (result.created > 0) load()
        else setError(t('noCandidateClusters'))
      })
      .catch((e: any) => { setGenerating(false); setError(String(e?.message ?? e)) })
  }

  const act = (proposalId: string, kind: 'approve' | 'reject' | 'run') => {
    setBusy(proposalId)
    void api<{ ok: boolean }>(`skills/${kind}`, { proposalId })
      .then((result) => {
        setBusy(null)
        if (result.ok) load()
        else setError(t('opFailed'))
      })
      .catch((e: any) => { setBusy(null); setError(String(e?.message ?? e)) })
  }

  const tab = (key: SkillFilter, label: string) => jsx('button', {
    type: 'button',
    className: 'evo-insp-subtab',
    'data-active': filter === key || undefined,
    onClick: () => setFilter(key),
    children: label,
  }, key)

  const proposalsView = jsxs(Fragment, {
    children: [
      jsxs('div', {
        className: 'evo-skill-tabs',
        children: [tab('all', t('all')), tab('pending', t('pending')), tab('approved', t('approved')), tab('rejected', t('rejected'))],
      }),
      jsx('div', {
        className: 'evo-panel-form',
        children: [
          jsx('button', {
            type: 'button',
            className: 'evo-panel-add',
            disabled: generating,
            onClick: generate,
            children: jsxs(Fragment, { children: [jsx(Sparkles, {}), jsx('span', { children: generating ? t('generating') : t('generateProposals') })] }),
          }),
        ],
      }),
      // §42.9 AutoSkills 调度设置：enabled / mode / cadence / time（保存时 reconcile scheduler）
      jsx('div', { className: 'evo-panel-form', children: [
        jsx('div', { className: 'evo-panel-label', children: t('autoskillsSchedule') }),
        jsxs('div', { className: 'evo-sched-fields', children: [
          jsx('label', { className: 'evo-panel-check', children: jsxs(Fragment, { children: [
            jsx('input', { type: 'checkbox', checked: asEnabled, onChange: (e) => setAsEnabled(e.currentTarget.checked) }),
            jsx('span', { children: t('enabled') }),
          ] }) }),
          jsx('select', {
            className: 'evo-panel-input evo-sched-select',
            value: asMode,
            onChange: (e) => setAsMode(e.currentTarget.value),
            'aria-label': t('autoskillsMode'),
            children: [jsx('option', { value: 'review', children: t('review') }, 'review'), jsx('option', { value: 'auto', children: t('auto') }, 'auto')],
          }),
          jsx('select', {
            className: 'evo-panel-input evo-sched-select',
            value: asCadence,
            onChange: (e) => setAsCadence(e.currentTarget.value),
            'aria-label': t('autoskillsCadence'),
            children: [['nightly', t('nightly')], ['weekly', t('weekly')], ['monthly', t('monthly')]].map(([v, label]) => jsx('option', { value: v, children: label }, v)),
          }),
          jsx('input', {
            type: 'time',
            className: 'evo-panel-input evo-sched-select',
            value: asTime,
            onChange: (e) => setAsTime(e.currentTarget.value),
            'aria-label': t('autoskillsTime'),
          }),
          jsx('button', {
            type: 'button',
            className: 'evo-btn evo-btn-ok',
            disabled: asSaving,
            onClick: () => {
              setAsSaving(true)
              void api<{ saved?: boolean; cron?: string | null }>('autoskills-config', { enabled: asEnabled, mode: asMode, cadence: asCadence, time: asTime })
                .then((r) => { setAsSaving(false); setAsCron(r.cron ?? null); setError(r.saved === true ? null : t('saveFailed')) })
                .catch((e: any) => { setAsSaving(false); setError(String(e?.message ?? e)) })
            },
            children: jsxs(Fragment, { children: [jsx(Check, {}), jsx('span', { children: asSaving ? t('saving') : t('save') })] }),
          }),
        ] }),
        asCron !== null && jsx('code', { className: 'evo-sched-preview', children: `cron ${asCron}` }),
      ] }),
      error !== null && jsx('div', { className: 'evo-panel-error', children: error }),
      proposals === null
        ? jsx(LoadingRow, {})
        : proposals.length === 0
          ? jsx('span', { className: 'evo-panel-hint', children: t('noSkillProposals') })
          : jsx('div', {
              className: 'evo-panel-list',
              children: proposals.map((p) => jsxs('div', {
                className: 'evo-skill-card',
                children: [
                  jsxs('div', {
                    className: 'evo-skill-head',
                    children: [
                      jsx('span', { className: 'evo-panel-item-main', children: p.name }),
                      jsx('span', { className: `evo-skill-status ${p.status}`, children: p.status }),
                      p.action !== undefined && jsx('span', { className: 'evo-skill-action', children: p.action }),
                    ],
                  }),
                  p.description !== '' && p.description !== undefined && jsx('div', { className: 'evo-skill-desc', children: p.description }),
                  p.sourceObservationIds !== undefined && p.sourceObservationIds.length > 0
                    && jsx('div', { className: 'evo-skill-src', children: `${p.sourceObservationIds.length} ${t('observations')}` }),
                  p.status === 'pending' && jsxs('div', {
                    className: 'evo-skill-actions',
                    children: [
                      jsx('button', {
                        type: 'button',
                        className: 'evo-btn evo-btn-ok',
                        disabled: busy !== null,
                        onClick: () => act(p.proposalId, 'approve'),
                        children: jsxs(Fragment, { children: [jsx(Check, {}), jsx('span', { children: t('approve') })] }),
                      }),
                      jsx('button', {
                        type: 'button',
                        className: 'evo-btn evo-btn-danger',
                        disabled: busy !== null,
                        onClick: () => act(p.proposalId, 'reject'),
                        children: jsxs(Fragment, { children: [jsx(XIcon, {}), jsx('span', { children: t('reject') })] }),
                      }),
                    ],
                  }),
                  p.status === 'approved' && jsx('div', {
                    className: 'evo-skill-actions',
                    children: jsx('button', {
                      type: 'button',
                      className: 'evo-btn evo-btn-run',
                      disabled: busy !== null,
                      onClick: () => act(p.proposalId, 'run'),
                      children: jsxs(Fragment, { children: [jsx(Play, {}), jsx('span', { children: t('run') })] }),
                    }),
                  }),
                ],
              }, p.proposalId)),
            }),
    ],
  })

  return jsx(PanelShell, {
    icon: GraduationCap,
    title: t('researchSkills'),
    children: jsxs(Fragment, {
      children: [
        jsxs('div', {
          className: 'evo-skill-tabs',
          children: [
            jsx('button', { type: 'button', className: 'evo-insp-subtab', 'data-active': view === 'proposals' || undefined, onClick: () => setView('proposals'), children: t('proposals') }),
            jsx('button', { type: 'button', className: 'evo-insp-subtab', 'data-active': view === 'marketplace' || undefined, onClick: () => setView('marketplace'), children: t('marketplace') }),
          ],
        }),
        view === 'marketplace' ? jsx(MarketplaceView, {}) : proposalsView,
      ],
    }),
  })
}

interface GoalRow {
  goalId?: string
  id?: string
  title?: string
  status?: string
  progress?: number
  objective?: string
  criteria?: Array<{ id: string; text: string; satisfied: boolean; evidence: readonly string[] }>
  constraints?: readonly string[]
  version?: number
  updatedAt?: number
}

interface GoalProposalRow {
  proposalId: string
  goalId: string
  title: string
  summary: string
  changes: Record<string, unknown>
  status: 'pending' | 'approved' | 'rejected'
  createdAt: number
}

interface ProjectRow { name: string; path?: string }

/** 项目环境信息（§环境管理）。 */
interface ProjectEnvRow {
  uv: string | null
  envDir: string
  pythonPath: string
  exists: boolean
  pythonVersion: string
  packages: string[]
}

/** 单个项目的环境卡片（状态 + 创建/装包/删除；UV 缺失时自动安装）。 */
function ProjectEnvCard({ projectDir, onError }: { projectDir: string; onError: (m: string) => void }) {
  const [info, setInfo] = useState<ProjectEnvRow | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [uvBusy, setUvBusy] = useState(false)
  const [version, setVersion] = useState('3.12')
  const [pkgInput, setPkgInput] = useState('')
  const [confirmRemove, setConfirmRemove] = useState(false)

  const load = () => {
    setInfo(null)
    void api<ProjectEnvRow>('env-status', { projectDir }).then(setInfo).catch((e: any) => onError(String(e?.message ?? e)))
  }
  useEffect(() => { if (expanded) load() }, [expanded, projectDir])

  // UV 缺失 → 自动安装（官方脚本；一次成功即刷新状态）
  useEffect(() => {
    if (!expanded || info === null || info.uv !== null || uvBusy) return
    setUvBusy(true)
    void api<{ ok: boolean; installed: boolean; error?: string }>('uv-ensure', {})
      .then((result) => {
        setUvBusy(false)
        if (result.ok) load()
        else onError(`${t('uvInstallFailed')}: ${result.error ?? ''}`)
      })
      .catch((e: any) => { setUvBusy(false); onError(String(e?.message ?? e)) })
  }, [expanded, info, uvBusy])

  const doCreate = () => {
    setBusy(true)
    void api<ProjectEnvRow>('env-create', { projectDir, pythonVersion: version.trim() || '3.12' })
      .then((row) => { setBusy(false); setInfo(row) })
      .catch((e: any) => { setBusy(false); onError(String(e?.message ?? e)) })
  }
  const doInstall = () => {
    const pkgs = pkgInput.trim()
    if (pkgs === '') return
    setBusy(true)
    void api<{ ok: boolean }>('env-install', { projectDir, packages: pkgs.split(/\s+/) })
      .then(() => { setBusy(false); setPkgInput(''); load() })
      .catch((e: any) => { setBusy(false); onError(String(e?.message ?? e)) })
  }
  const doRemove = () => {
    setConfirmRemove(false)
    setBusy(true)
    void api<{ ok: boolean }>('env-remove', { projectDir })
      .then(() => { setBusy(false); load() })
      .catch((e: any) => { setBusy(false); onError(String(e?.message ?? e)) })
  }

  return jsxs('div', {
    className: 'evo-env-card',
    children: [
      jsxs('button', {
        type: 'button',
        className: 'evo-env-head',
        onClick: () => setExpanded((v) => !v),
        children: [
          jsx(Boxes, {}),
          jsx('span', { children: t('projectEnv') }),
          jsx('span', { style: { flex: 1 } }),
          info === null
            ? jsx('span', { className: 'evo-env-state', children: t('loading') })
            : info.uv === null
              ? jsx('span', { className: 'evo-env-state evo-env-missing', children: uvBusy ? t('uvInstalling') : t('uvMissing') })
              : info.exists
                ? jsx('span', { className: 'evo-env-state evo-env-ok', children: info.pythonVersion.replace('Python ', '') })
                : jsx('span', { className: 'evo-env-state evo-env-missing', children: t('envMissing') }),
          expanded ? jsx(ChevronDown, {}) : jsx(ChevronRight, {}),
        ],
      }),
      expanded && jsxs('div', {
        className: 'evo-env-body',
        children: [
          info !== null && jsx('code', { className: 'evo-panel-item-code', children: info.envDir }),
          info !== null && info.uv === null && jsxs('div', {
            className: 'evo-env-uvrow',
            children: [
              jsx('span', { className: 'evo-env-uvhint', children: t('uvInstalling') }),
              jsx('button', {
                type: 'button',
                className: 'evo-panel-add',
                disabled: uvBusy,
                onClick: () => { setUvBusy(false); load() },
                children: jsx('span', { children: t('retryUv') }),
              }),
            ],
          }),
          info !== null && info.exists && jsx('div', {
            className: 'evo-env-pkgs',
            children: info.packages.length > 0
              ? `${info.packages.length} ${t('packages')}: ${info.packages.slice(0, 12).join(', ')}${info.packages.length > 12 ? '…' : ''}`
              : t('noPackagesYet'),
          }),
          // 创建（未存在时）
          !info?.exists && jsxs('div', {
            className: 'evo-panel-form',
            children: [
              jsx('input', {
                type: 'text',
                className: 'evo-panel-input',
                placeholder: t('pythonVersionHint'),
                value: version,
                disabled: busy,
                onInput: (e) => setVersion(e.currentTarget.value),
              }),
              jsx('button', {
                type: 'button',
                className: 'evo-panel-add',
                disabled: busy,
                onClick: doCreate,
                children: jsxs(Fragment, { children: [jsx(Plus, {}), jsx('span', { children: busy ? t('creating') : t('createEnv') })] }),
              }),
            ],
          }),
          // 安装包 + 删除（已存在时）
          info?.exists && jsxs(Fragment, {
            children: [
              jsxs('div', {
                className: 'evo-panel-form',
                children: [
                  jsx('input', {
                    type: 'text',
                    className: 'evo-panel-input',
                    placeholder: t('installPkgsHint'),
                    value: pkgInput,
                    disabled: busy,
                    onInput: (e) => setPkgInput(e.currentTarget.value),
                    onKeyDown: (e) => { if (e.key === 'Enter') doInstall() },
                  }),
                  jsx('button', {
                    type: 'button',
                    className: 'evo-panel-add',
                    disabled: busy || pkgInput.trim() === '',
                    onClick: doInstall,
                    children: jsxs(Fragment, { children: [jsx(Download, {}), jsx('span', { children: busy ? t('installing') : t('installPkgs') })] }),
                  }),
                ],
              }),
              confirmRemove
                ? jsx('button', { type: 'button', className: 'evo-tl-del-confirm', disabled: busy, onClick: doRemove, children: t('deleteQ') })
                : jsx('button', {
                    type: 'button',
                    className: 'evo-tl-del',
                    disabled: busy,
                    onClick: () => { setConfirmRemove(true); setTimeout(() => setConfirmRemove(false), 5000) },
                    children: jsxs(Fragment, { children: [jsx(Trash2, {}), jsx('span', { children: t('removeEnv') })] }),
                  }),
            ],
          }),
        ],
      }),
    ],
  })
}

/** Workspace 面板：项目列表 + 新建项目 + Import Project + 每项目环境。 */
export function WorkspacePanel() {
  const [projects, setProjects] = useState<ProjectRow[] | null>(null)
  const [sourcePath, setSourcePath] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)

  const load = () => {
    setProjects(null)
    void api<ProjectRow[]>('projects').then(setProjects).catch((e: any) => setError(String(e?.message ?? e)))
  }

  useEffect(() => { load() }, [])

  const doCreate = () => {
    if (!newName.trim()) return
    setCreating(true)
    setError(null)
    void api<ProjectRow>('projects-create', { name: newName.trim() }).then((project) => {
      setCreating(false)
      if (project?.name !== undefined) { setNewName(''); load() }
      else setError(t('createFailed'))
    }).catch((e: any) => { setCreating(false); setError(String(e?.message ?? e)) })
  }

  const doImport = () => {
    if (!sourcePath.trim()) return
    setImporting(true)
    setError(null)
    void api<ProjectRow>('projects-import', {
      sourcePath: sourcePath.trim(),
      ...(name.trim() === '' ? {} : { name: name.trim() }),
    }).then((project) => {
      setImporting(false)
      if (project?.name !== undefined) { setSourcePath(''); setName(''); load() }
      else setError(t('importFailed'))
    }).catch((e: any) => { setImporting(false); setError(String(e?.message ?? e)) })
  }

  return jsx(PanelShell, {
    icon: FolderGit2,
    title: t('workspace'),
    children: jsxs(Fragment, {
      children: [
        error !== null && jsx('div', { className: 'evo-panel-error', children: error }),
        jsxs('div', {
          className: 'evo-panel-form',
          children: [
            jsx('input', {
              type: 'text',
              className: 'evo-panel-input',
              placeholder: t('newProjectName'),
              value: newName,
              onInput: (e) => setNewName(e.currentTarget.value),
              onKeyDown: (e: { key: string }) => { if (e.key === 'Enter') doCreate() },
            }),
            jsx('button', {
              type: 'button',
              className: 'evo-panel-add',
              disabled: creating || !newName.trim(),
              onClick: doCreate,
              children: jsxs(Fragment, { children: [jsx(Plus, {}), jsx('span', { children: creating ? t('creating') : t('newProject') })] }),
            }),
          ],
        }),
        jsxs('div', {
          className: 'evo-panel-form',
          children: [
            jsx('input', {
              type: 'text',
              className: 'evo-panel-input',
              placeholder: t('projectPathHint'),
              value: sourcePath,
              onInput: (e) => setSourcePath(e.currentTarget.value),
            }),
            jsx('input', {
              type: 'text',
              className: 'evo-panel-input',
              placeholder: t('projectNameHint'),
              value: name,
              onInput: (e) => setName(e.currentTarget.value),
            }),
            jsx('button', {
              type: 'button',
              className: 'evo-panel-add',
              disabled: importing || !sourcePath.trim(),
              onClick: doImport,
              children: jsxs(Fragment, { children: [jsx(FolderUp, {}), jsx('span', { children: t('importProject') })] }),
            }),
          ],
        }),
        jsxs('div', {
          className: 'evo-panel-row',
          children: [
            jsx('span', { className: 'evo-panel-row-label', children: t('projects') }),
            jsx('span', { style: { flex: 1 } }),
            jsx('button', { type: 'button', className: 'evo-icon-btn', title: t('refresh'), onClick: load, children: jsx(RefreshCw, {}) }),
          ],
        }),
        projects === null
          ? jsx(LoadingRow, {})
          : (projects ?? []).length === 0
            ? jsx('span', { className: 'evo-panel-hint', children: t('noProjectsYet') })
            : jsx('div', {
                className: 'evo-panel-list',
                children: (projects ?? []).map((p) => jsxs('div', {
                  className: 'evo-panel-item evo-panel-item-wrap',
                  children: [
                    jsxs('div', {
                      className: 'evo-panel-item-row',
                      children: [
                        jsx(FolderGit2, {}),
                        jsx('span', { className: 'evo-panel-item-main', children: p.name }),
                        p.path !== undefined && jsx('code', { className: 'evo-panel-item-code', children: p.path }),
                      ],
                    }),
                    p.path !== undefined && jsx(ProjectEnvCard, { projectDir: p.path, onError: (m) => setError(m) }),
                  ],
                }, p.name)),
              }),
      ],
    }),
  })
}

interface ChannelRow {
  id: string
  name: string
  online: boolean
  received: number
  sent: number
  error?: string
}

/** Channels 面板：消息通道状态 + 启动/停止。 */
export function ChannelsPanel() {
  const [channels, setChannels] = useState<ChannelRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = () => {
    setChannels(null)
    void api<ChannelRow[]>('channels-status').then(setChannels).catch((e: any) => setError(String(e?.message ?? e)))
  }

  useEffect(() => { load() }, [])

  const toggle = (row: ChannelRow) => {
    setBusy(row.id)
    setError(null)
    void api<{ ok: boolean }>(row.online ? 'channel-stop' : 'channel-start', { id: row.id })
      .then((result) => {
        setBusy(null)
        if (result.ok) load()
        else setError(t('opFailed'))
      })
      .catch((e: any) => { setBusy(null); setError(String(e?.message ?? e)) })
  }

  return jsx(PanelShell, {
    icon: Cable,
    title: t('channels'),
    children: jsxs(Fragment, {
      children: [
        jsxs('div', {
          className: 'evo-panel-row',
          children: [
            jsx('span', { className: 'evo-panel-row-label', children: t('messagingChannels') }),
            jsx('span', { style: { flex: 1 } }),
            jsx('button', { type: 'button', className: 'evo-icon-btn', title: t('refresh'), onClick: load, children: jsx(RefreshCw, {}) }),
          ],
        }),
        error !== null && jsx('div', { className: 'evo-panel-error', children: error }),
        channels === null
          ? jsx(LoadingRow, {})
          : (channels ?? []).length === 0
            ? jsx('span', { className: 'evo-panel-hint', children: t('noChannels') })
            : jsx('div', {
                className: 'evo-panel-list',
                children: (channels ?? []).map((c) => jsxs('div', {
                  className: 'evo-panel-item evo-channel-row',
                  children: [
                    jsx(Cable, {}),
                    jsx('span', { className: 'evo-panel-item-main', children: c.name }),
                    jsx('span', { className: `evo-channel-badge${c.online ? ' online' : ''}`, children: c.online ? t('online') : t('offline') }),
                    c.received + c.sent > 0 && jsx('span', { className: 'evo-channel-counts', children: `↓${c.received} ↑${c.sent}` }),
                    jsx('button', {
                      type: 'button',
                      className: `evo-channel-toggle${c.online ? ' stop' : ''}`,
                      disabled: busy !== null,
                      title: c.online ? t('stopChannel') : t('startChannel'),
                      onClick: () => toggle(c),
                      children: c.online ? jsx(PowerOff, {}) : jsx(Power, {}),
                    }),
                  ],
                }, c.id)),
              }),
        channels !== null && (channels ?? []).some((c) => c.error !== undefined)
          && jsx('div', { className: 'evo-panel-hint', children: (channels ?? []).filter((c) => c.error !== undefined).map((c) => `${c.name}: ${c.error}`).join(' · ') }),
      ],
    }),
  })
}

interface ExpertRow {
  name: string
  description?: string
  invitedAt: number
}

/** Team 面板：科研角色团队 + 邀请/清空。 */
export function TeamPanel() {
  const [experts, setExperts] = useState<ExpertRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = () => {
    setExperts(null)
    void api<ExpertRow[]>('experts').then(setExperts).catch((e: any) => setError(String(e?.message ?? e)))
  }

  useEffect(() => { load() }, [])

  const invite = (name: string) => {
    setBusy(name)
    void api<{ ok: boolean }>('expert-invite', { name })
      .then((result) => {
        setBusy(null)
        if (result.ok) load()
        else setError(t('inviteFailed'))
      })
      .catch((e: any) => { setBusy(null); setError(String(e?.message ?? e)) })
  }

  const clearAll = () => {
    setBusy('__clear__')
    void api<{ ok: boolean }>('expert-clear')
      .then((result) => {
        setBusy(null)
        if (result.ok) load()
        else setError(t('clearFailed'))
      })
      .catch((e: any) => { setBusy(null); setError(String(e?.message ?? e)) })
  }

  const invitedCount = (experts ?? []).filter((e) => e.invitedAt !== 0).length

  return jsx(PanelShell, {
    icon: Users,
    title: t('team'),
    children: jsxs(Fragment, {
      children: [
        jsxs('div', {
          className: 'evo-panel-row',
          children: [
            jsx('span', { className: 'evo-panel-row-label', children: t('researchExperts') }),
            jsx('span', { style: { flex: 1 } }),
            invitedCount > 0 && jsx('button', {
              type: 'button',
              className: 'evo-btn evo-btn-danger',
              disabled: busy !== null,
              onClick: clearAll,
              children: jsxs(Fragment, { children: [jsx(Ban, {}), jsx('span', { children: t('clear') })] }),
            }),
            jsx('button', { type: 'button', className: 'evo-icon-btn', title: t('refresh'), onClick: load, children: jsx(RefreshCw, {}) }),
          ],
        }),
        error !== null && jsx('div', { className: 'evo-panel-error', children: error }),
        experts === null
          ? jsx(LoadingRow, {})
          : jsx('div', {
              className: 'evo-panel-list',
              children: (experts ?? []).map((e) => jsxs('div', {
                className: 'evo-panel-item evo-team-row',
                children: [
                  jsx(Users, {}),
                  jsxs('div', {
                    className: 'evo-team-info',
                    children: [
                      jsx('div', { className: 'evo-team-name', children: e.name }),
                      e.description !== undefined && e.description !== '' && jsx('div', { className: 'evo-team-desc', children: e.description }),
                    ],
                  }),
                  e.invitedAt !== 0
                    ? jsx('span', { className: 'evo-channel-badge online', children: t('invited') })
                    : jsx('button', {
                        type: 'button',
                        className: 'evo-btn evo-btn-ok',
                        disabled: busy !== null,
                        onClick: () => invite(e.name),
                        children: jsxs(Fragment, { children: [jsx(UserPlus, {}), jsx('span', { children: t('invite') })] }),
                      }),
                ],
              }, e.name)),
            }),
      ],
    }),
  })
}
