//! File-system operations behind the Tauri commands. Kept free of Tauri types
//! so they can be unit-tested and reused (e.g. by a future CLI).

use crate::library::Record;
use crate::meta::{self, Geo, SIDECAR_DIR};
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use walkdir::WalkDir;

/// Mirrors `Entry` in `src/lib/core/types.ts`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub path: String,
    pub name: String,
    pub ext: String,
    pub kind: &'static str,
    pub size: u64,
    pub mtime: f64,
    pub ctime: f64,
    pub tags: Vec<String>,
    pub color: Option<String>,
    pub geo: Option<Geo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rel_dir: Option<String>,
}

#[derive(Debug, Default, Serialize)]
pub struct TransferResult {
    pub moved: HashMap<String, String>,
    pub errors: Vec<TransferError>,
}

#[derive(Debug, Serialize)]
pub struct TransferError {
    pub path: String,
    pub message: String,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Mode {
    Move,
    Copy,
}

fn ms(t: io::Result<std::time::SystemTime>) -> f64 {
    t.ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis() as f64).unwrap_or(0.0)
}

pub fn is_hidden(name: &str) -> bool {
    name.starts_with('.') || name == SIDECAR_DIR
}

/// Files and folders of the system, never the user's own: hidden like dot files.
const SYSTEM_NAMES: &[&str] = &[
    "$RECYCLE.BIN",
    "System Volume Information",
    "$WinREAgent",
    "AppData",
    "Application Data",
    "Local Settings",
    "pagefile.sys",
    "hiberfil.sys",
    "swapfile.sys",
    "DumpStack.log.tmp",
    "desktop.ini",
    "Thumbs.db",
    "Icon\r",
];

/// Folders full of program files: shown in a listing, but Stream and the watcher do not go in.
const PROGRAM_DIRS: &[&str] = &[
    "node_modules",
    "__pycache__",
    "site-packages",
    "bower_components",
    "Program Files",
    "Program Files (x86)",
    "ProgramData",
    "Windows",
    "Recovery",
    "MSOCache",
    #[cfg(target_os = "macos")]
    "Library",
    #[cfg(target_os = "macos")]
    "Applications",
    #[cfg(target_os = "macos")]
    "System",
];

/// Packages (apps, photo libraries) look like folders but belong to a program.
const PACKAGE_EXTS: &[&str] = &[
    "app", "framework", "bundle", "plugin", "kext", "photoslibrary", "photolibrary", "musiclibrary", "tvlibrary", "lrlibrary",
    "lrdata", "fcpbundle", "imovielibrary", "xcodeproj", "xcworkspace",
];

/// Hidden in listings unless hidden files are shown: dot files, system files, and on
/// Windows everything marked hidden or system.
pub fn is_system(name: &str, md: Option<&fs::Metadata>) -> bool {
    if is_hidden(name) || SYSTEM_NAMES.iter().any(|n| n.eq_ignore_ascii_case(name)) || name.to_ascii_lowercase().starts_with("ntuser.") {
        return true;
    }
    #[cfg(windows)]
    if let Some(md) = md {
        use std::os::windows::fs::MetadataExt;
        // FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_SYSTEM
        if md.file_attributes() & 0x6 != 0 {
            return true;
        }
    }
    #[cfg(not(windows))]
    let _ = md;
    false
}

/// A folder Stream and the watcher leave alone (program files, packages).
pub fn is_program_dir(name: &str) -> bool {
    PROGRAM_DIRS.iter().any(|n| n.eq_ignore_ascii_case(name))
        || Path::new(name).extension().is_some_and(|e| PACKAGE_EXTS.iter().any(|x| e.eq_ignore_ascii_case(x)))
}

/// Whether anything below `root` on the way to `path` is skipped (for watcher events).
pub fn in_skipped(root: &Path, path: &Path) -> bool {
    let rel = path.strip_prefix(root).unwrap_or(path);
    rel.components().any(|c| {
        let n = c.as_os_str().to_string_lossy();
        is_system(&n, None) || is_program_dir(&n)
    })
}

/// Folders below `root` that Stream would read, at most `limit` (for watchers without native recursion).
pub fn walk_dirs(root: &Path, max_depth: usize, limit: usize) -> Vec<PathBuf> {
    WalkDir::new(root)
        .max_depth(max_depth)
        .into_iter()
        .filter_entry(|e| e.depth() == 0 || !skip_walk(e))
        .flatten()
        .filter(|e| e.file_type().is_dir())
        .take(limit)
        .map(|e| e.into_path())
        .collect()
}

/// System files and program folders: Stream, the index and the watcher leave them out.
pub fn skip_walk(e: &walkdir::DirEntry) -> bool {
    let n = e.file_name().to_string_lossy();
    is_system(&n, e.metadata().ok().as_ref()) || (e.file_type().is_dir() && is_program_dir(&n))
}

/// Plain file-system view of a path; index metadata is added by `decorate`.
pub fn make_entry(path: &Path) -> io::Result<Entry> {
    let md = fs::metadata(path)?;
    let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| path.to_string_lossy().to_string());
    let is_dir = md.is_dir();
    let ext = if is_dir {
        String::new()
    } else {
        Path::new(&name).extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default()
    };
    let tags = meta::filename_tags(&name);
    Ok(Entry {
        path: path.to_string_lossy().to_string(),
        name,
        ext,
        kind: if is_dir { "dir" } else { "file" },
        size: if is_dir { 0 } else { md.len() },
        mtime: ms(md.modified()),
        ctime: ms(md.created().or_else(|_| md.modified())),
        tags,
        color: None,
        geo: None,
        rel_dir: None,
    })
}

/// Merge index metadata (tags, color, geo) into an entry; filename tags stay.
pub fn decorate(e: &mut Entry, r: Option<&Record>) {
    if let Some(r) = r {
        e.tags = meta::unique_tags(r.tags.iter().cloned().chain(e.tags.drain(..)));
        e.color = r.color.clone();
        e.geo = r.geo.clone();
    }
}

pub fn list_dir(dir: &Path, include_hidden: bool) -> io::Result<Vec<Entry>> {
    let mut out = Vec::new();
    for e in fs::read_dir(dir)?.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        if name == SIDECAR_DIR || (!include_hidden && is_system(&name, e.metadata().ok().as_ref())) {
            continue;
        }
        // Unreadable entries (broken symlinks, permissions) are skipped, not fatal.
        if let Ok(entry) = make_entry(&e.path()) {
            out.push(entry);
        }
    }
    Ok(out)
}

/// Recursive flat listing of files below `root`, with `rel_dir` set.
pub fn walk(root: &Path, max_depth: usize, include_hidden: bool, limit: usize, exts: Option<&[String]>) -> Vec<Entry> {
    let mut out = Vec::new();
    let it = WalkDir::new(root).min_depth(1).max_depth(max_depth).into_iter().filter_entry(|e| {
        let n = e.file_name().to_string_lossy();
        n != SIDECAR_DIR && (include_hidden || !skip_walk(e))
    });
    for e in it.flatten() {
        if !e.file_type().is_file() {
            continue;
        }
        if let Some(exts) = exts {
            let ext = e.path().extension().map(|x| x.to_string_lossy().to_lowercase()).unwrap_or_default();
            if !exts.iter().any(|x| *x == ext) {
                continue;
            }
        }
        let parent = e.path().parent().unwrap_or(root).to_path_buf();
        if let Ok(mut entry) = make_entry(e.path()) {
            let rel = parent.strip_prefix(root).unwrap_or(Path::new(""));
            entry.rel_dir = Some(rel.to_string_lossy().replace('\\', "/"));
            out.push(entry);
            if out.len() >= limit {
                break;
            }
        }
    }
    out
}

/// Files and folders below each root whose name contains `needle` (case-insensitive), at
/// most `limit` and for at most `budget`; `rel_dir` is relative to the root they were found in.
pub fn find(roots: &[PathBuf], needle: &str, include_hidden: bool, limit: usize, budget: std::time::Duration) -> (Vec<Entry>, bool) {
    let needle = needle.to_lowercase();
    let start = std::time::Instant::now();
    let mut out = Vec::new();
    for root in roots {
        let it = WalkDir::new(root).min_depth(1).max_depth(32).into_iter().filter_entry(|e| {
            let n = e.file_name().to_string_lossy();
            n != SIDECAR_DIR && (include_hidden || !skip_walk(e))
        });
        for (i, e) in it.flatten().enumerate() {
            if i % 256 == 0 && start.elapsed() > budget {
                return (out, true);
            }
            if !e.file_name().to_string_lossy().to_lowercase().contains(&needle) {
                continue;
            }
            let parent = e.path().parent().unwrap_or(root).to_path_buf();
            if let Ok(mut entry) = make_entry(e.path()) {
                entry.rel_dir = Some(parent.strip_prefix(root).unwrap_or(Path::new("")).to_string_lossy().replace('\\', "/"));
                out.push(entry);
                if out.len() >= limit {
                    return (out, true);
                }
            }
        }
    }
    (out, false)
}

/// Mounted drives other than the system disk: USB sticks, memory cards, network shares.
pub fn volumes() -> Vec<(String, PathBuf)> {
    let mut v: Vec<(String, PathBuf)> = Vec::new();
    let mut add_children = |dir: &Path| {
        if let Ok(rd) = fs::read_dir(dir) {
            for e in rd.flatten() {
                let p = e.path();
                let name = e.file_name().to_string_lossy().to_string();
                // macOS lists the system disk in /Volumes as a link to `/`.
                if name.starts_with('.') || fs::canonicalize(&p).map(|c| c == Path::new("/")).unwrap_or(false) {
                    continue;
                }
                if p.is_dir() && !v.iter().any(|(_, q)| *q == p) {
                    v.push((name, p));
                }
            }
        }
    };
    if cfg!(target_os = "macos") {
        add_children(Path::new("/Volumes"));
    } else if cfg!(windows) {
        let system = std::env::var("SystemDrive").unwrap_or_else(|_| "C:".into()).to_uppercase();
        for c in b'A'..=b'Z' {
            let d = format!("{}:", c as char);
            let root = PathBuf::from(format!("{d}\\"));
            if d != system && root.is_dir() {
                v.push((d, root));
            }
        }
    } else {
        // Only real mounts below the usual places, not every folder in /mnt.
        let mounts = fs::read_to_string("/proc/mounts").unwrap_or_default();
        for line in mounts.lines() {
            let Some(target) = line.split_whitespace().nth(1) else { continue };
            // Spaces in mount points are written as \040.
            let target = target.replace("\\040", " ");
            let p = PathBuf::from(&target);
            let under = ["/media/", "/run/media/", "/mnt/"].iter().any(|r| target.starts_with(r));
            if under && p.is_dir() && !v.iter().any(|(_, q)| *q == p) {
                let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or(target.clone());
                v.push((name, p));
            }
        }
    }
    v.sort_by(|a, b| a.0.to_lowercase().cmp(&b.0.to_lowercase()));
    v
}

/// `name.ext` → `name 2.ext`, `name 3.ext`, … until free.
pub fn unique_dest(dir: &Path, name: &str) -> PathBuf {
    let first = dir.join(name);
    if !first.exists() {
        return first;
    }
    let p = Path::new(name);
    let stem = p.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| name.to_string());
    let ext = p.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
    (2..)
        .map(|i| dir.join(format!("{stem} {i}{ext}")))
        .find(|c| !c.exists())
        .unwrap()
}

fn copy_recursive(from: &Path, to: &Path) -> io::Result<()> {
    if fs::symlink_metadata(from)?.is_dir() {
        fs::create_dir_all(to)?;
        for e in fs::read_dir(from)?.flatten() {
            copy_recursive(&e.path(), &to.join(e.file_name()))?;
        }
        Ok(())
    } else {
        fs::copy(from, to).map(|_| ())
    }
}

fn transfer_one(src: &Path, target_dir: &Path, mode: Mode) -> Result<PathBuf, String> {
    let name = src.file_name().ok_or_else(|| crate::tr!("Ungültiger Pfad", "Invalid path"))?.to_string_lossy().to_string();
    if !target_dir.is_dir() {
        return Err(format!("Ziel ist kein Ordner: {}", target_dir.display()));
    }
    if src.is_dir() && target_dir.starts_with(src) {
        return Err(crate::tr!(format!("„{name}“ kann nicht in sich selbst verschoben werden"), format!("“{name}” cannot be moved into itself")));
    }
    if mode == Mode::Move && src.parent() == Some(target_dir) {
        return Ok(src.to_path_buf());
    }
    let dest = unique_dest(target_dir, &name);
    match mode {
        Mode::Move => {
            if fs::rename(src, &dest).is_err() {
                // Different volume: copy then delete.
                copy_recursive(src, &dest).map_err(|e| e.to_string())?;
                let rm = if src.is_dir() { fs::remove_dir_all(src) } else { fs::remove_file(src) };
                rm.map_err(|e| e.to_string())?;
            }
        }
        Mode::Copy => copy_recursive(src, &dest).map_err(|e| e.to_string())?,
    }
    Ok(dest)
}

pub fn transfer(paths: &[String], target_dir: &Path, mode: Mode) -> TransferResult {
    let mut res = TransferResult::default();
    for p in paths {
        match transfer_one(Path::new(p), target_dir, mode) {
            Ok(dest) => {
                res.moved.insert(p.clone(), dest.to_string_lossy().to_string());
            }
            Err(message) => res.errors.push(TransferError { path: p.clone(), message }),
        }
    }
    res
}

/// Rename within the same folder. Fails instead of overwriting.
pub fn rename(path: &Path, new_name: &str) -> Result<PathBuf, String> {
    let name = new_name.trim();
    if name.is_empty() || name == "." || name == ".." || name.contains(['/', '\\']) {
        return Err(crate::tr!("Ungültiger Name", "Invalid name").into());
    }
    let dir = path.parent().ok_or_else(|| crate::tr!("Kein Elternordner", "No parent folder"))?;
    let dest = dir.join(name);
    if dest == path {
        return Ok(dest);
    }
    // Case-only renames ("a.jpg" → "A.jpg") are fine on case-insensitive file systems.
    let same_file = dest.exists()
        && fs::canonicalize(&dest).ok() == fs::canonicalize(path).ok();
    if dest.exists() && !same_file {
        return Err(crate::tr!(format!("„{name}“ existiert bereits"), format!("“{name}” already exists")));
    }
    fs::rename(path, &dest).map_err(|e| e.to_string())?;
    Ok(dest)
}

/// Move files to the system trash. The index keeps their metadata as orphans for a while.
pub fn trash(paths: &[String]) -> TransferResult {
    let mut res = TransferResult::default();
    for p in paths {
        let path = Path::new(p);
        match ::trash::delete(path) {
            Ok(()) => {
                res.moved.insert(p.clone(), String::new());
            }
            Err(e) => res.errors.push(TransferError { path: p.clone(), message: e.to_string() }),
        }
    }
    res
}

pub fn places() -> Vec<(String, PathBuf)> {
    let mut v = Vec::new();
    if let Some(h) = dirs::home_dir() {
        v.push(("Home".to_string(), h));
    }
    let candidates = [
        ("Schreibtisch", dirs::desktop_dir()),
        ("Dokumente", dirs::document_dir()),
        ("Bilder", dirs::picture_dir()),
        ("Downloads", dirs::download_dir()),
        ("Videos", dirs::video_dir()),
        ("Musik", dirs::audio_dir()),
    ];
    for (n, p) in candidates {
        if let Some(p) = p.filter(|p| p.is_dir()) {
            v.push((n.to_string(), p));
        }
    }
    v
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn skips_system_and_program_folders() {
        let t = tempfile::tempdir().unwrap();
        let root = t.path();
        for d in ["Fotos", "AppData/Local/cache", "proj/node_modules/x", "Bilder.photoslibrary/originals", ".cache/y"] {
            fs::create_dir_all(root.join(d)).unwrap();
        }
        for f in ["Fotos/a.jpg", "AppData/Local/cache/b.bin", "proj/node_modules/x/c.js", "proj/d.txt", "Bilder.photoslibrary/originals/e.jpg", ".cache/y/f", "Thumbs.db"] {
            fs::write(root.join(f), b"1").unwrap();
        }
        let mut names: Vec<String> = walk(root, 10, false, 100, None).into_iter().map(|e| e.name).collect();
        names.sort();
        assert_eq!(names, ["a.jpg", "d.txt"]);
        // Searching finds folders too, and skips the same places.
        let (found, more) = find(&[root.to_path_buf()], "FOT", false, 100, std::time::Duration::from_secs(5));
        assert!(!more);
        assert_eq!(found.iter().map(|e| (e.name.as_str(), e.kind)).collect::<Vec<_>>(), [("Fotos", "dir")]);
        let (found, _) = find(&[root.to_path_buf()], "c.js", false, 100, std::time::Duration::from_secs(5));
        assert!(found.is_empty(), "program folders are not searched");
        // Listings hide system files but show program folders (they just are not walked into).
        let top: Vec<String> = list_dir(root, false).unwrap().into_iter().map(|e| e.name).collect();
        assert!(!top.iter().any(|n| n == "AppData" || n == "Thumbs.db" || n == ".cache"));
        assert!(top.iter().any(|n| n == "Bilder.photoslibrary"));
        assert!(in_skipped(root, &root.join("proj/node_modules/x/c.js")));
        assert!(in_skipped(root, &root.join(".cache/y/f")));
        assert!(!in_skipped(root, &root.join("Fotos/a.jpg")));
        let dirs = walk_dirs(root, 10, 100);
        assert!(dirs.iter().all(|d| !d.to_string_lossy().contains("node_modules") && !d.to_string_lossy().contains("AppData")));
        assert!(dirs.contains(&root.join("Fotos")));
    }

    #[test]
    fn lists_walks_moves_and_renames() {
        let t = tempfile::tempdir().unwrap();
        let root = t.path();
        fs::create_dir_all(root.join("a/b")).unwrap();
        fs::create_dir_all(root.join("dest")).unwrap();
        fs::write(root.join("a/b/x[foo].jpg"), b"123").unwrap();
        fs::write(root.join(".hidden"), b"").unwrap();

        let top = list_dir(root, false).unwrap();
        assert_eq!(top.iter().filter(|e| e.name.starts_with('.')).count(), 0);

        let all = walk(root, 10, false, 100, None);
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].rel_dir.as_deref(), Some("a/b"));
        assert_eq!(all[0].tags, vec!["foo"], "filename tags are read");

        let res = transfer(&[all[0].path.clone()], &root.join("dest"), Mode::Move);
        assert!(res.errors.is_empty());
        let moved = list_dir(&root.join("dest"), false).unwrap();
        assert_eq!(moved[0].name, "x[foo].jpg");

        // Name collision → "x[foo] 2.jpg"
        fs::write(root.join("a/x[foo].jpg"), b"1").unwrap();
        let res = transfer(&[root.join("a/x[foo].jpg").to_string_lossy().to_string()], &root.join("dest"), Mode::Copy);
        assert!(res.moved.values().next().unwrap().ends_with("x[foo] 2.jpg"));

        // Rename refuses to overwrite and to leave the folder.
        let renamed = rename(Path::new(res.moved.values().next().unwrap()), "y.jpg").unwrap();
        assert!(renamed.ends_with("y.jpg"));
        assert!(rename(&renamed, "x[foo].jpg").is_err(), "must not overwrite");
        assert!(rename(&renamed, "../evil.jpg").is_err());

        // A folder can't go into itself.
        let res = transfer(&[root.join("a").to_string_lossy().to_string()], &root.join("a/b"), Mode::Move);
        assert_eq!(res.errors.len(), 1);
    }
}
