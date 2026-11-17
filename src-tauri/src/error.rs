use serde::Serialize;

/// Error returned to the WebView. Messages are safe to show; they never contain credentials.
#[derive(Debug, Clone, Serialize, thiserror::Error, PartialEq)]
#[serde(rename_all = "camelCase")]
#[error("{code}: {message}")]
pub struct NativeError {
    /// Stable code: an Alice server error code, or a native one
    /// (NO_PROFILE, NOT_SIGNED_IN, PROFILE_CHANGED, NETWORK_ERROR, PROTOCOL_ERROR, INVALID_REQUEST, STORAGE_ERROR).
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<serde_json::Value>,
}

impl NativeError {
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        Self { code: code.to_string(), message: message.into(), details: None }
    }
    pub fn with_details(mut self, details: serde_json::Value) -> Self {
        self.details = Some(details);
        self
    }
    pub fn invalid(message: impl Into<String>) -> Self {
        Self::new("INVALID_REQUEST", message)
    }
}

pub type Result<T> = std::result::Result<T, NativeError>;

/// Maps transport failures to safe messages (TLS problems are named explicitly).
pub fn network_error(origin: &str, err: &reqwest::Error) -> NativeError {
    let text = format!("{err:?}").to_lowercase();
    if text.contains("certificate") || text.contains("tls") || text.contains("invalidcertificate") {
        return NativeError::new("NETWORK_ERROR", format!("The TLS certificate of {origin} could not be verified"));
    }
    if err.is_timeout() {
        return NativeError::new("NETWORK_ERROR", format!("{origin} did not respond in time"));
    }
    if err.is_connect() {
        return NativeError::new("NETWORK_ERROR", format!("Could not connect to {origin}"));
    }
    NativeError::new("NETWORK_ERROR", format!("Could not reach {origin}"))
}
