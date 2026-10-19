[Deutsch](README.de.md) · **English**

# brausa

A visual, cross-platform file browser for macOS, Windows and Linux.
It is built for fast sorting by drag & drop, with portable tags without
lock-in and flat image streams instead of deep folder trees.

> Full concept, architecture and roadmap (in German): **[docs/KONZEPT.md](docs/KONZEPT.md)**

![Stream view](docs/img/stream.jpg)

| Dragging into the tree (expands on hover, breadcrumb bar) | Drop zones grid |
|---|---|
| ![](docs/img/drag-baum.jpg) | ![](docs/img/ablage-raster.jpg) |
| **Kanban by tags** | **Preview flows under the toolbar** |
| ![](docs/img/kanban.jpg) | ![](docs/img/vorschau.jpg) |

## Install

Installers for macOS, Windows and Linux are available under [Releases](https://github.com/lasjoh-toho/brausa/releases).

> **Experimental software.** brausa is a pre-release version and was made to the best of our knowledge and belief. Even so, it may contain bugs, and it works directly on your files. Use it at your own risk; to the extent permitted by law, no responsibility or liability is accepted. Please make a backup first and try it out on test folders before anything else.

brausa is not signed with Apple or Microsoft, so you have to allow the first start. How to do that is explained in the [README for macOS](packaging/README-macOS.txt) (also included in the DMG) and the [README for Windows](packaging/README-Windows.txt) (notice in the installer, file in the program folder).

The interface follows the desktop language (German or English, otherwise English) and can be changed in Settings (gear icon at the top of the sidebar). Shortly after starting, brausa looks for updates and installs them on request (for maintainers: [docs/UPDATES.md](docs/UPDATES.md)).

## What already works

| Area | Feature |
|---|---|
| **Folder tree** | While dragging over a folder, it expands after ~0.5 s and collapses again afterwards. **Dual-zone drop:** the left half moves (with ⌥ or Ctrl: copies), the right half applies the folder's tags and colour. |
| **Breadcrumb drop** | While dragging, a path bar appears at the top; every segment is a drop target. |
| **Drop zones grid** | Dragging a file onto **Drop zones** in the toolbar opens a configurable N×M grid of folders and tags. Clicking “Drop zones” opens its settings. |
| **Stream** | Subfolders become one continuous image wall with a path badge on each tile. Dragging a folder from the tree onto the canvas filters to that branch (funnel). Next to it, **All kinds ▾** picks a kind of file (Media, Images, Videos, Audio, PDF, Text and code, Web pages, Office) and switches Stream on at the same time: this way you can see, for example, all videos from all subfolders. |
| **List with preview** | The classic three-column view (second icon in the view bar): on the left places, projects and the folder tree, in the middle a list with name, date, size and kind, on the right the preview of the selected file with size, dates, location and tags. Clicking a column header sorts (once more: reversed), ↑/↓ moves through the list (with ⇧ extends the selection), Space shows it large. Dragging, renaming, the context menu and dropping onto folders work as in the tile view; the border to the preview can be moved. |
| **Sorting** | The menu next to *All kinds* sorts all views by Name, Modified, Created, Taken (EXIF, otherwise modification date), Size or Kind; the button next to it reverses the direction. Folders always come first, and the choice is remembered. |
| **Views** | Tile grid (stream), Kanban (columns by tags or subfolders, dragging between columns changes the tag), Timeline (by month), **Calendar**, **Map** (OpenStreetMap; photos with GPS from EXIF, nearby markers are clustered). |
| **Calendar heatmap** | Zoomable: all years → year (days) → month (with a photo per day). **Clicking a year number** opens, instead of the year overview, a band of days across all years (at the chosen year), with all weekdays, highlighted weekends and the total per weekday. The band scrolls sideways, frames can span the turn of the year; × goes back to all years. Double-click or ⌘/Ctrl + scroll or pinch zooms. **Dragging across cells sets a date filter** that applies in all views. In the day heatmap this is a **frame** across weeks and weekdays: a frame over the Monday row from July to October selects only those Mondays; ⌘/Ctrl + drag adds another frame (e.g. the Sundays), clicking *Mon … Sun* toggles single weekdays. Selectable by modification, creation or capture date (EXIF). |
| **Files** | Double-click opens in the default app, “Show in Finder” / “Show in file manager”, rename (F2, macOS ↵; with several selected files **batch rename**, see below), trash (Del, macOS ⌘⌫), new folder (⌘/Ctrl+⇧N), context menu by right-click. |
| **Batch rename** | Select several files, F2 (macOS ↵) or right-click → *Rename … items …*. A **pattern** with placeholders (`{name}`, `{n}`, `{n:3}` for 001, `{date}` and `{time}` from the capture or modification date, `{folder}`) builds the new name; the extension stays. On top of that **Replace** (also with a regular expression), start number and case (lower, UPPER, Title Case). The **preview** shows every new name and marks conflicts (duplicate, already exists, invalid characters) before anything happens. Names can also be swapped among each other; undo via the notification. |
| **Thumbnails** | Are scaled down in the Rust core, cached and only loaded once the tile becomes visible. Portrait photos are rotated according to EXIF. |
| **Live updates** | Changes made by other programs (sync clients, downloads) appear automatically. |
| **Selection** | Click, Shift range, ⌘/Ctrl toggle, lasso, ⌘/Ctrl+A, **select by pattern** (`*.png > 5MB`, `#ToReview`, `modified < 30d`, `ext:jpg,png`, `is:video`, `is:media`, `-is:image`, `-#done`). |
| **Tray** | Collect files from any folders (drag or `S`). The contents stay while you navigate and can be moved or tagged as a group. |
| **Second panel** | The icon to the left of *Drop zones* opens a second panel on the right with another folder (places and projects in the menu, ⇄ swaps the folders of both sides). Files and folders can be dragged in both directions: onto the list or a subfolder in the panel, onto the main view or into the tree, places and projects. ⌥/Ctrl copies instead of moving, undo via the notification. The border to the main view can be moved with the mouse (it lights up on hover). |
| **Web window** | The globe in the toolbar opens a web window on the right for pages from the internet (address or search term). It is **isolated**: its own cookies and logins, separate from your normal browser, and no access to brausa or your files. **Downloads** and **Save** (page as HTML) end up in the first folder of the open project or in the current folder, and then belong to the project. **To the map** puts the selected text on the project map as a snippet (otherwise the page as a card) with a link; clicking it opens the page again. **Bookmarks and history per project:** the star in the address bar remembers the page, *Bookmarks* and the clock show the bookmarks and history of the open project (or of the project the current folder belongs to) with search; the bookmarks also appear on the start page of the web window. **Local websites:** right-click an HTML file → *Open in web window*; brausa serves the folder only on this computer under a random address, links and loaded files work, scripts only run if they are allowed for the folder (button at the top right). |
| **Archives** | ZIP, tar and tar.gz files open by double-click **like folders**: browse, Stream, filters, preview with Space (images, PDF, text, media), double-click opens a file in the default app. Dragging files or folders from the archive into a folder, the second panel or the tree **unpacks them**. Dragging files onto an archive or into an opened archive folder **packs them** (as a copy), Del **deletes inside the archive**; both after confirmation, and the previous version of the archive goes to the trash. Right-click → *Compress* creates a ZIP from files and folders. |
| **Duplicates** | Right-click on empty space → *Find duplicates* (or on a folder → *Find duplicates in “…”*) compares the displayed files including subfolders, in a project all files of the project; search and filters apply too (e.g. images only). The content is compared: first the size, then a quick and finally a full checksum; the same file under several names (hard links) does not count. The canvas then shows only the groups of identical files, and the top shows how much space would be freed. **Select extras** selects all but one file per group (the one that stays is the one not named like a copy, otherwise the oldest; it comes first), Del moves them to the trash, *Done* ends the search. |
| **Tags** | `T` opens the quick tag bar with autocomplete, recently used tags and colours. Hierarchical tags (`Work/Design/UI` also appears under `#Work`). Stored in the central index (see Projects); tags in the file name (`Photo[holiday beach].jpg`) are read too. |
| **Projects** | Projects are **independent of folders**: freely named collections (+ next to *Projects* in the sidebar). Dragging files and folders from anywhere onto a project adds them **without moving them**; a folder belongs to it with all its contents. A click shows all files of the project in all views (Stream, Kanban, Calendar, Map, Project map). Del only takes a file out of the project; nothing changes on disk. Files stay members even when they are moved or renamed in Finder/Explorer. Rename by double-click or ✎, delete with × (the files stay). Folders that used to be projects automatically become projects containing that folder. |
| **Smart folders** | Save search, kind filter, Stream and calendar frames together with the folder or project: as soon as a filter is set, “Save current view” (or +) appears under *Smart folders*. A click restores everything, and the open smart folder is highlighted. The tooltip shows what is saved; ◎ replaces the filters with the current view, ✎ or double-click renames, × removes (undo via the notification). Renamed or moved folders are tracked. |
| **Index** | Tags, colours and links live in a central index (readable, sorted); brausa recognises files that were moved or renamed in other programs by file ID and checksum. |
| **Project map** | An infinite, zoomable canvas per project (icon at the far right of the view bar), stored with brausa's app data (for former folder projects still in `<folder>/.brausa/maps/`). The map belongs to the open project, otherwise to a project that contains the current folder, otherwise to the last one used. Double-click creates a card (title + Markdown text). **Dragging a card onto another one makes it a sub-card** (⌥/Alt keeps it on its level). The dot on the right edge draws **arrows**, also across levels; arrows can be labelled. The mouse wheel zooms smoothly, `↵` flies into a card, `Esc` goes up one level, and the breadcrumb shows where you are. Colours, resizing, undo/redo. Several maps per project. |
| **Files on the map** | The folder icon at the top right opens the project's files. Dragging a file (also from the folder tree or the tray) onto the map creates a card with a thumbnail; double-click opens it in the default app. Dropped on the **right edge** of a card, the file gets **linked** to the card. The other way round, a card dragged onto a file in the list or the tray links itself to it. Cards remember files through the index: moved or renamed in Finder, the link is kept. |
| **Reader and snippets** | PDFs, HTML, Markdown and text files open (double-click in the file list or on the card) in the **reader to the left of the map**. Selecting text and dragging it onto the map creates a **snippet** with a way back: clicking the snippet opens the source at exactly that spot and makes it light up; all snippets of a document stay marked in it. Dragging snippets onto the **top or bottom edge** of another one **stacks** them (as in LiquidText); dragging them out separates them again. HTML is shown without scripts and forms. |
| **TiddlyWiki (bags and recipes)** | Under *Wikis* in the sidebar you put together a wiki from **bags**, as in MultiWikiServer: project maps (cards become tiddlers with `brausa-id`, sub-cards become `list`, arrows become `brausa-links` for tw5-graph) and **shared bags** (glossary, people …) that several wikis share. The target is a folder or single-file wiki that you open in **TiddlyDesktop-RS**. **Sync** (↻) takes changes back from the wiki and then writes all bags to the wiki. Card texts and renames go back into the map; everything else ends up, as in MultiWikiServer, in the wiki's own bag and **overrides** shared tiddlers there. The **Overlays** tool (layers icon next to *Wikis*) shows these with a line-by-line comparison and resolves them selectively: promote to all, merge, discard or keep as variant. **Plugins are built in** (Markdown, tw5-graph with pinboard and kanban): maps appear in the wiki as a pinboard and kanban without installing anything. Conflicts are kept as a copy; single-file wikis are backed up first. |
| **Kanban for cards** | “Kanban” in the selection bar sends cards to the project kanban (switch between Map/Kanban at the top right). Columns = status, drag cards between columns, create your own columns; a click shows the card on the map. |
| **Preview** | Double-click or Space: the image grows out of the tile up to below the toolbar, which turns into glass in the image's colour. ←/→ browses. Also **videos and audio** (with player; which formats play depends on the system, otherwise “Open in default app”), **PDFs**, **text and code** (php, js, css, json, py … with syntax colours; Markdown formatted or as source) and **web pages**. If a page contains scripts, brausa asks whether they may run, with a warning; the answer can be remembered for the file or the whole folder and taken back via “Change”. The page runs isolated without access to brausa or other files. |
| **Undo** | Moves can be undone via the notification at the bottom right. |

## Development

Requirements: Node ≥ 20 and Rust (stable). On Linux additionally
`libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev`
([Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)).

```bash
npm install
npm run tauri dev        # desktop app with the real file system
npm run dev              # UI only in the browser, with demo data (http://localhost:1420)
npm test                 # domain core (Vitest)
npm run check            # type check
cd src-tauri && cargo test   # Rust core
npm run tauri build      # installer for the current operating system
```

In the browser, the `DemoBackend` with generated sample images runs automatically.
This lets you develop the interface without a Rust toolchain.

## Structure

```
src/lib/core/       plain TypeScript: tags, pattern selection, views, paths (+ tests)
src/lib/backend/    backend interface · TauriBackend · DemoBackend
src/lib/state/      app state (Svelte 5 runes) · drag controller
src/lib/components/ sidebar, tree, toolbar, canvas, tray, overlays
src-tauri/src/      Rust: file system, sidecar metadata, Tauri commands (+ tests)
docs/KONZEPT.md     concept, architecture, roadmap (German)
```

## Keyboard shortcuts

| Key | Action |
|---|---|
| `T` | Tag the selection (or the tray) |
| `S` | Put the selection in the tray |
| `Space` | Preview |
| Double-click, `⌘/Ctrl+O` | Open in default app (folder: go into it) |
| `F2` (macOS also `↵`) | Rename |
| `Del` (macOS `⌘⌫`) | Move to trash |
| `⌘/Ctrl+⇧N` | New folder |
| `⌘/Ctrl+F` | Search or pattern |
| `⌘/Ctrl+A` | Select all |
| `⌫` or `⌘/Ctrl+↑` | Parent folder |
| `⌘/Ctrl+[` / `]` | Back / Forward |
| `Esc` | Clear funnel or selection, cancel drag |
| `⌥` (macOS) or `Ctrl` while dragging | Copy instead of move |

**In the project map**

| Key | Action |
|---|---|
| Double-click (empty space / inside a card) | New card or sub-card |
| Double-click on the card title, `F2` | Edit (`⌘/Ctrl+↵` or `Esc` finishes) |
| `N` | New card in the centre |
| `↵` | Fly into the selected card |
| `Esc` | Clear selection, otherwise one level up |
| `0` | Show whole map |
| `Del` / `⌫` | Delete card or arrow |
| `⌘/Ctrl+Z`, `⌘/Ctrl+⇧Z` | Undo, Redo |
| Drag with `⌥`/Alt | Move without nesting |
