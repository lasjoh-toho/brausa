mod fsops;
mod media;
mod meta;

use fsops::{Entry, Mode, TransferResult};
use media::MediaInfo;
use meta::MetaPatch;
use notify_debouncer_mini::{new_debouncer, notify::RecursiveMode, DebouncedEvent, Debouncer};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_opener::OpenerExt;

/// The folder currently shown in the UI is watched; changes are pushed as `fs-change` events.
#[derive(Default)]
struct Watcher(Mutex<Option<Debouncer<notify_debouncer_mini::notify::RecommendedWatcher>>>);

type CmdResult<T> = Result<T, String>;

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

#[derive(Serialize)]
struct Place {
    name: String,
    path: String,
}

#[derive(Serialize)]
struct FolderMeta {
    tags: Vec<String>,
    color: Option<String>,
}

#[tauri::command]
fn home_dir() -> CmdResult<String> {
    dirs::home_dir().map(|p| p.to_string_lossy().to_string()).ok_or_else(|| "Kein Home-Verzeichnis".into())
}

#[tauri::command]
fn places() -> Vec<Place> {
    fsops::places()
        .into_iter()
        .map(|(name, p)| Place { name, path: p.to_string_lossy().to_string() })
        .collect()
}

// File-system commands run on the async pool so large folders don't block the UI thread.

#[tauri::command]
async fn list_dir(path: String, include_hidden: bool) -> CmdResult<Vec<Entry>> {
    fsops::list_dir(Path::new(&path), include_hidden).map_err(err)
}

#[tauri::command]
async fn walk(root: String, max_depth: usize, include_hidden: bool, limit: usize) -> Vec<Entry> {
    fsops::walk(Path::new(&root), max_depth, include_hidden, limit)
}

#[tauri::command]
async fn transfer(paths: Vec<String>, target_dir: String, mode: String) -> CmdResult<TransferResult> {
    let mode = match mode.as_str() {
        "move" => Mode::Move,
        "copy" => Mode::Copy,
        m => return Err(format!("Unbekannter Modus: {m}")),
    };
    Ok(fsops::transfer(&paths, Path::new(&target_dir), mode))
}

#[tauri::command]
async fn update_meta(paths: Vec<String>, patch: MetaPatch) -> CmdResult<Vec<Entry>> {
    let mut out = Vec::with_capacity(paths.len());
    for p in &paths {
        let path = PathBuf::from(p);
        let mut sc = meta::read_sidecar(&path);
        meta::apply_patch(&mut sc, &patch);
        meta::write_sidecar(&path, &sc).map_err(err)?;
        out.push(fsops::make_entry(&path, Some(&sc)).map_err(err)?);
    }
    Ok(out)
}

#[tauri::command]
async fn folder_meta(path: String) -> FolderMeta {
    let sc = meta::read_sidecar(Path::new(&path));
    FolderMeta { tags: sc.tags, color: sc.color }
}

#[tauri::command]
async fn mkdir(parent: String, name: String) -> CmdResult<String> {
    if name.contains(['/', '\\']) || name.trim().is_empty() {
        return Err("Ungültiger Ordnername".into());
    }
    let p = fsops::unique_dest(Path::new(&parent), name.trim());
    std::fs::create_dir(&p).map_err(err)?;
    Ok(p.to_string_lossy().to_string())
}

fn thumb_cache(app: &AppHandle) -> CmdResult<PathBuf> {
    Ok(app.path().app_cache_dir().map_err(err)?.join("thumbs"))
}

/// Path of a cached thumbnail; the UI turns it into an asset URL.
#[tauri::command]
async fn thumbnail(app: AppHandle, path: String, size: u32) -> CmdResult<String> {
    let cache = thumb_cache(&app)?;
    // Decoding is CPU-bound: keep it off the async workers.
    tauri::async_runtime::spawn_blocking(move || media::thumbnail(Path::new(&path), size.clamp(64, 2048), &cache))
        .await
        .map_err(err)?
        .map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
async fn media_info(paths: Vec<String>) -> CmdResult<Vec<MediaInfo>> {
    tauri::async_runtime::spawn_blocking(move || paths.iter().map(|p| media::media_info(Path::new(p))).collect())
        .await
        .map_err(err)
}

#[tauri::command]
async fn rename(path: String, new_name: String) -> CmdResult<Entry> {
    let dest = fsops::rename(Path::new(&path), &new_name)?;
    fsops::make_entry(&dest, None).map_err(err)
}

#[tauri::command]
async fn trash(paths: Vec<String>) -> TransferResult {
    fsops::trash(&paths)
}

/// Open with the operating system's default application.
#[tauri::command]
fn open_default(app: AppHandle, path: String) -> CmdResult<()> {
    app.opener().open_path(path, None::<&str>).map_err(err)
}

/// Show the item in Finder / Explorer / the desktop file manager.
#[tauri::command]
fn reveal(app: AppHandle, path: String) -> CmdResult<()> {
    app.opener().reveal_item_in_dir(path).map_err(err)
}

#[derive(Clone, Serialize)]
struct FsChange {
    paths: Vec<String>,
}

#[tauri::command]
fn watch(app: AppHandle, state: State<'_, Watcher>, path: String, recursive: bool) -> CmdResult<()> {
    let mut guard = state.0.lock().map_err(err)?;
    *guard = None; // drop the previous watcher first
    let emitter = app.clone();
    let mut deb = new_debouncer(Duration::from_millis(300), move |res: Result<Vec<DebouncedEvent>, _>| {
        let Ok(events) = res else { return };
        let paths: Vec<String> = events
            .into_iter()
            .map(|e| e.path.to_string_lossy().to_string())
            // Our own sidecar writes would otherwise cause refresh loops.
            .filter(|p| !p.contains(meta::SIDECAR_DIR))
            .collect();
        if !paths.is_empty() {
            let _ = emitter.emit("fs-change", FsChange { paths });
        }
    })
    .map_err(err)?;
    let mode = if recursive { RecursiveMode::Recursive } else { RecursiveMode::NonRecursive };
    deb.watcher().watch(Path::new(&path), mode).map_err(err)?;
    *guard = Some(deb);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(Watcher::default())
        .invoke_handler(tauri::generate_handler![
            home_dir,
            places,
            list_dir,
            walk,
            transfer,
            update_meta,
            folder_meta,
            mkdir,
            thumbnail,
            media_info,
            rename,
            trash,
            watch,
            open_default,
            reveal
        ])
        .run(tauri::generate_context!())
        .expect("error while running brausa");
}
