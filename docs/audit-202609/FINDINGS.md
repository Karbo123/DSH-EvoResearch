# EvoResearch 全仓审计报告（2026-09-04）

> 分支：`claude/audit-20260904`（基于 main@721ddc4bc7）。
> 方法：3 个只读探索代理摸底 + 7 个领域审计代理（逐文件 5~7 维度彻查）+ 1 个 Playwright 黑盒 UI 测试代理（146 项检查）+ 主代理多视口视觉走查与人工复核修复。
> 检查清单：[CHECKLIST.md](./CHECKLIST.md)（1023 项）。本文件记录**确认的问题与处置**：✅=本次已修复，📋=已确认、留待后续（附建议）。

---

## 一、已修复（P0）

| # | 位置 | 问题 | 修复 |
|---|------|------|------|
| P0-1 | `plugin host/api.ts` sessionDeleteCascade | **会话删除功能整体失效**：顶层目录名是工作区哈希编码，与 sessionId 比较永不命中，`rmSync` 从不执行；前端永远收到「删除失败」，数据永不删除。两个审计代理独立确证 | 改为两级扫描 `sessions/<编码cwd>/<sessionId>/`（与 rewind.findSessionDir 同构），保留扁平布局兜底；接线 `dropSessionRefs` 清理 slug/置顶残留；改为幂等语义（不存在也返回 ok） |
| P0-2 | `plugin host/rewind.ts` restoreWorkspace | **回溯/编辑重发会删除项目私有数据**：`git clean -fdx` 把 `.evoresearch-data/`（记忆库/笔记/日报）与 `.venv/` 一并无法恢复地删除（都是"未跟踪+忽略"文件，safety commit 不含它们）；文件头注释与语义相反 | 改 `clean -fd`；rewind-safety 提交失败（index.lock 等）从「当无变更继续」改为**抛错中止**回溯；`git.exe` 硬编码改平台感知（POSIX 上此前回溯整体静默失效） |
| P0-3 | `plugin host/jobs.ts` + `api.ts` jobsCancel | **任务假取消**：`markCancelled` 只挪历史不调 `entry.cancel()`，面板显示已取消但实验进程继续跑（与 sessionDeleteCascade 级联路径行为不一致） | 新增 `JobHub.cancel()`：先调注册的 cancel() 真正终止，再走完结流转；jobsCancel 改经此路径 |

## 二、已修复（P1）

| # | 位置 | 问题 | 修复 |
|---|------|------|------|
| P1-1 | `api.ts` dataClear('projects') | **官方数据红线**：删除目标是 `DSH_HOME/sessions`，未经理器启动时 DSH_HOME 回退 `~/.dsh`，可能整删官方 3080 会话 | 执行前校验 `resolveDshHomePath() === dataRoot`，不一致拒绝并提示经启动器重启 |
| P1-2 | `api.ts` graphSync | 记忆节点去重键 `note:<source>:<noteId>` 与 knownRefs 的 `<kind>:<path>` 永不相交，每次同步重复追加节点（图数据损坏） | 去重键与 ref 同构（`note:<file>`/`file:<relpath>`） |
| P1-3 | `host/index.ts` DSH 子代理 provider | `agents.create` 丢弃 `request.prompt`，建出空会话（对照 deliverToAgent 有 initialMessage） | create 后经 followup 投递 prompt |
| P1-4 | `scheduler.ts` tick | 新任务从 epoch(0) 起算恒为到期：「每天9点」10 点添加也立即执行；无在飞守卫，慢任务下一分钟双触发 | 新任务改从 `createdAt` 起算；加 `ticking` 在飞守卫。失败推进 lastRunAt 的原语义**有意保留**（避免每分钟重试风暴式创建无人值守会话） |
| P1-5 | `api.ts` projectFilesList/projectFileRead | projectDir 零校验 = 全盘任意目录列表+任意 2MB 文本读取 | 新增 `assertReadableWorkspaceRoot`：dataRoot 内或任一既有会话 cwd 白名单（保持工作区文件面板对任意 cwd 会话的正常工作，不能直接套 validateWorkspace——那正是图谱红条的来源） |
| P1-6 | `daily-report.ts` findReportPath | reportId 未消毒拼路径，`../` 可穿越读任意 .md | 白名单消毒 `[^A-Za-z0-9._-]→_` |
| P1-7 | `workspace.ts` createProject | 无碰撞守卫：slug 化/截断后不同名项目静默并入同一目录（deep-learning-pipeline-alpha/beta 同目录） | 已存在即抛错（调用方 API 层已返回 {error}） |
| P1-8 | `memory/tools.ts` search_observations | 原始查询直传 FTS MATCH，含 CJK 标点即语法错误抛给模型（同文件 search_research_history 有完整清洗回退，此处漏了） | `toFtsQuery` 清洗 + 失败退化 LIKE |
| P1-9 | `memory/tools.ts` update_observation | 更新把 status 重置 active（superseded 记录复活）、createdAt 重置 now、关联边清空 | `writeObservation` 输入扩展 status/supersededBy/createdAt（缺省保持原行为），更新路径透传既有元数据 |
| P1-10 | `library/indexer.ts` + `search.ts` | 项目级 SQLite 连接缓存只在 dispose 关闭；项目删除/数据清空不关 → Windows 句柄占用删除失败或僵尸连接 | 两服务各加 `closeStore(path)`；dataClear 与 projectDeleteDisk 删除前调用（并补 memory.beginDeletion/endDeletion 配对） |
| P1-11 | `app client/chat.ts` runRewindOp | 成功路径永不清 `opBusy`：一次成功的回溯/编辑重发后，该实例编辑与回溯永久失效（ChatArea 无 key，fork 后同实例续存） | 成功分支 `setOpBusy(false)`；切换会话 effect 重置 opBusy/rewindConfirm |
| P1-12 | `app client/panels.ts` UV 自动安装 | uv-ensure 失败 → effect 守卫永真重试 → 无限「安装失败→重试→刷错误条」循环 | 加 `uvFailedRef` 失败即退出自动安装 |
| P1-13 | `scripts/verify-bundle.mjs` | ELK（GWT 产物）进 app bundle 后模块初始化期执行 `$wnd.Error…`，mock window 无浏览器构造器 → **主仓库与 worktree 的 verify-bundle 均失败（预存）** | mock window 补 Error/TypeError/Date/Math/JSON/Promise/Uint8Array |
| P1-14 | 依赖漂移 | `@deepseek-ai/dsh-llm` 声明 peer `@deepseek-ai/dsh-timeout` 未被安装：**全新 npm install 后 npm test 必失败**（主仓库同样复现，ERR_MODULE_NOT_FOUND） | 插件 devDependencies 显式补 `@deepseek-ai/dsh-timeout@^0.1.1-rc.2`；616 项单测恢复全绿 |

## 三、已修复（P2/P3，节选）

- **前端 URL 体系**（F1 黑盒实测 4 个 bug 全修，Playwright 复验通过）：
  - `?v=<视图>` 直开 9 个视图全部不恢复（只有写入方无读取方）→ 挂载时从 URL 初始化 view；
  - 首条消息创建会话后 URL 不写 `?t=`，刷新即回欢迎页 → 创建链补 patchUrl（占位 8 位）+ ensureThreadAlias；
  - 检查器 X/遮罩关闭后 `i=1` 残留 URL，刷新复活 → 关闭时同步清参；
  - 旧链接 `?threadId=` 升级后永不升级为正式 slug → 恢复路径接线 ensureThreadAlias；
  - `?r=` 清除正则无捕获组，URL 被写入字面 `$1` → 补 `([?&])`。
  - 恢复 effect 双通道（直开+解析后重开）各自持 resend timer，同一段修正文本可能 prompt 两次 → 收敛为互斥单通道 + 单 timer。
- **i18n 收敛**：`testing` 缺键（全站唯一）、欢迎页三张英文建议卡（中文界面显示英文）、约 30 处硬编码中文 toast/通知/占位标题（新子对话/新项目等落库文案）、`formatWhen` 硬编码英文，全部进 DICT（zh/en 双列）。
- **设置面板**支持 Esc 关闭（对齐品牌菜单/context-trace）。
- **inspector 死按钮**：工作区子标签「刷新/下载」无 onClick → 经自定义事件接入 WorkspaceFiles 的刷新与 ZIP 下载。
- **图谱空态**：「未绑定项目工作区」由红色错误条改为中性提示条（`.evo-graph-hint-banner`），错误分流助手统一路由。
- **research-notes**：NoteReader 缺 initialOffset 依赖（同笔记换段落打开不跳转）、DocBlock 缺 workspaceDir 依赖（切项目显示旧项目背景资料）。
- **启动器 start-web.mjs**：`--port` 用户覆盖失效（option 取首个匹配且不识别 `=`）→ 取最后一个+支持等号；worktree 隔离提示在 `--root` 显式覆盖时仍打印（误导）→ 判后再打印；`DSH_HOME=EVORESEARCH_ROOT` 日志字面量 → 打印实际值；Windows 停止先 `taskkill /t /f` 树杀（修复 npx→node 孙进程孤儿化占端口）。
- **桌面 sidecar launch.js**：junction 从 `cmd /c mklink /J` 改 `fs.symlinkSync('junction')`（POSIX 此前必抛后走复制，**macOS/Linux 桌面升级后永远运行数据根里的陈旧代码副本**）；readlink 比较归一化 `\\?\` 前缀/分隔符/大小写；端口文件只写一次（此前任何含 `127.0.0.1:N` 的日志行都会覆写）；头注释路径更正。
- **verify-bundle.mjs**：缺构建产物时裸 ENOENT 崩溃 → 明确报错并指引 `npm run build`。
- **死代码清理**：`sessionKeyOf`（api.ts）、`disposeGraphMemory`/`disposeAutoskillsMining`/`randomUUID` 导入（host/index.ts）、`WEEKDAY_NAME`+`normalizeWeekdays` 恒等函数（cron.ts）、`SessionStatsLine` 组件+孤立 formatDuration+死 CSS（session-dock.ts/styles.ts）；`dropSessionRefs` 由死代码变为已接线。

## 七·二、第二轮修复（同日继续：把 §四 遗留项全部处理）

**后端（plugin）**
- MCP supervisor：connect 加 15s 整体超时，child exit 时 reject 该 server 全部 pending（不再永久卡 starting）。
- 实验任务：JobHub 注册补 cancel（真实 stop 进程）+ 轮询 24h 上限（jobsCancel 对实验任务真实生效，僵死任务不再永久 running）。
- PDF 同步提取阻塞热路径：快速投影区间抑制 pdftotext 子进程（index.ts resourceReader + assembler readPdf + link-resolver paper 惰性），每条消息不再被 3N 秒阻塞。
- 审批策略双实现收敛：删除 decisionFromPolicy，统一走 approval-policy.decideApproval。
- threadsSearch 非 ASCII 兜底加双上限（200 会话或 2s，truncated 标记）。
- dataClear('projects') 范围补齐：plugins/ledgers、plugins/evolution、plugins/science-loops、project-meta.json 重置。
- graphInherit 落盘带 expectedRev（fork 前捕获，冲突返回可读错误）；chat-graph rev 改 JSON 内持久化自增（旧文件回退 mtime 方案，消除同毫秒盲区）。
- project-env 全面跨平台（POSIX uv/python/where/download 分支，此前 Linux/macOS 环境功能整体空转）。
- core/paths normPath 改平台感知大小写（POSIX 不再错误折叠）；memory：countByCategory SQL 聚合、respondGoalProposal 事务化、Store.open 失败关句柄、profile mtime 缓存、segments 请求级缓存、searchObservations 行内组装（N+1 消除）、supersede 校验目标存在、死向量路径删除；library：searchFts 退化回退、importBibtex 候选 2000；manuscript 编译超时树杀 + quoteCheck 路径包含校验；experiments manifest 容错 + checkpoint 源回写；rounds cancel 保留 done 产物；ledger runGit 超时 + 删死代码；channels 回发防崩 + 指数退避；vision 去硬编码盘符/超时/MIME 白名单；skills git 超时 + watch 泄漏修复；web-search 错误信息张冠李戴/JSONCache 原子写/deepseekEnrich 显式 opt-in。

**前端（app）**
- 共享模块收敛：新建 fs-api.ts（替换 9 份 POST 封装复制）与 file-kind.ts（统一扩展名分类，.env/.csv 一致）。
- tab-file 保存 CAS：写前重读比对，外部修改不再被静默覆盖；非文本文件只读打开成为事实（Monaco/textarea readonly + 写回双保险）。
- workspace-api 加固：file 读取先 stat 上限（GET 32MiB）、zip 逐文件预检、全响应 nosniff、trustedHosts IPv6 解析修复 + 带端口条目精确比较、commands-execute 120s 超时。
- chatgraph：system 常驻节点禁改名/删除、rev 未加载禁盲写、load 请求序号守卫（防旧图覆盖新图）、fallback 布局尺寸与真实节点一致、锚点原样输出；删除 Worker 入口地雷（self.onmessage 劫持 window）+ 构建期 worker 打包段 + 校验断言同步更新。
- markdown JSON 折叠补键盘（Enter/Space）与双向收起；panels/rounds/ledger/experiments/library/experiment-workspace 一批小修（死请求、key 兜底、loading 态表单、模板文案 i18n、logText 上限、记忆列表追加语义、fileHits key 等）。
- settings/panels/workspace-files/experiments 硬编码文案全部进 DICT；clearPathDetail 未知 id 显示原文；dsh-settings-file 描述改为与实现一致。

**桌面 / CI / 脚本**
- lib.rs：sidecar 失败页从 about:blank 改为内嵌诊断页（指向 shell 日志）；macOS 数据根改 app_local_data_dir（不再写进 .app 破坏 ad-hoc 签名封印）；stderr 日志改追加不再截断；启动不再删除 port.json（消除双实例互踩）；cargo check 通过。
- release.yml：publish-notes 增加 android 成功条件；draft 清理过滤本 TAG（不再误删人工草稿）。
- package.json：verify 链接入 launcher 单测；scripts/ 111 个一次性脚本 git mv 归档到 scripts/legacy/（白名单 22 个长期脚本保留）。

## 三·五、检查清单执行报告（2026-09-04/05 清单核验战役）

按 [CHECKLIST.md](./CHECKLIST.md) 的 1023 项逐项执行审查：由 6 个分段核验代理（后端×2 / 前端 / 桌面·脚本·测试 / 领域清单 / 视觉·端到端·可维护性）对每一项到代码/运行时实测复核，判定合并脚本校验 **覆盖 1023/1023、无缺失、无重复**。每项行尾 `→ 状态 证据` 已回写进 CHECKLIST.md。

### 执行结果总览

| 分区 | 项数 | 结果分布 |
|---|---|---|
| 后端逐文件 | 460 | ✅403 / 📋2 / 🔧55 |
| 前端逐文件 | 238 | ✅197 / 📋6 / 🔧35 |
| 桌面 | 20 | ✅13 / 🔧7 |
| 脚本 | 48 | ✅41 / 📋1 / 🔧6 |
| CI/Profile | 12 | ✅9 / 🔧3 |
| 测试覆盖 | 51 | ✅51 |
| 测试缺口 | 13 | ✅2 / 📋11 |
| 领域清单 | 116 | ✅95 / 📋4 / 🔧17 |
| 视觉走查 | 41 | ✅41 |
| 端到端场景 | 16 | ✅16 |
| 可维护性 | 8 | 📋3 / 🔧5 |
| **合计** | **1023** | **✅868 / 📋27 / 🔧128** |

**✅868 通过 · 🔧128 已修复 · 📋27 已登记遗留 · ⚠️0**（核验中发现的问题全部当场修复，无未处置发现）。

### 清单核验中新发现并当场修复的问题（第五批，20 项）

后端：autorelatedwork-compat 死函数 sourceCount 与恒空回调清理、`/project create` 缺 try/catch（碰撞守卫抛错裸冒给命令框架）、core/llm 恒真三元、MCP supervisor reconnectTimer 死字段（三处 clearTimeout 空操作）、diagnostics 悬空段注释、shared/types TurnRecord.interruptReason 联合类型与 store 写入值不一致（补 superseded_by_new_turn）。
前端：约 12 处硬编码文案走 i18n（工具图片「点击放大」、History copied、Mermaid 两处占位、skills 计数、superseded by、ShortcutsDialog 五行、Full history、读取失败等）；composer-assist `c.hint !== ''` 对 undefined 为真导致无 hint 命令的 description 永不展示（逻辑修复）；死代码 renderComposerDeco（约 70 行）/chatgraph refDisplayName/canvas 死参数 onEdit·onDelete/RESTORE_ICON 死常量删除；ToastHost 补 role=status+aria-live（读屏可感知）；view=/inspector= 短化前旧长键兼容读取。
后端·项目删除：projectDeleteDisk 级联清理 `plugins/ledgers/<key>` 与 `plugins/chat-graphs/<name>.json`（此前同名重建项目会复活旧账本与图谱）。
CI：release.yml draft 清理 `gh api --jq --arg` 语法无效（pflag 把 --arg 当 --jq 的值，命令替换内失败被 for 静默吞掉）——第二轮的"按 TAG 过滤"修复实际未生效，改 shell 内插后修复；Release 表述（prerelease）与实现（正式版）矛盾——以实现为准同步 AGENTS.md/feature-map，并修正 feature-map「ELK Worker 已接入」文档漂移。
清单自身：修正 507 处路径双写前缀（packages/evoresearch-plugin/packages/…）与 AUD-0731~0734 指向全历史不存在的 build-plugin.mjs（实际由 tsc+build-client.mjs 承担，条目标注说明）。

### 📋 27 项登记遗留分布

测试缺口 11（experiment-rounds/commands/core-llm/chat-graph-bridge/packet/rewind×2/api 283 端点/Rust/launch.js/React 组件渲染）· 性能 P3 3（bundle 19MB 无分割/大图主线程布局/client-state 高频写）· 可维护性 3（巨石主体拆分/console.error 保留/active-teams 开关+ctx:any 路线）· 领域 4（verify.mjs 双入口/端口 TOCTOU/capabilities 通配评估/桌面测试面）· 脚本 1（verify.mjs 并存）· 前端 5（主体拆分/readSideChats/matchesSession/拖停全边重算/session-actions 焦点圈闭）· 杂项（cron 英文缩写/roles 死导出有测试引用）。


## 三·六、复查（2026-09-05：清单覆盖审计 + 判定抽查 + 补充核验）

按「接近完成必须复查」原则，对上一轮清单执行结果做了三项独立复核：

1. **清单覆盖审计**：程序化对比 git 全部跟踪源码（149 个 ts/tsx/rs）与 CHECKLIST 提及文件，发现生成清单的 glob `**/*.ts` 遗漏 **21 个文件**（3 个 .tsx 面板、5 个修复期新建模块、3 个 frontend 入口、3 个 vendored、workspace-api/runtime/directory-picker/app 与 plugin 的 src/index.ts、plugin src/client/index.ts 406 行兜底面板、build.rs）。21 个已全部补审并以 SUP-001~021 追加进 CHECKLIST（总项数 1044）。
2. **判定抽查**：跨分区随机抽 10 条代理判定逐条独立复核（disposeAutoskillsMining/WEEKDAY_NAME 删除、segmentsCache、clickToEnlarge、hint 判定、toast aria-live、verify 链 launcher、release gh api 内插、projectDeleteDisk 级联、AGENTS Release 表述）——**10/10 属实**。
3. **补充核验新发现并当场修复**：plugin 兜底面板（src/client/index.ts，406 行，生产 disabled）的 `projectCreate` 调用不处理错误返回——第一轮给 createProject 加的碰撞守卫抛错后该面板静默无反馈；且 `call()` 全程无错误处理（4 处未捕获 Promise 拒绝）。已改 `callOrAlert`（错误可见反馈）覆盖全部 5 处调用。其余 20 个文件补审通过（多数前几轮代理已顺带覆盖，本轮补正式判定）。

**补充核验后基线**：typecheck 0 错误、单测 617+52+5 全过。

## 四、最终遗留（📋，仅 1 项）

1. **前端巨石组件完全拆分（EvoFrame / ChatArea 主体）**：有界拆分已完成两阶段——第一阶段 notifications.ts/two-step.ts/fs-api.ts/file-kind.ts，第二阶段 url-state.ts（URL 状态与会话短别名模块，纯函数搬移）。剩余主体为 JSX 组合与事件处理，完全拆分需独立重构分支 + 逐组件回归，不在本审计分支继续。

## 四·四、第四轮修复明细（同日第四批）

- **账本 slug 截断碰撞：从硬报错升级为确定性自愈迁移**——新增 `resolveLedgerDirKey(dataRoot, projectName)` 单点（repoDir 与 experiment-workspace 覆盖清理共用）：检测到同键异名项目时，键派生为 `<截断键>-m<sha1 前8（完整项目名）>`（两碰撞项目各得独立裸库），被共享的旧库一次性改名 `<截断键>-collided-archive` 保留混杂历史；幂等（归档存在即跳过）。新增单元测试覆盖碰撞/归档/独立读写/幂等（ledger.test 10 用例全过）。
- **memory activeTurns 并发覆盖保护**：同会话并发两条 user/message 不再覆盖式丢失——检测到未结束的上一轮时即时收尾（updateTurn → interrupted/superseded_by_new_turn + 已积累 assistantText），新轮正常开启（此前上一轮悬挂 pending 1 小时被 recovery 兜底误标，正文串账）。
- **memory storeFor 启动对账后台化**：整库备份复制 + 最多 200 个会话日志同步读挪到 setImmediate，用户首条消息路径不再卡顿。
- **api 清理**：删除恒 false 且无前端消费的 safety 占位端点；mcpServerAdd 等待启动完成（connect 已有 15s 超时）返回真实状态（此前恒返回 starting 前快照）。
- **前端小项**：setNarrow 的 resize 处理纯函数化（跨 setState 副作用挪出 updater）；statusbar computeStats 确认已 memo（无需改）。

> 第四轮后基线：build 0 警告、单测 617+52+5、domain 27、acceptance 19/19、xyflow/bundle/docs 全过、cargo check 过、UI 回归 5/5、pageerror 0。

## 四·三、第三轮修复明细（同日第三批，其"遗留 2 项"中账本项已于第四轮解决）

- **contextPrunes 端点下线**：管线未接线、无前端消费、恒返回 []；pruneToolResult 能力本体保留并标注「预留、需设计评审后接入」（context-runtime）。
- **日报 llm:true 从假功能变真功能**：DailyReportOptions 新增 polisher 注入，api 层经 ctx.llm（callText，当前默认模型→auxiliaryModel→部署默认）真实润色，30s 超时/失败/空输出回退模板原文。
- **账本 slug 截断碰撞运行时守卫**：repoDir 检测同键异名项目，拒绝并给出可读错误。
- **版本单一事实源**：tauri.conf.json version 0.1.0 → 0.1.0-rc.1（对齐 Cargo.toml 与 Release TAG），release.yml Notes 下载表与 AGENTS.md 产物名同步。
- **console.error 过滤改造**：key 误报由「4 帧+2s 时间窗」改为对恰好该条文案的永久精确过滤（其余错误一律放行，消除窗口漂移与误吞疑虑）。
- **两段式确认定时器统一**：新增 two-step.ts useConfirmReset（先清旧 timer 防截断新确认窗口 + 卸载清理），替换 research-notes/experiments/ledger-panel/panels 六处裸 setTimeout。
- **trajectory 行键盘可达**：turn/step/call 三类行补 role=button + tabIndex + Enter/Space + aria-expanded。
- **library import_literature**：Content-Length 预检，声明超限直接拒绝（不再整体进内存后才校验）。
- **预留能力显式标注**：science/memory.ts（ScienceMemory 有测试、生产未接线）与 platform/adapters.ts（七适配器预留面）标注「预留、勿按死代码删除」。
- **有界拆分第一阶段**：index.ts 后台通知 effects 抽为 notifications.ts（行为不变的纯搬移，构建与回归通过）。

> 第三轮后基线：build 0 警告、单测 616+52+5、domain 27、acceptance 19/19、xyflow/bundle/docs 全过、cargo check 过、UI 回归 5/5、pageerror 0。

> 其余 P3 级（5s 确认定时器不清理、trajectory 行键盘可达、library import 50MB 流式预检等）记录于各代理审计原始报告，影响面小，按需处理。

