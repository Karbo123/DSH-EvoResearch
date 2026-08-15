# 02 · 功能地图（能力清单、设计与状态）

> 状态：✅ 已实现（可编译/可运行）｜🟡 骨架/接口预留 ｜🔲 规划中。

## A. 科研项目工作区

| 功能 | 本实现 | 状态 |
|---|---|---|
| projects/<name>/.evoresearch-data 项目数据隔离 | `workspace.ts` + `core/paths.ts`（projectDataDir/projectMemoriesDir） | ✅ |
| 工作区边界校验（部署根或 projects/<n>） | `validateWorkspace`（normcase 比较） | ✅ |
| git init + .evoresearch-data git exclude | `prepareProjectGit` / `writeGitExclude` | ✅ |
| 导入项目文件夹（隐藏临时目录 + 原子改名 + 跳过可重建目录） | `importProject`（SKIP_DIRS） | ✅ |
| 新建项目（§5.4：目录 + git init + README + exclude） | `createProject` + projects-create 端点 + Workspace 面板表单 | ✅ |
| New Chat 自动创建项目（AI slug ≤20 + 确定性回退 + 碰撞后缀） | `autoCreateProject`（LLM + slugify） | ✅ |
| 项目列表 / 创建（/project 命令 + Remote API） | `commands.ts` + `api.ts` | ✅ |
| 按项目切换记忆与会话（workspace_dir 路由） | session header cwd + `storeFor(workspaceDir)` | ✅ |

## B. 科研记忆

| 功能 | 本实现 | 状态 |
|---|---|---|
| Turn Catalog（research_turns + FTS5） | `store.ts` createPendingTurn/updateTurn/listTurns | ✅ |
| 七类多标签分类（LLM JSON + 严格校验 + 确定性回退） | `classifier.ts` classifyRequest/classifyDeterministic | ✅ |
| topic 归一化（词面/包含匹配复用，E5 向量 ≥0.82 语义匹配） | `canonicalizeTopicKeys`（词面 ✅，向量接口 🟡） | 🟡 |
| 每轮记忆包（<research_memory_packet>，6000 token 预算） | `packet.ts` + systemPrompt.context 注入 | ✅ |
| category_catalog 七类一行目录 | `renderPacketText` | ✅ |
| 每类 1 最佳 state + 同类别高分补充 | `buildMemoryPacket`（STATES_PER_CATEGORY=3） | ✅ |
| RRF 融合 FTS5 + E5 向量，类别加权不硬过滤 | `retrieval.ts` fuseRrf + CATEGORY_WEIGHT | ✅（向量 🟡） |
| Observation 增强（frontmatter + create/update/supersede/noop） | `store.ts` writeObservation/supersede + `tools.ts` | ✅ |
| Observation 关联（link_observations 双向 + 去重） | `store.ts` linkObservations（migration v4）+ Knowledge 卡片「关联」徽标 | ✅ |
| 检索默认只出 ACTIVE | `searchObservationsFts` status='active' | ✅ |
| search_research_history / read_research_turn 工具 | `tools.ts` | ✅ |
| backfill 断点续做（source_version 指纹） | `backfill.ts`（幂等 + 进度记录）+ MemoryRuntime 后台接线 | ✅ |
| 缓存观测（hit/miss/token） | 🔲（依赖 provider cost 元数据） | 🔲 |

## C. 记忆生命周期与长程目标

| 功能 | 本实现 | 状态 |
|---|---|---|
| Turn interrupted 状态 + turn_attempts | `store.ts`（status/interrupted、recordAttempt） | ✅ |
| 中断原因（user_stop / api_failure）+ Partial Turn Note | `updateTurn`（interruptReason/partialNote） | ✅ |
| turn_continuation_messages 幂等映射 | `linkContinuation` / `findTurnByContinuation` | ✅ |
| Raw Turn Archive（原始消息永不清除） | `turn_segments` 表 + archiveTurn + turn/end 自动归档 | ✅ |
| 工具收据（started → completed/unknown） | `recordToolStarted/Completed` + **session/event 钩子接入**（tool/call → tool/result） | ✅ |
| 启动对账（quick_check/轮换备份/悬挂清理/补归档） | `recovery.ts` + storeFor 首次接线 | ✅ |
| Goal Control：长程检测 → 合同 → slice → 四轴判定 | `goals.ts`（全部核心逻辑） | ✅ |
| propose_goal_contract_update 提案 → 用户确认 → version | `goals.ts`（proposal 存储/接受合并 changes 生成新版本）+ `tools.ts`（只建待确认提案）+ Goals 面板接受/拒绝 | ✅ |
| Active Goal Projection / Turn Envelope 注入 | `renderGoalProjection`（systemPrompt.context 注入）+ judgeProgress | ✅ |
| Goal Contract 展开审阅（目标/成功标准/约束/版本） | Goals 面板行展开（aria-expanded + 证据徽标） | ✅ |
| 有限重试（首 chunk 前一次） | DSH `llm-retry` 已有 | ✅（平台） |

## D. AutoSkills / 专家团队

| 功能 | 本实现 | 状态 |
|---|---|---|
| 观测聚类 → 技能提案（§42.7：簇 ≥3 且 ≥2 procedural + cluster hash 去重） | `autoskills.ts` generateFromObservations | ✅ |
| 提案审核界面（生成按钮 + 状态 tab + approve/reject/run） | 工作台「技能提案」面板 | ✅ |
| 批准写入 SKILL.md（frontmatter 规范）+ manifest.json（§42.8） | approve 写 skills/<name>/ + 安装路径记录 | ✅ |
| Auto 模式自动安装（mode=auto 生成即批准） | generateFromObservations + saveConfig | ✅ |
| Expert 专家邀请（active_teams 随 run 注入） | `experts.ts` + /expert 命令 | ✅（随 run 注入接线 🟡） |
| **多智能体团队（6 子代理）** | `teams.ts`：planner/research/code/debug/data_analysis/writing 角色预设（中文 system prompt；§22.1 复查补强：planner PLAN/REFLECTION 双模式、research 搜索次数上限 + 不伪造来源、data_analysis 效应量/不确定性/不编造数字、writing 论文级报告 + TODO 占位、artifacts/ 与 experiment_log.md 产物约定），`/expert invite <id>` 内置可邀 | ✅ |

## E. 定时任务

| 功能 | 本实现 | 状态 |
|---|---|---|
| cron 定时任务（5 字段，自研解析） | `scheduler.ts` + `core/cron.ts` | ✅ |
| 任务结果直达结果 thread | lastResultThreadId + 打开结果按钮 | ✅ |
| Report to main chat（回送主对话） | schedulerReport 读取结果会话事件 → 回送当前主对话 | ✅ |
| 自然语言创建任务 | 🔲（LLM 解析 cron） | 🔲 |

## F. 多通道

| 通道 | 本实现 | 状态 |
|---|---|---|
| Telegram | 长轮询 Bot API（fetch，零依赖） | ✅ |
| Slack | 骨架（PendingAdapter） | 🔲 |
| QQ | 骨架 | 🔲 |
| 微信 | 骨架 | 🔲 |
| 飞书 | 骨架 | 🔲 |
| Signal | 骨架 | 🔲 |

## G. 自定义工作台界面

| 功能 | 本实现（DSH 平台能力 vs 插件新增） | 状态 |
|---|---|---|
| 自定义浏览器表面（不加载官方 ui-* 外壳） | `@evoresearch/dsh-app` bundle：root slot + layout 服务自给自足 | ✅ |
| 真实多轮对话（消息管线/流式/发送） | conversation Definition（官方语义）+ Session.prompt + 快照订阅 | ✅ |
| 会话历史侧栏 / 新建会话 | ThreadList（useSessions）+ sessions.create/open | ✅ |
| 三栏工作台（会话 / 聊天 / 检查器，可拖拽） | evo-app 布局 + resizable 手柄（宽度记忆） | ✅ |
| 浅/深双主题（暖色纸面 + 青色品牌） | 主题 token + html.dark + 跟随系统/手动切换 | ✅ |
| 桌面版无边框自绘标题栏 | `?desktop=1` 模式：36px 标题栏 + 窗口控制命令 | ✅ |
| 分页历史/加载更早/回到最新 | DSH 会话层 + 消息滚动 | ✅（基础） |
| 斜杠命令执行与补全 | DSH `commands` 原生 + 插件命令注册 | ✅ |
| 会话状态条 / 模型切换 / Fallback | DSH 平台已有（ui-model-selection/llm-retry）；Fallback 管理 UI 因官方 rc.6 无 API 未做 | ✅（平台） |
| 中英双语（默认中文，~150 处 UI 字符串 i18n） | 工作台 i18n（readLang 默认 zh）+ 全面本地化 | ✅ |
| 业务面板（记忆/调度/通道/团队/技能/工作区） | EvoMemory 四 tab / Scheduled Builder / Channels / Team / Skills（提案+市场）/ Workspace（新建+导入） | ✅ |
| 会话行操作（重命名/置顶/标签色/导出/归档/删除） | ThreadList（localStorage 持久化 + 两段式确认 + 已归档分区） | ✅ |
| JSON 完整诊断导出（reasoning + 工具调用/结果） | session-export（§41.8） | ✅ |
| MCP 管理 | 官方 rc.6 配置驱动（cordis.yml mcp-client 行，无运行时管理 API）——维持配置驱动 | 🟡（平台） |

## H. 桌面端

| 功能 | 本实现 | 状态 |
|---|---|---|
| 单文件桌面应用 | Tauri 2 + Node sidecar（desktop/）—— **安装包实测 ~45MB**（NSIS/LZMA） | ✅ |
| 无边框自绘标题栏/窗口控制 | `decorations: false` + 36px 自绘标题栏（最小化/最大化/关闭、拖拽、双击最大化） | ✅ |
| 最小打包体积 | ~45MB 实测（Node 24 LTS + WebView2 复用 + provider SDK/prebuilds 裁剪） | ✅ |
| sidecar 协作协议 | DSH_HOME 隔离布局 + 端口文件协议 + 防孤儿进程；**裁剪产物完整 boot 验证通过** | ✅ |
| web 模式（无 GUI 服务器模式） | DSH 原生 web profile | ✅（平台） |

## I. 运维

| 功能 | 本实现 | 状态 |
|---|---|---|
| start/stop/status/update 管理 | DSH 平台（dsh CLI / profiles）替代；update 流水线 🔲 | 🟡 |
| 启动懒加载 + 数据库索引 | node:sqlite WAL + 覆盖索引（idx_*） | ✅ |
| WSL/运行稳定性 | 本项目仅 Windows（文档注明） | ✅ |

## 已知取舍（有意为之）

1. **界面自研而非依赖平台外壳**：自定义工作台（不加载官方 ui-*），host 引擎（会话/模型/工具/审批）完全复用 DSH 平台；
2. **Embedding 第一版不内置本地模型**：FTS5 保底 + 远端 embedding API 接口预留（体积与隐私权衡）；
3. **通道优先 Telegram**：其余通道骨架化（协议文档齐全后按同一接口补齐）；
4. **Raw Turn Archive/启动对账**：依赖 DSH 会话事件日志的原始保留，插件层归档按需实现；
5. **官方 rc.6 无运行时 API 的三项保持平台受限**：Fallback chain 管理（dsh-llm-retry 内部处理）、code_interpreter（host shell 工具等价提供；dsh-code-runtime 为 TS 运行时非 Python REPL）、MCP 管理（配置驱动 cordis.yml）。

## 验证记录

- ✅ `npm run verify`：tsc 双配置构建 + 70 个单元测试 + client bundle 模拟加载校验 + 文档完整性校验；
- ✅ 挂载组合：示例 profile `--dump-config` 确认三个 bundle 行合并、包可解析；
- ✅ 真实运行：`dsh --profile evoresearch --port 3210` 启动成功，host 插件激活
  （`[evoresearch] host 插件激活` / `evoresearch: http://127.0.0.1:PORT`）；
- ✅ 浏览器链路：`window.__DSH_BOOT__` 图包含 `@evoresearch/dsh-app`，
  `/plugins/@evoresearch/dsh-app/client.js` 以 ModuleLoader factory 格式正确 serve（200）；
- ✅ 端到端对话：新建会话 → 发送消息 → 真实模型回复流式渲染（CDP 自动交互 + 视觉检查确认）；
- ✅ 桌面版：无边框窗口 + 自绘标题栏（PrintWindow 截图 + 视觉检查确认）；
- ✅ 深度回归（scripts/verify-*.mjs，CDP headless，21 项）：l10n/smoke/identity/knowledge/memory-history/
  marketplace/runnow/schedule-builder/round21/toast/md/fs-upload2/responsive/a11y/urlstate/steer-stop/
  autoskills-config/archive/export-json/project-create/goal-detail 全部通过；
- ✅ 真实 exe（WebView2 远程调试）：标题栏结构 + 点击关闭进程退出（verify-titlebar.mjs）。

### 开发中修复的关键问题（对插件开发者有普适参考价值）

| 问题 | 根因 | 修复 |
|---|---|---|
| boot 失败 `window is not defined` | client 行 name 指向浏览器 bundle（window 包装）被 host loader import | client 行指向包根导出（node half：空 apply），浏览器 half 走 `exports["./client"]` |
| `web boot: 1 entry did not activate`（pending） | `dsh.client.inject` 误用服务名而非加载拓扑包名 | inject 声明加载拓扑包名（官方 ui-* 模式） |
| 同一包双行 host 侧 apply 冲突 | app-runtime 行与 UI 行都指向包根（真实 apply） | 包根空 apply + 子路径行（`./runtime`） |
| 官方 modules client 内联崩溃 | 发布形态是 ModuleLoader 包装，内核静态 import 需源码形态 | vendored 官方源码 + 构建 alias（与官方 vite 同构） |
| esbuild 裸 `sqlite` 导入 | tsup 代码分割绕过 external，`node:sqlite` 前缀被剥离 | 改用 tsc 直出（与 DSH 生态包一致） |
| client bundle 无法被浏览器加载 | tsc ESM 输出不符合 ModuleLoader factory 格式 | `scripts/build-client.mjs`：esbuild → CJS → 包 `window.__ModuleLoader__.load({id, factory})` |
