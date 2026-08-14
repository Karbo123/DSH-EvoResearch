# dsh-evoscientist

**EvoScientist 的 deepseek-harness（DSH）插件实现** —— TypeScript / Node.js 完全重写，
复刻 [D:\EvoScientist](https://github.com/EvoScientist/EvoScientist)（Python）的科研 Agent 能力：

- 🧠 **EvoMemory v2/v3 科研记忆**：Turn Catalog、七类多标签分类、FTS5/向量混合检索（RRF）、
  每轮记忆包注入（≤6000 token）、Goal Contract 长程目标控制、中断恢复语义；
- 📂 **科研项目工作区**：`projects/<name>/.evosci-data/` 数据隔离、git 集成、
  项目导入、New Chat 自动创建；
- 🤖 **多智能体团队 / 专家邀请**、🛠️ **AutoSkills 技能蒸馏**、⏰ **定时任务（cron）**、
  🌐 **多通道（Telegram 等）**、💬 **斜杠命令**、🔬 **WebUI 科研面板**；
- 🪟 **Windows 桌面版**（Tauri 2 + Node sidecar，目标安装包 < 60MB）。

**硬性约束（已满足）**：Node.js 后端（零 Python）；不基于 deepagents；Windows 优先；
中文文档与注释。

## 快速开始

```bash
npm install          # 安装 workspace 依赖
npm run verify       # 构建 + 单元测试（43 个用例）
```

## 文档

| 文档 | 内容 |
|---|---|
| [docs/00-decisions.md](docs/00-decisions.md) | 技术选型决策（SQLite vs PostgreSQL、嵌入模型、桌面方案等） |
| [docs/01-architecture.md](docs/01-architecture.md) | 架构设计与数据流 |
| [docs/02-feature-map.md](docs/02-feature-map.md) | EvoScientist 功能逐条映射表（✅/🟡/🔲） |
| [docs/03-development.md](docs/03-development.md) | 开发指南（挂载、配置、扩展点） |
| [docs/04-desktop.md](docs/04-desktop.md) | Windows 桌面版构建与体积优化 |

## 目录结构

```
packages/evoscientist-plugin/   # @evoscientist/dsh-plugin —— 唯一插件包
  ├── src/host/                 # Host 插件（workspace/memory/scheduler/channels/...）
  ├── src/client/               # Client 插件（WebUI 科研面板）
  └── cordis.patch.yml          # bundle patch（挂载两行插件）
profiles/evoscientist/          # 示例 DSH profile
desktop/                        # Tauri 2 桌面壳 + Node sidecar 打包脚本
docs/                           # 中文文档
```

## 版本基线

- 基于 deepseek-harness **0.1.0-rc.x**（npm 实际发布的最新为 **0.1.0-rc.6**，本机部署同版本；
  0.1.0-rc.5 未在 npm 发布，见 [docs/00-decisions.md §8](docs/00-decisions.md)）；
- 本插件版本 `0.1.0-rc.1`，peerDependencies `^0.1.0-rc.6`。

## License

MIT
