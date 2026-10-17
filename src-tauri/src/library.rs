//! Central metadata index.
//!
//! Every project is a *library*: a folder with `.brausa/library.json` and
//! `.brausa/meta.jsonl`. `meta.jsonl` is the source of truth (one sorted JSON
//! line per file that carries metadata). Files outside any project live in a
//! *global* store in the app data folder with absolute paths.
//!
//! Files are identified by OS file id (inode / NTFS file index) plus a quick
//! content hash, so metadata survives renames and moves done in other apps:
//! `reconcile()` finds them again and repairs the paths.

use crate::meta::{self, Geo, MetaPatch, Sidecar, SIDECAR_DIR};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::{self, BufRead, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use walkdir::WalkDir;

const LIBRARY_FILE: &str = "library.json";
const META_FILE: &str = "meta.jsonl";
/// Orphaned records (file gone) are kept this long in case the file comes back.
const ORPHAN_TTL_MS: f64 = 30.0 * 86_400_000.0;
const QHASH_CHUNK: u64 = 64 * 1024;

fn now_ms() -> f64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as f64).unwrap_or(0.0)
}

fn new_id() -> String {
    // Time + counter is unique enough for a local index and keeps ids short.
    use std::sync::atomic::{AtomicU64, Ordering};
    static N: AtomicU64 = AtomicU64::new(0);
    let n = N.fetch_add(1, Ordering::Relaxed);
    format!("f_{:x}{:x}", now_ms() as u64, n)
}

/// OS-level identity of a file; stable across renames on the same volume.
pub fn file_id(p: &Path) -> Option<String> {
    file_id::get_file_id(p).ok().map(|id| match id {
        file_id::FileId::Inode { device_id, inode_number } => format!("ino:{device_id}:{inode_number}"),
        file_id::FileId::LowRes { volume_serial_number, file_index } => format!("win:{volume_serial_number}:{file_index}"),
        file_id::FileId::HighRes { volume_serial_number, file_id } => format!("win:{volume_serial_number}:{file_id}"),
    })
}

/// xxh3 over size + first and last 64 KB: cheap even for large videos, good enough to re-identify a file.
pub fn quick_hash(p: &Path) -> Option<String> {
    let mut f = fs::File::open(p).ok()?;
    let len = f.metadata().ok()?.len();
    let mut h = xxhash_rust::xxh3::Xxh3::new();
    h.update(&len.to_le_bytes());
    let mut buf = vec![0u8; QHASH_CHUNK as usize];
    let n = f.read(&mut buf).ok()?;
    h.update(&buf[..n]);
    if len > 2 * QHASH_CHUNK {
        f.seek(SeekFrom::End(-(QHASH_CHUNK as i64))).ok()?;
        let n = f.read(&mut buf).ok()?;
        h.update(&buf[..n]);
    }
    Some(format!("xxh3:{:016x}", h.digest()))
}

fn stat(p: &Path) -> Option<(u64, f64, bool)> {
    let md = fs::metadata(p).ok()?;
    let mtime = md.modified().ok()?.duration_since(UNIX_EPOCH).map(|d| d.as_millis() as f64).unwrap_or(0.0);
    Some((md.len(), mtime, md.is_dir()))
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct Record {
    pub id: String,
    /// Relative to the library root ('/'-separated), absolute for the global store.
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fid: Option<String>,
    #[serde(default)]
    pub size: u64,
    #[serde(default)]
    pub mtime: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub qhash: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub note: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub geo: Option<Geo>,
    /// Number of map cards pointing at this file; keeps the record alive without tags.
    #[serde(default, skip_serializing_if = "is_zero")]
    pub refs: u32,
    /// Set when the file vanished (ms since epoch).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub orphaned: Option<f64>,
}

fn is_zero(n: &u32) -> bool {
    *n == 0
}

impl Record {
    fn is_empty(&self) -> bool {
        self.tags.is_empty() && self.color.is_none() && self.note.is_empty() && self.geo.is_none() && self.refs == 0
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LibraryInfo {
    pub id: String,
    pub name: String,
    /// None for the global store.
    pub root: Option<String>,
    #[serde(default)]
    pub files: usize,
    #[serde(default)]
    pub orphans: usize,
}

#[derive(Debug, Default, Clone, Serialize, PartialEq)]
pub struct Report {
    pub relinked: Vec<(String, String)>,
    pub orphaned: Vec<String>,
    pub restored: usize,
    pub updated: usize,
    pub purged: usize,
    pub imported: usize,
}

impl Report {
    pub fn is_empty(&self) -> bool {
        self.relinked.is_empty() && self.orphaned.is_empty() && self.restored == 0 && self.updated == 0 && self.purged == 0 && self.imported == 0
    }
    fn absorb(&mut self, o: Report) {
        self.relinked.extend(o.relinked);
        self.orphaned.extend(o.orphaned);
        self.restored += o.restored;
        self.updated += o.updated;
        self.purged += o.purged;
        self.imported += o.imported;
    }
}

pub struct Library {
    pub id: String,
    pub name: String,
    /// None = global store with absolute paths.
    pub root: Option<PathBuf>,
    store: PathBuf,
    records: Vec<Record>,
    dirty: bool,
}

impl Library {
    /// Open (or initialise) a project library rooted at `root`.
    pub fn open_project(root: &Path, name: Option<&str>) -> io::Result<Library> {
        let store = root.join(SIDECAR_DIR);
        fs::create_dir_all(&store)?;
        let info_path = store.join(LIBRARY_FILE);
        let info: LibraryInfo = fs::read_to_string(&info_path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_else(|| LibraryInfo {
                id: format!("lib_{:x}", now_ms() as u64),
                name: name
                    .map(String::from)
                    .or_else(|| root.file_name().map(|n| n.to_string_lossy().to_string()))
                    .unwrap_or_else(|| "Projekt".into()),
                root: None,
                files: 0,
                orphans: 0,
            });
        if !info_path.exists() {
            fs::write(&info_path, serde_json::to_vec_pretty(&serde_json::json!({"id": info.id, "name": info.name, "v": 1}))?)?;
        }
        let mut lib = Library { id: info.id, name: info.name, root: Some(root.to_path_buf()), store, records: vec![], dirty: false };
        lib.load()?;
        Ok(lib)
    }

    pub fn open_global(store: &Path) -> io::Result<Library> {
        fs::create_dir_all(store)?;
        let mut lib = Library { id: "global".into(), name: "Global".into(), root: None, store: store.to_path_buf(), records: vec![], dirty: false };
        lib.load()?;
        Ok(lib)
    }

    fn load(&mut self) -> io::Result<()> {
        self.records.clear();
        if let Ok(f) = fs::File::open(self.store.join(META_FILE)) {
            for line in io::BufReader::new(f).lines() {
                let line = line?;
                if line.trim().is_empty() {
                    continue;
                }
                // A damaged line must not take the whole index down.
                if let Ok(r) = serde_json::from_str::<Record>(&line) {
                    self.records.push(r);
                }
            }
        }
        Ok(())
    }

    /// Write `meta.jsonl` atomically, sorted by path (stable diffs, merge-friendly).
    pub fn save(&mut self) -> io::Result<()> {
        if !self.dirty {
            return Ok(());
        }
        self.records.sort_by(|a, b| a.path.cmp(&b.path));
        let tmp = self.store.join(format!("{META_FILE}.tmp"));
        {
            let mut f = io::BufWriter::new(fs::File::create(&tmp)?);
            for r in &self.records {
                serde_json::to_writer(&mut f, r)?;
                f.write_all(b"\n")?;
            }
            f.flush()?;
        }
        fs::rename(tmp, self.store.join(META_FILE))?;
        self.dirty = false;
        Ok(())
    }

    pub fn info(&self) -> LibraryInfo {
        LibraryInfo {
            id: self.id.clone(),
            name: self.name.clone(),
            root: self.root.as_ref().map(|r| r.to_string_lossy().to_string()),
            files: self.records.iter().filter(|r| r.orphaned.is_none()).count(),
            orphans: self.records.iter().filter(|r| r.orphaned.is_some()).count(),
        }
    }

    pub fn contains(&self, p: &Path) -> bool {
        match &self.root {
            Some(root) => p.starts_with(root),
            None => true,
        }
    }

    fn key(&self, p: &Path) -> String {
        match &self.root {
            Some(root) => p.strip_prefix(root).unwrap_or(p).to_string_lossy().replace('\\', "/"),
            None => p.to_string_lossy().to_string(),
        }
    }

    fn abs(&self, key: &str) -> PathBuf {
        match &self.root {
            Some(root) => root.join(key),
            None => PathBuf::from(key),
        }
    }

    fn idx(&self, key: &str) -> Option<usize> {
        self.records.iter().position(|r| r.path == key && r.orphaned.is_none())
    }

    pub fn get(&self, p: &Path) -> Option<&Record> {
        self.idx(&self.key(p)).map(|i| &self.records[i])
    }

    fn fresh_record(&self, p: &Path) -> Record {
        let (size, mtime, is_dir) = stat(p).unwrap_or((0, 0.0, false));
        Record {
            id: new_id(),
            path: self.key(p),
            fid: file_id(p),
            size,
            mtime,
            qhash: if is_dir { None } else { quick_hash(p) },
            ..Default::default()
        }
    }

    /// Make sure `p` has a record (map cards point at files by record id) and return its id.
    pub fn ensure(&mut self, p: &Path) -> String {
        let key = self.key(p);
        if let Some(i) = self.idx(&key) {
            if self.records[i].refs == 0 {
                self.records[i].refs = 1;
                self.dirty = true;
            }
            return self.records[i].id.clone();
        }
        let mut r = self.fresh_record(p);
        r.refs = 1;
        let id = r.id.clone();
        self.records.push(r);
        self.dirty = true;
        id
    }

    /// Current absolute path of a record, unless the file is missing.
    pub fn locate(&self, id: &str) -> Option<PathBuf> {
        self.records.iter().find(|r| r.id == id && r.orphaned.is_none()).map(|r| self.abs(&r.path))
    }

    /// Set the number of map cards pointing at each record; records that only
    /// existed for a card are dropped once no card needs them.
    pub fn set_refs(&mut self, counts: &HashMap<String, u32>) {
        for r in &mut self.records {
            let n = counts.get(&r.id).copied().unwrap_or(0);
            if r.refs != n {
                r.refs = n;
                self.dirty = true;
            }
        }
        let before = self.records.len();
        self.records.retain(|r| !r.is_empty());
        self.dirty |= self.records.len() != before;
    }

    /// Apply a tag/color patch. Creates the record on first use, drops it again when empty.
    pub fn patch(&mut self, p: &Path, patch: &MetaPatch) -> Record {
        let key = self.key(p);
        let i = match self.idx(&key) {
            Some(i) => i,
            None => {
                let r = self.fresh_record(p);
                self.records.push(r);
                self.records.len() - 1
            }
        };
        let mut sc = Sidecar { tags: self.records[i].tags.clone(), color: self.records[i].color.clone(), ..Default::default() };
        meta::apply_patch(&mut sc, patch);
        self.records[i].tags = sc.tags;
        self.records[i].color = sc.color;
        let out = self.records[i].clone();
        if out.is_empty() {
            self.records.remove(i);
        }
        self.dirty = true;
        out
    }

    /// Insert a record that came from another library (move across projects).
    fn adopt(&mut self, mut r: Record, p: &Path) {
        r.path = self.key(p);
        r.orphaned = None;
        self.records.retain(|x| x.path != r.path);
        self.records.push(r);
        self.dirty = true;
    }

    fn take(&mut self, p: &Path) -> Option<Record> {
        let i = self.idx(&self.key(p))?;
        self.dirty = true;
        Some(self.records.remove(i))
    }

    /// The app moved/renamed something itself: update paths (also everything below a moved folder).
    fn rename_within(&mut self, from: &Path, to: &Path) {
        let (fk, tk) = (self.key(from), self.key(to));
        for r in &mut self.records {
            if r.path == fk {
                r.path = tk.clone();
                self.dirty = true;
            } else if let Some(rest) = r.path.strip_prefix(&format!("{fk}/")) {
                r.path = format!("{tk}/{rest}");
                self.dirty = true;
            }
        }
    }

    fn mark_orphan(&mut self, p: &Path) {
        let key = self.key(p);
        let t = now_ms();
        for r in &mut self.records {
            if r.orphaned.is_none() && (r.path == key || r.path.starts_with(&format!("{key}/"))) {
                r.orphaned = Some(t);
                self.dirty = true;
            }
        }
    }

    /// Move per-folder `.brausa/<name>.meta.json` sidecars (format before the central index) into the index.
    fn migrate_sidecars(&mut self) -> usize {
        let Some(root) = self.root.clone() else { return 0 };
        let dirs: Vec<PathBuf> = WalkDir::new(&root)
            .into_iter()
            .filter_entry(|e| e.depth() == 0 || !e.file_name().to_string_lossy().starts_with('.') || e.file_name() == SIDECAR_DIR)
            .flatten()
            .filter(|e| e.file_type().is_dir() && e.file_name() == SIDECAR_DIR)
            .map(|e| e.into_path())
            .collect();
        dirs.iter().map(|d| self.import_sidecar_dir(d)).sum()
    }

    /// Import the sidecars of one `.brausa` folder, delete them, and the folder if it is now empty.
    pub fn import_sidecar_dir(&mut self, dir: &Path) -> usize {
        let Ok(rd) = fs::read_dir(dir) else { return 0 };
        let files: Vec<PathBuf> = rd.flatten().map(|e| e.path()).filter(|p| p.to_string_lossy().ends_with(".meta.json")).collect();
        let mut n = 0;
        for sc_path in files {
            let name = sc_path.file_name().unwrap().to_string_lossy().trim_end_matches(".meta.json").to_string();
            let target = dir.parent().unwrap().join(&name);
            let sc: Option<Sidecar> = fs::read_to_string(&sc_path).ok().and_then(|s| serde_json::from_str(&s).ok());
            if let (Some(sc), true) = (sc, target.exists()) {
                self.patch(&target, &MetaPatch { add_tags: sc.tags.clone(), remove_tags: vec![], color: sc.color.clone().map(Some) });
                if let Some(i) = self.idx(&self.key(&target)) {
                    if !sc.note.is_empty() {
                        self.records[i].note = sc.note.clone();
                    }
                    if self.records[i].geo.is_none() {
                        self.records[i].geo = sc.geo.clone();
                    }
                }
                n += 1;
            }
            let _ = fs::remove_file(&sc_path);
        }
        // Only per-folder sidecar dirs disappear; a library's own store stays.
        if dir != self.store {
            let _ = fs::remove_dir(dir);
        }
        if n > 0 {
            self.dirty = true;
        }
        n
    }

    /// Bring the index in line with the file system and repair paths of moved files.
    pub fn reconcile(&mut self) -> Report {
        let mut rep = Report { imported: self.migrate_sidecars(), ..Default::default() };
        let now = now_ms();

        // 1. Records whose path still exists: refresh stats, clear orphan flag.
        let mut missing: Vec<usize> = vec![];
        for i in 0..self.records.len() {
            let p = self.abs(&self.records[i].path);
            match stat(&p) {
                Some((size, mtime, is_dir)) => {
                    let r = &mut self.records[i];
                    let mut changed = false;
                    if r.orphaned.take().is_some() {
                        rep.restored += 1;
                        changed = true;
                    }
                    if r.size != size || r.mtime != mtime {
                        r.size = size;
                        r.mtime = mtime;
                        r.qhash = if is_dir { None } else { quick_hash(&p) };
                        // Editors often save via a new inode; the path wins.
                        r.fid = file_id(&p);
                        rep.updated += 1;
                        changed = true;
                    }
                    self.dirty |= changed;
                }
                None => missing.push(i),
            }
        }

        // 2. Look for the missing ones: same file id first, then size + quick hash.
        if !missing.is_empty() {
            let known: std::collections::HashSet<String> = self.records.iter().map(|r| r.path.clone()).collect();
            let candidates = self.candidates(&missing, &known);
            let mut by_fid: HashMap<String, PathBuf> = HashMap::new();
            let mut by_size: HashMap<u64, Vec<PathBuf>> = HashMap::new();
            for (p, fid, size) in candidates {
                if let Some(f) = fid {
                    by_fid.insert(f, p.clone());
                }
                by_size.entry(size).or_default().push(p);
            }
            let mut taken: std::collections::HashSet<PathBuf> = std::collections::HashSet::new();
            for &i in &missing {
                let r = &self.records[i];
                let hit = r
                    .fid
                    .as_ref()
                    .and_then(|f| by_fid.get(f))
                    .filter(|p| !taken.contains(*p))
                    .cloned()
                    .or_else(|| {
                        let qh = r.qhash.as_ref()?;
                        by_size.get(&r.size)?.iter().find(|p| !taken.contains(*p) && quick_hash(p).as_ref() == Some(qh)).cloned()
                    });
                match hit {
                    Some(p) => {
                        let old = self.records[i].path.clone();
                        let new_key = self.key(&p);
                        let r = &mut self.records[i];
                        r.path = new_key.clone();
                        r.orphaned = None;
                        r.fid = file_id(&p);
                        taken.insert(p);
                        rep.relinked.push((old, new_key));
                        self.dirty = true;
                    }
                    None => {
                        if self.records[i].orphaned.is_none() {
                            self.records[i].orphaned = Some(now);
                            rep.orphaned.push(self.records[i].path.clone());
                            self.dirty = true;
                        }
                    }
                }
            }
        }

        // 3. Forget orphans after the grace period.
        let before = self.records.len();
        self.records.retain(|r| r.orphaned.is_none_or(|t| now - t < ORPHAN_TTL_MS));
        rep.purged = before - self.records.len();
        if rep.purged > 0 {
            self.dirty = true;
        }
        rep
    }

    /// Unindexed paths that a missing record could have moved to.
    fn candidates(&self, missing: &[usize], known: &std::collections::HashSet<String>) -> Vec<(PathBuf, Option<String>, u64)> {
        let roots: Vec<PathBuf> = match &self.root {
            Some(root) => vec![root.clone()],
            // Global store: only look next to where the file used to be (renames), never walk the disk.
            None => missing
                .iter()
                .filter_map(|&i| Path::new(&self.records[i].path).parent().map(Path::to_path_buf))
                .filter(|d| d.is_dir())
                .collect(),
        };
        let mut out = vec![];
        for root in roots {
            let depth = if self.root.is_some() { usize::MAX } else { 1 };
            for e in WalkDir::new(&root)
                .min_depth(1)
                .max_depth(depth)
                .into_iter()
                .filter_entry(|e| !e.file_name().to_string_lossy().starts_with('.'))
                .flatten()
            {
                let p = e.path();
                if known.contains(&self.key(p)) {
                    continue;
                }
                let size = e.metadata().map(|m| m.len()).unwrap_or(0);
                out.push((p.to_path_buf(), file_id(p), size));
            }
        }
        out
    }
}

/// All libraries plus the global store; knows which one is responsible for a path.
pub struct Registry {
    app_dir: PathBuf,
    pub libs: Vec<Library>,
    pub global: Library,
}

#[derive(Serialize, Deserialize, Default)]
struct RegistryFile {
    roots: Vec<String>,
}

impl Registry {
    pub fn open(app_dir: &Path) -> io::Result<Registry> {
        fs::create_dir_all(app_dir)?;
        let reg: RegistryFile =
            fs::read_to_string(app_dir.join("libraries.json")).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
        let libs = reg.roots.iter().filter_map(|r| Library::open_project(Path::new(r), None).ok()).collect();
        let global = Library::open_global(&app_dir.join("global"))?;
        Ok(Registry { app_dir: app_dir.to_path_buf(), libs, global })
    }

    fn save_registry(&self) -> io::Result<()> {
        let reg = RegistryFile { roots: self.libs.iter().filter_map(|l| l.root.as_ref()).map(|r| r.to_string_lossy().to_string()).collect() };
        fs::write(self.app_dir.join("libraries.json"), serde_json::to_vec_pretty(&reg)?)
    }

    pub fn infos(&self) -> Vec<LibraryInfo> {
        self.libs.iter().map(Library::info).collect()
    }

    /// Include a folder as a project. Nested projects are allowed; the innermost wins.
    pub fn add(&mut self, root: &Path, name: Option<&str>) -> io::Result<LibraryInfo> {
        if let Some(l) = self.libs.iter().find(|l| l.root.as_deref() == Some(root)) {
            return Ok(l.info());
        }
        let mut lib = Library::open_project(root, name)?;
        // Global records that now belong to this project move over.
        let moving: Vec<Record> = self.global.records.iter().filter(|r| Path::new(&r.path).starts_with(root)).cloned().collect();
        for r in moving {
            let p = PathBuf::from(&r.path);
            self.global.take(&p);
            lib.adopt(r, &p);
        }
        let info = lib.info();
        lib.save()?;
        self.global.save()?;
        self.libs.push(lib);
        self.save_registry()?;
        Ok(info)
    }

    /// Stop tracking a project. Its `.brausa` folder stays, so re-adding restores everything.
    pub fn remove(&mut self, root: &Path) -> io::Result<()> {
        self.libs.retain(|l| l.root.as_deref() != Some(root));
        self.save_registry()
    }

    fn owner_idx(&self, p: &Path) -> Option<usize> {
        self.libs
            .iter()
            .enumerate()
            .filter(|(_, l)| l.contains(p))
            .max_by_key(|(_, l)| l.root.as_ref().map(|r| r.components().count()).unwrap_or(0))
            .map(|(i, _)| i)
    }

    pub fn owner_mut(&mut self, p: &Path) -> &mut Library {
        match self.owner_idx(p) {
            Some(i) => &mut self.libs[i],
            None => &mut self.global,
        }
    }

    pub fn owner(&self, p: &Path) -> &Library {
        match self.owner_idx(p) {
            Some(i) => &self.libs[i],
            None => &self.global,
        }
    }

    pub fn get(&self, p: &Path) -> Option<&Record> {
        self.owner(p).get(p)
    }

    pub fn patch(&mut self, p: &Path, patch: &MetaPatch) -> io::Result<Record> {
        let lib = self.owner_mut(p);
        let r = lib.patch(p, patch);
        lib.save()?;
        Ok(r)
    }

    /// brausa moved or renamed `from` to `to` (possibly across projects).
    pub fn moved(&mut self, from: &Path, to: &Path) -> io::Result<()> {
        let (a, b) = (self.owner_idx(from), self.owner_idx(to));
        if a == b {
            let lib = self.owner_mut(from);
            lib.rename_within(from, to);
            return lib.save();
        }
        // Across libraries: carry the record and everything below a moved folder.
        let src = self.owner_mut(from);
        let fk = src.key(from);
        let moving: Vec<Record> =
            src.records.iter().filter(|r| r.path == fk || r.path.starts_with(&format!("{fk}/"))).cloned().collect();
        src.records.retain(|r| !(r.path == fk || r.path.starts_with(&format!("{fk}/"))));
        src.dirty = true;
        src.save()?;
        let dst = self.owner_mut(to);
        for r in moving {
            let rel = r.path[fk.len()..].trim_start_matches('/').to_string();
            let p = if rel.is_empty() { to.to_path_buf() } else { to.join(&rel) };
            dst.adopt(r, &p);
        }
        dst.save()
    }

    /// brausa copied `from` to `to`: the copy gets its own record with the same tags.
    pub fn copied(&mut self, from: &Path, to: &Path) -> io::Result<()> {
        let Some(src) = self.get(from).cloned() else { return Ok(()) };
        let dst = self.owner_mut(to);
        let mut r = dst.fresh_record(to);
        r.tags = src.tags;
        r.color = src.color;
        r.note = src.note;
        r.geo = src.geo;
        dst.adopt(r, to);
        dst.save()
    }

    /// Old sidecars in a folder that is opened in the UI (also outside projects).
    pub fn migrate_dir(&mut self, dir: &Path) -> io::Result<usize> {
        let sc_dir = dir.join(SIDECAR_DIR);
        if !sc_dir.is_dir() {
            return Ok(0);
        }
        let lib = self.owner_mut(dir);
        let n = lib.import_sidecar_dir(&sc_dir);
        lib.save()?;
        Ok(n)
    }

    /// Give each path a stable id for map cards (creates index records as needed).
    pub fn link(&mut self, p: &Path) -> io::Result<String> {
        let lib = self.owner_mut(p);
        let id = lib.ensure(p);
        lib.save()?;
        Ok(id)
    }

    pub fn locate(&self, id: &str) -> Option<PathBuf> {
        self.libs.iter().chain(std::iter::once(&self.global)).find_map(|l| l.locate(id))
    }

    /// Reference counts from all maps of all projects (see `maps::ref_counts`).
    pub fn set_refs(&mut self, counts: &HashMap<String, u32>) -> io::Result<()> {
        for lib in self.libs.iter_mut().chain(std::iter::once(&mut self.global)) {
            lib.set_refs(counts);
            lib.save()?;
        }
        Ok(())
    }

    pub fn trashed(&mut self, p: &Path) -> io::Result<()> {
        let lib = self.owner_mut(p);
        lib.mark_orphan(p);
        lib.save()
    }

    pub fn reconcile_all(&mut self) -> Report {
        let mut rep = Report::default();
        for lib in self.libs.iter_mut().chain(std::iter::once(&mut self.global)) {
            rep.absorb(lib.reconcile());
            let _ = lib.save();
        }
        rep
    }

    /// Reconcile only the libraries that contain one of `paths` (watcher events).
    pub fn reconcile_for(&mut self, paths: &[PathBuf]) -> Report {
        let mut idx: Vec<Option<usize>> = paths.iter().map(|p| self.owner_idx(p)).collect();
        idx.sort();
        idx.dedup();
        let mut rep = Report::default();
        for i in idx {
            let lib = match i {
                Some(i) => &mut self.libs[i],
                None => &mut self.global,
            };
            rep.absorb(lib.reconcile());
            let _ = lib.save();
        }
        rep
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn linked_files_keep_their_id_across_moves_until_unreferenced() {
        let t = tempfile::tempdir().unwrap();
        let root = t.path().join("proj");
        fs::create_dir_all(root.join("sub")).unwrap();
        fs::write(root.join("plan.pdf"), b"%PDF plan").unwrap();
        let mut reg = Registry::open(&t.path().join("app")).unwrap();
        reg.add(&root, None).unwrap();
        let id = reg.link(&root.join("plan.pdf")).unwrap();
        assert_eq!(reg.link(&root.join("plan.pdf")).unwrap(), id);
        fs::rename(root.join("plan.pdf"), root.join("sub/plan-v2.pdf")).unwrap();
        reg.reconcile_all();
        assert_eq!(reg.locate(&id), Some(root.join("sub/plan-v2.pdf")));
        // No map needs it any more and it carries no tags: the record goes away.
        reg.set_refs(&HashMap::new()).unwrap();
        assert_eq!(reg.locate(&id), None);
    }

    fn tags(t: &[&str]) -> MetaPatch {
        MetaPatch { add_tags: t.iter().map(|s| s.to_string()).collect(), remove_tags: vec![], color: None }
    }

    #[test]
    fn project_metadata_survives_external_rename_and_move() {
        let t = tempfile::tempdir().unwrap();
        let root = t.path().join("proj");
        fs::create_dir_all(root.join("a/b")).unwrap();
        fs::write(root.join("a/x.jpg"), vec![7u8; 200_000]).unwrap();
        let mut lib = Library::open_project(&root, Some("Test")).unwrap();
        lib.patch(&root.join("a/x.jpg"), &tags(&["Work"]));
        lib.save().unwrap();

        // Someone renames and moves the file in Finder.
        fs::rename(root.join("a/x.jpg"), root.join("a/b/renamed.jpg")).unwrap();
        let mut lib = Library::open_project(&root, None).unwrap();
        let rep = lib.reconcile();
        assert_eq!(rep.relinked, vec![("a/x.jpg".to_string(), "a/b/renamed.jpg".to_string())]);
        assert_eq!(lib.get(&root.join("a/b/renamed.jpg")).unwrap().tags, vec!["Work"]);
        assert_eq!(lib.info().name, "Test");
    }

    #[test]
    fn relinks_by_content_when_file_id_changed() {
        // A copy + delete (e.g. via a sync client) gives a new inode; the quick hash still matches.
        let t = tempfile::tempdir().unwrap();
        let root = t.path().to_path_buf();
        fs::write(root.join("doc.pdf"), b"hello pdf").unwrap();
        let mut lib = Library::open_project(&root, None).unwrap();
        lib.patch(&root.join("doc.pdf"), &tags(&["Steuer"]));
        fs::copy(root.join("doc.pdf"), root.join("Steuer-2025.pdf")).unwrap();
        fs::remove_file(root.join("doc.pdf")).unwrap();
        let rep = lib.reconcile();
        assert_eq!(rep.relinked.len(), 1);
        assert!(lib.get(&root.join("Steuer-2025.pdf")).is_some());
    }

    #[test]
    fn orphans_are_kept_and_restored() {
        let t = tempfile::tempdir().unwrap();
        let root = t.path().to_path_buf();
        fs::write(root.join("a.txt"), b"a").unwrap();
        let mut lib = Library::open_project(&root, None).unwrap();
        lib.patch(&root.join("a.txt"), &tags(&["x"]));
        fs::remove_file(root.join("a.txt")).unwrap();
        let rep = lib.reconcile();
        assert_eq!(rep.orphaned, vec!["a.txt"]);
        assert_eq!(lib.info().orphans, 1);
        // Back from the trash at the same path.
        fs::write(root.join("a.txt"), b"a").unwrap();
        let rep = lib.reconcile();
        assert_eq!(rep.restored, 1);
        assert_eq!(lib.get(&root.join("a.txt")).unwrap().tags, vec!["x"]);
    }

    #[test]
    fn migrates_old_sidecars_and_cleans_up() {
        let t = tempfile::tempdir().unwrap();
        let root = t.path().to_path_buf();
        fs::create_dir_all(root.join("sub")).unwrap();
        fs::write(root.join("sub/p.jpg"), b"img").unwrap();
        meta::write_sidecar(&root.join("sub/p.jpg"), &Sidecar { tags: vec!["Alt".into()], ..Default::default() }).unwrap();
        let mut lib = Library::open_project(&root, None).unwrap();
        let rep = lib.reconcile();
        lib.save().unwrap();
        assert_eq!(rep.imported, 1);
        assert_eq!(lib.get(&root.join("sub/p.jpg")).unwrap().tags, vec!["Alt"]);
        assert!(!root.join("sub/.brausa").exists(), "per-folder sidecar dir is removed");
        let line = fs::read_to_string(root.join(".brausa/meta.jsonl")).unwrap();
        assert!(line.contains("\"path\":\"sub/p.jpg\""));
    }

    #[test]
    fn registry_routes_paths_and_moves_across_projects() {
        let t = tempfile::tempdir().unwrap();
        let app = t.path().join("app");
        let (p1, p2) = (t.path().join("p1"), t.path().join("p2"));
        fs::create_dir_all(&p1).unwrap();
        fs::create_dir_all(&p2).unwrap();
        let loose = t.path().join("loose.txt");
        fs::write(&loose, b"l").unwrap();
        fs::write(p1.join("f.txt"), b"f").unwrap();

        let mut reg = Registry::open(&app).unwrap();
        reg.patch(&loose, &tags(&["global"])).unwrap();
        assert_eq!(reg.owner(&loose).id, "global");
        reg.add(&p1, Some("Eins")).unwrap();
        reg.add(&p2, None).unwrap();
        reg.patch(&p1.join("f.txt"), &tags(&["a"])).unwrap();

        // Move from project 1 to project 2 through brausa.
        fs::rename(p1.join("f.txt"), p2.join("f.txt")).unwrap();
        reg.moved(&p1.join("f.txt"), &p2.join("f.txt")).unwrap();
        assert!(reg.get(&p1.join("f.txt")).is_none());
        assert_eq!(reg.get(&p2.join("f.txt")).unwrap().tags, vec!["a"]);

        // Registry survives a restart.
        let reg = Registry::open(&app).unwrap();
        assert_eq!(reg.infos().len(), 2);
        assert_eq!(reg.get(&p2.join("f.txt")).unwrap().tags, vec!["a"]);
        assert_eq!(reg.get(&loose).unwrap().tags, vec!["global"]);
    }

    #[test]
    fn adding_a_project_adopts_global_records() {
        let t = tempfile::tempdir().unwrap();
        let p = t.path().join("p");
        fs::create_dir_all(&p).unwrap();
        fs::write(p.join("x.txt"), b"x").unwrap();
        let mut reg = Registry::open(&t.path().join("app")).unwrap();
        reg.patch(&p.join("x.txt"), &tags(&["t"])).unwrap();
        reg.add(&p, None).unwrap();
        assert_ne!(reg.owner(&p.join("x.txt")).id, "global");
        assert_eq!(reg.get(&p.join("x.txt")).unwrap().tags, vec!["t"]);
        assert!(reg.global.get(&p.join("x.txt")).is_none());
    }

    #[test]
    fn migrates_sidecars_outside_projects_on_open() {
        let t = tempfile::tempdir().unwrap();
        let d = t.path().join("loose");
        fs::create_dir_all(&d).unwrap();
        fs::write(d.join("a.jpg"), b"a").unwrap();
        meta::write_sidecar(&d.join("a.jpg"), &Sidecar { tags: vec!["Alt".into()], ..Default::default() }).unwrap();
        let mut reg = Registry::open(&t.path().join("app")).unwrap();
        assert_eq!(reg.migrate_dir(&d).unwrap(), 1);
        assert_eq!(reg.get(&d.join("a.jpg")).unwrap().tags, vec!["Alt"]);
        assert!(!d.join(".brausa").exists());
    }
}
