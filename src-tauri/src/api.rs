use crate::error::{network_error, NativeError, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;

pub const CLIENT_API_PREFIX: &str = "/client/v1";
pub const CLIENT_API_VERSION: u32 = 1;
pub const CLIENT_NAME: &str = concat!("alice-desktop/", env!("CARGO_PKG_VERSION"));

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiResponse {
    pub status: u16,
    pub data: Value,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientApiRange {
    pub current: u32,
    pub minimum: u32,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerInfo {
    pub product: String,
    pub name: String,
    pub server_version: String,
    pub client_api: ClientApiRange,
    pub capabilities: Vec<String>,
}

/// Compatibility of this client with a server's advertised protocol range.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Compatibility {
    pub compatible: bool,
    pub upgrade: Option<&'static str>,
    pub message: String,
}

pub fn compatibility(info: &ServerInfo) -> Compatibility {
    if info.client_api.minimum > CLIENT_API_VERSION {
        return Compatibility {
            compatible: false,
            upgrade: Some("client"),
            message: format!("This server requires Client API v{}+; update Alice Desktop.", info.client_api.minimum),
        };
    }
    if info.client_api.current < CLIENT_API_VERSION {
        return Compatibility {
            compatible: false,
            upgrade: Some("server"),
            message: format!("This server offers Client API v{}; Alice Desktop needs v{CLIENT_API_VERSION}. Upgrade the server.", info.client_api.current),
        };
    }
    Compatibility { compatible: true, upgrade: None, message: format!("Compatible (Client API v{CLIENT_API_VERSION})") }
}

pub fn http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(30))
        .connect_timeout(Duration::from_secs(10))
        .user_agent(CLIENT_NAME)
        .build()
        .expect("http client")
}

/// A request scoped to one server origin and the Client API prefix only.
pub struct ServerClient<'a> {
    pub http: &'a reqwest::Client,
    pub origin: &'a str,
}

impl ServerClient<'_> {
    pub async fn send(&self, method: &str, path: &str, query: &[(String, String)], body: Option<&Value>, bearer: Option<&str>, extra: &[(String, String)]) -> Result<ApiResponse> {
        let method = reqwest::Method::from_bytes(method.as_bytes()).map_err(|_| NativeError::invalid("Unsupported method"))?;
        let mut req = self
            .http
            .request(method, format!("{}{}{}", self.origin, CLIENT_API_PREFIX, path))
            .query(query)
            .header("alice-client-api", CLIENT_API_VERSION.to_string())
            .header("alice-client", CLIENT_NAME)
            .header("accept", "application/json");
        for (k, v) in extra {
            req = req.header(k.as_str(), v.as_str());
        }
        if let Some(token) = bearer {
            req = req.bearer_auth(token);
        }
        if let Some(b) = body {
            req = req.json(b);
        }
        let res = req.send().await.map_err(|e| network_error(self.origin, &e))?;
        let status = res.status().as_u16();
        let text = res.text().await.map_err(|e| network_error(self.origin, &e))?;
        let data = if text.is_empty() {
            Value::Null
        } else {
            serde_json::from_str(&text).map_err(|_| NativeError::new("PROTOCOL_ERROR", format!("{} did not answer like an Alice server (HTTP {status})", self.origin)))?
        };
        Ok(ApiResponse { status, data })
    }

    /// Sends and converts non-2xx answers into the server's stable error.
    pub async fn call(&self, method: &str, path: &str, body: Option<&Value>, bearer: Option<&str>) -> Result<Value> {
        let res = self.send(method, path, &[], body, bearer, &[]).await?;
        if (200..300).contains(&res.status) {
            Ok(res.data)
        } else {
            Err(server_error(&res))
        }
    }

    /// A `/local/v1` call on a Local workspace daemon.
    pub async fn local_call(&self, method: &str, path: &str, body: Option<&Value>, bearer: &str) -> Result<Value> {
        let method = reqwest::Method::from_bytes(method.as_bytes()).map_err(|_| NativeError::invalid("Unsupported method"))?;
        let mut req = self.http.request(method, format!("{}/local/v1{}", self.origin, path)).bearer_auth(bearer).header("accept", "application/json");
        if let Some(b) = body {
            req = req.json(b);
        }
        let res = req.send().await.map_err(|e| network_error(self.origin, &e))?;
        let status = res.status().as_u16();
        let data: Value = res.json().await.unwrap_or(Value::Null);
        let res = ApiResponse { status, data };
        if (200..300).contains(&status) { Ok(res.data) } else { Err(server_error(&res)) }
    }

    pub async fn info(&self) -> Result<ServerInfo> {
        let data = self.call("GET", "/info", None, None).await?;
        serde_json::from_value::<ServerInfo>(data)
            .ok()
            .filter(|i| i.product == "alice")
            .ok_or_else(|| NativeError::new("PROTOCOL_ERROR", format!("{} is not an Alice server", self.origin)))
    }
}

pub fn server_error(res: &ApiResponse) -> NativeError {
    let err = res.data.get("error");
    let code = err.and_then(|e| e.get("code")).and_then(Value::as_str).unwrap_or(if res.status >= 500 { "INTERNAL_ERROR" } else { "PROTOCOL_ERROR" });
    let message = err.and_then(|e| e.get("message")).and_then(Value::as_str).unwrap_or("Request failed");
    let mut e = NativeError::new(code, message);
    if let Some(d) = err.and_then(|e| e.get("details")) {
        e = e.with_details(d.clone());
    }
    e
}
