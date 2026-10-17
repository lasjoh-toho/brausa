<script lang="ts">
  /**
   * Overlays (MultiWikiServer-style): a wiki's own bag covers a tiddler of a
   * shared bag. Here they are compared and resolved: take a wiki's version for
   * everyone, merge by hand, drop it, or keep it as a deliberate variant.
   */
  import { scale } from 'svelte/transition';
  import { wikis } from '../state/wikis.svelte';
  import { changedFields, lineDiff } from '../core/diff';
  import Icon from './Icon.svelte';

  let { onclose }: { onclose: () => void } = $props();

  let sel = $state<string | null>(null);
  let variant = $state<string | null>(null);
  let merging = $state<string | null>(null);
  let showKept = $state(false);

  const key = (o: { bag: string; title: string }) => `${o.bag}\u0000${o.title}`;
  const list = $derived(wikis.overlays.filter((o) => showKept || o.variants.some((v) => !v.kept)));
  const current = $derived(list.find((o) => key(o) === sel) ?? list[0] ?? null);
  const v = $derived(current?.variants.find((x) => x.recipe === variant) ?? current?.variants[0] ?? null);
  const diff = $derived(current && v ? lineDiff(current.base.text ?? '', v.fields.text ?? '') : []);
  const fields = $derived(current && v ? changedFields(current.base, v.fields) : []);
  const writable = $derived(!!current && !current.bag.startsWith('@') && !wikis.bags.find((b) => b.name === current.bag)?.readonly);
  const identical = $derived(wikis.overlays.reduce((n, o) => n + o.variants.filter((x) => x.identical).length, 0));

  function pick(o: (typeof list)[number]) {
    sel = key(o);
    variant = null;
    merging = null;
  }

  async function promote(all: boolean) {
    if (!current || !v) return;
    await wikis.resolve(current, { action: 'promote', recipe: v.recipe, all });
    variant = null;
  }

  async function merge() {
    if (!current || merging === null) return;
    await wikis.resolve(current, { action: 'merge', text: merging });
    merging = null;
  }
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />

<div class="backdrop" role="presentation" onpointerdown={(e) => e.target === e.currentTarget && onclose()}>
  <div class="panel" transition:scale={{ start: 0.96, duration: 140 }} role="dialog" aria-label="Überdeckungen">
    <div class="head">
      <Icon name="layers" size={16} />
      <b>Überdeckungen</b>
      <span class="muted">Ein Wiki hat einen Tiddler eines gemeinsamen Bags in seinem eigenen Bag überschrieben.</span>
      <span class="grow"></span>
      <label class="muted"><input type="checkbox" bind:checked={showKept} /> behaltene zeigen</label>
      {#if identical}
        <button class="btn" onclick={() => wikis.discardIdentical()} title="Überdeckungen, die sich nur im Datum unterscheiden">
          {identical} gleiche verwerfen
        </button>
      {/if}
      <button class="btn icon" onclick={onclose} aria-label="Schließen"><Icon name="x" size={14} /></button>
    </div>

    {#if !list.length}
      <p class="empty">Keine offenen Überdeckungen. Alles einheitlich.</p>
    {:else}
      <div class="body">
        <ul class="list">
          {#each list as o (key(o))}
            <li>
              <button class:on={current && key(o) === key(current)} onclick={() => pick(o)}>
                <span class="t">{o.title}</span>
                <span class="sub">
                  {wikis.label(o.bag)} · {o.variants.length}
                  {o.variants.length === 1 ? 'Wiki' : 'Wikis'}
                  {#if o.variants.every((x) => x.identical)}<span class="badge">gleich</span>{/if}
                  {#if o.variants.some((x) => x.kept)}<span class="badge">behalten</span>{/if}
                </span>
              </button>
            </li>
          {/each}
        </ul>

        {#if current && v}
          <div class="detail">
            <div class="tabs">
              <span class="muted">Fassung aus</span>
              {#each current.variants as x (x.recipe)}
                <button class="btn" class:on={x.recipe === v.recipe} onclick={() => ((variant = x.recipe), (merging = null))}>
                  <Icon name="book" size={12} />{x.recipe}{x.kept ? ' ✓' : ''}
                </button>
              {/each}
            </div>

            {#if merging !== null}
              <div class="sec">Zusammengeführter Text für „{current.bag}“ (ersetzt alle Fassungen)</div>
              <textarea bind:value={merging} rows="14"></textarea>
              <div class="actions">
                <button class="btn" onclick={() => (merging = null)}>Abbrechen</button>
                <button class="btn primary" onclick={merge}>In „{current.bag}“ speichern</button>
              </div>
            {:else}
              <div class="sec">
                <span class="del">gemeinsam ({wikis.label(current.bag)})</span> → <span class="add">Wiki „{v.recipe}“</span>
                {#if v.identical}<span class="badge">nur das Datum unterscheidet sich</span>{/if}
              </div>
              {#if fields.length}
                <div class="fields">
                  {#each fields as f (f)}
                    <div><b>{f}</b>: <span class="del">{current.base[f] ?? '—'}</span> → <span class="add">{v.fields[f] ?? '—'}</span></div>
                  {/each}
                </div>
              {/if}
              <pre class="diff">{#each diff as l, i (i)}<div class={l.op}>{l.op === 'add' ? '+ ' : l.op === 'del' ? '− ' : '  '}{l.text}</div>{/each}</pre>

              <div class="actions">
                <button class="btn" title="Die Fassung des Wikis löschen; es bekommt wieder die gemeinsame" onclick={() => wikis.resolve(current, { action: 'discard', recipe: v.recipe })}>
                  <Icon name="trash" size={13} /> Verwerfen
                </button>
                <button
                  class="btn"
                  title="Als eigene Variante dieses Wikis behalten und nicht mehr nachfragen"
                  onclick={() => wikis.resolve(current, { action: 'keep', recipe: v.recipe, keep: !v.kept })}
                >
                  {v.kept ? 'Nicht mehr behalten' : 'Als Variante behalten'}
                </button>
                <span class="grow"></span>
                {#if writable}
                  <button class="btn" onclick={() => (merging = v.fields.text ?? '')}><Icon name="pencil" size={13} /> Zusammenführen …</button>
                  {#if current.variants.length > 1}
                    <button class="btn" onclick={() => promote(false)} title="Nur dieses Wiki gibt seine Fassung ab; die anderen behalten ihre">Übernehmen</button>
                  {/if}
                  <button class="btn primary" onclick={() => promote(true)} title="Wird die gemeinsame Fassung; alle Überdeckungen dieses Tiddlers entfallen">
                    Für alle übernehmen
                  </button>
                {:else}
                  <span class="muted">„{current.bag}“ ist schreibgeschützt.</span>
                {/if}
              </div>
            {/if}
          </div>
        {/if}
      </div>
    {/if}
    <p class="muted foot">Änderungen erreichen die Wikis beim nächsten Abgleich (↻).</p>
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
    width: min(1040px, calc(100% - 32px));
    height: min(680px, calc(100% - 48px));
    display: flex;
    flex-direction: column;
    padding: 16px;
    border-radius: 16px;
    background: var(--bg-elev);
    box-shadow:
      var(--shadow),
      0 0 0 1px var(--line);
  }
  .head,
  .tabs,
  .actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .grow {
    flex: 1;
  }
  .muted {
    color: var(--fg-faint);
    font-size: 12px;
  }
  .body {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: 260px 1fr;
    gap: 16px;
    margin-top: 12px;
  }
  .list {
    margin: 0;
    padding: 0;
    list-style: none;
    overflow: auto;
    border-right: 1px solid var(--line);
    padding-right: 8px;
  }
  .list button {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    width: 100%;
    padding: 6px 8px;
    border-radius: 7px;
    text-align: left;
  }
  .list button:hover,
  .list button.on {
    background: var(--bg-sunken);
  }
  .t {
    font-weight: 600;
  }
  .sub {
    font-size: 11px;
    color: var(--fg-faint);
  }
  .badge {
    margin-left: 4px;
    font-size: 10px;
    padding: 0 6px;
    border-radius: 8px;
    background: var(--accent-soft);
    color: var(--accent);
  }
  .detail {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
    overflow: auto;
  }
  .sec {
    font-size: 12px;
    color: var(--fg-muted);
  }
  .fields {
    font-size: 12px;
    font-family: var(--mono);
  }
  .diff {
    flex: 1;
    min-height: 120px;
    margin: 0;
    padding: 8px;
    overflow: auto;
    border-radius: 8px;
    background: var(--bg-sunken);
    font-family: var(--mono);
    font-size: 12px;
    line-height: 1.5;
    white-space: pre-wrap;
    -webkit-user-select: text;
    user-select: text;
  }
  .diff .add,
  .add {
    color: #15803d;
  }
  .diff .add {
    background: rgba(34, 197, 94, 0.12);
  }
  .diff .del,
  .del {
    color: #b91c1c;
  }
  .diff .del {
    background: rgba(239, 68, 68, 0.1);
    text-decoration: line-through;
  }
  textarea {
    flex: 1;
    min-height: 200px;
    padding: 8px;
    border-radius: 8px;
    border: 1px solid var(--line);
    background: var(--bg);
    color: var(--fg);
    font-family: var(--mono);
    font-size: 12px;
  }
  .empty {
    flex: 1;
    display: grid;
    place-items: center;
    color: var(--fg-muted);
  }
  .foot {
    margin: 10px 0 0;
  }
</style>
