<script lang="ts">
  /**
   * Stories of the map (as in TiddlyVisuals' Pinboard): presentation paths
   * whose stops are cards or views. Stops form an outline (indent with Tab);
   * ▶ plays the story full screen. In the wiki each story becomes a story
   * tiddler (`story`, `pinboard-levels`) that the Pinboard shows.
   */
  import { board } from '../state/board.svelte';
  import { wikis } from '../state/wikis.svelte';
  import type { WikiRecipe } from '../backend/types';
  import { liveSteps, STORY_COLORS } from '../core/map';
  import Icon from './Icon.svelte';
  import { t, tn } from '../i18n/index.svelte';

  const m = $derived(board.map);
  const s = $derived(board.story);
  const steps = $derived(m && s ? s.steps : []);
  let renaming = $state(false);
  let dragFrom = $state<number | null>(null);

  const label = (i: number) => {
    const st = steps[i];
    if (st.kind === 'view') return t('board.story.view');
    const c = st.ref ? m?.cards[st.ref] : null;
    return c ? c.title || c.text.slice(0, 40) || t('map.untitled') : t('board.story.gone');
  };

  /** The wikis holding this map: open the one (sync first), choose among several, or make one. */
  let choosing = $state<WikiRecipe[] | null>(null);
  async function openInWiki() {
    const bag = board.mapBag();
    if (!bag) return;
    await wikis.load();
    const list = wikis.recipes.filter((r) => r.bags.includes(bag));
    if (!list.length) wikis.createFor(bag);
    else if (list.length === 1) void wikis.openStory(list[0].name);
    else choosing = choosing ? null : list;
  }

  function stepKey(e: KeyboardEvent, i: number) {
    if (e.key === 'Tab') {
      e.preventDefault();
      board.indent(i, e.shiftKey ? -1 : 1);
    } else if (e.key === 'Delete' || e.key === 'Backspace') board.removeStep(steps[i].id);
  }
</script>

<aside class="stories">
  <div class="head">
    <Icon name="play" size={14} />
    <b>{t('board.story.title')}</b>
    <span class="grow"></span>
    <button class="btn icon" onclick={() => board.toggleStories(false)} aria-label={t('common.close')}><Icon name="x" size={13} /></button>
  </div>
  {#if m}
    <div class="pick">
      {#if renaming && s}
        <!-- svelte-ignore a11y_autofocus -->
        <input value={s.title} autofocus onblur={(e) => ((renaming = false), board.renameStory(e.currentTarget.value))} onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
      {:else}
        <select value={s?.id ?? ''} onchange={(e) => board.setStory(e.currentTarget.value)}>
          {#each m.stories ?? [] as x (x.id)}<option value={x.id}>{x.title}</option>{/each}
          {#if !m.stories?.length}<option value="">Story 1</option>{/if}
        </select>
        <button class="btn icon" title={t('common.rename')} disabled={!s} onclick={() => (renaming = true)}><Icon name="pencil" size={12} /></button>
      {/if}
      <button class="btn icon" title={t('board.story.new')} onclick={() => board.newStory()}><Icon name="plus" size={13} /></button>
      {#if (m.stories?.length ?? 0) > 1}
        <button class="btn icon" title={t('board.story.delete')} onclick={() => board.deleteStory()}><Icon name="trash" size={12} /></button>
      {/if}
    </div>
    {#if s}
      <div class="colors">
        {#each STORY_COLORS as c (c)}
          <button class="sw" class:on={s.color === c} style:background={c} aria-label={c} onclick={() => board.mutate((mm) => (mm.stories!.find((x) => x.id === s.id)!.color = c))}></button>
        {/each}
      </div>
    {/if}
    <div class="adds">
      <button class="btn add" title={t('board.story.addViewHint')} onclick={() => board.addView()}>
        <Icon name="fit" size={12} />{t('board.story.addView')}
      </button>
      <button class="btn add" class:on={board.picking} title={t('board.story.pickHint')} onclick={() => board.pickStop()}>
        <Icon name="pick" size={12} />{board.selection.size ? tn('board.story.addCards', board.selection.size) : board.picking ? t('board.story.pickingShort') : t('board.story.pick')}
      </button>
    </div>
    <ol>
      {#each steps as st, i (st.id)}
        <li
          class:drop={dragFrom !== null && dragFrom !== i}
          style:padding-left="{8 + (st.level ?? 0) * 16}px"
          draggable="false"
        >
          <span
            class="grip"
            role="button"
            tabindex="-1"
            onpointerdown={(e) => {
              e.preventDefault();
              dragFrom = i;
              const up = (ev: PointerEvent) => {
                window.removeEventListener('pointerup', up);
                const li = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>('[data-step]');
                const to = li ? Number(li.dataset.step) : null;
                if (to !== null && dragFrom !== null && to !== dragFrom) board.moveStep(dragFrom, to);
                dragFrom = null;
              };
              window.addEventListener('pointerup', up);
            }}>⋮⋮</span
          >
          <button class="stop" data-step={i} onclick={() => st.ref && board.reveal(st.ref)} onkeydown={(e) => stepKey(e, i)} title={t('board.story.stopHint')}>
            <span class="no" style:background={s?.color}>{i + 1}</span>
            <span class="lbl">{label(i)}</span>
          </button>
          <span class="acts">
            <button class="btn icon" onclick={() => board.indent(i, -1)} aria-label={t('board.story.outdent')}><Icon name="back" size={11} /></button>
            <button class="btn icon" onclick={() => board.indent(i, 1)} aria-label={t('board.story.indent')}><Icon name="forward" size={11} /></button>
            <button class="btn icon" onclick={() => board.present(i)} aria-label={t('board.story.playFrom')}><Icon name="play" size={11} /></button>
            <button class="btn icon" onclick={() => board.removeStep(st.id)} aria-label={t('board.story.remove')}><Icon name="x" size={11} /></button>
          </span>
        </li>
      {:else}
        <li class="none">{t('board.story.none')}</li>
      {/each}
    </ol>
    <button class="btn primary play" disabled={!s || !liveSteps(m, s).length} onclick={() => board.present(0)}>
      <Icon name="play" size={13} />{t('board.story.present')}
    </button>
    <div class="wiki">
      <button class="btn" onclick={openInWiki} title={t('board.story.inWikiHint')}><Icon name="book" size={13} />{t('board.story.inWiki')}</button>
      {#if choosing}
        <div class="choose">
          {#each choosing as w (w.name)}
            <button class="btn" onclick={() => ((choosing = null), wikis.openStory(w.name))}><Icon name="book" size={12} />{w.name}</button>
          {/each}
          <button class="btn" onclick={() => ((choosing = null), wikis.createFor(board.mapBag()))}><Icon name="plus" size={12} />{t('board.story.newWiki')}</button>
        </div>
      {/if}
    </div>
    <p class="hint">{t('board.story.hint')}</p>
  {/if}
</aside>

<style>
  .adds {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .adds .btn {
    flex: 1 1 auto;
    min-width: 0;
  }
  .adds .btn.on {
    background: var(--accent);
    color: #fff;
  }
  .wiki {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .choose {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .stories {
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 290px;
    min-height: 0;
    padding: 10px;
    border-left: 1px solid var(--line);
    background: var(--bg-sunken);
  }
  .head,
  .pick {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
  }
  .grow {
    flex: 1;
  }
  .pick select,
  .pick input {
    flex: 1;
    min-width: 0;
    padding: 4px 6px;
    border-radius: 7px;
    border: 1px solid var(--line);
    background: var(--bg);
    color: var(--fg);
    font: inherit;
  }
  .colors {
    display: flex;
    gap: 5px;
  }
  .sw {
    width: 16px;
    height: 16px;
    border-radius: 50%;
  }
  .sw.on {
    box-shadow:
      0 0 0 2px var(--bg-sunken),
      0 0 0 3.5px var(--fg-muted);
  }
  .add,
  .play {
    gap: 5px;
    justify-content: center;
  }
  ol {
    flex: 1;
    min-height: 0;
    overflow: auto;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  li {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 3px 4px;
    border-radius: 7px;
  }
  li:hover {
    background: var(--bg-elev);
  }
  li.drop:hover {
    box-shadow: inset 0 2px 0 var(--accent);
  }
  .grip {
    cursor: grab;
    color: var(--fg-faint);
    font-size: 11px;
    user-select: none;
  }
  .stop {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 1;
    min-width: 0;
    text-align: left;
    font-size: 13px;
  }
  .no {
    flex: none;
    min-width: 18px;
    height: 18px;
    border-radius: 9px;
    color: #fff;
    font: 600 10px/18px var(--font);
    text-align: center;
  }
  .lbl {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .acts {
    display: none;
  }
  li:hover .acts {
    display: flex;
  }
  .none {
    font-size: 12px;
    color: var(--fg-faint);
  }
  .hint {
    margin: 0;
    font-size: 11px;
    color: var(--fg-faint);
  }
</style>
