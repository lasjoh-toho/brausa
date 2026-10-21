//! Searching inside documents: plain text, PDFs (text layer), Office/OpenDocument files.
//! The extracted text is kept in memory per file (path, size, mtime), so searching
//! the same folder again only reads what changed.

use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use walkdir::WalkDir;

use crate::fsops::skip_walk;
use crate::meta::SIDECAR_DIR;

/// Files larger than this are not read.
const MAX_BYTES: u64 = 60 * 1024 * 1024;
/// Text kept in memory at most (roughly, in bytes).
const CACHE_BYTES: usize = 256 * 1024 * 1024;

const TEXT: &[&str] = &[
    "txt", "md", "markdown", "tid", "csv", "tsv", "json", "xml", "html", "htm", "rtf", "tex", "log", "ini", "toml", "yaml", "yml",
    "js", "ts", "py", "rs", "java", "c", "h", "cpp", "css", "svelte", "sh", "sql", "srt", "vtt",
];
const ZIPPED: &[&str] = &["docx", "xlsx", "pptx", "odt", "ods", "odp"];

/// The text of a document, page by page (one page for everything but PDFs):
/// as written and lower-cased (for searching), white space collapsed.
type Pages = Arc<Vec<Page>>;

#[derive(Debug)]
pub struct Page {
    pub text: String,
    pub lower: String,
}

impl Page {
    pub fn new(s: &str) -> Page {
        let text = s.split_whitespace().collect::<Vec<_>>().join(" ");
        Page { lower: text.to_lowercase(), text }
    }
}

struct Cache {
    files: HashMap<PathBuf, (u64, f64, Pages)>,
    bytes: usize,
}

fn cache() -> &'static Mutex<Cache> {
    static C: OnceLock<Mutex<Cache>> = OnceLock::new();
    C.get_or_init(|| Mutex::new(Cache { files: HashMap::new(), bytes: 0 }))
}

/// Can brausa look into files with this extension?
pub fn searchable(ext: &str) -> bool {
    let ext = ext.to_lowercase();
    ext == "pdf" || TEXT.contains(&ext.as_str()) || ZIPPED.contains(&ext.as_str())
}

fn ext_of(p: &Path) -> String {
    p.extension().and_then(|x| x.to_str()).unwrap_or("").to_lowercase()
}

/// The document's text, from the cache or freshly read.
fn pages(path: &Path) -> Option<Pages> {
    let md = fs::metadata(path).ok()?;
    if md.len() > MAX_BYTES {
        return None;
    }
    let mtime = md.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok()?.as_secs_f64();
    if let Some((size, t, p)) = cache().lock().ok()?.files.get(path) {
        if *size == md.len() && *t == mtime {
            return Some(p.clone());
        }
    }
    let p: Pages = Arc::new(read(path)?.iter().map(|s| Page::new(s)).collect());
    let mut c = cache().lock().ok()?;
    let n: usize = p.iter().map(|x| x.text.len() * 2).sum();
    if c.bytes + n > CACHE_BYTES {
        c.files.clear();
        c.bytes = 0;
    }
    c.bytes += n;
    c.files.insert(path.to_path_buf(), (md.len(), mtime, p.clone()));
    Some(p)
}

/// Lower case, runs of white space as one blank (PDF text breaks lines anywhere).
fn normalize(s: &str) -> String {
    Page::new(s).lower
}

fn read(path: &Path) -> Option<Vec<String>> {
    let ext = ext_of(path);
    if ext == "pdf" {
        let bytes = fs::read(path).ok()?;
        // The PDF parser may panic on broken files; that only loses this file.
        return std::panic::catch_unwind(|| pdf_extract::extract_text_from_mem_by_pages(&bytes).ok()).ok().flatten();
    }
    if ZIPPED.contains(&ext.as_str()) {
        return Some(vec![office_text(path)?]);
    }
    let bytes = fs::read(path).ok()?;
    let text = String::from_utf8_lossy(&bytes).to_string();
    Some(vec![if matches!(ext.as_str(), "html" | "htm" | "xml") { strip_tags(&text) } else { text }])
}

/// The text of an Office or OpenDocument file: the XML parts that hold the content.
fn office_text(path: &Path) -> Option<String> {
    let mut z = zip::ZipArchive::new(fs::File::open(path).ok()?).ok()?;
    let mut out = String::new();
    let names: Vec<String> = z.file_names().map(String::from).collect();
    for n in names {
        let wanted = n == "content.xml"
            || n == "word/document.xml"
            || n == "xl/sharedStrings.xml"
            || (n.starts_with("ppt/slides/slide") && n.ends_with(".xml"))
            || (n.starts_with("word/") && (n.contains("header") || n.contains("footer") || n.contains("footnotes")) && n.ends_with(".xml"));
        if !wanted {
            continue;
        }
        let mut s = String::new();
        if z.by_name(&n).ok()?.take(MAX_BYTES).read_to_string(&mut s).is_ok() {
            out.push_str(&strip_tags(&s));
            out.push(' ');
        }
    }
    Some(out)
}

/// Markup without its tags; paragraph-like ends become blanks, a few entities are decoded.
fn strip_tags(s: &str) -> String {
    let mut out = String::with_capacity(s.len() / 2);
    let mut in_tag = false;
    for ch in s.chars() {
        match ch {
            '<' => {
                in_tag = true;
                out.push(' ');
            }
            '>' => in_tag = false,
            c if !in_tag => out.push(c),
            _ => {}
        }
    }
    out.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&apos;", "'").replace("&nbsp;", " ")
}

/// A document holding all the words.
#[derive(Debug, Clone, serde::Serialize)]
pub struct Hit {
    pub path: PathBuf,
    /// Some text around the first word found.
    pub snippet: String,
    /// The page of that word (PDFs, from 1).
    pub page: Option<u32>,
}

/// Does `pages` hold all `words`? Then where the first one is.
pub fn hit_in(pages: &[Page], words: &[String]) -> Option<(String, Option<u32>)> {
    if words.is_empty() || !words.iter().all(|w| pages.iter().any(|p| p.lower.contains(w.as_str()))) {
        return None;
    }
    let (i, at) = pages.iter().enumerate().find_map(|(i, p)| p.lower.find(words[0].as_str()).map(|at| (i, at)))?;
    // The text as written, unless lower-casing changed its length (then offsets differ).
    let p = if pages[i].lower.len() == pages[i].text.len() { &pages[i].text } else { &pages[i].lower };
    let floor = |mut k: usize| {
        while !p.is_char_boundary(k) {
            k -= 1;
        }
        k
    };
    let from = floor(at.saturating_sub(60));
    let to = floor((at + words[0].len() + 100).min(p.len()));
    let snippet = format!("{}{}{}", if from > 0 { "…" } else { "" }, p[from..to].trim(), if to < p.len() { "…" } else { "" });
    Some((snippet, (pages.len() > 1).then_some(i as u32 + 1)))
}

/// Documents below `roots` that contain every word (case-insensitive). Stops at
/// `limit` hits or when `budget` is spent; the flag says it stopped early.
pub fn search(roots: &[PathBuf], words: &[String], include_hidden: bool, limit: usize, budget: Duration) -> (Vec<Hit>, bool) {
    let words: Vec<String> = words.iter().map(|w| normalize(w)).filter(|w| !w.is_empty()).collect();
    let start = Instant::now();
    let mut out = vec![];
    if words.is_empty() {
        return (out, false);
    }
    for root in roots {
        let it = WalkDir::new(root).min_depth(1).max_depth(32).into_iter().filter_entry(|e| {
            e.file_name().to_string_lossy() != SIDECAR_DIR && (include_hidden || !skip_walk(e))
        });
        for e in it.flatten() {
            if start.elapsed() > budget {
                return (out, true);
            }
            if !e.file_type().is_file() || !searchable(&ext_of(e.path())) {
                continue;
            }
            let Some(p) = pages(e.path()) else { continue };
            if let Some((snippet, page)) = hit_in(&p, &words) {
                out.push(Hit { path: e.path().to_path_buf(), snippet, page });
                if out.len() >= limit {
                    return (out, true);
                }
            }
        }
    }
    (out, false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn words(w: &[&str]) -> Vec<String> {
        w.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn all_words_must_be_there_and_the_snippet_shows_the_first() {
        let pages = vec![Page::new("Erste Seite"), Page::new("Hier steht der Vertrag\n mit der Stadt")];
        let (s, page) = hit_in(&pages, &words(&["vertrag", "erste"])).unwrap();
        assert_eq!(s, "Hier steht der Vertrag mit der Stadt");
        assert_eq!(page, Some(2));
        assert!(hit_in(&pages, &words(&["vertrag", "fehlt"])).is_none());
    }

    #[test]
    fn finds_words_in_text_markup_and_office_files() {
        let dir = std::env::temp_dir().join(format!("brausa-content-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("sub")).unwrap();
        fs::write(dir.join("notiz.md"), "Der Termin ist am\nMontag.").unwrap();
        fs::write(dir.join("sub/seite.html"), "<p>Ein <b>Montag</b>sbrief &amp; mehr</p>").unwrap();
        fs::write(dir.join("bild.jpg"), "Montag").unwrap();
        let f = fs::File::create(dir.join("brief.docx")).unwrap();
        let mut z = zip::ZipWriter::new(f);
        z.start_file("word/document.xml", zip::write::SimpleFileOptions::default()).unwrap();
        z.write_all(b"<w:document><w:p><w:r><w:t>Termin am Montag</w:t></w:r></w:p></w:document>").unwrap();
        z.finish().unwrap();

        let (hits, more) = search(&[dir.clone()], &words(&["MONTAG"]), false, 100, Duration::from_secs(10));
        let mut names: Vec<String> = hits.iter().map(|h| h.path.file_name().unwrap().to_string_lossy().to_string()).collect();
        names.sort();
        assert_eq!(names, ["brief.docx", "notiz.md", "seite.html"]);
        assert!(!more);
        // Line breaks don't split a phrase.
        let (hits, _) = search(&[dir.clone()], &words(&["am montag"]), false, 100, Duration::from_secs(10));
        assert_eq!(hits.len(), 2);
        fs::remove_dir_all(&dir).unwrap();
    }
}
