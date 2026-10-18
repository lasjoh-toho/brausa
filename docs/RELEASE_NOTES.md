> **Experimentelle Software.** brausa ist eine frühe Vorab-Version und wurde nach bestem Wissen und Gewissen erstellt. Trotzdem kann sie Fehler enthalten und arbeitet direkt mit Ihren Dateien. Die Nutzung erfolgt auf eigene Gefahr; soweit gesetzlich zulässig, wird keine Verantwortung oder Haftung übernommen. Bitte vorher eine Datensicherung anlegen und zuerst mit Testordnern ausprobieren.

## Installation

brausa ist nicht signiert, deshalb muss der erste Start freigegeben werden. Die Schritte stehen ausführlich in **LIESMICH-macOS.txt** und **LIESMICH-Windows.txt** (unten bei den Dateien, außerdem im DMG bzw. im Windows-Installer).

| System | Datei | Freigeben |
|---|---|---|
| macOS (Apple Silicon und Intel) | `brausa_*_universal.dmg` | macOS 15+: Starten, „Fertig“, dann Systemeinstellungen → Datenschutz & Sicherheit → **Dennoch öffnen**. macOS 14 und älter: ctrl-Klick → **Öffnen** |
| Windows | `brausa_*_x64-setup.exe` oder `.msi` | SmartScreen → **Weitere Informationen** → **Trotzdem ausführen** |
| Linux | `.AppImage` (ausführbar machen) oder `.deb` | – |

## Was drin ist

**Neu in 0.4: Leser, Snippets und TiddlyWiki**
- **Leser für PDF und HTML** direkt in der Projektmap: Text markieren und als **Snippet** auf die Map ziehen. Ein Klick auf das Snippet springt zurück an die Stelle im Dokument.
- **Snippet-Stapel** wie in LiquidText: Snippet an die Ober- oder Unterkante eines anderen ziehen verbindet beide; Umsortieren und Herauslösen per Ziehen.
- **Wikis für TiddlyDesktop-RS:** Maps, Karten und Kanban werden als Tiddler in ein Ordner- oder Einzeldatei-Wiki abgeglichen, in beide Richtungen. Bags und Recipes wie im MultiWikiServer: mehrere Wikis teilen sich gemeinsame Bags.
- **Überdeckungen auflösen:** Ändert ein Wiki einen gemeinsamen Tiddler, landet die Änderung im eigenen Bag des Wikis. Ein eigenes Werkzeug zeigt alle Überdeckungen mit Diff: für alle übernehmen, zusammenführen, verwerfen oder als Variante behalten.
- **Plugins eingebaut:** Markdown, Graph (vis-network), Pinboard und Kanban werden mitgeliefert. Karten erscheinen im Wiki sofort als Pinboard und Kanban, im Wiki muss nichts installiert werden.

**Neu in 0.3: Projektmaps**
- **Projektmap** pro Projekt (Symbol ganz rechts in der Ansichtsleiste): unendliche, stufenlos zoombare Fläche mit Karten (Titel, Markdown-Text, Farbe). Mehrere Maps pro Projekt, gespeichert in `<Projekt>/.brausa/maps/`.
- **Unterkarten:** Karte auf eine andere ziehen macht sie zur Unterkarte, beliebig tief. `↵` fliegt hinein, `Esc` eine Ebene hinauf, die Breadcrumb zeigt, wo man ist.
- **Pfeile** zwischen Karten, auch über Ebenen hinweg, mit Beschriftung. Rückgängig/Wiederholen.
- **Dateien als Karten:** Dateien aus der Dateiliste, dem Ordnerbaum oder der Ablage auf die Map ziehen ergibt Karten mit Vorschaubild; Doppelklick öffnet in der Standard-App.
- **Karten mit Dokumenten verknüpfen:** Datei auf den rechten Kartenrand ziehen, oder Karte auf eine Datei. Verknüpfungen überleben Umbenennen und Verschieben im Finder/Explorer.
- **Kanban für Karten:** Karten ins Kanban schicken, Spalten = Status, Klick führt zurück auf die Map.

**Neu in 0.2**
- **Projekte mit zentralem Index:** Ordner unter *Projekte* einbeziehen. Tags und Farben liegen in `<Projekt>/.brausa/meta.jsonl` statt in einer Datei pro Ordner. Dateien, die im Finder oder Explorer verschoben oder umbenannt wurden, werden wiedererkannt. Alte Sidecars werden automatisch übernommen.
- **Kalender-Heatmap:** zoombar (Jahre → Jahr → Monat). Ziehen setzt einen Zeitfilter, wählbar nach geändert, erstellt oder aufgenommen (EXIF).
- **Karte** mit OpenStreetMap für Fotos mit GPS
- **Schnelle Vorschaubilder:** Hochkant-Fotos werden richtig gedreht.
- **Dateiaktionen:** Doppelklick öffnet in der Standard-App, dazu Kontextmenü, Umbenennen, Papierkorb und neuer Ordner.
- **Live-Aktualisierung,** wenn andere Programme Dateien ändern

**Seit 0.1**
- Ordnerbaum, der beim Ziehen über einem Ordner aufklappt; Dual-Zone-Drop (links verschieben, rechts Tags und Farbe übernehmen)
- Breadcrumb-Drop-Leiste und Ablage-Raster
- Stream über Unterordner, Kanban, Zeitachse
- Lasso, Auswahl per Muster (`*.png > 5MB`, `#tag`), Ablage-Tray
- Hierarchische Tags (`T`), Zoom-Vorschau, Rückgängig für Verschieben

Details und Roadmap: [README](https://github.com/lasjoh-toho/brausa#readme) · [Konzept](https://github.com/lasjoh-toho/brausa/blob/main/docs/KONZEPT.md)
