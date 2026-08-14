# 00 · 技术选型决策（Tech Decisions）

> 本项目是 D:\EvoScientist（上游参照，Python）的 TypeScript 完全重写，运行于
> [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）0.1.0-rc.x 平台。
> 本文记录每项关键选型的**决策依据**与**否决项**，便于后续维护者复核。
> 硬性约束：Node.js 后端、不使用 Python、不基于 deepagents、Windows 优先（Web + 桌面）、
> 桌面打包体积最小、文档与注释使用中文。

## 1. 存储：SQLite（node:sqlite 内置驱动）

**决策**：主存储使用 SQLite，由 Node 22.5+ **内置**的 `node:sqlite`（DatabaseSync）驱动，
存储层通过抽象接口接入，可随部署形态扩展。

**依据**：桌面端与「项目即目录」的数据模型要求嵌入式单文件存储；`node:sqlite` 自带 FTS5
全文检索（零原生依赖，对桌面打包体积最友好）；与 DSH 平台自身的会话查询层同构。

## 2. 嵌入模型（科研记忆 向量召回）：三级可退化

**决策**：抽象 `EmbeddingProvider` 接口，三级方案：

1. **远端 embedding API**（OpenAI 兼容 `/embeddings`）：零本地模型、体积最小，用户已有 API key 时首选；
2. **本地 transformers.js**（`multilingual-e5-small`，~0.47GB 首次下载）：离线/隐私场景，后台线程预热度量；
3. **纯 FTS5 保底**：模型未就绪/不可用时自动退化，不阻塞主回答（与 EvoResearch 的退化逻辑一致）。

第一版交付 FTS5 + 接口预留；`docs/02-feature-map.md` 中标注 v2 接入项。

## 3. 会话/检查点：复用 DSH session 层，项目隔离靠 workspace_dir

**决策**：不重写会话存储。DSH 已有 `dsh-session`（事件日志 + JSONL 持久化）、
`dsh-session-query-sqlite`（FTS5 会话查询）。项目隔离通过 session header 的 `cwd`
（= workspace_dir）实现，科研记忆 的 `research_memory.db` 按项目独立存放。

## 4. 模型路由 / Fallback / 审批 / 子代理 / 调度 / 技能 / MCP：全部复用 DSH 平台

| 能力 | DSH 平台服务 | 本项目动作 |
|---|---|---|
| 多 provider 路由 | `llm` + `llm-deepseek` + `llm-pi-ai`（settings.yaml 热加载） | 直接使用 |
| 模型 Fallback/重试 | `dsh-llm-retry` | 直接使用 |
| 审批/危险模式 | `approval` + `permissionPresets` | 直接使用 |
| 子代理/多智能体 | `subagents` + `dsh-tool-subagent` | 团队预设与专家邀请（experts.ts） |
| 定时任务 | `timer`（本插件自实现 cron 调度） | scheduler.ts（项目隔离 + 结果回报主对话） |
| 技能 | `skills` + `dsh-skill-filesystem` | AutoSkills 提案 → 技能目录（autoskills.ts） |
| MCP | `dsh-mcp-client` | 直接使用（WebUI System 弹窗管理） |
| 目标 | `goals`（DSH 原生）+ 科研记忆 Goal Contract | 二者并存：科研 Goal 走本插件（goals.ts） |

## 5. Web 扩展：Client 插件 + Typert Remote，不另起 HTTP 服务

**决策**：WebUI 扩展注册到 DSH 现有 Web GUI 的 Slots（`sidebar.footer.action`、
`shell.overlay`、`conversation.input.dock` 等），Client→Host 通信走平台 Typert Gateway
（`ctx.remote.evoresearch.*`）。不写独立 SPA，不新增 HTTP 层 —— 与"DSH 插件"定位一致，
避免与平台 UI 割裂。

## 6. 桌面壳：Tauri 2（Rust）+ Node sidecar

**决策**：Tauri 2 作 WebView2 壳（复用系统 WebView2，安装包 ~5-15MB 壳），
后端 = Node sidecar（node.exe + 打包的 DSH 应用目录，LZMA 压缩后 ~35-50MB）。
总安装包目标 **< 60MB**。

| 方案 | 体积 | 结论 |
|---|---|---|
| Electron | ~100MB+ | 否决 |
| NW.js | ~100MB+ | 否决 |
| PyInstaller onefile（上游 EvoScientist 原方案） | 通常 100MB+ | 本项目不用 Python |
| **Tauri + Node sidecar** | **~40-60MB** | **采用**（Rust 工具链已就绪；Node 是硬约束，物理下限 ≈ node.exe 压缩后体积） |
| Node SEA 单文件 | ~80-120MB | 备选；原生模块（node-pty 等）需外置，复杂度高，第一版不用 |

## 7. 构建与测试

- **tsup**（esbuild）：host/client 双入口 ESM 打包，`@deepseek-ai/*` 全部 external（peerDependencies）；
- **tsc --noEmit** 严格类型检查（tsconfig.json + tsconfig.client.json）；
- **node:test + tsx**：零框架单元测试（SQLite/cron/路径/分类器等纯逻辑全覆盖）。

## 8. 版本基线说明

npm 上 `@deepseek-ai/dsh` 系列发布的版本为 `0.1.0-rc.2 / rc.3 / rc.6`，
**不存在 rc.5**。本机部署与依赖声明统一对齐 **0.1.0-rc.6**（同系列最新，API 与 rc.5 目标一致）。
本插件自身版本 `0.1.0-rc.1`，peerDependencies 使用 `^0.1.0-rc.6` 范围。
