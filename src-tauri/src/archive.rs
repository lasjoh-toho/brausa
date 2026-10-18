//! Archives as read-only folders: `/a/b.zip!/docs/x.pdf` names a file inside
//! `b.zip`. Listing reads the archive's directory; single files are unpacked
//! on demand into a cache (thumbnails, preview, open) or into a folder (drag out).
//! ZIP, tar, tar.gz/tgz.

use crate::fsops::Entry;
use std::{
    collections::hash_map::DefaultHasher,
    collections::BTreeMap,
    fs,
    hash::{Hash, Hasher},
    io::{self, Read},
    path::{Component, Path, PathBuf},
    time::UNIX_EPOCH,
};

pub const SEP: &str = "!/";

#[derive(Clone, Copy, PartialEq, Debug)]
enum Kind {
    Zip,
    Tar,
    TarGz,
}

fn kind(p: &Path) -> Option<Kind> {
    let n = p.file_name()?.to_string_lossy().to_lowercase();
    if n.ends_with(".zip") {
        Some(Kind::Zip)
    } else if n.ends_with(".tar.gz") || n.ends_with(".tgz") {
        Some(Kind::TarGz)
    } else if n.ends_with(".tar") {
        Some(Kind::Tar)
    } else {
        None
    }
}

/// `/a/b.zip!/x/y` → (`/a/b.zip`, `x/y`); `/a/b.zip!` → (`/a/b.zip`, ``). None for normal paths.
pub fn split(p: &str) -> Option<(PathBuf, String)> {
    // Windows paths may carry `\` after the `!` too (the UI joins with the platform separator).
    let (archive, inner) = match p.find(SEP).or_else(|| p.find("!\\")) {
        Some(i) => (&p[..i], &p[i + 2..]),
        None => (p.strip_suffix('!')?, ""),
    };
    let archive = PathBuf::from(archive);
    kind(&archive)?;
    Some((archive, inner.replace('\\', "/").trim_matches('/').to_string()))
}

pub fn join(archive: &Path, inner: &str) -> String {
    format!("{}{SEP}{}", archive.to_string_lossy(), inner)
}

/// A path inside an archive that cannot escape it (no `..`, no root).
fn clean(name: &str) -> Option<String> {
    let p = Path::new(name);
    if p.components().any(|c| !matches!(c, Component::Normal(_) | Component::CurDir)) {
        return None;
    }
    let s = name.replace('\\', "/");
    let s = s.trim_matches('/');
    (!s.is_empty()).then(|| s.to_string())
}

struct Item {
    name: String,
    dir: bool,
    size: u64,
}

fn items(archive: &Path) -> io::Result<Vec<Item>> {
    let k = kind(archive).ok_or_else(|| io::Error::other("Kein Archiv"))?;
    let f = fs::File::open(archive)?;
    let mut out = vec![];
    match k {
        Kind::Zip => {
            let mut z = zip::ZipArchive::new(f).map_err(io::Error::other)?;
            for i in 0..z.len() {
                let e = z.by_index(i).map_err(io::Error::other)?;
                if let Some(name) = e.enclosed_name().and_then(|n| clean(&n.to_string_lossy())) {
                    out.push(Item { name, dir: e.is_dir(), size: e.size() });
                }
            }
        }
        Kind::Tar | Kind::TarGz => {
            let r: Box<dyn Read> = if k == Kind::TarGz { Box::new(flate2::read::GzDecoder::new(f)) } else { Box::new(f) };
            let mut t = tar::Archive::new(r);
            for e in t.entries()? {
                let e = e?;
                let Ok(path) = e.path() else { continue };
                if let Some(name) = clean(&path.to_string_lossy()) {
                    let dir = e.header().entry_type().is_dir();
                    if dir || e.header().entry_type().is_file() {
                        out.push(Item { name, dir, size: e.header().size().unwrap_or(0) });
                    }
                }
            }
        }
    }
    Ok(out)
}

fn entry(archive: &Path, name: &str, dir: bool, size: u64, mtime: f64) -> Entry {
    let base = name.rsplit('/').next().unwrap_or(name).to_string();
    let ext = if dir { String::new() } else { Path::new(&base).extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default() };
    Entry {
        path: join(archive, name),
        name: base.clone(),
        ext,
        kind: if dir { "dir" } else { "file" },
        size: if dir { 0 } else { size },
        mtime,
        ctime: mtime,
        tags: crate::meta::filename_tags(&base),
        color: None,
        geo: None,
        rel_dir: None,
    }
}

fn mtime_ms(p: &Path) -> f64 {
    fs::metadata(p).and_then(|m| m.modified()).ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis() as f64).unwrap_or(0.0)
}

/// The direct children of `dir` inside the archive (folders that only exist implicitly included).
pub fn list(archive: &Path, dir: &str) -> io::Result<Vec<Entry>> {
    let t = mtime_ms(archive);
    let prefix = if dir.is_empty() { String::new() } else { format!("{dir}/") };
    let mut children: BTreeMap<String, (bool, u64)> = BTreeMap::new();
    for it in items(archive)? {
        let Some(rest) = it.name.strip_prefix(&prefix) else { continue };
        match rest.split_once('/') {
            Some((first, _)) => {
                children.insert(first.to_string(), (true, 0));
            }
            None if !rest.is_empty() => {
                children.entry(rest.to_string()).or_insert((it.dir, it.size));
            }
            None => {}
        }
    }
    Ok(children.into_iter().map(|(n, (d, s))| entry(archive, &format!("{prefix}{n}"), d, s, t)).collect())
}

/// All files below `dir` inside the archive, with `rel_dir` set (for Stream).
pub fn walk(archive: &Path, dir: &str, limit: usize) -> io::Result<Vec<Entry>> {
    let t = mtime_ms(archive);
    let prefix = if dir.is_empty() { String::new() } else { format!("{dir}/") };
    Ok(items(archive)?
        .into_iter()
        .filter(|it| !it.dir && it.name.starts_with(&prefix))
        .take(limit)
        .map(|it| {
            let mut e = entry(archive, &it.name, false, it.size, t);
            let rel = it.name[prefix.len()..].rsplit_once('/').map(|(d, _)| d.to_string()).unwrap_or_default();
            e.rel_dir = Some(rel);
            e
        })
        .collect())
}

/// Unpacks `inner` (a file, or a folder with everything in it) to `dest`.
fn extract(archive: &Path, inner: &str, dest: &Path) -> io::Result<usize> {
    let k = kind(archive).ok_or_else(|| io::Error::other("Kein Archiv"))?;
    let prefix = format!("{inner}/");
    let target = |name: &str| -> Option<PathBuf> {
        if name == inner {
            Some(dest.to_path_buf())
        } else {
            name.strip_prefix(&prefix).map(|rest| dest.join(rest))
        }
    };
    let mut n = 0;
    let f = fs::File::open(archive)?;
    match k {
        Kind::Zip => {
            let mut z = zip::ZipArchive::new(f).map_err(io::Error::other)?;
            for i in 0..z.len() {
                let mut e = z.by_index(i).map_err(io::Error::other)?;
                let Some(name) = e.enclosed_name().and_then(|n| clean(&n.to_string_lossy())) else { continue };
                let Some(out) = target(&name) else { continue };
                if e.is_dir() {
                    fs::create_dir_all(&out)?;
                } else {
                    fs::create_dir_all(out.parent().unwrap_or(dest))?;
                    io::copy(&mut e, &mut fs::File::create(&out)?)?;
                    n += 1;
                }
            }
        }
        Kind::Tar | Kind::TarGz => {
            let r: Box<dyn Read> = if k == Kind::TarGz { Box::new(flate2::read::GzDecoder::new(f)) } else { Box::new(f) };
            let mut t = tar::Archive::new(r);
            for e in t.entries()? {
                let mut e = e?;
                let Some(name) = e.path().ok().and_then(|p| clean(&p.to_string_lossy())) else { continue };
                let Some(out) = target(&name) else { continue };
                if e.header().entry_type().is_dir() {
                    fs::create_dir_all(&out)?;
                } else if e.header().entry_type().is_file() {
                    fs::create_dir_all(out.parent().unwrap_or(dest))?;
                    io::copy(&mut e, &mut fs::File::create(&out)?)?;
                    n += 1;
                }
            }
        }
    }
    if n == 0 && !dest.exists() {
        return Err(io::Error::new(io::ErrorKind::NotFound, format!("„{inner}“ ist nicht im Archiv")));
    }
    Ok(n)
}

/// A file inside an archive as a real file in `cache` (unpacked once per archive version).
pub fn materialize(virtual_path: &str, cache: &Path) -> io::Result<PathBuf> {
    let (archive, inner) = split(virtual_path).ok_or_else(|| io::Error::other("Kein Pfad in einem Archiv"))?;
    let mut h = DefaultHasher::new();
    (&archive, mtime_ms(&archive) as u64).hash(&mut h);
    let out = cache.join(format!("{:016x}", h.finish())).join(&inner);
    if !out.exists() {
        extract(&archive, &inner, &out)?;
    }
    Ok(out)
}

/// Unpacks a file or folder from an archive into `dir` (next free name); returns where it went.
pub fn extract_to(virtual_path: &str, dir: &Path) -> io::Result<PathBuf> {
    let (archive, inner) = split(virtual_path).ok_or_else(|| io::Error::other("Kein Pfad in einem Archiv"))?;
    let name = inner.rsplit('/').next().filter(|n| !n.is_empty()).map(String::from).unwrap_or_else(|| {
        archive.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "Archiv".into())
    });
    let dest = crate::fsops::unique_dest(dir, &name);
    extract(&archive, &inner, &dest)?;
    Ok(dest)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn sample(dir: &Path) -> PathBuf {
        let p = dir.join("Fotos.zip");
        let mut z = zip::ZipWriter::new(fs::File::create(&p).unwrap());
        let o = zip::write::SimpleFileOptions::default();
        z.start_file("readme.txt", o).unwrap();
        z.write_all(b"hallo").unwrap();
        z.start_file("2026/urlaub/strand.jpg", o).unwrap();
        z.write_all(b"jpg").unwrap();
        z.start_file("2026/notiz.md", o).unwrap();
        z.write_all(b"# Notiz").unwrap();
        z.start_file("../boese.txt", o).unwrap();
        z.write_all(b"x").unwrap();
        z.finish().unwrap();
        p
    }

    #[test]
    fn archives_are_read_only_folders() {
        let t = tempfile::tempdir().unwrap();
        let zip = sample(t.path());
        assert_eq!(split(&format!("{}!", zip.display())), Some((zip.clone(), String::new())));
        assert_eq!(split(&format!("{}!/2026/notiz.md", zip.display())), Some((zip.clone(), "2026/notiz.md".into())));
        assert_eq!(split("/a/b.txt!/x"), None);

        let top: Vec<_> = list(&zip, "").unwrap().into_iter().map(|e| (e.name, e.kind)).collect();
        assert_eq!(top, vec![("2026".into(), "dir"), ("readme.txt".into(), "file")], "no entry escapes the archive");
        let sub: Vec<_> = list(&zip, "2026").unwrap().into_iter().map(|e| e.name).collect();
        assert_eq!(sub, vec!["notiz.md", "urlaub"]);
        let all = walk(&zip, "", 100).unwrap();
        assert_eq!(all.len(), 3);
        assert!(all.iter().any(|e| e.rel_dir.as_deref() == Some("2026/urlaub")));

        let cache = t.path().join("cache");
        let f = materialize(&join(&zip, "2026/notiz.md"), &cache).unwrap();
        assert_eq!(fs::read_to_string(f).unwrap(), "# Notiz");

        let out = t.path().join("out");
        fs::create_dir_all(&out).unwrap();
        let d = extract_to(&join(&zip, "2026"), &out).unwrap();
        assert_eq!(fs::read(d.join("urlaub/strand.jpg")).unwrap(), b"jpg");
        assert!(!t.path().join("boese.txt").exists());
    }

    #[test]
    fn tar_gz_works_too() {
        let t = tempfile::tempdir().unwrap();
        let p = t.path().join("a.tar.gz");
        let gz = flate2::write::GzEncoder::new(fs::File::create(&p).unwrap(), flate2::Compression::fast());
        let mut b = tar::Builder::new(gz);
        let data = b"inhalt";
        let mut h = tar::Header::new_gnu();
        h.set_size(data.len() as u64);
        h.set_mode(0o644);
        h.set_cksum();
        b.append_data(&mut h, "docs/x.txt", &data[..]).unwrap();
        b.into_inner().unwrap().finish().unwrap();
        assert_eq!(list(&p, "").unwrap()[0].name, "docs");
        let f = materialize(&join(&p, "docs/x.txt"), &t.path().join("c")).unwrap();
        assert_eq!(fs::read(f).unwrap(), b"inhalt");
    }
}
