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
    let k = kind(archive).ok_or_else(|| io::Error::other(crate::tr!("Kein Archiv", "Not an archive")))?;
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
    let k = kind(archive).ok_or_else(|| io::Error::other(crate::tr!("Kein Archiv", "Not an archive")))?;
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
        return Err(io::Error::new(io::ErrorKind::NotFound, crate::tr!(format!("„{inner}“ ist nicht im Archiv"), format!("“{inner}” is not in the archive"))));
    }
    Ok(n)
}

/// A file inside an archive as a real file in `cache` (unpacked once per archive version).
pub fn materialize(virtual_path: &str, cache: &Path) -> io::Result<PathBuf> {
    let (archive, inner) = split(virtual_path).ok_or_else(|| io::Error::other(crate::tr!("Kein Pfad in einem Archiv", "Not a path inside an archive")))?;
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
    let (archive, inner) = split(virtual_path).ok_or_else(|| io::Error::other(crate::tr!("Kein Pfad in einem Archiv", "Not a path inside an archive")))?;
    let name = inner.rsplit('/').next().filter(|n| !n.is_empty()).map(String::from).unwrap_or_else(|| {
        archive.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "Archiv".into())
    });
    let dest = crate::fsops::unique_dest(dir, &name);
    extract(&archive, &inner, &dest)?;
    Ok(dest)
}

// ── Writing ────────────────────────────────────────────────────────────────
// An archive is never changed in place: brausa writes a new one next to it,
// hands the old version to `retire` (the app puts a copy into the trash) and
// then copies the new content over the original, so the file keeps its identity.

fn zip_options(md: &fs::Metadata) -> zip::write::SimpleFileOptions {
    use chrono::{Datelike, Timelike};
    let mut o = zip::write::SimpleFileOptions::default().large_file(md.len() >= u32::MAX as u64);
    if let Ok(t) = md.modified() {
        let t: chrono::DateTime<chrono::Local> = t.into();
        if let Ok(d) = zip::DateTime::from_date_and_time(t.year() as u16, t.month() as u8, t.day() as u8, t.hour() as u8, t.minute() as u8, t.second() as u8) {
            o = o.last_modified_time(d);
        }
    }
    o
}

/// Adds a real file or folder (with everything in it) as `name`. Symlinked folders are skipped.
fn zip_add(z: &mut zip::ZipWriter<fs::File>, name: &str, real: &Path) -> io::Result<()> {
    let link = fs::symlink_metadata(real)?;
    let md = fs::metadata(real)?;
    if md.is_dir() {
        if link.file_type().is_symlink() {
            return Ok(());
        }
        z.add_directory(format!("{name}/"), zip_options(&md)).map_err(io::Error::other)?;
        for e in fs::read_dir(real)?.flatten() {
            zip_add(z, &format!("{name}/{}", e.file_name().to_string_lossy()), &e.path())?;
        }
    } else {
        z.start_file(name, zip_options(&md)).map_err(io::Error::other)?;
        io::copy(&mut fs::File::open(real)?, z)?;
    }
    Ok(())
}

fn tar_add<W: io::Write>(b: &mut tar::Builder<W>, name: &str, real: &Path) -> io::Result<()> {
    if fs::metadata(real)?.is_dir() {
        b.append_dir_all(name, real)
    } else {
        b.append_path_with_name(real, name)
    }
}

/// Copies the entries `keep` accepts from the old tar into `b`.
fn tar_copy<W: io::Write>(b: &mut tar::Builder<W>, old: &Path, k: Kind, keep: &dyn Fn(&str) -> bool) -> io::Result<()> {
    let f = fs::File::open(old)?;
    let r: Box<dyn Read> = if k == Kind::TarGz { Box::new(flate2::read::GzDecoder::new(f)) } else { Box::new(f) };
    let mut t = tar::Archive::new(r);
    for e in t.entries()? {
        let e = e?;
        let Some(name) = e.path().ok().and_then(|p| clean(&p.to_string_lossy())) else { continue };
        let ty = e.header().entry_type();
        if keep(&name) && (ty.is_dir() || ty.is_file()) {
            let mut h = e.header().clone();
            b.append_data(&mut h, &name, e)?;
        }
    }
    Ok(())
}

/// Writes `out` as an archive of the kind its name says: the entries of `old`
/// that `keep` accepts, then `add` (name inside the archive → real file or folder).
fn write(out: &Path, old: Option<&Path>, keep: &dyn Fn(&str) -> bool, add: &[(String, PathBuf)]) -> io::Result<()> {
    let k = kind(out).ok_or_else(|| io::Error::other(crate::tr!("Kein Archiv", "Not an archive")))?;
    let f = fs::File::create(out)?;
    match k {
        Kind::Zip => {
            let mut z = zip::ZipWriter::new(f);
            if let Some(old) = old {
                let mut src = zip::ZipArchive::new(fs::File::open(old)?).map_err(io::Error::other)?;
                for i in 0..src.len() {
                    let e = src.by_index_raw(i).map_err(io::Error::other)?;
                    if e.enclosed_name().and_then(|n| clean(&n.to_string_lossy())).is_some_and(|n| keep(&n)) {
                        z.raw_copy_file(e).map_err(io::Error::other)?;
                    }
                }
            }
            for (name, real) in add {
                zip_add(&mut z, name, real)?;
            }
            z.finish().map_err(io::Error::other)?;
        }
        Kind::Tar => {
            let mut b = tar::Builder::new(f);
            b.follow_symlinks(false);
            if let Some(old) = old {
                tar_copy(&mut b, old, k, keep)?;
            }
            for (name, real) in add {
                tar_add(&mut b, name, real)?;
            }
            b.into_inner()?;
        }
        Kind::TarGz => {
            let mut b = tar::Builder::new(flate2::write::GzEncoder::new(f, flate2::Compression::default()));
            b.follow_symlinks(false);
            if let Some(old) = old {
                tar_copy(&mut b, old, k, keep)?;
            }
            for (name, real) in add {
                tar_add(&mut b, name, real)?;
            }
            b.into_inner()?.finish()?;
        }
    }
    Ok(())
}

/// `inner` itself or anything below it.
fn covers(inner: &str, name: &str) -> bool {
    name == inner || name.strip_prefix(inner).is_some_and(|r| r.starts_with('/'))
}

fn rewrite(archive: &Path, keep: &dyn Fn(&str) -> bool, add: &[(String, PathBuf)], retire: &dyn Fn(&Path) -> io::Result<()>) -> io::Result<()> {
    let name = archive.file_name().ok_or_else(|| io::Error::other(crate::tr!("Kein Archiv", "Not an archive")))?.to_string_lossy().to_string();
    // Same folder and same extension, so the kind is right and the copy stays on one volume.
    let tmp = archive.with_file_name(format!(".brausa-neu-{name}"));
    let res = write(&tmp, Some(archive), keep, add).and_then(|_| retire(archive)).and_then(|_| fs::copy(&tmp, archive).map(|_| ()));
    let _ = fs::remove_file(&tmp);
    res
}

/// Removes files or folders (with everything in them) from an archive. `inners` are paths inside it.
pub fn remove(archive: &Path, inners: &[String], retire: &dyn Fn(&Path) -> io::Result<()>) -> io::Result<()> {
    let found = items(archive)?.iter().any(|it| inners.iter().any(|i| covers(i, &it.name)));
    if !found {
        return Err(io::Error::new(io::ErrorKind::NotFound, crate::tr!("Nicht im Archiv", "Not in the archive")));
    }
    rewrite(archive, &|n| !inners.iter().any(|i| covers(i, n)), &[], retire)
}

/// Copies real files or folders into folder `dir` of an archive; entries with the same
/// name are replaced. Returns their new paths.
pub fn add(archive: &Path, dir: &str, sources: &[PathBuf], retire: &dyn Fn(&Path) -> io::Result<()>) -> io::Result<Vec<String>> {
    let mut add = vec![];
    for s in sources {
        let n = s.file_name().ok_or_else(|| io::Error::other(crate::tr!("Ungültiger Pfad", "Invalid path")))?.to_string_lossy().to_string();
        if s == archive {
            return Err(io::Error::other(crate::tr!(format!("„{n}“ kann nicht in sich selbst gepackt werden"), format!("“{n}” cannot be packed into itself"))));
        }
        add.push((if dir.is_empty() { n } else { format!("{dir}/{n}") }, s.clone()));
    }
    rewrite(archive, &|n| !add.iter().any(|(a, _)| covers(a, n)), &add, retire)?;
    Ok(add.into_iter().map(|(n, _)| join(archive, &n)).collect())
}

/// Names in folder `dir` of an archive that `names` would replace.
pub fn conflicts(archive: &Path, dir: &str, names: &[String]) -> io::Result<Vec<String>> {
    Ok(list(archive, dir)?.into_iter().map(|e| e.name).filter(|n| names.contains(n)).collect())
}

/// Packs files and folders into a new ZIP in `dir`, named after the single item or „Archiv.zip“.
pub fn compress(sources: &[PathBuf], dir: &Path) -> io::Result<PathBuf> {
    let name = match sources {
        [one] => format!("{}.zip", one.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| crate::tr!("Archiv", "Archive").into())),
        _ => crate::tr!("Archiv.zip", "Archive.zip").into(),
    };
    let dest = crate::fsops::unique_dest(dir, &name);
    let add: Vec<_> = sources.iter().map(|s| (s.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(), s.clone())).collect();
    if let Err(e) = write(&dest, None, &|_| false, &add) {
        let _ = fs::remove_file(&dest);
        return Err(e);
    }
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

    fn names(a: &Path) -> Vec<String> {
        let mut v: Vec<_> = walk(a, "", 100).unwrap().into_iter().map(|e| split(&e.path).unwrap().1).collect();
        v.sort();
        v
    }

    #[test]
    fn archives_can_be_changed() {
        let t = tempfile::tempdir().unwrap();
        let zip = sample(t.path());
        let retired = std::cell::RefCell::new(vec![]);
        let retire = |p: &Path| {
            retired.borrow_mut().push(fs::read(p)?);
            Ok(())
        };

        remove(&zip, &["2026/urlaub".into()], &retire).unwrap();
        assert_eq!(names(&zip), vec!["2026/notiz.md", "readme.txt"]);
        assert_eq!(retired.borrow().len(), 1, "the old version is handed over before it is replaced");
        assert!(remove(&zip, &["gibtsnicht".into()], &retire).is_err());

        let src = t.path().join("neu");
        fs::create_dir_all(src.join("sub")).unwrap();
        fs::write(src.join("sub/a.txt"), "A").unwrap();
        fs::write(t.path().join("readme.txt"), "neu").unwrap();
        assert_eq!(conflicts(&zip, "", &["readme.txt".into(), "x".into()]).unwrap(), vec!["readme.txt"]);
        let added = add(&zip, "", &[src.clone(), t.path().join("readme.txt")], &retire).unwrap();
        assert_eq!(added[0], join(&zip, "neu"));
        assert_eq!(names(&zip), vec!["2026/notiz.md", "neu/sub/a.txt", "readme.txt"]);
        let f = materialize(&join(&zip, "readme.txt"), &t.path().join("c")).unwrap();
        assert_eq!(fs::read_to_string(f).unwrap(), "neu", "same name is replaced");
        add(&zip, "2026", &[t.path().join("readme.txt")], &retire).unwrap();
        assert!(names(&zip).contains(&"2026/readme.txt".to_string()));
        assert!(add(&zip, "", &[zip.clone()], &retire).is_err());
        assert!(!t.path().join(".brausa-neu-Fotos.zip").exists());

        let packed = compress(&[src.clone()], t.path()).unwrap();
        assert_eq!(packed.file_name().unwrap(), "neu.zip");
        assert_eq!(names(&packed), vec!["neu/sub/a.txt"]);
        crate::i18n::set("de");
        assert_eq!(compress(&[src.clone(), zip.clone()], t.path()).unwrap().file_name().unwrap(), "Archiv.zip");
    }

    #[test]
    fn tar_can_be_changed() {
        let t = tempfile::tempdir().unwrap();
        let p = t.path().join("a.tgz");
        fs::create_dir_all(t.path().join("d")).unwrap();
        fs::write(t.path().join("d/x.txt"), "x").unwrap();
        fs::write(t.path().join("y.txt"), "y").unwrap();
        write(&p, None, &|_| false, &[("d".into(), t.path().join("d"))]).unwrap();
        add(&p, "d", &[t.path().join("y.txt")], &|_| Ok(())).unwrap();
        assert_eq!(names(&p), vec!["d/x.txt", "d/y.txt"]);
        remove(&p, &["d/x.txt".into()], &|_| Ok(())).unwrap();
        assert_eq!(names(&p), vec!["d/y.txt"]);
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
