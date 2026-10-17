# Plan: Zentraler Index, Projektmaps und TiddlyWiki-Anbindung

> Stand: Oktober 2026 · ergänzt [KONZEPT.md](KONZEPT.md)

Dieser Plan beschreibt drei zusammenhängende Schritte:

1. **Zentraler Index** statt einer Sidecar-Datei pro Datei
2. **Projektorganisation**: Projektmaps mit Karten, Unterkarten, Verbindungen und
   zoombarer Fläche (ZUI), angelehnt an iMapping
3. **TiddlyWiki-Kompatibilität**: Projektmaps lassen sich als TW5-Wiki mit
   tw5-graph (Pinboard- und Kanban-Engine) vorstellen, über TiddlyDesktop-RS

---

## 1. Zentraler Index statt Sidecar pro Datei

### Bewertung: sinnvoll, mit zwei Bedingungen

| | Sidecar pro Datei (heute) | Zentraler Index (neu) |
|---|---|---|
| Ordnung im Dateisystem | ✗ Ein `.brausa/` in **jedem** Ordner | ✓ Ein Ort pro Bibliothek |
| Externe Änderungen | ✗ Verschieben im Finder trennt die Metadaten | ✓ Reparatur im Hintergrund über Datei-Identität |
| Suche, Kalender, Karte über alles | ✗ Jeder Ordner muss gelesen werden | ✓ Eine Abfrage |
| Projektmaps, Verbindungen | ✗ Passt nicht pro Datei | ✓ Gehören ohnehin zentral |
| Metadaten reisen mit einer einzelnen Datei | ✓ | ✗ Nur mit Export |

Die Idee ist also gut, wenn zwei Bedingungen erfüllt sind:

1. **Kein Lock-in.** Die Wahrheit liegt in einem lesbaren, versionierbaren
   Textformat. SQLite ist nur ein Cache, den brausa jederzeit neu aufbauen kann.
2. **Die Identität einer Datei hängt nicht am Pfad.** Nur so lässt sich eine
   außerhalb verschobene oder umbenannte Datei wiederfinden.

### Aufbau

```
<Bibliothek>/                 z. B. ~/Projekte/Brausa  (frei wählbar, beliebig viele)
  .brausa/
    library.json              Kennung, Name, Einstellungen
    meta.jsonl                ← Wahrheit: eine Zeile pro Datei mit Metadaten (sortiert, diff-freundlich)
    maps/<id>.json            Projektmaps (Abschnitt 2)
~/.cache/brausa/<lib-id>.sqlite   ← Cache: Volltext, Tag-Index, Datei-Identitäten, Thumbnails
```

- **Warum `meta.jsonl` und nicht SQLite als Wahrheit?** SQLite-Dateien gehen in
  Sync-Ordnern (Dropbox, iCloud, Nextcloud) bei gleichzeitigem Schreiben leicht
  kaputt. Eine sortierte Textdatei lässt sich mergen, mit Git versionieren und
  von Hand lesen.
- **Eine Zeile** sieht so aus:

  ```json
  {"id":"f_7Kq2","path":"Assets/2026/raw_1.jpg","fid":"ino:83412:dev:66306","size":16384,"mtime":1792226105311,"qhash":"xxh3:9f1c…","tags":["Work/Design"],"color":null,"note":""}
  ```

- **Datei-Identität (`fid`):** unter macOS und Linux Inode plus Gerät, unter
  Windows die File-ID (`GetFileInformationByHandle`). Dazu kommt `qhash`: xxh3
  über Größe sowie die ersten und letzten 64 KB, das geht schnell auch bei
  großen Videos.

### Selbstreparatur im Hintergrund

```
Watcher-Event / App-Start / alle 10 min
  → Abgleich (Walk mit Größe + mtime + fid; Inhalt nur, wenn nötig)
     ├─ Pfad bekannt, Datei unverändert          → nichts tun
     ├─ Pfad bekannt, Inhalt geändert            → qhash, mtime aktualisieren
     ├─ neuer Pfad, fid/qhash passt zu "fehlt"   → **umbenannt/verschoben**: Metadaten umhängen
     ├─ neuer Pfad, unbekannt                    → neu indexieren (EXIF, Thumbnail)
     └─ Eintrag ohne Datei                       → „verwaist" markieren, 30 Tage aufheben
                                                    (falls die Datei aus dem Papierkorb zurückkommt)
```

- Sichtbar wird das nur als kleine Statusanzeige („Index: 12 Dateien neu
  zugeordnet“). In einer Liste lassen sich verwaiste Einträge prüfen, zuordnen
  oder verwerfen.
- **Migration:** Vorhandene `.brausa/*.meta.json`-Sidecars werden beim ersten
  Öffnen importiert und danach aufgeräumt. Tags im Dateinamen
  (`Foto[urlaub].jpg`) bleiben als optionale, portable Variante.
- **Mitnehmen:** „Mit Metadaten exportieren“ schreibt beim Kopieren aus der
  Bibliothek heraus wahlweise eine Sidecar-Datei mit. Optional werden Tags
  zusätzlich als Finder-Tags (xattr) gesetzt.

---

## 2. Projektorganisation: Projektmaps

### Grundbegriffe

| Begriff | Bedeutung |
|---|---|
| **Projekt** | Eine Bibliothek (Ordner) mit Index und einer oder mehreren Maps |
| **Map** | Unendliche, zoombare Fläche |
| **Karte** | Informationseinheit: Titel, Text (Markdown), Farbe, Status, beliebige Felder |
| **Unterkarten** | Jede Karte enthält ihre eigene Fläche mit eigenen Karten, beliebig tief |
| **Verbindung** | Pfeil oder Linie zwischen **beliebigen** Karten, auch über Ebenen hinweg; mit Beschriftung und Typ |
| **Verweis** | Eine Karte kann auf Dateien, Ordner, URLs oder Tiddler zeigen (mit Vorschaubild) |

### Datenformat (`.brausa/maps/<id>.json`)

```json
{
  "v": 1, "id": "m_main", "title": "Brausa Roadmap",
  "cards": {
    "c_1": { "title": "Phase 3: Web", "text": "…", "x": 0, "y": 0, "w": 320, "h": 200,
             "color": "#0090ff", "status": "Doing", "fields": {"owner": "Jo"},
             "refs": [{"kind": "file", "id": "f_7Kq2"}, {"kind": "url", "href": "https://…"}],
             "children": ["c_4", "c_5"], "parent": null }
  },
  "links": [ { "id": "l_1", "from": "c_1", "to": "c_9", "label": "blockiert", "type": "depends", "directed": true } ],
  "view": { "x": 0, "y": 0, "scale": 1 }
}
```

- Dateien referenziert die Map über die **Index-ID** (`f_7Kq2`), nicht über
  den Pfad. Verschiebt man eine Datei im Finder, bleibt die Karte trotzdem
  richtig verknüpft. Das ist der eigentliche Gewinn des zentralen Index.
- Unterkarten liegen **flach** in `cards`, mit `parent` und `children`. Dadurch
  lassen sich Karten leicht zwischen Ebenen verschieben, und Verbindungen über
  Ebenen hinweg bleiben einfach.

### Zoombare Oberfläche (ZUI)

- **Semantischer Zoom** in drei Detailstufen je Karte:
  1. *Punkt/Fläche* (sehr klein): nur Farbe und Größe
  2. *Titel* (klein): Titel, Anzahl der Unterkarten
  3. *Inhalt* (groß): Text, Vorschaubilder der Verweise; die **Unterkarten
     werden innerhalb der Karte verkleinert sichtbar**. Beim weiteren
     Hineinzoomen gehen sie nahtlos in eine eigene Fläche über.
- **Leistung bei Tausenden Karten:**
  - Was außerhalb des Sichtfelds liegt, wird nicht gerendert (Viewport-Culling).
  - Unterkarten werden erst gezeichnet, wenn ihre Fläche groß genug ist.
  - Gezeichnet wird ab der tiefsten Karte, die den ganzen Bildschirm füllt.
    Dadurch bekommt CSS auch nach zehn Ebenen keine riesigen Zahlen.
  - Umgesetzt (Phase B/C) mit absolut positionierten HTML-Elementen in
    Bildschirmkoordinaten; das reicht für einige Hundert sichtbare Karten.
    Erst wenn das nicht mehr genügt, wechselt der Renderer zu Canvas 2D bzw.
    WebGL. Das Datenformat ändert sich dabei nicht.
- **Navigation:** Mausrad oder Pinch zoomt zum Zeiger hin. `↵` oder die Lupe
  an der Karte fliegt hinein, `Esc` geht eine Ebene zurück, `0` zeigt die
  ganze Map. Oben steht eine Breadcrumb-Leiste („Roadmap › Phase 3 ›
  Web-Clipper“). Ihre Segmente sollen später auch Drop-Ziele werden.

### Zusammenspiel mit dem Rest von brausa

- **Kanban** wird eine *Ansicht* auf dieselben Karten: Spalten kommen aus
  `status` oder einem anderen Feld. Ein Projekt kann also gleichzeitig Map und
  Board sein.
- **Dateien auf die Map ziehen** (aus dem Stream, dem Tray oder dem Ordnerbaum)
  erzeugt eine Karte mit Verweis und Vorschaubild. Zieht man eine Karte auf
  einen Ordner, landen die verwiesenen Dateien dort.
- **Unterstützung beim manuellen Anlegen:** Projektmaps entstehen nur von Hand.
  Ein Seitenpanel „Bausteine“ hilft dabei:
  - die vorhandene Suche und Muster-Auswahl (`*.pdf #Angebot modified < 30d`)
    über die Bibliothek;
  - „Ordnerstruktur vorschlagen“ zeigt die Unterordner als Kartenvorschläge;
    **nichts wird automatisch angelegt**, man zieht sich, was man will.
- **Integrierter Browser** (Phase 3 im Konzept) als Basis: Web-Pane neben der
  Map. Links, markierter Text und Bilder lassen sich als Karten auf die Map
  ziehen (mit Quelle). Der Web-Clipper legt die Seite zusätzlich als Datei in
  die Bibliothek.
- **Karten Dokumenten zuordnen:** Eine Karte (z. B. mit einer Idee) auf eine
  Datei ziehen, oder eine Datei auf eine Karte, ergänzt einen Verweis in
  `refs`. Ein Klick darauf öffnet die Datei in der Standard-App. Eine Karte
  kann mehrere Verweise haben.
- **Von der Map ins Kanban schicken:** Weil das Kanban nur eine Ansicht ist,
  heißt „schicken“, das Feld `status` zu setzen. Das geht per Kontextmenü, per
  Ablage-Raster mit Status-Zellen oder durch Ziehen in die Kanban-Ansicht.

### Snippets aus PDF und HTML (wie LiquidText)

- **Leser:** PDFs werden mit pdf.js angezeigt, HTML im Web-Pane bzw. als
  lokale Datei. Der Leser steht neben der Map.
- **Snippet ziehen:** Markierten Text oder einen Bildausschnitt auf die Map
  ziehen. Das erzeugt eine Snippet-Karte mit Verweis
  `{ "kind": "file", "id": "f_…", "page": 3, "quads": [...], "quote": "…" }`
  (bei HTML ein Textanker statt der Seitenkoordinaten). Ein Klick auf das
  Snippet öffnet die Quelle an genau dieser Stelle und hebt sie hervor.
- **Stapel:** Zieht man ein Snippet an die Ober- oder Unterkante eines
  anderen, rasten beide zu einem Stapel ein. Der Stapel bewegt sich als
  Ganzes, einzelne Snippets lassen sich wieder herausziehen. Gespeichert wird
  er als Karte vom Typ `stack`, deren `children` die Reihenfolge festlegen.
  Nach TiddlyWiki wird das ein `list`-Feld.
- Pfeile und Verschachtelung funktionieren mit Snippets wie mit jeder anderen
  Karte.

---

## 3. TiddlyWiki-, tw5-graph- und TiddlyDesktop-Anbindung

### Was tw5-graph (dein Fork) heute schon kann

Gelesen in `lasjoh-toho/tw5-graph`:

- **Graph-Tiddler** = Data-Tiddler; `text` hält Positionen im Format
  `Titel: x,y`. Das Feld `filter` bestimmt, welche Tiddler Knoten sind.
- **Kanten** entstehen aus Feldern. Welche Felder Kanten bilden, steht in
  `$:/config/flibbles/graph/edges/fields/<feld>`, z. B. `list` oder `tags`, mit
  JSON `{"label": "…"}`.
- **Pinboard-Engine**: Im Store-Tiddler steht im Feld `pinboard` JSON mit
  `cards` (x, y, w, h, angezeigte Felder), `shapes`, `steps`
  (Präsentationspfad) und `view`.
- **Kanban-Engine**: Spalten und Swimlanes kommen aus Feldern (`status`,
  `owner`); Ziehen schreibt diese Felder.

Das passt sehr gut: Eine brausa-Karte **ist** im Kern ein Tiddler, und eine
Map **ist** ein Pinboard-Graph.

### Abbildung brausa → TiddlyWiki

| brausa | TiddlyWiki / tw5-graph |
|---|---|
| Karte | Tiddler: `title`, `text` (Markdown, mit markdown-Plugin, oder WikiText), `tags`, `color`, `status`, eigene Felder |
| Karten-ID | Feld `brausa-id` (stabil, auch wenn der Titel sich ändert) |
| Unterkarten | Feld `brausa-parent` (Titel der Elternkarte) und `list` (Reihenfolge der Kinder) → ergibt automatisch eine „lists“-Kante |
| Verbindung | Listenfeld `brausa-links` plus Config-Tiddler `$:/config/flibbles/graph/edges/fields/brausa-links` mit `{"label": "verweist auf"}`. Getypte Verbindungen bekommen je ein eigenes Feld (`brausa-depends` …) |
| Map | Graph-Tiddler mit `$engine: Pinboard`, `filter: [field:brausa-map[<id>]]`, Positionen im Text, Größen und Ansicht im Feld `pinboard` |
| Unter-Ebene | eigener Pinboard-Graph-Tiddler pro Karte mit Kindern |
| Datei-Verweis | `_canonical_uri` (Bilder, PDFs) bzw. Link-Feld; Dateien optional ins Wiki kopieren |
| Kanban-Ansicht | Graph-Tiddler mit `$engine: Kanban`, `columns` aus dem Status-Feld |

### Schritte (vom Einfachen zum Vollständigen)

1. **Export als TiddlyWiki-Ordner** (einseitig): brausa schreibt `.tid`-Dateien
   und einen `tiddlywiki.info` mit den Plugins `flibbles/graph`,
   `lasjoh-toho/pinboard` und `lasjoh-toho/kanban`. Ein Klick erzeugt ein
   vorzeigbares Wiki.
2. **Export als JSON-Paket** zum Hineinziehen in ein bestehendes
   Single-File-Wiki: TiddlyWikis normaler Import, ohne Server.
3. **Import** eines TW-Ordners oder JSONs als Map; der Rückweg nutzt dieselbe
   Abbildung.
4. **Live-Sync mit einem Ordner-Wiki:** brausa beobachtet den Wiki-Ordner, wie
   die Bibliothek. Geänderte `.tid`-Dateien werden in die Map übernommen und
   umgekehrt. Konflikte entscheidet `modified`; Konfliktfälle werden angezeigt,
   nichts wird still überschrieben.
5. **Erweiterung im tw5-graph-Fork:** *Drill-down* für Pinboard. Eine Karte mit
   `brausa-parent`-Kindern öffnet per Doppelklick bzw. Zoom ihre Unterebene. Das
   bildet die ZUI auch im Wiki nach. Der Präsentationspfad (`steps`) kann
   ebenenübergreifend fliegen.

### TiddlyDesktop-RS (Stand Oktober 2026)

TiddlyDesktop-RS (BurningTreeC, Tauri + System-WebView) verwaltet
**Einzeldatei-Wikis** (Speichern mit Strg+S, Backups in `.backups/`) und
**Ordner-Wikis** (eigener Node.js-Prozess, speichert jede Änderung sofort als
`.tid`). Eine Kommandozeile, ein URL-Schema oder eine API gibt es nicht.
brausa dockt deshalb über die **Wiki-Dateien selbst** an: Es schreibt in ein
Wiki, das TiddlyDesktop-RS öffnet, und liest Änderungen von dort zurück.
TiddlyDesktop-RS bleibt dabei unverändert.

### Bags und Recipes (nach dem MultiWikiServer)

Der MultiWikiServer (MWS) speichert Tiddler in **Bags** (benannte Sammlungen).
Ein **Recipe** ist eine geordnete Liste von Bags; zusammen ergeben sie ein
Wiki. Bei gleichem Titel gewinnt der Bag weiter hinten im Recipe. Dieses
Modell übernimmt brausa, damit **mehrere Wikis gemeinsame Bags** nutzen
(Glossar, Personen, Vorlagen, Quellen …).

| Begriff | In brausa |
|---|---|
| **Bag** | Ordner mit `.tid`-Dateien unter `<App-Daten>/tw/bags/<name>/`, optional schreibgeschützt |
| **Map-Bag** | Eine Projektmap, als Bag gelesen: Karten, Pfeile und Snippets werden zu Tiddlern (Abbildung siehe oben). Er wird nicht gespeichert, sondern bei jedem Abgleich frisch erzeugt. |
| **Recipe** | Name, Liste von Bags und ein **Ziel-Wiki**: ein Ordner-Wiki (`tiddlywiki.info` + `tiddlers/`) oder ein Einzeldatei-Wiki (`.html`). Der letzte Bag ist der eigene, beschreibbare Bag des Wikis. |

**Abgleich** (ein Knopf pro Wiki, in beide Richtungen):

1. **Rückweg:** brausa vergleicht das Wiki mit dem Stand des letzten
   Abgleichs. Geänderte oder neue Tiddler werden so verteilt:
   - Tiddler einer **Karte** (Feld `brausa-id`): Titel, Text, Farbe und
     Status gehen zurück in die Map. Eine Umbenennung im Wiki benennt die
     Karte um.
   - Tiddler aus einem **gemeinsamen, beschreibbaren Bag** gehen in diesen
     Bag zurück, so dass alle Wikis mit diesem Bag die Änderung bekommen.
     Das weicht bewusst vom MWS ab: Dort landen Änderungen immer im obersten
     Bag und überdecken den gemeinsamen Tiddler nur.
   - **Neue** Tiddler und Änderungen an schreibgeschützten Bags landen im
     eigenen Bag des Wikis.
   - Hat sich ein Tiddler **auf beiden Seiten** geändert, gewinnt der Bag.
     Die Wiki-Fassung wird als `<Titel> (Konflikt <Datum>)` im eigenen Bag
     aufbewahrt. Nichts geht still verloren.
   - Löschungen im Wiki löschen in beschreibbaren Bags; Karten werden nie
     aus dem Wiki heraus gelöscht.
   - Zustands-Tiddler wie `$:/StoryList`, `$:/state/…` und `$:/temp/…`
     werden ignoriert.
2. **Hinweg:** brausa schreibt alle Bags des Recipes ins Wiki. Im Ordner-Wiki
   werden nur geänderte Dateien geschrieben. Im Einzeldatei-Wiki wird der
   Tiddler-Speicher im HTML ersetzt, vorher legt brausa eine Sicherung in
   `.backups/` an, wie TiddlyDesktop-RS.

**Einschränkungen:**
- Ein Einzeldatei-Wiki darf beim Abgleich nicht offen sein, sonst
  überschreibt sein nächstes Speichern den Abgleich. brausa warnt, wenn die
  Datei seit dem letzten Abgleich jünger ist als der Stand im Wiki.
- Ein Ordner-Wiki übernimmt von außen geschriebene Dateien erst nach dem
  Neuladen.

**Ausbaustufe Live-Sync:** brausa bietet die MWS-Schnittstelle selbst an,
lokal und nur auf 127.0.0.1. Das sind:

- `GET /recipes/:r/tiddlers.json?last_known_tiddler_id=…`
- `GET`/`PUT /recipes/:r/tiddlers/:title`
- `GET`/`DELETE /bags/:b/tiddlers/:title`
- `GET /recipes/:r/events` (Server-Sent Events)

Ein Wiki mit dem MWS-Client-Plugin synchronisiert damit live mit brausa;
gemeinsame Bags werden in allen offenen Wikis sofort sichtbar. Das hängt
davon ab, wie stabil die MWS-API ist; sie wird gerade aus dem Kern in ein
eigenes Projekt verlagert.

---

## 4. Roadmap

| Phase | Inhalt | Ergebnis |
|---|---|---|
| **A – Index** | `meta.jsonl` und SQLite-Cache, Datei-Identität, Abgleich und Reparatur, Migration der Sidecars, Statusanzeige | Ein `.brausa/` pro Bibliothek; Tags überleben Verschieben im Finder |
| **B – Map-Grundgerüst** ✅ | Datenformat, Renderer mit Pan/Zoom/Culling, Karten anlegen, bearbeiten, verschieben, Verbindungen ziehen, Undo | Erste nutzbare Map |
| **C – Tiefe und ZUI** ✅ | Unterkarten, semantischer Zoom, Hineinfliegen, Breadcrumbs, Drag zwischen Ebenen | iMapping-artiges Arbeiten |
| **D – Verzahnung** ✅ (ohne Suche nach Mustern über alle Bibliotheken) | Dateien als Karten mit Vorschaubild (über Index-IDs), Karten Dokumenten zuordnen, Kanban als Ansicht auf Karten („ins Kanban schicken“), Bausteine-Panel mit Suche und Ordnervorschlägen | Projektorganisation mit echten Dateien |
| **E – TiddlyWiki** (Bags, Recipes und Abgleich ✅; Live-Sync und Drill-down offen) | Bags und Recipes, Abgleich mit Ordner- und Einzeldatei-Wikis (TiddlyDesktop-RS), danach Live-Sync über die MWS-Schnittstelle; Drill-down im Pinboard-Fork | Projekte im Wiki vorstellen, gemeinsame Bags in mehreren Wikis |
| **F – Web und Lesen** (Leser, Snippets und Stapel ✅; Web-Pane und Clipper offen) | Web-Pane, PDF-/HTML-Leser, Snippets mit Rücksprung zur Quelle, Snippet-Stapel, Clipper | Recherche direkt in Maps |

Reihenfolge-Empfehlung: **A vor B.** Maps verweisen auf Dateien, und das ist
nur mit stabilen Index-IDs robust. E kann nach B parallel beginnen, weil das
Format früh feststeht.

## 5. Entscheidungen (17.10.2026)

1. **Bibliotheken:** Jedes Projekt ist eine eigene Bibliothek (eigener Ordner
   mit `.brausa/`). Zusätzlich gibt es einen **globalen Überblick** über alle
   einbezogenen Ordner: eine Registry im App-Datenordner, die alle Projekte
   kennt und projektübergreifend suchen kann. Dateien außerhalb eines
   Projekts, die trotzdem Tags bekommen, landen im globalen Speicher
   (`<App-Daten>/global/meta.jsonl`, absolute Pfade, gleiche Reparaturlogik).
2. **Kartentext wie in TiddlyWiki:** Jede Karte hat einen `type`:
   `text/markdown` oder `text/vnd.tiddlywiki`. Der Standard ist pro Projekt
   einstellbar. Gerendert wird **mit dem echten TiddlyWiki-Kern**, der als
   JS-Bibliothek in brausa eingebettet ist. Markdown entspricht damit dem
   TW-Markdown-Plugin. Alles, was Markdown nicht abdeckt (Makros `<<…>>`,
   Transklusionen `{{…}}`, Widgets, `[[Links]]`), wird nach TW-Schema
   gerendert. Dadurch sieht eine Karte in brausa genau so aus wie später im
   Wiki.
3. **Karten ohne Datei** sind normal: Notizen, Lesezeichen, Aufgaben,
   Überschriften.

### Brauchen Notizen und Lesezeichen einen Projektordner?

**Nein, nicht zwingend.**

- Eine Karte lebt in der Map-Datei ihres Projekts
  (`.brausa/maps/<id>.json`). Eine Notiz erzeugt also keine eigene Datei
  und keinen Ordner.
- Für Lose, was (noch) zu keinem Projekt gehört, gibt es ein festes
  **Eingang-Projekt** (`~/Brausa/Eingang`, sichtbar und synchronisierbar).
  Schnell-Notizen, Clips und Lesezeichen landen dort und werden später per
  Drag in ein Projekt verschoben.
- **„Als Datei ablegen“** (optional pro Karte) schreibt eine Notiz als
  `.md`- bzw. `.tid`-Datei in den Projektordner. Das ist sinnvoll, wenn sie
  auch außerhalb von brausa auftauchen soll. Lesezeichen werden dabei zu
  `.url`/`.webloc` (klickbar im Finder).
- **Ein neues Projekt** entsteht nur bewusst: einen vorhandenen Ordner „als
  Projekt einbeziehen“ oder einen neuen anlegen.

### Umsetzungsdetail Phase A

Die SQLite-Datenbank kommt erst mit der Volltextsuche. Für Phase A reicht
`meta.jsonl` plus ein Speicherindex im Rust-Kern.

- `meta.jsonl` enthält **nur Dateien mit Metadaten** (Tags, Farbe, Notiz,
  Map-Verweise), nicht jede Datei. Damit bleibt die Datei klein.
- Für diese Einträge merkt sich brausa Datei-ID und Prüfwert. So werden
  extern verschobene Dateien wiedergefunden.
