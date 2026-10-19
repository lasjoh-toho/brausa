// Messages of the demo backend (browser build) and visible errors of the Tauri backend.
export const de = {
  notAFolder: 'Kein Ordner: {path}',
  noTarget: 'Ziel fehlt',
  notFound: 'Nicht gefunden',
  intoItself: 'Ordner kann nicht in sich selbst verschoben werden',
  onlyPdfs: 'Demo-Modus: nur PDFs haben Inhalt',
  invalidName: 'Ungültiger Name',
  exists: '„{name}“ existiert bereits',
  compressAppOnly: 'Komprimieren geht nur in der App',
  wouldOpen: 'Demo-Modus: „{name}“ würde jetzt in der Standard-App geöffnet.',
  wouldReveal: 'Demo-Modus: „{name}“ würde im Dateimanager gezeigt.',
  projectNameMissing: 'Der Projektname fehlt',
  noSuchProject: 'Projekt „{id}“ gibt es nicht',
  notAProject: '„{root}“ ist kein Projekt',
  mapNotFound: 'Map nicht gefunden',
  webAppOnly: 'Das Web-Fenster gibt es nur in der Desktop-App.',
  bagInUse: 'Bag „{name}“ wird noch von einem Wiki benutzt',
  notOverlaid: '„{title}“ wird nicht mehr überdeckt',
  syncAppOnly: 'Demo-Modus: Der Abgleich mit TiddlyWiki braucht die App (Dateien auf der Festplatte).',
  readFailed: '„{path}“ ließ sich nicht lesen ({status})'
};

export const en: typeof de = {
  notAFolder: 'Not a folder: {path}',
  noTarget: 'Target missing',
  notFound: 'Not found',
  intoItself: 'A folder cannot be moved into itself',
  onlyPdfs: 'Demo mode: only PDFs have content',
  invalidName: 'Invalid name',
  exists: '“{name}” already exists',
  compressAppOnly: 'Compressing only works in the app',
  wouldOpen: 'Demo mode: “{name}” would now open in the default app.',
  wouldReveal: 'Demo mode: “{name}” would be shown in the file manager.',
  projectNameMissing: 'The project name is missing',
  noSuchProject: 'There is no project “{id}”',
  notAProject: '“{root}” is not a project',
  mapNotFound: 'Map not found',
  webAppOnly: 'The web pane is only available in the desktop app.',
  bagInUse: 'Bag “{name}” is still used by a wiki',
  notOverlaid: '“{title}” is no longer overridden',
  syncAppOnly: 'Demo mode: syncing with TiddlyWiki needs the app (files on disk).',
  readFailed: 'Could not read “{path}” ({status})'
};
