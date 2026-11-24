//! Folder sizes, remembered ("eigener Index", part 1).
//!
//! Counting a folder's size means reading every file below it, which can take
//! half a minute on a large disk. brausa keeps what it counted in
//! `dir-sizes.json` in the app data folder, so the size is there at once the
//! next time, and counts again in the background when the number is older than
//! a minute. One scan of a folder fills the sizes of all its subfolders too.

use serde::Serialize;
use std::collections::{HashMap, HashSet, VecDeque};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use walkdir::WalkDir;

/// Counted again after this long (ms).
pub const MAX_AGE_MS: f64 = 60_000.0;
/// Kept on disk: folders up to this deep below a scanned folder, deeper ones only when large.
const KEEP_DEPTH: usize = 4;
const KEEP_SIZE: u64 = 20_000_000;

#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
pub struct DirSize {
    pub size: u64,
    pub files: u64,
    /// When it was counted (ms since 1970).
    pub scanned: f64,
}

pub fn now_ms() -> f64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as f64).unwrap_or(0.0)
}

/// Size and file count of `root` and every folder below it (keys: full paths).
/// Symlinks are not followed and other file systems (mounted drives) are left out.
pub fn scan(root: &Path, now: f64) -> HashMap<String, DirSize> {
    let mut sums: HashMap<PathBuf, (u64, u64, usize)> = HashMap::new();
    sums.insert(root.to_path_buf(), (0, 0, 0));
    for e in WalkDir::new(root).follow_links(false).same_file_system(true).into_iter().flatten() {
        let ft = e.file_type();
        if ft.is_dir() {
            sums.entry(e.path().to_path_buf()).or_insert((0, 0, e.depth()));
            continue;
        }
        if !ft.is_file() {
            continue;
        }
        let len = e.metadata().map(|m| m.len()).unwrap_or(0);
        // Add to every folder from the file's own up to the root.
        let mut p = e.path().parent();
        while let Some(dir) = p {
            if let Some(s) = sums.get_mut(dir) {
                s.0 += len;
                s.1 += 1;
            }
            if dir == root {
                break;
            }
            p = dir.parent();
        }
    }
    sums.into_iter()
        .map(|(p, (size, files, _))| (p.to_string_lossy().to_string(), DirSize { size, files, scanned: now }))
        .collect()
}

/// The remembered sizes.
#[derive(Default)]
pub struct Sizes {
    map: HashMap<String, DirSize>,
    file: Option<PathBuf>,
}

impl Sizes {
    pub fn open(file: PathBuf) -> Self {
        let map = fs::read(&file)
            .ok()
            .and_then(|b| serde_json::from_slice::<HashMap<String, (u64, u64, f64)>>(&b).ok())
            .unwrap_or_default()
            .into_iter()
            .map(|(p, (size, files, scanned))| (p, DirSize { size, files, scanned }))
            .collect();
        Sizes { map, file: Some(file) }
    }

    pub fn get(&self, path: &str) -> Option<DirSize> {
        self.map.get(path).copied()
    }

    pub fn stale(&self, path: &str, now: f64) -> bool {
        self.map.get(path).is_none_or(|s| now - s.scanned > MAX_AGE_MS)
    }

    /// Take a scan of `root`: replaces everything remembered below it (folders gone since are dropped).
    pub fn insert_scan(&mut self, root: &str, scan: HashMap<String, DirSize>) {
        let prefix = format!("{}{}", root.trim_end_matches(['/', '\\']), std::path::MAIN_SEPARATOR);
        self.map.retain(|p, _| p != root && !p.starts_with(&prefix));
        let depth = |p: &str| p[prefix.len().min(p.len())..].split(['/', '\\']).filter(|s| !s.is_empty()).count();
        for (p, s) in scan {
            if p == root || depth(&p) <= KEEP_DEPTH || s.size >= KEEP_SIZE {
                self.map.insert(p, s);
            }
        }
    }

    /// Files changed in `dirs`: their sizes and those of every folder above them count as old.
    pub fn forget(&mut self, dirs: &[String]) {
        let norm = |p: &str| p.replace('\\', "/").trim_end_matches('/').to_string();
        let changed: Vec<String> = dirs.iter().map(|d| norm(d)).collect();
        for (p, s) in self.map.iter_mut() {
            let k = norm(p);
            if changed.iter().any(|c| *c == k || c.starts_with(&format!("{k}/"))) {
                s.scanned = 0.0;
            }
        }
    }

    pub fn save(&self) {
        let Some(file) = &self.file else { return };
        let out: HashMap<&String, (u64, u64, f64)> = self.map.iter().map(|(p, s)| (p, (s.size, s.files, s.scanned))).collect();
        if let Ok(b) = serde_json::to_vec(&out) {
            let tmp = file.with_extension("tmp");
            if fs::write(&tmp, b).is_ok() {
                let _ = fs::rename(tmp, file);
            }
        }
    }
}

/// Folders waiting to be counted, and whether a worker is running.
#[derive(Default)]
pub struct Queue {
    pub waiting: VecDeque<String>,
    pub running: bool,
}

/// Shared state for the command and its background worker.
#[derive(Clone, Default)]
pub struct SizeIndex {
    pub sizes: Arc<Mutex<Sizes>>,
    pub queue: Arc<Mutex<Queue>>,
}

impl SizeIndex {
    pub fn open(file: PathBuf) -> Self {
        SizeIndex { sizes: Arc::new(Mutex::new(Sizes::open(file))), queue: Default::default() }
    }

    /// What is known now for `paths`; queues the unknown and old ones. Returns whether a worker must be started.
    pub fn request(&self, paths: &[String]) -> (HashMap<String, DirSize>, bool) {
        let now = now_ms();
        let (known, stale): (HashMap<String, DirSize>, Vec<String>) = {
            let s = self.sizes.lock().unwrap_or_else(|e| e.into_inner());
            (paths.iter().filter_map(|p| s.get(p).map(|d| (p.clone(), d))).collect(), paths.iter().filter(|p| s.stale(p, now)).cloned().collect())
        };
        let mut q = self.queue.lock().unwrap_or_else(|e| e.into_inner());
        let queued: HashSet<String> = q.waiting.iter().cloned().collect();
        for p in stale {
            if !queued.contains(&p) {
                q.waiting.push_back(p);
            }
        }
        // Parents first: their scan fills the children, which are then skipped.
        q.waiting.make_contiguous().sort_by_key(|p| p.len());
        let start = !q.running && !q.waiting.is_empty();
        if start {
            q.running = true;
        }
        (known, start)
    }

    /// Counts what is queued, one folder after the other; `done` is called with each counted folder.
    pub fn work(&self, done: impl Fn(&str)) {
        loop {
            let next = {
                let mut q = self.queue.lock().unwrap_or_else(|e| e.into_inner());
                match q.waiting.pop_front() {
                    Some(p) => p,
                    None => {
                        q.running = false;
                        break;
                    }
                }
            };
            if !self.sizes.lock().unwrap_or_else(|e| e.into_inner()).stale(&next, now_ms()) {
                continue;
            }
            let path = Path::new(&next);
            if !path.is_dir() {
                continue;
            }
            let scan = scan(path, now_ms());
            self.sizes.lock().unwrap_or_else(|e| e.into_inner()).insert_scan(&next, scan);
            done(&next);
        }
        self.sizes.lock().unwrap_or_else(|e| e.into_inner()).save();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(p: &Path, bytes: usize) {
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, vec![0u8; bytes]).unwrap();
    }

    #[test]
    fn counts_every_folder_below() {
        let d = tempfile::tempdir().unwrap();
        let r = d.path();
        write(&r.join("a.bin"), 10);
        write(&r.join("x/b.bin"), 100);
        write(&r.join("x/y/c.bin"), 1000);
        fs::create_dir_all(r.join("empty")).unwrap();
        let s = scan(r, 1.0);
        let at = |p: &Path| s[&p.to_string_lossy().to_string()];
        assert_eq!((at(r).size, at(r).files), (1110, 3));
        assert_eq!((at(&r.join("x")).size, at(&r.join("x")).files), (1100, 2));
        assert_eq!(at(&r.join("x/y")).size, 1000);
        assert_eq!(at(&r.join("empty")).size, 0);
    }

    #[test]
    fn remembers_and_counts_again_in_the_background() {
        let d = tempfile::tempdir().unwrap();
        let r = d.path().join("root");
        write(&r.join("sub/f.bin"), 50);
        let file = d.path().join("dir-sizes.json");
        let idx = SizeIndex::open(file.clone());
        let root = r.to_string_lossy().to_string();
        let sub = r.join("sub").to_string_lossy().to_string();

        let (known, start) = idx.request(&[sub.clone(), root.clone()]);
        assert!(known.is_empty());
        assert!(start);
        let counted = Mutex::new(vec![]);
        idx.work(|p| counted.lock().unwrap().push(p.to_string()));
        // The root first; its scan filled "sub", so that is not counted again.
        assert_eq!(*counted.lock().unwrap(), vec![root.clone()]);

        let (known, start) = idx.request(&[sub.clone(), root.clone()]);
        assert_eq!(known[&sub].size, 50);
        assert_eq!(known[&root].files, 1);
        assert!(!start);

        // Kept on disk for the next start.
        let again = SizeIndex::open(file);
        assert_eq!(again.request(std::slice::from_ref(&root)).0[&root].size, 50);
    }

    #[test]
    fn a_new_scan_drops_folders_that_are_gone() {
        let d = tempfile::tempdir().unwrap();
        let r = d.path();
        write(&r.join("old/f.bin"), 5);
        let mut s = Sizes::default();
        let root = r.to_string_lossy().to_string();
        s.insert_scan(&root, scan(r, 1.0));
        let old = r.join("old").to_string_lossy().to_string();
        assert!(s.get(&old).is_some());
        fs::remove_dir_all(r.join("old")).unwrap();
        s.insert_scan(&root, scan(r, 2.0));
        assert!(s.get(&old).is_none());
        assert_eq!(s.get(&root).unwrap().size, 0);
    }

    #[test]
    fn a_change_makes_the_folder_and_all_above_old() {
        let mut s = Sizes::default();
        let d = |size| DirSize { size, files: 1, scanned: now_ms() };
        for p in ["/a", "/a/b", "/a/b/c", "/a/x", "/ab"] {
            s.map.insert(p.to_string(), d(1));
        }
        s.forget(&["/a/b".to_string()]);
        let now = now_ms();
        assert!(s.stale("/a", now) && s.stale("/a/b", now));
        assert!(!s.stale("/a/b/c", now) && !s.stale("/a/x", now) && !s.stale("/ab", now));
    }
}
