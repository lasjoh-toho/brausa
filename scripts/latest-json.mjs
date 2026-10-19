// Writes the updater manifest (latest.json) for a release from the signatures
// the build uploaded: node scripts/latest-json.mjs v0.8.0 owner/repo sigs/ notes.md
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const [tag, repo, dir, notesFile] = process.argv.slice(2);
const url = (name) => `https://github.com/${repo}/releases/download/${tag}/${encodeURIComponent(name)}`;
const sigs = readdirSync(dir).filter((f) => f.endsWith('.sig'));
const pick = (re) => sigs.find((f) => re.test(f));

const platforms = {};
const add = (keys, sig) => {
  if (!sig) return;
  const entry = { signature: readFileSync(join(dir, sig), 'utf8').trim(), url: url(sig.replace(/\.sig$/, '')) };
  for (const k of keys) platforms[k] = entry;
};
// One universal macOS app serves both architectures.
add(['darwin-aarch64', 'darwin-x86_64'], pick(/\.app\.tar\.gz\.sig$/));
add(['windows-x86_64'], pick(/-setup\.exe\.sig$/));
add(['linux-x86_64'], pick(/\.AppImage\.sig$/));

if (!Object.keys(platforms).length) {
  console.error('no signatures found');
  process.exit(1);
}
let notes = '';
try {
  notes = readFileSync(notesFile, 'utf8');
} catch {
  /* optional */
}
console.log(JSON.stringify({ version: tag.replace(/^v/, ''), notes, pub_date: new Date().toISOString(), platforms }, null, 2));
