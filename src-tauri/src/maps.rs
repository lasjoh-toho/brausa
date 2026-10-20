//! Project maps: one JSON file per map in `<project>/.brausa/maps/<id>.json`.
//!
//! The Rust side treats a map as an opaque JSON document (the format lives in
//! `src/lib/core/map.ts`); it only checks the id, writes atomically and lists
//! the maps of a project.

use serde::Serialize;
use serde_json::Value;
use std::{
    collections::HashMap,
    fs, io,
    path::{Path, PathBuf},
};

use crate::meta::SIDECAR_DIR;

#[derive(Debug, Serialize, PartialEq)]
pub struct MapInfo {
    pub id: String,
    pub title: String,
    pub updated: Option<String>,
}

fn dir(root: &Path) -> PathBuf {
    root.join(SIDECAR_DIR).join("maps")
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

fn file(root: &Path, id: &str) -> io::Result<PathBuf> {
    if !valid_id(id) {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, crate::tr!(format!("Ungültige Map-ID „{id}“"), format!("Invalid map id “{id}”"))));
    }
    Ok(dir(root).join(format!("{id}.json")))
}

pub fn list(root: &Path) -> Vec<MapInfo> {
    let mut out: Vec<MapInfo> = fs::read_dir(dir(root))
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| e.path().extension().is_some_and(|x| x == "json"))
        .filter_map(|e| {
            let v: Value = serde_json::from_slice(&fs::read(e.path()).ok()?).ok()?;
            let id = v.get("id")?.as_str()?.to_string();
            let title = v.get("title").and_then(Value::as_str).unwrap_or(&id).to_string();
            let updated = v.get("updated").and_then(Value::as_str).map(String::from);
            Some(MapInfo { id, title, updated })
        })
        .collect();
    out.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase()));
    out
}

pub fn load(root: &Path, id: &str) -> io::Result<Value> {
    let bytes = fs::read(file(root, id)?)?;
    serde_json::from_slice(&bytes).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))
}

pub fn save(root: &Path, map: &Value) -> io::Result<()> {
    let id = map.get("id").and_then(Value::as_str).unwrap_or_default();
    let p = file(root, id)?;
    fs::create_dir_all(p.parent().unwrap())?;
    let tmp = p.with_extension("json.tmp");
    // Pretty-printed so maps diff well under version control.
    fs::write(&tmp, serde_json::to_vec_pretty(map)?)?;
    fs::rename(tmp, p)
}

/// How many cards in all maps of these projects point at each index record.
pub fn ref_counts<'a>(roots: impl IntoIterator<Item = &'a Path>) -> HashMap<String, u32> {
    let mut out = HashMap::new();
    for root in roots {
        for info in list(root) {
            let Ok(m) = load(root, &info.id) else { continue };
            let cards = m.get("cards").and_then(Value::as_object).into_iter().flat_map(|c| c.values());
            let notes = load_notes(root);
            let thread = notes.as_array().into_iter().flatten();
            for r in cards.chain(thread).filter_map(|c| c.get("refs")?.as_array()).flatten() {
                if r.get("kind").and_then(Value::as_str) == Some("file") {
                    if let Some(id) = r.get("id").and_then(Value::as_str) {
                        *out.entry(id.to_string()).or_insert(0) += 1;
                    }
                }
            }
        }
    }
    out
}

/// The project's notes & snippets thread: cards not (or no longer) placed on a map,
/// in `<project>/.brausa/notes.json` (a JSON list, newest last).
fn notes_file(root: &Path) -> PathBuf {
    root.join(SIDECAR_DIR).join("notes.json")
}

pub fn load_notes(root: &Path) -> Value {
    fs::read(notes_file(root)).ok().and_then(|b| serde_json::from_slice(&b).ok()).filter(Value::is_array).unwrap_or(Value::Array(vec![]))
}

pub fn save_notes(root: &Path, notes: &Value) -> io::Result<()> {
    if !notes.is_array() {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "notes must be a list"));
    }
    let p = notes_file(root);
    fs::create_dir_all(p.parent().unwrap())?;
    let tmp = p.with_extension("json.tmp");
    fs::write(&tmp, serde_json::to_vec_pretty(notes)?)?;
    fs::rename(tmp, p)
}

pub fn delete(root: &Path, id: &str) -> io::Result<()> {
    match fs::remove_file(file(root, id)?) {
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        r => r,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn saves_lists_loads_and_deletes() {
        let t = tempfile::tempdir().unwrap();
        let root = t.path();
        assert!(list(root).is_empty());
        let m = json!({"v": 1, "id": "m_b", "title": "Roadmap", "cards": {}, "roots": [], "links": []});
        save(root, &m).unwrap();
        save(root, &json!({"v": 1, "id": "m_a", "title": "archiv"})).unwrap();
        assert_eq!(list(root).iter().map(|i| i.title.as_str()).collect::<Vec<_>>(), ["archiv", "Roadmap"]);
        assert_eq!(load(root, "m_b").unwrap(), m);
        delete(root, "m_b").unwrap();
        delete(root, "m_b").unwrap(); // idempotent
        assert_eq!(list(root).len(), 1);
    }

    #[test]
    fn counts_file_references_across_maps() {
        let t = tempfile::tempdir().unwrap();
        let card = |id: &str| json!({"refs": [{"kind": "file", "id": id}, {"kind": "url", "href": "x"}]});
        save(t.path(), &json!({"id": "a", "cards": {"c1": card("f_1"), "c2": card("f_2")}})).unwrap();
        save(t.path(), &json!({"id": "b", "cards": {"c1": card("f_1")}})).unwrap();
        let n = ref_counts([t.path()]);
        assert_eq!(n.get("f_1"), Some(&2));
        assert_eq!(n.get("f_2"), Some(&1));
        assert_eq!(n.len(), 2);
    }

    #[test]
    fn rejects_ids_that_escape_the_folder() {
        let t = tempfile::tempdir().unwrap();
        assert!(save(t.path(), &json!({"id": "../evil"})).is_err());
        assert!(load(t.path(), "a/b").is_err());
        assert!(save(t.path(), &json!({"title": "no id"})).is_err());
    }
}
