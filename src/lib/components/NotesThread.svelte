<script lang="ts">
  /**
   * The project's notes & snippets thread, at the right of the map or Kanban.
   * Snippets sent to the project land here; drag one onto the map (or click
   * "place" for the middle of the view), put cards back here, write notes, or
   * send an item to another project's thread.
   */
  import { app } from '../state/app.svelte';
  import { board } from '../state/board.svelte';
  import { drag } from '../state/drag.svelte';
  import type { NoteCard } from '../core/map';
  import type { Entry } from '../core/types';
  import Icon from './Icon.svelte';
  import { t, tn, loc } from '../i18n/index.svelte';

  let draft = $state('');
  let sending = $state<string | null>(null);
  const others = $derived(app.projects.filter((p) => p.root !== board.root));
  const items = $derived([...board.notes].reverse());

  function add() {
    const text = draft.trim();
    if (!text) return;
    // The first line (or heading) becomes the title.
    const first = text.split('\n')[0].replace(/^#+\s*/, '').trim();
    void board.addNote({ kind: 'note', title: first.slice(0, 80), text });
    draft = '';
  }

  function down(e: PointerEvent, n: NoteCard) {
    if ((e.target as HTMLElement).closest('button, textarea')) return;
    const entry: Entry = { path: n.refs?.[0]?.path ?? '', name: n.title, ext: '', kind: 'file', size: 0, mtime: 0, ctime: 0, tags: [] };
    drag.begin(e, () => [entry], 'notes', undefined, { data: { note: n }, accepts: ['board', 'project', 'kanban'], title: (n.text || n.title).slice(0, 200) });
  }

  const when = (ms: number) => new Date(ms).toLocaleString(loc(), { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
</script>

<aside class="thread" class:hit={drag.active && drag.hit?.kind === 'notes'} data-notes-thread data-drop="notes">
  <div class="head">
    <Icon name="doc" size={14} />
    <b>{t('board.notes.title')}</b>
    <span class="n">{board.notes.length}</span>
    <span class="grow"></span>
    <button class="btn icon" onclick={() => board.toggleNotes(false)} aria-label={t('common.close')}><Icon name="x" size={13} /></button>
  </div>
  <textarea
    bind:value={draft}
    placeholder={t('board.notes.placeholder')}
    rows="2"
    onkeydown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && add()}
  ></textarea>
  {#if draft.trim()}<button class="btn primary addbtn" onclick={add}>{t('board.notes.add')}</button>{/if}
  <p class="hint">{t('board.notes.hint')}</p>
  <ul>
    {#each items as n (n.id)}
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <li class:snippet={n.kind === 'snippet'} style:--c={n.color ?? undefined} onpointerdown={(e) => down(e, n)}>
        {#if n.title && n.title !== n.text}<span class="t">{n.title}</span>{/if}
        <span class="x">{n.kind === 'snippet' ? `„${n.text}“` : n.text}</span>
        <span class="meta">
          {#if n.refs?.[0]?.name}<Icon name={n.refs[0].kind === 'url' ? 'globe' : 'doc'} size={10} />{n.refs[0].name} · {/if}{when(n.at)}
        </span>
        <span class="acts">
          <button class="btn" disabled={!board.map || board.mode !== 'map'} onclick={() => board.placeNote(n.id)} title={t('board.notes.placeHint')}><Icon name="target" size={12} />{t('board.notes.place')}</button>
          {#if others.length}
            <button class="btn icon" class:on={sending === n.id} onclick={() => (sending = sending === n.id ? null : n.id)} title={t('board.notes.send')}><Icon name="forward" size={12} /></button>
          {/if}
          <button class="btn icon" onclick={() => board.removeNote(n.id)} title={t('board.notes.delete')}><Icon name="trash" size={12} /></button>
        </span>
        {#if sending === n.id}
          <span class="send">
            {#each others as p (p.id)}
              <button class="chip" onclick={() => ((sending = null), board.sendNote(n.id, p.root, p.name))}><Icon name="kanban" size={11} />{p.name}</button>
            {/each}
          </span>
        {/if}
      </li>
    {:else}
      <li class="none">{t('board.notes.empty')}</li>
    {/each}
  </ul>
  <p class="foot">{tn('board.notes.count', board.notes.length)}</p>
</aside>

<style>
  .thread {
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: 300px;
    min-height: 0;
    padding: 10px;
    border-left: 1px solid var(--line);
    background: var(--bg-sunken);
  }
  .thread.hit {
    box-shadow: inset 0 0 0 2px var(--accent);
  }
  .head {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
  }
  .n {
    color: var(--fg-faint);
    font-size: 12px;
  }
  .grow {
    flex: 1;
  }
  textarea {
    width: 100%;
    resize: vertical;
    padding: 6px 8px;
    border-radius: 8px;
    border: 1px solid var(--line);
    background: var(--bg);
    color: var(--fg);
    font: inherit;
    font-size: 13px;
  }
  .addbtn {
    align-self: flex-end;
  }
  .hint,
  .foot {
    margin: 0;
    font-size: 11px;
    color: var(--fg-faint);
  }
  ul {
    flex: 1;
    min-height: 0;
    overflow: auto;
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  li {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 8px 10px;
    border-radius: 10px;
    background: var(--bg-elev);
    box-shadow: 0 0 0 1px var(--line);
    border-left: 3px solid var(--c, transparent);
    cursor: grab;
    user-select: none;
  }
  li.snippet .x {
    font-style: italic;
  }
  .t {
    font-weight: 600;
    font-size: 13px;
  }
  .x {
    font-size: 12.5px;
    color: var(--fg-muted);
    white-space: pre-wrap;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 6;
    line-clamp: 6;
    -webkit-box-orient: vertical;
  }
  .meta {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 10.5px;
    color: var(--fg-faint);
  }
  .acts {
    display: flex;
    gap: 4px;
  }
  .acts .btn {
    gap: 4px;
    font-size: 11px;
  }
  .send {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 11px;
    background: var(--bg-sunken);
  }
  .none {
    cursor: default;
    color: var(--fg-faint);
    font-size: 12px;
    background: none;
    box-shadow: none;
  }
</style>
