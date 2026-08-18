/**
 * EvoResearch 工作台样式 —— 暖色"纸面" + 青色品牌设计系统
 * （浅/深双主题）。
 *
 * 设计 token 与布局数值：
 * - 浅色：象牙纸面 #faf8f3、纯白卡片、暖炭文字 #33302a、青品牌 #066679
 * - 深色：暖炭纸面 #23211d、表面 #2c2a25、文字 #ece7dc、青品牌 #3b9cb0
 * - 圆角 0.5rem、顶栏 h-14（56px）、聊天最大宽度 900px
 */

export const CSS = `
:root {
  color-scheme: light;
  --color-primary: #33302a;
  --color-user-message: #0e5c6e;
  --color-user-message-bg: #e6f2f5;  --color-avatar-bg: #efe4db;
  --color-secondary: #6b6557;
  --color-success: #3f7a52;
  --color-warning: #946618;
  --color-error: #c0392b;
  --color-background: #faf8f3;
  --color-surface: #ffffff;
  --color-border: #e6dfd2;
  --color-border-light: #f0ebe1;
  --color-text-primary: #33302a;
  --color-text-secondary: #6b6557;
  --color-text-tertiary: #736e60;
  --color-text-placeholder: #b6b0a4;
  --brand: #066679;
  --brand-hover: #054e5b;
  --brand-solid: #066679;
  --brand-foreground: #ffffff;
  --radius: 0.5rem;
  --chat-max-width: 900px;
  --input-bg: #ffffff;
  --hover-bg: #f0ebe1;
  /* Chat Graph tokens: deliberately separate from the general surface scale
     so a light canvas remains readable without hard-coded dark-only colors. */
  --graph-canvas: #f3f0ea;
  --graph-grid: #d4cec2;
  --graph-node-surface: #fffdf8;
  --graph-node-surface-alt: #f4f0e8;
  --graph-node-border: #b9b1a4;
  --graph-node-title: #2f2b25;
  --graph-chat: #2e6f95;
  --graph-memory: #2d8158;
  --graph-global: #7653a0;
  --graph-resource: #94652b;
  --graph-fork: #2e72a0;
  --graph-reference: #2d8158;
  --graph-relation: #77736c;
  --graph-disabled: #8e887f;
  --graph-edge-label: #3c3933;
  --graph-control: #fffdf8;
  --graph-control-border: #b9b1a4;
  --graph-minimap: rgb(255 253 248 / 92%);
  --graph-minimap-group: #7653a0;
  --graph-minimap-chat: #2e6f95;
  --graph-minimap-resource: #2d8158;
  --graph-trace: #b66f16;
  --graph-candidate: #7653a0;
  --graph-status-missing: #a33e34;
  --graph-status-running: #94652b;
}
html.dark {
  color-scheme: dark;
  --color-primary: #ece7dc;
  --color-user-message: #a9dce6;
  --color-user-message-bg: #16343b;
  --color-avatar-bg: #3a2e27;
  --color-secondary: #ada694;
  --color-success: #5dbe85;
  --color-warning: #e0a94a;
  --color-error: #e0796b;
  --color-background: #23211d;
  --color-surface: #2c2a25;
  --color-border: #3a372f;
  --color-border-light: #332f2a;
  --color-text-primary: #ece7dc;
  --color-text-secondary: #ada694;
  --color-text-tertiary: #908d83;
  --color-text-placeholder: #5d5951;
  --brand: #3b9cb0;
  --brand-hover: #46a9bd;
  --brand-solid: #087d91;
  --brand-foreground: #ffffff;
  --input-bg: #1c1a17;
  --hover-bg: #332f2a;
  --graph-canvas: #1b1b1e;
  --graph-grid: #3a3a42;
  --graph-node-surface: #2e2e33;
  --graph-node-surface-alt: #29292d;
  --graph-node-border: #19191d;
  --graph-node-title: #f2f2f2;
  --graph-chat: #4a90d9;
  --graph-memory: #5dbe85;
  --graph-global: #c39bf0;
  --graph-resource: #c98b3d;
  --graph-fork: #4a90d9;
  --graph-reference: #5dbe85;
  --graph-relation: #8a8a94;
  --graph-disabled: #777780;
  --graph-edge-label: #b8b8bd;
  --graph-control: #28282d;
  --graph-control-border: #53535c;
  --graph-minimap: rgb(22 22 25 / 82%);
  --graph-minimap-group: #8a789e;
  --graph-minimap-chat: #4a90d9;
  --graph-minimap-resource: #5dbe85;
  --graph-trace: #e8a33d;
  --graph-candidate: #c39bf0;
  --graph-status-missing: #c96d6d;
  --graph-status-running: #d6a455;
}
* { box-sizing: border-box; }
button, input, textarea, select, [role='button'], [role='group'] { touch-action: manipulation; }
*:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
/* 全局细滚动条（消息列表/侧栏/面板一致）：细、圆角、半透明，hover 加深——避免默认粗条视觉噪音 */
* { scrollbar-width: thin; scrollbar-color: rgba(128, 128, 128, 0.38) transparent; }
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: rgba(128, 128, 128, 0.38); border-radius: 999px; border: 2px solid transparent; background-clip: content-box; }
::-webkit-scrollbar-thumb:hover { background-color: rgba(128, 128, 128, 0.62); }
::-webkit-scrollbar-corner { background: transparent; }
body { margin: 0; }
.evo-app {
  display: flex; flex-direction: column; height: 100vh;
  background: var(--color-background); color: var(--color-text-primary);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  font-size: 14px; line-height: 1.5;
}
.evo-topbar {
  height: 56px; flex-shrink: 0; display: flex; align-items: center; justify-content: space-between;
  gap: 8px; padding: 0 10px 0 16px; border-bottom: 1px solid var(--color-border);
  background: var(--color-background);
}
.evo-topbar-group { display: flex; align-items: center; gap: 2px; min-width: 0; }
.evo-brand-btn {
  display: flex; align-items: center; gap: 10px; min-width: 0; cursor: pointer;
  border: none; background: none; padding: 4px; border-radius: 8px; color: var(--color-text-primary);
}
.evo-brand-btn:hover { background: var(--hover-bg); }
.evo-brand-logo { width: 28px; height: 28px; border-radius: 6px; flex-shrink: 0; }
.evo-brand-name { font-size: 17px; font-weight: 600; white-space: nowrap; }
.evo-icon-btn {
  display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px;
  border: none; background: none; border-radius: 8px; color: var(--color-text-secondary); cursor: pointer;
}
.evo-icon-btn:hover { background: var(--hover-bg); color: var(--color-text-primary); }
.evo-icon-btn svg { width: 20px; height: 20px; }
.evo-cols { flex: 1; display: flex; min-height: 0; }
.evo-left {
  width: 264px; flex-shrink: 0; min-width: 0; display: flex; flex-direction: column;
  border-right: 1px solid var(--color-border); background: var(--color-background); overflow: hidden;
}
.evo-center { flex: 1; min-width: 0; display: flex; flex-direction: column; overflow: hidden; position: relative; }
.evo-right {
  width: 320px; flex-shrink: 0; min-width: 0; display: flex; flex-direction: column;
  border-left: 1px solid var(--color-border); background: var(--color-background); overflow: hidden;
}
.evo-resize-handle { width: 4px; flex-shrink: 0; cursor: col-resize; background: transparent; position: relative; }
.evo-resize-handle:hover, .evo-resize-handle[data-dragging] { background: var(--color-border); }
/* ── 响应式抽屉（§26.1：<768px 左右栏变抽屉 + 黑色 40% 遮罩）── */
.evo-drawer-mask { position: fixed; inset: 0; background: rgb(0 0 0 / 40%); z-index: 280; }
@media (max-width: 767px) {
  .evo-left, .evo-right { position: fixed; top: 0; bottom: 0; z-index: 300; width: min(320px, 84vw) !important; box-shadow: 0 0 40px rgb(0 0 0 / 35%); transition: transform 0.22s ease; }
  .evo-left { left: 0; transform: translateX(-100%); }
  .evo-right { right: 0; transform: translateX(100%); }
  .evo-cols[data-narrow] .evo-left { transform: none; }
  .evo-cols[data-narrow] .evo-right { transform: none; }
  .evo-resize-handle { display: none; }
  .evo-graph-toolbar { flex-wrap: wrap; padding: 6px 8px; }
  .evo-graph-toolbar .evo-graph-search { order: 5; flex: 1 1 100%; }
  .evo-graph-search input { width: 100%; }
  .evo-graph-canvas { overflow: auto; }
  .evo-graph-minimap, .evo-graph-inspector { display: none; }
  .evo-composer-wrap { padding-inline: 8px; }
  .evo-composer { max-width: none; }
  .evo-composer-tools { gap: 2px; padding: 4px 6px 6px; }
  .evo-composer-tool { width: 26px; height: 28px; padding: 4px 5px; gap: 0; justify-content: center; }
  .evo-composer-tool svg { width: 15px; height: 15px; }
  .evo-send { width: 30px; height: 28px; }
}
/* ── 左侧栏 ── */
.evo-tl { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.evo-tl-head { padding: 10px 12px 4px; display: flex; align-items: center; gap: 6px; }
.evo-tl-head-title { font-size: 13.5px; font-weight: 600; color: var(--color-text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.evo-tl-back { display: inline-flex; align-items: center; gap: 4px; padding: 5px 9px; border: 1px solid var(--color-border); border-radius: 7px; background: var(--color-surface); color: var(--color-text-secondary); cursor: pointer; flex-shrink: 0; font-size: 12px; font: inherit; transition: border-color 0.15s, color 0.15s, background 0.15s; }
.evo-tl-back:hover { border-color: var(--brand); color: var(--brand); background: var(--hover-bg); }
.evo-tl-back svg { width: 14px; height: 14px; }
.evo-tl-newchat {
  display: inline-flex; align-items: center; gap: 7px; width: auto; padding: 6px 10px; margin-left: auto;
  border: none; background: none; border-radius: 8px; color: var(--color-text-primary);
  font-size: 13px; font-weight: 500; cursor: pointer; flex-shrink: 0;
}
.evo-tl-newchat:hover { background: var(--hover-bg); }
.evo-tl-newchat svg { width: 16px; height: 16px; color: var(--color-text-secondary); }
/* 项目行（§二级聊天） */
.evo-tl-project-row { cursor: pointer; gap: 9px; padding: 8px 10px; }
.evo-tl-project-row > svg { width: 16px; height: 16px; color: var(--brand); flex-shrink: 0; }
.evo-tl-project-row > svg:last-child { width: 13px; height: 13px; color: var(--color-text-tertiary); }
.evo-tl-project-main { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.evo-tl-menu { padding: 2px 8px; }
.evo-tl-item {
  display: flex; align-items: center; gap: 10px; width: 100%; padding: 7px 10px;
  border: none; background: none; border-radius: 8px; color: var(--color-text-secondary);
  font-size: 13.5px; cursor: pointer; text-align: left;
}
.evo-tl-item:hover { background: var(--hover-bg); color: var(--color-text-primary); }
.evo-tl-item[data-active] { background: var(--hover-bg); color: var(--color-text-primary); font-weight: 500; }
.evo-tl-item svg { width: 17px; height: 17px; flex-shrink: 0; }
.evo-tl-item > span { min-width: 4em; }
.evo-tl-newchat-item { color: var(--color-text-primary); font-weight: 600; }
.evo-tl-tools { display: flex; align-items: center; gap: 6px; padding: 6px 12px 2px; }
.evo-tl-search { flex: 1; min-width: 0; padding: 6px 10px; display: flex; align-items: center; gap: 8px;
  border: 1px solid var(--color-border); border-radius: 6px; background: var(--input-bg); }
.evo-tl-search svg { width: 15px; height: 15px; color: var(--color-text-tertiary); flex-shrink: 0; }
.evo-tl-search input { flex: 1; border: none; outline: none; background: none; color: var(--color-text-primary); font-size: 13px; }
.evo-tl-search input::placeholder { color: var(--color-text-tertiary); }
.evo-tl-searching { color: var(--color-text-tertiary); font-size: 10px; white-space: nowrap; }
.evo-tl-sort-wrap { position: relative; flex: 0 0 auto; }
.evo-tl-sort-btn { display: inline-flex; align-items: center; justify-content: center; width: 31px; height: 31px; padding: 0; border: 1px solid var(--color-border); border-radius: 7px; color: var(--color-text-tertiary); background: var(--input-bg); cursor: pointer; }
.evo-tl-sort-btn:hover, .evo-tl-sort-btn[aria-expanded='true'] { color: var(--brand); border-color: color-mix(in srgb, var(--brand) 55%, var(--color-border)); background: color-mix(in srgb, var(--brand) 8%, var(--input-bg)); }
.evo-tl-sort-btn svg { width: 15px; height: 15px; }
.evo-tl-sort-menu { position: absolute; top: calc(100% + 6px); right: 0; z-index: 90; min-width: 164px; padding: 5px; border: 1px solid var(--color-border); border-radius: 9px; background: var(--color-surface); box-shadow: 0 10px 26px rgba(0, 0, 0, 0.2); display: flex; flex-direction: column; gap: 1px; }
.evo-tl-sort-option { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 30px; padding: 6px 8px; border: none; border-radius: 6px; background: transparent; color: var(--color-text-secondary); font: inherit; font-size: 12px; text-align: left; cursor: pointer; }
.evo-tl-sort-option:hover { background: var(--hover-bg); color: var(--color-text-primary); }
.evo-tl-sort-option[data-active] { background: color-mix(in srgb, var(--brand) 10%, transparent); color: var(--brand); }
.evo-tl-sort-option svg { width: 14px; height: 14px; flex: 0 0 auto; }
.evo-tl-sort-option span { flex: 1; min-width: 0; }
.evo-tl-body { flex: 1; overflow-y: auto; padding: 6px 8px 16px; min-height: 0; }
.evo-tl-section { padding: 10px 10px 4px; display: flex; align-items: center; justify-content: space-between; }
.evo-tl-section-title { font-size: 12px; font-weight: 600; color: var(--color-text-secondary); letter-spacing: .2px; }
.evo-tl-subchat-section { display: block; padding-top: 8px; }
.evo-tl-section-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.evo-tl-section-action { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; padding: 0; border: none; border-radius: 6px; color: var(--color-text-tertiary); background: transparent; cursor: pointer; }
.evo-tl-section-action:hover { color: var(--color-text-primary); background: var(--hover-bg); }
.evo-tl-section-action svg { width: 14px; height: 14px; }
.evo-tl-project-context { display: block; margin-top: 3px; color: var(--color-text-tertiary); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.evo-tl-archived-toggle { display: flex; align-items: center; gap: 6px; width: 100%; padding: 6px 10px; font-size: 12px; font-weight: 600; color: var(--color-text-secondary); background: transparent; border: none; border-radius: 8px; cursor: pointer; font: inherit; }
.evo-tl-archived-toggle:hover { background: var(--hover-bg); }
.evo-tl-archived-toggle svg { width: 13px; height: 13px; }
.evo-tl-archived-list { margin: 2px 0 6px; }
.evo-tl-archived-row { opacity: 0.75; }
.evo-tl-archived-row:hover { opacity: 1; }
.evo-tl-fork-error { font-size: 11px; color: var(--color-error); text-align: right; line-height: 1.4; max-width: 70%; }
.evo-tl-row {
  display: flex; align-items: center; gap: 4px; width: 100%; text-align: left; padding: 6px 10px; margin-bottom: 2px;
  border: none; background: none; border-radius: 8px; cursor: default; position: relative;
}
.evo-tl-row:hover { background: var(--hover-bg); }
.evo-tl-row[data-active] { background: var(--hover-bg); }
.evo-tl-row[data-active]::before { content: ''; position: absolute; left: 0; top: 22%; bottom: 22%; width: 3px; border-radius: 3px; background: var(--brand); }
.evo-tl-row-title { font-size: 13.5px; color: var(--color-text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: flex; align-items: center; gap: 5px; }
.evo-tl-pin-badge { display: inline-flex; flex-shrink: 0; color: var(--brand); }
.evo-tl-pin-badge svg { width: 11px; height: 11px; }
.evo-tl-title-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.evo-tl-color-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.evo-tl-palette { position: absolute; right: 10px; z-index: 30; display: flex; gap: 5px; padding: 6px 8px; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 999px; box-shadow: 0 6px 18px rgba(0, 0, 0, 0.16); }
.evo-tl-color-swatch { width: 16px; height: 16px; border-radius: 50%; border: 2px solid var(--color-surface); cursor: pointer; flex-shrink: 0; transition: transform 0.12s; }
.evo-tl-color-swatch:hover { transform: scale(1.2); }
.evo-tl-color-swatch[data-active] { outline: 2px solid var(--color-text-secondary); outline-offset: 1px; }
.evo-tl-row-sub { font-size: 11.5px; color: var(--color-text-tertiary); margin-top: 1px; }
.evo-tl-empty { padding: 28px 16px; text-align: center; color: var(--color-text-tertiary); font-size: 13px; }
.evo-tl-empty svg { width: 40px; height: 40px; color: var(--color-border); margin-bottom: 8px; }
/* ── 中间聊天区 ── */
.evo-chat { flex: 1 1 auto; height: auto; display: flex; flex-direction: column; min-height: 0; overflow-y: auto; overflow-x: hidden; }
.evo-welcome { flex: 1 1 auto; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 24px 24px 32px; min-height: 0; }
.evo-welcome h1 { font-size: 22px; font-weight: 600; margin: 0 0 10px; color: var(--color-text-primary); letter-spacing: -.01em; }
.evo-welcome p { margin: 0 0 28px; color: var(--color-text-secondary); font-size: 14px; max-width: 512px; line-height: 1.6; }
.evo-suggest { display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; }
/* §31.7：建议问题用圆形 pill 按钮（1px 边框、轻阴影、紧凑内边距） */
.evo-suggest-card {
  padding: 8px 18px; border: 1px solid var(--color-border); border-radius: 999px;
  background: var(--color-surface); color: var(--color-text-secondary); font-size: 13px;
  cursor: pointer; transition: border-color .15s, box-shadow .15s; box-shadow: 0 1px 2px rgb(0 0 0 / 6%);
}
.evo-suggest-card:hover { border-color: var(--brand); color: var(--color-text-primary); box-shadow: 0 2px 6px rgb(0 0 0 / 10%); }
.evo-welcome-prompt { margin-top: 22px; padding: 0; border: 0; background: none; color: var(--color-text-placeholder); font: inherit; font-size: 13px; line-height: 1.55; cursor: text; }
.evo-welcome-prompt:hover, .evo-welcome-prompt:focus-visible { color: var(--color-text-secondary); }
/* ── 欢迎页 Research Dashboard（§31.7）── */
.evo-dashboard { display: flex; gap: 10px; margin-top: 26px; }
.evo-dashboard-card { display: flex; flex-direction: column; align-items: center; gap: 2px; min-width: 96px; padding: 12px 18px; border: 1px solid var(--color-border); border-radius: 14px; background: var(--color-surface); }
.evo-dashboard-value { font-size: 22px; font-weight: 600; color: var(--brand); line-height: 1.1; }
.evo-dashboard-label { font-size: 11.5px; color: var(--color-text-tertiary); }
/* ── 输入面板：sticky 常驻中间栏底部（消息区内容自适应、页面整体滚动）── */
.evo-composer-wrap { flex-shrink: 0; padding: 4px 24px 8px; display: flex; flex-wrap: wrap; justify-content: center; position: sticky; bottom: 0; z-index: 30; background: var(--color-background); }
/* ── 输入候选弹层（§23.2–23.5：斜杠命令 / @文件 / 输入历史）── */
.evo-cand { position: absolute; bottom: calc(100% - 8px); left: 50%; transform: translateX(-50%); width: min(560px, calc(100vw - 96px)); max-height: 280px; overflow-y: auto; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 12px; box-shadow: 0 10px 32px rgba(0, 0, 0, 0.18); z-index: 40; padding: 6px; display: flex; flex-direction: column; gap: 2px; }
.evo-cand-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 4px 10px 6px; border-bottom: 1px solid var(--color-border-light); }
.evo-cand-label { color: var(--color-text-secondary); font-size: 11.5px; font-weight: 600; }
.evo-cand-hint { color: var(--color-text-tertiary); font-size: 10.5px; white-space: nowrap; }
.evo-cand-item { display: flex; align-items: center; gap: 10px; padding: 7px 10px; border-radius: 8px; cursor: pointer; }
.evo-cand-item[data-active] { background: var(--hover-bg); }
.evo-cand-item svg { width: 15px; height: 15px; color: var(--brand); flex-shrink: 0; }
.evo-cand-text { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.evo-cand-title { font-size: 13px; color: var(--color-text-primary); font-family: ui-monospace, Consolas, monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.evo-cand-sub { font-size: 11.5px; color: var(--color-text-tertiary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.evo-composer { width: 100%; max-width: var(--chat-max-width); border: 1px solid var(--color-border); border-radius: 14px; background: var(--color-surface); box-shadow: 0 2px 12px rgba(0,0,0,.05); }
.evo-composer-status { display: flex; align-items: center; gap: 7px; padding: 8px 14px 0; font-size: 12px; color: var(--color-text-tertiary); }
.evo-composer-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--color-success); flex-shrink: 0; }
.evo-composer-textarea { width: 100%; padding: 10px 14px 4px; border: none; outline: none; resize: none; background: none; color: transparent; -webkit-text-fill-color: transparent; caret-color: var(--color-text-primary); font-size: 14.5px; font-family: inherit; line-height: 1.55; min-height: 44px; max-height: 220px; position: relative; z-index: 1; }
.evo-composer-input:focus-within .evo-composer-textarea { color: var(--color-text-primary); -webkit-text-fill-color: var(--color-text-primary); }
.evo-composer-textarea::placeholder { color: var(--color-text-tertiary); -webkit-text-fill-color: var(--color-text-tertiary); }
.evo-composer-textarea::selection { background: color-mix(in srgb, var(--brand) 30%, transparent); }
/* ── 双层 Markdown 实时编辑器（§composer）：装饰层渲染样式，textarea 透明编辑 ── */
.evo-composer-input { position: relative; flex: 1; display: flex; min-height: 44px; }
.evo-composer-deco { position: absolute; inset: 0; overflow: hidden; padding: 10px 14px 4px; font-size: 14.5px; font-family: inherit; line-height: 1.55; color: var(--color-text-primary); white-space: pre-wrap; word-break: break-word; pointer-events: none; }
.evo-composer-deco[data-empty] { display: none; }
.evod-m { visibility: hidden; }
/* 聚焦输入时：隐藏的语法标记显示极浅背景，辅助定位（失焦自动隐藏，保持干净） */
.evo-composer-input:focus-within .evo-composer-deco { display: none; }
.evod-code { font-family: ui-monospace, "Cascadia Code", Consolas, monospace; font-size: 13px; background: var(--hover-bg); border-radius: 4px; padding: 1px 3px; }
.evod-link { color: var(--brand); text-decoration: underline; text-underline-offset: 2px; }
.evod-h { font-weight: 700; }
.evod-h1 { font-size: 22px; } .evod-h2 { font-size: 19px; } .evod-h3 { font-size: 17px; } .evod-h4 { font-size: 15.5px; }
.evod-h5 { font-size: 14.5px; } .evod-h6 { font-size: 14.5px; color: var(--color-text-secondary); }
.evod-li { display: block; padding-left: 20px; position: relative; }
.evod-ul::before, .evod-ol::before { content: '•'; position: absolute; left: 5px; color: var(--color-text-tertiary); }
.evod-quote { border-left: 3px solid var(--color-border); padding-left: 9px; color: var(--color-text-secondary); }
.evod-hr { border-bottom: 1px solid var(--color-border); margin: 5px 0; }
.evod-fence-line, .evod-fence-body { background: var(--hover-bg); }
.evod-fence-line { margin-top: 4px; border-radius: 6px 6px 0 0; }
.evod-fence-body { font-family: ui-monospace, "Cascadia Code", Consolas, monospace; font-size: 13px; }
.evod-fence-body:last-child { border-radius: 0 0 6px 6px; margin-bottom: 4px; }
.evo-composer-textarea::selection { background: color-mix(in srgb, var(--brand) 30%, transparent); }
.evo-composer-tools { display: flex; align-items: center; gap: 4px; min-height: 44px; padding: 6px 8px 8px; visibility: visible; opacity: 1; }
.evo-composer-tool {
  display: inline-flex; align-items: center; gap: 6px; flex: 0 0 auto; padding: 6px 9px; border: none; background: none;
  border-radius: 8px; color: var(--color-text-secondary); font-size: 12.5px; cursor: pointer;
}
.evo-composer-tool:hover { background: var(--hover-bg); color: var(--color-text-primary); }
.evo-composer-tool svg { width: 16px; height: 16px; }
.evo-composer-tool[data-on] { color: var(--brand); background: color-mix(in srgb, var(--brand) 12%, var(--color-surface)); }
.evo-composer-tool.evo-aa-on { color: #e05d5d; }
/* 动作项文字（§25.5）：窄容器只显示图标，hover 时该项文字平滑展开 */
.evo-composer-tool span { max-width: 140px; opacity: 1; overflow: hidden; white-space: nowrap; transition: max-width 0.18s ease, opacity 0.18s ease, margin-left 0.18s ease; }
@container (max-width: 640px) {
  .evo-composer-tool span { max-width: 0; opacity: 0; margin-left: -6px; }
  .evo-composer-tool:hover span { max-width: 140px; opacity: 1; margin-left: 0; }
}
.evo-composer-spacer { flex: 1; }
.evo-send {
  display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 30px; padding: 0;
  border: none; border-radius: 9px; background: var(--brand-solid); color: var(--brand-foreground); cursor: pointer;
}
.evo-send:hover { background: var(--brand-hover); }
.evo-send:disabled { opacity: .5; cursor: default; }
.evo-send svg { width: 16px; height: 16px; }
/* ── 右侧 inspector ── */
.evo-insp { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.evo-insp-tabs { display: flex; align-items: center; gap: 2px; padding: 8px 10px 0; border-bottom: 1px solid var(--color-border); }
.evo-insp-tab {
  display: inline-flex; align-items: center; gap: 6px; padding: 7px 10px; border: none; background: none;
  border-radius: 7px 7px 0 0; color: var(--color-text-tertiary); font-size: 13px; cursor: pointer;
  border-bottom: 2px solid transparent; margin-bottom: -1px;
}
.evo-insp-tab:hover { color: var(--color-text-primary); }
.evo-insp-tab[data-active] { color: var(--color-text-primary); border-bottom-color: var(--brand); font-weight: 500; }
.evo-insp-tab svg { width: 15px; height: 15px; }
.evo-insp-close { margin-left: auto; }
.evo-insp-body { flex: 1; overflow-y: auto; min-height: 0; }
.evo-insp-subtabs { display: flex; gap: 2px; padding: 8px 12px 0; }
.evo-insp-subtab { padding: 4px 10px; border: none; background: none; border-radius: 999px; color: var(--color-text-tertiary); font-size: 12px; cursor: pointer; }
.evo-insp-subtab:hover { background: var(--hover-bg); }
.evo-insp-subtab[data-active] { background: var(--hover-bg); color: var(--color-text-primary); }
.evo-insp-empty { padding: 40px 20px; text-align: center; color: var(--color-text-tertiary); font-size: 13px; }
.evo-insp-empty svg { width: 36px; height: 36px; color: var(--color-border); margin-bottom: 8px; }
.evo-view { flex: 1; overflow-y: auto; }
/* ── 消息列表 ── */
.evo-msg-list { flex: none; height: auto; overflow: visible; padding: 18px 24px 6px; display: flex; flex-direction: column; gap: 10px; max-width: var(--chat-max-width); width: 100%; margin: 0 auto; position: relative; }
.evo-msg-error { padding: 10px 14px; border: 1px solid var(--color-error); border-radius: 10px; color: var(--color-error); font-size: 13px; background: color-mix(in srgb, var(--color-error) 8%, transparent); }
.evo-useronly-hint { align-self: center; display: inline-flex; align-items: center; gap: 6px; padding: 4px 14px; border: 1px dashed color-mix(in srgb, var(--brand) 45%, var(--color-border)); border-radius: 999px; color: var(--color-text-secondary); font-size: 12px; background: color-mix(in srgb, var(--brand) 7%, var(--color-surface)); cursor: pointer; transition: border-color 0.15s, color 0.15s; }
.evo-useronly-hint:hover { border-color: var(--brand); color: var(--brand); }
/* 历史分页（移植规范 §9）：Load earlier / 回到最新 */
.evo-load-earlier { align-self: center; display: inline-flex; align-items: center; gap: 6px; padding: 6px 16px; border: 1px solid var(--color-border); border-radius: 999px; background: var(--color-surface); color: var(--color-text-secondary); font-size: 12.5px; cursor: pointer; transition: border-color 0.15s, color 0.15s; }
.evo-load-earlier:hover { border-color: var(--brand); color: var(--color-text-primary); }
.evo-load-earlier svg { width: 13px; height: 13px; }
.evo-jump-latest { position: sticky; bottom: 12px; align-self: flex-end; display: inline-flex; align-items: center; gap: 6px; padding: 7px 16px; border: 1px solid var(--color-border); border-radius: 999px; background: var(--color-surface); color: var(--color-text-secondary); font-size: 12.5px; font-weight: 600; cursor: pointer; box-shadow: 0 4px 14px rgba(0, 0, 0, 0.12); transition: border-color 0.15s, color 0.15s, transform 0.15s; }
.evo-jump-latest:hover { border-color: var(--brand); color: var(--brand); transform: translateY(-1px); }
.evo-jump-latest svg { width: 14px; height: 14px; }
.evo-msg-row { display: flex; gap: 10px; align-items: flex-start; }
.evo-msg-user { flex-direction: row-reverse; }
.evo-msg-avatar { width: 30px; height: 30px; border-radius: 50%; background: var(--color-avatar-bg); display: flex; align-items: center; justify-content: center; flex-shrink: 0; color: var(--color-text-secondary); }
.evo-msg-avatar svg { width: 15px; height: 15px; }
.evo-msg-body { min-width: 0; max-width: 78%; display: flex; flex-direction: column; gap: 4px; }
.evo-msg-user-body { min-width: 0; max-width: 78%; }
.evo-msg-bubble { padding: 8px 14px; border-radius: 13px; font-size: 14px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
.evo-msg-bubble-user { padding-block: 8px; line-height: 1.5; background: var(--color-user-message-bg); color: var(--color-user-message); border-top-right-radius: 4px; }
.evo-msg-bubble-user .evo-md { line-height: 1.5; }
.evo-msg-bubble-user .evo-md > p:only-child { margin-block: 0; }
.evo-msg-bubble-assistant { background: var(--color-surface); border: 1px solid var(--color-border-light); border-top-left-radius: 4px; color: var(--color-text-primary); }
.evo-msg-text { white-space: pre-wrap; word-break: break-word; }
.evo-msg-time { font-size: 10.5px; color: var(--color-text-tertiary); margin-top: 3px; text-align: right; }
.evo-msg-cursor { display: inline-block; width: 7px; height: 15px; margin-left: 2px; background: var(--brand); vertical-align: -2px; animation: evo-blink 1s steps(2) infinite; }
@keyframes evo-blink { 50% { opacity: 0; } }
/* ── Thinking 折叠（§31.6：reasoning 默认折叠，左侧 2px 边线 + 次级文字）── */
.evo-thinking { margin-top: 6px; }
.evo-thinking-toggle { display: inline-flex; align-items: center; gap: 6px; border: none; background: none; padding: 2px 6px 2px 0; font-size: 12px; color: var(--color-text-tertiary); cursor: pointer; }
.evo-thinking-toggle:hover { color: var(--color-text-secondary); }
.evo-thinking-toggle svg { width: 13px; height: 13px; }
.evo-thinking-body { margin: 4px 0 10px; padding: 2px 0 2px 14px; border-left: 2px solid var(--color-border); color: var(--color-text-tertiary); font-size: 12.5px; line-height: 1.7; white-space: pre-wrap; word-break: break-word; }
/* ── 工具卡片分组（§21.1：running/success/error 状态 + 折叠）── */
.evo-tool-group { display: flex; flex-direction: column; gap: 4px; margin-top: 10px; }
.evo-tool-group-head { display: flex; align-items: center; gap: 7px; width: 100%; text-align: left; padding: 6px 10px; border: 1px solid var(--color-border-light); border-radius: 9px; background: var(--color-surface); color: var(--color-text-secondary); font-size: 12.5px; cursor: pointer; }
.evo-tool-group-head:hover { border-color: var(--color-border); }
.evo-tool-group-head svg { width: 14px; height: 14px; flex-shrink: 0; color: var(--color-text-tertiary); }
.evo-tool-group-state { margin-left: auto; font-size: 11px; color: var(--color-text-tertiary); border: 1px solid var(--color-border-light); border-radius: 999px; padding: 0 7px; background: var(--color-background); }
.evo-tool-group-body { display: flex; flex-direction: column; gap: 4px; padding-left: 8px; }
.evo-tool-chev { transition: transform 0.15s; }
.evo-tool-chev.open { transform: rotate(90deg); }
.evo-tool-card { display: flex; flex-direction: column; gap: 4px; padding: 7px 11px; border: 1px solid var(--color-border); border-radius: 9px; background: var(--color-surface); font-size: 12.5px; color: var(--color-text-secondary); }
.evo-tool-card.running { border-color: color-mix(in srgb, var(--brand) 40%, var(--color-border)); }
.evo-tool-card.success { border-color: color-mix(in srgb, var(--color-success) 35%, var(--color-border)); }
.evo-tool-card.error { border-color: color-mix(in srgb, var(--color-error) 40%, var(--color-border)); }
.evo-tool-head { display: flex; align-items: center; gap: 7px; }
.evo-tool-head svg { width: 14px; height: 14px; flex-shrink: 0; }
.evo-tool-card.success .evo-tool-head svg { color: var(--color-success); }
.evo-tool-card.error .evo-tool-head svg { color: var(--color-error); }
.evo-tool-name { font-weight: 600; color: var(--color-text-primary); font-family: var(--font-mono, ui-monospace, Consolas, monospace); flex-shrink: 0; }
.evo-tool-state { margin-left: auto; font-size: 11px; color: var(--color-text-tertiary); }
.evo-tool-card.running .evo-tool-state { color: var(--brand); }
.evo-tool-card.success .evo-tool-state { color: var(--color-success); }
.evo-tool-card.error .evo-tool-state { color: var(--color-error); }
.evo-tool-spinner { width: 11px; height: 11px; border-radius: 50%; border: 2px solid color-mix(in srgb, var(--brand) 30%, transparent); border-top-color: var(--brand); animation: evo-spin 0.8s linear infinite; flex-shrink: 0; display: inline-block; }
@keyframes evo-spin { to { transform: rotate(360deg); } }
.evo-tool-args, .evo-tool-result { display: flex; align-items: flex-start; gap: 7px; width: 100%; text-align: left; border: none; background: none; padding: 0; color: var(--color-text-secondary); cursor: pointer; font-size: 12px; line-height: 1.55; }
.evo-tool-args:hover, .evo-tool-result:hover { color: var(--color-text-primary); }
.evo-tool-args-text, .evo-tool-result-text { font-family: var(--font-mono, ui-monospace, Consolas, monospace); white-space: pre-wrap; word-break: break-word; }
.evo-tool-result-label { font-size: 10.5px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px; flex-shrink: 0; margin-top: 2px; color: var(--color-text-tertiary); }
.evo-tool-card.error .evo-tool-result-label { color: var(--color-error); }
.evo-tool-card.success .evo-tool-result-label { color: var(--color-success); }
/* ── 桌面自绘标题栏 ── */
html.evo-desktop body { margin: 0 !important; }
.evo-app[data-desktop] { height: calc(100vh - 36px); margin-top: 36px; }
.evo-tb {
  position: fixed; top: 0; left: 0; right: 0; height: 36px; z-index: 2147483647;
  display: flex; align-items: center; justify-content: flex-start; box-sizing: border-box;
  overflow: hidden; background: #18181b; border-bottom: 1px solid #3f3f46; color: #d4d4d8;
  font: 500 13px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  -webkit-user-select: none; user-select: none;
}
html:not(.dark) .evo-tb { background: #f4f4f5; border-bottom-color: #e4e4e7; color: #52525b; }
.evo-tb-spacer { flex: 1; min-width: 0; height: 100%; cursor: default; }
.evo-tb-brand {
  display: flex; align-items: center; gap: 8px; padding: 0 12px; height: 100%;
  border: 0; background: transparent; color: inherit; cursor: pointer; letter-spacing: 0.02em; white-space: nowrap;
}
.evo-tb-brand:hover { background: rgba(128, 128, 128, 0.18); }
.evo-tb-tools, .evo-tb-actions { display: flex; align-items: center; gap: 2px; min-width: 0; }
.evo-tb-tools { margin-left: 2px; }
.evo-tb-actions { position: absolute; top: 3px; right: 142px; justify-content: flex-end; padding-right: 2px; }
.evo-tb-tools button, .evo-tb-actions button {
  width: 30px; height: 30px; min-width: 30px; padding: 0; border: 0; border-radius: 6px;
  background: transparent; color: inherit; display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer; transition: background-color 100ms ease, color 100ms ease;
}
.evo-tb-tools button:hover, .evo-tb-actions button:hover { background: rgba(128, 128, 128, 0.18); }
.evo-tb-tools svg, .evo-tb-actions svg { width: 16px; height: 16px; flex: none; }
.evo-tb-health { width: auto !important; min-width: 0; max-width: 132px; padding: 0 8px; gap: 6px; font-size: 12px; justify-content: center; margin-right: 4px; }
.evo-tb-dot { width: 8px; height: 8px; border-radius: 50%; background: #4ade80; flex: none; }
.evo-tb-dot.disconnected { background: #f87171; }
.evo-tb-controls { position: absolute; top: 0; right: 0; display: flex; align-items: stretch; height: 100%; margin-left: 4px; border-left: 1px solid rgba(128, 128, 128, 0.18); }
.evo-tb-win { width: 46px; height: 100%; border: 0; margin: 0; padding: 0; background: transparent; color: inherit; display: grid; place-items: center; cursor: default; transition: background-color 100ms ease, color 100ms ease; }
.evo-tb-win:hover { background: rgba(128, 128, 128, 0.18); }
.evo-tb-close:hover { background: #e81123; color: #ffffff; }
/* ── 设置弹窗 ── */
.evo-modal-mask { position: fixed; inset: 0; z-index: 2000; background: rgba(0, 0, 0, 0.45); display: flex; align-items: center; justify-content: center; }
.evo-modal { width: 75vw; height: 75vh; max-width: 75vw; max-height: 75vh; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 14px; box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25); display: flex; flex-direction: column; overflow: hidden; }
/* 设置面板占满整个窗口（用户要求）：fixed + inset 精确覆盖视口 */
.evo-modal.evo-modal-full { position: fixed; inset: 0; width: auto; height: auto; max-width: none; max-height: none; border-radius: 0; border: none; }
.evo-modal-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px 10px; border-bottom: 1px solid var(--color-border-light); }
.evo-modal-title { font-size: 15px; font-weight: 600; color: var(--color-text-primary); }
.evo-modal-body { padding: 14px 18px 18px; overflow-y: auto; }
.evo-setting { padding: 14px 16px; margin-bottom: 12px; background: var(--color-background); border: 1px solid var(--color-border-light); border-radius: 10px; }
.evo-setting:last-child { margin-bottom: 0; }
.evo-setting-label { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--color-text-primary); margin-bottom: 8px; }
.evo-setting-label svg { width: 15px; height: 15px; color: var(--brand); }
.evo-setting-options { display: flex; gap: 6px; flex-wrap: wrap; }
.evo-setting-option { padding: 5px 14px; border: 1px solid var(--color-border); border-radius: 999px; background: var(--color-surface); color: var(--color-text-secondary); font-size: 12.5px; cursor: pointer; transition: border-color 0.15s, color 0.15s, background 0.15s; }
.evo-setting-option:hover { border-color: var(--brand); color: var(--color-text-primary); }
.evo-setting-option[data-active] { background: var(--brand-solid); border-color: var(--brand-solid); color: var(--brand-foreground); }
.evo-setting-hint { font-size: 12px; color: var(--color-text-tertiary); margin-top: 6px; line-height: 1.6; }
.evo-setting-error { color: var(--color-error); }
.evo-model-list { display: flex; flex-direction: column; gap: 4px; }
.evo-model-group { display: flex; flex-direction: column; gap: 2px; }
.evo-model-group-name { font-size: 11.5px; color: var(--color-text-tertiary); padding: 6px 2px 2px; letter-spacing: 0.3px; }
.evo-model-item { text-align: left; padding: 6px 10px; border: none; background: none; border-radius: 8px; color: var(--color-text-secondary); font-size: 13px; cursor: pointer; }
.evo-model-item:hover { background: var(--hover-bg); color: var(--color-text-primary); }
.evo-model-item[data-active] { background: var(--hover-bg); color: var(--color-text-primary); font-weight: 600; }
/* ── 业务面板（记忆/调度/团队/通道/技能）── */
.evo-panel { max-width: 760px; margin: 0 auto; padding: 28px 28px 40px; }
.evo-panel-head { display: flex; align-items: center; gap: 10px; font-size: 17px; font-weight: 700; color: var(--color-text-primary); margin-bottom: 20px; }
.evo-panel-head svg { width: 19px; height: 19px; color: var(--brand); }
.evo-panel-body { display: flex; flex-direction: column; gap: 16px; }
.evo-panel-row { display: flex; flex-direction: column; gap: 8px; }
.evo-panel-row-label { font-size: 12px; font-weight: 600; color: var(--color-text-tertiary); letter-spacing: 0.4px; text-transform: uppercase; }
.evo-panel-hint { font-size: 13px; color: var(--color-text-tertiary); }
.evo-panel-error { padding: 8px 12px; border: 1px solid var(--color-error); border-radius: 8px; color: var(--color-error); font-size: 12.5px; }
.evo-panel-tags { display: flex; gap: 6px; flex-wrap: wrap; }
.evo-panel-tag { padding: 4px 12px; border: 1px solid var(--color-border); border-radius: 999px; font-size: 12.5px; color: var(--color-text-secondary); background: var(--color-surface); }
.evo-panel-tag-link { border-color: color-mix(in srgb, var(--brand) 40%, transparent); color: var(--brand); background: color-mix(in srgb, var(--brand) 8%, transparent); }
.evo-panel-stats { display: flex; gap: 10px; flex-wrap: wrap; }
.evo-panel-stat { flex: 1; min-width: 88px; padding: 12px; border: 1px solid var(--color-border); border-radius: 12px; background: var(--color-surface); text-align: center; }
.evo-panel-stat-num { font-size: 20px; font-weight: 700; color: var(--color-text-primary); }
.evo-panel-stat-label { font-size: 11px; color: var(--color-text-tertiary); margin-top: 2px; }
.evo-panel-list { display: flex; flex-direction: column; gap: 6px; }
.evo-panel-item { display: flex; align-items: center; gap: 10px; padding: 9px 12px; border: 1px solid var(--color-border-light); border-radius: 10px; background: var(--color-surface); }
.evo-panel-item svg { width: 15px; height: 15px; color: var(--color-text-tertiary); flex-shrink: 0; }
.evo-panel-item-main { flex: 1; font-size: 13.5px; color: var(--color-text-primary); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.evo-panel-item-code { font-size: 11.5px; color: var(--color-text-tertiary); font-family: ui-monospace, Consolas, monospace; }
.evo-panel-item-badge { padding: 2px 8px; border-radius: 999px; font-size: 11px; background: var(--hover-bg); color: var(--color-text-secondary); }
.evo-panel-item-num { font-size: 12px; font-weight: 600; color: var(--brand); }
.evo-goal-item { flex-direction: column; align-items: stretch; gap: 0; padding: 0; overflow: hidden; }
.evo-goal-item[data-open] { border-color: var(--brand); }
.evo-goal-head { display: flex; align-items: center; gap: 10px; padding: 9px 12px; background: transparent; border: none; cursor: pointer; text-align: left; width: 100%; font: inherit; }
.evo-goal-head:hover { background: var(--hover-bg); }
.evo-goal-head svg { width: 15px; height: 15px; color: var(--color-text-tertiary); flex-shrink: 0; }
.evo-goal-criteria-count { font-size: 11px; font-weight: 600; color: var(--color-text-tertiary); }
.evo-goal-detail { padding: 4px 12px 12px; border-top: 1px dashed var(--color-border-light); display: flex; flex-direction: column; gap: 9px; }
.evo-goal-detail-block { display: flex; flex-direction: column; gap: 4px; }
.evo-goal-detail-label { font-size: 11px; font-weight: 600; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing: 0.4px; }
.evo-goal-detail-text { font-size: 12.5px; color: var(--color-text-primary); line-height: 1.55; white-space: pre-wrap; }
.evo-goal-criteria { display: flex; flex-direction: column; gap: 5px; }
.evo-goal-criterion { display: flex; align-items: flex-start; gap: 7px; font-size: 12.5px; color: var(--color-text-secondary); line-height: 1.5; }
.evo-goal-criterion.done { color: var(--color-text-primary); }
.evo-goal-criterion-mark { flex-shrink: 0; font-size: 12px; color: var(--color-text-tertiary); }
.evo-goal-criterion.done .evo-goal-criterion-mark { color: #2ecc71; }
.evo-goal-criterion-text { flex: 1; min-width: 0; }
.evo-goal-evidence { flex-shrink: 0; font-size: 11px; color: var(--color-text-tertiary); padding: 1px 7px; border-radius: 999px; background: var(--hover-bg); }
.evo-goal-tags { display: flex; flex-wrap: wrap; gap: 5px; }
.evo-goal-detail-meta { display: flex; gap: 12px; font-size: 11px; color: var(--color-text-tertiary); }
.evo-btn-sm { padding: 3px 10px; font-size: 12px; border-radius: 8px; }
.evo-goal-proposals { display: flex; flex-direction: column; gap: 7px; }
.evo-goal-proposal { display: flex; flex-direction: column; gap: 5px; padding: 8px 10px; border: 1px solid var(--color-border-light); border-radius: 9px; background: var(--color-surface); }
.evo-goal-proposal-head { display: flex; align-items: baseline; gap: 8px; }
.evo-goal-proposal-title { flex: 1; font-size: 12.5px; font-weight: 600; color: var(--color-text-primary); min-width: 0; }
.evo-goal-proposal-time { flex-shrink: 0; font-size: 10.5px; color: var(--color-text-tertiary); }
.evo-goal-proposal-summary { font-size: 12px; color: var(--color-text-secondary); line-height: 1.5; white-space: pre-wrap; }
.evo-goal-proposal-acts { display: flex; gap: 7px; }
.evo-panel-form { display: flex; gap: 8px; flex-wrap: wrap; }
.evo-panel-input { flex: 1; min-width: 140px; padding: 7px 12px; border: 1px solid var(--color-border); border-radius: 9px; background: var(--color-surface); color: var(--color-text-primary); font-size: 13px; outline: none; }
.evo-panel-input:focus { border-color: var(--brand); }
.evo-panel-input-cron { flex: 0 0 130px; min-width: 0; font-family: ui-monospace, Consolas, monospace; }
.evo-panel-add { display: inline-flex; align-items: center; gap: 6px; padding: 7px 16px; border: none; border-radius: 9px; background: var(--brand-solid); color: var(--brand-foreground); font-size: 13px; font-weight: 600; cursor: pointer; }
.evo-panel-add:disabled { opacity: 0.5; cursor: default; }
.evo-panel-add svg { width: 14px; height: 14px; }
.evo-panel-del { border: none; background: none; color: var(--color-text-tertiary); cursor: pointer; padding: 4px; border-radius: 6px; display: inline-flex; }
.evo-panel-del:hover { color: var(--color-error); background: var(--hover-bg); }
.evo-panel-del svg { width: 14px; height: 14px; }
.evo-panel-act { border: none; background: none; color: var(--color-text-tertiary); cursor: pointer; padding: 4px; border-radius: 6px; display: inline-flex; }
.evo-panel-act:hover { color: var(--brand); background: var(--hover-bg); }
.evo-panel-act:disabled { opacity: .45; cursor: default; }
.evo-panel-act svg { width: 14px; height: 14px; }
.evo-profile-edit { display: flex; flex-direction: column; gap: 8px; padding: 4px 2px 8px; }
.evo-identity-edit { width: 100%; min-height: 140px; padding: 8px 10px; border: 1px solid var(--color-border); border-radius: 9px; background: var(--color-surface); color: var(--color-text-primary); font-family: ui-monospace, Consolas, monospace; font-size: 12.5px; line-height: 1.6; resize: vertical; outline: none; }
.evo-identity-edit:focus { border-color: var(--brand); }
.evo-profile-rename { align-items: center; padding: 4px 2px 8px; }
/* ── Schedule Builder（§42.2）── */
.evo-sched-modes { display: flex; gap: 4px; }
.evo-sched-fields { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.evo-sched-select { width: auto; flex: 0 1 110px; }
.evo-sched-preview { font-family: ui-monospace, Consolas, monospace; font-size: 11.5px; color: var(--color-text-tertiary); background: var(--hover-bg); padding: 3px 8px; border-radius: 6px; }
.evo-sched-templates { display: flex; flex-wrap: wrap; gap: 5px; }
.evo-sched-template { border: 1px solid var(--color-border); background: var(--color-surface); color: var(--color-text-secondary); font-size: 11.5px; border-radius: 999px; padding: 3px 11px; cursor: pointer; }
.evo-sched-template:hover { border-color: var(--brand); color: var(--brand); }
.evo-panel-label { font-size: 12px; font-weight: 600; color: var(--color-text-secondary); }
.evo-panel-check { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--color-text-secondary); cursor: pointer; }
/* ── Memory History 时间线（§26.5）── */
.evo-history-row { display: flex; align-items: flex-start; gap: 8px; padding: 8px 10px; border: 1px solid var(--color-border); border-radius: 10px; background: var(--color-surface); }
.evo-history-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--color-text-tertiary); flex-shrink: 0; margin-top: 6px; }
.evo-history-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.evo-history-text { font-size: 12.5px; color: var(--color-text-primary); line-height: 1.5; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.evo-history-meta { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--color-text-tertiary); flex-wrap: wrap; }
.evo-identity-text { margin: 0; max-height: 160px; overflow-y: auto; font-family: ui-monospace, Consolas, monospace; font-size: 11.5px; line-height: 1.55; color: var(--color-text-secondary); white-space: pre-wrap; word-break: break-word; }
/* ── Skills Marketplace（§42.6）── */
.evo-skill-name-btn { border: none; background: none; padding: 0; cursor: pointer; text-align: left; min-width: 0; }
.evo-skill-name-btn:hover .evo-panel-item-main { color: var(--brand); }
.evo-skill-source { font-size: 10.5px; color: var(--color-text-tertiary); background: var(--hover-bg); border-radius: 999px; padding: 2px 8px; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.evo-skill-detail { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--color-text-secondary); border-top: 1px dashed var(--color-border); padding-top: 7px; line-height: 1.55; }
/* ── 工作区文件浏览器（Inspector → Workspace）── */
.evo-fs { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.evo-fs-toolbar { display: flex; align-items: center; gap: 6px; padding: 8px 10px 4px; }
.evo-fs-crumb { flex: 1; min-width: 0; font-size: 11.5px; color: var(--color-text-tertiary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; direction: rtl; text-align: left; }
.evo-fs-tree { flex: 1; overflow-y: auto; padding: 4px 6px 12px; min-height: 0; }
.evo-fs-row { display: flex; align-items: center; gap: 6px; width: 100%; padding: 4px 8px; border: none; background: none; border-radius: 7px; color: var(--color-text-secondary); font-size: 12.5px; cursor: pointer; text-align: left; }
.evo-fs-row:hover { background: var(--hover-bg); color: var(--color-text-primary); }
.evo-fs-row svg { width: 14px; height: 14px; flex-shrink: 0; color: var(--color-text-tertiary); }
.evo-fs-row svg.lucide-folder { color: var(--brand); }
.evo-fs-arrow { width: 14px; flex-shrink: 0; }
.evo-fs-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.evo-fs-hidden .evo-fs-name { opacity: 0.55; }
.evo-fs-empty { font-size: 11.5px; color: var(--color-text-tertiary); padding: 4px 8px; }
.evo-fs-viewer { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.evo-fs-viewer-head { display: flex; align-items: center; gap: 6px; padding: 8px 10px 6px; border-bottom: 1px solid var(--color-border-light); }
.evo-fs-viewer-name { flex: 1; min-width: 0; font-size: 12.5px; font-weight: 600; color: var(--color-text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.evo-fs-save { display: inline-flex; align-items: center; gap: 5px; padding: 4px 12px; border: none; border-radius: 7px; background: var(--brand-solid); color: var(--brand-foreground); font-size: 12px; font-weight: 600; cursor: pointer; }
.evo-fs-save:disabled { opacity: 0.5; cursor: default; }
.evo-fs-save svg { width: 13px; height: 13px; }
.evo-fs-editor { flex: 1; min-height: 0; padding: 10px 12px; border: none; outline: none; resize: none; background: var(--color-surface); color: var(--color-text-primary); font-size: 12.5px; line-height: 1.6; font-family: ui-monospace, "Cascadia Code", Consolas, monospace; }
.evo-fs-image { max-width: 100%; object-fit: contain; padding: 10px; }
.evo-fs-frame { flex: 1; min-height: 0; border: none; background: var(--color-surface); }
/* ── 会话状态条 / 统计条 ── */
.evo-composer { position: relative; border: 1px solid var(--color-border); border-radius: 12px; background: var(--color-surface); display: flex; flex-direction: column; container-type: inline-size; }
/* 输入区顶部拖拽热区：覆盖边框，不额外占据输入区的布局高度。 */
.evo-composer-resize { position: absolute; z-index: 1; inset: -4px 0 auto; height: 9px; cursor: ns-resize; border-radius: 12px 12px 0 0; touch-action: none; display: flex; align-items: center; justify-content: center; }
.evo-composer-resize::before { content: ''; width: 28px; height: 2px; border-radius: 999px; background: var(--color-border); transition: background 0.15s ease, width 0.15s ease; }
.evo-composer-resize:hover::before, .evo-composer-resize[data-dragging]::before { background: var(--brand); width: 44px; }
.evo-composer-status { display: flex; align-items: center; gap: 8px; padding: 8px 14px 0; font-size: 12px; color: var(--color-text-tertiary); flex-wrap: wrap; }
/* 当前工作路径（§25.4）：单行省略 + tooltip 完整路径 */
.evo-cwd { max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: ui-monospace, Consolas, monospace; font-size: 11px; color: var(--color-text-tertiary); cursor: default; }
.evo-cwd:hover { color: var(--color-text-secondary); }
.evo-status-chip { display: inline-flex; align-items: center; gap: 5px; padding: 2px 8px; border-radius: 999px; background: var(--hover-bg); color: var(--color-text-secondary); font-size: 11px; }
.evo-status-model { border: none; cursor: pointer; transition: border-color 0.15s, color 0.15s; }
.evo-status-model:hover { color: var(--brand); box-shadow: 0 0 0 1px var(--brand); }
.evo-status-chip svg { width: 11px; height: 11px; }
.evo-status-goal { color: var(--brand); }
.evo-status-ro { color: var(--color-warning); }
.evo-status-full { color: var(--color-error); }
.evo-stats-line { display: flex; align-items: center; gap: 8px; padding: 6px 14px 9px; font-size: 11px; color: var(--color-text-tertiary); font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* 会话统计行：与输入框同宽，位于圆角框外部正下方；统计居左、模型徽章居右。 */
.evo-composer-stats { flex: 0 0 100%; width: 100%; max-width: var(--chat-max-width); margin: 0 auto; display: flex; align-items: center; gap: 10px; }
.evo-composer-stats .evo-statusbar { flex: 1 1 auto; min-width: 0; width: auto; height: auto; min-height: 16px; padding: 0; border-top: 0; background: transparent; flex-wrap: wrap; row-gap: 0; overflow: visible; white-space: normal; line-height: 16px; justify-content: center; }
.evo-composer-stats .evo-statusbar-empty { line-height: 16px; }
/* 模型徽章：品牌色强调、右侧固定，点击切换模型 */
.evo-composer-model { flex-shrink: 0; display: inline-flex; align-items: center; gap: 5px; padding: 2px 10px; border-radius: 999px; border: 1px solid color-mix(in srgb, var(--brand) 30%, transparent); background: color-mix(in srgb, var(--brand) 8%, var(--color-surface)); color: var(--brand); font-size: 11px; font-weight: 600; cursor: pointer; font-family: inherit; line-height: 1.5; white-space: nowrap; transition: box-shadow 0.15s ease, border-color 0.15s ease; }
.evo-composer-model:hover { border-color: var(--brand); box-shadow: 0 0 0 1px color-mix(in srgb, var(--brand) 45%, transparent); }
.evo-composer-model svg { width: 11px; height: 11px; flex-shrink: 0; }
.evo-composer-model-name { max-width: 220px; overflow: hidden; text-overflow: ellipsis; }
.evo-composer-model-effort { font-weight: 400; opacity: 0.88; }
.evo-stats-sep { color: var(--color-border); margin-right: 8px; }
/* ── 插件清单 ── */
.evo-plugin-list { display: flex; flex-direction: column; gap: 4px; max-height: 180px; overflow-y: auto; }
.evo-settings-modal { display: flex; flex-direction: column; padding: 0; overflow: hidden; }
.evo-settings-head { padding: 10px 14px; border-bottom: 1px solid var(--color-border-light); }
.evo-btn-back { display: inline-flex; align-items: center; gap: 5px; padding: 5px 12px; border: 1px solid var(--color-border); border-radius: 8px; background: transparent; color: var(--color-text-primary); font-size: 13px; cursor: pointer; font: inherit; }
.evo-btn-back:hover { background: var(--hover-bg); }
.evo-btn-back svg { width: 15px; height: 15px; }
.evo-settings-body { display: flex; flex: 1; min-height: 0; }
.evo-settings-nav { width: 176px; flex-shrink: 0; border-right: 1px solid var(--color-border-light); padding: 10px 8px; display: flex; flex-direction: column; gap: 4px; overflow-y: auto; }
.evo-settings-tab { display: flex; align-items: center; gap: 9px; padding: 9px 12px; border: none; border-radius: 9px; background: transparent; color: var(--color-text-secondary); font-size: 13.5px; cursor: pointer; text-align: left; font: inherit; position: relative; }
.evo-settings-tab:hover { background: var(--hover-bg); }
.evo-settings-tab[data-active] { background: color-mix(in srgb, var(--brand) 8%, transparent); color: var(--brand); font-weight: 600; }
.evo-settings-tab[data-active]::before { content: ''; position: absolute; left: 0; top: 20%; bottom: 20%; width: 3px; border-radius: 3px; background: var(--brand); }
.evo-settings-tab svg { width: 16px; height: 16px; flex-shrink: 0; }
.evo-settings-content { flex: 1; min-width: 0; overflow-y: auto; padding: 14px 16px; }
/* ── 清除数据（设置面板）：多选行 + 二次确认 ── */
.evo-clear-rows { display: flex; flex-direction: column; gap: 8px; margin: 12px 0; }
.evo-clear-row { display: flex; align-items: flex-start; gap: 10px; padding: 11px 13px; border: 1px solid var(--color-border-light); border-radius: 12px; background: var(--color-surface); cursor: pointer; transition: border-color 0.15s ease, background 0.15s ease; }
.evo-clear-row:hover { border-color: color-mix(in srgb, var(--brand) 35%, var(--color-border-light)); }
.evo-clear-row.checked { border-color: color-mix(in srgb, var(--color-error) 45%, var(--color-border-light)); background: color-mix(in srgb, var(--color-error) 5%, var(--color-surface)); }
.evo-clear-row input[type='checkbox'] { width: 15px; height: 15px; margin: 2px 0 0; accent-color: var(--color-error); flex-shrink: 0; cursor: pointer; }
.evo-clear-row-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.evo-clear-row-title { font-size: 13px; font-weight: 600; color: var(--color-text-primary); }
.evo-clear-row-desc { font-size: 12px; line-height: 1.5; color: var(--color-text-tertiary); }
.evo-btn-danger.confirming { background: var(--color-error); color: #fff; }
.evo-btn-danger.confirming:hover { background: color-mix(in srgb, var(--color-error) 86%, #000); }
.evo-tier-grid { display: flex; flex-direction: column; gap: 12px; margin: 10px 0; }
.evo-tier-card { padding: 12px 14px; border: 1px solid var(--color-border-light); border-radius: 12px; background: var(--color-surface); display: flex; flex-direction: column; gap: 8px; }
.evo-tier-head { display: flex; align-items: baseline; gap: 10px; }
.evo-tier-name { font-size: 13.5px; font-weight: 600; color: var(--color-text-primary); }
.evo-tier-desc { font-size: 12px; color: var(--color-text-tertiary); }
.evo-setting-field { display: flex; flex-direction: column; gap: 4px; }
.evo-setting-field-label { font-size: 12px; color: var(--color-text-tertiary); }
.evo-mode-row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
.evo-mode-chip { padding: 5px 14px; border: 1px solid var(--color-border); border-radius: 999px; background: var(--color-surface); color: var(--color-text-secondary); font-size: 12.5px; cursor: pointer; font: inherit; }
.evo-mode-chip:hover { border-color: var(--brand); }
.evo-mode-chip[data-active] { border-color: var(--brand); color: var(--brand); background: color-mix(in srgb, var(--brand) 10%, transparent); font-weight: 600; }
.evo-plugin-row { display: flex; justify-content: space-between; gap: 10px; font-size: 12.5px; color: var(--color-text-secondary); }
.evo-plugin-state { color: var(--color-text-tertiary); font-size: 11.5px; }
.evo-plugin-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 5px 10px; border: 1px solid var(--color-border-light); border-radius: 8px; background: var(--color-surface); }
.evo-plugin-id { font-size: 12px; color: var(--color-text-primary); font-family: ui-monospace, Consolas, monospace; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.evo-plugin-state { font-size: 10.5px; color: var(--color-text-tertiary); flex-shrink: 0; }
.evo-plugin-ok { color: var(--color-success); }
/* ── 消息复制 / 编辑 / 回溯（气泡外下方操作行）── */
.evo-msg-stack { display: flex; flex-direction: column; align-items: flex-start; gap: 3px; min-width: 0; max-width: 100%; }
.evo-msg-user .evo-msg-stack { align-items: flex-end; gap: 2px; }
.evo-msg-author { padding: 0 3px; color: var(--color-text-tertiary); font-size: 11px; line-height: 1.2; }
.evo-msg-meta { display: flex; align-items: center; gap: 7px; min-height: 18px; opacity: 0; transition: opacity 0.12s ease; padding: 0 2px; }
.evo-msg-row:hover .evo-msg-meta { opacity: 1; }
.evo-msg-meta .evo-msg-time { font-size: 10.5px; color: var(--color-text-tertiary); }
.evo-msg-copy { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; border: none; background: none; color: var(--color-text-tertiary); border-radius: 6px; cursor: pointer; padding: 0; }
.evo-msg-copy:hover { background: var(--hover-bg); color: var(--color-text-primary); }
.evo-msg-copy.confirming { background: color-mix(in srgb, var(--color-warning) 18%, transparent); color: var(--color-warning); }
.evo-msg-copy svg { width: 13px; height: 13px; }
/* 用户消息内联编辑（§回溯：编辑并重发覆盖） */
.evo-msg-edit { display: flex; flex-direction: column; gap: 7px; min-width: 320px; max-width: 620px; }
.evo-msg-edit-textarea { width: 100%; min-height: 76px; max-height: 220px; padding: 10px 12px; border: 1px solid var(--brand); border-radius: 12px; background: var(--color-surface); color: var(--color-text-primary); font-size: 14px; font-family: inherit; line-height: 1.5; outline: none; resize: vertical; }
.evo-msg-edit-acts { display: flex; align-items: center; gap: 8px; }
.evo-msg-edit-hint { font-size: 11px; color: var(--color-text-tertiary); }
/* ── Agents 树（Inspector）── */
.evo-insp-subtab-title { font-size: 11.5px; font-weight: 600; color: var(--color-text-tertiary); letter-spacing: 0.3px; text-transform: uppercase; padding: 2px 4px; }
.evo-agent-list { display: flex; flex-direction: column; gap: 2px; padding: 4px 6px 12px; }
.evo-agent-row { display: flex; align-items: center; gap: 7px; padding: 5px 8px; border-radius: 7px; font-size: 12.5px; color: var(--color-text-secondary); }
.evo-agent-row:hover { background: var(--hover-bg); }
.evo-agent-chevron { width: 13px; height: 13px; color: var(--color-text-tertiary); flex-shrink: 0; }
.evo-agent-chevron-empty { display: inline-block; }
.evo-agent-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--color-border); flex-shrink: 0; }
.evo-agent-dot.running { background: var(--color-success); box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-success) 22%, transparent); }
.evo-agent-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--color-text-primary); }
.evo-agent-mode { padding: 1px 7px; border-radius: 999px; font-size: 10px; background: var(--hover-bg); color: var(--color-text-tertiary); flex-shrink: 0; }
.evo-agent-mode.continuable { background: color-mix(in srgb, var(--brand) 14%, transparent); color: var(--brand); }
.evo-agent-activity { font-size: 10.5px; color: var(--color-success); flex-shrink: 0; }
/* ── Research Skills ── */
.evo-skill-tabs { display: flex; gap: 6px; flex-wrap: wrap; }
.evo-skill-card { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; border: 1px solid var(--color-border-light); border-radius: 10px; background: var(--color-surface); }
.evo-skill-head { display: flex; align-items: center; gap: 8px; }
.evo-skill-status { padding: 1px 8px; border-radius: 999px; font-size: 10.5px; background: var(--hover-bg); color: var(--color-text-tertiary); flex-shrink: 0; text-transform: capitalize; }
.evo-skill-status.pending { color: var(--color-warning); }
.evo-skill-status.approved { color: var(--color-success); }
.evo-skill-status.rejected { color: var(--color-error); }
.evo-skill-action { padding: 1px 8px; border-radius: 999px; font-size: 10.5px; background: color-mix(in srgb, var(--brand) 14%, transparent); color: var(--brand); flex-shrink: 0; }
.evo-skill-desc { font-size: 12.5px; color: var(--color-text-secondary); line-height: 1.55; }
.evo-skill-src { font-size: 11px; color: var(--color-text-tertiary); }
.evo-skill-actions { display: flex; gap: 8px; margin-top: 2px; }
.evo-btn { display: inline-flex; align-items: center; gap: 6px; padding: 5px 14px; border: none; border-radius: 8px; font-size: 12.5px; font-weight: 600; cursor: pointer; }
.evo-btn:disabled { opacity: 0.5; cursor: default; }
.evo-btn svg { width: 13px; height: 13px; }
.evo-btn-ok { background: color-mix(in srgb, var(--color-success) 16%, transparent); color: var(--color-success); }
.evo-btn-ok:hover { background: color-mix(in srgb, var(--color-success) 26%, transparent); }
.evo-btn-danger { background: color-mix(in srgb, var(--color-error) 14%, transparent); color: var(--color-error); }
.evo-btn-danger:hover { background: color-mix(in srgb, var(--color-error) 24%, transparent); }
.evo-btn-run { background: var(--brand-solid); color: var(--brand-foreground); }
.evo-btn-run:hover { background: var(--brand-hover); }
/* ── Chat Graph（§ChatGraph：节点/连线画布；视觉评审优化版）── */
.evo-graph { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.evo-graph-toolbar { display: flex; align-items: center; gap: 6px; padding: 8px 14px; border-bottom: 1px solid var(--color-border); flex-shrink: 0; }
.evo-graph-title { font-size: 13px; font-weight: 600; color: var(--color-text-primary); }
.evo-graph-btn { display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px; border: 1px solid var(--color-border); border-radius: 7px; background: var(--color-surface); color: var(--color-text-secondary); font-size: 12px; cursor: pointer; font: inherit; transition: border-color 0.15s, color 0.15s; }
.evo-graph-btn:hover:not(:disabled) { border-color: var(--brand); color: var(--brand); }
.evo-graph-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.evo-graph-btn svg { width: 13px; height: 13px; }
/* 画布：Blender 节点编辑器风格深色底 + 点阵网格 */
.evo-graph-canvas { position: relative; flex: 1; min-height: 300px; overflow: auto; background:
  radial-gradient(circle, var(--graph-grid) 1.2px, transparent 1.2px) 0 0 / 20px 20px,
  var(--graph-canvas); }
.evo-graph-canvas .react-flow { position: absolute; inset: 0; direction: ltr; background: transparent; }
.evo-graph-canvas .react-flow__container, .evo-graph-canvas .react-flow__renderer, .evo-graph-canvas .react-flow__pane { position: absolute; inset: 0; width: 100%; height: 100%; }
.evo-graph-canvas .react-flow__viewport { transform-origin: 0 0; z-index: 2; pointer-events: none; }
.evo-graph-canvas .react-flow__nodes { pointer-events: none; transform-origin: 0 0; }
.evo-graph-canvas .react-flow__node { position: absolute; user-select: none; pointer-events: all; transform-origin: 0 0; box-sizing: border-box; }
.evo-graph-canvas .react-flow__nodes, .evo-graph-canvas .react-flow__edges { position: absolute; }
.evo-graph-canvas .react-flow__edges svg { position: absolute; overflow: visible; pointer-events: none; }
.evo-graph-canvas .react-flow__edge { pointer-events: visibleStroke; }
.evo-graph-canvas .react-flow__edge-path, .evo-graph-canvas .react-flow__connection-path { fill: none; }
.evo-graph-canvas .react-flow__edgelabel-renderer { position: absolute; inset: 0; pointer-events: none; user-select: none; }
.evo-graph-canvas .react-flow__panel { position: absolute; z-index: 5; margin: 15px; }
.evo-graph-canvas .react-flow__node { cursor: grab; }
.evo-graph-canvas .react-flow__node.dragging { cursor: grabbing; }
.evo-graph-canvas .react-flow__handle { width: 9px; height: 9px; min-width: 9px; min-height: 9px; border-radius: 999px; border: 1.5px solid rgba(255,255,255,.75); box-shadow: 0 0 3px rgba(0,0,0,.5); }
.evo-graph-canvas .react-flow__handle-left { left: -5px; }
.evo-graph-canvas .react-flow__handle-right { right: -5px; }
.evo-graph-canvas .react-flow__handle.evo-graph-socket-ctx { background: var(--graph-fork); }
.evo-graph-canvas .react-flow__handle.evo-graph-socket-mem { background: var(--graph-reference); }
.evo-graph-canvas .react-flow__handle.evo-graph-socket-out { background: var(--graph-resource); }
.evo-graph-canvas .react-flow__handle:hover { transform: translateY(-50%) scale(1.45) !important; }
.evo-graph-canvas .react-flow__controls { overflow: hidden; border: 1px solid var(--graph-control-border); border-radius: 7px; box-shadow: 0 4px 14px rgb(0 0 0 / 24%); }
.evo-graph-canvas .react-flow__controls-button { width: 26px; height: 26px; border: 0; border-bottom: 1px solid var(--graph-control-border); background: var(--graph-control); color: var(--color-text-primary); fill: var(--color-text-primary); }
.evo-graph-canvas .react-flow__controls-button:last-child { border-bottom: 0; }
.evo-graph-canvas .react-flow__minimap { right: 12px; bottom: 12px; overflow: hidden; border: 1px solid var(--graph-control-border); border-radius: 6px; background: var(--graph-minimap); }
.evo-graph-canvas .react-flow__edge-path { stroke: var(--graph-disabled); stroke-width: 2px; }
.evo-graph-canvas .react-flow__edge.selected .react-flow__edge-path { stroke: var(--graph-trace); }
.evo-graph-canvas .react-flow__node .evo-graph-node { position: relative; left: auto; top: auto; }
.evo-graph-canvas .evo-graph-node .evo-graph-socket-label-ctx { position: absolute; left: 14px; top: 29px; }
.evo-graph-canvas .evo-graph-node .evo-graph-socket-label-mem { position: absolute; left: 14px; top: 47px; }
.evo-graph-canvas .evo-graph-node .evo-graph-socket-label-out { position: absolute; right: 14px; top: 38px; }
.evo-graph-canvas .evo-graph-node .evo-graph-node-sid { position: absolute; right: 8px; top: 47px; max-width: 58px; }
.evo-graph-canvas .evo-graph-node > .evo-graph-node-body { position: static; }
.evo-graph-canvas .react-flow__edge-textbg { fill: var(--graph-node-surface-alt); }
.evo-graph-canvas .react-flow__edge-text { fill: var(--graph-edge-label); font-size: 10px; }
/* 节点卡片：Blender 节点编辑器风格——类型色标题栏 + 深灰主体 + socket 行（顶部内高光增强浮起感） */
.evo-graph-node { position: absolute; background: linear-gradient(180deg, var(--graph-node-surface), var(--graph-node-surface-alt)); border: 1px solid var(--graph-node-border); border-radius: 7px; padding: 0; cursor: grab; user-select: none; box-shadow: inset 0 1px 0 rgb(255 255 255 / 10%), 0 3px 12px rgb(0 0 0 / 24%); transition: border-color 0.15s, box-shadow 0.15s; display: flex; flex-direction: column; }
.evo-graph-node:hover { border-color: color-mix(in srgb, var(--brand) 55%, var(--graph-node-border)); box-shadow: inset 0 1px 0 rgb(255 255 255 / 10%), 0 5px 18px rgb(0 0 0 / 30%); }
.evo-graph-node-sel { border-color: var(--graph-trace); box-shadow: 0 0 0 1.5px color-mix(in srgb, var(--graph-trace) 55%, transparent), 0 5px 18px rgb(0 0 0 / 28%); }
.evo-graph-node[data-pinned] { box-shadow: 0 0 0 1px color-mix(in srgb, var(--graph-trace) 42%, transparent), inset 0 1px 0 rgb(255 255 255 / 10%), 0 3px 12px rgb(0 0 0 / 24%); }
.evo-graph-node-dragging { z-index: 30; cursor: grabbing; box-shadow: 0 0 0 1.5px color-mix(in srgb, var(--graph-trace) 40%, transparent), 0 10px 28px rgb(0 0 0 / 34%); }
/* 标题栏：类型色渐变（Blender 节点 header 风格） */
.evo-graph-node-titlebar { height: 24px; display: flex; align-items: center; gap: 6px; padding: 0 8px; border-radius: 4px 4px 0 0; flex-shrink: 0; }
.evo-graph-node-chat .evo-graph-node-titlebar { background: color-mix(in srgb, var(--graph-chat) 28%, var(--graph-node-surface-alt)); }
.evo-graph-node-memory .evo-graph-node-titlebar { background: color-mix(in srgb, var(--graph-memory) 28%, var(--graph-node-surface-alt)); }
.evo-graph-node-memory[data-global] .evo-graph-node-titlebar { background: color-mix(in srgb, var(--graph-global) 30%, var(--graph-node-surface-alt)); }
.evo-graph-node-resource { border-style: dashed; }
.evo-graph-node-resource .evo-graph-node-titlebar { background: color-mix(in srgb, var(--graph-resource) 28%, var(--graph-node-surface-alt)); }
.evo-graph-node[data-status='missing'], .evo-graph-node[data-status='failed'] { border-color: var(--graph-status-missing); }
.evo-graph-node[data-status='running'], .evo-graph-node[data-status='indexing'] { border-color: var(--graph-status-running); }
.evo-graph-node-candidate { border-style: dashed; border-color: var(--graph-candidate); }
.evo-graph-node-trace::after { content: '本轮已读取'; position: absolute; right: 6px; bottom: 4px; padding: 1px 4px; border-radius: 3px; background: color-mix(in srgb, var(--graph-trace) 16%, var(--graph-node-surface)); color: var(--graph-trace); font-size: 8px; line-height: 1.2; }
.evo-graph-node-dot { width: 9px; height: 9px; border-radius: 999px; background: var(--color-text-secondary); flex-shrink: 0; }
.evo-graph-node-chat .evo-graph-node-dot { background: color-mix(in srgb, var(--graph-chat) 68%, white); }
.evo-graph-node-memory .evo-graph-node-dot { background: color-mix(in srgb, var(--graph-memory) 68%, white); }
.evo-graph-node-memory[data-global] .evo-graph-node-dot { background: var(--graph-global); }
.evo-graph-node-title { font-size: 12px; font-weight: 650; color: var(--graph-node-title); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; flex: 1; }
/* 主体：socket 行 */
.evo-graph-node-body { flex: 1; display: flex; flex-direction: column; gap: 2px; padding: 5px 7px 6px; min-width: 0; }
.evo-graph-socket-row { display: flex; align-items: center; gap: 6px; min-width: 0; }
.evo-graph-socket-row-out { margin-top: 1px; }
/* Blender socket：8px 实心圆 + 亮描边 */
.evo-graph-socket { width: 9px; height: 9px; border-radius: 999px; border: 1.5px solid rgba(255, 255, 255, 0.75); cursor: crosshair; flex-shrink: 0; transition: transform 0.12s, box-shadow 0.12s; box-shadow: 0 0 3px rgba(0, 0, 0, 0.5); }
.evo-graph-socket-ctx { background: var(--graph-fork); }
.evo-graph-socket-mem { background: var(--graph-reference); }
.evo-graph-socket-out { background: var(--graph-resource); }
.evo-graph-socket-hidden { visibility: hidden; pointer-events: none; }
.evo-graph-socket:hover { transform: scale(1.45); box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.18); }
.evo-graph-socket-label { font-size: 10px; letter-spacing: 0.2px; color: var(--color-text-secondary); white-space: nowrap; }
.evo-graph-node-tag { font-size: 9.5px; color: var(--color-text-secondary); background: color-mix(in srgb, var(--color-text-primary) 8%, transparent); border-radius: 3px; padding: 1px 5px; flex-shrink: 0; }
.evo-graph-node-sid { font-size: 9.5px; color: var(--color-text-tertiary); font-family: ui-monospace, Consolas, monospace; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.evo-graph-node-preview { font-size: 10px; color: var(--color-text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
/* 连线：粗贝塞尔 + 类型色（Blender 风格：线在 socket 处衔接） */
.evo-graph-edge { fill: none; stroke: var(--graph-disabled); stroke-width: 2px; }
.evo-graph-edge-ctx { stroke: var(--graph-fork); stroke-width: 2.2px; }
.evo-graph-edge-mem { stroke: var(--graph-reference); stroke-width: 2px; }
.evo-graph-edge-relation { stroke: var(--graph-relation); stroke-width: 1.6px; stroke-dasharray: 5 4; }
.evo-graph-canvas .react-flow__edge-path.evo-graph-edge-ctx { stroke: var(--graph-fork) !important; stroke-width: 2.2px; }
.evo-graph-canvas .react-flow__edge-path.evo-graph-edge-mem { stroke: var(--graph-reference) !important; stroke-width: 2px; }
.evo-graph-canvas .react-flow__edge-path.evo-graph-edge-relation { stroke: var(--graph-relation) !important; stroke-width: 1.6px; stroke-dasharray: 5 4; }
.evo-graph-edge-disabled { opacity: 0.35; }
.evo-graph-edge-label-hidden { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
.evo-graph-edge-linking { stroke: var(--graph-trace); stroke-dasharray: 6 4; stroke-width: 2.2px; }
/* 右键菜单：与面板同语言 */
.evo-graph-menu { position: absolute; z-index: 50; min-width: 176px; padding: 5px; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 10px; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.28); display: flex; flex-direction: column; gap: 2px; }
.evo-graph-menu-item { display: flex; align-items: center; gap: 9px; padding: 7px 10px; border: none; background: none; border-radius: 7px; color: var(--color-text-primary); font-size: 12.5px; cursor: pointer; text-align: left; font: inherit; transition: background 0.12s; }
.evo-graph-menu-item:hover:not(:disabled) { background: var(--hover-bg); }
.evo-graph-menu-item:disabled { opacity: 0.45; cursor: not-allowed; }
.evo-graph-menu-item svg { width: 13px; height: 13px; color: var(--color-text-tertiary); }
.evo-graph-menu-danger { color: var(--color-error); }
.evo-graph-menu-danger svg { color: var(--color-error); }
.evo-graph-hint { padding: 18px 16px; display: flex; flex-direction: column; align-items: center; gap: 8px; color: var(--color-text-tertiary); font-size: 12.5px; text-align: center; line-height: 1.6; }
.evo-graph-hint svg { width: 34px; height: 34px; color: var(--color-border); }
/* compound group：标题是原生按钮，折叠不依赖颜色或精确点击坐标 */
.evo-graph-group { position: relative; width: 100%; height: 100%; overflow: visible; border: 1px solid color-mix(in srgb, var(--graph-global) 55%, var(--graph-node-border)); border-radius: 10px; background: color-mix(in srgb, var(--graph-global) 8%, transparent); pointer-events: all; }
.evo-graph-group-experiment { border-color: color-mix(in srgb, var(--graph-resource) 65%, var(--graph-node-border)); background: color-mix(in srgb, var(--graph-resource) 8%, transparent); }
.evo-graph-group-exploration { border-color: color-mix(in srgb, var(--graph-candidate) 65%, var(--graph-node-border)); background: color-mix(in srgb, var(--graph-candidate) 8%, transparent); }
.evo-graph-group.collapsed { background: color-mix(in srgb, var(--graph-global) 16%, var(--graph-node-surface)); box-shadow: 0 3px 12px rgb(0 0 0 / 18%); }
.evo-graph-group-header { display: flex; align-items: center; gap: 6px; min-height: 30px; padding: 3px 5px 3px 8px; }
.evo-graph-group-toggle { display: inline-flex; align-items: center; min-width: 0; flex: 1; padding: 3px 5px; border: 0; border-radius: 5px; background: transparent; color: var(--color-text-primary); cursor: pointer; font: inherit; text-align: left; }
.evo-graph-group-toggle:hover { background: color-mix(in srgb, var(--brand) 10%, transparent); }
.evo-graph-group-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; font-weight: 650; }
.evo-graph-group-count { flex: 0 0 auto; min-width: 20px; padding: 1px 5px; border-radius: 999px; background: color-mix(in srgb, var(--color-text-primary) 10%, transparent); color: var(--color-text-secondary); font-size: 10px; text-align: center; }
/* 记忆节点内容编辑弹窗 */
.evo-graph-editor-mask { position: fixed; inset: 0; z-index: 80; background: rgba(0, 0, 0, 0.35); display: flex; align-items: center; justify-content: center; }
.evo-graph-editor { width: min(520px, calc(100vw - 48px)); background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 12px; box-shadow: 0 12px 36px rgba(0, 0, 0, 0.3); display: flex; flex-direction: column; padding: 12px; gap: 10px; }
.evo-graph-editor-head { display: flex; align-items: center; gap: 8px; }
.evo-graph-editor-title { font-size: 13.5px; font-weight: 600; color: var(--color-text-primary); }
.evo-graph-editor-text { width: 100%; min-height: 140px; max-height: 50vh; resize: vertical; padding: 9px 11px; border: 1px solid var(--color-border); border-radius: 8px; background: var(--color-background); color: var(--color-text-primary); font-size: 13px; line-height: 1.5; font-family: inherit; outline: none; }
.evo-graph-editor-text:focus { border-color: color-mix(in srgb, var(--brand) 45%, var(--color-border)); box-shadow: 0 0 0 2px color-mix(in srgb, var(--brand) 12%, transparent); }
.evo-graph-editor-foot { display: flex; align-items: center; gap: 8px; }
.evo-graph-editor-hint { font-size: 11px; color: var(--color-text-tertiary); }
/* GRAPH-04/08：引用节点展示（图标 + 文件名 + 实时预览） */
.evo-graph-node-ref-icon { width: 12px; height: 12px; color: var(--color-text-secondary); flex-shrink: 0; }
.evo-graph-node-ref-name { font-size: 10px; color: var(--color-text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.evo-graph-node-preview-muted { color: var(--color-text-tertiary); }
.evo-graph-node-preview-err { color: var(--graph-status-missing); }
/* GRAPH-11：工具栏节点搜索框 */
.evo-graph-search { display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px; border: 1px solid var(--color-border); border-radius: 7px; background: var(--color-background); color: var(--color-text-tertiary); }
.evo-graph-search svg { width: 12px; height: 12px; flex-shrink: 0; }
.evo-graph-search input { border: none; outline: none; background: none; color: var(--color-text-primary); font-size: 12px; width: 130px; font: inherit; }
.evo-graph-search input::placeholder { color: var(--color-text-tertiary); }
/* GRAPH-07：连线说明文字（svg text；描边底保证可读） */
.evo-graph-edge-label { min-width: 52px; max-width: 280px; padding: 2px 5px; border: 1px solid color-mix(in srgb, var(--graph-edge-label) 22%, transparent); border-radius: 4px; background: color-mix(in srgb, var(--graph-node-surface) 94%, transparent); color: var(--graph-edge-label); font-size: 10px; line-height: 1.25; white-space: normal; overflow-wrap: anywhere; word-break: break-word; pointer-events: none; user-select: none; box-shadow: 0 1px 3px rgb(0 0 0 / 14%); }
/* GRAPH-07/09：连线可右键（编辑说明/删除）；svg 层 pointer-events:none，仅 path 命中 stroke */
.evo-graph-edge-hit { pointer-events: stroke; cursor: pointer; }
.evo-graph-edge-hit:hover { filter: brightness(1.35); }
.evo-graph-canvas .react-flow__minimap { left: 50%; right: auto; transform: translateX(-50%); }
/* GRAPH-04/08：引用只读预览弹窗 */
.evo-graph-viewer { width: min(640px, calc(100vw - 48px)); }
.evo-graph-viewer-path { font-size: 11px; color: var(--color-text-tertiary); font-family: ui-monospace, Consolas, monospace; margin-left: 8px; }
.evo-graph-viewer-text { width: 100%; min-height: 180px; max-height: 55vh; overflow: auto; margin: 0; padding: 9px 11px; border: 1px solid var(--color-border); border-radius: 8px; background: var(--color-background); color: var(--color-text-primary); font-size: 12px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; }
.evo-graph-viewer-error { width: 100%; padding: 14px 11px; border: 1px solid color-mix(in srgb, var(--color-error) 40%, var(--color-border)); border-radius: 8px; background: color-mix(in srgb, var(--color-error) 8%, var(--color-background)); color: var(--color-error); font-size: 12.5px; }
.evo-graph-narrow-list { display: none; }
@media (max-width: 767px) {
  .evo-graph-narrow-list { display: block; min-height: 100%; background: var(--color-surface); }
  .evo-graph-canvas > .react-flow { display: none; }
}
.evo-graph-narrow-item { width: 100%; display: flex; align-items: center; gap: 8px; min-height: 42px; padding: 8px 10px; border: 0; border-bottom: 1px solid var(--color-border); background: var(--color-surface); color: var(--color-text-primary); text-align: left; font: inherit; }
.evo-graph-narrow-item.active { background: color-mix(in srgb, var(--brand) 10%, var(--color-surface)); }
.evo-graph-narrow-kind, .evo-graph-narrow-meta { flex: 0 0 auto; font-size: 11px; color: var(--color-text-tertiary); }
.evo-graph-narrow-title { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
.evo-graph-inspector { position: absolute; z-index: 45; right: 12px; bottom: 12px; width: min(280px, calc(100% - 24px)); max-height: min(52vh, 360px); overflow: auto; padding: 10px; background: color-mix(in srgb, var(--color-surface) 96%, transparent); border: 1px solid var(--color-border); border-radius: 8px; box-shadow: 0 8px 22px rgba(0, 0, 0, 0.24); color: var(--color-text-primary); }
.evo-graph-inspector-head, .evo-graph-inspector-meta { display: flex; align-items: center; gap: 7px; }
.evo-graph-inspector-head { margin-bottom: 8px; font-size: 13px; }
.evo-graph-inspector-meta { flex-wrap: wrap; margin-bottom: 7px; font-size: 11px; color: var(--color-text-tertiary); }
.evo-graph-inspector code { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin: 4px 0; padding: 4px 6px; background: var(--color-background); color: var(--color-text-secondary); font-size: 10px; }
.evo-graph-inspector-preview { margin: 8px 0; color: var(--color-text-secondary); font-size: 11px; line-height: 1.5; }
.evo-graph-inspector-action, .evo-graph-inspector-links button { border: 1px solid var(--color-border); border-radius: 6px; padding: 5px 8px; background: var(--color-background); color: var(--color-text-primary); cursor: pointer; font: inherit; font-size: 11px; }
.evo-graph-inspector-action { margin: 3px 4px 3px 0; }
.evo-graph-inspector-links { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin-top: 8px; font-size: 11px; color: var(--color-text-tertiary); }
.evo-graph-inspector-reopen { position: absolute; z-index: 45; right: 12px; bottom: 12px; border: 1px solid var(--color-border); border-radius: 6px; padding: 6px 9px; background: var(--color-surface); color: var(--color-text-primary); cursor: pointer; font: inherit; font-size: 11px; }
.evo-graph-minimap { position: absolute; z-index: 20; right: 12px; top: 12px; width: 142px; height: 86px; overflow: hidden; border: 1px solid var(--graph-control-border); border-radius: 6px; background: var(--graph-minimap); pointer-events: none; }
.evo-graph-minimap-dot { position: absolute; width: 8px; height: 5px; border-radius: 2px; background: var(--graph-minimap-resource); opacity: 0.72; }
.evo-graph-minimap-dot.active { background: var(--graph-trace); opacity: 1; box-shadow: 0 0 0 1px var(--color-surface); }
.evo-graph-status-missing, .evo-graph-status-failed { color: var(--graph-status-missing); }
.evo-graph-status-running, .evo-graph-status-indexing { color: var(--graph-status-running); }
.evo-context-trace { position: fixed; z-index: 900; top: 0; right: 0; bottom: 0; width: min(520px, 94vw); display: flex; flex-direction: column; gap: 10px; padding: 14px; overflow-y: auto; overscroll-behavior: contain; background: var(--color-surface); color: var(--color-text-primary); border-left: 1px solid var(--color-border); box-shadow: -10px 0 30px rgb(0 0 0 / 18%); }
.evo-context-trace-head { display: flex; align-items: flex-start; gap: 10px; flex-shrink: 0; }
.evo-context-trace-head > div { min-width: 0; flex: 1; }
.evo-context-trace-head strong { display: block; font-size: 15px; }
.evo-context-trace-head p { margin: 2px 0 0; color: var(--color-text-tertiary); font-size: 11.5px; }
.evo-context-trace-question { display: flex; flex-direction: column; gap: 6px; flex-shrink: 0; }
.evo-context-trace-question label, .evo-context-trace-section h3 { font-size: 11.5px; font-weight: 650; color: var(--color-text-secondary); }
.evo-context-trace-question textarea { width: 100%; min-height: 54px; resize: vertical; padding: 7px 9px; border: 1px solid var(--color-border); border-radius: 7px; background: var(--color-background); color: var(--color-text-primary); font: inherit; font-size: 12px; line-height: 1.45; }
.evo-context-trace-actions, .evo-context-trace-item-actions { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.evo-context-trace-section { display: flex; flex-direction: column; gap: 7px; min-width: 0; }
.evo-context-trace-section h3 { margin: 2px 0 0; }
.evo-context-trace-item, .evo-context-trace-link { min-width: 0; padding: 9px; border: 1px solid var(--color-border); border-radius: 8px; background: var(--color-background); }
.evo-context-trace-item.excluded { opacity: .58; }
.evo-context-trace-item-head, .evo-context-trace-link-line { display: flex; align-items: flex-start; gap: 7px; min-width: 0; }
.evo-context-trace-item-head strong { min-width: 0; flex: 1; overflow-wrap: anywhere; font-size: 12.5px; }
.evo-context-trace-item-head span { flex-shrink: 0; color: var(--color-text-tertiary); font-size: 10.5px; }
.evo-context-trace-item-head span.connected { color: var(--color-success); }
.evo-context-trace-item p { margin: 5px 0 7px; color: var(--color-text-secondary); font-size: 11.5px; line-height: 1.5; overflow-wrap: anywhere; }
.evo-context-trace-item-actions button, .evo-context-trace-link button { min-height: 28px; padding: 4px 8px; border: 1px solid var(--color-border); border-radius: 6px; background: var(--color-surface); color: var(--color-text-primary); cursor: pointer; font: inherit; font-size: 11px; }
.evo-context-trace-item-actions button:hover, .evo-context-trace-link button:hover { border-color: var(--brand); color: var(--brand); }
.evo-context-trace-link-line button { min-width: 0; flex: 1; border: 0; background: none; padding: 0; text-align: left; overflow-wrap: anywhere; color: var(--brand); }
.evo-context-trace-link-line code { max-width: 54%; min-width: 0; color: var(--color-text-secondary); overflow-wrap: anywhere; white-space: normal; font-size: 10.5px; }
.evo-context-trace-link small { display: block; margin: 6px 0; color: var(--color-text-tertiary); line-height: 1.45; overflow-wrap: anywhere; }
.evo-context-trace-error, .evo-context-trace-degraded { padding: 8px 9px; border-radius: 7px; font-size: 11.5px; line-height: 1.45; overflow-wrap: anywhere; }
.evo-context-trace-error { border: 1px solid color-mix(in srgb, var(--color-error) 45%, var(--color-border)); color: var(--color-error); background: color-mix(in srgb, var(--color-error) 7%, var(--color-background)); }
.evo-context-trace-degraded { border: 1px solid color-mix(in srgb, var(--color-warning) 45%, var(--color-border)); color: var(--color-warning); background: color-mix(in srgb, var(--color-warning) 7%, var(--color-background)); }
.evo-context-trace-loading, .evo-context-trace-empty { padding: 16px 8px; text-align: center; color: var(--color-text-tertiary); font-size: 12px; }
.evo-context-trace-close-bottom { align-self: flex-end; min-height: 30px; padding: 5px 12px; border: 1px solid var(--color-border); border-radius: 7px; background: var(--color-surface); color: var(--color-text-primary); cursor: pointer; font: inherit; font-size: 12px; }
@media (max-width: 767px) { .evo-context-trace { width: 100vw; max-width: none; border-left: 0; } .evo-context-trace-link code { max-width: 42%; } }
/* ── Channels / Team ── */
.evo-channel-badge { padding: 1px 8px; border-radius: 999px; font-size: 10.5px; background: var(--hover-bg); color: var(--color-text-tertiary); flex-shrink: 0; text-transform: capitalize; }
.evo-channel-badge.online { background: color-mix(in srgb, var(--color-success) 16%, transparent); color: var(--color-success); }
.evo-channel-counts { font-size: 11px; color: var(--color-text-tertiary); font-variant-numeric: tabular-nums; flex-shrink: 0; }
.evo-channel-toggle { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; border: 1px solid var(--color-border); border-radius: 8px; background: var(--color-surface); color: var(--color-text-secondary); cursor: pointer; flex-shrink: 0; }
.evo-channel-toggle:hover { border-color: var(--brand); color: var(--brand); }
.evo-channel-toggle.stop { color: var(--color-error); }
.evo-channel-toggle.stop:hover { border-color: var(--color-error); color: var(--color-error); }
.evo-channel-toggle:disabled { opacity: 0.5; cursor: default; }
.evo-channel-toggle svg { width: 13px; height: 13px; }
.evo-team-row { align-items: flex-start; }
.evo-team-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.evo-team-name { font-size: 13px; font-weight: 600; color: var(--color-text-primary); font-family: ui-monospace, Consolas, monospace; }
.evo-team-desc { font-size: 12px; color: var(--color-text-tertiary); line-height: 1.5; }
/* ── Markdown 排版（移植规范 §31.5；聊天内容紧凑排版：行高 1.3、段距 2px）── */
.evo-md { font-size: 14px; line-height: 1.3; white-space: normal; word-break: break-word; }
.evo-md > :first-child { margin-top: 0 !important; }
.evo-md > :last-child { margin-bottom: 0 !important; }
.evo-md p { margin: 0 0 2px; white-space: pre-wrap; }
.evo-md h1, .evo-md h2, .evo-md h3, .evo-md h4, .evo-md h5, .evo-md h6 { margin: 7px 0 3px; font-weight: 600; line-height: 1.25; color: var(--color-text-primary); }
.evo-md h1 { font-size: 19px; margin-top: 14px; }
.evo-md h2 { font-size: 17px; }
.evo-md h3 { font-size: 15px; }
.evo-md h4, .evo-md h5, .evo-md h6 { font-size: 14px; }
.evo-md ul, .evo-md ol { margin: 0 0 4px; padding-left: 22px; }
.evo-md li { margin: 1px 0; }
.evo-md li > p { margin: 0; }
.evo-md li::marker { color: var(--color-text-tertiary); }
.evo-md .task-list-item { list-style: none; margin-left: -22px; }
.evo-md .task-list-item-checkbox { margin-right: 8px; vertical-align: -1px; }
.evo-md blockquote { margin: 0 0 4px; padding: 2px 10px; border-left: 3px solid var(--color-border); color: var(--color-text-secondary); }
.evo-md blockquote p { margin: 1px 0; white-space: normal; }
.evo-md code { font-family: Consolas, "Cascadia Code", ui-monospace, monospace; font-size: 12.5px; background: var(--hover-bg); border-radius: 4px; padding: 1px 4px; }
.evo-md pre { margin: 6px 0; padding: 9px 11px; background: var(--color-background); border: 1px solid var(--color-border-light); border-radius: 8px; overflow-x: auto; }
.evo-md pre code { background: none; padding: 0; border-radius: 0; font-size: 12.5px; line-height: 1.45; display: block; white-space: pre; }
.evo-md table { margin: 0 0 4px; border-collapse: collapse; width: 100%; font-size: 13px; display: block; overflow-x: auto; }
.evo-md th, .evo-md td { border: 1px solid var(--color-border); padding: 4px 8px; text-align: left; }
.evo-md th { background: var(--hover-bg); font-weight: 600; }
.evo-md tr:nth-child(even) td { background: color-mix(in srgb, var(--hover-bg) 40%, transparent); }
.evo-md hr { border: none; border-top: 1px solid var(--color-border); margin: 6px 0; }
.evo-md a { color: var(--brand); text-decoration: none; }
.evo-md a:hover { text-decoration: underline; }
.evo-md img { max-width: 100%; border-radius: 8px; }
.evo-md .katex-display { margin: 8px 0 16px; overflow-x: auto; overflow-y: hidden; padding: 4px 0; }
.evo-md .hljs { background: transparent; }
.evo-md .evo-mermaid { margin: 0 0 16px; padding: 12px 14px; border: 1px dashed var(--color-border); border-radius: 8px; background: var(--color-background); color: var(--color-text-tertiary); font-size: 12.5px; font-family: ui-monospace, Consolas, monospace; overflow-x: auto; white-space: pre-wrap; }
.evo-md .evo-mermaid svg { max-width: 100%; height: auto; display: block; white-space: normal; }
/* ── 输入框 Markdown 预览 ── */
.evo-md-toggle { display: inline-flex; align-items: center; gap: 2px; padding: 2px; border: 1px solid var(--color-border); border-radius: 999px; background: var(--color-surface); }
.evo-md-toggle-btn { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 22px; border: none; background: none; color: var(--color-text-tertiary); border-radius: 999px; cursor: pointer; }
.evo-md-toggle-btn:hover { color: var(--color-text-primary); }
.evo-md-toggle-btn[data-active] { background: var(--brand-solid); color: var(--brand-foreground); }
.evo-md-toggle-btn svg { width: 13px; height: 13px; }
.evo-composer-preview { flex: 1; min-height: 84px; max-height: 220px; overflow-y: auto; padding: 10px 12px; border: 1px solid var(--color-border); border-radius: 12px; background: var(--color-surface); color: var(--color-text-primary); margin: 8px 14px 0; }
.evo-composer-preview-empty { color: var(--color-text-tertiary); font-size: 13px; }
/* ── 会话动作（§25.6 / §26.8）：Current / Search / Shortcuts / Compact / Clear view ── */
.evo-composer-divider { width: 1px; height: 18px; background: var(--color-border); flex-shrink: 0; }
.evo-info { display: flex; flex-direction: column; gap: 2px; }
.evo-info-row { display: flex; align-items: flex-start; gap: 12px; padding: 7px 2px; border-bottom: 1px solid var(--color-border-light); }
.evo-info-row:last-of-type { border-bottom: none; }
.evo-info-label { flex: 0 0 118px; font-size: 12px; font-weight: 600; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing: 0.3px; padding-top: 1px; }
.evo-info-value { flex: 1; min-width: 0; font-size: 12.5px; color: var(--color-text-primary); display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap; word-break: break-all; }
.evo-info-mono { font-family: ui-monospace, Consolas, monospace; }
.evo-info-path { font-family: ui-monospace, Consolas, monospace; font-size: 11.5px; color: var(--color-text-secondary); }
.evo-info-copy { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border: none; background: none; color: var(--color-text-tertiary); border-radius: 6px; cursor: pointer; flex-shrink: 0; }
.evo-info-copy:hover { color: var(--color-text-primary); background: var(--hover-bg); }
.evo-info-copy svg { width: 13px; height: 13px; }
.evo-info-actions { display: flex; justify-content: flex-end; gap: 8px; padding-top: 14px; }
.evo-search { display: flex; flex-direction: column; gap: 12px; }
.evo-search-bar { display: flex; gap: 8px; align-items: center; }
.evo-search-bar svg { width: 16px; height: 16px; color: var(--color-text-tertiary); flex-shrink: 0; }
.evo-search-input { flex: 1; min-width: 0; padding: 8px 12px; border: 1px solid var(--color-border); border-radius: 9px; background: var(--color-surface); color: var(--color-text-primary); font-size: 13px; outline: none; }
.evo-search-input:focus { border-color: var(--brand); }
.evo-search-section { display: flex; flex-direction: column; gap: 6px; }
.evo-search-section-title { font-size: 11.5px; font-weight: 600; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing: 0.3px; }
.evo-search-results { display: flex; flex-direction: column; gap: 4px; max-height: 260px; overflow-y: auto; }
.evo-search-hit { text-align: left; padding: 7px 10px; border: 1px solid var(--color-border-light); border-radius: 8px; background: var(--color-surface); color: var(--color-text-secondary); font-size: 12.5px; cursor: pointer; line-height: 1.5; }
.evo-search-hit:hover { border-color: var(--brand); color: var(--color-text-primary); }
.evo-search-empty { font-size: 12.5px; color: var(--color-text-tertiary); padding: 6px 2px; }
.evo-shortcuts { display: flex; flex-direction: column; gap: 10px; }
.evo-shortcut-row { display: flex; align-items: center; gap: 14px; }
.evo-shortcut-row span { font-size: 13px; color: var(--color-text-secondary); }
.evo-kbd { display: inline-block; min-width: 30px; padding: 4px 10px; border: 1px solid var(--color-border); border-bottom-width: 2px; border-radius: 6px; background: var(--color-background); color: var(--color-text-primary); font-family: ui-monospace, Consolas, monospace; font-size: 12px; text-align: center; }
.evo-confirm { display: flex; flex-direction: column; gap: 14px; }
.evo-confirm-msg { font-size: 13px; color: var(--color-text-secondary); line-height: 1.7; }
.evo-confirm-actions { display: flex; justify-content: flex-end; gap: 8px; }
.evo-clear-notice { flex: 1; display: flex; align-items: center; justify-content: center; }
.evo-clear-notice-box { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 32px; border: 1px dashed var(--color-border); border-radius: 14px; text-align: center; }
.evo-clear-notice-title { font-size: 16px; font-weight: 600; color: var(--color-text-primary); }
.evo-clear-notice-sub { font-size: 12.5px; color: var(--color-text-tertiary); max-width: 420px; line-height: 1.6; }
/* ── 附件（§23.7）── */
.evo-chat { position: relative; }
.evo-chat-dragover::after { content: 'Drop image(s) to attach'; position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: color-mix(in srgb, var(--brand) 12%, var(--color-background)); color: var(--brand); font-size: 15px; font-weight: 600; border: 2px dashed var(--brand); border-radius: 12px; pointer-events: none; z-index: 5; }
.evo-attach-strip { flex-basis: 100%; flex-shrink: 0; display: flex; flex-direction: column; gap: 6px; padding: 8px 24px 0; }
.evo-attach-error { font-size: 12px; color: var(--color-error); }
.evo-attach-list { display: flex; flex-wrap: wrap; gap: 8px; }
.evo-attach-item { display: inline-flex; align-items: center; gap: 7px; border: 1px solid var(--color-border); border-radius: 10px; background: var(--color-surface); padding: 4px 8px; max-width: 260px; }
.evo-attach-thumb { width: 36px; height: 36px; object-fit: cover; border-radius: 7px; flex-shrink: 0; }
.evo-attach-thumb.evo-attach-loading { display: inline-flex; align-items: center; justify-content: center; font-size: 13px; color: var(--color-text-tertiary); background: var(--hover-bg); }
.evo-attach-name { flex: 1; min-width: 0; font-size: 12px; color: var(--color-text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.evo-attach-remove { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; border: none; background: none; color: var(--color-text-tertiary); border-radius: 5px; cursor: pointer; flex-shrink: 0; }
.evo-attach-remove:hover { color: var(--color-error); background: var(--hover-bg); }
.evo-attach-remove svg { width: 13px; height: 13px; }
/* ── Toast（§33.2）── */
.evo-toast-host { position: fixed; right: 18px; bottom: 18px; z-index: 1200; display: flex; flex-direction: column; gap: 8px; pointer-events: none; }
.evo-toast { padding: 9px 16px; border-radius: 10px; font-size: 12.5px; line-height: 1.5; color: var(--color-text-primary); background: var(--color-surface); border: 1px solid var(--color-border); box-shadow: 0 6px 24px rgb(0 0 0 / 18%); animation: evo-toast-in 0.18s ease-out; max-width: 340px; }
.evo-toast-success { border-color: color-mix(in srgb, var(--color-success) 55%, var(--color-border)); }
.evo-toast-error { border-color: color-mix(in srgb, var(--color-error) 55%, var(--color-border)); color: var(--color-error); }
@keyframes evo-toast-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
/* 无障碍（§30.2）：reduced-motion 时动画/过渡降到约 0.01ms */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
/* ── 页面级错误（§33.4）── */
.evo-fatal { position: fixed; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; background: var(--color-background); color: var(--color-text-primary); z-index: 2000; }
.evo-fatal h2 { margin: 0; font-size: 20px; }
.evo-fatal p { margin: 0; font-size: 13px; color: var(--color-text-secondary); max-width: 460px; text-align: center; line-height: 1.6; }
.evo-fatal-acts { display: flex; gap: 10px; }
.evo-msg-jump { animation: evo-jump-flash 1.6s ease-out; border-radius: 10px; }
@keyframes evo-jump-flash { 0% { background: color-mix(in srgb, var(--brand) 26%, transparent); } 100% { background: transparent; } }
/* ── Recents 操作（§26.3）与 Side Chat（§22.3-22.4）── */
.evo-tl-row { display: flex; align-items: center; gap: 4px; }
.evo-tl-drag-grip { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 28px; margin: -4px 0 -4px -5px; padding: 0; border: 0; border-radius: 6px; background: transparent; color: var(--color-text-tertiary); cursor: grab; flex: 0 0 24px; touch-action: none; }
.evo-tl-drag-grip:hover { background: var(--hover-bg); color: var(--color-text-primary); }
.evo-tl-drag-grip:active, .evo-tl[data-dragging] .evo-tl-drag-grip { cursor: grabbing; }
.evo-tl-drag-grip svg { width: 13px; height: 13px; }
.evo-tl-project-row .evo-tl-drag-grip { width: 24px; height: 28px; }
.evo-tl[data-dragging] { user-select: none; }
.evo-tl-row-dragging { opacity: .42; }
.evo-tl-row-dragging .evo-tl-row-acts { opacity: 0; }
.evo-tl-drop-placeholder { height: 44px; margin: 2px 0; border: 1px dashed color-mix(in srgb, var(--brand) 48%, var(--color-border)); border-radius: 8px; background: color-mix(in srgb, var(--brand) 7%, transparent); position: relative; transition: height 160ms cubic-bezier(.16, 1, .3, 1), background 120ms ease, border-color 120ms ease; }
.evo-tl-drop-placeholder::before { content: ''; position: absolute; left: 10px; right: 10px; top: 50%; height: 2px; border-radius: 999px; background: color-mix(in srgb, var(--brand) 58%, transparent); transform: translateY(-50%); }
.evo-tl-drag-preview { position: fixed; z-index: 1000; display: flex; align-items: center; gap: 9px; width: min(230px, calc(100vw - 28px)); min-height: 42px; padding: 8px 11px; border: 1px solid color-mix(in srgb, var(--brand) 45%, var(--color-border)); border-radius: 10px; background: color-mix(in srgb, var(--color-surface) 78%, transparent); color: var(--color-text-primary); box-shadow: 0 12px 28px rgb(0 0 0 / 20%), 0 2px 7px rgb(0 0 0 / 12%); backdrop-filter: blur(12px) saturate(145%); pointer-events: none; opacity: .9; transform: translate3d(0, 0, 0); }
.evo-tl-drag-preview > svg { width: 16px; height: 16px; color: var(--brand); flex: 0 0 auto; }
.evo-tl-drag-preview > span { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.evo-tl-drag-preview strong, .evo-tl-drag-preview small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.evo-tl-drag-preview strong { font-size: 12.5px; font-weight: 600; }
.evo-tl-drag-preview small { color: var(--color-text-tertiary); font-size: 10.5px; }
@media (prefers-reduced-motion: reduce) {
  .evo-tl-drop-placeholder { transition: none; }
  .evo-tl-drag-preview { backdrop-filter: none; }
}
.evo-tl-row-main { flex: 1; min-width: 0; text-align: left; border: none; background: none; padding: 0; cursor: pointer; }
.evo-tl-row-acts { display: flex; gap: 2px; opacity: 0; transition: opacity 0.15s; flex-shrink: 0; align-items: center; }
.evo-tl-row:hover .evo-tl-row-acts, .evo-tl-row:focus-within .evo-tl-row-acts { opacity: 1; }
.evo-tl-row-act { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border: none; background: none; color: var(--color-text-tertiary); border-radius: 6px; cursor: pointer; }
.evo-tl-row-act:hover { color: var(--color-text-primary); background: var(--hover-bg); }
.evo-tl-row-act[data-on] { color: var(--brand); }
.evo-tl-row-act svg { width: 13px; height: 13px; }
.evo-tl-row-act-del { margin-left: 3px; }
.evo-tl-row-act-del:hover { color: var(--color-error); background: color-mix(in srgb, var(--color-error) 10%, transparent); }
.evo-tl-row-act.evo-tl-del-confirm { color: var(--color-error); background: color-mix(in srgb, var(--color-error) 12%, transparent); font-size: 11px; width: auto; padding: 0 7px; font-weight: 600; }
/* 「⋯」更多操作菜单（§侧栏重构：低频操作收纳） */
.evo-tl-row-more { position: relative; display: inline-flex; align-items: center; }
.evo-tl-row-menu { position: absolute; top: calc(100% + 4px); right: 0; z-index: 80; min-width: 172px; padding: 5px; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 10px; box-shadow: 0 8px 28px rgba(0, 0, 0, 0.16); display: flex; flex-direction: column; gap: 1px; }
.evo-tl-menu-item { display: flex; align-items: center; gap: 9px; padding: 8px 10px; border: none; background: none; border-radius: 7px; color: var(--color-text-primary); font-size: 12.5px; cursor: pointer; text-align: left; white-space: nowrap; }
.evo-tl-menu-item:hover { background: var(--hover-bg); }
.evo-tl-menu-item svg { width: 14px; height: 14px; color: var(--brand); flex-shrink: 0; }
.evo-tl-menu-sep { height: 1px; background: var(--color-border-light); margin: 3px 6px; }
.evo-tl-menu-danger { color: var(--color-error); }
.evo-tl-menu-danger svg { color: var(--color-error); }
.evo-tl-menu-danger:hover { background: color-mix(in srgb, var(--color-error) 10%, transparent); }
.evo-tl-row-acts[data-menu-open] .evo-tl-row-act[data-on] { color: var(--brand); }
.evo-tl-del:hover, .evo-tl-del-confirm { color: var(--color-error); }
.evo-tl-del-confirm { width: auto; padding: 0 6px; font-size: 11px; font-weight: 600; background: color-mix(in srgb, var(--color-error) 14%, transparent); }
.evo-tl-del-confirm:hover { background: var(--color-error); color: var(--color-surface); }
.evo-tl-running { width: 8px; height: 8px; border-radius: 50%; background: var(--brand); flex-shrink: 0; animation: evo-running-pulse 1.2s ease-in-out infinite; }
@keyframes evo-running-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
.evo-del { color: var(--color-text-tertiary); }
.evo-del:hover { color: var(--color-error); }
.evo-del-confirm { color: var(--color-error) !important; font-size: 11px; font-weight: 600; }
.evo-del-confirm:hover { background: var(--color-error); color: var(--color-surface) !important; }
.evo-tl-rename { display: flex; align-items: center; gap: 4px; padding: 4px 8px; }
.evo-tl-rename-input { flex: 1; min-width: 0; padding: 4px 8px; border: 1px solid var(--brand); border-radius: 6px; background: var(--color-surface); color: var(--color-text-primary); font-size: 12.5px; outline: none; }
.evo-sidechat-list { display: flex; flex-direction: column; gap: 4px; padding: 4px 6px 12px; }
.evo-sidechat-tab { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border: 1px solid var(--color-border-light); border-radius: 8px; background: var(--color-surface); }
.evo-sidechat-tab svg { width: 14px; height: 14px; color: var(--brand); flex-shrink: 0; }
.evo-sidechat-tab-main { flex: 1; min-width: 0; text-align: left; border: none; background: none; padding: 0; font-size: 12.5px; color: var(--color-text-primary); cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.evo-sidechat-tab-main:hover { color: var(--brand); }
.evo-sidechat-new { display: inline-flex; align-items: center; gap: 5px; }
.evo-sidechat-new svg { width: 13px; height: 13px; }
/* ── 忙时消息队列（§23.6）── */
.evo-queue-count { font-size: 10.5px; font-weight: 700; min-width: 15px; height: 15px; line-height: 15px; text-align: center; border-radius: 999px; background: var(--brand-solid); color: var(--brand-foreground); padding: 0 4px; }
.evo-queue { position: absolute; bottom: calc(100% - 8px); left: 50%; transform: translateX(-50%); width: min(520px, calc(100vw - 96px)); max-height: 300px; overflow-y: auto; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 12px; box-shadow: 0 10px 32px rgba(0, 0, 0, 0.18); z-index: 40; padding: 8px 10px; display: flex; flex-direction: column; gap: 6px; }
.evo-queue-head { display: flex; align-items: center; gap: 8px; }
.evo-queue-list { display: flex; flex-direction: column; gap: 4px; }
.evo-queue-row { display: flex; align-items: center; gap: 6px; padding: 6px 8px; border: 1px solid var(--color-border-light); border-radius: 8px; background: var(--color-background); }
.evo-queue-text { flex: 1; min-width: 0; font-size: 12.5px; color: var(--color-text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.evo-queue-input { flex: 1; min-width: 0; padding: 4px 8px; border: 1px solid var(--brand); border-radius: 6px; background: var(--color-surface); color: var(--color-text-primary); font-size: 12.5px; outline: none; }
.evo-queue-act { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border: none; background: none; color: var(--color-text-tertiary); border-radius: 6px; cursor: pointer; flex-shrink: 0; }
.evo-queue-act:hover { color: var(--color-text-primary); background: var(--hover-bg); }
.evo-queue-act svg { width: 13px; height: 13px; }
.evo-queue-steer { color: var(--brand); }
.evo-queue-steer:hover { background: color-mix(in srgb, var(--brand) 14%, transparent); color: var(--brand); }
.evo-composer-stop { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border: 1px solid color-mix(in srgb, var(--color-error) 40%, var(--color-border)); border-radius: 7px; background: color-mix(in srgb, var(--color-error) 8%, transparent); color: var(--color-error); cursor: pointer; flex-shrink: 0; }
.evo-composer-stop:hover { background: var(--color-error); color: var(--color-surface); }
.evo-composer-stop svg { width: 12px; height: 12px; }
/* ── HITL 审批条（§21.2）── */
.evo-approval-strip { flex-shrink: 0; display: flex; justify-content: center; padding: 8px 24px 0; }
.evo-approval-list { width: 100%; max-width: var(--chat-max-width); display: flex; flex-direction: column; gap: 8px; }
.evo-approval-card { border: 1px solid color-mix(in srgb, var(--color-warning) 45%, var(--color-border)); border-radius: 12px; background: color-mix(in srgb, var(--color-warning) 7%, var(--color-surface)); padding: 10px 14px; display: flex; flex-direction: column; gap: 8px; }
.evo-approval-head { display: flex; align-items: center; gap: 7px; font-size: 12.5px; font-weight: 600; color: var(--color-warning); }
.evo-approval-head svg { width: 15px; height: 15px; }
.evo-approval-body { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.evo-approval-tool { font-family: ui-monospace, Consolas, monospace; font-size: 13px; color: var(--color-text-primary); background: var(--hover-bg); padding: 3px 10px; border-radius: 7px; }
.evo-approval-callid { font-size: 11px; color: var(--color-text-tertiary); font-family: ui-monospace, Consolas, monospace; }
.evo-approval-reason { font-size: 12.5px; color: var(--color-text-secondary); line-height: 1.6; }
/* ── Ask User 问题卡片（§21.3）── */
.evo-question-card { border: 1px solid color-mix(in srgb, var(--brand) 45%, var(--color-border)); border-radius: 12px; background: color-mix(in srgb, var(--brand) 7%, var(--color-surface)); padding: 10px 14px; display: flex; flex-direction: column; gap: 8px; }
.evo-question-card .evo-approval-head { color: var(--brand); }
.evo-question { display: flex; flex-direction: column; gap: 7px; }
.evo-question-text { font-size: 13px; color: var(--color-text-primary); line-height: 1.6; }
.evo-question-opts { display: flex; flex-wrap: wrap; gap: 6px; }
.evo-question-opt { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--color-border); border-radius: 8px; background: var(--color-surface); color: var(--color-text-secondary); font-size: 12.5px; padding: 4px 12px; cursor: pointer; }
.evo-question-opt:hover { border-color: var(--brand); color: var(--color-text-primary); }
.evo-question-opt[data-on] { border-color: var(--brand); background: color-mix(in srgb, var(--brand) 12%, var(--color-surface)); color: var(--brand); font-weight: 600; }
.evo-question-check { width: 13px; height: 13px; border-radius: 4px; border: 1px solid var(--brand); display: inline-flex; align-items: center; justify-content: center; font-size: 10px; }
.evo-question-custom { width: 100%; padding: 5px 10px; border: 1px solid var(--color-border); border-radius: 8px; background: var(--color-surface); color: var(--color-text-primary); font-size: 12.5px; outline: none; }
.evo-question-custom:focus { border-color: var(--brand); }
.evo-question-submit { display: flex; justify-content: flex-end; }
.evo-question-acts { display: flex; justify-content: flex-end; }
.evo-approval-acts { display: flex; gap: 8px; }
/* ── Dynamic Workflow 条（§24）── */
.evo-wf-strip { flex-shrink: 0; display: flex; justify-content: center; padding: 8px 24px 0; }
.evo-wf-bar { width: 100%; max-width: var(--chat-max-width); display: flex; align-items: center; gap: 8px; padding: 7px 12px; border: 1px solid var(--color-border); border-radius: 10px; background: var(--color-surface); }
.evo-wf-bar > svg { width: 15px; height: 15px; color: var(--brand); flex-shrink: 0; }
.evo-wf-name { font-size: 12.5px; font-weight: 600; color: var(--color-text-primary); flex-shrink: 0; }
.evo-wf-members { display: flex; gap: 5px; flex-wrap: wrap; flex: 1; min-width: 0; }
.evo-wf-member { font-size: 11px; padding: 2px 8px; border-radius: 999px; background: var(--hover-bg); color: var(--color-text-tertiary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 140px; }
.evo-wf-member.running { background: color-mix(in srgb, var(--brand) 14%, transparent); color: var(--brand); }
.evo-wf-member.done { background: color-mix(in srgb, var(--color-success) 14%, transparent); color: var(--color-success); }
.evo-wf-member.failed { background: color-mix(in srgb, var(--color-error) 14%, transparent); color: var(--color-error); }
.evo-wf-count { font-size: 11px; font-weight: 600; color: var(--color-text-secondary); flex-shrink: 0; }
.evo-wf-duration { font-size: 11px; color: var(--color-text-tertiary); font-variant-numeric: tabular-nums; flex-shrink: 0; }
.evo-wf-status { font-size: 11px; color: var(--color-warning); flex-shrink: 0; }
.evo-wf-clear { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border: none; background: none; color: var(--color-text-tertiary); border-radius: 6px; cursor: pointer; flex-shrink: 0; }
.evo-wf-clear:hover { color: var(--color-error); background: var(--hover-bg); }
.evo-wf-clear svg { width: 13px; height: 13px; }
/* ── 后台任务（§21.6）── */
.evo-job-row { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border: 1px solid var(--color-border-light); border-radius: 8px; background: var(--color-background); }
.evo-job-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--color-border); flex-shrink: 0; }
.evo-job-dot.running { background: var(--brand); box-shadow: 0 0 0 3px color-mix(in srgb, var(--brand) 20%, transparent); }
.evo-job-dot.done { background: var(--color-success); }
.evo-job-dot.failed { background: var(--color-error); }
.evo-job-dot.killed { background: var(--color-text-tertiary); }
.evo-job-kind { font-size: 11px; font-weight: 600; color: var(--brand); font-family: ui-monospace, Consolas, monospace; flex-shrink: 0; }
.evo-job-label { flex: 1; min-width: 0; font-size: 12.5px; color: var(--color-text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.evo-job-detail { font-size: 11px; color: var(--color-text-tertiary); max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex-shrink: 0; }
.evo-job-status { font-size: 11px; color: var(--color-text-tertiary); flex-shrink: 0; }
.evo-job-duration { font-size: 11px; color: var(--color-text-tertiary); font-variant-numeric: tabular-nums; flex-shrink: 0; }
/* ── 命令执行结果条（§23.3）── */
.evo-cmd-strip { flex-shrink: 0; display: flex; justify-content: center; padding: 8px 24px 0; }
.evo-cmd-card { width: 100%; max-width: var(--chat-max-width); display: flex; align-items: flex-start; gap: 8px; padding: 9px 12px; border: 1px solid var(--color-border); border-radius: 10px; background: var(--color-surface); }
.evo-cmd-card.error { border-color: color-mix(in srgb, var(--color-error) 40%, var(--color-border)); }
.evo-cmd-card > svg { width: 15px; height: 15px; color: var(--brand); flex-shrink: 0; margin-top: 1px; }
.evo-cmd-card.error > svg { color: var(--color-error); }
.evo-cmd-line { font-family: ui-monospace, Consolas, monospace; font-size: 12px; color: var(--color-text-primary); flex-shrink: 0; }
.evo-cmd-running { font-size: 12px; color: var(--brand); }
.evo-cmd-output { flex: 1; min-width: 0; margin: 0; font-family: ui-monospace, Consolas, monospace; font-size: 12px; line-height: 1.6; color: var(--color-text-secondary); white-space: pre-wrap; word-break: break-word; max-height: 180px; overflow-y: auto; }
.evo-cmd-output-md { font-family: inherit; font-size: 12.5px; line-height: 1.6; color: var(--color-text-primary); max-height: 220px; }
.evo-cmd-output-md table { border-collapse: collapse; margin: 4px 0; }
.evo-cmd-output-md th, .evo-cmd-output-md td { border: 1px solid var(--color-border); padding: 3px 10px; font-size: 12px; text-align: left; }
.evo-cmd-output-md th { background: var(--hover-bg); font-weight: 600; }
.evo-cmd-dismiss { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border: none; background: none; color: var(--color-text-tertiary); border-radius: 6px; cursor: pointer; flex-shrink: 0; }
.evo-cmd-dismiss:hover { color: var(--color-text-primary); background: var(--hover-bg); }
.evo-cmd-dismiss svg { width: 13px; height: 13px; }
/* ── 标签栏（§5.2：轻量分段导航，接近原生桌面工具栏）── */
.evo-tabwrap { display: flex; flex-direction: column; min-width: 0; min-height: 0; flex: 1; }
.evo-tabbar { display: flex; align-items: center; gap: 2px; padding: 6px 14px; background: color-mix(in srgb, var(--color-background) 94%, var(--color-surface)); border-bottom: 1px solid var(--color-border); flex-shrink: 0; overflow-x: auto; scrollbar-width: thin; position: sticky; top: 0; z-index: 20; }
.evo-tab { display: inline-flex; align-items: center; gap: 6px; max-width: 200px; padding: 5px 10px; border: 1px solid transparent; border-radius: 7px; background: transparent; color: var(--color-text-secondary); font-size: 12.5px; cursor: pointer; user-select: none; white-space: nowrap; transition: background 0.12s ease, color 0.12s ease, box-shadow 0.12s ease; }
.evo-tab:hover { background: var(--hover-bg); color: var(--color-text-primary); }
.evo-tab[data-active] { background: var(--color-surface); border-color: var(--color-border); color: var(--color-text-primary); font-weight: 600; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08); }
.evo-tab-title { overflow: hidden; text-overflow: ellipsis; }
.evo-tab-close { display: inline-flex; align-items: center; justify-content: center; width: 17px; height: 17px; border: none; background: none; color: currentColor; border-radius: 5px; cursor: pointer; padding: 0; flex-shrink: 0; opacity: 0.65; }
.evo-tab-close:hover { background: rgba(255, 255, 255, 0.22); opacity: 1; }
.evo-tab-close svg { width: 11px; height: 11px; }
.evo-tab-new-wrap { position: relative; display: inline-flex; align-items: center; margin-left: 2px; }
.evo-tab-new { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; border: 1px solid transparent; border-radius: 8px; background: transparent; color: var(--color-text-tertiary); cursor: pointer; flex-shrink: 0; transition: background 0.12s ease, color 0.12s ease; }
.evo-tab-new:hover:not(:disabled) { background: var(--hover-bg); color: var(--brand); }
.evo-tab-new:disabled { opacity: 0.45; cursor: not-allowed; }
.evo-tab-new svg { width: 14px; height: 14px; }
/* + 菜单：fixed 定位（坐标由 JS 按「+」按钮实时计算），脱离 tabbar 的 overflow 裁剪 */
.evo-tab-menu { position: fixed; top: 32px; left: 0; z-index: 90; min-width: 260px; max-width: 340px; padding: 6px; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 10px; box-shadow: 0 8px 28px rgba(0, 0, 0, 0.14); display: flex; flex-direction: column; gap: 4px; }
.evo-tab-menu-item { display: flex; align-items: center; gap: 8px; padding: 7px 10px; border: none; background: none; border-radius: 7px; color: var(--color-text-primary); font-size: 12.5px; cursor: pointer; text-align: left; }
.evo-tab-menu-item:hover:not(:disabled) { background: var(--hover-bg); }
.evo-tab-menu-item:disabled { opacity: 0.45; cursor: not-allowed; }
.evo-tab-menu-item svg { width: 14px; height: 14px; color: var(--brand); flex-shrink: 0; }
.evo-tab-menu-hint { padding: 4px 10px 6px; font-size: 11.5px; color: var(--color-text-tertiary); line-height: 1.5; border-top: 1px solid var(--color-border-light); margin-top: 2px; }
.evo-tab-menu-help { border-top: 0; margin: -2px 0 2px; padding-top: 0; }
.evo-tab-menu-newfile { gap: 6px; }
.evo-tab-newfile-input { flex: 1; min-width: 0; border: 1px solid var(--color-border); border-radius: 7px; background: var(--input-bg); color: var(--color-text-primary); font-size: 12.5px; padding: 5px 8px; outline: none; }
.evo-tab-newfile-input:focus { border-color: var(--brand); }
.evo-tab-newfile-go { display: inline-flex; align-items: center; border: 1px solid var(--brand); background: var(--brand-solid); color: var(--brand-foreground); border-radius: 7px; padding: 5px 10px; font-size: 12px; cursor: pointer; flex-shrink: 0; }
.evo-tab-newfile-go:disabled { opacity: 0.5; cursor: not-allowed; }
/* 「从工作区打开」目录树（内嵌 + 菜单） */
.evo-tab-tree { border-top: 1px solid var(--color-border-light); padding: 6px 2px; display: flex; flex-direction: column; gap: 1px; max-height: 260px; overflow-y: auto; }
.evo-tab-tree-head { display: flex; align-items: center; gap: 6px; padding: 3px 8px 5px; }
.evo-tab-tree-head > svg { width: 13px; height: 13px; color: var(--brand); flex-shrink: 0; }
.evo-tab-tree-root { font-size: 11px; color: var(--color-text-tertiary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; font-family: ui-monospace, Consolas, monospace; }
.evo-tab-tree-refresh { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; border: none; background: none; color: var(--color-text-tertiary); border-radius: 5px; cursor: pointer; flex-shrink: 0; }
.evo-tab-tree-refresh:hover { background: var(--hover-bg); color: var(--color-text-primary); }
.evo-tab-tree-refresh svg { width: 12px; height: 12px; }
.evo-tab-tree-row { display: flex; align-items: center; gap: 6px; width: 100%; border: none; background: none; border-radius: 6px; padding: 4px 8px; font-size: 12.5px; color: var(--color-text-primary); cursor: pointer; text-align: left; min-width: 0; }
.evo-tab-tree-row:hover { background: var(--hover-bg); }
.evo-tab-tree-row > svg { width: 13px; height: 13px; color: var(--color-text-tertiary); flex-shrink: 0; }
.evo-tab-tree-row > svg:first-child { color: var(--color-text-tertiary); }
.evo-tab-tree-arrow { width: 13px; flex-shrink: 0; }
.evo-tab-tree-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.evo-tab-tree-empty { font-size: 11.5px; color: var(--color-text-tertiary); padding: 4px 0; }
.evo-tab-tree-error { font-size: 11.5px; color: var(--color-error); padding: 4px 8px; }
.evo-tab-body { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.evo-tab-frame { flex: 1; width: 100%; border: none; background: #ffffff; }
.evo-tab-editor-body { gap: 0; }
.evo-tab-editor-head { display: flex; align-items: center; gap: 10px; padding: 8px 14px; border-bottom: 1px solid var(--color-border); background: var(--color-surface); flex-shrink: 0; }
.evo-tab-editor-path { font-family: ui-monospace, Consolas, monospace; font-size: 12px; color: var(--color-text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.evo-tab-editor { flex: 1; min-height: 0; width: 100%; border: none; outline: none; resize: none; background: var(--color-surface); color: var(--color-text-primary); font-family: ui-monospace, Consolas, 'SF Mono', monospace; font-size: 13px; line-height: 1.65; padding: 14px 18px; tab-size: 2; }
/* ── 实验管理（§5.1）── */
.evo-exp-notice { margin: 8px 0 0; padding: 8px 12px; border-radius: 8px; background: color-mix(in srgb, var(--color-success) 12%, var(--color-surface)); border: 1px solid color-mix(in srgb, var(--color-success) 35%, var(--color-border)); color: var(--color-success); font-size: 12.5px; }
.evo-exp-item { border: 1px solid var(--color-border); border-radius: 10px; margin-bottom: 8px; background: var(--color-surface); }
.evo-exp-item[data-active] { border-color: color-mix(in srgb, var(--brand) 45%, var(--color-border)); }
.evo-exp-item-head { display: flex; align-items: center; gap: 10px; width: 100%; padding: 10px 12px; border: none; background: none; cursor: pointer; text-align: left; }
.evo-exp-item-head > svg { width: 16px; height: 16px; color: var(--brand); flex-shrink: 0; }
.evo-exp-item-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.evo-exp-item-name { font-size: 13px; font-weight: 600; color: var(--color-text-primary); }
.evo-exp-item-sub { font-size: 11.5px; color: var(--color-text-tertiary); }
.evo-exp-detail { border-top: 1px solid var(--color-border-light); padding: 10px 12px; display: flex; flex-direction: column; gap: 10px; }
.evo-exp-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.evo-exp-title { font-size: 14px; font-weight: 700; color: var(--color-text-primary); }
.evo-exp-desc { font-size: 12px; color: var(--color-text-secondary); }
.evo-exp-del { border: none; background: none; cursor: pointer; display: inline-flex; align-items: center; }
.evo-exp-branches { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.evo-exp-branch-label { font-size: 11.5px; color: var(--color-text-tertiary); }
.evo-exp-branch-chip { display: inline-flex; align-items: center; gap: 5px; padding: 3px 10px; border: 1px solid var(--color-border); border-radius: 999px; background: var(--color-surface); color: var(--color-text-secondary); font-size: 12px; cursor: pointer; }
.evo-exp-branch-chip[data-active] { background: color-mix(in srgb, var(--brand) 12%, var(--color-surface)); border-color: var(--brand); color: var(--brand); }
.evo-exp-branch-chip svg { width: 12px; height: 12px; }
.evo-exp-phases { display: flex; flex-direction: column; gap: 6px; }
.evo-exp-phases-head { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--color-text-tertiary); }
.evo-exp-phase { border: 1px solid var(--color-border); border-radius: 9px; overflow: hidden; background: var(--color-surface); }
.evo-exp-phase-head { display: flex; align-items: center; gap: 6px; width: 100%; padding: 8px 10px; border: none; background: none; cursor: pointer; text-align: left; font-size: 12.5px; color: var(--color-text-primary); }
.evo-exp-phase-head > svg { width: 13px; height: 13px; color: var(--color-text-tertiary); flex-shrink: 0; }
.evo-exp-phase-name { font-weight: 600; }
.evo-exp-phase-meta { margin-left: auto; font-size: 11px; color: var(--color-text-tertiary); flex-shrink: 0; }
.evo-exp-phase-body { border-top: 1px solid var(--color-border-light); padding: 8px 10px; display: flex; flex-direction: column; gap: 6px; }
.evo-exp-cp { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; padding: 7px 9px; border: 1px solid var(--color-border-light); border-radius: 8px; background: var(--color-background); }
.evo-exp-cp[data-rolled] { border-color: color-mix(in srgb, var(--color-warning) 50%, var(--color-border)); }
.evo-exp-cp-main { display: flex; align-items: flex-start; gap: 8px; min-width: 0; }
.evo-exp-cp-main > svg { width: 14px; height: 14px; color: var(--brand); flex-shrink: 0; margin-top: 1px; }
.evo-exp-cp-info { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.evo-exp-cp-title { display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--color-text-primary); }
.evo-exp-cp-rolled { font-size: 10.5px; color: var(--color-warning); border: 1px solid color-mix(in srgb, var(--color-warning) 45%, var(--color-border)); border-radius: 999px; padding: 0 6px; }
.evo-exp-cp-sub { font-size: 11px; color: var(--color-text-tertiary); }
.evo-exp-cp-note { font-size: 11.5px; color: var(--color-text-secondary); white-space: pre-wrap; word-break: break-word; }
.evo-exp-cp-acts { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
.evo-exp-branch-from { display: inline-flex; align-items: center; }
.evo-exp-cp-form { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.evo-exp-inline { display: inline-flex; align-items: center; gap: 5px; }
.evo-exp-inline-ok, .evo-exp-inline-cancel { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border: 1px solid var(--color-border); border-radius: 6px; background: var(--color-surface); color: var(--color-text-secondary); cursor: pointer; flex-shrink: 0; }
.evo-exp-inline-ok:hover { color: var(--color-success); border-color: var(--color-success); }
.evo-exp-inline-cancel:hover { color: var(--color-error); border-color: var(--color-error); }
.evo-exp-inline-ok:disabled, .evo-exp-inline-cancel:disabled { opacity: 0.5; cursor: not-allowed; }
.evo-exp-inline-ok svg, .evo-exp-inline-cancel svg { width: 13px; height: 13px; }
/* ── 项目环境卡片（§环境管理）── */
.evo-panel-item-wrap { display: flex; flex-direction: column; gap: 6px; align-items: stretch; }
.evo-panel-item-row { display: flex; align-items: center; gap: 8px; min-width: 0; }
.evo-panel-item-row > svg { width: 15px; height: 15px; color: var(--brand); flex-shrink: 0; }
.evo-env-card { border: 1px solid var(--color-border); border-radius: 9px; background: var(--color-surface); overflow: hidden; }
.evo-env-head { display: flex; align-items: center; gap: 8px; width: 100%; padding: 8px 10px; border: none; background: none; cursor: pointer; text-align: left; font-size: 12.5px; color: var(--color-text-primary); }
.evo-env-head > svg { width: 14px; height: 14px; color: var(--brand); flex-shrink: 0; }
.evo-env-state { font-size: 11px; color: var(--color-text-tertiary); }
.evo-env-state.evo-env-ok { color: var(--color-success); font-weight: 600; }
.evo-env-state.evo-env-missing { color: var(--color-warning); }
.evo-env-body { border-top: 1px solid var(--color-border-light); padding: 8px 10px; display: flex; flex-direction: column; gap: 6px; }
.evo-env-pkgs { font-size: 11.5px; color: var(--color-text-secondary); line-height: 1.5; word-break: break-word; }
.evo-env-uvrow { display: flex; align-items: center; gap: 8px; }
.evo-env-uvhint { font-size: 11.5px; color: var(--color-warning); }
/* ── 轨迹面板（§轨迹：DSH Trajectory 复刻，暖纸面风格）── */
.evo-traj { display: flex; flex-direction: column; flex: 1; min-height: 0; background: var(--color-background); }
.evo-traj-toolbar { display: flex; align-items: center; gap: 6px; padding: 8px 14px; border-bottom: 1px solid var(--color-border); flex-shrink: 0; flex-wrap: wrap; }
.evo-traj-toolbar > svg { width: 14px; height: 14px; color: var(--brand); flex-shrink: 0; }
.evo-traj-seg { display: inline-flex; align-items: center; gap: 2px; padding: 2px; border: 1px solid var(--color-border); border-radius: 999px; background: var(--color-surface); flex-shrink: 0; }
.evo-traj-chip { display: inline-flex; align-items: center; padding: 3px 10px; border: none; border-radius: 999px; background: transparent; color: var(--color-text-secondary); font-size: 12px; cursor: pointer; }
.evo-traj-chip:hover { color: var(--color-text-primary); }
.evo-traj-chip[data-on] { background: color-mix(in srgb, var(--brand) 12%, var(--color-surface)); color: var(--brand); font-weight: 600; }
.evo-traj-sep { width: 1px; height: 16px; background: var(--color-border); margin: 0 4px; flex-shrink: 0; }
.evo-traj-totals { font-size: 11px; color: var(--color-text-tertiary); font-variant-numeric: tabular-nums; flex-shrink: 0; }
.evo-traj-search { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border: 1px solid var(--color-border); border-radius: 999px; background: var(--color-surface); flex-shrink: 0; }
.evo-traj-search svg { width: 13px; height: 13px; color: var(--color-text-tertiary); flex-shrink: 0; }
.evo-traj-search-input { width: 140px; border: none; outline: none; background: none; color: var(--color-text-primary); font-size: 12px; }
.evo-traj-body { flex: 1; min-height: 0; overflow-y: auto; padding: 10px 14px 16px; }
.evo-traj-empty { padding: 30px; text-align: center; color: var(--color-text-tertiary); font-size: 13px; }
.evo-traj-turn { border: 1px solid var(--color-border); border-left: 3px solid color-mix(in srgb, var(--brand) 55%, var(--color-border)); border-radius: 10px; margin-bottom: 8px; background: var(--color-surface); overflow: hidden; }
.evo-traj-turn-body { border-top: 1px solid var(--color-border-light); padding: 8px 10px 10px; display: flex; flex-direction: column; gap: 8px; }
/* 时间轴竖线：回合 → 步骤 → 调用 串联 */
.evo-traj-turn-body { position: relative; margin-left: 13px; padding-left: 17px; border-left: 1px solid var(--color-border); }
.evo-traj-quote { display: flex; flex-direction: column; gap: 4px; padding: 8px 12px; border-radius: 9px; background: color-mix(in srgb, var(--brand) 6%, var(--color-background)); }
.evo-traj-quote-head { display: flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 600; color: var(--brand); }
.evo-traj-quote-head svg { width: 12px; height: 12px; }
.evo-traj-step { border-top: 1px solid var(--color-border-light); }
.evo-traj-step-body { border-top: 1px dashed var(--color-border-light); padding: 6px 10px 10px 26px; display: flex; flex-direction: column; gap: 6px; }
.evo-traj-call { border-top: 1px dashed var(--color-border-light); background: color-mix(in srgb, var(--color-background) 55%, transparent); }
.evo-traj-row { display: flex; align-items: center; gap: 7px; padding: 6px 10px; font-size: 12.5px; color: var(--color-text-primary); cursor: pointer; min-width: 0; }
.evo-traj-row:hover { background: var(--hover-bg); }
.evo-traj-row > svg { width: 13px; height: 13px; flex-shrink: 0; color: var(--color-text-tertiary); }
.evo-traj-turn-row > svg:nth-child(2) { color: var(--brand); }
.evo-traj-step-row > svg:nth-child(2) { color: var(--color-warning); }
.evo-traj-call-row > svg:nth-child(2) { color: var(--color-text-secondary); }
.evo-traj-label { font-weight: 600; flex-shrink: 0; }
.evo-traj-usertext, .evo-traj-steptext { color: var(--color-text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; flex: 0 1 auto; max-width: 34%; }
.evo-traj-args { color: var(--color-text-tertiary); font-family: ui-monospace, Consolas, monospace; font-size: 11.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 30%; min-width: 0; }
.evo-traj-tokens { flex-shrink: 0; font-size: 11px; color: var(--brand); background: color-mix(in srgb, var(--brand) 10%, transparent); border-radius: 999px; padding: 1px 8px; font-variant-numeric: tabular-nums; }
.evo-traj-bar { flex: 1; min-width: 30px; height: 5px; background: var(--hover-bg); border-radius: 999px; overflow: hidden; flex-shrink: 0; }
.evo-traj-bar-fill { display: block; height: 100%; background: color-mix(in srgb, var(--brand) 55%, var(--color-border)); border-radius: 999px; }
.evo-traj-dur { flex-shrink: 0; font-size: 11px; color: var(--color-text-tertiary); font-variant-numeric: tabular-nums; min-width: 52px; text-align: right; }
.evo-traj-dur.slow { color: var(--brand); font-weight: 700; }
.evo-traj-status { flex-shrink: 0; display: inline-flex; }
.evo-traj-status svg { width: 13px; height: 13px; color: var(--color-success); }
.evo-traj-status.error svg { color: var(--color-error); }
.evo-traj-call-detail { padding: 2px 12px 10px 30px; display: flex; flex-direction: column; gap: 4px; }
.evo-traj-detail { display: flex; flex-direction: column; gap: 4px; }
.evo-traj-detail-head { display: flex; align-items: center; gap: 8px; font-size: 11px; color: var(--color-text-tertiary); font-weight: 600; margin-top: 4px; }
.evo-traj-goto { display: inline-flex; align-items: center; gap: 4px; border: none; background: none; color: var(--brand); font-size: 11px; font-weight: 600; cursor: pointer; padding: 2px 6px; border-radius: 6px; }
.evo-traj-goto:hover { background: var(--hover-bg); }
.evo-traj-goto svg { width: 12px; height: 12px; }
.evo-traj-meta { font-size: 11px; color: var(--color-text-tertiary); font-variant-numeric: tabular-nums; }
.evo-traj-detail-pre { margin: 0; padding: 8px 10px; background: var(--color-background); border: 1px solid var(--color-border-light); border-radius: 8px; font-family: ui-monospace, Consolas, monospace; font-size: 11.5px; line-height: 1.55; white-space: pre-wrap; word-break: break-word; color: var(--color-text-secondary); max-height: 240px; overflow-y: auto; }
.evo-traj-detail-pre.error { color: var(--color-error); }
/* ── 会话统计栏（紧邻输入框、小字号）── */
.evo-statusbar { flex-shrink: 0; height: 20px; display: flex; align-items: center; justify-content: center; gap: 14px; padding: 0 16px; border-top: 1px solid var(--color-border); background: var(--color-background); font-size: 11px; color: var(--color-text-tertiary); font-variant-numeric: tabular-nums; overflow: hidden; white-space: nowrap; }
.evo-statusbar-empty { color: var(--color-text-tertiary); opacity: 0.55; }
.evo-statusbar-item { display: inline-flex; align-items: center; gap: 4px; }
.evo-statusbar-item b { font-weight: 600; color: var(--color-text-secondary); }
.evo-statusbar-label { color: var(--color-text-tertiary); }
.evo-statusbar-sep { opacity: 0.5; margin: 0 1px; }
/* ── 研究笔记面板（NOTE-UI：列表 / 阅读分页 / 草稿 / 背景资料）── */
.evo-note-toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.evo-note-search { flex: 1; min-width: 160px; padding: 7px 12px; border: 1px solid var(--color-border); border-radius: 9px; background: var(--color-surface); color: var(--color-text-primary); font-size: 13px; outline: none; }
.evo-note-search:focus { border-color: var(--brand); }
.evo-note-card { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; border: 1px solid var(--color-border-light); border-radius: 10px; background: var(--color-surface); cursor: pointer; text-align: left; font: inherit; width: 100%; transition: border-color 0.12s; }
.evo-note-card:hover { border-color: color-mix(in srgb, var(--brand) 45%, var(--color-border)); }
.evo-note-card-head { display: flex; align-items: center; gap: 8px; min-width: 0; }
.evo-note-card-title { flex: 1; font-size: 13.5px; font-weight: 600; color: var(--color-text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.evo-note-badge { padding: 1px 8px; border-radius: 999px; font-size: 10.5px; flex-shrink: 0; white-space: nowrap; }
.evo-note-badge.note { background: color-mix(in srgb, var(--brand) 14%, transparent); color: var(--brand); }
.evo-note-badge.legacy { background: color-mix(in srgb, var(--color-warning) 14%, transparent); color: var(--color-warning); }
.evo-note-badge.fm { background: var(--hover-bg); color: var(--color-text-tertiary); }
.evo-note-card-preview { font-size: 12.5px; color: var(--color-text-secondary); line-height: 1.5; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.evo-note-card-meta { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--color-text-tertiary); flex-wrap: wrap; }
.evo-note-detail { display: flex; flex-direction: column; gap: 10px; }
.evo-note-detail-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.evo-note-detail-title { font-size: 15px; font-weight: 700; color: var(--color-text-primary); min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.evo-note-detail-acts { display: flex; align-items: center; gap: 4px; margin-left: auto; flex-shrink: 0; }
.evo-note-body { padding: 12px 14px; border: 1px solid var(--color-border-light); border-radius: 10px; background: var(--color-surface); }
.evo-note-fm { border: 1px dashed var(--color-border); border-radius: 8px; padding: 8px 10px; font-size: 12px; color: var(--color-text-tertiary); background: var(--color-background); }
.evo-note-fm-toggle { border: none; background: none; color: var(--brand); font-size: 12px; cursor: pointer; padding: 0; font: inherit; }
.evo-note-fm-grid { display: grid; grid-template-columns: max-content 1fr; gap: 2px 14px; margin-top: 6px; word-break: break-word; }
.evo-note-fm-key { font-family: ui-monospace, Consolas, monospace; color: var(--color-text-secondary); }
.evo-note-pager { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.evo-note-pager-info { font-size: 11.5px; color: var(--color-text-tertiary); }
.evo-note-editor { display: flex; flex-direction: column; gap: 8px; }
.evo-note-textarea { width: 100%; min-height: 220px; max-height: 60vh; resize: vertical; padding: 9px 11px; border: 1px solid var(--color-border); border-radius: 8px; background: var(--color-background); color: var(--color-text-primary); font-size: 13px; line-height: 1.55; font-family: ui-monospace, Consolas, monospace; outline: none; }
.evo-note-textarea:focus { border-color: var(--brand); box-shadow: 0 0 0 2px color-mix(in srgb, var(--brand) 12%, transparent); }
.evo-note-textarea-sm { min-height: 120px; }
.evo-note-hit { display: flex; align-items: flex-start; gap: 8px; padding: 7px 10px; border: 1px solid var(--color-border-light); border-radius: 8px; background: var(--color-background); cursor: pointer; text-align: left; font: inherit; width: 100%; transition: border-color 0.12s; }
.evo-note-hit:hover { border-color: color-mix(in srgb, var(--brand) 45%, var(--color-border)); }
.evo-note-hit-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.evo-note-hit-title { display: flex; align-items: center; gap: 8px; font-size: 12.5px; font-weight: 600; color: var(--color-text-primary); }
.evo-note-hit-snippet { font-size: 12px; color: var(--color-text-secondary); line-height: 1.5; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.evo-note-hit-meta { font-size: 11px; color: var(--color-text-tertiary); }
.evo-note-draft { border: 1px solid var(--color-border); border-radius: 10px; background: var(--color-surface); display: flex; flex-direction: column; overflow: hidden; }
.evo-note-draft-head { display: flex; align-items: center; gap: 8px; padding: 9px 12px; }
.evo-note-draft-target { font-size: 12.5px; font-weight: 600; color: var(--color-text-primary); font-family: ui-monospace, Consolas, monospace; }
.evo-note-draft-note { font-size: 11.5px; color: var(--color-text-secondary); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.evo-note-draft-body { border-top: 1px solid var(--color-border-light); padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
.evo-note-draft-text { max-height: 40vh; overflow: auto; font-size: 12.5px; line-height: 1.55; white-space: pre-wrap; word-break: break-word; color: var(--color-text-secondary); background: var(--color-background); border: 1px solid var(--color-border-light); border-radius: 8px; padding: 8px 10px; }
.evo-note-draft-acts { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.evo-note-conflict { padding: 7px 10px; border: 1px solid color-mix(in srgb, var(--color-error) 50%, var(--color-border)); background: color-mix(in srgb, var(--color-error) 10%, var(--color-surface)); color: var(--color-error); border-radius: 8px; font-size: 12px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.evo-note-doc { border: 1px solid var(--color-border-light); border-radius: 10px; background: var(--color-surface); padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
.evo-note-doc-head { display: flex; align-items: center; gap: 8px; }
.evo-note-doc-name { font-size: 13px; font-weight: 600; color: var(--color-text-primary); font-family: ui-monospace, Consolas, monospace; }
.evo-note-doc-acts { margin-left: auto; display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
.evo-note-doc-body { max-height: 45vh; overflow: auto; }
.evo-note-doc-missing { font-size: 12px; color: var(--color-text-tertiary); }
/* ── 文献与稿件面板（LIB-UI） ── */
.evo-lib-badge { padding: 1px 8px; border-radius: 999px; font-size: 10.5px; flex-shrink: 0; white-space: nowrap; background: var(--hover-bg); color: var(--color-text-tertiary); }
.evo-lib-badge.ok { background: color-mix(in srgb, var(--brand) 14%, transparent); color: var(--brand); }
.evo-lib-badge.no { background: color-mix(in srgb, var(--color-warning) 14%, transparent); color: var(--color-warning); }
.evo-lib-badge.fail { background: color-mix(in srgb, var(--color-error) 14%, transparent); color: var(--color-error); }
.evo-lib-badge.miss { background: color-mix(in srgb, var(--color-error) 10%, transparent); color: var(--color-error); }
.evo-lib-fields { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; font-size: 12px; color: var(--color-text-secondary); }
.evo-lib-check { display: inline-flex; align-items: center; gap: 4px; cursor: pointer; font-size: 12px; color: var(--color-text-secondary); }
.evo-lib-check input { accent-color: var(--brand); }
.evo-lib-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.evo-lib-path { flex: 1; min-width: 160px; }
.evo-lib-num { width: 84px; }
.evo-lib-scan { flex: 1; min-width: 160px; }
.evo-lib-pagetext { display: flex; flex-direction: column; gap: 6px; }
.evo-lib-log { max-height: 45vh; overflow: auto; white-space: pre-wrap; word-break: break-word; font-size: 12px; line-height: 1.5; font-family: ui-monospace, Consolas, monospace; background: var(--color-background); border: 1px solid var(--color-border-light); border-radius: 8px; padding: 8px 10px; color: var(--color-text-secondary); }
.evo-lib-list { display: flex; flex-direction: column; gap: 6px; }
.evo-lib-block { display: flex; flex-direction: column; gap: 8px; border: 1px solid var(--color-border-light); border-radius: 10px; background: var(--color-surface); padding: 10px 12px; }
.evo-lib-tree { display: flex; flex-direction: column; gap: 2px; max-height: 30vh; overflow: auto; }
.evo-lib-file { display: flex; align-items: center; gap: 6px; padding: 4px 8px; border: none; background: none; border-radius: 6px; color: var(--color-text-secondary); font-size: 12.5px; cursor: pointer; text-align: left; font-family: ui-monospace, Consolas, monospace; }
.evo-lib-file:hover { background: var(--hover-bg); color: var(--color-text-primary); }
.evo-lib-file[data-active] { background: var(--hover-bg); color: var(--brand); }
.evo-lib-file svg { width: 13px; height: 13px; flex-shrink: 0; }
.evo-lib-err { font-size: 12px; color: var(--color-error); font-family: ui-monospace, Consolas, monospace; padding: 4px 8px; background: color-mix(in srgb, var(--color-error) 8%, transparent); border-radius: 6px; }
.evo-lib-project { max-width: 220px; padding: 3px 8px; border: 1px solid var(--color-border); border-radius: 6px; background: var(--color-background); color: var(--color-text-primary); font-size: 12px; margin-left: auto; }
/* ── 实验工作区面板（EXP-UI：Tab 切换 / 笔记 / 运行 / 日志 / 复盘 / 产物）── */
.evo-ews-tabs { display: flex; gap: 4px; padding-bottom: 12px; border-bottom: 1px solid var(--color-border); margin-bottom: 14px; }
.evo-ews-tab { display: inline-flex; align-items: center; gap: 6px; padding: 6px 14px; border: none; border-radius: 8px; background: transparent; color: var(--color-text-secondary); font-size: 13px; font-weight: 600; cursor: pointer; font: inherit; }
.evo-ews-tab:hover { background: var(--hover-bg); color: var(--color-text-primary); }
.evo-ews-tab[data-active] { background: color-mix(in srgb, var(--brand) 12%, var(--color-surface)); color: var(--brand); }
.evo-ews-tab svg { width: 14px; height: 14px; }
.evo-ews-section { border: 1px solid var(--color-border-light); border-radius: 10px; background: var(--color-surface); padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
.evo-ews-section-head { display: flex; align-items: center; gap: 8px; font-size: 12.5px; font-weight: 600; color: var(--color-text-secondary); flex-wrap: wrap; }
.evo-ews-section-head > svg { width: 14px; height: 14px; color: var(--brand); flex-shrink: 0; }
.evo-ews-section-head > span { flex: 1; }
.evo-ews-note-view { font-size: 12.5px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; color: var(--color-text-secondary); background: var(--color-background); border: 1px solid var(--color-border-light); border-radius: 8px; padding: 8px 10px; max-height: 300px; overflow-y: auto; }
.evo-ews-run-form { display: flex; flex-direction: column; gap: 6px; }
.evo-ews-status-badge { display: inline-flex; align-items: center; gap: 6px; padding: 2px 10px; border-radius: 999px; font-size: 11.5px; font-weight: 600; flex-shrink: 0; }
.evo-ews-status-badge[data-status='running'] { background: color-mix(in srgb, var(--brand) 14%, transparent); color: var(--brand); }
.evo-ews-status-badge[data-status='success'] { background: color-mix(in srgb, var(--color-success) 14%, transparent); color: var(--color-success); }
.evo-ews-status-badge[data-status='failed'] { background: color-mix(in srgb, var(--color-error) 14%, transparent); color: var(--color-error); }
.evo-ews-status-badge[data-status='user-stopped'], .evo-ews-status-badge[data-status='unknown'] { background: var(--hover-bg); color: var(--color-text-secondary); }
.evo-ews-run-meta { font-family: ui-monospace, Consolas, monospace; font-size: 11px; color: var(--color-text-tertiary); word-break: break-all; }
.evo-ews-log-view { background: var(--color-background); border: 1px solid var(--color-border-light); border-radius: 8px; font-family: ui-monospace, Consolas, monospace; font-size: 11.5px; line-height: 1.5; color: var(--color-text-secondary); white-space: pre-wrap; word-break: break-word; max-height: 280px; overflow-y: auto; padding: 8px 10px; }
.evo-ews-log-acts { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.evo-ews-check { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--color-text-secondary); cursor: pointer; }
.evo-ews-check input { accent-color: var(--brand); }
.evo-ews-tree { display: flex; flex-direction: column; gap: 1px; font-size: 12px; max-height: 320px; overflow-y: auto; }
.evo-ews-tree-row { display: flex; align-items: center; gap: 6px; padding: 2px 4px; border-radius: 6px; color: var(--color-text-secondary); min-width: 0; }
.evo-ews-tree-row:hover { background: var(--hover-bg); }
.evo-ews-tree-row > svg { width: 13px; height: 13px; flex-shrink: 0; color: var(--color-text-tertiary); }
.evo-ews-tree-row[data-dir] > svg { color: var(--brand); }
.evo-ews-tree-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.evo-ews-tree-size { margin-left: auto; font-size: 10.5px; color: var(--color-text-tertiary); flex-shrink: 0; }
.evo-ews-tree-children { padding-left: 16px; display: flex; flex-direction: column; gap: 1px; }
.evo-ews-retro { max-height: 40vh; overflow: auto; font-size: 12px; line-height: 1.55; white-space: pre-wrap; word-break: break-word; color: var(--color-text-secondary); background: var(--color-background); border: 1px solid var(--color-border-light); border-radius: 8px; padding: 8px 10px; }
.evo-ews-item-sub { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 11.5px; color: var(--color-text-tertiary); }
.evo-ews-badge { padding: 1px 8px; border-radius: 999px; font-size: 10.5px; background: var(--hover-bg); color: var(--color-text-secondary); flex-shrink: 0; white-space: nowrap; }
.evo-ews-badge.ref { background: color-mix(in srgb, var(--color-warning) 14%, transparent); color: var(--color-warning); }
.evo-ews-badge.copy { background: color-mix(in srgb, var(--brand) 14%, transparent); color: var(--brand); }
/* ── Toast UI WYSIWYG composer ── */
.evo-composer-editor { position: relative; flex: 0 0 auto; min-height: 112px; height: 112px; overflow: hidden; }
.evo-composer-editor-host { height: 100%; min-height: 0; overflow: hidden; }
.evo-composer-placeholder { position: absolute; top: 10px; left: 14px; right: 14px; color: var(--color-text-placeholder); font: inherit; font-size: 14.5px; line-height: 1.55; pointer-events: none; user-select: none; white-space: pre-wrap; }
.evo-composer-editor[data-markdown-toolbar-open] .evo-composer-placeholder { top: 46px; }
.evo-composer-editor .toastui-editor-defaultUI { height: 100% !important; min-height: 0 !important; border: 0; border-radius: 0; background: transparent; color: var(--color-text-primary); font-family: inherit; }
.evo-composer-editor .toastui-editor-toolbar { display: flex; height: 0; min-height: 0; padding: 0; border: 0; background: transparent; overflow: hidden; visibility: hidden; }
.evo-composer-editor[data-markdown-toolbar-open] .toastui-editor-toolbar { height: 36px; min-height: 36px; visibility: visible; }
.evo-composer-editor .toastui-editor-defaultUI-toolbar { display: flex; width: 100%; height: 36px; min-height: 36px; box-sizing: border-box; padding: 4px 10px; border: 0; background: transparent; }
.evo-composer-editor .toastui-editor-toolbar-group { display: flex; flex: 0 0 auto; height: 28px; margin: 0 3px 0 0; border-right-color: var(--color-border-light); }
.evo-composer-editor .toastui-editor-toolbar .more { display: none; }
.evo-composer-editor .toastui-editor-toolbar button { width: 28px; height: 28px; border: 1px solid transparent; border-radius: 7px; background-color: transparent; color: var(--color-text-secondary); }
.evo-composer-editor .toastui-editor-toolbar button:not(:disabled):hover { background-color: var(--hover-bg); }
.evo-composer-editor .toastui-editor-toolbar-icons { opacity: .72; }
.evo-composer-editor .toastui-editor-toolbar button.active { background-color: color-mix(in srgb, var(--brand) 14%, transparent); }
.evo-composer-editor .toastui-editor-toolbar button.active .toastui-editor-toolbar-icons { opacity: 1; }
.evo-composer-editor .toastui-editor-main { min-height: 0; height: 100%; background: transparent; }
.evo-composer-editor .toastui-editor-main-container { height: 100% !important; }
.evo-composer-editor .toastui-editor-ww-container { height: 100% !important; background: transparent; }
.evo-composer-editor .toastui-editor-ww-container > .toastui-editor { height: 100% !important; min-height: 0; }
.evo-composer-editor .toastui-editor-ww-container .toastui-editor-contents { height: 100%; overflow-y: auto; padding: 10px 14px 12px; color: var(--color-text-primary); font-family: inherit; font-size: 14.5px; line-height: 1.55; }
.evo-composer-editor .ProseMirror { color: var(--color-text-primary); }
.evo-composer-editor .toastui-editor-contents p { margin: 0 0 7px; }
.evo-composer-editor .toastui-editor-contents p:last-child { margin-bottom: 0; }
.evo-composer-editor .toastui-editor-contents h1, .evo-composer-editor .toastui-editor-contents h2, .evo-composer-editor .toastui-editor-contents h3 { color: var(--color-text-primary); border-bottom-color: var(--color-border-light); }
.evo-composer-editor .toastui-editor-contents blockquote { border-left-color: var(--brand); color: var(--color-text-secondary); }
.evo-composer-editor .toastui-editor-contents pre { background: var(--hover-bg); border-color: var(--color-border-light); }
.evo-composer-editor .toastui-editor-contents code { background: var(--hover-bg); color: var(--color-text-primary); }
.evo-composer-editor .toastui-editor-contents a { color: var(--brand); }
.evo-composer-markdown-state { display: inline-flex; align-items: center; gap: 5px; color: var(--color-text-tertiary); font-size: 11px; }
.evo-composer-markdown-state::before { content: 'M'; display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; border: 1px solid color-mix(in srgb, var(--brand) 45%, var(--color-border)); border-radius: 5px; color: var(--brand); font-size: 10px; font-weight: 700; }
.evo-composer-markdown-toggle { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; width: 24px; height: 24px; padding: 0; border: 1px solid transparent; border-radius: 7px; background: transparent; color: var(--color-text-tertiary); cursor: pointer; transition: color .15s ease, background-color .15s ease, border-color .15s ease; }
.evo-composer-markdown-toggle svg { width: 14px; height: 14px; }
.evo-composer-markdown-toggle:hover, .evo-composer-markdown-toggle:focus-visible { color: var(--brand); background: var(--hover-bg); border-color: var(--color-border-light); outline: none; }
.evo-composer-markdown-toggle[data-on] { color: var(--brand); background: color-mix(in srgb, var(--brand) 12%, transparent); border-color: color-mix(in srgb, var(--brand) 28%, var(--color-border-light)); }
html.dark .evo-composer-editor .toastui-editor-toolbar-icons { filter: invert(1); }
html.dark .evo-composer-editor .toastui-editor-contents pre { background: color-mix(in srgb, var(--color-background) 72%, white 4%); }
@media (prefers-reduced-motion: reduce) { .evo-composer-editor .toastui-editor-toolbar button { transition: none; } }
@media (max-width: 620px) {
  .evo-composer-editor .toastui-editor-toolbar { padding-inline: 5px; overflow-x: auto; }
  .evo-composer-editor .toastui-editor-defaultUI-toolbar { padding-inline: 5px; }
  .evo-composer-editor .toastui-editor-toolbar-group { margin-right: 1px; }
  .evo-composer-editor .toastui-editor-toolbar button { width: 25px; }
  .evo-composer-markdown-state { display: none; }
  .evo-composer-markdown-toggle { width: 26px; height: 26px; }
}
`
