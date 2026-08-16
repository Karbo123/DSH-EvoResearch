# EvoResearch 自我迭代项目交接文档

> 最后更新：2026-08-16 08:10（本轮：全面审查 + Bug 修复 + 实验管理/标签栏/复制历史 + 清理）
> 接手者请先阅读本文全文，再继续工作。

---

## 一、项目概述

**EvoResearch** 是一个面向科研的自主 AI 智能体工作台，基于 [deepseek-harness (DSH)](https://github.com/Karbo123/DSH-EvoResearch) 引擎构建。

- 仓库位置：`D:\DSH-Research`
- 相关项目：`D:\ResearchOS`（.env 配置参考）；`D:\EvoScientist\Transplantation.md`（移植规范）
- 核心包：`packages/evoresearch-app`（前端 UI + node half）和 `packages/evoresearch-plugin`（host 后端插件）
- 桌面版：`desktop/` 目录（Tauri 壳 + sidecar，sidecar 的 `dist/app/node_modules/@evoresearch/*` 是**目录联接**，build 后直接生效）

## 二、如何启动

```bash
# 1. 构建（修改代码后必须执行）
cd D:\DSH-Research
npm run build

# 2. 启动 Web 服务（端口自动分配）
cd D:\DSH-Research\desktop\sidecar\dist\app
$env:DSH_HOME = 'D:\DSH-Research\desktop\sidecar\dist\app'   # 必须设，否则找不到 profile
$env:EVORESEARCH_DATA_ROOT = 'D:\evoresearch'                # 部署数据根（projects/ 所在）
$env:NEW_API_API_KEY = 'sk-ehuqNkIOuBzeR9GsWDHRqchtHYqFB7hBrsTK5joJJ3X3kQcx'
node node_modules/@deepseek-ai/dsh/lib/bin.js --profile evoresearch --port 0
```

- 模型代理：`http://127.0.0.1:3000/v1`（已有独立进程，端口 3000）
- 默认模型：`deepseek-v4-flash`；视觉：`mimo-v2.5`
- 端口自动选择：`--port 0`（DSH 随机分配空闲端口），launch.js 把端口写入 `%LOCALAPPDATA%/EvoResearch/port.json`
- **欢迎页首条消息会自动创建科研项目**（`projects/<slug>/`，AI 生成 slug，LLM 失败确定性回退），会话工作区 = 项目目录；新对话继承当前项目

### 验证模式（CDP 无头 Edge）

```bash
# sidecar 启动后（端口写在 EVORESEARCH_PORT_FILE）
node scripts/verify-newfeatures.mjs <CDP端口> <APP端口>   # 本轮功能 E2E
```
- Edge：`--headless=new --remote-debugging-port=46299`（端口区间 35000-47000）
- 数据根用独立临时目录（如 `D:\evoresearch-e2e-*`）避免污染真实数据

## 三、本轮已完成（2026-08-16 全面审查轮）

### 3.1 修复 Bug #3（最高优先级）：系统提示/runtime context 泄漏到聊天界面

**文件**：`packages/evoresearch-app/src/client/index.ts`（节点过滤处，原第 236 行附近）

**修复**：节点过滤从 `visibility === 'visible'` 扩展为内容前缀过滤——`isSystemLeak()` 跳过以
`Current runtime context` / `Current DSH file policy` / `Approval prompts are disabled` /
`<code_mode>` / `<research_memory_packet>` / `<identity_profile>` 开头的文本节点（含 blocks 与
data.text 两种形态）。E2E 验证：真实对话前后 `document.body.innerText` 无任何泄漏前缀。

### 3.2 验证 Bug #1 / #2 / #4（工作区中的修复已提交）

- **Bug #1**（欢迎页首条消息被静默丢弃）：`sendMessage` 无活跃会话时自动创建会话并轮询 binding
  就绪后 prompt。已实测：欢迎页发消息 → 正常回复。
- **Bug #2 / #4**（记忆工具 inject 报错）：`workspaceOf` 改用 `exec.agent.session`（带 try/catch
  回退）。已实测：回复中模型主动调用记忆检索/观察工具正常（"先读一下之前的讨论"）。

### 3.3 新功能 §5.1 实验管理（Git 式分支/回退/checkpoint）

**后端**：`packages/evoresearch-plugin/src/host/experiments.ts`（ExperimentService）
- 存储：`<workspace>/.evoresearch-data/experiments/<id>.json`（manifest：branches/phases/checkpoints）
- 快照：`<workspace>/.evoresearch-data/experiments/snapshots/<expId>/<checkpointId>/`
  （复制工作区文件，跳过 `.git/.evoresearch-data/node_modules/.venv/dist` 等；上限 256MB）
- 操作：create / update / addPhase / checkpoint（快照+备注+关联会话）/ rollback（恢复快照文件，
  标记 rolledBack）/ branch（从检查点分叉，携带截至该点的阶段副本）/ switchBranch / delete
- Remote API：`api.ts` 的 `experiments*` 方法；HTTP：`workspace-api.ts` 的 `experiments-*` 端点
- 工作区校验：必须在部署根（dataRoot）或其子目录内，否则拒绝（前端显示友好提示）

**前端**：`packages/evoresearch-app/src/client/experiments.ts`（ExperimentsPanel）
- 左侧栏新增「实验」入口（threadlist.ts MENU + SideView 'experiments'）
- 面板：实验列表 → 详情（分支 chips 切换 / 阶段时间线 / 检查点卡片：回退（两段确认）/
  创建分支 / 跳转会话 / 删除（两段确认））；新增阶段、创建检查点均为内联表单
- 样式：styles.ts `.evo-exp-*`；i18n：`experiments` 等 30+ 键

### 3.4 新功能 §5.2 浏览器式标签栏

**前端**：`packages/evoresearch-app/src/client/index.ts`（标签栏在聊天视图顶部）
- 标签类型：对话（固定不可关）/ PDF 预览（iframe + `/evoresearch/fs/file`，sandbox）/ 文本编辑器
  （textarea + 保存按钮 + Ctrl+S，写回工作区）
- 操作：`+` 菜单「打开 PDF…」（上传到 `papers/` 后开标签）与「新建文件」（支持子目录，如
  `notes/draft.md`）；标签可关闭/切换；状态在会话内保持
- 工作区文件浏览器（workspace-files.ts）文件查看器新增「在标签页打开」按钮（派发
  `evo-open-tab` 自定义事件）
- **注意**：标签激活用 `tabsRef` 同步镜像（React 18 setState updater 延迟执行，不能在 updater
  里捕获 targetId）

### 3.5 新功能 §5.3 复制历史到新对话（fork 提升为主聊天）

**前端**：`packages/evoresearch-app/src/client/index.ts` + `threadlist.ts`
- Recents 行新增复制按钮 → `manager.fork` 创建独立会话（继承全部历史）→ 该 id 进入
  `promotedIds`（localStorage `evoresearch-promoted` 持久化）→ 从侧聊集合剔除、出现在 Recents
  成为主聊天（ThreadList/Inspector 双处过滤）
- 官方 fork 语义约束：源会话必须有**已完成轮次**（运行中点击会失败并显示错误，轮次结束后可用）
- Side Chat（继承/空白）原实现保留并验证正常

### 3.6 项目自动创建接线（此前只有实现没有调用）

- `api.ts` 新增 `projectAutoCreate`（模型取当前默认选择 → auxiliaryModel → new-api 回退）
- `workspace-api.ts` 新增 `projects-auto` 端点
- `index.ts`：欢迎页首条消息先自动建项目（AI slug），会话以项目目录为 cwd 创建；
  `startNewChat` 继承当前会话的项目 cwd
- 效果：记忆/实验/工作区文件全部落在 `projects/<slug>/` 下

### 3.7 其他修复

- `/evoresearch/fs/write`：允许空文本（新建空文件）+ 自动创建父目录（子目录编辑器/PDF 可用）
- 实验面板：刷新保留旧列表（避免详情/提示随加载态卸载）；回退成功提示常驻 5s
- i18n：删除重复 `back` 键（消除 esbuild duplicate-key 警告）

## 四、E2E 验证结果（verify-newfeatures.mjs，真实模型对话）

| 项目 | 结果 |
|------|------|
| 欢迎页发消息 → 专业回复（含记忆检索/观察工具调用） | ✅ |
| 系统 XML 泄漏（`<code_mode>` 等 6 前缀） | ✅ 零泄漏 |
| 复制历史到新对话（轮次结束后） | ✅ 新主聊天出现，侧聊面板不显示 |
| 标签栏：新建 `notes/draft.md` → 编辑 → 保存回读 | ✅ |
| PDF 标签：写最小 PDF → 事件开标签 → iframe 渲染 | ✅ |
| 标签关闭/切换 | ✅ |
| 实验：新建/阶段/检查点（快照落盘 3 文件）/回退（rolledBack）/分支/切分支/删除 | ✅ |
| 项目自动创建（AI slug `rag-4090-*`） | ✅ |
| 多轮续聊（同会话追问文献）→ 引用真实基准（HALLMARK/FaithfulRAG/ARES）并承接前文给出"修订后的推荐" | ✅ |

## 五、已知限制 / 后续建议

1. **exe 未重新构建**：本轮为功能级更新，按策略等下次大更新或用户指示再发布（流程：先 kill
   sidecar → `build.mjs --skip-download` → 重拷 `~/.dsh/.credentials.yaml` → gh release upload）
2. **图片生成/语音识别**仍为配置预留（无实际工具）；本地语音引擎未实现（ResearchOS 同为 API 模式）
3. **实验快照**只复制文件，不含数据库类状态（记忆/会话在 `.evoresearch-data` 内，天然随项目迁移）
4. **React dev 警告**：`Each child in a list should have a unique "key" prop` 为代码库既有的
   静态 children 数组模式（ThreadList/UserBubble 等），dev-only 噪音，构建无警告
5. 会话默认 cwd 在未建项目时为进程目录（dist/app），实验面板会提示"未绑定项目工作区"；
   欢迎页发消息后自动创建项目即解决

## 六、关键文件索引

| 文件路径 | 说明 |
|----------|------|
| `packages/evoresearch-app/src/client/index.ts` | 前端主入口：节点过滤（Bug#3）、标签栏、复制历史、自动建项目 |
| `packages/evoresearch-app/src/client/experiments.ts` | 实验管理面板（新建/阶段/检查点/回退/分支/删除） |
| `packages/evoresearch-app/src/client/threadlist.ts` | 左侧栏：实验入口、复制历史按钮、promotedIds 过滤 |
| `packages/evoresearch-app/src/client/workspace-files.ts` | 文件浏览器「在标签页打开」 |
| `packages/evoresearch-app/src/workspace-api.ts` | /evoresearch/fs/* 端点（experiments-*、projects-auto、write 增强） |
| `packages/evoresearch-plugin/src/host/experiments.ts` | 实验服务（manifest + 快照 + 回退 + 分支） |
| `packages/evoresearch-plugin/src/host/api.ts` | Remote API（experiments*、projectAutoCreate） |
| `packages/evoresearch-plugin/src/host/memory/tools.ts` | workspaceOf（Bug #2/#4 修复） |
| `packages/evoresearch-plugin/src/shared/types.ts` | Experiment* 类型 |
| `scripts/verify-newfeatures.mjs` | 本轮功能 E2E 验证脚本 |
| `scripts/verify-mobile-dark.mjs` | 移动端（375px）与暗色模式探测 |
| `scripts/verify-multiturn.mjs` | 多轮续聊 E2E（记忆一致性/web_search/Markdown 渲染/泄漏复检） |

## 七、重要 API 与模型配置

| 用途 | 模型/地址 | API Key |
|------|-----------|---------|
| 默认文本/代码 | `deepseek-v4-flash` @ `http://127.0.0.1:3000/v1` | 见 `D:\ResearchOS\.env` / 部署 `settings.yaml` |
| 视觉 | `mimo-v2.5` @ `http://127.0.0.1:3000/v1` | 同上 |
| 图片生成 | `gpt-image-2-official` @ `https://api.apib.ai/v1/images/generations` | 同上 |
| 语音识别 | `whisper-large-v3-turbo` @ `https://api.groq.com/openai/v1` | 同上 |
| 词嵌入 API | `https://ai.gitee.com/v1` | 同上 |

**注意**：密钥不要写入仓库（GitHub push protection 会拦截）；完整配置参考 `D:\ResearchOS\.env` 与 `desktop/sidecar/dist/app/settings.yaml`。
