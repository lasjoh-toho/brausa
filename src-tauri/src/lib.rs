mod fsops;
mod library;
mod maps;
mod media;
mod meta;

use fsops::{Entry, Mode, TransferResult};
use library::{LibraryInfo, Registry, Report};
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

/// Central metadata index (all projects + global store).
struct Index(Mutex<Registry>);

type CmdResult<T> = Result<T, String>;

fn decorated(state: &State<'_, Index>, mut entries: Vec<Entry>) -> CmdResult<Vec<Entry>> {
    let reg = state.0.lock().map_err(err)?;
    for e in &mut entries {
        fsops::decorate(e, reg.get(Path::new(&e.path)));
    }
    Ok(entries)
}

/// Run a reconcile in the background and tell the UI if anything was repaired.
fn reconcile_async(app: AppHandle, paths: Option<Vec<PathBuf>>) {
    std::thread::spawn(move || {
        let state = app.state::<Index>();
        let report: Report = {
            let Ok(mut reg) = state.0.lock() else { return };
            match &paths {
                Some(p) => reg.reconcile_for(p),
                None => reg.reconcile_all(),
            }
        };
        if !report.is_empty() {
            let _ = app.emit("index-report", report);
        }
    });
}

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
async fn list_dir(state: State<'_, Index>, path: String, include_hidden: bool) -> CmdResult<Vec<Entry>> {
    // Folders tagged with brausa ≤ 0.2 still carry per-folder sidecars: fold them into the index.
    state.0.lock().map_err(err)?.migrate_dir(Path::new(&path)).map_err(err)?;
    decorated(&state, fsops::list_dir(Path::new(&path), include_hidden).map_err(err)?)
}

#[tauri::command]
async fn walk(state: State<'_, Index>, root: String, max_depth: usize, include_hidden: bool, limit: usize) -> CmdResult<Vec<Entry>> {
    let entries = fsops::walk(Path::new(&root), max_depth, include_hidden, limit);
    {
        let mut reg = state.0.lock().map_err(err)?;
        let dirs: std::collections::BTreeSet<&Path> = entries.iter().filter_map(|e| Path::new(&e.path).parent()).collect();
        for d in dirs {
            reg.migrate_dir(d).map_err(err)?;
        }
    }
    decorated(&state, entries)
}

#[tauri::command]
async fn transfer(state: State<'_, Index>, paths: Vec<String>, target_dir: String, mode: String) -> CmdResult<TransferResult> {
    let mode = match mode.as_str() {
        "move" => Mode::Move,
        "copy" => Mode::Copy,
        m => return Err(format!("Unbekannter Modus: {m}")),
    };
    let res = fsops::transfer(&paths, Path::new(&target_dir), mode);
    // Metadata follows the files inside the index (also across projects).
    let mut reg = state.0.lock().map_err(err)?;
    for (from, to) in &res.moved {
        let (from, to) = (Path::new(from), Path::new(to));
        let r = if mode == Mode::Move { reg.moved(from, to) } else { reg.copied(from, to) };
        r.map_err(err)?;
    }
    Ok(res)
}

#[tauri::command]
async fn update_meta(state: State<'_, Index>, paths: Vec<String>, patch: MetaPatch) -> CmdResult<Vec<Entry>> {
    let mut out = Vec::with_capacity(paths.len());
    {
        let mut reg = state.0.lock().map_err(err)?;
        for p in &paths {
            reg.patch(Path::new(p), &patch).map_err(err)?;
        }
    }
    for p in &paths {
        out.push(fsops::make_entry(Path::new(p)).map_err(err)?);
    }
    decorated(&state, out)
}

#[tauri::command]
async fn folder_meta(state: State<'_, Index>, path: String) -> CmdResult<FolderMeta> {
    let reg = state.0.lock().map_err(err)?;
    let r = reg.get(Path::new(&path));
    Ok(FolderMeta { tags: r.map(|r| r.tags.clone()).unwrap_or_default(), color: r.and_then(|r| r.color.clone()) })
}

#[tauri::command]
async fn libraries(state: State<'_, Index>) -> CmdResult<Vec<LibraryInfo>> {
    Ok(state.0.lock().map_err(err)?.infos())
}

/// Include a folder as a project (creates `<folder>/.brausa/`).
#[tauri::command]
async fn add_library(app: AppHandle, state: State<'_, Index>, root: String, name: Option<String>) -> CmdResult<LibraryInfo> {
    let info = state.0.lock().map_err(err)?.add(Path::new(&root), name.as_deref()).map_err(err)?;
    reconcile_async(app, Some(vec![PathBuf::from(root)]));
    Ok(info)
}

#[tauri::command]
async fn remove_library(state: State<'_, Index>, root: String) -> CmdResult<()> {
    state.0.lock().map_err(err)?.remove(Path::new(&root)).map_err(err)
}

/// Maps may only be stored inside a registered project.
fn project_root(state: &State<'_, Index>, root: &str) -> CmdResult<PathBuf> {
    let reg = state.0.lock().map_err(err)?;
    if reg.infos().iter().any(|i| i.root.as_deref() == Some(root)) {
        Ok(PathBuf::from(root))
    } else {
        Err(format!("„{root}“ ist kein Projekt"))
    }
}

#[tauri::command]
async fn list_maps(state: State<'_, Index>, root: String) -> CmdResult<Vec<maps::MapInfo>> {
    Ok(maps::list(&project_root(&state, &root)?))
}

#[tauri::command]
async fn load_map(state: State<'_, Index>, root: String, id: String) -> CmdResult<serde_json::Value> {
    maps::load(&project_root(&state, &root)?, &id).map_err(err)
}

#[tauri::command]
async fn save_map(state: State<'_, Index>, root: String, map: serde_json::Value) -> CmdResult<()> {
    maps::save(&project_root(&state, &root)?, &map).map_err(err)
}

#[tauri::command]
async fn delete_map(state: State<'_, Index>, root: String, id: String) -> CmdResult<()> {
    maps::delete(&project_root(&state, &root)?, &id).map_err(err)
}

#[tauri::command]
fn reconcile(app: AppHandle) {
    reconcile_async(app, None);
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
async fn rename(state: State<'_, Index>, path: String, new_name: String) -> CmdResult<Entry> {
    let dest = fsops::rename(Path::new(&path), &new_name)?;
    state.0.lock().map_err(err)?.moved(Path::new(&path), &dest).map_err(err)?;
    let e = fsops::make_entry(&dest).map_err(err)?;
    Ok(decorated(&state, vec![e])?.remove(0))
}

#[tauri::command]
async fn trash(state: State<'_, Index>, paths: Vec<String>) -> CmdResult<TransferResult> {
    let res = fsops::trash(&paths);
    let mut reg = state.0.lock().map_err(err)?;
    for p in res.moved.keys() {
        reg.trashed(Path::new(p)).map_err(err)?;
    }
    Ok(res)
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
            // Files moved by other apps: let the index find them again.
            reconcile_async(emitter.clone(), Some(paths.iter().map(PathBuf::from).collect()));
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
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            app.manage(Index(Mutex::new(Registry::open(&dir)?)));
            // Repair on start, then every 10 minutes (catches changes outside the watched folder).
            let handle = app.handle().clone();
            std::thread::spawn(move || loop {
                reconcile_async(handle.clone(), None);
                std::thread::sleep(Duration::from_secs(600));
            });
            Ok(())
        })
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
            reveal,
            libraries,
            add_library,
            remove_library,
            reconcile,
            list_maps,
            load_map,
            save_map,
            delete_map
        ])
        .run(tauri::generate_context!())
        .expect("error while running brausa");
}
