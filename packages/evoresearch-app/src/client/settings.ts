/**
 * 设置弹窗：主题 / 语言 / 模型（只读指引）/ 关于。
 *
 * - 主题：light / dark / system（html.dark 驱动）
 * - 语言：中 / 英（localStorage，切换后刷新）
 * - 模型：由 DSH 设置管理（模型选择在官方设置面；此处给指引）
 */
import { jsx, jsxs, Fragment } from 'react/jsx-runtime'
import { useState } from 'react'
import { X, Palette, Languages, Cpu, Info } from 'lucide-react'
import { t, readLang } from './i18n'
import { readPreference, applyTheme } from './theme'

export interface SettingsDialogProps {
  onClose: () => void
}

export function SettingsDialog({ onClose }: SettingsDialogProps) {
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
