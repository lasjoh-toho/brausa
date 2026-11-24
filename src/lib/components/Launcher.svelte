<script lang="ts">
  /** A program tab: its aliases as large buttons. Click starts, files dropped on one open with it, dragging sorts or moves to another tab. */
  import type { Entry } from '../core/types';
  import type { Alias, LauncherTab } from '../core/launcher';
  import { app } from '../state/app.svelte';
  import { apps } from '../state/apps.svelte';
  import { drag } from '../state/drag.svelte';
  import { launcher } from '../state/launcher.svelte';
  import Icon from './Icon.svelte';
  import { t } from '../i18n/index.svelte';

  let { tab }: { tab: LauncherTab } = $props();

  let query = $state('');
  let picking = $state(false);
  $effect(() => {
    if (picking) void apps.load();
  });
  const matches = $derived.by(() => {
    const q = query.trim().toLowerCase();
    const list = apps.list.filter((a) => !tab.aliases.some((x) => x.path === a.path));
    return (q ? list.filter((a) => a.name.toLowerCase().includes(q)) : list).slice(0, 40);
  });

  function hue(name: string) {
    let h = 0;
    for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
    return h;
  }

  function entryOf(a: Alias): Entry {
    return { path: a.path, name: a.name, ext: 'app', kind: 'file', size: 0, mtime: 0, ctime: 0, tags: [] };
  }

  function launch(a: Alias) {
    void apps.launch({ path: a.path, name: a.name, categories: [], exts: [], kinds: [] });
  }

  function pick(path: string, name: string) {
    launcher.drop({ path, name }, tab.id);
    query = '';
    picking = false;
  }

  const over = (a: Alias) => drag.active && drag.hit?.kind === 'appalias' && drag.hit.path === a.path;
</script>

<section class="launcher" data-drop="apptab" data-key={tab.id}>
  <header>
    <h2>{tab.name}</h2>
    <div class="adder">
      <input
        bind:value={query}
        placeholder={t('launcher.addProgram')}
        onfocus={() => (picking = true)}
        onblur={() => setTimeout(() => (picking = false), 150)}
        onkeydown={(e) => {
          if (e.key === 'Enter' && matches[0]) pick(matches[0].path, matches[0].name);
          if (e.key === 'Escape') (e.currentTarget as HTMLInputElement).blur();
        }}
      />
      {#if picking}
        <div class="pick">
          {#each matches as a (a.path)}
            <button onmousedown={(e) => e.preventDefault()} onclick={() => pick(a.path, a.name)}>{a.name}</button>
          {:else}
            <div class="none">{apps.loading ? t('apps.loading') : t('launcher.noMatch')}</div>
          {/each}
        </div>
      {/if}
    </div>
  </header>

  {#if tab.aliases.length}
    <div class="grid">
      {#each tab.aliases as a (a.path)}
        <div
          class="alias"
          class:hit={over(a)}
          role="button"
          tabindex="0"
          title={t('launcher.launch')}
          data-drop="appalias"
          data-path={a.path}
          data-key={tab.id}
          onpointerdown={(e) =>
            drag.begin(
              e,
              () => [entryOf(a)],
              'launcher',
              (ev) => !(ev.target as HTMLElement).closest('.rm') && launch(a),
              { data: { alias: a, fromTab: tab.id }, accepts: ['apptab', 'appalias'], title: a.name }
            )}
          onkeydown={(e) => e.key === 'Enter' && launch(a)}
        >
          <div class="icon" style:--h={hue(a.name)}>{a.name.slice(0, 1).toUpperCase()}</div>
          <div class="label">{a.name}</div>
          <button
            class="rm"
            title={t('launcher.removeAlias')}
            onpointerdown={(e) => e.stopPropagation()}
            onclick={(e) => {
              e.stopPropagation();
              launcher.removeAlias(tab.id, a.path);
            }}><Icon name="x" size={11} /></button
          >
        </div>
      {/each}
    </div>
  {:else}
    <p class="empty"><Icon name="grid" size={28} /><span>{t('launcher.empty')}</span></p>
  {/if}
</section>

<style>
  .launcher {
    flex: 1;
    min-width: 0;
    overflow-y: auto;
    padding: 22px 26px;
    background: var(--bg);
  }
  :global(body.dragging) .launcher:hover {
    background: color-mix(in srgb, var(--accent-soft) 40%, var(--bg));
  }
  header {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-bottom: 20px;
  }
  h2 {
    margin: 0;
    font-size: 20px;
  }
  .adder {
    position: relative;
    margin-left: auto;
  }
  .adder input {
    width: 240px;
    padding: 6px 10px;
    border-radius: 8px;
    border: 1px solid var(--line);
    background: var(--bg-elev);
    color: var(--fg);
    outline: none;
  }
  .pick {
    position: absolute;
    right: 0;
    top: calc(100% + 4px);
    z-index: 5;
    width: 280px;
    max-height: 320px;
    overflow-y: auto;
    padding: 4px;
    border-radius: 10px;
    border: 1px solid var(--line);
    background: var(--bg-elev);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
  }
  .pick button {
    display: block;
    width: 100%;
    padding: 6px 8px;
    border-radius: 6px;
    text-align: left;
    color: var(--fg);
  }
  .pick button:hover {
    background: var(--accent-soft);
  }
  .none {
    padding: 6px 8px;
    color: var(--fg-faint);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
    gap: 14px;
  }
  .alias {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 14px 8px 10px;
    border-radius: 12px;
    cursor: default;
    user-select: none;
  }
  .alias:hover {
    background: var(--bg-sunken);
  }
  .alias.hit {
    background: var(--accent-soft);
    outline: 2px solid var(--accent);
  }
  .icon {
    display: grid;
    place-items: center;
    width: 56px;
    height: 56px;
    border-radius: 14px;
    background: linear-gradient(145deg, hsl(var(--h) 62% 58%), hsl(calc(var(--h) + 30) 60% 42%));
    color: #fff;
    font-size: 24px;
    font-weight: 600;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.18);
  }
  .label {
    max-width: 100%;
    text-align: center;
    font-size: 12.5px;
    line-height: 1.25;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
  }
  .rm {
    position: absolute;
    top: 4px;
    right: 4px;
    display: none;
    place-items: center;
    width: 20px;
    height: 20px;
    border-radius: 6px;
    color: var(--fg-faint);
  }
  .alias:hover .rm {
    display: grid;
  }
  .rm:hover {
    background: var(--bg);
    color: var(--fg);
  }
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    max-width: 380px;
    margin: 80px auto;
    text-align: center;
    color: var(--fg-faint);
  }
</style>
