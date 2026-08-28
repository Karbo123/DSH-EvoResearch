# AGENTS.md — EvoResearch 项目交接手册

> **定位**：给接手本项目的下一位开发者 / Agent 的完整工作手册。涵盖隐形规则、环境约定、启动/构建命令、数据目录统一原则。本文件纳入 Git 跟踪并随项目推送到 GitHub。

---

## 1. 项目全貌

- **名称**：EvoResearch — 面向科研的自主智能体工作台（对话、文献、项目文件、实验记录与长期记忆联动）。
- **基座**：`@deepseek-ai/dsh` **0.1.1-rc.2**（务必用此版本或兼容更新版，见 `README.md` 与 `profiles/evoresearch/package.json`）。
- **结构**：monorepo（`packages/*` workspaces）
  - `packages/evoresearch-plugin` — 后端插件（Host 侧，Cordis 服务）
  - `packages/evoresearch-app` — 前端应用（Client 侧，React + Cordis slots）
  - `desktop/` — Tauri 2 桌面壳（sidecar 启动 DSH + 自绘标题栏）
  - `profiles/evoresearch/` — DSH profile 定义（`cordis.yml` / `cordis.patch.yml` 叠加）
  - `docs/` — 设计与决策文档
  - `scripts/` — 构建与校验脚本

---

## 2. 数据目录统一原则（核心约束）

### 2.1 三个完全独立的运行环境（核心约束）

**3080 是官方原版 DSH，不加载 EvoResearch 插件。** 它承载官方 DSH 的重要对话和 Harness 数据，必须与 EvoResearch 完全隔离，禁止使用 EvoResearch profile、插件或数据根。

**EvoResearch 网页版首选使用 3081。** 开发/测试和正式 Web 实例都从 3081 开始；若首选端口已占用，统一启动器会自动向上选择空闲端口（跳过 3080）；其 profile 必须是 `evoresearch`。开发数据根是 `.tmp-dev/.evoresearch-data/`，正式 Web 数据根是仓库根 `.evoresearch-data/`，两者各自可整体清空/备份。每个环境只配置 `EVORESEARCH_ROOT`，启动器强制令 `DSH_HOME` 与 `EVORESEARCH_DATA_ROOT` 等于该根目录。

**EvoResearch 打包桌面版是第三条数据线。** 它加载 EvoResearch 插件，数据保存在 exe 同级的 `.evoresearch-data/`，由 Tauri 壳传入；桌面 sidecar 使用动态空闲端口，不等同于 3080 或 3081。

三条数据线严格隔离，互不读写。仓库根目录的 `D:\DSH-Research\.evoresearch-data\` 是 EvoResearch 正式 Web 的数据根；其中已有内容可能来自旧启动方式，不能据文件内容推断当前运行归属，使用前仍应核对启动参数和实际 profile。

这里列出的 `D:\DSH-Research\...` 是**本机开发/本机正式 Web 的路径约定**，不是 EvoResearch 发布版对所有用户的固定路径。发布给其他用户的 Web 版本不得硬编码这个盘符；启动器应根据发布目录或用户数据目录计算一个绝对 `EVORESEARCH_ROOT`，再把 `DSH_HOME` 与 `EVORESEARCH_DATA_ROOT` 同步为该路径。可移植版通常使用启动器同级的 `.evoresearch-data`，安装版则应优先使用当前用户可写的数据目录。只有在启动器没有设置这些变量时，插件才会把当前工作目录（cwd）作为 `dataRoot` 兜底；这不是正式发布版应依赖的路径规则。

| 场景 | 实际路径 | 说明 |
|------|----------|------|
| **3080 官方 DSH** | `C:\Users\Karbo\.dsh\` | 官方原版 DSH 的 sessions、storages、settings、凭据；**不加载 EvoResearch，不可污染、不可删除** |
| **3081 起 EvoResearch Web（开发）** | `D:\DSH-Research\.tmp-dev\.evoresearch-data\`（主仓库 main）或 `D:\DSH-Research\.tmp-dev\.evoresearch-data-<分支名>-<worktree标识>\`（worktree） | 3081 是首选端口；占用时启动器自动选择更高空闲端口。对应根是 `DSH_HOME` 与 `EVORESEARCH_DATA_ROOT` 的共同外层根；项目、会话、设置、profile 和插件内部状态全部在对应根；**清理 worktree 时要清理对应带标识的根** |
| **worktree 内 EvoResearch Web（开发，按 worktree 隔离）** | `<主仓库>\.tmp-dev\.evoresearch-data-<分支名>-<worktree标识>\` | 在任一 worktree 里 `npm run start:web` 时自动使用当前 worktree 的独立根（见 §2.2）；如分支 `claude/monaco-editor`，目录名会包含清洗后的分支名和稳定短标识；与主仓库及其它 worktree 的数据根互不冲突，可并行开发/验收 |
| **3081 起 EvoResearch Web（正式）** | `D:\DSH-Research\.evoresearch-data\` | 3081 是首选端口；占用时启动器自动选择更高空闲端口。EvoResearch 正式 Web 的共同外层根；项目数据与本环境 DSH_HOME 均在此；**不可与开发目录混用** |
| **桌面版 EvoResearch** | `<安装目录>\.evoresearch-data\`（exe 同级，开头有点） | `desktop/sidecar/launch.js` 通过 `EVORESEARCH_DATA_HOME` 传入；随程序目录迁移，整体备份即迁移；端口动态分配 |
| **正式 Web 的历史内容提醒** | `D:\DSH-Research\.evoresearch-data\` | 规范上属于 EvoResearch 正式 Web；其中旧会话/旧任务可能是历史残留，清理前先确认，不得当作官方 3080 数据 |
| **临时产物（截图/调试输出）** | `D:\DSH-Research\.tmp-dev\images\` | 见 §3 |
| **项目工作区（3081）** | `<EvoResearch dataRoot>\projects\<name>\` | 开发时位于 `.tmp-dev\.evoresearch-data\projects\<name>\`，正式 Web 位于 `.evoresearch-data\projects\<name>\`；内部 `.evoresearch-data/` 为项目私有数据 |

### 2.2 工作目录与 worktree 数据根隔离（核心约束）

**主仓库（main）`npm run start:web` 仍读写 `.tmp-dev\.evoresearch-data`，行为不变。**

**在任意 git worktree 里 `npm run start:web`，启动器自动把数据根按 worktree 和分支隔离**：`<主仓库>/.tmp-dev/.evoresearch-data-<分支名>-<worktree标识>`。这是由 `scripts/start-web.mjs` 的 `detectWorktreeIsolation()` 自动完成的——它用 `git --git-common-dir` / `--show-toplevel` / `branch --show-current` 判断当前是否在 worktree 中，是则把 `EVORESEARCH_ROOT` / `DSH_HOME` / `EVORESEARCH_DATA_ROOT` 一并指到该 worktree 的独立根。分支名中的非法字符（如 `/`）会被收敛为 `-`，并附加当前 worktree 路径的稳定短标识，避免不同分支清洗后目录名碰撞；detached HEAD 也会使用 `detached-<标识>` 隔离。

> **代码与数据都按 worktree 隔离**：启动器从当前 worktree 的 `profiles\evoresearch` 加载插件，因此该 worktree 需要先在自身目录执行 `npm install` 和 `npm run build`（可共享 pnpm/npm 下载缓存，但不能依赖主仓库构建产物）。这样每个 worktree 验收的是自己的分支代码；隔离根只保存该实例的 sessions/storages/projects/plugins/settings 等运行数据。

**为什么这样做**：多个 worktree 并行开发/验收独立功能时，若都读写同一份 `.tmp-dev\.evoresearch-data`，两个 DSH 实例会同时抢写 `settings.yaml`、`storages\workspace.json`、`plugins\*\*.json`，并并发打开 `plugins\memories\research_memory.db`（SQLite 锁/损坏风险），会话列表与项目映射还会互相穿插——即"多个 worktree 写到同一处而冲突"。**worktree 数据根隔离后，每个 worktree 有自己完整的 projects / ledgers / memories / sessions / storages / settings，互不冲突，可并行开发与并行验收。**

**端口选择会自动探测并尽量避免冲突**：`scripts/web-port.mjs` 从 3081 起查找空闲端口，多个 worktree 实例通常会依次使用 3081/3082/3083…，并始终跳过 3080。并行启动的极短竞态仍由操作系统最终绑定结果决定。

**什么时候隔离与共享的分界**：
- **串行使用（同一时刻只起一个实例）**：主仓库与任意 worktree 各自读写自己的根，互不影响。
- **并行验收多个独立功能**：每个 worktree 一个分支、一套独立根，天然隔离，正是本设计的意图。
- **需要共享数据**（如想让某 worktree 复用主仓库的记忆/账本）：使用启动器 `--root <绝对路径>`（经 `npm run start:web -- --root <绝对路径>` 传入）显式覆盖隔离根。普通继承的 `EVORESEARCH_ROOT` 在 worktree 中不会覆盖自动隔离，避免环境变量误配造成共享。
- ⚠️ **worktree 里改了 `profiles/evoresearch/cordis.patch.yml` 但未构建时**：先在该 worktree 执行 `npm install` 和 `npm run build`，再启动验收；启动器加载的是当前 worktree 的 profile，不会读取主仓库的 profile。

**本机正式 Web 与发布版 Web 的区别**：本机正式 Web 的 `EVORESEARCH_ROOT` 可以明确写成 `D:\DSH-Research\.evoresearch-data`，因为这是本机数据隔离约定；发布版不能照搬这条命令。发布版启动器应先计算统一根目录，再设置：

```text
EVORESEARCH_ROOT = <发布目录>/.evoresearch-data # 可移植发布
DSH_HOME = EVORESEARCH_ROOT
EVORESEARCH_DATA_ROOT = EVORESEARCH_ROOT
```

这样别人的电脑会使用自己的发布目录，不会寻找 `D:\DSH-Research`。如果采用安装版，`dataHome` 也可以改为当前用户的应用数据目录；关键是由启动器显式设置，而不是让 DSH 和插件各自回退到不同位置。

### 2.3 关键环境变量

| 变量 | 作用 | 3081 开发推荐值 |
|------|------|-----------------|
| `DSH_HOME` | DSH 的运行数据根（profiles/sessions/storages/settings/凭据/skills） | 开发：`D:\DSH-Research\.tmp-dev\.evoresearch-data`；正式 Web：`D:\DSH-Research\.evoresearch-data` |
| `EVORESEARCH_ROOT` | EvoResearch 唯一可配置的数据根；启动器同时将下面两个兼容变量设为此路径 | 开发：`D:\DSH-Research\.tmp-dev\.evoresearch-data`；正式 Web：`D:\DSH-Research\.evoresearch-data` |
| `EVORESEARCH_DATA_ROOT` | 兼容变量，表示 EvoResearch 部署根与科研项目工作区；值强制等于 `EVORESEARCH_ROOT` | 同 `EVORESEARCH_ROOT` |
| `EVORESEARCH_DATA_HOME` | 桌面版专用，exe 同级数据目录 | 由 Tauri 壳传入，勿手动覆盖 |
| `EVORESEARCH_PORT_FILE` | 桌面版端口文件 | `%LOCALAPPDATA%\com.evoresearch.desktop\port.json` |

> `dataRoot` 解析优先级（`host/index.ts`）：`config.dataRoot`（若 profile 提供）> `EVORESEARCH_ROOT` > `EVORESEARCH_DATA_ROOT` > `process.cwd()`。当前 EvoResearch profile 不写死 `dataRoot`；统一启动器显式传入 `EVORESEARCH_ROOT`，并把两个兼容变量同步为同一路径，cwd 只作为异常兜底。
>
> **在 worktree 里使用 `npm run start:web` 时**，上表三个变量由启动器自动替换为该 worktree 的独立根 `.tmp-dev\.evoresearch-data-<分支名>-<worktree标识>`（见 §2.2），无需也不应手工覆盖。确需共享数据时，只使用启动器 `--root <绝对路径>` 显式覆盖；继承的 `EVORESEARCH_ROOT` 不会关闭 worktree 隔离。

### 2.4 配置文件位置

- `settings.yaml` / `.credentials.yaml` / `.anonymous-user-id` — DSH 运行时在对应环境的 `DSH_HOME` 下读写。开发 Web 位于 `.tmp-dev\.evoresearch-data\`；正式 Web 位于 `.evoresearch-data\`；3080 官方 DSH 仍位于 `C:\Users\Karbo\.dsh\`。
- ~~项目根的 `settings.yaml`~~ **已于 2026-08-23 删除**（历史遗留：早期未设 DSH_HOME 时落到 cwd，两个活跃环境均不读它）。
- `desktop/sidecar/launch.js:ensureCredentials()` 会把程序目录内置 `.credentials.yaml` 复制进 `dataHome`（首次启动）。

### 2.5 启动后会产生/读写哪些文件（持久化清单）

按 §4.2 启动开发 Web 后，持久化文件都在对应开发 dataRoot 外层目录下：主仓库是 `.tmp-dev\.evoresearch-data\`，worktree 是 `.tmp-dev\.evoresearch-data-<分支名>-<worktree标识>\`；正式 Web 使用 `.evoresearch-data`。插件全局状态统一放在外层根的 `plugins\` 下，不再创建根级第二层 `.evoresearch-data`。

**A. DSH 引擎层（`DSH_HOME` 外层根，由 DSH 框架读写）：**

| 文件/目录 | 是什么 | 内容 |
|-----------|--------|------|
| `settings.yaml` | DSH 全局配置 | 默认模型（agent-default-model）、LLM provider 列表（new-api baseURL、模型 id、reasoningEffort）；UI 里改模型设置会写这里 |
| `.credentials.yaml` | 凭据存储 | provider 的 API key（如 `NEW_API_API_KEY: sk-...`）；**含密钥，gitignore，勿外传** |
| `profiles\evoresearch\` | 本项目的 profile | 见 §4.2.1；worktree 使用当前 worktree 的 profile 和 workspace 构建产物，主仓库使用主仓库 profile |
| `sessions\<工作区hash>\session-<uuid>\` | 对话会话存储 | 每个会话一个目录，存消息 JSONL 与会话元数据；左侧会话列表的数据源。目录名是启动时 cwd 路径的编码 |
| `storages\workspace.json` / `session_projcache.json` | DSH 工作区状态 | workspace 注册表、会话→项目映射缓存 |

**B. EvoResearch 插件层（`<EVORESEARCH_ROOT>\plugins\`，由本仓库插件读写）：**

| 文件/目录 | 是什么 | 内容 |
|-----------|--------|------|
| `projects\<name>\` | 科研项目工作区 | 项目文件（代码/文档/数据），内含独立 `.git`；项目名限小写字母数字连字符 ≤64 字符 |
| `projects\<name>\.evoresearch-data\` | 项目私有数据 | 该项目的 research_memory.db、observations、profile、CLI history 等（随项目走，删项目即删） |
| `plugins\ledgers\<project>\` | 实验账本 | 实验（experiment）条目与回合记录 |
| `plugins\chat-graphs\` | Chat Graph | 左侧对话图谱布局（xyflow 节点/边坐标），带 .bak 时间戳备份 |
| `plugins\memories\research_memory.db`（+shm/wal） | 全局长期记忆 | SQLite 库：跨项目的科研记忆条目；`notes\` 为笔记，`backups\` 自动备份 |
| `plugins\model-settings.json` | 科研模式模型选择 | 科研代码模式 Lite/More Effort 等各场景绑定的 provider+model |
| `plugins\scheduler.json` / `plugins\daily-report.json` | 定时任务与日报 | AutoSkills cron 注册状态；日报生成状态 |
| `plugins\client-state.json` / `plugins\session-meta.json` / `plugins\project-meta.json` | 前端/元信息缓存 | UI 状态持久化、会话元信息、项目元信息 |
| `plugins\evolution\candidates.json` | evolution 候选 | 自主演化候选队列 |

> 清空开发环境 = 删整个 `.tmp-dev\.evoresearch-data\`（profile、sessions、settings、凭据、项目和插件数据会一并删掉，需按 §4.2.1 重建）。**worktree 按分支隔离的根也要一并清理**（每个用过的分支一个 `.tmp-dev\.evoresearch-data-<分支名>-<worktree标识>\`，见 §2.2 / §3.2），否则残留的分支数据不会随主仓库根被清掉。正式 Web 根目录是 `.evoresearch-data\`，不可误删。只清测试项目 = 删对应 dataRoot 下的 `projects\<name>\`；实验账本位于 `dataRoot\plugins\ledgers\`，按项目名清理对应条目。

### 2.5.1 `EVORESEARCH_ROOT`、`DSH_HOME` 与 `EVORESEARCH_DATA_ROOT` 的边界

这三个变量都使用**绝对路径**；`EVORESEARCH_ROOT` 是唯一配置入口，后两个变量由启动器同步，但负责的内容仍有边界：

| 根变量 | 保存内容 | 典型内部路径 |
|---|---|---|
| `DSH_HOME` | DSH 引擎运行状态，不是科研项目源文件 | `settings.yaml`、`.credentials.yaml`、`.anonymous-user-id`、`profiles\`、`sessions\`、`storages\`、全局 `skills\` |
| `EVORESEARCH_ROOT` | EvoResearch 唯一数据根；既是 DSH_HOME 也是插件部署根 | `projects\`、`projects\<name>\.evoresearch-data\`、`plugins\ledgers\`、`plugins\memories\`、`plugins\scheduler.json` 等 |
| `EVORESEARCH_DATA_ROOT` | 兼容别名，强制等于 `EVORESEARCH_ROOT` | 与 `EVORESEARCH_ROOT` 相同 |

在本项目的 Web 环境中，两者强制使用同一个 `EVORESEARCH_ROOT`，但仍保留职责边界：

```text
<EVORESEARCH_ROOT>/                   # 例如 D:\DSH-Research\.tmp-dev\.evoresearch-data
├── profiles/evoresearch/              # DSH profile（仓库 profiles/ 的 junction）
├── sessions/<工作区编码>/             # DSH 对话会话
├── storages/                          # DSH 工作区注册与缓存
├── projects/<name>/                   # 科研项目文件
│   └── .evoresearch-data/             # 该项目私有记忆/观测/CLI 数据
└── plugins/                           # 插件全局状态（账本、记忆、调度、Chat Graph 等）
    ├── ledgers/
    ├── memories/
    └── scheduler.json / chat-graphs/ ...
```

路径基准规则：DSH 文件（`sessions`、`storages`、`settings.yaml` 等）相对于 `DSH_HOME`；项目目录与插件全局文件都相对于 `EVORESEARCH_ROOT`，插件全局文件位于 `EVORESEARCH_ROOT/plugins`；项目私有路径相对于 `EVORESEARCH_ROOT/projects/<name>/.evoresearch-data`。工作目录（cwd）只决定 DSH 会话归属和项目工作区选择，不能改变上述数据根。

### 2.6 官方 DSH（3080）与 EvoResearch（3081）隔离（非常重要）

**背景**：`3080` 是官方原版 DSH，只服务官方 Harness，不加载 EvoResearch；`3081` 才是 EvoResearch Web，加载本项目插件，开发数据随时可改/可删。两者**必须**使用不同 profile、不同 `DSH_HOME`，EvoResearch 也不得连接或写入官方 DSH 的 sessions/storages。

| 端口 | 用途 | EvoResearch 插件 | `DSH_HOME` | 实际效果 |
|------|------|--------------------------|------------|----------|
| `3080` | 官方原版 DSH | **不加载** | `C:\Users\Karbo\.dsh` | 只读写官方 DSH 数据，禁止加载 EvoResearch |
| `3081` | EvoResearch Web 开发/测试 | **加载** | 主仓库：`D:\DSH-Research\.tmp-dev\.evoresearch-data`；worktree 内：`.tmp-dev\.evoresearch-data-<分支名>-<worktree标识>` | 主仓库开发产出落 `.tmp-dev\.evoresearch-data`；worktree 内按分支隔离（见 §2.2），删对应根即清该环境测试数据 |

**常见坑**：把 EvoResearch 插件挂到 3080，或让 3081 使用 `C:\Users\Karbo\.dsh`，都会造成官方 DSH 与 EvoResearch 数据混同；用 `Start-Process` 不加 `-Environment` 则环境变量不传递。

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
| `.tmp-dev/.evoresearch-data/` | 3081 EvoResearch 开发数据根（主仓库 main；含 DSH `profiles/`、`sessions/`、`storages/` 和插件状态） |
| `.tmp-dev/.evoresearch-data-<分支名>-<worktree标识>/` | worktree 的独立开发数据根（见 §2.2）；分支名经清洗并附加 worktree 路径短哈希，可整体删除以清理该 worktree 测试数据 |
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

### 4.2 网页版开发（3081 首选）— 后端 + 前端一体化

前端是静态 bundle，由 DSH 后端直接托管（`dsh-host-frontend-static`），**没有独立的前端 dev server**——启动后端即同时服务前后端。

**推荐使用路径可配置的统一启动器**：

```powershell
npm run start:web
```

**在任意 worktree 里运行 `npm run start:web` 时，数据根自动切换为该 worktree 的独立根 `.tmp-dev\.evoresearch-data-<分支名>-<worktree标识>`**（见 §2.2），端口同样从 3081 起自动递增。启动前必须先在该 worktree 执行 `npm install` 和 `npm run build`，以确保验收的是当前分支代码。

**日常启动（profile 已就绪时）**：

```powershell
# 带显式环境变量启动（PowerShell；Start-Process 必须加 -Environment）
Start-Process npx.cmd "@deepseek-ai/dsh@0.1.1-rc.2 --profile evoresearch --port 3081" -WindowStyle Hidden `
  -Environment @{
    EVORESEARCH_ROOT="D:\DSH-Research\.tmp-dev\.evoresearch-data";
    DSH_HOME="D:\DSH-Research\.tmp-dev\.evoresearch-data";
    EVORESEARCH_DATA_ROOT="D:\DSH-Research\.tmp-dev\.evoresearch-data"
  }
# 打开 http://127.0.0.1:3081
# 调试桌面标题栏：http://127.0.0.1:3081/?desktop=1
```

bash 等价形式（Claude Code 后台任务常用）：

```bash
EVORESEARCH_ROOT="D:\\DSH-Research\\.tmp-dev\\.evoresearch-data" \
DSH_HOME="D:\\DSH-Research\\.tmp-dev\\.evoresearch-data" \
EVORESEARCH_DATA_ROOT="D:\\DSH-Research\\.tmp-dev\\.evoresearch-data" \
npx @deepseek-ai/dsh@0.1.1-rc.2 --profile evoresearch --port 3081
```

**验证启动成功**：
1. 日志出现 `[evoresearch] host 插件激活（dataRoot: …）`：主仓库为 `.tmp-dev\.evoresearch-data`，worktree 内为该分支独立根 `.tmp-dev\.evoresearch-data-<分支名>-<worktree标识>`（见 §2.2）；
2. 使用启动器日志打印的实际 URL 访问（正常情况下是 `http://127.0.0.1:3081/`，端口占用时可能是 3082 或更高）并返回 200；
3. 页面左侧项目列表来自对应 dataRoot（主仓库 `.tmp-dev`，worktree 为其分支根）；3080 是独立的官方 DSH，不作 EvoResearch 对照环境。

**profile 就绪判定**：当前 worktree 的 `profiles\evoresearch\` 必须存在 `cordis.yml`、`cordis.patch.yml`、`package.json`、`node_modules`，且 `node_modules/@evoresearch/dsh-app`、`dsh-plugin` 指向该 worktree 自己的 workspace 包。不要把 worktree profile junction 到主仓库；启动器会把 profile 挂载到对应 dataRoot 下的 `profiles\evoresearch\`。若缺失，先在当前 worktree 执行 `npm install` 和 `npm run build`。

#### 4.2.1 重建开发 profile（一次性 / node_modules 损坏时）

> **worktree 数据根的 profile 由启动器自动挂载当前 worktree 的 profile**；不要手工把 profile junction 到主仓库。若 `profiles\evoresearch\` 或其 `node_modules` 缺失，必须在当前 worktree 执行 `npm install` 和 `npm run build`。`package.json` 中的 `file:../../packages/...` 会相对于当前 worktree profile 正确解析；不要复制 profile 到数据目录后再安装。

**注意**：`--profile evoresearch` 只认裸名（profile 必须位于 `$DSH_HOME/profiles/` 下），**不能**传 `--profile profiles/evoresearch` 路径形式（rc.2 会报 invalid profile name）。

#### 4.2.2 EvoResearch 正式网页版（3081 首选）

正式 Web 与开发 Web 使用同一套 `evoresearch` profile，端口从 `3081` 开始自动选择，只切换 `EVORESEARCH_ROOT`。正式 Web 的 `EVORESEARCH_ROOT` 是 `D:\DSH-Research\.evoresearch-data`，`DSH_HOME` 和 `EVORESEARCH_DATA_ROOT` 自动与其相同；其 `profiles` 也应通过 junction 指向仓库 `profiles`：

```powershell
Start-Process npx.cmd "@deepseek-ai/dsh@0.1.1-rc.2 --profile evoresearch --port 3081" -WindowStyle Hidden `
  -Environment @{
    EVORESEARCH_ROOT="D:\DSH-Research\.evoresearch-data";
    DSH_HOME="D:\DSH-Research\.evoresearch-data";
    EVORESEARCH_DATA_ROOT="D:\DSH-Research\.evoresearch-data"
  }
# 打开 http://127.0.0.1:3081
```

开发 Web 与正式 Web 不应共用同一份数据目录；启动器会在 3081 被占用时自动选择更高端口。切换前只需确认 `EVORESEARCH_ROOT` 指向正确环境，启动器会同步两个兼容变量。3080 始终保留给官方原版 DSH，EvoResearch 启动器不会选择它。

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

1. **0 warnings / 0 errors**：适配新 DSH 版本（如 rc.2）后，端到端无 warnings/errors 为验收标准。
2. **前端样式**：`packages/evoresearch-app/src/client/styles.ts` 为主样式；桌面自绘标题栏相关样式在 `html.evo-desktop` 分支，`z-index` 需谨慎（标题栏 `2147483647` 为顶层，需让 modal 等让位）。
3. **React key**：所有 `.map()` 必须传 key（第三参数）；`index.ts` 有 `suppressKeyWarning` 兜底（仅压制误报）。
4. **Cordis 插件**：profile 为 `@deepseek-ai/dsh-base` + `@evoresearch/dsh-app` + `@evoresearch/dsh-plugin`；rc.2 起需 `ui-renderer` 提供 `uiRenderer` 服务（`cordis.patch.yml`）。
5. **截图/临时脚本产物**：一律 `.tmp-dev/images/`；一次性调试脚本可放 `scripts/.tmp-*`（gitignore）或直接 `.tmp-dev/`。不得污染项目根、用户目录或数据目录。
6. **数据目录**：EvoResearch 开发 Web 数据只进 `.tmp-dev/.evoresearch-data/`（主仓库）或 `.tmp-dev/.evoresearch-data-<分支名>-<worktree标识>/`（worktree，见 §2.2）；正式 Web 数据只进仓库根 `.evoresearch-data/`；官方 DSH 数据只在 `C:\Users\Karbo\.dsh`（勿写勿删）；桌面版数据只在 exe 同级 `.evoresearch-data/`。
7. **URL 短化**：面向用户的 URL 一律用短键与可读短值——会话是 `?t=<slug>`（英文别名或 `s-<uuid 前8位>` 兜底，映射持久化于 `plugins/session-meta.json`，经 `sessionSlugEnsure/sessionSlugLookup` 分配与反查），键名一律单/双字符：`v`（视图）/`i`（检查器）/`it`（检查子标签）/`sb`（窄屏抽屉）/`r`（编辑重发文本），且**枚举值同样缩写**：`v=ws|sk|mem|sch|ch|tm|exp|note|lib`、`it=ws|ag|ch`；完整单词的旧链接仍兼容读取并自动升级为短形式。禁止再往分享链接里塞完整 `session-<uuid>` 或 `threadId=/view=/inspector=` 长参数。DSH 引擎层的 `session-<uuid>` 目录名不动，slug 只是 UI 层别名。新增任何 URL 参数先走这条规则。更完整的约定见 `docs/` 下的 URL 短化设计文档。
8. **自动 Git 管理（用户明确要求，必须遵守）**：Agent 完成一个完整改动后**必须自动 `git add` + `git commit`，不等用户提醒**；提交只在**当前 worktree 的分支**上进行，不碰 main、不混入他人未提交的 WIP。详细规则见 §9.0。

---

## 7. 初次交接 Checklist

- [ ] `npm install && npm run build` 能通过
- [ ] 按 §4.2 启动 Web，日志 dataRoot 为主仓库 `.tmp-dev\.evoresearch-data`（在主仓库 main 里），并使用日志中的实际 URL（3081 首选，端口占用时自动递增）返回 200；若在 worktree 里启动，dataRoot 应为该分支独立根 `.tmp-dev\.evoresearch-data-<分支名>-<worktree标识>`
- [ ] `http://127.0.0.1:3081/?desktop=1` 标题栏 36px 正常，设置面板返回按钮可见（`top:46` 不被遮挡）
- [ ] `node desktop/scripts/build.mjs --skip-download` 能产出 NSIS 安装包，安装后无黑窗、无滚动条/黑边
- [ ] `npm run verify` 全绿
- [ ] 知晓：临时产物只进 `.tmp-dev/`（截图 `images/`）；EvoResearch 开发 Web 数据只进 `.tmp-dev/.evoresearch-data/`（主仓库）或 `.tmp-dev/.evoresearch-data-<分支名>-<worktree标识>/`（worktree，见 §2.2）；正式 Web 数据只进仓库根 `.evoresearch-data/`；官方 DSH 数据只在 `C:\Users\Karbo\.dsh`；桌面版数据只在 exe 同级 `.evoresearch-data/`

---

## 8. 约束与注意事项

- **勿删 `.tmp-dev/node_modules`**：内含 Playwright，删后 e2e/截图脚本失效。
- **勿动 3080 官方 DSH 数据**：`C:\Users\Karbo\.dsh`、3080 端口进程一律不写不删；清理进程时精确匹配路径，勿误杀常驻 DSH。仓库根 `.evoresearch-data/` 属于 EvoResearch 正式 Web，不能与官方 DSH 数据混用。
- **Tauri resources 路径**：`tauri.conf.json` 的 `resources: ../sidecar/dist/**/*` 会把 junction 展开为真实目录（`--install-links` 保证可移植）。
- **移动端（Android/iOS）必须用 `tauri.<platform>.conf.json` 清空 resources**——sidecar glob 在无 `desktop/sidecar/dist/` 的 CI 环境直接报错；壳侧 `main.rs` 已拆 desktop/mobile 双入口。
- **iOS 构建三坑**：① `tauri ios build --target` 只认短名 `aarch64/aarch64-sim/x86_64`；
  ② `tauri ios init` 生成的 Xcode phase 是 `npm run tauri --` → 根 package.json 必须有
  `"tauri": "tauri"` script 且 `@tauri-apps/cli` 在 devDependencies；③ CLI 用 `npx tauri`
  （cargo 版与 npm 版子命令不同）。
- **gh api 布尔值用 `-F` 不用 `-f`**（字符串 "false" 会 422）；PATCH release 只认
  `/releases/{id}`，by-tag 路由 404。
- **`@deepseek-ai/dsh-client-schema-form`（rc.7）、`@deepseek-ai/dsh-client-web-react`（rc.7）等无 `0.1.1-rc.2` 的包保持其历史可用版本**（`ETARGET` 限制；`dsh-client-web-react@rc.7` 自身锁定的 `dsh-client-ui-slots@rc.8` 传递依赖亦保留）。
- **AGENTS.md**：项目交接与开发约定，纳入 Git 跟踪并推送到 GitHub。
- **`.serena/`**：Serena MCP（LSP 代码检索工具）的项目级配置与缓存，由 Claude Code 的 serena MCP server 读写，与本应用运行无关；已 gitignore。

---

## 9. Git 与发布自动化

### 9.0 自动 Git 管理（⚠️ 用户明确要求，Agent 必须执行）

> **核心要求：不要等用户提醒，完成即提交。** Agent 对本仓库的每次有意义的改动，都要**自动**完成 git 提交，把"改动躺在工作区里未提交"视为异常状态。

- **自动提交时机**：每当完成一个完整、自洽的改动（一个功能、一个修复、一批文档更新），并且经过基本验证（构建/测试通过）后，**立即自动 `git add` + `git commit`**。不要批量攒到会话结束，更不要问用户"要不要提交"。
- **提交位置（关键）**：一律在**当前 worktree 对应的分支**上提交（如 `claude/dev`）；**绝不直接在 main 上提交**，绝不把提交混进主仓库里他人未提交的 WIP。因此**禁止 `git add -A` / `git add .`**——只精确 add 自己本次改动的文件，避免误收别人的草稿。
- **提交信息**：中文 conventional commits，格式 `type(scope): 一句话说明改了什么、为什么`（如 `feat(trajectory): 条长模式改为「按耗时/按回合」`）；**不带任何 co-author trailer**（见 §9.1）。
- **提交粒度**：一个功能/一个修复一个 commit；同一次改动不要拆成碎片提交，也不要把多个不相关改动塞进同一个 commit。
- **push**：worktree 功能分支默认**不自动 push**（用户要求或需要备份时再推）；`git push origin main` 仍按下方"日常"规则执行（工作树干净、`ahead N` 时）。
- **异常兜底**：若工作区里存在不属于本次任务的他人 WIP，提交时只 add 自己的文件并照常 commit；发现改动无法通过构建时先修复再提交，确实修不完就先提交草稿并在 commit message 里注明 `WIP:`。
- **worktree 清理联动**：删除某个 worktree 前，先确认其分支上没有未提交的成果（见 §9.2"成果及时 commit"）；删除分支前用 `git branch -d`（而非 `-D`）让 git 帮忙校验已合并。

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
- **每个 worktree 启动 Web 都使用独立数据根** `.tmp-dev/.evoresearch-data-<分支名>-<worktree标识>`
  （见 §2.2）：并行开发/验收的数据互不冲突，端口从 3081 起自动探测且不使用 3080；主仓库 main 仍用
  `.tmp-dev\.evoresearch-data`。确需共享数据时只通过启动器 `--root <绝对路径>` 显式覆盖。
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
- **数据布局（2026-08-24 定稿）**：EvoResearch 开发 Web 数据 `.tmp-dev/.evoresearch-data/`（主仓库）或 `.tmp-dev/.evoresearch-data-<分支名>-<worktree标识>/`（worktree 独立根，见 §2.2）、正式 Web 数据 `.evoresearch-data/`（各自作为对应环境的 `EVORESEARCH_ROOT`、`DSH_HOME` 与 `EVORESEARCH_DATA_ROOT`；插件全局状态位于根下 `plugins/`，不再嵌套第二层 `.evoresearch-data/`）；临时产物 `.tmp-dev/images/`；Playwright 依赖
  `.tmp-dev/node_modules/`；旧 `.tmp-port/` 已删除。

---

*最后更新：2026-08-28（新增 §9.0 自动 Git 管理强规则：完成即自动 commit、只在当前 worktree 分支提交、禁 `git add -A`；worktree 数据根使用“清洗后分支名 + 稳定 worktree 标识”，并加载当前 worktree profile 和构建产物；每个 worktree 需独立执行 `npm install`、`npm run build`，可并行开发与验收；3080 官方 DSH / EvoResearch Web 数据严格隔离）*
