# 01 · 架构设计（Architecture）

```
┌────────────────────────────────────────────────────────────────────┐
│                   浏览器（EvoResearch 工作台，自定义表面）             │
│  @evoresearch/dsh-app（自建前端 dist + UI 插件，不加载官方 ui-*）    │
│    AppWebEntry 内核 → root slot → EvoFrame（导航/会话/业务面板）      │
│    └── ctx.remote.evoresearch.*（Typert Gateway / JSON RPC）        │
└──────────────────────────────┬─────────────────────────────────────┘
                               │
┌──────────────────────────────▼─────────────────────────────────────┐
│                      Host（Node.js 进程）                           │
│  @evoresearch/dsh-plugin/host ── 插件入口（apply 组装）             │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ WorkspaceService   科研项目工作区（projects/<n>/.evoresearch-data） │  │
│  │ MemoryRuntime      科研记忆（本插件核心）               │  │
│  │  ├─ store.ts      research_memory.db（node:sqlite + FTS5）    │  │
│  │  ├─ classifier.ts 七类多标签分类（LLM + 确定性回退）            │  │
│  │  ├─ retrieval.ts  FTS5/向量 RRF 融合检索                       │  │
│  │  ├─ packet.ts     记忆包注入（6000 token 预算）                │  │
│  │  ├─ goals.ts      v3 Goal Contract（四轴保守判定）             │  │
│  │  └─ tools.ts      记忆工具（search/read/observation）          │  │
│  │ SchedulerService  定时任务（cron，项目隔离，结果回报主对话）      │  │
│  │ ChannelManager    通道（Telegram 长轮询 + Slack/QQ/微信/飞书   │  │
│  │                   骨架，消息 → agent 会话）                    │  │
│  │ AutoSkillsService 观测聚类 → 技能提案 → 审核 → 技能目录         │  │
│  │ ExpertService     专家团队（active_teams）                     │  │
│  │ evoresearchApiService  Typert Remote API（evoresearch.*）                │  │
│  │ commands.ts       /project /memory /schedule /channel ...     │  │
│  └──────────────────────────────────────────────────────────────┘  │
│        │ 注入/订阅（复用平台服务）                                  │
│        ▼                                                          │
│  dsh-base 组合：session(session/event) · systemPrompt.context     │
│  · tools.register · commands.register · llm · agents · timer ·    │
│  settings · skills · sessionQuery · approval · permissionPresets  │
└────────────────────────────────────────────────────────────────────┘
```

## 模块职责

### Host 插件（`src/host/`）

| 模块 | 职责 |
|---|---|
| `core/paths.ts` | 项目名/路径/工作区安全校验（Windows normcase） |
| `core/db.ts` | node:sqlite 封装（WAL/FULL 同步/迁移/FTS5） |
| `core/cron.ts` | 5 字段 cron 解析 + nextRun（自研零依赖） |
| `core/llm.ts` | LLM 文本/JSON 调用辅助（流式收集、宽松 JSON 提取、token 估算） |
| `workspace.ts` | 项目创建/导入/自动创建（AI slug）/git exclude |
| `memory/store.ts` | research_memory.db：turns/attempts/receipts/states/observations/goals/进度 |
| `memory/classifier.ts` | 七类分类 + topic 归一化（词面 + 语义接口） |
| `memory/retrieval.ts` | RRF 融合、类别加权不硬过滤、EmbeddingProvider 接口 |
| `memory/packet.ts` | 记忆包构建与渲染（<research_memory_packet>） |
| `memory/tools.ts` | search_research_history / read_research_turn / observations 工具 |
| `memory/goals.ts` | 长程检测、Goal 提取、四轴判定、投影渲染 |
| `memory/index.ts` | MemoryRuntime：session/event 订阅、prompt 注入、后台分类、按项目懒打开存储 |
| `scheduler.ts` | 定时任务（JSON 持久化 + 每分钟 tick + 结果线程） |
| `channels/` | ChannelAdapter 接口 + 管理器 + Telegram 长轮询 + 骨架适配器 |
| `autoskills.ts` | 观测聚类 → 提案 → approve/reject/run → 技能目录 |
| `experts.ts` | 专家邀请（active_teams 持久化） |
| `api.ts` | evoresearchApiService（Typert Remote，Client 可调） |
| `commands.ts` | 斜杠命令注册（平台命令体系） |
| `index.ts` | 插件入口：配置解析 + 组装 + 副作用管理 |

### 浏览器表面（`packages/evoresearch-app/`）

自定义表面 bundle `@evoresearch/dsh-app`，替代官方 `dsh-web-app`：host 行全部复用官方包
（webserver / api-gateway / connection / client-runtime / modules / ui-theme / locale /
ui-settings），**不加载**任何官方 `ui-*` 外壳行；浏览器端只加载本包的 UI 插件。

| 组成 | 说明 |
|---|---|
| `src/runtime.ts` | app-runtime 行（`@evoresearch/dsh-app/runtime`）：serve 本包 `dist/`、提供 `webRuntime` 服务、注册表面提示段与 `DSH_WEB_URL`、打印 URL |
| `src/client.ts` | evoresearch-ui 行（包根空 apply + `exports["./client"]`）：提供 `layout` 服务（app-shell 硬依赖）+ 注册 `root` slot → EvoFrame 工作台 |
| `src/directory-picker.ts` | `directoryPicker` 服务桩（`kind: 'none'`）：官方 auto 包的 client 面依赖 ui-workspace 外壳，自定义表面改用桩，消费方隐藏选择 UI |
| `frontend/` | 前端外壳入口：`AppWebEntry` 内核（@deepseek-ai/dsh-client-web）+ 我们的 `index.html`，构建为 `dist/` |
| `vendor/` | vendored 官方 `dsh-client-modules/client` 源码（MIT）：发布形态是 ModuleLoader 包装，内核静态 import 必须用源码形态（与官方 vite alias 同构） |

关键机制（与官方设计文档一致的约定）：

- **app-shell 组装**（web 内核内部）inject `slots/sessions/layout` 并渲染 `root` slot ——
  官方由 ui-layout 提供 `layout` 服务并注册 root slot，自定义表面由 `evoresearch-ui` 自给自足；
- **官方 client 行的 inject 是"加载拓扑包名"**（factory require 依赖），不是 cordis 服务依赖 ——
  自定义表面必须保留依赖闭包内的行：`cordis-client-runner → ui-theme → {locale, ui-settings}`；
  会话导出（`dsh-session-log-export`）与目录选择（`dsh-host-directory-picker-auto`）的 client 面
  会拖入 ui-conversation/ui-workspace 等外壳，故在 patch 中禁用/替换；
- **行名解析**：`app-runtime` 与 `directory-picker` 行指向包子路径（`./runtime`、`./directory-picker`），
  包根保持空 apply（与官方 ui-\* 的 node half 同构），避免同一包多行的 host 侧 apply 冲突；
  modules 按**行名**解析包并扫描 `dsh.client`，子路径行天然不产生 client 面。

## 数据流：一轮对话的科研记忆闭环

```
用户消息 ──▶ session/event('user/message', source.user)
              │
              ▼
MemoryRuntime.handleSessionEvent
  1. createPendingTurn（立即，不阻塞）
  2. 后台 processTurnBackground：
     a. classifyRequest（LLM JSON → 校验 → 确定性回退）
     b. canonicalizeTopicKeys（复用已有 topic key）
     c. updateTurn + upsertTopicState
     d. looksLongHorizon? → ensureGoalContract（v3）
     e. buildMemoryPacket(query=用户消息) → packets[sessionId]
              │
              ▼
systemPrompt.context('evoresearch:research-memory')
  ──▶ 每步模型调用前注入 <research_memory_packet>（≤6000 token）
              │
              ▼
session/event('turn/end') ──▶ 标记 completed / interrupted（v3）
```

## 项目数据布局

```
<dataRoot>/
├── projects/
│   └── <name>/                    # 独立 git 仓库
│       ├── .evoresearch-data/          # git exclude（info/exclude）
│       │   ├── memories/
│       │   │   ├── research_memory.db      # SQLite + FTS5
│       │   │   ├── observations/           # Markdown（人类可读、git 可管理）
│       │   │   │   ├── global/O-xxx.md
│       │   │   │   └── projects/P-xxx/O-yyy.md
│       │   │   └── profile/                # SOUL/USER_PROFILE/RESEARCH_TASTE...
│       │   └── scheduler.json    # 全局定时任务（带 workspaceDir）
├── .evoresearch-data/
│   ├── autoskills.json           # 技能提案
│   ├── active-teams.json         # 专家团队
│   └── skills/<name>/SKILL.md    # 已批准技能
```

## 安全边界

- 项目名白名单（`[a-z0-9][a-z0-9-]{0,63}`），路径 resolve 后必须位于根内（防 `..` 穿越）；
- 工作区只允许「部署根」或「projects/<name> 直接子目录」；
- `read_memory` 工具限制在 `.evoresearch-data/memories/` 内；
- 导入项目：隐藏临时目录 + 原子改名 + 失败清理；跳过可重建目录（node_modules/.venv 等）；
- API 层只经 Typert Remote（JSON 序列化），不暴露 Host 内部对象。
