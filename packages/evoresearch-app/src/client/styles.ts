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
  --color-user-message-bg: #e6f2f5;
  --color-avatar-bg: #efe4db;
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
/* ── 左侧栏 ── */
.evo-tl { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.evo-tl-head { padding: 10px 12px 4px; display: flex; flex-direction: column; gap: 2px; }
.evo-tl-newchat {
  display: flex; align-items: center; gap: 8px; width: 100%; padding: 7px 10px;
  border: none; background: none; border-radius: 8px; color: var(--color-text-primary);
  font-size: 14px; font-weight: 500; cursor: pointer;
}
.evo-tl-newchat:hover { background: var(--hover-bg); }
.evo-tl-newchat svg { width: 18px; height: 18px; color: var(--color-text-secondary); }
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
.evo-tl-fork-error { font-size: 11px; color: var(--color-error); text-align: right; line-height: 1.4; max-width: 70%; }
.evo-tl-row {
  display: flex; align-items: center; gap: 4px; width: 100%; text-align: left; padding: 6px 10px; margin-bottom: 2px;
  border: none; background: none; border-radius: 8px; cursor: default;
}
.evo-tl-row:hover { background: var(--hover-bg); }
.evo-tl-row[data-active] { background: var(--hover-bg); }
.evo-tl-row-title { font-size: 13.5px; color: var(--color-text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.evo-tl-row-sub { font-size: 11.5px; color: var(--color-text-tertiary); margin-top: 1px; }
.evo-tl-empty { padding: 28px 16px; text-align: center; color: var(--color-text-tertiary); font-size: 13px; }
.evo-tl-empty svg { width: 40px; height: 40px; color: var(--color-border); margin-bottom: 8px; }
/* ── 中间聊天区 ── */
.evo-chat { flex: 1; display: flex; flex-direction: column; min-height: 0; overflow-y: auto; }
.evo-welcome { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 24px; }
.evo-welcome h1 { font-size: 30px; font-weight: 700; margin: 0 0 10px; color: var(--color-text-primary); letter-spacing: -.01em; }
.evo-welcome p { margin: 0 0 28px; color: var(--color-text-secondary); font-size: 14.5px; max-width: 520px; }
.evo-suggest { display: flex; gap: 12px; flex-wrap: wrap; justify-content: center; }
.evo-suggest-card {
  padding: 14px 18px; border: 1px solid var(--color-border); border-radius: var(--radius);
  background: var(--color-surface); color: var(--color-text-secondary); font-size: 13px;
  cursor: pointer; transition: border-color .15s;
}
.evo-suggest-card:hover { border-color: var(--brand); color: var(--color-text-primary); }
/* ── 输入面板 ── */
.evo-composer-wrap { flex-shrink: 0; padding: 8px 24px 16px; display: flex; justify-content: center; position: relative; }
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
.evo-composer-textarea { width: 100%; padding: 10px 14px 4px; border: none; outline: none; resize: none; background: none; color: var(--color-text-primary); font-size: 14.5px; font-family: inherit; line-height: 1.55; min-height: 44px; max-height: 220px; }
.evo-composer-textarea::placeholder { color: var(--color-text-tertiary); }
.evo-composer-tools { display: flex; align-items: center; gap: 4px; padding: 6px 8px 8px; }
.evo-composer-tool {
  display: inline-flex; align-items: center; gap: 6px; padding: 6px 9px; border: none; background: none;
  border-radius: 8px; color: var(--color-text-secondary); font-size: 12.5px; cursor: pointer;
}
.evo-composer-tool:hover { background: var(--hover-bg); color: var(--color-text-primary); }
.evo-composer-tool svg { width: 16px; height: 16px; }
.evo-composer-tool[data-on] { color: var(--brand); }
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
.evo-msg-list { flex: 1; overflow-y: auto; padding: 24px 24px 8px; display: flex; flex-direction: column; gap: 18px; max-width: var(--chat-max-width); width: 100%; margin: 0 auto; position: relative; }
.evo-msg-error { padding: 10px 14px; border: 1px solid var(--color-error); border-radius: 10px; color: var(--color-error); font-size: 13px; background: color-mix(in srgb, var(--color-error) 8%, transparent); }
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
.evo-msg-body { min-width: 0; max-width: 78%; display: flex; flex-direction: column; gap: 6px; }
.evo-msg-user-body { min-width: 0; max-width: 78%; }
.evo-msg-bubble { padding: 9px 13px; border-radius: 12px; font-size: 14px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; }
.evo-msg-bubble-user { background: var(--color-user-message-bg); color: var(--color-user-message); border-bottom-right-radius: 4px; }
.evo-msg-bubble-assistant { background: var(--color-surface); border: 1px solid var(--color-border-light); border-bottom-left-radius: 4px; color: var(--color-text-primary); }
.evo-msg-text { white-space: pre-wrap; word-break: break-word; }
.evo-msg-time { font-size: 10.5px; color: var(--color-text-tertiary); margin-top: 3px; text-align: right; }
.evo-msg-cursor { display: inline-block; width: 7px; height: 15px; margin-left: 2px; background: var(--brand); vertical-align: -2px; animation: evo-blink 1s steps(2) infinite; }
@keyframes evo-blink { 50% { opacity: 0; } }
.evo-tool-card { display: flex; align-items: flex-start; gap: 8px; padding: 7px 11px; border: 1px solid var(--color-border); border-radius: 9px; background: var(--color-surface); font-size: 12.5px; color: var(--color-text-secondary); }
.evo-tool-card svg { width: 14px; height: 14px; margin-top: 1px; flex-shrink: 0; color: var(--color-text-tertiary); }
.evo-tool-name { font-weight: 600; color: var(--color-text-primary); font-family: var(--font-mono, ui-monospace, Consolas, monospace); flex-shrink: 0; }
.evo-tool-args { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--color-text-tertiary); font-family: var(--font-mono, ui-monospace, Consolas, monospace); }
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
.evo-modal { width: 560px; max-width: calc(100vw - 48px); max-height: calc(100vh - 96px); background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 14px; box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25); display: flex; flex-direction: column; overflow: hidden; }
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
.evo-composer-status { display: flex; align-items: center; gap: 7px; padding: 8px 14px 0; font-size: 12px; color: var(--color-text-tertiary); flex-wrap: wrap; }
.evo-status-chip { display: inline-flex; align-items: center; gap: 5px; padding: 2px 8px; border-radius: 999px; background: var(--hover-bg); color: var(--color-text-secondary); font-size: 11px; }
.evo-status-model { border: none; cursor: pointer; transition: border-color 0.15s, color 0.15s; }
.evo-status-model:hover { color: var(--brand); box-shadow: 0 0 0 1px var(--brand); }
.evo-status-chip svg { width: 11px; height: 11px; }
.evo-status-goal { color: var(--brand); }
.evo-status-ro { color: var(--color-warning); }
.evo-status-full { color: var(--color-error); }
.evo-stats-line { display: flex; align-items: center; gap: 8px; padding: 6px 14px 9px; font-size: 11px; color: var(--color-text-tertiary); font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.evo-stats-sep { color: var(--color-border); margin-right: 8px; }
/* ── 插件清单 ── */
.evo-plugin-list { display: flex; flex-direction: column; gap: 4px; max-height: 180px; overflow-y: auto; }
.evo-plugin-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 5px 10px; border: 1px solid var(--color-border-light); border-radius: 8px; background: var(--color-surface); }
.evo-plugin-id { font-size: 12px; color: var(--color-text-primary); font-family: ui-monospace, Consolas, monospace; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.evo-plugin-state { font-size: 10.5px; color: var(--color-text-tertiary); flex-shrink: 0; }
.evo-plugin-ok { color: var(--color-success); }
/* ── 消息复制 ── */
.evo-msg-meta { display: flex; align-items: center; gap: 6px; margin-top: 4px; min-height: 22px; }
.evo-msg-copy { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border: none; background: none; color: var(--color-text-tertiary); border-radius: 6px; cursor: pointer; opacity: 0; transition: opacity 0.15s, color 0.15s, background 0.15s; }
.evo-msg-bubble:hover .evo-msg-copy, .evo-msg-copy:focus-visible { opacity: 1; }
.evo-msg-copy:hover { color: var(--color-text-primary); background: var(--hover-bg); }
.evo-msg-copy svg { width: 13px; height: 13px; }
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
/* ── Markdown 排版（移植规范 §31.5）── */
.evo-md { font-size: 14px; line-height: 1.75; word-break: break-word; }
.evo-md > :first-child { margin-top: 0 !important; }
.evo-md > :last-child { margin-bottom: 0 !important; }
.evo-md p { margin: 0 0 16px; white-space: pre-wrap; }
.evo-md h1, .evo-md h2, .evo-md h3, .evo-md h4, .evo-md h5, .evo-md h6 { margin: 24px 0 16px; font-weight: 600; line-height: 1.4; color: var(--color-text-primary); }
.evo-md h1 { font-size: 20px; }
.evo-md h2 { font-size: 18px; }
.evo-md h3 { font-size: 16px; }
.evo-md h4, .evo-md h5, .evo-md h6 { font-size: 14px; }
.evo-md ul, .evo-md ol { margin: 0 0 16px; padding-left: 26px; }
.evo-md li { margin: 4px 0; }
.evo-md li > p { margin: 0; }
.evo-md li::marker { color: var(--color-text-tertiary); }
.evo-md .task-list-item { list-style: none; margin-left: -26px; }
.evo-md .task-list-item-checkbox { margin-right: 8px; vertical-align: -1px; }
.evo-md blockquote { margin: 0 0 16px; padding: 2px 14px; border-left: 3px solid var(--color-border); color: var(--color-text-secondary); }
.evo-md blockquote p { margin: 4px 0; white-space: normal; }
.evo-md code { font-family: Consolas, "Cascadia Code", ui-monospace, monospace; font-size: 12.5px; background: var(--hover-bg); border-radius: 4px; padding: 1px 5px; }
.evo-md pre { margin: 0 0 16px; padding: 12px 14px; background: var(--color-background); border: 1px solid var(--color-border-light); border-radius: 8px; overflow-x: auto; }
.evo-md pre code { background: none; padding: 0; border-radius: 0; font-size: 12.5px; line-height: 1.65; display: block; white-space: pre; }
.evo-md table { margin: 0 0 16px; border-collapse: collapse; width: 100%; font-size: 13px; display: block; overflow-x: auto; }
.evo-md th, .evo-md td { border: 1px solid var(--color-border); padding: 6px 10px; text-align: left; }
.evo-md th { background: var(--hover-bg); font-weight: 600; }
.evo-md tr:nth-child(even) td { background: color-mix(in srgb, var(--hover-bg) 40%, transparent); }
.evo-md hr { border: none; border-top: 1px solid var(--color-border); margin: 24px 0; }
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
.evo-msg-jump { animation: evo-jump-flash 1.6s ease-out; border-radius: 10px; }
@keyframes evo-jump-flash { 0% { background: color-mix(in srgb, var(--brand) 26%, transparent); } 100% { background: transparent; } }
/* ── Recents 操作（§26.3）与 Side Chat（§22.3-22.4）── */
.evo-tl-row { display: flex; align-items: center; gap: 4px; }
.evo-tl-row-main { flex: 1; min-width: 0; text-align: left; border: none; background: none; padding: 0; cursor: pointer; }
.evo-tl-row-acts { display: flex; gap: 2px; opacity: 0; transition: opacity 0.15s; flex-shrink: 0; }
.evo-tl-row:hover .evo-tl-row-acts, .evo-tl-row:focus-within .evo-tl-row-acts { opacity: 1; }
.evo-tl-row-act { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border: none; background: none; color: var(--color-text-tertiary); border-radius: 6px; cursor: pointer; }
.evo-tl-row-act:hover { color: var(--color-text-primary); background: var(--hover-bg); }
.evo-tl-row-act svg { width: 13px; height: 13px; }
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
`
