//! Installed programs: listed for the "Programme" section of the sidebar and for
//! "Öffnen mit …", started, and handed files.
//!
//! - macOS: `.app` bundles in /Applications (one level of subfolders, e.g. Utilities),
//!   /System/Applications and ~/Applications; category and document types from `Info.plist`.
//! - Windows: shortcuts in the start menus (all users and the user's own).
//! - Linux: `.desktop` files (system, Flatpak, the user's own); `Categories` and `MimeType`.
//!
//! Each program gets guessed categories (the user can change them in brausa) and the file
//! kinds or extensions it says it opens, for the suggestions under "Öffnen mit …".

use serde::Serialize;
use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct AppInfo {
    pub name: String,
    /// The bundle, shortcut or desktop file.
    pub path: String,
    /// Category keys (office, writing, graphics, media, web, dev, utilities, games, learn, system).
    pub categories: Vec<String>,
    /// Extensions it declares it opens (lower case, without dot).
    pub exts: Vec<String>,
    /// File kinds it declares it opens: image, video, audio, text, pdf, web, any.
    pub kinds: Vec<String>,
}

/// Where programs live on this system (the folder the sidebar opens).
pub fn folders() -> Vec<PathBuf> {
    let mut v = vec![];
    #[cfg(target_os = "macos")]
    {
        v.push(PathBuf::from("/Applications"));
        v.push(PathBuf::from("/System/Applications"));
        if let Some(h) = dirs::home_dir() {
            v.push(h.join("Applications"));
        }
    }
    #[cfg(windows)]
    {
        if let Ok(p) = std::env::var("ProgramData") {
            v.push(PathBuf::from(p).join("Microsoft\\Windows\\Start Menu\\Programs"));
        }
        if let Ok(p) = std::env::var("APPDATA") {
            v.push(PathBuf::from(p).join("Microsoft\\Windows\\Start Menu\\Programs"));
        }
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        if let Some(d) = dirs::data_dir() {
            v.push(d.join("applications"));
        }
        v.push(PathBuf::from("/usr/share/applications"));
        v.push(PathBuf::from("/usr/local/share/applications"));
        v.push(PathBuf::from("/var/lib/flatpak/exports/share/applications"));
        if let Some(d) = dirs::data_dir() {
            v.push(d.join("flatpak/exports/share/applications"));
        }
    }
    v.into_iter().filter(|p| p.is_dir()).collect()
}

/// Every program found, sorted by name, each name once.
pub fn list() -> Vec<AppInfo> {
    let mut out: Vec<AppInfo> = vec![];
    for dir in folders() {
        scan(&dir, 0, &mut out);
    }
    let coll = |s: &str| s.to_lowercase();
    out.sort_by(|a, b| coll(&a.name).cmp(&coll(&b.name)));
    out.dedup_by(|a, b| a.name.eq_ignore_ascii_case(&b.name));
    out
}

fn scan(dir: &Path, depth: usize, out: &mut Vec<AppInfo>) {
    let Ok(rd) = fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let p = e.path();
        let name = e.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        if let Some(a) = read_app(&p) {
            out.push(a);
        } else if p.is_dir() && depth < MAX_DEPTH && !is_bundle(&p) {
            scan(&p, depth + 1, out);
        }
    }
}

#[cfg(target_os = "macos")]
const MAX_DEPTH: usize = 1;
#[cfg(not(target_os = "macos"))]
const MAX_DEPTH: usize = 3;

fn is_bundle(p: &Path) -> bool {
    p.extension().is_some_and(|e| e.eq_ignore_ascii_case("app"))
}

/// One program from its bundle, shortcut or desktop file (None: not a program).
pub fn read_app(p: &Path) -> Option<AppInfo> {
    let ext = p.extension()?.to_string_lossy().to_lowercase();
    let stem = p.file_stem()?.to_string_lossy().to_string();
    match ext.as_str() {
        "app" => Some(mac_app(p, stem)),
        "lnk" | "url" => {
            // Uninstallers and help links are no programs to start.
            let l = stem.to_lowercase();
            if ["uninstall", "deinstall", "entfernen", "readme", "liesmich", "help", "hilfe", "website"].iter().any(|w| l.contains(w)) {
                return None;
            }
            Some(AppInfo { categories: guess(&stem, &[]), name: stem, path: p.to_string_lossy().to_string(), exts: vec![], kinds: vec![] })
        }
        "desktop" => desktop_app(p),
        _ => None,
    }
}

fn mac_app(p: &Path, stem: String) -> AppInfo {
    let plist = plist::Value::from_file(p.join("Contents/Info.plist")).ok();
    let dict = plist.as_ref().and_then(|v| v.as_dictionary());
    let s = |k: &str| dict.and_then(|d| d.get(k)).and_then(|v| v.as_string()).map(String::from);
    let name = s("CFBundleDisplayName").filter(|n| !n.trim().is_empty()).unwrap_or(stem);
    let mut cats = vec![];
    if let Some(c) = s("LSApplicationCategoryType") {
        cats.extend(mac_category(&c));
    }
    let mut exts = BTreeSet::new();
    let mut kinds = BTreeSet::new();
    if let Some(types) = dict.and_then(|d| d.get("CFBundleDocumentTypes")).and_then(|v| v.as_array()) {
        for t in types {
            let Some(t) = t.as_dictionary() else { continue };
            // Viewers and editors only; "None" just marks icons.
            if t.get("CFBundleTypeRole").and_then(|v| v.as_string()) == Some("None") {
                continue;
            }
            for e in t.get("CFBundleTypeExtensions").and_then(|v| v.as_array()).into_iter().flatten() {
                if let Some(e) = e.as_string() {
                    if e == "*" {
                        kinds.insert("any".to_string());
                    } else {
                        exts.insert(e.to_lowercase());
                    }
                }
            }
            for u in t.get("LSItemContentTypes").and_then(|v| v.as_array()).into_iter().flatten() {
                if let Some(u) = u.as_string() {
                    if let Some(k) = uti_kind(u) {
                        kinds.insert(k.to_string());
                    } else {
                        exts.extend(uti_exts(u).iter().map(|s| s.to_string()));
                    }
                }
            }
        }
    }
    let kinds: Vec<String> = kinds.into_iter().collect();
    let cats = merge(cats, guess(&name, &kinds));
    AppInfo { name, path: p.to_string_lossy().to_string(), categories: cats, exts: exts.into_iter().collect(), kinds }
}

fn mac_category(c: &str) -> Vec<String> {
    let c = c.trim_start_matches("public.app-category.");
    let k = match c {
        "productivity" | "business" | "finance" => "office",
        "graphics-design" | "photography" => "graphics",
        "video" | "music" | "entertainment" => "media",
        "social-networking" | "news" => "web",
        "developer-tools" => "dev",
        "utilities" => "utilities",
        "education" | "reference" | "medical" | "healthcare-fitness" => "learn",
        c if c.ends_with("games") => "games",
        _ => return vec![],
    };
    vec![k.to_string()]
}

/// File kinds behind Apple's type identifiers.
fn uti_kind(u: &str) -> Option<&'static str> {
    Some(match u {
        "public.image" | "public.jpeg" | "public.png" | "public.tiff" | "com.compuserve.gif" | "public.heic" | "public.camera-raw-image" => "image",
        "public.movie" | "public.video" | "public.mpeg-4" | "com.apple.quicktime-movie" | "public.avi" => "video",
        "public.audio" | "public.mp3" | "public.mpeg-4-audio" | "com.microsoft.waveform-audio" => "audio",
        "public.text" | "public.plain-text" | "public.utf8-plain-text" | "public.source-code" | "public.script" | "net.daringfireball.markdown" => "text",
        "com.adobe.pdf" => "pdf",
        "public.html" | "public.url" => "web",
        "public.data" | "public.item" | "public.content" => "any",
        _ => return None,
    })
}

fn uti_exts(u: &str) -> &'static [&'static str] {
    match u {
        "org.openxmlformats.wordprocessingml.document" => &["docx"],
        "com.microsoft.word.doc" => &["doc"],
        "org.openxmlformats.spreadsheetml.sheet" => &["xlsx"],
        "com.microsoft.excel.xls" => &["xls"],
        "org.openxmlformats.presentationml.presentation" => &["pptx"],
        "com.microsoft.powerpoint.ppt" => &["ppt"],
        "org.oasis-open.opendocument.text" => &["odt"],
        "org.oasis-open.opendocument.spreadsheet" => &["ods"],
        "org.oasis-open.opendocument.presentation" => &["odp"],
        "public.rtf" => &["rtf"],
        "public.comma-separated-values-text" => &["csv"],
        "public.json" => &["json"],
        "public.xml" => &["xml"],
        "public.zip-archive" => &["zip"],
        "com.apple.iwork.pages.pages" => &["pages"],
        "com.apple.iwork.numbers.numbers" => &["numbers"],
        "com.apple.iwork.keynote.key" => &["key"],
        "org.idpf.epub-container" => &["epub"],
        "public.svg-image" => &["svg"],
        _ => &[],
    }
}

/// A `.desktop` file's program; hidden ones and plain links are left out.
fn desktop_app(p: &Path) -> Option<AppInfo> {
    let text = fs::read_to_string(p).ok()?;
    let d = parse_desktop(&text);
    if d.kind != "Application" || d.hidden || d.exec.is_empty() {
        return None;
    }
    let mut kinds = BTreeSet::new();
    let mut exts = BTreeSet::new();
    for m in &d.mime {
        match m.split('/').next().unwrap_or("") {
            "image" => {
                kinds.insert("image");
            }
            "video" => {
                kinds.insert("video");
            }
            "audio" => {
                kinds.insert("audio");
            }
            _ if m == "text/plain" => {
                kinds.insert("text");
            }
            _ if m == "application/pdf" => {
                kinds.insert("pdf");
            }
            _ if m == "text/html" || m == "x-scheme-handler/http" || m == "x-scheme-handler/https" => {
                kinds.insert("web");
            }
            _ => {
                if let Some(e) = mime_guess::get_mime_extensions_str(m) {
                    exts.extend(e.iter().map(|s| s.to_string()));
                }
            }
        }
    }
    let kinds: Vec<String> = kinds.into_iter().map(String::from).collect();
    let mut cats = vec![];
    for c in &d.categories {
        let k = match c.as_str() {
            "Office" => "office",
            "TextEditor" | "WordProcessor" => "writing",
            "Graphics" | "Photography" => "graphics",
            "AudioVideo" | "Audio" | "Video" | "Player" => "media",
            "Network" | "WebBrowser" | "Email" | "Chat" => "web",
            "Development" | "IDE" => "dev",
            "Utility" | "Archiving" | "FileManager" => "utilities",
            "Game" => "games",
            "Education" | "Science" => "learn",
            "System" | "Settings" => "system",
            _ => continue,
        };
        if !cats.iter().any(|x: &String| x == k) {
            cats.push(k.to_string());
        }
    }
    let cats = merge(cats, guess(&d.name, &kinds));
    Some(AppInfo { name: d.name, path: p.to_string_lossy().to_string(), categories: cats, exts: exts.into_iter().collect(), kinds })
}

#[derive(Default, Debug)]
struct Desktop {
    name: String,
    kind: String,
    exec: String,
    hidden: bool,
    categories: Vec<String>,
    mime: Vec<String>,
}

fn parse_desktop(text: &str) -> Desktop {
    let mut d = Desktop::default();
    let mut main = false;
    for line in text.lines() {
        let line = line.trim();
        if line.starts_with('[') {
            main = line == "[Desktop Entry]";
            continue;
        }
        if !main {
            continue;
        }
        let Some((k, v)) = line.split_once('=') else { continue };
        let (k, v) = (k.trim(), v.trim());
        let list = || v.split(';').filter(|s| !s.is_empty()).map(String::from).collect::<Vec<_>>();
        match k {
            "Name" => d.name = v.to_string(),
            "Type" => d.kind = v.to_string(),
            "Exec" => d.exec = v.to_string(),
            "NoDisplay" | "Hidden" if v == "true" => d.hidden = true,
            "Categories" => d.categories = list(),
            "MimeType" => d.mime = list(),
            _ => {}
        }
    }
    d
}

fn merge(mut a: Vec<String>, b: Vec<String>) -> Vec<String> {
    for x in b {
        if !a.contains(&x) {
            a.push(x);
        }
    }
    a
}

/// Categories from the name (and the kinds it opens) where the program says nothing itself.
pub fn guess(name: &str, kinds: &[String]) -> Vec<String> {
    let n = name.to_lowercase();
    const WORDS: &[(&str, &[&str])] = &[
        ("office", &["word", "excel", "powerpoint", "outlook", "onenote", "pages", "numbers", "keynote", "libreoffice", "openoffice", "calc", "impress", "writer", "office", "acrobat", "kalender", "calendar", "erinnerungen", "reminders", "notion", "obsidian", "evernote", "notizen", "notes", "kontakte", "contacts"]),
        ("writing", &["textedit", "notepad", "editor", "bbedit", "sublime", "typora", "ulysses", "scrivener", "markdown", "ia writer"]),
        ("graphics", &["photoshop", "illustrator", "indesign", "lightroom", "affinity", "gimp", "inkscape", "krita", "pixelmator", "figma", "sketch", "preview", "vorschau", "fotos", "photos", "digikam", "darktable", "blender", "paint", "acdsee", "irfanview"]),
        ("media", &["vlc", "musik", "music", "itunes", "quicktime", "spotify", "audacity", "garageband", "logic", "final cut", "imovie", "davinci", "premiere", "handbrake", "obs", "mpv", "podcasts", "tv", "kodi", "rhythmbox", "totem", "media player"]),
        ("web", &["safari", "chrome", "chromium", "firefox", "edge", "opera", "brave", "vivaldi", "mail", "thunderbird", "outlook", "zoom", "teams", "slack", "discord", "skype", "telegram", "signal", "whatsapp", "messages", "nachrichten", "facetime", "filezilla", "cyberduck", "transmit"]),
        ("dev", &["xcode", "visual studio", "code", "intellij", "pycharm", "webstorm", "android studio", "terminal", "iterm", "warp", "github", "sourcetree", "docker", "postman", "eclipse", "konsole", "powershell", "git"]),
        ("utilities", &["finder", "explorer", "archive", "unarchiver", "7-zip", "winrar", "keka", "rechner", "calculator", "dienstprogramm", "utility", "disk", "festplatten", "aktivität", "activity", "monitor", "screenshot", "bildschirmfoto", "console", "konsole", "nautilus", "dolphin", "1password", "keepass", "schlüsselbund", "keychain"]),
        ("games", &["steam", "epic games", "chess", "schach", "solitaire", "minecraft", "game"]),
        ("learn", &["anki", "zotero", "mendeley", "geogebra", "wörterbuch", "dictionary", "lexikon", "duden", "matlab", "rstudio", "jupyter"]),
        ("system", &["system", "settings", "einstellungen", "control panel", "systemsteuerung", "app store", "software", "update"]),
    ];
    let mut out: Vec<String> = vec![];
    for (cat, words) in WORDS {
        if words.iter().any(|w| contains_word(&n, w)) {
            out.push(cat.to_string());
        }
    }
    if out.is_empty() {
        let k = |x: &str| kinds.iter().any(|y| y == x);
        if k("image") {
            out.push("graphics".into());
        } else if k("video") || k("audio") {
            out.push("media".into());
        } else if k("web") {
            out.push("web".into());
        } else if k("text") {
            out.push("writing".into());
        }
    }
    out
}

/// `w` in `n` at word starts (so "code" matches "Visual Studio Code" but not "Unicode Viewer").
fn contains_word(n: &str, w: &str) -> bool {
    let mut from = 0;
    while let Some(i) = n[from..].find(w) {
        let at = from + i;
        let before = n[..at].chars().next_back();
        if before.is_none_or(|c| !c.is_alphanumeric()) {
            return true;
        }
        from = at + w.len();
    }
    false
}

/// The command line of a `.desktop` file for these files (field codes replaced, as the spec says).
pub fn desktop_command(exec: &str, files: &[String]) -> Vec<String> {
    let mut out = vec![];
    let mut used = false;
    for arg in split_exec(exec) {
        match arg.as_str() {
            "%f" | "%u" => {
                used = true;
                if let Some(f) = files.first() {
                    out.push(f.clone());
                }
            }
            "%F" | "%U" => {
                used = true;
                out.extend(files.iter().cloned());
            }
            a if a.len() == 2 && a.starts_with('%') => {}
            a => out.push(a.replace("%%", "%")),
        }
    }
    if !used {
        out.extend(files.iter().cloned());
    }
    out
}

fn split_exec(s: &str) -> Vec<String> {
    let mut out = vec![];
    let mut cur = String::new();
    let mut quoted = false;
    let mut chars = s.chars();
    let mut any = false;
    while let Some(c) = chars.next() {
        match c {
            '"' => {
                quoted = !quoted;
                any = true;
            }
            '\\' if quoted => {
                if let Some(n) = chars.next() {
                    cur.push(n);
                }
            }
            c if c.is_whitespace() && !quoted => {
                if any || !cur.is_empty() {
                    out.push(std::mem::take(&mut cur));
                    any = false;
                }
            }
            c => cur.push(c),
        }
    }
    if any || !cur.is_empty() {
        out.push(cur);
    }
    out
}

/// Start a program, with files to open (none: just start it).
pub fn launch(app: &str, files: &[String]) -> std::io::Result<()> {
    use std::process::Command;
    let p = Path::new(app);
    #[cfg(target_os = "macos")]
    {
        let _ = p;
        let mut c = Command::new("open");
        c.arg("-a").arg(app).args(files);
        c.spawn()?;
        return Ok(());
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = p;
        // `start` follows shortcuts and passes the files on; no console window.
        let mut c = Command::new("cmd");
        c.arg("/C").arg("start").arg("").arg(app).args(files).creation_flags(0x0800_0000);
        c.spawn()?;
        return Ok(());
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let d = parse_desktop(&fs::read_to_string(p)?);
        let cmd = desktop_command(&d.exec, files);
        let (prog, args) = cmd.split_first().ok_or_else(|| std::io::Error::other(crate::tr!("Das Programm hat keinen Befehl", "The program has no command")))?;
        Command::new(prog).args(args).spawn()?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn guesses_categories_from_names() {
        assert_eq!(guess("Visual Studio Code", &[]), ["dev"]);
        assert!(guess("Unicode Viewer", &[]).is_empty());
        assert_eq!(guess("Firefox", &[]), ["web"]);
        assert!(guess("Microsoft Outlook", &[]).contains(&"office".to_string()));
        assert!(guess("Microsoft Outlook", &[]).contains(&"web".to_string()));
        assert_eq!(guess("Seltsam", &["image".into()]), ["graphics"]);
    }

    #[test]
    fn reads_desktop_files() {
        let t = tempfile::tempdir().unwrap();
        let p = t.path().join("gimp.desktop");
        fs::write(
            &p,
            "[Desktop Entry]\nType=Application\nName=GNU Image Manipulation Program\nExec=gimp-2.10 %U\nCategories=Graphics;2DGraphics;\nMimeType=image/png;application/pdf;application/vnd.oasis.opendocument.text;\n\n[Desktop Action new]\nName=Neu\n",
        )
        .unwrap();
        let a = read_app(&p).unwrap();
        assert_eq!(a.name, "GNU Image Manipulation Program");
        assert_eq!(a.categories, ["graphics"]);
        assert_eq!(a.kinds, ["image", "pdf"]);
        assert!(a.exts.contains(&"odt".to_string()));
        fs::write(t.path().join("hidden.desktop"), "[Desktop Entry]\nType=Application\nName=X\nExec=x\nNoDisplay=true\n").unwrap();
        assert!(read_app(&t.path().join("hidden.desktop")).is_none());
    }

    #[test]
    fn builds_desktop_command_lines() {
        let f = vec!["/a b.png".to_string(), "/c.png".to_string()];
        assert_eq!(desktop_command("gimp %U", &f), ["gimp", "/a b.png", "/c.png"]);
        assert_eq!(desktop_command("\"/opt/my app/run\" --new %f", &f), ["/opt/my app/run", "--new", "/a b.png"]);
        assert_eq!(desktop_command("vlc --started-from-file %i %c", &f), ["vlc", "--started-from-file", "/a b.png", "/c.png"]);
    }

    #[test]
    fn skips_uninstallers() {
        let t = tempfile::tempdir().unwrap();
        for n in ["Uninstall Foo.lnk", "Foo.lnk"] {
            fs::write(t.path().join(n), b"x").unwrap();
        }
        let mut v = vec![];
        scan(t.path(), 0, &mut v);
        assert_eq!(v.iter().map(|a| a.name.as_str()).collect::<Vec<_>>(), ["Foo"]);
    }
}
