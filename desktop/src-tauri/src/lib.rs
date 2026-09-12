//! EvoResearch 壳库（Tauri 2 移动端要求 lib target：cdylib 供 Android 加载）。
//!
//! 桌面（bin，main.rs）与移动端（lib）共用 `run()` 入口：
//! - desktop：spawn Node sidecar → 等端口 → WebView 加载 WebUI；
//! - mobile（Android/iOS）：无 Node sidecar（DSH 后端不支持移动端运行时），
//!   直接由 Tauri 移动壳加载打包进二进制的占位页
//!   （tauri.android.conf.json 清空 resources：sidecar 资源不进移动包）。

// 移动端入口点：tauri::mobile_entry_point 必须标注在 pub fn run() 上
// （展开为 Android JNI 加载 .so 时寻找的运行时符号；标在私有函数上不生效，
// 会报 "Library does not include required runtime symbols"）。
#[cfg(desktop)]
fn desktop_main() {
    log(&format!("[shell] 启动，PID={}", std::process::id()));

    let app = tauri::Builder::default()
        .setup(|app| {
            let handle = app.handle();
            let resource_dir = handle.path().resource_dir().unwrap_or_default();
            let app_data_dir = app_local_data_dir();
            log(&format!("[shell] resource_dir={}", resource_dir.display()));
            log(&format!("[shell] app_data_dir={}", app_data_dir.display()));
            // 端口文件目录由 app_local_data_dir() 内部负责创建（失败会写日志）。
            // 不再启动即删 port.json：删除会导致多实例互踩（新实例删掉正在运行
            // 实例的端口文件）；读到旧文件最多短暂连到旧端，由 wait_for_port
            // 轮询语义兜底，权衡见 wait_for_port 文档。

            // 1) 启动 Node sidecar（数据根目录创建失败则直接走失败页）。
            // 记录 spawn 时刻：wait_for_port 只接受**晚于该时刻**写入的端口文件——
            // 残留的上一轮 port.json（升级/重启场景）会被立刻读到，指向已死端口，
            // WebView 报 ERR_CONNECTION_REFUSED 且不再重读（升级后首次启动必现）。
            let sidecar_spawned_at = std::time::SystemTime::now();
            let spawn_result = spawn_sidecar(&resource_dir);
            if let Err(error) = &spawn_result {
                log(&format!("[shell] sidecar 启动失败: {error}"));
            }
            let sidecar_failed = spawn_result.is_err();
            if let Ok(child) = &spawn_result {
                log(&format!("[shell] sidecar 已启动，pid={}", child.id()));
            }

            // 2) 等待端口并加载 WebUI（首次启动 sidecar 冷启动较慢，放宽到 60s）
            // 0.1.3 token 柵门：首跳 URL 在这里**一次性**拼好（token 与 desktop=1
            // 一起），外层不得再追加任何参数——曾因外层又拼了一次 `?desktop=1`，
            // token 值被污染成 `TOKEN?desktop=1`，DSH 恒返回 401 鉴权页
            // （实测：同样 token，正确拼接 303 换 cookie，污染后 401）。
            let url: Result<String, std::io::Error> = if sidecar_failed {
                log("[shell] sidecar 启动失败，加载失败页");
                failure_page_url("后端启动失败")
            } else {
                match wait_for_port(&app_data_dir, Duration::from_secs(60), sidecar_spawned_at) {
                    Some((port, token)) => {
                        log(&format!("[shell] 后端就绪，端口={port} token={}", token.is_some()));
                        match token {
                            Some(token) => Ok(format!("http://127.0.0.1:{port}/?desktop=1&token={token}")),
                            // 无 token（旧版 sidecar）：仅带桌面参数
                            None => Ok(format!("http://127.0.0.1:{port}/?desktop=1")),
                        }
                    }
                    None => {
                        log("[shell] sidecar 未在 60s 内就绪，加载失败页");
                        failure_page_url("后端启动超时")
                    }
                }
            };
            // 失败页（file:/about:blank）不经此处改写
            let url = match url {
                Ok(url) => url,
                Err(error) => {
                    log(&format!("[shell] 失败页写入失败: {error}"));
                    "about:blank".to_string()
                }
            };
            WebviewWindowBuilder::new(
                handle,
                "main",
                WebviewUrl::External(url.parse().expect("合法 URL")),
            )
            .title("EvoResearch")
            .inner_size(1280.0, 820.0)
            .min_inner_size(960.0, 600.0)
            .decorations(false) // 无系统标题栏：自绘
            .shadow(true)
            .build()?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            window_minimize,
            window_toggle_maximize,
            window_close,
            window_start_drag
        ])
        .build(tauri::generate_context!())
        .expect("Tauri 应用初始化失败");

    app.run(|_app_handle, _event| {});
}

// 移动端入口（Android/iOS）：无 Node sidecar —— DSH 后端依赖 Node 运行时，
// 移动端暂不提供完整后端；加载打包进二进制的占位页说明现状。
#[cfg(mobile)]
fn mobile_main() {
    let app = tauri::Builder::default()
        .build(tauri::generate_context!())
        .expect("Tauri 应用初始化失败");
    app.run(|_app_handle, _event| {});
}

/// 平台分发入口（main.rs 与 Android cdylib 共用）。
/// tauri::mobile_entry_point 必须直接标注在 pub fn 上：展开为 Android JNI
/// 加载 .so 时寻找的运行时符号，标注私有函数或间接函数都不生效（会报
/// "Library does not include required runtime symbols"）。
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(desktop)]
    desktop_main();
    #[cfg(mobile)]
    mobile_main();
}

// ── 桌面专用实现（sidecar 协议 + 自绘标题栏窗口命令）─────────────────────────

#[cfg(desktop)]
use std::fs;
#[cfg(desktop)]
use std::path::PathBuf;
#[cfg(desktop)]
use std::process::{Child, Command, Stdio};
#[cfg(desktop)]
use std::thread;
#[cfg(desktop)]
use std::time::{Duration, Instant};

#[cfg(desktop)]
use tauri::{WebviewUrl, WebviewWindowBuilder};
#[cfg(desktop)]
use tauri::Manager;

/// 应用数据目录（端口文件位置）。
#[cfg(desktop)]
fn port_file(app_data_dir: &PathBuf) -> PathBuf {
    app_data_dir.join("port.json")
}

/// 去掉 Windows 长路径前缀（`\\?\`）：Node 模块解析无法处理该前缀的 cwd/文件路径。
#[cfg(all(desktop, target_os = "windows"))]
fn simplified(path: &std::path::Path) -> PathBuf {
    let text = path.to_string_lossy();
    let stripped = text.strip_prefix("\\\\?\\").unwrap_or(&text);
    PathBuf::from(stripped.to_string())
}

/// POSIX 无长路径前缀，原样返回。
#[cfg(all(desktop, not(target_os = "windows")))]
fn simplified(path: &std::path::Path) -> PathBuf {
    path.to_path_buf()
}

/// 在资源目录中定位 sidecar 组件。
/// tauri-build 把 `../sidecar/dist/**/*` 资源复制为 `<target>/_up_/sidecar/dist/...`
/// （`_up_` 是相对路径中 `..` 部分的映射），因此按候选路径探测。
#[cfg(desktop)]
fn locate_sidecar(resource_dir: &std::path::Path, name: &str) -> Option<PathBuf> {
    for candidate in [
        resource_dir.join("_up_").join("sidecar").join("dist").join(name),
        resource_dir.join("sidecar").join("dist").join(name),
        resource_dir.join(name),
    ] {
        if candidate.exists() {
            return Some(simplified(&candidate));
        }
    }
    None
}

/// 应用本地数据目录（与 launch.js 端口文件约定一致）：
/// Windows = %LOCALAPPDATA%/com.evoresearch.desktop；POSIX = ~/.local/share/com.evoresearch.desktop。
#[cfg(desktop)]
fn app_local_data_dir() -> PathBuf {
    #[cfg(target_os = "windows")]
    let base = std::env::var("LOCALAPPDATA").unwrap_or_else(|_| std::env::temp_dir().display().to_string());
    #[cfg(not(target_os = "windows"))]
    let base = {
        let home = std::env::var("HOME").unwrap_or_else(|_| std::env::temp_dir().display().to_string());
        PathBuf::from(home).join(".local").join("share").display().to_string()
    };
    let dir = PathBuf::from(base).join("com.evoresearch.desktop");
    if let Err(error) = fs::create_dir_all(&dir) {
        log(&format!("[shell] 创建端口文件目录失败 {}: {error}", dir.display()));
    }
    dir
}

/// 失败页 HTML（编译期内嵌，无外部资源依赖）。
#[cfg(desktop)]
const FAILURE_PAGE_HTML: &str = r#"<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>EvoResearch 启动失败</title>
<style>
  body { margin:0; height:100vh; display:flex; align-items:center; justify-content:center;
         font-family: system-ui, "Segoe UI", "Microsoft YaHei", sans-serif;
         background:#111418; color:#e6e6e6; }
  .box { max-width:560px; padding:32px 40px; border:1px solid #333; border-radius:12px;
         background:#1b1f26; }
  h1 { font-size:20px; margin:0 0 12px; color:#ff9f6b; }
  p { line-height:1.7; margin:6px 0; }
  code { background:#2a2f38; padding:2px 6px; border-radius:4px; }
</style></head>
<body><div class="box">
  <h1>后端启动失败</h1>
  <p id="reason"></p>
  <p>请查看日志文件 <code>%TEMP%\evoresearch-shell.log</code> 与
     <code>%TEMP%\evoresearch-sidecar.err.log</code> 排查原因后重启应用。</p>
</div>
<script>
  // 通过 URL hash 传入失败原因（data:/file: 页面无法读取启动参数）
  const r = decodeURIComponent((location.hash || "").replace(/^#/, ""));
  if (r) document.getElementById("reason").textContent = "原因：" + r;
</script>
</body></html>
"#;

/// 把失败页写到临时目录并返回其 file:// URL；不追加 ?desktop=1。
#[cfg(desktop)]
fn failure_page_url(reason: &str) -> Result<String, std::io::Error> {
    let path = std::env::temp_dir().join("evoresearch-failure.html");
    fs::write(&path, FAILURE_PAGE_HTML)?;
    let text = path.display().to_string().replace('\\', "/");
    // Windows 绝对路径形如 C:/...，需补一个斜杠成为 file:///C:/...
    let url = if text.starts_with('/') {
        format!("file://{text}")
    } else {
        format!("file:///{text}")
    };
    Ok(format!(
        "{url}#{}",
        percent_encode_minimal(reason)
    ))
}

/// 最小百分比编码（保留字母数字与 -_.~，其余转 %XX）。
#[cfg(desktop)]
fn percent_encode_minimal(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for b in text.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// 启动自愈：若 profiles/node_modules 是真实目录（打包/复制残留），删除之。
/// dsh 的 healProfilesModuleFallback 要求该路径不存在或为它管理的符号链接；
/// 真实目录会导致 profile 启动直接报错（sidecar 起不来 → 无窗口）。
#[cfg(desktop)]
fn heal_profiles_modules(workdir: &std::path::Path) {
    let nested = workdir.join("profiles").join("node_modules");
    if let Ok(meta) = std::fs::symlink_metadata(&nested) {
        if !meta.file_type().is_symlink() {
            let _ = std::fs::remove_dir_all(&nested);
            eprintln!("[evoresearch] 已清理非符号链接的 profiles/node_modules（启动自愈）");
        }
    }
}

/// 启动 sidecar 进程。
#[cfg(desktop)]
fn spawn_sidecar(resource_dir: &PathBuf) -> std::io::Result<Child> {
    // Windows 资源里是 node.exe；POSIX 是 node
    #[cfg(target_os = "windows")]
    const NODE_BINARY: &str = "node.exe";
    #[cfg(not(target_os = "windows"))]
    const NODE_BINARY: &str = "node";
    let node = locate_sidecar(resource_dir, NODE_BINARY)
        .ok_or_else(|| std::io::Error::other(format!("未找到 sidecar {NODE_BINARY}（资源未嵌入？）")))?;
    let launch = locate_sidecar(resource_dir, "launch.js")
        .ok_or_else(|| std::io::Error::other("未找到 sidecar launch.js"))?;
    // sidecar 工作目录 = app 目录（程序文件：profiles/ 与 node_modules/）
    let workdir = locate_sidecar(resource_dir, "app")
        .ok_or_else(|| std::io::Error::other("未找到 sidecar app 目录"))?;
    heal_profiles_modules(&workdir);
    // 数据根：Windows = exe/程序目录同级的 .evoresearch-data（用户数据一目了然、
    // 随程序迁移）；macOS = 应用本地数据目录下的 .evoresearch-data——写入 .app
    // bundle 内会破坏 ad-hoc 签名封印，绝不可写资源目录。
    // 创建失败不能吞错：直接返回 Err，壳会加载失败页提示用户看日志。
    #[cfg(target_os = "macos")]
    let data_home = app_local_data_dir().join(".evoresearch-data");
    #[cfg(not(target_os = "macos"))]
    let data_home = resource_dir.join(".evoresearch-data");
    fs::create_dir_all(&data_home)?;
    log(&format!("[shell] data_home={}", data_home.display()));
    // 端口文件路径经环境变量传给 launch.js（避免两侧路径约定漂移）
    let port_file_env = app_local_data_dir().join("port.json");
    let stderr_log = std::env::temp_dir().join("evoresearch-sidecar.err.log");
    // 追加而非截断：多实例/多次启动的日志都保留，便于排障
    let stderr_file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&stderr_log)?;
    let mut command = Command::new(&node);
    command
        .arg(&launch)
        .current_dir(&workdir)
        .env("EVORESEARCH_PORT_FILE", &port_file_env)
        .env("EVORESEARCH_DATA_HOME", &data_home)
        .stdin(Stdio::null())
        .stdout(Stdio::null()) // 端口经端口文件传递，避免管道阻塞
        .stderr(Stdio::from(stderr_file));
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW：隐藏控制台
    }
    command.spawn()
}

/// 等待端口文件出现并返回端口。
/// 权衡：不再启动即删旧 port.json（避免多实例互踩），但**只接受晚于本次
/// sidecar spawn 时刻写入的端口文件**——否则升级/重启场景下会立刻读到上一轮
/// 的残留文件（指向已死端口，token 也过期），WebView 停在 ERR_CONNECTION_REFUSED
/// 且不再重读（升级后首次启动必现，用户实录）。多实例场景下，晚写文件的一方
/// 胜出，先启动的一方会在自己的 60s 窗口内读到对方的文件（后端是活的，直接复用
/// 其服务，无害）。
///
/// 桌面专用：移动端无 sidecar/端口文件，本函数连同它引用的
/// `read_port_token`/`PathBuf`/`Duration`/`Instant`/`thread` 都随 cfg(desktop)
/// 消失——缺了这行属性，Android/iOS 的 lib 编译会报 cannot find `PathBuf` 等
/// （曾导致 CI 的 android/ios 作业全挂，见 docs/05）。
#[cfg(desktop)]
fn wait_for_port(
    app_data_dir: &PathBuf,
    timeout: Duration,
    not_before: std::time::SystemTime,
) -> Option<(u16, Option<String>)> {
    let start = Instant::now();
    while start.elapsed() < timeout {
        // 端口文件必须是本次 sidecar 启动后新写的（mtime 判定），残留文件直接跳过
        let fresh = fs::metadata(port_file(app_data_dir))
            .and_then(|meta| meta.modified())
            .map(|modified| modified >= not_before)
            .unwrap_or(false);
        if fresh {
            if let Some(pair) = read_port_token(app_data_dir) {
                return Some(pair);
            }
        }
        thread::sleep(Duration::from_millis(300));
    }
    None
}
/// 读端口文件，返回 (端口, 可选 token)。0.1.3 起 web 传输默认 per-process token
/// 鉴权：sidecar 从启动日志捕获 `?token=` 写入端口文件，壳把它拼进首跳 URL
/// 完成 token → cookie 交换（旧版 sidecar 无 token 字段 → None，兼容）。
#[cfg(desktop)]
fn read_port_token(app_data_dir: &PathBuf) -> Option<(u16, Option<String>)> {
    let file = port_file(app_data_dir);
    if let Ok(raw) = fs::read_to_string(&file) {
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw) {
            if let Some(port) = value.get("port").and_then(|p| p.as_u64()) {
                if port > 0 && port < 65536 {
                    let token = value
                        .get("token")
                        .and_then(|t| t.as_str())
                        .map(|s| s.to_string())
                        .filter(|s| !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
                    return Some((port as u16, token));
                }
            }
        }
    }
    None
}

/// 诊断日志（%TEMP%/evoresearch-shell.log）；发布版可移除。
#[cfg(desktop)]
fn log(msg: &str) {
    let log_path = std::env::temp_dir().join("evoresearch-shell.log");
    let _ = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .and_then(|mut f| {
            use std::io::Write;
            writeln!(f, "{}", msg)
        });
}

/// 窗口控制命令（自绘标题栏按钮调用；桌面端专用——移动端无自绘标题栏）。
#[cfg(desktop)]
#[tauri::command]
fn window_minimize(window: tauri::WebviewWindow) {
    let _ = window.minimize();
}

#[cfg(desktop)]
#[tauri::command]
fn window_toggle_maximize(window: tauri::WebviewWindow) {
    if window.is_maximized().unwrap_or(false) {
        let _ = window.unmaximize();
    } else {
        let _ = window.maximize();
    }
}

#[cfg(desktop)]
#[tauri::command]
fn window_close(window: tauri::WebviewWindow) {
    let _ = window.close();
}

/// 开始窗口拖拽（自绘标题栏 JS 拖拽模式：阈值后调用一次，OS 接管拖动）。
/// 调用后 OS 接管拖动直到指针松开，因此调用方应在 pointer 越过阈值后调用一次。
#[cfg(desktop)]
#[tauri::command]
fn window_start_drag(window: tauri::WebviewWindow) {
    let _ = window.start_dragging();
}
