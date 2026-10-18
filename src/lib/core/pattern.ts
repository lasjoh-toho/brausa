/**
 * Select-by-pattern mini language. All terms are ANDed.
 *
 *   *.png > 5MB             glob + size
 *   #ToReview  -#Done       tag (hierarchical) / negated tag
 *   modified < 30d          modified within the last 30 days (also: created, age units s m h d w y)
 *   kind:dir   ext:jpg,png  entry kind / extension list
 *   is:video   is:bild,pdf  file type (Bilder, Videos, Audio, PDF, Text/Code, Web, Office, Medien)
 *   size>=1.5GB             operators may be glued to the value or the field
 *   beach                   plain word: name contains (case-insensitive)
 *   -draft                  negated word
 */
import type { Entry } from './types';
import { hasTag } from './tags';
import { category, type Category } from './format';

export type Cmp = '<' | '<=' | '>' | '>=' | '=';

export type Term =
  | { type: 'glob'; re: RegExp; neg: boolean; src: string }
  | { type: 'tag'; tag: string; neg: boolean }
  | { type: 'size'; op: Cmp; bytes: number }
  | { type: 'age'; field: 'mtime' | 'ctime'; op: Cmp; ms: number }
  | { type: 'kind'; kind: 'dir' | 'file' }
  | { type: 'ext'; exts: string[]; neg: boolean }
  | { type: 'cat'; cats: Category[]; neg: boolean }
  | { type: 'text'; text: string; neg: boolean };

export interface Pattern {
  terms: Term[];
  errors: string[];
}

const SIZE_UNITS: Record<string, number> = {
  b: 1,
  kb: 1e3,
  mb: 1e6,
  gb: 1e9,
  tb: 1e12,
  kib: 1024,
  mib: 1024 ** 2,
  gib: 1024 ** 3,
  k: 1e3,
  m: 1e6,
  g: 1e9
};

const AGE_UNITS: Record<string, number> = {
  s: 1e3,
  min: 60e3,
  h: 3600e3,
  d: 86400e3,
  w: 7 * 86400e3,
  mo: 30 * 86400e3,
  y: 365 * 86400e3
};

// German and English names for `is:`; "medien" is images, videos and audio together.
const CATEGORY_ALIASES: Record<string, Category[]> = {
  image: ['image'], images: ['image'], bild: ['image'], bilder: ['image'], foto: ['image'], fotos: ['image'], photo: ['image'],
  video: ['video'], videos: ['video'], film: ['video'], filme: ['video'],
  audio: ['audio'], musik: ['audio'], music: ['audio'], ton: ['audio'],
  pdf: ['pdf'],
  text: ['text'], code: ['text'], quelltext: ['text'],
  web: ['web'], html: ['web'], webseite: ['web'], webseiten: ['web'],
  office: ['office'], dokument: ['office', 'pdf'], dokumente: ['office', 'pdf'], doc: ['office', 'pdf'], docs: ['office', 'pdf'],
  medien: ['image', 'video', 'audio'], media: ['image', 'video', 'audio']
};

/** Categories named by an `is:` value like `video` or `bild,pdf`; null if one is unknown. */
export function parseCategories(val: string): Category[] | null {
  const out = new Set<Category>();
  for (const v of val.toLowerCase().split(',').filter(Boolean)) {
    const c = CATEGORY_ALIASES[v];
    if (!c) return null;
    c.forEach((x) => out.add(x));
  }
  return out.size ? [...out] : null;
}

const OP_RE = /^(<=|>=|<|>|=)/;
const FIELD_ALIASES: Record<string, 'size' | 'mtime' | 'ctime'> = {
  size: 'size',
  modified: 'mtime',
  mtime: 'mtime',
  changed: 'mtime',
  created: 'ctime',
  ctime: 'ctime'
};

export function globToRegExp(glob: string): RegExp {
  const esc = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp('^' + esc + '$', 'i');
}

export function parseSize(s: string): number | null {
  const m = s.trim().toLowerCase().match(/^(\d+(?:[.,]\d+)?)\s*([a-z]*)$/);
  if (!m) return null;
  const unit = m[2] || 'b';
  const mult = SIZE_UNITS[unit];
  if (mult === undefined) return null;
  return parseFloat(m[1].replace(',', '.')) * mult;
}

export function parseAge(s: string): number | null {
  const m = s.trim().toLowerCase().match(/^(\d+(?:[.,]\d+)?)\s*(s|min|h|d|w|mo|y)$/);
  if (!m) return null;
  return parseFloat(m[1].replace(',', '.')) * AGE_UNITS[m[2]];
}

/** Split into tokens, gluing "field op value" and "op value" sequences together. */
function tokenize(input: string): string[] {
  const raw = input.trim().split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    let t = raw[i];
    // "modified" "<" "30d"  |  "modified" "<30d"
    if (FIELD_ALIASES[t.toLowerCase()] && i + 1 < raw.length && OP_RE.test(raw[i + 1])) {
      t = t + raw[++i];
      if (/(<=|>=|<|>|=)$/.test(t) && i + 1 < raw.length) t += raw[++i];
    } else if (/^(<=|>=|<|>|=)$/.test(t) && i + 1 < raw.length) {
      t = t + raw[++i];
    }
    out.push(t);
  }
  return out;
}

export function parsePattern(input: string): Pattern {
  const terms: Term[] = [];
  const errors: string[] = [];

  for (const tok of tokenize(input)) {
    const neg = tok.startsWith('-') && tok.length > 1;
    const body = neg ? tok.slice(1) : tok;

    // field comparison: size>5MB, modified<30d
    const fm = body.match(/^([a-z]+)(<=|>=|<|>|=)(.+)$/i);
    if (fm && FIELD_ALIASES[fm[1].toLowerCase()]) {
      const field = FIELD_ALIASES[fm[1].toLowerCase()];
      const op = fm[2] as Cmp;
      if (field === 'size') {
        const bytes = parseSize(fm[3]);
        bytes === null ? errors.push(`Ungültige Größe: ${fm[3]}`) : terms.push({ type: 'size', op, bytes });
      } else {
        const ms = parseAge(fm[3]);
        ms === null ? errors.push(`Ungültige Zeitspanne: ${fm[3]}`) : terms.push({ type: 'age', field, op, ms });
      }
      continue;
    }

    // bare comparison: >5MB (size) or <30d (age of mtime)
    const om = body.match(/^(<=|>=|<|>|=)(.+)$/);
    if (om) {
      const op = om[1] as Cmp;
      const bytes = parseSize(om[2]);
      const ms = parseAge(om[2]);
      if (ms !== null) terms.push({ type: 'age', field: 'mtime', op, ms });
      else if (bytes !== null) terms.push({ type: 'size', op, bytes });
      else errors.push(`Ungültiger Vergleich: ${body}`);
      continue;
    }

    if (body.startsWith('#') && body.length > 1) {
      terms.push({ type: 'tag', tag: body.slice(1), neg });
      continue;
    }

    const kv = body.match(/^(kind|ext|is):(.+)$/i);
    if (kv) {
      const key = kv[1].toLowerCase();
      const val = kv[2].toLowerCase();
      if (key === 'ext') terms.push({ type: 'ext', exts: val.split(',').map((e) => e.replace(/^\./, '')), neg });
      else if (['dir', 'folder', 'ordner'].includes(val)) terms.push({ type: 'kind', kind: 'dir' });
      else if (['file', 'datei'].includes(val)) terms.push({ type: 'kind', kind: 'file' });
      else {
        const cats = parseCategories(val);
        if (cats) terms.push({ type: 'cat', cats, neg });
        else errors.push(`Unbekannter Typ: ${val}`);
      }
      continue;
    }

    if (/[*?]/.test(body)) {
      terms.push({ type: 'glob', re: globToRegExp(body), neg, src: body });
      continue;
    }

    terms.push({ type: 'text', text: body.toLowerCase(), neg });
  }

  return { terms, errors };
}

function cmp(a: number, op: Cmp, b: number): boolean {
  switch (op) {
    case '<':
      return a < b;
    case '<=':
      return a <= b;
    case '>':
      return a > b;
    case '>=':
      return a >= b;
    case '=':
      return a === b;
  }
}

export function matchTerm(e: Entry, t: Term, now: number): boolean {
  switch (t.type) {
    case 'glob':
      return t.re.test(e.name) !== t.neg;
    case 'tag':
      return hasTag(e.tags, t.tag) !== t.neg;
    case 'size':
      return e.kind === 'file' && cmp(e.size, t.op, t.bytes);
    case 'age':
      // "modified < 30d" reads as "age is less than 30 days"
      return cmp(now - e[t.field], t.op, t.ms);
    case 'kind':
      return e.kind === t.kind;
    case 'ext':
      return t.exts.includes(e.ext) !== t.neg;
    case 'cat': {
      const c = e.kind === 'file' ? category(e.ext) : null;
      return (!!c && t.cats.includes(c)) !== t.neg;
    }
    case 'text':
      return e.name.toLowerCase().includes(t.text) !== t.neg;
  }
}

export function matches(e: Entry, p: Pattern, now = Date.now()): boolean {
  return p.terms.every((t) => matchTerm(e, t, now));
}

export function selectByPattern(entries: Entry[], input: string, now = Date.now()): { paths: string[]; errors: string[] } {
  const p = parsePattern(input);
  if (!p.terms.length) return { paths: [], errors: p.errors };
  return { paths: entries.filter((e) => matches(e, p, now)).map((e) => e.path), errors: p.errors };
}
