<script lang="ts">
  // Quick-tag bar (T): batch-add/remove tags with autocomplete, recent presets and colors.
  import { scale } from 'svelte/transition';
  import type { Entry } from '../core/types';
  import { app } from '../state/app.svelte';
  import { normalizeTag, suggestTags, tagColor, expandTag } from '../core/tags';
  import Icon from './Icon.svelte';
  import { t, tn } from '../i18n/index.svelte';

  let { targets, onclose }: { targets: Entry[]; onclose: () => void } = $props();

  let input = $state('');
  let active = $state(0);
  let inputEl: HTMLInputElement;

  const COLORS = ['#e5484d', '#f76b15', '#e5a50a', '#30a46c', '#0090ff', '#6e56cf', null];

  // Tags shared by all targets vs. present on some.
  const counts = $derived.by(() => {
    const m = new Map<string, number>();
    for (const e of targets) for (const t of e.tags) m.set(t, (m.get(t) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  });

  const query = $derived(input.replace(/^-/, ''));
  const suggestions = $derived(
    suggestTags(query, app.knownTags, app.recentTags, 7).filter((t) => !counts.some(([c, n]) => c === t && n === targets.length))
  );

  $effect(() => {
    inputEl?.focus();
  });

  async function commit(raw: string) {
    const remove = raw.startsWith('-');
    const tag = normalizeTag(remove ? raw.slice(1) : raw);
    if (!tag) return;
    await app.patchMeta(targets, remove ? { removeTags: [tag] } : { addTags: [tag] });
    input = '';
    active = 0;
  }

  function key(e: KeyboardEvent) {
    if (e.key === 'Escape') onclose();
    else if (e.key === 'ArrowDown') {
      active = Math.min(active + 1, suggestions.length - 1);
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      active = Math.max(active - 1, 0);
      e.preventDefault();
    } else if (e.key === 'Enter') {
      const pick = query && suggestions[active] && suggestions[active].toLowerCase().startsWith(query.toLowerCase()) ? suggestions[active] : input;
      commit(input.startsWith('-') ? '-' + pick.replace(/^-/, '') : pick);
    } else if (e.key === 'Tab' && suggestions[active]) {
      input = (input.startsWith('-') ? '-' : '') + suggestions[active];
      e.preventDefault();
    } else if (e.key === 'Backspace' && !input && counts.length) {
      commit('-' + counts[counts.length - 1][0]);
    }
    e.stopPropagation();
  }
</script>

<div class="backdrop" role="presentation" onpointerdown={(e) => e.target === e.currentTarget && onclose()}>
  <div class="bar" transition:scale={{ start: 0.96, duration: 140 }} role="dialog" aria-label={t('files.editTags')}>
    <div class="head">
      <Icon name="tag" size={15} />
      <span>{tn('files.tagFiles', targets.length)}</span>
      <span class="colors">
        {#each COLORS as c (c)}
          <button
            class="swatch"
            class:none={!c}
            style:background={c ?? undefined}
            title={c ? t('files.setColor') : t('files.removeColor')}
            onclick={() => app.patchMeta(targets, { color: c })}
            aria-label={c ?? t('files.noColor')}
          ></button>
        {/each}
      </span>
    </div>

    <div class="field">
      {#each counts as [tag, n] (tag)}
        <span class="chip" class:partial={n < targets.length} title={n < targets.length ? t('files.tagPartial', { n, total: targets.length }) : ''}>
          <span class="dot" style:background={tagColor(tag)}></span>{tag}
          <button onclick={() => commit('-' + tag)} aria-label={t('files.removeTag', { tag })}><Icon name="x" size={10} /></button>
        </span>
      {/each}
      <input
        bind:this={inputEl}
        bind:value={input}
        onkeydown={key}
        placeholder={counts.length ? '' : t('files.tagPlaceholder')}
        spellcheck="false"
      />
    </div>

    {#if suggestions.length}
      <ul class="sugg">
        {#each suggestions as s, i (s)}
          <li>
            <button class:active={i === active} onmouseenter={() => (active = i)} onclick={() => commit(s)}>
              <span class="dot" style:background={tagColor(s)}></span>
              {s}
              {#if s.includes('/')}<span class="anc">{t('files.tagIndexedUnder', { tags: expandTag(s).slice(0, -1).join(', ') })}</span>{/if}
              {#if app.recentTags.includes(s)}<span class="recent">{t('files.tagRecent')}</span>{/if}
            </button>
          </li>
        {/each}
      </ul>
    {/if}
    <div class="foot"><kbd>↵</kbd> {t('files.tagAdd')} · <kbd>-tag</kbd> {t('files.tagRemoveHint')} · <kbd>Tab</kbd> {t('files.tagComplete')} · <kbd>Esc</kbd></div>
  </div>
</div>

<style>
  .backdrop {
    position: absolute;
    inset: 0;
    z-index: 80;
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding-top: 14vh;
    background: rgba(0, 0, 0, 0.12);
  }
  .bar {
    width: min(560px, calc(100% - 32px));
    border-radius: 16px;
    background: var(--bg-elev);
    box-shadow:
      var(--shadow),
      0 0 0 1px var(--line);
    overflow: hidden;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 14px 0;
    color: var(--fg-muted);
    font-weight: 500;
  }
  .colors {
    margin-left: auto;
    display: flex;
    gap: 5px;
  }
  .swatch {
    width: 14px;
    height: 14px;
    border-radius: 50%;
  }
  .swatch.none {
    box-shadow: inset 0 0 0 1.5px var(--fg-faint);
  }
  .field {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    padding: 12px 14px;
  }
  .field .chip {
    height: 24px;
    font-size: 12px;
    color: var(--fg);
  }
  .chip.partial {
    opacity: 0.6;
  }
  .chip button {
    display: grid;
    color: var(--fg-faint);
  }
  .field input {
    flex: 1;
    min-width: 160px;
    border: 0;
    outline: 0;
    background: none;
    font-size: 15px;
    padding: 4px 0;
  }
  .sugg {
    list-style: none;
    margin: 0;
    padding: 4px 6px;
    border-top: 1px solid var(--line);
  }
  .sugg button {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 7px 8px;
    border-radius: 8px;
    text-align: left;
  }
  .sugg button.active {
    background: var(--bg-sunken);
  }
  .anc,
  .recent {
    font-size: 11px;
    color: var(--fg-faint);
  }
  .recent {
    margin-left: auto;
  }
  .foot {
    padding: 8px 14px 10px;
    font-size: 11px;
    color: var(--fg-faint);
    border-top: 1px solid var(--line);
  }
</style>
