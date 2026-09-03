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

## 四、已确认、留待后续（📋，按优先级）

1. **前端巨石组件**：EvoFrame ~1930 行、ChatArea ~1900 行、ThreadList ~1000 行。建议按「composer/气泡/标签栏/URL 状态」拆分（本次不做，防止大范围回归）。
2. **文件 tab 保存为最后写入者胜**（tab-file Ctrl+S 裸覆盖写）：智能体并发改动会被静默覆盖。建议后端 /fs/write 提供 hash CAS 或前端写前重读比对。
3. **账本 slug 20 字符截断碰撞**（experiment-ledger 等）：超 20 字符的项目名前缀相同会共享裸 git 账本库。createProject 碰撞守卫已挡住新建，存量数据迁移需单独设计。
4. **dailyReportGenerate 的 llm:true 是假功能**（tryPolishMarkdown 恒等返回）：建议接线 LLM 或移除开关。
5. **MCP supervisor connect 无超时**：stdio 服务器挂起时 start() 永久 await。建议 Promise.race 超时 + child exit reject pending。
6. **project-env POSIX 全链路失效**（uv.exe/Scripts/python.exe/where.exe 硬编码）：CI 已产 AppImage/deb/dmg，Linux 桌面用户环境功能空转。建议按 platform 分支。
7. **审批策略双实现**（index.ts decisionFromPolicy 与 platform/approval-policy decideApproval 等价并存）：建议门面改调 decideApproval 后删除。
8. **threadsSearch 非 ASCII 全量串行扫描**：会话多时卡顿，建议限扫描数/并行分批。
9. **macOS 桌面数据根在 .app bundle 内**（resource_dir 下 + ad-hoc 签名）：运行期写入破坏签名封印、卸载即删数据。建议 macOS 用 app_local_data_dir。
10. **tauri.conf.json version 0.1.0 与 Release v0.1.0-rc.1 双源**：NSIS 产物名与 Notes 模板硬编码一致，改动需两处联动，留待版本策略统一时处理。
11. **release.yml**：publish-notes 不看 android 结果（Android 失败仍发含 APK 表的 Notes）；prepare-release 删全部 draft 不限本 tag。建议各加条件/过滤。
12. **scripts/ 130 个 mjs 中约 107 个一次性脚本**（verify-round*/shot*/vision*/cdp*/probe* 等）建议移 `scripts/legacy/` 归档（本次不动，避免破坏既有引用）。
13. **console.error 劫持压制 React key 警告**（app index.ts apply）：后台标签页 rAF 节流期会吞掉其他错误，建议仅 dev 构建启用。
14. **AGENTS.md 文档缺口**：worktree 就绪除 `npm install + npm run build` 外，还需在 `profiles/evoresearch` 执行 `pnpm install`（本次已在 AGENTS.md 补充）。
15. **web-search 大量 P3**：学术 Provider 校验错误信息张冠李戴、JSONCache 非原子写、`deepseekEnrich !== false` 把 undefined 当 true 等（见审计清单）。

## 五、验证基线（修复后，本分支）

| 套件 | 结果 |
|---|---|
| `npm run build` | ✅ 0 warning / 0 error |
| `npm test`（插件单测） | ✅ 616/616 |
| `npm run test -w @evoresearch/dsh-app` | ✅ 52/52 |
| `node --test scripts/web-port.test.mjs` | ✅ 5/5 |
| `npm run verify:domain` | ✅ 27 checks PASS |
| `npm run verify:acceptance` | ✅ 19/19（42 断言） |
| `verify-chatgraph-xyflow` | ✅ 6 PASS |
| `verify-bundle` | ✅ 通过（修复 mock 后） |
| `check-docs` | ✅ 通过 |
| **`npm run verify` 全链** | ✅ exit 0 |

## 六、UI 黑盒测试（Playwright，修复后复验）

| 检查 | 结果 |
|---|---|
| `?v=mem` 直开恢复视图 | ✅ PASS |
| 设置面板 Esc 关闭 | ✅ PASS |
| 检查器关闭后 `i=` 残留清除 | ✅ PASS |
| 图谱空态不再红色错误条 | ✅ PASS |
| 首条消息后 URL 写入 `?t=<slug>` | ✅ PASS（`/?t=s-ba8aa3dd`） |
| 全程 pageerror | 0 |

修复前的首轮黑盒测试：146 项检查 128 通过，暴露本文档所列 4 个 URL bug 与 2 个 UX 问题，全部已修。多视口（1920/1366/1024/768/414/375）视觉走查无布局破裂、无 console error、暗/亮主题一致、桌面 36px 标题栏正常。

## 七、视觉走查截图

`.tmp-dev/images/audit-main/`（本 worktree，gitignore）与 `.tmp-dev/images/audit-f1/`（F1 代理 146 项测试证据）。
