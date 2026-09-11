/**
 * EvoResearch 工作台样式 —— 设计流派：Natural Organic（自然有机风）
 * 浅/深双主题，大地色系 + 自然纹理 + 手工感形状。方案与验收见 docs/06-natural-organic.md。
 *
 * 三层结构（改样式请按层落位，勿散写色值）：
 * 1. 令牌层 :root / html.dark —— 色盘、形状（含 blob）、字体、动效曲线、纹理、阴影、图谱。
 * 2. 组件层（"组件复用"一节）—— .evo-pop / .evo-btn* / .evo-field / .evo-chip /
 *    .evo-card / .evo-avatar / .evo-dot：同类控件只在这里定义配色与形状，其余规则只写布局。
 * 3. 清扫层 —— 各业务规则，一律引用令牌，禁止硬编码 hex / rgb / 线性渐变 / 正圆 / 直角。
 *
 * 色盘（浅）：底 #faf6f1、面 #fffdf9、Primary 石褐 #5c4033、交互鼠尾草 #5b6d43、
 *              Accent 鼠尾草 #8b9d77 / 暖沙 #d4a373 / 雾 #e9e0d4 / 灰青 #75a191。
 * 色盘（深）：深壤土 #1e1b16、树皮面 #292420、交互浅鼠尾草 #a9bf8e、陶土主按钮 #c08a5e。
 * 布局数值：顶栏 h-14（56px）、聊天最大宽度 900px。
 */

import { FIRA_MONO_400, FIRA_MONO_700 } from './chatgraph-fonts'

export const CSS = `
/* Chat Graph 专用字体：Fira Mono（SIL OFL 1.1，latin 内嵌）——与 reactflow.dev
   仅 --graph-font-mono 作用域内使用。 */
@font-face { font-family: 'Fira Mono'; font-style: normal; font-weight: 400; font-display: block; src: url("${FIRA_MONO_400}") format('woff2'); }
@font-face { font-family: 'Fira Mono'; font-style: normal; font-weight: 700; font-display: block; src: url("${FIRA_MONO_700}") format('woff2'); }
:root {
  color-scheme: light;
  /* ── 色盘（浅）：暖米底 + 石褐/鼠尾草/暖沙/雾/灰青（Natural Organic 给定盘） ── */
  --color-primary: #3b3226;
  --color-user-message: #4d3722;
  --color-user-message-bg: #f2e5d3;  --color-avatar-bg: #e9e0d4;
  --color-secondary: #6b5f50;
  --color-success: #5d7a45;
  --color-warning: #8f6019;
  --color-info: #47776c;
  --color-error: #a4472f;
  --color-background: #faf6f1;
  --color-surface: #fffdf9;
  --color-border: #e2d8c8;
  --color-border-light: #ede4d8;
  --color-text-primary: #3b3226;
  --color-text-secondary: #6b5f50;
  --color-text-tertiary: #786c5c;
  /* placeholder 与三级文字同值：靠字体样式区分层级，不靠降低对比度（保证 AA） */
  --color-text-placeholder: #786c5c;
  /* 强调色：来自风格给定盘；sage/tan/mist/teal 仅作底/圆点/装饰，
     作为文字时用 -ink 深化值（原色在米底上不足 AA） */
  --accent-sage: #8b9d77;
  --accent-tan: #d4a373;
  --accent-mist: #e9e0d4;
  --accent-teal: #75a191;
  --accent-tan-ink: #8a5f2b;
  --accent-teal-ink: #3f6f63;
  /* 交互色 = 鼠尾草深绿（Verdant Tint：hover 向深绿缓慢过渡）；
     主按钮 = 石褐填充（风格 Primary），前景暖米而非纯白 */
  --brand: #5b6d43;
  --brand-hover: #46592f;
  --brand-solid: #5c4033;
  --brand-foreground: #faf6f1;
  --focus-ring: #5b6d43;
  /* ── 形状：有机圆角尺度 + blob（禁止直角/正圆/尖锐小圆角） ── */
  --r-2xs: 6px;
  --r-xs: 10px;
  --r-sm: 12px;
  --r-md: 16px;
  --r-lg: 22px;
  --r-xl: 28px;
  --r-pill: 999px;
  --r-blob: 22px 17px 24px 15px;
  --r-blob-lg: 34px 26px 36px 22px;
  --r-dot: 50% 46% 52% 48% / 48% 52% 46% 54%;
  /* 鹅卵石：按钮/输入/徽标的主形状——四角不等，避免"完美矩形"的工业感 */
  --r-pebble-sm: 10px 8px 11px 9px;
  --r-pebble: 15px 12px 16px 13px;
  /* 气泡：一角收小（对话"叶尖"），其余大圆角 */
  --r-bubble-ai: 6px 20px 20px 20px;
  --r-bubble-user: 20px 6px 20px 20px;
  --radius: 16px;
  /* 遮罩（暖土 scrim，非纯黑）与加深混色基准 */
  /* 桌面自绘标题栏（暖土色，替代原冷灰） */
  --titlebar-bg: #efe6d8;
  --titlebar-border: #e2d8c8;
  --titlebar-fg: #5c4033;
  --titlebar-accent: #c42b1c;
  --scrim: rgb(30 27 22 / 45%);
  --shade: #241a12;
  /* ── 字体：衬线标题 + 人文无衬线正文（风格禁用 Inter/Roboto/Geist） ── */
  --font-sans: 'Avenir Next', 'Segoe UI Variable Text', 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', system-ui, sans-serif;
  --font-serif: 'Iowan Old Style', 'Palatino Linotype', Palatino, 'Source Han Serif SC', 'Noto Serif SC', 'Songti SC', STSong, SimSun, Georgia, serif;
  --font-mono: ui-monospace, 'Cascadia Code', Consolas, 'SF Mono', Menlo, monospace;
  /* ── 动效：Botanical Slowness（自然生长速度 + 有机缓动） ── */
  --ease-organic: cubic-bezier(0.4, 0, 0.2, 1);
  --dur-organic: 480ms;
  --dur-morph: 600ms;
  --dur-quick: 200ms;
  /* ── 阴影：土色低透明（禁纯黑重阴影 shadow-xl 级） ── */
  --shadow-sm: 0 1px 2px rgb(92 64 51 / 6%);
  --shadow-md: 0 6px 18px rgb(92 64 51 / 10%), 0 1px 3px rgb(92 64 51 / 6%);
  --shadow-lg: 0 14px 34px rgb(74 51 39 / 16%), 0 3px 9px rgb(74 51 39 / 8%);
  /* ── 纹理：内联 SVG 纸纹（feTurbulence，浅色 7% / 深色 6% 噪声，平铺 180px，stitchTiles 消接缝）。
     只铺在结构底色（页面底/左右栏/顶栏/输入区），卡片表面保持干净，正文不叠噪声。 ── */
  --organic-grain: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='g'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='180' height='180' filter='url(%23g)' opacity='0.07'/%3E%3C/svg%3E");
  /* 植物小枝（mask 用，颜色由 background-color 给）：空态/面板头/欢迎页的图形签名 —— 
     风格要求"自然/有机/手工"的视觉元素，这枚手绘感枝芽承担该角色（装饰性、aria-hidden）。 */
  --sprig: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Cpath d='M32 60V24' stroke='black' stroke-width='3.4' stroke-linecap='round'/%3E%3Cellipse cx='19' cy='31' rx='11' ry='6' transform='rotate(-30 19 31)' fill='black'/%3E%3Cellipse cx='45' cy='39' rx='11' ry='6' transform='rotate(30 45 39)' fill='black'/%3E%3Cellipse cx='21' cy='48' rx='9' ry='5' transform='rotate(-26 21 48)' fill='black'/%3E%3Ccircle cx='32' cy='15' r='4.6' fill='black'/%3E%3C/svg%3E");
  --chat-max-width: 900px;
  --input-bg: #fffdf9;
  --hover-bg: #efe5d8;
  /* Chat Graph tokens：大地色图谱（原 reactflow 官网白/黑 + 蓝紫语义色已替换为
     黏土/橄榄/灰青/赭石，保持"无冷色主调"）。画布为暖纸面而非纯白；
     光斑按主题着色（浅色鼠尾草、深色暖沙），点阵仍由 xyflow Background 绘制。 */
  --graph-canvas: #fbf7f0;
  --graph-glow-core: rgba(139, 157, 119, 0.22);
  --graph-glow-mid: rgba(212, 163, 115, 0.10);
  --graph-node-surface: #fffdf9;
  --graph-node-surface-alt: #fffdf9;
  --graph-node-border: #e7ded0;
  --graph-node-title: #3b3226;
  --graph-muted: #786c5c;
  --graph-font-mono: 'Fira Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, 'Microsoft YaHei', monospace;
  --graph-node-radius: 20px;
  --graph-card-shadow: 0 7px 9px 0 rgba(92, 64, 51, 0.05);
  --graph-handle: #b9ac97;
  --graph-edge-default: #d8cdbb;
  --graph-chat: #b8693a;
  --graph-memory: #7d9163;
  --graph-global: #5f8b7d;
  --graph-resource: #b58a2b;
  --graph-fork: #b8693a;
  --graph-reference: #7d9163;
  --graph-write: #cc8a55;
  --graph-edge-label: #5b5142;
  --graph-control: #fffdf9;
  --graph-control-border: #e2d8c8;
  --graph-minimap: rgb(255 253 249 / 94%);
  --graph-minimap-group: #5f8b7d;
  --graph-minimap-chat: #b8693a;
  --graph-minimap-resource: #b58a2b;
  --graph-trace: #8f5f2f;
  --graph-candidate: #8a7355;
  --graph-status-missing: #a4472f;
  --graph-status-running: #b58a2b;
  --graph-node-shadow: rgba(92, 64, 51, 0.10);
}
html.dark {
  color-scheme: dark;
  /* ── 色盘（深）：同族推导——深壤土底 + 羊皮纸字；Primary 石褐提亮为陶土承担主按钮，
     Accent 1 鼠尾草提亮为浅绿承担交互色（深底上达 AA）。禁用纯黑与冷色。 ── */
  --color-primary: #f0e9dd;
  --color-user-message: #ecdcc6;
  --color-user-message-bg: #3a2c20;
  --color-avatar-bg: #3b3128;
  --color-secondary: #c2b6a4;
  --color-success: #8fb06c;
  --color-warning: #d2a24a;
  --color-info: #8ec0b1;
  --color-error: #d9836b;
  --color-background: #1e1b16;
  --color-surface: #292420;
  --color-border: #3e3529;
  --color-border-light: #342c22;
  --color-text-primary: #f0e9dd;
  --color-text-secondary: #c2b6a4;
  --color-text-tertiary: #9d9182;
  --color-text-placeholder: #9d9182;
  --accent-sage: #8b9d77;
  --accent-tan: #d4a373;
  --accent-mist: #4a4034;
  --accent-teal: #8fbfab;
  --accent-tan-ink: #d4a373;
  --accent-teal-ink: #8fbfab;
  --brand: #a9bf8e;
  --brand-hover: #bcd1a3;
  --brand-solid: #c08a5e;
  --brand-foreground: #241a12;
  --focus-ring: #a9bf8e;
  --shadow-sm: 0 1px 2px rgb(8 6 4 / 32%);
  --shadow-md: 0 6px 18px rgb(8 6 4 / 40%), 0 1px 3px rgb(8 6 4 / 30%);
  --shadow-lg: 0 14px 34px rgb(8 6 4 / 48%), 0 3px 9px rgb(8 6 4 / 34%);
  /* 深色下纸纹略提（深底上的噪声更不明显），仍只铺结构底色 */
  --organic-grain: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='g'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='180' height='180' filter='url(%23g)' opacity='0.06'/%3E%3C/svg%3E");
  --input-bg: #17140f;
  --hover-bg: #352d24;
  --titlebar-bg: #221d18;
  --titlebar-border: #3e3529;
  --titlebar-fg: #d8cdbb;
  --titlebar-accent: #c42b1c;
  --scrim: rgb(10 8 6 / 62%);
  --shade: #0f0d0a;
  --graph-canvas: #16130f;
  --graph-glow-core: rgba(212, 163, 115, 0.20);
  --graph-glow-mid: rgba(139, 157, 119, 0.10);
  --graph-node-surface: #201c17;
  --graph-node-surface-alt: #262119;
  --graph-node-border: #3a3228;
  --graph-node-title: #f0e9dd;
  --graph-muted: #a2967f;
  --graph-node-radius: 20px;
  --graph-card-shadow: 0 7px 9px 0 rgba(8, 6, 4, 0.32);
  --graph-handle: #7d7260;
  --graph-edge-default: #4a4136;
  --graph-chat: #d99a63;
  --graph-memory: #a3bd82;
  --graph-global: #8fbfab;
  --graph-resource: #d9b45e;
  --graph-fork: #d99a63;
  --graph-reference: #a3bd82;
  --graph-write: #e0a06a;
  --graph-edge-label: #ddd3c4;
  --graph-control: #221e18;
  --graph-control-border: #3a3228;
  --graph-minimap: rgb(22 19 15 / 90%);
  --graph-minimap-group: #8fbfab;
  --graph-minimap-chat: #d99a63;
  --graph-minimap-resource: #d9b45e;
  --graph-trace: #c98f4f;
  --graph-candidate: #b6a98c;
  --graph-status-missing: #d9836b;
  --graph-status-running: #d9b45e;
  --graph-node-shadow: rgba(8, 6, 4, 0.5);
}
* { box-sizing: border-box; }
button, input, textarea, select, [role='button'], [role='group'] { touch-action: manipulation; }
*:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
/* 全局细滚动条：土色半透明细条，hover 加深（禁纯黑/冷灰） */
* { scrollbar-width: thin; scrollbar-color: rgb(120 108 92 / 38%) transparent; }
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: rgb(120 108 92 / 38%); border-radius: var(--r-pill); border: 2px solid transparent; background-clip: content-box; }
::-webkit-scrollbar-thumb:hover { background-color: rgb(120 108 92 / 62%); }
::-webkit-scrollbar-corner { background: transparent; }
body { margin: 0; }
.evo-app {
  display: flex; flex-direction: column; height: 100vh;
  background-color: var(--color-background); background-image: var(--organic-grain);
  color: var(--color-text-primary);
  font-family: var(--font-sans);
  font-size: 14px; line-height: 1.5;
}

/* ══════════════════ 组件层（组件复用：同类控件只在此定义配色与形状） ══════════════════
   约定：本层给出"这一类控件长什么样"，业务规则只写布局/尺寸/状态差异。
   新增同类控件请把类名并入本层分组选择器，不要在业务规则里另配色值——
   dropdown / 输入框 / 徽标曾经各写一套配色，是漂移的根源。
   本层之后出现的高优先级具体规则可覆盖尺寸；配色/形状若需覆盖请回本层改。 */

/* 列表行/图标钮：hover 缓慢过渡（有机节奏），避免密集工具区出现"瞬变"硬切 */
.evo-tl-item, .evo-tl-row, .evo-tl-project-row, .evo-fs-row, .evo-cand-item, .evo-tl-archived-toggle,
.evo-tl-section-action, .evo-ews-tree-row, .evo-icon-btn, .evo-msg-copy, .evo-insp-subtab,
.evo-insp-tab, .evo-traj-row, .evo-agent-row, .evo-tl-row-act, .evo-panel-act, .evo-panel-del,
.evo-graph-legend-toggle, .evo-graph-minimap-toggle, .evo-tl-sort-btn, .evo-dropdown-btn,
.evo-ledger-kind, .evo-note-fm-toggle, .evo-traj-goto, .evo-traj-chip, .evo-md-toggle-btn,
.evo-composer-tool, .evo-composer-markdown-toggle, .evo-composer-markdown-state {
  transition: background-color var(--dur-quick) var(--ease-organic), color var(--dur-quick) var(--ease-organic),
    border-color var(--dur-quick) var(--ease-organic), box-shadow var(--dur-quick) var(--ease-organic);
}
/* 纸纹：铺在结构底色上（页面底/左右栏/顶栏/输入区），卡片表面保持干净。
   注意业务规则里写 background 简写会重置 background-image，结构面色一律用
   background-color + background-image: var(--organic-grain)。 */
.evo-paper, .evo-topbar, .evo-left, .evo-right, .evo-composer-wrap, .evo-tabbar,
.evo-statusbar, .evo-traj, .evo-settings-nav {
  background-color: var(--color-background); background-image: var(--organic-grain);
}

/* 浮层（菜单/弹层/抽屉卡）：所有 dropdown、popover、modal、toast 共用一套表面语言 */
.evo-pop,
.evo-dropdown-menu, .evo-brand-menu-panel, .evo-tl-sort-menu, .evo-tl-row-menu, .evo-tl-palette,
.evo-tab-menu, .evo-graph-menu, .evo-graph-legend, .evo-composer-model-menu, .evo-cand, .evo-queue,
.evo-ctx-panel, .evo-graph-editor, .evo-graph-viewer, .evo-modal, .evo-report-card,
.evo-context-trace, .evo-toast {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--r-blob);
  box-shadow: var(--shadow-lg), inset 0 1px 0 color-mix(in srgb, var(--color-text-primary) 5%, transparent);
  color: var(--color-text-primary);
}
/* 浮层行：hover 返青（Verdant Tint）+ 选中态鼠尾草底 */
.evo-pop-item,
.evo-dropdown-option, .evo-brand-menu-item, .evo-tl-sort-option, .evo-tl-menu-item,
.evo-tab-menu-item, .evo-graph-menu-item {
  display: flex; align-items: center; gap: 8px; width: 100%; min-width: 0;
  padding: 7px 10px; border: none; border-radius: var(--r-pebble-sm);
  background: transparent; color: var(--color-text-secondary);
  font: inherit; font-size: 12.5px; text-align: left; cursor: pointer;
  transition: background-color var(--dur-quick) var(--ease-organic), color var(--dur-quick) var(--ease-organic);
}
.evo-pop-item:hover,
.evo-dropdown-option:hover, .evo-brand-menu-item:hover, .evo-tl-sort-option:hover,
.evo-tl-menu-item:hover, .evo-tab-menu-item:hover:not(:disabled), .evo-graph-menu-item:hover:not(:disabled) {
  background: var(--hover-bg); color: var(--brand);
}
.evo-pop-item[data-active],
.evo-dropdown-option[data-active], .evo-brand-menu-item[data-active], .evo-tl-sort-option[data-active] {
  background: color-mix(in srgb, var(--accent-sage) 24%, transparent); color: var(--brand); font-weight: 600;
}
.evo-pop-sep, .evo-tl-menu-sep, .evo-graph-menu-sep {
  height: 1px; margin: 4px 6px; background: var(--color-border-light); flex-shrink: 0;
}
.evo-pop-title, .evo-brand-menu-title, .evo-graph-menu-title {
  padding: 4px 10px 6px; font-size: 10.5px; letter-spacing: 0.04em; color: var(--color-text-tertiary);
}

/* 按钮：鹅卵石形（四角不等）+ "底/边/影/字"四件套 + 缓慢土色过渡。
   基础态的 .evo-btn 就是一套完整的次级按钮样式——任何 <button class="evo-btn"> 都自带
   底色/描边/圆角/阴影，绝不回退到浏览器默认外观（早期版本漏了这点，界面上冒出过
   "2px 黑边 + 灰底"的系统按钮，看起来像单独写的样式）。变体只改语义色，形状尺寸一致。
   Soft Earth Press：hover 下沉 0.5px 并返青，active 再下沉 1px，不做漂浮弹跳。 */
.evo-btn,
.evo-btn-outline, .evo-btn-back, .evo-tl-back, .evo-graph-btn, .evo-setting-option,
.evo-suggest-card, .evo-ledger-exp, .evo-sched-template, .evo-exp-branch-chip, .evo-data-path-root,
.evo-panel-add, .evo-fs-save, .evo-tab-newfile-go, .evo-send, .evo-btn-run, .evo-btn-ok,
.evo-btn-test, .evo-btn-teal, .evo-btn-danger {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  padding: 6px 15px;
  border: 1px solid var(--color-border);
  border-radius: var(--r-pebble);
  background: var(--color-surface);
  color: var(--color-text-secondary);
  box-shadow: var(--shadow-sm);
  font: inherit; font-size: 12.5px; font-weight: 600; line-height: 1.5;
  cursor: pointer; white-space: nowrap;
  transition: background-color var(--dur-quick) var(--ease-organic),
    border-color var(--dur-quick) var(--ease-organic),
    color var(--dur-quick) var(--ease-organic),
    transform var(--dur-quick) var(--ease-organic),
    box-shadow var(--dur-quick) var(--ease-organic);
}
.evo-btn:hover, .evo-btn-outline:hover, .evo-btn-back:hover, .evo-tl-back:hover,
.evo-graph-btn:hover:not(:disabled), .evo-setting-option:hover, .evo-suggest-card:hover,
.evo-ledger-exp:hover, .evo-sched-template:hover, .evo-exp-branch-chip:hover, .evo-data-path-root:hover {
  border-color: color-mix(in srgb, var(--brand) 42%, var(--color-border));
  background: color-mix(in srgb, var(--accent-sage) 13%, var(--color-surface));
  color: var(--brand); transform: translateY(0.5px);
}
/* 主按钮：石褐/陶土填充（风格 Primary）+ 暖米前景 + 顶部一线内高光（手工漆面感）；
   hover 返青为深绿/浅鼠尾草（Verdant Tint）。 */
.evo-btn-primary, .evo-panel-add, .evo-fs-save, .evo-tab-newfile-go, .evo-send, .evo-btn-run,
.evo-setting-option[data-active] {
  border-color: color-mix(in srgb, var(--shade) 18%, transparent);
  background: var(--brand-solid); color: var(--brand-foreground);
  box-shadow: var(--shadow-sm), inset 0 1px 0 color-mix(in srgb, var(--brand-foreground) 20%, transparent);
}
.evo-btn-primary:hover, .evo-panel-add:hover, .evo-fs-save:hover, .evo-tab-newfile-go:hover,
.evo-send:hover, .evo-btn-run:hover, .evo-setting-option[data-active]:hover {
  border-color: transparent; background: var(--brand-hover);
  color: color-mix(in srgb, var(--brand-foreground) 82%, var(--color-background));
}
/* 语义变体：柔和土色浆（不用纯色块，保持"浆染"手感） */
.evo-btn-ok { border-color: color-mix(in srgb, var(--color-success) 34%, transparent); background: color-mix(in srgb, var(--color-success) 13%, var(--color-surface)); color: var(--color-success); }
.evo-btn-ok:hover { background: color-mix(in srgb, var(--color-success) 22%, var(--color-surface)); border-color: color-mix(in srgb, var(--color-success) 52%, transparent); }
.evo-btn-teal, .evo-btn-test { border-color: color-mix(in srgb, var(--accent-sage) 40%, transparent); background: color-mix(in srgb, var(--accent-sage) 15%, var(--color-surface)); color: var(--brand); }
.evo-btn-teal:hover, .evo-btn-test:hover { background: color-mix(in srgb, var(--accent-sage) 26%, var(--color-surface)); border-color: color-mix(in srgb, var(--brand) 50%, transparent); }
.evo-btn-danger { border-color: color-mix(in srgb, var(--color-error) 34%, transparent); background: color-mix(in srgb, var(--color-error) 12%, var(--color-surface)); color: var(--color-error); }
.evo-btn-danger:hover { background: color-mix(in srgb, var(--color-error) 22%, var(--color-surface)); border-color: color-mix(in srgb, var(--color-error) 52%, transparent); }
/* 幽灵按钮：工具条里的无框动作 */
.evo-btn-ghost { border-color: transparent; background: transparent; box-shadow: none; }
.evo-btn-ghost:hover { border-color: transparent; background: var(--hover-bg); color: var(--brand); }
.evo-btn-primary:disabled, .evo-btn-outline:disabled, .evo-btn-ok:disabled, .evo-btn-teal:disabled,
.evo-btn-danger:disabled, .evo-btn:disabled, .evo-send:disabled, .evo-panel-add:disabled,
.evo-fs-save:disabled, .evo-tab-newfile-go:disabled, .evo-btn-run:disabled, .evo-suggest-card:disabled {
  opacity: 0.5; cursor: default; transform: none;
}
.evo-btn:active:not(:disabled), .evo-btn-outline:active:not(:disabled), .evo-btn-primary:active:not(:disabled),
.evo-btn-ok:active:not(:disabled), .evo-btn-danger:active:not(:disabled) { transform: translateY(1px); box-shadow: none; }

/* 输入控件：内凹"凿面"——暖底 + 1px 描边 + 极浅内阴影；聚焦时鼠尾草环。
   所有 input/textarea/select 共用，避免出现第二套输入语言。 */
.evo-field,
.evo-panel-input, .evo-search-input, .evo-note-search, .evo-note-textarea, .evo-identity-edit,
.evo-graph-editor-text, .evo-queue-input, .evo-question-custom, .evo-md-link-input,
.evo-tl-search, .evo-tl-rename-input, .evo-tab-newfile-input, .evo-graph-search {
  background: var(--input-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--r-pebble-sm);
  box-shadow: inset 0 1px 2px color-mix(in srgb, var(--shade) 6%, transparent);
  color: var(--color-text-primary); font: inherit; outline: none;
  transition: border-color var(--dur-quick) var(--ease-organic), box-shadow var(--dur-quick) var(--ease-organic),
    background-color var(--dur-quick) var(--ease-organic);
}
.evo-field:hover, .evo-panel-input:hover, .evo-search-input:hover, .evo-note-search:hover,
.evo-note-textarea:hover, .evo-identity-edit:hover, .evo-graph-editor-text:hover,
.evo-queue-input:hover, .evo-question-custom:hover, .evo-md-link-input:hover,
.evo-tl-search:hover, .evo-tl-rename-input:hover, .evo-tab-newfile-input:hover, .evo-graph-search:hover {
  border-color: color-mix(in srgb, var(--brand) 30%, var(--color-border));
}
.evo-field:focus, .evo-field:focus-within,
.evo-panel-input:focus, .evo-search-input:focus, .evo-note-search:focus, .evo-note-textarea:focus,
.evo-identity-edit:focus, .evo-graph-editor-text:focus, .evo-queue-input:focus,
.evo-question-custom:focus, .evo-md-link-input:focus, .evo-tl-search:focus-within,
.evo-tl-rename-input:focus, .evo-tab-newfile-input:focus, .evo-graph-search:focus-within {
  border-color: color-mix(in srgb, var(--brand) 55%, var(--color-border));
  box-shadow: inset 0 1px 2px color-mix(in srgb, var(--shade) 4%, transparent),
    0 0 0 3px color-mix(in srgb, var(--brand) 16%, transparent);
}
.evo-field::placeholder, .evo-panel-input::placeholder, .evo-search-input::placeholder,
.evo-note-search::placeholder, .evo-note-textarea::placeholder, .evo-identity-edit::placeholder {
  color: var(--color-text-placeholder);
}

/* 徽标/胶囊：鹅卵石形 + 浆染色 + 1px 同色描边（比纯底色更"手工"）；
   -dashed 变体表示"未设置/默认值"，与"已设置"在形态上区分（不只靠颜色）。 */
.evo-chip,
.evo-status-chip, .evo-panel-tag, .evo-panel-item-badge, .evo-skill-status, .evo-skill-source,
.evo-note-badge, .evo-lib-badge, .evo-ews-badge, .evo-report-badge, .evo-channel-badge,
.evo-goal-evidence, .evo-wf-member, .evo-agent-mode, .evo-llm-model-n, .evo-tool-group-state,
.evo-tool-engine-chip, .evo-rounds-phase-status, .evo-traj-tokens {
  display: inline-flex; align-items: center; gap: 5px; padding: 2px 10px;
  border: 1px solid color-mix(in srgb, var(--color-border) 78%, transparent);
  border-radius: var(--r-pebble-sm);
  background: var(--accent-mist); color: var(--color-text-secondary);
  font-size: 11px; line-height: 1.55; white-space: nowrap; flex-shrink: 0;
}
.evo-chip-sage { border-color: color-mix(in srgb, var(--accent-sage) 55%, transparent); background: color-mix(in srgb, var(--accent-sage) 22%, transparent); color: var(--brand); }
.evo-chip-tan { border-color: color-mix(in srgb, var(--accent-tan) 60%, transparent); background: color-mix(in srgb, var(--accent-tan) 26%, transparent); color: var(--accent-tan-ink); }
.evo-chip-teal { border-color: color-mix(in srgb, var(--accent-teal) 55%, transparent); background: color-mix(in srgb, var(--accent-teal) 22%, transparent); color: var(--accent-teal-ink); }
.evo-chip-ok { border-color: color-mix(in srgb, var(--color-success) 42%, transparent); background: color-mix(in srgb, var(--color-success) 13%, transparent); color: var(--color-success); }
.evo-chip-warn { border-color: color-mix(in srgb, var(--color-warning) 45%, transparent); background: color-mix(in srgb, var(--color-warning) 14%, transparent); color: var(--color-warning); }
.evo-chip-err { border-color: color-mix(in srgb, var(--color-error) 40%, transparent); background: color-mix(in srgb, var(--color-error) 12%, transparent); color: var(--color-error); }
.evo-chip-dashed { border-style: dashed; background: transparent; color: var(--color-text-tertiary); }

/* 卡片：纸片感——不规则圆角（blob）+ 1px 暖描边 + 极轻投影。
   hover 只做"上浮 + 描边返青"，不再改变圆角：早期按风格文档的 Organic Morphing 做过
   hover 形变，实际读起来像渲染抖动（用户明确反馈），已废弃该动效。 */
.evo-card,
.evo-setting, .evo-panel-item, .evo-skill-card, .evo-ledger-card, .evo-report-section,
.evo-ews-section, .evo-note-body, .evo-note-doc, .evo-note-card, .evo-web-search-card,
.evo-tier-card, .evo-clear-row, .evo-rounds-phase, .evo-exp-item, .evo-env-card, .evo-history-row,
.evo-goal-proposal, .evo-sidechat-tab, .evo-note-draft, .evo-lib-block, .evo-note-hit,
.evo-assign-tier, .evo-llm-provider, .evo-context-trace-item, .evo-data-path-entry {
  background: var(--color-surface);
  border: 1px solid var(--color-border-light);
  border-radius: var(--r-blob);
  box-shadow: var(--shadow-sm);
  transition: border-color var(--dur-organic) var(--ease-organic),
    background-color var(--dur-organic) var(--ease-organic),
    box-shadow var(--dur-organic) var(--ease-organic),
    transform var(--dur-organic) var(--ease-organic);
}
.evo-note-card, .evo-note-hit, .evo-clear-row, .evo-exp-item:hover, .evo-sidechat-tab:hover {
  cursor: pointer;
}
.evo-note-card:hover, .evo-note-hit:hover, .evo-clear-row:hover, .evo-exp-item:hover, .evo-sidechat-tab:hover {
  border-color: color-mix(in srgb, var(--brand) 38%, var(--color-border));
  box-shadow: var(--shadow-md); transform: translateY(-1px);
}

/* 分段控件（视图切换/工具条开关）：凹槽轨道 + 鹅卵石滑块，替代散落的独立按钮 */
.evo-md-toggle, .evo-traj-seg, .evo-setting-options, .evo-sched-modes {
  gap: 3px; padding: 3px; border: 1px solid var(--color-border-light);
  border-radius: var(--r-pebble); background: var(--color-background);
}
.evo-md-toggle-btn, .evo-traj-chip, .evo-insp-subtab { border: 1px solid transparent; border-radius: var(--r-pebble-sm); }
.evo-md-toggle-btn[data-active], .evo-traj-chip[data-on], .evo-insp-subtab[data-active] {
  border-color: color-mix(in srgb, var(--accent-sage) 45%, transparent);
  background: color-mix(in srgb, var(--accent-sage) 24%, var(--color-surface));
  color: var(--brand);
}

/* 头像与圆点：blob 而非正圆（风格禁止完美圆形）；头像加一圈暖描边，像贴纸 */
.evo-avatar, .evo-msg-avatar, .evo-avatar-blob {
  border-radius: var(--r-dot);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-border) 85%, transparent);
}
.evo-dot, .evo-msg-avatar, .evo-ctx-panel-dot, .evo-tl-color-dot, .evo-tl-color-swatch,
.evo-agent-dot, .evo-tb-dot, .evo-composer-dot, .evo-job-dot, .evo-history-dot,
.evo-pending-dot, .evo-tl-running { border-radius: var(--r-dot); }

/* 植物小枝（图形签名）：mask 上色 = currentColor，尺寸由使用处给 */
.evo-sprig {
  display: inline-block; width: 1em; height: 1em; flex-shrink: 0;
  background-color: currentColor;
  -webkit-mask-image: var(--sprig); mask-image: var(--sprig);
  -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat;
  -webkit-mask-position: center; mask-position: center;
  -webkit-mask-size: contain; mask-size: contain;
}

/* 衬线标题（风格：Headings: font-serif, tracking-tight），正文/代码保持无衬线与等宽 */
.evo-serif { font-family: var(--font-serif); font-weight: 600; letter-spacing: -0.01em; }
.evo-md h1, .evo-md h2, .evo-md h3, .evo-md h4, .evo-md h5, .evo-md h6,
.evod-h, .evo-composer-editor-host .milkdown .ProseMirror h1,
.evo-composer-editor-host .milkdown .ProseMirror h2,
.evo-composer-editor-host .milkdown .ProseMirror h3,
.evo-composer-editor-host .milkdown .ProseMirror h4 {
  font-family: var(--font-serif); letter-spacing: -0.01em;
}
.evo-topbar {
  height: 56px; flex-shrink: 0; display: flex; align-items: center; justify-content: space-between;
  gap: 8px; padding: 0 10px 0 16px; border-bottom: 1px solid var(--color-border);
  background-color: var(--color-background); background-image: var(--organic-grain);
}
.evo-topbar-group { display: flex; align-items: center; gap: 2px; min-width: 0; }
.evo-brand-btn {
  display: flex; align-items: center; gap: 10px; min-width: 0; cursor: pointer;
  border: none; background: none; padding: 4px; border-radius: var(--r-sm); color: var(--color-text-primary);
}
.evo-brand-btn:hover { background: var(--hover-bg); }
.evo-brand-logo { width: 28px; height: 28px; border-radius: var(--r-xs); flex-shrink: 0; }
.evo-brand-name { font-family: var(--font-serif); font-size: 18px; font-weight: 600; white-space: nowrap; letter-spacing: -.01em; }
.evo-brand-menu { position: fixed; left: 8px; top: 52px; z-index: 1200; width: 230px; }
.evo-brand-menu-panel {
  display: flex; flex-direction: column; gap: 2px; padding: 6px;
}
.evo-brand-menu-title {
  padding: 2px 10px 8px; font-size: 11.5px; font-weight: 600; letter-spacing: .04em;
  border-bottom: 1px solid var(--color-border-light); margin-bottom: 4px;
}
.evo-brand-menu-item { padding: 8px 10px; font-size: 13px; }
.evo-brand-menu-item svg { width: 15px; height: 15px; color: var(--brand); flex-shrink: 0; }
.evo-icon-btn {
  display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px;
  border: 1px solid transparent; background: none; border-radius: var(--r-pebble-sm); color: var(--color-text-secondary); cursor: pointer;
}
.evo-icon-btn:hover { background: var(--hover-bg); border-color: var(--color-border-light); color: var(--brand); }
.evo-icon-btn svg { width: 20px; height: 20px; }
.evo-cols { flex: 1; display: flex; min-height: 0; }
.evo-left {
  width: 264px; flex-shrink: 0; min-width: 0; display: flex; flex-direction: column;
  border-right: 1px solid var(--color-border); background-color: var(--color-background); background-image: var(--organic-grain); overflow: hidden;
}
.evo-center { flex: 1; min-width: 0; display: flex; flex-direction: column; overflow: hidden; position: relative; }
.evo-right {
  width: 320px; flex-shrink: 0; min-width: 0; display: flex; flex-direction: column;
  border-left: 1px solid var(--color-border); background-color: var(--color-background); background-image: var(--organic-grain); overflow: hidden;
}
.evo-resize-handle { width: 4px; flex-shrink: 0; cursor: col-resize; background: transparent; position: relative; }
.evo-resize-handle:hover, .evo-resize-handle[data-dragging] { background: var(--color-border); }
/* ── 响应式抽屉（§26.1：<768px 左右栏变抽屉 + 黑色 40% 遮罩）── */
.evo-drawer-mask { position: fixed; inset: 0; background: var(--scrim); z-index: 280; }
@media (max-width: 819px) {
  .evo-left, .evo-right { position: fixed; top: 0; bottom: 0; z-index: 300; width: min(320px, 84vw) !important; box-shadow: var(--shadow-lg); transition: transform 0.22s ease; }
  .evo-left { left: 0; transform: translateX(-100%); }
  .evo-right { right: 0; transform: translateX(100%); }
  .evo-cols[data-narrow] .evo-left { transform: none; }
  .evo-cols[data-narrow] .evo-right { transform: none; }
  .evo-resize-handle { display: none; }
  .evo-graph-toolbar { flex-wrap: wrap; padding: 6px 8px; }
  .evo-graph-toolbar .evo-graph-search { order: 5; flex: 1 1 100%; }
  .evo-graph-search input { width: 100%; }
  .evo-graph-canvas { overflow: auto; }
  .evo-graph-inspector { display: none; }
}
/* ── 左侧栏 ── */
.evo-tl { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.evo-tl-head { padding: 10px 12px 4px; display: flex; align-items: center; gap: 6px; }
.evo-tl-head-title { font-size: 13.5px; font-weight: 600; color: var(--color-text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.evo-tl-head-title.evo-current-projects { font-family: var(--font-serif); font-size: 18.5px; font-weight: 600; letter-spacing: -.01em; }
.evo-tl-back { gap: 4px; padding: 5px 11px; flex-shrink: 0; font-size: 12px; }
.evo-tl-back svg { width: 14px; height: 14px; }
.evo-tl-newchat {
  display: inline-flex; align-items: center; gap: 7px; width: auto; padding: 6px 10px; margin-left: auto;
  border: none; background: none; border-radius: var(--r-sm); color: var(--color-text-primary);
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
  border: none; background: none; border-radius: var(--r-sm); color: var(--color-text-secondary);
  font-size: 13.5px; cursor: pointer; text-align: left;
}
.evo-tl-item:hover { background: var(--hover-bg); color: var(--color-text-primary); }
.evo-tl-item[data-active] { background: var(--hover-bg); color: var(--color-text-primary); font-weight: 500; }
.evo-tl-item svg { width: 17px; height: 17px; flex-shrink: 0; }
.evo-tl-item > span { min-width: 4em; }
.evo-tl-newchat-item { color: var(--color-text-primary); font-weight: 600; }
.evo-tl-menu-hint { display: flex; align-items: center; gap: 7px; padding: 7px 10px 9px; font-size: 11.5px; line-height: 1.5; }
.evo-tl-menu-hint svg { width: 13px; height: 13px; flex-shrink: 0; color: var(--color-text-tertiary); }
.evo-tl-tools { display: flex; align-items: center; gap: 6px; padding: 6px 12px 2px; }
.evo-tl-search { flex: 1; min-width: 0; padding: 6px 11px; display: flex; align-items: center; gap: 8px; }
.evo-tl-search svg { width: 15px; height: 15px; color: var(--color-text-tertiary); flex-shrink: 0; }
.evo-tl-search input { flex: 1; border: none; outline: none; background: none; color: var(--color-text-primary); font-size: 13px; }
.evo-tl-search input::placeholder { color: var(--color-text-tertiary); }
.evo-tl-searching { color: var(--color-text-tertiary); font-size: 10px; white-space: nowrap; }
.evo-tl-sort-wrap { position: relative; flex: 0 0 auto; }
.evo-tl-sort-btn { display: inline-flex; align-items: center; justify-content: center; width: 31px; height: 31px; padding: 0; border: 1px solid var(--color-border); border-radius: var(--r-xs); color: var(--color-text-tertiary); background: var(--input-bg); cursor: pointer; }
.evo-tl-sort-btn:hover, .evo-tl-sort-btn[aria-expanded='true'] { color: var(--brand); border-color: color-mix(in srgb, var(--brand) 55%, var(--color-border)); background: color-mix(in srgb, var(--brand) 8%, var(--input-bg)); }
.evo-tl-sort-btn svg { width: 15px; height: 15px; }
.evo-tl-sort-menu { position: absolute; top: calc(100% + 6px); right: 0; z-index: 90; min-width: 168px; padding: 5px; display: flex; flex-direction: column; gap: 1px; }
.evo-tl-sort-option { min-height: 30px; padding: 6px 8px; font-size: 12px; }
.evo-tl-sort-option svg { width: 14px; height: 14px; flex: 0 0 auto; }
.evo-tl-sort-option span { flex: 1; min-width: 0; }
.evo-tl-body { flex: 1; overflow-y: auto; padding: 6px 8px 16px; min-height: 0; }
.evo-tl-section { padding: 10px 10px 4px; display: flex; align-items: center; justify-content: space-between; }
.evo-tl-section-title { font-size: 12px; font-weight: 600; color: var(--color-text-secondary); letter-spacing: .2px; }
.evo-tl-subchat-section { display: block; padding: 6px 10px 9px; margin-bottom: 6px; border-bottom: 1px solid var(--color-border-light); }
.evo-tl-subchat-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-width: 0; }
.evo-tl-subchat-project { display: inline-flex; align-items: center; gap: 6px; flex: 1; min-width: 0; color: var(--color-text-primary); font-size: 12.5px; font-weight: 600; }
.evo-tl-subchat-project svg { width: 12px; height: 12px; color: var(--brand); flex-shrink: 0; }
.evo-tl-subchat-project > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.evo-tl-section-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.evo-tl-section-action { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; padding: 0; border: none; border-radius: var(--r-pebble-sm); color: var(--color-text-tertiary); background: transparent; cursor: pointer; }
.evo-tl-section-action:hover { color: var(--color-text-primary); background: var(--hover-bg); }
.evo-tl-section-action svg { width: 14px; height: 14px; }
.evo-tl-archived-toggle { display: flex; align-items: center; gap: 6px; width: 100%; padding: 6px 10px; font-size: 12px; font-weight: 600; color: var(--color-text-secondary); background: transparent; border: none; border-radius: var(--r-sm); cursor: pointer; font: inherit; }
.evo-tl-archived-toggle:hover { background: var(--hover-bg); }
.evo-tl-archived-toggle svg { width: 13px; height: 13px; }
.evo-tl-archived-list { margin: 2px 0 6px; }
.evo-tl-archived-row { opacity: 0.75; }
.evo-tl-archived-row:hover { opacity: 1; }
.evo-tl-footer { flex: 0 0 auto; display: flex; flex-direction: column; min-height: 0; max-height: 44%; padding: 6px 8px 8px; border-top: 1px solid var(--color-border-light); background: color-mix(in srgb, var(--color-surface) 72%, transparent); }
.evo-tl-footer .evo-tl-archived-list { overflow-y: auto; min-height: 0; margin: 2px 0 0; }
.evo-tl-archived-subchats { display: flex; flex-direction: column; gap: 1px; margin: 0 0 4px 12px; padding-left: 8px; border-left: 2px solid var(--color-border-light); }
.evo-tl-fork-error { font-size: 11px; color: var(--color-error); text-align: right; line-height: 1.4; max-width: 70%; }
.evo-tl-project-error { display: block; margin: 2px 10px 6px; text-align: left; max-width: none; }
.evo-tl-archived-sessions { display: block; padding: 6px 10px 4px; }
.evo-tl-row {
  display: flex; align-items: center; gap: 4px; width: 100%; text-align: left; padding: 6px 10px; margin-bottom: 2px;
  border: none; background: none; border-radius: var(--r-sm); cursor: default; position: relative;
}
.evo-tl-row:hover { background: var(--hover-bg); }
.evo-tl-row[data-active] { background: var(--hover-bg); }
.evo-tl-row[data-active]::before { content: ''; position: absolute; left: 0; top: 22%; bottom: 22%; width: 3px; border-radius: var(--r-2xs); background: var(--brand); }
.evo-tl-row-title { font-size: 13.5px; color: var(--color-text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: flex; align-items: center; gap: 5px; }
.evo-tl-pin-badge { display: inline-flex; flex-shrink: 0; color: var(--brand); }
.evo-tl-pin-badge svg { width: 11px; height: 11px; }
.evo-tl-title-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.evo-tl-color-dot { width: 8px; height: 8px; border-radius: var(--r-dot); flex-shrink: 0; }
.evo-tl-palette { position: absolute; right: 10px; z-index: 30; display: flex; gap: 5px; padding: 6px 8px; border-radius: var(--r-pill); }
.evo-tl-color-swatch { width: 16px; height: 16px; border-radius: var(--r-dot); border: 2px solid var(--color-surface); cursor: pointer; flex-shrink: 0; transition: transform 0.12s; }
.evo-tl-color-swatch:hover { transform: scale(1.2); }
.evo-tl-color-swatch[data-active] { outline: 2px solid var(--color-text-secondary); outline-offset: 1px; }
.evo-tl-row-sub { font-size: 11.5px; color: var(--color-text-tertiary); margin-top: 1px; }
.evo-tl-empty { padding: 28px 16px; text-align: center; color: var(--color-text-tertiary); font-size: 13px; }
.evo-tl-empty svg { width: 40px; height: 40px; color: var(--color-border); margin-bottom: 8px; }
.evo-tl-empty-compact { padding: 10px 16px; text-align: left; font-size: 12px; color: var(--color-text-tertiary); }
/* ── 中间聊天区 ── */
.evo-chat { flex: 1 1 auto; height: auto; display: flex; flex-direction: column; min-height: 0; overflow-y: auto; overflow-x: hidden; }
.evo-welcome { flex: 1 1 auto; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 24px 24px 32px; min-height: 0; }
/* 欢迎页的植物水印（图形签名；装饰性，不参与语义）：一枚淡鼠尾草小枝压在标题上方 */
.evo-welcome::before { content: ''; width: 58px; height: 58px; margin-bottom: 4px; opacity: 0.5;
  background-color: var(--accent-sage);
  -webkit-mask-image: var(--sprig); mask-image: var(--sprig); -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat;
  -webkit-mask-position: center; mask-position: center; -webkit-mask-size: contain; mask-size: contain; }
.evo-welcome h1 { font-family: var(--font-serif); font-size: 26px; font-weight: 600; margin: 0 0 10px; color: var(--color-text-primary); letter-spacing: -.015em; }
.evo-welcome p { margin: 0 0 28px; color: var(--color-text-secondary); font-size: 14px; max-width: 512px; line-height: 1.6; }
.evo-suggest { display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; }
/* §31.7：建议问题用圆形 pill 按钮（1px 边框、轻阴影、紧凑内边距） */
.evo-suggest-card {
  padding: 9px 20px; font-size: 13px; box-shadow: var(--shadow-sm);
}
.evo-welcome-prompt { margin-top: 22px; padding: 0; border: 0; background: none; color: var(--color-text-placeholder); font: inherit; font-size: 13px; line-height: 1.55; cursor: text; }
.evo-welcome-prompt:hover, .evo-welcome-prompt:focus-visible { color: var(--color-text-secondary); }
/* ── 欢迎页 Research Dashboard（§31.7）── */
.evo-dashboard { display: flex; gap: 10px; margin-top: 26px; }
.evo-dashboard-card { display: flex; flex-direction: column; align-items: center; gap: 2px; min-width: 96px; padding: 12px 18px; border: 1px solid var(--color-border); border-radius: var(--r-md); background: var(--color-surface); }
.evo-dashboard-value { font-family: var(--font-serif); font-size: 23px; font-weight: 600; color: var(--brand); line-height: 1.1; }
.evo-dashboard-label { font-size: 11.5px; color: var(--color-text-tertiary); }
/* ── 输入面板：sticky 常驻中间栏底部（消息区内容自适应、页面整体滚动）── */
.evo-composer-wrap { flex-shrink: 0; padding: 4px 0 8px; display: flex; flex-wrap: wrap; justify-content: center; position: sticky; bottom: 0; z-index: 30; background-color: var(--color-background); background-image: var(--organic-grain); }
/* ── 输入候选弹层（§23.2–23.5：斜杠命令 / @文件与@会话 / 输入历史）──
   max-width 独立于 width 声明：部分内嵌视口下 min() 的 100vw 解析偏大，
   独立钳制保证窄屏（≤430px）弹层永不横向溢出。 */
.evo-cand { position: absolute; bottom: calc(100% - 8px); left: 50%; transform: translateX(-50%); width: min(560px, calc(100vw - 96px)); max-width: calc(100vw - 96px); max-height: 280px; overflow-y: auto; z-index: 40; padding: 6px; display: flex; flex-direction: column; gap: 2px; }
.evo-cand-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 4px 10px 6px; border-bottom: 1px solid var(--color-border-light); }
.evo-cand-label { color: var(--color-text-secondary); font-size: 11.5px; font-weight: 600; }
.evo-cand-hint { color: var(--color-text-tertiary); font-size: 10.5px; white-space: nowrap; }
.evo-cand-item { display: flex; align-items: center; gap: 10px; padding: 7px 10px; border-radius: var(--r-sm); cursor: pointer; }
.evo-cand-item[data-active] { background: var(--hover-bg); }
.evo-cand-item svg { width: 15px; height: 15px; color: var(--brand); flex-shrink: 0; }
.evo-cand-text { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.evo-cand-title { font-size: 13px; color: var(--color-text-primary); font-family: var(--font-mono); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.evo-cand-sub { font-size: 11.5px; color: var(--color-text-tertiary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.evo-composer { width: 75%; max-width: none; margin-inline: auto; border: 1px solid var(--color-border); border-radius: var(--r-md); background: var(--color-surface); box-shadow: var(--shadow-sm); }
.evo-composer-status { display: flex; align-items: center; gap: 7px; padding: 8px 14px 0; font-size: 12px; color: var(--color-text-tertiary); }
.evo-composer-dot { width: 8px; height: 8px; border-radius: var(--r-dot); background: var(--color-success); flex-shrink: 0; }
.evo-composer-textarea { width: 100%; padding: 10px 14px 4px; border: none; outline: none; resize: none; background: none; color: transparent; -webkit-text-fill-color: transparent; caret-color: var(--color-text-primary); font-size: 14.5px; font-family: inherit; line-height: 1.55; min-height: 44px; max-height: 220px; position: relative; z-index: 1; }
.evo-composer-input:focus-within .evo-composer-textarea { color: var(--color-text-primary); -webkit-text-fill-color: var(--color-text-primary); }
.evo-composer:focus-within { border-color: color-mix(in srgb, var(--brand) 42%, var(--color-border)); box-shadow: var(--shadow-md); }
.evo-composer-textarea::placeholder { color: var(--color-text-tertiary); -webkit-text-fill-color: var(--color-text-tertiary); }
.evo-composer-textarea::selection { background: color-mix(in srgb, var(--brand) 30%, transparent); }
/* ── 双层 Markdown 实时编辑器（§composer）：装饰层渲染样式，textarea 透明编辑 ── */
.evo-composer-input { position: relative; flex: 1; display: flex; min-height: 44px; }
.evo-composer-deco { position: absolute; inset: 0; overflow: hidden; padding: 10px 14px 4px; font-size: 14.5px; font-family: inherit; line-height: 1.55; color: var(--color-text-primary); white-space: pre-wrap; word-break: break-word; pointer-events: none; }
.evo-composer-deco[data-empty] { display: none; }
.evod-m { visibility: hidden; }
/* 聚焦输入时：隐藏的语法标记显示极浅背景，辅助定位（失焦自动隐藏，保持干净） */
.evo-composer-input:focus-within .evo-composer-deco { display: none; }
.evod-code { font-family: var(--font-mono); font-size: 13px; background: var(--hover-bg); border-radius: var(--r-2xs); padding: 1px 3px; }
.evod-link { color: var(--brand); text-decoration: underline; text-underline-offset: 2px; }
.evod-h { font-weight: 700; }
.evod-h1 { font-size: 22px; } .evod-h2 { font-size: 19px; } .evod-h3 { font-size: 17px; } .evod-h4 { font-size: 15.5px; }
.evod-h5 { font-size: 14.5px; } .evod-h6 { font-size: 14.5px; color: var(--color-text-secondary); }
.evod-li { display: block; padding-left: 20px; position: relative; }
.evod-ul::before, .evod-ol::before { content: '•'; position: absolute; left: 5px; color: var(--color-text-tertiary); }
.evod-quote { border-left: 3px solid var(--color-border); padding-left: 9px; color: var(--color-text-secondary); }
.evod-hr { border-bottom: 1px solid var(--color-border); margin: 5px 0; }
.evod-fence-line, .evod-fence-body { background: var(--hover-bg); }
.evod-fence-line { margin-top: 4px; border-radius: var(--r-xs) var(--r-xs) 0 0; }
.evod-fence-body { font-family: var(--font-mono); font-size: 13px; }
.evod-fence-body:last-child { border-radius: 0 0 var(--r-xs) var(--r-xs); margin-bottom: 4px; }
.evo-composer-textarea::selection { background: color-mix(in srgb, var(--brand) 30%, transparent); }
.evo-composer-tools { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; min-width: 0; min-height: 44px; padding: 6px 8px 8px; visibility: visible; opacity: 1; }
.evo-composer-tool-start { display: flex; align-items: center; flex: 1 1 auto; min-width: 0; flex-wrap: wrap; gap: 4px; }
.evo-composer-tool-end { display: flex; align-items: center; justify-content: flex-end; flex: 0 1 auto; min-width: 0; gap: 4px; margin-left: auto; }
.evo-composer-tool {
  display: inline-flex; align-items: center; gap: 6px; flex: 0 0 auto; padding: 7px 10px; border: none; background: none;
  border-radius: var(--r-sm); color: var(--color-text-secondary); font-size: 12.5px; cursor: pointer;
}
.evo-composer-tool:hover { background: var(--hover-bg); color: var(--color-text-primary); }
.evo-composer-tool svg { width: 17px; height: 17px; }
.evo-composer-tool[data-on] { color: var(--brand); background: color-mix(in srgb, var(--brand) 12%, var(--color-surface)); }
.evo-composer-tool.evo-aa-on { color: var(--color-error); }
/* 窄容器：收紧间距尽量保持单行；右侧组不再强制换行，放不下时由 flex-wrap 自然兜底（换行后仍右对齐） */
@container (max-width: 640px) {
  .evo-composer-tools { gap: 2px; padding: 5px 6px 7px; }
  .evo-composer-tool-start, .evo-composer-tool-end { gap: 2px; }
  .evo-composer-tool { padding: 6px 7px; }
}
.evo-composer-spacer { flex: 1; }
.evo-send {
  width: 32px; height: 30px; padding: 0; flex-shrink: 0;
}
.evo-send svg { width: 16px; height: 16px; }
/* 窄视口（≤819px）：输入框不再 100% 顶边，左右留 10px 呼吸位；按钮略收紧保单行。
   注意须放在上方桌面规则之后——同优先级后者胜，放前面会被桌面 shorthand 覆盖成死规则。 */
@media (max-width: 819px) {
  .evo-composer-wrap { padding: 4px 10px 8px; }
  .evo-composer { width: 100%; max-width: none; }
  .evo-composer-stats { max-width: 100%; }
  .evo-composer-tools { gap: 2px; }
  .evo-composer-tool-start, .evo-composer-tool-end { gap: 2px; }
  .evo-composer-tool { width: 26px; height: 28px; padding: 4px 5px; gap: 0; justify-content: center; }
  .evo-composer-tool svg { width: 16px; height: 16px; }
  .evo-send { width: 30px; height: 28px; }
}
/* 超窄容器（小屏手机）：间距压到 1px，尽量保住单行；再窄才自然换行 */
@container (max-width: 430px) {
  .evo-composer-tools { gap: 1px; }
  .evo-composer-tool-start, .evo-composer-tool-end { gap: 1px; }
}
/* ── 右侧 inspector ── */
.evo-insp { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.evo-insp-tabs { display: flex; align-items: center; gap: 2px; padding: 8px 10px 0; border-bottom: 1px solid var(--color-border); }
.evo-insp-tab {
  position: relative; display: inline-flex; align-items: center; gap: 6px; padding: 7px 10px 9px; border: none; background: none;
  border-radius: var(--r-pebble-sm) var(--r-pebble-sm) 0 0; color: var(--color-text-tertiary); font-size: 13px; cursor: pointer;
  border-bottom: 2px solid transparent; margin-bottom: -1px;
}
.evo-insp-tab:hover { color: var(--color-text-primary); }
.evo-insp-tab[data-active] { color: var(--color-text-primary); border-bottom-color: transparent; font-weight: 600; }
.evo-insp-tab[data-active]::after { content: ''; position: absolute; left: 9px; right: 9px; bottom: -1px; height: 3px; border-radius: var(--r-pill); background: var(--brand); }
.evo-insp-tab svg { width: 15px; height: 15px; }
.evo-insp-close { margin-left: auto; }
.evo-insp-body { flex: 1; overflow-y: auto; min-height: 0; }
.evo-insp-subtabs { display: flex; gap: 2px; padding: 8px 12px 0; flex-wrap: wrap; }
.evo-insp-subtab { padding: 4px 10px; border: none; background: none; border-radius: var(--r-pill); color: var(--color-text-tertiary); font-size: 12px; cursor: pointer; }
.evo-insp-subtab:hover { background: var(--hover-bg); }
.evo-insp-subtab[data-active] { background: var(--hover-bg); color: var(--color-text-primary); }
.evo-insp-empty { padding: 40px 20px; text-align: center; color: var(--color-text-tertiary); font-size: 13px; }
.evo-insp-empty svg { width: 36px; height: 36px; color: var(--color-border); margin-bottom: 8px; }
/* 已有图标语义的空态不叠小枝（避免两个图形元素打架），只在纯文字空态加 */
.evo-insp-empty:not(:has(svg))::before, .evo-tl-empty:not(:has(svg))::before, .evo-graph-hint:not(:has(svg))::before { content: ''; display: block; width: 38px; height: 38px; margin: 0 auto 10px; opacity: 0.42;
  background-color: var(--accent-sage);
  -webkit-mask-image: var(--sprig); mask-image: var(--sprig); -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat;
  -webkit-mask-position: center; mask-position: center; -webkit-mask-size: contain; mask-size: contain; }
.evo-view { flex: 1; overflow-y: auto; }
/* ── 消息列表 ── */
.evo-msg-list { flex: none; height: auto; overflow: visible; padding: 18px 24px 6px; display: flex; flex-direction: column; gap: 10px; width: 75%; max-width: none; min-width: 0; margin: 0 auto; position: relative; }
.evo-msg-error { padding: 10px 14px; border: 1px solid var(--color-error); border-radius: var(--r-sm); color: var(--color-error); font-size: 13px; background: color-mix(in srgb, var(--color-error) 8%, transparent); }
.evo-useronly-hint { align-self: center; display: inline-flex; align-items: center; gap: 6px; padding: 4px 14px; border: 1px dashed color-mix(in srgb, var(--brand) 45%, var(--color-border)); border-radius: var(--r-pill); color: var(--color-text-secondary); font-size: 12px; background: color-mix(in srgb, var(--brand) 7%, var(--color-surface)); cursor: pointer; transition: border-color 0.15s, color 0.15s; }
.evo-useronly-hint:hover { border-color: var(--brand); color: var(--brand); }
/* 历史分页（移植规范 §9）：Load earlier / 回到最新 */
.evo-load-earlier { align-self: center; display: inline-flex; align-items: center; gap: 6px; padding: 6px 16px; border: 1px solid var(--color-border); border-radius: var(--r-pill); background: var(--color-surface); color: var(--color-text-secondary); font-size: 12.5px; cursor: pointer; transition: border-color 0.15s, color 0.15s; }
.evo-load-earlier:hover { border-color: var(--brand); color: var(--color-text-primary); }
.evo-load-earlier svg { width: 13px; height: 13px; }
/* 「回到最新」：iOS 风格圆形毛玻璃图标钮（纯图标 + tooltip，贴合苹果控制件语言）。
   z-index 必须压过悬停消息行（:hover 时 z-index:6）——按钮 sticky 悬浮时会与最后
   一条消息重叠，行悬停置顶后透明行矩形会盖住按钮吞掉点击，表现为「点了没反应」。 */
.evo-jump-latest { position: sticky; bottom: 14px; z-index: 7; align-self: flex-end; margin: 0 18px 2px 0; display: inline-flex; align-items: center; justify-content: center; width: 34px; height: 34px; padding: 0; border: 1px solid color-mix(in srgb, var(--color-border) 72%, transparent); border-radius: var(--r-dot); background: color-mix(in srgb, var(--color-surface) 68%, transparent); backdrop-filter: blur(14px) saturate(1.6); -webkit-backdrop-filter: blur(14px) saturate(1.6); color: var(--color-text-secondary); cursor: pointer; box-shadow: var(--shadow-md); transition: color 0.16s ease, border-color 0.16s ease, transform 0.16s ease, box-shadow 0.16s ease; }
.evo-jump-latest:hover { color: var(--brand); border-color: color-mix(in srgb, var(--brand) 45%, transparent); transform: translateY(-1px); box-shadow: var(--shadow-md); }
.evo-jump-latest:active { transform: translateY(0); }
.evo-jump-latest svg { width: 17px; height: 17px; }
.evo-msg-row { display: flex; gap: 10px; align-items: flex-start; position: relative; }
.evo-msg-row:hover { z-index: 6; }
/* 连续 AI 回复续行：头像仅分组首条出现；续行保留占位对齐文本、收紧与上一条的间距 */
.evo-msg-row.evo-msg-cont { margin-top: -8px; }
.evo-msg-row.evo-msg-cont .evo-msg-avatar { visibility: hidden; }
.evo-msg-user { flex-direction: row-reverse; }
.evo-msg-avatar { width: 30px; height: 30px; border-radius: var(--r-dot); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.evo-msg-avatar svg { width: 15px; height: 15px; }
.evo-msg-avatar-ai { background: var(--brand-solid); color: var(--brand-foreground); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--brand-foreground) 18%, transparent); }
.evo-msg-avatar-ai svg { width: 16px; height: 16px; }
.evo-msg-avatar-user { background: var(--color-avatar-bg); color: var(--color-text-secondary); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-text-tertiary) 28%, transparent); }
.evo-msg-avatar-user svg { width: 15px; height: 15px; }
.evo-msg-body { min-width: 0; max-width: 75%; display: flex; flex-direction: column; gap: 4px; }
.evo-msg-user-body { min-width: 0; max-width: 75%; flex: 0 0 auto; }
.evo-msg-user .evo-msg-stack { max-width: 75%; }
.evo-msg-bubble { position: relative; padding: 9px 15px; border-radius: var(--r-bubble-ai); font-size: 14px; line-height: 1.55; white-space: pre-wrap; word-break: break-word; }
.evo-msg-bubble-user { padding-block: 8px; line-height: 1.5; background: var(--color-user-message-bg); color: var(--color-user-message); border-radius: var(--r-bubble-user); box-shadow: var(--shadow-sm); }
.evo-msg-bubble-user .evo-md { line-height: 1.5; }
.evo-msg-bubble-user .evo-md > p:only-child { margin-block: 0; }
.evo-msg-bubble-assistant { background: var(--color-surface); border: 1px solid var(--color-border-light); border-radius: var(--r-bubble-ai); color: var(--color-text-primary); box-shadow: var(--shadow-sm); }
.evo-msg-text { white-space: pre-wrap; word-break: break-word; }
.evo-msg-time { font-size: 10.5px; color: var(--color-text-tertiary); margin-top: 3px; text-align: right; }
.evo-msg-cursor { display: inline-block; width: 7px; height: 15px; margin-left: 2px; background: var(--brand); vertical-align: -2px; animation: evo-blink 1s steps(2) infinite; }
@keyframes evo-blink { 50% { opacity: 0; } }
/* ── 首条消息乐观占位：AI「加载中」三点动画 ── */
.evo-pending-loading .evo-msg-stack { max-width: 75%; }
.evo-pending-bubbles { display: inline-flex; align-items: center; gap: 5px; padding: 4px 2px; min-width: 48px; }
.evo-pending-dot { width: 7px; height: 7px; border-radius: var(--r-dot); background: var(--brand); opacity: .35; animation: evo-pending-bounce 1.2s ease-in-out infinite; }
.evo-pending-dot:nth-child(2) { animation-delay: .18s; }
.evo-pending-dot:nth-child(3) { animation-delay: .36s; }
@keyframes evo-pending-bounce { 0%, 60%, 100% { transform: translateY(0); opacity: .35; } 30% { transform: translateY(-4px); opacity: .9; } }
/* 窄屏：消息列与审批/命令条占满可用宽度（放在主规则之后，避免被前面的媒体查询覆盖） */
@media (max-width: 819px) {
  .evo-msg-list { width: 100%; min-width: 0; }
  .evo-composer { width: 100%; max-width: none; margin-inline: 0; }
  .evo-approval-list, .evo-cmd-card { max-width: 100%; min-width: 0; }
}
/* ── Thinking 折叠（§31.6：reasoning 默认折叠，左侧 2px 边线 + 次级文字）── */
.evo-thinking { margin-top: 6px; }
.evo-thinking-toggle { display: inline-flex; align-items: center; gap: 6px; border: none; background: none; padding: 2px 6px 2px 0; font-size: 12px; color: var(--color-text-tertiary); cursor: pointer; }
.evo-thinking-toggle:hover { color: var(--color-text-secondary); }
.evo-thinking-toggle svg { width: 13px; height: 13px; }
.evo-thinking-body { margin: 4px 0 10px; padding: 2px 0 2px 14px; border-left: 2px solid var(--color-border); color: var(--color-text-tertiary); font-size: 12.5px; line-height: 1.7; white-space: pre-wrap; word-break: break-word; }
/* ── 工具卡片分组（§21.1：running/success/error 状态 + 折叠）── */
.evo-tool-group { display: flex; flex-direction: column; gap: 4px; margin-top: 10px; }
.evo-tool-group-head { display: flex; align-items: center; gap: 7px; width: 100%; text-align: left; padding: 6px 10px; border: 1px solid var(--color-border-light); border-radius: var(--r-sm); background: var(--color-surface); color: var(--color-text-secondary); font-size: 12.5px; cursor: pointer; }
.evo-tool-group-head:hover { border-color: var(--color-border); }
.evo-tool-group-head svg { width: 14px; height: 14px; flex-shrink: 0; color: var(--color-text-tertiary); }
.evo-tool-group-state { margin-left: auto; padding: 0 8px; }
.evo-tool-group-body { display: flex; flex-direction: column; gap: 4px; padding-left: 8px; }
.evo-tool-chev { transition: transform 0.15s; }
.evo-tool-chev.open { transform: rotate(90deg); }
.evo-tool-card { display: flex; flex-direction: column; gap: 4px; padding: 7px 11px; border: 1px solid var(--color-border); border-radius: var(--r-sm); background: var(--color-surface); font-size: 12.5px; color: var(--color-text-secondary); }
.evo-tool-card.running { border-color: color-mix(in srgb, var(--brand) 40%, var(--color-border)); }
.evo-tool-card.success { border-color: color-mix(in srgb, var(--color-success) 35%, var(--color-border)); }
.evo-tool-card.error { border-color: color-mix(in srgb, var(--color-error) 40%, var(--color-border)); }
.evo-tool-head { display: flex; align-items: center; gap: 7px; }
.evo-tool-head svg { width: 14px; height: 14px; flex-shrink: 0; }
.evo-tool-card.success .evo-tool-head svg { color: var(--color-success); }
.evo-tool-card.error .evo-tool-head svg { color: var(--color-error); }
.evo-tool-name { font-weight: 600; color: var(--color-text-primary); font-family: var(--font-mono, var(--font-mono)); flex-shrink: 0; }
.evo-tool-state { margin-left: auto; font-size: 11px; color: var(--color-text-tertiary); }
.evo-tool-card.running .evo-tool-state { color: var(--brand); }
.evo-tool-card.success .evo-tool-state { color: var(--color-success); }
.evo-tool-card.error .evo-tool-state { color: var(--color-error); }
.evo-tool-spinner { width: 11px; height: 11px; border-radius: var(--r-dot); border: 2px solid color-mix(in srgb, var(--brand) 30%, transparent); border-top-color: var(--brand); animation: evo-spin 0.8s linear infinite; flex-shrink: 0; display: inline-block; }
@keyframes evo-spin { to { transform: rotate(360deg); } }
.evo-tool-args, .evo-tool-result { display: flex; align-items: flex-start; gap: 7px; width: 100%; text-align: left; border: none; background: none; padding: 0; color: var(--color-text-secondary); cursor: pointer; font-size: 12px; line-height: 1.55; }
.evo-tool-args:hover, .evo-tool-result:hover { color: var(--color-text-primary); }
.evo-tool-args-text, .evo-tool-result-text { font-family: var(--font-mono, var(--font-mono)); white-space: pre-wrap; word-break: break-word; }
.evo-tool-result-label { font-size: 10.5px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px; flex-shrink: 0; margin-top: 2px; color: var(--color-text-tertiary); }
.evo-tool-card.error .evo-tool-result-label { color: var(--color-error); }
.evo-tool-card.success .evo-tool-result-label { color: var(--color-success); }
/* ── P0-2 工具结果图片缩略图 ── */
.evo-tool-imgs { display: flex; flex-wrap: wrap; gap: 6px; padding: 2px 0 4px; }
.evo-tool-img { width: 96px; height: 72px; border-radius: var(--r-xs); border: 1px solid var(--color-border); background: var(--color-surface); overflow: hidden; cursor: zoom-in; padding: 0; display: flex; align-items: center; justify-content: center; }
.evo-tool-img img { width: 100%; height: 100%; object-fit: cover; display: block; }
.evo-tool-img-loading { font-size: 11px; color: var(--color-text-tertiary); }
/* ── 桌面自绘标题栏 ── */
/* 桌面模式：#root 与 body 锁死为 100vh 且禁止文档级滚动——避免 margin 撑高 body
   造成 36px 底部黑边 + 右侧滚动条。标题栏 fixed 覆盖顶部 36px，.evo-app 全高
   用 padding-top 让位，内容与标题栏不重叠、页面不溢出。 */
html.evo-desktop { height: 100%; overflow: hidden; }
html.evo-desktop body { margin: 0 !important; height: 100%; overflow: hidden; }
html.evo-desktop #root { height: 100%; overflow: hidden; }
html.evo-desktop .evo-app[data-desktop] { height: 100%; padding-top: 36px; margin-top: 0; box-sizing: border-box; }
/* 桌面模式：全屏 modal（设置面板等）从自绘标题栏下方开始——标题栏在上层常驻
   （拖拽/关闭窗口可用），modal 内容不被 36px 标题栏遮挡；返回按钮在 modal
   头部清晰可见。 */
html.evo-desktop .evo-modal-mask { align-items: stretch; padding-top: 36px; }
html.evo-desktop .evo-modal.evo-modal-full { top: 36px; bottom: 0; }
.evo-tb {
  position: fixed; top: 0; left: 0; right: 0; height: 36px; z-index: 2147483647;
  display: flex; align-items: center; justify-content: flex-start; box-sizing: border-box;
  overflow: hidden; background-color: var(--titlebar-bg); background-image: var(--organic-grain);
  border-bottom: 1px solid var(--titlebar-border); color: var(--titlebar-fg);
  font: 500 13px/1 var(--font-sans);
  -webkit-user-select: none; user-select: none;
}
.evo-tb-spacer { flex: 1; min-width: 0; height: 100%; cursor: default; }
.evo-tb-brand {
  display: flex; align-items: center; gap: 8px; padding: 0 12px; height: 100%;
  border: 0; background: transparent; color: inherit; cursor: pointer; letter-spacing: 0.02em; white-space: nowrap;
}
.evo-tb-brand:hover { background: color-mix(in srgb, var(--color-text-primary) 12%, transparent); }
.evo-tb-tools, .evo-tb-actions { display: flex; align-items: center; gap: 2px; min-width: 0; }
.evo-tb-tools { margin-left: 2px; }
.evo-tb-actions { position: absolute; top: 3px; right: 142px; justify-content: flex-end; padding-right: 2px; }
.evo-tb-tools button, .evo-tb-actions button {
  width: 30px; height: 30px; min-width: 30px; padding: 0; border: 0; border-radius: var(--r-xs);
  background: transparent; color: inherit; display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer; transition: background-color 100ms ease, color 100ms ease;
}
.evo-tb-tools button:hover, .evo-tb-actions button:hover { background: color-mix(in srgb, var(--color-text-primary) 12%, transparent); }
.evo-tb-tools svg, .evo-tb-actions svg { width: 16px; height: 16px; flex: none; }
.evo-tb-health { width: auto !important; min-width: 0; max-width: 132px; padding: 0 8px; gap: 6px; font-size: 12px; justify-content: center; margin-right: 4px; }
.evo-tb-dot { width: 8px; height: 8px; border-radius: var(--r-dot); background: var(--color-success); flex: none; }
.evo-tb-dot.disconnected { background: var(--color-error); }
.evo-tb-controls { position: absolute; top: 0; right: 0; display: flex; align-items: stretch; height: 100%; margin-left: 4px; border-left: 1px solid color-mix(in srgb, var(--color-text-primary) 16%, transparent); }
.evo-tb-win { width: 46px; height: 100%; border: 0; margin: 0; padding: 0; background: transparent; color: inherit; display: grid; place-items: center; cursor: default; transition: background-color 100ms ease, color 100ms ease; }
.evo-tb-win:hover { background: color-mix(in srgb, var(--color-text-primary) 12%, transparent); }
.evo-tb-close:hover { background: var(--titlebar-accent); color: var(--brand-foreground); }
/* ── 设置弹窗 ── */
.evo-modal-mask { position: fixed; inset: 0; z-index: 2000; background: var(--scrim); display: flex; align-items: center; justify-content: center; }
.evo-modal { width: 75vw; height: 75vh; max-width: 75vw; max-height: 75vh; border-radius: var(--r-blob-lg); display: flex; flex-direction: column; overflow: hidden; }
.evo-modal.evo-modal-sm { width: min(440px, 92vw); height: auto; max-width: 440px; }
/* 设置面板占满整个窗口（用户要求）：fixed + inset 精确覆盖视口 */
.evo-modal.evo-modal-full { position: fixed; inset: 0; width: auto; height: auto; max-width: none; max-height: none; border-radius: 0; border: none; }
.evo-modal-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px 10px; border-bottom: 1px solid var(--color-border-light); }
.evo-modal-title { font-family: var(--font-serif); font-size: 16.5px; font-weight: 600; color: var(--color-text-primary); letter-spacing: -.01em; }
.evo-modal-body { padding: 14px 18px 18px; overflow-y: auto; }
.evo-setting { padding: 14px 16px; margin-bottom: 12px; background: var(--color-background); }
.evo-setting:last-child { margin-bottom: 0; }
.evo-setting-label { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--color-text-primary); margin-bottom: 8px; }
.evo-setting-label svg { width: 15px; height: 15px; color: var(--brand); }
.evo-setting-options { display: flex; gap: 6px; flex-wrap: wrap; }
.evo-setting-option { padding: 5px 14px; }
.evo-setting-hint { font-size: 12px; color: var(--color-text-tertiary); margin-top: 6px; line-height: 1.6; }
.evo-setting-error { color: var(--color-error); }
.evo-data-paths { overflow: hidden; }
.evo-data-path-row { padding: 12px 0; border-top: 1px solid var(--color-border-light); }
.evo-data-path-row-head, .evo-data-path-actual { display: flex; align-items: center; gap: 10px; min-width: 0; }
.evo-data-path-row-head { justify-content: flex-start; }
.evo-data-path-choose { margin-inline-start: 4px; }
.evo-data-path-label { font-size: 12px; font-weight: 600; color: var(--color-text-secondary); }
.evo-data-path-value { display: block; min-width: 0; margin-top: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--color-text-primary); font: 12px/1.5 var(--font-mono); }
.evo-data-path-layout { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--color-border-light); }
.evo-data-path-layout-title { margin-bottom: 7px; color: var(--color-text-tertiary); font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
.evo-data-path-layout-row { display: flex; align-items: baseline; gap: 10px; min-width: 0; padding: 4px 0; }
.evo-data-path-layout-row .evo-data-path-label { flex: 0 0 auto; }
.evo-data-path-layout-row .evo-data-path-value { flex: 1; margin-top: 0; }
.evo-data-path-change { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--color-border-light); }
.evo-data-path-actions, .evo-data-path-picker-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
.evo-data-path-notice, .evo-data-path-pending { margin-top: 10px; padding: 8px 10px; border: 1px solid color-mix(in srgb, var(--color-success) 45%, var(--color-border)); border-radius: var(--r-sm); color: var(--color-success); font-size: 12px; line-height: 1.5; }
.evo-data-path-pending { color: var(--color-warning); border-color: color-mix(in srgb, var(--color-warning) 45%, var(--color-border)); }
.evo-btn-small { padding: 4px 11px; font-size: 11.5px; border-radius: var(--r-pebble-sm); }
.evo-btn-small svg { width: 14px; height: 14px; }
.evo-data-path-picker-mask { z-index: 2100; }
.evo-data-path-picker { width: min(680px, 94vw); max-width: min(680px, 94vw); height: min(680px, 86vh); max-height: 86vh; }
.evo-data-path-picker-hint { padding: 10px 16px 0; color: var(--color-text-tertiary); font-size: 12px; line-height: 1.5; }
.evo-data-path-roots { display: flex; gap: 5px; flex-wrap: wrap; padding: 10px 16px 0; }
.evo-data-path-root, .evo-data-path-crumb, .evo-data-path-up { border: 1px solid var(--color-border); background: var(--color-surface); color: var(--color-text-secondary); cursor: pointer; font: inherit; }
.evo-data-path-root { padding: 4px 9px; border-radius: var(--r-pebble-sm); font: 600 12px var(--font-mono); }
.evo-data-path-root:hover, .evo-data-path-crumb:hover, .evo-data-path-up:hover { border-color: var(--brand); color: var(--color-text-primary); }
.evo-data-path-crumbs { display: flex; align-items: center; gap: 2px; min-width: 0; padding: 10px 16px 0; overflow-x: auto; }
.evo-data-path-crumbs svg { width: 13px; height: 13px; flex: none; color: var(--color-text-tertiary); }
.evo-data-path-up { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; flex: none; border-radius: var(--r-pebble-sm); }
.evo-data-path-up svg { width: 14px; height: 14px; }
.evo-data-path-crumb { max-width: 180px; padding: 4px 7px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; border: 0; background: transparent; }
.evo-data-path-current { margin: 10px 16px 0; padding: 7px 9px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; border: 1px solid var(--color-border-light); border-radius: var(--r-xs); color: var(--color-text-primary); background: var(--color-background); font: 12px/1.5 var(--font-mono); }
.evo-data-path-entries { flex: 1; min-height: 120px; margin: 10px 16px 0; overflow-y: auto; border: 1px solid var(--color-border-light); border-radius: var(--r-sm); }
.evo-data-path-entry { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 36px; padding: 7px 10px; border: 0; border-bottom: 1px solid var(--color-border-light); background: transparent; color: var(--color-text-primary); cursor: pointer; text-align: left; font: inherit; }
.evo-data-path-entry:last-child { border-bottom: 0; }
.evo-data-path-entry:hover { background: var(--hover-bg); }
.evo-data-path-entry svg:first-child { width: 15px; height: 15px; color: var(--brand); flex: none; }
.evo-data-path-entry svg:last-child { width: 14px; height: 14px; margin-left: auto; color: var(--color-text-tertiary); flex: none; }
.evo-data-path-entry span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.evo-data-path-picker-actions { padding: 0 16px 16px; }
.evo-data-path-picker-loading { padding: 24px 16px; color: var(--color-text-tertiary); font-size: 12px; }
.evo-web-search-setting { min-width: 0; overflow: hidden; }
.evo-web-search-setting > *, .evo-web-search-card > * { min-width: 0; max-width: 100%; }
.evo-web-search-setting .evo-setting-hint { min-width: 0; overflow-wrap: anywhere; word-break: break-word; }
.evo-web-search-select { max-width: 420px; margin-top: 10px; }
.evo-web-search-card { display: flex; flex-direction: column; gap: 8px; min-width: 0; margin-top: 12px; padding: 12px 14px; }
.evo-web-search-runtime { display: flex; flex-direction: column; gap: 7px; padding-top: 8px; border-top: 1px solid var(--color-border-light); }
/* 引擎可用性：chips 按可用/不可用着色，悬停 title 说明 */
.evo-web-search-engines { display: flex; flex-direction: column; gap: 7px; }
.evo-web-search-engine-chips { display: flex; flex-wrap: wrap; gap: 5px; }
.evo-web-search-engine-chip { padding: 1px 9px; border-radius: var(--r-pill); font-family: var(--font-mono); font-size: 11px; line-height: 1.5; }
.evo-web-search-engine-ok { border: 1px solid color-mix(in srgb, var(--color-success) 45%, transparent); background: color-mix(in srgb, var(--color-success) 9%, transparent); color: var(--color-success); }
.evo-web-search-engine-dead { border: 1px dashed var(--color-border); background: transparent; color: var(--color-text-tertiary); text-decoration: line-through; opacity: 0.7; }
/* web_search 工具卡头部的引擎徽标（host 登记、UI 渲染，不污染结果文本）：每个引擎一枚 chip */
.evo-tool-engines { display: inline-flex; align-items: center; flex-wrap: wrap; gap: 4px; min-width: 0; }
.evo-tool-engine-chip { padding: 0 8px; border: 1px solid color-mix(in srgb, var(--brand) 32%, transparent); background: color-mix(in srgb, var(--accent-sage) 22%, transparent); color: var(--brand); font-size: 10px; line-height: 1.7; }
.evo-web-search-name { font-family: var(--font-serif); font-size: 13.5px; font-weight: 600; color: var(--color-text-primary); }
.evo-web-search-key { min-width: 0; max-width: 560px; }
.evo-web-search-setting .evo-panel-input { box-sizing: border-box; min-width: 0; max-width: 100%; }
.evo-web-search-test { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--color-border-light); }
.evo-web-search-test-row { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
.evo-web-search-test-row .evo-panel-input { min-width: 0; flex: 1; }
.evo-web-search-result { display: flex; flex-direction: column; gap: 5px; margin-top: 9px; padding: 8px 10px; border: 1px solid var(--color-border-light); border-radius: var(--r-sm); font-size: 12px; }
.evo-web-search-result a { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--brand); }
.evo-setting-check { display: flex; align-items: flex-start; gap: 8px; width: fit-content; max-width: 100%; color: var(--color-text-secondary); font-size: 12px; line-height: 1.5; }
.evo-setting-check input { flex: 0 0 auto; margin-top: 2px; }
.evo-setting-check-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 16px; width: 100%; }
@media (max-width: 560px) { .evo-setting-check-grid { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 560px) {
  .evo-web-search-test-row { align-items: stretch; flex-direction: column; }
  .evo-web-search-test-row .evo-btn { align-self: flex-start; }
}
.evo-tier-option { display: flex; flex-direction: column; gap: 7px; width: 100%; text-align: left; padding: 12px 16px; border: 1px solid var(--color-border); border-radius: var(--r-sm); background: var(--color-background); color: var(--color-text-primary); cursor: pointer; transition: border-color 0.15s, background 0.15s, box-shadow 0.15s; }
.evo-tier-option:hover:not(:disabled) { border-color: var(--brand); background: color-mix(in srgb, var(--brand) 5%, var(--color-background)); }
.evo-tier-option[data-active] { border-color: var(--brand); box-shadow: 0 0 0 1px color-mix(in srgb, var(--brand) 45%, transparent); }
.evo-tier-option:disabled { opacity: 0.55; cursor: not-allowed; }
.evo-tier-option-head { display: flex; align-items: flex-start; gap: 10px; }
.evo-tier-option-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.evo-tier-option-name { font-family: var(--font-serif); font-size: 14.5px; font-weight: 600; line-height: 1.4; }
.evo-tier-option-desc { font-size: 12px; color: var(--color-text-tertiary); line-height: 1.55; }
.evo-tier-option-current { flex-shrink: 0; margin-top: 2px; padding: 1px 9px; border-radius: var(--r-pill); background: var(--brand-solid); color: var(--brand-foreground); font-size: 11px; font-weight: 600; }
.evo-tier-option-detail { font-size: 12.5px; color: var(--color-text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* ── 业务面板（记忆/调度/团队/通道/技能）── */
.evo-panel { max-width: 760px; margin: 0 auto; padding: 28px 28px 40px; }
@media (max-width: 560px) { .evo-panel { padding: 16px 12px 32px; } }
.evo-panel-head { display: flex; align-items: center; gap: 10px; font-family: var(--font-serif); font-size: 18px; font-weight: 600; color: var(--color-text-primary); margin-bottom: 20px; letter-spacing: -.01em; }
.evo-panel-head::before { content: ''; width: 20px; height: 20px; flex-shrink: 0; background-color: var(--accent-sage);
  -webkit-mask-image: var(--sprig); mask-image: var(--sprig); -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat;
  -webkit-mask-position: center; mask-position: center; -webkit-mask-size: contain; mask-size: contain; }
.evo-panel-head svg { width: 19px; height: 19px; color: var(--brand); }
.evo-panel-body { display: flex; flex-direction: column; gap: 16px; }
.evo-panel-row { display: flex; flex-direction: column; gap: 8px; }
.evo-panel-row-label { font-size: 12px; font-weight: 600; color: var(--color-text-tertiary); letter-spacing: 0.4px; text-transform: uppercase; }
.evo-panel-hint { font-size: 13px; color: var(--color-text-tertiary); }
.evo-panel-help { font-size: 12.5px; line-height: 1.6; color: var(--color-text-tertiary);
  padding: 9px 12px; border: 1px solid var(--color-border); border-left: 3px solid var(--accent-sage);
  border-radius: var(--r-blob); background: var(--color-surface); }
.evo-panel-field-hint { margin-top: -10px; font-size: 11.5px; line-height: 1.5; }
.evo-panel-error { padding: 8px 12px; border: 1px solid var(--color-error); border-radius: var(--r-sm); color: var(--color-error); font-size: 12.5px; }
/* 图谱「未绑定项目工作区」引导空态：中性色，不用错误红 */
.evo-graph-hint-banner { padding: 8px 12px; border: 1px solid var(--color-border); border-radius: var(--r-sm); color: var(--color-text-secondary); font-size: 12.5px; line-height: 1.6; }
.evo-llm-probe-warn { padding: 8px 12px; border: 1px solid color-mix(in srgb, var(--color-warning) 45%, var(--color-border)); border-radius: var(--r-sm); color: var(--color-warning); font-size: 12.5px; line-height: 1.6; }
.evo-panel-tags { display: flex; gap: 6px; flex-wrap: wrap; }
.evo-panel-tag { padding: 4px 12px; font-size: 12.5px; }
.evo-panel-tag-link { border-color: color-mix(in srgb, var(--brand) 40%, transparent); color: var(--brand); background: color-mix(in srgb, var(--brand) 8%, transparent); }
/* P1-2 边类型徽标：互补=青（默认 link 色）/ 矛盾=橙红 / 取代=灰+删除线暗示 */
.evo-edge-contradicts { border-color: color-mix(in srgb, var(--color-error) 45%, transparent); color: var(--color-error); background: color-mix(in srgb, var(--color-error) 8%, transparent); }
.evo-edge-supersedes { border-color: var(--color-border); color: var(--color-text-tertiary); background: var(--color-surface); text-decoration: line-through; text-decoration-color: color-mix(in srgb, var(--color-text-tertiary) 55%, transparent); }
/* P2-1 图纸缩略图 */
.evo-figure-thumb { max-width: 100%; max-height: 180px; border: 1px solid var(--color-border-light); border-radius: var(--r-sm); cursor: zoom-in; object-fit: contain; background: var(--color-surface); }
.evo-panel-stats { display: flex; gap: 10px; flex-wrap: wrap; }
.evo-panel-stat { flex: 1; min-width: 88px; padding: 12px; border: 1px solid var(--color-border); border-radius: var(--r-md); background: var(--color-surface); text-align: center; }
.evo-panel-stat-num { font-size: 20px; font-weight: 700; color: var(--color-text-primary); }
.evo-panel-stat-label { font-size: 11px; color: var(--color-text-tertiary); margin-top: 2px; }
.evo-panel-list { display: flex; flex-direction: column; gap: 6px; }
.evo-panel-item { display: flex; align-items: center; gap: 10px; padding: 9px 12px; }
.evo-panel-item svg { width: 15px; height: 15px; color: var(--color-text-tertiary); flex-shrink: 0; }
.evo-panel-item-main { flex: 1; font-size: 13.5px; color: var(--color-text-primary); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.evo-panel-item-code { font-size: 11.5px; color: var(--color-text-tertiary); font-family: var(--font-mono); }
.evo-panel-item-badge { padding: 2px 9px; }
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
.evo-goal-criterion.done .evo-goal-criterion-mark { color: var(--color-success); }
.evo-goal-criterion-text { flex: 1; min-width: 0; }
.evo-goal-evidence { padding: 1px 8px; }
.evo-goal-tags { display: flex; flex-wrap: wrap; gap: 5px; }
.evo-goal-detail-meta { display: flex; gap: 12px; font-size: 11px; color: var(--color-text-tertiary); }
.evo-btn-sm { padding: 4px 11px; font-size: 12px; border-radius: var(--r-pebble-sm); }
.evo-goal-proposals { display: flex; flex-direction: column; gap: 7px; }
.evo-goal-proposal { display: flex; flex-direction: column; gap: 5px; padding: 8px 11px; }
.evo-goal-proposal-head { display: flex; align-items: baseline; gap: 8px; }
.evo-goal-proposal-title { flex: 1; font-size: 12.5px; font-weight: 600; color: var(--color-text-primary); min-width: 0; }
.evo-goal-proposal-time { flex-shrink: 0; font-size: 10.5px; color: var(--color-text-tertiary); }
.evo-goal-proposal-summary { font-size: 12px; color: var(--color-text-secondary); line-height: 1.5; white-space: pre-wrap; }
.evo-goal-proposal-acts { display: flex; gap: 7px; }
.evo-panel-form { display: flex; gap: 8px; flex-wrap: wrap; }
.evo-panel-input { flex: 1; min-width: 140px; padding: 7px 12px; font-size: 13px; }
.evo-panel-input-cron { flex: 0 0 130px; min-width: 0; font-family: var(--font-mono); }
.evo-panel-add { padding: 7px 16px; font-size: 13px; }
.evo-panel-add svg { width: 14px; height: 14px; }
.evo-panel-del { border: none; background: none; color: var(--color-text-tertiary); cursor: pointer; padding: 4px; border-radius: var(--r-pebble-sm); display: inline-flex; }
.evo-panel-del:hover { color: var(--color-error); background: var(--hover-bg); }
.evo-panel-del svg { width: 14px; height: 14px; }
.evo-panel-act { border: none; background: none; color: var(--color-text-tertiary); cursor: pointer; padding: 4px; border-radius: var(--r-pebble-sm); display: inline-flex; }
.evo-panel-act:hover { color: var(--brand); background: var(--hover-bg); }
.evo-panel-act:disabled { opacity: .45; cursor: default; }
.evo-panel-act svg { width: 14px; height: 14px; }
.evo-profile-edit { display: flex; flex-direction: column; gap: 8px; padding: 4px 2px 8px; }
.evo-identity-edit { width: 100%; min-height: 140px; padding: 8px 10px; font-family: var(--font-mono); font-size: 12.5px; line-height: 1.6; resize: vertical; }
.evo-profile-rename { align-items: center; padding: 4px 2px 8px; }
/* ── Schedule Builder（§42.2）── */
.evo-sched-modes { display: flex; gap: 4px; }
.evo-sched-fields { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.evo-sched-select { width: auto; flex: 0 1 110px; }
.evo-sched-preview { font-family: var(--font-mono); font-size: 11.5px; color: var(--color-text-tertiary); background: var(--hover-bg); padding: 3px 8px; border-radius: var(--r-xs); }
.evo-sched-templates { display: flex; flex-wrap: wrap; gap: 5px; }
.evo-sched-template { border: 1px solid var(--color-border); background: var(--color-surface); color: var(--color-text-secondary); font-size: 11.5px; border-radius: var(--r-pill); padding: 3px 11px; cursor: pointer; }
.evo-sched-template:hover { border-color: var(--brand); color: var(--brand); }
.evo-panel-label { font-size: 12px; font-weight: 600; color: var(--color-text-secondary); }
.evo-panel-check { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--color-text-secondary); cursor: pointer; }
/* ── Memory History 时间线（§26.5）── */
.evo-history-row { display: flex; align-items: flex-start; gap: 8px; padding: 8px 11px; }
.evo-history-dot { width: 8px; height: 8px; border-radius: var(--r-dot); background: var(--color-text-tertiary); flex-shrink: 0; margin-top: 6px; }
.evo-history-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.evo-history-text { font-size: 12.5px; color: var(--color-text-primary); line-height: 1.5; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.evo-history-meta { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--color-text-tertiary); flex-wrap: wrap; }
.evo-identity-text { margin: 0; max-height: 160px; overflow-y: auto; font-family: var(--font-mono); font-size: 11.5px; line-height: 1.55; color: var(--color-text-secondary); white-space: pre-wrap; word-break: break-word; }
/* ── Skills Marketplace（§42.6）── */
.evo-skill-name-btn { border: none; background: none; padding: 0; cursor: pointer; text-align: left; min-width: 0; }
.evo-skill-name-btn:hover .evo-panel-item-main { color: var(--brand); }
.evo-skill-source { padding: 2px 9px; max-width: 140px; overflow: hidden; text-overflow: ellipsis; }
.evo-skill-detail { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--color-text-secondary); border-top: 1px dashed var(--color-border); padding-top: 7px; line-height: 1.55; }
/* ── 工作区文件浏览器（Inspector → Workspace）── */
.evo-fs { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.evo-fs-toolbar { display: flex; align-items: center; gap: 6px; padding: 8px 10px 4px; }
.evo-fs-crumb { flex: 1; min-width: 0; font-size: 11.5px; color: var(--color-text-tertiary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; direction: rtl; text-align: left; }
.evo-fs-tree { flex: 1; overflow-y: auto; padding: 4px 6px 12px; min-height: 0; }
.evo-fs-row { display: flex; align-items: center; gap: 6px; width: 100%; padding: 4px 8px; border: none; background: none; border-radius: var(--r-xs); color: var(--color-text-secondary); font-size: 12.5px; cursor: pointer; text-align: left; }
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
.evo-fs-save { gap: 5px; padding: 5px 13px; font-size: 12px; }
.evo-fs-save svg { width: 13px; height: 13px; }
.evo-fs-editor { flex: 1; min-height: 0; padding: 10px 12px; border: none; outline: none; resize: none; background: var(--color-surface); color: var(--color-text-primary); font-size: 12.5px; line-height: 1.6; font-family: var(--font-mono); }
.evo-fs-image { max-width: 100%; object-fit: contain; padding: 10px; }
.evo-fs-frame { flex: 1; min-height: 0; border: none; background: var(--color-surface); }
/* ── 会话状态条 / 统计条 ── */
.evo-composer { position: relative; border: 1px solid var(--color-border); border-radius: var(--r-blob-lg); background: var(--color-surface); box-shadow: var(--shadow-sm); display: flex; flex-direction: column; container-type: inline-size; transition: border-color var(--dur-organic) var(--ease-organic), box-shadow var(--dur-organic) var(--ease-organic); }
/* 输入区顶部拖拽热区：覆盖边框，不额外占据输入区的布局高度。 */
.evo-composer-resize { position: absolute; z-index: 1; inset: -4px 0 auto; height: 9px; cursor: ns-resize; border-radius: var(--r-blob-lg) var(--r-blob-lg) 0 0; touch-action: none; display: flex; align-items: center; justify-content: center; }
.evo-composer-resize::before { content: ''; width: 28px; height: 2px; border-radius: var(--r-pill); background: var(--color-border); transition: background 0.15s ease, width 0.15s ease; }
.evo-composer-resize:hover::before, .evo-composer-resize[data-dragging]::before { background: var(--brand); width: 44px; }
.evo-composer-status { display: flex; align-items: center; gap: 8px; padding: 8px 14px 0; font-size: 12px; color: var(--color-text-tertiary); flex-wrap: wrap; }
.evo-composer-editing { display: inline-flex; align-items: center; gap: 4px; min-width: 0; padding: 2px 6px; border-radius: var(--r-xs); background: color-mix(in srgb, var(--brand) 10%, transparent); color: var(--brand); }
.evo-composer-editing > svg { width: 12px; height: 12px; flex: 0 0 auto; }
.evo-composer-editing-cancel { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; margin-left: 1px; padding: 0; border: 0; border-radius: var(--r-pebble-sm); background: transparent; color: currentColor; cursor: pointer; }
.evo-composer-editing-cancel:hover { background: color-mix(in srgb, var(--brand) 16%, transparent); }
.evo-composer-editing-cancel svg { width: 12px; height: 12px; }
/* 当前工作路径（§25.4）：单行省略 + tooltip 完整路径 */
.evo-cwd { flex: 1 1 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--font-mono); font-size: 11px; color: var(--color-text-tertiary); cursor: default; }
.evo-cwd:hover { color: var(--color-text-secondary); }
.evo-status-chip { padding: 2px 9px; }
.evo-status-model { border: none; cursor: pointer; transition: border-color 0.15s, color 0.15s; }
.evo-status-model:hover { color: var(--brand); box-shadow: 0 0 0 1px var(--brand); }
.evo-status-chip svg { width: 11px; height: 11px; }
.evo-status-goal { color: var(--brand); }
.evo-status-ro { color: var(--color-warning); }
.evo-status-full { color: var(--color-error); }
/* P0-4 上下文占用条：绿/黄/红三档 + 内嵌比例小条 */
.evo-ctx-meter-bar { display: inline-block; width: 34px; height: 4px; border-radius: var(--r-2xs); background: color-mix(in srgb, var(--color-text-tertiary) 25%, transparent); position: relative; overflow: hidden; }
.evo-ctx-ok { color: var(--color-success); }
.evo-ctx-watch { color: var(--color-warning); }
.evo-ctx-high { color: var(--color-error); }
/* 胶囊本体是按钮：点击展开上下文明细浮层（§23.9） */
.evo-ctx-wrap { position: relative; display: inline-flex; }
.evo-ctx-meter { border: none; font: inherit; font-size: 11px; cursor: pointer; }
.evo-ctx-meter:hover, .evo-ctx-meter-open { box-shadow: 0 0 0 1px currentColor; }
/* 上下文明细浮层：标题 + 容量条 + 分类占比行 + 平均缓存命中率 */
.evo-ctx-panel { position: absolute; bottom: calc(100% + 8px); left: 0; z-index: 3000; width: 288px; max-width: calc(100vw - 24px); padding: 12px 14px; font-size: 12.5px; }
.evo-ctx-panel-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 9px; }
.evo-ctx-panel-title { font-size: 14px; font-weight: 600; color: var(--color-text-primary); }
.evo-ctx-panel-value { font-size: 12.5px; color: var(--color-text-secondary); font-variant-numeric: tabular-nums; }
.evo-ctx-panel-bar { height: 8px; border-radius: var(--r-pill); background: color-mix(in srgb, var(--color-text-tertiary) 22%, transparent); overflow: hidden; margin-bottom: 10px; }
.evo-ctx-panel-bar i { display: block; height: 100%; border-radius: var(--r-pill); background: var(--brand); }
.evo-ctx-panel-rows { display: flex; flex-direction: column; gap: 7px; }
.evo-ctx-panel-row { display: flex; align-items: center; gap: 9px; }
.evo-ctx-panel-dot { width: 9px; height: 9px; border-radius: var(--r-dot); flex: 0 0 auto; background: color-mix(in srgb, var(--color-text-tertiary) 60%, transparent); }
.evo-ctx-panel-dot[data-key='messages'] { background: var(--brand); }
.evo-ctx-panel-dot[data-key='mcp'] { background: color-mix(in srgb, var(--brand) 62%, var(--color-surface)); }
.evo-ctx-panel-dot[data-key='tools'] { background: color-mix(in srgb, var(--brand) 46%, var(--color-surface)); }
.evo-ctx-panel-dot[data-key='skills'] { background: color-mix(in srgb, var(--brand) 32%, var(--color-surface)); }
.evo-ctx-panel-dot[data-key='system'] { background: color-mix(in srgb, var(--brand) 20%, var(--color-surface)); }
.evo-ctx-panel-dot[data-key='other'] { background: color-mix(in srgb, var(--color-text-tertiary) 45%, transparent); }
.evo-ctx-panel-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.evo-ctx-panel-pct { font-variant-numeric: tabular-nums; color: var(--color-text-primary); }
.evo-ctx-panel-foot { margin-top: 11px; padding-top: 10px; border-top: 1px solid var(--color-border-light); display: flex; align-items: center; justify-content: space-between; }
.evo-ctx-panel-foot span:last-child { font-variant-numeric: tabular-nums; color: var(--color-text-primary); }
/* 会话统计行：与输入框同宽，位于圆角框外部正下方、水平居中、紧贴。
   不设 max-width 上限——统计项在整行宽度内挤得下就不换行，只在确实放不下时
   flex 换行（此前 75% 上限会在中间列变窄时提前换行，明明放得下也占两行）。 */
.evo-composer-stats { flex: 0 0 100%; width: 100%; max-width: none; margin: 8px auto 0; display: flex; align-items: center; gap: 10px; }
.evo-composer-stats:empty { margin: 0 auto; }
.evo-composer-stats .evo-statusbar { flex: 1 1 auto; min-width: 0; width: auto; height: auto; min-height: 16px; padding: 0; border-top: 0; background: transparent; flex-wrap: wrap; row-gap: 0; overflow: visible; white-space: normal; line-height: 16px; justify-content: center; }
/* 模型徽章：品牌色强调、输入框内右下侧（工具栏 spacer 之后、发送按钮之前），点击切换模型 */
.evo-composer-model { flex-shrink: 0; display: inline-flex; align-items: center; gap: 5px; padding: 2px 10px; border-radius: var(--r-pebble-sm); border: 1px solid color-mix(in srgb, var(--accent-sage) 55%, transparent); background: color-mix(in srgb, var(--accent-sage) 18%, var(--color-surface)); color: var(--brand); font-size: 11px; font-weight: 600; cursor: pointer; font-family: inherit; line-height: 1.5; white-space: nowrap; transition: box-shadow var(--dur-quick) var(--ease-organic), border-color var(--dur-quick) var(--ease-organic); }
.evo-composer-model:hover { border-color: var(--brand); box-shadow: 0 0 0 1px color-mix(in srgb, var(--brand) 45%, transparent); }
.evo-composer-model.evo-composer-model-open { border-color: var(--brand); box-shadow: 0 0 0 1px color-mix(in srgb, var(--brand) 45%, transparent); }
.evo-composer-model svg { width: 11px; height: 11px; flex-shrink: 0; }
.evo-composer-model-name { min-width: 0; max-width: 220px; overflow: hidden; text-overflow: ellipsis; }
.evo-composer-model-effort { min-width: 0; max-width: 160px; overflow: hidden; text-overflow: ellipsis; font-weight: 400; opacity: 0.88; }
.evo-composer-model-menu { position: fixed; z-index: 3000; width: min(400px, calc(100vw - 24px)); max-height: 440px; overflow-y: auto; padding: 6px; display: flex; flex-direction: column; gap: 4px; }
.evo-composer-model-menu-hint { padding: 4px 8px 6px; font-size: 11px; color: var(--color-text-tertiary); line-height: 1.5; }
.evo-composer-model-menu .evo-tier-option { padding: 9px 12px; gap: 5px; }
.evo-composer-model-menu .evo-setting-hint { padding: 6px 8px; font-size: 12px; }
.evo-composer-model-menu .evo-panel-error { padding: 6px 8px; font-size: 12px; }
/* 会话权限档位（输入框工具行）：仿模型徽章的胶囊下拉 */
.evo-dropdown.evo-composer-perm { display: inline-flex; width: auto; flex-shrink: 0; }
.evo-composer-perm .evo-dropdown-btn { flex-shrink: 0; display: inline-flex; align-items: center; gap: 5px; width: auto; height: auto; padding: 2px 10px; border-radius: var(--r-pebble-sm); border: 1px solid color-mix(in srgb, var(--accent-sage) 55%, transparent); background: color-mix(in srgb, var(--accent-sage) 18%, var(--color-surface)); color: var(--brand); font-size: 11px; font-weight: 600; line-height: 1.5; white-space: nowrap; }
.evo-composer-perm .evo-dropdown-btn:hover, .evo-composer-perm .evo-dropdown-btn.evo-dropdown-open { border-color: var(--brand); box-shadow: 0 0 0 1px color-mix(in srgb, var(--brand) 45%, transparent); color: var(--brand); }
.evo-composer-perm .evo-dropdown-btn svg { width: 11px; height: 11px; flex-shrink: 0; }
.evo-composer-perm .evo-dropdown-value { flex: 0 1 auto; min-width: 0; max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* 输入框状态行内的「打开方式」：紧凑幽灵胶囊（evo-dropdown 默认 width:100% 是给设置表单的，
   放在 flex 行里会撑满整行并把右侧 Markdown 开关挤到下一行）。注意：本文件是模板字符串，勿写反引号 */
.evo-dropdown.evo-composer-openin { display: inline-flex; width: auto; flex-shrink: 0; }
.evo-composer-openin .evo-dropdown-btn { flex-shrink: 0; display: inline-flex; align-items: center; gap: 4px; width: auto; height: auto; padding: 2px 7px; border: 1px solid transparent; border-radius: var(--r-pebble-sm); background: transparent; color: var(--color-text-tertiary); font-size: 11px; font-weight: 400; line-height: 1.5; white-space: nowrap; }
.evo-composer-openin .evo-dropdown-btn:hover, .evo-composer-openin .evo-dropdown-btn.evo-dropdown-open { border-color: var(--color-border-light); background: var(--hover-bg); color: var(--brand); }
.evo-composer-openin .evo-dropdown-btn svg { width: 12px; height: 12px; flex-shrink: 0; }
.evo-composer-openin .evo-dropdown-value { flex: 0 0 auto; min-width: 0; max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.evo-stats-sep { color: var(--color-border); margin-right: 8px; }
/* ── 插件清单：自适应多列（窄 1~2 列、宽屏最多 4 列），撑满可用宽度、可垂直滚动 ──
   最大高度按“最多一次性展示 10 行”计算（行高约 31px + 6px 行距）；
   内容不足 10 行时随内容收缩，不会留下大片空白，最少也展示一行。 */
.evo-plugin-list { --evo-plugin-row: 31px; display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 6px 10px; max-height: calc(var(--evo-plugin-row) * 10 + 9 * 6px); overflow-y: auto; width: 100%; align-items: stretch; }
.evo-settings-modal { display: flex; flex-direction: column; padding: 0; overflow: hidden; }
.evo-settings-head { padding: 10px 14px; border-bottom: 1px solid var(--color-border-light); }
.evo-btn-back { gap: 5px; padding: 5px 14px; font-size: 13px; }
.evo-btn-back svg { width: 15px; height: 15px; }
.evo-settings-body { display: flex; flex: 1; min-height: 0; }
.evo-settings-nav { width: 176px; flex-shrink: 0; border-right: 1px solid var(--color-border-light); padding: 10px 8px; display: flex; flex-direction: column; gap: 4px; overflow-y: auto; background-color: var(--color-background); background-image: var(--organic-grain); }
.evo-settings-tab { display: flex; align-items: center; gap: 9px; padding: 9px 12px; border: none; border-radius: var(--r-sm); background: transparent; color: var(--color-text-secondary); font-size: 13.5px; cursor: pointer; text-align: left; font: inherit; position: relative; }
.evo-settings-tab:hover { background: var(--hover-bg); }
.evo-settings-tab[data-active] { background: color-mix(in srgb, var(--brand) 8%, transparent); color: var(--brand); font-weight: 600; }
.evo-settings-tab[data-active]::before { content: ''; position: absolute; left: 0; top: 20%; bottom: 20%; width: 3px; border-radius: var(--r-2xs); background: var(--brand); }
.evo-settings-tab svg { width: 16px; height: 16px; flex-shrink: 0; }
.evo-settings-content { flex: 1; min-width: 0; overflow-y: auto; padding: 14px 16px; }
/* ── 清除数据（设置面板）：多选行 + 二次确认 ── */
.evo-clear-rows { display: flex; flex-direction: column; gap: 8px; margin: 12px 0; }
.evo-clear-row { display: flex; align-items: flex-start; gap: 10px; padding: 11px 13px; cursor: pointer; }
.evo-clear-row:hover { border-color: color-mix(in srgb, var(--brand) 35%, var(--color-border-light)); }
.evo-clear-row.checked { border-color: color-mix(in srgb, var(--color-error) 45%, var(--color-border-light)); background: color-mix(in srgb, var(--color-error) 5%, var(--color-surface)); }
.evo-clear-row input[type='checkbox'] { width: 15px; height: 15px; margin: 2px 0 0; accent-color: var(--color-error); flex-shrink: 0; cursor: pointer; }
.evo-clear-row input[type='checkbox']:disabled { cursor: not-allowed; opacity: 0.55; }
.evo-clear-row-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.evo-clear-row-title { font-size: 13px; font-weight: 600; color: var(--color-text-primary); }
.evo-clear-row-desc { font-size: 12px; line-height: 1.5; color: var(--color-text-tertiary); }
.evo-clear-row-paths, .evo-clear-summary-paths { display: flex; flex-direction: column; gap: 7px; margin-top: 9px; padding-top: 9px; border-top: 1px solid var(--color-border-light); }
.evo-clear-path-entry { display: grid; grid-template-columns: max-content minmax(0, 1fr); align-items: start; gap: 3px 8px; min-width: 0; }
.evo-clear-path-effect { color: var(--color-text-tertiary); font-size: 11px; line-height: 1.5; white-space: nowrap; }
.evo-clear-path-value { grid-column: 2; min-width: 0; color: var(--color-text-primary); font: 11.5px/1.45 var(--font-mono); overflow-wrap: anywhere; word-break: break-word; white-space: pre-wrap; }
.evo-clear-path-detail { grid-column: 2; color: var(--color-text-tertiary); font-size: 11px; line-height: 1.45; overflow-wrap: anywhere; }
.evo-clear-path-loading { margin: 12px 0; padding: 9px 11px; border: 1px dashed var(--color-border); border-radius: var(--r-sm); color: var(--color-text-tertiary); font-size: 12px; line-height: 1.5; }
.evo-clear-path-error { margin: 12px 0; line-height: 1.5; overflow-wrap: anywhere; }
.evo-clear-summary { margin: 14px 0 12px; padding: 11px 12px; border: 1px solid color-mix(in srgb, var(--color-error) 28%, var(--color-border-light)); border-radius: var(--r-sm); background: color-mix(in srgb, var(--color-error) 4%, var(--color-background)); }
.evo-clear-summary-title { color: var(--color-text-primary); font-family: var(--font-serif); font-size: 13px; font-weight: 600; line-height: 1.5; }
.evo-clear-summary-group + .evo-clear-summary-group { margin-top: 12px; }
.evo-clear-summary-label { color: var(--color-error); font-size: 11.5px; font-weight: 600; line-height: 1.5; }
.evo-clear-summary-paths { margin-top: 5px; padding-top: 0; border-top: 0; }
.evo-clear-summary-empty { border-style: dashed; color: var(--color-text-tertiary); font-size: 12px; line-height: 1.5; }
.evo-clear-confirm { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; margin-top: 2px; }
.evo-btn-danger.confirming { background: var(--color-error); color: var(--brand-foreground); }
.evo-btn-danger.confirming:hover { background: color-mix(in srgb, var(--color-error) 84%, var(--shade)); }
@media (max-width: 560px) {
  .evo-settings-nav { width: 116px; padding: 10px 6px; }
  .evo-settings-tab { gap: 5px; padding: 8px 6px; font-size: 12px; }
  .evo-settings-content { padding: 12px 10px; }
  .evo-clear-path-entry { display: block; }
  .evo-clear-path-effect, .evo-clear-path-value, .evo-clear-path-detail { display: block; }
  .evo-clear-path-effect { white-space: normal; }
  .evo-clear-path-value { margin-top: 2px; }
  .evo-clear-path-detail { margin-top: 2px; }
}
.evo-tier-grid { display: flex; flex-direction: column; gap: 12px; margin: 10px 0; }
.evo-tier-card { padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }
/* ── 模型分配（设置面板第 2 步）── */
.evo-assign-card { gap: 12px; margin-top: 10px; }
.evo-assign-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.evo-assign-head svg { width: 15px; height: 15px; color: var(--brand); flex-shrink: 0; }
.evo-assign-head-title { font-weight: 600; color: var(--color-text-primary); }
.evo-assign-head-desc { color: var(--color-text-tertiary); font-size: 12px; }
.evo-assign-tier { padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
.evo-assign-tier-head { display: flex; align-items: baseline; gap: 8px; }
.evo-assign-tier-name { font-weight: 600; font-size: 13px; color: var(--color-text-primary); }
.evo-assign-tier-desc { font-size: 12px; color: var(--color-text-tertiary); }
.evo-assign-grid { display: grid; grid-template-columns: minmax(110px, 150px) minmax(130px, 1fr) minmax(90px, 120px); gap: 10px; align-items: end; }
.evo-assign-grid.tier { grid-template-columns: minmax(110px, 150px) minmax(130px, 1fr) minmax(90px, 120px); }
.evo-assign-grid.no-reasoning { grid-template-columns: minmax(110px, 150px) minmax(130px, 1fr); }
@media (max-width: 600px) {
  .evo-assign-grid, .evo-assign-grid.tier, .evo-assign-grid.no-reasoning { grid-template-columns: 1fr; }
}
.evo-assign-grid .evo-btn { height: 28px; padding: 3px 10px; font-size: 12px; white-space: nowrap; }
.evo-assign-actions { display: flex; justify-content: flex-start; gap: 10px; }
.evo-assign-migrate { font-size: 12px; color: var(--color-warning); line-height: 1.5; }
.evo-assign-hint { font-size: 12px; color: var(--color-text-tertiary); line-height: 1.5; }
.evo-assign-test { font-size: 12px; line-height: 1.5; }
.evo-assign-test.ok { color: var(--color-success); }
.evo-assign-test.fail { color: var(--color-error); }
/* ── 模型提供商配置（§25.2 扩展）：API URL / Key / 模型推理强度 ── */
.evo-llm-providers { display: flex; flex-direction: column; gap: 12px; margin: 10px 0; }
.evo-llm-provider { padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }
.evo-llm-actions { display: flex; align-items: center; justify-content: flex-start; gap: 8px; }
.evo-llm-key-input { font-family: var(--font-mono); }
.evo-llm-add { align-self: flex-start; }
.evo-llm-new { border-style: dashed; border-color: var(--color-border); }
.evo-llm-new-grid { display: flex; flex-wrap: wrap; gap: 10px 14px; align-items: start; }
.evo-llm-new-grid .evo-setting-field { gap: 4px; }
.evo-llm-edit-grid { display: flex; flex-wrap: wrap; gap: 10px 14px; align-items: start; }
.evo-llm-edit-grid .evo-setting-field { gap: 4px; }
.evo-llm-span2 { flex: 1 1 100%; }
.evo-llm-url { flex: 1 1 320px; max-width: 480px; }
.evo-llm-key { flex: 1 1 320px; max-width: 560px; }
.evo-llm-name { flex: 0 0 200px; }
.evo-llm-id { flex: 0 0 200px; }
.evo-llm-proto { flex: 0 0 160px; }
.evo-llm-new-select { width: 100%; }
/* 设置面板的推理强度选择框：紧凑高度，避免撑开卡片留白 */
.evo-select-compact { flex: 0 0 auto; width: auto; min-width: 112px; padding: 3px 8px; font-size: 12px; border-radius: var(--r-xs); height: 28px; line-height: 20px; }
/* 主题化下拉（仿左侧搜索排序弹层）：按钮 + 自定义浮层，长列表限高滚动 */
.evo-dropdown { display: flex; width: 100%; min-width: 0; }
.evo-dropdown-btn { display: inline-flex; align-items: center; gap: 8px; width: 100%; min-width: 0; height: 28px; padding: 3px 10px; border: 1px solid var(--color-border); border-radius: var(--r-sm); background: var(--input-bg); color: var(--color-text-primary); font: inherit; font-size: 12px; line-height: 20px; cursor: pointer; transition: border-color var(--dur-quick) var(--ease-organic), color var(--dur-quick) var(--ease-organic), background-color var(--dur-quick) var(--ease-organic); }
.evo-dropdown-btn:hover, .evo-dropdown-btn.evo-dropdown-open { border-color: color-mix(in srgb, var(--brand) 55%, var(--color-border)); color: var(--brand); }
.evo-dropdown-btn svg { width: 14px; height: 14px; flex: 0 0 auto; color: var(--color-text-tertiary); }
.evo-dropdown-value { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; }
.evo-dropdown-menu { position: fixed; z-index: 3000; max-height: 280px; overflow-y: auto; padding: 5px; display: flex; flex-direction: column; gap: 1px; }
.evo-dropdown-option { min-height: 30px; padding: 6px 8px; font-size: 12px; }
.evo-dropdown-option svg { width: 14px; height: 14px; flex: 0 0 auto; }
.evo-dropdown-option span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.evo-dropdown-option-icon { width: 16px; height: 16px; flex: 0 0 auto; border-radius: var(--r-2xs); object-fit: contain; }
/* 统一「已获取模型」：胶囊卡片按字母序排列 */
.evo-llm-fetched { display: flex; flex-direction: column; gap: 10px; margin: 14px 0 2px; padding-top: 12px; border-top: 1px solid var(--color-border-light); }
.evo-llm-fetched-head { display: flex; align-items: center; gap: 8px; }
.evo-llm-fetched-title { font-size: 13px; font-weight: 600; color: var(--color-text-primary); }
.evo-llm-fetched-count { font-size: 11.5px; color: var(--color-text-tertiary); font-variant-numeric: tabular-nums; }
.evo-llm-model-pills { display: flex; flex-wrap: wrap; gap: 10px 8px; }
.evo-llm-model-pill { display: inline-flex; align-items: center; gap: 6px; max-width: 100%; padding: 3px 5px 3px 12px; border: 1px solid var(--color-border); border-radius: var(--r-pebble); background: var(--color-surface); box-shadow: var(--shadow-sm); }
/* 上下文窗口：默认态是虚框"未设置"胶囊（显示人去化的默认值），点击才变成数字输入框——
   早期直接把 262144 当 placeholder 显示，看起来像一个错误的数字（用户反馈）。 */
.evo-llm-model-ctx-chip { display: inline-flex; align-items: center; gap: 4px; padding: 1px 8px; border: 1px dashed color-mix(in srgb, var(--color-border) 90%, transparent); border-radius: var(--r-pebble-sm);
  background: transparent; color: var(--color-text-tertiary); font: inherit; font-size: 11px; line-height: 1.6; cursor: text; }
.evo-llm-model-ctx-chip[data-set] { border-style: solid; border-color: color-mix(in srgb, var(--accent-sage) 50%, transparent); background: color-mix(in srgb, var(--accent-sage) 16%, transparent); color: var(--brand); font-variant-numeric: tabular-nums; }
.evo-llm-model-ctx-chip:hover { border-color: var(--brand); color: var(--brand); }
.evo-llm-model-pill .evo-llm-model-id { flex: 0 1 auto; min-width: 0; max-width: 260px; font-family: var(--font-mono); font-size: 12px; color: var(--color-text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.evo-llm-model-n { min-width: 16px; text-align: center; font-size: 10.5px; line-height: 1; padding: 2px 5px; font-variant-numeric: tabular-nums; }
/* 胶囊内嵌上下文窗口输入：窄位数字框，留空即默认 */
.evo-llm-model-pill .evo-llm-model-ctx { flex: 0 0 auto; width: 96px; padding: 1px 8px; border: 1px solid color-mix(in srgb, var(--brand) 45%, var(--color-border)); border-radius: var(--r-pebble-sm); background: var(--color-background); font-family: var(--font-mono); font-size: 11.5px; line-height: 18px; color: var(--color-text-primary); text-align: right; box-shadow: inset 0 1px 2px color-mix(in srgb, var(--shade) 6%, transparent); }
.evo-llm-model-pill .evo-llm-model-ctx:focus { border-color: var(--brand); outline: none; }
.evo-llm-model-pill .evo-llm-model-ctx:disabled { opacity: 0.55; }
.evo-llm-model-x { flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; padding: 0; border: none; border-radius: var(--r-pill); background: transparent; color: var(--color-text-tertiary); cursor: pointer; }
.evo-llm-model-x:hover { background: var(--color-border-light); color: var(--color-text-primary); }
.evo-llm-model-x svg { width: 12px; height: 12px; }
.evo-llm-model-x:disabled { opacity: .5; cursor: default; }
.evo-tier-head { display: flex; align-items: baseline; gap: 10px; }
.evo-tier-name { font-size: 13.5px; font-weight: 600; color: var(--color-text-primary); }
.evo-tier-desc { font-size: 12px; color: var(--color-text-tertiary); }
.evo-setting-field { display: flex; flex-direction: column; gap: 4px; }
.evo-setting-field-label { font-size: 12px; color: var(--color-text-tertiary); }
.evo-plugin-row { display: flex; justify-content: space-between; gap: 10px; font-size: 12.5px; color: var(--color-text-secondary); }
.evo-plugin-state { color: var(--color-text-tertiary); font-size: 11.5px; }
.evo-plugin-state[data-active] { color: var(--brand); }
.evo-plugin-state[data-failed] { color: var(--color-error); font-weight: 600; }
.evo-plugin-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 5px 10px; border: 1px solid var(--color-border-light); border-radius: var(--r-sm); background: var(--color-surface); }
.evo-plugin-main { display: flex; align-items: baseline; gap: 8px; min-width: 0; flex: 1; }
.evo-plugin-id { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: var(--color-text-primary); font-family: var(--font-mono); }
.evo-plugin-version { flex: none; color: var(--color-text-tertiary); font: 11px/1.4 var(--font-mono); white-space: nowrap; }
.evo-plugin-state { font-size: 10.5px; color: var(--color-text-tertiary); flex-shrink: 0; }
.evo-plugin-ok { color: var(--color-success); }
/* ── 消息复制 / 编辑 / 回溯（气泡侧边操作行）──
   悬停时按钮出现在气泡旁的空白侧边（AI 消息在右、用户消息在左镜像），按钮底边
   与气泡底边对齐；绝对定位不占布局空间。操作行 DOM 置于气泡内、以气泡为定位基准。
   感应范围 = 气泡 AABB ∪ 直角梯形 ∪ 按钮 AABB：梯形（.evo-msg-bubble::after，
   clip-path 裁剪即命中边界）从气泡侧边全高收敛到按钮高度、底边平齐，把「消息框
   侧边—按钮外缘」之间的过渡区纳入感应；三者都是气泡子树，气泡 :hover 即覆盖
   整个并集，行内气泡之外的空白不触发，鼠标离区按钮立即消失。纯 :hover 位置
   驱动、与点击无关；键盘聚焦（:focus-visible）同样浮现。 */
.evo-msg-stack { display: flex; flex-direction: column; align-items: flex-start; gap: 3px; min-width: 0; max-width: 100%; position: relative; }
.evo-msg-user .evo-msg-stack { align-items: flex-end; gap: 2px; }
.evo-msg-author { padding: 0 3px; color: var(--color-text-tertiary); font-size: 11px; line-height: 1.2; }
.evo-msg-meta { position: absolute; bottom: 0; left: calc(100% + 8px); z-index: 6; display: flex; align-items: center; flex-wrap: nowrap; gap: 2px; white-space: nowrap; opacity: 0; pointer-events: none; transition: opacity 0.12s ease; }
.evo-msg-user .evo-msg-meta { left: auto; right: calc(100% + 8px); }
.evo-msg-bubble:hover .evo-msg-meta, .evo-msg-meta:has(:focus-visible) { opacity: 1; pointer-events: auto; }
.evo-msg-bubble::after { content: ''; position: absolute; top: 0; bottom: 0; left: calc(100% - 2px); width: 34px; clip-path: polygon(0 0, 100% calc(100% - 26px), 100% 100%, 0 100%); }
.evo-msg-user .evo-msg-bubble::after { left: auto; right: calc(100% - 2px); width: 150px; clip-path: polygon(0 calc(100% - 26px), 100% 0, 100% 100%, 0 100%); }
.evo-msg-meta .evo-msg-time { font-size: 10.5px; color: var(--color-text-tertiary); margin-top: 0; margin-right: 3px; white-space: nowrap; flex-shrink: 0; }
.evo-msg-copy { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border: none; background: none; color: var(--color-text-tertiary); border-radius: var(--r-pebble-sm); cursor: pointer; padding: 0; }
.evo-msg-copy:hover { background: var(--hover-bg); color: var(--brand); }
.evo-msg-copy.confirming { background: color-mix(in srgb, var(--color-warning) 18%, transparent); color: var(--color-warning); }
.evo-msg-copy svg { width: 14px; height: 14px; }
/* ── Agents 树（Inspector）── */
.evo-insp-subtab-title { font-size: 11.5px; font-weight: 600; color: var(--color-text-tertiary); letter-spacing: 0.3px; text-transform: uppercase; padding: 2px 4px; }
.evo-agent-list { display: flex; flex-direction: column; gap: 2px; padding: 4px 6px 12px; }
.evo-agent-row { display: flex; align-items: center; gap: 7px; padding: 5px 8px; border-radius: var(--r-xs); font-size: 12.5px; color: var(--color-text-secondary); }
.evo-agent-row:hover { background: var(--hover-bg); }
.evo-agent-chevron { width: 13px; height: 13px; color: var(--color-text-tertiary); flex-shrink: 0; }
.evo-agent-chevron-empty { display: inline-block; }
.evo-agent-dot { width: 7px; height: 7px; border-radius: var(--r-dot); background: var(--color-border); flex-shrink: 0; }
.evo-agent-dot.running { background: var(--color-success); box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-success) 22%, transparent); }
.evo-agent-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--color-text-primary); }
.evo-agent-mode { padding: 1px 8px; font-size: 10px; }
.evo-agent-mode.continuable { background: color-mix(in srgb, var(--brand) 14%, transparent); color: var(--brand); }
.evo-agent-activity { font-size: 10.5px; color: var(--color-success); flex-shrink: 0; }
/* ── Research Skills ── */
.evo-skill-tabs { display: flex; gap: 6px; flex-wrap: wrap; }
.evo-skill-card { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; }
.evo-skill-head { display: flex; align-items: center; gap: 8px; }
.evo-skill-status { padding: 1px 9px; font-size: 10.5px; text-transform: capitalize; }
.evo-skill-status.pending { color: var(--color-warning); }
.evo-skill-status.approved { color: var(--color-success); }
.evo-skill-status.rejected { color: var(--color-error); }
.evo-skill-action { padding: 1px 8px; border-radius: var(--r-pill); font-size: 10.5px; background: color-mix(in srgb, var(--brand) 14%, transparent); color: var(--brand); flex-shrink: 0; }
.evo-skill-desc { font-size: 12.5px; color: var(--color-text-secondary); line-height: 1.55; }
.evo-skill-src { font-size: 11px; color: var(--color-text-tertiary); }
.evo-skill-actions { display: flex; gap: 8px; margin-top: 2px; }
.evo-btn { gap: 6px; padding: 5px 14px; }
.evo-btn svg { width: 13px; height: 13px; }
/* ── Chat Graph（§ChatGraph：节点/连线画布；视觉评审优化版）── */
.evo-graph { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.evo-graph-toolbar { display: flex; align-items: center; gap: 6px; padding: 8px 14px; border-bottom: 1px solid var(--color-border); flex-shrink: 0; }
.evo-graph-title { font-family: var(--font-serif); font-size: 14px; font-weight: 600; color: var(--color-text-primary); letter-spacing: -.01em; }
.evo-graph-btn { gap: 5px; padding: 5px 11px; font-size: 12px; white-space: nowrap; flex-shrink: 0; }
.evo-graph-btn svg { width: 13px; height: 13px; }
.evo-graph-btn .evo-graph-btn-label { display: none; }
.evo-graph-btn.has-label .evo-graph-btn-label { display: inline; }
/* 画布打底：暖纸面（暗色深壤土）+ CSS 绘制的倾斜椭圆光斑（::before，径向）。
   光斑按主题着色：浅色鼠尾草、深色暖沙（自然有机风的阳光透过叶隙层次）。
   点阵由 xyflow Background 默认参数（gap 20 / size 1）绘制并随视口平移。 */
.evo-graph-canvas { position: relative; flex: 1; min-height: 300px; overflow: hidden; background-color: var(--graph-canvas); }
.evo-graph-canvas::before { content: ''; position: absolute; left: 65%; top: 50%; width: 85%; height: 60%; transform: translate(-50%, -50%) rotate(-18deg); border-radius: var(--r-dot); background: radial-gradient(closest-side, var(--graph-glow-core), var(--graph-glow-mid) 52%, transparent 100%); pointer-events: none; z-index: 0; }
.evo-graph-canvas .react-flow { position: absolute; inset: 0; direction: ltr; background: transparent; z-index: 1; }
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
/* 端点（handle/socket）：10px 土色圆点（--graph-handle，blob 形状）、无边框无阴影、
   无 hover 视觉；圆心压在卡片边线上（±5px 偏移 + 垂直居中）。 */
.evo-graph-canvas .react-flow__handle { width: 10px; height: 10px; min-width: 10px; min-height: 10px; border-radius: var(--r-dot); border: none; background: var(--graph-handle); box-shadow: none; }
.evo-graph-canvas .react-flow__handle-left { left: -5px; }
.evo-graph-canvas .react-flow__handle-right { right: -5px; }
.evo-graph-canvas .react-flow__controls { overflow: hidden; border: 1px solid var(--graph-control-border); border-radius: var(--r-sm); box-shadow: var(--shadow-sm); }
.evo-graph-canvas .react-flow__controls-button { width: 26px; height: 26px; border: 0; border-bottom: 1px solid var(--graph-control-border); background: var(--graph-control); color: var(--color-text-primary); fill: var(--color-text-primary); }
.evo-graph-canvas .react-flow__controls-button:last-child { border-bottom: 0; }
/* MiniMap：左下角，默认隐藏，图标按钮切换（按钮 26×26，与 Controls 同规格） */
.evo-graph-canvas .react-flow__minimap.react-flow__panel { left: 12px; right: auto; bottom: 12px; top: auto; margin: 0; transform: none; overflow: hidden; border: 1px solid var(--graph-control-border); border-radius: var(--r-sm); background: var(--graph-minimap); box-shadow: var(--shadow-md); }
.evo-graph-minimap-toggle { position: absolute; z-index: 6; display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; padding: 0; border: 1px solid var(--graph-control-border); border-radius: var(--r-sm); background: var(--graph-control); color: var(--color-text-secondary); cursor: pointer; font: inherit; box-shadow: var(--shadow-sm); transition: color 0.15s, border-color 0.15s; }
.evo-graph-minimap-toggle:hover { color: var(--brand); border-color: var(--brand); }
.evo-graph-minimap-toggle svg { width: 14px; height: 14px; }
.evo-graph-minimap-toggle[aria-pressed='true'] { color: var(--brand); border-color: color-mix(in srgb, var(--brand) 45%, transparent); background: color-mix(in srgb, var(--brand) 8%, var(--graph-control)); }
/* 图例（Legend）：右下角 Info 按钮 + 悬浮说明卡（与右键菜单同语言） */
.evo-graph-legend-toggle { position: absolute; z-index: 6; right: 12px; bottom: 96px; display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; padding: 0; border: 1px solid var(--graph-control-border); border-radius: var(--r-sm); background: var(--graph-control); color: var(--color-text-secondary); cursor: pointer; font: inherit; box-shadow: var(--shadow-sm); transition: color 0.15s, border-color 0.15s; }
.evo-graph-legend-toggle:hover, .evo-graph-legend-toggle[aria-pressed='true'] { color: var(--brand); border-color: var(--brand); }
.evo-graph-legend-toggle svg { width: 14px; height: 14px; }
.evo-graph-legend { position: absolute; z-index: 7; width: min(340px, calc(100% - 24px)); max-height: min(430px, 72%); overflow: auto; padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; }
.evo-graph-legend-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.evo-graph-legend-head strong { font-size: 12.5px; color: var(--color-text-primary); }
.evo-graph-legend-close { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; padding: 0; border: none; border-radius: var(--r-pebble-sm); background: none; color: var(--color-text-tertiary); cursor: pointer; font-size: 12px; }
.evo-graph-legend-close:hover { background: var(--hover-bg); color: var(--color-text-primary); }
.evo-graph-legend-note { font-size: 11px; color: var(--color-text-tertiary); margin-top: 2px; }
.evo-graph-legend-row { display: flex; align-items: center; gap: 9px; min-width: 0; }
.evo-graph-legend-text { font-size: 12px; line-height: 15px; color: var(--color-text-secondary); min-width: 0; }
.evo-graph-legend-sample { position: relative; flex-shrink: 0; width: 30px; height: 0; border-top: 2.2px solid var(--graph-reference); border-radius: var(--r-2xs); }
.evo-graph-legend-sample::after { content: ''; position: absolute; right: -2px; top: -3.6px; border-left: 6px solid var(--graph-reference); border-top: 3.4px solid transparent; border-bottom: 3.4px solid transparent; }
.evo-graph-legend-sample.sample-system { opacity: 0.45; }
.evo-graph-legend-sample.sample-hit { border-top-style: dashed; animation: evo-legend-hit 1.6s ease-in-out infinite; }
.evo-graph-legend-sample.sample-write { border-top-color: var(--graph-write); }
.evo-graph-legend-sample.sample-write::after { border-left-color: var(--graph-write); }
.evo-graph-legend-sample.sample-fork { border-top-color: var(--graph-fork); }
.evo-graph-legend-sample.sample-fork::after { border-left-color: var(--graph-fork); }
@keyframes evo-legend-hit { 0%, 100% { opacity: 1; } 50% { opacity: 0.25; } }
.evo-graph-legend-chip { flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; min-width: 30px; height: 18px; padding: 0 5px; border-radius: var(--r-2xs); font-size: 10px; }
.evo-graph-legend-chip.chip-chat { border: 1px solid var(--graph-fork); color: var(--graph-fork); background: color-mix(in srgb, var(--graph-fork) 8%, transparent); }
.evo-graph-legend-chip.chip-memory { border: 1px solid var(--graph-reference); color: var(--graph-reference); background: color-mix(in srgb, var(--graph-reference) 8%, transparent); }
.evo-graph-legend-chip.chip-empty { border: 1px dashed var(--color-border); color: var(--color-text-tertiary); background: none; }
.evo-graph-legend-tips { margin-top: 2px; padding-top: 7px; border-top: 1px solid var(--color-border); font-size: 11px; color: var(--color-text-tertiary); }
/* 连线：描边走 --graph-edge-default（土色）经 BaseEdge 内联样式给出（hover/选中不改变颜色）；
   虚线流动由 edge.animated + xyflow 基础 CSS 驱动：
   .react-flow__edge.animated path { stroke-dasharray: 5; animation: .5s linear infinite dashdraw }。
   transition-opacity duration-400 挂在 g 层（evo-edge-fade / evo-node-fade）。 */
.react-flow__edge.evo-edge-fade, .react-flow__node.evo-node-fade { transition: opacity 0.4s cubic-bezier(0.4, 0, 0.2, 1); }
.evo-graph-edge-disabled { opacity: 0.35; }
/* 虚线流速：官网 0.5s 的两倍速（用户要求） */
.evo-graph-canvas .react-flow__edge.animated path,
.evo-graph-canvas .react-flow__connection .animated { animation-duration: 0.25s; }
.evo-graph-canvas .react-flow__node .evo-graph-node { position: relative; left: auto; top: auto; }
/* socket 标签/连线标签坐标由 JSX 内联样式给出（相对节点根定位），这里不再覆盖。 */
.evo-graph-canvas .evo-graph-node > .evo-graph-node-body { position: static; }
.evo-graph-canvas .react-flow__edge-textbg { fill: var(--graph-node-surface-alt); }
.evo-graph-canvas .react-flow__edge-text { fill: var(--graph-edge-label); font-size: 10px; }
/* 节点卡片：暖纸面 70% + 土色描边 + 20px 有机圆角 + 轻土色投影；无 hover 变色；
   选中仅 0.5px 发丝环（xyflow 默认选中语言），拖拽仅提层。 */
.evo-graph-node { position: absolute; background: color-mix(in srgb, var(--graph-node-surface) 70%, transparent); border: 1px solid var(--graph-node-border); border-radius: var(--graph-node-radius); padding: 0; cursor: grab; user-select: none; box-shadow: var(--graph-card-shadow); transition: opacity 0.4s cubic-bezier(0.4, 0, 0.2, 1); display: flex; flex-direction: column; }
.evo-graph-node-sel { box-shadow: var(--graph-card-shadow), 0 0 0 0.5px var(--graph-node-title); }
.evo-graph-node[data-pinned] { box-shadow: 0 0 0 1px color-mix(in srgb, var(--graph-trace) 42%, transparent), var(--graph-card-shadow); }
.evo-graph-node-dragging { z-index: 30; cursor: grabbing; }
/* 标题条：px-3 py-2（8px 12px）、font-mono text-xs(12px) font-semibold、土色下边框、上圆角随卡片。 */
.evo-graph-node-titlebar { display: flex; align-items: center; gap: 7px; padding: 8px 12px; flex-shrink: 0; border-bottom: 1px solid var(--graph-node-border); border-radius: var(--graph-node-radius) var(--graph-node-radius) 0 0; }
.evo-graph-node-resource { border-style: solid; }
.evo-graph-node[data-status='missing'], .evo-graph-node[data-status='failed'] { border-color: var(--graph-status-missing); }
.evo-graph-node[data-status='running'], .evo-graph-node[data-status='indexing'] { border-color: var(--graph-status-running); }
.evo-graph-node-candidate { border-style: dashed; border-color: var(--graph-candidate); }
.evo-graph-node-trace::after { content: '本轮已读取'; position: absolute; right: 6px; bottom: 4px; padding: 1px 4px; border-radius: var(--r-2xs); background: color-mix(in srgb, var(--graph-trace) 16%, var(--graph-node-surface)); color: var(--graph-trace); font-size: 8px; line-height: 1.2; font-family: var(--graph-font-mono); }
.evo-graph-node-icon { display: inline-flex; align-items: center; justify-content: center; width: 13px; height: 13px; flex-shrink: 0; }
.evo-graph-node-chat .evo-graph-node-icon { color: var(--graph-chat); }
.evo-graph-node-memory .evo-graph-node-icon { color: var(--graph-memory); }
.evo-graph-node-memory[data-global] .evo-graph-node-icon { color: var(--graph-global); }
.evo-graph-node-resource .evo-graph-node-icon { color: var(--graph-resource); }
.evo-graph-node-icon svg { width: 11px; height: 11px; }
.evo-graph-node-kind { flex: 1; min-width: 0; font-family: var(--graph-font-mono); font-size: 12px; font-weight: 600; color: var(--graph-node-title); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.evo-graph-node-headermeta { display: inline-flex; align-items: center; gap: 4px; margin-left: auto; flex-shrink: 0; }
.evo-graph-node-candidate-badge { padding: 1px 6px; border-radius: var(--r-pill); border: 1px solid color-mix(in srgb, var(--graph-candidate) 45%, transparent); color: var(--graph-candidate); font-size: 8.5px; line-height: 1.3; font-family: var(--graph-font-mono); white-space: nowrap; }
.evo-graph-node-scopechip { padding: 1px 6px; border-radius: var(--r-pill); background: color-mix(in srgb, var(--graph-global) 12%, transparent); color: var(--graph-global); font-size: 8.5px; line-height: 1.3; font-family: var(--graph-font-mono); white-space: nowrap; }
/* 标题移入主体：12px/16px 半粗，ellipsis 截断。 */
.evo-graph-node-title { flex: 0 1 auto; font-size: 12px; font-weight: 600; line-height: 16px; color: var(--graph-node-title); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
/* 主体：实色暖纸面、下圆角随卡片、p-3(12px)。 */
.evo-graph-node-body { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 4px; padding: 12px; min-width: 0; background: var(--graph-node-surface); border-radius: 0 0 var(--graph-node-radius) var(--graph-node-radius); overflow: hidden; }
.evo-graph-socket-row { display: flex; align-items: center; gap: 6px; min-width: 0; }
.evo-graph-socket-row-out { margin-top: 1px; }
/* socket：颜色/几何与 .react-flow__handle 规则一致 */
.evo-graph-socket { width: 10px; height: 10px; border-radius: var(--r-dot); border: none; background: var(--graph-handle); cursor: crosshair; flex-shrink: 0; box-shadow: none; }
/* 节点缩放：手柄默认隐形——光标悬到角落变成缩放指针即提示。
   xyflow 把手柄中心放在包围盒直角点上（比圆角弧线外凸约 r(√2−1)≈6.6px），
   视觉上「直角凸出的空白区」会误触发；内移 5px 让命中区中心落在圆角曲线上，
   悬停真正的圆角边缘才出现缩放光标与倒角三角（包围盒外凸角点恰好移出命中圆）。 */
.evo-graph-canvas .react-flow__resize-control { z-index: 30; }
.evo-graph-canvas .react-flow__resize-control.handle { width: 10px; height: 10px; border-radius: var(--r-dot); background: transparent; border: none; box-shadow: none; }
.evo-graph-canvas .react-flow__resize-control.handle.top.left { transform: translate(4.7px, 4.7px); }
.evo-graph-canvas .react-flow__resize-control.handle.top.right { transform: translate(-4.7px, 4.7px); }
.evo-graph-canvas .react-flow__resize-control.handle.bottom.left { transform: translate(4.7px, -4.7px); }
.evo-graph-canvas .react-flow__resize-control.handle.bottom.right { transform: translate(-4.7px, -4.7px); }
/* 边线控件（选中时的矩形描边）整体隐藏：它会在四个圆角处露出线框三角形缺口 */
.evo-graph-canvas .react-flow__resize-control.line { display: none; }
/* 角落缩放提示（内侧倒角三角）：悬停某角手柄时，该角淡入节点类型色的直角三角形。
   颜色：跟随节点图标同款类型色（chat 蓝 / memory 绿 / 全局 memory 紫），半透明融入卡片。
   几何：块 21×21、圆角 = --graph-node-radius（必须与卡片圆角同源，否则外弧与卡片边缘错位）、
   外扩 1px 顶到卡片边框外沿。圆心恒为卡片角内 (半径, 半径) 与外圆角曲线同心同径 →
   三角外弧就是卡片最外沿本身，与选中描边环严丝合缝，零间隙；
   斜边腿长 21px > 半径 → 两腿沿卡片边缘、斜边平直、外角沿圆弧的厚实倒角三角。
   悬停透明度 0.7（与卡片 70% 半透明表面同一语言，描边在外层仍隐约可读）。
   拖拽缩放进行中：按下的手柄在松开前始终匹配 :active（指针甩离手柄也一样），
   因此 :active 分支保证被拖角的倒角全程常显——不依赖 :hover、无需 JS 状态。
   常态与聚焦态完全不显示；只亮一个角。 */
.evo-resize-chamfer { position: absolute; width: 21px; height: 21px; background: var(--graph-chat); opacity: 0; transition: opacity 0.12s; pointer-events: none; z-index: 6; }
.evo-graph-node-memory .evo-resize-chamfer { background: var(--graph-memory); }
.evo-graph-node-memory[data-global] .evo-resize-chamfer { background: var(--graph-global); }
.evo-graph-node:has(.react-flow__resize-control.handle.top.left:hover) .evo-resize-chamfer-tl,
.evo-graph-node:has(.react-flow__resize-control.handle.top.left:active) .evo-resize-chamfer-tl,
.evo-graph-node:has(.react-flow__resize-control.handle.top.right:hover) .evo-resize-chamfer-tr,
.evo-graph-node:has(.react-flow__resize-control.handle.top.right:active) .evo-resize-chamfer-tr,
.evo-graph-node:has(.react-flow__resize-control.handle.bottom.left:hover) .evo-resize-chamfer-bl,
.evo-graph-node:has(.react-flow__resize-control.handle.bottom.left:active) .evo-resize-chamfer-bl,
.evo-graph-node:has(.react-flow__resize-control.handle.bottom.right:hover) .evo-resize-chamfer-br,
.evo-graph-node:has(.react-flow__resize-control.handle.bottom.right:active) .evo-resize-chamfer-br { opacity: 0.7; }
.evo-resize-chamfer-tl { top: -1px; left: -1px; border-top-left-radius: var(--graph-node-radius); clip-path: polygon(0 0, 100% 0, 0 100%); }
.evo-resize-chamfer-tr { top: -1px; right: -1px; border-top-right-radius: var(--graph-node-radius); clip-path: polygon(0 0, 100% 0, 100% 100%); }
.evo-resize-chamfer-bl { bottom: -1px; left: -1px; border-bottom-left-radius: var(--graph-node-radius); clip-path: polygon(0 0, 0 100%, 100% 100%); }
.evo-resize-chamfer-br { bottom: -1px; right: -1px; border-bottom-right-radius: var(--graph-node-radius); clip-path: polygon(100% 0, 100% 100%, 0 100%); }
/* 端口小字默认隐藏（避免常驻遮挡连线走向），悬停该节点时才浮现；键盘 Tab 导航（focus-visible）同样显示 */
.evo-graph-socket-label { font-size: 10px; letter-spacing: 0.2px; color: var(--graph-muted); white-space: nowrap; opacity: 0; visibility: hidden; transition: opacity 0.12s ease, visibility 0.12s ease; pointer-events: none; background: var(--graph-node-surface); border: 1px solid var(--graph-control-border); border-radius: var(--r-2xs); padding: 0 4px; }
.evo-graph-node:hover .evo-graph-socket-label, .evo-graph-node:has(:focus-visible) .evo-graph-socket-label { opacity: 1; visibility: visible; color: var(--color-text-secondary); }
.evo-graph-node-sid { font-size: 12px; line-height: 16px; color: var(--graph-muted); font-family: var(--graph-font-mono); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.evo-graph-node-preview { font-size: 12px; line-height: 16px; color: var(--graph-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
/* 连线：平滑贝塞尔；类型色仅保留 fork/引用/关系三类语义 */
/* 连线类型类（evo-graph-edge-ctx/mem/relation）仅供脚本计数与语义标注，
   颜色/线宽全部经 BaseEdge 内联样式给出（与节点卡片同源 token）。 */
.evo-graph-edge-label-hidden { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
.evo-graph-edge-linking { stroke: var(--graph-trace); stroke-dasharray: 6 4; stroke-width: 2.2px; }
/* 右键菜单：与面板同语言 */
.evo-graph-menu { position: absolute; z-index: 50; min-width: 180px; padding: 5px; display: flex; flex-direction: column; gap: 2px; }
.evo-graph-menu-item { padding: 7px 10px; }
.evo-graph-menu-item:disabled { opacity: 0.45; cursor: not-allowed; }
.evo-graph-menu-item svg { width: 13px; height: 13px; color: var(--color-text-tertiary); }
.evo-graph-menu-danger { color: var(--color-error); }
.evo-graph-menu-danger svg { color: var(--color-error); }
.evo-graph-hint { padding: 18px 16px; display: flex; flex-direction: column; align-items: center; gap: 8px; color: var(--color-text-tertiary); font-size: 12.5px; text-align: center; line-height: 1.6; }
.evo-graph-hint svg { width: 34px; height: 34px; color: var(--color-border); }
/* compound group：标题是原生按钮，折叠不依赖颜色或精确点击坐标 */
.evo-graph-group { position: relative; width: 100%; height: 100%; overflow: visible; border: 1px solid color-mix(in srgb, var(--graph-global) 45%, var(--graph-node-border)); border-radius: var(--graph-node-radius); background: color-mix(in srgb, var(--graph-node-surface) 55%, transparent); box-shadow: var(--graph-card-shadow); pointer-events: all; }
.evo-graph-group-experiment { border-color: color-mix(in srgb, var(--graph-resource) 65%, var(--graph-node-border)); background: color-mix(in srgb, var(--graph-resource) 8%, transparent); }
.evo-graph-group-exploration { border-color: color-mix(in srgb, var(--graph-candidate) 65%, var(--graph-node-border)); background: color-mix(in srgb, var(--graph-candidate) 8%, transparent); }
.evo-graph-group.collapsed { background: color-mix(in srgb, var(--graph-global) 16%, var(--graph-node-surface)); box-shadow: var(--shadow-md); }
.evo-graph-group-header { display: flex; align-items: center; gap: 6px; min-height: 30px; padding: 3px 5px 3px 8px; }
.evo-graph-group-toggle { display: inline-flex; align-items: center; min-width: 0; flex: 1; padding: 3px 5px; border: 0; border-radius: var(--r-2xs); background: transparent; color: var(--color-text-primary); cursor: pointer; font: inherit; text-align: left; }
.evo-graph-group-toggle:hover { background: color-mix(in srgb, var(--brand) 10%, transparent); }
.evo-graph-group-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; font-weight: 650; font-family: var(--graph-font-mono); }
.evo-graph-group-count { flex: 0 0 auto; min-width: 20px; padding: 1px 5px; border-radius: var(--r-pill); background: color-mix(in srgb, var(--color-text-primary) 10%, transparent); color: var(--color-text-secondary); font-size: 10px; text-align: center; }
/* 记忆节点内容编辑弹窗 */
.evo-graph-editor-mask { position: fixed; inset: 0; z-index: 80; background: var(--scrim); display: flex; align-items: center; justify-content: center; }
.evo-graph-editor { width: min(520px, calc(100vw - 48px)); display: flex; flex-direction: column; padding: 12px; gap: 10px; }
.evo-graph-editor-head { display: flex; align-items: center; gap: 8px; }
.evo-graph-editor-title { font-size: 13.5px; font-weight: 600; color: var(--color-text-primary); }
.evo-graph-editor-text { width: 100%; min-height: 140px; max-height: 50vh; resize: vertical; padding: 9px 11px; font-size: 13px; line-height: 1.5; }
.evo-graph-editor-foot { display: flex; align-items: center; gap: 8px; }
.evo-graph-editor-hint { font-size: 11px; color: var(--color-text-tertiary); }
/* GRAPH-04/08：引用节点展示（图标 + 文件名 + 实时预览） */
.evo-graph-node-ref-icon { width: 12px; height: 12px; color: var(--color-text-secondary); flex-shrink: 0; }
.evo-graph-node-ref-name { font-size: 12px; line-height: 16px; color: var(--graph-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.evo-graph-node-preview-muted { color: var(--color-text-tertiary); }
.evo-graph-node-preview-err { color: var(--graph-status-missing); }
/* GRAPH-11：工具栏节点搜索框 */
.evo-graph-search { display: inline-flex; align-items: center; gap: 6px; padding: 4px 11px; color: var(--color-text-tertiary); }
.evo-graph-search svg { width: 12px; height: 12px; flex-shrink: 0; }
.evo-graph-search input { border: none; outline: none; background: none; color: var(--color-text-primary); font-size: 12px; width: 130px; font: inherit; }
.evo-graph-search input::placeholder { color: var(--color-text-tertiary); }
/* GRAPH-07：连线说明文字（svg text；描边底保证可读） */
.evo-graph-edge-label { min-width: 52px; max-width: 280px; padding: 2px 5px; border: 1px solid color-mix(in srgb, var(--graph-edge-label) 22%, transparent); border-radius: var(--r-2xs); background: color-mix(in srgb, var(--graph-node-surface) 94%, transparent); color: var(--graph-edge-label); font-size: 10px; line-height: 1.25; white-space: normal; overflow-wrap: anywhere; word-break: break-word; pointer-events: none; user-select: none; box-shadow: var(--shadow-sm); }
/* GRAPH-07/09：连线可右键（编辑说明/删除）；svg 层 pointer-events:none，仅 path 命中 stroke */
.evo-graph-edge-hit { pointer-events: stroke; cursor: pointer; }
.evo-graph-edge-hit:hover { filter: brightness(1.35); }
/* ── ChatGraph v2：写线（橙）/ 系统默认连线（同色细半透明）/ 双向平行线 ──
   颜色仍由 BaseEdge 内联样式给出（--graph-write）；此处只做透明度/徽标等补充语义。 */
.evo-graph-edge-system { opacity: 0.45; }
.evo-graph-edge-badge { position: absolute; padding: 1px 6px; border: 1px solid color-mix(in srgb, var(--graph-write) 42%, transparent); border-radius: var(--r-pill); background: color-mix(in srgb, var(--graph-node-surface) 92%, transparent); color: var(--graph-write); font-size: 9px; line-height: 1.4; font-family: var(--graph-font-mono); white-space: nowrap; pointer-events: none; user-select: none; }
/* 命中脉冲：这份记忆这一轮真的被读到了——流动发光约 2 秒后消退（纯 CSS，不持久化） */
@keyframes evo-graph-hit-pulse {
  0% { box-shadow: var(--graph-card-shadow), 0 0 0 0 color-mix(in srgb, var(--graph-trace) 55%, transparent); }
  70% { box-shadow: var(--graph-card-shadow), 0 0 0 12px transparent; }
  100% { box-shadow: var(--graph-card-shadow), 0 0 0 0 transparent; }
}
.evo-graph-node-hit { animation: evo-graph-hit-pulse 2s ease-out; border-color: color-mix(in srgb, var(--graph-trace) 55%, var(--graph-node-border)); }
/* 常驻节点空态：同款卡片淡样式 + "空"角标（点击可创建内容） */
.evo-graph-node-empty { border-style: dashed; opacity: 0.62; }
.evo-graph-node-empty-chip { padding: 1px 6px; border-radius: var(--r-pill); border: 1px dashed color-mix(in srgb, var(--graph-muted) 55%, transparent); color: var(--graph-muted); font-size: 8.5px; line-height: 1.3; font-family: var(--graph-font-mono); white-space: nowrap; }
/* 节点小徽标（收纳的系统连线数 / 压缩次数 / 最后活跃） */
.evo-graph-node-badge { padding: 1px 5px; border-radius: var(--r-pill); background: color-mix(in srgb, var(--graph-muted) 14%, transparent); color: var(--graph-muted); font-size: 8.5px; line-height: 1.3; font-family: var(--graph-font-mono); white-space: nowrap; }
.evo-graph-node-badge-warn { color: var(--graph-trace); background: color-mix(in srgb, var(--graph-trace) 12%, transparent); }
/* 写线落点：不可见输入端口（拖 chat → memory 建沉淀通道；不新增可见元素） */
.evo-graph-socket-ghost { opacity: 0; }
/* 右键菜单分组：小节标题 / 分隔线 / 辅注（"由系统自动生成"） / 长列表滚动 */
.evo-graph-menu-title { padding: 4px 10px 2px; font-size: 10px; letter-spacing: 0.4px; color: var(--color-text-tertiary); }
.evo-graph-menu-sep { height: 1px; margin: 4px 6px; background: var(--color-border); flex-shrink: 0; }
.evo-graph-menu-note { margin-left: auto; font-size: 10px; color: var(--color-text-tertiary); white-space: nowrap; }
.evo-graph-menu-scroll { max-height: 300px; overflow-y: auto; }
/* 上下文体检卡（Inspector 内；机制词只出现在"给想深究的人"折叠区） */
.evo-graph-health { margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--color-border); display: flex; flex-direction: column; gap: 8px; font-size: 11px; }
.evo-graph-health-head { display: flex; align-items: center; gap: 6px; }
.evo-graph-health-head strong { font-size: 12px; color: var(--color-text-primary); }
.evo-graph-health-time { color: var(--color-text-tertiary); font-size: 10px; }
.evo-graph-health-empty { color: var(--color-text-tertiary); }
.evo-graph-health-section { display: flex; flex-direction: column; gap: 3px; }
.evo-graph-health-section > span { font-weight: 600; color: var(--color-text-secondary); }
.evo-graph-health-row { display: flex; align-items: baseline; justify-content: space-between; gap: 6px; }
.evo-graph-health-row-main { min-width: 0; color: var(--color-text-secondary); overflow-wrap: anywhere; }
.evo-graph-health-row-meta { flex-shrink: 0; color: var(--color-text-tertiary); font-size: 10px; }
.evo-graph-health-hit { border: 1px solid var(--color-border); border-radius: var(--r-xs); padding: 4px 8px; background: var(--color-background); color: var(--color-text-primary); cursor: pointer; font: inherit; font-size: 11px; text-align: left; overflow-wrap: anywhere; }
.evo-graph-health-hit:hover { border-color: var(--brand); color: var(--brand); }
.evo-graph-health-deep summary { cursor: pointer; color: var(--color-text-tertiary); font-size: 10.5px; }
.evo-graph-health-deep pre { max-height: 180px; overflow: auto; margin: 6px 0 0; padding: 6px; border-radius: var(--r-xs); background: var(--color-background); color: var(--color-text-secondary); font-size: 10px; line-height: 1.5; white-space: pre-wrap; word-break: break-all; }
/* GRAPH-04/08：引用只读预览弹窗 */
.evo-graph-viewer { width: min(640px, calc(100vw - 48px)); }
.evo-graph-viewer-path { font-size: 11px; color: var(--color-text-tertiary); font-family: var(--font-mono); margin-left: 8px; }
.evo-graph-viewer-text { width: 100%; min-height: 180px; max-height: 55vh; overflow: auto; margin: 0; padding: 9px 11px; border: 1px solid var(--color-border); border-radius: var(--r-sm); background: var(--color-background); color: var(--color-text-primary); font-size: 12px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; }
.evo-graph-viewer-error { width: 100%; padding: 14px 11px; border: 1px solid color-mix(in srgb, var(--color-error) 40%, var(--color-border)); border-radius: var(--r-sm); background: color-mix(in srgb, var(--color-error) 8%, var(--color-background)); color: var(--color-error); font-size: 12.5px; }
.evo-graph-narrow-list { display: none; }
@media (max-width: 819px) {
  .evo-graph-narrow-list { display: block; min-height: 100%; background: var(--color-surface); }
}
.evo-graph-narrow-item { width: 100%; display: flex; align-items: center; gap: 8px; min-height: 42px; padding: 8px 10px; border: 0; border-bottom: 1px solid var(--color-border); background: var(--color-surface); color: var(--color-text-primary); text-align: left; font: inherit; }
.evo-graph-narrow-item.active { background: color-mix(in srgb, var(--brand) 10%, var(--color-surface)); }
.evo-graph-narrow-kind, .evo-graph-narrow-meta { flex: 0 0 auto; font-size: 11px; color: var(--color-text-tertiary); }
.evo-graph-narrow-title { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
.evo-graph-inspector { position: absolute; z-index: 45; right: 12px; bottom: 12px; width: min(280px, calc(100% - 24px)); max-height: min(52vh, 360px); overflow: auto; padding: 10px; background: color-mix(in srgb, var(--color-surface) 96%, transparent); border: 1px solid var(--color-border); border-radius: var(--r-sm); box-shadow: var(--shadow-lg); color: var(--color-text-primary); }
.evo-graph-inspector-head, .evo-graph-inspector-meta { display: flex; align-items: center; gap: 7px; }
.evo-graph-inspector-head { margin-bottom: 8px; font-size: 13px; }
.evo-graph-inspector-meta { flex-wrap: wrap; margin-bottom: 7px; font-size: 11px; color: var(--color-text-tertiary); }
.evo-graph-inspector code { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin: 4px 0; padding: 4px 6px; background: var(--color-background); color: var(--color-text-secondary); font-size: 10px; }
.evo-graph-inspector-preview { margin: 8px 0; color: var(--color-text-secondary); font-size: 11px; line-height: 1.5; }
.evo-graph-inspector-action, .evo-graph-inspector-links button { border: 1px solid var(--color-border); border-radius: var(--r-xs); padding: 5px 8px; background: var(--color-background); color: var(--color-text-primary); cursor: pointer; font: inherit; font-size: 11px; }
.evo-graph-inspector-action { margin: 3px 4px 3px 0; }
.evo-graph-inspector-links { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin-top: 8px; font-size: 11px; color: var(--color-text-tertiary); }
.evo-graph-inspector-reopen { position: absolute; z-index: 45; right: 12px; bottom: 12px; border: 1px solid var(--color-border); border-radius: var(--r-pebble-sm); padding: 6px 9px; background: var(--color-surface); color: var(--color-text-primary); cursor: pointer; font: inherit; font-size: 11px; }
.evo-graph-minimap { position: absolute; z-index: 20; right: 12px; top: 12px; width: 142px; height: 86px; overflow: hidden; border: 1px solid var(--graph-control-border); border-radius: var(--r-xs); background: var(--graph-minimap); pointer-events: none; }
.evo-graph-minimap-dot { position: absolute; width: 8px; height: 5px; border-radius: var(--r-2xs); background: var(--graph-minimap-resource); opacity: 0.72; }
.evo-graph-minimap-dot.active { background: var(--graph-trace); opacity: 1; box-shadow: 0 0 0 1px var(--color-surface); }
.evo-graph-status-missing, .evo-graph-status-failed { color: var(--graph-status-missing); }
.evo-graph-status-running, .evo-graph-status-indexing { color: var(--graph-status-running); }
.evo-context-trace { position: fixed; z-index: 900; top: 0; right: 0; bottom: 0; width: min(520px, 94vw); display: flex; flex-direction: column; gap: 10px; padding: 14px; overflow-y: auto; overscroll-behavior: contain; border-radius: var(--r-lg) 0 0 var(--r-lg); }
.evo-context-trace-head { display: flex; align-items: flex-start; gap: 10px; flex-shrink: 0; }
.evo-context-trace-head > div { min-width: 0; flex: 1; }
.evo-context-trace-head strong { display: block; font-size: 15px; }
.evo-context-trace-head p { margin: 2px 0 0; color: var(--color-text-tertiary); font-size: 11.5px; }
.evo-context-trace-question { display: flex; flex-direction: column; gap: 6px; flex-shrink: 0; }
.evo-context-trace-question label, .evo-context-trace-section h3 { font-size: 11.5px; font-weight: 650; color: var(--color-text-secondary); }
.evo-context-trace-question textarea { width: 100%; min-height: 54px; resize: vertical; padding: 7px 9px; border: 1px solid var(--color-border); border-radius: var(--r-xs); background: var(--color-background); color: var(--color-text-primary); font: inherit; font-size: 12px; line-height: 1.45; }
.evo-context-trace-actions, .evo-context-trace-item-actions { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.evo-context-trace-section { display: flex; flex-direction: column; gap: 7px; min-width: 0; }
.evo-context-trace-section h3 { margin: 2px 0 0; }
.evo-context-trace-item, .evo-context-trace-link { min-width: 0; padding: 9px; background: var(--color-background); }
.evo-context-trace-item.excluded { opacity: .58; }
.evo-context-trace-item-head, .evo-context-trace-link-line { display: flex; align-items: flex-start; gap: 7px; min-width: 0; }
.evo-context-trace-item-head strong { min-width: 0; flex: 1; overflow-wrap: anywhere; font-size: 12.5px; }
.evo-context-trace-item-head span { flex-shrink: 0; color: var(--color-text-tertiary); font-size: 10.5px; }
.evo-context-trace-item-head span.connected { color: var(--color-success); }
.evo-context-trace-item p { margin: 5px 0 7px; color: var(--color-text-secondary); font-size: 11.5px; line-height: 1.5; overflow-wrap: anywhere; }
.evo-context-trace-item-actions button, .evo-context-trace-link button { min-height: 28px; padding: 4px 8px; border: 1px solid var(--color-border); border-radius: var(--r-xs); background: var(--color-surface); color: var(--color-text-primary); cursor: pointer; font: inherit; font-size: 11px; }
.evo-context-trace-item-actions button:hover, .evo-context-trace-link button:hover { border-color: var(--brand); color: var(--brand); }
.evo-context-trace-link-line button { min-width: 0; flex: 1; border: 0; background: none; padding: 0; text-align: left; overflow-wrap: anywhere; color: var(--brand); }
.evo-context-trace-link-line code { max-width: 54%; min-width: 0; color: var(--color-text-secondary); overflow-wrap: anywhere; white-space: normal; font-size: 10.5px; }
.evo-context-trace-link small { display: block; margin: 6px 0; color: var(--color-text-tertiary); line-height: 1.45; overflow-wrap: anywhere; }
.evo-context-trace-error, .evo-context-trace-degraded { padding: 8px 9px; border-radius: var(--r-xs); font-size: 11.5px; line-height: 1.45; overflow-wrap: anywhere; }
.evo-context-trace-error { border: 1px solid color-mix(in srgb, var(--color-error) 45%, var(--color-border)); color: var(--color-error); background: color-mix(in srgb, var(--color-error) 7%, var(--color-background)); }
.evo-context-trace-degraded { border: 1px solid color-mix(in srgb, var(--color-warning) 45%, var(--color-border)); color: var(--color-warning); background: color-mix(in srgb, var(--color-warning) 7%, var(--color-background)); }
.evo-context-trace-loading, .evo-context-trace-empty { padding: 16px 8px; text-align: center; color: var(--color-text-tertiary); font-size: 12px; }
.evo-context-trace-close-bottom { align-self: flex-end; min-height: 30px; padding: 5px 12px; border: 1px solid var(--color-border); border-radius: var(--r-xs); background: var(--color-surface); color: var(--color-text-primary); cursor: pointer; font: inherit; font-size: 12px; }
@media (max-width: 819px) { .evo-context-trace { width: 100vw; max-width: none; border-left: 0; } .evo-context-trace-link code { max-width: 42%; } }
/* ── Channels / Team ── */
.evo-channel-badge { padding: 1px 9px; font-size: 10.5px; text-transform: capitalize; }
.evo-channel-badge.online { background: color-mix(in srgb, var(--color-success) 16%, transparent); color: var(--color-success); }
.evo-channel-counts { font-size: 11px; color: var(--color-text-tertiary); font-variant-numeric: tabular-nums; flex-shrink: 0; }
.evo-channel-toggle { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; border: 1px solid var(--color-border); border-radius: var(--r-pebble-sm); background: var(--color-surface); color: var(--color-text-secondary); cursor: pointer; flex-shrink: 0; }
.evo-channel-toggle:hover { border-color: var(--brand); color: var(--brand); }
.evo-channel-toggle.stop { color: var(--color-error); }
.evo-channel-toggle.stop:hover { border-color: var(--color-error); color: var(--color-error); }
.evo-channel-toggle:disabled { opacity: 0.5; cursor: default; }
.evo-channel-toggle svg { width: 13px; height: 13px; }
.evo-team-row { align-items: flex-start; }
.evo-team-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.evo-team-name { font-size: 13px; font-weight: 600; color: var(--color-text-primary); font-family: var(--font-serif); letter-spacing: -.01em; }
.evo-team-desc { font-size: 12px; color: var(--color-text-tertiary); line-height: 1.5; }
/* ── 科研团队职责层（RA/EA/EMA → 六类角色）── */
.evo-duty-stages { display: flex; flex-wrap: wrap; gap: 6px; margin: 6px 0 2px; }
.evo-duty-stage { display: inline-flex; align-items: center; gap: 6px; padding: 3px 8px; border: 1px solid var(--color-border); border-radius: var(--r-pill); font-size: 12px; }
.evo-duty-stage-label { color: var(--color-text-secondary); }
.evo-duty-stage-role { color: var(--brand); font-family: var(--font-mono); }
.evo-duty-header { display: flex; align-items: center; gap: 8px; width: 100%; padding: 7px 8px; border: none; background: none; cursor: pointer; text-align: left; border-radius: var(--r-sm); color: inherit; }
.evo-duty-header:hover { background: var(--color-fill-quaternary); }
.evo-duty-header[aria-expanded="true"] { background: var(--color-fill-tertiary); }
.evo-duty-badge { flex-shrink: 0; padding: 1px 7px; border-radius: var(--r-pill); background: color-mix(in srgb, var(--brand) 16%, transparent); color: var(--brand); font-size: 11px; font-weight: 700; font-family: var(--font-mono); }
.evo-duty-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.evo-duty-name { font-size: 13px; font-weight: 600; color: var(--color-text-primary); }
.evo-duty-desc { font-size: 12px; color: var(--color-text-tertiary); line-height: 1.45; }
.evo-duty-roles { flex-shrink: 0; font-size: 11px; color: var(--color-text-tertiary); font-family: var(--font-mono); }
.evo-duty-detail { display: flex; flex-direction: column; gap: 6px; padding: 4px 10px 10px 14px; }
.evo-duty-line { display: flex; gap: 8px; font-size: 12px; line-height: 1.55; color: var(--color-text-secondary); }
.evo-duty-key { flex-shrink: 0; width: 58px; color: var(--color-text-tertiary); }
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
.evo-md code { font-family: var(--font-mono); font-size: 12.5px; background: var(--hover-bg); border-radius: var(--r-2xs); padding: 1px 4px; }
.evo-md pre { margin: 6px 0; padding: 9px 11px; background: var(--color-background); border: 1px solid var(--color-border-light); border-radius: var(--r-sm); overflow-x: auto; }
/* 内联于 <pre> 的 code 不单独描圆角（直角是代码块几何的一部分，非卡片） */
.evo-md pre code { background: none; padding: 0; border-radius: 0; font-size: 12.5px; line-height: 1.45; display: block; white-space: pre; }
.evo-md table { margin: 0 0 4px; border-collapse: collapse; width: 100%; font-size: 13px; display: block; overflow-x: auto; }
.evo-md th, .evo-md td { border: 1px solid var(--color-border); padding: 4px 8px; text-align: left; }
.evo-md th { background: var(--hover-bg); font-weight: 600; }
.evo-md tr:nth-child(even) td { background: color-mix(in srgb, var(--hover-bg) 40%, transparent); }
.evo-md hr { border: none; border-top: 1px solid var(--color-border); margin: 6px 0; }
.evo-md a { color: var(--brand); text-decoration: none; }
.evo-md a:hover { text-decoration: underline; }
.evo-md a[href^="evo-file://"] { color: var(--brand); font-weight: 600; background: color-mix(in srgb, var(--brand) 8%, transparent); border-radius: var(--r-2xs); padding: 1px 4px; white-space: nowrap; cursor: pointer; }
.evo-md a[href^="evo-file://"]::before { content: '📄'; font-size: 10px; margin-right: 3px; opacity: 0.8; }
.evo-md img { max-width: 100%; border-radius: var(--r-sm); }
.evo-md .katex-display { margin: 8px 0 16px; overflow-x: auto; overflow-y: hidden; padding: 4px 0; }
.evo-md .hljs { background: transparent; }
.evo-md .evo-mermaid { margin: 0 0 16px; padding: 12px 14px; border: 1px dashed var(--color-border); border-radius: var(--r-sm); background: var(--color-background); color: var(--color-text-tertiary); font-size: 12.5px; font-family: var(--font-mono); overflow-x: auto; white-space: pre-wrap; }
.evo-md .evo-mermaid svg { max-width: 100%; height: auto; display: block; white-space: normal; }
/* ── JSON 结构化渲染（§需求4）── */
.evo-md .evo-json { margin: 6px 0; padding: 10px 12px; background: var(--color-background); border: 1px solid var(--color-border-light); border-radius: var(--r-sm); overflow-x: auto; white-space: pre; font-family: var(--font-mono); font-size: 12.5px; line-height: 1.55; color: var(--color-text-primary); }
.evo-json .evo-jkey { color: var(--brand); }
.evo-json .evo-jstr { color: var(--color-info); }
.evo-json .evo-jnum { color: var(--color-warning); }
.evo-json .evo-jbool { color: var(--color-success); }
.evo-json .evo-jnull { color: var(--color-text-tertiary); font-style: italic; }
.evo-json .evo-jpunct { color: var(--color-text-tertiary); }
.evo-json.evo-json-large { padding: 4px; }
.evo-json-toggle { display: flex; align-items: flex-start; gap: 7px; width: 100%; padding: 7px 9px; border: none; background: none; color: var(--color-text-secondary); font-family: inherit; font-size: 12px; line-height: 1.5; text-align: left; cursor: pointer; border-radius: var(--r-xs); }
.evo-json-toggle:hover { background: var(--hover-bg); color: var(--color-text-primary); }
.evo-json-toggle-icon { flex: 0 0 auto; color: var(--brand); font-size: 12px; line-height: 1.5; transition: transform 0.15s ease; }
.evo-json-toggle-label { min-width: 0; word-break: break-word; white-space: normal; }
.evo-json-toggle-preview { color: var(--color-text-tertiary); font-family: var(--font-mono); font-size: 11.5px; }
.evo-json-hidden { display: block; padding: 6px 8px 4px; }
.evo-json-hidden[hidden] { display: none; }
/* ── 输入框 Markdown 预览 ── */
.evo-md-toggle { display: inline-flex; align-items: center; gap: 2px; padding: 2px; border: 1px solid var(--color-border); border-radius: var(--r-pill); background: var(--color-surface); }
.evo-md-toggle-btn { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 22px; border: none; background: none; color: var(--color-text-tertiary); border-radius: var(--r-pill); cursor: pointer; }
.evo-md-toggle-btn:hover { color: var(--color-text-primary); }
.evo-md-toggle-btn[data-active] { background: var(--brand-solid); color: var(--brand-foreground); }
.evo-md-toggle-btn svg { width: 13px; height: 13px; }
.evo-composer-preview { flex: 1; min-height: 84px; max-height: 220px; overflow-y: auto; padding: 10px 12px; border: 1px solid var(--color-border); border-radius: var(--r-md); background: var(--color-surface); color: var(--color-text-primary); margin: 8px 14px 0; }
.evo-composer-preview-empty { color: var(--color-text-tertiary); font-size: 13px; }
/* ── 会话动作（§25.6 / §26.8）：Current / Search / Shortcuts / Compact / Clear view ── */
.evo-composer-divider { width: 1px; height: 18px; background: var(--color-border); flex-shrink: 0; }
.evo-info { display: flex; flex-direction: column; gap: 2px; }
.evo-info-row { display: flex; align-items: flex-start; gap: 12px; padding: 7px 2px; border-bottom: 1px solid var(--color-border-light); }
.evo-info-row:last-of-type { border-bottom: none; }
.evo-info-label { flex: 0 0 118px; font-size: 12px; font-weight: 600; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing: 0.3px; padding-top: 1px; }
.evo-info-value { flex: 1; min-width: 0; font-size: 12.5px; color: var(--color-text-primary); display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap; word-break: break-all; }
.evo-info-mono { font-family: var(--font-mono); }
.evo-info-path { font-family: var(--font-mono); font-size: 11.5px; color: var(--color-text-secondary); }
.evo-info-copy { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border: none; background: none; color: var(--color-text-tertiary); border-radius: var(--r-pebble-sm); cursor: pointer; flex-shrink: 0; }
.evo-info-copy:hover { color: var(--color-text-primary); background: var(--hover-bg); }
.evo-info-copy svg { width: 13px; height: 13px; }
.evo-info-actions { display: flex; justify-content: flex-end; gap: 8px; padding-top: 14px; }
.evo-search { display: flex; flex-direction: column; gap: 12px; }
.evo-search-bar { display: flex; gap: 8px; align-items: center; }
.evo-search-bar svg { width: 16px; height: 16px; color: var(--color-text-tertiary); flex-shrink: 0; }
.evo-search-input { flex: 1; min-width: 0; padding: 8px 14px; font-size: 13px; }
.evo-search-section { display: flex; flex-direction: column; gap: 6px; }
.evo-search-section-title { font-size: 11.5px; font-weight: 600; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing: 0.3px; }
.evo-search-results { display: flex; flex-direction: column; gap: 4px; max-height: 260px; overflow-y: auto; }
.evo-search-hit { text-align: left; padding: 7px 10px; border: 1px solid var(--color-border-light); border-radius: var(--r-sm); background: var(--color-surface); color: var(--color-text-secondary); font-size: 12.5px; cursor: pointer; line-height: 1.5; }
.evo-search-hit:hover { border-color: var(--brand); color: var(--color-text-primary); }
.evo-search-empty { font-size: 12.5px; color: var(--color-text-tertiary); padding: 6px 2px; }
.evo-shortcuts { display: flex; flex-direction: column; gap: 10px; }
.evo-shortcut-row { display: flex; align-items: center; gap: 14px; }
.evo-shortcut-row span { font-size: 13px; color: var(--color-text-secondary); }
.evo-kbd { display: inline-block; min-width: 30px; padding: 4px 10px; border: 1px solid var(--color-border); border-bottom-width: 2px; border-radius: var(--r-xs); background: var(--color-background); color: var(--color-text-primary); font-family: var(--font-mono); font-size: 12px; text-align: center; }
.evo-confirm { display: flex; flex-direction: column; gap: 14px; }
.evo-confirm-msg { font-size: 13px; color: var(--color-text-secondary); line-height: 1.7; }
.evo-confirm-check { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--color-text-secondary); cursor: pointer; user-select: none; }
.evo-confirm-check input { width: 14px; height: 14px; accent-color: var(--color-error); cursor: pointer; flex-shrink: 0; }
.evo-confirm-actions { display: flex; justify-content: flex-end; gap: 8px; }
.evo-clear-notice { flex: 1; display: flex; align-items: center; justify-content: center; }
.evo-clear-notice-box { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 32px; border: 1px dashed var(--color-border); border-radius: var(--r-md); text-align: center; }
.evo-clear-notice-title { font-family: var(--font-serif); font-size: 17px; font-weight: 600; color: var(--color-text-primary); }
.evo-clear-notice-sub { font-size: 12.5px; color: var(--color-text-tertiary); max-width: 420px; line-height: 1.6; }
/* ── 附件（§23.7）── */
.evo-chat { position: relative; }
.evo-chat-dragover::after { content: 'Drop image(s) to attach'; position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: color-mix(in srgb, var(--brand) 12%, var(--color-background)); color: var(--brand); font-size: 15px; font-weight: 600; border: 2px dashed var(--brand); border-radius: var(--r-md); pointer-events: none; z-index: 5; }
.evo-attach-strip { flex-basis: 100%; flex-shrink: 0; display: flex; flex-direction: column; gap: 6px; padding: 8px 24px 0; }
.evo-attach-error { font-size: 12px; color: var(--color-error); }
.evo-attach-list { display: flex; flex-wrap: wrap; gap: 8px; }
.evo-attach-item { display: inline-flex; align-items: center; gap: 7px; border: 1px solid var(--color-border); border-radius: var(--r-sm); background: var(--color-surface); padding: 4px 8px; max-width: 260px; }
.evo-attach-thumb { width: 36px; height: 36px; object-fit: cover; border-radius: var(--r-xs); flex-shrink: 0; }
.evo-attach-thumb.evo-attach-loading { display: inline-flex; align-items: center; justify-content: center; font-size: 13px; color: var(--color-text-tertiary); background: var(--hover-bg); }
.evo-attach-name { flex: 1; min-width: 0; font-size: 12px; color: var(--color-text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.evo-attach-remove { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; border: none; background: none; color: var(--color-text-tertiary); border-radius: var(--r-pebble-sm); cursor: pointer; flex-shrink: 0; }
.evo-attach-remove:hover { color: var(--color-error); background: var(--hover-bg); }
.evo-attach-remove svg { width: 13px; height: 13px; }
/* ── Toast（§33.2）── */
.evo-toast-host { position: fixed; right: 18px; bottom: 18px; z-index: 1200; display: flex; flex-direction: column; gap: 8px; pointer-events: none; }
.evo-toast { padding: 9px 16px; font-size: 12.5px; line-height: 1.5; animation: evo-toast-in var(--dur-organic) var(--ease-organic); max-width: 340px; }
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
  /* 例外：图谱连线虚线流动是画布的核心动态语义（对齐 reactflow.dev 官网，
     官网在 reduced-motion 下同样流动），此时降速降密而非禁用。 */
  .evo-graph-canvas .react-flow__edge.animated path,
  .react-flow__connection .animated {
    animation-duration: 1s !important;
    animation-iteration-count: infinite !important;
  }
}
/* ── 页面级错误（§33.4）── */
.evo-fatal { position: fixed; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; background: var(--color-background); color: var(--color-text-primary); z-index: 2000; }
.evo-fatal h2 { margin: 0; font-family: var(--font-serif); font-size: 22px; font-weight: 600; letter-spacing: -.01em; }
.evo-fatal p { margin: 0; font-size: 13px; color: var(--color-text-secondary); max-width: 460px; text-align: center; line-height: 1.6; }
.evo-fatal-acts { display: flex; gap: 10px; }
.evo-msg-jump { animation: evo-jump-flash 1.6s ease-out; border-radius: var(--r-sm); }
@keyframes evo-jump-flash { 0% { background: color-mix(in srgb, var(--brand) 26%, transparent); } 100% { background: transparent; } }
/* ── Recents 操作（§26.3）与 Side Chat（§22.3-22.4）── */
.evo-tl-row { display: flex; align-items: center; gap: 4px; }
.evo-tl-drag-grip { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 28px; margin: -4px 0 -4px -5px; padding: 0; border: 0; border-radius: var(--r-pebble-sm); background: transparent; color: var(--color-text-tertiary); cursor: grab; flex: 0 0 24px; touch-action: none; }
.evo-tl-drag-grip:hover { background: var(--hover-bg); color: var(--color-text-primary); }
.evo-tl-drag-grip:active, .evo-tl[data-dragging] .evo-tl-drag-grip { cursor: grabbing; }
.evo-tl-drag-grip svg { width: 13px; height: 13px; }
.evo-tl-project-row .evo-tl-drag-grip { width: 24px; height: 28px; }
.evo-tl[data-dragging] { user-select: none; }
.evo-tl-row-dragging { opacity: .42; }
.evo-tl-row-dragging .evo-tl-row-acts { opacity: 0; }
.evo-tl-drop-placeholder { height: 44px; margin: 2px 0; border: 1px dashed color-mix(in srgb, var(--brand) 48%, var(--color-border)); border-radius: var(--r-sm); background: color-mix(in srgb, var(--brand) 7%, transparent); position: relative; transition: height 160ms cubic-bezier(.16, 1, .3, 1), background 120ms ease, border-color 120ms ease; }
.evo-tl-drop-placeholder::before { content: ''; position: absolute; left: 10px; right: 10px; top: 50%; height: 2px; border-radius: var(--r-pill); background: color-mix(in srgb, var(--brand) 58%, transparent); transform: translateY(-50%); }
.evo-tl-drag-preview { position: fixed; z-index: 1000; display: flex; align-items: center; gap: 9px; width: min(230px, calc(100vw - 28px)); min-height: 42px; padding: 8px 11px; border: 1px solid color-mix(in srgb, var(--brand) 45%, var(--color-border)); border-radius: var(--r-sm); background: color-mix(in srgb, var(--color-surface) 78%, transparent); color: var(--color-text-primary); box-shadow: var(--shadow-lg); backdrop-filter: blur(12px) saturate(145%); pointer-events: none; opacity: .9; transform: translate3d(0, 0, 0); }
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
.evo-tl-row-act { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border: none; background: none; color: var(--color-text-tertiary); border-radius: var(--r-pebble-sm); cursor: pointer; }
.evo-tl-row-act:hover { color: var(--color-text-primary); background: var(--hover-bg); }
.evo-tl-row-act[data-on] { color: var(--brand); }
.evo-tl-row-act svg { width: 13px; height: 13px; }
.evo-tl-row-act-del { margin-left: 3px; }
.evo-tl-row-act-del:hover { color: var(--color-error); background: color-mix(in srgb, var(--color-error) 10%, transparent); }
.evo-tl-row-act.evo-tl-del-confirm { color: var(--color-error); background: color-mix(in srgb, var(--color-error) 12%, transparent); font-size: 11px; width: auto; padding: 0 7px; font-weight: 600; }
/* 「⋯」更多操作菜单（§侧栏重构：低频操作收纳） */
.evo-tl-row-more { position: relative; display: inline-flex; align-items: center; }
.evo-tl-row-menu { position: absolute; top: calc(100% + 4px); right: 0; z-index: 80; min-width: 176px; padding: 5px; display: flex; flex-direction: column; gap: 1px; }
.evo-tl-menu-item { padding: 8px 10px; white-space: nowrap; }
.evo-tl-menu-item svg { width: 14px; height: 14px; color: var(--brand); flex-shrink: 0; }
.evo-tl-menu-sep { height: 1px; background: var(--color-border-light); margin: 3px 6px; }
.evo-tl-menu-danger { color: var(--color-error); }
.evo-tl-menu-danger svg { color: var(--color-error); }
.evo-tl-menu-danger:hover { background: color-mix(in srgb, var(--color-error) 10%, transparent); }
.evo-tl-row-acts[data-menu-open] .evo-tl-row-act[data-on] { color: var(--brand); }
.evo-tl-row-acts[data-menu-open] { opacity: 1; }
.evo-tl-del:hover, .evo-tl-del-confirm { color: var(--color-error); }
.evo-tl-del-confirm { width: auto; padding: 0 6px; font-size: 11px; font-weight: 600; background: color-mix(in srgb, var(--color-error) 14%, transparent); }
.evo-tl-del-confirm:hover { background: var(--color-error); color: var(--color-surface); }
.evo-tl-running { width: 8px; height: 8px; border-radius: var(--r-dot); background: var(--brand); flex-shrink: 0; animation: evo-running-pulse 1.2s ease-in-out infinite; }
@keyframes evo-running-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
.evo-del { color: var(--color-text-tertiary); }
.evo-del:hover { color: var(--color-error); }
.evo-del-confirm { color: var(--color-error) !important; font-size: 11px; font-weight: 600; }
.evo-del-confirm:hover { background: var(--color-error); color: var(--color-surface) !important; }
.evo-tl-rename { display: flex; align-items: center; gap: 4px; padding: 4px 8px; }
.evo-tl-rename-input { flex: 1; min-width: 0; padding: 4px 10px; font-size: 12.5px; border-color: color-mix(in srgb, var(--brand) 55%, var(--color-border)); }
.evo-sidechat-list { display: flex; flex-direction: column; gap: 4px; padding: 4px 6px 12px; }
.evo-sidechat-tab { display: flex; align-items: center; gap: 8px; padding: 6px 11px; }
.evo-sidechat-tab svg { width: 14px; height: 14px; color: var(--brand); flex-shrink: 0; }
.evo-sidechat-tab-main { flex: 1; min-width: 0; text-align: left; border: none; background: none; padding: 0; font-size: 12.5px; color: var(--color-text-primary); cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.evo-sidechat-tab-main:hover { color: var(--brand); }
.evo-sidechat-new { display: inline-flex; align-items: center; gap: 5px; }
.evo-sidechat-new svg { width: 13px; height: 13px; }
/* ── 忙时消息队列（§23.6）── */
.evo-queue-count { font-size: 10.5px; font-weight: 700; min-width: 16px; height: 16px; line-height: 16px; text-align: center; border-radius: var(--r-pebble-sm); background: var(--brand-solid); color: var(--brand-foreground); padding: 0 4px; }
.evo-queue { position: absolute; bottom: calc(100% - 8px); left: 50%; transform: translateX(-50%); width: min(520px, calc(100vw - 96px)); max-height: 300px; overflow-y: auto; z-index: 40; padding: 8px 10px; display: flex; flex-direction: column; gap: 6px; }
.evo-queue-head { display: flex; align-items: center; gap: 8px; }
.evo-queue-list { display: flex; flex-direction: column; gap: 4px; }
.evo-queue-row { display: flex; align-items: center; gap: 6px; padding: 6px 8px; border: 1px solid var(--color-border-light); border-radius: var(--r-sm); background: var(--color-background); }
.evo-queue-text { flex: 1; min-width: 0; font-size: 12.5px; color: var(--color-text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.evo-queue-input { flex: 1; min-width: 0; padding: 4px 10px; font-size: 12.5px; }
.evo-queue-act { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border: none; background: none; color: var(--color-text-tertiary); border-radius: var(--r-pebble-sm); cursor: pointer; flex-shrink: 0; }
.evo-queue-act:hover { color: var(--color-text-primary); background: var(--hover-bg); }
.evo-queue-act svg { width: 13px; height: 13px; }
.evo-queue-steer { color: var(--brand); }
.evo-queue-steer:hover { background: color-mix(in srgb, var(--brand) 14%, transparent); color: var(--brand); }
.evo-composer-stop { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border: 1px solid color-mix(in srgb, var(--color-error) 40%, var(--color-border)); border-radius: var(--r-xs); background: color-mix(in srgb, var(--color-error) 8%, transparent); color: var(--color-error); cursor: pointer; flex-shrink: 0; }
.evo-composer-stop:hover { background: var(--color-error); color: var(--color-surface); }
.evo-composer-stop svg { width: 12px; height: 12px; }
/* ── HITL 审批条（§21.2）── */
.evo-approval-strip { flex-shrink: 0; display: flex; justify-content: center; padding: 8px 24px 0; }
.evo-approval-list { width: 100%; max-width: 60%; min-width: min(560px, 100%); display: flex; flex-direction: column; gap: 8px; }
.evo-approval-card { border: 1px solid color-mix(in srgb, var(--color-warning) 45%, var(--color-border)); border-radius: var(--r-md); background: color-mix(in srgb, var(--color-warning) 7%, var(--color-surface)); padding: 10px 14px; display: flex; flex-direction: column; gap: 8px; }
.evo-approval-head { display: flex; align-items: center; gap: 7px; font-size: 12.5px; font-weight: 600; color: var(--color-warning); }
.evo-approval-head svg { width: 15px; height: 15px; }
.evo-approval-body { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.evo-approval-tool { font-family: var(--font-mono); font-size: 13px; color: var(--color-text-primary); background: var(--hover-bg); padding: 3px 10px; border-radius: var(--r-xs); }
.evo-approval-callid { font-size: 11px; color: var(--color-text-tertiary); font-family: var(--font-mono); }
.evo-approval-reason { font-size: 12.5px; color: var(--color-text-secondary); line-height: 1.6; }
/* ── Ask User 问题卡片（§21.3）── */
.evo-question-card { border: 1px solid color-mix(in srgb, var(--brand) 45%, var(--color-border)); border-radius: var(--r-md); background: color-mix(in srgb, var(--brand) 7%, var(--color-surface)); padding: 10px 14px; display: flex; flex-direction: column; gap: 8px; }
.evo-question-card .evo-approval-head { color: var(--brand); }
.evo-question { display: flex; flex-direction: column; gap: 7px; }
.evo-question-text { font-size: 13px; color: var(--color-text-primary); line-height: 1.6; }
.evo-question-opts { display: flex; flex-wrap: wrap; gap: 6px; }
.evo-question-opt { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--color-border); border-radius: var(--r-sm); background: var(--color-surface); color: var(--color-text-secondary); font-size: 12.5px; padding: 4px 12px; cursor: pointer; }
.evo-question-opt:hover { border-color: var(--brand); color: var(--color-text-primary); }
.evo-question-opt[data-on] { border-color: var(--brand); background: color-mix(in srgb, var(--brand) 12%, var(--color-surface)); color: var(--brand); font-weight: 600; }
.evo-question-check { width: 13px; height: 13px; border-radius: var(--r-2xs); border: 1px solid var(--brand); display: inline-flex; align-items: center; justify-content: center; font-size: 10px; }
.evo-question-custom { width: 100%; padding: 6px 11px; font-size: 12.5px; }
.evo-question-submit { display: flex; justify-content: flex-end; }
.evo-question-acts { display: flex; justify-content: flex-end; }
.evo-approval-acts { display: flex; gap: 8px; }
/* ── Dynamic Workflow 条（§24）── */
.evo-wf-strip { flex-shrink: 0; display: flex; justify-content: center; padding: 8px 24px 0; }
.evo-wf-bar { width: 100%; max-width: var(--chat-max-width); display: flex; align-items: center; gap: 8px; padding: 7px 12px; border: 1px solid var(--color-border); border-radius: var(--r-sm); background: var(--color-surface); }
.evo-wf-bar > svg { width: 15px; height: 15px; color: var(--brand); flex-shrink: 0; }
.evo-wf-name { font-size: 12.5px; font-weight: 600; color: var(--color-text-primary); flex-shrink: 0; }
.evo-wf-members { display: flex; gap: 5px; flex-wrap: wrap; flex: 1; min-width: 0; }
.evo-wf-member { padding: 2px 9px; overflow: hidden; text-overflow: ellipsis; max-width: 140px; }
.evo-wf-member.running { background: color-mix(in srgb, var(--brand) 14%, transparent); color: var(--brand); }
.evo-wf-member.done { background: color-mix(in srgb, var(--color-success) 14%, transparent); color: var(--color-success); }
.evo-wf-member.failed { background: color-mix(in srgb, var(--color-error) 14%, transparent); color: var(--color-error); }
.evo-wf-count { font-size: 11px; font-weight: 600; color: var(--color-text-secondary); flex-shrink: 0; }
.evo-wf-duration { font-size: 11px; color: var(--color-text-tertiary); font-variant-numeric: tabular-nums; flex-shrink: 0; }
.evo-wf-status { font-size: 11px; color: var(--color-warning); flex-shrink: 0; }
.evo-wf-clear { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border: none; background: none; color: var(--color-text-tertiary); border-radius: var(--r-pebble-sm); cursor: pointer; flex-shrink: 0; }
.evo-wf-clear:hover { color: var(--color-error); background: var(--hover-bg); }
.evo-wf-clear svg { width: 13px; height: 13px; }
/* ── 后台任务（§21.6）── */
.evo-job-row { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border: 1px solid var(--color-border-light); border-radius: var(--r-sm); background: var(--color-background); }
.evo-job-dot { width: 7px; height: 7px; border-radius: var(--r-dot); background: var(--color-border); flex-shrink: 0; }
.evo-job-dot.running { background: var(--brand); box-shadow: 0 0 0 3px color-mix(in srgb, var(--brand) 20%, transparent); }
.evo-job-dot.done { background: var(--color-success); }
.evo-job-dot.failed { background: var(--color-error); }
.evo-job-dot.killed { background: var(--color-text-tertiary); }
.evo-job-kind { font-size: 11px; font-weight: 600; color: var(--brand); font-family: var(--font-mono); flex-shrink: 0; }
.evo-job-label { flex: 1; min-width: 0; font-size: 12.5px; color: var(--color-text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.evo-job-detail { font-size: 11px; color: var(--color-text-tertiary); max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex-shrink: 0; }
.evo-job-status { font-size: 11px; color: var(--color-text-tertiary); flex-shrink: 0; }
.evo-job-duration { font-size: 11px; color: var(--color-text-tertiary); font-variant-numeric: tabular-nums; flex-shrink: 0; }
/* ── 命令执行结果条（§23.3）── */
.evo-cmd-strip { flex-shrink: 0; display: flex; justify-content: center; padding: 8px 24px 0; }
.evo-cmd-card { width: 100%; max-width: 60%; min-width: min(560px, 100%); display: flex; align-items: flex-start; gap: 8px; padding: 9px 12px; border: 1px solid var(--color-border); border-radius: var(--r-sm); background: var(--color-surface); }
.evo-cmd-card.error { border-color: color-mix(in srgb, var(--color-error) 40%, var(--color-border)); }
.evo-cmd-card > svg { width: 15px; height: 15px; color: var(--brand); flex-shrink: 0; margin-top: 1px; }
.evo-cmd-card.error > svg { color: var(--color-error); }
.evo-cmd-line { font-family: var(--font-mono); font-size: 12px; color: var(--color-text-primary); flex-shrink: 0; }
.evo-cmd-running { font-size: 12px; color: var(--brand); }
.evo-cmd-output { flex: 1; min-width: 0; margin: 0; font-family: var(--font-mono); font-size: 12px; line-height: 1.6; color: var(--color-text-secondary); white-space: pre-wrap; word-break: break-word; max-height: 180px; overflow-y: auto; }
.evo-cmd-output-md { font-family: inherit; font-size: 12.5px; line-height: 1.6; color: var(--color-text-primary); max-height: 220px; }
.evo-cmd-output-md table { border-collapse: collapse; margin: 4px 0; }
.evo-cmd-output-md th, .evo-cmd-output-md td { border: 1px solid var(--color-border); padding: 3px 10px; font-size: 12px; text-align: left; }
.evo-cmd-output-md th { background: var(--hover-bg); font-weight: 600; }
.evo-cmd-dismiss { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border: none; background: none; color: var(--color-text-tertiary); border-radius: var(--r-pebble-sm); cursor: pointer; flex-shrink: 0; }
.evo-cmd-dismiss:hover { color: var(--color-text-primary); background: var(--hover-bg); }
.evo-cmd-dismiss svg { width: 13px; height: 13px; }
/* ── 标签栏（§5.2：轻量分段导航，接近原生桌面工具栏）── */
.evo-tabwrap { display: flex; flex-direction: column; min-width: 0; min-height: 0; flex: 1; }
.evo-tabbar { display: flex; align-items: center; gap: 2px; padding: 6px 14px; background-color: var(--color-background); background-image: var(--organic-grain); border-bottom: 1px solid var(--color-border); flex-shrink: 0; overflow-x: auto; scrollbar-width: thin; position: sticky; top: 0; z-index: 20; }
.evo-tab { display: inline-flex; align-items: center; gap: 6px; max-width: 200px; padding: 5px 10px; border: 1px solid transparent; border-radius: var(--r-xs); background: transparent; color: var(--color-text-secondary); font-size: 12.5px; cursor: pointer; user-select: none; white-space: nowrap; transition: background 0.12s ease, color 0.12s ease, box-shadow 0.12s ease, transform 0.5s linear; will-change: transform; }
.evo-tab:hover { background: var(--hover-bg); color: var(--color-text-primary); }
.evo-tab { position: relative; }
.evo-tab[data-active] { background: var(--color-surface); border-color: var(--color-border); color: var(--color-text-primary); font-weight: 600; box-shadow: var(--shadow-sm); }
.evo-tab[data-active]::after { content: ''; position: absolute; left: 9px; right: 9px; top: -1px; height: 3px; border-radius: var(--r-pill); background: var(--accent-sage); }
/* 拖拽中的 tab：抬起、加投影、禁止触摸滚动干扰；位置由内联 transform 跟随指针/FLIP */
.evo-tab.evo-tab-dragging { cursor: grabbing; background: var(--color-surface); border-color: var(--color-border); box-shadow: var(--shadow-md); touch-action: none; transition: transform 0.1s ease, box-shadow 0.15s ease; }
.evo-tab-title { overflow: hidden; text-overflow: ellipsis; }
/* 文件编辑 tab：未改动=斜体，有未保存改动=正体（仿 VSCode dirty 语义的斜体约定） */
.evo-tab-title-file { font-style: italic; }
.evo-tab-title-file.evo-tab-title-dirty { font-style: normal; font-weight: 700; color: var(--color-text-primary); }
.evo-tab-close { display: inline-flex; align-items: center; justify-content: center; width: 17px; height: 17px; border: none; background: none; color: currentColor; border-radius: var(--r-pebble-sm); cursor: pointer; padding: 0; flex-shrink: 0; opacity: 0.65; position: relative; }
.evo-tab-close::after { content: ''; position: absolute; inset: -6px; }
.evo-tab-close:hover { background: color-mix(in srgb, var(--color-text-primary) 14%, transparent); opacity: 1; }
.evo-tab-close svg { width: 11px; height: 11px; }
.evo-tab-new-wrap { position: relative; display: inline-flex; align-items: center; margin-left: 2px; }
.evo-tab-new-wrap-drop-target::before { content: ''; position: absolute; left: -5px; top: 4px; bottom: 4px; width: 2px; border-radius: var(--r-2xs); background: var(--brand); box-shadow: 0 0 0 2px color-mix(in srgb, var(--brand) 18%, transparent); pointer-events: none; }
.evo-tab-new-wrap-drop-target .evo-tab-new { color: var(--brand); background: color-mix(in srgb, var(--brand) 12%, transparent); }
.evo-tab-new { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; border: 1px solid transparent; border-radius: var(--r-pebble-sm); background: transparent; color: var(--color-text-tertiary); cursor: pointer; flex-shrink: 0; transition: background 0.12s ease, color 0.12s ease; }
.evo-tab-new:hover:not(:disabled) { background: var(--hover-bg); color: var(--brand); }
.evo-tab-new:disabled { opacity: 0.45; cursor: not-allowed; }
.evo-tab-new svg { width: 14px; height: 14px; }
/* + 菜单：fixed 定位（坐标由 JS 按「+」按钮实时计算），脱离 tabbar 的 overflow 裁剪 */
.evo-tab-menu { position: fixed; top: 32px; left: 0; z-index: 90; min-width: 264px; max-width: 344px; padding: 6px; display: flex; flex-direction: column; gap: 4px; }
.evo-tab-menu-item { padding: 7px 10px; }
.evo-tab-menu-item:disabled { opacity: 0.45; cursor: not-allowed; }
.evo-tab-menu-item svg { width: 14px; height: 14px; color: var(--brand); flex-shrink: 0; }
.evo-tab-menu-hint { padding: 4px 10px 6px; font-size: 11.5px; color: var(--color-text-tertiary); line-height: 1.5; border-top: 1px solid var(--color-border-light); margin-top: 2px; }
.evo-tab-menu-help { border-top: 0; margin: -2px 0 2px; padding-top: 0; }
.evo-tab-menu-newfile { gap: 6px; }
.evo-tab-newfile-input { flex: 1; min-width: 0; font-size: 12.5px; padding: 5px 10px; }
.evo-tab-newfile-go { padding: 5px 12px; font-size: 12px; flex-shrink: 0; }
/* 「从工作区打开」目录树（内嵌 + 菜单） */
.evo-tab-tree { border-top: 1px solid var(--color-border-light); padding: 6px 2px; display: flex; flex-direction: column; gap: 1px; max-height: 260px; overflow-y: auto; }
.evo-tab-tree-head { display: flex; align-items: center; gap: 6px; padding: 3px 8px 5px; }
.evo-tab-tree-head > svg { width: 13px; height: 13px; color: var(--brand); flex-shrink: 0; }
.evo-tab-tree-root { font-size: 11px; color: var(--color-text-tertiary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; font-family: var(--font-mono); }
.evo-tab-tree-refresh { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; border: none; background: none; color: var(--color-text-tertiary); border-radius: var(--r-pebble-sm); cursor: pointer; flex-shrink: 0; }
.evo-tab-tree-refresh:hover { background: var(--hover-bg); color: var(--color-text-primary); }
.evo-tab-tree-refresh svg { width: 12px; height: 12px; }
.evo-tab-tree-row { display: flex; align-items: center; gap: 6px; width: 100%; border: none; background: none; border-radius: var(--r-xs); padding: 4px 8px; font-size: 12.5px; color: var(--color-text-primary); cursor: pointer; text-align: left; min-width: 0; }
.evo-tab-tree-row:hover { background: var(--hover-bg); }
.evo-tab-tree-row > svg { width: 13px; height: 13px; color: var(--color-text-tertiary); flex-shrink: 0; }
.evo-tab-tree-row > svg:first-child { color: var(--color-text-tertiary); }
.evo-tab-tree-arrow { width: 13px; flex-shrink: 0; }
.evo-tab-tree-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.evo-tab-tree-empty { font-size: 11.5px; color: var(--color-text-tertiary); padding: 4px 0; }
.evo-tab-tree-error { font-size: 11.5px; color: var(--color-error); padding: 4px 8px; }
.evo-tab-body { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.evo-tab-frame { flex: 1; width: 100%; border: none; background: var(--color-surface); }
.evo-tab-editor-body { gap: 0; }
.evo-tab-editor-head { display: flex; align-items: center; gap: 8px; padding: 6px 14px; border-bottom: 1px solid var(--color-border); background: var(--color-surface); flex-shrink: 0; min-height: 36px; box-sizing: border-box; }
.evo-tab-editor-fileicon { width: 14px; height: 14px; color: var(--color-text-tertiary); flex-shrink: 0; }
.evo-tab-editor-path { font-family: var(--font-mono); font-size: 12px; color: var(--color-text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1 1 auto; min-width: 0; }
.evo-tab-editor { flex: 1; min-height: 0; width: 100%; border: none; outline: none; resize: none; background: var(--color-surface); color: var(--color-text-primary); font-family: ui-monospace, Consolas, 'SF Mono', monospace; font-size: 13px; line-height: 1.65; padding: 14px 18px; tab-size: 2; }
/* ── 文件 tab（按类型：md → Milkdown 所见即所得实时编辑）── */
.evo-tab-file-body { gap: 0; }
.evo-tab-file-preview { flex: 1; min-height: 0; overflow-y: auto; padding: 16px 22px; font-size: 14px; line-height: 1.7; background: var(--color-surface); }
.evo-btn-run.evo-btn-active { outline: 2px solid color-mix(in srgb, var(--brand) 55%, transparent); outline-offset: 1px; }
/* Milkdown 文件编辑器：占满 tab 剩余高度（覆盖 composer 的固定高度）；工具条常开由 data-markdown-toolbar-open 控制 */
.evo-tab-md-live.evo-composer-editor { flex: 1 1 auto; min-height: 200px; height: auto; }
.evo-tab-md-live .evo-composer-editor-host { flex: 1 1 auto; min-height: 0; }
/* Monaco 文件编辑器：占满 tab 剩余高度 */
.evo-tab-monaco { flex: 1 1 auto; min-height: 0; }
/* ── 实验管理（§5.1）── */
.evo-exp-notice { margin: 8px 0 0; padding: 8px 12px; border-radius: var(--r-sm); background: color-mix(in srgb, var(--color-success) 12%, var(--color-surface)); border: 1px solid color-mix(in srgb, var(--color-success) 35%, var(--color-border)); color: var(--color-success); font-size: 12.5px; }
.evo-exp-item { margin-bottom: 8px; }
.evo-exp-item[data-active] { border-color: color-mix(in srgb, var(--brand) 45%, var(--color-border)); }
.evo-exp-item-head { display: flex; align-items: center; gap: 10px; width: 100%; padding: 10px 12px; border: none; background: none; cursor: pointer; text-align: left; }
.evo-exp-item-head > svg { width: 16px; height: 16px; color: var(--brand); flex-shrink: 0; }
.evo-exp-item-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.evo-exp-item-name { font-size: 13px; font-weight: 600; color: var(--color-text-primary); }
.evo-exp-item-sub { font-size: 11.5px; color: var(--color-text-tertiary); }
.evo-exp-detail { border-top: 1px solid var(--color-border-light); padding: 10px 12px; display: flex; flex-direction: column; gap: 10px; }
.evo-exp-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.evo-exp-title { font-family: var(--font-serif); font-size: 15px; font-weight: 600; color: var(--color-text-primary); }
.evo-exp-desc { font-size: 12px; color: var(--color-text-secondary); }
.evo-exp-del { border: none; background: none; cursor: pointer; display: inline-flex; align-items: center; }
.evo-exp-branches { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.evo-exp-branch-label { font-size: 11.5px; color: var(--color-text-tertiary); }
.evo-exp-branch-chip { display: inline-flex; align-items: center; gap: 5px; padding: 3px 10px; border: 1px solid var(--color-border); border-radius: var(--r-pill); background: var(--color-surface); color: var(--color-text-secondary); font-size: 12px; cursor: pointer; }
.evo-exp-branch-chip[data-active] { background: color-mix(in srgb, var(--brand) 12%, var(--color-surface)); border-color: var(--brand); color: var(--brand); }
.evo-exp-branch-chip svg { width: 12px; height: 12px; }
.evo-exp-phases { display: flex; flex-direction: column; gap: 6px; }
.evo-exp-phases-head { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--color-text-tertiary); }
.evo-exp-phase { border: 1px solid var(--color-border); border-radius: var(--r-sm); overflow: hidden; background: var(--color-surface); }
.evo-exp-phase-head { display: flex; align-items: center; gap: 6px; width: 100%; padding: 8px 10px; border: none; background: none; cursor: pointer; text-align: left; font-size: 12.5px; color: var(--color-text-primary); }
.evo-exp-phase-head > svg { width: 13px; height: 13px; color: var(--color-text-tertiary); flex-shrink: 0; }
.evo-exp-phase-name { font-weight: 600; }
.evo-exp-phase-meta { margin-left: auto; font-size: 11px; color: var(--color-text-tertiary); flex-shrink: 0; }
.evo-exp-phase-body { border-top: 1px solid var(--color-border-light); padding: 8px 10px; display: flex; flex-direction: column; gap: 6px; }
.evo-exp-cp { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; padding: 7px 9px; border: 1px solid var(--color-border-light); border-radius: var(--r-sm); background: var(--color-background); }
.evo-exp-cp[data-rolled] { border-color: color-mix(in srgb, var(--color-warning) 50%, var(--color-border)); }
.evo-exp-cp-main { display: flex; align-items: flex-start; gap: 8px; min-width: 0; }
.evo-exp-cp-main > svg { width: 14px; height: 14px; color: var(--brand); flex-shrink: 0; margin-top: 1px; }
.evo-exp-cp-info { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.evo-exp-cp-title { display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--color-text-primary); }
.evo-exp-cp-rolled { font-size: 10.5px; color: var(--color-warning); border: 1px solid color-mix(in srgb, var(--color-warning) 45%, var(--color-border)); border-radius: var(--r-pill); padding: 0 6px; }
.evo-exp-cp-sub { font-size: 11px; color: var(--color-text-tertiary); }
.evo-exp-cp-note { font-size: 11.5px; color: var(--color-text-secondary); white-space: pre-wrap; word-break: break-word; }
.evo-exp-cp-acts { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
.evo-exp-branch-from { display: inline-flex; align-items: center; }
.evo-exp-cp-form { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.evo-exp-inline { display: inline-flex; align-items: center; gap: 5px; }
.evo-exp-inline-ok, .evo-exp-inline-cancel { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border: 1px solid var(--color-border); border-radius: var(--r-xs); background: var(--color-surface); color: var(--color-text-secondary); cursor: pointer; flex-shrink: 0; }
.evo-exp-inline-ok:hover { color: var(--color-success); border-color: var(--color-success); }
.evo-exp-inline-cancel:hover { color: var(--color-error); border-color: var(--color-error); }
.evo-exp-inline-ok:disabled, .evo-exp-inline-cancel:disabled { opacity: 0.5; cursor: not-allowed; }
.evo-exp-inline-ok svg, .evo-exp-inline-cancel svg { width: 13px; height: 13px; }
/* ── 项目环境卡片（§环境管理）── */
.evo-panel-item-wrap { display: flex; flex-direction: column; gap: 6px; align-items: stretch; }
.evo-panel-item-row { display: flex; align-items: center; gap: 8px; min-width: 0; }
.evo-panel-item-row > svg { width: 15px; height: 15px; color: var(--brand); flex-shrink: 0; }
.evo-env-card { overflow: hidden; }
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
.evo-traj { display: flex; flex-direction: column; flex: 1; min-height: 0; background-color: var(--color-background); background-image: var(--organic-grain); }
.evo-traj-toolbar { display: flex; align-items: center; gap: 6px; padding: 8px 14px; border-bottom: 1px solid var(--color-border); flex-shrink: 0; flex-wrap: wrap; }
.evo-traj-toolbar > svg { width: 14px; height: 14px; color: var(--brand); flex-shrink: 0; }
.evo-traj-seg { display: inline-flex; align-items: center; gap: 2px; padding: 2px; border: 1px solid var(--color-border); border-radius: var(--r-pill); background: var(--color-surface); flex-shrink: 0; }
.evo-traj-chip { display: inline-flex; align-items: center; padding: 3px 10px; border: none; border-radius: var(--r-pill); background: transparent; color: var(--color-text-secondary); font-size: 12px; cursor: pointer; }
.evo-traj-chip:hover { color: var(--color-text-primary); }
.evo-traj-chip[data-on] { background: color-mix(in srgb, var(--brand) 12%, var(--color-surface)); color: var(--brand); font-weight: 600; }
.evo-traj-sep { width: 1px; height: 16px; background: var(--color-border); margin: 0 4px; flex-shrink: 0; }
.evo-traj-totals { font-size: 11px; color: var(--color-text-tertiary); font-variant-numeric: tabular-nums; flex-shrink: 0; }
.evo-traj-search { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border: 1px solid var(--color-border); border-radius: var(--r-pill); background: var(--color-surface); flex-shrink: 0; }
.evo-traj-search svg { width: 13px; height: 13px; color: var(--color-text-tertiary); flex-shrink: 0; }
.evo-traj-search-input { width: 140px; border: none; outline: none; background: none; color: var(--color-text-primary); font-size: 12px; }
.evo-traj-body { flex: 1; min-height: 0; overflow-y: auto; padding: 10px 14px 16px; }
.evo-traj-empty { padding: 30px; text-align: center; color: var(--color-text-tertiary); font-size: 13px; }
.evo-traj-turn { border: 1px solid var(--color-border); border-left: 3px solid color-mix(in srgb, var(--brand) 55%, var(--color-border)); border-radius: var(--r-sm); margin-bottom: 8px; background: var(--color-surface); overflow: hidden; }
.evo-traj-turn-body { border-top: 1px solid var(--color-border-light); padding: 8px 10px 10px; display: flex; flex-direction: column; gap: 8px; }
/* 时间轴竖线：回合 → 步骤 → 调用 串联 */
.evo-traj-turn-body { position: relative; margin-left: 13px; padding-left: 17px; border-left: 1px solid var(--color-border); }
.evo-traj-quote { display: flex; flex-direction: column; gap: 4px; padding: 8px 12px; border-radius: var(--r-sm); background: color-mix(in srgb, var(--brand) 6%, var(--color-background)); }
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
.evo-traj-args { color: var(--color-text-tertiary); font-family: var(--font-mono); font-size: 11.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 30%; min-width: 0; }
.evo-traj-tokens { padding: 1px 9px; font-variant-numeric: tabular-nums; background: color-mix(in srgb, var(--accent-sage) 26%, transparent); color: var(--brand); }
.evo-traj-bar { flex: 1; min-width: 30px; height: 5px; background: var(--hover-bg); border-radius: var(--r-pill); overflow: hidden; flex-shrink: 0; }
.evo-traj-bar-fill { display: block; height: 100%; background: color-mix(in srgb, var(--brand) 55%, var(--color-border)); border-radius: var(--r-pill); }
.evo-traj-dur { flex-shrink: 0; font-size: 11px; color: var(--color-text-tertiary); font-variant-numeric: tabular-nums; min-width: 52px; text-align: right; }
.evo-traj-dur.slow { color: var(--brand); font-weight: 700; }
.evo-traj-status { flex-shrink: 0; display: inline-flex; }
.evo-traj-status svg { width: 13px; height: 13px; color: var(--color-success); }
.evo-traj-status.error svg { color: var(--color-error); }
.evo-traj-call-detail { padding: 2px 12px 10px 30px; display: flex; flex-direction: column; gap: 4px; }
.evo-traj-detail { display: flex; flex-direction: column; gap: 4px; }
.evo-traj-detail-head { display: flex; align-items: center; gap: 8px; font-size: 11px; color: var(--color-text-tertiary); font-weight: 600; margin-top: 4px; }
.evo-traj-goto { display: inline-flex; align-items: center; gap: 4px; border: none; background: none; color: var(--brand); font-size: 11px; font-weight: 600; cursor: pointer; padding: 2px 6px; border-radius: var(--r-pebble-sm); }
.evo-traj-goto:hover { background: var(--hover-bg); }
.evo-traj-goto svg { width: 12px; height: 12px; }
.evo-traj-meta { font-size: 11px; color: var(--color-text-tertiary); font-variant-numeric: tabular-nums; }
.evo-traj-detail-pre { margin: 0; padding: 8px 10px; background: var(--color-background); border: 1px solid var(--color-border-light); border-radius: var(--r-sm); font-family: var(--font-mono); font-size: 11.5px; line-height: 1.55; white-space: pre-wrap; word-break: break-word; color: var(--color-text-secondary); max-height: 240px; overflow-y: auto; }
.evo-traj-detail-pre.error { color: var(--color-error); }
/* ── 会话统计栏（紧邻输入框、小字号）── */
.evo-statusbar { flex-shrink: 0; height: 20px; display: flex; align-items: center; justify-content: center; gap: 14px; padding: 0 16px; border-top: 1px solid var(--color-border); background-color: var(--color-background); background-image: var(--organic-grain); font-size: 11px; color: var(--color-text-tertiary); font-variant-numeric: tabular-nums; overflow: hidden; white-space: nowrap; }
.evo-statusbar-empty { color: var(--color-text-tertiary); opacity: 0.55; }
.evo-statusbar-item { display: inline-flex; align-items: center; gap: 4px; }
.evo-statusbar-item b { font-weight: 600; color: var(--color-text-secondary); }
.evo-statusbar-label { color: var(--color-text-tertiary); }
.evo-statusbar-sep { opacity: 0.5; margin: 0 1px; }
/* ── 研究笔记面板（NOTE-UI：列表 / 阅读分页 / 草稿 / 背景资料）── */
.evo-note-toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.evo-note-search { flex: 1; min-width: 160px; padding: 7px 13px; font-size: 13px; }
.evo-note-card { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; cursor: pointer; text-align: left; font: inherit; width: 100%; }
.evo-note-card:hover { border-color: color-mix(in srgb, var(--brand) 45%, var(--color-border)); }
.evo-note-card-head { display: flex; align-items: center; gap: 8px; min-width: 0; }
.evo-note-card-title { flex: 1; font-size: 13.5px; font-weight: 600; color: var(--color-text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.evo-note-badge { padding: 1px 9px; font-size: 10.5px; white-space: nowrap; }
.evo-note-badge.note { background: color-mix(in srgb, var(--brand) 14%, transparent); color: var(--brand); }
.evo-note-badge.legacy { background: color-mix(in srgb, var(--color-warning) 14%, transparent); color: var(--color-warning); }
.evo-note-badge.fm { background: var(--accent-mist); color: var(--color-text-tertiary); }
.evo-note-card-preview { font-size: 12.5px; color: var(--color-text-secondary); line-height: 1.5; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.evo-note-card-meta { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--color-text-tertiary); flex-wrap: wrap; }
.evo-note-detail { display: flex; flex-direction: column; gap: 10px; }
.evo-note-detail-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.evo-note-detail-title { font-family: var(--font-serif); font-size: 16px; font-weight: 600; color: var(--color-text-primary); min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.evo-note-detail-acts { display: flex; align-items: center; gap: 4px; margin-left: auto; flex-shrink: 0; }
.evo-note-body { padding: 12px 14px; }
.evo-note-fm { border: 1px dashed var(--color-border); border-radius: var(--r-sm); padding: 8px 10px; font-size: 12px; color: var(--color-text-tertiary); background: var(--color-background); }
.evo-note-fm-toggle { border: none; background: none; color: var(--brand); font-size: 12px; cursor: pointer; padding: 0; font: inherit; }
.evo-note-fm-grid { display: grid; grid-template-columns: max-content 1fr; gap: 2px 14px; margin-top: 6px; word-break: break-word; }
.evo-note-fm-key { font-family: var(--font-mono); color: var(--color-text-secondary); }
.evo-note-pager { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.evo-note-pager-info { font-size: 11.5px; color: var(--color-text-tertiary); }
.evo-note-editor { display: flex; flex-direction: column; gap: 8px; }
.evo-note-textarea { width: 100%; min-height: 220px; max-height: 60vh; resize: vertical; padding: 9px 11px; font-size: 13px; line-height: 1.55; font-family: var(--font-mono); }
.evo-note-textarea-sm { min-height: 120px; }
.evo-note-hit { display: flex; align-items: flex-start; gap: 8px; padding: 7px 11px; background: var(--color-background); cursor: pointer; text-align: left; font: inherit; width: 100%; }
.evo-note-hit:hover { border-color: color-mix(in srgb, var(--brand) 45%, var(--color-border)); }
.evo-note-hit-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.evo-note-hit-title { display: flex; align-items: center; gap: 8px; font-size: 12.5px; font-weight: 600; color: var(--color-text-primary); }
.evo-note-hit-snippet { font-size: 12px; color: var(--color-text-secondary); line-height: 1.5; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.evo-note-hit-meta { font-size: 11px; color: var(--color-text-tertiary); }
.evo-note-draft { display: flex; flex-direction: column; overflow: hidden; }
.evo-note-draft-head { display: flex; align-items: center; gap: 8px; padding: 9px 12px; }
.evo-note-draft-target { font-size: 12.5px; font-weight: 600; color: var(--color-text-primary); font-family: var(--font-mono); }
.evo-note-draft-note { font-size: 11.5px; color: var(--color-text-secondary); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.evo-note-draft-body { border-top: 1px solid var(--color-border-light); padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
.evo-note-draft-text { max-height: 40vh; overflow: auto; font-size: 12.5px; line-height: 1.55; white-space: pre-wrap; word-break: break-word; color: var(--color-text-secondary); background: var(--color-background); border: 1px solid var(--color-border-light); border-radius: var(--r-sm); padding: 8px 10px; }
.evo-note-draft-acts { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.evo-note-conflict { padding: 7px 10px; border: 1px solid color-mix(in srgb, var(--color-error) 50%, var(--color-border)); background: color-mix(in srgb, var(--color-error) 10%, var(--color-surface)); color: var(--color-error); border-radius: var(--r-sm); font-size: 12px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.evo-note-doc { padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
.evo-note-doc-head { display: flex; align-items: center; gap: 8px; }
.evo-note-doc-name { font-size: 13px; font-weight: 600; color: var(--color-text-primary); font-family: var(--font-mono); }
.evo-note-doc-acts { margin-left: auto; display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
.evo-note-doc-body { max-height: 45vh; overflow: auto; }
.evo-note-doc-missing { font-size: 12px; color: var(--color-text-tertiary); }
/* ── 文献与稿件面板（LIB-UI） ── */
.evo-lib-badge { padding: 1px 9px; font-size: 10.5px; white-space: nowrap; }
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
.evo-lib-log { max-height: 45vh; overflow: auto; white-space: pre-wrap; word-break: break-word; font-size: 12px; line-height: 1.5; font-family: var(--font-mono); background: var(--color-background); border: 1px solid var(--color-border-light); border-radius: var(--r-sm); padding: 8px 10px; color: var(--color-text-secondary); }
.evo-lib-list { display: flex; flex-direction: column; gap: 6px; }
.evo-lib-block { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; }
.evo-lib-tree { display: flex; flex-direction: column; gap: 2px; max-height: 30vh; overflow: auto; }
.evo-lib-file { display: flex; align-items: center; gap: 6px; padding: 4px 8px; border: none; background: none; border-radius: var(--r-xs); color: var(--color-text-secondary); font-size: 12.5px; cursor: pointer; text-align: left; font-family: var(--font-mono); }
.evo-lib-file:hover { background: var(--hover-bg); color: var(--color-text-primary); }
.evo-lib-file[data-active] { background: var(--hover-bg); color: var(--brand); }
.evo-lib-file svg { width: 13px; height: 13px; flex-shrink: 0; }
.evo-lib-err { font-size: 12px; color: var(--color-error); font-family: var(--font-mono); padding: 4px 8px; background: color-mix(in srgb, var(--color-error) 8%, transparent); border-radius: var(--r-xs); }
.evo-lib-project { max-width: 220px; padding: 3px 8px; border: 1px solid var(--color-border); border-radius: var(--r-xs); background: var(--color-background); color: var(--color-text-primary); font-size: 12px; margin-left: auto; }
/* ── 实验工作区面板（EXP-UI：Tab 切换 / 笔记 / 运行 / 日志 / 复盘 / 产物）── */
.evo-ews-tabs { display: flex; gap: 4px; padding-bottom: 12px; border-bottom: 1px solid var(--color-border); margin-bottom: 14px; }
.evo-ews-tab { display: inline-flex; align-items: center; gap: 6px; padding: 6px 14px; border: none; border-radius: var(--r-sm); background: transparent; color: var(--color-text-secondary); font-size: 13px; font-weight: 600; cursor: pointer; font: inherit; }
.evo-ews-tab:hover { background: var(--hover-bg); color: var(--color-text-primary); }
.evo-ews-tab[data-active] { background: color-mix(in srgb, var(--brand) 12%, var(--color-surface)); color: var(--brand); }
.evo-ews-tab svg { width: 14px; height: 14px; }
.evo-ews-section { padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
.evo-ews-section-head { display: flex; align-items: center; gap: 8px; font-size: 12.5px; font-weight: 600; color: var(--color-text-secondary); flex-wrap: wrap; }
.evo-ews-section-head > svg { width: 14px; height: 14px; color: var(--brand); flex-shrink: 0; }
.evo-ews-section-head > span { flex: 1; }
.evo-ews-note-view { font-size: 12.5px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; color: var(--color-text-secondary); background: var(--color-background); border: 1px solid var(--color-border-light); border-radius: var(--r-sm); padding: 8px 10px; max-height: 300px; overflow-y: auto; }
.evo-ews-run-form { display: flex; flex-direction: column; gap: 6px; }
.evo-ews-status-badge { display: inline-flex; align-items: center; gap: 6px; padding: 2px 10px; border-radius: var(--r-pill); font-size: 11.5px; font-weight: 600; flex-shrink: 0; }
.evo-ews-status-badge[data-status='running'] { background: color-mix(in srgb, var(--brand) 14%, transparent); color: var(--brand); }
.evo-ews-status-badge[data-status='success'] { background: color-mix(in srgb, var(--color-success) 14%, transparent); color: var(--color-success); }
.evo-ews-status-badge[data-status='failed'] { background: color-mix(in srgb, var(--color-error) 14%, transparent); color: var(--color-error); }
.evo-ews-status-badge[data-status='user-stopped'], .evo-ews-status-badge[data-status='unknown'] { background: var(--accent-mist); color: var(--color-text-secondary); }
.evo-ews-run-meta { font-family: var(--font-mono); font-size: 11px; color: var(--color-text-tertiary); word-break: break-all; }
.evo-ews-log-view { background: var(--color-background); border: 1px solid var(--color-border-light); border-radius: var(--r-sm); font-family: var(--font-mono); font-size: 11.5px; line-height: 1.5; color: var(--color-text-secondary); white-space: pre-wrap; word-break: break-word; max-height: 280px; overflow-y: auto; padding: 8px 10px; }
.evo-ews-log-acts { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.evo-ews-check { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--color-text-secondary); cursor: pointer; }
.evo-ews-check input { accent-color: var(--brand); }
.evo-ews-tree { display: flex; flex-direction: column; gap: 1px; font-size: 12px; max-height: 320px; overflow-y: auto; }
.evo-ews-tree-row { display: flex; align-items: center; gap: 6px; padding: 2px 4px; border-radius: var(--r-xs); color: var(--color-text-secondary); min-width: 0; }
.evo-ews-tree-row:hover { background: var(--hover-bg); }
.evo-ews-tree-row > svg { width: 13px; height: 13px; flex-shrink: 0; color: var(--color-text-tertiary); }
.evo-ews-tree-row[data-dir] > svg { color: var(--brand); }
.evo-ews-tree-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.evo-ews-tree-size { margin-left: auto; font-size: 10.5px; color: var(--color-text-tertiary); flex-shrink: 0; }
.evo-ews-tree-children { padding-left: 16px; display: flex; flex-direction: column; gap: 1px; }
.evo-ews-retro { max-height: 40vh; overflow: auto; font-size: 12px; line-height: 1.55; white-space: pre-wrap; word-break: break-word; color: var(--color-text-secondary); background: var(--color-background); border: 1px solid var(--color-border-light); border-radius: var(--r-sm); padding: 8px 10px; }
.evo-ews-item-sub { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 11.5px; color: var(--color-text-tertiary); }
.evo-ews-badge { padding: 1px 9px; font-size: 10.5px; white-space: nowrap; }
.evo-ews-badge.ref { background: color-mix(in srgb, var(--color-warning) 14%, transparent); color: var(--color-warning); }
.evo-ews-badge.copy { background: color-mix(in srgb, var(--brand) 14%, transparent); color: var(--brand); }
/* ── Milkdown 所见即所得 composer ── */
.evo-composer-editor { position: relative; display: flex; flex-direction: column; flex: 0 0 auto; min-height: 112px; height: 112px; overflow: hidden; }
.evo-composer-editor-host { flex: 1 1 auto; min-height: 0; overflow: hidden; }
.evo-composer-editor[data-markdown-plain] .evo-md-toolbar { display: none; }
.evo-composer-editor[data-markdown-plain] .evo-composer-editor-host { display: none; }
.evo-composer-source {
  box-sizing: border-box; flex: 1 1 auto; min-height: 0; width: 100%; height: 100%; resize: none;
  padding: 10px 14px 12px; border: 0; outline: none; background: transparent; color: var(--color-text-primary);
  font: inherit; font-size: 14.5px; line-height: 1.55; white-space: pre-wrap; overflow-y: auto;
}
.evo-composer-source::placeholder { color: var(--color-text-placeholder); opacity: 1; }
.evo-composer-placeholder { position: absolute; top: 10px; left: 14px; right: 14px; color: var(--color-text-placeholder); font: inherit; font-size: 14.5px; line-height: 1.55; pointer-events: none; user-select: none; white-space: pre-wrap; }
.evo-composer-editor[data-markdown-toolbar-open] .evo-composer-placeholder { top: 46px; }
.evo-md-toolbar { display: flex; flex: 0 0 0; align-items: center; gap: 2px; height: 0; min-height: 0; padding: 0 10px; overflow: hidden; overflow-x: auto; scrollbar-width: none; border-bottom: 0 solid transparent; }
.evo-composer-editor[data-markdown-toolbar-open] .evo-md-toolbar { flex-basis: 36px; height: 36px; border-bottom-width: 1px; border-bottom-color: var(--color-border-light); }
.evo-md-btn { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; width: 28px; height: 28px; padding: 0; border: 1px solid transparent; border-radius: var(--r-xs); background-color: transparent; color: var(--color-text-secondary); cursor: pointer; transition: background-color 0.15s, color 0.15s, border-color 0.15s; }
.evo-md-btn svg { width: 15px; height: 15px; }
.evo-md-btn:hover { background-color: var(--hover-bg); color: var(--color-text-primary); }
.evo-md-btn:focus-visible { outline: none; border-color: var(--color-border); color: var(--brand); }
.evo-md-sep { flex: 0 0 auto; width: 1px; height: 18px; margin: 0 5px; background: var(--color-border-light); }
.evo-md-toolbar .evo-md-heading { flex: 0 0 auto; width: auto; }
.evo-md-toolbar .evo-md-heading .evo-dropdown-btn { width: auto; height: 28px; padding: 0 7px; font-size: 12px; color: var(--color-text-secondary); }
.evo-md-toolbar .evo-md-heading .evo-dropdown-btn svg { width: 14px; height: 14px; }
.evo-md-link-input { flex: 0 1 190px; min-width: 0; height: 28px; padding: 0 11px; font-size: 12.5px; }
.evo-composer-editor-host .milkdown { height: 100%; min-height: 0; }
.evo-composer-editor-host .milkdown .ProseMirror { height: 100%; overflow-y: auto; padding: 10px 14px 12px; outline: none; color: var(--color-text-primary); font-family: inherit; font-size: 14.5px; line-height: 1.55; white-space: pre-wrap; word-wrap: break-word; caret-color: var(--color-text-primary); }
.evo-composer-editor-host .milkdown .ProseMirror p { margin: 0 0 7px; }
.evo-composer-editor-host .milkdown .ProseMirror p:last-child { margin-bottom: 0; }
.evo-composer-editor-host .milkdown .ProseMirror h1, .evo-composer-editor-host .milkdown .ProseMirror h2, .evo-composer-editor-host .milkdown .ProseMirror h3, .evo-composer-editor-host .milkdown .ProseMirror h4 { color: var(--color-text-primary); margin: 10px 0 6px; line-height: 1.3; }
.evo-composer-editor-host .milkdown .ProseMirror h1 { font-size: 20px; border-bottom: 1px solid var(--color-border-light); padding-bottom: 4px; }
.evo-composer-editor-host .milkdown .ProseMirror h2 { font-size: 17px; border-bottom: 1px solid var(--color-border-light); padding-bottom: 3px; }
.evo-composer-editor-host .milkdown .ProseMirror h3 { font-size: 15.5px; }
.evo-composer-editor-host .milkdown .ProseMirror blockquote { margin: 6px 0; padding: 2px 12px; border-left: 3px solid var(--brand); color: var(--color-text-secondary); }
.evo-composer-editor-host .milkdown .ProseMirror pre { margin: 6px 0; padding: 8px 12px; background: var(--hover-bg); border: 1px solid var(--color-border-light); border-radius: var(--r-sm); overflow-x: auto; }
.evo-composer-editor-host .milkdown .ProseMirror pre code { background: transparent; padding: 0; font-size: 12.5px; }
.evo-composer-editor-host .milkdown .ProseMirror code { background: var(--hover-bg); color: var(--color-text-primary); padding: 1px 5px; border-radius: var(--r-2xs); font-size: 0.88em; font-family: var(--font-mono); }
.evo-composer-editor-host .milkdown .ProseMirror a { color: var(--brand); }
.evo-composer-editor-host .milkdown .ProseMirror ul, .evo-composer-editor-host .milkdown .ProseMirror ol { margin: 4px 0; padding-left: 22px; }
.evo-composer-editor-host .milkdown .ProseMirror li { margin: 1px 0; }
.evo-composer-editor-host .milkdown .ProseMirror li[data-list-type="bullet"] { list-style: disc; }
.evo-composer-editor-host .milkdown .ProseMirror li[data-list-type="ordered"] { list-style: decimal; }
.evo-composer-editor-host .milkdown .ProseMirror li[data-item-type="task"] { list-style: none; display: flex; align-items: flex-start; gap: 6px; }
.evo-composer-editor-host .milkdown .ProseMirror li[data-item-type="task"]::before { content: ''; flex: 0 0 auto; width: 13px; height: 13px; margin-top: 3px; border: 1.5px solid var(--color-text-tertiary); border-radius: var(--r-2xs); background: var(--color-background); cursor: pointer; }
.evo-composer-editor-host .milkdown .ProseMirror li[data-item-type="task"][data-checked="true"]::before { background: var(--brand); border-color: var(--brand); }
.evo-composer-editor-host .milkdown .ProseMirror li[data-item-type="task"][data-checked="true"] > p { text-decoration: line-through; color: var(--color-text-tertiary); }
.evo-composer-editor-host .milkdown .ProseMirror table { border-collapse: collapse; margin: 6px 0; }
.evo-composer-editor-host .milkdown .ProseMirror th, .evo-composer-editor-host .milkdown .ProseMirror td { border: 1px solid var(--color-border); padding: 4px 9px; font-size: 13px; }
.evo-composer-editor-host .milkdown .ProseMirror th { background: var(--hover-bg); font-weight: 600; }
.evo-composer-editor-host .milkdown .ProseMirror hr { margin: 10px 0; border: 0; border-top: 1px solid var(--color-border); }
.evo-composer-editor-host .milkdown .ProseMirror .ProseMirror-selectednode { outline: 2px solid color-mix(in srgb, var(--brand) 45%, transparent); outline-offset: 1px; border-radius: var(--r-2xs); }
.evo-composer-editor-host .milkdown .ProseMirror .code-block::before { content: attr(data-language); display: block; margin-bottom: 4px; font-size: 10.5px; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing: 0.4px; }
.evo-composer-markdown-state { display: inline-flex; align-items: center; gap: 5px; color: var(--color-text-tertiary); font-size: 11px; border: 0; background: none; padding: 2px 6px; border-radius: var(--r-xs); cursor: pointer; transition: background-color 0.15s, color 0.15s; }
.evo-composer-markdown-state:hover { background: var(--hover-bg); color: var(--color-text-secondary); }
.evo-composer-markdown-state[data-on] { color: var(--brand); }
.evo-composer-markdown-state::before { content: 'M'; display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; border: 1px solid color-mix(in srgb, var(--brand) 45%, var(--color-border)); border-radius: var(--r-2xs); color: var(--brand); font-size: 10px; font-weight: 700; }
.evo-composer-markdown-toggle { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; width: 24px; height: 24px; padding: 0; border: 1px solid transparent; border-radius: var(--r-xs); background: transparent; color: var(--color-text-tertiary); cursor: pointer; transition: color .15s ease, background-color .15s ease, border-color .15s ease; }
.evo-composer-markdown-toggle svg { width: 14px; height: 14px; }
.evo-composer-markdown-toggle:hover, .evo-composer-markdown-toggle:focus-visible { color: var(--brand); background: var(--hover-bg); border-color: var(--color-border-light); outline: none; }
.evo-composer-markdown-toggle[data-on] { color: var(--brand); background: color-mix(in srgb, var(--brand) 12%, transparent); border-color: color-mix(in srgb, var(--brand) 28%, var(--color-border-light)); }
.evo-composer-markdown-toggle:disabled { opacity: 0.45; cursor: not-allowed; }
html.dark .evo-composer-editor-host .milkdown .ProseMirror pre { background: color-mix(in srgb, var(--color-background) 74%, var(--accent-tan) 6%); }
@media (prefers-reduced-motion: reduce) { .evo-composer-editor .evo-md-btn { transition: none; } }
@media (max-width: 620px) {
  .evo-composer-editor .evo-md-toolbar { padding-inline: 5px; overflow-x: auto; }
  .evo-composer-editor .evo-md-btn { width: 26px; }
  .evo-composer-markdown-state { display: none; }
  .evo-composer-markdown-toggle { width: 26px; height: 26px; }
}
@container (max-width: 560px) {
  .evo-composer-perm .evo-dropdown-value,
  .evo-composer-openin .evo-dropdown-value,
  .evo-composer-model-name,
  .evo-composer-model-effort { display: none; }
  .evo-composer-perm .evo-dropdown-btn,
  .evo-composer-model { width: 30px; height: 28px; justify-content: center; padding-inline: 6px; gap: 0; }
  .evo-composer-openin .evo-dropdown-btn { padding-inline: 5px; gap: 0; }
}
/* ── 科研回合（Part B：四阶段模板）── */
.evo-rounds-card { gap: 10px; }
.evo-rounds-id { font-size: 11px; color: var(--color-text-tertiary); font-family: var(--font-mono); }
.evo-rounds-progress { display: flex; gap: 6px; flex-wrap: wrap; }
.evo-rounds-step { flex: 1; min-width: 72px; display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 8px 6px; border: 1px solid var(--color-border-light); border-radius: var(--r-sm); background: var(--color-background); }
.evo-rounds-step[data-status='done'] { border-color: color-mix(in srgb, var(--color-success) 35%, var(--color-border)); background: color-mix(in srgb, var(--color-success) 8%, var(--color-background)); }
.evo-rounds-step[data-current] { border-color: var(--brand); box-shadow: 0 0 0 1px color-mix(in srgb, var(--brand) 18%, transparent); }
.evo-rounds-step-num { font-size: 14px; font-weight: 700; color: var(--color-text-secondary); }
.evo-rounds-step[data-status='done'] .evo-rounds-step-num { color: var(--color-success); }
.evo-rounds-step[data-current] .evo-rounds-step-num { color: var(--brand); }
.evo-rounds-step-label { font-size: 11px; font-weight: 600; color: var(--color-text-secondary); }
.evo-rounds-step-check { width: 13px; height: 13px; color: var(--color-success); }
.evo-rounds-step-spin { width: 13px; height: 13px; color: var(--brand); animation: evo-spin 1s linear infinite; }
.evo-rounds-done-hint { padding: 6px 10px; border-radius: var(--r-sm); background: color-mix(in srgb, var(--color-success) 10%, transparent); color: var(--color-success); }
.evo-rounds-phases { display: flex; flex-direction: column; gap: 8px; }
.evo-rounds-phase { padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; }
.evo-rounds-phase[data-current] { border-color: color-mix(in srgb, var(--brand) 40%, var(--color-border)); }
.evo-rounds-phase[data-status='done'] { background: color-mix(in srgb, var(--color-success) 5%, var(--color-surface)); }
.evo-rounds-phase-head { display: flex; align-items: center; gap: 8px; }
.evo-rounds-phase-num { font-weight: 700; color: var(--brand); font-size: 12.5px; }
.evo-rounds-phase-name { font-weight: 600; color: var(--color-text-primary); font-size: 12.5px; }
.evo-rounds-phase-status { margin-left: auto; padding: 1px 9px; }
.evo-rounds-phase[data-status='done'] .evo-rounds-phase-status { background: color-mix(in srgb, var(--color-success) 14%, transparent); color: var(--color-success); }
.evo-rounds-phase[data-current] .evo-rounds-phase-status { background: color-mix(in srgb, var(--brand) 12%, transparent); color: var(--brand); }
.evo-rounds-prompt { font-size: 11.5px; line-height: 1.5; }
.evo-rounds-editor { display: flex; flex-direction: column; gap: 6px; }
.evo-rounds-textarea { min-height: 88px; resize: vertical; font-family: inherit; line-height: 1.6; }
.evo-rounds-acts { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.evo-rounds-ai-btn { opacity: 0.55; }
.evo-rounds-done-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.evo-rounds-view { border: 1px solid var(--color-border-light); border-radius: var(--r-sm); background: var(--color-background); overflow: hidden; }
.evo-rounds-view-head { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-bottom: 1px solid var(--color-border-light); font-size: 12px; font-weight: 600; color: var(--color-text-secondary); }
.evo-rounds-view-body { margin: 0; padding: 8px 10px; font-size: 12.5px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; max-height: 300px; overflow-y: auto; color: var(--color-text-secondary); font-family: var(--font-mono); }
/* ── 日报卡片（Part C：手动 + 定时）── */
.evo-ews-dup { border: 1px solid color-mix(in srgb, var(--color-warning) 30%, var(--color-border-light)); border-radius: var(--r-sm); background: color-mix(in srgb, var(--color-warning) 8%, var(--color-surface)); padding: 8px 10px; display: flex; flex-direction: column; gap: 6px; }
.evo-ews-toolbar { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.evo-report-drawer { position: fixed; inset: 0; z-index: 400; display: flex; justify-content: flex-end; }
.evo-report-mask { flex: 1; background: var(--scrim); }
.evo-report-card { width: min(480px, 92vw); height: 100%; border-radius: var(--r-lg) 0 0 var(--r-lg); display: flex; flex-direction: column; overflow: hidden; }
.evo-report-head { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-bottom: 1px solid var(--color-border-light); font-weight: 600; color: var(--color-text-primary); }
.evo-report-head svg { width: 16px; height: 16px; color: var(--brand); }
.evo-report-body { flex: 1; overflow-y: auto; padding: 12px 14px; display: flex; flex-direction: column; gap: 14px; }
.evo-report-section { background: var(--color-background); padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
.evo-report-section-head { display: flex; align-items: center; gap: 8px; font-size: 12.5px; font-weight: 600; color: var(--color-text-secondary); }
.evo-report-section-head svg { width: 14px; height: 14px; color: var(--brand); }
.evo-report-generate { width: 100%; justify-content: center; }
.evo-report-preview-wrap { display: flex; flex-direction: column; gap: 6px; }
.evo-report-preview-head { display: flex; align-items: center; gap: 8px; }
.evo-report-preview { margin: 0; padding: 8px 10px; background: var(--color-surface); border: 1px solid var(--color-border-light); border-radius: var(--r-sm); font-size: 12px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; color: var(--color-text-secondary); max-height: 260px; overflow-y: auto; font-family: var(--font-mono); }
.evo-report-modes { display: flex; gap: 6px; flex-wrap: wrap; }
.evo-report-list { display: flex; flex-direction: column; gap: 6px; max-height: 220px; overflow-y: auto; }
.evo-report-row { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border: 1px solid var(--color-border-light); border-radius: var(--r-sm); background: var(--color-surface); }
.evo-report-row[data-active] { border-color: var(--brand); }
.evo-report-row-main { flex: 1; display: flex; align-items: center; gap: 8px; min-width: 0; }
.evo-report-row-time { font-size: 12px; color: var(--color-text-primary); font-family: var(--font-mono); }
.evo-report-badge { padding: 1px 9px; font-size: 10.5px; }
.evo-report-badge.manual { background: color-mix(in srgb, var(--brand) 12%, transparent); color: var(--brand); }
.evo-report-badge.auto { background: var(--accent-mist); color: var(--color-text-tertiary); }
.evo-spin { animation: evo-spin 1s linear infinite; }
/* ── 实验账本（Part A：Git 8 条纪律）── */
.evo-ledger-exp-list { display: flex; gap: 6px; flex-wrap: wrap; }
.evo-ledger-exp { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border: 1px solid var(--color-border-light); border-radius: var(--r-pill); background: var(--color-surface); color: var(--color-text-secondary); font-size: 12.5px; cursor: pointer; }
.evo-ledger-exp:hover { border-color: var(--brand); color: var(--color-text-primary); }
.evo-ledger-exp[data-active] { background: color-mix(in srgb, var(--brand) 12%, var(--color-surface)); border-color: var(--brand); color: var(--brand); font-weight: 600; }
.evo-ledger-exp svg { width: 14px; height: 14px; }
.evo-ledger-exp-name { font-weight: 600; }
.evo-ledger-exp-time { font-size: 11px; color: var(--color-text-tertiary); }
.evo-ledger-detail { display: flex; flex-direction: column; gap: 12px; margin-top: 10px; }
.evo-ledger-card { padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
.evo-ledger-card-head { display: flex; align-items: center; gap: 8px; font-size: 12.5px; font-weight: 600; color: var(--color-text-secondary); flex-wrap: wrap; }
.evo-ledger-card-head svg { width: 14px; height: 14px; color: var(--brand); flex-shrink: 0; }
.evo-ledger-ok { color: var(--color-success); font-weight: 600; font-size: 12.5px; }
.evo-ledger-bad { color: var(--color-error); font-size: 12.5px; }
.evo-ledger-exists { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.evo-ledger-notfound { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.evo-ledger-confirm { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 12px; color: var(--color-text-secondary); }
.evo-ledger-cancel { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; border: none; background: var(--hover-bg); border-radius: var(--r-pebble-sm); color: var(--color-text-tertiary); cursor: pointer; }
.evo-ledger-cancel:hover { color: var(--color-text-primary); }
.evo-ledger-log { display: flex; flex-direction: column; gap: 6px; max-height: 360px; overflow-y: auto; }
.evo-ledger-row { display: flex; align-items: center; gap: 8px; padding: 7px 10px; border: 1px solid var(--color-border-light); border-radius: var(--r-sm); background: var(--color-background); }
.evo-ledger-row[data-kind='rejected'] { border-color: color-mix(in srgb, var(--color-error) 30%, var(--color-border-light)); }
.evo-ledger-kind { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: var(--r-xs); background: var(--hover-bg); color: var(--color-text-secondary); flex-shrink: 0; }
.evo-ledger-kind svg { width: 13px; height: 13px; }
.evo-ledger-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.evo-ledger-msg { font-size: 12.5px; color: var(--color-text-primary); display: flex; gap: 6px; align-items: center; min-width: 0; }
.evo-ledger-kind-label { padding: 1px 6px; border-radius: var(--r-pill); font-size: 10.5px; background: var(--hover-bg); color: var(--color-text-secondary); flex-shrink: 0; }
.evo-ledger-meta { font-size: 11px; color: var(--color-text-tertiary); display: flex; gap: 8px; font-family: var(--font-mono); }
.evo-ledger-notice { padding: 6px 10px; border-radius: var(--r-sm); background: color-mix(in srgb, var(--color-success) 10%, var(--color-surface)); color: var(--color-success); font-size: 12.5px; border: 1px solid color-mix(in srgb, var(--color-success) 24%, transparent); }
.evo-ledger-json { margin: 0; padding: 8px 10px; background: var(--color-background); border: 1px solid var(--color-border-light); border-radius: var(--r-sm); font-size: 11.5px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; color: var(--color-text-secondary); font-family: var(--font-mono); max-height: 240px; overflow-y: auto; }
.evo-ledger-prov-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 6px; font-size: 12px; color: var(--color-text-secondary); }
.evo-ledger-k { display: inline-block; min-width: 48px; font-weight: 600; color: var(--color-text-tertiary); margin-right: 6px; }
.evo-ledger-recent { display: flex; flex-direction: column; gap: 6px; }
.evo-ledger-resume-guide { display: flex; flex-direction: column; gap: 6px; padding: 8px 10px; border: 1px dashed color-mix(in srgb, var(--brand) 30%, var(--color-border-light)); border-radius: var(--r-sm); background: color-mix(in srgb, var(--brand) 6%, var(--color-surface)); }
`
