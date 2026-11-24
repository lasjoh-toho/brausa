# Plan: Leinwand, Index und Werkzeuge

Stand 24.11.2026, nach Jos Gesamtübersicht. Pro Punkt: was es schon gibt,
was fehlt, in welcher Reihenfolge es kommt. Jeder Schritt ist ein eigener PR.

## Was es schon gibt

| Wunsch | Stand in brausa |
|---|---|
| Programme im Menü | Seitenleiste „Programme“ nach Funktion (0.23), „Öffnen mit …“ |
| Dateiablage | Ablage (Tray) unten: sammeln aus beliebigen Ordnern, gemeinsam ziehen, taggen |
| Batch umbenennen mit Vorschau | F2 mit mehreren Dateien: Muster, Suchen/Ersetzen, Vorschau, Konfliktprüfung, Rückgängig (0.8) |
| Dublettensuche | Dateien nach Inhalt (0.8), Filter „Keine Dubletten“ (0.23). Ganze Ordner: fehlt |
| Ordnergrößen | nur Dateien; Ordner zeigen „–“ |
| Suche | Namen unterhalb des Ordners, in allen Orten/Medien; Volltext in PDF/Office (0.15), aber jedes Mal neu gelesen |
| Index | `library.rs`: Metadaten (Tags, Farben) je Projekt, kein Datei-Index |
| Ausgeblendete Formate (.tid) | eigener PR #34 |

## Reihenfolge

1. **Leinwand** (dieser PR). Neue Ansicht neben Kacheln/Liste/Tabelle: Ordner
   als Fenster auf einer zoombaren Fläche. Klick auf einen Unterordner öffnet
   ihn als eigenes Fenster daneben, verbunden mit einer farbigen Linie von
   seiner Zeile. Anordnungen: nach rechts (tiefe Pfade), Baum nach unten
   (breite Auffächerung), Stern (Wurzel in der Mitte). Fenster lassen sich
   an der Titelleiste verschieben. Dateien von einem Fenster ins andere
   ziehen = verschieben (mit ⌥/Strg kopieren), mit Rückgängig. Beim
   Herauszoomen zeigen die Fenster nur noch Name und Anzahl.
   Offene Fenster und Anordnung merkt sich brausa pro Ordner/Projekt.
2. **Eigener Index, Teil 1: Größen.** SQLite-Datenbank im App-Ordner
   (`index.db`): Pfad, Größe, Datum, Datei-ID, Platte (Volume-UUID). Ein
   Hintergrund-Scan pro Ort und Platte, danach hält der Dateiwächter ihn
   aktuell. Ordnergrößen kommen sofort aus der Datenbank (Summen werden
   beim Scan nach oben gerechnet). Größenansicht (Treemap/Balken) auf
   derselben Grundlage.
3. **Index, Teil 2: Suche über alle Platten.** Namenssuche aus der
   Datenbank, auch für Platten, die gerade nicht angesteckt sind: der
   Treffer sagt, welche Platte anzustecken ist. Auf Wunsch je Platte:
   Vorschaubilder und Text aus PDF/Office in die Datenbank (FTS5), dann ist
   die Volltextsuche sofort da.
4. **Vergleichen und synchronisieren.** Zwei Ordner (auch rekursiv), jede
   Abweichung eine Zeile: grün nur links, blau nur rechts, orange gleicher
   Name, anderer Inhalt. Sync mit Vorschau: spiegeln, ergänzen, beide
   Richtungen. Dublettensuche für ganze Ordner (gleiche Dateien Datei für
   Datei), aus dem Index berechnet.
5. **Galerie und Umwandeln.** Bilder/Filme/PDFs des aktuellen Ordners als
   Galerie in der rechten Spalte. Bilder umwandeln, verkleinern,
   komprimieren mit Vorher/Nachher-Blatt. Video/Audio/PDF per Rechtsklick
   (ffmpeg bzw. eingebaute Bildbibliothek; ffmpeg wird gesucht, nicht
   mitgeliefert).
6. **Dateiablage als Werkstatt.** Was in der Ablage umgewandelt oder
   komprimiert wird, entsteht in einem Ablage-Ordner, nicht neben dem
   Original. Ablage in einen Ordner ziehen = einsetzen.
7. **Backup mit Versionen.** Gemerkte Aufgaben (Quelle → Ziel), nach
   Zeitplan oder beim Anstecken der Platte. Versionen als datierte
   Ordner mit Hardlinks für Unverändertes. Eine kleine Uhr an Dateien und
   Ordnern mit Sicherungen, ein Klick holt eine Version zurück.
8. **Tabs mit Programm-Aliassen.** Tabs im Hauptfenster; ein Programm auf
   einen Tab ziehen legt dort einen Alias ab. Gibt es schon Aliasse, fragt
   ein Popup: zusätzlichen Alias anlegen oder den in … löschen.
9. **Netzfreigaben.** Änderungen anderer Rechner auf Wunsch sofort melden
   (Polling der Freigabe, da SMB keine Dateiereignisse liefert).

Warum diese Reihenfolge: Die Leinwand baut nur auf vorhandenem auf
(Ordner lesen, Ziehen/Verschieben) und ist sofort nutzbar. Der Index ist die
Grundlage für Größen, Suche, Vergleich und Ordner-Dubletten, deshalb kommt
er vor diesen. Backup und Tabs sind am wenigsten mit dem Rest verzahnt.
