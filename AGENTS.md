# AGENTS.md — EvoResearch 项目交接手册

> **定位**：给接手本项目的下一位开发者 / Agent 的完整工作手册。涵盖隐形规则、环境约定、启动/构建命令、数据目录统一原则。**本文件仅本地留存，不提交 GitHub**（已加入 `.gitignore`）。

---

## 1. 项目全貌

- **名称**：EvoResearch — 面向科研的自主智能体工作台（对话、文献、项目文件、实验记录与长期记忆联动）。
- **基座**：`@deepseek-ai/dsh` **0.1.0-rc.8**（务必用此版本或兼容更新版，见 `README.md` 与 `profiles/evoresearch/package.json`）。
- **结构**：monorepo（`packages/*` workspaces）
  - `packages/evoresearch-plugin` — 后端插件（Host 侧，Cordis 服务）
  - `packages/evoresearch-app` — 前端应用（Client 侧，React + Cordis slots）
  - `desktop/` — Tauri 2 桌面壳（sidecar 启动 DSH + 自绘标题栏）
  - `profiles/evoresearch/` — DSH profile 定义（`cordis.yml` / `cordis.patch.yml` 叠加）
  - `docs/` — 设计与决策文档
  - `scripts/` — 构建与校验脚本

---

## 2. 数据目录统一原则（核心约束）

### 2.1 两条数据线：开发用 `.tmp-dev/`，生产用 `.evoresearch-data/`

**开发/测试（端口 3081）的一切持久化数据统一放 `D:\DSH-Research\.tmp-dev\`**；正式用户数据（端口 3080 的 web profile）放 `.evoresearch-data/` 与 `C:\Users\Karbo\.dsh`。两条线严格隔离，互不读写。

| 场景 | 实际路径 | 说明 |
|------|----------|------|
| **3081 开发数据根** | `D:\DSH-Research\.tmp-dev\evoresearch-dev-data\` | 插件 `dataRoot`：projects、ledgers、reports/daily、chat-graphs 等全部在此；**删此一处即清空全部开发测试数据** |
| **3081 开发 DSH_HOME** | `D:\DSH-Research\.tmp-dev\evoresearch-dev-data\dsh-home\` | DSH 引擎状态：sessions、storages、settings.yaml、credentials、**profile（含 node_modules）** 都在此 |
| **3080 生产数据根** | `D:\DSH-Research\.evoresearch-data\` + `C:\Users\Karbo\.dsh` | 用户重要对话（74+），**不可污染、不可删除** |
| **桌面版** | `<安装目录>\evoresearch-data\`（exe 同级） | `desktop/sidecar/launch.js` 通过 `EVORESEARCH_DATA_HOME` 传入；随程序目录迁移，整体备份即迁移 |
| **临时产物（截图/调试输出）** | `D:\DSH-Research\.tmp-dev\images\` | 见 §3 |
| **项目工作区（3081）** | `.tmp-dev\evoresearch-dev-data\projects\<name>\` | 每个科研项目独立目录，内部 `.evoresearch-data/` 为项目私有数据（见 `packages/evoresearch-plugin/src/host/core/paths.ts`） |

### 2.2 与工作目录无关（workflow / worktree 均一致 — 重要）

**无论是否使用 Claude Code 的 workflow / worktree 功能，EvoResearch 开发时读取和写入的持久化配置与数据路径都相同**：

- Claude Code workflow 启用时可能把工作目录切到 `.claude/worktrees/<name>`，不启用时就是主仓库 `D:\DSH-Research` —— **但 EvoResearch 的数据路径不跟随进程 cwd**，因为：
  1. `dataRoot` 由 `profiles/evoresearch/cordis.patch.yml` 显式写死为绝对路径 `D:\DSH-Research\.tmp-dev\evoresearch-dev-data`（优先级最高，见 `host/index.ts` 的 `config.dataRoot ?? env ?? cwd`）；
  2. `DSH_HOME` / `EVORESEARCH_DATA_ROOT` 启动时以**绝对路径**显式传入。
- 因此：**从任何 worktree、任何 cwd 启动 3081，读写的都是主仓库下同一份 `.tmp-dev`**。项目列表、实验账本、记忆库不会因启动位置不同而分裂。
- ⚠️ 唯一例外：若某 worktree 里改了 `profiles/evoresearch/cordis.patch.yml` 且未合并回 main，以该 profile 启动才会指向别处——合并前不要用 worktree 版 profile 启动。

### 2.3 关键环境变量

| 变量 | 作用 | 3081 开发推荐值 |
|------|------|-----------------|
| `DSH_HOME` | DSH 的数据根（profiles/sessions/storages/凭据） | `D:\DSH-Research\.tmp-dev\evoresearch-dev-data\dsh-home` |
| `EVORESEARCH_DATA_ROOT` | 插件数据根（projects 等） | `D:\DSH-Research\.tmp-dev\evoresearch-dev-data` |
| `EVORESEARCH_DATA_HOME` | 桌面版专用，exe 同级数据目录 | 由 Tauri 壳传入，勿手动覆盖 |
| `EVORESEARCH_PORT_FILE` | 桌面版端口文件 | `%LOCALAPPDATA%\com.evoresearch.desktop\port.json` |

> `dataRoot` 解析优先级（`host/index.ts:137`）：`config.dataRoot`（cordis.patch.yml）> `EVORESEARCH_DATA_ROOT` > `process.cwd()`。**前两层已固定为 .tmp-dev，cwd 回落只是兜底**。

### 2.4 配置文件位置

- `settings.yaml` / `.credentials.yaml` / `.anonymous-user-id` — DSH 运行时在 `DSH_HOME` 下读写。3081 开发环境位于 `.tmp-dev\evoresearch-dev-data\dsh-home\settings.yaml`；3080 生产位于 `C:\Users\Karbo\.dsh\settings.yaml`。
- ~~项目根的 `settings.yaml`~~ **已于 2026-08-23 删除**（历史遗留：早期未设 DSH_HOME 时落到 cwd，两个活跃环境均不读它）。
- `desktop/sidecar/launch.js:ensureCredentials()` 会把程序目录内置 `.credentials.yaml` 复制进 `dataHome`（首次启动）。

### 2.5 启动后会产生/读写哪些文件（持久化清单）

按 §4.2 启动 3081 后，所有持久化文件都在 `.tmp-dev\evoresearch-dev-data\` 下，分两层：

**A. DSH 引擎层（`dsh-home\`，由 DSH 框架读写）：**

| 文件/目录 | 是什么 | 内容 |
|-----------|--------|------|
| `settings.yaml` | DSH 全局配置 | 默认模型（agent-default-model）、LLM provider 列表（new-api baseURL、模型 id、reasoningEffort）；UI 里改模型设置会写这里 |
| `.credentials.yaml` | 凭据存储 | provider 的 API key（如 `NEW_API_API_KEY: sk-...`）；**含密钥，gitignore，勿外传** |
| `profiles\evoresearch\` | 本项目的 profile | 见 §4.2.1；声明加载哪些 bundle、dataRoot 指向；node_modules 是 pnpm junction 到主仓库构建产物 |
| `sessions\<工作区hash>\session-<uuid>\` | 对话会话存储 | 每个会话一个目录，存消息 JSONL 与会话元数据；左侧会话列表的数据源。目录名是启动时 cwd 路径的编码 |
| `storages\workspace.json` / `session_projcache.json` | DSH 工作区状态 | workspace 注册表、会话→项目映射缓存 |

**B. EvoResearch 插件层（`.evoresearch-data\`，由本仓库插件读写）：**

| 文件/目录 | 是什么 | 内容 |
|-----------|--------|------|
| `projects\<name>\` | 科研项目工作区 | 项目文件（代码/文档/数据），内含独立 `.git`；项目名限小写字母数字连字符 ≤64 字符 |
| `projects\<name>\.evoresearch-data\` | 项目私有数据 | 该项目的 research_memory.db、observations、profile、CLI history 等（随项目走，删项目即删） |
| `ledgers\<project>\` | 实验账本 | 实验（experiment）条目与回合记录 |
| `chat-graphs\_global_.json` | Chat Graph | 左侧对话图谱布局（xyflow 节点/边坐标），带 .bak 时间戳备份 |
| `memories\research_memory.db`（+shm/wal） | 全局长期记忆 | SQLite 库：跨项目的科研记忆条目；`notes\` 为笔记，`backups\` 自动备份 |
| `model-settings.json` | 科研模式模型选择 | 科研代码模式 Lite/More Effort 等各场景绑定的 provider+model |
| `scheduler.json` / `daily-report.json` | 定时任务与日报 | AutoSkills cron 注册状态；日报生成状态 |
| `client-state.json` / `session-meta.json` / `project-meta.json` | 前端/元信息缓存 | UI 状态持久化、会话元信息、项目元信息 |
| `evolution\candidates.json` | evolution 候选 | 自主演化候选队列 |

> 清空开发环境 = 删整个 `.tmp-dev\evoresearch-dev-data\`（profile 会一并删掉，需按 §4.2.1 重建）。只清测试项目 = 删 `projects\` + `ledgers\` 下对应条目。

### 2.6 开发 vs 生产数据隔离（3080 vs 3081 — 非常重要）

**背景**：`3081` 是开发/测试环境（实验账本/回合/日报的测试数据随时可改/可删），`3080` 的 `web` profile 承载与用户聊天的正式 DSH 数据（74+ 个对话，非常重要，不可污染）。两者**必须**用不同的 `dataRoot` / `DSH_HOME`，否则左侧面板会显示同一批项目。

| 端口 | 用途 | `EVORESEARCH_DATA_ROOT` | `DSH_HOME` | 实际效果 |
|------|------|--------------------------|------------|----------|
| `3080` | 生产/正式（用户重要对话） | `D:\DSH-Research\.evoresearch-data` | `C:\Users\Karbo\.dsh`（默认） | projects/ledgers/reports/chat-graphs 均在正式目录 |
| `3081` | 开发/测试（随时可删） | `D:\DSH-Research\.tmp-dev\evoresearch-dev-data` | `.tmp-dev\evoresearch-dev-data\dsh-home` | 所有开发产出落 `.tmp-dev`，删此一处即清测试 |

**常见坑**：仅设 `EVORESEARCH_DATA_ROOT` 而不改 `DSH_HOME`，sessions 仍共用导致项目列表混同；用 `Start-Process` 不加 `-Environment` 则环境变量不传递。

---

## 3. 临时文件与截图规范

### 3.1 临时文件统一放 `.tmp-dev/`

**所有 Playwright / 调试截图、临时脚本输出必须放到 `.tmp-dev/` 目录下**（截图放 `.tmp-dev/images/`），不得散落到项目根、用户目录（`C:\Users\Karbo\...`）、`.evoresearch-data/` 等任何别处。

- `.tmp-dev/` 已在 `.gitignore`。
- 正确示例：
  ```js
  await page.screenshot({ path: 'D:/DSH-Research/.tmp-dev/images/debug-3081.png' })
  // 或
  await page.screenshot({ path: '.tmp-dev/images/my-shot.png' })
  ```
- 错误示例（禁止）：
  ```
  D:/DSH-Research/debug-3081.png              // 项目根
  C:/Users/Karbo/.../*.png                    // 用户目录
  D:/DSH-Research/.evoresearch-data/*.png     // 数据目录
  ```

### 3.2 `.tmp-dev/` 内部结构

| 子目录 | 用途 |
|--------|------|
| `.tmp-dev/images/` | 所有截图、HTML 预览等可视化产物 |
| `.tmp-dev/evoresearch-dev-data/` | 3081 开发数据根（含 `dsh-home/` profile） |
| `.tmp-dev/node_modules/` | Playwright（`playwright` + `playwright-core`），e2e/截图脚本经 `file:///D:/DSH-Research/.tmp-dev/node_modules/playwright/index.mjs` 导入；**勿删** |
| `.tmp-dev/scripts-legacy/` | 历史一次性调试脚本归档（不再维护） |
| `.tmp-dev/legacy-tmp-port/` | 旧 `.tmp-port` 遗留目录归档（agent-team 测试、mnist-data 等） |

> 旧 `.tmp-port/` 已于 2026-08-23 完全删除：截图入 `images/`，Playwright 依赖迁 `node_modules/`，其余归档 `legacy-tmp-port/`。任何文档/脚本再引用 `.tmp-port` 均为过期信息。

---

## 4. 启动与开发命令

### 4.1 前置（一次性）

```bash
npm install          # 主仓库依赖（含 workspaces）
npm run build        # 构建插件 + 前端（修改 packages/* 后必须重新执行）
```

### 4.2 网页版开发（3081）— 后端 + 前端一体化

前端是静态 bundle，由 DSH 后端直接托管（`dsh-host-frontend-static`），**没有独立的前端 dev server**——启动后端即同时服务前后端。

**日常启动（profile 已就绪时）**：

```powershell
# 带显式环境变量启动（PowerShell；Start-Process 必须加 -Environment）
Start-Process npx.cmd "@deepseek-ai/dsh@0.1.0-rc.8 --profile evoresearch --port 3081" -WindowStyle Hidden `
  -Environment @{
    DSH_HOME="D:\DSH-Research\.tmp-dev\evoresearch-dev-data\dsh-home";
    EVORESEARCH_DATA_ROOT="D:\DSH-Research\.tmp-dev\evoresearch-dev-data"
  }
# 打开 http://127.0.0.1:3081
# 调试桌面标题栏：http://127.0.0.1:3081/?desktop=1
```

bash 等价形式（Claude Code 后台任务常用）：

```bash
DSH_HOME="D:\\DSH-Research\\.tmp-dev\\evoresearch-dev-data\\dsh-home" \
EVORESEARCH_DATA_ROOT="D:\\DSH-Research\\.tmp-dev\\evoresearch-dev-data" \
npx @deepseek-ai/dsh@0.1.0-rc.8 --profile evoresearch --port 3081
```

**验证启动成功**：
1. 日志出现 `[evoresearch] host 插件激活（dataRoot: D:\DSH-Research\.tmp-dev\evoresearch-dev-data）`；
2. `curl http://127.0.0.1:3081/` 返回 200；
3. 页面左侧项目列表来自 `.tmp-dev`（与 3080 的正式项目不同）。

**profile 就绪判定**：`dsh-home\profiles\evoresearch\` 下应存在 `cordis.yml`、`cordis.patch.yml`、`package.json`、`node_modules`（pnpm junction）。若缺失，按 §4.2.1 重建。

#### 4.2.1 重建开发 profile（一次性 / node_modules 损坏时）

```powershell
# 1. 建目录
New-Item -ItemType Directory -Force D:\DSH-Research\.tmp-dev\evoresearch-dev-data\dsh-home\profiles\evoresearch

# 2. 复制主仓库 profile 定义
Copy-Item D:\DSH-Research\profiles\evoresearch\cordis.yml,D:\DSH-Research\profiles\evoresearch\package.json `
  D:\DSH-Research\.tmp-dev\evoresearch-dev-data\dsh-home\profiles\evoresearch\ -Force

# 3. cordis.patch.yml 需确认 dataRoot 指向 .tmp-dev（主仓库版已写好，直接复制即可）
Copy-Item D:\DSH-Research\profiles\evoresearch\cordis.patch.yml `
  D:\DSH-Research\.tmp-dev\evoresearch-dev-data\dsh-home\profiles\evoresearch\ -Force

# 4. pnpm 安装（生成 junction；禁止 robocopy/cp 复制 node_modules——会把 junction
#    展平成实体目录，dsh 启动报 "exists and is not a symlink"）
cd D:\DSH-Research\.tmp-dev\evoresearch-dev-data\dsh-home\profiles\evoresearch
pnpm install
```

> profile 的 `package.json` 以 `file:` 引用主仓库 `packages\evoresearch-app` / `packages\evoresearch-plugin`。主仓库 `npm run build` 更新 `lib/` 后，**junction 指向的是构建产物，无需重装 profile**；但若 package.json 依赖变了则需重跑 `pnpm install`。

**注意**：`--profile evoresearch` 只认裸名（profile 必须位于 `$DSH_HOME/profiles/` 下），**不能**传 `--profile profiles/evoresearch` 路径形式（rc.8 会报 invalid profile name）。

### 4.3 桌面版

**开发态直接运行**（不打包）：

```powershell
# 方式 A：直接跑 Tauri dev（需 Rust）
cd desktop
cargo tauri dev
```

**打包为可执行文件（NSIS 安装包）**：

```powershell
# 1. 构建前端
npm run build

# 2. 打包 desktop（bundle-sidecar + Tauri build）
node desktop/scripts/build.mjs --skip-download
# 产物：desktop/src-tauri/target/release/bundle/nsis/EvoResearch_0.1.0_x64-setup.exe
# 同时更新：desktop/sidecar/dist/ 和 desktop/src-tauri/target/release/_up_/ 供验证
```

- `desktop/scripts/bundle-sidecar.mjs` — 打包 sidecar（含 `--install-links` 真实复制 `@evoresearch/*`，避免 junction 在 NSIS 展开失效）
- `desktop/sidecar/launch.js` — 启动时自愈 `profiles/node_modules/@evoresearch/*` junction（黑窗根因修复）
- 无边框窗口（`decorations(false)`）+ 自绘标题栏 36px（`?desktop=1` 时渲染 `DesktopTitlebar`）

---

## 5. 构建与校验流水

```bash
# 完整校验（构建 + 单元测试 + domain/acceptance e2e + chatgraph xyflow + bundle + docs）
npm run verify

# 单项
npm run build
npm test                          # 插件单元测试
npm run test -w @evoresearch/dsh-app
npm run verify:domain
npm run verify:acceptance
node scripts/verify-chatgraph-xyflow.mjs
node scripts/verify-bundle.mjs
node scripts/check-docs.mjs
```

---

## 6. 通用项目规则

1. **0 warnings / 0 errors**：适配新 DSH 版本（如 rc.8）后，端到端无 warnings/errors 为验收标准。
2. **前端样式**：`packages/evoresearch-app/src/client/styles.ts` 为主样式；桌面自绘标题栏相关样式在 `html.evo-desktop` 分支，`z-index` 需谨慎（标题栏 `2147483647` 为顶层，需让 modal 等让位）。
3. **React key**：所有 `.map()` 必须传 key（第三参数）；`index.ts` 有 `suppressKeyWarning` 兜底（仅压制误报）。
4. **Cordis 插件**：profile 为 `@deepseek-ai/dsh-base` + `@evoresearch/dsh-app` + `@evoresearch/dsh-plugin`；rc.8 需 `ui-renderer` 提供 `uiRenderer` 服务（`cordis.patch.yml`）。
5. **截图/临时脚本产物**：一律 `.tmp-dev/images/`；一次性调试脚本可放 `scripts/.tmp-*`（gitignore）或直接 `.tmp-dev/`。不得污染项目根、用户目录或数据目录。
6. **数据目录**：开发数据只进 `.tmp-dev/evoresearch-dev-data/`；正式用户数据只在 `.evoresearch-data/` 与 `C:\Users\Karbo\.dsh`（勿写勿删）。

---

## 7. 初次交接 Checklist

- [ ] `npm install && npm run build` 能通过
- [ ] 按 §4.2 启动 3081，日志 dataRoot 为 `.tmp-dev\evoresearch-dev-data`，`http://127.0.0.1:3081` 返回 200
- [ ] `http://127.0.0.1:3081/?desktop=1` 标题栏 36px 正常，设置面板返回按钮可见（`top:46` 不被遮挡）
- [ ] `node desktop/scripts/build.mjs --skip-download` 能产出 NSIS 安装包，安装后无黑窗、无滚动条/黑边
- [ ] `npm run verify` 全绿
- [ ] 知晓：临时产物只进 `.tmp-dev/`（截图 `images/`）；开发数据只进 `.tmp-dev/evoresearch-dev-data/`；`.evoresearch-data/` 与 `C:\Users\Karbo\.dsh` 是生产数据，勿动

---

## 8. 约束与注意事项

- **勿删 `.tmp-dev/node_modules`**：内含 Playwright，删后 e2e/截图脚本失效。
- **勿动 3080 生产数据**：`.evoresearch-data/`、`C:\Users\Karbo\.dsh`、3080 端口进程一律不写不删；清理进程时精确匹配路径，勿误杀常驻 DSH。
- **Tauri resources 路径**：`tauri.conf.json` 的 `resources: ../sidecar/dist/**/*` 会把 junction 展开为真实目录（`--install-links` 保证可移植）。
- **移动端（Android/iOS）必须用 `tauri.<platform>.conf.json` 清空 resources**——sidecar glob 在无 `desktop/sidecar/dist/` 的 CI 环境直接报错；壳侧 `main.rs` 已拆 desktop/mobile 双入口。
- **iOS 构建三坑**：① `tauri ios build --target` 只认短名 `aarch64/aarch64-sim/x86_64`；
  ② `tauri ios init` 生成的 Xcode phase 是 `npm run tauri --` → 根 package.json 必须有
  `"tauri": "tauri"` script 且 `@tauri-apps/cli` 在 devDependencies；③ CLI 用 `npx tauri`
  （cargo 版与 npm 版子命令不同）。
- **gh api 布尔值用 `-F` 不用 `-f`**（字符串 "false" 会 422）；PATCH release 只认
  `/releases/{id}`，by-tag 路由 404。
- **`@deepseek-ai/dsh-client-schema-form` 等无 rc.8 的包保持 rc.6**（`ETARGET` 限制）。
- **AGENTS.md 本地留存**：已加入 `.gitignore`，不推送 GitHub。
- **`.serena/`**：Serena MCP（LSP 代码检索工具）的项目级配置与缓存，由 Claude Code 的 serena MCP server 读写，与本应用运行无关；已 gitignore。

---

## 9. Git 与发布自动化

- **日常**：工作树干净、`ahead N` 时 `git push origin main`。
- **CI 发布流水线**（`.github/workflows/release.yml`，**仅手动触发** workflow_dispatch）：
  - push 到 main **不会**触发构建；需要出新安装包时到 GitHub Actions 页手动 Run workflow；
  - 流水线：prepare-release（删旧 tag/Release 重建）→ desktop 三平台矩阵
    （Windows NSIS / Linux AppImage+deb / macOS dmg）∥ android ∥ ios → publish-notes；
  - **Release 恒为 `v0.1.0-rc.1`**（prerelease），资产被同名覆盖；Notes 由 publish-notes
    固定模板生成（导读 + 平台下载表含 iOS + 卖点 + commit 摘要），改模板去 workflow 里改；
  - iOS：`npx tauri ios build --target aarch64-sim|aarch64`（短名！），产物 .app 打 zip 走
    workflow artifact `ios-build`（无签名证书，正式 IPA 需配 Apple 证书 secrets）；
  - Android unsigned APK 直接挂 Release；配置 `ANDROID_KEYSTORE_*` 四个 secrets 后自动签名。

### 9.1 Git 历史重写（去 Claude co-author）

- 用户要求提交里**不出现任何 Claude co-author**。全局设置 `includeCoAuthoredBy: false`
  只对**新会话**生效；当次会话手动加的 trailer 不受控，需事后重写：
  ```bash
  git filter-repo --force --message-callback <回调文件>
  ```
  回调文件内容（参数名必须是 `message` 不是 `msg`！filter-repo 的 handle('message')
  决定了签名）：
  ```python
  message = message.replace(b"\r\n", b"\n")
  lines = message.split(b"\n")
  out = [l for l in lines if not (l.lower().startswith(b"co-authored-by:") and b"anthropic.com" in l.lower())]
  while out and out[-1].strip() == b"":
      out.pop()
  return b"\n".join(out) + b"\n"
  ```
- **Windows 坑**：bash heredoc/命令行传回调会被转义吃掉 → 用 python 以二进制写文件、
  `--message-callback` 传 Windows 路径。失败会 fast-import 中途崩但 repo 完好，可直接重试。
- filter-repo 前置：stash 全部改动、移除所有 worktree 注册（`git worktree remove --force`，
  Windows 下目录可能删不掉，注册移除即可）；完成后需 `git remote add origin …`（会被删）、
  force-push 所有分支、重建 worktree、pop stash。
- **worktree 空目录 ≠ 代码丢失**：分支引用都在，`git worktree add <路径> <分支>` 一条命令恢复。

### 9.2 Worktree 使用惯例

- 并行开发用 `.claude/worktrees/<name>`（Claude Code 自动管理）；每个 worktree 对应一个
  `claude/*` 分支；成果及时 commit——未提交的草稿在 worktree 目录删除时无法找回。
- **worktree 里启动 3081 读写同一份 `.tmp-dev`**（见 §2.2），不会产生第二套项目数据。
- 合并顺序参考（2026-08-22）：sleepy-bartik（RC8+chatgraph，已含 heuristic 的 merge）→
  jovial（补齐剩余 commit）→ main；冲突多为 import 行与文档章节，取两边并集。

---

## 10. 当前状态快照（2026-08-23）

- **main 已包含**：三平台桌面 CI + Android APK + iOS 编译、跨平台 sidecar/壳/前端路径统一、
  chatgraph 重设计（heuristic）、科研团队职责层审批管线（jovial）、RC8 新功能批次（sleepy）。
- **验证基线**：`npm run verify` 全绿（544+11 测试）；`cargo check` Windows +
  aarch64-linux-android 双目标通过。
- **iOS 产物形态**：占位壳（.app zip，~1.8MB artifact）——DSH 后端依赖 Node 运行时，
  移动端暂无完整后端；Android 同理为预览壳。
- **待办线索**：iOS 正式签名分发（需 Apple Developer 证书 → secrets → CI 出 IPA）；
  Android 签名 secrets 可选配。
- **数据布局（2026-08-23 定稿）**：开发数据 `.tmp-dev/evoresearch-dev-data/`（含 dsh-home
  profile，pnpm junction 安装）；临时产物 `.tmp-dev/images/`；Playwright 依赖
  `.tmp-dev/node_modules/`；旧 `.tmp-port/` 已删除。

---

*最后更新：2026-08-23（.tmp-dev 统一临时/开发数据根；.tmp-port 删除；启动章节重写：前后端一体化、profile 重建流程、workflow/worktree 路径一致性说明）*
