//! Tauri 构建脚本（生成 context）。
//!
//! Windows 下 build script 主线程默认栈仅 1MB，tauri-build 的资源处理
//! （embed-resource 递归收集）会触发栈溢出（STATUS_STACK_OVERFLOW）；
//! 因此把实际构建放到 16MB 栈的线程中执行（社区通用 workaround）。

fn main() {
    std::thread::Builder::new()
        .stack_size(16 * 1024 * 1024)
        .spawn(|| tauri_build::build())
        .expect("无法启动构建线程")
        .join()
        .expect("tauri-build 失败")
}
