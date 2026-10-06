import type { GravityTerm } from './types';

/* ----------------------------------------------------------------------------
   SPECIAL CHARACTER COLLECTION — powers the special-character buttons
   above the typing field.

   Scans every term AND definition of the active study set and collects
   every non-ASCII LETTER (ä ö ü ß é è ê à ç ñ š đ č ć ž å ø æ œ …).
   Punctuation (¿ ¡ « » —), digits and emoji are ignored; only letters
   a player could actually need to type. The result is deduplicated and
   sorted by base letter (a, á, à, ä … then b, c, č, ć …), so the bar
   reads naturally for mixed French/German/Serbian sets.
---------------------------------------------------------------------------- */

/** anything outside basic ASCII (0x00–0x7F) */
function isNonAscii(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0;
  return code > 0x7f;
}

/** letters only — \p{L} covers all unicode letter categories */
function isLetter(ch: string): boolean {
  return /\p{L}/u.test(ch);
}

/** base letter for sorting: "é" -> "e", "Š" -> "s", "ß" -> "ß" */
function baseLetter(ch: string): string {
  return ch.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

export function collectSpecialChars(terms: GravityTerm[]): string[] {
  const seen = new Set<string>();
  for (const term of terms) {
    for (const text of [term.word, term.definition]) {
      if (!text) continue;
      // `for…of` iterates by code point (surrogate-pair safe)
      for (const ch of text) {
        if (isNonAscii(ch) && isLetter(ch)) {
          seen.add(ch);
        }
      }
    }
  }
  return Array.from(seen).sort((a, b) => {
    const byBase = baseLetter(a).localeCompare(baseLetter(b));
    if (byBase !== 0) return byBase;
    // same base letter (e.g. é vs è vs ê): keep a stable, predictable order
    return (a.codePointAt(0) ?? 0) - (b.codePointAt(0) ?? 0);
  });
}
