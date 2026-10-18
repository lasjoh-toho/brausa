#!/bin/sh
# Rebuild the TiddlyWiki plugins brausa puts into every wiki it syncs.
#   scripts/build-tw-plugins.sh [path to a checkout of lasjoh-toho/tw5-graph]
# The JSON files are committed; run this after updating tw5-graph.
set -e
SRC=$(cd "${1:-../tw5-graph}" && pwd)
OUT=$(pwd)/src-tauri/resources/tw-plugins
(cd "$SRC" && npm install --silent)
TW="$SRC/node_modules/.bin/tiddlywiki"
"$TW" +plugins/tiddlywiki/markdown "++$SRC/node_modules/tw5-vis-network/plugins/vis-network" "$SRC" --output "$OUT" \
  --render '$:/plugins/flibbles/graph' graph.json text/plain '$:/core/templates/html-json-tiddler' \
  --render '$:/plugins/lasjoh-toho/pinboard' pinboard.json text/plain '$:/core/templates/html-json-tiddler' \
  --render '$:/plugins/lasjoh-toho/kanban' kanban.json text/plain '$:/core/templates/html-json-tiddler' \
  --render '$:/plugins/flibbles/vis-network' vis-network.json text/plain '$:/core/templates/html-json-tiddler' \
  --render '$:/plugins/tiddlywiki/markdown' markdown.json text/plain '$:/core/templates/html-json-tiddler'
ls -la "$OUT"
