//! The web panel: a second webview inside the main window for pages from the
//! internet and for local websites.
//!
//! - It keeps its own cookies and storage (not those of the system browser).
//! - Pages in it are not brausa: they are remote origins, so the app's IPC
//!   refuses them; a local site is served from a random 127.0.0.1 port.
//! - Downloads land in the folder the UI chose (the project's or Downloads).
//! - A local site is served with a Content-Security-Policy that forbids
//!   scripts unless the user allowed them for that site.

use serde::Serialize;
use std::{
    collections::HashMap,
    fs,
    io::Read,
    path::{Component, Path, PathBuf},
    sync::{mpsc, Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{
    webview::{DownloadEvent, PageLoadEvent, WebviewBuilder},
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Url, WebviewUrl,
};

pub const LABEL: &str = "web";

/// Linux: GTK stacks a window's webviews in a box. To lay the web panel over
/// brausa instead, brausa's webview goes into a GtkOverlay whose top layer is a
/// GtkFixed (input passes through where it is empty); the panel's webview is
/// moved into that GtkFixed and placed there.
#[cfg(target_os = "linux")]
mod gtk_layer {
    use gtk::prelude::*;

    const FIXED: &str = "brausa-web-layer";

    pub fn prepare(window: &tauri::Window) -> Result<(), String> {
        let vbox = window.default_vbox().map_err(|e| e.to_string())?;
        let main = vbox.children().last().cloned().ok_or("Kein Webview im Fenster")?;
        vbox.remove(&main);
        let overlay = gtk::Overlay::new();
        overlay.add(&main);
        let fixed = gtk::Fixed::new();
        fixed.set_widget_name(FIXED);
        overlay.add_overlay(&fixed);
        overlay.set_overlay_pass_through(&fixed, true);
        vbox.pack_start(&overlay, true, true, 0);
        overlay.show_all();
        Ok(())
    }

    fn find(w: &gtk::Widget) -> Option<gtk::Fixed> {
        if w.widget_name() == FIXED {
            return w.clone().downcast::<gtk::Fixed>().ok();
        }
        w.clone().downcast::<gtk::Container>().ok()?.children().iter().find_map(find)
    }

    /// Moves the panel's webview into the layer (once) and places it.
    pub fn place(webview: &tauri::Webview, x: i32, y: i32, w: i32, h: i32) {
        let _ = webview.with_webview(move |pv| {
            let wv = pv.inner();
            let wv: gtk::Widget = wv.upcast();
            let in_layer = wv.parent().map(|p| p.widget_name() == FIXED).unwrap_or(false);
            if !in_layer {
                let Some(top) = wv.toplevel() else { return };
                let Some(fixed) = find(&top) else { return };
                if let Some(p) = wv.parent().and_then(|p| p.downcast::<gtk::Container>().ok()) {
                    p.remove(&wv);
                }
                fixed.put(&wv, x, y);
            } else if let Some(fixed) = wv.parent().and_then(|p| p.downcast::<gtk::Fixed>().ok()) {
                fixed.move_(&wv, x, y);
            }
            wv.set_size_request(w.max(1), h.max(1));
        });
    }
}

#[cfg(target_os = "linux")]
pub use gtk_layer::prepare as prepare_window;

#[derive(Clone, Copy, serde::Deserialize)]
pub struct Bounds {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Serialize, Clone)]
struct Nav {
    url: String,
    loading: bool,
}

#[derive(Serialize, Clone)]
struct Download {
    url: String,
    path: Option<String>,
    success: bool,
}

/// One served local site: its folder and whether scripts may run.
struct Site {
    root: PathBuf,
    scripts: bool,
}

#[derive(Default)]
pub struct Web {
    /// Where downloads go.
    pub target: Mutex<Option<PathBuf>>,
    sites: Arc<Mutex<HashMap<String, Site>>>,
    port: Mutex<Option<u16>>,
    /// Where each running download goes (macOS does not report the path when it finishes).
    pending: Mutex<HashMap<String, PathBuf>>,
}

fn token() -> String {
    let t = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    format!("{:x}{:x}", t, std::process::id())
}

/// Only web pages; no file:, javascript: or custom schemes in the panel.
pub fn allowed(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https" | "about" | "blob" | "data")
}

fn safe_name(name: &str) -> String {
    let s: String = name.chars().map(|c| if r#"/\:*?"<>|"#.contains(c) || c.is_control() { '_' } else { c }).collect();
    let s = s.trim().trim_matches('.').to_string();
    if s.is_empty() { "download".into() } else { s.chars().take(120).collect() }
}

/// `dir/name`, or `dir/name (2)` … when taken.
fn free_path(dir: &Path, name: &str) -> PathBuf {
    let p = dir.join(name);
    if !p.exists() {
        return p;
    }
    let (stem, ext) = match name.rsplit_once('.') {
        Some((s, e)) if !s.is_empty() => (s.to_string(), format!(".{e}")),
        _ => (name.to_string(), String::new()),
    };
    (2..).map(|i| dir.join(format!("{stem} ({i}){ext}"))).find(|p| !p.exists()).unwrap()
}

impl Web {
    fn download_dir(&self) -> PathBuf {
        self.target.lock().ok().and_then(|t| t.clone()).or_else(dirs::download_dir).unwrap_or_else(std::env::temp_dir)
    }

    /// Opens (or navigates) the panel at `url` and puts it at `b` (CSS pixels of the main window).
    pub fn open(&self, app: &AppHandle, url: &str, b: Bounds) -> Result<(), String> {
        let url = Url::parse(url).map_err(|e| format!("Ungültige Adresse: {e}"))?;
        if !allowed(&url) {
            return Err(format!("„{}“-Adressen öffnet das Web-Fenster nicht", url.scheme()));
        }
        if let Some(w) = app.get_webview(LABEL) {
            w.navigate(url).map_err(|e| e.to_string())?;
            return self.place(app, b, true);
        }
        let window = app.get_window("main").ok_or("Kein Hauptfenster")?;
        let data = app.path().app_data_dir().map_err(|e| e.to_string())?.join("web");
        let (title, load) = (app.clone(), app.clone());
        let me = app.clone();
        let mut builder = WebviewBuilder::new(LABEL, WebviewUrl::External(url))
            .data_directory(data)
            // The address bar follows page loads (not navigations: a download is one, too).
            .on_navigation(allowed)
            .on_document_title_changed(move |_, t| {
                let _ = title.emit("web-title", t);
            })
            .on_page_load(move |_, p| {
                let loading = matches!(p.event(), PageLoadEvent::Started);
                let _ = load.emit("web-nav", Nav { url: p.url().to_string(), loading });
            })
            .on_download(move |_, ev| {
                match ev {
                    DownloadEvent::Requested { url, destination } => {
                        let dir = me.state::<Web>().download_dir();
                        let name = destination
                            .file_name()
                            .map(|n| n.to_string_lossy().to_string())
                            .filter(|n| !n.is_empty())
                            .or_else(|| url.path_segments().and_then(|mut s| s.next_back()).map(String::from))
                            .unwrap_or_default();
                        *destination = free_path(&dir, &safe_name(&name));
                        if let Ok(mut p) = me.state::<Web>().pending.lock() {
                            p.insert(url.to_string(), destination.clone());
                        }
                    }
                    DownloadEvent::Finished { url, path, success } => {
                        let planned = me.state::<Web>().pending.lock().ok().and_then(|mut p| p.remove(url.as_str()));
                        let path = path.filter(|p| !p.as_os_str().is_empty()).or(planned);
                        let _ = me.emit(
                            "web-download",
                            Download { url: url.to_string(), path: path.map(|p| p.to_string_lossy().to_string()), success },
                        );
                    }
                    _ => {}
                }
                true
            });
        // macOS keeps website data per identifier instead of per folder.
        #[cfg(target_os = "macos")]
        {
            builder = builder.data_store_identifier(*b"brausa-web-panel");
        }
        #[cfg(not(target_os = "macos"))]
        {
            builder = builder.incognito(false);
        }
        window
            .add_child(builder, LogicalPosition::new(b.x, b.y), LogicalSize::new(b.w.max(1.0), b.h.max(1.0)))
            .map_err(|e| e.to_string())?;
        self.place(app, b, true)
    }

    pub fn place(&self, app: &AppHandle, b: Bounds, visible: bool) -> Result<(), String> {
        let Some(w) = app.get_webview(LABEL) else { return Ok(()) };
        #[cfg(target_os = "linux")]
        gtk_layer::place(&w, b.x.round() as i32, b.y.round() as i32, b.w.round() as i32, b.h.round() as i32);
        #[cfg(not(target_os = "linux"))]
        {
            w.set_position(LogicalPosition::new(b.x, b.y)).map_err(|e| e.to_string())?;
            w.set_size(LogicalSize::new(b.w.max(1.0), b.h.max(1.0))).map_err(|e| e.to_string())?;
        }
        if visible { w.show() } else { w.hide() }.map_err(|e| e.to_string())
    }

    pub fn close(&self, app: &AppHandle) -> Result<(), String> {
        if let Some(w) = app.get_webview(LABEL) {
            w.close().map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    /// Runs `js` in the page and returns its JSON-encoded result.
    pub fn eval(&self, app: &AppHandle, js: &str) -> Result<String, String> {
        let w = app.get_webview(LABEL).ok_or("Das Web-Fenster ist nicht offen")?;
        let (tx, rx) = mpsc::channel();
        w.eval_with_callback(js, move |r| {
            let _ = tx.send(r);
        })
        .map_err(|e| e.to_string())?;
        rx.recv_timeout(Duration::from_secs(10)).map_err(|_| "Die Seite antwortet nicht".to_string())
    }

    /// Saves the page as it is shown now (HTML after scripts ran) into `dir`.
    pub fn save_page(&self, app: &AppHandle, dir: &Path) -> Result<PathBuf, String> {
        let raw = self.eval(app, "JSON.stringify({title: document.title, url: location.href, html: '<!doctype html>\\n' + document.documentElement.outerHTML})")?;
        // The callback result is the JSON encoding of our JSON string.
        let inner: String = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
        let page: serde_json::Value = serde_json::from_str(&inner).map_err(|e| e.to_string())?;
        let title = page["title"].as_str().filter(|t| !t.trim().is_empty()).unwrap_or("Webseite");
        let url = page["url"].as_str().unwrap_or("");
        let html = page["html"].as_str().unwrap_or("");
        // Relative links keep working when opened again: point them at the original address.
        let html = html.replacen("<head>", &format!("<head><base href=\"{}\">", url.replace('"', "&quot;")), 1);
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        let p = free_path(dir, &format!("{}.html", safe_name(title)));
        fs::write(&p, html).map_err(|e| e.to_string())?;
        Ok(p)
    }

    /// Serves `root` on 127.0.0.1 under a secret prefix; returns the base URL.
    pub fn serve(&self, root: &Path, scripts: bool) -> Result<String, String> {
        let root = root.canonicalize().map_err(|e| e.to_string())?;
        let port = self.ensure_server()?;
        let mut sites = self.sites.lock().map_err(|e| e.to_string())?;
        // One token per folder and script setting, so URLs stay stable while the app runs.
        let key = sites.iter().find(|(_, s)| s.root == root && s.scripts == scripts).map(|(k, _)| k.clone());
        let key = key.unwrap_or_else(|| {
            let k = token();
            sites.insert(k.clone(), Site { root, scripts });
            k
        });
        Ok(format!("http://127.0.0.1:{port}/{key}/"))
    }

    fn ensure_server(&self) -> Result<u16, String> {
        let mut port = self.port.lock().map_err(|e| e.to_string())?;
        if let Some(p) = *port {
            return Ok(p);
        }
        let server = tiny_http::Server::http("127.0.0.1:0").map_err(|e| e.to_string())?;
        let p = server.server_addr().to_ip().map(|a| a.port()).ok_or("Kein Port")?;
        let sites = self.sites.clone();
        std::thread::spawn(move || {
            for req in server.incoming_requests() {
                let res = respond(&sites, req.url());
                let _ = req.respond(res);
            }
        });
        *port = Some(p);
        Ok(p)
    }
}

type Response = tiny_http::Response<std::io::Cursor<Vec<u8>>>;

fn header(k: &str, v: &str) -> tiny_http::Header {
    tiny_http::Header::from_bytes(k.as_bytes(), v.as_bytes()).unwrap()
}

/// The file a request path points to inside `root`, refusing anything outside it.
pub fn resolve(root: &Path, rel: &str) -> Option<PathBuf> {
    let rel = percent_decode(rel.split(['?', '#']).next().unwrap_or(""));
    let rel = Path::new(&rel);
    if rel.components().any(|c| !matches!(c, Component::Normal(_))) {
        return None;
    }
    let mut p = root.join(rel);
    if p.is_dir() {
        p = p.join("index.html");
    }
    let p = p.canonicalize().ok()?;
    p.starts_with(root).then_some(p)
}

fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn respond(sites: &Mutex<HashMap<String, Site>>, url: &str) -> Response {
    let not_found = || tiny_http::Response::from_data(b"Nicht gefunden".to_vec()).with_status_code(404);
    let path = url.trim_start_matches('/');
    let (key, rest) = path.split_once('/').unwrap_or((path, ""));
    let Ok(sites) = sites.lock() else { return not_found() };
    let Some(site) = sites.get(key) else { return not_found() };
    let Some(file) = resolve(&site.root, rest) else { return not_found() };
    let mut data = vec![];
    if fs::File::open(&file).and_then(|mut f| f.read_to_end(&mut data)).is_err() {
        return not_found();
    }
    let mime = mime_guess::from_path(&file).first_or_octet_stream();
    let mut r = tiny_http::Response::from_data(data)
        .with_header(header("Content-Type", mime.essence_str()))
        .with_header(header("Cache-Control", "no-store"))
        .with_header(header("X-Content-Type-Options", "nosniff"));
    if !site.scripts {
        r = r.with_header(header("Content-Security-Policy", "script-src 'none'; object-src 'none'; frame-src 'none'"));
    }
    r
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serves_only_inside_the_site() {
        let tmp = std::env::temp_dir().join(format!("brausa-web-{}", token()));
        fs::create_dir_all(tmp.join("sub")).unwrap();
        fs::write(tmp.join("index.html"), "<h1>Hi</h1>").unwrap();
        fs::write(tmp.join("sub/a b.css"), "h1{}").unwrap();
        let root = tmp.canonicalize().unwrap();
        assert_eq!(resolve(&root, ""), Some(root.join("index.html")));
        assert_eq!(resolve(&root, "sub/a%20b.css?v=1"), Some(root.join("sub/a b.css")));
        assert_eq!(resolve(&root, "../etc/passwd"), None);
        assert_eq!(resolve(&root, "sub/../../x"), None);
        assert_eq!(resolve(&root, "nope.html"), None);

        let web = Web::default();
        let base = web.serve(&tmp, false).unwrap();
        assert_eq!(web.serve(&tmp, false).unwrap(), base, "same site, same address");
        assert_ne!(web.serve(&tmp, true).unwrap(), base, "scripts allowed is another address");
        let key = base.trim_end_matches('/').rsplit('/').next().unwrap().to_string();
        let r = respond(&web.sites, &format!("/{key}/index.html"));
        assert_eq!(r.status_code().0, 200);
        assert!(r.headers().iter().any(|h| h.field.equiv("Content-Security-Policy")));
        assert_eq!(respond(&web.sites, "/wrong/index.html").status_code().0, 404);
        let _ = fs::remove_dir_all(tmp);
    }

    #[test]
    fn names_downloads_safely() {
        assert_eq!(safe_name("a/b:c?.pdf"), "a_b_c_.pdf");
        assert_eq!(safe_name("..."), "download");
        assert!(allowed(&Url::parse("https://example.org").unwrap()));
        assert!(!allowed(&Url::parse("file:///etc/passwd").unwrap()));
    }
}
