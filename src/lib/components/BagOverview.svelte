<script lang="ts">
  /**
   * Bag overview: which wikis use which bags (editable matrix), the same as a
   * graph, and one wiki's layers stacked as they are loaded (bottom first, the
   * top wins when titles collide).
   */
  import { scale } from 'svelte/transition';
  import { app } from '../state/app.svelte';
  import { wikis } from '../state/wikis.svelte';
  import type { WikiLayer, WikiRecipe } from '../backend/types';
  import Icon from './Icon.svelte';
  import { t, tn } from '../i18n/index.svelte';

  let { onclose }: { onclose: () => void } = $props();

  type Tab = 'matrix' | 'graph' | 'layers';
  type Kind = 'plugins' | 'local' | 'shared' | 'map' | 'own' | 'unknown';
  type Row = { bag: string; kind: Kind; label: string; sub: string };
  type Draft = { bags: string[]; plugins: boolean; local: boolean };

  let tab = $state<Tab>('matrix');

  /** The wiki's own (writable, top) bag: the last of its bags, as in the core (tw.rs). */
  const ownOf = (w: { name: string; bags?: string[] }) =>
    (w.bags ?? wikis.recipes.find((r) => r.name === w.name)?.bags ?? []).at(-1) ?? `wiki-${w.name}`;

  function name(bag: string): string {
    return bag === '@plugins' ? t('wiki.overview.plugins') : wikis.label(bag);
  }

  function icon(kind: Kind | string) {
    return kind === 'plugins' ? 'gear' : kind === 'local' ? 'home' : kind === 'map' ? 'nodes' : kind === 'own' ? 'book' : 'tray';
  }

  /** Load order of a recipe, bottom first: plugins, shared/map bags, lokal, what came from the web, own bag. */
  function stack(r: Draft & { name: string }): string[] {
    // Same order as Store::layer_names in the core.
    const own = ownOf(r);
    const web = `web-${r.name}`;
    const lower = r.bags.slice(0, -1).filter((b) => b !== '@plugins' && b !== web);
    return [...(r.plugins ? ['@plugins'] : []), ...lower, ...(r.local && !r.bags.includes('lokal') ? ['lokal'] : []), ...(r.bags.includes(web) ? [web] : []), own];
  }

  // ---------- matrix ----------

  let draft = $state<Record<string, Draft>>({});
  let saving = $state(false);

  const eff = (w: WikiRecipe): Draft & { name: string } => ({ name: w.name, ...(draft[w.name] ?? { bags: w.bags, plugins: w.plugins, local: w.local ?? false }) });
  const stacks = $derived(Object.fromEntries(wikis.recipes.map((w) => [w.name, stack(eff(w))])));
  const changed = $derived(Object.keys(draft).length);

  const rows = $derived.by(() => {
    const owns = new Set(wikis.recipes.map(ownOf));
    const out: Row[] = [
      { bag: '@plugins', kind: 'plugins', label: name('@plugins'), sub: t('wiki.overview.builtin') },
      {
        bag: 'lokal',
        kind: 'local',
        label: 'lokal',
        sub: [wikis.bags.find((b) => b.name === 'lokal') ? tn('wiki.tiddlers', wikis.bags.find((b) => b.name === 'lokal')!.tiddlers) : '', t('wiki.overview.localSub')]
          .filter(Boolean)
          .join(' · ')
      }
    ];
    for (const b of wikis.bags)
      if (b.name !== 'lokal' && !owns.has(b.name))
        out.push({ bag: b.name, kind: 'shared', label: b.name, sub: tn('wiki.tiddlers', b.tiddlers) + (b.readonly ? ' · ' + t('wiki.readonlyBag') : '') });
    for (const m of wikis.maps) out.push({ bag: m.bag, kind: 'map', label: m.title, sub: `${t('wiki.overview.map')} · ${m.project}` });
    for (const w of wikis.recipes) {
      const b = wikis.bags.find((x) => x.name === ownOf(w));
      out.push({ bag: ownOf(w), kind: 'own', label: ownOf(w), sub: (b ? tn('wiki.tiddlers', b.tiddlers) + ' · ' : '') + t('wiki.overview.ownOf', { wiki: w.name }) });
    }
    const known = new Set(out.map((r) => r.bag));
    for (const s of Object.values(stacks))
      for (const b of s)
        if (!known.has(b)) {
          known.add(b);
          out.push({ bag: b, kind: b.startsWith('@map:') ? 'map' : 'unknown', label: name(b), sub: t('wiki.overview.unknown') });
        }
    return out;
  });

  function overlaysIn(w: WikiRecipe, bag: string) {
    let n = 0;
    for (const o of wikis.overlays) if (o.bag === bag) n += o.variants.filter((v) => v.recipe === w.name).length;
    return n;
  }

  function toggle(w: WikiRecipe, bag: string) {
    const cur = eff(w);
    const own = ownOf(w);
    const next: Draft = { bags: [...cur.bags], plugins: cur.plugins, local: cur.local };
    if (bag === '@plugins') next.plugins = !cur.plugins;
    else if (bag === 'lokal') next.local = !cur.local;
    else if (cur.bags.includes(bag)) next.bags = cur.bags.filter((b) => b !== bag);
    else next.bags = [...cur.bags.filter((b) => b !== own), bag, ...(cur.bags.includes(own) ? [own] : [])];
    const same = next.plugins === w.plugins && next.local === (w.local ?? false) && next.bags.join('\n') === w.bags.join('\n');
    const d = { ...draft };
    if (same) delete d[w.name];
    else d[w.name] = next;
    draft = d;
  }

  async function save() {
    if (saving) return;
    saving = true;
    try {
      for (const [n, d] of Object.entries($state.snapshot(draft))) {
        const w = wikis.recipes.find((r) => r.name === n);
        if (w) await wikis.save({ ...$state.snapshot(w), ...d }, n);
      }
      draft = {};
    } catch (e) {
      app.toast(String(e).replace(/^Error: /, ''), true);
    } finally {
      saving = false;
    }
  }

  // ---------- graph ----------

  const GW = 860;
  const RH = 30;
  const NW = 230;
  let hover = $state<{ bag?: string; wiki?: string } | null>(null);

  const graph = $derived.by(() => {
    const used = rows.filter((r) => wikis.recipes.some((w) => stacks[w.name]?.includes(r.bag)));
    const h = Math.max(used.length, wikis.recipes.length) * RH + 20;
    const offB = (h - used.length * RH) / 2;
    const offW = (h - wikis.recipes.length * RH) / 2;
    const bags = used.map((r, i) => ({ ...r, y: offB + i * RH + RH / 2 }));
    const ws = wikis.recipes.map((w, i) => ({ name: w.name, y: offW + i * RH + RH / 2 }));
    const edges = [];
    for (const w of ws) {
      const s = stacks[w.name] ?? [];
      for (const [p, bag] of s.entries()) {
        const b = bags.find((x) => x.bag === bag);
        if (b) edges.push({ bag, wiki: w.name, pos: p + 1, total: s.length, y1: b.y, y2: w.y });
      }
    }
    return { h, bags, ws, edges };
  });

  const x1 = NW + 10;
  const x2 = GW - NW - 10;
  const mx = (x1 + x2) / 2;
  const curve = (e: { y1: number; y2: number }) => `M${x1} ${e.y1} C${mx} ${e.y1} ${mx} ${e.y2} ${x2} ${e.y2}`;
  /** A point on the curve near the wiki end, for the position label. */
  function labelAt(e: { y1: number; y2: number }) {
    const s = 0.84;
    const u = 1 - s;
    const x = u ** 3 * x1 + 3 * u * u * s * mx + 3 * u * s * s * mx + s ** 3 * x2;
    const y = u ** 3 * e.y1 + 3 * u * u * s * e.y1 + 3 * u * s * s * e.y2 + s ** 3 * e.y2;
    return { x, y };
  }
  const active = (e: { bag: string; wiki: string }) => !!hover && (hover.bag === e.bag || hover.wiki === e.wiki);
  const bagLit = (bag: string) => !!hover && (hover.bag === bag || graph.edges.some((e) => e.bag === bag && active(e)));
  const wikiLit = (wiki: string) => !!hover && (hover.wiki === wiki || graph.edges.some((e) => e.wiki === wiki && active(e)));
  const trunc = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

  // ---------- layers ----------

  let wikiSel = $state(wikis.recipes[0]?.name ?? '');
  let layers = $state<WikiLayer[] | null>(null);
  let layerError = $state('');
  let query = $state('');
  let picked = $state<number | null>(null);
  let filter = $state('');

  $effect(() => {
    const n = wikiSel;
    void wikis.recipes;
    if (tab !== 'layers' || !n) return;
    let live = true;
    layers = null;
    layerError = '';
    picked = null;
    app.backend
      .wikiLayers(n)
      .then((l) => live && (layers = l))
      .catch((e) => live && (layerError = String(e).replace(/^Error: /, '')));
    return () => {
      live = false;
    };
  });

  /** Title → indices of the layers that contain it (ascending). */
  const index = $derived.by(() => {
    const m = new Map<string, number[]>();
    for (const [i, l] of (layers ?? []).entries())
      for (const title of new Set(l.titles)) {
        const a = m.get(title);
        if (a) a.push(i);
        else m.set(title, [i]);
      }
    return m;
  });

  const stats = $derived(
    (layers ?? []).map((l, i) => {
      let hidden = 0;
      let hides = 0;
      const set = new Set(l.titles);
      for (const title of set) {
        const a = index.get(title)!;
        if (a[a.length - 1] > i) hidden++;
        if (a[0] < i) hides++;
      }
      return { count: set.size, hidden, hides };
    })
  );

  const suggestions = $derived.by(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const out: string[] = [];
    for (const title of index.keys()) {
      if (title.toLowerCase().includes(q) && title !== query) out.push(title);
      if (out.length >= 60) break;
    }
    return out.sort((a, b) => a.localeCompare(b));
  });

  const hit = $derived.by(() => {
    const q = query.trim();
    if (!q) return null;
    const exact = index.get(q);
    if (exact) return exact;
    const lower = q.toLowerCase();
    for (const [title, a] of index) if (title.toLowerCase() === lower) return a;
    return [];
  });

  const pickedTitles = $derived.by(() => {
    if (picked === null || !layers?.[picked]) return [];
    const f = filter.trim().toLowerCase();
    return [...new Set(layers[picked].titles)]
      .filter((x) => !f || x.toLowerCase().includes(f))
      .sort((a, b) => a.localeCompare(b))
      .map((title) => {
        const a = index.get(title)!;
        return { title, hidden: a[a.length - 1] > (picked ?? 0) };
      });
  });

  const kindOf = (bag: string): Kind =>
    bag === '@plugins' ? 'plugins' : bag === 'lokal' ? 'local' : bag.startsWith('@map:') ? 'map' : bag === ownOf({ name: wikiSel }) ? 'own' : 'shared';
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />

<div class="backdrop" role="presentation" onpointerdown={(e) => e.target === e.currentTarget && onclose()}>
  <div class="panel" transition:scale={{ start: 0.96, duration: 140 }} role="dialog" aria-label={t('wiki.overview.title')}>
    <div class="head">
      <Icon name="grid" size={16} />
      <b>{t('wiki.overview.title')}</b>
      <span class="muted">{t('wiki.overview.intro')}</span>
      <span class="grow"></span>
      <div class="seg">
        {#each [['matrix', 'grid'], ['graph', 'nodes'], ['layers', 'layers']] as [k, ic] (k)}
          <button class="btn" class:on={tab === k} onclick={() => (tab = k as Tab)}><Icon name={ic} size={12} />{t(`wiki.overview.${k}`)}</button>
        {/each}
      </div>
      <button class="btn icon" onclick={onclose} aria-label={t('common.close')}><Icon name="x" size={14} /></button>
    </div>

    {#if !wikis.recipes.length}
      <p class="empty">{t('wiki.overview.empty')}</p>
    {:else if tab === 'matrix'}
      <div class="scroll">
        <table class="matrix">
          <thead>
            <tr>
              <th class="rowhead">{t('wiki.overview.bag')}</th>
              {#each wikis.recipes as w (w.name)}
                <th class="col" class:dirty={draft[w.name]}>
                  <button class="wname" title={w.name} onclick={() => wikis.open(w.name)}><Icon name="book" size={12} />{w.name}</button>
                </th>
              {/each}
            </tr>
          </thead>
          <tbody>
            {#each rows as row (row.bag)}
              <tr>
                <th class="rowhead">
                  <span class="bagname"><Icon name={icon(row.kind)} size={13} /><span class="lbl" title={row.bag}>{row.label}</span></span>
                  <span class="sub">{row.sub}</span>
                </th>
                {#each wikis.recipes as w (w.name)}
                  {@const s = stacks[w.name] ?? []}
                  {@const pos = s.indexOf(row.bag)}
                  {@const fixed = row.bag === ownOf(w)}
                  {@const ov = overlaysIn(w, row.bag)}
                  <td class:on={pos >= 0}>
                    <label
                      class="cell"
                      title={fixed
                        ? t('wiki.overview.fixed')
                        : pos >= 0
                          ? t('wiki.overview.remove', { bag: row.label, wiki: w.name }) + '\n' + t('wiki.overview.position', { n: pos + 1, total: s.length })
                          : t('wiki.overview.add', { bag: row.label, wiki: w.name })}
                    >
                      <input type="checkbox" checked={pos >= 0} disabled={fixed} onchange={() => toggle(w, row.bag)} />
                      {#if pos >= 0}<span class="pos">{pos + 1}</span>{/if}
                      {#if ov}<span class="badge" title={tn('wiki.overview.overlays', ov)}>{ov}</span>{/if}
                    </label>
                  </td>
                {/each}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <div class="foot">
        <span class="muted">{t('wiki.overview.matrixNote')}</span>
        <span class="grow"></span>
        {#if changed}
          <span class="muted">{tn('wiki.overview.changed', changed)}</span>
          <button class="btn" onclick={() => (draft = {})}>{t('wiki.overview.reset')}</button>
        {/if}
        <button class="btn primary" disabled={!changed || saving} onclick={save}>{t('common.save')}</button>
      </div>
    {:else if tab === 'graph'}
      <div class="scroll">
        <svg class="graph" viewBox="0 0 {GW} {graph.h}" width="100%" style:max-width="{GW}px" role="img" aria-label={t('wiki.overview.graph')}>
          {#each graph.edges as e (e.bag + '\u0000' + e.wiki)}
            <path class="edge" class:lit={active(e)} class:dim={hover && !active(e)} d={curve(e)} stroke-width={1 + (2.5 * e.pos) / e.total} />
          {/each}
          {#each graph.edges as e (e.bag + '\u0000' + e.wiki)}
            {@const p = labelAt(e)}
            <g class="plabel" class:lit={active(e)} class:dim={hover && !active(e)}>
              <circle cx={p.x} cy={p.y} r="8" />
              <text x={p.x} y={p.y} dy="0.34em" text-anchor="middle">{e.pos}</text>
            </g>
          {/each}
          {#each graph.bags as b (b.bag)}
            {@const n = graph.edges.filter((e) => e.bag === b.bag).length}
            <g
              class="node"
              class:lit={bagLit(b.bag)}
              class:dim={hover && !bagLit(b.bag)}
              role="presentation"
              onpointerenter={() => (hover = { bag: b.bag })}
              onpointerleave={() => (hover = null)}
            >
              <title>{b.label} · {b.sub} · {tn('wiki.overview.uses', n)}</title>
              <rect x="10" y={b.y - RH / 2 + 3} width={NW} height={RH - 6} rx="7" />
              <text x="20" y={b.y} dy="0.34em">{trunc(b.label, 30)}</text>
              <text class="n" x={NW} y={b.y} dy="0.34em" text-anchor="end">{n}</text>
            </g>
          {/each}
          {#each graph.ws as w (w.name)}
            <g
              class="node wiki"
              class:lit={wikiLit(w.name)}
              class:dim={hover && !wikiLit(w.name)}
              role="presentation"
              onpointerenter={() => (hover = { wiki: w.name })}
              onpointerleave={() => (hover = null)}
            >
              <title>{w.name}</title>
              <rect x={x2} y={w.y - RH / 2 + 3} width={NW} height={RH - 6} rx="7" />
              <text x={x2 + 10} y={w.y} dy="0.34em">{trunc(w.name, 30)}</text>
            </g>
          {/each}
        </svg>
      </div>
      <div class="foot"><span class="muted">{t('wiki.overview.graphNote')}</span></div>
    {:else}
      <div class="lhead">
        <select bind:value={wikiSel}>
          {#each wikis.recipes as w (w.name)}<option value={w.name}>{w.name}</option>{/each}
        </select>
        <input class="grow search" list="bag-overview-titles" bind:value={query} placeholder={t('wiki.overview.search')} />
        <datalist id="bag-overview-titles">
          {#each suggestions as s (s)}<option value={s}></option>{/each}
        </datalist>
        {#if hit && !hit.length}<span class="muted">{t('wiki.overview.notFound')}</span>{/if}
      </div>
      {#if layerError}
        <p class="err">{layerError}</p>
      {:else if !layers}
        <p class="empty">{t('wiki.overview.loading')}</p>
      {:else}
        <div class="lbody">
          <div class="stack">
            <div class="edge-note">▲ {t('wiki.overview.winsTop')}</div>
            {#each [...layers.keys()].reverse() as i (i)}
              {@const l = layers[i]}
              {@const st = stats[i]}
              {@const has = !!hit?.includes(i)}
              {@const win = has && hit![hit!.length - 1] === i}
              <button class="slab" class:picked={picked === i} class:has class:win class:lost={has && !win} class:faded={hit && hit.length && !has} onclick={() => ((picked = i), (filter = ''))}>
                <span class="lnum">{i + 1}</span>
                <Icon name={icon(kindOf(l.bag))} size={14} />
                <span class="lname" title={l.bag}>{name(l.bag)}</span>
                {#if win}<span class="tag win">{t('wiki.overview.wins')}</span>{:else if has}<span class="tag lost">{t('wiki.overview.hidden')}</span>{/if}
                <span class="grow"></span>
                <span class="stat">{tn('wiki.tiddlers', st.count)}</span>
                {#if st.hidden}<span class="stat warn">{t('wiki.overview.hiddenBy', { n: st.hidden })}</span>{/if}
                {#if st.hides}<span class="stat">{t('wiki.overview.hides', { n: st.hides })}</span>{/if}
                <span class="bar" aria-hidden="true"><span style:width="{st.count ? ((st.count - st.hidden) / st.count) * 100 : 0}%"></span></span>
              </button>
            {/each}
            <div class="edge-note">▼ {t('wiki.overview.loadedFirst')}</div>
          </div>
          <div class="titles">
            {#if picked !== null && layers[picked]}
              <div class="sec"><Icon name={icon(kindOf(layers[picked].bag))} size={12} /> {name(layers[picked].bag)}</div>
              <input bind:value={filter} placeholder={t('wiki.overview.filter')} />
              <ul>
                {#each pickedTitles as x (x.title)}
                  <li>
                    <button class:hidden={x.hidden} onclick={() => (query = x.title)}>
                      <span class="tt">{x.title}</span>
                      {#if x.hidden}<span class="tag lost">{t('wiki.overview.hidden')}</span>{/if}
                    </button>
                  </li>
                {:else}
                  <li class="muted">{t('wiki.overview.noTitles')}</li>
                {/each}
              </ul>
            {:else}
              <p class="muted">{t('wiki.overview.pickLayer')}</p>
            {/if}
          </div>
        </div>
      {/if}
    {/if}
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
    width: min(1080px, calc(100% - 32px));
    height: min(720px, calc(100% - 48px));
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 16px;
    border-radius: 16px;
    background: var(--bg-elev);
    box-shadow:
      var(--shadow),
      0 0 0 1px var(--line);
  }
  .head,
  .foot,
  .lhead {
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
  .seg {
    display: flex;
    gap: 2px;
  }
  .seg .btn {
    gap: 5px;
  }
  .empty {
    flex: 1;
    display: grid;
    place-items: center;
    color: var(--fg-muted);
  }
  .err {
    color: #b91c1c;
    font-size: 12px;
  }
  .scroll {
    flex: 1;
    min-height: 0;
    overflow: auto;
    border-radius: 10px;
    background: var(--bg);
    box-shadow: inset 0 0 0 1px var(--line);
  }
  .badge {
    font-size: 10px;
    min-width: 16px;
    padding: 0 5px;
    border-radius: 8px;
    background: var(--attr-soft, var(--accent-soft));
    color: var(--attr, var(--accent));
    text-align: center;
  }

  /* matrix */
  .matrix {
    border-collapse: separate;
    border-spacing: 0;
    font-size: 12px;
  }
  .matrix th,
  .matrix td {
    border-bottom: 1px solid var(--line);
    padding: 4px 8px;
  }
  .matrix thead th {
    position: sticky;
    top: 0;
    z-index: 2;
    background: var(--bg-elev);
  }
  .matrix .rowhead {
    position: sticky;
    left: 0;
    z-index: 1;
    min-width: 220px;
    max-width: 280px;
    background: var(--bg-elev);
    text-align: left;
    font-weight: 400;
    border-right: 1px solid var(--line);
  }
  .matrix thead .rowhead {
    z-index: 3;
    font-weight: 600;
    color: var(--fg-faint);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-size: 11px;
  }
  .col.dirty .wname {
    color: var(--accent);
  }
  .wname {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    max-width: 130px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
  }
  .wname:hover {
    color: var(--accent);
  }
  .bagname {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .lbl {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sub {
    display: block;
    margin-left: 19px;
    font-size: 11px;
    color: var(--fg-faint);
  }
  .matrix td {
    text-align: center;
  }
  .matrix td.on {
    background: var(--accent-soft);
  }
  .cell {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-height: 22px;
    cursor: pointer;
  }
  .pos {
    min-width: 12px;
    font-family: var(--mono);
    font-size: 11px;
    color: var(--accent);
  }

  /* graph */
  .graph {
    display: block;
    margin: 0 auto;
    font-size: 12px;
  }
  .edge {
    fill: none;
    stroke: var(--fg-faint);
    opacity: 0.55;
    transition: opacity 0.12s;
  }
  .edge.lit {
    stroke: var(--accent);
    opacity: 1;
  }
  .edge.dim,
  .plabel.dim {
    opacity: 0.12;
  }
  .plabel circle {
    fill: var(--bg);
    stroke: var(--line);
  }
  .plabel text {
    fill: var(--fg-muted);
    font-size: 10px;
    font-family: var(--mono);
  }
  .plabel.lit circle {
    stroke: var(--accent);
  }
  .plabel.lit text {
    fill: var(--accent);
  }
  .node {
    cursor: default;
    transition: opacity 0.12s;
  }
  .node rect {
    fill: var(--bg-sunken);
    stroke: var(--line);
  }
  .node text {
    fill: var(--fg);
  }
  .node text.n {
    fill: var(--fg-faint);
    font-size: 11px;
  }
  .node.wiki rect {
    fill: var(--bg-elev);
  }
  .node.lit rect {
    fill: var(--accent-soft);
    stroke: var(--accent);
  }
  .node.dim {
    opacity: 0.4;
  }

  /* layers */
  select,
  .lhead input,
  .titles input {
    height: 28px;
    padding: 0 8px;
    border-radius: 7px;
    border: 1px solid var(--line);
    background: var(--bg);
    color: var(--fg);
  }
  .lbody {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: 1fr 300px;
    gap: 16px;
  }
  .stack {
    display: flex;
    flex-direction: column;
    gap: 6px;
    overflow: auto;
    padding: 2px 4px 4px;
  }
  .edge-note {
    font-size: 11px;
    color: var(--fg-faint);
    text-align: center;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .slab {
    position: relative;
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    padding: 10px 12px 12px;
    border-radius: 9px;
    background: var(--bg-sunken);
    box-shadow:
      0 0 0 1px var(--line),
      0 3px 0 var(--line);
    text-align: left;
    transition: opacity 0.12s;
  }
  .slab:hover {
    box-shadow:
      0 0 0 1px var(--fg-faint),
      0 3px 0 var(--line);
  }
  .slab.picked {
    box-shadow:
      0 0 0 2px var(--accent),
      0 3px 0 var(--line);
  }
  .slab.has {
    background: var(--bg-elev);
  }
  .slab.win {
    background: var(--accent-soft);
    box-shadow:
      0 0 0 2px var(--accent),
      0 3px 0 var(--line);
  }
  .slab.lost .lname {
    text-decoration: line-through;
    text-decoration-color: var(--fg-faint);
  }
  .slab.faded {
    opacity: 0.45;
  }
  .lnum {
    min-width: 18px;
    font-family: var(--mono);
    font-size: 11px;
    color: var(--fg-faint);
  }
  .lname {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 280px;
  }
  .stat {
    font-size: 11px;
    color: var(--fg-muted);
  }
  .stat.warn {
    color: var(--attr, var(--fg-muted));
  }
  .tag {
    font-size: 10px;
    padding: 0 6px;
    border-radius: 8px;
  }
  .tag.win {
    background: var(--accent);
    color: var(--bg);
  }
  .tag.lost {
    background: var(--bg-sunken);
    color: var(--fg-faint);
    box-shadow: inset 0 0 0 1px var(--line);
  }
  .bar {
    position: absolute;
    left: 12px;
    right: 12px;
    bottom: 4px;
    height: 3px;
    border-radius: 2px;
    background: var(--line);
    overflow: hidden;
  }
  .bar span {
    display: block;
    height: 100%;
    background: var(--accent);
  }
  .titles {
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding-left: 12px;
    border-left: 1px solid var(--line);
  }
  .titles .sec {
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 600;
  }
  .titles ul {
    flex: 1;
    min-height: 0;
    margin: 0;
    padding: 0;
    list-style: none;
    overflow: auto;
  }
  .titles li button {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 3px 6px;
    border-radius: 6px;
    text-align: left;
    font-size: 12px;
  }
  .titles li button:hover {
    background: var(--bg-sunken);
  }
  .titles li button.hidden .tt {
    color: var(--fg-faint);
  }
  .tt {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
