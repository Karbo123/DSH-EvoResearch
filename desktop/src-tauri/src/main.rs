//! EvoResearch 桌面壳：spawn Node sidecar（DSH web 服务）→ 读取端口 → WebView2 加载。
//!
//! 协作协议：
//! 1. 壳在资源目录中定位 sidecar（node.exe + app/ + launch.js，由 bundle-sidecar.mjs 组装）；
//! 2. 以隐藏控制台方式 spawn `node.exe launch.js`；
//! 3. launch.js 启动 DSH web profile（EvoResearch）后，把端口写入端口文件
//!    （%LOCALAPPDATA%/EvoResearch/port.json）并打印一行 JSON 到 stdout；
//! 4. 壳轮询端口文件（≤30s）后加载 `http://127.0.0.1:<port>`；
//! 5. 壳退出时终止 sidecar 进程树（Node 侧 process.on('exit') 兜底）。

use std::fs;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

/// 应用数据目录（端口文件位置）。
fn port_file(app_data_dir: &PathBuf) -> PathBuf {
    app_data_dir.join("port.json")
}

/// 去掉 Windows 长路径前缀（`\\?\`）：Node 模块解析无法处理该前缀的 cwd/文件路径。
fn simplified(path: &std::path::Path) -> PathBuf {
    let text = path.to_string_lossy();
    let stripped = text.strip_prefix("\\\\?\\").unwrap_or(&text);
    PathBuf::from(stripped.to_string())
}

/// 在资源目录中定位 sidecar 组件。
/// tauri-build 把 `../sidecar/dist/**/*` 资源复制为 `<target>/_up_/sidecar/dist/...`
/// （`_up_` 是相对路径中 `..` 部分的映射），因此按候选路径探测。
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

/// 应用本地数据目录：%LOCALAPPDATA%/com.EvoResearch.desktop（与 launch.js 端口文件约定一致）。
fn app_local_data_dir() -> PathBuf {
    let base = std::env::var("LOCALAPPDATA").unwrap_or_else(|_| std::env::temp_dir().display().to_string());
    let dir = PathBuf::from(base).join("com.EvoResearch.desktop");
    let _ = fs::create_dir_all(&dir);
    dir
}

/// 启动 sidecar 进程。
fn spawn_sidecar(resource_dir: &PathBuf) -> std::io::Result<Child> {
    let node = locate_sidecar(resource_dir, "node.exe")
        .ok_or_else(|| std::io::Error::other("未找到 sidecar node.exe（资源未嵌入？）"))?;
    let launch = locate_sidecar(resource_dir, "launch.js")
        .ok_or_else(|| std::io::Error::other("未找到 sidecar launch.js"))?;
    // sidecar 工作目录 = app 目录（DSH_HOME 根，含 profiles/ 与 node_modules/）
    let workdir = locate_sidecar(resource_dir, "app")
        .ok_or_else(|| std::io::Error::other("未找到 sidecar app 目录"))?;
    // 端口文件路径经环境变量传给 launch.js（避免两侧路径约定漂移）
    let port_file_env = app_local_data_dir().join("port.json");
    let stderr_log = std::env::temp_dir().join("EVORESEARCH-sidecar.err.log");
    let stderr_file = std::fs::File::create(&stderr_log)?;
    Command::new(&node)
        .arg(&launch)
        .current_dir(&workdir)
        .env("EVORESEARCH_PORT_FILE", &port_file_env)
        .stdin(Stdio::null())
        .stdout(Stdio::null()) // 端口经端口文件传递，避免管道阻塞
        .stderr(Stdio::from(stderr_file))
        .creation_flags(0x0800_0000) // CREATE_NO_WINDOW：隐藏控制台
        .spawn()
}

/// 等待端口文件出现并返回端口。
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

/// 诊断日志（%TEMP%/EVORESEARCH-shell.log）；发布版可移除。
fn log(msg: &str) {
    let log_path = std::env::temp_dir().join("EVORESEARCH-shell.log");
    let _ = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .and_then(|mut f| {
            use std::io::Write;
            writeln!(f, "{}", msg)
        });
}

fn main() {
    log(&format!("[shell] 启动，PID={}", std::process::id()));

    let app = tauri::Builder::default()
        .setup(|app| {
            let handle = app.handle();
            let resource_dir = handle.path().resource_dir().unwrap_or_default();
            let app_data_dir = app_local_data_dir(); // %LOCALAPPDATA%/com.EvoResearch.desktop
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
                    log("[shell] sidecar 未在 30s 内就绪，加载失败页");
                    "about:blank".to_string()
                }
            };

            // 3) 创建主窗口
            WebviewWindowBuilder::new(
                handle,
                "main",
                WebviewUrl::External(url.parse().expect("合法 URL")),
            )
            .title("EvoResearch")
            .inner_size(1280.0, 820.0)
            .min_inner_size(960.0, 600.0)
            .build()?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Tauri 应用初始化失败");

    app.run(|_app_handle, _event| {});
}
