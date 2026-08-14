# 02 · 功能映射表（EvoScientist → 本实现）

> 依据 D:\EvoScientist\DESC-difference.md 与 README「本地 fork 改动」清单逐条映射。
> 状态：✅ 已实现（可编译/可运行）｜🟡 骨架/接口预留 ｜🔲 规划中。

## A. 科研项目工作区（主1-2、35-36、39-42）

| EvoScientist 功能 | 本实现 | 状态 |
|---|---|---|
| projects/<name>/.evosci-data 项目数据隔离 | `workspace.ts` + `core/paths.ts`（projectDataDir/projectMemoriesDir） | ✅ |
| WebUI 工作区边界校验（部署根或 projects/<n>） | `validateWorkspace`（normcase 比较） | ✅ |
| git init + .evosci-data git exclude | `prepareProjectGit` / `writeGitExclude` | ✅ |
| 导入项目文件夹（隐藏临时目录 + 原子改名 + 跳过可重建目录） | `importProject`（SKIP_DIRS） | ✅ |
| New Chat 自动创建项目（AI slug ≤20 + 确定性回退 + 碰撞后缀） | `autoCreateProject`（LLM + slugify） | ✅ |
| 项目列表 / 创建（/project 命令 + Remote API） | `commands.ts` + `api.ts` | ✅ |
| 按项目切换记忆与会话（workspace_dir 路由） | session header cwd + `storeFor(workspaceDir)` | ✅ |

## B. EvoMemory v2（主37、W31）

| EvoScientist 功能 | 本实现 | 状态 |
|---|---|---|
| Turn Catalog（research_turns + FTS5） | `store.ts` createPendingTurn/updateTurn/listTurns | ✅ |
| 七类多标签分类（LLM JSON + 严格校验 + 确定性回退） | `classifier.ts` classifyRequest/classifyDeterministic | ✅ |
| topic 归一化（词面/包含匹配复用，E5 向量 ≥0.82 语义匹配） | `canonicalizeTopicKeys`（词面 ✅，向量接口 🟡） | 🟡 |
| 每轮记忆包（<research_memory_packet>，6000 token 预算） | `packet.ts` + systemPrompt.context 注入 | ✅ |
| category_catalog 七类一行目录 | `renderPacketText` | ✅ |
| 每类 1 最佳 state + 同类别高分补充 | `buildMemoryPacket`（STATES_PER_CATEGORY=3） | ✅ |
| RRF 融合 FTS5 + E5 向量，类别加权不硬过滤 | `retrieval.ts` fuseRrf + CATEGORY_WEIGHT | ✅（向量 🟡） |
| Observation 增强（frontmatter + create/update/supersede/noop） | `store.ts` writeObservation/supersede + `tools.ts` | ✅ |
| 检索默认只出 ACTIVE | `searchObservationsFts` status='active' | ✅ |
| search_research_history / read_research_turn 工具 | `tools.ts` | ✅ |
| 记忆包注入记录（record_retrieval） | packet 缓存（packets Map） | 🟡 |
| backfill 断点续做（source_version 指纹） | `research_index_progress` 表 + get/setIndexProgress | 🟡（后台回填 🔲） |
| 缓存观测（hit/miss/token） | 🔲（依赖 provider cost 元数据） | 🔲 |

## C. EvoMemory v3（主38、W32）

| EvoScientist 功能 | 本实现 | 状态 |
|---|---|---|
| Turn interrupted 状态 + turn_attempts | `store.ts`（status/interrupted、recordAttempt） | ✅ |
| 中断原因（user_stop / api_failure）+ Partial Turn Note | `updateTurn`（interruptReason/partialNote） | ✅ |
| turn_continuation_messages 幂等映射 | `linkContinuation` / `findTurnByContinuation` | ✅ |
| Raw Turn Archive（原始消息永不清除） | 🔲（turn_segments 分页归档） | 🔲 |
| 工具收据（started → completed/unknown） | `recordToolStarted` / `recordToolCompleted` / `listUnknownTools` | ✅（钩子接入 🟡） |
| 启动对账（quick_check/轮换备份/悬挂清理） | 🔲 | 🔲 |
| Goal Control：长程检测 → 合同 → slice → 四轴判定 | `goals.ts`（全部核心逻辑） | ✅ |
| propose_goal_contract_update 提案 → 用户确认 → version | `appendGoalEvent` + 提案事件（确认流 🔲） | 🟡 |
| Active Goal Projection / Turn Envelope 注入 | `renderGoalProjection`（注入接线 🟡） | 🟡 |
| 有限重试（首 chunk 前一次） | DSH `llm-retry` 已有 | ✅（平台） |

## D. AutoSkills / 专家（主16、17）

| EvoScientist 功能 | 本实现 | 状态 |
|---|---|---|
| 观测聚类 → 技能提案（approve/reject/run） | `autoskills.ts` | ✅ |
| 提案审核 UI（WebUI 面板） | client 科研面板「技能提案」tab | ✅ |
| 批准写入技能目录（可被 dsh-skill 挂载） | SKILL.md 写入 | ✅（真实挂载 🔲） |
| Expert 专家邀请（active_teams 随 run 注入） | `experts.ts` + /expert 命令 | ✅（随 run 注入接线 🟡） |

## E. 定时任务（主29）

| EvoScientist 功能 | 本实现 | 状态 |
|---|---|---|
| cron 定时任务（5 字段，自研解析） | `scheduler.ts` + `core/cron.ts` | ✅ |
| 任务结果直达结果 thread | lastResultThreadId | ✅ |
| Report to main chat（回送主对话） | 🔲（client 侧对接 sendMessage） | 🔲 |
| 自然语言创建任务 | 🔲（LLM 解析 cron） | 🔲 |

## F. 多通道（README Features: Multi-Channel）

| 通道 | 本实现 | 状态 |
|---|---|---|
| Telegram | 长轮询 Bot API（fetch，零依赖） | ✅ |
| Slack | 骨架（PendingAdapter） | 🔲 |
| QQ | 骨架 | 🔲 |
| 微信 | 骨架 | 🔲 |
| 飞书 | 骨架 | 🔲 |
| Signal | 骨架 | 🔲 |

## G. WebUI 交互增强（主5-33、W1-W37）

| EvoScientist 功能 | 本实现（DSH Web GUI 平台已有 vs 插件新增） | 状态 |
|---|---|---|
| 分页历史/加载更早/回到最新 | DSH 会话层 + sessionQuery（插件 API 封装 🟡） | 🟡 |
| 斜杠命令执行与补全 | DSH `commands` 原生（ui-commands）✅ + 插件命令注册 ✅ | ✅ |
| @文件引用 / 输入历史 / 快捷键 | DSH 平台已有（ui-input-trigger 等） | ✅（平台） |
| 会话状态条 / 模型切换 / Fallback | DSH 平台已有（ui-conversation/ui-model-selection/llm-retry） | ✅（平台） |
| MCP / Channel 管理 | DSH mcp-client ✅；Channel 管理走 /channel 命令 + 科研面板 | 🟡 |
| AutoSkills 面板 / Research History / Goal 面板 | 科研面板（第一版 5 tab）；Research History/Goal diff UI 🔲 | 🟡 |
| Thread 标签/颜色/归档/筛选 | DSH 会话元数据（🔲 插件增强） | 🔲 |
| Markdown 导出 / 换行保留 | DSH 平台（CodeBlock/Markdown 渲染） | ✅（平台） |
| 浏览器通知 | DSH 平台（🔲 确认） | 🔲 |
| 中英双语 | DSH client-locale 平台 ✅ + 插件文案（🟡 i18n 接入） | 🟡 |
| 危险模式 Badge / Auto-approve 确认 | DSH permissionPresets 平台 ✅ | ✅（平台） |

## H. 桌面端（主4）

| EvoScientist 功能 | 本实现 | 状态 |
|---|---|---|
| 单文件桌面应用 | Tauri 2 + Node sidecar（desktop/）—— **安装包实测 44MB**（NSIS/LZMA） | ✅ |
| 无边框标题栏/窗口控制 | Tauri 配置（NSIS 中文安装器 + 最小窗口 960×600） | ✅（基础版） |
| 最小打包体积 | 44MB 实测（Node 24 LTS + WebView2 复用 + provider SDK/prebuilds 裁剪） | ✅ |
| sidecar 协作协议 | DSH_HOME 隔离布局 + 端口文件协议 + 防孤儿进程；**裁剪产物完整 boot 验证通过** | ✅ |
| web 模式（无 GUI 服务器模式） | DSH 原生 web profile | ✅（平台） |

## I. 运维（主3）

| EvoScientist 功能 | 本实现 | 状态 |
|---|---|---|
| evosci.sh start/stop/status/update/push | DSH 平台（dsh CLI / profiles）替代；update 流水线 🔲 | 🟡 |
| 启动懒加载 + 数据库索引 | node:sqlite WAL + 覆盖索引（idx_*） | ✅ |
| WSL/运行稳定性 | 本项目仅 Windows（文档注明） | ✅ |

## 已知取舍（相对 EvoScientist 有意为之）

1. **不重写聊天主界面**：复用 DSH Web GUI（会话/输入/审批/工具卡片），仅做科研化扩展——避免两套 UI 割裂；
2. **Embedding 第一版不内置本地模型**：FTS5 保底 + 远端 embedding API 接口预留（体积与隐私权衡）；
3. **通道优先 Telegram**：其余通道骨架化（协议文档齐全后按同一接口补齐）；
4. **v3 的 Raw Turn Archive/启动对账**：依赖 DSH 会话事件日志的原始保留，插件层归档后续按需实现。

## 验证记录（0.1.0-rc.1）

- ✅ `npm run verify`：tsc 双配置构建 + 43 个单元测试 + client bundle 模拟加载校验 + 文档完整性校验；
- ✅ 挂载组合：独立 profile（evosci-smoke）`--dump-config` 确认 evosci-host / evosci-client 行合并、包可解析；
- ✅ 真实运行：`dsh --profile evosci-smoke --port 3210` 启动成功，host 插件与 client node half 均激活
  （`[evosci] host 插件激活` / `[evosci] client node half apply() 已执行`）；
- ✅ 浏览器链路：index.html 的 `window.__DSH_BOOT__` 图包含 `@evoscientist/dsh-plugin`，
  `/plugins/@evoscientist/dsh-plugin/client.js` 以 ModuleLoader factory 格式正确 serve（200）。

### 本轮修复的关键问题（对插件开发者有普适参考价值）

| 问题 | 根因 | 修复 |
|---|---|---|
| boot 失败 `window is not defined` | client 行 name 指向浏览器 bundle（window 包装）被 host loader import | client 行指向包根导出（node half：空 apply），浏览器 half 走 `exports["./client"]` |
| BOOT 图缺插件 | client-modules 在行激活后经 `internal/plugin` 事件重扫（首次扫描时序） | 无需修复（时序正确后自动纳入）；排查手段：node half 加 apply 日志 |
| esbuild 裸 `sqlite` 导入 | tsup 代码分割绕过 external，`node:sqlite` 前缀被剥离 | 改用 tsc 直出（与 DSH 生态包一致） |
| client bundle 无法被浏览器加载 | tsc ESM 输出不符合 ModuleLoader factory 格式 | `scripts/build-client.mjs`：esbuild → CJS → 包 `window.__ModuleLoader__.load({id, factory})`，factory 内自声明 `var module`（与官方 client 包一致） |
