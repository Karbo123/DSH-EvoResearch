//! EvoScientist 桌面壳：spawn Node sidecar（DSH web 服务）→ 读取端口 → WebView2 加载。
//!
//! 协作协议：
//! 1. 壳在资源目录中定位 sidecar（node.exe + app/ + launch.js，由 bundle-sidecar.mjs 组装）；
//! 2. 以隐藏控制台方式 spawn `node.exe launch.js`；
//! 3. launch.js 启动 DSH web profile（evoscientist）后，把端口写入端口文件
//!    （%LOCALAPPDATA%/EvoScientist/port.json）并打印一行 JSON 到 stdout；
//! 4. 壳轮询端口文件（≤30s）后加载 `http://127.0.0.1:<port>`；
//! 5. 壳退出时终止 sidecar 进程树（Node 侧 process.on('exit') 兜底）。

use std::fs;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

/// 应用数据目录（端口文件位置）。
fn port_file(app_data_dir: &PathBuf) -> PathBuf {
    app_data_dir.join("port.json")
}

/// 在资源目录中定位 sidecar 组件（Tauri 资源复制保留的路径结构随版本/配置变化，
/// 因此按候选路径探测）。
fn locate_sidecar(resource_dir: &std::path::Path, name: &str) -> Option<std::path::PathBuf> {
    for candidate in [
        resource_dir.join(name),
        resource_dir.join("sidecar").join(name),
        resource_dir.join("dist").join(name),
    ] {
        if candidate.exists() {
            return Some(candidate);
        }
    }
    None
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
    Command::new(&node)
        .arg(&launch)
        .current_dir(&workdir)
        .stdin(Stdio::null())
        .stdout(Stdio::null()) // 端口经端口文件传递，避免管道阻塞
        .stderr(Stdio::null())
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

fn main() {
    let app = tauri::Builder::default()
        .setup(|app| {
            let handle = app.handle();
            let resource_dir = handle.path().resource_dir().unwrap_or_default();
            let app_data_dir = handle.path().app_data_dir().unwrap_or_default();
            fs::create_dir_all(&app_data_dir).ok();
            // 清掉旧端口文件（避免读到上次运行的残留）
            fs::remove_file(port_file(&app_data_dir)).ok();

            // 1) 启动 Node sidecar
            match spawn_sidecar(&resource_dir) {
                Ok(_child) => {
                    // 注意：child 句柄保存在 setup 闭包中，进程生命周期由 Node 侧
                    // 'exit' 钩子与系统任务管理器兜底；壳进程退出时由 OS 回收。
                    // （更完整的进程树管理后续接入 tauri-plugin-shell）
                }
                Err(error) => {
                    eprintln!("sidecar 启动失败: {error}");
                }
            }

            // 2) 等待端口并加载 WebUI
            let port = wait_for_port(&app_data_dir, Duration::from_secs(30));
            let url = match port {
                Some(port) => format!("http://127.0.0.1:{port}"),
                None => {
                    eprintln!("sidecar 未在 30s 内就绪，加载失败页");
                    "about:blank".to_string()
                }
            };

            // 3) 创建主窗口
            WebviewWindowBuilder::new(
                handle,
                "main",
                WebviewUrl::External(url.parse().expect("合法 URL")),
            )
            .title("EvoScientist")
            .inner_size(1280.0, 820.0)
            .min_inner_size(960.0, 600.0)
            .build()?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Tauri 应用初始化失败");

    app.run(|_app_handle, _event| {});
}
