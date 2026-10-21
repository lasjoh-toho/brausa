#!/bin/sh
# The empty TiddlyWiki (core, German and English) brausa shows folder wikis in.
#   scripts/build-tw-empty.sh [version]    default: the newest TiddlyWiki on npm
set -e
VER=${1:-latest}
OUT=$(cd "$(dirname "$0")/.." && pwd)/src-tauri/resources/tw-empty.html
TMP=$(mktemp -d)
cd "$TMP"
npm install --silent --no-save "tiddlywiki@$VER" >/dev/null
mkdir -p edition
cat > edition/tiddlywiki.info <<'JSON'
{ "plugins": [], "themes": ["tiddlywiki/vanilla", "tiddlywiki/snowwhite"], "languages": ["de-DE"] }
JSON
npx tiddlywiki edition --render '$:/core/save/all' empty.html text/plain >/dev/null
cp edition/output/empty.html "$OUT"
echo "TiddlyWiki $(node -p "require('tiddlywiki/package.json').version") → $OUT"
rm -rf "$TMP"
