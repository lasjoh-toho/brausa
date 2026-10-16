# brausa

Ein visueller, plattformunabhängiger Datei-Browser für macOS, Windows und Linux.
Er ist für schnelles Sortieren per Drag & Drop gebaut, mit portablen Tags ohne
Lock-in und flachen Bild-Streams statt tiefer Ordnerbäume.

> Vollständiges Konzept, Architektur und Roadmap: **[docs/KONZEPT.md](docs/KONZEPT.md)**

![Stream-Ansicht](docs/img/stream.jpg)

| Ziehen in den Baum (aufklappen beim Hovern, Breadcrumb-Leiste) | Ablage-Raster |
|---|---|
| ![](docs/img/drag-baum.jpg) | ![](docs/img/ablage-raster.jpg) |
| **Kanban nach Tags** | **Vorschau fließt unter die Toolbar** |
| ![](docs/img/kanban.jpg) | ![](docs/img/vorschau.jpg) |

## Was schon geht (v0.1)

| Bereich | Funktion |
|---|---|
| **Ordnerbaum** | Klappt beim Ziehen über einem Ordner nach ~0,5 s auf und danach wieder zu. **Dual-Zone-Drop:** linke Hälfte verschiebt (mit ⌥ bzw. Strg: kopiert), rechte Hälfte überträgt Tags und Farbe des Ordners. |
| **Breadcrumb-Drop** | Beim Ziehen erscheint oben eine Pfadleiste; jedes Segment ist ein Ablageziel. |
| **Ablage-Raster** | Datei auf **Ablage** in der Toolbar ziehen öffnet ein konfigurierbares N×M-Raster aus Ordnern und Tags. Ein Klick auf „Ablage“ öffnet die Einstellungen dazu. |
| **Stream** | Unterordner werden zu einer durchgehenden Bildwand mit Pfad-Badge pro Kachel. Ordner aus dem Baum auf die Fläche ziehen filtert auf diesen Zweig (Funnel). |
| **Ansichten** | Stream-Grid, Kanban (Spalten nach Tags oder Unterordnern, Ziehen zwischen Spalten setzt den Tag um), Zeitachse (nach Monat), Karte (Vorschau ohne Kacheln). |
| **Auswahl** | Klick, Shift-Bereich, ⌘/Strg-Toggle, Lasso, ⌘/Strg+A, **Auswahl per Muster** (`*.png > 5MB`, `#ToReview`, `modified < 30d`, `ext:jpg,png`, `-#done`). |
| **Ablage-Tray** | Dateien aus beliebigen Ordnern sammeln (Drag oder `S`). Der Inhalt bleibt beim Navigieren erhalten und lässt sich als Gruppe verschieben oder taggen. |
| **Tags** | `T` öffnet die Quick-Tag-Leiste mit Autovervollständigung, zuletzt benutzten Tags und Farben. Hierarchische Tags (`Work/Design/UI` erscheint auch unter `#Work`). Gespeichert wird in `.brausa/<datei>.meta.json`; Tags im Dateinamen (`Foto[urlaub strand].jpg`) werden mitgelesen. |
| **Vorschau** | Doppelklick oder Leertaste: Das Bild wächst aus der Kachel bis unter die Toolbar, die zu Glas in der Bildfarbe wird. ←/→ blättert. |
| **Rückgängig** | Verschieben lässt sich über die Meldung unten rechts zurücknehmen. |

## Entwickeln

Voraussetzungen: Node ≥ 20 und Rust (stable). Unter Linux zusätzlich
`libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev`
([Tauri-Voraussetzungen](https://v2.tauri.app/start/prerequisites/)).

```bash
npm install
npm run tauri dev        # Desktop-App mit echtem Dateisystem
npm run dev              # nur UI im Browser, mit Demo-Daten (http://localhost:1420)
npm test                 # Domänenkern (Vitest)
npm run check            # Typprüfung
cd src-tauri && cargo test   # Rust-Kern
npm run tauri build      # Installer für das aktuelle Betriebssystem
```

Im Browser läuft automatisch das `DemoBackend` mit generierten Beispielbildern.
Damit lässt sich die Oberfläche ohne Rust-Toolchain entwickeln.

## Aufbau

```
src/lib/core/       reines TypeScript: Tags, Muster-Auswahl, Ansichten, Pfade (+ Tests)
src/lib/backend/    Backend-Interface · TauriBackend · DemoBackend
src/lib/state/      App-Zustand (Svelte-5-Runes) · Drag-Controller
src/lib/components/ Sidebar, Baum, Toolbar, Canvas, Tray, Overlays
src-tauri/src/      Rust: Dateisystem, Sidecar-Metadaten, Tauri-Commands (+ Tests)
docs/KONZEPT.md     Konzept, Architektur, Roadmap
```

## Tastenkürzel

| Taste | Aktion |
|---|---|
| `T` | Auswahl (oder Ablage) taggen |
| `S` | Auswahl in die Ablage legen |
| `Leertaste` | Vorschau |
| `⌘/Strg+F` | Suche oder Muster |
| `⌘/Strg+A` | Alles auswählen |
| `⌫` bzw. `⌘/Strg+↑` | Übergeordneter Ordner |
| `⌘/Strg+[` / `]` | Zurück / Vor |
| `Esc` | Funnel bzw. Auswahl aufheben, Drag abbrechen |
| `⌥` (macOS) bzw. `Strg` beim Ziehen | Kopieren statt Verschieben |
