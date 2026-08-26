# 05 · 云端发布 CI（三平台桌面 + Android）

`.github/workflows/release.yml` 负责在 GitHub Actions 上自动编译并挂载全部平台产物，
本地无需配置 macOS / Linux / Android 编译链。

## 触发方式

| 方式 | 操作 |
|---|---|
| 自动 | `push` 到 `main` 分支即触发 |
| 手动 | GitHub 仓库 → Actions → **Release EvoResearch** → Run workflow |

```bash
# 本地推送触发（main 分支）
git push origin main
```

## 固定版本号与资产覆盖

- Release 名称恒为 **EvoResearch v0.1.0-rc.1**，Tag 恒为 **v0.1.0-rc.1**；虽然版本号保留 `rc.1`，Release 本身按正式发布显示在仓库首页。
- 每次运行：先删除远端旧 Tag 与旧 Release → 用当前 commit 重建 Tag 与 Release →
  tauri-action / `gh release upload --clobber` 上传同名资产（覆盖更新）。
- 因此该 Release 始终指向最近一次成功构建的产物。

## Job 结构

```
prepare-release（删旧建新 Release，输出 release_id）
├── desktop ×3 矩阵并行
│   ├── windows-latest → NSIS x64 安装包
│   ├── ubuntu-latest  → .AppImage + .deb（x86_64）
│   └── macos-latest   → .dmg（aarch64 + x86_64 universal 构建）
└── android（ubuntu）→ APK（--split-per-abi，arm64/armv7/x86/x86_64）
```

各 job 共同步骤：Node 22 + Rust stable + `npm ci && npm run build`
（生成 packages/*/lib 与 evoresearch-app/dist）→ 平台差异步骤。

### Desktop 差异

- Linux：apt 装 webkit2gtk-4.1 / appindicator 等 Tauri 系统依赖；
- macOS：`APPLE_SIGNING_IDENTITY: '-'`（Ad-hoc 签名，见下文签名节）；
- sidecar 组装：`bundle-sidecar.mjs` 已按 runner 平台下载对应官方 Node
  （win-x64 zip / linux-x64、darwin-{x64,arm64} tar.gz），并只保留当前平台的原生 prebuilds。

### Android 差异

- Java 17（Temurin）+ NDK 26.3 + Rust 四个 android target；
- `cargo tauri android init` 在 runner 上现场生成 gen/android（不入库）；
- 构建命令：`cargo tauri android build --apk --split-per-abi --config tauri.android.conf.json`；
- `tauri.android.conf.json` 清空 resources —— Node sidecar 不进移动包
  （DSH 后端依赖 Node 运行时，移动端目前是占位壳；`main.rs` 的 `mobile_main` 无 sidecar 逻辑）；
- APK 从 `gen/android/app/build/outputs/apk/` 收集后 `gh release upload --clobber` 挂载。

## 产物清单（Release 页）

| 文件 | 平台 |
|---|---|
| `EvoResearch_0.1.0_x64-setup.exe` | Windows 10/11 x64 |
| `*.AppImage` / `*_amd64.deb` | Linux x86_64 |
| `*_aarch64.dmg` / `*_x64.dmg` | macOS Apple Silicon / Intel |
| `*-<abi>.apk` | Android（arm64-v8a / armeabi-v7a / x86 / x86_64） |

## 签名注意事项

### macOS（当前：Ad-hoc）

未配置证书时以 `APPLE_SIGNING_IDENTITY='-'` 做 Ad-hoc 签名：
本机可直接运行，但分发到其它机器会被 Gatekeeper 拦截（右键打开或 `xattr -cr` 可放行）。
要正式分发需：

1. Apple Developer 账号，创建 "Developer ID Application" 证书；
2. 把 `.p12` 导入临时钥匙串的步骤加入 workflow（secrets 存 base64 的 p12 + 密码）；
3. 设置 `APPLE_CERTIFICATE` / `APPLE_CERTIFICATE_PASSWORD` / `APPLE_SIGNING_IDENTITY` /
   `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID`（后三项用于公证 notarize）——
   tauri-action 会自动完成签名+公证。

### Windows（当前：未签名）

NSIS 包未做 Authenticode 签名，SmartScreen 可能提示"未知发布者"。
如需签名：准备 EV 代码签名证书（可消除 SmartScreen 累积信誉要求），
在 desktop job 增加 signtool 步骤对 `*-setup.exe` 签名后再上传。

### Android（当前：unsigned/debug；支持 secrets 自动签名）

未配置密钥时产出 unsigned APK（安装时需允许未知来源，部分设备还需手动签名）。
推荐直接在仓库 secrets 配好 keystore，CI 内会自动走签名路径：

```bash
# 本地生成一次上传密钥（keytool 随 JDK 提供）
keytool -genkey -v -keystore evoresearch-release.jks -keyalg RSA \
  -keysize 2048 -validity 10000 -alias evoresearch

# 转 base64（Git Bash）
base64 -w0 evoresearch-release.jks > keystore.b64
```

在仓库 **Settings → Secrets and variables → Actions** 添加：

| Secret | 值 |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | keystore.b64 内容 |
| `ANDROID_KEYSTORE_PASSWORD` | keytool 时输入的 store 密码 |
| `ANDROID_KEY_ALIAS` | `evoresearch` |
| `ANDROID_KEY_PASSWORD` | key 密码（通常与 store 相同） |

CI 检测到这些 secrets 后经 `TAURI_ANDROID_KEY_*` 环境变量交给 Gradle 签名 release APK。
**注意**：keystore 一旦用于发布请妥善离线备份——丢失后将无法对同一应用提供升级包。

## 常见问题

- **构建超时/失败重跑**：Actions 页进入对应 run → Re-run failed jobs（Release 删除重建是幂等的）。
- **想改版本号**：同步修改根 package.json / Cargo.toml / tauri.conf.json 的 version，
  以及 workflow env 中 `TAG` / `RELEASE_NAME` 三处。
- **gen/android 需要自定义**（图标名、applicationId 等）：可在本地 init 后提交修改过的文件，
  workflow 的 `android init` 在目录已存在时会跳过。
