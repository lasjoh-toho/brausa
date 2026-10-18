#!/bin/sh
# Take Graph, Pinboard and Kanban from a TiddlyVisuals release
# (https://lasjoh-toho.github.io/TiddlyVisuals/), the plugins brausa puts into every wiki.
#   scripts/update-tw-plugins.sh [tag]    default: the newest release
# The tag in use is kept in src-tauri/resources/tw-plugins/TIDDLYVISUALS.
set -e
REPO=https://github.com/lasjoh-toho/TiddlyVisuals
OUT=$(dirname "$0")/../src-tauri/resources/tw-plugins
TAG=${1:-$(git ls-remote --tags --refs "$REPO" 'v*' | sed 's|.*refs/tags/||' | sort -V | tail -1)}
[ -n "$TAG" ] || { echo "Kein TiddlyVisuals-Release gefunden" >&2; exit 1; }
TMP=$(mktemp -d)
for p in graph pinboard kanban; do
  curl -fsSL -o "$TMP/$p.json" "$REPO/releases/download/$TAG/$p.json"
done
# brausa's map projection relies on these titles; refuse a release that drops them.
node - "$TMP" <<'JS'
const fs = require('fs'), dir = process.argv[2];
const need = {
  graph: ['$:/plugins/flibbles/graph', []],
  pinboard: ['$:/plugins/lasjoh-toho/pinboard', ['$:/plugins/lasjoh-toho/pinboard/templates/pinboard']],
  kanban: ['$:/plugins/lasjoh-toho/kanban', ['$:/plugins/lasjoh-toho/kanban/templates/kanban']]
};
for (const [file, [title, inner]] of Object.entries(need)) {
  let p = JSON.parse(fs.readFileSync(`${dir}/${file}.json`, 'utf8'));
  p = Array.isArray(p) ? p[0] : p;
  if (p.title !== title) throw new Error(`${file}.json: ${p.title} statt ${title}`);
  const tiddlers = JSON.parse(p.text).tiddlers;
  for (const t of inner) if (!tiddlers[t]) throw new Error(`${file}.json: ${t} fehlt`);
  console.log(`${title} ${p.version}`);
}
JS
mv "$TMP"/*.json "$OUT/"
echo "$TAG" > "$OUT/TIDDLYVISUALS"
rm -rf "$TMP"
