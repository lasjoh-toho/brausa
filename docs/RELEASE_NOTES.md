> **Experimental software.** brausa is an early preview, built to the best of our knowledge. It may still contain bugs and works directly with your files. Use at your own risk; to the extent permitted by law, no responsibility or liability is accepted. Please make a backup first and try it with test folders.

[English](#english) · [Deutsch](#deutsch)

## English

### Install

brausa is not signed by Apple or Microsoft, so the first start has to be allowed. The steps are in **README-macOS.txt** and **README-Windows.txt** (attached below, also inside the DMG and the Windows installer).

| System | File | Allow |
|---|---|---|
| macOS (Apple silicon and Intel) | `brausa_*_universal.dmg` | macOS 15+: start, "Done", then System Settings → Privacy & Security → **Open Anyway**. macOS 14 and earlier: Control-click → **Open** |
| Windows | `brausa_*_x64-setup.exe` or `.msi` | SmartScreen → **More info** → **Run anyway** |
| Linux | `.AppImage` (make executable) or `.deb` | – |

### New in 0.9

- **No more hanging on system files.** Listings hide system files (AppData, Thumbs.db, recycle bin, everything Windows marks hidden or system). Stream and the live update leave program folders alone (node_modules, Program Files, Library on macOS, app bundles, photo libraries), so caches no longer cause constant reloading.
- **Watchdog.** If a view stops responding for 12 seconds, brausa offers to restart; the next start then opens plain tiles instead of the same view.
- **Photo data** (date taken, location) loads in the background with progress and a cancel button; the photo map stays fast with many photos.
- **Table view** with selectable, resizable columns.
- **Empty view because of a filter:** the filter is named and can be removed with one click.
- **Smart folders** are stored by brausa itself; projects in the sidebar open to show their own and linked smart folders.
- **Wikis:** bag "lokal" for file links and notes tagged lokal/privat; overview of the bags as matrix, graph and stacked layers; TiddlyVisuals 1.16.0 and Relink built in.

### New in 0.8

- **English interface.** brausa follows the desktop language (German or English, otherwise English); Settings (gear icon at the top of the sidebar) → Language changes it.
- **Automatic updates.** brausa looks for a new version shortly after starting and installs it on request (can be switched off in the settings). Updates are signed. *The first signed update will come with the next release; from 0.8 on, installed copies update themselves.*
- **List with preview** (three-column view): folder tree, a detail list with sortable columns, and a preview of the selected file. ↑/↓ browse.
- **Sort menu** in the toolbar: name, modified, created, taken (EXIF), size or kind, with a direction button.
- **Smart folders:** save search, kind filter and calendar frame with the folder or project, and get it all back with one click.
- **Find duplicates** (right-click on the background or a folder): compares content, selects the extra copies for the trash.
- **Batch rename** (F2 with several files): pattern with `{name}`, `{n:3}`, `{date}`, `{time}`, `{folder}`, search and replace, case, live preview with conflict check, undo.
- **Archives can be changed:** drop files onto a ZIP to pack them in, Del removes entries, right-click → *Compress* makes a ZIP (with a confirmation; the old archive goes to the trash).
- **Web panel:** bookmarks and history per project.

Details and roadmap: [README](https://github.com/lasjoh-toho/brausa#readme)

## Deutsch

### Installation

brausa ist nicht signiert, deshalb muss der erste Start freigegeben werden. Die Schritte stehen ausführlich in **LIESMICH-macOS.txt** und **LIESMICH-Windows.txt** (unten bei den Dateien, außerdem im DMG bzw. im Windows-Installer).

| System | Datei | Freigeben |
|---|---|---|
| macOS (Apple Silicon und Intel) | `brausa_*_universal.dmg` | macOS 15+: Starten, „Fertig“, dann Systemeinstellungen → Datenschutz & Sicherheit → **Dennoch öffnen**. macOS 14 und älter: ctrl-Klick → **Öffnen** |
| Windows | `brausa_*_x64-setup.exe` oder `.msi` | SmartScreen → **Weitere Informationen** → **Trotzdem ausführen** |
| Linux | `.AppImage` (ausführbar machen) oder `.deb` | – |

### Was drin ist

**Neu in 0.9: kein Hängen mehr an Systemdateien, Tabelle, Bag-Übersicht**
- **Systemdateien werden übersprungen:** Listen blenden Systemdateien aus (AppData, Thumbs.db, Papierkorb, alles, was Windows als versteckt oder System markiert). Stream und die Live-Aktualisierung lassen Programmordner aus (node_modules, Programme, unter macOS Library, App-Pakete, Fotomediatheken), Caches lösen kein ständiges Neuladen mehr aus.
- **Wachhund:** Reagiert eine Ansicht 12 Sekunden lang nicht, bietet brausa einen Neustart an; der nächste Start öffnet dann einfache Kacheln statt derselben Ansicht.
- **Aufnahmedaten** (Datum, Ort) werden im Hintergrund gelesen, mit Fortschritt und „Abbrechen“; die Foto-Karte bleibt auch mit vielen Fotos schnell.
- **Tabellenansicht** mit wählbaren, verschiebbaren Spalten.
- **Leere Ansicht durch Filter:** der Filter wird genannt und lässt sich mit einem Klick entfernen.
- **Intelligente Ordner** speichert brausa jetzt selbst; Projekte in der Seitenleiste klappen auf und zeigen ihre eigenen und verknüpften intelligenten Ordner.
- **Wikis:** Bag „lokal“ für Dateiverweise und als lokal/privat getaggte Notizen; Übersicht der Bags als Matrix, Graph und gestapelte Ebenen; TiddlyVisuals 1.16.0 und Relink eingebaut.

**Neu in 0.8: Englisch, Updates, Liste mit Vorschau**
- **Englische Oberfläche:** brausa folgt der Sprache des Systems (Deutsch oder Englisch, sonst Englisch); Einstellungen (Zahnrad oben in der Seitenleiste) → Sprache stellt sie um.
- **Automatische Updates:** brausa sucht kurz nach dem Start nach einer neuen Version und installiert sie auf Wunsch (in den Einstellungen abschaltbar). Updates sind signiert. *Das erste signierte Update kommt mit dem nächsten Release; ab 0.8 aktualisiert sich brausa dann selbst.*
- **Liste mit Vorschau** (Drei-Spalten-Ansicht): Ordnerbaum, Detailliste mit sortierbaren Spalten und Vorschau der markierten Datei; ↑/↓ blättert.
- **Sortiermenü** in der Toolbar: Name, Geändert, Erstellt, Aufgenommen (EXIF), Größe oder Art, mit Richtungsknopf.
- **Intelligente Ordner:** Suche, Art-Filter und Kalender-Rahmen mit Ordner oder Projekt speichern und mit einem Klick zurückholen.
- **Duplikate finden** (Rechtsklick auf die Fläche oder einen Ordner): vergleicht den Inhalt, markiert die überzähligen Kopien für den Papierkorb.
- **Stapel-Umbenennen** (F2 bei mehreren Dateien): Muster mit `{name}`, `{n:3}`, `{datum}`, `{zeit}`, `{ordner}`, Ersetzen, Schreibweise, Vorschau mit Konfliktprüfung, Rückgängig.
- **Archive bearbeiten:** Dateien auf ein ZIP ziehen packt sie ein, Entf löscht im Archiv, Rechtsklick → *komprimieren* legt ein ZIP an (mit Rückfrage; die alte Fassung kommt in den Papierkorb).
- **Web-Fenster:** Lesezeichen und Verlauf pro Projekt.


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
