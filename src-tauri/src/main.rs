// ซ่อนหน้าต่าง console บน Windows ใน release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    alice_desktop::run()
}
