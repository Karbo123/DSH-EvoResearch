# 03 · 开发指南（Development Guide）

## 环境要求

- Windows 10/11（当前仅支持 Windows；Linux/WSL2 暂不支持，见 `docs/04-desktop.md`）
- Node.js ≥ 22.5（推荐 26.x；内置 `node:sqlite` 需要 ≥22.5）
- npm ≥ 10
- （桌面端）Rust 工具链：https://rustup.rs （`rustc`/`cargo` 1.80+）

## 目录结构

```
D:\DSH-Research\
├── package.json                  # npm workspaces 根
├── packages/
│   └── evoresearch-plugin/      # @evoresearch/dsh-plugin（唯一插件包）
│       ├── src/host/             # Host 插件（Node.js 侧全部逻辑）
│       ├── src/client/           # Client 插件（浏览器 WebUI 扩展）
│       ├── src/shared/           # 两侧共享的纯 JSON 类型
│       ├── test/                 # node:test 单元测试
│       └── cordis.patch.yml      # bundle patch（插入 evoresearch-host / evoresearch-client 行）
├── profiles/evoresearch/        # 示例 profile（dsh-base + dsh-web-app + 本插件）
├── desktop/                      # Tauri 2 桌面壳 + Node sidecar 打包脚本
├── docs/                         # 中文文档
└── scripts/                      # 构建/校验脚本
```

## 常用命令

```bash
npm install            # 安装 workspace 依赖
npm run build          # tsup 构建（lib/ 输出 host + client 两个 ESM 入口）
npm run typecheck      # tsc 严格类型检查（host + client 两个 tsconfig）
npm test               # node:test 单元测试（node --import tsx）
npm run verify         # build + test
```

## 插件如何挂载到 DSH

本插件是一个 **profile bundle**（与 `@deepseek-ai/dsh-base`、`dsh-web-app` 同机制）：

1. 构建：`npm run build`；
2. 在目标 DSH 部署的 profile 中引用本包（示例见 `profiles/evoresearch/`）：

   ```jsonc
   // profiles/evoresearch/package.json
   {
     "name": "dsh-profile-evoresearch",
     "private": true,
     "dependencies": { "@evoresearch/dsh-plugin": "file:../../packages/evoresearch-plugin" },
     "dsh": { "profile": { "bundles": [
       "@deepseek-ai/dsh-base",
       "@deepseek-ai/dsh-web-app",
       "@evoresearch/dsh-plugin"
     ] } }
   }
   ```

3. 启动：`npx dsh --profile evoresearch`（或 `dsh web --patch ...`）；
   - `cordis.patch.yml` 自动插入 `evoresearch-host`（Host 插件）与 `evoresearch-client`（浏览器插件）；
   - client 插件由 `dsh-client-modules` 扫描 `dsh.client` 声明纳入 `window.__DSH_BOOT__`。

## 配置项（settings.yaml 的 evoresearch 段）

```yaml
evoresearch:
  dataRoot: D:\evoresearch        # 部署根目录（projects/ 所在），默认 $EVORESEARCH_DATA_ROOT 或 cwd
  memoryTokenBudget: 6000          # 记忆包 token 预算
  auxiliaryModel:                  # 分类/Goal 提取用辅助模型（缺省取当前默认模型）
    provider: deepseek-official
    model: deepseek-v4-flash
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

- 纯逻辑（cron/路径/SQLite/分类器/Goal 判定）全部有 node:test 覆盖；
- 数据库测试使用内存库（`evoresearchDb.openMemory` / `ResearchMemoryStore.openMemory`），不留文件残留；
- 涉及真实 LLM/网络的分支保持可注入（LLM 失败走确定性回退的路径已覆盖）。

## 编码约定

- 注释与文档使用中文；对外 API 描述保持中英关键词并存；
- 顶层只 import（ESM）；不写 `require` 绕行、不用 `eval`；
- Host 插件不 import 任何 `@deepseek-ai/dsh-client-*`；Client 插件不 import node 模块；
- 所有时间戳为毫秒 epoch；JSON 字段命名与上游 EvoScientist snake_case 对齐（wire 兼容）。
