# 04 · Windows 桌面版（Desktop）

## 目标

- 网页版：DSH Web GUI（`dsh web`）—— 浏览器直接使用；
- 桌面版：**Tauri 2**（WebView2 壳）+ **Node sidecar**（后端进程）；
- 打包体积**最小化**：复用系统 WebView2（Windows 10/11 内置），安装包目标 **< 60MB**。

## 为什么 Tauri + Node sidecar（体积账）

| 方案 | 安装包体积 | 说明 |
|---|---|---|
| Electron | ~100MB+ | 自带 Chromium，否决 |
| PyInstaller onefile（上游 EvoScientist） | 100MB+ | 本项目不用 Python |
| **Tauri 2 + Node sidecar** | **~40-60MB** | WebView2 系统复用（壳 ~5-15MB）+ node.exe（LZMA ~35-45MB）+ 应用代码 |
| Node SEA 单文件 exe | 80-120MB | 原生模块（node-pty 等）外置复杂度高，备选 |

Node.js 是硬约束（后端必须 NodeJS），因此体积下限 ≈ node.exe 压缩后体积；
相比 Electron 已缩小约 60%，相比原 Python 方案缩小约 50%+。

## 体积实测（0.1.0-rc.1）

| 项 | 体积 | 说明 |
|---|---|---|
| **NSIS 安装包（实测）** | **44 MB** | `EvoResearch_0.1.0_x64-setup.exe`（LZMA，225.6MB 未压缩 → 44MB） |
| 壳 exe | 2.9 MB | Tauri release + strip |
| node.exe（v24.19.0 LTS） | 88.5 MB | 未压缩；LZMA 后约 30-35MB |
| app/（node_modules + profiles） | ~137 MB | 裁剪后 |
| 对比 Electron 典型 | 100MB+ | **本方案缩小 56%+** |
| 对比上游 EvoScientist（PyInstaller） | 100MB+ | 本方案缩小 50%+ |

**体积优化（deepseek profile 思路，已实现）**：`bundle-sidecar.mjs` 裁剪
- 未使用的 provider SDK：`@anthropic-ai`/`@google`/`@mistralai`/`@aws-*`/`@smithy`/`@protobufjs`（-32MB）——与上游 EvoScientist `build.py --profile deepseek` 语义一致（适配器惰性 import，不选则不加载）；
- 原生模块跨平台 prebuilds：node-pty 只留 win32-x64（-28MB），sharp 只留 win32；
- 裁剪后产物已通过完整 boot 验证（DSH_HOME 隔离 + 插件激活 + BOOT 图 + bundle serve）。

**关键版本约束**：sidecar 的 node.exe 必须 ≥ **Node 23**（`node:zlib` 的 zstd API 是 23.0 加入，
`dsh-session-persistence-jsonl` 依赖它）；当前使用 Node 24 LTS（Krypton）。

## 目录结构（desktop/）

```
desktop/
├── src-tauri/                 # Tauri 2（Rust）
│   ├── src/main.rs            # 壳入口：locate_sidecar 探测 + spawn + WebView2 加载
│   ├── tauri.conf.json        # NSIS/LZMA、resources: ../sidecar/dist/**
│   └── Cargo.toml
├── sidecar/
│   ├── launch.js              # sidecar 启动脚本（DSH_HOME=app 根、端口文件协议、防孤儿）
│   ├── .cache/                # node.zip 缓存（--skip-download 复用）
│   └── dist/                  # 打包产物（构建时生成，不入库）
│       ├── node.exe           # Node 24 LTS（win-x64）
│       ├── launch.js
│       └── app/               # DSH_HOME 根（运行期 DSH_HOME 指向这里）
│           ├── profiles/evoresearch/   # profile 元数据（bundle 声明）
│           └── node_modules/            # dsh-base + dsh-web-app + dsh CLI + 插件
├── scripts/
│   ├── bundle-sidecar.mjs     # 组装 sidecar（下载 node/安装依赖/裁剪）
│   └── build.mjs              # 一键：npm build → bundle-sidecar → cargo tauri build
├── icons/                     # icon-source.png（gen-icon.mjs 生成）
└── dist/index.html            # frontendDist 占位（运行期由 sidecar 提供真实服务）
```

## sidecar 协作协议（壳 ↔ 后端）

1. 壳 `locate_sidecar` 探测资源目录中的 node.exe/launch.js/app
   （Tauri 把 `../sidecar/dist/**/*` 复制为 `<exe目录>/_up_/sidecar/dist/...`，`_up_` 是 `..` 的映射）；
2. spawn `node.exe launch.js`（cwd = app/，隐藏控制台，stderr 写入 `%TEMP%/evoresearch-sidecar.err.log`）；
3. launch.js 设置 `DSH_HOME = cwd`（独立数据根，不污染用户 `~/.dsh`），
   启动 `dsh --profile evoresearch --port 0`；
4. 端口文件路径经环境变量 `EVORESEARCH_PORT_FILE` 传入（默认 `%LOCALAPPDATA%/com.evoresearch.desktop/port.json`），
   端口从 dsh stdout 解析（`dsh web: http://127.0.0.1:PORT` / `{"port":N}` / Listening 行）；
5. 壳轮询端口文件（≤60s，首次冷启动较慢）后加载 WebView2；
6. 退出清理：launch.js 在父进程消失时自动退出（tasklist 探测），防孤儿进程。

## 桌面壳端到端验证（0.1.0-rc.1）

| 验证项 | 结果 |
|---|---|
| release exe 启动（窗口 + WebView2） | ✅ 进程存活、无错误 |
| sidecar spawn（node.exe launch.js） | ✅ 隐藏控制台、stderr 落盘 |
| DSH web 后端启动 | ✅ `dsh web: http://127.0.0.1:<port>` |
| 端口文件协议 | ✅ `{"port":9430}` 写入 LOCALAPPDATA |
| 壳 → WebView2 加载后端 | ✅ 页面 200、BOOT 图含插件、client bundle 200 |
| 安装包 | ✅ `EvoResearch_0.1.0_x64-setup.exe` = 43.7MB（NSIS/LZMA） |

### 调试过程中修复的问题（对 Tauri 桌面开发有普适参考价值）

| 问题 | 根因 | 修复 |
|---|---|---|
| build.rs 栈溢出 | Windows build script 主线程 1MB 栈，embed-resource 递归溢出 | 16MB 栈线程执行 tauri_build::build() |
| resources 未进安装包 | glob 模式 `**` 结尾不匹配文件（需 `**/*`） | tauri.conf resources 用 `../sidecar/dist/**/*` |
| 资源路径未知 | tauri-build 把 `../sidecar/**` 复制为 `<target>/_up_/sidecar/**` | main.rs 候选路径探测 + `\\?\` 前缀剥离 |
| 壳读端口文件失败 | Tauri `app_data_dir()` 是 Roaming，launch.js 写 LOCALAPPDATA | 统一为 `%LOCALAPPDATA%/com.evoresearch.desktop`，路径经 `EVORESEARCH_PORT_FILE` 环境变量传递 |
| sidecar 崩溃 `lstat 'D:'` | 壳 `resource_dir` 带 `\\?\` 长路径前缀，Node 模块解析失败 | `simplified()` 剥离前缀 |
| 端口一直未就绪 | dsh 输出 `dsh web: http://127.0.0.1:PORT` 不含 "listen"，旧正则不匹配 | 新增 URL 正则；等待放宽到 60s |
| 窗口创建 panic | tauri.conf 已声明 `main` 窗口，setup 又建同名 | tauri.conf `windows: []`，窗口由 setup 全权创建 |
| sidecar 启动报错 | npm 嵌套安装生成 `profiles/node_modules`（真实目录），dsh heal 要求 symlink 或不存在 | bundle-sidecar 清理该目录；build.mjs 构建前清理 `_up_` 残留 |

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
2. sidecar 启动 DSH web 服务（profile: EvoResearch，绑定 127.0.0.1 随机端口）；
3. 壳读取 sidecar 就绪后的端口（stdout JSON / 本地端口文件），
   用 WebView2 加载 `http://127.0.0.1:<port>`；
4. 壳退出时终止 sidecar 进程树（Tauri `kill_children` + Node 侧 `process.on('exit')` 兜底）。

## 体积优化清单（按优先级）

- [ ] NSIS 安装器（LZMA）而非 MSI/WiX；
- [ ] `npm ci --omit=dev --production` + `pnpm deploy` 式裁剪，剔除 SDK 测试套件
      （`--profile deepseek` 思路：仅保留 OpenAI-compatible/DeepSeek provider，去掉
      anthropic/google/ollama 等 SDK —— 对应上游 EvoScientist build.py 的 deepseek profile）；
- [ ] node.exe 用官方 x64 最小发行版（不启用 npm 全局缓存）；
- [ ] 图标与资源压缩（`tauri icon` + 单尺寸 .ico）；
- [ ] 后续可选：Node SEA 实验（若原生模块约束可解）再砍 ~10MB。

## 已知边界

- 仅 Windows x64（目标机需 Windows 10 1803+，自带 WebView2 Runtime；旧系统需装 Evergreen Bootstrapper）；
- Linux/WSL2 不在本期范围；sidecar 打包脚本已按平台参数化，未来可扩展；
- sidecar 目录不可写问题：安装到 `%LOCALAPPDATA%\<AppName>`（不装 Program Files 写保护目录）。
