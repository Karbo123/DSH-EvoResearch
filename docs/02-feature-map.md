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
| Expert 专家邀请（active_teams 随 run 注入） | `experts.ts` + /expert 命令 + host/index.ts run 注入 | ✅ |
| **多智能体团队（6 子代理）** | `teams.ts`：planner/research/code/debug/data_analysis/writing 角色预设（中文 system prompt；§22.1 复查补强：planner PLAN/REFLECTION 双模式、research 搜索次数上限 + 不伪造来源、data_analysis 效应量/不确定性/不编造数字、writing 论文级报告 + TODO 占位、artifacts/ 与 experiment_log.md 产物约定），`/expert invite <id>` 内置可邀 | ✅ |

## E. 定时任务

| 功能 | 本实现 | 状态 |
|---|---|---|
| cron 定时任务（5 字段，自研解析） | `scheduler.ts` + `core/cron.ts` | ✅ |
| 任务结果直达结果 thread | lastResultThreadId + 打开结果按钮 | ✅ |
| Report to main chat（回送主对话） | schedulerReport 读取结果会话事件 → 回送当前主对话 | ✅ |
| 自然语言创建任务 | `SchedulerService.addNatural()` 中文自然语言解析为 cron | ✅ |

## F. 多通道

| 通道 | 本实现 | 状态 |
|---|---|---|
| Telegram | 长轮询 Bot API（fetch，零依赖） | ✅ |
| Slack | 配置 HTTP inbox/send bridge | ✅（需配置端点） |
| QQ | 配置 HTTP inbox/send bridge | ✅（需配置端点） |
| 微信 | 配置 HTTP inbox/send bridge | ✅（需配置端点） |
| 飞书 | 配置 HTTP inbox/send bridge | ✅（需配置端点） |
| Signal | 配置 HTTP inbox/send bridge | ✅（需配置端点） |

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
| MCP 管理 | `host/mcp/supervisor.ts`：stdio/HTTP/Streamable HTTP 生命周期、过滤和局部降级 | ✅（需配置服务器） |

## H. 桌面端

| 功能 | 本实现 | 状态 |
|---|---|---|
| 单文件桌面应用 | Tauri 2 + Node sidecar（desktop/）—— **安装包实测 53.0MB**（53,009,147 bytes，NSIS/LZMA） | ✅ |
| 无边框自绘标题栏/窗口控制 | `decorations: false` + 36px 自绘标题栏（最小化/最大化/关闭、拖拽、双击最大化） | ✅ |
| 最小打包体积 | 53.0MB 实测（Node 24 LTS + WebView2 复用 + provider SDK/prebuilds 裁剪，仍低于 60MB 目标） | ✅ |
| sidecar 协作协议 | DSH_HOME 隔离布局 + 端口文件协议 + 防孤儿进程；**裁剪产物完整 boot 验证通过** | ✅ |
| web 模式（无 GUI 服务器模式） | DSH 原生 web profile | ✅（平台） |

## I. 运维

| 功能 | 本实现 | 状态 |
|---|---|---|
| start/stop/status/update 管理 | DSH 平台（dsh CLI / profiles）替代；update 流水线 🔲 | 🟡 |
| 启动懒加载 + 数据库索引 | node:sqlite WAL + 覆盖索引（idx_*） | ✅ |
| WSL/运行稳定性 | 本项目仅 Windows（文档注明） | ✅ |

## J. 按能力域分组的状态（MIG-05）

> 本节状态图例（区别于文首图例）：✅ **已完成/可用**（实现完成并有测试/冒烟佐证）｜🟡 **外部条件**（依赖用户配置或第三方服务）｜🔲 **未开始**。
> 分组与编号对应统一功能验收项；外部条件只表示需要用户提供凭据或本地工具，不表示代码缺失。

### J.1 MEM 完整对话原文（§15.2，MEM-01..10）

| 能力 | 现状 | 状态 |
|---|---|---|
| 统一 session-text 还原（user/assistant/chunk/结构化块）、assistantText 可靠汇总、中断 partialNote、工具按序入档（>64KB 落盘 archives/）、archiveTurn 幂等、启动对账补回、rebuildFtsIndexes（MEM-01..09） | `session-text.ts` + `memory/{store,recovery,index}.ts`，memory-text.test.ts 17 用例全过 | ✅ |
| 五类轮次单测（正常/多 step/工具/停止/失败，MEM-10） | memory-text.test.ts 覆盖 | ✅ |

### J.2 RET 精细历史搜索与回读（§15.3，RET-01..10）

| 能力 | 现状 | 状态 |
|---|---|---|
| 轮次级全文检索 + 读取工具（search_research_history / read_research_turn） | `retrieval.ts` + `tools.ts` | ✅ |
| 片段级索引（v6 migration：turn_fragments + FTS 镜像 + 断点进度）、buildTurnFragments 重灌、find_in_conversation / read_conversation_range（RET-01..08） | `memory/{store,backfill,read,tools}.ts`；片段索引可断点回填和定位原文 | ✅ |
| FTS 不可用降级、长聊天回归语料与 E2E（RET-09..10） | `retrieval.ts` LIKE 回退 + `verify-acceptance.mjs` 固定长聊天夹具 | ✅ |

### J.3 NOTE 自由文本研究笔记（§15.4，NOTE-01..09）

| 能力 | 现状 | 状态 |
|---|---|---|
| 零 frontmatter 笔记（memories/notes/）、旧 Observation 兼容（frontmatter 解析且字节级保留/默认折叠）、简化创建、段落级索引（.notes-index.json 可删除重建 + mtime 增量自愈）、文件编辑优先、两段式草稿冲突检测、profile 背景资料（NOTE-01..09） | `notes.ts` NotesService + ResearchNotesPanel；单测与验收均覆盖 | ✅ |

### J.4 GRAPH 研究者操纵的 Chat Graph（§15.5，GRAPH-01..12）

| 能力 | 现状 | 状态 |
|---|---|---|
| context 一次性 fork 原子化（graphInherit）、memory 持续参考注入、global 跨项目共享、旧递归 graphContextText 已删、语义单测（GRAPH-01..03） | `chat-graph.ts` + graph-semantics.test.ts 38/38 | ✅ |
| 文件/PDF/代码/目录引用节点 + previewOf 实时预览、convertToNote、neighborChatText 多聊天汇合、连线自然语言说明（context 边禁 label）、删除不删资料、前端分出新方向/搜索框（GRAPH-04..10、12） | t11 完成，前端 E2E 脚本（verify-graph*）存在 | ✅ |
| 大型图节点搜索/分支折叠/邻域视图、检查器、XYFlow 缩略图和窄屏列表（GRAPH-11 / CG-CANVAS-04..10） | `client/chatgraph.ts` + `client/chatgraph-canvas.ts` + `client/chatgraph-layout-worker.ts` + `styles.ts`；ELK Worker 已接入 | ✅ |

### J.5 CTX ContextAssembler 与上下文窗口保护（§15.6，CTX-01..19）

| 能力 | 现状 | 状态 |
|---|---|---|
| assembler 按 session+问题组装（快速路径同步 + 深入路径异步降级）、Graph 加权不屏蔽、token 预算、Markdown 渲染含定位、白黑名单预览、EffectSignal、会话作用域无 lastActiveSessionId（CTX-01..12） | `context/{assembler,search,render}.ts`，context-assembler.test.ts 23 用例 | ✅ |
| 窗口压力检测 + 四类压缩 + 工具结果裁剪归档 + compaction 事件 + tool-history repair + 来源查询（CTX-13..19） | `context/window.ts` 全套，context-window.test.ts 39 用例 | ✅ |
| 与记忆包/Graph 的运行时接线（窗口-组装器协同） | `context/index.ts` 与 Host API 装配；缺失 DSH compaction 时保留手动入口和原文回读 | ✅ |

### J.6 EXP 实验工作区与原始材料（§15.7，EXP-01..14）

| 能力 | 现状 | 状态 |
|---|---|---|
| 旧 manifest/branch/phase/checkpoint/snapshot 兼容读取（EXP-01） | `experiments.ts`（t6 核对 + t12 rollback confirm） | ✅ |
| experiment-workspace（自由实验目录 + LAB_NOTE.md + 导入引用优先）、experiment-process（运行账本/日志流式/停止/重启恢复/复盘草稿/GraphRef）、appendNote/artifacts（EXP-02..12） | `experiment-workspace.ts` + `experiment-process.ts`（t6/t12），36 用例 | ✅ |
| worktree 优先分支、成功/失败/中断/重启/导入 E2E（EXP-13..14） | `verify-domain-e2e.mjs` 逐项覆盖 | ✅ |

### J.7 ENV Git worktree 与 Python 环境（§15.8，ENV-01..08）

| 能力 | 现状 | 状态 |
|---|---|---|
| 项目级 UV 虚拟环境（每项目独立 .venv） | `env.ts` ProjectEnvService | ✅ |
| worktrees.ts 安全创建/列出/移除、共享环境指纹与复用、依赖变化派生环境、legacy .venv 保留（ENV-01..08） | `worktrees.ts` + `project-env.ts`；双 worktree 隔离与复用测试 | ✅ |

### J.8 LIB 文献资料（§15.9，LIB-01..09）

| 能力 | 现状 | 状态 |
|---|---|---|
| library.db 镜像（原文保留）、PDF 全文按页索引 + getTextRange 原文定位、pdf-parse 缺失降级、精读笔记、references 标题保留、BibTeX 导入/生成（v2 迁移）、多源检索、Graph 引用（LIB-01..09） | `library/{store,indexer,search,index,bibtex}.ts`（t7/t14），library-write.test.ts 20 用例 | ✅ |

### J.9 WRITE LaTeX 论文写作（§15.10，WRITE-01..09）

| 能力 | 现状 | 状态 |
|---|---|---|
| manuscript.ts：稿件骨架 CRUD、编译 + 错误解析跳转、缺工具提示、写作上下文优先 Graph、quoteCheck 核对入口、diffDraft 过期提示（WRITE-01..08） | `manuscript.ts`（t14） | ✅ |
| “实验运行中继续写作”与“结果完成后核对数字”E2E（WRITE-09） | `verify-domain-e2e.mjs` 覆盖编辑、差异提示、原始数字核对和编译降级 | ✅ |

### J.10 EVO 自进化与 Skill（§15.11，EVO-01..10）

| 能力 | 现状 | 状态 |
|---|---|---|
| 自然信号 JSONL 收集 + 弱点聚合 Markdown、组件版本号 + unifiedDiff + disposer 回滚、失败样本隔离评估、AutoSkills 无固定门槛/草稿可编辑/runSkill 接 DSH skills（EVO-01..10） | `evolution/{signals,registry,evaluator}.ts` + `autoskills.ts`（t15），evolution.test.ts 22 用例 | ✅ |

### J.11 PLAT DSH 与 EvoScientist 平台能力（§15.12，PLAT-01..21）

| 能力 | 现状 | 状态 |
|---|---|---|
| 能力矩阵（15 项：8 available/4 partial/3 missing + 运行时探测）+ 7 个降级适配器（PLAT-01/02） | `platform/{capabilities,adapters}.ts`（t8） | ✅ |
| 压缩/工具裁剪接入、session query、Skill 注册表、MCP supervisor、adaptive tool selector、子代理 provider、降级测试（PLAT-03..21） | `context/`、`platform/`、`mcp/`、`skills/`；`verify-domain-e2e.mjs` 覆盖失败隔离 | ✅（外部服务需配置） |

### J.12 SCI 科学自演化编排（§15.13，SCI-01..10）

| 能力 | 现状 | 状态 |
|---|---|---|
| 6 个科研角色预设（planner/research/code/debug/data_analysis/writing）——RA/EA/EMA 映射 | `teams.ts` + `science/roles.ts` | ✅ |
| RA/EA/EMA 高层职责、Ideation/Experimentation Memory、Idea/experiment tree、授权自动循环（SCI-01..10） | `science/{roles,memory,loops,chat-graph-bridge}.ts` + 领域 E2E | ✅ |

### J.13 MIG 迁移、界面与文档收尾（§15.14，MIG-01..08）

| 能力 | 现状 | 状态 |
|---|---|---|
| 迁移只追加 + 轮换备份、索引可重建、旧数据兼容（MIG-01..04） | 数据迁移与兼容测试已覆盖（memory v6） | ✅ |
| 功能地图状态标注（MIG-05） | 本节 | ✅ |
| README 产品定位与特性更新（MIG-06） | README.md（t22 定位 + 本轮特性修订） | ✅ |
| 路径/中文编码/长路径验证 + 桌面/网页模式说明（MIG-07） | `scripts/verify-paths.mjs` 44/44 + 桌面说明 | ✅ |
| 桌面与网页模式的 Windows 长路径、完整 `npm run verify` 与专项 E2E | 真实网页检查和最终验证命令均已通过 | ✅ |

### J.14 新模块落位（对照 t22 预留条目）

| 模块 | 实际路径 | 状态 |
|---|---|---|
| notes | `src/host/notes.ts`（非 notes/ 目录） | ✅ 已实现 |
| experiment-workspace | `src/host/experiment-workspace.ts` | ✅ 已实现 |
| experiment-process | `src/host/experiment-process.ts` | ✅ 已实现 |
| worktrees | `src/host/worktrees.ts` | ✅ 已实现 |
| library | `src/host/library/`（store/indexer/search/index/bibtex/types/tools） | ✅ 已实现 |
| manuscript | `src/host/manuscript.ts`（含 detectLatexEnv） | ✅ 已实现 |
| context | `src/host/context/`（assembler/window/pruner/compaction-log/history-repair/sources/guard/render/search/types/index + overflow-watch） | ✅ 已实现并接线 |
| platform | `src/host/platform/`（capabilities/adapters/tools-selector/subagents/diagnostics/approval-policy） | ✅ 已实现 |
| science | `src/host/science/` | ✅ 已实现 |
| evolution | `src/host/evolution/`（signals/registry/evaluator） | ✅ 已实现 |
| jobs | `src/host/jobs.ts`（P0-3 JobHub） | ✅ 已实现并接线 |
| figures | `src/host/figures.ts`（P2-1 FigureService + 三工具） | ✅ 已实现并接线 |
| tools | `src/host/tools/ask.ts`（P1-3 ask_researcher） | ✅ 已实现并接线 |
| thread-preview | `src/host/thread-preview.ts`（P0-1 会话尾部预览数据层） | ✅ 已实现 |

### NF 新功能批次验收组（RC7/RC8 平台红利 + EvoScientist 借鉴，2026-08）

| 验收项 | 内容 | 状态 |
|---|---|---|
| NF-01 工具结果图片渲染（P0-2） | api.ts `detectToolImageAssets`（workspace 边界校验 ≤6 张 ≤5MB）+ Remote `artifactImageDetect`/`artifactImage`；chat.ts 缩略图网格（懒加载 base64、失败重试、点击放大） | ✅ |
| NF-02 状态栏上下文占用条（P0-4） | session-dock 复用 contextPressure 投影渲染三档配色占用条（≥80% 红 = autoCompactThreshold 对齐），tooltip 估算明细 | ✅ |
| NF-03 后台任务注册表（P0-3） | jobs.ts `JobHubService`（register/complete/fail/markCancelled/cancelBySession/dispose，环形历史 cap 100）；host 四挂接点之一实验进程登记；Remote `jobsList`/`jobsCancel`/`jobsCountForSession` | ✅ |
| NF-04 @会话引用数据层（P0-1 后端） | thread-preview.ts `extractPreview`/`resolveThreadPreview`（live → sessionQuery → 持久化 jsonl 三级降级）；composer 会话候选 UI 依赖此数据层 | ✅ 数据层 |
| NF-05 AutoSkills 定时挖掘（P1-1） | autoskills.ts `mineAllWorkspaces`（观测聚类 + 笔记挖掘，mining 互斥）；host 内置调度任务（默认 `7 3 * * 1`，`evoresearch.autoskillsSchedule` 覆盖/off） | ✅ |
| NF-06 记忆类型化关联边（P1-2） | store 迁移 v7 `observation_links` 表；`setObservationLink`/`listObservationLinks`；supersede 自动写 supersedes 边；link_observations 工具 `edge_type` 枚举；Remote `memoryObservationEdges`；Knowledge 卡片徽标按边类型着色（互补=青 / 矛盾=橙红 / 取代=灰删除线） | ✅ |
| NF-07 ask_researcher 工具（P1-3） | tools/ask.ts 适配平台 ctx.userQuestions（超时降级文本提问，无人值守不卡死）；问题卡 UI 复用官方 pending question 帧 | ✅ |
| NF-08 超限自动映射重试（P1-4） | context/overflow-watch.ts：turn/end 错误特征识别（9 条中英文）→ guard.overflowRetry 一次，冷却 + 同 turn 去重 + compaction 缺失降级告警 | ✅ |
| NF-09 论文图片工作流后端（P2-1） | figures.ts `FigureService`（项目 venv 渲染 → figures/<id>/v<N>/ 版本历史 manifest+history.jsonl 原子落盘）+ render_figure/list_figures/critique_figure 三工具 + Remote `figuresList`/`figuresGet` + Library 面板「图纸」分区（缩略图网格 + 版本历史） | ✅ |
| NF-10 文献网络检索三工具（P2-2） | library/tools.ts：search_library（本地库）/ search_literature（本地+web_search 合并，未配置明确降级不伪造在线）/ import_literature（50MB 上限 + %PDF 魔数三道闸门防付费墙伪造）；Library 面板「网络检索」入口（Remote `libraryLiteratureWeb`，未配置时明确降级提示） | ✅ |
| NF-11 LaTeX 环境检测（P2-3） | manuscript.ts `detectLatexEnv`（引擎/kpsewhich 宏包抽查/ctex/建议纯函数）；Remote `manuscriptLatexEnv` | ✅ |
| NF-12 斜杠命令图片输入（P2-4） | workspace-api commands-execute 透传 EncodedImageAttachment；chat.ts 带图命令执行（executor 拒绝时降级普通消息原图不丢） | ✅ |
| NF-13 会话删除级联取消（P3-1） | Remote `sessionDeleteCascade`（cancelBySession → 删持久化目录）；客户端 deleteSessionById 改走级联端点并 toast 取消数 | ✅ |
| NF-14 无人值守 shell 门控（P3-2） | approval-policy.ts `decideUnattendedShell`（管道切段逐段 deny-list fail-closed + allow-list 前缀）+ `isUnattendedSource`；运行时接线：unattended-registry.ts 登记 scheduler/channel/science 会话 → host 挂载 `tools.guard`（bash/pwsh 命令执行前判定，拒绝返回原因），配置样例见 docs/03-development.md | ✅ |
| NF-15 继续上次入口（P3-4） | threadlist New Chat 下方「继续上次」按钮：按 titleTime/updatedAt 打开最近活跃主线程 | ✅ |

> P3-3（追问卡折叠保草稿）由官方 ask_user_question 问题卡语义吸收；rc.8 SQLite 存储格式变更的桌面 sidecar 升级注意见 docs/04-desktop.md 与提案书 §4。

## 已知取舍（有意为之）

1. **界面自研而非依赖平台外壳**：自定义工作台（不加载官方 ui-*），host 引擎（会话/模型/工具/审批）完全复用 DSH 平台；
2. **Embedding 第一版不内置本地模型**：FTS5 保底 + 远端 embedding API 接口预留（体积与隐私权衡）；
3. **通道优先 Telegram**：其余通道通过配置的 HTTP inbox/send bridge 接入，未配置时明确离线；
4. **Raw Turn Archive/启动对账**：依赖 DSH 会话事件日志的原始保留，插件层归档按需实现；
5. **外部平台条件**：Embedding、模型、MCP、消息通道和 LaTeX 由配置提供；代码有真实适配器、局部降级和原文回读，不在无凭据环境中伪造在线状态。

## 验证记录

- ✅ `npm run verify`：双配置构建 + 插件/App 425/425 单元测试 + 领域 E2E 27/27 + ACCEPT 19/19（43 assertions）+
  XYFlow/ELK 6/6 + client bundle 模拟加载 + 文档完整性校验；
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
