# 01 · 架构设计（Architecture）

```
┌────────────────────────────────────────────────────────────────────┐
│                        浏览器（DSH Web GUI）                         │
│  dsh-client-ui-*（平台）   +   @evoresearch/dsh-plugin/client     │
│    侧栏「🔬 科研」入口 / 科研面板(overlay) / 会话记忆提示条(dock)     │
│    └── ctx.remote.EVORESEARCH.*（Typert Gateway / JSON RPC）            │
└──────────────────────────────┬─────────────────────────────────────┘
                               │
┌──────────────────────────────▼─────────────────────────────────────┐
│                      Host（Node.js 进程）                           │
│  @evoresearch/dsh-plugin/host ── 插件入口（apply 组装）             │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ WorkspaceService   科研项目工作区（projects/<n>/.evoresearch-data） │  │
│  │ MemoryRuntime      EvoMemory v2/v3（本插件核心）               │  │
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
│  │ EVORESEARCHApiService  Typert Remote API（EVORESEARCH.*）                │  │
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

| 模块 | 职责 | 与 EvoResearch 对应 |
|---|---|---|
| `core/paths.ts` | 项目名/路径/工作区安全校验（Windows normcase） | `paths.py` |
| `core/db.ts` | node:sqlite 封装（WAL/FULL 同步/迁移/FTS5） | `memory/research/store.py` 基础层 |
| `core/cron.ts` | 5 字段 cron 解析 + nextRun（自研零依赖） | `cron/schedule.py` |
| `core/llm.ts` | LLM 文本/JSON 调用辅助（流式收集、宽松 JSON 提取、token 估算） | `llm/*` 辅助 |
| `workspace.ts` | 项目创建/导入/自动创建（AI slug）/git exclude | `paths.py` + WebUI workspace API |
| `memory/store.ts` | research_memory.db：turns/attempts/receipts/states/observations/goals/进度 | `memory/research/store.py` |
| `memory/classifier.ts` | 七类分类 + topic 归一化（词面 + 语义接口） | `memory/research/classifier.py` |
| `memory/retrieval.ts` | RRF 融合、类别加权不硬过滤、EmbeddingProvider 接口 | `memory/research/retrieval.py` |
| `memory/packet.ts` | 记忆包构建与渲染（<research_memory_packet>） | `memory/research/packet.py` |
| `memory/tools.ts` | search_research_history / read_research_turn / observations 工具 | `memory/research/tools.py` |
| `memory/goals.ts` | 长程检测、Goal 提取、四轴判定、投影渲染 | `memory/research/goal_control.py` |
| `memory/index.ts` | MemoryRuntime：session/event 订阅、prompt 注入、后台分类、按项目懒打开存储 | `middleware/memory.py` |
| `scheduler.ts` | 定时任务（JSON 持久化 + 每分钟 tick + 结果线程） | `cron/` + WebUI Scheduled Tasks |
| `channels/` | ChannelAdapter 接口 + 管理器 + Telegram 长轮询 + 骨架适配器 | `channels/*` |
| `autoskills.ts` | 观测聚类 → 提案 → approve/reject/run → 技能目录 | `memory/autoskills/*` |
| `experts.ts` | 专家邀请（active_teams 持久化） | `middleware/active_team.py` |
| `api.ts` | EVORESEARCHApiService（Typert Remote，Client 可调） | `langgraph_dev/http.py` |
| `commands.ts` | 斜杠命令注册（平台命令体系） | `commands/implementation/*` |
| `index.ts` | 插件入口：配置解析 + 组装 + 副作用管理 | `EvoScientist.py` 接线层（上游参照） |

### Client 插件（`src/client/`）

| Slot | 用途 | 对应 EvoResearch WebUI |
|---|---|---|
| `sidebar.footer.action` | 侧栏「🔬 科研」入口 | 顶部 Logo/工具入口 |
| `shell.overlay` | 科研面板（项目/记忆/任务/通道/提案 5 个标签） | WebUI 各面板 |
| `conversation.input.dock` | 会话记忆提示条（Memory · N sources） | ChatMessage 记忆徽标 |

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
systemPrompt.context('EVORESEARCH:research-memory')
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
