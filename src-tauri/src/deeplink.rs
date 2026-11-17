//! `alice://open/<kind>/<id>?profile=<name>` (Remote) or `?workspace=<wsp_id>` (Local) — the
//! same strict grammar as src/shared/deeplink.ts. Links carry one context selector, a resource kind and
//! an opaque id; never a server URL or credential.

use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeepLink {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile: Option<String>,
    /// Immutable Local workspace id; exactly one of `profile` and `workspace` is set.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace: Option<String>,
    pub kind: String,
    pub id: String,
}

impl DeepLink {
    /// Path of the resource inside the Alice UI.
    pub fn path(&self) -> String {
        let segment = if self.kind == "document" { "documents".to_string() } else { format!("{}s", self.kind) };
        format!("/{segment}/{}", self.id)
    }
}

const MAX_LENGTH: usize = 256;

fn prefix_for(kind: &str) -> Option<&'static str> {
    match kind {
        "task" => Some("tsk_"),
        "project" => Some("prj_"),
        "document" => Some("doc_"),
        _ => None,
    }
}

pub fn valid_profile_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 40
        && name.chars().next().is_some_and(|c| c.is_ascii_alphanumeric())
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '.' || c == '-')
}

fn valid_id(id: &str, prefix: &str) -> bool {
    // [a-z]{3}_[0-9a-z]{4,60}
    let Some(rest) = id.strip_prefix(prefix) else { return false };
    (4..=60).contains(&rest.len()) && rest.chars().all(|c| c.is_ascii_digit() || c.is_ascii_lowercase())
}

pub fn parse(raw: &str) -> Result<DeepLink, &'static str> {
    if raw.is_empty() || raw.len() > MAX_LENGTH {
        return Err("Link is empty or too long");
    }
    // url crate ตัด tab/newline ทิ้งเงียบ ๆ จึงต้องตรวจจาก string ดิบก่อน
    if raw.chars().any(|c| c.is_control() || c.is_whitespace() || c == '\\') {
        return Err("Link contains invalid characters");
    }
    let url = url::Url::parse(raw).map_err(|_| "Not a URL")?;
    if url.scheme() != "alice" {
        return Err("Not an alice:// link");
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("Links must not contain credentials");
    }
    if url.port().is_some() {
        return Err("Links must not contain a port");
    }
    if url.fragment().is_some() {
        return Err("Links must not contain a fragment");
    }
    if url.host_str() != Some("open") {
        return Err("Unknown link action");
    }
    let segments: Vec<&str> = url.path().trim_start_matches('/').split('/').collect();
    if segments.len() != 2 || segments.iter().any(|s| s.is_empty()) || !url.path().starts_with('/') {
        return Err("Expected alice://open/<kind>/<id>");
    }
    let pairs: Vec<(String, String)> = url.query_pairs().map(|(k, v)| (k.into_owned(), v.into_owned())).collect();
    if pairs.len() != 1 || (pairs[0].0 != "profile" && pairs[0].0 != "workspace") {
        return Err("Links take exactly one parameter: profile or workspace");
    }
    let (profile, workspace) = if pairs[0].0 == "workspace" {
        if !valid_id(&pairs[0].1, "wsp_") {
            return Err("Invalid workspace id");
        }
        (None, Some(pairs[0].1.clone()))
    } else {
        if !valid_profile_name(&pairs[0].1) {
            return Err("Invalid profile name");
        }
        (Some(pairs[0].1.clone()), None)
    };
    let kind = segments[0];
    let prefix = prefix_for(kind).ok_or("Unsupported resource kind")?;
    if !valid_id(segments[1], prefix) {
        return Err("Invalid resource id");
    }
    Ok(DeepLink { profile, workspace, kind: kind.to_string(), id: segments[1].to_string() })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shared_vectors() {
        let vectors: serde_json::Value = serde_json::from_str(include_str!("../../tests/fixtures/deeplinks.json")).unwrap();
        for v in vectors["valid"].as_array().unwrap() {
            let raw = v[0].as_str().unwrap();
            let got = parse(raw).unwrap_or_else(|e| panic!("{raw}: {e}"));
            assert_eq!(serde_json::to_value(&got).unwrap(), v[1], "{raw}");
        }
        for v in vectors["invalid"].as_array().unwrap() {
            let raw = v[0].as_str().unwrap();
            assert!(parse(raw).is_err(), "should reject {raw:?} ({})", v[1]);
        }
        assert_eq!(parse("alice://open/document/doc_abcd1234?profile=w").unwrap().path(), "/documents/doc_abcd1234");
    }
}
