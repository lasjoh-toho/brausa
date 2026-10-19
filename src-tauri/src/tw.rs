//! TiddlyWiki connection: bags, recipes and two-way sync with wikis.
//!
//! The model follows TiddlyWiki's MultiWikiServer: a *bag* is a named set of
//! tiddlers, a *recipe* an ordered list of bags that make up one wiki (later
//! bags win). brausa stores real bags as folders of `.tid` files in its app
//! data; a project map can be used as a bag too (its cards become tiddlers).
//! A recipe is synced with a target wiki that TiddlyDesktop-RS (or any other
//! TiddlyWiki setup) opens: a wiki folder or a single-file wiki.
//!
//! See docs/PLAN-PROJEKTE.md, section 3, for the rules of the sync.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use crate::maps;

pub type Fields = BTreeMap<String, String>;

const MAP_BAG: &str = "@map:";
/// Built-in, read-only bag with the plugins every brausa wiki needs.
pub const PLUGINS: &str = "@plugins";
/// Shared bag for what stays on this computer: links to local files (generated from
/// the maps' file cards) and notes tagged `lokal` or `privat`. Wikis include it
/// right below their own bag unless switched off (`Recipe::local`).
pub const LOCAL: &str = "lokal";
/// Tags that send a tiddler edited in a wiki to the bag `lokal`.
const LOCAL_TAGS: [&str; 2] = ["lokal", "privat"];
/// Marks tiddlers brausa generates in `lokal` for linked files.
const GENERATED: &str = "brausa-generated";

/// Plugin tiddlers bundled into brausa (rebuild with scripts/build-tw-plugins.sh).
const BUNDLED_PLUGINS: [&str; 5] = [
    include_str!("../resources/tw-plugins/markdown.json"),
    include_str!("../resources/tw-plugins/graph.json"),
    include_str!("../resources/tw-plugins/vis-network.json"),
    include_str!("../resources/tw-plugins/pinboard.json"),
    include_str!("../resources/tw-plugins/kanban.json"),
];

fn plugin_tiddlers() -> Vec<Fields> {
    let mut out: Vec<Fields> =
        BUNDLED_PLUGINS.iter().filter_map(|s| serde_json::from_str::<Value>(s).ok()).filter_map(|v| fields_from_json(&v)).collect();
    // Map cards are written in Markdown by default.
    let mut cfg = Fields::new();
    cfg.insert("title".into(), "$:/config/markdown/renderWikiText".into());
    cfg.insert("text".into(), "true".into());
    out.push(cfg);
    out
}

/// Plugin name and version, for the UI.
pub fn bundled_plugins() -> Vec<(String, String)> {
    plugin_tiddlers()
        .into_iter()
        .filter(|f| f.contains_key("plugin-type"))
        .map(|f| (f.get("name").cloned().unwrap_or_else(|| f["title"].clone()), f.get("version").cloned().unwrap_or_default()))
        .collect()
}

fn err(msg: impl Into<String>) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, msg.into())
}

// ---------------------------------------------------------------- tiddler formats

/// Parse a `.tid` file: `field: value` lines, a blank line, then the text.
pub fn parse_tid(s: &str) -> Option<Fields> {
    let s = s.strip_prefix('\u{feff}').unwrap_or(s).replace("\r\n", "\n");
    let (head, text) = match s.find("\n\n") {
        Some(i) => (&s[..i], Some(&s[i + 2..])),
        None => (s.as_str(), None),
    };
    let mut f = Fields::new();
    for line in head.lines() {
        let (k, v) = line.split_once(':')?;
        f.insert(k.trim().to_string(), v.trim().to_string());
    }
    if let Some(t) = text {
        f.insert("text".into(), t.to_string());
    }
    f.contains_key("title").then_some(f)
}

/// `.tid` text, or None if a field other than `text` spans lines (then JSON is used).
pub fn to_tid(f: &Fields) -> Option<String> {
    let mut out = String::new();
    for (k, v) in f {
        if k == "text" {
            continue;
        }
        if v.contains('\n') || k.contains(':') || k.contains('\n') {
            return None;
        }
        out.push_str(&format!("{k}: {v}\n"));
    }
    out.push('\n');
    out.push_str(f.get("text").map(String::as_str).unwrap_or(""));
    Some(out)
}

fn fields_from_json(v: &Value) -> Option<Fields> {
    let obj = v.as_object()?;
    let f: Fields = obj
        .iter()
        .map(|(k, v)| (k.clone(), v.as_str().map(String::from).unwrap_or_else(|| v.to_string())))
        .collect();
    f.contains_key("title").then_some(f)
}

/// A file name TiddlyWiki itself would accept for a title.
pub fn filename(title: &str) -> String {
    let t = title.replace("$:/", "$__");
    let mut s: String = t
        .chars()
        .map(|c| if "<>:\"/\\|?*^".contains(c) || c.is_control() { '_' } else { c })
        .collect();
    if s.chars().count() > 160 {
        s = s.chars().take(160).collect();
    }
    if s.trim().is_empty() || s.starts_with('.') {
        s = format!("_{s}");
    }
    s
}

/// TiddlyWiki list syntax: `a [[b c]] d`.
pub fn stringify_list(items: &[String]) -> String {
    items.iter().map(|t| if t.contains(' ') { format!("[[{t}]]") } else { t.clone() }).collect::<Vec<_>>().join(" ")
}

pub fn parse_list(s: &str) -> Vec<String> {
    let mut out = vec![];
    let mut rest = s.trim();
    while !rest.is_empty() {
        if let Some(r) = rest.strip_prefix("[[") {
            let end = r.find("]]").unwrap_or(r.len());
            out.push(r[..end].to_string());
            rest = r.get(end + 2..).unwrap_or("").trim_start();
        } else {
            let end = rest.find(char::is_whitespace).unwrap_or(rest.len());
            out.push(rest[..end].to_string());
            rest = rest[end..].trim_start();
        }
    }
    out
}

fn hash(f: &Fields) -> String {
    format!("{:016x}", xxhash_rust::xxh3::xxh3_64(serde_json::to_string(f).unwrap_or_default().as_bytes()))
}

/// State and temporary tiddlers of a running wiki, never synced.
fn ignored(f: &Fields) -> bool {
    let t = f.get("title").map(String::as_str).unwrap_or("");
    f.contains_key("plugin-type")
        || t == "$:/StoryList"
        || t == "$:/HistoryList"
        || t == "$:/Import"
        || t == "$:/core"
        || ["$:/state/", "$:/temp/", "$:/status/", "$:/themes/", "$:/languages/", "$:/plugins/", "$:/boot/", "$:/library/"]
            .iter()
            .any(|p| t.starts_with(p))
}

// ---------------------------------------------------------------- map → tiddlers

/// The tiddlers of a project map: one per card, one for the map, edge config for tw5-graph.
/// No `created`/`modified`: a map has no per-card dates, and the projection must
/// stay identical as long as the card does (that is how changes are detected).
pub fn map_tiddlers(map: &Value) -> Vec<Fields> {
    let map_id = map.get("id").and_then(Value::as_str).unwrap_or("");
    let map_title = map.get("title").and_then(Value::as_str).unwrap_or("Map").to_string();
    let empty = serde_json::Map::new();
    let cards = map.get("cards").and_then(Value::as_object).unwrap_or(&empty);
    let s = |c: &Value, k: &str| c.get(k).and_then(Value::as_str).unwrap_or("").to_string();

    // Unique, readable titles; ids stay in `brausa-id`.
    let mut ids: Vec<&String> = cards.keys().collect();
    ids.sort();
    let mut title_of: HashMap<String, String> = HashMap::new();
    let mut used: BTreeSet<String> = BTreeSet::from([map_title.clone()]);
    for id in &ids {
        let c = &cards[*id];
        let base = match s(c, "title").trim() {
            "" if c.get("kind").and_then(Value::as_str) == Some("stack") => "Stapel".to_string(),
            "" => format!("Karte {}", id.trim_start_matches("c_")),
            t => t.to_string(),
        };
        let mut t = base.clone();
        let mut n = 2;
        while used.contains(&t) {
            t = format!("{base} ({n})");
            n += 1;
        }
        used.insert(t.clone());
        title_of.insert((*id).clone(), t);
    }

    let mut links: HashMap<String, Vec<String>> = HashMap::new();
    for l in map.get("links").and_then(Value::as_array).into_iter().flatten() {
        if let (Some(a), Some(b)) = (l.get("from").and_then(Value::as_str), l.get("to").and_then(Value::as_str)) {
            if let Some(t) = title_of.get(b) {
                links.entry(a.to_string()).or_default().push(t.clone());
            }
        }
    }

    let mut out = vec![];
    for id in &ids {
        let c = &cards[*id];
        let kind = s(c, "kind");
        let mut f = Fields::new();
        f.insert("title".into(), title_of[*id].clone());
        f.insert("brausa-id".into(), (*id).clone());
        f.insert("brausa-map".into(), map_id.into());
        let mut tags = vec!["brausa-karte".to_string()];
        match kind.as_str() {
            "snippet" => tags.push("brausa-snippet".into()),
            "stack" => tags.push("brausa-stapel".into()),
            _ => {}
        }
        f.insert("tags".into(), stringify_list(&tags));
        f.insert("type".into(), if kind == "snippet" { "text/plain" } else { "text/markdown" }.into());
        f.insert("text".into(), s(c, "text"));
        if let Some(p) = c.get("parent").and_then(Value::as_str).and_then(|p| title_of.get(p)) {
            f.insert("brausa-parent".into(), p.clone());
        }
        let kids: Vec<String> =
            c.get("children").and_then(Value::as_array).into_iter().flatten().filter_map(|k| title_of.get(k.as_str()?).cloned()).collect();
        if !kids.is_empty() {
            f.insert("list".into(), stringify_list(&kids));
        }
        if let Some(l) = links.get(*id) {
            f.insert("brausa-links".into(), stringify_list(l));
        }
        for k in ["color", "status"] {
            if !s(c, k).is_empty() {
                f.insert(k.into(), s(c, k));
            }
        }
        if let Some(r) = c.get("refs").and_then(Value::as_array).and_then(|r| r.iter().find(|r| r.get("kind").and_then(Value::as_str) == Some("file"))) {
            if let Some(p) = r.get("path").and_then(Value::as_str) {
                f.insert("brausa-file".into(), p.into());
            }
            if let Some(n) = r.get("page").and_then(Value::as_u64) {
                f.insert("brausa-page".into(), n.to_string());
            }
        }
        out.push(f);
    }

    // The map as tw5-graph boards (bundled plugins): a Pinboard per level and a Kanban.
    let kids_of = |parent: Option<&str>| -> Vec<&str> {
        match parent {
            None => map.get("roots").and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_str).collect(),
            Some(p) => cards.get(p).and_then(|c| c.get("children")).and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_str).collect(),
        }
    };
    let board = |title: String, filter: String, ids: &[&str]| -> Fields {
        let mut pos = serde_json::Map::new();
        let mut sizes = serde_json::Map::new();
        for id in ids {
            if let (Some(c), Some(t)) = (cards.get(*id), title_of.get(*id)) {
                let n = |k: &str| c.get(k).and_then(Value::as_f64).unwrap_or(0.0);
                // Pinboard keeps card centres; brausa keeps top-left corners.
                pos.insert(t.clone(), Value::String(format!("{},{}", (n("x") + n("w") / 2.0).round(), (n("y") + n("h") / 2.0).round())));
                sizes.insert(t.clone(), serde_json::json!({"w": n("w").round(), "h": n("h").round()}));
            }
        }
        let mut g = Fields::new();
        g.insert("title".into(), title);
        g.insert("type".into(), "application/json".into());
        g.insert("template".into(), "$:/plugins/lasjoh-toho/pinboard/templates/pinboard".into());
        g.insert("filter".into(), filter);
        g.insert("brausa-map-id".into(), map_id.into());
        g.insert("pinboard".into(), serde_json::json!({"version": 1, "cards": sizes}).to_string());
        g.insert("text".into(), serde_json::to_string_pretty(&pos).unwrap_or_default());
        g
    };
    out.push(board(format!("$:/graph/{map_title}"), format!("[field:brausa-map[{map_id}]!has[brausa-parent]]"), &kids_of(None)));
    for id in &ids {
        let kids = kids_of(Some(id.as_str()));
        if !kids.is_empty() {
            let t = &title_of[*id];
            out.push(board(format!("$:/graph/{map_title}/{t}"), format!("[field:brausa-map[{map_id}]field:brausa-parent[{t}]]"), &kids));
        }
    }
    let statuses: Vec<String> = map
        .get("statuses")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(Value::as_str).map(String::from).collect())
        .unwrap_or_else(|| ["Offen", "In Arbeit", "Erledigt"].map(String::from).to_vec());
    let mut k = Fields::new();
    k.insert("title".into(), format!("$:/graph/{map_title} · Kanban"));
    k.insert("template".into(), "$:/plugins/lasjoh-toho/kanban/templates/kanban".into());
    k.insert("filter".into(), format!("[field:brausa-map[{map_id}]has[status]]"));
    k.insert("brausa-map-id".into(), map_id.into());
    k.insert("graph.graph".into(), serde_json::json!({"columns": stringify_list(&statuses), "fields": "title text"}).to_string());
    k.insert("text".into(), String::new());
    out.push(k);

    let mut e = Fields::new();
    e.insert("title".into(), "$:/config/flibbles/graph/edges/fields/brausa-links".into());
    e.insert("type".into(), "application/json".into());
    e.insert("text".into(), r#"{"label":"verweist auf"}"#.into());
    out.push(e);
    out
}

// ---------------------------------------------------------------- store: bags and recipes

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct BagInfo {
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub readonly: bool,
    #[serde(default, skip_deserializing)]
    pub tiddlers: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Target {
    /// "folder" (wiki folder with tiddlywiki.info) or "file" (single-file wiki).
    pub kind: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Recipe {
    pub name: String,
    #[serde(default)]
    pub description: String,
    /// Bottom to top; the last bag receives new tiddlers. `@map:<root>|<id>` is a project map.
    pub bags: Vec<String>,
    pub target: Target,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_sync: Option<String>,
    /// Put brausa's bundled plugins (Markdown, tw5-graph with Pinboard and Kanban) into the wiki.
    #[serde(default = "yes")]
    pub plugins: bool,
    /// Include the bag `lokal` (file links, private notes) below the wiki's own bag.
    #[serde(default = "yes")]
    pub local: bool,
    /// Overlays the user decided to keep as this wiki's own variant.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub kept: Vec<String>,
}

fn yes() -> bool {
    true
}

/// A tiddler of a shared bag (or map) that one or more wikis cover with their own version.
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Overlay {
    pub title: String,
    pub bag: String,
    pub base: Fields,
    pub variants: Vec<Variant>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Variant {
    pub recipe: String,
    pub fields: Fields,
    /// Same as the base apart from dates: can be dropped without losing anything.
    pub identical: bool,
    pub kept: bool,
}

/// What to do with an overlay.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", tag = "action")]
pub enum Resolve {
    /// The wiki's version becomes the shared one; with `all`, other wikis' overlays go too.
    Promote { recipe: String, all: bool },
    /// Write merged text into the shared tiddler and drop all overlays of it.
    Merge { text: String },
    /// Drop the wiki's version; the wiki gets the shared one again.
    Discard { recipe: String },
    /// Keep (or stop keeping) the wiki's version as a deliberate variant.
    Keep { recipe: String, keep: bool },
}

/// What the last sync left behind: where each pushed tiddler came from, and the wiki as it was.
#[derive(Debug, Default, Serialize, Deserialize)]
struct SyncState {
    /// title → (bag, hash pushed)
    pushed: BTreeMap<String, (String, String)>,
    /// title → hash of every non-ignored tiddler in the wiki after the sync
    wiki: BTreeMap<String, String>,
    /// file mtime of a single-file wiki after the sync
    #[serde(default)]
    file_mtime: Option<u64>,
}

#[derive(Debug, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SyncReport {
    pub pulled: Vec<String>,
    pub conflicts: Vec<String>,
    pub deleted: Vec<String>,
    pub pushed: usize,
    /// (project root, map id) whose cards were changed from the wiki
    pub maps: Vec<(String, String)>,
    pub warnings: Vec<String>,
}

pub struct Store {
    dir: PathBuf,
}

fn valid_bag(name: &str) -> bool {
    !name.trim().is_empty()
        && name.len() <= 80
        && !name.starts_with('@')
        && !name.starts_with('.')
        && !name.contains(['/', '\\', ':', '|', '\0'])
        && name != ".."
}

impl Store {
    pub fn open(app_dir: &Path) -> io::Result<Store> {
        let dir = app_dir.join("tw");
        fs::create_dir_all(dir.join("bags"))?;
        fs::create_dir_all(dir.join("state"))?;
        Ok(Store { dir })
    }

    fn bag_dir(&self, name: &str) -> io::Result<PathBuf> {
        if !valid_bag(name) {
            return Err(err(crate::tr!(format!("Ungültiger Bag-Name „{name}“"), format!("Invalid bag name “{name}”"))));
        }
        Ok(self.dir.join("bags").join(name))
    }

    pub fn bags(&self) -> Vec<BagInfo> {
        let mut out: Vec<BagInfo> = fs::read_dir(self.dir.join("bags"))
            .into_iter()
            .flatten()
            .flatten()
            .filter(|e| e.path().is_dir())
            .map(|e| {
                let name = e.file_name().to_string_lossy().to_string();
                let mut info: BagInfo =
                    fs::read(e.path().join("bag.json")).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
                info.name = name.clone();
                info.tiddlers = self.bag_tiddlers(&name).map(|t| t.len()).unwrap_or(0);
                info
            })
            .collect();
        out.sort_by_key(|b| b.name.to_lowercase());
        out
    }

    pub fn put_bag(&self, info: &BagInfo) -> io::Result<()> {
        let d = self.bag_dir(&info.name)?;
        fs::create_dir_all(d.join("tiddlers"))?;
        fs::write(d.join("bag.json"), serde_json::to_vec_pretty(info)?)
    }

    pub fn delete_bag(&self, name: &str) -> io::Result<()> {
        if self.recipes().iter().any(|r| r.bags.iter().any(|b| b == name)) {
            return Err(err(crate::tr!(format!("Bag „{name}“ wird noch von einem Wiki benutzt"), format!("Bag “{name}” is still used by a wiki"))));
        }
        let d = self.bag_dir(name)?;
        if d.exists() {
            trash::delete(&d).map_err(|e| err(e.to_string()))?;
        }
        Ok(())
    }

    fn bag_readonly(&self, name: &str) -> bool {
        if name.starts_with('@') {
            return true;
        }
        self.bags().iter().find(|b| b.name == name).map(|b| b.readonly).unwrap_or(true)
    }

    /// title → (fields, file) of a real bag.
    pub fn bag_tiddlers(&self, name: &str) -> io::Result<BTreeMap<String, (Fields, PathBuf)>> {
        let d = self.bag_dir(name)?.join("tiddlers");
        Ok(read_tiddler_dir(&d))
    }

    pub fn put_tiddler(&self, bag: &str, f: &Fields) -> io::Result<()> {
        let title = f.get("title").ok_or_else(|| err("Tiddler ohne Titel"))?;
        let existing = self.bag_tiddlers(bag)?.remove(title).map(|(_, p)| p);
        let dir = self.bag_dir(bag)?.join("tiddlers");
        fs::create_dir_all(&dir)?;
        write_tiddler(&dir, existing, f)?;
        Ok(())
    }

    pub fn delete_tiddler(&self, bag: &str, title: &str) -> io::Result<()> {
        if let Some((_, p)) = self.bag_tiddlers(bag)?.remove(title) {
            fs::remove_file(p)?;
        }
        Ok(())
    }

    fn recipes_file(&self) -> PathBuf {
        self.dir.join("recipes.json")
    }

    pub fn recipes(&self) -> Vec<Recipe> {
        fs::read(self.recipes_file()).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
    }

    fn save_recipes(&self, list: &[Recipe]) -> io::Result<()> {
        let tmp = self.recipes_file().with_extension("json.tmp");
        fs::write(&tmp, serde_json::to_vec_pretty(list)?)?;
        fs::rename(tmp, self.recipes_file())
    }

    /// Create or replace a recipe. A new recipe gets its own writable top bag.
    pub fn put_recipe(&self, mut r: Recipe) -> io::Result<Recipe> {
        if !valid_bag(&r.name) {
            return Err(err(crate::tr!(format!("Ungültiger Name „{}“", r.name), format!("Invalid name “{}”", r.name))));
        }
        if r.target.kind != "folder" && r.target.kind != "file" {
            return Err(err("Ziel muss ein Wiki-Ordner oder eine Wiki-Datei sein"));
        }
        let own = format!("wiki-{}", r.name);
        if r.bags.last().map(|b| b.starts_with(MAP_BAG) || self.bag_readonly(b)).unwrap_or(true) && !r.bags.contains(&own) {
            r.bags.push(own.clone());
        }
        if r.local {
            self.ensure_local()?;
        }
        for b in &r.bags {
            if !b.starts_with(MAP_BAG) && !self.bag_dir(b)?.exists() {
                self.put_bag(&BagInfo { name: b.clone(), description: crate::tr!(format!("Eigener Bag von „{}“", r.name), format!("Own bag of “{}”", r.name)), ..Default::default() })?;
            }
        }
        let mut list = self.recipes();
        list.retain(|x| x.name != r.name);
        list.push(r.clone());
        list.sort_by_key(|x| x.name.to_lowercase());
        self.save_recipes(&list)?;
        Ok(r)
    }

    pub fn delete_recipe(&self, name: &str) -> io::Result<()> {
        let mut list = self.recipes();
        list.retain(|x| x.name != name);
        self.save_recipes(&list)?;
        let _ = fs::remove_file(self.state_file(name));
        Ok(())
    }

    fn state_file(&self, recipe: &str) -> PathBuf {
        self.dir.join("state").join(format!("{}.json", filename(recipe)))
    }

    // ------------------------------------------------------------ layers

    /// Tiddlers of one bag; map bags are generated from the map file.
    fn layer(&self, bag: &str) -> io::Result<BTreeMap<String, Fields>> {
        if bag == PLUGINS {
            return Ok(plugin_tiddlers().into_iter().map(|f| (f["title"].clone(), f)).collect());
        }
        if let Some(spec) = bag.strip_prefix(MAP_BAG) {
            let (root, id) = spec.split_once('|').ok_or_else(|| err(crate::tr!("Ungültiger Map-Bag", "Invalid map bag")))?;
            let m = maps::load(Path::new(root), id)?;
            return Ok(map_tiddlers(&m).into_iter().map(|f| (f["title"].clone(), f)).collect());
        }
        Ok(self.bag_tiddlers(bag)?.into_iter().map(|(t, (f, _))| (t, f)).collect())
    }

    /// The recipe's layers in load order (later ones win): the plugins, the recipe's
    /// bags, `lokal` right below the wiki's own bag, then the own bag.
    pub fn layer_names(r: &Recipe) -> Vec<String> {
        let mut out = vec![];
        if r.plugins {
            out.push(PLUGINS.to_string());
        }
        let (top, lower) = match r.bags.split_last() {
            Some((t, l)) => (Some(t), l),
            None => (None, &r.bags[..]),
        };
        out.extend(lower.iter().cloned());
        if r.local && !r.bags.iter().any(|b| b == LOCAL) {
            out.push(LOCAL.to_string());
        }
        out.extend(top.cloned());
        out
    }

    /// The recipe's view: title → (fields, bag); later bags win.
    fn merged(&self, r: &Recipe) -> io::Result<BTreeMap<String, (Fields, String)>> {
        let mut out = BTreeMap::new();
        for b in Self::layer_names(r) {
            for (t, f) in self.layer(&b)? {
                out.insert(t, (f, b.clone()));
            }
        }
        Ok(out)
    }

    /// Each layer of a wiki with its tiddler titles, bottom first (for the layer view).
    pub fn layers(&self, name: &str) -> io::Result<Vec<(String, Vec<String>)>> {
        let r = self.recipes().into_iter().find(|x| x.name == name).ok_or_else(|| err(crate::tr!(format!("Wiki „{name}“ gibt es nicht"), format!("There is no wiki “{name}”"))))?;
        Self::layer_names(&r).into_iter().map(|b| Ok((b.clone(), self.layer(&b).map(|l| l.into_keys().collect()).unwrap_or_default()))).collect()
    }

    // ------------------------------------------------------------ bag „lokal“

    fn ensure_local(&self) -> io::Result<()> {
        if !self.bag_dir(LOCAL)?.exists() {
            self.put_bag(&BagInfo {
                name: LOCAL.into(),
                description: crate::tr!("Bleibt auf diesem Rechner: Verweise auf lokale Dateien und Notizen mit dem Tag lokal oder privat", "Stays on this computer: links to local files and notes tagged lokal or privat").into(),
                ..Default::default()
            })?;
        }
        Ok(())
    }

    /// Keep one tiddler per file linked from a map card in `lokal`: title = file name,
    /// `_canonical_uri` = the file. Text and tags added in the wiki are kept; tiddlers of
    /// files no map links any more go, unless someone wrote text into them.
    fn refresh_local_files(&self) -> io::Result<()> {
        self.ensure_local()?;
        let mut files: BTreeSet<String> = BTreeSet::new();
        let map_bags: BTreeSet<String> = self.recipes().iter().flat_map(|r| r.bags.iter().filter(|b| b.starts_with(MAP_BAG)).cloned()).collect();
        for b in map_bags {
            for (_, f) in self.layer(&b).unwrap_or_default() {
                if let Some(p) = f.get("brausa-file").filter(|p| !p.is_empty()) {
                    files.insert(p.clone());
                }
            }
        }
        let have = self.bag_tiddlers(LOCAL)?;
        let generated: HashMap<String, Fields> =
            have.values().filter(|(f, _)| f.contains_key(GENERATED)).filter_map(|(f, _)| Some((f.get("brausa-file")?.clone(), f.clone()))).collect();
        let mut titles: BTreeSet<String> = have.keys().cloned().collect();
        for path in &files {
            let uri = tauri::Url::from_file_path(path).map(|u| u.to_string()).unwrap_or_else(|_| format!("file://{path}"));
            let mime = mime_guess::from_path(path).first_raw().unwrap_or("application/octet-stream").to_string();
            let mut f = match generated.get(path) {
                Some(f) => f.clone(),
                None => {
                    let p = Path::new(path);
                    let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| path.clone());
                    let mut title = name.clone();
                    if titles.contains(&title) {
                        let parent = p.parent().and_then(|d| d.file_name()).map(|d| d.to_string_lossy().to_string()).unwrap_or_default();
                        title = format!("{name} ({parent})");
                        let mut n = 2;
                        while titles.contains(&title) {
                            title = format!("{name} ({parent} {n})");
                            n += 1;
                        }
                    }
                    titles.insert(title.clone());
                    let mut f = Fields::new();
                    f.insert("title".into(), title);
                    f.insert("tags".into(), stringify_list(&[LOCAL.to_string(), "brausa-datei".to_string()]));
                    f.insert("text".into(), String::new());
                    f
                }
            };
            let before = f.clone();
            f.insert("_canonical_uri".into(), uri);
            f.insert("type".into(), mime);
            f.insert("brausa-file".into(), path.clone());
            f.insert(GENERATED.into(), "datei".into());
            if f != before {
                self.put_tiddler(LOCAL, &f)?;
            }
        }
        for (path, f) in &generated {
            if !files.contains(path) && f.get("text").map(|t| t.trim().is_empty()).unwrap_or(true) {
                self.delete_tiddler(LOCAL, &f["title"])?;
            }
        }
        Ok(())
    }

    // ------------------------------------------------------------ overlays

    /// Every tiddler that a wiki's own bag holds over a lower bag of its recipe.
    pub fn overlays(&self) -> io::Result<Vec<Overlay>> {
        let mut by_key: BTreeMap<(String, String), Overlay> = BTreeMap::new();
        for r in self.recipes() {
            let Some((top, lower)) = r.bags.split_last() else { continue };
            if top.starts_with('@') {
                continue;
            }
            let _ = lower;
            let own = self.layer(top)?;
            let mut layers = vec![];
            for b in Self::layer_names(&r).iter().filter(|b| *b != top) {
                layers.push((b.clone(), self.layer(b)?));
            }
            for (title, f) in own {
                // The highest lower bag that has the title is the one being covered.
                let Some((bag, base)) = layers.iter().rev().find_map(|(b, l)| l.get(&title).map(|f| (b.clone(), f.clone()))) else {
                    continue;
                };
                let identical = strip_wiki_fields(&f) == strip_wiki_fields(&base);
                let o = by_key.entry((bag.clone(), title.clone())).or_insert_with(|| Overlay { title: title.clone(), bag, base, variants: vec![] });
                o.variants.push(Variant { recipe: r.name.clone(), fields: f, identical, kept: r.kept.contains(&title) });
            }
        }
        Ok(by_key.into_values().collect())
    }

    /// Resolve the overlay of `title` over `bag`. Changes reach the wikis with their next sync.
    pub fn resolve_overlay(&self, title: &str, bag: &str, how: Resolve) -> io::Result<()> {
        let o = self
            .overlays()?
            .into_iter()
            .find(|o| o.title == title && o.bag == bag)
            .ok_or_else(|| err(crate::tr!(format!("„{title}“ wird nicht mehr überdeckt"), format!("“{title}” is no longer overlaid"))))?;
        let recipes = self.recipes();
        let own_bag = |recipe: &str| recipes.iter().find(|r| r.name == recipe).and_then(|r| r.bags.last().cloned());
        let shared_writable = !bag.starts_with('@') && !self.bag_readonly(bag);
        let drop = |recipe: &str| -> io::Result<()> {
            match own_bag(recipe) {
                Some(b) => self.delete_tiddler(&b, title),
                None => Ok(()),
            }
        };
        match how {
            Resolve::Promote { recipe, all } => {
                if !shared_writable {
                    return Err(err(crate::tr!(format!("„{bag}“ ist schreibgeschützt; nur Verwerfen oder Behalten ist möglich"), format!("“{bag}” is read-only; you can only discard or keep"))));
                }
                let v = o.variants.iter().find(|v| v.recipe == recipe).ok_or_else(|| err("Diese Fassung gibt es nicht"))?;
                self.put_tiddler(bag, &strip_wiki_fields(&v.fields))?;
                for v in &o.variants {
                    if v.recipe == recipe || all {
                        drop(&v.recipe)?;
                    }
                }
            }
            Resolve::Merge { text } => {
                if !shared_writable {
                    return Err(err(crate::tr!(format!("„{bag}“ ist schreibgeschützt"), format!("“{bag}” is read-only"))));
                }
                let mut f = o.base.clone();
                f.insert("text".into(), text);
                self.put_tiddler(bag, &f)?;
                for v in &o.variants {
                    drop(&v.recipe)?;
                }
            }
            Resolve::Discard { recipe } => drop(&recipe)?,
            Resolve::Keep { recipe, keep } => {
                let mut r = recipes.iter().find(|r| r.name == recipe).cloned().ok_or_else(|| err("Wiki nicht gefunden"))?;
                r.kept.retain(|t| t != title);
                if keep {
                    r.kept.push(title.to_string());
                }
                self.put_recipe(r)?;
            }
        }
        Ok(())
    }

    // ------------------------------------------------------------ sync

    /// Two-way sync: changes made in the wiki go back to bags and maps, then
    /// the recipe is written to the wiki.
    pub fn sync(&self, name: &str) -> io::Result<SyncReport> {
        let mut r = self.recipes().into_iter().find(|x| x.name == name).ok_or_else(|| err(crate::tr!(format!("Wiki „{name}“ gibt es nicht"), format!("There is no wiki “{name}”"))))?;
        let mut rep = SyncReport::default();
        let state: SyncState =
            fs::read(self.state_file(name)).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
        let target = Path::new(&r.target.path);
        if r.local {
            self.refresh_local_files()?;
        }
        let wiki = read_wiki(&r.target)?;
        let first = state.wiki.is_empty() && state.pushed.is_empty();

        if r.target.kind == "file" {
            if let (Some(before), Some(now)) = (state.file_mtime, mtime(target)) {
                if now != before && !first {
                    rep.warnings.push(crate::tr!("Die Wiki-Datei wurde seit dem letzten Abgleich gespeichert; ihre Änderungen werden übernommen.", "The wiki file was saved since the last sync; its changes are taken over.").into());
                }
            }
        }

        // 1. Wiki → bags and maps. The first sync only writes; an existing wiki's content stays where it is.
        if !first {
            let top = r.bags.last().cloned().unwrap_or_default();
            let before = self.merged(&r)?;
            let stamp = chrono::Local::now().format("%Y-%m-%d %H:%M").to_string();
            let mut map_edits: HashMap<String, Vec<Fields>> = HashMap::new();
            for (title, (f, _)) in &wiki {
                if ignored(f) || state.wiki.get(title) == Some(&hash(f)) {
                    continue;
                }
                // Cards go back into their map (by id, so a rename in the wiki renames the card).
                if let (Some(map_id), Some(_)) = (f.get("brausa-map"), f.get("brausa-id")) {
                    if let Some(bag) = r.bags.iter().find(|b| b.starts_with(MAP_BAG) && b.ends_with(&format!("|{map_id}"))) {
                        map_edits.entry(bag.clone()).or_default().push(f.clone());
                        continue;
                    }
                }
                // Like the MultiWikiServer: everything else lands in the wiki's own bag. A tiddler
                // from a shared bag is overlaid there; `overlays()` finds these for later resolution.
                // Private notes and everything that already lives in `lokal` stay there.
                let private = r.local
                    && (parse_list(f.get("tags").map(String::as_str).unwrap_or("")).iter().any(|t| LOCAL_TAGS.contains(&t.to_lowercase().as_str()))
                        || before.get(title).map(|(_, b)| b == LOCAL).unwrap_or(false));
                let bag = if private { LOCAL.to_string() } else { top.clone() };
                // Changed in the own bag as well since the last sync? The bag wins, the wiki's version is kept aside.
                let bag_now = before.get(title).filter(|(_, b)| *b == bag).map(|(f, _)| hash(f));
                let bag_then = state.pushed.get(title).filter(|(b, _)| *b == bag).map(|(_, h)| h.clone());
                if bag_now.is_some() && bag_now != bag_then {
                    let mut c = f.clone();
                    let t = format!("{title} (Konflikt {stamp})");
                    c.insert("title".into(), t.clone());
                    self.put_tiddler(&top, &c)?;
                    rep.conflicts.push(t);
                } else {
                    self.put_tiddler(&bag, f)?;
                    rep.pulled.push(title.clone());
                }
            }
            // Deleted in the wiki: delete in the own bag if unchanged; shared tiddlers come back.
            for (title, (bag, h)) in &state.pushed {
                if wiki.contains_key(title) || bag == PLUGINS || bag.starts_with(MAP_BAG) {
                    continue;
                }
                let generated = before.get(title).map(|(f, _)| f.contains_key(GENERATED)).unwrap_or(false);
                if (*bag != top && *bag != LOCAL) || generated {
                    rep.warnings.push(crate::tr!(format!("„{title}“ kommt aus dem Bag „{bag}“ und erscheint beim nächsten Abgleich wieder"), format!("“{title}” comes from the bag “{bag}” and will reappear on the next sync")));
                    continue;
                }
                if before.get(title).map(|(f, b)| b == bag && hash(f) == *h).unwrap_or(false) {
                    self.delete_tiddler(bag, title)?;
                    rep.deleted.push(title.clone());
                }
            }
            for (bag, edits) in map_edits {
                let spec = &bag[MAP_BAG.len()..];
                let (root, id) = spec.split_once('|').unwrap();
                if apply_card_edits(Path::new(root), id, &edits, &state, &mut rep)? {
                    rep.maps.push((root.to_string(), id.to_string()));
                }
            }
        }

        // 2. Bags and maps → wiki.
        let merged = self.merged(&r)?;
        let stale: Vec<String> = state.pushed.keys().filter(|t| !merged.contains_key(*t)).cloned().collect();
        rep.pushed = write_wiki(&r.target, &wiki, &merged, &stale)?;

        // 3. Remember what the wiki looks like now.
        let after = read_wiki(&r.target)?;
        let new_state = SyncState {
            pushed: merged.iter().map(|(t, (f, b))| (t.clone(), (b.clone(), hash(f)))).collect(),
            wiki: after.iter().filter(|(_, (f, _))| !ignored(f)).map(|(t, (f, _))| (t.clone(), hash(f))).collect(),
            file_mtime: if r.target.kind == "file" { mtime(target) } else { None },
        };
        fs::write(self.state_file(name), serde_json::to_vec(&new_state)?)?;
        r.last_sync = Some(chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true));
        self.put_recipe(r)?;
        Ok(rep)
    }
}

/// Card tiddlers edited in the wiki → title, text, color, status of the cards.
fn apply_card_edits(root: &Path, map_id: &str, edits: &[Fields], state: &SyncState, rep: &mut SyncReport) -> io::Result<bool> {
    let mut m = maps::load(root, map_id)?;
    let current: HashMap<String, Fields> =
        map_tiddlers(&m).into_iter().filter_map(|f| Some((f.get("brausa-id")?.clone(), f))).collect();
    let mut changed = false;
    for f in edits {
        let id = &f["brausa-id"];
        let Some(card) = m.get_mut("cards").and_then(|c| c.get_mut(id.as_str())).and_then(Value::as_object_mut) else {
            rep.warnings.push(crate::tr!(format!("Karte zu „{}“ gibt es nicht mehr", f["title"]), format!("The card for “{}” no longer exists", f["title"])));
            continue;
        };
        // Changed in brausa too since the last sync? Then brausa wins (the wiki copy is in the report).
        if let Some(now) = current.get(id) {
            let then = state.pushed.get(&now["title"]).map(|(_, h)| h.clone());
            if then.as_deref() != Some(hash(now).as_str()) && then.is_some() {
                rep.conflicts.push(crate::tr!(format!("{} (Karte in brausa geändert, Wiki-Fassung nicht übernommen)", f["title"]), format!("{} (card changed in brausa, wiki version not taken over)", f["title"])));
                continue;
            }
        }
        for (k, field) in [("title", "title"), ("text", "text"), ("color", "color"), ("status", "status")] {
            let v = f.get(field).cloned().unwrap_or_default();
            let old = card.get(k).and_then(Value::as_str).unwrap_or("").to_string();
            if v != old && !(k == "title" && v.starts_with("Karte ")) {
                card.insert(k.into(), if v.is_empty() && k != "text" && k != "title" { Value::Null } else { Value::String(v) });
                changed = true;
            }
        }
        rep.pulled.push(f["title"].clone());
    }
    if changed {
        m["updated"] = Value::String(chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true));
        maps::save(root, &m)?;
    }
    Ok(changed)
}

fn mtime(p: &Path) -> Option<u64> {
    fs::metadata(p).ok()?.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok().map(|d| d.as_millis() as u64)
}

// ---------------------------------------------------------------- tiddler folders

fn read_tiddler_dir(dir: &Path) -> BTreeMap<String, (Fields, PathBuf)> {
    let mut out = BTreeMap::new();
    for e in walkdir::WalkDir::new(dir).into_iter().flatten().filter(|e| e.file_type().is_file()) {
        let p = e.path();
        let ext = p.extension().and_then(|x| x.to_str()).unwrap_or("");
        let Ok(s) = fs::read_to_string(p) else { continue };
        let found: Vec<Fields> = match ext {
            "tid" => parse_tid(&s).into_iter().collect(),
            "json" => match serde_json::from_str::<Value>(&s) {
                Ok(Value::Array(a)) => a.iter().filter_map(fields_from_json).collect(),
                Ok(v) => fields_from_json(&v).into_iter().collect(),
                Err(_) => vec![],
            },
            _ => vec![],
        };
        // Multi-tiddler JSON files are read but never rewritten tiddler by tiddler.
        let single = found.len() == 1;
        for f in found {
            out.insert(f["title"].clone(), (f, if single { p.to_path_buf() } else { PathBuf::new() }));
        }
    }
    out
}

/// Write one tiddler as `.tid` (or `.json` if a field has line breaks), into `existing` if given.
fn write_tiddler(dir: &Path, existing: Option<PathBuf>, f: &Fields) -> io::Result<PathBuf> {
    let tid = to_tid(f);
    let ext = if tid.is_some() { "tid" } else { "json" };
    let path = match existing.filter(|p| !p.as_os_str().is_empty() && p.extension().and_then(|x| x.to_str()) == Some(ext)) {
        Some(p) => p,
        None => {
            let base = filename(&f["title"]);
            let mut p = dir.join(format!("{base}.{ext}"));
            let mut n = 1;
            while p.exists() {
                p = dir.join(format!("{base} {n}.{ext}"));
                n += 1;
            }
            p
        }
    };
    let body = match tid {
        Some(t) => t,
        None => serde_json::to_string_pretty(&vec![f])?,
    };
    if fs::read_to_string(&path).ok().as_deref() != Some(body.as_str()) {
        fs::write(&path, body)?;
    }
    Ok(path)
}

// ---------------------------------------------------------------- wikis

type WikiTiddlers = BTreeMap<String, (Fields, PathBuf)>;

fn read_wiki(t: &Target) -> io::Result<WikiTiddlers> {
    let p = Path::new(&t.path);
    match t.kind.as_str() {
        "folder" => Ok(read_tiddler_dir(&p.join("tiddlers"))),
        _ => {
            if !p.exists() {
                return Err(err(crate::tr!(format!("Wiki-Datei „{}“ nicht gefunden", t.path), format!("Wiki file “{}” not found", t.path))));
            }
            let html = fs::read_to_string(p)?;
            let mut out = BTreeMap::new();
            for (start, end) in store_blocks(&html) {
                let v: Value = serde_json::from_str(&html[start..end]).map_err(|e| err(format!("Tiddler-Speicher unlesbar: {e}")))?;
                for f in v.as_array().into_iter().flatten().filter_map(fields_from_json) {
                    out.insert(f["title"].clone(), (f, PathBuf::new()));
                }
            }
            if out.is_empty() {
                return Err(err(crate::tr!("Keine TiddlyWiki-Datei ab Version 5.2 (kein Tiddler-Speicher gefunden)", "Not a TiddlyWiki 5.2+ file (no tiddler store found)")));
            }
            Ok(out)
        }
    }
}

/// Byte ranges of the JSON inside `<script class="tiddlywiki-tiddler-store" …>` blocks.
fn store_blocks(html: &str) -> Vec<(usize, usize)> {
    let mut out = vec![];
    let mut from = 0;
    while let Some(i) = html[from..].find("<script") {
        let tag_start = from + i;
        let Some(tag_end) = html[tag_start..].find('>').map(|j| tag_start + j + 1) else { break };
        let close = html[tag_end..].find("</script>").map(|j| tag_end + j).unwrap_or(html.len());
        if html[tag_start..tag_end].contains("tiddlywiki-tiddler-store") {
            out.push((tag_end, close));
        }
        from = close;
    }
    out
}

/// Fields only the wiki maintains; kept when brausa rewrites a tiddler.
const WIKI_FIELDS: [&str; 4] = ["created", "modified", "creator", "modifier"];

fn strip_wiki_fields(f: &Fields) -> Fields {
    f.iter().filter(|(k, _)| !WIKI_FIELDS.contains(&k.as_str())).map(|(k, v)| (k.clone(), v.clone())).collect()
}

/// `f` as it should look in the wiki: plus the wiki's own date/author fields of the existing copy.
fn with_wiki_fields(f: &Fields, existing: Option<&Fields>) -> Fields {
    let mut out = f.clone();
    for k in WIKI_FIELDS {
        if let Some(v) = existing.and_then(|e| e.get(k)) {
            out.entry(k.to_string()).or_insert_with(|| v.clone());
        }
    }
    out
}

/// Write the recipe's tiddlers into the wiki. `stale` = titles brausa wrote before that are gone now.
fn write_wiki(t: &Target, wiki: &WikiTiddlers, merged: &BTreeMap<String, (Fields, String)>, stale: &[String]) -> io::Result<usize> {
    let p = Path::new(&t.path);
    let mut n = 0;
    if t.kind == "folder" {
        let dir = p.join("tiddlers");
        fs::create_dir_all(&dir)?;
        if !p.join("tiddlywiki.info").exists() {
            let info = serde_json::json!({
                "description": "Von brausa angelegt",
                "plugins": [],
                "themes": ["tiddlywiki/vanilla", "tiddlywiki/snowwhite"]
            });
            fs::write(p.join("tiddlywiki.info"), serde_json::to_vec_pretty(&info)?)?;
        }
        for (title, (f, _)) in merged {
            let existing = wiki.get(title);
            let f = with_wiki_fields(f, existing.map(|(w, _)| w));
            if existing.map(|(w, _)| *w == f).unwrap_or(false) {
                continue;
            }
            write_tiddler(&dir, existing.map(|(_, p)| p.clone()), &f)?;
            n += 1;
        }
        for title in stale {
            if let Some((_, path)) = wiki.get(title) {
                if !path.as_os_str().is_empty() {
                    fs::remove_file(path)?;
                }
            }
        }
        return Ok(n);
    }

    // Single-file wiki: replace the tiddler store, after a backup like TiddlyDesktop-RS makes.
    let html = fs::read_to_string(p)?;
    let blocks = store_blocks(&html);
    let mut all: BTreeMap<String, Fields> = wiki.iter().map(|(t, (f, _))| (t.clone(), f.clone())).collect();
    for t in stale {
        all.remove(t);
    }
    for (title, (f, _)) in merged {
        let f = with_wiki_fields(f, all.get(title));
        if all.get(title) != Some(&f) {
            all.insert(title.clone(), f);
            n += 1;
        }
    }
    if n == 0 && stale.iter().all(|t| !wiki.contains_key(t)) {
        return Ok(0);
    }
    let backups = p.parent().unwrap_or(Path::new(".")).join(".backups");
    fs::create_dir_all(&backups)?;
    let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("wiki");
    fs::copy(p, backups.join(format!("{stem}-{}.html", chrono::Local::now().format("%Y%m%d-%H%M%S"))))?;

    // `<` is escaped like TiddlyWiki does, so no `</script>` can end the block early.
    let list: Vec<&Fields> = all.values().collect();
    let json = serde_json::to_string(&list)?.replace('<', "\\u003C");
    let mut out = String::with_capacity(html.len() + json.len());
    let mut last = 0;
    for (i, (s, e)) in blocks.iter().enumerate() {
        out.push_str(&html[last..*s]);
        out.push_str(if i == 0 { &json } else { "[]" });
        last = *e;
    }
    out.push_str(&html[last..]);
    let tmp = p.with_extension("html.brausa-tmp");
    fs::write(&tmp, out)?;
    fs::rename(tmp, p)?;
    Ok(n)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn f(pairs: &[(&str, &str)]) -> Fields {
        pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    #[test]
    fn tid_round_trip_and_names() {
        let t = f(&[("title", "$:/Hallo Welt"), ("tags", "a [[b c]]"), ("text", "Zeile 1\n\nZeile 2")]);
        let s = to_tid(&t).unwrap();
        assert_eq!(parse_tid(&s).unwrap(), t);
        assert_eq!(filename("$:/a/b?c"), "$__a_b_c");
        assert!(to_tid(&f(&[("title", "x"), ("caption", "a\nb")])).is_none());
        assert_eq!(parse_list("a [[b c]]  d"), ["a", "b c", "d"]);
        assert_eq!(stringify_list(&["a".into(), "b c".into()]), "a [[b c]]");
    }

    #[test]
    fn map_becomes_tiddlers_for_tw5_graph() {
        let m = json!({"id": "m_1", "title": "Roadmap", "roots": ["c_a", "c_b"],
            "cards": {
                "c_a": {"id": "c_a", "title": "Idee", "text": "**x**", "x": 1.4, "y": 2, "parent": null, "children": ["c_c"], "status": "Offen"},
                "c_b": {"id": "c_b", "title": "Idee", "text": "", "x": 0, "y": 0, "parent": null, "children": []},
                "c_c": {"id": "c_c", "title": "", "kind": "snippet", "text": "Zitat", "x": 0, "y": 0, "parent": "c_a", "children": [],
                        "refs": [{"kind": "file", "path": "/p/a.pdf", "page": 3}]}
            },
            "links": [{"id": "l", "from": "c_a", "to": "c_b", "directed": true}]});
        let ts = map_tiddlers(&m);
        let get = |id: &str| ts.iter().find(|t| t.get("brausa-id").map(String::as_str) == Some(id)).unwrap();
        assert_eq!(get("c_a")["title"], "Idee");
        assert_eq!(get("c_b")["title"], "Idee (2)");
        assert_eq!(get("c_a")["brausa-links"], "[[Idee (2)]]");
        assert_eq!(get("c_a")["list"], "[[Karte c]]");
        assert_eq!(get("c_c")["brausa-parent"], "Idee");
        assert_eq!(get("c_c")["brausa-page"], "3");
        assert_eq!(get("c_a")["status"], "Offen");
        // Boards for the bundled tw5-graph plugins: Pinboard per level (card centres), Kanban by status.
        let board = ts.iter().find(|t| t["title"] == "$:/graph/Roadmap").unwrap();
        assert_eq!(board["template"], "$:/plugins/lasjoh-toho/pinboard/templates/pinboard");
        let pos: Value = serde_json::from_str(&board["text"]).unwrap();
        assert_eq!(pos["Idee"], "1,2");
        assert!(ts.iter().any(|t| t["title"] == "$:/graph/Roadmap/Idee" && t["filter"].contains("brausa-parent[Idee]")));
        let kanban = ts.iter().find(|t| t["title"] == "$:/graph/Roadmap · Kanban").unwrap();
        assert!(kanban["graph.graph"].contains("[[In Arbeit]]"));
        assert!(ts.iter().any(|t| t["title"] == "$:/config/flibbles/graph/edges/fields/brausa-links"));
    }

    fn setup() -> (tempfile::TempDir, Store, PathBuf) {
        let t = tempfile::tempdir().unwrap();
        let store = Store::open(&t.path().join("app")).unwrap();
        let proj = t.path().join("proj");
        fs::create_dir_all(&proj).unwrap();
        maps::save(&proj, &json!({"id": "m_1", "title": "Plan", "roots": ["c_a"], "links": [],
            "cards": {"c_a": {"id": "c_a", "title": "Idee", "text": "alt", "x": 0, "y": 0, "parent": null, "children": []}}}))
        .unwrap();
        store.put_bag(&BagInfo { name: "glossar".into(), ..Default::default() }).unwrap();
        store.put_tiddler("glossar", &f(&[("title", "ZUI"), ("text", "Zoomable UI")])).unwrap();
        (t, store, proj)
    }

    fn recipe(store: &Store, name: &str, proj: &Path, target: Target) -> Recipe {
        store
            .put_recipe(Recipe {
                name: name.into(),
                description: String::new(),
                bags: vec!["glossar".into(), format!("@map:{}|m_1", proj.display())],
                target,
                last_sync: None,
                plugins: true,
                local: false,
                kept: vec![],
            })
            .unwrap()
    }

    #[test]
    fn bag_lokal_holds_file_links_and_private_notes() {
        let (t, store, proj) = setup();
        crate::i18n::set("de");
        let doc = proj.join("Bericht 2026.pdf");
        fs::write(&doc, b"%PDF").unwrap();
        maps::save(&proj, &json!({"id": "m_1", "title": "Plan", "roots": ["c_a"], "links": [],
            "cards": {"c_a": {"id": "c_a", "title": "Idee", "text": "", "x": 0, "y": 0, "parent": null, "children": [],
                              "refs": [{"kind": "file", "path": doc.display().to_string()}]}}}))
        .unwrap();
        let wa = t.path().join("wiki-a");
        let mut r = recipe(&store, "a", &proj, Target { kind: "folder".into(), path: wa.display().to_string() });
        r.local = true;
        store.put_recipe(r).unwrap();

        // Layer order: plugins, shared bags and maps, lokal, the wiki's own bag on top.
        let names: Vec<String> = store.layers("a").unwrap().into_iter().map(|(b, _)| b).collect();
        assert_eq!(names.first().unwrap(), PLUGINS);
        assert_eq!(&names[names.len() - 2..], [LOCAL.to_string(), "wiki-a".to_string()]);

        store.sync("a").unwrap();
        // One tiddler per linked file, pointing at the file on this computer.
        let link = store.bag_tiddlers(LOCAL).unwrap().into_values().map(|(f, _)| f).find(|f| f.contains_key(GENERATED)).unwrap();
        assert_eq!(link["title"], "Bericht 2026.pdf");
        assert!(link["_canonical_uri"].starts_with("file://") && link["_canonical_uri"].ends_with("Bericht%202026.pdf"), "{link:?}");
        assert_eq!(link["type"], "application/pdf");
        assert!(read_tiddler_dir(&wa.join("tiddlers")).contains_key("Bericht 2026.pdf"));

        // Notes tagged privat (or lokal) go to the bag lokal, others to the wiki's own bag.
        fs::write(wa.join("tiddlers/Geheim.tid"), "tags: [[Privat]] idee\ntitle: Geheim\n\nnoch nicht veröffentlichen").unwrap();
        fs::write(wa.join("tiddlers/Offen.tid"), "title: Offen\n\nfür alle").unwrap();
        store.sync("a").unwrap();
        assert!(store.bag_tiddlers(LOCAL).unwrap().contains_key("Geheim"));
        assert!(!store.bag_tiddlers("wiki-a").unwrap().contains_key("Geheim"));
        assert!(store.bag_tiddlers("wiki-a").unwrap().contains_key("Offen"));
        // Edited again without the tag, it stays where it lives.
        fs::write(wa.join("tiddlers/Geheim.tid"), "title: Geheim\n\ngeändert").unwrap();
        store.sync("a").unwrap();
        assert_eq!(store.bag_tiddlers(LOCAL).unwrap()["Geheim"].0["text"], "geändert");
        assert!(!store.bag_tiddlers("wiki-a").unwrap().contains_key("Geheim"));

        // Without the link on the map, the generated tiddler goes again.
        maps::save(&proj, &json!({"id": "m_1", "title": "Plan", "roots": ["c_a"], "links": [],
            "cards": {"c_a": {"id": "c_a", "title": "Idee", "text": "", "x": 0, "y": 0, "parent": null, "children": []}}}))
        .unwrap();
        store.sync("a").unwrap();
        assert!(!store.bag_tiddlers(LOCAL).unwrap().contains_key("Bericht 2026.pdf"));

        // A wiki can leave lokal out (e.g. one meant for publishing).
        let wb = t.path().join("wiki-b");
        recipe(&store, "b", &proj, Target { kind: "folder".into(), path: wb.display().to_string() });
        store.sync("b").unwrap();
        assert!(!read_tiddler_dir(&wb.join("tiddlers")).contains_key("Geheim"));
    }

    #[test]
    fn wiki_edits_overlay_shared_bags_until_resolved() {
        let (t, store, proj) = setup();
        let wa = t.path().join("wiki-a");
        let wb = t.path().join("wiki-b");
        let ra = recipe(&store, "a", &proj, Target { kind: "folder".into(), path: wa.display().to_string() });
        recipe(&store, "b", &proj, Target { kind: "folder".into(), path: wb.display().to_string() });
        assert_eq!(ra.bags.last().unwrap(), "wiki-a"); // own writable bag on top

        store.sync("a").unwrap();
        store.sync("b").unwrap();
        assert!(wa.join("tiddlywiki.info").exists());
        assert!(wa.join("tiddlers/ZUI.tid").exists());
        assert!(wa.join("tiddlers/Idee.tid").exists());
        // The bundled plugins are in every wiki.
        let wiki_a = read_tiddler_dir(&wa.join("tiddlers"));
        for p in ["$:/plugins/flibbles/graph", "$:/plugins/lasjoh-toho/pinboard", "$:/plugins/lasjoh-toho/kanban", "$:/plugins/tiddlywiki/markdown"] {
            assert!(wiki_a.contains_key(p), "{p} missing");
        }

        // In wiki A: edit the shared glossary entry, rename and edit the card, add a new tiddler.
        fs::write(wa.join("tiddlers/ZUI.tid"), "title: ZUI\n\nZoomable User Interface").unwrap();
        fs::remove_file(wa.join("tiddlers/Idee.tid")).unwrap();
        fs::write(wa.join("tiddlers/Kernidee.tid"), "brausa-id: c_a\nbrausa-map: m_1\nmodified: 20261017120000000\ntitle: Kernidee\n\nneu").unwrap();
        fs::write(wa.join("tiddlers/Neu.tid"), "title: Neu\n\nnur in A").unwrap();
        fs::write(wa.join("tiddlers/$__StoryList.tid"), "title: $:/StoryList\nlist: Neu\n\n").unwrap();
        let rep = store.sync("a").unwrap();
        assert!(rep.conflicts.is_empty(), "{rep:?}");
        assert_eq!(rep.maps.len(), 1);

        // Like the MultiWikiServer: the shared entry is only overlaid in A's own bag.
        assert_eq!(store.bag_tiddlers("glossar").unwrap()["ZUI"].0["text"], "Zoomable UI");
        assert_eq!(store.bag_tiddlers("wiki-a").unwrap()["ZUI"].0["text"], "Zoomable User Interface");
        // Cards still go back into the map; state tiddlers are ignored.
        let m = maps::load(&proj, "m_1").unwrap();
        assert_eq!(m["cards"]["c_a"]["title"], "Kernidee");
        assert_eq!(m["cards"]["c_a"]["text"], "neu");
        assert!(store.bag_tiddlers("wiki-a").unwrap().contains_key("Neu"));
        assert!(!store.bag_tiddlers("wiki-a").unwrap().contains_key("$:/StoryList"));
        assert!(fs::read_to_string(wa.join("tiddlers/Kernidee.tid")).unwrap().contains("modified: 20261017120000000"));

        store.sync("b").unwrap();
        assert!(fs::read_to_string(wb.join("tiddlers/ZUI.tid")).unwrap().contains("Zoomable UI"));
        assert!(read_tiddler_dir(&wb.join("tiddlers")).contains_key("Kernidee"));
        assert!(!wb.join("tiddlers/Neu.tid").exists());

        // B overlays the same entry differently.
        fs::write(wb.join("tiddlers/ZUI.tid"), "title: ZUI\n\nAus B").unwrap();
        store.sync("b").unwrap();
        let ov = store.overlays().unwrap();
        assert_eq!(ov.len(), 1, "{ov:?}");
        assert_eq!((ov[0].title.as_str(), ov[0].bag.as_str(), ov[0].variants.len()), ("ZUI", "glossar", 2));

        // Promote A's version for everyone: the shared bag changes, both overlays go.
        store.resolve_overlay("ZUI", "glossar", Resolve::Promote { recipe: "a".into(), all: true }).unwrap();
        assert_eq!(store.bag_tiddlers("glossar").unwrap()["ZUI"].0["text"], "Zoomable User Interface");
        assert!(store.overlays().unwrap().is_empty());
        store.sync("b").unwrap();
        assert!(fs::read_to_string(wb.join("tiddlers/ZUI.tid")).unwrap().contains("Zoomable User Interface"));

        // Keep marks a deliberate variant; discard drops it and the wiki gets the shared text back.
        fs::write(wb.join("tiddlers/ZUI.tid"), "title: ZUI\n\nNur in B so").unwrap();
        store.sync("b").unwrap();
        store.resolve_overlay("ZUI", "glossar", Resolve::Keep { recipe: "b".into(), keep: true }).unwrap();
        assert!(store.overlays().unwrap()[0].variants[0].kept);
        store.resolve_overlay("ZUI", "glossar", Resolve::Discard { recipe: "b".into() }).unwrap();
        store.sync("b").unwrap();
        assert!(fs::read_to_string(wb.join("tiddlers/ZUI.tid")).unwrap().contains("Zoomable User Interface"));

        // Merge: hand-written text for the shared tiddler.
        fs::write(wa.join("tiddlers/ZUI.tid"), "title: ZUI\n\nA2").unwrap();
        store.sync("a").unwrap();
        store.resolve_overlay("ZUI", "glossar", Resolve::Merge { text: "A2 und B".into() }).unwrap();
        assert_eq!(store.bag_tiddlers("glossar").unwrap()["ZUI"].0["text"], "A2 und B");
        assert!(!store.bag_tiddlers("wiki-a").unwrap().contains_key("ZUI"));

        // Deleting a shared tiddler in a wiki does not delete it for everyone.
        store.sync("a").unwrap();
        fs::remove_file(wa.join("tiddlers/ZUI.tid")).unwrap();
        let rep = store.sync("a").unwrap();
        assert!(rep.deleted.is_empty() && rep.warnings.len() == 1, "{rep:?}");
        assert!(wa.join("tiddlers/ZUI.tid").exists());
        // Deleting the wiki's own tiddler deletes it in its bag.
        fs::remove_file(wa.join("tiddlers/Neu.tid")).unwrap();
        assert_eq!(store.sync("a").unwrap().deleted, ["Neu"]);
    }

    #[test]
    fn read_only_bags_can_not_take_promotions() {
        let (t, store, proj) = setup();
        store.put_bag(&BagInfo { name: "glossar".into(), readonly: true, ..Default::default() }).unwrap();
        let w = t.path().join("w");
        recipe(&store, "a", &proj, Target { kind: "folder".into(), path: w.display().to_string() });
        store.sync("a").unwrap();
        fs::write(w.join("tiddlers/ZUI.tid"), "title: ZUI\n\nanders").unwrap();
        store.sync("a").unwrap();
        assert!(store.resolve_overlay("ZUI", "glossar", Resolve::Promote { recipe: "a".into(), all: false }).is_err());
        store.resolve_overlay("ZUI", "glossar", Resolve::Discard { recipe: "a".into() }).unwrap();
        assert!(store.overlays().unwrap().is_empty());
    }

    #[test]
    fn single_file_wiki_keeps_its_own_tiddlers_and_makes_backups() {
        let (t, store, proj) = setup();
        let file = t.path().join("wiki.html");
        let core = r#"{"title":"$:/core","plugin-type":"plugin","text":"{}"}"#;
        fs::write(
            &file,
            format!("<html><body><script class=\"tiddlywiki-tiddler-store\" type=\"application/json\">[{core},{{\"title\":\"Eigenes\",\"text\":\"bleibt <b>\"}}]</script></body></html>"),
        )
        .unwrap();
        recipe(&store, "einzel", &proj, Target { kind: "file".into(), path: file.display().to_string() });
        store.sync("einzel").unwrap();
        let html = fs::read_to_string(&file).unwrap();
        assert!(!html.contains("bleibt <b>"), "< must be escaped inside the script block");
        let wiki = read_wiki(&Target { kind: "file".into(), path: file.display().to_string() }).unwrap();
        assert_eq!(wiki["Eigenes"].0["text"], "bleibt <b>");
        assert!(wiki.contains_key("$:/core"));
        assert!(wiki.contains_key("ZUI") && wiki.contains_key("Idee"));
        assert!(wiki.contains_key("$:/plugins/lasjoh-toho/pinboard"));
        assert_eq!(fs::read_dir(t.path().join(".backups")).unwrap().count(), 1);

        // An edit saved by the wiki comes back; the plugin is never imported.
        let html = html.replace("Zoomable UI", "Zoomen!");
        fs::write(&file, html).unwrap();
        let rep = store.sync("einzel").unwrap();
        assert_eq!(rep.pulled, ["ZUI"]);
        assert_eq!(store.bag_tiddlers("wiki-einzel").unwrap()["ZUI"].0["text"], "Zoomen!");
        assert!(!store.bag_tiddlers("wiki-einzel").unwrap().contains_key("$:/core"));
    }
}
