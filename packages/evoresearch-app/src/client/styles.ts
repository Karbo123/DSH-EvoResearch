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
  --brand: #066679;
  --brand-hover: #054e5b;
  --brand-solid: #066679;
  --brand-foreground: #ffffff;
  --radius: 0.5rem;
  --chat-max-width: 900px;
  --input-bg: #ffffff;
  --hover-bg: #f0ebe1;
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
  --brand: #3b9cb0;
  --brand-hover: #46a9bd;
  --brand-solid: #087d91;
  --brand-foreground: #ffffff;
  --input-bg: #1c1a17;
  --hover-bg: #332f2a;
}
* { box-sizing: border-box; }
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
.evo-center { flex: 1; min-width: 0; display: flex; flex-direction: column; overflow-y: auto; position: relative; }
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
.evo-tl-search { margin: 6px 12px 2px; padding: 6px 10px; display: flex; align-items: center; gap: 8px;
  border: 1px solid var(--color-border); border-radius: 6px; background: var(--input-bg); }
.evo-tl-search svg { width: 15px; height: 15px; color: var(--color-text-tertiary); flex-shrink: 0; }
.evo-tl-search input { flex: 1; border: none; outline: none; background: none; color: var(--color-text-primary); font-size: 13px; }
.evo-tl-search input::placeholder { color: var(--color-text-tertiary); }
.evo-tl-body { flex: 1; overflow-y: auto; padding: 6px 8px 16px; min-height: 0; }
.evo-tl-section { padding: 10px 10px 4px; display: flex; align-items: center; justify-content: space-between; }
.evo-tl-section-title { font-size: 12px; font-weight: 600; color: var(--color-text-secondary); letter-spacing: .2px; }
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
.evo-chat { flex: none; height: auto; display: flex; flex-direction: column; min-height: 0; overflow: visible; }
.evo-welcome { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 24px; min-height: 42vh; }
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
/* ── 欢迎页 Research Dashboard（§31.7）── */
.evo-dashboard { display: flex; gap: 10px; margin-top: 26px; }
.evo-dashboard-card { display: flex; flex-direction: column; align-items: center; gap: 2px; min-width: 96px; padding: 12px 18px; border: 1px solid var(--color-border); border-radius: 14px; background: var(--color-surface); }
.evo-dashboard-value { font-size: 22px; font-weight: 600; color: var(--brand); line-height: 1.1; }
.evo-dashboard-label { font-size: 11.5px; color: var(--color-text-tertiary); }
/* ── 输入面板：sticky 常驻中间栏底部（消息区内容自适应、页面整体滚动）── */
.evo-composer-wrap { flex-shrink: 0; padding: 8px 24px 16px; display: flex; flex-wrap: wrap; justify-content: center; position: sticky; bottom: 0; z-index: 30; background: var(--color-background); }
/* ── 输入候选弹层（§23.2–23.5：斜杠命令 / @文件 / 输入历史）── */
.evo-cand { position: absolute; bottom: calc(100% - 8px); left: 50%; transform: translateX(-50%); width: min(560px, calc(100vw - 96px)); max-height: 280px; overflow-y: auto; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 12px; box-shadow: 0 10px 32px rgba(0, 0, 0, 0.18); z-index: 40; padding: 6px; display: flex; flex-direction: column; gap: 2px; }
.evo-cand-item { display: flex; align-items: center; gap: 10px; padding: 7px 10px; border-radius: 8px; cursor: pointer; }
.evo-cand-item[data-active] { background: var(--hover-bg); }
.evo-cand-item svg { width: 15px; height: 15px; color: var(--brand); flex-shrink: 0; }
.evo-cand-text { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.evo-cand-title { font-size: 13px; color: var(--color-text-primary); font-family: ui-monospace, Consolas, monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.evo-cand-sub { font-size: 11.5px; color: var(--color-text-tertiary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.evo-composer { width: 100%; max-width: var(--chat-max-width); border: 1px solid var(--color-border); border-radius: 14px; background: var(--color-surface); box-shadow: 0 2px 12px rgba(0,0,0,.05); }
.evo-composer-status { display: flex; align-items: center; gap: 7px; padding: 8px 14px 0; font-size: 12px; color: var(--color-text-tertiary); }
.evo-composer-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--color-success); flex-shrink: 0; }
.evo-composer-textarea { width: 100%; padding: 10px 14px 4px; border: none; outline: none; resize: none; background: none; color: transparent; -webkit-text-fill-color: transparent; caret-color: var(--color-text-primary); font-size: 14.5px; font-family: inherit; line-height: 1.55; min-height: 44px; max-height: 220px; position: relative; }
.evo-composer-textarea::placeholder { color: var(--color-text-tertiary); -webkit-text-fill-color: var(--color-text-tertiary); }
.evo-composer-textarea::selection { background: color-mix(in srgb, var(--brand) 30%, transparent); }
/* ── 双层 Markdown 实时编辑器（§composer）：装饰层渲染样式，textarea 透明编辑 ── */
.evo-composer-input { position: relative; flex: 1; display: flex; min-height: 44px; }
.evo-composer-deco { position: absolute; inset: 0; overflow: hidden; padding: 10px 14px 4px; font-size: 14.5px; font-family: inherit; line-height: 1.55; color: var(--color-text-primary); white-space: pre-wrap; word-break: break-word; pointer-events: none; }
.evo-composer-deco[data-empty] { display: none; }
.evod-m { visibility: hidden; }
/* 聚焦输入时：隐藏的语法标记显示极浅背景，辅助定位（失焦自动隐藏，保持干净） */
.evo-composer-input:focus-within .evod-m { visibility: visible; background: color-mix(in srgb, var(--color-text-tertiary) 13%, transparent); border-radius: 2px; }
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
.evo-composer-tools { display: flex; align-items: center; gap: 4px; padding: 6px 8px 8px; }
.evo-composer-tool {
  display: inline-flex; align-items: center; gap: 6px; padding: 6px 9px; border: none; background: none;
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
  display: inline-flex; align-items: center; gap: 7px; padding: 7px 16px; border: none; border-radius: 9px;
  background: var(--brand-solid); color: var(--brand-foreground); font-size: 13px; font-weight: 600; cursor: pointer;
}
.evo-send:hover { background: var(--brand-hover); }
.evo-send:disabled { opacity: .5; cursor: default; }
.evo-send svg { width: 15px; height: 15px; }
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
.evo-msg-bubble { padding: 10px 14px; border-radius: 13px; font-size: 14px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
.evo-msg-bubble-user { background: var(--color-user-message-bg); color: var(--color-user-message); border-bottom-right-radius: 4px; }
.evo-msg-bubble-assistant { background: var(--color-surface); border: 1px solid var(--color-border-light); border-bottom-left-radius: 4px; color: var(--color-text-primary); }
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
/* 输入区顶部拖拽热区：细线手柄（居中 2px 圆角线，hover/拖动变品牌色，不占突兀色块） */
.evo-composer-resize { height: 10px; cursor: ns-resize; border-radius: 12px 12px 0 0; flex-shrink: 0; touch-action: none; display: flex; align-items: center; justify-content: center; position: relative; }
.evo-composer-resize::before { content: ''; width: 44px; height: 2px; border-radius: 999px; background: var(--color-border); transition: background 0.15s ease, width 0.15s ease; }
.evo-composer-resize:hover::before, .evo-composer-resize[data-dragging]::before { background: var(--brand); width: 60px; }
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
/* 会话统计行（输入框圆角框下方外部、水平居中、紧贴）：flex-basis 100% 强制换行，
   max-width 与输入框一致，justify-content 水平居中 */
.evo-composer-stats { flex-basis: 100%; max-width: var(--chat-max-width); margin-top: 4px; }
.evo-composer-stats .evo-stats-line { padding: 2px 4px 0; justify-content: center; }
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
.evo-msg-user .evo-msg-stack { align-items: flex-end; }
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
  radial-gradient(circle, #3a3a42 1.2px, transparent 1.2px) 0 0 / 20px 20px,
  #1b1b1e; }
.evo-graph-svg { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; overflow: visible; }
/* 节点卡片：Blender 节点编辑器风格——类型色标题栏 + 深灰主体 + socket 行（顶部内高光增强浮起感） */
.evo-graph-node { position: absolute; background: linear-gradient(180deg, #2e2e33, #29292d); border: 1px solid #19191d; border-radius: 5px; padding: 0; cursor: grab; user-select: none; box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06), 0 3px 12px rgba(0, 0, 0, 0.4); transition: border-color 0.15s, box-shadow 0.15s; display: flex; flex-direction: column; }
.evo-graph-node:hover { border-color: #4a4a52; box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06), 0 5px 18px rgba(0, 0, 0, 0.45); }
.evo-graph-node-sel { border-color: #e8a33d; box-shadow: 0 0 0 1.5px rgba(232, 163, 61, 0.55), 0 5px 18px rgba(0, 0, 0, 0.42); }
.evo-graph-node-dragging { z-index: 30; cursor: grabbing; box-shadow: 0 0 0 1.5px rgba(232, 163, 61, 0.4), 0 10px 28px rgba(0, 0, 0, 0.5); }
/* 标题栏：类型色渐变（Blender 节点 header 风格） */
.evo-graph-node-titlebar { height: 24px; display: flex; align-items: center; gap: 6px; padding: 0 8px; border-radius: 4px 4px 0 0; flex-shrink: 0; }
.evo-graph-node-chat .evo-graph-node-titlebar { background: linear-gradient(180deg, #2d4a68, #243a52); }
.evo-graph-node-memory .evo-graph-node-titlebar { background: linear-gradient(180deg, #2d5440, #23422f); }
.evo-graph-node-memory[data-global] .evo-graph-node-titlebar { background: linear-gradient(180deg, #4a3d63, #382e4d); }
.evo-graph-node-dot { width: 9px; height: 9px; border-radius: 999px; background: var(--color-text-secondary); flex-shrink: 0; }
.evo-graph-node-chat .evo-graph-node-dot { background: #7fb3e8; }
.evo-graph-node-memory .evo-graph-node-dot { background: #7fd8a0; }
.evo-graph-node-memory[data-global] .evo-graph-node-dot { background: #c39bf0; }
.evo-graph-node-title { font-size: 12px; font-weight: 600; color: #f2f2f2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; flex: 1; }
/* 主体：socket 行 */
.evo-graph-node-body { flex: 1; display: flex; flex-direction: column; gap: 2px; padding: 5px 7px 6px; min-width: 0; }
.evo-graph-socket-row { display: flex; align-items: center; gap: 6px; min-width: 0; }
.evo-graph-socket-row-out { margin-top: 1px; }
/* Blender socket：8px 实心圆 + 亮描边 */
.evo-graph-socket { width: 9px; height: 9px; border-radius: 999px; border: 1.5px solid rgba(255, 255, 255, 0.75); cursor: crosshair; flex-shrink: 0; transition: transform 0.12s, box-shadow 0.12s; box-shadow: 0 0 3px rgba(0, 0, 0, 0.5); }
.evo-graph-socket-ctx { background: #4a90d9; }
.evo-graph-socket-mem { background: #5dbe85; }
.evo-graph-socket-out { background: #c98b3d; }
.evo-graph-socket:hover { transform: scale(1.45); box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.18); }
.evo-graph-socket-label { font-size: 10px; letter-spacing: 0.2px; color: #9d9da3; white-space: nowrap; }
.evo-graph-node-tag { font-size: 9.5px; color: #a8a8ad; background: rgba(255, 255, 255, 0.07); border-radius: 3px; padding: 1px 5px; flex-shrink: 0; }
.evo-graph-node-sid { font-size: 9.5px; color: #7a7a80; font-family: ui-monospace, Consolas, monospace; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.evo-graph-node-preview { font-size: 10px; color: #b8b8bd; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
/* 连线：粗贝塞尔 + 类型色（Blender 风格：线在 socket 处衔接） */
.evo-graph-edge { fill: none; stroke: #6a6a72; stroke-width: 2px; }
.evo-graph-edge-ctx { stroke: #4a90d9; stroke-width: 2.2px; }
.evo-graph-edge-mem { stroke: #5dbe85; stroke-width: 2px; }
.evo-graph-edge-linking { stroke: #e8a33d; stroke-dasharray: 6 4; stroke-width: 2.2px; }
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
/* 记忆节点内容编辑弹窗 */
.evo-graph-editor-mask { position: fixed; inset: 0; z-index: 80; background: rgba(0, 0, 0, 0.35); display: flex; align-items: center; justify-content: center; }
.evo-graph-editor { width: min(520px, calc(100vw - 48px)); background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 12px; box-shadow: 0 12px 36px rgba(0, 0, 0, 0.3); display: flex; flex-direction: column; padding: 12px; gap: 10px; }
.evo-graph-editor-head { display: flex; align-items: center; gap: 8px; }
.evo-graph-editor-title { font-size: 13.5px; font-weight: 600; color: var(--color-text-primary); }
.evo-graph-editor-text { width: 100%; min-height: 140px; max-height: 50vh; resize: vertical; padding: 9px 11px; border: 1px solid var(--color-border); border-radius: 8px; background: var(--color-background); color: var(--color-text-primary); font-size: 13px; line-height: 1.5; font-family: inherit; outline: none; }
.evo-graph-editor-text:focus { border-color: color-mix(in srgb, var(--brand) 45%, var(--color-border)); box-shadow: 0 0 0 2px color-mix(in srgb, var(--brand) 12%, transparent); }
.evo-graph-editor-foot { display: flex; align-items: center; gap: 8px; }
.evo-graph-editor-hint { font-size: 11px; color: var(--color-text-tertiary); }
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
/* ── Markdown 排版（移植规范 §31.5；视觉评审三轮收紧：行高 1.35、段距 4px、标题上疏下密）── */
.evo-md { font-size: 14px; line-height: 1.35; word-break: break-word; }
.evo-md > :first-child { margin-top: 0 !important; }
.evo-md > :last-child { margin-bottom: 0 !important; }
.evo-md p { margin: 0 0 4px; white-space: pre-wrap; }
.evo-md h1, .evo-md h2, .evo-md h3, .evo-md h4, .evo-md h5, .evo-md h6 { margin: 9px 0 4px; font-weight: 600; line-height: 1.3; color: var(--color-text-primary); }
.evo-md h1 { font-size: 19px; margin-top: 14px; }
.evo-md h2 { font-size: 17px; }
.evo-md h3 { font-size: 15px; }
.evo-md h4, .evo-md h5, .evo-md h6 { font-size: 14px; }
.evo-md ul, .evo-md ol { margin: 0 0 6px; padding-left: 22px; }
.evo-md li { margin: 2px 0; }
.evo-md li > p { margin: 0; }
.evo-md li::marker { color: var(--color-text-tertiary); }
.evo-md .task-list-item { list-style: none; margin-left: -22px; }
.evo-md .task-list-item-checkbox { margin-right: 8px; vertical-align: -1px; }
.evo-md blockquote { margin: 0 0 6px; padding: 2px 10px; border-left: 3px solid var(--color-border); color: var(--color-text-secondary); }
.evo-md blockquote p { margin: 1px 0; white-space: normal; }
.evo-md code { font-family: Consolas, "Cascadia Code", ui-monospace, monospace; font-size: 12.5px; background: var(--hover-bg); border-radius: 4px; padding: 1px 4px; }
.evo-md pre { margin: 8px 0; padding: 9px 11px; background: var(--color-background); border: 1px solid var(--color-border-light); border-radius: 8px; overflow-x: auto; }
.evo-md pre code { background: none; padding: 0; border-radius: 0; font-size: 12.5px; line-height: 1.45; display: block; white-space: pre; }
.evo-md table { margin: 0 0 6px; border-collapse: collapse; width: 100%; font-size: 13px; display: block; overflow-x: auto; }
.evo-md th, .evo-md td { border: 1px solid var(--color-border); padding: 4px 8px; text-align: left; }
.evo-md th { background: var(--hover-bg); font-weight: 600; }
.evo-md tr:nth-child(even) td { background: color-mix(in srgb, var(--hover-bg) 40%, transparent); }
.evo-md hr { border: none; border-top: 1px solid var(--color-border); margin: 8px 0; }
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
/* ── 标签栏（§5.2 浏览器式标签；视觉评审后重设计：圆角胶囊 + 品牌选中态）── */
.evo-tabwrap { display: flex; flex-direction: column; min-width: 0; min-height: 0; flex: 1; }
.evo-tabbar { display: flex; align-items: center; gap: 6px; padding: 8px 12px; background: var(--color-background); border-bottom: 1px solid var(--color-border); flex-shrink: 0; overflow-x: auto; scrollbar-width: thin; position: sticky; top: 0; z-index: 20; }
.evo-tab { display: inline-flex; align-items: center; gap: 6px; max-width: 200px; padding: 5px 12px; border: 1px solid transparent; border-radius: 8px; background: transparent; color: var(--color-text-secondary); font-size: 12.5px; cursor: pointer; user-select: none; white-space: nowrap; transition: background 0.12s ease, color 0.12s ease; }
.evo-tab:hover { background: var(--hover-bg); color: var(--color-text-primary); }
.evo-tab[data-active] { background: var(--brand-solid); border-color: var(--brand-solid); color: var(--brand-foreground); font-weight: 600; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.15); }
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
/* ── 底部状态栏（§状态栏：DSH 式，页面最底部、小字号）── */
.evo-statusbar { flex-shrink: 0; height: 20px; display: flex; align-items: center; justify-content: center; gap: 14px; padding: 0 16px; border-top: 1px solid var(--color-border); background: var(--color-background); font-size: 11px; color: var(--color-text-tertiary); font-variant-numeric: tabular-nums; overflow: hidden; white-space: nowrap; }
.evo-statusbar-empty { color: var(--color-text-tertiary); opacity: 0.55; }
.evo-statusbar-item { display: inline-flex; align-items: center; gap: 4px; }
.evo-statusbar-item b { font-weight: 600; color: var(--color-text-secondary); }
.evo-statusbar-label { color: var(--color-text-tertiary); }
.evo-statusbar-sep { opacity: 0.5; margin: 0 1px; }
`
