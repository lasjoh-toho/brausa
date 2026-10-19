# Konzept: Projekt als Arbeitsraum (Projekte, Maps, Kanban, Wikis, intelligente Ordner)

Stand: 19.10.2026 · Status: Entwurf zur Entscheidung

## 1. Ausgangslage

Heute stehen fünf Dinge nebeneinander, die inhaltlich zusammengehören:

| Baustein | Wo er heute lebt | Bezug zu Projekten |
|---|---|---|
| **Projekt** | `projects.json` im Rust-Kern: Name, Farbe, Dateien (Index-IDs), Ordner | – |
| **Map** | Map-Dateien je Projekt (`maps/<id>.json`) | gehört fest zu einem Projekt |
| **Kanban** | Status-Spalten *einer Map* (`statuses`, Karten mit `status`); daneben das Datei-Kanban der Ansicht (Spalten = Tags oder Unterordner) | nur indirekt über die Map |
| **Wiki** | Recipe in `tw/recipes.json`: Liste von Bags, Ziel-Wiki | nur indirekt, wenn eine Map als Bag eingebunden ist |
| **Intelligenter Ordner** | im Frontend (`localStorage`): Ort (Ordner *oder* Projekt), Suche, Art, Stream, Zeitraum | optional über den Ort |

Folgen: Ein Wiki weiß nicht, zu welchem Projekt es gehört; ein intelligenter Ordner liegt global in der
Seitenleiste, auch wenn er nur für ein Projekt Sinn ergibt; das Kanban der Karten und das Kanban der
Dateien sind zwei getrennte Welten; wer ein Projekt öffnet, muss Map, Wiki und gespeicherte Ansichten
an verschiedenen Stellen zusammensuchen.

## 2. Leitidee

**Das Projekt wird zum Arbeitsraum.** Es ist der Knoten, an dem alles hängt: Dateien und Ordner (wie
bisher), dazu **Verknüpfungen** zu Maps, Kanban-Boards, Wikis und intelligenten Ordnern. Jede
Verknüpfung ist eine leichte Referenz, keine Kopie; dasselbe Wiki oder derselbe intelligente Ordner
kann in mehreren Projekten auftauchen.

Drei Regeln halten es einfach:

1. **Eigentum vs. Verknüpfung.** Was nur im Projekt Sinn ergibt, *gehört* ihm (seine Maps, sein
   Projekt-Bag). Alles andere wird *verknüpft* (Wikis, intelligente Ordner, gemeinsame Bags, andere
   Boards). Löschen eines Projekts löscht nur, was ihm gehört; Verknüpfungen fallen einfach weg.
2. **Ein Baustein, viele Ansichten.** Map, Kanban und Wiki sind Sichten auf dieselben Karten.
   Intelligente Ordner sind Sichten auf Dateien. Nichts wird doppelt gepflegt.
3. **Alles hat einen Standard.** Jedes Projekt hat genau eine Standard-Map, ein Standard-Board und
   optional ein Standard-Wiki. Ein Klick auf das Projekt öffnet diese; weitere sind einen Klick entfernt.

```
                    ┌───────────── Projekt „Reise 2026“ ─────────────┐
 Dateien/Ordner ───▶│  Dateien · Ordner                              │
                    │  Maps        (gehören dem Projekt, 1…n)        │──▶ Map „Übersicht“ (Standard)
                    │  Boards      (Sichten auf Karten oder Dateien) │──▶ Kanban „Planung“ (Standard)
                    │  Wikis       (verknüpft, 0…n)                  │──▶ Wiki „Reise“ (Standard)
                    │  Int. Ordner (eigene oder verknüpfte, 0…n)     │──▶ „Fotos Juli“, „#beleg“
                    └────────────────────────────────────────────────┘
```

## 3. Die Bausteine im Einzelnen

### 3.1 Maps (gehören dem Projekt)

Bleibt wie heute: Maps liegen beim Projekt, mehrere sind möglich. Neu ist nur die markierte
**Standard-Map**, die die Ansicht „Projektmap“ öffnet.

### 3.2 Kanban-Boards (Sicht, gehört dem Projekt)

Das heutige Karten-Kanban und das Datei-Kanban werden zu **einem Board-Begriff** vereint:

```ts
interface Board {
  id: string;
  name: string;
  /** Was auf dem Board liegt. */
  source:
    | { kind: 'cards'; map: string }          // Karten einer Map (heute: Map-Kanban)
    | { kind: 'files'; smart?: string };      // Dateien des Projekts, optional gefiltert durch einen intelligenten Ordner
  /** Wonach die Spalten gebildet werden. */
  columns:
    | { by: 'status'; values: string[] }      // Karten-Status oder Datei-Status (neues Metafeld wie Tags)
    | { by: 'tag'; depth: number }            // wie das heutige Datei-Kanban
    | { by: 'folder' };
}
```

- Karten-Boards sind genau das heutige Kanban der Map (Status bleibt in der Map gespeichert).
- Datei-Boards bekommen optional einen **Status für Dateien** (neues Metafeld im Index, wie Tags):
  „Eingang → In Arbeit → Erledigt“ für Belege, Fotos, Dokumente. Ziehen zwischen Spalten setzt ihn.
- Ein Board kann einen intelligenten Ordner als Quelle haben: „Alle PDFs mit #beleg aus 2026“ als
  Kanban nach Status.

### 3.3 Intelligente Ordner (eigene oder verknüpfte)

Wandern aus dem Browser-Speicher in den Rust-Kern (`smart.json`), damit sie mit Projekten, Boards und
Wikis verknüpfbar sind und auf andere Rechner mitkommen.

- **Projekt-eigen:** Ort = das Projekt (alle seine Dateien). Erscheint nur unter dem Projekt.
- **Verknüpft:** Ein globaler intelligenter Ordner (z. B. „Alle Rechnungen“, Ort = Dokumente) wird mit
  einem oder mehreren Projekten verknüpft und erscheint dort zusätzlich.
- Wer einen intelligenten Ordner auf ein Projekt zieht, verknüpft ihn; wer im Projekt „Aktuelle Ansicht
  speichern“ wählt, legt einen projekt-eigenen an.

### 3.4 Wikis (verknüpft)

Ein Wiki bleibt ein Recipe (Bags in Reihenfolge, Ziel-Wiki), bekommt aber Projekte als Bezug:

- **Projekt-Wiki anlegen:** Ein Klick im Projekt erzeugt ein Recipe mit einer sinnvollen
  Grundaufstellung (siehe Ebenen-Ansicht der Bag-Übersicht):
  `@plugins` → gemeinsame Bags nach Wahl → **alle Maps des Projekts** → `lokal` → **Projekt-Bag**
  (`projekt-<id>`, gehört dem Projekt, ist der beschreibbare oberste Bag).
- **Neue Maps kommen automatisch dazu:** Ein Projekt-Wiki führt die Maps seines Projekts nach (Option
  „Maps des Projekts automatisch einbinden“, Standard an).
- **Verknüpfen statt anlegen:** Ein bestehendes Wiki kann mit mehreren Projekten verknüpft werden
  (z. B. ein Wiki für mehrere Teilprojekte). Die Bag-Übersicht zeigt Projekte als zusätzliche
  Gruppierung über den Bags.
- **Intelligente Ordner im Wiki:** Ein verknüpfter intelligenter Ordner kann als Tiddler ins Wiki
  (Liste der Dateien mit `_canonical_uri`, im Bag `lokal`, wird beim Abgleich aktualisiert). So
  erscheinen z. B. „Fotos Juli“ im Wiki als Galerie.
- **Kanban im Wiki:** Karten-Boards gehen wie heute als tw5-graph-Kanban mit; Datei-Boards als Liste
  pro Spalte.

### 3.5 Weitere Projektbezüge (schon vorhanden, werden einsortiert)

Lesezeichen und Verlauf des Web-Fensters, Downloads, der Ablage-Tray: alles hängt heute schon am
offenen Projekt und bekommt im Arbeitsraum seinen festen Platz.

## 4. Datenmodell

Ein Projekt bekommt eine Liste typisierter Verknüpfungen; Eigentum ergibt sich aus dem Typ.

```rust
pub struct Project {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
    pub files: Vec<String>,          // wie bisher
    pub folders: Vec<String>,        // wie bisher
    pub home: Option<String>,        // wie bisher
    #[serde(default)]
    pub links: Vec<Link>,            // neu
}

#[serde(tag = "kind")]
pub enum Link {
    Map   { id: String, default: bool },                 // gehört dem Projekt
    Board { id: String, default: bool },                 // gehört dem Projekt (boards.json im Projekt)
    Wiki  { recipe: String, default: bool, own: bool },  // own = vom Projekt angelegt
    Smart { id: String, own: bool },                     // own = Ort ist das Projekt
}
```

- `smart.json` (neu, Rust): intelligente Ordner mit `id`, `name`, `scope`, `search`, `typeFilter`,
  `recursive`, `date`. Das Format entspricht dem heutigen `SmartFolder`; Migration liest einmal den
  Browser-Speicher und schreibt ihn in den Kern.
- `Recipe` bekommt `projects: Vec<String>` (Rückverweis, für die Übersicht) und
  `follow_maps: Option<String>` (Projekt, dessen Maps automatisch eingebunden werden).
- Rückverweise werden nur vom Kern geschrieben, damit Projekt und Wiki nie auseinanderlaufen.
- Datei-Status: neues Feld `status` im Index (wie `tags`, `color`), mit Verlauf für Rückgängig.

## 5. Oberfläche

### 5.1 Seitenleiste

Projekte werden aufklappbar. Unter einem Projekt stehen seine Bausteine, die Standard-Elemente zuerst:

```
PROJEKTE
▾ Reise 2026
    ◇ Übersicht            (Map, Standard)
    ▤ Planung              (Kanban, Standard)
    ▣ Wiki „Reise“         (Wiki, ↻ abgleichen)
    ⌕ Fotos Juli           (intelligenter Ordner, eigen)
    ⌕ Alle Rechnungen  ⧉   (intelligenter Ordner, verknüpft)
▸ Hausbau
INTELLIGENTE ORDNER        (nur noch die globalen)
WIKIS                      (alle; Projekt-Wikis mit Projektfarbe)
```

- Ziehen eines intelligenten Ordners oder Wikis auf ein Projekt verknüpft ihn; Ziehen aus dem
  Projekt heraus (oder Rechtsklick → „Vom Projekt lösen“) löst die Verknüpfung.
- `+` am Projekt: Map, Board, Wiki, intelligenter Ordner anlegen.

### 5.2 Projekt-Startseite

Ein Klick auf den Projektnamen (nicht auf einen Baustein) öffnet eine Übersicht mit Kacheln:
Dateien (Anzahl, letzte Änderungen), Standard-Map (Vorschau), Board (Spalten mit Zahlen), Wiki
(letzter Abgleich, Überdeckungen), intelligente Ordner (Anzahl Treffer). Von dort führt jeder Klick in
die passende Ansicht.

### 5.3 Ansichtsleiste im Projekt

Ist ein Projekt offen, zeigt die Ansichtsleiste zusätzlich zu den Dateiansichten **Map**, **Board** und
**Wiki** des Projekts; ein kleines Menü daneben wählt zwischen mehreren Maps/Boards/Wikis. Das Wiki
öffnet sich im Web-Fenster (Einzeldatei-Wiki oder über den lokalen Server), so dass Dateien, Map und
Wiki nebeneinander stehen.

### 5.4 Bag-Übersicht

Bekommt Projekte als Gruppierung: in der Matrix als Spaltengruppen über den Wikis, im Graph als dritte
Spalte (Projekt → Wiki → Bags), in den Ebenen markiert, welche Bags dem Projekt gehören.

## 6. Abläufe (Beispiele)

1. **Neues Projekt „Hausbau“:** anlegen → bekommt automatisch Standard-Map und Standard-Board
   (Karten nach Status). „Wiki anlegen“ erzeugt das Projekt-Wiki mit Map, `lokal` und Projekt-Bag.
2. **Belege verfolgen:** Im Projekt „Hausbau“ nach `is:pdf #beleg` filtern → „Aktuelle Ansicht
   speichern“ → projekt-eigener intelligenter Ordner. „Als Board öffnen“ → Datei-Board nach Status.
3. **Gemeinsames Glossar:** Der Bag „glossar“ und das Wiki „Wissen“ werden mit „Hausbau“ und
   „Reise 2026“ verknüpft; beide Projekte zeigen es, die Bag-Übersicht zeigt die Beziehung.
4. **Fotos ins Wiki:** Intelligenten Ordner „Fotos Juli“ verknüpfen → beim Abgleich erscheint im Wiki
   ein Tiddler „Fotos Juli“ mit allen Bildern als Links auf die lokalen Dateien (Bag `lokal`).

## 7. Migration

- Bestehende Projekte: ihre Maps werden als `Link::Map` eingetragen, die zuletzt geöffnete wird Standard.
- Bestehende Wikis: Enthält ein Recipe Map-Bags genau eines Projekts, wird es mit diesem verknüpft
  (`own: false`), sonst bleibt es global.
- Intelligente Ordner: Ort = Projekt → projekt-eigen; Ort = Ordner innerhalb eines Projektordners →
  verknüpft mit diesem Projekt; sonst global.
- Nichts wird gelöscht oder verschoben; die Migration ist idempotent und läuft beim ersten Start.

## 8. Umsetzung in Schritten

| Schritt | Inhalt | Nutzen sofort |
|---|---|---|
| 1 | Intelligente Ordner in den Kern (`smart.json`), Projekt-eigene unter dem Projekt anzeigen | aufgeräumte Seitenleiste, Ordner auf allen Rechnern |
| 2 | `Project.links` + aufklappbare Projekte in der Seitenleiste, Verknüpfen per Ziehen | alles zu einem Projekt an einem Ort |
| 3 | Projekt-Wiki per Klick, Maps automatisch nachführen, Rückverweise im Recipe | Wiki ohne Handarbeit aktuell |
| 4 | Board-Begriff: Karten- und Datei-Boards, Datei-Status im Index | ein Kanban für alles |
| 5 | Projekt-Startseite, Map/Board/Wiki in der Ansichtsleiste, Wiki im Web-Fenster | Arbeitsraum-Gefühl |
| 6 | Intelligente Ordner als Wiki-Tiddler, Projekte in der Bag-Übersicht | Wiki zeigt Dateisammlungen |

Jeder Schritt ist für sich nutzbar und bricht nichts Bestehendes.

## 9. Offene Entscheidungen

1. **Kanban vereinheitlichen?** Ein Board-Begriff für Karten *und* Dateien (Vorschlag) oder die beiden
   Kanbans getrennt lassen und nur verknüpfen.
2. **Datei-Status:** neues Metafeld (Vorschlag) oder Status über Tags abbilden (`status/offen`).
3. **Wiki pro Projekt:** genau ein Projekt-Wiki als Standard plus verknüpfte (Vorschlag) oder beliebig viele gleichrangige.
4. **Intelligente Ordner im Wiki:** als Liste von Datei-Links in `lokal` (Vorschlag) oder gar nicht ins Wiki.
5. **Projekt-Bag-Name:** `projekt-<Name>` (lesbar, ändert sich beim Umbenennen) oder `projekt-<id>` (stabil, Vorschlag).
