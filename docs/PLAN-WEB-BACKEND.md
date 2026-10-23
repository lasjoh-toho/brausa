# Plan: Wikis im Internet – Node.js-Backend, von brausa gesteuert

> Stand: Oktober 2026 · ergänzt [PLAN-PROJEKTE.md](PLAN-PROJEKTE.md)

Ziel: Ein Wiki, das in brausa aus Bags zusammengesetzt wird, liegt auch im Internet.
Dort speichert ein Node.js-Server die Tiddler, Leser und Schreiber arbeiten im Browser,
und brausa steuert alles: welche Bags hochgehen, wie das Wiki zusammengesetzt ist,
Abgleich in beide Richtungen. Ausgeliefert wird das Wiki komprimiert („uglified“).

---

## 1. Empfehlung: MultiWikiServer statt eigenem Server

Der MultiWikiServer (MWS, [TiddlyWiki/MultiWikiServer](https://github.com/TiddlyWiki/MultiWikiServer),
eigener Fork: lasjoh-toho/MultiWikiServer) hat bereits genau das Modell, das brausa lokal nachbaut:

| brausa | MWS |
|---|---|
| Bag (Ordner mit .tid) | Bag (Datenbank: SQLite oder Postgres über Prisma) |
| Wiki = Rezept: Bags unten → oben, eigener Bag oben | Wiki (Slug) = Template + Bags mit Priorität (kleinste Zahl = oben) |
| „Speichern in“ im Bearbeiten-Modus | Schreiben nach Titel-Präfix in den passenden beschreibbaren Bag |
| Bag „plugins“ / mitgelieferte Plugins | Plugin-Satz des Templates/Wikis, serverseitig im Plugin-Cache |
| Bag „lokal“, Maps (`@map:`) | bleiben auf dem Rechner (Einstellung „ins Web“ je Bag) |

Ein eigener Server müsste Benutzer, Rechte, Sitzungen, Revisionen, Konflikte und die
Auslieferung der Wiki-Seite neu bauen. MWS hat das alles; brausa wird zum Client von MWS.

## 2. Wie MWS eine Wiki-Seite ausliefert (für brausa wichtig)

`GET /wiki/<slug>` liefert die HTML-Hülle von TiddlyWiki. Dazu kommt:

- **Plugins** meist als externe Skripte: `<script src="/$cache/…/plugin.js?cb=$tw.preloadTiddler">`.
  Jedes ruft `$tw.preloadTiddler({…})` auf. Sie stehen **nicht** im Tiddler-Speicher der Seite.
  Deshalb sah ein importiertes MWS-Wiki in brausa wie ein Standard-Wiki aus. Ab 0.19 lädt brausa diese Skripte mit.
- **Tiddler** im Speicher der Seite (`tiddlywiki-tiddler-store`), schon aus den Bags aufgelöst.
  Bei eigenem HTML-Template kommen sie als `$tw.preloadTiddler(…)`-Aufrufe, optional extern als `store.js`.
- **Bag je Tiddler** in `$:/state/multiwikiclient/tiddlers/bag` (Titel → Bagname), Revisionen in
  `…/tiddlers/revision`, das Rezept in `$:/config/multiwikiclient/recipe`.
- **Sync-Client** `$:/plugins/mws/client` (mit tiddlyweb). Lokal hat er keinen Server und bleibt
  deshalb beim Import draußen.

Daraus folgt für den Import in brausa (umgesetzt in 0.19):

- Jeder Tiddler kommt in einen gespiegelten Bag `mws-<Bagname>`.
- Die Reihenfolge stammt aus `GET /recipe/<slug>/status` (Feld `priority`).
- Die Spiegel-Bags liegen über „lokal“ und unter dem eigenen Bag des Wikis.

## 3. Schreiben vom Rechner ins Netz: die MWS-API

| Zweck | Aufruf |
|---|---|
| Aufbau des Wikis, Schreibrechte je Bag | `GET /recipe/<slug>/status` |
| Titel mit Bag und Revision | `GET /recipe/<slug>/list.json` |
| Änderungen seit Revision n | `GET /recipe/<slug>/updates?since=n` → `{modifications, deletions, lastSeq}` |
| Lesen / Speichern / Löschen in Mengen | `PUT /recipe/<slug>/batch/read\|save\|delete` mit `{titles}` bzw. `{tiddlers}` |

Schreibende Aufrufe brauchen den Header `X-Requested-With` (CSRF-Schutz) und eine Sitzung
(Anmeldung mit Benutzer und Passwort). Ein Tiddler landet dabei in dem Bag, den MWS über das
Titel-Präfix bestimmt.

### Abgleich in brausa (Phase 2)

1. **Holen:** `updates?since=<letzter Stand>`. Geänderte Titel kommen über `batch/read` und
   landen im gespiegelten Bag. Löschungen werden dort entfernt. Der Stand `lastSeq` wird je Wiki gemerkt.
2. **Senden:** Tiddler, die sich in brausa seit dem letzten Abgleich geändert haben und in
   einem Bag mit „ins Web“ liegen, gehen über `batch/save`. Pro Tiddler wird die Revision gemerkt.
3. **Konflikt:** Hat sich ein Titel auf beiden Seiten geändert, gewinnt nichts stillschweigend.
   Der Vergleichsdialog (wie heute) zeigt beide Fassungen.
4. **Nicht hochgeladen** werden „lokal“, Notizen mit Tag lokal/privat, Map-Bags (außer
   eingeschaltet) und `$:/state/…`.

Das ersetzt das heutige „Hochladen“ per PUT der ganzen HTML-Datei. Das bleibt für einfache
Single-File-Wikis (WebDAV, TiddlyHost) bestehen.

### Steuerung des Aufbaus (Phase 3)

Im Fork kommt eine kleine Admin-Route für brausa dazu, mit persönlichem Token statt Sitzung und CSRF:

- `PUT /api/brausa/bag/<name>`: Bag anlegen oder ändern (Beschreibung, Rechte).
- `PUT /api/brausa/wiki/<slug>`: Bags mit Prioritäten, schreibbare Präfixe, Plugin-Satz, Template.
- `PUT /api/brausa/plugin`: eigenes Plugin hochladen (z. B. TiddlyVisuals), landet im Plugin-Cache.

brausa bekommt dafür in den Wiki-Einstellungen einen Abschnitt „Server“ mit Adresse, Konto
und Token. Der Token liegt im Schlüsselbund des Systems, nicht in der App-Datei. Daneben gibt
es „Auf den Server bringen“: Bags anlegen, Wiki zusammensetzen, Tiddler senden.

## 4. „Uglify“: komprimiert ausliefern

Das Plugin [flibbles/uglify](https://github.com/flibbles/tw5-uglify) komprimiert JavaScript,
CSS und Wikitext von Core und Plugins beim Ausliefern durch einen Node.js-TiddlyWiki-Server.
Die Dateien auf dem Server bleiben unverändert. MWS liefert Plugins aber aus seinem eigenen
Cache (`cache/<plugin>/plugin.json`, vorab gezippt als `plugin.N.js.gz`). Deshalb gehört die
Kompression **in den Aufbau dieses Caches**:

- Hook im Fork nach dem Import eines Plugins in den Cache: Für jedes Shadow-Tiddler
  - `application/javascript` → terser (oder der Kompressor aus uglify),
  - `text/css` → clean-css,
  - Wikitext optional über die Wikitext-Kompression von uglify.

  Danach werden Hash und gzip neu berechnet. Das geschieht einmal je Plugin-Version, nicht pro Aufruf.
- Ebenso die HTML-Hülle `tiddlywiki5.html` (boot.js, Core).
- Quelltext-Karten (Source Maps) optional für die Fehlersuche.
- Einschränkung laut uglify: Plugins mit sehr neuem JavaScript (ES2015+) kann es nicht
  verarbeiten. terser kann das, deshalb terser als Grundlage.

## 5. Betrieb

- Ein kleiner Server (VPS oder Container) mit Node.js 20 oder neuer. MWS bringt Dockerfile und
  docker-compose mit (SQLite im Volume, oder Postgres).
- Davor ein Reverse Proxy mit TLS (Caddy), gzip/brotli. MWS verlangt für Sitzungen HTTPS.
- Sicherung: Datenbank-Dump täglich. brausa hat ohnehin die Bags als Dateien.

## 6. Phasen

| Phase | Inhalt | Stand |
|---|---|---|
| 1 | MWS-Wiki in brausa importieren: externe Plugins, Bags gespiegelt, Sync-Client draußen | 0.19 |
| 2 | Abgleich über `updates` + `batch/read/save/delete` mit Revisionen und Konfliktdialog | offen |
| 3 | Admin-Route im Fork + Abschnitt „Server“ in brausa: Bags, Wiki-Aufbau, Plugins | offen |
| 4 | Uglify-Hook im Plugin-Cache des Forks, Docker-Compose mit Caddy | offen |
