<div align="center">

# 🔬 EvoResearch

**面向科研的自主智能体工作台**

一个开箱即用的本地 AI 科研助手：长期记忆、项目工作区、多智能体团队、技能蒸馏与定时任务，
Windows 桌面版一键安装，网页版即启即用。

[![Release](https://img.shields.io/github/v/release/Karbo123/DSH-EvoResearch?color=2f6bff&label=Release)](https://github.com/Karbo123/DSH-EvoResearch/releases)
[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-24%2B-green)](https://nodejs.org/)
[![Windows](https://img.shields.io/badge/Platform-Windows-0078d6)]()
[![License](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)

**安装包仅 ~45 MB** · 零 Python · 数据完全本地

![EvoResearch 工作台](docs/screenshots/hero-dark.png)

</div>

## ✨ 特性

- 🧠 **科研记忆** —— 每轮对话自动沉淀为结构化记忆，七类分类 + 混合检索，模型调用前自动注入相关记忆包
- 🎯 **长程目标** —— 复杂任务自动拆解为目标合同，按证据推进、可审计、可恢复
- 📂 **项目工作区** —— 每个项目独立目录、独立 git 仓库，数据随项目迁移；一键导入既有目录
- 🤖 **多智能体团队** —— 规划 / 调研 / 编码 / 调试 / 数据分析 / 写作 六位科研角色，可邀请进对话协作
- 🛠️ **技能蒸馏** —— 从对话与记忆中自动提炼可复用技能，审核通过后即成为团队能力
- ⏰ **定时任务** —— 类 cron 调度，结果自动回报到对话
- 🌐 **多通道接入** —— Telegram 开箱即用，Slack / QQ / 微信 / 飞书 / Signal 适配器框架就绪
- ✍️ **富文本对话** —— GFM 表格、任务列表、KaTeX 数学公式、代码高亮、Mermaid 流程图，输入框支持实时预览
- 💬 **斜杠命令** —— `/project` `/memory` `/schedule` `/channel` `/expert` `/autoskills` …，回车即执行
- 🔍 **会话工具** —— 全文搜索、JSON / Markdown 导出、会话置顶与重命名、侧边对话、消息回填编辑、忙时队列编辑
- 🛡️ **安全审批** —— 工具调用需人工批准时逐项展示（工具名 / 理由），Approve 或 Reject 一键决定
- 🪟 **Windows 桌面版** —— 无边框原生窗口，后端随开随关，无需手动配置

## 🚀 快速开始

### Windows 桌面版（推荐）

从 [GitHub Releases](https://github.com/Karbo123/DSH-EvoResearch/releases) 下载
`EvoResearch_0.1.0_x64-setup.exe`，双击安装即可使用。

### 网页版

```bash
git clone https://github.com/Karbo123/DSH-EvoResearch.git
cd DSH-EvoResearch
npm install
npm run build
npx @deepseek-ai/dsh --profile profiles/evoresearch --port 3081
# 打开 http://127.0.0.1:3081
```

### 作为 DSH profile 挂载

在任意 deepseek-harness 部署中，将本仓库的 `@evoresearch/dsh-app` 与
`@evoresearch/dsh-plugin` 加入 profile bundles 即可获得完整科研能力与工作台界面。

## ⚙️ 配置

在 DSH `settings.yaml` 中加入：

```yaml
evoresearch:
  dataRoot: D:\evoresearch        # 部署根目录（projects/ 所在）
  memoryTokenBudget: 6000         # 每轮记忆包 token 预算
  autoStartChannels: false        # 启动时自动启动已配置通道
  visionEnabled: true             # 视觉检查工具（需配置视觉模型）
```

## 🛠️ 开发

```bash
npm install
npm run build        # 插件 + 自定义表面
npm test             # 单元测试
npm run verify       # 构建 + 测试 + bundle / 文档校验
node desktop/scripts/build.mjs   # 桌面安装包
```

| 文档 | 内容 |
|---|---|
| [docs/01-architecture.md](docs/01-architecture.md) | 架构设计与数据流 |
| [docs/02-feature-map.md](docs/02-feature-map.md) | 能力清单 |
| [docs/03-development.md](docs/03-development.md) | 开发指南 |
| [docs/04-desktop.md](docs/04-desktop.md) | 桌面版构建 |

## ❓ FAQ

**数据存在哪里？**
每个项目独立目录 `projects/<name>/`，记忆库、观测文件与调度任务都在
`.evoresearch-data/` 内，项目本身是 git 仓库，可整体迁移与备份。

**没有网络或 API Key 能用吗？**
记忆分类与检索在模型不可用时自动退化到确定性算法，不阻塞主对话。

**如何接入更多消息通道？**
实现 `ChannelAdapter` 接口并注册即可；Telegram 已内置完整实现。

## 📄 License

MIT
