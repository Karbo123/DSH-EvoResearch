/**
 * EvoResearch 工作台样式 —— 复刻 EvoScientist WebUI 的视觉设计系统
 * （暖色"纸面" + 青色品牌，浅/深双主题）。
 *
 * token 与布局数值取自 WebUI 的 globals.css / tailwind 配置（对照基准）：
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
/* ── 左侧栏（ThreadList 复刻）── */
.evo-tl { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.evo-tl-head { padding: 10px 12px 4px; display: flex; flex-direction: column; gap: 2px; }
.evo-tl-title { display: flex; align-items: center; gap: 10px; padding: 4px 6px 8px; }
.evo-tl-title-name { font-size: 17px; font-weight: 600; flex: 1; white-space: nowrap; overflow: hidden; }
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
.evo-tl-row {
  display: block; width: 100%; text-align: left; padding: 8px 10px; margin-bottom: 2px;
  border: none; background: none; border-radius: 8px; cursor: pointer;
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
.evo-composer-wrap { flex-shrink: 0; padding: 8px 24px 16px; display: flex; justify-content: center; }
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
`
