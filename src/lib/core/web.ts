/** What was typed: an address (adds https://) or words to search for. */
export function toUrl(input: string): string {
  const s = input.trim();
  if (/^(https?|about):/i.test(s)) return s;
  if (/^[^\s/]+\.[^\s]{2,}(\/.*)?$/.test(s) || /^localhost(:\d+)?(\/.*)?$/.test(s)) return 'https://' + s;
  return 'https://duckduckgo.com/?q=' + encodeURIComponent(s);
}
