// Project map, card kanban, project board.
export const de = {
  untitled: 'Ohne Titel',
  card: 'Karte',
  'status.open': 'Offen',
  'status.doing': 'In Arbeit',
  'status.done': 'Erledigt',

  'switch.map': 'Projektmap',
  'switch.mapLabel': 'Map',
  'switch.kanban': 'Karten mit Status als Kanban',
  'switch.files': 'Dateien des Projekts zum Hineinziehen',

  'board.noProject': 'Maps gehören zu einem Projekt. Projekte sammeln Dateien und Ordner von überall.',
  'board.newProject': 'Neues Projekt …',
  'board.create': 'Anlegen',

  'kanban.hint': 'Karten kommen über „Kanban“ in der Map hierher. Klick zeigt die Karte auf der Map.',
  'kanban.columnName': 'Name der Spalte',
  'kanban.column': 'Spalte',
  'kanban.dropRemove': 'Hierher ziehen: aus dem Kanban nehmen',
  'kanban.empty': 'Noch keine Karten im Kanban. Karte in der Map auswählen und unten auf „Kanban“ klicken.',

  'drop.link': 'Mit „{title}“ verknüpfen',
  'drop.stackAbove': 'Über „{title}“ stapeln',
  'drop.stackBelow': 'Unter „{title}“ stapeln',
  'drop.intoCard': 'Als Karte in „{title}“ legen',
  'drop.intoSnippet': 'Als Snippet in „{title}“ legen',
  'drop.placeCard': 'Als Karte ablegen',
  'drop.placeSnippet': 'Als Snippet ablegen',
  snippetTitle: '{name} · S. {page}',
  linked: '„{title}“ verknüpft mit {files}',
  toKanban: 'Im Kanban unter „{status}“',
  fromKanban: 'Aus dem Kanban genommen',

  stack: 'Stapel · {n}',
  notFound: 'Nicht gefunden',
  'subcards.one': '{n} Unterkarte',
  'subcards.other': '{n} Unterkarten',
  zoomIn: 'Hineinzoomen (Enter)',
  connect: 'Ziehen: Pfeil zu einer anderen Karte',

  'link.label': 'Beschriftung',
  'link.direction': 'Richtung umschalten',
  'link.delete': 'Verbindung löschen',

  'edit.title': 'Titel',
  'edit.text': 'Text (Markdown) …',
  'edit.doneHint': 'fertig',

  'menu.newName': 'Name der neuen Map',
  'menu.rename': 'Neuer Name',
  'menu.rootTitle': 'Ganze Map zeigen (0) · Doppelklick: umbenennen',
  'menu.maps': 'Maps',
  'menu.new': 'Neue Map',
  'menu.delete': 'Map löschen',

  'tools.newCard': 'Neue Karte (N) – oder Doppelklick auf eine freie Stelle',
  'tools.up': 'Eine Ebene hinauf (Esc)',
  'tools.overview': 'Ganze Map (0)',
  'tools.redo': 'Wiederholen',

  'sel.color': 'Farbe {color}',
  'sel.noColor': 'Keine Farbe',
  'sel.edit': 'Bearbeiten (F2)',
  'sel.fromKanban': 'Aus dem Kanban nehmen',
  'sel.toKanban': 'Ins Kanban schicken',
  'sel.delete': 'Löschen (Entf)',

  empty: 'Doppelklick legt eine Karte an. Karten auf andere ziehen macht sie zu Unterkarten, der Punkt am rechten Rand zieht Pfeile.'
};

export const en: typeof de = {
  untitled: 'Untitled',
  card: 'Card',
  'status.open': 'To do',
  'status.doing': 'In progress',
  'status.done': 'Done',

  'switch.map': 'Project map',
  'switch.mapLabel': 'Map',
  'switch.kanban': 'Cards with a status as a kanban',
  'switch.files': 'Project files to drag in',

  'board.noProject': 'Maps belong to a project. Projects collect files and folders from anywhere.',
  'board.newProject': 'New project …',
  'board.create': 'Create',

  'kanban.hint': 'Cards get here via “Kanban” on the map. Click to show the card on the map.',
  'kanban.columnName': 'Column name',
  'kanban.column': 'Column',
  'kanban.dropRemove': 'Drag here to remove from the kanban',
  'kanban.empty': 'No cards in the kanban yet. Select a card on the map and click “Kanban” at the bottom.',

  'drop.link': 'Link to “{title}”',
  'drop.stackAbove': 'Stack above “{title}”',
  'drop.stackBelow': 'Stack below “{title}”',
  'drop.intoCard': 'Put into “{title}” as a card',
  'drop.intoSnippet': 'Put into “{title}” as a snippet',
  'drop.placeCard': 'Place as a card',
  'drop.placeSnippet': 'Place as a snippet',
  snippetTitle: '{name} · p. {page}',
  linked: '“{title}” linked to {files}',
  toKanban: 'In the kanban under “{status}”',
  fromKanban: 'Removed from the kanban',

  stack: 'Stack · {n}',
  notFound: 'Not found',
  'subcards.one': '{n} sub-card',
  'subcards.other': '{n} sub-cards',
  zoomIn: 'Zoom in (Enter)',
  connect: 'Drag: arrow to another card',

  'link.label': 'Label',
  'link.direction': 'Toggle direction',
  'link.delete': 'Delete connection',

  'edit.title': 'Title',
  'edit.text': 'Text (Markdown) …',
  'edit.doneHint': 'done',

  'menu.newName': 'Name of the new map',
  'menu.rename': 'New name',
  'menu.rootTitle': 'Show whole map (0) · Double-click: rename',
  'menu.maps': 'Maps',
  'menu.new': 'New map',
  'menu.delete': 'Delete map',

  'tools.newCard': 'New card (N) – or double-click an empty spot',
  'tools.up': 'One level up (Esc)',
  'tools.overview': 'Whole map (0)',
  'tools.redo': 'Redo',

  'sel.color': 'Colour {color}',
  'sel.noColor': 'No colour',
  'sel.edit': 'Edit (F2)',
  'sel.fromKanban': 'Remove from the kanban',
  'sel.toKanban': 'Send to the kanban',
  'sel.delete': 'Delete (Del)',

  empty: 'Double-click to create a card. Drag cards onto others to make them sub-cards; the dot on the right edge draws arrows.'
};
