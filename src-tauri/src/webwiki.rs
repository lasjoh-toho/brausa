//! Single-file TiddlyWiki on the web: read its tiddlers from the HTML, and
//! write a new version of the HTML with changed tiddlers.
//!
//! Two store formats exist: since TiddlyWiki 5.2 the tiddlers are JSON in
//! `<script class="tiddlywiki-tiddler-store" type="application/json">`; older
//! files keep them as `<div title="…">` elements with a `<pre>` inside
//! `<div id="storeArea">`.

use crate::tw::Fields;
use serde_json::Value;
use std::collections::BTreeMap;

const JSON_STORE: &str = "<script class=\"tiddlywiki-tiddler-store\" type=\"application/json\">";
const DIV_STORE: &str = "<div id=\"storeArea\"";

/// Every tiddler of a wiki file, by title (later stores win, as in TiddlyWiki).
pub fn tiddlers(html: &str) -> BTreeMap<String, Fields> {
    let mut out = BTreeMap::new();
    let mut rest = html;
    while let Some(i) = rest.find(JSON_STORE) {
        let body = &rest[i + JSON_STORE.len()..];
        let Some(end) = body.find("</script>") else { break };
        if let Ok(Value::Array(list)) = serde_json::from_str::<Value>(&body[..end]) {
            for t in list {
                if let Some(f) = fields_of(&t) {
                    out.insert(f["title"].clone(), f);
                }
            }
        }
        rest = &body[end..];
    }
    if let Some(i) = html.find(DIV_STORE) {
        for f in div_tiddlers(&html[i..]) {
            out.insert(f["title"].clone(), f);
        }
    }
    out
}

/// Scripts a wiki page loads before TiddlyWiki boots, with the function each one calls per
/// tiddler. MultiWikiServer delivers a wiki's plugins this way (`…/plugin.js?cb=$tw.preloadTiddler`),
/// and on some setups the tiddlers too (`…/store.js`).
pub fn preload_scripts(html: &str) -> Vec<(String, String)> {
    let mut out = vec![];
    let mut rest = html;
    while let Some(i) = rest.find("<script") {
        let tag = &rest[i..];
        let Some(gt) = tag.find('>') else { break };
        let attrs = &tag[7..gt];
        rest = &tag[gt..];
        let Some(src) = attributes(attrs).into_iter().find(|(k, _)| k == "src").map(|(_, v)| unescape(&v)) else { continue };
        let path = src.split(['?', '#']).next().unwrap_or("");
        if !(path.ends_with("/plugin.js") || path.ends_with("/store.js")) {
            continue;
        }
        let func = src
            .split_once('?')
            .and_then(|(_, q)| q.split('&').find_map(|kv| kv.strip_prefix("cb=")))
            .map(percent_decode)
            .unwrap_or_else(|| PRELOAD.to_string());
        out.push((src, func));
    }
    out
}

/// TiddlyWiki's hook for tiddlers that arrive before it boots.
pub const PRELOAD: &str = "$tw.preloadTiddler";

/// The tiddlers a script hands to `func({…})`, call by call.
pub fn preloaded(js: &str, func: &str) -> Vec<Fields> {
    let call = format!("{func}(");
    let mut out = vec![];
    let mut rest = js;
    while let Some(i) = rest.find(&call) {
        rest = &rest[i + call.len()..];
        let body = rest.trim_start();
        if !body.starts_with('{') {
            continue;
        }
        if let Some(Ok(v)) = serde_json::Deserializer::from_str(body).into_iter::<Value>().next() {
            if let Some(f) = fields_of(&v) {
                out.push(f);
            }
        }
    }
    out
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
        out.push(if b[i] == b'+' { b' ' } else { b[i] });
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// A tiddler from JSON (values that are not strings become their JSON text).
pub fn fields(v: &Value) -> Option<Fields> {
    fields_of(v)
}

fn fields_of(v: &Value) -> Option<Fields> {
    let o = v.as_object()?;
    let f: Fields = o
        .iter()
        .map(|(k, v)| (k.clone(), v.as_str().map(String::from).unwrap_or_else(|| v.to_string())))
        .collect();
    f.contains_key("title").then_some(f)
}

/// Tiddlers of an old-style `storeArea`.
fn div_tiddlers(area: &str) -> Vec<Fields> {
    let mut out = vec![];
    // The store ends at the first `</div>` that closes it: tiddler divs never nest.
    let mut rest = &area[area.find('>').map(|i| i + 1).unwrap_or(0)..];
    while let Some(i) = rest.find("<div ") {
        let after = &rest[i + 5..];
        let Some(gt) = after.find('>') else { break };
        let attrs = &after[..gt];
        let Some(close) = after.find("</div>") else { break };
        let inner = &after[gt + 1..close];
        let mut f = Fields::new();
        for (k, v) in attributes(attrs) {
            f.insert(k, unescape(&v));
        }
        let text = inner.trim();
        let text = text.strip_prefix("<pre>").and_then(|t| t.strip_suffix("</pre>")).unwrap_or(text);
        f.insert("text".into(), unescape(text));
        if f.contains_key("title") {
            out.push(f);
        }
        rest = &after[close + 6..];
        if rest.trim_start().starts_with("</div>") {
            break;
        }
    }
    out
}

fn attributes(s: &str) -> Vec<(String, String)> {
    let mut out = vec![];
    let mut rest = s.trim();
    while let Some(eq) = rest.find("=\"") {
        let key = rest[..eq].trim().to_string();
        let val = &rest[eq + 2..];
        let Some(end) = val.find('"') else { break };
        out.push((key, val[..end].to_string()));
        rest = val[end + 1..].trim_start();
    }
    out
}

fn unescape(s: &str) -> String {
    s.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&#39;", "'").replace("&#x27;", "'").replace("&amp;", "&")
}

fn escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

/// The wiki file with `tiddlers` as its complete store (the format of the original is kept).
pub fn with_tiddlers(html: &str, tiddlers: &BTreeMap<String, Fields>) -> Option<String> {
    if let Some(i) = html.find(JSON_STORE) {
        let list: Vec<&Fields> = tiddlers.values().collect();
        // `<` inside the JSON would end the script element early.
        let json = serde_json::to_string(&list).ok()?.replace('<', "\\u003C");
        let start = i + JSON_STORE.len();
        let end = start + html[start..].find("</script>")?;
        let mut out = format!("{}{}{}", &html[..start], json, &html[end..]);
        // Further stores held tiddlers that are in the first one now.
        loop {
            let first = out.find(JSON_STORE)? + JSON_STORE.len();
            let Some(j) = out[first..].find(JSON_STORE).map(|j| j + first) else { break };
            let close = j + out[j..].find("</script>")? + "</script>".len();
            out.replace_range(j..close, "");
        }
        return Some(out);
    }
    let i = html.find(DIV_STORE)?;
    let open = i + html[i..].find('>')? + 1;
    let mut close = open;
    // Skip the tiddler divs to the `</div>` of the store itself.
    let mut rest = &html[open..];
    loop {
        let t = rest.trim_start();
        close += rest.len() - t.len();
        if !t.starts_with("<div ") {
            break;
        }
        let end = t.find("</div>")? + 6;
        close += end;
        rest = &t[end..];
    }
    let mut body = String::from("\n");
    for f in tiddlers.values() {
        let attrs: String = f.iter().filter(|(k, _)| *k != "text").map(|(k, v)| format!(" {}=\"{}\"", k, escape(v))).collect();
        body.push_str(&format!("<div{}>\n<pre>{}</pre>\n</div>\n", attrs, escape(f.get("text").map(String::as_str).unwrap_or(""))));
    }
    Some(format!("{}{}{}", &html[..open], body, &html[close..]))
}

/// Tiddlers that only describe the state of a browser session: never compared or offered.
pub fn ephemeral(title: &str) -> bool {
    // The wiki's start tiddlers, themes, palettes and changed core tiddlers belong to its look and come along.
    // A server's sync client (MultiWikiServer, TiddlyWeb) has no server to talk to here.
    ["$:/StoryList", "$:/HistoryList", "$:/Import", "$:/core", "$:/isEncrypted", "$:/plugins/mws/client", "$:/plugins/tiddlywiki/tiddlyweb", "$:/plugins/tiddlywiki/multiwikiclient"].contains(&title)
        || ["$:/state/", "$:/temp/", "$:/status/", "$:/info/", "$:/config/multiwikiclient/", "$:/config/tiddlyweb/"].iter().any(|p| title.starts_with(p))
}

/// `user:password` for HTTP basic authentication.
pub fn basic_auth(user: &str, password: &str) -> String {
    const A: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let bytes = format!("{user}:{password}").into_bytes();
    let mut out = String::new();
    for c in bytes.chunks(3) {
        let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
        for (i, shift) in [18, 12, 6, 0].into_iter().enumerate() {
            out.push(if i <= c.len() { A[(n >> shift & 63) as usize] as char } else { '=' });
        }
    }
    format!("Basic {out}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_wikis_look_comes_along_session_state_does_not() {
        for t in ["$:/DefaultTiddlers", "$:/theme", "$:/palette", "$:/core/ui/PageTemplate", "$:/language/Buttons/Save/Caption"] {
            assert!(!ephemeral(t), "{t}");
        }
        for t in ["$:/StoryList", "$:/core", "$:/state/x", "$:/temp/y", "$:/isEncrypted", "$:/info/url/full"] {
            assert!(ephemeral(t), "{t}");
        }
    }

    fn f(pairs: &[(&str, &str)]) -> Fields {
        pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    #[test]
    fn reads_and_writes_json_stores() {
        let html = format!(
            "<html><body>{JSON_STORE}[{{\"title\":\"A\",\"text\":\"eins\"}}]</script>{JSON_STORE}[{{\"title\":\"B\",\"text\":\"<b>zwei</b>\",\"tags\":\"x\"}}]</script></body></html>"
        );
        let t = tiddlers(&html);
        assert_eq!(t.len(), 2);
        assert_eq!(t["B"]["text"], "<b>zwei</b>");
        let mut next = t.clone();
        next.insert("C".into(), f(&[("title", "C"), ("text", "drei")]));
        let out = with_tiddlers(&html, &next).unwrap();
        assert_eq!(out.matches(JSON_STORE).count(), 1, "one store remains");
        assert!(!out.contains("<b>zwei"), "< is escaped inside the script");
        assert_eq!(tiddlers(&out), next);
    }

    #[test]
    fn reads_and_writes_old_div_stores() {
        let html = "<html><div id=\"storeArea\" style=\"display:none;\"><div title=\"A &amp; B\" tags=\"x\">\n<pre>1 &lt; 2</pre>\n</div><div title=\"C\"><pre></pre></div></div><script>x</script></html>";
        let t = tiddlers(html);
        assert_eq!(t["A & B"]["text"], "1 < 2");
        assert_eq!(t["A & B"]["tags"], "x");
        assert_eq!(t["C"]["text"], "");
        let mut next = t.clone();
        next.remove("C");
        let out = with_tiddlers(html, &next).unwrap();
        assert_eq!(tiddlers(&out), next);
        assert!(out.ends_with("<script>x</script></html>"));
    }

    #[test]
    fn encodes_basic_auth() {
        assert_eq!(basic_auth("Aladdin", "open sesame"), "Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ==");
        assert_eq!(basic_auth("a", "b"), "Basic YTpi");
    }
}
