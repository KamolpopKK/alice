use crate::error::{NativeError, Result};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// Local connection metadata. Never contains credentials.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub name: String,
    pub server: String,
    /// Plain HTTP explicitly allowed (development only); the UI shows a persistent warning.
    pub insecure: bool,
    pub created_at: String,
    #[serde(default)]
    pub session: Option<SessionMeta>,
    /// Set for a Local workspace: `name` is then its immutable `wsp_` id. Never saved here.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub local: Option<LocalMeta>,
}

/// Display data of a Local workspace, from the registry.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LocalMeta {
    pub alias: String,
    pub display_name: String,
    pub state: String,
}

/// Non-secret description of the signed-in session, for display only.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionMeta {
    pub id: String,
    pub actor_id: String,
    pub actor_name: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileFile {
    pub active: Option<String>,
    pub profiles: Vec<Profile>,
}

pub struct ProfileStore {
    file: PathBuf,
    pub data: ProfileFile,
}

impl ProfileStore {
    pub fn load(dir: &Path) -> Result<Self> {
        let file = dir.join("profiles.json");
        let data = match std::fs::read_to_string(&file) {
            Ok(text) => serde_json::from_str(&text).map_err(|_| NativeError::new("STORAGE_ERROR", "The profile file is damaged; remove it to start over"))?,
            Err(_) => ProfileFile::default(),
        };
        Ok(Self { file, data })
    }

    pub fn save(&self) -> Result<()> {
        if let Some(parent) = self.file.parent() {
            std::fs::create_dir_all(parent).map_err(|_| NativeError::new("STORAGE_ERROR", "Could not create the settings directory"))?;
        }
        let tmp = self.file.with_extension("json.tmp");
        let text = serde_json::to_string_pretty(&self.data).expect("serializable");
        std::fs::write(&tmp, text).and_then(|_| std::fs::rename(&tmp, &self.file)).map_err(|_| NativeError::new("STORAGE_ERROR", "Could not save profiles"))
    }

    pub fn get(&self, name: &str) -> Option<&Profile> {
        self.data.profiles.iter().find(|p| p.name == name)
    }

    pub fn get_mut(&mut self, name: &str) -> Option<&mut Profile> {
        self.data.profiles.iter_mut().find(|p| p.name == name)
    }

    pub fn active(&self) -> Option<&Profile> {
        self.data.active.as_deref().and_then(|n| self.get(n))
    }
}

pub fn validate_name(name: &str) -> Result<()> {
    let ok = !name.is_empty()
        && name.len() <= 40
        && name.chars().next().is_some_and(|c| c.is_ascii_alphanumeric())
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '.' || c == '-');
    if ok { Ok(()) } else { Err(NativeError::invalid("Profile names use letters, digits, \".\", \"_\" or \"-\" (max 40)")) }
}

pub fn is_loopback(host: &str) -> bool {
    matches!(host, "localhost" | "127.0.0.1" | "[::1]" | "::1") || host.ends_with(".localhost")
}

/// HTTPS is required; plain HTTP only for loopback hosts or an explicit development override.
pub fn normalize_server(raw: &str, allow_insecure: bool) -> Result<(String, bool)> {
    let candidate = if raw.contains("://") { raw.to_string() } else { format!("https://{raw}") };
    let url = url::Url::parse(candidate.trim()).map_err(|_| NativeError::invalid("Not a valid server URL"))?;
    if !url.username().is_empty() || url.password().is_some() {
        return Err(NativeError::invalid("Server URLs must not contain credentials"));
    }
    if url.scheme() != "https" && url.scheme() != "http" {
        return Err(NativeError::invalid("Server URLs must use https://"));
    }
    if (url.path() != "/" && !url.path().is_empty()) || url.query().is_some() || url.fragment().is_some() {
        return Err(NativeError::invalid("Use the server origin only, e.g. https://alice.example.com"));
    }
    let host = url.host_str().unwrap_or_default().to_string();
    let insecure = url.scheme() == "http";
    if insecure && !is_loopback(&host) && !allow_insecure {
        return Err(NativeError::invalid(format!(
            "Refusing plain HTTP to {host}: credentials would travel unencrypted. Use https://, or enable the development override."
        )));
    }
    Ok((url.origin().ascii_serialization(), insecure))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn https_and_loopback_rules() {
        assert_eq!(normalize_server("alice.example.com", false).unwrap(), ("https://alice.example.com".into(), false));
        assert_eq!(normalize_server("http://127.0.0.1:8080/", false).unwrap(), ("http://127.0.0.1:8080".into(), true));
        assert!(normalize_server("http://alice.example.com", false).is_err());
        assert_eq!(normalize_server("http://devbox:8080", true).unwrap(), ("http://devbox:8080".into(), true));
        assert!(normalize_server("https://u:p@alice.example.com", false).is_err());
        assert!(normalize_server("https://alice.example.com/path", false).is_err());
        assert!(normalize_server("ftp://alice.example.com", false).is_err());
        assert!(validate_name("work").is_ok());
        assert!(validate_name("bad name").is_err());
        assert!(validate_name("-x").is_err());
    }
}
