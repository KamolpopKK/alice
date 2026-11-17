//! Signed, compatibility-aware Desktop updates.
//!
//! The Tauri updater verifies the minisign signature of every artifact against the public key built
//! into the app before installing. On top of that, Alice refuses updates that are not newer than the
//! running version, and updates whose Client API would not work with the active server.

use crate::api::ClientApiRange;
use base64::Engine;
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "decision", rename_all = "snake_case")]
pub enum Decision {
    Install,
    NotNewer,
    Incompatible { message: String },
}

/// `candidate_client_api` comes from the release manifest (`aliceClientApi`); `server` is the active
/// profile's advertised range, when known.
pub fn evaluate(current: &str, candidate: &str, candidate_client_api: Option<u32>, server: Option<&ClientApiRange>) -> Decision {
    let (Ok(cur), Ok(next)) = (semver::Version::parse(current), semver::Version::parse(candidate)) else {
        return Decision::NotNewer;
    };
    if next <= cur {
        return Decision::NotNewer;
    }
    if let (Some(api), Some(range)) = (candidate_client_api, server) {
        if api < range.minimum || api > range.current {
            return Decision::Incompatible {
                message: format!(
                    "Alice Desktop {candidate} speaks Client API v{api}, but your server supports v{}–v{}. Update the server first.",
                    range.minimum, range.current
                ),
            };
        }
    }
    Decision::Install
}

/// Verifies a Tauri updater signature: both values are base64 of minisign text files.
pub fn verify_signature(data: &[u8], signature_b64: &str, pubkey_b64: &str) -> Result<(), String> {
    let decode = |s: &str| -> Result<String, String> {
        let bytes = base64::engine::general_purpose::STANDARD.decode(s.trim()).map_err(|_| "invalid base64".to_string())?;
        String::from_utf8(bytes).map_err(|_| "invalid text".to_string())
    };
    let pk = minisign_verify::PublicKey::decode(&decode(pubkey_b64)?).map_err(|_| "invalid public key".to_string())?;
    let sig = minisign_verify::Signature::decode(&decode(signature_b64)?).map_err(|_| "invalid signature".to_string())?;
    pk.verify(data, &sig, true).map_err(|_| "signature does not match".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const RANGE: ClientApiRange = ClientApiRange { current: 1, minimum: 1 };

    #[test]
    fn only_newer_compatible_releases_install() {
        assert_eq!(evaluate("0.2.0", "0.2.1", Some(1), Some(&RANGE)), Decision::Install);
        assert_eq!(evaluate("0.2.0", "0.2.0", Some(1), Some(&RANGE)), Decision::NotNewer);
        assert_eq!(evaluate("0.2.0", "0.1.9", Some(1), Some(&RANGE)), Decision::NotNewer);
        assert_eq!(evaluate("0.2.0", "0.3.0-beta.1", Some(1), None), Decision::Install);
        assert_eq!(evaluate("0.2.0", "not-a-version", Some(1), None), Decision::NotNewer);
        assert!(matches!(evaluate("0.2.0", "1.0.0", Some(2), Some(&RANGE)), Decision::Incompatible { .. }));
    }

    #[test]
    fn signatures_from_the_release_key_verify_and_tampering_fails() {
        // fixture: ไฟล์ตัวอย่างที่ลงนามด้วย key ทดสอบ (private key ทิ้งไปแล้ว ไม่ได้ commit)
        let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/updater");
        let data = std::fs::read(format!("{dir}/artifact.bin")).unwrap();
        let sig = std::fs::read_to_string(format!("{dir}/artifact.bin.sig")).unwrap();
        let pk = std::fs::read_to_string(format!("{dir}/test.key.pub")).unwrap();
        assert_eq!(verify_signature(&data, &sig, &pk), Ok(()));
        let mut tampered = data.clone();
        tampered[0] ^= 1;
        assert!(verify_signature(&tampered, &sig, &pk).is_err());
        let other = std::fs::read_to_string(format!("{dir}/other.key.pub")).unwrap();
        assert!(verify_signature(&data, &sig, &other).is_err());
        assert!(verify_signature(&data, "", &pk).is_err());
    }
}
