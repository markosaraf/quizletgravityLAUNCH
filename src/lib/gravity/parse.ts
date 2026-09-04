import type { GravityTerm } from './types';

export const CORRECT_STORE_KEY = 'gravityAcceptsPartialAnswer';
export const SET_STORAGE_KEY = 'gravityImportedSet';
export const SEPARATOR_STORAGE_KEY = 'gravitySeparator';

/** User-selectable term/definition separator. Tab is always also accepted
    (it's unambiguous — a literal tab character is never part of normal text),
    so the choice here only controls which "soft" separator (comma, semicolon,
    or dash) splits a line. */
export type Separator = 'comma' | 'semicolon' | 'dash';

/** Parse one CSV line honoring quoted fields. */
function parseCsvLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** Dash-splitting logic — shared between the dash Separator choice and the
    fallback for paste-mode lines. Three-tier priority using lookbehind/
    lookahead so the match is just the dash character itself (match.index
    === dash position). Supports hyphen-minus "-", en-dash "–", em-dash "—".

    a) whitespace on both sides: "term - definition" — safest, preserves
       hyphenated terms like "mother-in-law - definition".
    b) whitespace on one side: "term -definition" or "term- definition".
    c) no whitespace: "term-definition". Only fires when there's exactly one
       dash character in the line, so "mother-in-law" (two dashes) is NOT
       misinterpreted as a term/definition pair. */
function splitOnDash(line: string): [string, string] | null {
  const dashClass = '[-\\u2013\\u2014]';
  const bothSides = line.match(new RegExp(`(?<=\\s)${dashClass}(?=\\s)`));
  if (bothSides && bothSides.index && bothSides.index > 0) {
    return [line.slice(0, bothSides.index), line.slice(bothSides.index + 1)];
  }
  const oneSide = line.match(new RegExp(`(?<=\\s)${dashClass}|${dashClass}(?=\\s)`));
  if (oneSide && oneSide.index !== undefined && oneSide.index > 0) {
    return [line.slice(0, oneSide.index), line.slice(oneSide.index + 1)];
  }
  const dashCount = (line.match(new RegExp(dashClass, 'g')) ?? []).length;
  if (dashCount === 1) {
    const noSpace = line.match(new RegExp(dashClass));
    if (noSpace && noSpace.index !== undefined && noSpace.index > 0) {
      return [line.slice(0, noSpace.index), line.slice(noSpace.index + 1)];
    }
  }
  return null;
}

/** Split a pasted line into [term, definition] using the user-selected
    separator. Tab is always also tried first (it's unambiguous). */
function splitPastedLine(line: string, separator: Separator): [string, string] | null {
  // 1) tab — always (literal tab character is never ambiguous in normal text)
  const tabIdx = line.indexOf('\t');
  if (tabIdx > 0) {
    return [line.slice(0, tabIdx), line.slice(tabIdx + 1)];
  }
  // 2) only the user-selected soft separator
  if (separator === 'dash') {
    return splitOnDash(line);
  }
  const sepChar = separator === 'comma' ? ',' : ';';
  const idx = line.indexOf(sepChar);
  if (idx > 0) {
    return [line.slice(0, idx), line.slice(idx + 1)];
  }
  return null;
}

let termIdCounter = 0;
function makeTerm(word: string, definition: string): GravityTerm {
  termIdCounter += 1;
  // dash-free id: liveTermId = `term-{id}-{level}-{n}` and the original
  // zIndex math reads split('-')[3], so ids must not contain dashes
  const id = `${Date.now().toString(36)}${termIdCounter.toString(36)}`;
  return {
    id,
    luid: `term-${id}`,
    word: word.trim(),
    definition: definition.trim(),
    starred: false,
  };
}

export function parsePastedList(text: string, separator: Separator = 'comma'): GravityTerm[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const terms: GravityTerm[] = [];
  for (const line of lines) {
    const pair = splitPastedLine(line, separator);
    if (pair && pair[0] && pair[1]) {
      terms.push(makeTerm(pair[0], pair[1]));
    }
  }
  return terms;
}

export function parseCsv(text: string, separator: Separator = 'comma'): TermParseResult {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() !== '');
  if (lines.length === 0) return { terms: [], skipped: 0 };

  // Dash isn't a standard CSV delimiter (CSV parsers expect a single char).
  // For dash, fall back to the pasted-list rules so the 3-tier dash logic
  // (preserve hyphenated words, etc.) applies.
  if (separator === 'dash') {
    return { terms: parsePastedList(text, separator), skipped: 0 };
  }

  let startIdx = 0;
  const first = lines[0];
  const delimiter = separator === 'comma' ? ',' : ';';

  // If the first line doesn't contain the user-selected delimiter at all,
  // nothing will parse — fall back to pasted-list rules (which also respect
  // the user's separator) so the user gets consistent behavior.
  if (!first.includes(delimiter)) {
    return { terms: parsePastedList(text, separator), skipped: 0 };
  }

  // skip a header row if it doesn't look like data
  const firstCells = parseCsvLine(first, delimiter);
  const headerLike =
    /^(term|word|vocabulary|front|question|prompt)s?$/i.test(firstCells[0] ?? '') ||
    /^(definition|meaning|back|answer|translation)s?$/i.test(firstCells[1] ?? '');
  if (headerLike) startIdx = 1;

  const terms: GravityTerm[] = [];
  let skipped = 0;
  for (let i = startIdx; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i], delimiter);
    const word = (cells[0] ?? '').trim();
    const definition = (cells[1] ?? '').trim();
    if (word && (definition || cells.length > 2)) {
      terms.push(makeTerm(word, definition));
    } else if (word || definition) {
      skipped++;
    }
  }
  return { terms, skipped };
}

export interface TermParseResult {
  terms: GravityTerm[];
  skipped: number;
}

export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

/** Persist imported set so returning players can resume quickly. */
export function saveImportedSet(title: string, terms: GravityTerm[]) {
  try {
    window.localStorage.setItem(
      SET_STORAGE_KEY,
      JSON.stringify({ title, terms }),
    );
  } catch {
    /* storage full — ignore */
  }
}

export function loadImportedSet(): { title: string; terms: GravityTerm[] } | null {
  try {
    const raw = window.localStorage.getItem(SET_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.title === 'string' &&
      Array.isArray(parsed.terms) &&
      parsed.terms.length > 0
    ) {
      return parsed;
    }
  } catch {
    /* corrupted — ignore */
  }
  return null;
}

export function getStoredPartialAnswer(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(CORRECT_STORE_KEY) === '1';
}

/** Persist + load the user's separator choice across sessions. Defaults to
    'comma' (the most common CSV separator). */
export function saveStoredSeparator(sep: Separator) {
  try {
    window.localStorage.setItem(SEPARATOR_STORAGE_KEY, sep);
  } catch {
    /* ignore */
  }
}

export function loadStoredSeparator(): Separator {
  if (typeof window === 'undefined') return 'comma';
  const v = window.localStorage.getItem(SEPARATOR_STORAGE_KEY);
  return v === 'comma' || v === 'semicolon' || v === 'dash' ? v : 'comma';
}

/** Persist + load the user's theme choice (dark / light) across sessions.
    Defaults to 'dark' — the existing app appearance is the dark mode. */
export type Theme = 'dark' | 'light';
export const THEME_STORAGE_KEY = 'gravityTheme';

export function saveStoredTheme(theme: Theme) {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* ignore */
  }
}

export function loadStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'dark';
  const v = window.localStorage.getItem(THEME_STORAGE_KEY);
  return v === 'dark' || v === 'light' ? v : 'dark';
}
