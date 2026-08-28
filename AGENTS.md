# AGENTS.md — EvoResearch 项目交接手册

> **定位**：接手本项目的开发者 / Agent 的完整工作手册：隐形规则、环境约定、启动/构建命令、数据目录统一原则。本文件纳入 Git 跟踪并推送到 GitHub。
>
> ⚠️ **本文件硬性上限 24,000 字符。** 每次修改本文件后，**必须重新统计字符数**：PowerShell 执行 `(Get-Content -Raw AGENTS.md).Length`，结果 > 24000 必须继续精简；未超限才允许提交（见 §9.0）。

---

## 1. 项目全貌

- **名称**：EvoResearch — 面向科研的自主智能体工作台（对话、文献、项目文件、实验记录与长期记忆联动）。
- **基座**：`@deepseek-ai/dsh` **0.1.1-rc.2**（务必用此版本或兼容更新版，见 `README.md` 与 `profiles/evoresearch/package.json`）。
- **结构**：monorepo（`packages/*` workspaces）：`packages/evoresearch-plugin`（后端插件，Host 侧 Cordis 服务）、`packages/evoresearch-app`（前端，React + Cordis slots）、`desktop/`（Tauri 2 桌面壳，sidecar 启动 DSH + 自绘标题栏）、`profiles/evoresearch/`（DSH profile：`cordis.yml` / `cordis.patch.yml` 叠加）、`docs/`（设计与决策文档）、`scripts/`（构建与校验脚本）。

---

## 2. 数据目录统一原则（核心约束）

### 2.1 三个完全独立的运行环境（核心约束）

**3080 是官方原版 DSH，不加载 EvoResearch 插件**：承载官方 DSH 的重要对话和 Harness 数据，必须与 EvoResearch 完全隔离，禁止使用 EvoResearch profile/插件/数据根，不可污染、不可删除。

**EvoResearch 网页版首选 3081**（端口占用时统一启动器自动向上选空闲端口，始终跳过 3080），profile 必须是 `evoresearch`；每个环境只配置 `EVORESEARCH_ROOT`，启动器强制令 `DSH_HOME` 与 `EVORESEARCH_DATA_ROOT` 等于该根。开发数据根：主仓库 `.tmp-dev\.evoresearch-data\`，worktree 为 `.tmp-dev\.evoresearch-data-<分支名>-<worktree标识>\`（见 §2.2），各自可整体清空/备份；正式 Web 数据根为仓库根 `.evoresearch-data\`，不可与开发目录混用。

**桌面版是第三条数据线**：加载 EvoResearch 插件，数据在 exe 同级 `.evoresearch-data/`（Tauri 壳经 `EVORESEARCH_DATA_HOME` 传入），sidecar 动态空闲端口，随程序目录迁移，整体备份即迁移。

三条数据线严格隔离，互不读写。正式 Web 根中的旧内容可能是历史残留，使用/清理前先核对启动参数和实际 profile，不得当作官方 3080 数据。`D:\DSH-Research\...` 只是**本机路径约定**，发布版不得硬编码该盘符：启动器应按发布目录或用户数据目录计算绝对 `EVORESEARCH_ROOT`（可移植版 `<发布目录>/.evoresearch-data`，安装版用当前用户可写的数据目录），再同步 `DSH_HOME`/`EVORESEARCH_DATA_ROOT`；只有启动器未设置这些变量时，插件才回退用 cwd 作 `dataRoot`（发布版不应依赖）。

**临时产物**：截图/调试输出只进 `.tmp-dev/images/`（见 §3）。**项目工作区**：`<dataRoot>\projects\<name>\`（开发 `.tmp-dev`、正式 `.evoresearch-data`），内部 `.evoresearch-data/` 为项目私有数据，删项目即删。

### 2.2 worktree 数据根隔离（核心约束）

主仓库（main）`npm run start:web` 仍读写 `.tmp-dev\.evoresearch-data`，行为不变。**在任意 worktree 里 `npm run start:web`，启动器（`scripts/start-web.mjs` 的 `detectWorktreeIsolation()`）自动把 `EVORESEARCH_ROOT` / `DSH_HOME` / `EVORESEARCH_DATA_ROOT` 一并指到该 worktree 的独立根 `.tmp-dev\.evoresearch-data-<分支名>-<worktree标识>`**：用 `git --git-common-dir` / `--show-toplevel` / `branch --show-current` 判断是否在 worktree；分支名非法字符（如 `/`）收敛为 `-` 并附加 worktree 路径稳定短标识防碰撞；detached HEAD 用 `detached-<标识>`。

> **代码与数据都按 worktree 隔离**：启动器从当前 worktree 的 `profiles\evoresearch` 加载插件，因此 worktree 必须先在自身目录 `npm install` + `npm run build`（可共享下载缓存，不能依赖主仓库构建产物），每个 worktree 验收自己的分支代码。

**为什么**：多个 worktree 若写同一数据根，会并发抢写 `settings.yaml`、`storages\workspace.json`、`plugins\*\*.json`，并并发打开 `research_memory.db`（SQLite 锁/损坏风险），会话与项目映射互相穿插。隔离后各 worktree 有完整的 projects / ledgers / memories / sessions / storages / settings，可并行开发与验收。

**端口**：`scripts/web-port.mjs` 从 3081 起自动探测，多实例依次 3081/3082/3083…，极短竞态由操作系统绑定结果决定。

**隔离与共享分界**：串行或并行使用时各根天然隔离；确需共享数据（如复用主仓库记忆/账本）只用启动器 `--root <绝对路径>`（`npm run start:web -- --root …`）显式覆盖——继承的 `EVORESEARCH_ROOT` 在 worktree 中不会覆盖自动隔离。⚠️ worktree 里改了 `profiles/evoresearch/cordis.patch.yml` 未构建时：先在该 worktree `npm install` + `npm run build` 再启动验收（启动器只读当前 worktree 的 profile）。

### 2.3 关键环境变量

| 变量 | 作用 |
|------|------|
| `EVORESEARCH_ROOT` | **唯一配置入口**（绝对路径）；启动器将 `DSH_HOME`、`EVORESEARCH_DATA_ROOT` 同步为此路径。开发 `D:\DSH-Research\.tmp-dev\.evoresearch-data`，正式 Web `D:\DSH-Research\.evoresearch-data` |
| `DSH_HOME` | DSH 运行数据根（profiles/sessions/storages/settings/凭据/skills），强制等于 `EVORESEARCH_ROOT` |
| `EVORESEARCH_DATA_ROOT` | 兼容别名，强制等于 `EVORESEARCH_ROOT` |
| `EVORESEARCH_DATA_HOME` / `EVORESEARCH_PORT_FILE` | 桌面版专用：exe 同级数据目录 / `%LOCALAPPDATA%\com.evoresearch.desktop\port.json`，勿手动覆盖 |

> `dataRoot` 解析优先级（`host/index.ts`）：`config.dataRoot`（若 profile 提供）> `EVORESEARCH_ROOT` > `EVORESEARCH_DATA_ROOT` > `process.cwd()`。当前 profile 不写死 `dataRoot`，由启动器显式传入。worktree 内启动时上表变量被自动替换为该 worktree 独立根，无需也不应手工覆盖。

### 2.4 配置文件位置

- `settings.yaml` / `.credentials.yaml` / `.anonymous-user-id` 在对应环境 `DSH_HOME` 下：开发 `.tmp-dev\.evoresearch-data\`，正式 Web `.evoresearch-data\`，3080 在 `C:\Users\Karbo\.dsh\`。（项目根 `settings.yaml` 已于 2026-08-23 删除，无环境读它。）
- `desktop/sidecar/launch.js:ensureCredentials()` 首次启动把内置 `.credentials.yaml` 复制进 `dataHome`。

### 2.5 启动后的持久化清单

持久化文件都在对应 dataRoot 外层根下（主仓库 `.tmp-dev\.evoresearch-data\`、worktree 为带标识根、正式 Web `.evoresearch-data`）；插件全局状态统一在根下 `plugins\`，无第二层 `.evoresearch-data`。

**A. DSH 引擎层（`DSH_HOME`）：** `settings.yaml`（全局配置：默认模型、LLM provider 列表）；`.credentials.yaml`（API key，**含密钥已 gitignore 勿外传**）；`profiles\evoresearch\`（profile，worktree 用自己的）；`sessions\<工作区hash>\session-<uuid>\`（会话 JSONL 与元数据，左侧会话列表数据源）；`storages\workspace.json` / `session_projcache.json`（工作区注册、会话→项目缓存）。

**B. 插件层（`<EVORESEARCH_ROOT>\plugins\` 与 `projects\`）：** `projects\<name>\`（项目工作区，内含独立 `.git`，名限小写字母数字连字符 ≤64）及 `projects\<name>\.evoresearch-data\`（项目私有 research_memory.db、observations、profile、CLI history）；`plugins\ledgers\<project>\`（实验账本）；`plugins\chat-graphs\`（图谱布局，.bak 备份）；`plugins\memories\research_memory.db`（全局长期记忆，`notes\`、`backups\`）；`plugins\model-settings.json`（科研模式模型绑定）；`plugins\scheduler.json` / `daily-report.json`（定时任务与日报）；`plugins\client-state.json` / `session-meta.json` / `project-meta.json`（前端状态与元信息缓存）；`plugins\evolution\candidates.json`（演化候选队列）。

> 清空开发环境 = 删整个对应根（worktree 的带标识根要一并删，否则分支数据残留；正式 Web 根 `.evoresearch-data\` 不可误删）。只清测试项目 = 删 `projects\<name>\` 并按项目名清理 `plugins\ledgers\`。

### 2.6 路径基准与 3080/3081 隔离

- **路径基准**：DSH 文件（sessions/storages/settings.yaml 等）相对 `DSH_HOME`；项目目录与插件全局文件相对 `EVORESEARCH_ROOT`（插件全局在 `EVORESEARCH_ROOT/plugins`）；项目私有路径相对 `EVORESEARCH_ROOT/projects/<name>/.evoresearch-data`；cwd 只决定会话归属与项目工作区选择，不改变数据根。
- **隔离红线**：EvoResearch 不得连接或写入官方 DSH（`C:\Users\Karbo\.dsh`、3080）的 sessions/storages；把 EvoResearch 挂到 3080、或让 3081 用 `C:\Users\Karbo\.dsh` 都是数据混同事故。

---

## 3. 临时文件与截图规范

**所有 Playwright/调试截图、临时脚本输出必须放 `.tmp-dev/`**（截图在 `.tmp-dev/images/`），已 gitignore；禁止散落到项目根、用户目录、`.evoresearch-data/` 等任何别处。

```js
await page.screenshot({ path: 'D:/DSH-Research/.tmp-dev/images/debug-3081.png' }) // ✅
// ❌ 项目根 / C:\Users\Karbo\... / .evoresearch-data\
```

| 子目录 | 用途 |
|--------|------|
| `.tmp-dev/images/` | 截图、HTML 预览等可视化产物 |
| `.tmp-dev/.evoresearch-data/` | 主仓库 main 开发数据根 |
| `.tmp-dev/.evoresearch-data-<分支名>-<worktree标识>/` | worktree 独立数据根（见 §2.2），整体删除即清理该分支测试数据 |
| `.tmp-dev/node_modules/` | Playwright（e2e/截图脚本经 `file:///D:/DSH-Research/.tmp-dev/node_modules/playwright/index.mjs` 导入）；**勿删** |
| `.tmp-dev/scripts-legacy/`、`legacy-tmp-port/` | 历史归档（旧 `.tmp-port/` 已于 2026-08-23 删除，再引用均为过期信息） |

---

## 4. 启动与开发命令

### 4.1 前置（一次性）

```bash
npm install && npm run build   # 修改 packages/* 后必须重新 build
```

### 4.2 网页版开发（3081 首选）

前端是静态 bundle 由 DSH 后端托管（`dsh-host-frontend-static`），**没有独立前端 dev server**——启动后端即同时服务前后端。**推荐统一启动器 `npm run start:web`**（自动设环境变量、数据根、端口）；worktree 里运行时数据根自动切换为该 worktree 独立根（见 §2.2），启动前必须先在该 worktree `npm install` + `npm run build`。

手工启动（PowerShell；`Start-Process` 必须加 `-Environment`，否则环境变量不传递）：

```powershell
Start-Process npx.cmd "@deepseek-ai/dsh@0.1.1-rc.2 --profile evoresearch --port 3081" -WindowStyle Hidden `
  -Environment @{ EVORESEARCH_ROOT="D:\DSH-Research\.tmp-dev\.evoresearch-data";
                  DSH_HOME="D:\DSH-Research\.tmp-dev\.evoresearch-data";
                  EVORESEARCH_DATA_ROOT="D:\DSH-Research\.tmp-dev\.evoresearch-data" }
# 打开 http://127.0.0.1:3081（调试桌面标题栏加 ?desktop=1）
```

bash 等价形式：以上三个变量取同值（`D:\\DSH-Research\\.tmp-dev\\.evoresearch-data`）作前缀，接 `npx @deepseek-ai/dsh@0.1.1-rc.2 --profile evoresearch --port 3081`。

**验证启动成功**：① 日志出现 `[evoresearch] host 插件激活（dataRoot: …）` 且 dataRoot 符合 §2（主仓库或分支独立根）；② 用启动器日志打印的实际 URL（3081 起，占用自动递增）访问返回 200；③ 左侧项目列表来自对应 dataRoot。

**profile 就绪判定**：当前 worktree `profiles\evoresearch\` 须有 `cordis.yml`、`cordis.patch.yml`、`package.json`、`node_modules`，且 `node_modules/@evoresearch/*` 指向本 worktree workspace 包；缺失就先在当前 worktree `npm install` + `npm run build`。profile 的 `file:../../packages/...` 相对当前 worktree 解析；不要把 profile junction 到主仓库、不要复制到数据目录（启动器自动挂载）。**`--profile evoresearch` 只认裸名**，不能传路径形式（rc.2 报 invalid profile name）。

#### 4.2.1 正式 Web（同一 profile，只切数据根）

正式 Web 用同一套启动命令，仅把三个变量换成 `D:\DSH-Research\.evoresearch-data`，其 profiles junction 指向仓库 `profiles`。开发/正式不共用数据目录；启动器自动避让 3080。

### 4.3 桌面版

- **开发态**：`cd desktop; cargo tauri dev`（需 Rust）。
- **打包 NSIS**：`npm run build` → `node desktop/scripts/build.mjs --skip-download`，产物 `desktop/src-tauri/target/release/bundle/nsis/EvoResearch_0.1.0_x64-setup.exe`（同时更新 `desktop/sidecar/dist/` 与 `_up_/`）。
- `bundle-sidecar.mjs` 用 `--install-links` 真实复制 `@evoresearch/*`（junction 在 NSIS 展开失效）；`launch.js` 启动时自愈 profile junction（黑窗根因修复）；无边框窗口 + 自绘标题栏 36px（`?desktop=1` 渲染 `DesktopTitlebar`）。

---

## 5. 构建与校验流水

```bash
npm run verify                       # 完整校验：构建+单测+domain/acceptance e2e+xyflow+bundle+docs
npm run build                        # 构建插件 + 前端
npm test                             # 插件单元测试
npm run test -w @evoresearch/dsh-app
npm run verify:domain / npm run verify:acceptance
node scripts/verify-chatgraph-xyflow.mjs / verify-bundle.mjs / check-docs.mjs
```

---

## 6. 通用项目规则

1. **0 warnings / 0 errors**：端到端无 warnings/errors 为验收标准。
2. **前端样式**：`packages/evoresearch-app/src/client/styles.ts` 为主；桌面标题栏样式在 `html.evo-desktop` 分支，`z-index` 谨慎（标题栏 `2147483647` 顶层，modal 等需让位）。
3. **React key**：所有 `.map()` 必须传 key（第三参数）；`index.ts` 有 `suppressKeyWarning` 兜底（仅压制误报）。
4. **Cordis 插件**：profile = `@deepseek-ai/dsh-base` + `@evoresearch/dsh-app` + `@evoresearch/dsh-plugin`；rc.2 起需 `ui-renderer` 提供 `uiRenderer` 服务（`cordis.patch.yml`）。
5. **临时产物**：一律 `.tmp-dev/images/`；一次性调试脚本放 `scripts/.tmp-*`（gitignore）或 `.tmp-dev/`；不得污染项目根、用户目录、数据目录。
6. **数据目录**：开发 Web 数据只进 `.tmp-dev` 对应根（主仓库或 worktree 带标识根，见 §2.2）；正式 Web 只进 `.evoresearch-data/`；官方 DSH 数据只在 `C:\Users\Karbo\.dsh`（勿写勿删）；桌面版只在 exe 同级 `.evoresearch-data/`。
7. **URL 短化**：面向用户的 URL 一律短键短值——会话 `?t=<slug>`（英文别名或 `s-<uuid 前8位>` 兜底，映射持久化于 `plugins/session-meta.json`，经 `sessionSlugEnsure/sessionSlugLookup` 分配/反查）；键名单/双字符：`v`（视图）/`i`（检查器）/`it`（检查子标签）/`sb`（窄屏抽屉）/`r`（编辑重发文本），**枚举值同样缩写**：`v=ws|sk|mem|sch|ch|tm|exp|note|lib`、`it=ws|ag|ch`；完整单词旧链接兼容读取并自动升级为短形式；禁止塞完整 `session-<uuid>` 或 `threadId=/view=/inspector=` 长参数；引擎层 `session-<uuid>` 目录名不动；新增 URL 参数先走本条。详见 `docs/` URL 短化设计文档。
8. **自动 Git 管理（用户明确要求，必须遵守）**：完成一个完整改动后**必须自动 `git add` + `git commit`，不等用户提醒**；只在**当前 worktree 分支**提交，不碰 main、不混入他人未提交 WIP。详见 §9.0。

---

## 7. 初次交接 Checklist

- [ ] `npm install && npm run build` 通过；`npm run verify` 全绿
- [ ] 按 §4.2 启动 Web：dataRoot 符合 §2（主仓库 `.tmp-dev\.evoresearch-data` 或分支独立根），实际 URL 返回 200
- [ ] `http://127.0.0.1:3081/?desktop=1` 标题栏 36px 正常，设置面板返回按钮可见（`top:46` 不被遮挡）
- [ ] `node desktop/scripts/build.mjs --skip-download` 产出 NSIS 包，安装后无黑窗、无滚动条/黑边
- [ ] 知晓 §3 临时产物规范与 §6.6 数据目录边界

---

## 8. 约束与注意事项

- **勿删 `.tmp-dev/node_modules`**（内含 Playwright，删后 e2e 失效）；**勿动 3080 官方 DSH 数据**（`C:\Users\Karbo\.dsh`、3080 进程不写不删，清理进程精确匹配路径防误杀）。
- **Tauri resources**：`tauri.conf.json` 的 `resources: ../sidecar/dist/**/*` 会把 junction 展开为真实目录（`--install-links` 保证可移植）；**移动端必须用 `tauri.<platform>.conf.json` 清空 resources**（sidecar glob 在无 dist 的 CI 直接报错；壳侧 main.rs 已拆 desktop/mobile 双入口）。
- **iOS 构建三坑**：① `tauri ios build --target` 只认短名 `aarch64/aarch64-sim/x86_64`；② `tauri ios init` 生成的 Xcode phase 是 `npm run tauri --` → 根 package.json 须有 `"tauri": "tauri"` script 且 `@tauri-apps/cli` 在 devDependencies；③ 用 `npx tauri`（cargo 版子命令不同）。
- **gh api**：布尔值用 `-F` 不用 `-f`（字符串 "false" 会 422）；PATCH release 只认 `/releases/{id}`，by-tag 路由 404。
- **依赖版本**：`@deepseek-ai/dsh-client-schema-form@rc.7`、`dsh-client-web-react@rc.7` 等无 `0.1.1-rc.2` 版本的包保持历史可用版本（ETARGET 限制；web-react@rc.7 锁定的 `dsh-client-ui-slots@rc.8` 传递依赖亦保留）。
- **`.serena/`**：Serena MCP（LSP 检索）项目配置与缓存，gitignore，与本应用运行无关。

---

## 9. Git 与发布自动化

### 9.0 自动 Git 管理（⚠️ 用户明确要求，Agent 必须执行）

> **核心要求：不要等用户提醒，完成即提交。** 每次有意义的改动都要**自动**完成 git 提交，把"改动躺在工作区里未提交"视为异常状态。

- **自动提交时机**：完成一个完整、自洽的改动（功能/修复/文档），并经基本验证（构建/测试通过）后，**立即自动 `git add` + `git commit`**；不攒到会话结束，不问"要不要提交"。
- **提交位置（关键）**：一律在**当前 worktree 对应的分支**上提交（如 `claude/dev`）；**绝不直接在 main 上提交**，绝不混入主仓库他人未提交的 WIP；**禁止 `git add -A` / `git add .`**——只精确 add 自己本次改动的文件。
- **提交信息**：中文 conventional commits，`type(scope): 一句话说明改了什么、为什么`；**不带任何 co-author trailer**（见 §9.1）。
- **提交粒度**：一个功能/修复一个 commit；不拆碎片，也不混装不相关改动。
- **push**：worktree 功能分支默认**不自动 push**（用户要求或需备份时再推）；`git push origin main` 按"日常"规则（工作树干净、`ahead N` 时）。
- **异常兜底**：工作区有他人 WIP 时只 add 自己的文件照常提交；构建不过先修复再提交，修不完先提交草稿并在 message 注明 `WIP:`。
- **worktree 清理联动**：删 worktree 前确认其分支无未提交成果（§9.2"成果及时 commit"）；删分支用 `git branch -d`（让 git 校验已合并）。
- **修改本文件（AGENTS.md）后**：先按文件头部规则复查字符数 ≤ 24,000，超限继续精简，然后再自动提交。

- **日常**：工作树干净、`ahead N` 时 `git push origin main`。
- **CI 发布流水线**（`.github/workflows/release.yml`，仅手动 workflow_dispatch；push main 不触发构建）：prepare-release（删旧 tag/Release 重建）→ desktop 三平台矩阵（NSIS / AppImage+deb / dmg）∥ android ∥ ios → publish-notes；**Release 恒为 `v0.1.0-rc.1`**（prerelease），资产同名覆盖，Notes 由 publish-notes 固定模板生成；iOS `npx tauri ios build --target aarch64-sim|aarch64`，.app 打 zip 走 artifact `ios-build`（无签名，正式 IPA 需配证书 secrets）；Android unsigned APK 挂 Release，配 `ANDROID_KEYSTORE_*` 四个 secrets 后自动签名。

### 9.1 Git 历史重写（去 Claude co-author）

- 提交里**不出现任何 Claude co-author**；全局 `includeCoAuthoredBy: false` 只对新会话生效，当次会话手动 trailer 需事后重写：`git filter-repo --force --message-callback <回调文件>`。回调文件内容（参数名必须是 `message`）：
  ```python
  message = message.replace(b"\r\n", b"\n")
  out = [l for l in message.split(b"\n") if not (l.lower().startswith(b"co-authored-by:") and b"anthropic.com" in l.lower())]
  while out and out[-1].strip() == b"": out.pop()
  return b"\n".join(out) + b"\n"
  ```
- **Windows 坑**：bash heredoc 传回调会被转义吃掉 → 用 python 二进制写文件、`--message-callback` 传 Windows 路径；失败会 fast-import 中途崩但 repo 完好，可直接重试。
- filter-repo 前置：stash 全部改动、移除所有 worktree 注册（Windows 目录可能删不掉，注册移除即可）；完成后 `git remote add origin …`（会被删）、force-push 所有分支、重建 worktree、pop stash。
- **worktree 空目录 ≠ 代码丢失**：分支引用都在，`git worktree add <路径> <分支>` 一条命令恢复。

### 9.2 Worktree 使用惯例

- 并行开发用 `.claude/worktrees/<name>`，每个 worktree 对应一个 `claude/*` 分支；**成果及时 commit**——未提交的草稿在 worktree 目录删除时无法找回。
- 每个 worktree 用独立数据根（见 §2.2）；共享数据只用启动器 `--root <绝对路径>` 显式覆盖。
- 合并顺序参考（2026-08-22）：sleepy-bartik（RC8+chatgraph）→ jovial → main；冲突多为 import 行与文档章节，取两边并集。

---

## 10. 当前状态快照（2026-08-28）

- **main 已包含**：三平台桌面 CI + Android APK + iOS 编译、跨平台 sidecar/壳/前端路径统一、chatgraph 重设计（heuristic）、科研团队审批管线、RC8 批次；验证基线 `npm run verify` 全绿（544+11 测试）。
- **移动端形态**：占位壳（DSH 后端依赖 Node 运行时）；待办：iOS 正式签名分发（需 Apple 证书 secrets）、Android 签名 secrets 可选配。
- **`claude/dev` 分支**：轨迹条长模式「按耗时/按回合」（254f197）、自动 Git 管理与字符上限规则（b39cab6）。

---

*最后更新：2026-08-28（文件头新增硬性规则：本文件上限 24,000 字符，每次修改后必须复查字符数，超限须继续精简；全文精简压缩至限额内；§9.0 自动 Git 管理；worktree 数据根隔离与并行验收约定不变）*
