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
│   ├── evoresearch-plugin/      # @evoresearch/dsh-plugin（科研能力插件）
│   │   ├── src/host/             # Host 插件（Node.js 侧全部逻辑）
│   │   ├── src/shared/           # 两侧共享的纯 JSON 类型
│   │   ├── test/                 # node:test 单元测试
│   │   └── cordis.patch.yml      # bundle patch（evoresearch-host 行；client 行默认停用）
│   └── evoresearch-app/         # @evoresearch/dsh-app（自定义浏览器表面 bundle）
│       ├── src/runtime.ts        # app-runtime 行（serve dist / webRuntime / URL 打印）
│       ├── src/client.ts         # 工作台 UI 插件（root slot + layout 服务）
│       ├── src/directory-picker.ts # directoryPicker 服务桩（kind: none）
│       ├── frontend/             # 前端外壳（index.html + AppWebEntry 入口 + stub）
│       └── vendor/               # vendored 官方 client-modules 源码（构建 alias）
├── profiles/evoresearch/        # 示例 profile（dsh-base + dsh-app + 插件）
├── desktop/                      # Tauri 2 桌面壳 + Node sidecar 打包脚本
├── docs/                         # 中文文档
└── scripts/                      # 构建/校验脚本（build-client / build-app / verify-bundle ...）
```

## 常用命令

```bash
npm install            # 安装 workspace 依赖
npm run build          # 插件（tsc + client bundle）+ 表面（node half + client + frontend dist）
npm run typecheck      # tsc 严格类型检查（插件两个 tsconfig）
npm test               # node:test 单元测试（node --import tsx）
npm run verify         # build + test + bundle 校验 + docs 校验
node scripts/build-app.mjs        # 只构建表面包（@evoresearch/dsh-app）
node desktop/scripts/bundle-sidecar.mjs --skip-download   # 重新组装桌面 sidecar
```

## 插件如何挂载到 DSH

本仓库是 **profile bundle 组合**（与 `@deepseek-ai/dsh-base` 同机制）：`dsh-base`（引擎）+
`@evoresearch/dsh-app`（自定义浏览器表面）+ `@evoresearch/dsh-plugin`（科研能力）：

1. 构建：`npm run build`；
2. 在目标 DSH 部署的 profile 中引用（示例见 `profiles/evoresearch/`）：

   ```jsonc
   // profiles/evoresearch/package.json
   {
     "name": "dsh-profile-evoresearch",
     "private": true,
     "dependencies": {
       "@evoresearch/dsh-app": "file:../../packages/evoresearch-app",
       "@evoresearch/dsh-plugin": "file:../../packages/evoresearch-plugin"
     },
     "dsh": { "profile": { "bundles": [
       "@deepseek-ai/dsh-base",
       "@evoresearch/dsh-app",
       "@evoresearch/dsh-plugin"
     ] } }
   }
   ```

3. 启动：`npx dsh --profile evoresearch`，浏览器打开打印的 `evoresearch: http://127.0.0.1:<port>`：
   - 打开即是 **EvoResearch 工作台**（自定义表面，无官方 DSH 外壳）；
   - host 侧：`evoresearch-host`（插件）注册科研服务与工具；
   - 浏览器侧：`evoresearch-ui`（@evoresearch/dsh-app 的 client 面）注册 root slot 渲染工作台。

> 若需要在官方 DSH 表面（dsh-web-app）中使用科研能力：把 `@evoresearch/dsh-plugin`
> 的 `evoresearch-client` 行取消 disabled（`cordis.patch.yml`），bundles 换回官方
> `dsh-web-app` 即可 —— 旧 slot UI（侧栏入口/面板/记忆提示条）仍可用。

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
