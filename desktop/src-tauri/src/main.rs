//! EvoResearch 桌面可执行入口（bin）：调用 lib.rs 的 run()。
//!
//! Windows GUI 子系统：release 构建不显示控制台黑框（直接弹出应用窗口）。
//! 协作协议与平台分发见 lib.rs 顶部注释。

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    evoresearch_desktop::run()
}
