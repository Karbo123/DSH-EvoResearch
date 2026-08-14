/**
 * EvoResearch 工作台（browser half）。
 *
 * 注册 root slot（web 外壳只渲染这一个 slot）并提供 app-shell 硬依赖的
 * layout 服务 —— 这两件事官方由 dsh-client-ui-layout 完成，本表面自给自足。
 *
 * 阶段 0（架构验证）：两栏工作台壳 + 会话列表 + 选中态显示，
 * 验证"自定义表面"链路（bundle → 前端 dist → root slot → 本插件渲染）。
 * 阶段 1 起接入会话打开/流式聊天/composer 与 EvoResearch 业务面板。
 */
import { jsx, jsxs, Fragment } from 'react/jsx-runtime'

/** 服务依赖：slots（注册 root slot）。layout 服务由本插件自己提供。 */
const inject = ['slots']

// ── 工作台样式（自包含，不依赖官方 ui-primitives token）─────────────────────
const CSS = `
:root { color-scheme: light; }
body { margin: 0; font-family: "Segoe UI", "Microsoft YaHei", system-ui, sans-serif; background: #f4f6fb; color: #1b2437; }
.evo-frame { display: grid; grid-template-columns: 260px 1fr; height: 100vh; }
.evo-rail { background: #0e1a3c; color: #dbe4ff; display: flex; flex-direction: column; overflow: hidden; }
.evo-brand { display: flex; align-items: center; gap: 10px; padding: 18px 16px; border-bottom: 1px solid rgba(255,255,255,.08); }
.evo-logo { width: 30px; height: 30px; border-radius: 8px; background: linear-gradient(135deg,#2f6bff,#7aa2ff); display: flex; align-items: center; justify-content: center; color: #fff; font-weight: 800; font-size: 16px; }
.evo-brand-name { font-size: 15px; font-weight: 700; letter-spacing: .3px; }
.evo-brand-sub { font-size: 11px; color: #8fa3d9; }
.evo-nav { padding: 12px 8px; }
.evo-nav-item { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 8px; color: #b9c6ee; font-size: 13px; cursor: pointer; }
.evo-nav-item:hover { background: rgba(255,255,255,.07); color: #fff; }
.evo-nav-item[data-active] { background: rgba(47,107,255,.25); color: #fff; }
.evo-sessions { flex: 1; overflow-y: auto; padding: 4px 8px 12px; }
.evo-section-title { font-size: 11px; color: #7f93c9; padding: 10px 10px 4px; letter-spacing: .5px; }
.evo-session { padding: 8px 10px; border-radius: 8px; font-size: 13px; color: #c9d4f5; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.evo-session:hover { background: rgba(255,255,255,.07); }
.evo-session[data-active] { background: rgba(47,107,255,.3); color: #fff; }
.evo-session .evo-session-sub { display: block; font-size: 11px; color: #7f93c9; }
.evo-rail-foot { padding: 12px 16px; border-top: 1px solid rgba(255,255,255,.08); font-size: 11px; color: #7f93c9; }
.evo-main { display: flex; flex-direction: column; overflow: hidden; }
.evo-topbar { display: flex; align-items: center; justify-content: space-between; padding: 10px 20px; background: #fff; border-bottom: 1px solid #e3e8f2; }
.evo-topbar-title { font-size: 14px; font-weight: 600; color: #1b2437; }
.evo-topbar-badge { font-size: 11px; color: #2f6bff; background: #e8efff; border: 1px solid #c9d8ff; padding: 3px 8px; border-radius: 999px; }
.evo-content { flex: 1; overflow-y: auto; padding: 32px 40px; }
.evo-hero { max-width: 640px; }
.evo-hero h1 { font-size: 22px; margin: 0 0 8px; }
.evo-hero p { color: #5a6b8c; font-size: 13px; line-height: 1.7; }
.evo-empty { color: #8a97b5; font-size: 13px; padding: 40px; text-align: center; }
`

/** 注入样式（与官方 client 包相同的 data-plugin-css 模式，可被 HMR 清理）。 */
function installCss() {
  const tagId = '@evoresearch/dsh-app/workspace.css'
  if (typeof document !== 'undefined' && document.querySelector(`style[data-plugin-css="${tagId}"]`) === null) {
    const tag = document.createElement('style')
    tag.dataset.plugin = '@evoresearch/dsh-app'
    tag.dataset.pluginCss = tagId
    tag.textContent = CSS
    document.head.appendChild(tag)
  }
}

/** 工作台根组件（root slot）。props 为 framework kit：useSessions/useWorkspaces。 */
function EvoFrame({ useSessions }) {
  const sessions = useSessions((s) => s)
  const currentId = sessions.current
  const rows = (sessions.ids ?? []).map((id) => sessions.byId[id]).filter(Boolean)
  const current = currentId === undefined ? undefined : sessions.byId[currentId]

  const navItems = [
    { key: 'workspace', label: '科研工作台', active: true },
    { key: 'memory', label: '科研记忆' },
    { key: 'scheduler', label: '定时任务' },
    { key: 'channels', label: '消息通道' },
    { key: 'team', label: '专家团队' },
    { key: 'settings', label: '设置' },
  ]

  return jsxs('div', {
    className: 'evo-frame',
    children: [
      jsxs('aside', {
        className: 'evo-rail',
        children: [
          jsxs('div', {
            className: 'evo-brand',
            children: [
              jsx('div', { className: 'evo-logo', children: 'R' }),
              jsxs('div', {
                children: [
                  jsx('div', { className: 'evo-brand-name', children: 'EvoResearch' }),
                  jsx('div', { className: 'evo-brand-sub', children: '科研智能体工作台' }),
                ],
              }),
            ],
          }),
          jsx('nav', {
            className: 'evo-nav',
            children: navItems.map((item) => jsx('div', {
              className: 'evo-nav-item',
              'data-active': item.active || undefined,
              children: item.label,
            }, item.key)),
          }),
          jsxs('div', {
            className: 'evo-sessions',
            children: [
              jsx('div', { className: 'evo-section-title', children: '会话' }),
              rows.length === 0
                ? jsx('div', { className: 'evo-empty', children: '暂无会话' })
                : rows.map((s) => jsx('div', {
                    className: 'evo-session',
                    'data-active': s.id === currentId || undefined,
                    children: jsxs(Fragment, {
                      children: [
                        s.displayTitle,
                        jsx('span', { className: 'evo-session-sub', children: s.id.slice(0, 8) }),
                      ],
                    }),
                  }, s.id)),
            ],
          }),
          jsx('div', { className: 'evo-rail-foot', children: '基于 deepseek-harness · 0.1.0-rc.6' }),
        ],
      }),
      jsxs('main', {
        className: 'evo-main',
        children: [
          jsxs('div', {
            className: 'evo-topbar',
            children: [
              jsx('div', { className: 'evo-topbar-title', children: current === undefined ? 'EvoResearch' : current.displayTitle }),
              jsx('div', { className: 'evo-topbar-badge', children: '阶段 0 · 架构验证' }),
            ],
          }),
          jsx('div', {
            className: 'evo-content',
            children: current === undefined
              ? jsxs('div', {
                  className: 'evo-hero',
                  children: [
                    jsx('h1', { children: '欢迎使用 EvoResearch' }),
                    jsx('p', { children: '这是 EvoResearch 自定义浏览器表面（形态③）的阶段 0 验证界面：bundle 已替代官方 dsh-web-app 表面，本界面由 evoresearch-ui 插件注册 root slot 渲染。阶段 1 将接入会话打开、流式聊天与 composer。' }),
                  ],
                })
              : jsxs('div', {
                  className: 'evo-hero',
                  children: [
                    jsx('h1', { children: current.displayTitle }),
                    jsx('p', { children: `会话 ${current.id} · 阶段 0 仅展示选中态，聊天界面在阶段 1 接入。` }),
                  ],
                }),
          }),
        ],
      }),
    ],
  })
}

/** 客户端插件主体。 */
function apply(ctx) {
  installCss()
  ctx.effect(() => {
    // app-shell 硬依赖 layout 服务：本表面自给自足（阶段 0 为最小桩，
    // 阶段 1 起提供真实的面板几何控制）。
    const disposeService = ctx.reflect.provide('layout', {
      toggleSidebar() {},
      openDetails() {},
      closeDetails() {},
    })
    const disposeRegistration = ctx.slots.register({ name: 'root' }, EvoFrame)
    return () => {
      disposeRegistration()
      disposeService()
    }
  }, 'evoresearch-ui: layout 服务 + root 注册')
}

export { apply, inject }
