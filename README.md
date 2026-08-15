<div align="center">

# <img src="packages/evoresearch-app/frontend/favicon.svg" alt="EvoResearch" width="30" style="vertical-align: -6px"> EvoResearch

**面向科研的自主智能体工作台**

一个开箱即用的本地 AI 科研助手：长期记忆、项目工作区、多智能体团队、技能蒸馏与定时任务，
Windows 桌面版一键安装，网页版即启即用。

[![Release](https://img.shields.io/github/v/release/Karbo123/DSH-EvoResearch?color=2f6bff&label=Release)](https://github.com/Karbo123/DSH-EvoResearch/releases)
[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-24%2B-green)](https://nodejs.org/)
[![Windows](https://img.shields.io/badge/Platform-Windows-0078d6)]()
[![License](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)

**零 Python** · 数据完全本地

![EvoResearch 工作台](docs/screenshots/hero-dark.png)

</div>

## ✨ 特性

- <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: -3px"><path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"></path><path d="M9 13a4.5 4.5 0 0 0 3-4"></path><path d="M6.003 5.125A3 3 0 0 0 6.401 6.5"></path><path d="M3.477 10.896a4 4 0 0 1 .585-.396"></path><path d="M6 18a4 4 0 0 1-1.967-.516"></path><path d="M12 13h4"></path><path d="M12 18h6a2 2 0 0 1 2 2v1"></path><path d="M12 8h8"></path><path d="M16 8V5a2 2 0 0 1 2-2"></path><circle cx="16" cy="13" r=".5"></circle><circle cx="18" cy="3" r=".5"></circle><circle cx="20" cy="21" r=".5"></circle><circle cx="20" cy="8" r=".5"></circle></svg> **科研记忆** —— 每轮对话自动沉淀为结构化记忆，七类分类 + 混合检索，模型调用前自动注入相关记忆包
- <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: -3px"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="6"></circle><circle cx="12" cy="12" r="2"></circle></svg> **长程目标** —— 复杂任务自动拆解为目标合同，按证据推进、可审计、可恢复；合同全文审阅 + 修改提案接受/拒绝（版本化）
- <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: -3px"><path d="M18 19a5 5 0 0 1-5-5v8"></path><path d="M9 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v5"></path><circle cx="13" cy="12" r="2"></circle><circle cx="20" cy="19" r="2"></circle></svg> **项目工作区** —— 每个项目独立目录、独立 git 仓库，数据随项目迁移；一键新建或导入既有目录
- <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: -3px"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><path d="M16 3.128a4 4 0 0 1 0 7.744"></path><path d="M22 21v-2a4 4 0 0 0-3-3.87"></path><circle cx="9" cy="7" r="4"></circle></svg> **多智能体团队** —— 规划 / 调研 / 编码 / 调试 / 数据分析 / 写作 六位科研角色，可邀请进对话协作
- <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: -3px"><path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z"></path><path d="M22 10v6"></path><path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5"></path></svg> **技能蒸馏** —— 从对话与记忆中自动提炼可复用技能，审核通过后即成为团队能力；技能市场一键浏览
- <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: -3px"><circle cx="12" cy="12" r="10"></circle><path d="M12 6v6l4 2"></path></svg> **定时任务** —— 可视化 cron 构建器 + 内置模板，类 cron 调度，结果自动回报到对话
- <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: -3px"><path d="M17 19a1 1 0 0 1-1-1v-2a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2a1 1 0 0 1-1 1z"></path><path d="M17 21v-2"></path><path d="M19 14V6.5a1 1 0 0 0-7 0v11a1 1 0 0 1-7 0V10"></path><path d="M21 21v-2"></path><path d="M3 5V3"></path><path d="M4 10a2 2 0 0 1-2-2V6a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2a2 2 0 0 1-2 2z"></path><path d="M7 5V3"></path></svg> **多通道接入** —— Telegram 开箱即用，Slack / QQ / 微信 / 飞书 / Signal 适配器框架就绪
- <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: -3px"><path d="M13 21h8"></path><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"></path></svg> **富文本对话** —— GFM 表格、任务列表、KaTeX 数学公式、代码高亮、Mermaid 流程图，输入框支持实时预览
- <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: -3px"><path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3"></path></svg> **斜杠命令** —— `/project` `/memory` `/schedule` `/channel` `/expert` `/autoskills` …，回车即执行
- <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: -3px"><path d="m21 21-4.34-4.34"></path><circle cx="11" cy="11" r="8"></circle></svg> **会话工具** —— 全文搜索、JSON / Markdown 导出、会话置顶与标签、重命名、删除、**归档（隐藏保留可恢复）**、侧边对话、消息回填编辑、忙时队列编辑与转向
- <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: -3px"><rect width="18" height="18" x="3" y="3" rx="2"></rect></svg> **运行控制** —— 一键停止当前回复，随时中断长任务
- <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: -3px"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"></path><path d="m9 12 2 2 4-4"></path></svg> **安全审批** —— 工具调用需人工批准时逐项展示（工具名 / 理由），Approve 或 Reject 一键决定；模型提问可在界面直接作答
- <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: -3px"><path d="M4 6h16"></path><path d="M4 12h16"></path><path d="M4 18h10"></path></svg> **多模型配置** —— 设置面板左侧导航：写代码模型三档（轻量/均衡/深度，可一键设为默认）、图片识别、图片生成、语音识别（API / 本地引擎预留），左上角返回
- <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: -3px"><rect width="20" height="14" x="2" y="3" rx="2"></rect><line x1="8" x2="16" y1="21" y2="21"></line><line x1="12" x2="12" y1="17" y2="21"></line></svg> **Windows 桌面版** —— 无边框原生窗口，后端随开随关，无需手动配置

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
