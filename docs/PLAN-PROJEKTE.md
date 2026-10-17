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
  - Gezeichnet wird mit Canvas 2D bzw. WebGL (z. B. PixiJS).
  - Nur die gerade bearbeitete Karte ist ein echtes HTML-Element.
  - Was außerhalb des Sichtfelds liegt, wird nicht gerendert (Viewport-Culling).
  - Unterkarten werden erst ab Detailstufe 3 geladen.
- **Navigation:** Mausrad oder Pinch zoomt zum Zeiger hin. Doppelklick fliegt
  in eine Karte hinein, `Esc` oder Herauszoomen geht eine Ebene zurück. Oben
  steht eine Breadcrumb-Leiste („Roadmap › Phase 3 › Web-Clipper“), deren
  Segmente wie heute Drop-Ziele sind.

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

### TiddlyDesktop-RS

TiddlyDesktop-RS kenne ich nicht im Detail. Der Plan setzt deshalb auf
**Ordner-Wikis** und **Standard-Tiddlerformate** (`.tid` und JSON). Damit
funktioniert die Anbindung mit jeder TiddlyWiki-Umgebung, auch ohne
TiddlyDesktop-RS. Falls TiddlyDesktop-RS eine eigene Schnittstelle hat
(Kommandozeile, IPC, Ordner-Watcher), kann brausa daran andocken: etwa mit
„Wiki öffnen“ direkt aus einer Map. Dafür bräuchte ich das Repository.

Eine mögliche spätere Variante: brausa bettet das Wiki selbst in eine eigene
WebView ein (Tauri kann mehrere WebViews). Dann wäre die Präsentation im Wiki
ein Tab in brausa.

---

## 4. Roadmap

| Phase | Inhalt | Ergebnis |
|---|---|---|
| **A – Index** | `meta.jsonl` und SQLite-Cache, Datei-Identität, Abgleich und Reparatur, Migration der Sidecars, Statusanzeige | Ein `.brausa/` pro Bibliothek; Tags überleben Verschieben im Finder |
| **B – Map-Grundgerüst** | Datenformat, Canvas-Renderer mit Pan/Zoom/Culling, Karten anlegen, bearbeiten, verschieben, Verbindungen ziehen, Undo | Erste nutzbare Map |
| **C – Tiefe und ZUI** | Unterkarten, semantischer Zoom, Hineinfliegen, Breadcrumbs, Drag zwischen Ebenen | iMapping-artiges Arbeiten |
| **D – Verzahnung** | Dateien als Karten (über Index-IDs), Kanban als Ansicht auf Karten, Bausteine-Panel mit Suche und Ordnervorschlägen | Projektorganisation mit echten Dateien |
| **E – TiddlyWiki** | Export Ordner/JSON, Import, danach Live-Sync; Drill-down im Pinboard-Fork | Projekte im Wiki vorstellen |
| **F – Web** | Web-Pane, Ziehen ins Map, Clipper | Recherche direkt in Maps |

Reihenfolge-Empfehlung: **A vor B.** Maps verweisen auf Dateien, und das ist
nur mit stabilen Index-IDs robust. E kann nach B parallel beginnen, weil das
Format früh feststeht.

## 5. Offene Entscheidungen

1. **Bibliotheks-Grenze:** Ist jeder Projektordner eine eigene Bibliothek, oder
   gibt es eine große Bibliothek (z. B. `~`) mit Projekten darin?
   *Empfehlung:* mehrere Bibliotheken, frei wählbar.
2. **Kartentext:** Markdown (verbreitet, im Wiki mit Plugin) oder WikiText
   (nativ in TW)? *Empfehlung:* Markdown in brausa, beim Export wählbar.
3. **Sollen Map-Karten auch ohne Datei existieren können?** *Empfehlung:* ja,
   Karten sind eigenständige Notizen, Dateien nur optionale Verweise.
