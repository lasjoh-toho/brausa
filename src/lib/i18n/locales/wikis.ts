// TiddlyWiki sync state: toasts and bag labels.
export const de = {
  resolved: 'Erledigt – die Wikis bekommen es beim nächsten Abgleich.',
  'discarded.one': '{n} gleiche Überdeckung verworfen',
  'discarded.other': '{n} gleiche Überdeckungen verworfen',
  removed: 'Wiki „{name}“ entfernt. Wiki-Dateien und Bags bleiben erhalten.',
  synced: '„{name}“ abgeglichen: {parts}',
  pushed: '{n} ins Wiki geschrieben',
  pulled: '{n} aus dem Wiki übernommen',
  deleted: '{n} gelöscht',
  conflicts: 'Konflikte: {list}',
  'pending.one': '{n} Überdeckung gemeinsamer Tiddler – unter „Wikis“ prüfen',
  'pending.other': '{n} Überdeckungen gemeinsamer Tiddler – unter „Wikis“ prüfen',
  mapBag: '{title} (Map in {project})',
  mapBagUnknown: 'Map {id} ({folder})'
};

export const en: typeof de = {
  resolved: 'Done – the wikis get it on the next sync.',
  'discarded.one': '{n} identical overlay discarded',
  'discarded.other': '{n} identical overlays discarded',
  removed: 'Wiki “{name}” removed. Wiki files and bags are kept.',
  synced: '“{name}” synced: {parts}',
  pushed: '{n} written to the wiki',
  pulled: '{n} taken from the wiki',
  deleted: '{n} deleted',
  conflicts: 'Conflicts: {list}',
  'pending.one': '{n} overlay of shared tiddlers – check under “Wikis”',
  'pending.other': '{n} overlays of shared tiddlers – check under “Wikis”',
  mapBag: '{title} (map in {project})',
  mapBagUnknown: 'Map {id} ({folder})'
};
