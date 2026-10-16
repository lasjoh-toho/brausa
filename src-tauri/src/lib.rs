mod fsops;
mod meta;

use fsops::{Entry, Mode, TransferResult};
use meta::MetaPatch;
use serde::Serialize;
use std::path::{Path, PathBuf};

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![home_dir, places, list_dir, walk, transfer, update_meta, folder_meta, mkdir])
        .run(tauri::generate_context!())
        .expect("error while running brausa");
}
