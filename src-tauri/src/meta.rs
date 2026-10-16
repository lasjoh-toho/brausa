//! Portable metadata: sidecar files at `<dir>/.brausa/<name>.meta.json` and
//! tags embedded in file names (`Photo[beach sunset].jpg`).
//!
//! The format mirrors `src/lib/core/types.ts` (`Sidecar`).

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

pub const SIDECAR_DIR: &str = ".brausa";
const SIDECAR_EXT: &str = ".meta.json";

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct Geo {
    pub lat: f64,
    pub lon: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Sidecar {
    #[serde(default = "one")]
    pub v: u32,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub note: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub geo: Option<Geo>,
    /// Web clipper provenance; kept opaque so newer fields survive a round trip.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated: Option<String>,
}

fn one() -> u32 {
    1
}

impl Default for Sidecar {
    fn default() -> Self {
        Sidecar { v: 1, tags: vec![], color: None, note: String::new(), geo: None, source: None, updated: None }
    }
}

impl Sidecar {
    pub fn is_empty(&self) -> bool {
        self.tags.is_empty() && self.color.is_none() && self.note.is_empty() && self.geo.is_none() && self.source.is_none()
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetaPatch {
    #[serde(default)]
    pub add_tags: Vec<String>,
    #[serde(default)]
    pub remove_tags: Vec<String>,
    /// absent = unchanged, null = clear, string = set
    #[serde(default, deserialize_with = "double_option")]
    pub color: Option<Option<String>>,
}

fn double_option<'de, D>(d: D) -> Result<Option<Option<String>>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Ok(Some(Option::deserialize(d)?))
}

pub fn sidecar_path(file: &Path) -> Option<PathBuf> {
    let dir = file.parent()?;
    let name = file.file_name()?.to_string_lossy();
    Some(dir.join(SIDECAR_DIR).join(format!("{name}{SIDECAR_EXT}")))
}

pub fn read_sidecar(file: &Path) -> Sidecar {
    sidecar_path(file)
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

/// All sidecars of one directory, keyed by file name (one directory read instead of N file probes).
pub fn read_dir_sidecars(dir: &Path) -> HashMap<String, Sidecar> {
    let mut out = HashMap::new();
    let Ok(rd) = fs::read_dir(dir.join(SIDECAR_DIR)) else { return out };
    for e in rd.flatten() {
        let n = e.file_name().to_string_lossy().to_string();
        if let Some(base) = n.strip_suffix(SIDECAR_EXT) {
            if let Ok(s) = fs::read_to_string(e.path()) {
                if let Ok(sc) = serde_json::from_str::<Sidecar>(&s) {
                    out.insert(base.to_string(), sc);
                }
            }
        }
    }
    out
}

pub fn write_sidecar(file: &Path, sc: &Sidecar) -> io::Result<()> {
    let p = sidecar_path(file).ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "kein Elternordner"))?;
    if sc.is_empty() {
        // Don't leave empty sidecars behind.
        let _ = fs::remove_file(&p);
        return Ok(());
    }
    fs::create_dir_all(p.parent().unwrap())?;
    let tmp = p.with_extension("json.tmp");
    fs::write(&tmp, serde_json::to_vec_pretty(sc)?)?;
    fs::rename(tmp, p) // atomic replace
}

/// Move (or copy) the sidecar along with its file.
pub fn transfer_sidecar(from: &Path, to: &Path, copy: bool) -> io::Result<()> {
    let (Some(src), Some(dst)) = (sidecar_path(from), sidecar_path(to)) else { return Ok(()) };
    if !src.exists() {
        return Ok(());
    }
    fs::create_dir_all(dst.parent().unwrap())?;
    if copy {
        fs::copy(&src, &dst).map(|_| ())
    } else {
        fs::rename(&src, &dst).or_else(|_| fs::copy(&src, &dst).and_then(|_| fs::remove_file(&src)))
    }
}

// ---------------------------------------------------------------- tags

pub fn normalize_tag(raw: &str) -> String {
    raw.trim()
        .trim_start_matches('#')
        .split_whitespace()
        .collect::<Vec<_>>()
        .join("-")
        .split('/')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("/")
}

pub fn unique_tags<I: IntoIterator<Item = String>>(tags: I) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    tags.into_iter()
        .map(|t| normalize_tag(&t))
        .filter(|t| !t.is_empty() && seen.insert(t.to_lowercase()))
        .collect()
}

pub fn apply_patch(sc: &mut Sidecar, patch: &MetaPatch) {
    let rm: std::collections::HashSet<String> =
        patch.remove_tags.iter().map(|t| normalize_tag(t).to_lowercase()).collect();
    sc.tags = unique_tags(sc.tags.iter().cloned().chain(patch.add_tags.iter().cloned()))
        .into_iter()
        .filter(|t| !rm.contains(&t.to_lowercase()))
        .collect();
    if let Some(c) = &patch.color {
        sc.color = c.clone();
    }
    sc.updated = Some(chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true));
}

/// Tags embedded in a file name: `Foto[urlaub strand].jpg` → `["urlaub", "strand"]`.
pub fn filename_tags(name: &str) -> Vec<String> {
    let stem = match name.rfind('.') {
        Some(i) if i > 0 => &name[..i],
        _ => name,
    };
    let (Some(a), Some(b)) = (stem.find('['), stem.find(']')) else { return vec![] };
    if b <= a {
        return vec![];
    }
    unique_tags(stem[a + 1..b].split_whitespace().map(String::from))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_filename_tags() {
        assert_eq!(filename_tags("Foto[urlaub strand].jpg"), vec!["urlaub", "strand"]);
        assert!(filename_tags("plain.txt").is_empty());
        assert!(filename_tags("weird]name[.txt").is_empty());
    }

    #[test]
    fn patches_tags_case_insensitively() {
        let mut sc = Sidecar { tags: vec!["Work/Design".into(), "b".into()], ..Default::default() };
        apply_patch(
            &mut sc,
            &MetaPatch { add_tags: vec!["#c".into(), "work/design".into()], remove_tags: vec!["B".into()], color: None },
        );
        assert_eq!(sc.tags, vec!["Work/Design", "c"]);
    }

    #[test]
    fn color_patch_distinguishes_absent_and_null() {
        let p: MetaPatch = serde_json::from_str(r#"{"addTags":[]}"#).unwrap();
        assert_eq!(p.color, None);
        let p: MetaPatch = serde_json::from_str(r#"{"color":null}"#).unwrap();
        assert_eq!(p.color, Some(None));
        let p: MetaPatch = serde_json::from_str(r##"{"color":"#fff"}"##).unwrap();
        assert_eq!(p.color, Some(Some("#fff".into())));
    }

    #[test]
    fn sidecar_roundtrip_and_cleanup() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("a.jpg");
        fs::write(&f, b"x").unwrap();
        let sc = Sidecar { tags: vec!["x".into()], ..Default::default() };
        write_sidecar(&f, &sc).unwrap();
        assert_eq!(read_sidecar(&f).tags, vec!["x"]);
        assert_eq!(read_dir_sidecars(dir.path())["a.jpg"].tags, vec!["x"]);
        write_sidecar(&f, &Sidecar::default()).unwrap();
        assert!(!sidecar_path(&f).unwrap().exists());
    }
}
