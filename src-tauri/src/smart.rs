//! Smart folders: saved place + filters (see src/lib/core/smart.ts). The core only
//! keeps them, as JSON in the app data, so they travel with the other app data and
//! projects can refer to them; their meaning lives in the frontend.

use serde_json::Value;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

pub struct SmartFolders {
    file: PathBuf,
}

impl SmartFolders {
    pub fn open(app_dir: &Path) -> io::Result<SmartFolders> {
        fs::create_dir_all(app_dir)?;
        Ok(SmartFolders { file: app_dir.join("smart.json") })
    }

    /// The list, or `null` if nothing was ever saved (the frontend then migrates its old copy).
    pub fn load(&self) -> Value {
        fs::read(&self.file).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or(Value::Null)
    }

    pub fn save(&self, list: &Value) -> io::Result<()> {
        if !list.is_array() {
            return Err(io::Error::new(io::ErrorKind::InvalidInput, "smart folders must be a list"));
        }
        let tmp = self.file.with_extension("json.tmp");
        fs::write(&tmp, serde_json::to_vec_pretty(list)?)?;
        fs::rename(tmp, &self.file)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_the_list() {
        let d = tempfile::tempdir().unwrap();
        let s = SmartFolders::open(d.path()).unwrap();
        assert!(s.load().is_null());
        let list = serde_json::json!([{"id": "a", "name": "Fotos", "scope": {"project": "p1"}, "projects": ["p2"]}]);
        s.save(&list).unwrap();
        assert_eq!(SmartFolders::open(d.path()).unwrap().load(), list);
        assert!(s.save(&serde_json::json!({"x": 1})).is_err());
    }
}
