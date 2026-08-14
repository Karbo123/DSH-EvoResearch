# 04 · Windows 桌面版（Desktop）

## 目标

- 网页版：DSH Web GUI（`dsh web`）—— 浏览器直接使用；
- 桌面版：**Tauri 2**（WebView2 壳）+ **Node sidecar**（后端进程）；
- 打包体积**最小化**：复用系统 WebView2（Windows 10/11 内置），安装包目标 **< 60MB**。

## 为什么 Tauri + Node sidecar（体积账）

| 方案 | 安装包体积 | 说明 |
|---|---|---|
| Electron | ~100MB+ | 自带 Chromium，否决 |
| PyInstaller onefile（原 EvoScientist） | 100MB+ | 本项目不用 Python |
| **Tauri 2 + Node sidecar** | **~40-60MB** | WebView2 系统复用（壳 ~5-15MB）+ node.exe（LZMA ~35-45MB）+ 应用代码 |
| Node SEA 单文件 exe | 80-120MB | 原生模块（node-pty 等）外置复杂度高，备选 |

Node.js 是硬约束（后端必须 NodeJS），因此体积下限 ≈ node.exe 压缩后体积；
相比 Electron 已缩小约 60%，相比原 Python 方案缩小约 50%+。

## 目录结构（desktop/）

```
desktop/
├── src-tauri/                 # Tauri 2（Rust）
│   ├── src/main.rs            # 壳入口：创建窗口、加载本地 DSH web 服务 URL、sidecar 生命周期
│   ├── tauri.conf.json        # 窗口/打包配置（NSIS 安装器、图标）
│   └── Cargo.toml
├── sidecar/                   # Node 后端打包（构建时生成，不入库）
│   ├── node.exe               # 官方 Windows x64 Node（压缩前 ~100MB，LZMA 后 ~35-45MB）
│   └── app/                   # dsh + 插件 + profile 的 standalone 目录（npm pack / npm ci --omit=dev）
├── scripts/
│   ├── bundle-sidecar.mjs     # 组装 sidecar（下载 node、部署依赖、写 launch 脚本）
│   └── build.mjs              # 一键：npm build → bundle-sidecar → cargo tauri build
└── icons/                     # 应用图标（.ico/.png）
```

## 构建步骤

```bash
# 1. 构建插件与 web 资源
npm run build

# 2. 组装 Node sidecar（node.exe + standalone 应用目录 + 启动脚本）
node desktop/scripts/bundle-sidecar.mjs

# 3. Tauri 构建（NSIS 安装器，体积最小）
cd desktop/src-tauri
cargo tauri build --bundles nsis
```

产物：`desktop/src-tauri/target/release/bundle/nsis/*-setup.exe`。

## 壳与后端的协作

1. Tauri 壳启动时 **spawn sidecar**（`node.exe launch.js`，隐藏控制台窗口）；
2. sidecar 启动 DSH web 服务（profile: evoscientist，绑定 127.0.0.1 随机端口）；
3. 壳读取 sidecar 就绪后的端口（stdout JSON / 本地端口文件），
   用 WebView2 加载 `http://127.0.0.1:<port>`；
4. 壳退出时终止 sidecar 进程树（Tauri `kill_children` + Node 侧 `process.on('exit')` 兜底）。

## 体积优化清单（按优先级）

- [ ] NSIS 安装器（LZMA）而非 MSI/WiX；
- [ ] `npm ci --omit=dev --production` + `pnpm deploy` 式裁剪，剔除 SDK 测试套件
      （`--profile deepseek` 思路：仅保留 OpenAI-compatible/DeepSeek provider，去掉
      anthropic/google/ollama 等 SDK —— 对应原 EvoScientist build.py 的 deepseek profile）；
- [ ] node.exe 用官方 x64 最小发行版（不启用 npm 全局缓存）；
- [ ] 图标与资源压缩（`tauri icon` + 单尺寸 .ico）；
- [ ] 后续可选：Node SEA 实验（若原生模块约束可解）再砍 ~10MB。

## 已知边界

- 仅 Windows x64（目标机需 Windows 10 1803+，自带 WebView2 Runtime；旧系统需装 Evergreen Bootstrapper）；
- Linux/WSL2 不在本期范围；sidecar 打包脚本已按平台参数化，未来可扩展；
- sidecar 目录不可写问题：安装到 `%LOCALAPPDATA%\<AppName>`（不装 Program Files 写保护目录）。
