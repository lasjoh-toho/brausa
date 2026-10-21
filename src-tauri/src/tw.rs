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
use std::io::{self, Read};
use std::path::{Path, PathBuf};

use crate::maps;

pub type Fields = BTreeMap<String, String>;

const MAP_BAG: &str = "@map:";
/// The empty TiddlyWiki folder wikis are shown in (scripts/build-tw-empty.sh).
const EMPTY_WIKI: &str = include_str!("../resources/tw-empty.html");
/// Where those views are kept, one folder per wiki.
const VIEWS: &str = "views";
/// Built-in, read-only bag with the plugins every brausa wiki needs.
pub const PLUGINS: &str = "@plugins";
/// Shared bag for what stays on this computer: links to local files (generated from
/// the maps' file cards) and notes tagged `lokal` or `privat`. Wikis include it
/// right below their own bag unless switched off (`Recipe::local`).
pub const LOCAL: &str = "lokal";
/// Tags that send a tiddler edited in a wiki to the bag `lokal`.
const LOCAL_TAGS: [&str; 2] = ["lokal", "privat"];
/// brausa's own layer in every wiki: which bag each tiddler comes from (also when it is
/// in several), the bags a tiddler can be saved to, and the edit-mode line showing both.
const INFO: &str = "@brausa";
/// Field set in the wiki's edit mode: the bag a changed tiddler goes to on the next sync.
const SAVE_TO: &str = "brausa-bag";
/// Marks tiddlers brausa generates in `lokal` for linked files.
const GENERATED: &str = "brausa-generated";

/// Plugin tiddlers bundled into brausa (rebuild with scripts/build-tw-plugins.sh).
const BUNDLED_PLUGINS: [&str; 6] = [
    include_str!("../resources/tw-plugins/markdown.json"),
    include_str!("../resources/tw-plugins/graph.json"),
    include_str!("../resources/tw-plugins/vis-network.json"),
    include_str!("../resources/tw-plugins/pinboard.json"),
    include_str!("../resources/tw-plugins/kanban.json"),
    // Renames follow into lists, story fields and Pinboard boards.
    include_str!("../resources/tw-plugins/relink.json"),
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
        || t == "$:/isEncrypted"
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
            // TiddlyVisuals' Pinboard dives from this card into its own board.
            f.insert("pinboard-dive".into(), format!("$:/graph/{map_title}/{}", title_of[*id]));
        }
        if let Some(l) = links.get(*id) {
            f.insert("brausa-links".into(), stringify_list(l));
        }
        for k in ["color", "status"] {
            if !s(c, k).is_empty() {
                f.insert(k.into(), s(c, k));
            }
        }
        // Kept in a wiki bag (Kanban lanes by bag); the edit mode's "save to" shows and changes it.
        if !s(c, "bag").is_empty() {
            f.insert(SAVE_TO.into(), s(c, "bag"));
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
    // Stories (presentation paths) in the Pinboard's format: card stops refer to tiddler titles.
    let story_title = |s: &Value| format!("{map_title} · {}", s.get("title").and_then(Value::as_str).unwrap_or("Story"));
    let stories: Vec<&Value> = map.get("stories").and_then(Value::as_array).map(|a| a.iter().collect()).unwrap_or_default();
    let card_steps = |s: &Value, on: Option<&[&str]>| -> Vec<(String, u64)> {
        s.get("steps")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter(|st| st.get("kind").and_then(Value::as_str) == Some("card"))
            .filter_map(|st| {
                let r = st.get("ref").and_then(Value::as_str)?;
                if on.is_some_and(|ids| !ids.contains(&r)) {
                    return None;
                }
                Some((title_of.get(r)?.clone(), st.get("level").and_then(Value::as_u64).unwrap_or(0)))
            })
            .collect()
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
        let mut pin = serde_json::json!({"version": 1, "cards": sizes});
        if !stories.is_empty() {
            let list: Vec<Value> = stories
                .iter()
                .map(|s| {
                    let steps: Vec<Value> = card_steps(s, Some(ids))
                        .into_iter()
                        .enumerate()
                        .map(|(i, (t, level))| serde_json::json!({"id": format!("s{i}"), "kind": "card", "ref": t, "level": level}))
                        .collect();
                    serde_json::json!({
                        "id": s.get("id").cloned().unwrap_or(Value::Null),
                        "title": s.get("title").cloned().unwrap_or(Value::Null),
                        "color": s.get("color").cloned().unwrap_or(Value::Null),
                        "tiddler": story_title(s),
                        "steps": steps
                    })
                })
                .collect();
            pin["stories"] = Value::Array(list);
            pin["story"] = map.get("story").cloned().unwrap_or(Value::Null);
        }
        g.insert("pinboard".into(), pin.to_string());
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
    // A story tiddler per story: its cards in order, with their outline levels.
    for s in &stories {
        let steps = card_steps(s, None);
        let mut st = Fields::new();
        st.insert("title".into(), story_title(s));
        st.insert("tags".into(), "brausa-story".into());
        st.insert("pinboard-board".into(), format!("$:/graph/{map_title}"));
        st.insert("story".into(), stringify_list(&steps.iter().map(|(t, _)| t.clone()).collect::<Vec<_>>()));
        if steps.iter().any(|(_, l)| *l > 0) {
            st.insert("pinboard-levels".into(), steps.iter().map(|(_, l)| l.to_string()).collect::<Vec<_>>().join(" "));
        }
        st.insert("brausa-story-map".into(), map_id.into());
        st.insert("text".into(), String::new());
        out.push(st);
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
    /// Not offered when a new wiki is put together.
    #[serde(default)]
    pub hidden: bool,
    #[serde(default, skip_deserializing)]
    pub tiddlers: usize,
}

/// A tiddler found by the search across bags.
#[derive(Debug, Clone, Serialize)]
pub struct Hit {
    pub bag: String,
    pub title: String,
    /// Text around the first match (empty when only the title matched).
    pub snippet: String,
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
    /// The same wiki as a single file on the web (compared and uploaded on request).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub web: Option<WebLink>,
    /// The bags uploaded to the web; `None`: all but the maps (cards, snippets) and `lokal`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub web_bags: Option<Vec<String>>,
}

impl Recipe {
    /// Does this layer go to the web wiki on upload?
    pub fn to_web(&self, bag: &str) -> bool {
        if bag == INFO {
            return false;
        }
        match &self.web_bags {
            Some(list) => bag == PLUGINS || list.iter().any(|b| b == bag),
            None => bag != LOCAL && !bag.starts_with(MAP_BAG),
        }
    }
}

/// Address of a wiki on the web; the password is kept apart (`web-secrets.json`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct WebLink {
    pub url: String,
    #[serde(default)]
    pub user: String,
}

/// A tiddler that is new or different on the web.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebChange {
    pub title: String,
    pub web_modified: Option<String>,
    pub local_modified: Option<String>,
    /// Start of the text on the web and here (here: empty for new tiddlers).
    pub web_text: String,
    pub local_text: String,
}

/// A plugin of the web wiki that brausa does not bring.
#[derive(Debug, Clone, Serialize)]
pub struct WebPlugin {
    pub title: String,
    pub version: String,
    /// Already in the bag `plugins` (same version).
    pub have: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebPreview {
    pub new: Vec<WebChange>,
    pub changed: Vec<WebChange>,
    pub plugins: Vec<WebPlugin>,
    pub has_password: bool,
}

/// Writable bag for plugins of one's own (from web wikis), right above `@plugins`.
pub const OWN_PLUGINS: &str = "plugins";

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

    /// Tiddlers whose title, text or tags contain every word of `query` (case-insensitive), in all bags
    /// except the bundled plugins; at most `limit`.
    pub fn search(&self, query: &str, limit: usize) -> Vec<Hit> {
        let words: Vec<String> = query.to_lowercase().split_whitespace().map(String::from).collect();
        if words.is_empty() {
            return vec![];
        }
        let mut out = vec![];
        for b in self.bags().into_iter().filter(|b| !b.name.starts_with('@')) {
            for (title, (f, _)) in self.bag_tiddlers(&b.name).unwrap_or_default() {
                let text = f.get("text").map(String::as_str).unwrap_or("");
                let (lt, lx) = (title.to_lowercase(), text.to_lowercase());
                let tags = f.get("tags").map(|t| t.to_lowercase()).unwrap_or_default();
                if !words.iter().all(|w| lt.contains(w) || lx.contains(w) || tags.contains(w)) {
                    continue;
                }
                let snippet = lx
                    .find(&words[0])
                    .map(|i| {
                        let chars: Vec<char> = text.chars().collect();
                        let at = lx[..i].chars().count();
                        let from = at.saturating_sub(40);
                        let to = (at + 80).min(chars.len());
                        chars[from..to].iter().collect::<String>().replace('\n', " ")
                    })
                    .unwrap_or_default();
                out.push(Hit { bag: b.name.clone(), title, snippet });
                if out.len() >= limit {
                    return out;
                }
            }
        }
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

    /// The recipe's view: title → (fields, bag); later bags win. brausa's info layer
    /// (bag of each tiddler, bags to save to, edit-mode line) comes last.
    fn merged(&self, r: &Recipe) -> io::Result<BTreeMap<String, (Fields, String)>> {
        let mut out = BTreeMap::new();
        let mut bags_of: BTreeMap<String, Vec<String>> = BTreeMap::new();
        let names = Self::layer_names(r);
        let mut layers: Vec<(String, BTreeMap<String, Fields>)> = names.iter().map(|b| Ok((b.clone(), self.layer(b)?))).collect::<io::Result<_>>()?;
        // Map cards kept in one of the wiki's bags appear in that bag's layer.
        let mut moved: Vec<(String, Fields)> = vec![];
        for (b, l) in layers.iter_mut().filter(|(b, _)| b.starts_with(MAP_BAG)) {
            let away: Vec<String> =
                l.iter().filter(|(_, f)| f.get(SAVE_TO).map(|x| x != b && !x.starts_with('@') && names.contains(x)).unwrap_or(false)).map(|(t, _)| t.clone()).collect();
            moved.extend(away.into_iter().filter_map(|t| l.remove(&t)).map(|f| (f[SAVE_TO].clone(), f)));
        }
        for (bag, f) in moved {
            if let Some((_, l)) = layers.iter_mut().find(|(b, _)| *b == bag) {
                l.entry(f["title"].clone()).or_insert(f);
            }
        }
        for (b, layer) in layers {
            let label = self.bag_label(&b);
            for (t, f) in layer {
                if b != PLUGINS {
                    bags_of.entry(t.clone()).or_default().push(label.clone());
                }
                out.insert(t, (f, b.clone()));
            }
        }
        let writable: Vec<String> = r.bags.iter().filter(|b| !self.bag_readonly(b)).cloned().chain(r.local.then(|| LOCAL.to_string())).collect();
        for f in info_tiddlers(&bags_of, &writable, r.bags.last().map(String::as_str).unwrap_or("")) {
            out.insert(f["title"].clone(), (f, INFO.to_string()));
        }
        Ok(out)
    }

    /// A bag's name as the wiki shows it (a map bag by its map's title).
    fn bag_label(&self, bag: &str) -> String {
        if let Some(spec) = bag.strip_prefix(MAP_BAG) {
            if let Some((root, id)) = spec.split_once('|') {
                if let Ok(m) = maps::load(Path::new(root), id) {
                    return format!("Map {}", m.get("title").and_then(Value::as_str).unwrap_or(id));
                }
            }
        }
        bag.to_string()
    }

    /// Each layer of a wiki with its tiddler titles, bottom first (for the layer view).
    pub fn layers(&self, name: &str) -> io::Result<Vec<(String, Vec<String>)>> {
        let r = self.recipes().into_iter().find(|x| x.name == name).ok_or_else(|| err(crate::tr!(format!("Wiki „{name}“ gibt es nicht"), format!("There is no wiki “{name}”"))))?;
        Self::layer_names(&r).into_iter().map(|b| Ok((b.clone(), self.layer(&b).map(|l| l.into_keys().collect()).unwrap_or_default()))).collect()
    }

    // ------------------------------------------------------------ wikis on the web

    // ------------------------------------------------------------ the wiki in brausa's web panel

    /// The wiki as one HTML file for the web panel: a single-file wiki is that file; a folder
    /// wiki is put into the bundled empty TiddlyWiki (saving it goes back into the folder).
    pub fn view(&self, name: &str) -> io::Result<PathBuf> {
        let r = self.recipe(name)?;
        if r.target.kind == "file" {
            return Ok(PathBuf::from(&r.target.path));
        }
        let mut tiddlers: Vec<Fields> = read_wiki(&r.target)?.into_values().map(|(f, _)| f).collect();
        if !tiddlers.iter().any(|f| f["title"] == "$:/language") && !crate::i18n::en() {
            tiddlers.push([("title", "$:/language"), ("text", "$:/languages/de-DE")].iter().map(|(k, v)| (k.to_string(), v.to_string())).collect());
        }
        let dir = self.dir.join(VIEWS).join(filename(name));
        fs::create_dir_all(&dir)?;
        let p = dir.join("index.html");
        fs::write(&p, with_store(EMPTY_WIKI, &tiddlers)?)?;
        // What the view shows, to tell the user's changes from changes made in the folder meanwhile.
        let shown: BTreeMap<&String, String> = tiddlers.iter().map(|f| (&f["title"], hash(f))).collect();
        fs::write(dir.join("shown.json"), serde_json::to_vec(&shown)?)?;
        Ok(p)
    }

    /// A wiki saved itself in the web panel. A folder wiki's view goes back into its folder:
    /// changed tiddlers are written, deleted ones removed. Returns the wiki's name.
    pub fn saved_view(&self, file: &Path) -> io::Result<Option<String>> {
        let views = self.dir.join(VIEWS);
        let (Ok(file), Ok(views)) = (file.canonicalize(), views.canonicalize()) else { return Ok(None) };
        let Some(folder) = file.parent().filter(|d| d.parent() == Some(views.as_path())).and_then(|d| d.file_name()).map(|n| n.to_string_lossy().to_string()) else {
            return Ok(None);
        };
        let Some(r) = self.recipes().into_iter().find(|r| filename(&r.name) == folder && r.target.kind == "folder") else { return Ok(None) };
        let html = fs::read_to_string(&file)?;
        let saved = tiddlers_in(&html)?;
        let shown_file = file.with_file_name("shown.json");
        let shown: BTreeMap<String, String> = fs::read(&shown_file).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
        let dir = Path::new(&r.target.path).join("tiddlers");
        fs::create_dir_all(&dir)?;
        let keep = |f: &Fields| !ignored(f) && !f.contains_key("draft.of");
        let before = read_tiddler_dir(&dir);
        // Written: what was changed or added in the view (untouched tiddlers keep the folder's version).
        for f in saved.values().filter(|f| keep(f)) {
            if shown.get(&f["title"]) == Some(&hash(f)) {
                continue;
            }
            let old = before.get(&f["title"]);
            if old.map(|(o, _)| o != f).unwrap_or(true) {
                write_tiddler(&dir, old.map(|(_, p)| p.clone()), f)?;
            }
        }
        // Deleted: what the view showed and no longer has, unless it changed in the folder since.
        for (title, (f, path)) in &before {
            if !saved.contains_key(title) && shown.get(title) == Some(&hash(f)) && keep(f) && !path.as_os_str().is_empty() {
                fs::remove_file(path)?;
            }
        }
        let now: BTreeMap<&String, String> = saved.iter().map(|(t, f)| (t, hash(f))).collect();
        fs::write(&shown_file, serde_json::to_vec(&now)?)?;
        Ok(Some(r.name))
    }

    fn recipe(&self, name: &str) -> io::Result<Recipe> {
        self.recipes().into_iter().find(|x| x.name == name).ok_or_else(|| err(crate::tr!(format!("Wiki „{name}“ gibt es nicht"), format!("There is no wiki “{name}”"))))
    }

    fn secrets_file(&self) -> PathBuf {
        self.dir.join("web-secrets.json")
    }

    fn secrets(&self) -> BTreeMap<String, String> {
        fs::read(self.secrets_file()).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
    }

    /// Store (or with `None` forget) the password for uploading a wiki to the web.
    pub fn set_web_password(&self, name: &str, password: Option<&str>) -> io::Result<()> {
        let mut s = self.secrets();
        match password.filter(|p| !p.is_empty()) {
            Some(p) => s.insert(name.to_string(), p.to_string()),
            None => s.remove(name),
        };
        let f = self.secrets_file();
        fs::write(&f, serde_json::to_vec(&s)?)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(&f, fs::Permissions::from_mode(0o600));
        }
        Ok(())
    }

    pub fn has_web_password(&self, name: &str) -> bool {
        self.secrets().contains_key(name)
    }

    fn web_cache(&self, name: &str) -> PathBuf {
        self.dir.join("web").join(format!("{}.html", filename(name)))
    }

    fn tmp_bag(name: &str) -> String {
        format!("web-tmp-{name}")
    }

    fn download(url: &str) -> io::Result<String> {
        let resp = ureq::get(url)
            .timeout(std::time::Duration::from_secs(60))
            .call()
            .map_err(|e| err(crate::tr!(format!("Web-Wiki nicht erreichbar: {e}"), format!("Web wiki not reachable: {e}"))))?;
        let mut s = String::new();
        resp.into_reader().take(200 << 20).read_to_string(&mut s)?;
        Ok(s)
    }

    /// Load the web version into a temporary bag and list what is new or different there.
    pub fn web_fetch(&self, name: &str) -> io::Result<WebPreview> {
        let r = self.recipe(name)?;
        let link = r.web.clone().ok_or_else(|| err(crate::tr!("Für dieses Wiki ist keine Webadresse eingetragen", "No web address is set for this wiki")))?;
        let html = Self::download(&link.url)?;
        let web = crate::webwiki::tiddlers(&html);
        if web.is_empty() {
            return Err(err(crate::tr!("Unter der Adresse liegt kein TiddlyWiki", "There is no TiddlyWiki at that address")));
        }
        let cache = self.web_cache(name);
        fs::create_dir_all(cache.parent().unwrap())?;
        fs::write(&cache, &html)?;
        // The temporary bag holds the web tiddlers until the user decided.
        let tmp = Self::tmp_bag(name);
        let _ = fs::remove_dir_all(self.bag_dir(&tmp)?);
        self.put_bag(&BagInfo { name: tmp.clone(), description: crate::tr!("Web-Version (vorübergehend)", "Web version (temporary)").into(), hidden: true, ..Default::default() })?;
        let here = self.merged(&r)?;
        let bundled = self.layer(PLUGINS)?;
        let own_plugins = self.bag_tiddlers(OWN_PLUGINS).unwrap_or_default();
        let short = |s: &str| s.chars().take(400).collect::<String>();
        let mut preview = WebPreview { new: vec![], changed: vec![], plugins: vec![], has_password: self.has_web_password(name) };
        for (title, f) in &web {
            if crate::webwiki::ephemeral(title) {
                continue;
            }
            if f.contains_key("plugin-type") {
                if bundled.contains_key(title) {
                    continue;
                }
                let version = f.get("version").cloned().unwrap_or_default();
                let have = own_plugins.get(title).is_some_and(|(o, _)| o.get("version") == f.get("version"));
                self.put_tiddler(&tmp, f)?;
                preview.plugins.push(WebPlugin { title: title.clone(), version, have });
                continue;
            }
            let change = |local: Option<&Fields>| WebChange {
                title: title.clone(),
                web_modified: f.get("modified").cloned(),
                local_modified: local.and_then(|l| l.get("modified").cloned()),
                web_text: short(f.get("text").map(String::as_str).unwrap_or("")),
                local_text: local.map(|l| short(l.get("text").map(String::as_str).unwrap_or(""))).unwrap_or_default(),
            };
            match here.get(title) {
                None => {
                    self.put_tiddler(&tmp, f)?;
                    preview.new.push(change(None));
                }
                Some((l, _)) if ["text", "tags", "type", "caption"].iter().any(|k| l.get(*k).map(String::as_str).unwrap_or("") != f.get(*k).map(String::as_str).unwrap_or("")) => {
                    self.put_tiddler(&tmp, f)?;
                    preview.changed.push(change(Some(l)));
                }
                _ => {}
            }
        }
        Ok(preview)
    }

    /// Take the chosen tiddlers into the wiki's own bag and the chosen plugins into `plugins`;
    /// the temporary bag goes away. Returns how many tiddlers came over.
    pub fn web_apply(&self, name: &str, titles: &[String], plugins: &[String]) -> io::Result<usize> {
        let mut r = self.recipe(name)?;
        let tmp = self.bag_tiddlers(&Self::tmp_bag(name))?;
        let own = r.bags.last().cloned().ok_or_else(|| err("Wiki ohne Bag"))?;
        let mut n = 0;
        for t in titles {
            if let Some((f, _)) = tmp.get(t) {
                self.put_tiddler(&own, f)?;
                n += 1;
            }
        }
        if !plugins.is_empty() {
            if !self.bag_dir(OWN_PLUGINS)?.exists() {
                self.put_bag(&BagInfo { name: OWN_PLUGINS.into(), description: crate::tr!("Eigene Plugins (aus Web-Wikis), über den mitgelieferten", "Own plugins (from web wikis), above the bundled ones").into(), ..Default::default() })?;
            }
            for t in plugins {
                if let Some((f, _)) = tmp.get(t) {
                    self.put_tiddler(OWN_PLUGINS, f)?;
                }
            }
            if !r.bags.iter().any(|b| b == OWN_PLUGINS) {
                r.bags.insert(0, OWN_PLUGINS.into());
                self.put_recipe(r)?;
            }
        }
        self.web_discard(name)?;
        Ok(n)
    }

    /// A snippet, note or card dropped onto a wiki: a tiddler in the wiki's own bag, under a free title.
    pub fn add_to_wiki(&self, name: &str, mut f: Fields) -> io::Result<String> {
        let r = self.recipe(name)?;
        let own = r.bags.last().cloned().ok_or_else(|| err("Wiki ohne Bag"))?;
        let have = self.bag_tiddlers(&own)?;
        let base = f.get("title").map(|t| t.trim().replace(['[', ']', '|', '{', '}'], "")).filter(|t| !t.is_empty()).unwrap_or_else(|| "Snippet".into());
        let mut title = base.clone();
        let mut n = 2;
        while have.contains_key(&title) {
            title = format!("{base} {n}");
            n += 1;
        }
        let now = chrono::Utc::now().format("%Y%m%d%H%M%S%3f").to_string();
        f.insert("title".into(), title.clone());
        f.entry("created".into()).or_insert_with(|| now.clone());
        f.insert("modified".into(), now);
        self.put_tiddler(&own, &f)?;
        Ok(title)
    }

    /// Throw the temporary bag of a web comparison away.
    pub fn web_discard(&self, name: &str) -> io::Result<()> {
        let d = self.bag_dir(&Self::tmp_bag(name))?;
        if d.exists() {
            fs::remove_dir_all(d)?;
        }
        Ok(())
    }

    /// Upload the wiki as a new version of the web file (HTTP PUT, e.g. WebDAV) with the stored password.
    /// Notes of the bag `lokal` and tiddlers tagged lokal/privat stay on this computer.
    pub fn web_upload(&self, name: &str) -> io::Result<()> {
        let r = self.recipe(name)?;
        let link = r.web.clone().ok_or_else(|| err(crate::tr!("Für dieses Wiki ist keine Webadresse eingetragen", "No web address is set for this wiki")))?;
        let password = self.secrets().get(name).cloned().ok_or_else(|| err(crate::tr!("Kein Passwort gespeichert: nur abgleichen, nicht hochladen", "No password stored: compare only, no upload")))?;
        let cache = self.web_cache(name);
        let html = match fs::read_to_string(&cache) {
            Ok(h) => h,
            Err(_) => Self::download(&link.url)?,
        };
        let mut all = crate::webwiki::tiddlers(&html);
        for (title, (f, bag)) in self.merged(&r)? {
            let private = !r.to_web(&bag) || parse_list(f.get("tags").map(String::as_str).unwrap_or("")).iter().any(|t| LOCAL_TAGS.contains(&t.to_lowercase().as_str()));
            if !private {
                all.insert(title, f);
            }
        }
        let out = crate::webwiki::with_tiddlers(&html, &all).ok_or_else(|| err(crate::tr!("Das Web-Wiki hat ein unbekanntes Format", "The web wiki has an unknown format")))?;
        ureq::put(&link.url)
            .timeout(std::time::Duration::from_secs(120))
            .set("Authorization", &crate::webwiki::basic_auth(&link.user, &password))
            .set("Content-Type", "text/html;charset=utf-8")
            .send_string(&out)
            .map_err(|e| err(crate::tr!(format!("Hochladen fehlgeschlagen: {e}"), format!("Upload failed: {e}"))))?;
        fs::write(cache, out)?;
        Ok(())
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
                // Chosen in the wiki's edit mode ("save to"): that bag, if it may be written.
                let chosen = f.get(SAVE_TO).filter(|b| (r.bags.contains(b) && !self.bag_readonly(b)) || (r.local && *b == LOCAL)).cloned();
                let bag = chosen.unwrap_or_else(|| if private { LOCAL.to_string() } else { top.clone() });
                let mut f = f.clone();
                f.remove(SAVE_TO);
                let f = &f;
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
                let card = before.get(title).map(|(f, _)| f.contains_key("brausa-map")).unwrap_or(false);
                if wiki.contains_key(title) || bag == PLUGINS || bag == INFO || bag.starts_with(MAP_BAG) || card {
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
        for (k, field) in [("title", "title"), ("text", "text"), ("color", "color"), ("status", "status"), ("bag", SAVE_TO)] {
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

/// The tiddlers of a single-file wiki's HTML (later stores win, as in TiddlyWiki).
fn tiddlers_in(html: &str) -> io::Result<BTreeMap<String, Fields>> {
    let mut out = BTreeMap::new();
    for (start, end) in store_blocks(html) {
        let v: Value = serde_json::from_str(&html[start..end]).map_err(|e| err(format!("Tiddler-Speicher unlesbar: {e}")))?;
        for f in v.as_array().into_iter().flatten().filter_map(fields_from_json) {
            out.insert(f["title"].clone(), f);
        }
    }
    Ok(out)
}

/// `html` (a TiddlyWiki) with one more tiddler store after its last one.
fn with_store(html: &str, tiddlers: &[Fields]) -> io::Result<String> {
    let end = store_blocks(html).last().map(|(_, e)| *e).ok_or_else(|| err("Kein Tiddler-Speicher in der Vorlage"))?;
    let close = end + "</script>".len();
    // As TiddlyWiki writes it: "<" escaped, so the JSON can not end the script element.
    let json = serde_json::to_string(tiddlers)?.replace('<', "\\u003C");
    Ok(format!("{}\n<script class=\"tiddlywiki-tiddler-store\" type=\"application/json\">{json}</script>{}", &html[..close], &html[close..]))
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

    #[test]
    fn stories_become_pinboard_stories_and_story_tiddlers() {
        let m = json!({"id": "m_1", "title": "Plan", "roots": ["c_a", "c_b"],
            "cards": {
                "c_a": {"id": "c_a", "title": "Start", "text": "", "x": 0, "y": 0, "w": 100, "h": 50, "parent": null, "children": ["c_c"]},
                "c_b": {"id": "c_b", "title": "Ende", "text": "", "x": 0, "y": 0, "w": 100, "h": 50, "parent": null, "children": []},
                "c_c": {"id": "c_c", "title": "Detail", "text": "", "x": 0, "y": 0, "w": 100, "h": 50, "parent": "c_a", "children": []}
            },
            "links": [],
            "stories": [{"id": "s1", "title": "Vortrag", "color": "#e0503f", "steps": [
                {"id": "t1", "kind": "card", "ref": "c_a"}, {"id": "t2", "kind": "card", "ref": "c_c", "level": 1},
                {"id": "t3", "kind": "view", "cam": {"x": 0, "y": 0, "z": 1}}, {"id": "t4", "kind": "card", "ref": "c_b"}]}],
            "story": "s1"});
        let ts = map_tiddlers(&m);
        let story = ts.iter().find(|t| t["title"] == "Plan · Vortrag").unwrap();
        assert_eq!(story["story"], "Start Detail Ende");
        assert_eq!(story["pinboard-levels"], "0 1 0");
        assert_eq!(story["pinboard-board"], "$:/graph/Plan");
        assert!(!story.contains_key("brausa-map"), "the story tiddler is no card of the board");
        let board = ts.iter().find(|t| t["title"] == "$:/graph/Plan").unwrap();
        let pin: Value = serde_json::from_str(&board["pinboard"]).unwrap();
        let refs: Vec<&str> = pin["stories"][0]["steps"].as_array().unwrap().iter().map(|s| s["ref"].as_str().unwrap()).collect();
        assert_eq!(refs, ["Start", "Ende"], "the root board only stops at its own cards");
        assert_eq!(pin["stories"][0]["tiddler"], "Plan · Vortrag");
        let start = ts.iter().find(|t| t["title"] == "Start").unwrap();
        assert_eq!(start["pinboard-dive"], "$:/graph/Plan/Start", "a card with cards inside dives into its board");
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

    #[test]
    fn compares_with_the_web_version_and_uploads() {
        let (_t, store, proj) = setup();
        // A tiny web server: serves the wiki file and takes the upload.
        let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
        let port = server.server_addr().to_ip().unwrap().port();
        let store_tag = "<script class=\"tiddlywiki-tiddler-store\" type=\"application/json\">";
        let html = format!(
            "<html>{store_tag}[{{\"title\":\"ZUI\",\"text\":\"Zoomable UI, im Web ergänzt\"}},{{\"title\":\"Neu\",\"text\":\"aus dem Web\"}},{{\"title\":\"$:/StoryList\",\"list\":\"Neu\"}},{{\"title\":\"$:/plugins/x/y\",\"plugin-type\":\"plugin\",\"version\":\"1.0\",\"text\":\"{{}}\"}}]</script></html>"
        );
        let uploaded = std::sync::Arc::new(std::sync::Mutex::new(String::new()));
        let up = uploaded.clone();
        let h = html.clone();
        std::thread::spawn(move || {
            for mut req in server.incoming_requests() {
                if req.method() == &tiny_http::Method::Put {
                    let auth = req.headers().iter().find(|x| x.field.equiv("Authorization")).map(|x| x.value.to_string()).unwrap_or_default();
                    let mut body = String::new();
                    req.as_reader().read_to_string(&mut body).unwrap();
                    *up.lock().unwrap() = format!("{auth}\n{body}");
                    let _ = req.respond(tiny_http::Response::empty(204));
                } else {
                    let _ = req.respond(tiny_http::Response::from_string(h.clone()));
                }
            }
        });
        let mut r = recipe(&store, "W", &proj, Target { kind: "folder".into(), path: proj.join("wiki").display().to_string() });
        r.web = Some(WebLink { url: format!("http://127.0.0.1:{port}/wiki.html"), user: "ich".into() });
        store.put_recipe(r.clone()).unwrap();

        let p = store.web_fetch("W").unwrap();
        assert_eq!(p.new.iter().map(|c| c.title.as_str()).collect::<Vec<_>>(), ["Neu"]);
        assert_eq!(p.changed.iter().map(|c| c.title.as_str()).collect::<Vec<_>>(), ["ZUI"]);
        assert_eq!(p.plugins.len(), 1);
        assert!(!p.has_password);
        assert!(store.bag_dir("web-tmp-W").unwrap().exists());

        assert_eq!(store.web_apply("W", &["Neu".into()], &["$:/plugins/x/y".into()]).unwrap(), 1);
        assert!(!store.bag_dir("web-tmp-W").unwrap().exists(), "temporary bag is gone");
        let own = store.recipe("W").unwrap();
        assert_eq!(own.bags[0], OWN_PLUGINS, "plugins bag sits right above @plugins");
        assert!(store.bag_tiddlers(own.bags.last().unwrap()).unwrap().contains_key("Neu"));
        assert!(store.bag_tiddlers(OWN_PLUGINS).unwrap().contains_key("$:/plugins/x/y"));

        assert!(store.web_upload("W").is_err(), "no password, no upload");
        store.set_web_password("W", Some("geheim")).unwrap();
        store.put_tiddler(LOCAL, &f(&[("title", "Privat"), ("text", "bleibt hier")])).unwrap();
        store.web_upload("W").unwrap();
        let sent = uploaded.lock().unwrap().clone();
        assert!(sent.starts_with(&crate::webwiki::basic_auth("ich", "geheim")));
        let t = crate::webwiki::tiddlers(&sent);
        assert!(t.contains_key("Neu"));
        assert_eq!(t["ZUI"]["text"], "Zoomable UI", "the wiki's version goes up");
        assert!(!t.contains_key("Privat"), "lokal stays on this computer");
    }

    #[test]
    fn searches_titles_and_texts_in_all_bags() {
        let (_t, store, _) = setup();
        store.put_tiddler("glossar", &f(&[("title", "Kanban"), ("text", "Spalten für den Status einer Karte")])).unwrap();
        let hits = store.search("zoomable", 10);
        assert_eq!(hits.len(), 1);
        assert_eq!((hits[0].bag.as_str(), hits[0].title.as_str()), ("glossar", "ZUI"));
        assert!(hits[0].snippet.contains("Zoomable"));
        assert_eq!(store.search("status karte", 10).len(), 1, "every word must match");
        assert_eq!(store.search("kanban", 10)[0].snippet, "", "a title match has no text snippet");
        assert!(store.search("  ", 10).is_empty());
        store.put_tiddler("glossar", &f(&[("title", "Pinboard"), ("tags", "Glossar"), ("text", "")])).unwrap();
        assert_eq!(store.search("glossar", 10)[0].title, "Pinboard", "tags count too");
    }

    #[test]
    fn dropped_snippets_go_into_the_wiki_bag_under_a_free_title() {
        let (t, store, proj) = setup();
        recipe(&store, "Uni", &proj, Target { kind: "folder".into(), path: t.path().join("out").to_string_lossy().to_string() });
        let first = store.add_to_wiki("Uni", f(&[("title", "Zitat [1]"), ("text", "eins")])).unwrap();
        let second = store.add_to_wiki("Uni", f(&[("title", "Zitat [1]"), ("text", "zwei")])).unwrap();
        assert_eq!((first.as_str(), second.as_str()), ("Zitat 1", "Zitat 1 2"));
        let own = store.recipe("Uni").unwrap().bags.last().cloned().unwrap();
        let bag = store.bag_tiddlers(&own).unwrap();
        assert_eq!(bag["Zitat 1 2"].0["text"], "zwei");
        assert_eq!(bag["Zitat 1"].0["modified"].len(), 17, "TiddlyWiki date");
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
                web: None,
                web_bags: None,
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
    fn edit_mode_shows_bags_and_saves_into_the_chosen_one() {
        let (t, store, proj) = setup();
        let wa = t.path().join("wiki-a");
        let r = recipe(&store, "a", &proj, Target { kind: "folder".into(), path: wa.display().to_string() });
        store.sync("a").unwrap();
        // The info layer: where each tiddler comes from, where it can be saved to, the edit-mode line.
        let wiki = read_tiddler_dir(&wa.join("tiddlers"));
        let bags: Value = serde_json::from_str(&wiki["$:/brausa/bags"].0["text"]).unwrap();
        assert_eq!(bags["ZUI"], "glossar");
        assert_eq!(bags["Idee"], "[[Map Plan]]");
        assert_eq!(parse_list(&wiki["$:/brausa/writable"].0["list"]), ["glossar", "wiki-a"]);
        assert!(wiki["$:/brausa/ui/EditTemplate/bag"].0["tags"].contains("$:/tags/EditTemplate"));
        // A new tiddler saved to the shared bag instead of the wiki's own one; the choice is not stored.
        fs::write(wa.join("tiddlers/Begriff.tid"), "brausa-bag: glossar\ntitle: Begriff\n\nfür alle").unwrap();
        store.sync("a").unwrap();
        let g = store.bag_tiddlers("glossar").unwrap();
        assert_eq!(g["Begriff"].0["text"], "für alle");
        assert!(!g["Begriff"].0.contains_key(SAVE_TO));
        assert!(!store.bag_tiddlers("wiki-a").unwrap().contains_key("Begriff"));
        // The edit-mode line now names the shared bag.
        let wiki = read_tiddler_dir(&wa.join("tiddlers"));
        let bags: Value = serde_json::from_str(&wiki["$:/brausa/bags"].0["text"]).unwrap();
        assert_eq!(bags["Begriff"], "glossar");
        // Maps (cards, snippets), lokal and the info layer stay off the web unless chosen.
        assert!(r.to_web("glossar") && r.to_web("wiki-a") && r.to_web(PLUGINS));
        assert!(!r.to_web(LOCAL) && !r.to_web(&r.bags[1]) && !r.to_web(INFO));
        let chosen = Recipe { web_bags: Some(vec![r.bags[1].clone()]), ..r.clone() };
        assert!(chosen.to_web(&r.bags[1]) && !chosen.to_web("glossar"));
    }

    #[test]
    fn map_cards_kept_in_a_bag_show_there_and_move_in_edit_mode() {
        let (t, store, proj) = setup();
        let wa = t.path().join("wiki-a");
        let r = recipe(&store, "a", &proj, Target { kind: "folder".into(), path: wa.display().to_string() });
        let mut m = maps::load(&proj, "m_1").unwrap();
        let id = m["cards"].as_object().unwrap().iter().find(|(_, c)| c["title"] == "Idee").map(|(k, _)| k.clone()).unwrap();
        m["cards"][&id]["bag"] = json!("glossar");
        maps::save(&proj, &m).unwrap();
        // The card is in the bag glossar now (and goes to the web with it).
        let merged = store.merged(&r).unwrap();
        assert_eq!(merged["Idee"].1, "glossar");
        assert!(r.to_web(&merged["Idee"].1));
        store.sync("a").unwrap();
        let wiki = read_tiddler_dir(&wa.join("tiddlers"));
        let bags: Value = serde_json::from_str(&wiki["$:/brausa/bags"].0["text"]).unwrap();
        assert_eq!(bags["Idee"], "glossar");
        // "Save to" the default in the wiki: back in the map's own bag; the card file is not touched.
        let mut f = wiki["Idee"].0.clone();
        f.remove(SAVE_TO);
        write_tiddler(&wa.join("tiddlers"), Some(wiki["Idee"].1.clone()), &f).unwrap();
        store.sync("a").unwrap();
        assert!(maps::load(&proj, "m_1").unwrap()["cards"][&id]["bag"].is_null());
        assert!(!store.bag_tiddlers("glossar").unwrap().contains_key("Idee"));
        assert!(store.merged(&r).unwrap()["Idee"].1.starts_with(MAP_BAG));
    }

    #[test]
    fn folder_wiki_opens_in_the_bundled_tiddlywiki_and_saves_back() {
        let (t, store, proj) = setup();
        let wa = t.path().join("wiki-a");
        recipe(&store, "a", &proj, Target { kind: "folder".into(), path: wa.display().to_string() });
        store.sync("a").unwrap();
        let view = store.view("a").unwrap();
        let html = fs::read_to_string(&view).unwrap();
        let shown = tiddlers_in(&html).unwrap();
        assert!(shown.contains_key("$:/core") && shown.contains_key("ZUI") && shown.contains_key("Idee"));
        // Meanwhile a new tiddler arrives in the folder (a sync): saving the view must not delete it.
        fs::write(wa.join("tiddlers/Neu.tid"), "title: Neu\n\nvom Abgleich").unwrap();
        // In the view: one tiddler edited, one added, one deleted; a draft and state stay out.
        let mut list: Vec<Fields> = shown.values().filter(|f| f["title"] != "Idee").cloned().collect();
        list.iter_mut().find(|f| f["title"] == "ZUI").unwrap().insert("text".into(), "geändert".into());
        for (title, extra) in [("Eigen", None), ("Draft of 'Eigen'", Some("Eigen")), ("$:/state/x", None), ("$:/isEncrypted", None)] {
            let mut f: Fields = [("title".to_string(), title.to_string()), ("text".to_string(), "x".to_string())].into();
            if let Some(d) = extra {
                f.insert("draft.of".into(), d.into());
            }
            list.push(f);
        }
        let html = format!("<html><script class=\"tiddlywiki-tiddler-store\" type=\"application/json\">{}</script></html>", serde_json::to_string(&list).unwrap().replace('<', "\\u003C"));
        fs::write(&view, html).unwrap();
        assert_eq!(store.saved_view(&view).unwrap().as_deref(), Some("a"));
        let folder = read_tiddler_dir(&wa.join("tiddlers"));
        assert_eq!(folder["ZUI"].0["text"], "geändert");
        assert!(folder.contains_key("Eigen") && folder.contains_key("Neu"));
        assert!(!folder.contains_key("Idee") && !folder.contains_key("Draft of 'Eigen'") && !folder.contains_key("$:/state/x") && !folder.contains_key("$:/isEncrypted"));
        // Any other page saving itself is not a wiki view.
        assert_eq!(store.saved_view(&proj).unwrap(), None);
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

/// brausa's info layer: `$:/brausa/bags` (title → the bags holding it, lowest first),
/// `$:/brausa/writable` (bags a tiddler can be saved to) and the edit-mode line.
fn info_tiddlers(bags_of: &BTreeMap<String, Vec<String>>, writable: &[String], default: &str) -> Vec<Fields> {
    let index: serde_json::Map<String, Value> =
        bags_of.iter().filter(|(t, _)| !t.starts_with("$:/brausa/")).map(|(t, b)| (t.clone(), Value::String(stringify_list(b)))).collect();
    let f = |pairs: &[(&str, &str)]| -> Fields { pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect() };
    let (bag, also, save, new, std) = (
        crate::tr!("Bag", "Bag"),
        crate::tr!("auch in", "also in"),
        crate::tr!("Speichern in", "Save to"),
        crate::tr!("Neuer Tiddler", "New tiddler"),
        crate::tr!("Standard", "Default"),
    );
    let template = format!(
        r#"\whitespace trim
<$let brausaTitle={{{{{{ [{{!!draft.of}}] ~[{{!!title}}] }}}}}} brausaBags={{{{{{ [{{$:/brausa/bags}}jsonget<brausaTitle>] }}}}}}>
<div class="brausa-bag" style="font-size:.85em;opacity:.8;margin:.3em 0;">
<%if [<brausaBags>!is[blank]] %>
{bag}: <$list filter="[enlist<brausaBags>last[]]" variable="b"><code><$text text=<<b>>/></code></$list>
<%if [enlist<brausaBags>count[]compare:number:gt[1]] %> · {also}: <$list filter="[enlist<brausaBags>butlast[]]" variable="b" join=", "><code><$text text=<<b>>/></code></$list><%endif%>
<%else%>{new}<%endif%>
 · {save}: <$select field="brausa-bag" default=""><option value="">{std} ({default})</option><$list filter="[enlist{{$:/brausa/writable!!list}}]" variable="b"><option value=<<b>>><$text text=<<b>>/></option></$list></$select>
</div>
</$let>"#
    );
    vec![
        f(&[("title", "$:/brausa/bags"), ("type", "application/json"), ("text", &serde_json::to_string(&index).unwrap_or_default())]),
        f(&[("title", "$:/brausa/writable"), ("list", &stringify_list(writable)), ("text", "")]),
        f(&[("title", "$:/brausa/ui/EditTemplate/bag"), ("tags", "$:/tags/EditTemplate"), ("list-after", "$:/core/ui/EditTemplate/title"), ("text", &template)]),
    ]
}
