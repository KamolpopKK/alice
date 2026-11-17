//! The versioned Local runtime installed under the application-data root:
//! `runtime/<version>/` directories with a `current` pointer that changes atomically.

use std::path::Path;

/// `node alice.js` of the active installed runtime, when one is installed.
pub fn installed_cli_command(root: &Path) -> Option<Vec<String>> {
    let current = root.join("runtime").join("current");
    let node = current.join(if cfg!(windows) { "node.exe" } else { "node" });
    let cli = current.join("alice.js");
    (node.is_file() && cli.is_file()).then(|| vec![node.to_string_lossy().into_owned(), cli.to_string_lossy().into_owned()])
}

/// The runtime shipped inside the app bundle: `Resources/runtime/` plus the `alice-node` sidecar.
#[derive(Debug, Clone)]
pub struct Bundled {
    pub dir: std::path::PathBuf,
    pub node: std::path::PathBuf,
    pub version: String,
}

pub fn bundled(resource_dir: &Path, exe_dir: &Path) -> Option<Bundled> {
    let dir = resource_dir.join("runtime");
    let manifest: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(dir.join("manifest.json")).ok()?).ok()?;
    let version = manifest["version"].as_str()?.to_string();
    // Tauri วาง externalBin ไว้ข้าง executable โดยตัด target triple ออก
    let sidecar = exe_dir.join(if cfg!(windows) { "alice-node.exe" } else { "alice-node" });
    let node = if sidecar.is_file() { sidecar } else { dir.join("node") };
    node.is_file().then_some(Bundled { dir, node, version })
}

fn current_version(root: &Path) -> Option<String> {
    std::fs::canonicalize(root.join("runtime").join("current")).ok()?.file_name()?.to_str().map(str::to_string)
}

/// Installs the bundled runtime into the application-data root and activates it when it is not the
/// current one. The bundled CLI does the verified copy and the safe, rollback-capable switch.
pub fn install_bundled(root: &Path, b: &Bundled) -> std::result::Result<serde_json::Value, String> {
    if current_version(root).as_deref() == Some(b.version.as_str()) && root.join("runtime").join(&b.version).join("manifest.json").is_file() {
        return Ok(serde_json::json!({ "status": "unchanged", "to": b.version }));
    }
    let out = std::process::Command::new(&b.node)
        .arg(b.dir.join("alice.js"))
        .args(["local", "install-runtime", "--from"])
        .arg(&b.dir)
        .arg("--node")
        .arg(&b.node)
        .arg("--json")
        .env("ALICE_HOME", root)
        .stdin(std::process::Stdio::null())
        .output()
        .map_err(|_| "The bundled Alice runtime could not start".to_string())?;
    let body: serde_json::Value = serde_json::from_slice(&out.stdout).map_err(|_| "The bundled Alice runtime did not answer".to_string())?;
    if body["ok"].as_bool() == Some(true) {
        Ok(body["data"].clone())
    } else {
        Err(body["error"]["message"].as_str().unwrap_or("Installing the Alice runtime failed").to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_the_bundled_runtime_and_skips_an_installed_one() {
        let dir = tempfile::tempdir().unwrap();
        let res = dir.path().join("Resources");
        let exe = dir.path().join("MacOS");
        std::fs::create_dir_all(res.join("runtime")).unwrap();
        std::fs::create_dir_all(&exe).unwrap();
        assert!(bundled(&res, &exe).is_none(), "no manifest yet");
        std::fs::write(res.join("runtime/manifest.json"), r#"{"format":"alice-runtime","version":"9.9.9","files":[]}"#).unwrap();
        std::fs::write(exe.join("alice-node"), b"#!/bin/sh\n").unwrap();
        let b = bundled(&res, &exe).unwrap();
        assert_eq!(b.version, "9.9.9");
        assert_eq!(b.node, exe.join("alice-node"));

        let root = dir.path().join("data");
        std::fs::create_dir_all(root.join("runtime/9.9.9")).unwrap();
        std::fs::write(root.join("runtime/9.9.9/manifest.json"), "{}").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink("9.9.9", root.join("runtime/current")).unwrap();
        #[cfg(unix)]
        assert_eq!(install_bundled(&root, &b).unwrap()["status"], "unchanged");
    }
}
