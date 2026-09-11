# 自然有机风（Natural Organic）全站视觉改版方案

> 目标：把 EvoResearch 网页端整体呈现风格切换为 **Natural Organic（自然有机风）**——温暖大地色系、自然纹理、手工感元素，并保持信息密度、功能行为与无障碍基线不变。
> 本文是改版的实施计划书（含设计令牌、深色方案推导、组件复用清单、验收清单）。
> 参考：stylekit.top `/styles/natural-organic`（规则与禁止项）。浅色盘由需求给定，深色盘为本方案推导（§3）。

---

## 1. 现状与改造策略

现状（改造前）已有一套 token 驱动的暖色系统：`:root` / `html.dark` 两组变量（`--color-*`、`--brand*`、`--radius`、`--input-bg`、`--hover-bg`、`--graph-*`），全站 1024 处 `var(--…)` 引用，硬编码色值集中在 `packages/evoresearch-app/src/client/styles.ts`（132 处 hex / 55 处 rgb）+ 少量 TS 常量。

因此改版分三层推进，逐层可独立验收：

| 层 | 内容 | 覆盖比例 |
|----|------|----------|
| **L1 令牌层** | 重写 `:root` / `html.dark`：大地色系、语义色、形状（圆角）令牌、字体、动效曲线、纹理、阴影；`--graph-*` 全套改为大地色 | 全站 ~90% 自动生效 |
| **L2 组件层** | 新增共享组件类（`.evo-pop` / `.evo-btn*` / `.evo-field` / `.evo-chip` / `.evo-card` / `.evo-avatar` / `.evo-dot`），并把既有同类规则**合并到同一组选择器**，同一类控件只由一处定义配色与形状 | 消除同类控件配色漂移 |
| **L3 清扫层** | 逐条清除硬编码色值、线性渐变、纯黑阴影、`border-radius: 50%`（正圆）、尖锐小圆角；加有机 hover（下沉 / 返青 / 缓慢形变）与衬线标题 | 剩余边角 |

不改动：功能逻辑、信息架构、布局尺寸、交互行为、URL 规则、数据目录。

---

## 2. 浅色配色盘（需求给定 → 语义映射）

| 令牌 | 值 | 来源 | 用途 |
|------|----|------|------|
| `--color-background` | `#faf6f1` | Secondary | 页面底色（暖米色） |
| `--color-surface` | `#fffdf9` | 派生 | 卡片/面板/气泡（暖白，**非纯白**） |
| `--input-bg` | `#fffdf9` | 派生 | 输入框表面 |
| `--hover-bg` | `#efe5d8` | 派生 | hover 底（土色层） |
| `--brand` | `#5b6d43` | Accent 1 深化 | **交互色**（链接/图标/选中/焦点环）——鼠尾草深绿 |
| `--brand-hover` | `#46592f` | Accent 1 再深化 | 交互色 hover（"返青"落地为更深的绿） |
| `--brand-solid` | `#5c4033` | **Primary** | 主按钮填充（石褐），前景 `--brand-foreground: #faf6f1` |
| `--accent-sage` | `#8b9d77` | Accent 1 | 强调底/圆点/装饰（**不作小字正文**） |
| `--accent-tan` | `#d4a373` | Accent 2 | 强调底/装饰 |
| `--accent-mist` | `#e9e0d4` | Accent 3 | 次级面/头像底/分隔 |
| `--accent-teal` | `#75a191` | Accent 4 | 强调底/装饰（辅助冷色，唯一允许的偏青，来自给定盘） |
| `--color-text-primary` | `#3b3226` | 派生 | 正文（暖石褐，**非纯黑**） |
| `--color-text-secondary` | `#6b5f50` | 派生 | 次级文字 |
| `--color-text-tertiary` | `#786c5c` | 派生 | 三级文字与 placeholder（同值，靠字体样式区分） |
| `--color-border` | `#e2d8c8` | 派生 | 常规描边 |
| `--color-border-light` | `#ede4d8` | 派生 | 轻描边/分隔线 |
| `--color-success` | `#5d7a45` | 橄榄 | 成功 |
| `--color-warning` | `#8f6019` | 赭石 | 警告 |
| `--color-error` | `#a4472f` | 陶土红 | 错误/危险 |
| `--color-info` | `#47776c` | Accent 4 深化 | 信息（原蓝色已移除） |
| `--color-user-message-bg` / `-message` | `#f2e5d3` / `#4d3722` | Accent 2 系 | 用户气泡（暖沙） |
| `--color-avatar-bg` | `#e9e0d4` | Accent 3 | 用户头像底 |

对比度（WCAG 2.1）：正文 11.7:1、次级 5.8:1、三级 4.8:1、交互色 5.3:1（页面底）/5.6:1（卡片）、主按钮前景 8.7:1、用户气泡 9.0:1，语义色均 ≥4.5:1。`sage/tan/teal` 原色仅用于 ≤3:1 也允许的非文本装饰（圆点、进度条、底纹）。

---

## 3. 深色配色盘（本方案推导）

推导原则：① 保持"大地色系"骨架——底色用**深壤土褐**而非中性黑；② Primary 石褐在深底上不可读，按**同色相提亮为陶土/黏土色**承担主按钮；③ Accent 1 鼠尾草按**提亮 + 降饱和**成为深色下的交互色（浅绿在深底上自然达 AA）；④ 所有色值继续满足"无纯黑、无冷色、无霓虹"。

| 令牌 | 值 | 说明 |
|------|----|------|
| `--color-background` | `#1e1b16` | 深壤土（`#000` 禁用，此为暖近黑） |
| `--color-surface` | `#292420` | 树皮褐面板 |
| `--input-bg` | `#17140f` | 下凹输入面 |
| `--hover-bg` | `#352d24` | hover 土色层 |
| `--color-border` / `--border-light` | `#3e3529` / `#342c22` | 干枝描边 |
| `--brand` / `--brand-hover` | `#a9bf8e` / `#bcd1a3` | 浅鼠尾草（返青） |
| `--brand-solid` / `--foreground` | `#c08a5e` / `#241a12` | 陶土主按钮 + 深字 |
| `--color-text-primary` | `#f0e9dd` | 羊皮纸白 |
| `--color-text-secondary` / `-tertiary` | `#c2b6a4` / `#9d9182` | |
| `--color-success` / `-warning` / `-error` / `-info` | `#8fb06c` / `#d2a24a` / `#d9836b` / `#8ec0b1` | 橄榄 / 赭石 / 陶土 / 鼠尾草青 |
| `--color-user-message-bg` / `-message` | `#3a2c20` / `#ecdcc6` | 陶土暗底 + 沙色字 |
| `--color-avatar-bg` | `#3b3128` | |

深色对比度：正文 14.2:1、次级 8.6:1、三级 5.6:1、交互色 8.6:1、主按钮 5.7:1、用户气泡 10.0:1，全部 AA 通过；最高饱和度 60%（`warning`），无霓虹。

---

## 4. 形状、字体、纹理、动效（风格规则的本项目落地）

**形状（禁止尖锐几何/完美圆/正矩形）**
- 圆角令牌：`--r-2xs 6px`（行内代码/微型标记）、`--r-xs 10px`（小图标钮/行）、`--r-sm 12px`（菜单行/输入/小卡）、`--r-md 16px`（浮层/气泡）、`--r-lg 22px`（抽屉/侧板）、`--r-xl 28px`（预留大面）、`--r-pill 999px`（按钮/胶囊/进度条）。
- 有机 blob：`--r-blob: 22px 17px 24px 15px`（卡片悬停缓慢形变的目标半径）、`--r-blob-lg: 34px 26px 36px 22px`（模态/欢迎卡）、`--r-dot: 50% 46% 52% 48% / 48% 52% 46% 54%`（所有圆点/头像，替掉 `border-radius: 50%`）。
- 悬停形变：卡片/欢迎卡/建议卡 hover 时 `border-radius` 在 `--dur-organic` 内过渡到 blob（"Organic Morphing"）。

**字体**：`--font-sans` 去 Inter/Roboto，改 `Avenir Next / Segoe UI Variable Text / PingFang SC / Microsoft YaHei`；`--font-serif` = `Iowan Old Style / Palatino / 思源宋体 / Songti SC / SimSun`，用于欢迎标题、面板标题、模态标题、Markdown h1–h3（`tracking-tight`，行高舒适）；等宽字体沿用（代码/路径）。

**纹理**：内联 SVG `feTurbulence` 纸纹（`--organic-grain`，浅色 7% / 深色 6% 噪声、平铺 180px、stitchTiles 消接缝）铺在**结构底色**（页面底、左右栏、顶栏、输入区）上；卡片/面板保持干净表面——形成"纸面覆于织物"的层次，也保证正文锐利度（正文不叠噪声）。

**动效**：`--ease-organic: cubic-bezier(.4,0,.2,1)`；`--dur-organic: 480ms`（卡片/菜单/模态等有份量的元素，"植物生长速度"）；`--dur-quick: 200ms`（密集工具区微交互，避免误工效率）；`--dur-morph: 600ms`（blob 形变）。
- Soft Earth Press：按钮/行 hover 下移 0.5px 并加深土色（不用漂浮/弹跳）。
- Verdant Tint：交互文字/图标 hover 缓慢过渡到深绿（`--brand`/`--brand-hover`）。
- `prefers-reduced-motion` 已全局降级（保留），新动效一律走 transition，无新增 keyframes 弹跳。

**禁用项自查（全站）**：无蓝/紫/青主色（唯一偏青为给定 Accent 4 及其深化，仅作辅助与信息色）、无 `#000`/纯黑、无线性渐变装饰（原 AI 头像渐变、上下文条渐变已移除）、无 `shadow-xl` 级重阴影（阴影统一为土色低透明）、无霓虹（饱和度 ≤60%）、无正圆/直角（圆点与头像改 blob）。

---

## 5. 组件复用（本次交付的"防漂移"机制）

在 `styles.ts` 顶部新增**共享组件层**，同一类控件只在此定义配色/形状，具体规则只保留布局：

| 组件类 | 覆盖控件（既有类并入同一组选择器） |
|--------|-----------------------------------|
| `.evo-pop` / `.evo-pop-item` / `.evo-pop-sep` / `.evo-pop-title` | 全部浮层：`.evo-dropdown-menu`、`.evo-brand-menu-panel`、`.evo-tl-sort-menu`、`.evo-tl-row-menu`、`.evo-tl-palette`、`.evo-tab-menu`、`.evo-graph-menu`、`.evo-graph-legend`、`.evo-composer-model-menu`、`.evo-cand`、`.evo-queue`、`.evo-ctx-panel`、`.evo-graph-editor`、`.evo-graph-viewer`、`.evo-modal`、`.evo-report-card`、`.evo-context-trace`、`.evo-toast` |
| `.evo-btn`（+`-primary` / `-soft` / `-ghost` / `-outline` / `-danger` / `-ok` / `-teal` / `-icon` / `-sm`） | `.evo-panel-add`、`.evo-fs-save`、`.evo-report-generate`、`.evo-tab-newfile-go`、`.evo-send`、`.evo-btn-back`、`.evo-tl-back`、`.evo-graph-btn`、`.evo-setting-option`、`.evo-suggest-card`、`.evo-ledger-exp`、`.evo-exp-branch-chip`…… |
| `.evo-field`（+`-area`/`-sm`） | `.evo-panel-input`、`.evo-search-input`、`.evo-note-search`、`.evo-note-textarea`、`.evo-identity-edit`、`.evo-graph-editor-text`、`.evo-queue-input`、`.evo-question-custom`、`.evo-md-link-input` |
| `.evo-chip`（+`-sage`/`-tan`/`-mist`/`-teal`/`-warn`/`-err`/`-ok`） | `.evo-status-chip`、`.evo-panel-tag`、`.evo-panel-item-badge`、`.evo-skill-status`、`.evo-note-badge`、`.evo-lib-badge`、`.evo-ews-badge`、`.evo-report-badge`、`.evo-channel-badge`、`.evo-goal-evidence`、`.evo-wf-member` |
| `.evo-card` | `.evo-setting`、`.evo-panel-item`、`.evo-skill-card`、`.evo-ledger-card`、`.evo-report-section`、`.evo-ews-section`、`.evo-note-body`、`.evo-web-search-card`、`.evo-tier-card`、`.evo-clear-row`、`.evo-rounds-phase` |
| `.evo-avatar` / `.evo-dot` | 消息头像、会话色点、状态点、图例行首点等 14 处正圆 |

实现方式：① 在 `styles.ts` 里以**分组选择器**给出唯一定义（既有类名并入同一组，不挂新类也自动统一）；
② 在 TSX 中为全部浮层外壳与菜单行补挂 `evo-pop` / `evo-pop-item`（60 处，见 `.tmp-dev/organic-popovers.mjs` 实测），
后续新代码可直接复用组件类；③ 按钮/输入/徽标/卡片的既有类名已全部并入对应分组，其自身规则只保留尺寸与布局。

---

## 6. 改动文件清单

| 文件 | 改动 |
|------|------|
| `packages/evoresearch-app/src/client/styles.ts` | 令牌层重写、组件层新增、全量清扫（主战场） |
| `packages/evoresearch-app/src/client/monaco-css.ts` / `xyflow-css.ts` | **不改**（第三方 vendor 样式，可见色已由 token 覆盖）；Monaco 主题改为自定义 `evo-paper` / `evo-loam` |
| `packages/evoresearch-app/src/client/tab-monaco.ts` | 切换到自定义 Monaco 主题 |
| `packages/evoresearch-app/src/client/threadlist.ts` | 会话标签 8 色盘改为大地色盘（去蓝紫） |
| `packages/evoresearch-app/src/client/desktop.ts` | 桌面标题栏门面色改为 token/土色（原 `#18181b` 冷灰） |
| `report` 等 TSX | 挂载 `.evo-pop` / `.evo-btn` / `.evo-field` / `.evo-chip` 组件类 |
| `scripts/check-organic-style.mjs`（新增） | 风格守卫：禁止项扫描 + 令牌完整性 + 对比度核算，接入 `npm run verify` |
| `docs/06-natural-organic.md` | 本文 |

---

## 7. 验收记录（2026-09-11 实测）

**自动校验（可复跑）**

| 校验 | 命令 | 结果 |
|------|------|------|
| 风格守卫（禁止项 + 令牌完整性 + 调色板唯一性 + WCAG AA） | `node scripts/check-organic-style.mjs` | 通过：禁止项 0 命中、令牌齐备、调色板唯一、对比度 36 对全 AA |
| 完整流水 | `npm run verify` | 全绿（构建 + 插件单测 + app 单测 62 + domain + acceptance 19/19 + chatgraph + bundle + docs + 风格守卫） |
| 浏览器实测（浅/深 × 欢迎/对话/输入区/设置/图谱/轨迹/窄屏） | `.tmp-dev/organic-verify.mjs <token>` | 见下表 |

**浏览器实测要点**

- 令牌落地：浅 `#faf6f1` / 交互 `#5b6d43` / 主按钮 `#5c4033`；深 `#1e1b16` / `#a9bf8e` / `#c08a5e`；`--font-sans` 生效、`.evo-app` 背景含纸纹 SVG。
- 主题切换按钮真实翻转 `html.dark`；`prefers-reduced-motion` 下过渡/动画降到 `1e-05s`；Tab 聚焦环为鼠尾草 `rgb(169,191,142) 2px`。
- **浮层一致性（本次核心目标）**：工作台菜单 / 排序菜单 / 会话行菜单 / 模型菜单 / 打开方式菜单实测半径均 `16px`、底色均 `rgb(41,36,32)`、边框均 `rgb(62,53,41)`、阴影同一条 `--shadow-lg`；菜单项半径均 `12px` 且都带 `evo-pop-item` 类。
- 输入框容器（composer）圆角 `34px 26px 36px 22px`（blob），浅色表面 `rgb(255,253,249)`、描边 `rgb(226,216,200)`。
- 图谱画布底色 `rgb(251,247,240)`（暖纸面，非纯白），节点圆角 `20px`。
- 上下文占用明细浮层实测：`上下文容量 15k/262k（6%）`，`消息 15.6% / 系统工具 65.5% / 系统提示词 9.6% / 其他 9.3%`，`平均缓存命中率 19.7%`（与该会话投影一致）。
- 窄屏 420px：无横向溢出（`scrollWidth ≤ innerWidth`），输入区左右留 10px，统计行自然换行。
- 全程 0 console 报错 / 0 pageerror。

截图：`.tmp-dev/images/organic/`（01–24 号，含浅/深两套与各浮层）。报告：同目录 `report.json`。

**已记录的刻意偏离与理由**

1. **小半径 `--r-2xs: 6px`**：用于行内代码、微型标记（4–6px 原值）。风格文档禁止 `rounded-sm`，但 12px 高的行内代码用 `rounded-full/2rem` 会失真；6px 是本项目尺度下的"柔和最小圆角"。
2. **两档动效时长**：`--dur-organic 480ms`（卡片/菜单/模态/提示，"植物生长速度"）与 `--dur-quick 200ms`（密集列表行、图标钮）。全站 500ms+ 会让高频操作明显发钝；分档同时保留有机缓动与"返青/下沉"语义。
3. **保留径向渐变**：仅 `.evo-graph-canvas::before` 的椭圆光斑（画布打底层次）。风格禁止的是 `bg-gradient-to-*` 这类线性渐变装饰，线性渐变在本项目已全部清除。
4. **`#c42b1c`**：桌面自绘标题栏关闭按钮 hover 用 Windows 11 约定色（注册为例外），偏离会被系统级直觉判为"坏了"。它与陶土红同族，已并入 `--titlebar-accent`。
5. **vendored 样式未改**：`monaco-css.ts` / `xyflow-css.ts` 是第三方 CSS 产物，可见色由令牌（图谱控件/迷你图）与自定义 Monaco 主题 `evo-paper` / `evo-loam` 覆盖。
6. **placeholder 不降对比度**：`--color-text-placeholder` 与三级文字同值（浅 `#786c5c`、深 `#9d9182`），层级靠字体样式而非灰化表达，以满足 AA。
7. **间距与触控目标的尺度换算**：风格给的是落地页尺度（`py-16` / `p-6 md:p-8` / `gap-6 md:gap-8` / 触控 ≥44px）。本项目是密集工作台，按同一比例关系落位——面板 28px 内边距、卡片 12–14px、卡片间距 8–12px；移动端沿用紧凑工具条（26–34px）而非放大到 44px，因为"输入区保持单行"是此前多轮验收的既有约束，放大按钮会把工具栏挤成两行；改为保证窄容器自动收成图标、间距 ≥1px、无横向溢出。
8. **品牌图形同步换色**：`frontend/favicon.svg`（顶栏/窗口图标）原为冷黑 `#1d1d1f` + 蓝点 `#0a84ff`（高科技感 + 冷色 + 近纯黑），已改为石褐底 `#5c4033` + 暖米笔画 `#faf6f1` + 鼠尾草焦点 `#8b9d77`，圆角 18→20；几何字形（R + 焦点）保留以免品牌识别断裂。桌面安装包图标（`desktop/src-tauri/icons/*`）未重绘，属独立事项。

**风格规则逐条核对**

| 规则 | 落地 |
|------|------|
| 大地色系 amber/stone/olive/sage | 令牌层唯一色相来源；冷色主调（色相 190°–300°）由守卫脚本零容忍 |
| 背景暖米色 | 浅 `#faf6f1`；卡片为暖白 `#fffdf9` 而非纯白 |
| 不规则圆角 / blob | `--r-blob` 用于卡片与图谱节点，`--r-blob-lg` 用于模态与输入容器，可交互卡片 hover 缓慢形变 |
| 纸张/织物纹理 | 内联 SVG feTurbulence 纸纹铺在结构底色（页面/左右栏/顶栏/输入区/标签栏/状态栏/轨迹/设置导航）；像素实测有色阶微噪声（浅色 stddev 0.86 / 深色 1.38，纯色填充应为 0），3× 放大目检为均匀纸面颗粒、无接缝与脏点 |
| 手写风格或衬线字体 | `--font-serif` 用于欢迎标题、面板/模态/卡片标题与 Markdown 标题（含 Milkdown 编辑器） |
| 按钮柔和过渡 | 统一 `--dur-*` + `--ease-organic`，hover 加深土色并下沉 0.5px（Soft Earth Press） |
| 禁止纯黑 / 冷色 / 尖锐几何 / 高科技感 / 霓虹 | 守卫脚本逐条断言（含纯黑、线性渐变、>78% 饱和度、正圆、≤5px 直角、shadow-xl 级重阴影、Inter/Roboto/Geist） |
| 视觉一致性（同类控件同配色） | 组件层唯一定义 + TSX 挂组件类 60 处；5 类浮层实测同形状同配色 |
| 交互反馈 / 响应式 / 无障碍 | hover/active/focus-visible 全量检查；≤819px 抽屉与窄容器无溢出；AA 对比度 36 对全过；reduced-motion 降级 |
| 深色方案同族推导 | 深壤土底 + 浅鼠尾草交互 + 陶土主按钮（非反色），全部 AA |

**工程收尾**

- `npm run verify` 全绿；精确 `git add` 本次改动文件后中文 conventional commit。
- 新增守卫脚本 `scripts/check-organic-style.mjs` 已并入 `npm run verify`，防止后续漂移。
