> **Experimentelle Software.** brausa ist eine frühe Vorab-Version und wurde nach bestem Wissen und Gewissen erstellt. Trotzdem kann sie Fehler enthalten und arbeitet direkt mit Ihren Dateien. Die Nutzung erfolgt auf eigene Gefahr; soweit gesetzlich zulässig, wird keine Verantwortung oder Haftung übernommen. Bitte vorher eine Datensicherung anlegen und zuerst mit Testordnern ausprobieren.

## Installation

brausa ist nicht signiert, deshalb muss der erste Start freigegeben werden. Die Schritte stehen ausführlich in **LIESMICH-macOS.txt** und **LIESMICH-Windows.txt** (unten bei den Dateien, außerdem im DMG bzw. im Windows-Installer).

| System | Datei | Freigeben |
|---|---|---|
| macOS (Apple Silicon und Intel) | `brausa_*_universal.dmg` | macOS 15+: Starten, „Fertig“, dann Systemeinstellungen → Datenschutz & Sicherheit → **Dennoch öffnen**. macOS 14 und älter: ctrl-Klick → **Öffnen** |
| Windows | `brausa_*_x64-setup.exe` oder `.msi` | SmartScreen → **Weitere Informationen** → **Trotzdem ausführen** |
| Linux | `.AppImage` (ausführbar machen) oder `.deb` | – |

## Was drin ist

**Neu in 0.7: Web-Fenster und Archive**
- **Web-Fenster** (Weltkugel in der Toolbar): Seiten aus dem Internet neben den Dateien, abgeschottet mit eigenen Cookies und ohne Zugriff auf brausa oder deine Dateien. Downloads und gespeicherte Seiten landen im Projekt bzw. im aktuellen Ordner; **Auf die Map** legt markierten Text als Snippet mit Link zurück auf die Projektmap.
- **In Archive hineinschauen:** ZIP, tar und tar.gz öffnen sich per Doppelklick wie Ordner (nur lesend), mit Vorschau; herausziehen packt aus.
- **Lokale Websites** (Rechtsklick auf eine HTML-Datei → *Im Web-Fenster öffnen*): der Ordner wird nur auf diesem Rechner bereitgestellt, Links zwischen Seiten funktionieren, Skripte nur, wenn erlaubt.

**Neu in 0.6: Freie Projekte, zweites Panel, Kalender mit Wochentagen**
- **Projekte sind unabhängig von Ordnern:** frei benannt (+ bei *Projekte*), Dateien und Ordner von überall darauf ziehen fügt sie hinzu, ohne sie zu verschieben. Ein Klick zeigt alle Dateien des Projekts in jeder Ansicht; Entf nimmt eine Datei nur aus dem Projekt. Bisherige Ordner-Projekte werden mit ihren Maps übernommen.
- **Zweites Panel** (Symbol neben *Ablage*): ein zweiter Ordner rechts daneben, Dateien in beide Richtungen ziehen, ⌥/Strg kopiert, ⇄ tauscht die Seiten, Grenze verschiebbar.
- **Kalender:** Klick auf eine Jahreszahl öffnet ein Tagesband über alle Jahre mit allen Wochentagen und Summen je Wochentag, waagerecht scrollbar. Ziehen zeichnet einen **Rahmen** über Wochen und Wochentage (z. B. nur Montage von Juli bis Oktober), ⌘/Strg + Ziehen fügt Rahmen hinzu, Klick auf Mo … So schaltet Wochentage um.

**Neu in 0.5: Vorschau für alles, Filter nach Dateiart**
- **Leertaste-Vorschau** jetzt auch für **Videos und Audio** (mit Player; was das System nicht abspielen kann, öffnet sich mit einem Klick in der Standard-App), **PDFs**, **Text und Code** (php, js, css, json, py … mit Syntax-Farben, Markdown formatiert) und **Webseiten** mit ihrem CSS und ihren Bildern.
- **Webseiten mit Skripten:** brausa fragt vorher und warnt. Die Antwort lässt sich für die Datei oder den ganzen Ordner merken und über „Ändern“ zurücknehmen. Die Seite läuft abgeschottet ohne Zugriff auf brausa oder andere Dateien.
- **Filter nach Dateiart:** „Alle Arten ▾“ neben Stream zeigt z. B. alle Videos aus allen Unterordnern. Im Suchfeld: `is:video`, `is:medien`, `is:bild,pdf`, `-is:bild`.

**Neu in 0.4.1**
- **LIESMICH** im DMG und im Windows-Installer: wie man die unsignierte App freigibt, dazu der Hinweis auf experimentelle Software. Die macOS-App ist jetzt ad-hoc signiert.
- **Schöneres Kanban im Wiki:** Graph 1.13.1, Pinboard 0.3.0 und Kanban 0.3.1 aus [TiddlyVisuals](https://lasjoh-toho.github.io/TiddlyVisuals/), mit farbigen Spalten, Kartenansicht und gespeicherten Suchen.

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
