#!/bin/sh
# Rebuild Markdown, vis-network and Relink, the TiddlyWiki plugins brausa bundles that are not in
# TiddlyVisuals releases (Graph, Pinboard and Kanban come from scripts/update-tw-plugins.sh).
#   scripts/build-tw-plugins.sh [path to a checkout of lasjoh-toho/TiddlyVisuals]
# The JSON files are committed; run this after TiddlyVisuals updates its dependencies.
set -e
SRC=$(cd "${1:-../TiddlyVisuals}" && pwd)
OUT=$(pwd)/src-tauri/resources/tw-plugins
(cd "$SRC" && npm install --silent)
TW="$SRC/node_modules/.bin/tiddlywiki"
"$TW" +plugins/tiddlywiki/markdown "++$SRC/node_modules/tw5-vis-network/plugins/vis-network" \
  "++$SRC/node_modules/tw5-relink/plugins/relink" "$SRC" --output "$OUT" \
  --render '$:/plugins/flibbles/relink' relink.json text/plain '$:/core/templates/html-json-tiddler' \
  --render '$:/plugins/flibbles/vis-network' vis-network.json text/plain '$:/core/templates/html-json-tiddler' \
  --render '$:/plugins/tiddlywiki/markdown' markdown.json text/plain '$:/core/templates/html-json-tiddler'
ls -la "$OUT"
