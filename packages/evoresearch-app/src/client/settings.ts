/**
 * 设置弹窗：权限模式 / 模型 / 插件清单 / 关于。
 * （主题与语言在顶栏/标题栏切换，不在弹窗内重复。）
 */
import { jsx, jsxs, Fragment } from 'react/jsx-runtime'
import { useState, useEffect, useRef } from 'react'
import { X, Cpu, Info, Puzzle, ShieldCheck as ShieldCheckIcon } from 'lucide-react'
import { t } from './i18n'

export interface SettingsDialogProps {
  onClose: () => void
  /** 当前会话 id（权限切换目标；无会话时为 null）。 */
  sessionId: string | null
}

interface PluginRow { id: string; state: string }

/** 构建指纹（§44.2）：读取 dist/build-stamp.json（前端 hash + 构建时间）。 */
function BuildStamp() {
  const [stamp, setStamp] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    void fetch('/build-stamp.json')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || j === null || typeof j.revision !== 'string') return
        const when = typeof j.builtAt === 'string' ? ` · ${j.builtAt.slice(0, 16).replace('T', ' ')}` : ''
        setStamp(`build ${j.revision}${when}`)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])
  return stamp === null ? jsx('div', {}) : jsx('div', { style: { color: 'var(--color-text-tertiary)', fontSize: 11.5 }, children: stamp })
}

/** 权限模式选择（写 host permission 预设）。 */
function PermissionSection({ sessionId }: { sessionId: string | null }) {
  const [current, setCurrent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void fetch('/evoresearch/fs/mode').then((res) => res.json()).then((json) => {
      if (!cancelled && json.ok) setCurrent(json.value.preset)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  const switchMode = (preset: string) => {
    if (sessionId === null) { setError('打开一个会话后可切换权限模式'); return }
    void fetch('/evoresearch/fs/mode', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, preset }),
    }).then((res) => res.json()).then((json) => {
      if (json.ok) {
        setCurrent(preset)
        window.dispatchEvent(new CustomEvent('evo-mode-changed'))
      } else setError(json.error?.message ?? '切换失败')
    }).catch((e) => setError(String(e)))
  }

  const modes = [
    { key: 'read-only', label: 'Read-only' },
    { key: 'workspace-write', label: 'Write' },
    { key: 'danger-full-access', label: 'Full effect' },
  ]

  return jsxs('div', {
    className: 'evo-setting',
    children: [
      jsxs('div', {
        className: 'evo-setting-label',
        children: [jsx(ShieldCheckIcon, {}), jsx('span', { children: 'Permission' })],
      }),
      error !== null && jsx('div', { className: 'evo-setting-hint evo-setting-error', children: error }),
      jsxs('div', {
        className: 'evo-setting-options',
        children: modes.map((m) => jsx('button', {
          type: 'button',
          className: 'evo-setting-option',
          'data-active': current === m.key || undefined,
          onClick: () => switchMode(m.key),
          children: m.label,
        }, m.key)),
      }),
    ],
  })
}

/** 插件清单（host loader entries 快照，经 /evoresearch/plugins）。 */
function PluginListSection() {
  const [plugins, setPlugins] = useState<PluginRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void fetch('/evoresearch/fs/plugins', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }).then((res) => res.json()).then((json) => {
      if (cancelled) return
      if (json.ok) setPlugins(json.value.plugins)
      else setError(json.error?.message ?? '加载失败')
    }).catch((e) => { if (!cancelled) setError(String(e)) })
    return () => { cancelled = true }
  }, [])

  const stateLabel = (state: string): string => {
    if (state === '2') return 'active'
    if (state === '3') return 'failed'
    if (state === '1') return 'loading'
    return state
  }

  return jsxs('div', {
    className: 'evo-setting',
    children: [
      jsxs('div', {
        className: 'evo-setting-label',
        children: [jsx(Puzzle, {}), jsx('span', { children: 'Plugins' })],
      }),
      error !== null && jsx('div', { className: 'evo-setting-hint evo-setting-error', children: error }),
      plugins === null
        ? jsx('div', { className: 'evo-setting-hint', children: 'Loading…' })
        : jsxs('div', {
            className: 'evo-plugin-list',
            children: (plugins ?? []).map((p) => jsx('div', {
              className: 'evo-plugin-row',
              children: jsxs(Fragment, {
                children: [
                  jsx('span', { className: 'evo-plugin-id', children: p.id }),
                  jsx('span', {
                    className: `evo-plugin-state${p.state === '2' ? ' evo-plugin-ok' : ''}`,
                    children: stateLabel(p.state),
                  }),
                ],
              }),
            }, p.id)),
          }),
    ],
  })
}

export function SettingsDialog({ onClose, sessionId }: SettingsDialogProps) {
  const shellRef = useRef<HTMLDivElement | null>(null)
  // §30.2：打开聚焦首个可操作元素，关闭恢复触发按钮焦点
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const el = shellRef.current?.querySelector<HTMLElement>('button, input, textarea, [tabindex]')
    el?.focus()
    return () => { previous?.focus?.() }
  }, [])
  return jsxs('div', {
    className: 'evo-modal-mask',
    ref: shellRef,
    onPointerDown: (e: { target: HTMLElement; currentTarget: HTMLElement }) => { if (e.target === e.currentTarget) onClose() },
    children: [
      jsxs('div', {
        className: 'evo-modal',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': t('settings'),
        children: [
          jsxs('div', {
            className: 'evo-modal-head',
            children: [
              jsx('div', { className: 'evo-modal-title', children: t('settings') }),
              jsx('button', { type: 'button', className: 'evo-icon-btn', onClick: onClose, title: t('close'), 'aria-label': t('close'), children: jsx(X, {}) }),
            ],
          }),
          jsx('div', {
            className: 'evo-modal-body',
            children: jsxs(Fragment, {
              children: [
                // ── 权限模式 ──
                jsx(PermissionSection, { sessionId }),
                // ── 模型 ──
                jsxs('div', {
                  className: 'evo-setting',
                  children: [
                    jsxs('div', {
                      className: 'evo-setting-label',
                      children: [jsx(Cpu, {}), jsx('span', { children: t('model') })],
                    }),
                    jsx('div', { className: 'evo-setting-hint', children: '由 DSH 设置管理（settings.yaml 的 llm-deepseek / llm-pi-ai 段）。' }),
                  ],
                }),
                // ── 插件清单 ──
                jsx(PluginListSection, {}),
                // ── 关于 ──
                jsxs('div', {
                  className: 'evo-setting',
                  children: [
                    jsxs('div', {
                      className: 'evo-setting-label',
                      children: [jsx(Info, {}), jsx('span', { children: t('about') })],
                    }),
                    jsxs('div', {
                      className: 'evo-setting-hint',
                      children: [
                        jsx('div', { children: `EvoResearch 0.1.0-rc.1` }),
                        jsx('div', { children: t('basedOn') }),
                        jsx(BuildStamp, {}),
                      ],
                    }),
                  ],
                }),
              ],
            }),
          }),
        ],
      }),
    ],
  })
}
