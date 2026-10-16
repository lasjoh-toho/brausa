<script lang="ts">
  // Minimal stroke icon set (24px grid, 1.6 stroke) — no icon font dependency.
  const paths: Record<string, string> = {
    folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
    file: 'M6 3h8l4 4v14H6zM14 3v4h4',
    image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9.5a1.5 1.5 0 1 0 0-.01',
    video: 'M4 6h12v12H4zM16 10l4-2v8l-4-2',
    doc: 'M6 3h8l4 4v14H6zM9 12h6M9 16h6',
    chevron: 'M9 6l6 6-6 6',
    back: 'M15 6l-6 6 6 6',
    forward: 'M9 6l6 6-6 6',
    up: 'M12 19V5M6 11l6-6 6 6',
    grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
    kanban: 'M4 4h4v16H4zM10 4h4v10h-4zM16 4h4v13h-4z',
    timeline: 'M4 6h16M4 12h10M4 18h13',
    map: 'M9 4 3 6v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14',
    calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4M8 14h2M12 14h2M16 14h0M8 17h2M12 17h2',
    trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
    pencil: 'M4 20h4L19 9l-4-4L4 16zM13 7l4 4',
    open: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
    eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    folderPlus: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM12 10v6M9 13h6',
    stream: 'M4 6h16M4 12h16M4 18h16M8 3v18',
    search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
    tag: 'M3 12V4h8l10 10-8 8zM7.5 7.5h.01',
    tray: 'M3 13h5l2 3h4l2-3h5M5 5h14l2 8v6H3v-6z',
    target: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
    x: 'M6 6l12 12M18 6 6 18',
    plus: 'M12 5v14M5 12h14',
    home: 'M4 11 12 4l8 7v9H4z',
    select: 'M4 4h4M12 4h4M20 4v4M20 12v4M4 8v4M4 16v4h4M12 20h4',
    gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12l2-1-1-3-2 .5-1.5-1.5.5-2-3-1-1 2h-2l-1-2-3 1 .5 2L6 8.5 4 8l-1 3 2 1v0l-2 1 1 3 2-.5 1.5 1.5-.5 2 3 1 1-2h2l1 2 3-1-.5-2 1.5-1.5 2 .5 1-3z',
    filter: 'M4 5h16l-6 8v6l-4-2v-4z',
    copy: 'M8 8h12v12H8zM4 16V4h12'
  };
  let { name, size = 16 }: { name: string; size?: number } = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.6"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"><path d={paths[name] ?? paths.file} /></svg
>
