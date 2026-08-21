//! EvoResearch 壳库（Tauri 2 移动端要求 lib target：cdylib 供 Android 加载）。
//!
//! 桌面（bin，main.rs）与移动端（lib）共用 `run()` 入口：
//! - desktop：spawn Node sidecar → 等端口 → WebView 加载 WebUI；
//! - mobile（Android/iOS）：无 Node sidecar（DSH 后端不支持移动端运行时），
//!   直接由 Tauri 移动壳加载打包进二进制的占位页
//!   （tauri.android.conf.json 清空 resources：sidecar 资源不进移动包）。

#[cfg(mobile)]
fn mobile_main() {
    let app = tauri::Builder::default()
        .build(tauri::generate_context!())
        .expect("Tauri 应用初始化失败");
    app.run(|_app_handle, _event| {});
}

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
            fs::create_dir_all(&app_data_dir).ok();
            // 清掉旧端口文件（避免读到上次运行的残留）
            fs::remove_file(port_file(&app_data_dir)).ok();

            // 1) 启动 Node sidecar
            match spawn_sidecar(&resource_dir) {
                Ok(child) => {
                    log(&format!("[shell] sidecar 已启动，pid={}", child.id()));
                }
                Err(error) => {
                    log(&format!("[shell] sidecar 启动失败: {error}"));
                }
            }

            // 2) 等待端口并加载 WebUI（首次启动 sidecar 冷启动较慢，放宽到 60s）
            let port = wait_for_port(&app_data_dir, Duration::from_secs(60));
            let url = match port {
                Some(port) => {
                    log(&format!("[shell] 后端就绪，端口={port}"));
                    format!("http://127.0.0.1:{port}")
                }
                None => {
                    log("[shell] sidecar 未在 60s 内就绪，加载失败页");
                    "about:blank".to_string()
                }
            };

            // 3) 创建主窗口（无边框 + 自绘标题栏：frameless + 网页内注入 36px 标题栏）
            let url = format!("{}?desktop=1", url);
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

/// 平台分发入口（main.rs 与 Android cdylib 共用）。
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
    let _ = fs::create_dir_all(&dir);
    dir
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
    // 数据根：exe 同级目录下的 evoresearch-data（用户数据一目了然、随程序迁移；
    // 与程序文件（sidecar/dist/app）分离，打包重建不会触碰）
    let data_home = resource_dir.join("evoresearch-data");
    fs::create_dir_all(&data_home).ok();
    log(&format!("[shell] data_home={}", data_home.display()));
    // 端口文件路径经环境变量传给 launch.js（避免两侧路径约定漂移）
    let port_file_env = app_local_data_dir().join("port.json");
    let stderr_log = std::env::temp_dir().join("evoresearch-sidecar.err.log");
    let stderr_file = std::fs::File::create(&stderr_log)?;
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
#[cfg(desktop)]
fn wait_for_port(app_data_dir: &PathBuf, timeout: Duration) -> Option<u16> {
    let file = port_file(app_data_dir);
    let start = Instant::now();
    while start.elapsed() < timeout {
        if let Ok(raw) = fs::read_to_string(&file) {
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw) {
                if let Some(port) = value.get("port").and_then(|p| p.as_u64()) {
                    if port > 0 && port < 65536 {
                        return Some(port as u16);
                    }
                }
            }
        }
        thread::sleep(Duration::from_millis(300));
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
