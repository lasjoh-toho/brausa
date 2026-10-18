<script lang="ts">
  // Edit a wiki (recipe): its bags, bottom to top, and the target wiki that TiddlyDesktop-RS opens.
  import { scale } from 'svelte/transition';
  import { app } from '../state/app.svelte';
  import { wikis } from '../state/wikis.svelte';
  import type { WikiRecipe } from '../backend/types';
  import Icon from './Icon.svelte';

  let { onclose }: { onclose: () => void } = $props();

  const original = wikis.editing ? (wikis.recipes.find((r) => r.name === wikis.editing) ?? null) : null;
  const project = app.libraryOf(app.cwd);

  let r = $state<WikiRecipe>(
    original
      ? structuredClone($state.snapshot(original))
      : {
          name: project?.name ?? '',
          description: '',
          bags: wikis.maps.filter((m) => project && m.bag.startsWith(`@map:${project.root}|`)).map((m) => m.bag),
          target: { kind: 'folder', path: project?.root ? `${project.root}/${project.name}-wiki` : '' },
          plugins: true
        }
  );
  let error = $state('');
  let plugins = $state<[string, string][]>([]);
  app.backend.wikiPlugins().then((p) => (plugins = p)).catch(() => {});
  let newBag = $state('');
  let newReadonly = $state(false);

  const own = $derived(`wiki-${r.name.trim()}`);
  const available = $derived([
    ...wikis.bags.filter((b) => b.name !== own && !r.bags.includes(b.name)).map((b) => ({ bag: b.name, label: b.name, sub: b.readonly ? 'schreibgeschützt' : `${b.tiddlers} Tiddler` })),
    ...wikis.maps.filter((m) => !r.bags.includes(m.bag)).map((m) => ({ bag: m.bag, label: m.title, sub: `Map in ${m.project}` }))
  ]);
  const selectedHtml = $derived(app.selectedEntries.find((e) => e.ext === 'html' || e.ext === 'htm'));

  function move(i: number, d: number) {
    const b = [...r.bags];
    [b[i], b[i + d]] = [b[i + d], b[i]];
    r.bags = b;
  }

  async function createBag() {
    const name = newBag.trim();
    if (!name) return;
    try {
      await wikis.addBag(name, newReadonly);
      r.bags = [...r.bags.filter((b) => b !== own), name, ...(r.bags.includes(own) ? [own] : [])];
      newBag = '';
    } catch (e) {
      error = String(e).replace(/^Error: /, '');
    }
  }

  async function save(sync: boolean) {
    error = '';
    if (!r.name.trim() || !r.target.path.trim()) return void (error = 'Name und Ziel-Wiki angeben.');
    try {
      const plain = $state.snapshot(r);
      const saved = await wikis.save({ ...plain, name: plain.name.trim(), target: { ...plain.target, path: plain.target.path.trim() } }, original?.name ?? null);
      onclose();
      if (sync) await wikis.sync(saved.name);
    } catch (e) {
      error = String(e).replace(/^Error: /, '');
    }
  }

  async function remove() {
    if (!original) return;
    await wikis.remove(original.name);
    onclose();
  }
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />

<div class="backdrop" role="presentation" onpointerdown={(e) => e.target === e.currentTarget && onclose()}>
  <div class="panel" transition:scale={{ start: 0.96, duration: 140 }} role="dialog" aria-label="Wiki">
    <div class="head">
      <Icon name="book" size={16} />
      <b>{original ? `Wiki „${original.name}“` : 'Neues Wiki'}</b>
      <span class="muted">Ein Wiki besteht aus Bags; bei gleichem Titel gewinnt der untere in der Liste.</span>
    </div>

    <div class="row">
      <label>Name <input bind:value={r.name} placeholder="Projekt-Wiki" /></label>
      <label class="grow">Beschreibung <input bind:value={r.description} placeholder="optional" /></label>
    </div>

    <div class="sec">Ziel-Wiki (in TiddlyDesktop-RS öffnen)</div>
    <div class="row">
      <div class="seg">
        <button class="btn" class:on={r.target.kind === 'folder'} onclick={() => (r.target.kind = 'folder')}>Ordner-Wiki</button>
        <button class="btn" class:on={r.target.kind === 'file'} onclick={() => (r.target.kind = 'file')}>Einzeldatei</button>
      </div>
      <input class="grow mono" bind:value={r.target.path} placeholder={r.target.kind === 'folder' ? '/Pfad/zum/Wiki-Ordner' : '/Pfad/zu/wiki.html'} />
      {#if r.target.kind === 'folder'}
        <button class="btn" title="Unterordner im aktuellen Ordner" onclick={() => (r.target.path = `${app.cwd}/${r.name.trim() || 'wiki'}`)}>Hier</button>
      {:else if selectedHtml}
        <button class="btn" title="Die ausgewählte HTML-Datei" onclick={() => (r.target.path = selectedHtml.path)}>Auswahl: {selectedHtml.name}</button>
      {/if}
    </div>
    <p class="muted">
      {#if r.target.kind === 'folder'}
        Ordner-Wikis speichert TiddlyDesktop-RS bei jeder Änderung (mit Node.js). brausa legt <code>tiddlywiki.info</code> an, falls es fehlt.
      {:else}
        Ein vorhandenes Wiki (TiddlyWiki ≥ 5.2), z. B. in TiddlyDesktop-RS neu angelegt. Vor jedem Abgleich speichern und schließen; brausa legt eine Sicherung in <code>.backups/</code> an.
      {/if}
    </p>

    <label class="plugins">
      <input type="checkbox" bind:checked={r.plugins} />
      <span>
        <b>Plugins mitliefern:</b>
        {plugins.map(([n, v]) => `${n} ${v}`).join(' · ')}
        <span class="muted">– Karten erscheinen im Wiki als Pinboard und Kanban, Markdown wird gerendert. Nichts muss im Wiki installiert werden.</span>
      </span>
    </label>

    <div class="cols">
      <div>
        <div class="sec">Bags in diesem Wiki</div>
        <ol class="bags">
          {#each r.bags as b, i (b)}
            <li>
              <Icon name={b.startsWith('@map:') ? 'nodes' : 'tray'} size={13} />
              <span class="name">{wikis.label(b)}</span>
              {#if wikis.bags.find((x) => x.name === b)?.readonly}<span class="badge">nur lesen</span>{/if}
              <button class="btn icon" disabled={i === 0} onclick={() => move(i, -1)} aria-label="Nach oben"><Icon name="up" size={12} /></button>
              <button class="btn icon" onclick={() => (r.bags = r.bags.filter((x) => x !== b))} aria-label="Entfernen"><Icon name="x" size={12} /></button>
            </li>
          {:else}
            <li class="muted">Noch keine Bags</li>
          {/each}
          {#if !r.bags.includes(own) && r.name.trim()}
            <li class="muted"><Icon name="tray" size={13} /> {own} (eigener Bag, wird angelegt)</li>
          {/if}
        </ol>
      </div>
      <div>
        <div class="sec">Hinzufügen</div>
        <div class="avail">
          {#each available as a (a.bag)}
            <button class="add" onclick={() => (r.bags = [...r.bags.filter((x) => x !== own), a.bag, ...(r.bags.includes(own) ? [own] : [])])}>
              <Icon name={a.bag.startsWith('@map:') ? 'nodes' : 'tray'} size={13} />
              <span class="name">{a.label}</span><span class="sub">{a.sub}</span>
            </button>
          {:else}
            <span class="muted">Alles hinzugefügt</span>
          {/each}
        </div>
        <div class="row newbag">
          <input bind:value={newBag} placeholder="Neuer gemeinsamer Bag" onkeydown={(e) => e.key === 'Enter' && createBag()} />
          <label class="ro"><input type="checkbox" bind:checked={newReadonly} /> nur lesen</label>
          <button class="btn" onclick={createBag}><Icon name="plus" size={13} /></button>
        </div>
      </div>
    </div>

    {#if error}<p class="err">{error}</p>{/if}
    <div class="foot">
      {#if original}<button class="btn danger" onclick={remove}>Entfernen</button>{/if}
      <span class="grow"></span>
      <button class="btn" onclick={onclose}>Abbrechen</button>
      <button class="btn" onclick={() => save(false)}>Speichern</button>
      <button class="btn primary" onclick={() => save(true)}>Speichern und abgleichen</button>
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: absolute;
    inset: 0;
    z-index: 80;
    display: grid;
    place-items: center;
    background: rgba(0, 0, 0, 0.18);
  }
  .panel {
    width: min(760px, calc(100% - 32px));
    max-height: calc(100% - 48px);
    overflow: auto;
    padding: 16px;
    border-radius: 16px;
    background: var(--bg-elev);
    box-shadow:
      var(--shadow),
      0 0 0 1px var(--line);
  }
  .head,
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .row {
    margin-top: 10px;
  }
  .row label {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--fg-muted);
  }
  .grow {
    flex: 1;
  }
  input:not([type='checkbox']) {
    padding: 5px 8px;
    border-radius: 7px;
    border: 1px solid var(--line);
    background: var(--bg);
    color: var(--fg);
    min-width: 0;
  }
  label.grow input {
    flex: 1;
  }
  .mono {
    font-family: var(--mono);
    font-size: 12px;
  }
  .muted {
    color: var(--fg-faint);
    font-size: 12px;
  }
  code {
    font-family: var(--mono);
  }
  .sec {
    margin: 16px 0 6px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--fg-faint);
  }
  .plugins {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin-top: 12px;
    padding: 8px 10px;
    border-radius: 8px;
    background: var(--bg-sunken);
    font-size: 12px;
    line-height: 1.5;
  }
  .plugins input {
    margin-top: 3px;
  }
  .cols {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
  }
  .bags {
    margin: 0;
    padding: 0 0 0 18px;
  }
  .bags li {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 0;
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .badge {
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 8px;
    background: var(--bg-sunken);
    color: var(--fg-muted);
  }
  .avail {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 220px;
    overflow: auto;
  }
  .add {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 8px;
    border-radius: 7px;
    text-align: left;
  }
  .add:hover {
    background: var(--bg-sunken);
  }
  .sub {
    font-size: 11px;
    color: var(--fg-faint);
    white-space: nowrap;
  }
  .newbag input:not([type='checkbox']) {
    flex: 1;
  }
  .ro {
    font-size: 12px;
    white-space: nowrap;
  }
  .err {
    color: var(--danger);
  }
  .foot {
    display: flex;
    gap: 8px;
    margin-top: 18px;
  }
  .danger {
    color: var(--danger);
  }
</style>
