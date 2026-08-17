# 03 · 开发指南（Development Guide）

## 环境要求

  Windows 10/11（当前仅支持 Windows；Linux/WSL2 暂不支持，见 `docs/04 desktop.md`）
  Node.js ≥ 22.5（推荐 26.x；内置 `node:sqlite` 需要 ≥22.5）
  npm ≥ 10
  （桌面端）Rust 工具链：https://rustup.rs （`rustc`/`cargo` 1.80+）

## 目录结构

```
D:\DSH Research\
├── package.json                  # npm workspaces 根
├── packages/
│   ├── evoresearch plugin/      # @evoresearch/dsh plugin（科研能力插件）
│   │   ├── src/host/             # Host 插件（Node.js 侧全部逻辑）
│   │   ├── src/shared/           # 两侧共享的纯 JSON 类型
│   │   ├── test/                 # node:test 单元测试
│   │   └── cordis.patch.yml      # bundle patch（evoresearch host 行；client 行默认停用）
│   └── evoresearch app/         # @evoresearch/dsh app（自定义浏览器表面 bundle）
│       ├── src/runtime.ts        # app runtime 行（serve dist / webRuntime / URL 打印）
│       ├── src/client.ts         # 工作台 UI 插件（root slot + layout 服务）
│       ├── src/directory picker.ts # directoryPicker 服务桩（kind: none）
│       ├── frontend/             # 前端外壳（index.html + AppWebEntry 入口 + stub）
│       └── vendor/               # vendored 官方 client modules 源码（构建 alias）
├── profiles/evoresearch/        # 示例 profile（dsh base + dsh app + 插件）
├── desktop/                      # Tauri 2 桌面壳 + Node sidecar 打包脚本
├── docs/                         # 中文文档
└── scripts/                      # 构建/校验脚本（build client / build app / verify bundle ...）
```

## 常用命令

```bash
npm install            # 安装 workspace 依赖
npm run build          # 插件（tsc + client bundle）+ 表面（node half + client + frontend dist）
npm run typecheck      # tsc 严格类型检查（插件两个 tsconfig）
npm test               # node:test 单元测试（node   import tsx）
npm run verify         # build + test + bundle 校验 + docs 校验
node scripts/build app.mjs        # 只构建表面包（@evoresearch/dsh app）
node desktop/scripts/bundle sidecar.mjs   skip download   # 重新组装桌面 sidecar
```

## 插件如何挂载到 DSH

本仓库是 **profile bundle 组合**（与 `@deepseek ai/dsh base` 同机制）：`dsh base`（引擎）+
`@evoresearch/dsh app`（自定义浏览器表面）+ `@evoresearch/dsh plugin`（科研能力）：

1. 构建：`npm run build`；
2. 在目标 DSH 部署的 profile 中引用（示例见 `profiles/evoresearch/`）：

   ```jsonc
   // profiles/evoresearch/package.json
   {
     "name": "dsh profile evoresearch",
     "private": true,
     "dependencies": {
       "@evoresearch/dsh app": "file:../../packages/evoresearch app",
       "@evoresearch/dsh plugin": "file:../../packages/evoresearch plugin"
     },
     "dsh": { "profile": { "bundles": [
       "@deepseek ai/dsh base",
       "@evoresearch/dsh app",
       "@evoresearch/dsh plugin"
     ] } }
   }
   ```

3. 启动：`npx dsh   profile evoresearch`，浏览器打开打印的 `evoresearch: http://127.0.0.1:<port>`：
     打开即是 **EvoResearch 工作台**（自定义表面，无官方 DSH 外壳）；
     host 侧：`evoresearch host`（插件）注册科研服务与工具；
     浏览器侧：`evoresearch ui`（@evoresearch/dsh app 的 client 面）注册 root slot 渲染工作台。

> 若需要在官方 DSH 表面（dsh web app）中使用科研能力：把 `@evoresearch/dsh plugin`
> 的 `evoresearch client` 行取消 disabled（`cordis.patch.yml`），bundles 换回官方
> `dsh web app` 即可 —— 旧 slot UI（侧栏入口/面板/记忆提示条）仍可用。

## 平台适配层（PLAT-01 / PLAT-02）

**目标：科研模块只依赖 `src/host/platform/adapters.ts` 暴露的适配接口，不直接
散落 DSH 服务名与调用形态；DSH 版本升级只改适配层。**

本插件运行在 DSH 0.1.0-rc.6 之上（`ctx.sessions` / `ctx.llm` / `ctx.tools` /
`ctx.approval` / `ctx.skills` / `ctx.subagents` 等 Cordis 服务）。平台目标能力
（长上下文保护、session query、分层 Skill、MCP 生命周期、子代理、多模型
Fallback、调度、多通道）部分已由 DSH 提供、部分需要适配接入。适配层由两个文件
组成：

| 文件 | 职责 |
|---|---|
| `src/host/platform/capabilities.ts` | `PlatformCapability` 枚举（15 项：sessions/models/tools/approval/sandbox/events/plugins/compaction/toolPruning/sessionQuery/skills/mcp/subagents/scheduler/channels）；`DSH_CAPABILITY_MATRIX` 静态能力矩阵（能力 → rc.6 现状 available/partial/missing → 适配层策略 → 降级路径）；`probeCapabilities(ctx)` 运行时探测（`ctx.get` 对应服务是否存在，返回实际可用集） |
| `src/host/platform/adapters.ts` | `createPlatformAdapters(ctx)` 返回统一适配接口：`adapters.sessions`（get/create/fork/readLog/flush）、`adapters.models`（list/current/route）、`adapters.tools`（list/get/invoke/register）、`adapters.approval`、`adapters.sandbox`、`adapters.events`（on/once 统一返回 disposer）、`adapters.plugins`，外加 `has/require/summarize` |

降级行为约定（每个适配器对缺失能力必须给出明确行为）：

- 构造时汇总缺失/部分能力并 `console.warn`（`createPlatformAdapters(ctx, { quiet: true })` 可只收集不打印）；
- 读操作（list/get/current）缺失时返回空值；
- 写/执行操作（create/fork/invoke/register）缺失时抛 `PlatformCapabilityUnavailableError`；
- `approval` 缺失时 fail-closed 返回 `unavailable`（视为拒绝），显式
  `allowMissing: true` 才返回 `allowed-once`（degraded: true）；
- `sandbox` 在 rc.6 无独立服务，只有 `tools.restrict/guard`；缺失时 restrict/guard
  降级为 no-op。

使用示例（与 `host/index.ts` 的服务构造风格一致，构造参数传 ctx）：

```ts
import { createPlatformAdapters } from './platform/adapters.js'

const adapters = createPlatformAdapters(ctx)
console.log(`[evoresearch] 平台能力: ${adapters.summarize()}`)
if (adapters.has('sessionQuery')) {
  // MEM/RET 层跨会话检索
}
```

约定：

1. 新增科研模块需要 DSH 能力时，先查 `DSH_CAPABILITY_MATRIX` 与探测结果，再经
   `adapters.*` 访问；禁止在科研模块里直接 `ctx.get('sessions')` 等散落 DSH 细节。
2. `compaction` / `toolPruning` / `sessionQuery` / `skills` / `mcp` / `subagents` /
   `scheduler` / `channels` 由各科研模块按探测结果接入（CTX 压缩与裁剪、MEM 检索、
   AutoSkills、teams 子代理、SchedulerService、ChannelManager），适配层只负责探测
   与上报；`channels` / `mcp` 是插件层能力（DSH 无对应服务）。
3. 升级 DSH 版本时只改 `capabilities.ts`（矩阵行 + 服务名映射）与 `adapters.ts`
   （rc.6 服务最小结构类型），并重新核对 `summarize()` 输出。

## 配置项（settings.yaml 的 evoresearch 段）

```yaml
evoresearch:
  dataRoot: D:\evoresearch        # 部署根目录（projects/ 所在），默认 $EVORESEARCH_DATA_ROOT 或 cwd
  memoryTokenBudget: 6000          # 记忆包 token 预算
  auxiliaryModel:                  # 分类/Goal 提取用辅助模型（缺省取当前默认模型）
    provider: deepseek official
    model: deepseek v4 flash
  autoStartChannels: false         # 启动时自动启动已配置通道
  memoryEnabled: true
```

## 如何新增一个通道适配器

1. 实现 `ChannelAdapter`（`src/host/channels/base.ts`）：`id/name/isConfigured/start/stop/send`；
2. 在 `src/host/channels/adapters.ts` 的 `builtinAdapters()` 注册；
3. 需要外部依赖时：放入可选依赖并在 `start()` 中显式报错（保持主包零强制依赖）。

## 如何新增一个模型工具

在 `src/host/memory/tools.ts` 的 `registerMemoryTools` 内按 `ToolDefinition` 注册即可：
`{ name, description, parameters(JSON Schema), output: { schema, render }, execute(args, exec) }`。
工具自动随插件卸载而注销（disposer 组合）。

## 如何新增一个 Remote API（Client 可调）

在 `src/host/api.ts` 的 `evoresearchApiService` 内新增 `@Remote('methodName')` 方法；
Client 侧以 `ctx.remote.evoresearch.methodName(args)` 调用（wire 为 JSON，返回必须可序列化）。

## 测试约定

  纯逻辑（cron/路径/SQLite/分类器/Goal 判定）全部有 node:test 覆盖；
  数据库测试使用内存库（`evoresearchDb.openMemory` / `ResearchMemoryStore.openMemory`），不留文件残留；
  涉及真实 LLM/网络的分支保持可注入（LLM 失败走确定性回退的路径已覆盖）。

### 测试隔离约定（BASE-02）

**目标：任何测试都不得读写用户真实资料** —— 真实 DSH_HOME、真实数据根（如 `D:\evoresearch`）、
`profiles/`、`desktop/sidecar/dist/app` 与用户项目目录一律禁止出现在测试路径中。

统一做法（新增测试必须遵守）：

1. **纯逻辑/数据库测试**：一律用内存库（`evoresearchDb.openMemory`、
   `ResearchMemoryStore.openMemory`），不留文件残留。
2. **需要真实文件系统或 DSH_HOME 的脚本测试**：用 `fs.mkdtempSync(path.join(os.tmpdir(), '<前缀>-'))`
   创建临时目录，把 `session.jsonl` 等夹具写进临时目录，结束后 `fs.rmSync(tmp, { recursive: true, force: true })`
   清理（参考 `scripts/test-graph-*.mjs` 的做法）。
3. **需要完整 DSH 实例的 E2E**：数据根使用独立临时目录（如 `D:\evoresearch-e2e-*`，见 HANDOFF.md「验证模式」），
   部署/工作区目录用仓库内 `.tmp-e2e/dev`，浏览器用户目录用 `.tmp-e2e/edge-*`（参考 `scripts/verify-*.mjs`）。
   严禁指向 `%USERPROFILE%`、真实 `D:\evoresearch` 等真实位置。
4. **环境变量**：`process.env.DSH_HOME` 必须在夹具创建之后、任何服务/存储读取之前设置；
   `EVORESEARCH_DATA_ROOT` 必须指向临时数据根；测试结束（含失败路径）后不依赖这些变量残留。
5. **清理保证**：临时目录的删除要覆盖异常路径（`try/finally` 或脚本退出前统一清理），
   不允许测试在磁盘上留下可重建的临时项目、数据库或会话日志。
6. **断言完整性**：脚本类测试末尾的期望计数必须与实际断言数一致（参考基线中
   `test-graph-extract/global.mjs` 期望计数过期的教训已纳入当前图语义回归检查）。

### Cordis disposer 清单约定（BASE-03）

**目标：新增服务的所有副作用都必须可卸载**；插件 stop / update 后不得残留事件监听、注入、
timer、进程监听或动态注册。

凡新增以下任一项，都必须把它的 disposer 收集进 `ctx.effect()` 的返回函数（当前插件入口的
标准做法见 `src/host/index.ts` 第 9-10 步：`disposeMemory/disposeScheduler/...` 全部在
`ctx.effect(() => () => { ... })` 中调用）：

| 副作用类型 | 约定 | 示例 |
|---|---|---|
| 事件监听 | `ctx.on(...)` 的返回值必须保存并在卸载时调用 | `src/host/index.ts` 的 `disposeRewindHook`；`memory/index.ts` 的 `session/event` 订阅 |
| context contributor | `systemPrompt.context({...})` 返回的卸载函数必须调用 | `disposeCodeMode` / `disposeEnvHint` / `disposeShellEnv` |
| timer | 优先用 `ctx.setInterval/ctx.setTimeout`（随 ctx 自动回收）；自建 `setTimeout` 句柄必须登记并在卸载时 `clearTimeout` | `rewindTimers` Map + `disposeRewindTimers()` |
| 进程监听 | `process.on(...)` 必须配对 `process.off(...)`，仅在 apply 顶层注册、stop 时移除 | — |
| 动态注册 | `tools.register`、`commands.register`、Remote API 注册等返回的 disposer 必须被收集 | `registerMemoryTools`、`registerCommands`、`disposeVision` |
| 长轮询/文件监听 | channels 轮询、`fs.watch` 等必须在 stop 时 close/abort，避免句柄泄漏 | `channels.attach(ctx)` 的停止路径 |
| 子进程/后台任务 | 保存句柄并在 stop 时 kill/abort | — |

验收标准：

- 插件 stop 后重复 stop 幂等，无未捕获事件、无残留 timer 继续触发；
- 插件 update（旧版本卸载）后旧版本的 context 注入、工具与监听全部消失；
- 新增服务在交付时附带“卸载无残留”的检查（可在单测中构造最小 ctx，调用 `ctx.stop()` 后断言无副作用）。

## 编码约定

  注释与文档使用中文；对外 API 描述保持中英关键词并存；
  顶层只 import（ESM）；不写 `require` 绕行、不用 `eval`；
  Host 插件不 import 任何 `@deepseek ai/dsh client *`；Client 插件不 import node 模块；
  所有时间戳为毫秒 epoch；JSON 字段命名使用 snake_case（wire 兼容）。
