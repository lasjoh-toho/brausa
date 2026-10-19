mod archive;
mod fsops;
mod library;
mod maps;
mod tw;
mod media;
mod meta;
mod projects;
mod web;

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

/// Projects: named collections of files and folders from anywhere.
struct Projs(Mutex<projects::Projects>);

/// TiddlyWiki bags and recipes (serialised: one sync at a time).
struct Wikis(Mutex<tw::Store>);

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
    if let Some((archive, inner)) = archive::split(&path) {
        return archive::list(&archive, &inner).map_err(err);
    }
    // Folders tagged with brausa ≤ 0.2 still carry per-folder sidecars: fold them into the index.
    state.0.lock().map_err(err)?.migrate_dir(Path::new(&path)).map_err(err)?;
    decorated(&state, fsops::list_dir(Path::new(&path), include_hidden).map_err(err)?)
}

#[tauri::command]
async fn walk(state: State<'_, Index>, root: String, max_depth: usize, include_hidden: bool, limit: usize) -> CmdResult<Vec<Entry>> {
    if let Some((archive, inner)) = archive::split(&root) {
        return archive::walk(&archive, &inner, limit).map_err(err);
    }
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
async fn transfer(app: AppHandle, state: State<'_, Index>, projs: State<'_, Projs>, paths: Vec<String>, target_dir: String, mode: String) -> CmdResult<TransferResult> {
    let mode = match mode.as_str() {
        "move" => Mode::Move,
        "copy" => Mode::Copy,
        m => return Err(format!("Unbekannter Modus: {m}")),
    };
    // Into an archive means packing a copy; the originals stay where they are.
    if let Some((arch, dir)) = archive::split(&target_dir) {
        let sources = paths.iter().map(|p| real_path(&app, p)).collect::<CmdResult<Vec<_>>>()?;
        let added = archive::add(&arch, &dir, &sources, &|old| retire(&app, old)).map_err(err)?;
        return Ok(TransferResult { moved: paths.into_iter().zip(added).collect(), errors: vec![] });
    }
    // Out of an archive means unpacking: the archive itself stays unchanged.
    let (inside, paths): (Vec<String>, Vec<String>) = paths.into_iter().partition(|p| archive::split(p).is_some());
    let mut res = fsops::transfer(&paths, Path::new(&target_dir), mode);
    for p in inside {
        match archive::extract_to(&p, Path::new(&target_dir)) {
            Ok(to) => {
                res.moved.insert(p, to.to_string_lossy().to_string());
            }
            Err(e) => res.errors.push(fsops::TransferError { path: p, message: e.to_string() }),
        }
    }
    // Metadata follows the files inside the index (also across projects).
    let mut reg = state.0.lock().map_err(err)?;
    for (from, to) in &res.moved {
        let (from, to) = (Path::new(from), Path::new(to));
        let r = if mode == Mode::Move { reg.moved(from, to) } else { reg.copied(from, to) };
        r.map_err(err)?;
        if mode == Mode::Move {
            projs.0.lock().map_err(err)?.moved(from, to).map_err(err)?;
        }
    }
    Ok(res)
}

#[tauri::command]
async fn update_meta(state: State<'_, Index>, paths: Vec<String>, patch: MetaPatch) -> CmdResult<Vec<Entry>> {
    paths.iter().try_for_each(|p| read_only(p))?;
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
fn project_root(state: &State<'_, Index>, projs: &State<'_, Projs>, root: &str) -> CmdResult<PathBuf> {
    let known = state.0.lock().map_err(err)?.infos().iter().any(|i| i.root.as_deref() == Some(root))
        || projs.0.lock().map_err(err)?.is_root(Path::new(root));
    if known {
        Ok(PathBuf::from(root))
    } else {
        Err(format!("„{root}“ ist kein Projekt"))
    }
}

#[tauri::command]
async fn list_maps(state: State<'_, Index>, projs: State<'_, Projs>, root: String) -> CmdResult<Vec<maps::MapInfo>> {
    Ok(maps::list(&project_root(&state, &projs, &root)?))
}

#[tauri::command]
async fn load_map(state: State<'_, Index>, projs: State<'_, Projs>, root: String, id: String) -> CmdResult<serde_json::Value> {
    maps::load(&project_root(&state, &projs, &root)?, &id).map_err(err)
}

/// Keep index records alive exactly as long as some map card or project points at them.
fn sync_refs(state: &State<'_, Index>, projs: &State<'_, Projs>) -> CmdResult<()> {
    let mut reg = state.0.lock().map_err(err)?;
    let ps = projs.0.lock().map_err(err)?;
    let mut roots: Vec<PathBuf> = reg.infos().into_iter().filter_map(|i| i.root.map(PathBuf::from)).collect();
    for r in ps.roots() {
        if !roots.contains(&r) {
            roots.push(r);
        }
    }
    let mut counts = maps::ref_counts(roots.iter().map(PathBuf::as_path));
    for id in ps.member_ids() {
        *counts.entry(id.clone()).or_insert(0) += 1;
    }
    reg.set_refs(&counts).map_err(err)
}

#[tauri::command]
async fn save_map(state: State<'_, Index>, projs: State<'_, Projs>, root: String, map: serde_json::Value) -> CmdResult<()> {
    maps::save(&project_root(&state, &projs, &root)?, &map).map_err(err)?;
    sync_refs(&state, &projs)
}

#[tauri::command]
async fn delete_map(state: State<'_, Index>, projs: State<'_, Projs>, root: String, id: String) -> CmdResult<()> {
    maps::delete(&project_root(&state, &projs, &root)?, &id).map_err(err)?;
    sync_refs(&state, &projs)
}

#[derive(Serialize)]
struct FileLink {
    path: String,
    id: String,
}

/// Stable ids for files placed on a map; they follow the file when it moves.
#[tauri::command]
async fn link_files(state: State<'_, Index>, paths: Vec<String>) -> CmdResult<Vec<FileLink>> {
    let mut reg = state.0.lock().map_err(err)?;
    paths.into_iter().map(|path| Ok(FileLink { id: reg.link(Path::new(&path)).map_err(err)?, path })).collect()
}

/// Current paths for file ids (null = missing).
#[tauri::command]
async fn locate_files(state: State<'_, Index>, ids: Vec<String>) -> CmdResult<std::collections::HashMap<String, Option<String>>> {
    let reg = state.0.lock().map_err(err)?;
    Ok(ids.into_iter().map(|id| {
        let p = reg.locate(&id).map(|p| p.to_string_lossy().to_string());
        (id, p)
    }).collect())
}

#[tauri::command]
async fn projects(projs: State<'_, Projs>) -> CmdResult<Vec<projects::ProjectInfo>> {
    Ok(projs.0.lock().map_err(err)?.infos())
}

#[tauri::command]
async fn create_project(projs: State<'_, Projs>, name: String) -> CmdResult<projects::Project> {
    projs.0.lock().map_err(err)?.create(&name).map_err(err)
}

#[tauri::command]
async fn update_project(projs: State<'_, Projs>, id: String, name: Option<String>, color: Option<Option<String>>) -> CmdResult<()> {
    projs.0.lock().map_err(err)?.update(&id, name.as_deref(), color).map_err(err)
}

#[tauri::command]
async fn delete_project(state: State<'_, Index>, projs: State<'_, Projs>, id: String) -> CmdResult<()> {
    projs.0.lock().map_err(err)?.delete(&id).map_err(err)?;
    sync_refs(&state, &projs)
}

/// Adds files (by stable index id, so they follow moves) and folders (live) to a project.
#[tauri::command]
async fn project_add(state: State<'_, Index>, projs: State<'_, Projs>, id: String, paths: Vec<String>) -> CmdResult<usize> {
    let (mut files, mut folders) = (vec![], vec![]);
    {
        let mut reg = state.0.lock().map_err(err)?;
        for p in &paths {
            if Path::new(p).is_dir() {
                folders.push(p.clone());
            } else {
                files.push(reg.link(Path::new(p)).map_err(err)?);
            }
        }
    }
    let n = projs.0.lock().map_err(err)?.add(&id, files, folders).map_err(err)?;
    sync_refs(&state, &projs)?;
    Ok(n)
}

/// Takes files and folders out of a project (the files themselves stay where they are).
#[tauri::command]
async fn project_remove(state: State<'_, Index>, projs: State<'_, Projs>, id: String, paths: Vec<String>) -> CmdResult<usize> {
    let file_ids: Vec<String> = {
        let reg = state.0.lock().map_err(err)?;
        paths.iter().filter_map(|p| reg.get(Path::new(p)).map(|r| r.id.clone())).collect()
    };
    let n = projs.0.lock().map_err(err)?.remove(&id, &file_ids, &paths).map_err(err)?;
    sync_refs(&state, &projs)?;
    Ok(n)
}

/// Everything in a project: its single files (where they are now) and the content of its folders.
#[tauri::command]
async fn project_entries(state: State<'_, Index>, projs: State<'_, Projs>, id: String) -> CmdResult<Vec<Entry>> {
    let p = projs.0.lock().map_err(err)?.get(&id).map_err(err)?.clone();
    let mut out: Vec<Entry> = vec![];
    {
        let reg = state.0.lock().map_err(err)?;
        for f in &p.files {
            if let Some(e) = reg.locate(f).and_then(|path| fsops::make_entry(&path).ok()) {
                out.push(e);
            }
        }
    }
    for d in &p.folders {
        out.extend(fsops::walk(Path::new(d), 12, false, 20_000));
    }
    let mut seen = std::collections::HashSet::new();
    out.retain(|e| seen.insert(e.path.clone()));
    decorated(&state, out)
}

#[tauri::command]
async fn web_open(app: AppHandle, web: State<'_, web::Web>, url: String, bounds: web::Bounds) -> CmdResult<()> {
    web.open(&app, &url, bounds)
}

#[tauri::command]
async fn web_place(app: AppHandle, web: State<'_, web::Web>, bounds: web::Bounds, visible: bool) -> CmdResult<()> {
    web.place(&app, bounds, visible)
}

#[tauri::command]
async fn web_close(app: AppHandle, web: State<'_, web::Web>) -> CmdResult<()> {
    web.close(&app)
}

/// Back, forward, reload: run in the page itself.
#[tauri::command]
async fn web_go(app: AppHandle, web: State<'_, web::Web>, how: String) -> CmdResult<()> {
    let js = match how.as_str() {
        "back" => "history.back()",
        "forward" => "history.forward()",
        "reload" => "location.reload()",
        _ => return Err(format!("Unbekannt: {how}")),
    };
    web.eval(&app, js).map(|_| ())
}

/// Text marked in the page, with its address and title (for snippets on the map).
#[tauri::command]
async fn web_selection(app: AppHandle, web: State<'_, web::Web>) -> CmdResult<serde_json::Value> {
    let raw = web.eval(&app, "JSON.stringify({text: String(getSelection()), url: location.href, title: document.title})")?;
    let inner: String = serde_json::from_str(&raw).map_err(err)?;
    serde_json::from_str(&inner).map_err(err)
}

#[tauri::command]
async fn web_save_page(app: AppHandle, web: State<'_, web::Web>, dir: String) -> CmdResult<String> {
    web.save_page(&app, Path::new(&dir)).map(|p| p.to_string_lossy().to_string())
}

/// Where downloads from the web panel go (null: the system's Downloads folder).
#[tauri::command]
async fn web_target(web: State<'_, web::Web>, dir: Option<String>) -> CmdResult<()> {
    *web.target.lock().map_err(err)? = dir.map(PathBuf::from);
    Ok(())
}

/// Serves a local folder as a website (only on this computer); returns its address.
#[tauri::command]
async fn web_serve(web: State<'_, web::Web>, root: String, scripts: bool) -> CmdResult<String> {
    web.serve(Path::new(&root), scripts)
}

#[tauri::command]
async fn tw_bags(w: State<'_, Wikis>) -> CmdResult<Vec<tw::BagInfo>> {
    Ok(w.0.lock().map_err(err)?.bags())
}

#[tauri::command]
async fn tw_put_bag(w: State<'_, Wikis>, bag: tw::BagInfo) -> CmdResult<()> {
    w.0.lock().map_err(err)?.put_bag(&bag).map_err(err)
}

#[tauri::command]
async fn tw_delete_bag(w: State<'_, Wikis>, name: String) -> CmdResult<()> {
    w.0.lock().map_err(err)?.delete_bag(&name).map_err(err)
}

#[tauri::command]
async fn tw_recipes(w: State<'_, Wikis>) -> CmdResult<Vec<tw::Recipe>> {
    Ok(w.0.lock().map_err(err)?.recipes())
}

#[tauri::command]
async fn tw_put_recipe(w: State<'_, Wikis>, recipe: tw::Recipe) -> CmdResult<tw::Recipe> {
    w.0.lock().map_err(err)?.put_recipe(recipe).map_err(err)
}

#[tauri::command]
async fn tw_delete_recipe(w: State<'_, Wikis>, name: String) -> CmdResult<()> {
    w.0.lock().map_err(err)?.delete_recipe(&name).map_err(err)
}

#[tauri::command]
async fn tw_overlays(w: State<'_, Wikis>) -> CmdResult<Vec<tw::Overlay>> {
    w.0.lock().map_err(err)?.overlays().map_err(err)
}

#[tauri::command]
async fn tw_resolve_overlay(w: State<'_, Wikis>, title: String, bag: String, how: tw::Resolve) -> CmdResult<()> {
    w.0.lock().map_err(err)?.resolve_overlay(&title, &bag, how).map_err(err)
}

/// Name and version of the plugins brausa puts into its wikis.
#[tauri::command]
fn tw_plugins() -> Vec<(String, String)> {
    tw::bundled_plugins()
}

/// Two-way sync of one wiki; maps changed from the wiki are refreshed in the index too.
#[tauri::command]
async fn tw_sync(state: State<'_, Index>, projs: State<'_, Projs>, w: State<'_, Wikis>, name: String) -> CmdResult<tw::SyncReport> {
    let rep = w.0.lock().map_err(err)?.sync(&name).map_err(err)?;
    if !rep.maps.is_empty() {
        sync_refs(&state, &projs)?;
    }
    Ok(rep)
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

/// Files inside archives are unpacked here when they need to be real files.
fn archive_cache(app: &AppHandle) -> CmdResult<PathBuf> {
    Ok(app.path().app_cache_dir().map_err(err)?.join("archives"))
}

/// The real file for a path: itself, or for a file inside an archive its unpacked copy.
fn real_path(app: &AppHandle, path: &str) -> CmdResult<PathBuf> {
    if archive::split(path).is_some() {
        archive::materialize(path, &archive_cache(app)?).map_err(err)
    } else {
        Ok(PathBuf::from(path))
    }
}

fn read_only(path: &str) -> CmdResult<()> {
    if archive::split(path).is_some() {
        Err("Archive kann brausa nur lesen. Zum Ändern die Dateien herausziehen.".into())
    } else {
        Ok(())
    }
}

/// Before brausa changes an archive, a copy of the old version goes to the trash.
fn retire(app: &AppHandle, old: &Path) -> std::io::Result<()> {
    let dir = app.path().app_cache_dir().map_err(std::io::Error::other)?.join("retired").join(format!("{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos()));
    std::fs::create_dir_all(&dir)?;
    let copy = dir.join(old.file_name().unwrap_or_default());
    std::fs::copy(old, &copy)?;
    let r = ::trash::delete(&copy).map_err(|e| std::io::Error::other(format!("Sicherung in den Papierkorb fehlgeschlagen: {e}")));
    let _ = std::fs::remove_dir_all(&dir);
    r
}

/// Packs files and folders into a new ZIP next to the first one; returns its path.
#[tauri::command]
async fn compress(app: AppHandle, paths: Vec<String>) -> CmdResult<String> {
    let first = paths.first().ok_or("Nichts ausgewählt")?;
    let dir = match archive::split(first) {
        Some((a, _)) => a.parent().map(Path::to_path_buf).ok_or("Kein Ordner")?,
        None => Path::new(first).parent().map(Path::to_path_buf).ok_or("Kein Ordner")?,
    };
    tauri::async_runtime::spawn_blocking(move || {
        let sources = paths.iter().map(|p| real_path(&app, p)).collect::<CmdResult<Vec<_>>>()?;
        archive::compress(&sources, &dir).map_err(err)
    })
    .await
    .map_err(err)?
    .map(|p| p.to_string_lossy().to_string())
}

/// Names in an archive folder that dropping `names` there would replace.
#[tauri::command]
async fn archive_conflicts(dir: String, names: Vec<String>) -> CmdResult<Vec<String>> {
    let (a, inner) = archive::split(&dir).ok_or("Kein Archiv")?;
    archive::conflicts(&a, &inner, &names).map_err(err)
}

/// Unpacks a file from an archive (cached) and returns the real path, for the preview and reader.
#[tauri::command]
async fn archive_extract(app: AppHandle, path: String) -> CmdResult<String> {
    tauri::async_runtime::spawn_blocking(move || real_path(&app, &path)).await.map_err(err)?.map(|p| p.to_string_lossy().to_string())
}

fn thumb_cache(app: &AppHandle) -> CmdResult<PathBuf> {
    Ok(app.path().app_cache_dir().map_err(err)?.join("thumbs"))
}

/// Path of a cached thumbnail; the UI turns it into an asset URL.
#[tauri::command]
async fn thumbnail(app: AppHandle, path: String, size: u32) -> CmdResult<String> {
    let cache = thumb_cache(&app)?;
    // Decoding is CPU-bound: keep it off the async workers.
    tauri::async_runtime::spawn_blocking(move || media::thumbnail(&real_path(&app, &path)?, size.clamp(64, 2048), &cache))
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
async fn rename(state: State<'_, Index>, projs: State<'_, Projs>, path: String, new_name: String) -> CmdResult<Entry> {
    read_only(&path)?;
    let dest = fsops::rename(Path::new(&path), &new_name)?;
    state.0.lock().map_err(err)?.moved(Path::new(&path), &dest).map_err(err)?;
    projs.0.lock().map_err(err)?.moved(Path::new(&path), &dest).map_err(err)?;
    let e = fsops::make_entry(&dest).map_err(err)?;
    Ok(decorated(&state, vec![e])?.remove(0))
}

#[tauri::command]
async fn trash(app: AppHandle, state: State<'_, Index>, paths: Vec<String>) -> CmdResult<TransferResult> {
    // Inside an archive: rewrite each archive once without those entries.
    let (inside, paths): (Vec<String>, Vec<String>) = paths.into_iter().partition(|p| archive::split(p).is_some());
    let mut by_archive: std::collections::BTreeMap<PathBuf, Vec<String>> = Default::default();
    for p in &inside {
        let (a, i) = archive::split(p).unwrap();
        by_archive.entry(a).or_default().push(i);
    }
    let mut res = fsops::trash(&paths);
    for (a, inners) in by_archive {
        let r = if inners.iter().any(String::is_empty) {
            Err("Das ganze Archiv bitte von außen löschen".to_string())
        } else {
            archive::remove(&a, &inners, &|old| retire(&app, old)).map_err(err)
        };
        for i in inners {
            let p = archive::join(&a, &i);
            match &r {
                Ok(()) => {
                    res.moved.insert(p, String::new());
                }
                Err(e) => res.errors.push(fsops::TransferError { path: p, message: e.clone() }),
            }
        }
    }
    let mut reg = state.0.lock().map_err(err)?;
    for p in res.moved.keys() {
        reg.trashed(Path::new(p)).map_err(err)?;
    }
    Ok(res)
}

/// Open with the operating system's default application.
#[tauri::command]
fn open_default(app: AppHandle, path: String) -> CmdResult<()> {
    let real = real_path(&app, &path)?;
    app.opener().open_path(real.to_string_lossy(), None::<&str>).map_err(err)
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
        .manage(web::Web::default())
        .setup(|app| {
            // The main window holds two webviews (brausa and the web panel), so it is
            // built here: a plain window plus brausa's webview filling it.
            let window = tauri::window::WindowBuilder::new(app, "main")
                .title("brausa")
                .inner_size(1360.0, 860.0)
                .min_inner_size(800.0, 500.0);
            #[cfg(target_os = "macos")]
            let window = window.title_bar_style(tauri::TitleBarStyle::Overlay).hidden_title(true);
            let window = window.build()?;
            let size = window.inner_size()?.to_logical::<f64>(window.scale_factor()?);
            window.add_child(
                tauri::webview::WebviewBuilder::new("main", tauri::WebviewUrl::App("index.html".into())).auto_resize(),
                tauri::LogicalPosition::new(0.0, 0.0),
                size,
            )?;
            #[cfg(target_os = "linux")]
            web::prepare_window(&window)?;
            let dir = app.path().app_data_dir()?;
            let reg = Registry::open(&dir)?;
            // Folders that were projects before projects became free collections.
            let legacy = || reg.infos().into_iter().filter_map(|i| Some((i.name, i.root?))).collect();
            app.manage(Projs(Mutex::new(projects::Projects::open(&dir, legacy)?)));
            app.manage(Index(Mutex::new(reg)));
            app.manage(Wikis(Mutex::new(tw::Store::open(&dir)?)));
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
            delete_map,
            link_files,
            locate_files,
            projects,
            create_project,
            update_project,
            delete_project,
            project_add,
            project_remove,
            project_entries,
            archive_extract,
            archive_conflicts,
            compress,
            web_open,
            web_place,
            web_close,
            web_go,
            web_selection,
            web_save_page,
            web_target,
            web_serve,
            tw_bags,
            tw_put_bag,
            tw_delete_bag,
            tw_recipes,
            tw_put_recipe,
            tw_delete_recipe,
            tw_sync,
            tw_overlays,
            tw_resolve_overlay,
            tw_plugins
        ])
        .run(tauri::generate_context!())
        .expect("error while running brausa");
}
