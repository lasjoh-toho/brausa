//! Finds files with identical content: same size first, then a quick hash
//! over head and tail, then a full hash only for the files still alike.

use std::collections::HashMap;
use std::fs;
use std::io::{self, Read};
use std::path::{Path, PathBuf};

use crate::library::{file_id, quick_hash};

fn full_hash(p: &Path) -> io::Result<u128> {
    let mut f = fs::File::open(p)?;
    let mut h = xxhash_rust::xxh3::Xxh3::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(h.digest128())
}

/// Split each group by `key`, keeping only buckets with at least two files.
fn refine<K: std::hash::Hash + Eq>(groups: Vec<Vec<PathBuf>>, key: impl Fn(&Path) -> Option<K>) -> Vec<Vec<PathBuf>> {
    let mut out = Vec::new();
    for g in groups {
        let mut by: HashMap<K, Vec<PathBuf>> = HashMap::new();
        for p in g {
            if let Some(k) = key(&p) {
                by.entry(k).or_default().push(p);
            }
        }
        out.extend(by.into_values().filter(|v| v.len() > 1));
    }
    out
}

/// Groups of files with the same content, largest waste first. Empty files,
/// folders and several names for the same file (hard links) are left out.
pub fn find(paths: &[PathBuf]) -> Vec<Vec<PathBuf>> {
    let mut by_size: HashMap<u64, Vec<PathBuf>> = HashMap::new();
    let mut seen = std::collections::HashSet::new();
    for p in paths {
        let Ok(md) = fs::metadata(p) else { continue };
        if !md.is_file() || md.len() == 0 {
            continue;
        }
        if let Some(id) = file_id(p) {
            if !seen.insert(id) {
                continue;
            }
        }
        by_size.entry(md.len()).or_default().push(p.clone());
    }
    let groups = by_size.into_values().filter(|v| v.len() > 1).collect();
    let groups = refine(groups, quick_hash);
    let mut groups = refine(groups, |p| full_hash(p).ok());
    let size = |g: &Vec<PathBuf>| fs::metadata(&g[0]).map(|m| m.len()).unwrap_or(0);
    for g in &mut groups {
        g.sort();
    }
    groups.sort_by(|a, b| (size(b) * (b.len() as u64 - 1)).cmp(&(size(a) * (a.len() as u64 - 1))).then_with(|| a[0].cmp(&b[0])));
    groups
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_identical_files_only() {
        let d = tempfile::tempdir().unwrap();
        let w = |n: &str, c: &[u8]| {
            let p = d.path().join(n);
            fs::create_dir_all(p.parent().unwrap()).unwrap();
            fs::write(&p, c).unwrap();
            p
        };
        // Large files that agree in head and tail but differ in the middle.
        let mut big = vec![7u8; 300_000];
        let a = w("a.bin", &big);
        let b = w("sub/b.bin", &big);
        big[150_000] = 8;
        let c = w("c.bin", &big);
        let x = w("x.txt", b"hallo");
        let y = w("y.txt", b"hallo");
        let z = w("z.txt", b"hallx");
        let e1 = w("e1", b"");
        let e2 = w("e2", b"");
        let all = vec![a.clone(), b.clone(), c, x.clone(), y.clone(), z, e1, e2, x.clone()];
        let g = find(&all);
        assert_eq!(g, vec![vec![a, b], vec![x, y]]);
    }
}
