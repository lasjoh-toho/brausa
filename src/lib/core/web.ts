import { loc } from '../i18n/index.svelte';

/** What was typed: an address (adds https://) or words to search for. */
export function toUrl(input: string): string {
  const s = input.trim();
  if (/^(https?|about):/i.test(s)) return s;
  if (/^[^\s/]+\.[^\s]{2,}(\/.*)?$/.test(s) || /^localhost(:\d+)?(\/.*)?$/.test(s)) return 'https://' + s;
  return 'https://duckduckgo.com/?q=' + encodeURIComponent(s);
}

/** A page in the bookmarks or the history of a project. */
export interface WebPage {
  url: string;
  title: string;
  /** ms: when bookmarked or last visited */
  at: number;
}

export interface WebLibrary {
  bookmarks: WebPage[];
  history: WebPage[];
}

export const HISTORY_MAX = 500;

/** Local websites get a fresh random address each run; keeping them is pointless. */
export function isEphemeral(url: string): boolean {
  return /^http:\/\/127\.0\.0\.1:\d+\//.test(url) || !/^https?:/i.test(url);
}

/** Newest first; visiting a page again moves it to the top. */
export function addVisit(history: WebPage[], page: WebPage, max = HISTORY_MAX): WebPage[] {
  if (isEphemeral(page.url)) return history;
  const old = history.find((p) => p.url === page.url);
  const title = page.title || old?.title || '';
  return [{ ...page, title }, ...history.filter((p) => p.url !== page.url)].slice(0, max);
}

/** The title arrives after the address; fill it in where it is missing or stale. */
export function setTitle(list: WebPage[], url: string, title: string): WebPage[] {
  if (!title) return list;
  return list.some((p) => p.url === url && p.title !== title) ? list.map((p) => (p.url === url ? { ...p, title } : p)) : list;
}

export function toggleBookmark(bookmarks: WebPage[], page: WebPage): WebPage[] {
  return bookmarks.some((p) => p.url === page.url) ? bookmarks.filter((p) => p.url !== page.url) : [...bookmarks, page];
}

/** Every word must occur in title or address. */
export function filterPages(list: WebPage[], q: string): WebPage[] {
  const words = q.toLocaleLowerCase(loc()).split(/\s+/).filter(Boolean);
  if (!words.length) return list;
  return list.filter((p) => {
    const hay = (p.title + ' ' + p.url).toLocaleLowerCase(loc());
    return words.every((w) => hay.includes(w));
  });
}

/** "example.org/a/b" for display. */
export function shortUrl(url: string): string {
  return url.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '');
}
