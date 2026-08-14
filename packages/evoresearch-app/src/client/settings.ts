/**
 * 设置弹窗：主题 / 语言 / 权限模式 / 模型 / 插件清单 / 关于。
 */
import { jsx, jsxs, Fragment } from 'react/jsx-runtime'
import { useState, useEffect } from 'react'
import { X, Palette, Languages, Cpu, Info, Puzzle, ShieldCheck as ShieldCheckIcon } from 'lucide-react'
import { t, readLang } from './i18n'
import { readPreference, applyTheme } from './theme'

export interface SettingsDialogProps {
  onClose: () => void
  /** 当前会话 id（权限切换目标；无会话时为 null）。 */
  sessionId: string | null
}

interface PluginRow { id: string; state: string }

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
  const [themePref, setThemePref] = useState(readPreference())
  const [lang, setLangState] = useState(localStorage.getItem('evoresearch-lang') === 'zh' ? 'zh' : 'en')

  const changeTheme = (value: 'light' | 'dark' | 'system') => {
    setThemePref(value)
    localStorage.setItem('evoresearch-theme', value)
    applyTheme()
  }

  const changeLang = (value: 'zh' | 'en') => {
    setLangState(value)
    localStorage.setItem('evoresearch-lang', value)
  }

  return jsxs('div', {
    className: 'evo-modal-mask',
    onPointerDown: (e: { target: HTMLElement; currentTarget: HTMLElement }) => { if (e.target === e.currentTarget) onClose() },
    children: [
      jsxs('div', {
        className: 'evo-modal',
        children: [
          jsxs('div', {
            className: 'evo-modal-head',
            children: [
              jsx('div', { className: 'evo-modal-title', children: t('settings') }),
              jsx('button', { type: 'button', className: 'evo-icon-btn', onClick: onClose, title: t('close'), children: jsx(X, {}) }),
            ],
          }),
          jsx('div', {
            className: 'evo-modal-body',
            children: jsxs(Fragment, {
              children: [
                // ── 主题 ──
                jsxs('div', {
                  className: 'evo-setting',
                  children: [
                    jsxs('div', {
                      className: 'evo-setting-label',
                      children: [jsx(Palette, {}), jsx('span', { children: t('theme') })],
                    }),
                    jsxs('div', {
                      className: 'evo-setting-options',
                      children: [
                        jsx('button', { type: 'button', className: 'evo-setting-option', 'data-active': themePref === 'light' || undefined, onClick: () => changeTheme('light'), children: t('light') }),
                        jsx('button', { type: 'button', className: 'evo-setting-option', 'data-active': themePref === 'dark' || undefined, onClick: () => changeTheme('dark'), children: t('dark') }),
                        jsx('button', { type: 'button', className: 'evo-setting-option', 'data-active': themePref === 'system' || undefined, onClick: () => changeTheme('system'), children: t('system') }),
                      ],
                    }),
                  ],
                }),
                // ── 语言 ──
                jsxs('div', {
                  className: 'evo-setting',
                  children: [
                    jsxs('div', {
                      className: 'evo-setting-label',
                      children: [jsx(Languages, {}), jsx('span', { children: t('language') })],
                    }),
                    jsxs('div', {
                      className: 'evo-setting-options',
                      children: [
                        jsx('button', { type: 'button', className: 'evo-setting-option', 'data-active': lang === 'en' || undefined, onClick: () => changeLang('en'), children: 'English' }),
                        jsx('button', { type: 'button', className: 'evo-setting-option', 'data-active': lang === 'zh' || undefined, onClick: () => changeLang('zh'), children: '中文' }),
                      ],
                    }),
                    lang !== readLang() && jsx('div', { className: 'evo-setting-hint', children: lang === 'zh' ? '切换语言后刷新页面生效' : 'Language switches take effect after refresh' }),
                  ],
                }),
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
                // ── 权限模式 ──
                jsx(PermissionSection, { sessionId }),
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
