//! Projects: named collections that are independent of folders. A project
//! gathers single files from anywhere (by index id, so they follow moves) and
//! whole folders (live: everything in them belongs to the project).
//!
//! Kept in `<app_data>/projects.json`. A project's maps live in
//! `<app_data>/projects/<id>/.brausa/maps/`, or for projects taken over from an
//! indexed folder (brausa ≤ 0.5) still in `<folder>/.brausa/maps/` (`home`).

use serde::{Deserialize, Serialize};
use std::{
    fs, io,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Project {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub color: Option<String>,
    /// Index ids of single files (see `Registry::link`).
    #[serde(default)]
    pub files: Vec<String>,
    /// Folders whose whole content belongs to the project.
    #[serde(default)]
    pub folders: Vec<String>,
    /// Folder holding the maps, for projects that used to be a folder.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub home: Option<String>,
}

/// What the UI gets: the project plus where its maps are (`root`).
#[derive(Debug, Serialize)]
pub struct ProjectInfo {
    #[serde(flatten)]
    pub project: Project,
    pub root: String,
}

#[derive(Serialize, Deserialize, Default)]
struct ProjectsFile {
    projects: Vec<Project>,
}

pub struct Projects {
    file: PathBuf,
    dir: PathBuf,
    pub list: Vec<Project>,
}

fn new_id() -> String {
    let t = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    format!("p_{:x}", t)
}

fn bad(msg: String) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, msg)
}

impl Projects {
    /// Opens the project list; on first start, folders that were projects become projects with that folder.
    pub fn open(app_dir: &Path, legacy: impl FnOnce() -> Vec<(String, String)>) -> io::Result<Projects> {
        let file = app_dir.join("projects.json");
        let dir = app_dir.join("projects");
        let list = match fs::read(&file) {
            Ok(b) => serde_json::from_slice::<ProjectsFile>(&b).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?.projects,
            Err(e) if e.kind() == io::ErrorKind::NotFound => legacy()
                .into_iter()
                .enumerate()
                .map(|(i, (name, root))| Project {
                    id: format!("{}_{i}", new_id()),
                    name,
                    color: None,
                    files: vec![],
                    folders: vec![root.clone()],
                    home: Some(root),
                })
                .collect(),
            Err(e) => return Err(e),
        };
        let mut p = Projects { file, dir, list };
        p.save()?;
        Ok(p)
    }

    pub fn save(&mut self) -> io::Result<()> {
        if let Some(d) = self.file.parent() {
            fs::create_dir_all(d)?;
        }
        let tmp = self.file.with_extension("json.tmp");
        fs::write(&tmp, serde_json::to_vec_pretty(&ProjectsFile { projects: self.list.clone() })?)?;
        fs::rename(tmp, &self.file)
    }

    /// Where the maps of a project live.
    pub fn root(&self, p: &Project) -> PathBuf {
        p.home.as_ref().map(PathBuf::from).unwrap_or_else(|| self.dir.join(&p.id))
    }

    pub fn infos(&self) -> Vec<ProjectInfo> {
        let mut out: Vec<ProjectInfo> = self
            .list
            .iter()
            .map(|p| ProjectInfo { project: p.clone(), root: self.root(p).to_string_lossy().to_string() })
            .collect();
        out.sort_by_key(|i| i.project.name.to_lowercase());
        out
    }

    /// Is this a place where some project keeps its maps?
    pub fn is_root(&self, root: &Path) -> bool {
        self.list.iter().any(|p| self.root(p) == root)
    }

    pub fn roots(&self) -> Vec<PathBuf> {
        self.list.iter().map(|p| self.root(p)).collect()
    }

    fn get_mut(&mut self, id: &str) -> io::Result<&mut Project> {
        self.list.iter_mut().find(|p| p.id == id).ok_or_else(|| bad(format!("Projekt „{id}“ gibt es nicht")))
    }

    pub fn get(&self, id: &str) -> io::Result<&Project> {
        self.list.iter().find(|p| p.id == id).ok_or_else(|| bad(format!("Projekt „{id}“ gibt es nicht")))
    }

    pub fn create(&mut self, name: &str) -> io::Result<Project> {
        let name = name.trim();
        if name.is_empty() {
            return Err(bad("Der Projektname fehlt".into()));
        }
        let p = Project { id: new_id(), name: name.into(), color: None, files: vec![], folders: vec![], home: None };
        fs::create_dir_all(self.root(&p))?;
        self.list.push(p.clone());
        self.save()?;
        Ok(p)
    }

    pub fn update(&mut self, id: &str, name: Option<&str>, color: Option<Option<String>>) -> io::Result<()> {
        let p = self.get_mut(id)?;
        if let Some(n) = name.map(str::trim) {
            if n.is_empty() {
                return Err(bad("Der Projektname fehlt".into()));
            }
            p.name = n.into();
        }
        if let Some(c) = color {
            p.color = c;
        }
        self.save()
    }

    /// Removes the project. Its own maps go with it; the member files are not touched.
    pub fn delete(&mut self, id: &str) -> io::Result<()> {
        let p = self.get(id)?.clone();
        self.list.retain(|x| x.id != id);
        self.save()?;
        if p.home.is_none() {
            let _ = fs::remove_dir_all(self.root(&p));
        }
        Ok(())
    }

    /// Adds single files (by index id) and folders; returns how many were new.
    pub fn add(&mut self, id: &str, file_ids: Vec<String>, folders: Vec<String>) -> io::Result<usize> {
        let p = self.get_mut(id)?;
        let before = p.files.len() + p.folders.len();
        for f in file_ids {
            if !p.files.contains(&f) {
                p.files.push(f);
            }
        }
        for d in folders {
            if !p.folders.contains(&d) {
                p.folders.push(d);
            }
        }
        let n = p.files.len() + p.folders.len() - before;
        self.save()?;
        Ok(n)
    }

    /// Takes files (by index id) and folders out of the project; returns how many were members.
    pub fn remove(&mut self, id: &str, file_ids: &[String], folders: &[String]) -> io::Result<usize> {
        let p = self.get_mut(id)?;
        let before = p.files.len() + p.folders.len();
        p.files.retain(|f| !file_ids.contains(f));
        p.folders.retain(|d| !folders.contains(d));
        let n = before - p.files.len() - p.folders.len();
        self.save()?;
        Ok(n)
    }

    /// Every file id some project holds, so the index keeps those records.
    pub fn member_ids(&self) -> impl Iterator<Item = &String> {
        self.list.iter().flat_map(|p| p.files.iter())
    }

    /// A folder was renamed or moved: projects that hold it (or something inside) follow.
    pub fn moved(&mut self, from: &Path, to: &Path) -> io::Result<()> {
        let mut changed = false;
        for p in &mut self.list {
            for d in p.folders.iter_mut().chain(p.home.iter_mut()) {
                if let Ok(rest) = Path::new(d.as_str()).strip_prefix(from) {
                    let dest = if rest.as_os_str().is_empty() { to.to_path_buf() } else { to.join(rest) };
                    *d = dest.to_string_lossy().to_string();
                    changed = true;
                }
            }
        }
        if changed {
            self.save()?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn projects_are_free_collections() {
        let tmp = std::env::temp_dir().join(format!("brausa-projects-{}", new_id()));
        // Former folder projects are taken over with their folder.
        let mut ps = Projects::open(&tmp, || vec![("Alt".into(), "/data/alt".into())]).unwrap();
        assert_eq!(ps.list[0].folders, vec!["/data/alt".to_string()]);
        assert_eq!(ps.root(&ps.list[0]), PathBuf::from("/data/alt"));

        let p = ps.create("Reise 2026").unwrap();
        assert!(ps.root(&p).starts_with(&tmp));
        assert_eq!(ps.add(&p.id, vec!["f1".into(), "f2".into()], vec!["/fotos".into()]).unwrap(), 3);
        assert_eq!(ps.add(&p.id, vec!["f1".into()], vec![]).unwrap(), 0);
        assert_eq!(ps.remove(&p.id, &["f2".into()], &[]).unwrap(), 1);
        ps.moved(Path::new("/fotos"), Path::new("/bilder/fotos")).unwrap();

        // Reopened: the list file wins over the legacy folders.
        let ps2 = Projects::open(&tmp, || panic!("no migration twice")).unwrap();
        let q = ps2.get(&p.id).unwrap();
        assert_eq!(q.files, vec!["f1".to_string()]);
        assert_eq!(q.folders, vec!["/bilder/fotos".to_string()]);
        assert!(ps2.member_ids().any(|f| f == "f1"));

        let mut ps2 = ps2;
        ps2.delete(&p.id).unwrap();
        assert!(ps2.get(&p.id).is_err());
        let _ = fs::remove_dir_all(tmp);
    }
}
