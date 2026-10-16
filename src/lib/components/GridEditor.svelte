<script lang="ts">
  // Configure the drop-zone grid: size and what each cell does (folder or tag).
  import { scale } from 'svelte/transition';
  import { app, type DropCell, type DropGridConfig } from '../state/app.svelte';
  import Icon from './Icon.svelte';

  let { onclose }: { onclose: () => void } = $props();

  let cfg = $state<DropGridConfig>(structuredClone($state.snapshot(app.gridConfig)));
  const total = $derived(cfg.cols * cfg.rows);

  function cell(i: number): DropCell | null {
    return cfg.cells[i] ?? null;
  }

  function setCell(i: number, c: DropCell | null) {
    const cells = [...cfg.cells];
    while (cells.length < total) cells.push(null);
    cells[i] = c;
    cfg.cells = cells;
  }

  function useCurrent(i: number) {
    setCell(i, { label: app.cwd.split(/[\\/]/).pop() || app.cwd, path: app.cwd });
  }

  function setTag(i: number, raw: string) {
    const tag = raw.trim().replace(/^#/, '');
    setCell(i, tag ? { label: '#' + tag, tag } : null);
  }

  function save() {
    app.saveGrid({ ...cfg, cells: cfg.cells.slice(0, total) });
    onclose();
  }
</script>

<div class="backdrop" role="presentation" onpointerdown={(e) => e.target === e.currentTarget && onclose()}>
  <div class="panel" transition:scale={{ start: 0.96, duration: 140 }} role="dialog" aria-label="Ablagezonen">
    <div class="head">
      <Icon name="target" size={16} />
      <b>Ablagezonen</b>
      <span class="muted">Ziehe Dateien auf „Ablage“ in der Toolbar, um dieses Raster zu öffnen.</span>
    </div>
    <div class="size">
      <label>Spalten <input type="number" min="1" max="6" bind:value={cfg.cols} /></label>
      <label>Zeilen <input type="number" min="1" max="4" bind:value={cfg.rows} /></label>
    </div>
    <div class="grid" style:grid-template-columns="repeat({cfg.cols}, 1fr)">
      {#each Array.from({ length: total }, (_, i) => i) as i (i)}
        {@const c = cell(i)}
        <div class="cell">
          {#if c}
            <div class="label">
              <Icon name={c.tag ? 'tag' : 'folder'} size={13} />
              <input value={c.label} oninput={(e) => setCell(i, { ...c, label: e.currentTarget.value })} />
            </div>
            <div class="sub">{c.tag ? 'Tag: ' + c.tag : c.path}</div>
            <button class="rm" onclick={() => setCell(i, null)}>Leeren</button>
          {:else}
            <button class="btn" onclick={() => useCurrent(i)}><Icon name="folder" size={13} /> Aktueller Ordner</button>
            <input class="taginput" placeholder="#tag + ↵" onkeydown={(e) => e.key === 'Enter' && setTag(i, e.currentTarget.value)} />
          {/if}
        </div>
      {/each}
    </div>
    <div class="foot">
      <button class="btn" onclick={onclose}>Abbrechen</button>
      <button class="btn primary" onclick={save}>Speichern</button>
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
    width: min(720px, calc(100% - 32px));
    padding: 16px;
    border-radius: 16px;
    background: var(--bg-elev);
    box-shadow:
      var(--shadow),
      0 0 0 1px var(--line);
  }
  .head {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .muted {
    color: var(--fg-faint);
    font-size: 12px;
  }
  .size {
    display: flex;
    gap: 16px;
    margin: 14px 0;
    color: var(--fg-muted);
  }
  .size input {
    width: 52px;
    margin-left: 6px;
    padding: 4px 6px;
    border-radius: 6px;
    border: 1px solid var(--line);
    background: var(--bg);
  }
  .grid {
    display: grid;
    gap: 8px;
  }
  .cell {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-height: 92px;
    padding: 10px;
    border-radius: 12px;
    background: var(--bg-sunken);
  }
  .label {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .label input,
  .taginput {
    flex: 1;
    min-width: 0;
    padding: 4px 6px;
    border-radius: 6px;
    border: 1px solid var(--line);
    background: var(--bg-elev);
    font-weight: 500;
  }
  .sub {
    font-size: 11px;
    color: var(--fg-faint);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .rm {
    align-self: flex-start;
    font-size: 11px;
    color: var(--fg-faint);
  }
  .foot {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
    margin-top: 14px;
  }
</style>
