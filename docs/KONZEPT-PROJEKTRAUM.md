# Konzept: Projekt als Arbeitsraum (Projekte, Maps, Kanban, Wikis, Notizen, intelligente Ordner)

Stand: 19.10.2026 · Status: Entscheidungen eingearbeitet, bereit zur Umsetzung
Grundlage: brausa 0.8 und TiddlyVisuals 1.16.0 (Graph 1.16.0, Pinboard 0.5.0, Kanban 0.4.1, Relink 2.5.2)

## 1. Ausgangslage

Heute stehen die Bausteine nebeneinander, obwohl sie zusammengehören:

| Baustein | Wo er heute lebt | Bezug zu Projekten |
|---|---|---|
| **Projekt** | `projects.json` im Rust-Kern: Name, Farbe, Dateien (Index-IDs), Ordner | – |
| **Map** | Map-Dateien je Projekt (`maps/<id>.json`), Karten mit Unterkarten | gehört fest zu einem Projekt |
| **Kanban** | Status-Spalten *einer Map*; daneben das Datei-Kanban der Ansicht (Spalten = Tags/Unterordner) | nur indirekt |
| **Wiki** | Recipe in `tw/recipes.json` (Bags in Reihenfolge, Ziel-Wiki) | nur über eingebundene Map-Bags |
| **Intelligenter Ordner** | im Frontend (`localStorage`) | optional über den Ort |
| **Notizen** | gibt es nicht als eigenen Ort; nur Kartentexte und Wiki-Tiddler | – |

## 2. Leitidee

**Das Projekt wird zum Arbeitsraum.** Daran hängen Dateien und Ordner (wie bisher), **ein Hauptwiki mit
Unterwikis**, **Maps, die als Outliner der Wikis dienen**, **ein gemeinsames, filterbares Kanban**,
**eine Notizen-Seite** und **intelligente Ordner**.

Drei Regeln:

1. **Eigentum vs. Verknüpfung.** Maps, Kanban-Ansichten, Notizen und der Projekt-Bag *gehören* dem Projekt.
   Intelligente Ordner und fremde Wikis/Bags werden *verknüpft*. Löschen eines Projekts löscht nur, was ihm gehört.
2. **Ein Bestand, viele Sichten.** Karten, Notizen und Dateien werden einmal gepflegt. Map, Outline, Kanban
   und Wiki sind Sichten darauf.
3. **Alles hat einen Standard.** Ein Klick auf das Projekt öffnet die Projekt-Startseite; Hauptwiki,
   Standard-Map und Kanban sind je einen Klick entfernt.

```
Projekt „Schule“
├─ Dateien · Ordner
├─ Notizen                         (Notizen-Seite, gehört dem Projekt)
├─ Kanban                          (ein Board über alles, filterbar)
├─ Wikis
│   ├─ Hauptwiki „Schule“          (Projekt-Bag „Schule“)
│   ├─ Unterwiki „Geschichte“      (baut auf dem Hauptwiki auf)
│   └─ Unterwiki „Oberstufe“
├─ Maps                            (Outliner, je Map einem Wiki zugeordnet)
│   ├─ „Geschichte – Gliederung“   → Unterwiki Geschichte
│   └─ „Oberstufe – Kursplan“      → Unterwiki Oberstufe
└─ Intelligente Ordner             (eigene oder verknüpfte; nur in brausa, nicht im Wiki)
```

## 3. Die Bausteine

### 3.1 Hauptwiki und Unterwikis

Ein Projekt hat **ein Hauptwiki** und beliebig viele **Unterwikis** (z. B. „Geschichte“ und „Oberstufe“
im Projekt „Schule“). Ein Unterwiki ist ein eigenes Ziel-Wiki (eigene Datei oder eigener Ordner), das
auf dem Hauptwiki **aufbaut**:

| Ebene (unten → oben) | Hauptwiki „Schule“ | Unterwiki „Geschichte“ |
|---|---|---|
| `@plugins` (Standard-Plugins, s. 3.7) | ✓ | ✓ |
| gemeinsame Bags (Glossar …) | nach Wahl | erbt die des Hauptwikis |
| Projekt-Bag **„Schule“** | ✓ (oberster, beschreibbar) | ✓ (nur lesend eingebunden) |
| Maps, die diesem Wiki zugeordnet sind | Maps des Hauptwikis | Map „Geschichte – Gliederung“ |
| `lokal` | ✓ | ✓ |
| eigener Bag des Unterwikis | – | **„Schule/Geschichte“** (oberster, beschreibbar) |

- **Erben statt kopieren:** Das Recipe eines Unterwikis verweist auf das Hauptwiki (`base`) und ergänzt
  nur, was dazukommt. Ändert sich das Hauptwiki (neuer gemeinsamer Bag), haben es alle Unterwikis.
- **Wohin schreibt ein Unterwiki?** Neues landet im Bag des Unterwikis. Wer im Unterwiki einen Tiddler des
  Hauptwikis ändert, erzeugt eine **Überdeckung**; die Bag-Übersicht zeigt sie, „für alle übernehmen“
  schreibt sie in den Projekt-Bag zurück (wie heute beim MultiWikiServer-Modell).
- **Bag-Namen nach Name (entschieden):** Projekt-Bag = Projektname („Schule“), Unterwiki-Bag =
  „Schule/Geschichte“. Umbenennen eines Projekts benennt die Bags mit um (Recipes werden angepasst).
- **Ein Wiki öffnen:** Das Hauptwiki öffnet ein Klick auf das Projekt-Wiki-Symbol; Unterwikis stehen
  darunter. Geöffnet wird im Web-Fenster (Einzeldatei-Wiki oder Wiki-Ordner über den lokalen Server)
  oder in TiddlyDesktop.

### 3.2 Maps als Outliner der Wikis

Eine Map gehört dem Projekt und ist **einem Wiki zugeordnet** (Hauptwiki oder ein Unterwiki). Sie ist
dessen **Gliederung**: Die Hierarchie der Karten (Karte → Unterkarte → …) und ihre Reihenfolge
bilden die Outline des Wikis.

Abbildung auf TiddlyVisuals (Pinboard 0.5 „Stories“):

| brausa (Map) | Wiki (TiddlyVisuals) |
|---|---|
| Karte | Tiddler (wie heute, Titel = Kartentitel, `brausa-id`) |
| Unterkarten in Reihenfolge | `list`-Feld der Karte (wie heute) |
| die ganze Gliederung der Map | **Story-Tiddler** der Map: Feld `story` (Titelliste in Leserichtung), `pinboard-levels` (Einrückung je Eintrag), Text = Outline-Vorlage `$:/plugins/lasjoh-toho/pinboard/templates/story` |
| Ebene (Karte mit Unterkarten) | eigenes Pinboard je Ebene (wie heute `$:/graph/<Map>/<Karte>`) |
| Rahmen auf dem Pinboard | Kapitel (Pinboard „Make an entry“), optional |

- **In beide Richtungen:** Ordnet man im Wiki den Story-Tiddler um (Feld `story`, Einrückungen), ändert
  brausa beim Abgleich Reihenfolge und Eltern der Karten. Ordnet man in brausa um, schreibt der
  Abgleich `story`, `pinboard-levels` und `list` neu. Das entspricht der Zwei-Wege-Synchronisation, die
  Pinboard selbst zwischen Board und Story-Tiddler macht.
- **Outline-Ansicht in brausa:** Neben der Fläche bekommt die Map eine **Outline-Ansicht** (eingerückte
  Liste der Karten, Ziehen zum Umsortieren und Ein-/Ausrücken, Tab/⇧Tab wie in Pinboard). Fläche und
  Outline sind dieselben Daten.
- **Inhaltsverzeichnis im Wiki:** Der Story-Tiddler der zugeordneten Map ist das Inhaltsverzeichnis des
  Wikis (Standard-Tiddler beim Öffnen).
- **Umbenennen:** Mit Relink (Standard-Plugin, s. 3.7) folgen `story`, `list`, `pinboard-board` und die
  Pinboard-Daten jeder Umbenennung im Wiki; brausa folgt über `brausa-id`.

**Hineintauchen (Deep Dive) im Wiki:** In brausa taucht `↵` in eine Karte mit Unterkarten ein. Pinboard
0.5 kennt **keine verschachtelten Boards** (nur Zoom, Rahmen und Präsentationspfade). brausa erzeugt
zwar je Ebene ein eigenes Board, im Wiki fehlt aber der Sprung von der Karte in ihr Board und zurück.
Vorschlag für TiddlyVisuals: Karten mit einem Feld `pinboard-board` (Board der Unterebene) bekommen einen
„Hineintauchen“-Knopf, Boards eine Brotkrumenleiste nach oben (über `brausa-parent` bzw. ein neutrales
Feld `parent-board`). brausa schreibt die Felder schon beim Abgleich, damit es sofort funktioniert,
sobald Pinboard sie auswertet.

### 3.3 Ein gemeinsames, filterbares Kanban

**Ein Kanban pro Projekt** über alles, was einen Status hat: Karten aller Maps, Notizen und Dateien.

- **Status als Feld (entschieden):** Karten und Notizen haben das Feld `status` (wie heute und wie
  TiddlyVisuals Kanban 0.4 mit `columnField: status`). Dateien bekommen ein neues Metafeld `status` im
  Index (wie Tags und Farbe), mit Rückgängig.
- **Spalten:** die Statuswerte des Projekts (Standard: Offen · In Arbeit · Erledigt), frei erweiterbar;
  optional Bahnen (Swimlanes) nach Map, Wiki oder Tag (Kanban 0.4: `laneField`).
- **Filter:** Leiste über dem Board mit
  - Quelle: Karten / Notizen / Dateien (an/aus),
  - Wiki bzw. Map (z. B. nur „Geschichte“),
  - Tags, Suchtext (wie die Dateisuche, inkl. `is:pdf`, `#tag`),
  - **gespeicherte Filter** = intelligente Ordner des Projekts (für Dateien) und gespeicherte Kanban-Suchen
    (für Karten/Notizen, wie Kanban 0.4 „projects“).
- **Im Wiki:** Das Board wird als TiddlyVisuals-Kanban geschrieben (Store-Tiddler mit `boardFilter`,
  `columns`, `kanban-columns`); im Wiki erscheinen Karten und Notizen, Dateien nicht.
- Das bisherige Datei-Kanban (Spalten nach Tags/Unterordnern) bleibt als Ansicht erhalten; es ist dasselbe
  Board mit „Spalten nach: Tag/Ordner“ statt Status.

### 3.4 Notizen-Seite

Jedes Projekt bekommt eine **Notizen-Seite**: eine Liste von Notizen links (neueste oben, Suche, Tags,
Status), der Editor rechts (Markdown wie die Kartentexte, mit Vorschau).

- **Speicherort:** Notizen sind Tiddler im Projekt-Bag („Schule“), getaggt `Notiz`. Damit stehen sie ohne
  Umweg im Hauptwiki und in allen Unterwikis; im Wiki geschriebene Notizen erscheinen in brausa.
- **Privat:** Eine Notiz mit Tag `privat` oder `lokal` liegt im Bag `lokal` (wie heute beim Abgleich) und
  wird nie veröffentlicht.
- **Zuordnung:** Eine Notiz kann einem Unterwiki zugeordnet werden (dann liegt sie in dessen Bag) und auf
  eine Map gezogen werden (wird dort eine Karte, die auf die Notiz verweist).
- **Status:** Notizen mit `status` erscheinen im Kanban (Aufgaben, Ideen).
- **Datei-Bezug:** Dateien können auf eine Notiz gezogen werden (Link wie bei Karten, `_canonical_uri` über `lokal`).

### 3.5 Intelligente Ordner

Wandern aus dem Browser-Speicher in den Rust-Kern (`smart.json`), damit sie mit Projekten verknüpfbar sind
und auf andere Rechner mitkommen. **Sie gehen nicht ins Wiki (entschieden)**; sie sind Sichten auf Dateien
in brausa und dienen als gespeicherte Filter für Dateiansichten und das Kanban.

- **Projekt-eigen:** Ort = das Projekt; erscheint nur unter dem Projekt.
- **Verknüpft:** ein globaler intelligenter Ordner, zusätzlich unter einem oder mehreren Projekten.

### 3.6 Weitere Projektbezüge (vorhanden, werden einsortiert)

Lesezeichen und Verlauf des Web-Fensters, Downloads, der Ablage-Tray hängen schon am offenen Projekt.

### 3.7 Standard-Plugins

**Wie macht es der MultiWikiServer?** Dort sind Plugins ganz normale Tiddler in einem Bag; ein Recipe
bindet den Bag mit den gewünschten Plugins als unterste Ebene ein. Üblich ist ein gemeinsamer Bag für
Plugins, den alle Recipes zuerst laden. brausa macht es genauso: Der eingebaute, schreibgeschützte Bag
**`@plugins`** liegt in jedem Wiki ganz unten.

Inhalt ab jetzt: Markdown, Graph (tw5-graph), vis-network, Pinboard, Kanban **und Relink** (neu, damit
Umbenennungen in `list`, `story` und Pinboard-Boards nachgezogen werden).

Erweiterung: Ein zusätzlicher beschreibbarer Bag **„plugins“** (gemeinsam) für eigene Plugins, die der
Nutzer in alle seine Wikis haben will; er liegt direkt über `@plugins`. Wer ein Plugin nur in einem Wiki
will, installiert es dort; es landet dann im Bag dieses Wikis.

## 4. Datenmodell

```rust
pub struct Project {
    pub id: String,
    pub name: String,                 // = Name des Projekt-Bags
    pub color: Option<String>,
    pub files: Vec<String>,           // wie bisher
    pub folders: Vec<String>,         // wie bisher
    pub home: Option<String>,         // wie bisher
    #[serde(default)] pub wiki: Option<String>,        // Recipe des Hauptwikis
    #[serde(default)] pub statuses: Vec<String>,       // Kanban-Spalten des Projekts
    #[serde(default)] pub smart: Vec<String>,          // verknüpfte intelligente Ordner
}

pub struct Recipe {                    // wie bisher, dazu:
    #[serde(default)] pub project: Option<String>,     // Projekt-ID
    #[serde(default)] pub base: Option<String>,        // Unterwiki: Recipe des Hauptwikis
}

// Map (JSON) bekommt:
//   "wiki": "<Recipe-Name>"        Zuordnung (Outliner dieses Wikis)
// Notiz = Tiddler im Projekt-/Unterwiki-Bag mit tags: Notiz, optional status
// Datei-Status = Feld `status` im Index (meta.jsonl), wie tags/color
// smart.json (neu): intelligente Ordner mit scope Ordner|Projekt, wie heute SmartFolder
```

**Ebenen eines Unterwikis** (`Store::layer_names`, erweitert): `@plugins` → „plugins“ → gemeinsame Bags des
Hauptwikis → Projekt-Bag → Maps des Unterwikis → `lokal` → Bag des Unterwikis.

**Abgleich der Outline:** Pro zugeordneter Map schreibt der Abgleich einen Story-Tiddler
(`<Map-Titel>`, Felder `story`, `pinboard-levels`, `pinboard-board`, `brausa-map`) und liest Änderungen
an `story`/`pinboard-levels` zurück in die Map (neue Reihenfolge, neue Eltern). Konflikte wie bei Karten:
brausa gewinnt, die Wiki-Fassung kommt in den Bericht.

## 5. Oberfläche

### 5.1 Seitenleiste

```
PROJEKTE
▾ Schule
    ⌂ Übersicht                 (Projekt-Startseite)
    ✎ Notizen          12
    ▤ Kanban            5 offen
    ▣ Wiki „Schule“             ↻
       ▣ Geschichte              ↻
       ▣ Oberstufe               ↻
    ◇ Geschichte – Gliederung   (Map → Geschichte)
    ◇ Oberstufe – Kursplan      (Map → Oberstufe)
    ⌕ Arbeitsblätter            (intelligenter Ordner)
▸ Hausbau
INTELLIGENTE ORDNER             (nur die globalen)
```

- Ziehen eines intelligenten Ordners auf ein Projekt verknüpft ihn; Ziehen einer Map auf ein (Unter-)Wiki ordnet sie zu.
- `+` am Projekt: Notiz, Map, Unterwiki, intelligenter Ordner.
- Der bisherige Abschnitt *Wikis* bleibt für Wikis ohne Projekt und für die Bag-Übersicht.

### 5.2 Projekt-Startseite

Kacheln: Notizen (letzte drei), Kanban (Spalten mit Zahlen), Wikis (letzter Abgleich, Überdeckungen),
Maps (Vorschau), Dateien (Anzahl, zuletzt geändert), intelligente Ordner (Treffer).

### 5.3 Ansichten im Projekt

Ansichtsleiste mit **Dateien · Notizen · Kanban · Map (Fläche | Outline) · Wiki**. Das Wiki öffnet sich im
Web-Fenster neben den Dateien.

### 5.4 Bag-Übersicht

Gruppiert nach Projekten: Hauptwiki mit seinen Unterwikis nebeneinander, Projekt-Bag und Unterwiki-Bags
markiert; die Ebenen-Ansicht zeigt, was ein Unterwiki vom Hauptwiki erbt.

## 6. Abläufe

1. **Projekt „Schule“ anlegen:** Projekt-Bag „Schule“, Hauptwiki „Schule“, Notizen-Seite und Kanban entstehen sofort.
2. **Unterwiki „Geschichte“:** `+` → Unterwiki → Ziel-Datei wählen. Es erbt alles vom Hauptwiki, bekommt den Bag „Schule/Geschichte“.
3. **Gliederung:** Map „Geschichte – Gliederung“ anlegen, dem Unterwiki zuordnen, in der Outline-Ansicht Kapitel
   und Unterkapitel anlegen. Im Wiki „Geschichte“ steht danach das Inhaltsverzeichnis als Story-Tiddler, jede
   Karte ist ein Tiddler, jedes Kapitel ein Pinboard.
4. **Aufgaben:** Notiz „Klausur vorbereiten“ mit Status „Offen“ → erscheint im Kanban; Filter „Wiki: Oberstufe“ zeigt nur deren Karten und Notizen.
5. **Private Notiz:** Tag `privat` → bleibt in `lokal`, erscheint in keinem veröffentlichten Wiki.

## 7. Migration

- Bestehende Projekte bekommen Statusspalten aus ihren Maps (Vereinigung der `statuses`).
- Bestehende Recipes mit Map-Bags genau eines Projekts werden dessen Hauptwiki (wenn das Projekt noch keins hat),
  sonst bleiben sie global; ihre Map-Bags werden zur Zuordnung der Maps (`map.wiki`).
- Der eigene Bag eines Hauptwikis (`wiki-<Name>`) wird beim Übergang in den Projekt-Bag umbenannt; bestehende
  Tiddler bleiben erhalten.
- Intelligente Ordner: Ort = Projekt → projekt-eigen; Ordner in einem Projektordner → verknüpft; sonst global.
- Nichts wird gelöscht; die Migration läuft einmal und ist wiederholbar.

## 8. Umsetzung in Schritten

| Schritt | Inhalt |
|---|---|
| 0 ✓ | Standard-Plugins auf TiddlyVisuals 1.16.0, Relink 2.5.2 im Bag `@plugins` (erledigt 19.10.) |
| 1 ✓ | Intelligente Ordner in den Kern (`smart.json`, Übernahme aus dem alten Speicher); aufklappbare Projekte zeigen eigene und verknüpfte Ordner (erledigt 19.10.) |
| 2 | Projekt-Bag nach Name, Hauptwiki per Klick, Unterwikis mit `base`, Ebenen erweitert |
| 3 | Notizen-Seite (Tiddler im Projekt-Bag, Editor, privat → `lokal`) |
| 4 | Status als Feld für Dateien; gemeinsames Kanban mit Filterleiste |
| 5 | Map-Zuordnung zu Wikis, Outline-Ansicht, Story-Tiddler in beide Richtungen |
| 6 (teils ✓) | Projekt-Startseite (erledigt 19.10.: Dateien, Notizen & Snippets, Pinboard, Kanban, Wikis), Wiki im Web-Fenster |
| 7 | Vorschlag „Hineintauchen“ für Pinboard (TiddlyVisuals), brausa schreibt die Felder schon vorher |

## 9. Entscheidungen (19.10.2026)

1. **Kanban:** ein gemeinsames Board pro Projekt über Karten, Notizen und Dateien, **filterbar**.
2. **Wikis:** ein **Hauptwiki** pro Projekt, dazu **Unterwikis** (z. B. Geschichte, Oberstufe), die darauf aufbauen.
3. **Maps:** dienen als **Outliner** ihres Wikis (Abbildung auf Pinboard-Stories, s. 3.2).
4. **Status:** als **Feld** (`status`), auch für Dateien.
5. **Intelligente Ordner:** **nicht** im Wiki.
6. **Projekt-Bag:** benannt **nach dem Projektnamen**.
7. **Notizen-Seite** gehört zu jedem Projekt.
8. **Standard-Plugins:** wie beim MultiWikiServer in einem Bag ganz unten (`@plugins`), jetzt mit Relink.

9. **Eigene Plugins:** zusätzlicher beschreibbarer Bag **„plugins“** direkt über `@plugins`.
10. **Notiz-Titel:** die erste Überschrift wird als Titel vorgeschlagen (änderbar).
11. **Unterwikis:** je Unterwiki ein **eigenes Recipe und eine eigene Wiki-Datei**.
