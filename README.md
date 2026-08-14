<div align="center">

# 🔬 EvoResearch

**面向科研的自主 AI 研究员 —— deepseek-harness（DSH）插件**

基于 [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) **0.1.0-rc.6** 构建，
用 TypeScript / Node.js 从零实现的科研 Agent 能力套件：**自进化科研记忆、项目工作区、
多智能体团队、定时任务、多通道接入与 Windows 桌面版**。

[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-24%2B-green)](https://nodejs.org/)
[![DSH](https://img.shields.io/badge/deepseek--harness-0.1.0--rc.6-1f3a93)](https://github.com/deepseek-ai/deepseek-harness)
[![Tauri](https://img.shields.io/badge/Desktop-Tauri%202-6a5acd)](https://tauri.app/)
[![Windows](https://img.shields.io/badge/Platform-Windows-0078d6)]()
[![License](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)

**安装包仅 44 MB**（WebView2 复用系统组件）· 零 Python · 不依赖 deepagents

</div>

---

## ✨ 特性一览

| | 特性 | 说明 |
|---|---|---|
| 🧠 | **科研记忆 科研记忆** | 每轮对话自动进入 Turn Catalog，七类多标签分类（idea/method/experiment/related_work/reproduction/project/general），FTS5 + RRF 混合检索，每轮注入 ≤6000 token 记忆包 |
| 🎯 | **Goal Contract 长程目标控制** | 长期任务自动生成目标合同，四轴保守判定（目标/范围/证据/完成），证据链可审计推进 |
| 📂 | **科研项目工作区** | `projects/<name>/.evoresearch-data/` 数据随项目目录隔离，项目即 git 仓库，支持导入与 AI 自动命名创建 |
| 🤖 | **多智能体团队** | 6 个科研角色预设（规划/调研/编码/调试/数据分析/写作），`/expert invite` 一键邀请 |
| 🛠️ | **AutoSkills 技能蒸馏** | 从记忆观测自动聚类生成可复用技能提案，审核通过后写入技能目录 |
| ⏰ | **定时任务** | 自研 cron 解析（Vixie 语义），结果直达结果线程，支持「Report to main chat」 |
| 🌐 | **多通道接入** | Telegram 可用；Slack / QQ / 微信 / 飞书 / Signal 适配器框架就绪 |
| 💬 | **斜杠命令** | `/project` `/memory` `/schedule` `/channel` `/expert` `/autoskills` |
| 🖥️ | **WebUI 扩展 + i18n** | 侧栏科研入口、科研面板（项目/记忆/任务/通道/提案）、会话记忆提示条，中英双语 |
| 🪟 | **Windows 桌面版** | Tauri 2 + Node sidecar，NSIS 安装包 **44 MB**（实测），含全部后端 |

## 🚀 快速开始

### 环境要求

- **Windows 10/11**（当前仅支持 Windows）
- **Node.js ≥ 24**（需要内置 `node:sqlite` 与 zstd；推荐 24 LTS 或 26）
- **npm ≥ 10**

### 方式一：Windows 桌面版（开箱即用）

下载发布页的 `EvoResearch_0.1.0_x64-setup.exe`（**44 MB**），双击安装：
窗口内是完整 WebUI，后端（Node sidecar）自动启动、随窗口退出自动清理，无需手动配置。

### 方式二：网页版（构建后挂载）

```bash
# 1. 克隆仓库
git clone https://github.com/Karbo123/DSH-EvoResearch.git
cd DSH-EvoResearch

# 2. 构建插件（tsc 双配置 + client bundle）
npm install
npm run build
npm run verify        # 可选：70 个单元测试 + bundle/docs 校验
```

### 方式三：作为 DSH profile bundle 挂载

在任意 DSH 部署中把本仓库 `profiles/evoresearch/` 作为 profile：

```jsonc
// <你的 DSH profile 目录>/package.json
{
  "name": "dsh-profile-evoresearch",
  "private": true,
  "dependencies": {
    "@deepseek-ai/dsh-base": "^0.1.0-rc.6",
    "@deepseek-ai/dsh-web-app": "^0.1.0-rc.6",
    "@evoresearch/dsh-plugin": "file:path/to/DSH-EvoResearch/packages/evoresearch-plugin"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "@evoresearch/dsh-plugin"
      ]
    }
  }
}
```

```bash
npm install            # 在 profile 目录安装依赖
npx @deepseek-ai/dsh --profile <profile名>
```

插件启动后会打印：

```
[evoresearch] client node half apply() 已执行
[evoresearch] host 插件激活（dataRoot: ...）
dsh web: http://127.0.0.1:3080
```

## 🧪 建议：使用独立 DSH 环境测试（避免与现有环境冲突）

如果你目前通过 `npx @deepseek-ai/dsh web` 使用 DSH，**强烈建议为 EvoResearch 建一个独立 profile**：
它与你正在用的环境完全隔离（独立端口、独立会话、独立数据目录），互不干扰。

```bash
# 1. 创建独立 profile 目录（DSH_HOME 默认为 ~/.dsh）
mkdir -p ~/.dsh/profiles/evoresearch
cd ~/.dsh/profiles/evoresearch

# 2. 写入 profile 声明（内容见上方「方式三」），然后
npm install

# 3. 用独立端口启动（默认 3080，用 --port 指定其他端口）
npx @deepseek-ai/dsh --profile evoresearch --port 3081
# 浏览器打开 http://127.0.0.1:3081
```

> 仓库内置了可直接使用的示例 profile：`profiles/evoresearch/`（已声明三个 bundle）。

## ⚙️ 配置

在 DSH 的 `settings.yaml` 中加入 `evoresearch` 段（或设置环境变量）：

```yaml
evoresearch:
  dataRoot: D:\evoresearch        # 部署根目录（projects/ 所在），默认 $EVORESEARCH_DATA_ROOT 或 cwd
  memoryTokenBudget: 6000         # 每轮科研记忆包 token 预算
  auxiliaryModel:                 # 分类/Goal 提取用辅助模型（缺省取当前默认模型）
    provider: deepseek-official
    model: deepseek-v4-flash
  autoStartChannels: false        # 启动时自动启动已配置通道（如 Telegram）
  memoryEnabled: true
```

## 🧠 科研记忆怎么工作

```
用户消息 ──▶ session/event
              │
              ▼
  1. Turn Catalog 立即落库（pending）
  2. 后台：LLM 七类分类（失败自动确定性回退）
           → topic 归一化（复用已有主题）
           → topic state 更新
           → 长程检测 → Goal Contract（v3）
           → 记忆包构建（≤6000 token，RRF 混合召回）
              │
              ▼
  3. 每步模型调用前注入 <research_memory_packet>
  4. turn/end：completed/interrupted + Raw Turn Archive 归档
```

- 记忆数据存放在每个项目的 `.evoresearch-data/memories/`：
  `research_memory.db`（SQLite + FTS5）+ `observations/*.md`（人类可读、git 可管理）；
- 模型可通过 `search_research_history`、`read_research_turn`、`create_observation` 等工具按需读写；
- 既有会话历史会在首次使用时**后台自动回填**索引（断点续做，可重建）。

## 🖥️ 桌面版（Tauri 2 + Node sidecar）

| 项 | 值 |
|---|---|
| 安装包 | `EvoResearch_0.1.0_x64-setup.exe`，**43.7 MB**（NSIS/LZMA） |
| 运行时 | 复用系统 WebView2（Win10/11 内置） |
| 后端 | Node 24 LTS sidecar（独立 DSH_HOME，不污染用户环境） |
| 体积优化 | provider SDK 裁剪（deepseek profile 思路）、node-pty/sharp 仅 win32-x64 |

构建：

```bash
node desktop/scripts/build.mjs
# 产物：desktop/src-tauri/target/release/bundle/nsis/EvoResearch_0.1.0_x64-setup.exe
```

## 🛠️ 开发

```bash
npm install          # 安装 workspace 依赖
npm run build        # tsc 构建（host + client）+ client bundle 打包
npm run typecheck    # 严格类型检查
npm test             # 70 个单元测试（node:test）
npm run verify       # build + test + bundle 校验 + docs 校验
```

```
packages/evoresearch-plugin/   # @evoresearch/dsh-plugin —— 唯一插件包
  ├── src/host/                # Host 插件（workspace/memory/scheduler/channels/...）
  ├── src/client/              # Client 插件（WebUI 科研面板）
  └── cordis.patch.yml         # bundle patch（插入 evoresearch-host / evoresearch-client）
profiles/evoresearch/          # 示例 DSH profile
desktop/                       # Tauri 2 桌面壳 + Node sidecar 打包脚本
docs/                          # 中文文档（架构/功能映射/开发/桌面）
```

## 📚 文档

| 文档 | 内容 |
|---|---|
| [docs/00-decisions.md](docs/00-decisions.md) | 技术选型决策（存储、嵌入模型、桌面方案等） |
| [docs/01-architecture.md](docs/01-architecture.md) | 架构设计与数据流 |
| [docs/02-feature-map.md](docs/02-feature-map.md) | 与上游 EvoScientist 的功能逐条映射表 |
| [docs/03-development.md](docs/03-development.md) | 开发指南（挂载、配置、扩展点） |
| [docs/04-desktop.md](docs/04-desktop.md) | Windows 桌面版构建与体积优化 |

## ❓ FAQ

**Q：为什么基于 deepseek-harness 而不是自己写框架？**
DSH（0.1.0-rc.6）提供会话、模型路由、子代理、审批、技能、MCP 等完整平台能力，
EvoResearch 只做「科研化」扩展（记忆、项目、团队、调度、通道），避免重复造轮子。

**Q：数据存在哪里？**
每个科研项目一个独立目录 `projects/<name>/`，内部 `.evoresearch-data/` 存放
记忆库、观测文件与调度任务；项目本身是 git 仓库，可整体迁移、导入、备份。

**Q：没有网络/API Key 时能用吗？**
分类与记忆包构建在 LLM 失败时自动退化（确定性分类 + 纯 FTS5 检索），不阻塞主回答。

**Q：如何接入更多消息通道？**
实现 `ChannelAdapter` 接口（`src/host/channels/base.ts`）并在 `adapters.ts` 注册即可；
Telegram 已提供完整实现（长轮询，仅需 `EVORESEARCH_TELEGRAM_TOKEN`）。

## 🤝 贡献

欢迎 PR 与 Issue：完善通道适配器、接入本地/远端 Embedding、增强 Research History 面板等。
代码风格：TypeScript 严格模式、中文注释、`node:test` 单测覆盖。

## 📄 License

MIT
