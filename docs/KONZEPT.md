# brausa – Konzept

> Ein plattformunabhängiger Datei-Browser für schnelles visuelles Sortieren,
> Taggen und Sammeln, als Ersatz für Finder, Explorer oder Nautilus im Alltag.
> Läuft auf macOS, Windows und Linux.

---

## 1. Leitideen

1. **Räumlich statt hierarchisch denken.** Ordner bleiben die Wahrheit auf der
   Platte. Die Oberfläche zeigt sie aber als Ströme, Boards, Zeitachsen und Karten.
2. **Drag & Drop als Hauptwerkzeug.** Jede Aktion (verschieben, kopieren,
   taggen, sammeln) muss sich mit einer einzigen Ziehbewegung erledigen lassen,
   auch in tief verschachtelte Ordner.
3. **Kein Lock-in.** Alle Metadaten liegen als lesbare Dateien neben den Daten
   (Sidecar-JSON oder im Dateinamen). Ein Index ist nur ein Cache, den man
   jederzeit neu aufbauen kann.
4. **Ruhige, klare Oberfläche** nach dem Vorbild von FFFFinder: viel Bild,
   wenig Chrome. Beim Zoomen „fließt“ das Bild bis unter die Menüleiste.
5. **Offline zuerst.** Auch die KI-Funktionen laufen lokal (Ollama /
   llama.cpp). Sie sind als Erweiterung vorgesehen, aber nicht Pflicht.

---

## 2. Technologie-Entscheidung

| Schicht | Wahl | Begründung |
|---|---|---|
| App-Shell | **Tauri 2** | Nutzt die System-WebView (WKWebView, WebView2, WebKitGTK). Ca. 10 MB Binary, wenig RAM; wichtig für ein Werkzeug, das immer offen ist. Rechtemodell über Capabilities. |
| Kern / Dateisystem | **Rust** (`src-tauri`) | Schnelle rekursive Scans (`walkdir`), atomare Moves und Kopien, Dateisystem-Watcher (`notify`), später Thumbnails und EXIF/GPS. |
| UI | **Svelte 5 + TypeScript + Vite** | Feingranulare Reaktivität ohne Virtual DOM, gut für Grids mit tausenden Kacheln. Wenig Boilerplate. |
| Domänenlogik | **reines TypeScript** (`src/lib/core`) | Tags, Muster-Auswahl, Gruppierung für Views: ohne UI- und ohne Plattform-Abhängigkeit, mit Vitest getestet. |
| Backend-Abstraktion | `Backend`-Interface | `TauriBackend` (echt) und `DemoBackend` (In-Memory). Die UI läuft dadurch auch im normalen Browser, für Entwicklung, Tests und Screenshots. |

**Verworfen: Electron.** Damit wäre der Web-Bereich (eingebettetes
Chromium) einfacher. Der Speicherbedarf von 150–300 MB pro Fenster passt aber
nicht zu einem Dateimanager. Falls Tauris Multi-WebView (Funktion 3) auf einer
Plattform nicht stabil genug ist, wird das Web-Pane als angedocktes zweites
Fenster gebaut. Die Architektur ändert sich dadurch nicht.

### Plattform-Unterschiede (in einer Schicht gekapselt)

| Thema | macOS | Windows | Linux |
|---|---|---|---|
| Kopieren-Modifier beim Drag | ⌥ Option | Strg | Strg |
| Mehrfachauswahl-Toggle | ⌘ | Strg | Strg |
| Papierkorb | `trash`-Crate | `trash`-Crate | `trash`-Crate (FreeDesktop) |
| Drag *aus* der App in andere Apps | `tauri-plugin-drag` | dto. | dto. |
| Versteckte Dateien | Punkt-Präfix | Attribut + Punkt | Punkt-Präfix |

Die Tastenbelegung liegt zentral in `src/lib/platform.ts`.

---

## 3. Architektur

```
┌──────────────────────────── UI (Svelte) ───────────────────────────┐
│ Sidebar/Tree │ Toolbar │ Canvas (Stream/Kanban/Timeline/Map) │ Tray │
│        ▲ DragController (Pointer-Events, eigener Zustandsautomat)  │
├────────────────────────── App-State (Runes) ───────────────────────┤
│ workspace · selection · staging · dragState · settings             │
├──────────────────── Domänenkern (reines TS) ───────────────────────┤
│ tags · sidecar-Format · pattern-select · views/grouping · paths    │
├──────────────────────── Backend-Interface ─────────────────────────┤
│   TauriBackend (invoke)            │  DemoBackend (In-Memory)       │
├────────────────────────────────────┴───────────────────────────────┤
│ Rust: list_dir · walk · move/copy · meta read/write · watch · thumbs│
└────────────────────────────────────────────────────────────────────┘
```

### 3.1 Datenmodell

```ts
Entry {
  path, name, ext, kind: 'dir' | 'file',
  size, mtime, ctime,
  tags: string[],          // aus Sidecar + Dateiname vereinigt
  color?: string,          // Farbmarke
  geo?: { lat, lon },      // aus EXIF (Phase 2) oder Sidecar
  relDir?: string          // im Stream-Modus: Unterpfad relativ zur Wurzel
}
```

### 3.2 View-Pipeline

Alle Ansichten nutzen dieselbe Pipeline. Eine neue Ansicht braucht deshalb nur
eine neue Layout-Komponente:

```
Quelle (Ordner, rekursiv ja/nein, Funnel-Filter)
  → Filter (Suche, Tags, Muster)
  → Gruppierung (keine | Tag | Unterordner | Tag/Monat | Geo)
  → Layout (Grid | Kanban | Timeline | Map)
```

### 3.3 Drag-System

Natives HTML5-Drag-and-Drop ist zwischen den WebViews uneinheitlich.
Drag-Bilder, Hover-Expand und Modifier lassen sich damit kaum kontrollieren.
brausa nutzt deshalb **einen eigenen DragController auf Basis von
Pointer-Events**:

- `idle → pressing → dragging → (drop | cancel)`. Der Drag startet erst nach
  einer Bewegung von mehr als 5 px.
- Drop-Ziele melden sich mit `data-drop-*`-Attributen an. Per Hit-Test
  (`elementFromPoint`) wird das Ziel und seine **Zone** bestimmt (linke oder
  rechte Hälfte).
- Ein Hover-Timer (Standard 550 ms) klappt eingeklappte Ordner auf
  („spring-loaded“).
- Verlässt der Zeiger das Fenster, übernimmt später der native Drag
  (`tauri-plugin-drag`). Dateien lassen sich dann in Mail, Slack usw. ziehen.
  Drops von außen kommen über Tauris `onDragDropEvent`.

---

## 4. Funktionen im Detail

### 1A Deep-Dive-Ordnerbaum

| Funktion | Umsetzung |
|---|---|
| **Aufklappen beim Hovern** | Hover-Timer pro Baumknoten. Kinder werden lazy geladen und mit einer Höhen- und Opacity-Transition eingeblendet. Beim Drop klappen die automatisch geöffneten Zweige wieder zu, die vorher manuell geöffneten bleiben offen. |
| **Breadcrumb-Drop-Leiste** | Erscheint oben, sobald ein Drag läuft. Sie zeigt den Pfad des Ordners, über dem man gerade hovert, sonst den aktuellen Ordner. Jedes Segment ist ein Drop-Ziel. |
| **Breadcrumb-Funnel** | Zieht man einen Ordner auf den Canvas, wird der Stream auf diesen Unterzweig gefiltert. Die Ansicht bleibt gleich. Der Filter erscheint als entfernbarer Chip. |
| **Dual-Zone-Drop** | Linke Hälfte eines Ordners: verschieben (mit Modifier: kopieren). Rechte Hälfte: Tags und Farbe des Ordners werden auf die Dateien übertragen, sie bleiben aber, wo sie sind. Beide Zonen sind beim Hovern farbig markiert und beschriftet. |
| **Ablage-Raster** | Ein Toolbar-Feld „Ablage“. Zieht man eine Datei darauf, öffnet sich ein konfigurierbares N×M-Raster mit Standardablagen (Ordner oder Tag). Konfiguration in `settings.dropGrid`, Platzhalter-Zellen sind möglich. |

### 1B Flache Ströme und Ansichten

- **Rekursiver Stream:** Ein Schalter in der Toolbar. Im Backend sammelt
  `walk(root, maxDepth)` alle Dateien. Jede Kachel zeigt ein dezentes
  Pfad-Badge (`2026/Raw`); beim Hovern erscheint der volle Unterpfad.
- **Ansichten:** Stream (Grid), Kanban (Spalten nach Tag oder Unterordner,
  Drag zwischen Spalten taggt bzw. verschiebt), Timeline (nach Monat
  gruppiert), Karte (Leaflet + OSM-Kacheln, offline-fähig; Phase 2, die
  Geo-Daten dafür kommen aus EXIF).
- **Zoom ins Menü:** Doppelklick oder Leertaste öffnet die Vorschau. Das Bild
  wächst per FLIP-Animation aus der Kachel auf die volle Fensterfläche,
  *inklusive* der Toolbar-Zone. Die Toolbar wird dabei transparent und liegt
  mit Blur über dem Bild, die Akzentfarbe übernimmt den Farbton des Bildes.

### 2A Auswahl und Sammel-Tray

- `Shift+Klick` (Bereich), `⌘/Strg+Klick` (Toggle), Lasso auf freier Fläche
  (mit Modifier additiv), `⌘/Strg+A`.
- **Staging-Tray:** Eine Leiste unten. Dateien kommen per Drag oder `S`
  hinein. Der Inhalt bleibt beim Ordnerwechsel erhalten und wird lokal
  gespeichert. Aktionen auf dem Tray: alle verschieben, kopieren oder taggen,
  einzeln entfernen, leeren. Der ganze Tray lässt sich als Gruppe in einen
  Ordner ziehen.
- **Auswahl per Muster:** In der Suchleiste wählt `>` gefolgt von einem Muster
  Dateien aus. Beispiele:
  `*.png > 5MB` · `#ToReview` · `*.jpg #Urlaub < 2MB` · `modified < 30d` ·
  `kind:dir`. Die Grammatik steht in `src/lib/core/pattern.ts`.

### 2B Portables Tag-System

- **Speicherorte (umschaltbar je Bibliothek):**
  1. **Sidecar (Standard):** `<Ordner>/.brausa/<Dateiname>.meta.json`.
     Ein versteckter Unterordner pro Verzeichnis, damit keine Einzeldateien
     herumliegen. Synchronisiert mit Dropbox, iCloud, Nextcloud und
     Syncthing.
  2. **Dateiname:** `Foto[urlaub strand].jpg` (TagSpaces-kompatible Klammern).
     Unterstriche wie in `Foto_tag1_tag2.jpg` sind mehrdeutig, weil viele
     Dateinamen schon Unterstriche enthalten. brausa *liest* dieses Format
     optional (Einstellung „Unterstrich-Tags“), *schreibt* aber Klammern.
- **Sidecar-Format** (versioniert, offen dokumentiert):
  ```json
  { "v": 1, "tags": ["Work/Design/UI", "ToReview"], "color": "#e5a50a",
    "note": "", "geo": null, "source": null, "updated": "2026-10-16T12:00:00Z" }
  ```
- **Robustheit:** brausa-Operationen verschieben und benennen den Sidecar
  immer mit. Wird eine Datei außerhalb von brausa verschoben, ordnet der
  Index sie später über Größe, mtime und Hash neu zu (Phase 2).
- **Quick-Tag-Leiste (`T`):** Schwebende Eingabe mit Autovervollständigung aus
  allen bekannten Tags, Farbbadges und den zuletzt benutzten Tags. Enter
  fügt hinzu, `-tag` entfernt.
- **Hierarchische Tags:** `Work/Design/UI`. Der Index nimmt automatisch
  `Work` und `Work/Design` dazu. Ein Filter auf `#Work` findet daher auch
  `Work/Design/UI`. Gespeichert wird nur der Blatt-Tag.

### 3 Web und Dateien

- **Web-Pane (Phase 3):** Geteilte Ansicht mit eingebetteter WebView links
  (Tauri Multi-WebView) und Ordnerbaum plus Tray rechts. Bilder und Links aus
  der Seite lassen sich in Ordner oder den Tray ziehen. Sie werden lokal
  gespeichert, die Quell-URL kommt in den Sidecar.
- **Web-Clipper:** Readability-Extraktion zu sauberem HTML (später PDF via
  Print-to-PDF) mit Sidecar `source: { url, title, clippedAt }`.
  Lesezeichen werden als `.url`- oder `.webloc`-Datei plus Sidecar gespeichert
  und sind so in allen Betriebssystemen klickbar.

### 3 Lokale KI (vorbereitet, Phase 4)

- Interface `AiProvider { tagSuggest(entries), summarize(entry), query(nl) }`
  in `src/lib/ai/`.
- Erster Provider: **Ollama** über `http://localhost:11434`. Den Aufruf macht
  das Rust-Backend, damit keine CORS-Probleme entstehen und lange Jobs
  abgebrochen werden können.
- KI schreibt **nie** direkt. Sie erzeugt *Vorschläge*, die man in der
  Tag-Leiste bestätigt.
- Natürlichsprachige Suche wird in das vorhandene Muster-Format übersetzt
  (`"Vektor-Logos letzten Monat"` → `*.svg #logo modified < 31d`). Die
  Suche bleibt so nachvollziehbar und lässt sich von Hand nachbessern.

---

## 5. Roadmap

| Phase | Inhalt | Status |
|---|---|---|
| **0 – Fundament** | Konzept, Projektgerüst, Domänenkern mit Tests, Backend-Interface, Demo-Backend | ✅ in diesem Schritt |
| **1 – MVP-Oberfläche** | Baum mit Aufklappen beim Hovern, Breadcrumb-Drop, Dual-Zone, Ablage-Raster, Stream, Kanban, Timeline, Auswahl und Lasso, Tray, Quick-Tag, Muster-Auswahl, Zoom-Vorschau, Undo für Verschieben | ✅ erste Version, unter Linux (WebKitGTK) mit echtem Dateisystem getestet |
| **2 – Echte Daten** | Thumbnails (Rust, `image`-Crate, Cache), EXIF/GPS, Karten-Ansicht, Watcher, Undo-Stack, Papierkorb, Index (SQLite als Cache) | offen |
| **3 – Web** | Web-Pane, Clipper, Lesezeichen, nativer Drag hinaus | offen |
| **4 – KI** | Ollama-Provider, Auto-Tag-Vorschläge, Zusammenfassungen, NL-Suche | offen |
| **5 – Release** | Signierte Builds (notarisiert für macOS, MSI für Windows, AppImage/deb für Linux) über GitHub Actions | offen |

---

## 6. Offene Fragen

- Soll brausa sich als **Standard-Ordner-Handler** registrieren (z. B. für
  „Im Ordner anzeigen“)? Unter macOS geht das nur teilweise.
- **Mehrere Bibliotheken** (Arbeit, Privat) mit getrennten Tag-Sets?
- **Farbmarken** zusätzlich als native Finder-Tags (`xattr`) schreiben, damit
  sie auch in macOS sichtbar sind? Das wäre ein optionaler Export.
