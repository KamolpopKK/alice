use crate::error::{NativeError, Result};

const SERVICE: &str = "alice-desktop";

/// Where refresh credentials live. Only the Rust core can reach it; the WebView never can.
pub trait CredentialStore: Send + Sync {
    fn name(&self) -> &'static str;
    fn get(&self, account: &str) -> Result<Option<String>>;
    fn set(&self, account: &str, secret: &str) -> Result<()>;
    fn delete(&self, account: &str) -> Result<()>;
}

/// macOS Keychain, Windows Credential Manager or Linux Secret Service.
pub struct OsKeyring;

impl CredentialStore for OsKeyring {
    fn name(&self) -> &'static str {
        "operating-system keyring"
    }
    fn get(&self, account: &str) -> Result<Option<String>> {
        let entry = keyring::Entry::new(SERVICE, account).map_err(storage)?;
        match entry.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(storage(e)),
        }
    }
    fn set(&self, account: &str, secret: &str) -> Result<()> {
        keyring::Entry::new(SERVICE, account).and_then(|e| e.set_password(secret)).map_err(storage)
    }
    fn delete(&self, account: &str) -> Result<()> {
        match keyring::Entry::new(SERVICE, account).and_then(|e| e.delete_credential()) {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(storage(e)),
        }
    }
}

fn storage(_: keyring::Error) -> NativeError {
    // ไม่ใส่รายละเอียดของ error จาก keyring เพื่อไม่ให้มีข้อมูลลับหลุดใน UI/log
    NativeError::new("STORAGE_ERROR", "The operating-system credential store is unavailable")
}

/// Plain JSON file for automated tests. Compiled only with the `test-credential-store` feature.
#[cfg(any(test, feature = "test-credential-store"))]
pub struct FileStore {
    pub path: std::path::PathBuf,
}

#[cfg(any(test, feature = "test-credential-store"))]
impl FileStore {
    fn read(&self) -> std::collections::BTreeMap<String, String> {
        std::fs::read_to_string(&self.path).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
    }
    fn write(&self, data: &std::collections::BTreeMap<String, String>) -> Result<()> {
        std::fs::write(&self.path, serde_json::to_string(data).unwrap()).map_err(|_| NativeError::new("STORAGE_ERROR", "test store write failed"))
    }
}

#[cfg(any(test, feature = "test-credential-store"))]
impl CredentialStore for FileStore {
    fn name(&self) -> &'static str {
        "plaintext test store"
    }
    fn get(&self, account: &str) -> Result<Option<String>> {
        Ok(self.read().get(account).cloned())
    }
    fn set(&self, account: &str, secret: &str) -> Result<()> {
        let mut d = self.read();
        d.insert(account.to_string(), secret.to_string());
        self.write(&d)
    }
    fn delete(&self, account: &str) -> Result<()> {
        let mut d = self.read();
        d.remove(account);
        self.write(&d)
    }
}

/// Production builds always use the OS keyring. Test builds may select a file via
/// `ALICE_DESKTOP_CREDENTIAL_STORE=file:/path.json`.
pub fn select_store() -> Box<dyn CredentialStore> {
    #[cfg(feature = "test-credential-store")]
    if let Ok(choice) = std::env::var("ALICE_DESKTOP_CREDENTIAL_STORE") {
        if let Some(path) = choice.strip_prefix("file:") {
            return Box::new(FileStore { path: path.into() });
        }
    }
    Box::new(OsKeyring)
}

pub fn account(profile: &str, server: &str) -> String {
    format!("{profile}@{server}")
}
