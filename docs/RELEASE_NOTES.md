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

### New in 0.19

- **Wikis from a MultiWikiServer show right:** MWS delivers a wiki's plugins as separate scripts (`plugin.js`), not in the page's store; brausa now loads them too, so an imported MWS wiki no longer opens as a standard wiki. MWS's sync client (and tiddlyweb) stays out – it has no server here.
- **Bags as on the server:** each tiddler of an MWS wiki goes into a mirror of its bag there (`mws-<bag>`), stacked in the server's order, above "lokal".
- Plan for a Node.js backend on the internet, controlled from brausa and delivering compressed ("uglified") wikis: `docs/PLAN-WEB-BACKEND.md`.

### New in 0.18

- **Web wikis look as on the web:** the wiki's plugins and themes now come along (automatically when opening, ticked in the comparison) – without them its tiddlers did not show right. Its start tiddlers (`$:/DefaultTiddlers`), theme, palette, language strings and changed core tiddlers come along too.

### New in 0.17

- **Comparing with the web wiki is fast:** the comparison no longer copies the web version tiddler by tiddler into a temporary bag (with thousands of tiddlers that took minutes); texts are loaded only when a row is opened, long lists show 150 rows at first ("show more", "all/none"), the buttons stay in view.
- **Only what is new or newer is ticked:** tiddlers that do not exist here, or are newer on the web; where the version here is newer it stays ("newer here").
- **Bag "web-<wiki>" above "lokal":** what comes from the web lands there; an older copy in the wiki's own bag is replaced, so the web version shows.
- **Automatically when opening:** "Open wiki" on a wiki with a web address first takes over what is new or newer on the web (offline: it opens as it is).

### New in 0.16

- **Wikis open in brausa:** "Open wiki" (sidebar, project start page, map, wiki settings) brings the wiki up to date and shows it in the web panel, no longer the folder. A folder wiki is shown in a TiddlyWiki that comes with brausa (5.3.8, German or English); what you change there is saved back into the wiki's folder (only what changed; tiddlers added meanwhile by a sync stay).
- **Downloading wikis into projects:** "Save" in the web panel saves a TiddlyWiki as a complete wiki file (not the page as shown) into the project and opens it; a downloaded wiki file opens as well. Local wiki files run their scripts and save into their own file.
- **Places:** + offers the current folder or **"Choose folder …"** (the system's dialog), and folders can be dragged onto "Places". A message says when a folder is a place already.

### New in 0.15

- **Search in documents:** in the kinds menu (next to Folders/Flat), **"Search in documents"** looks for the words inside PDFs, Word/Excel/PowerPoint and OpenDocument files, notes, Markdown, HTML and other text below the folder – or in all places / on all media. Each hit shows the text around the word (and its page); opening a document opens its search bar with the word highlighted. Combines with the kind filter (e.g. only PDFs).
- **Kanban lanes by bag:** Lanes → "by bag" shows one lane per bag of the wikis holding the map (plus the map's own bag), each marked "goes to the web" or "stays local". Dragging a card into another lane keeps it in that bag in the wiki; "Save to" in the wiki's edit mode moves it back.

### New in 0.14

- **Which bag, in the wiki itself:** in a wiki's edit mode a line shows the tiddler's bag, the other bags holding the same title, and **"Save to"** – the next sync puts the tiddler into the chosen bag.
- **What goes to the web:** per wiki and bag (globe in the wiki settings). Maps (cards, snippets) and "lokal" stay on this computer unless switched on.
- **Places:** + adds the current folder, drag the grip to sort, × removes, ↺ restores the standard places.
- **Two areas:** web panel, document and second file pane take turns; the globe shows the browser instead of a document.
- Nothing found: **"Search in all places"** and **"Search all media"**; external drives in the second pane's place list.
- The toolbar shows only icons when it runs out of room.
- **⌘/Ctrl+F** searches the open document (after opening it or clicking into it), otherwise the files – the search term no longer lands in the file filter.
- Fixed: the second file pane did not open when a project folder is also a place.

### New in 0.13

- **Find in text** with highlighting in the web panel and in the PDF and document viewer: the search button (or ⌘/Ctrl+F in the viewer) opens a search bar; every hit is highlighted, the current one stronger, Enter / ⇧Enter step through them. In PDFs all pages count, also those not shown yet.
- **TiddlyVisuals 1.19.0** built in (Pinboard 0.8.0): card tools in two rows right on the card; "+ Object" and "Frame ▾" (current view, draw) in the path panel; an existing tiddler can become the story tiddler (with a question before replacing its story); "Open as story" without a story tiddler.

### New in 0.12.2

- **TiddlyVisuals 1.18.0** built in (Pinboard 0.7.0): in the wiki's Pinboard, "Open as story" works without a story tiddler; the story tiddler can be named before it is made and renamed later; the card menu (⋯) sets which board a card leads into; narrower card tools.

### New in 0.12.1

- **TiddlyVisuals 1.17.0** built in (Pinboard 0.6.0): in the wiki, a card that holds other cards leads into its own board (dive button), with a breadcrumb back; boards never nest inside themselves.

### New in 0.12

- **Search finds folders** and files in subfolders, not only in the folder shown. When nothing is found, **"Search in all places"** drops the folder and searches the whole home folder and all drives.
- **Media** in the sidebar: external drives (USB sticks, memory cards, network drives) appear as soon as they are connected.
- **Drag out of the web panel:** marked text, pictures and links can be dragged onto a project, the map, the notes & snippets thread, a Kanban column or a wiki. Pictures are saved only when dropped (into the folder they land on, else the project's folder).
- **Thread and Kanban:** map and Kanban cards can be dragged back into the thread, thread items into a Kanban column.
- **Card menu above the card** (also while editing), with a dropdown for the Kanban column, a **palette** with many more colours (and any other), and the choice to colour cards by their Kanban column. ▶ adds cards to the presentation; the story panel adds the view or the **next clicked cards**, and **"Open in the wiki"** opens the wiki holding the map (or creates one with this map as bag).
- A selected card with a scrollbar **scrolls** with the wheel instead of zooming the map.
- **Select by size** (right-click on the background): all pictures, videos or files from or up to a size.
- Snippets, notes and cards can be **dropped onto a wiki** in the sidebar; they become tiddlers with their source.

### New in 0.11

- **Wikis on the web:** give a wiki its web address (when creating it or in its settings). "Compare" loads the web version into a temporary bag, lists new and changed tiddlers to take over (and plugins for the plugin folder), then removes the bag. With a stored password (kept only on this computer) brausa uploads the new version.
- **Notes & snippets thread** next to the map and Kanban: snippets sent to a project land there; drag them onto the map or place them in the middle, put cards back, send items to another project.
- **Map stories and presentation** as in TiddlyVisuals' Pinboard: several paths per map, stops as an outline (indent), fullscreen presentation. Stories go to the wiki as story tiddlers; cards that contain cards dive into their own board there.
- **Kanban** as in TiddlyVisuals 0.4: column colors and views (full, foldable, compact), saved searches, lanes, card viewer, cards added right in a column.
- **Web panel:** the bar scrolls away and comes back when scrolling up; "send to project" appears with a selection and asks which project; the picture collector is a red record button with a dialog (where, minimum size, formats). PDFs open in the side panel without the browser bar.
- **Files open in the side panel**; right-click offers the default app. The **hamburger** next to the window buttons hides the sidebar. "Map" only appears in projects.

### New in 0.10

- **No more freezes with many files.** Views draw page by page (more appear when scrolling); the photo map reads only photos. If the interface still hangs for 10 seconds, brausa restarts without that folder and offers to go on there **without subfolders**.
- **Folders | Flat** toggle instead of "Stream"; flat view sorts by folder. **Sort menu:** clicking the current order again reverses it.
- **System files** (AppData, Library, program folders) are not indexed or shown; "All kinds" offers them inside a chosen folder or with a search of 5+ characters.
- **Drag & drop with Finder/Explorer** in both directions. A second click on a selected file deselects it. ⌘/Ctrl + scroll sizes the tiles and, past the largest size, opens the selected file large. **Tag button** at the top right.
- **Drop grid:** shake the dragged files to open it; it dives through folders (one level up, "drop here", subfolders).
- **Web panel:** speed dial, recent pages under the address bar, simple ad blocker, automatic saving of pictures to "Web-Bilder", PDFs and text files open in the panel (drag snippets onto the map).
- **Wiki settings** (gear): bags, plugins, search across all wikis. **Project start page** with files, notes & snippets, pinboard, Kanban and wikis.

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

**Neu in 0.19: Wikis vom MultiWikiServer, Bags wie auf dem Server**
- **MWS-Wikis werden richtig dargestellt:** Der MultiWikiServer liefert die Plugins eines Wikis als eigene Skripte (`plugin.js`), nicht im Speicher der Seite; brausa lädt sie jetzt mit, ein importiertes MWS-Wiki öffnet also nicht mehr als Standard-Wiki. Der Sync-Client des MWS (und tiddlyweb) bleibt draußen – hier gibt es keinen Server für ihn.
- **Bags wie auf dem Server:** Jeder Tiddler eines MWS-Wikis kommt in einen Spiegel seines Bags dort (`mws-<Bag>`), in der Reihenfolge des Servers, über „lokal“.
- Plan für ein Node.js-Backend im Internet, von brausa gesteuert, mit komprimierter („uglified“) Auslieferung: `docs/PLAN-WEB-BACKEND.md`.

**Neu in 0.18: Web-Wikis sehen aus wie im Web**
- Die Plugins und Themes des Wikis kommen jetzt mit (beim Öffnen automatisch, im Abgleich angehakt) – ohne sie wurden seine Tiddler nicht richtig dargestellt. Ebenso seine Start-Tiddler (`$:/DefaultTiddlers`), Theme, Palette, Sprachtexte und geänderte Core-Tiddler.

**Neu in 0.17: Schneller Abgleich mit dem Web-Wiki, automatisch beim Öffnen**
- **Der Vergleich mit dem Web-Wiki ist schnell:** Die Web-Version wird nicht mehr Tiddler für Tiddler in einen vorübergehenden Bag kopiert (bei Tausenden Tiddlern dauerte das Minuten); Texte werden erst beim Aufklappen einer Zeile geladen, lange Listen zeigen zunächst 150 Zeilen („weitere zeigen“, „alle/keine“), die Knöpfe bleiben sichtbar.
- **Nur Neues und Neueres ist angehakt:** Tiddler, die es hier nicht gibt oder die im Web neuer sind; ist die Fassung hier neuer, bleibt sie („hier neuer“).
- **Bag „web-<Wiki>“ über „lokal“:** Was aus dem Web kommt, landet dort; eine ältere Fassung im eigenen Bag des Wikis wird ersetzt, damit die Web-Fassung gilt.
- **Automatisch beim Öffnen:** „Wiki öffnen“ übernimmt bei einem Wiki mit Webadresse zuerst, was im Web neu oder neuer ist (ohne Netz öffnet es wie es ist).

**Neu in 0.16: Wikis in brausa öffnen und herunterladen, Orte wählen**
- **Wikis öffnen in brausa:** „Wiki öffnen“ (Seitenleiste, Projekt-Startseite, Map, Wiki-Einstellungen) gleicht das Wiki ab und zeigt es im Web-Fenster – nicht mehr den Ordner. Ein Ordner-Wiki erscheint in einem mitgelieferten TiddlyWiki (5.3.8, Deutsch oder Englisch); Änderungen dort werden in den Ordner des Wikis zurückgespeichert (nur Geändertes; zwischendurch durch einen Abgleich hinzugekommene Tiddler bleiben).
- **Wikis in Projekte herunterladen:** „Speichern“ im Web-Fenster speichert ein TiddlyWiki als vollständige Wiki-Datei (nicht die angezeigte Seite) ins Projekt und öffnet sie; ein heruntergeladenes Wiki öffnet sich ebenso. Lokale Wiki-Dateien führen ihre Skripte aus und speichern in ihre eigene Datei.
- **Orte:** + bietet den aktuellen Ordner oder **„Ordner wählen …“** (Systemdialog); Ordner lassen sich auch auf „Orte“ ziehen. Ist ein Ordner schon ein Ort, gibt es einen Hinweis.

**Neu in 0.15: Suchen in Dokumenten, Kanban-Bahnen nach Bag**
- **Suchen in Dokumenten:** Im Arten-Menü (neben Ordner/Flach) sucht **„Suchen in Dokumenten“** die Wörter im Text von PDFs, Word-/Excel-/PowerPoint- und OpenDocument-Dateien, Notizen, Markdown, HTML und anderen Textdateien unterhalb des Ordners – oder an allen Orten / auf allen Medien. Jeder Treffer zeigt den Text um das Wort (und die Seite); ein geöffnetes Dokument öffnet seine Suchleiste mit dem Wort markiert. Lässt sich mit dem Arten-Filter kombinieren (z. B. nur PDFs).
- **Kanban-Bahnen nach Bag:** Bahnen → „nach Bag“ zeigt eine Bahn je Bag der Wikis, die die Map enthalten (dazu den eigenen Bag der Map), jeweils mit „geht ins Web“ oder „bleibt lokal“. Eine Karte in eine andere Bahn ziehen speichert sie im Wiki in diesem Bag; „Speichern in“ im Bearbeiten-Modus des Wikis verschiebt sie zurück.

**Neu in 0.14: Bag im Wiki wählen, Orte, zwei Bereiche, Suche auf allen Medien**
- **Welcher Bag – im Wiki selbst:** Im Bearbeiten-Modus zeigt eine Zeile den Bag des Tiddlers, weitere Bags mit demselben Titel und **„Speichern in“** – der nächste Abgleich legt den Tiddler in den gewählten Bag.
- **Was ins Web geht:** pro Wiki und Bag (Weltkugel in den Wiki-Einstellungen). Maps (Karten, Snippets) und „lokal“ bleiben auf diesem Rechner, solange man sie nicht einschaltet.
- **Orte:** + fügt den aktuellen Ordner hinzu, am Griff ziehen sortiert, × entfernt, ↺ stellt die Standard-Orte wieder her.
- **Zwei Bereiche:** Web-Fenster, Dokument und zweites Dateifenster wechseln sich ab; die Weltkugel zeigt den Browser statt eines Dokuments.
- Nichts gefunden: **„An allen Orten suchen“** und **„Auf allen Medien suchen“**; externe Laufwerke auch in der Ortsliste des zweiten Fensters.
- Bei wenig Platz zeigt die Toolbar nur Symbole.
- **⌘/Strg+F** sucht im offenen Dokument (nach dem Öffnen oder einem Klick hinein), sonst in den Dateien – der Suchbegriff landet nicht mehr im Dateifilter.
- Behoben: Das zweite Dateifenster ging nicht auf, wenn ein Projektordner zugleich ein Ort ist.

**Neu in 0.13: Suche im Text, TiddlyVisuals 1.19**
- **Im Text suchen** mit Hervorhebung im Web-Fenster und im PDF- und Dokumentbetrachter: Der Lupen-Knopf (oder ⌘/Strg+F im Betrachter) öffnet eine Suchleiste; alle Treffer werden markiert, der aktuelle stärker, ↵ / ⇧↵ springen weiter. In PDFs zählen alle Seiten, auch noch nicht angezeigte.
- **TiddlyVisuals 1.19.0** eingebaut (Pinboard 0.8.0): Kartenwerkzeuge in zwei Reihen direkt an der Karte; „+ Object“ und „Frame ▾“ (aktuelle Ansicht, zeichnen) im Pfad-Feld; ein vorhandener Tiddler kann Story-Tiddler werden (mit Rückfrage, bevor seine Story ersetzt wird); „Open as story“ ohne Story-Tiddler.

**Neu in 0.12.2**
- **TiddlyVisuals 1.18.0** eingebaut (Pinboard 0.7.0): Im Pinboard des Wikis geht „Open as story“ auch ohne Story-Tiddler; der Story-Tiddler lässt sich vor dem Anlegen benennen und später umbenennen; im Kartenmenü (⋯) wird festgelegt, in welches Board eine Karte führt; schmalere Kartenwerkzeuge.

**Neu in 0.12.1**
- **TiddlyVisuals 1.17.0** eingebaut (Pinboard 0.6.0): Im Wiki führt eine Karte, die Karten enthält, in ihr eigenes Board (Eintauchen-Knopf), mit Brotkrumen zurück; Boards verschachteln sich nie in sich selbst.

**Neu in 0.12: Ordnersuche, Medien, Ziehen aus dem Web-Fenster, Kartenmenü mit Palette**
- **Die Suche findet Ordner** und Dateien in Unterordnern, nicht nur im gezeigten Ordner. Findet sie nichts, hebt **„An allen Orten suchen“** die Ordnerauswahl auf und sucht im ganzen Home-Ordner und auf allen Laufwerken.
- **Medien** in der Seitenleiste: externe Laufwerke (USB-Sticks, Speicherkarten, Netzlaufwerke) erscheinen, sobald sie angeschlossen sind.
- **Aus dem Web-Fenster ziehen:** markierten Text, Bilder und Links auf ein Projekt, die Map, den Notizen-&-Snippets-Thread, eine Kanban-Spalte oder ein Wiki ziehen. Bilder werden erst beim Ablegen gespeichert (in den Ordner, auf den sie fallen, sonst in den Projektordner).
- **Thread und Kanban:** Karten der Map und des Kanbans lassen sich in den Thread zurückziehen, Einträge des Threads in eine Kanban-Spalte.
- **Kartenmenü über der Karte** (auch beim Bearbeiten), mit Auswahlliste für die Kanban-Spalte, einer **Palette** mit viel mehr Farben (und jeder anderen) und der Wahl, Karten in der Farbe ihrer Kanban-Spalte zu zeigen. ▶ hängt Karten an die Präsentation; im Story-Feld kommen die Ansicht oder die **nächsten angeklickten Karten** dazu, und **„Im Wiki öffnen“** öffnet das Wiki mit dieser Map (oder legt eines mit dieser Map als Bag an).
- Eine markierte Karte mit Scrollbalken **scrollt** mit dem Mausrad, statt die Map zu zoomen.
- **Nach Größe markieren** (Rechtsklick auf die Fläche): alle Bilder, Videos oder Dateien ab oder bis zu einer Größe.
- Snippets, Notizen und Karten lassen sich **auf ein Wiki** in der Seitenleiste ziehen; sie werden dort Tiddler mit ihrer Quelle.

**Neu in 0.11: Wikis im Web, Notizen-Thread, Geschichten und Präsentation, Kanban**
- **Wikis im Web:** einem Wiki seine Webadresse geben (beim Anlegen oder im Zahnrad). „Abgleichen“ lädt die Web-Fassung in einen temporären Bag, zeigt neue und geänderte Tiddler zur Übernahme (und Plugins für den Plugin-Ordner) und entfernt den Bag wieder. Mit gespeichertem Passwort (nur auf diesem Rechner) lädt brausa die neue Fassung hoch.
- **Notizen- & Snippets-Thread** neben Map und Kanban: an ein Projekt gesendete Snippets landen dort; auf die Map ziehen oder in die Mitte setzen, Karten zurücklegen, an ein anderes Projekt senden.
- **Geschichten und Präsentation** wie im Pinboard von TiddlyVisuals: mehrere Pfade pro Map, Stationen als Gliederung (einrücken), Vollbild-Präsentation. Geschichten gehen als Story-Tiddler ins Wiki; Karten mit Karten darin führen dort in ihr eigenes Board.
- **Kanban** wie in TiddlyVisuals 0.4: Spaltenfarben und -ansichten (ganz, faltbar, kompakt), gespeicherte Suchen, Bahnen, Kartenansicht, Karten direkt in einer Spalte anlegen.
- **Web-Fenster:** die Leiste scrollt weg und kommt beim Hochscrollen zurück; „An Projekt senden“ erscheint bei einer Markierung und fragt nach dem Projekt; der Bildersammler ist ein roter Aufnahmeknopf mit Dialog (wohin, Mindestgröße, Formate). PDFs öffnen im Seitenfeld ohne Browserleiste.
- **Dateien öffnen im Seitenfeld**, Rechtsklick bietet die Standard-App. Der **Hamburger** neben den Fensterknöpfen blendet die Seitenleiste aus. „Map“ gibt es nur in Projekten.

**Neu in 0.10: kein Einfrieren, Ordner/Flach, Drag & Drop mit dem Finder, Projekt-Startseite**
- **Kein Einfrieren mehr bei vielen Dateien:** Ansichten zeichnen seitenweise (beim Scrollen kommt mehr), die Foto-Karte liest nur Fotos. Hängt die Oberfläche trotzdem 10 Sekunden, startet brausa ohne diesen Ordner neu und bietet an, dort **ohne Unterordner** weiterzusuchen.
- **Ordner | Flach** statt „Stream“; flach wird nach Ordner sortiert. **Sortiermenü:** die aktuelle Sortierung nochmals anklicken kehrt sie um.
- **Systemdateien** (AppData, Library, Programmordner) werden weder indiziert noch gezeigt; „Alle Arten“ bietet sie in einem gewählten Ordner oder bei einer Suche ab 5 Zeichen an.
- **Drag & Drop mit Finder/Explorer** in beide Richtungen. Zweiter Klick auf eine markierte Datei hebt die Markierung auf. ⌘/Strg + Scrollen ändert die Kachelgröße und öffnet über die größte Stufe hinaus die markierte Datei groß. **Tag-Knopf** oben rechts.
- **Ablage-Raster:** gezogene Dateien schütteln öffnet es; es taucht durch Ordner (eine Ebene hoch, „hier ablegen“, Unterordner).
- **Web-Fenster:** Schnellwahl, letzte Seiten unter der Adresszeile, einfacher Werbeblocker, Bilder automatisch in „Web-Bilder“ speichern, PDFs und Textdateien öffnen im Seitenfeld (Snippets auf die Map ziehen).
- **Wiki-Einstellungen** (Zahnrad): Bags, Plugins, Suche über alle Wikis. **Projekt-Startseite** mit Dateien, Notizen & Snippets, Pinboard, Kanban und Wikis.

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
