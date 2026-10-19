# Mitgelieferte TiddlyWiki-Plugins

brausa schreibt diese Plugins in die Wikis, die es abgleicht (Bag `@plugins`).

Graph, Pinboard und Kanban kommen aus den Releases von
[TiddlyVisuals](https://lasjoh-toho.github.io/TiddlyVisuals/) (Fork von tw5-graph).
Welches Release eingebaut ist, steht in `TIDDLYVISUALS`. Aktualisieren:
`scripts/update-tw-plugins.sh [tag]`. Der Workflow *TiddlyVisuals-Plugins* prüft das
jede Woche und schlägt neue Releases als Pull Request vor.
Markdown, vis-network und Relink: `scripts/build-tw-plugins.sh <Pfad zu TiddlyVisuals>`.

| Datei | Plugin | Lizenz |
|---|---|---|
| `markdown.json` | `$:/plugins/tiddlywiki/markdown` (TiddlyWiki 5.3.8, mit markdown-it) | BSD-3-Clause (TiddlyWiki), MIT (markdown-it) |
| `graph.json` | `$:/plugins/flibbles/graph` (Flibbles, tw5-graph) | BSD-3-Clause |
| `vis-network.json` | `$:/plugins/flibbles/vis-network` (mit vis-network) | BSD-3-Clause, Apache-2.0/MIT (vis-network) |
| `pinboard.json` | `$:/plugins/lasjoh-toho/pinboard` (TiddlyVisuals) | BSD-3-Clause |
| `kanban.json` | `$:/plugins/lasjoh-toho/kanban` (TiddlyVisuals) | BSD-3-Clause |
| `relink.json` | `$:/plugins/flibbles/relink` 2.5.2 (Flibbles, tw5-relink): Umbenennen folgt in Listen, `story`-Felder und Pinboard-Boards | BSD-3-Clause |
