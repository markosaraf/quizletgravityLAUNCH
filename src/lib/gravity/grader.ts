import type { GradingResult } from './types';

/**
 * Answer grader — approximation of Quizlet's shared Kotlin grader
 * (quizlet-shared-kotlin-grader): normalization, typo tolerance,
 * multi-answer support and optional partial answers.
 *
 * ── DIACRITICS POLICY (ä ö ü é è á à ç ñ ß …) ─────────────────────────
 * STRICT mode ("Allow partial answers" OFF, the default):
 *   Accented characters must be typed EXACTLY. Typing "a" for "ä",
 *   "o" for "ö" or "e" for "é" is WRONG. The typo tolerance
 *   (Levenshtein distance) can never rescue a diacritic difference
 *   either — when the ONLY difference between the typed word and the
 *   answer word is the accents, it always grades incorrect.
 * LENIENT mode ("Allow partial answers" ON):
 *   Diacritics are ignored ("schön" == "schon"), exactly like the
 *   previous behaviour, and typing only part of the answer is enough.
 */

/**
 * Strict normalization: keeps every accented character but makes the
 * different unicode encodings of the same letter comparable, so "é"
 * typed as one codepoint and "é" typed as "e" + combining accent both
 * end up as the identical string before comparing.
 */
function normalizeStrict(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFC') // e + U+0301 -> é (canonical composition)
    .replace(/[.,!?;:"'`()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "ä" -> "a", "é" -> "e" — used by LENIENT mode only. */
function stripDiacritics(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, ''); // strip diacritics
}

/** Lenient normalization: strict normalization + diacritic stripping. */
function normalizeLenient(s: string): string {
  return stripDiacritics(normalizeStrict(s));
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array<number>(b.length + 1);
  const cur = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j];
  }
  return prev[b.length];
}

/** allowed typo distance per word, scaling with word length */
function wordTolerance(len: number): number {
  if (len >= 8) return 2;
  if (len >= 5) return 1;
  return 0;
}

function tokens(s: string): string[] {
  return s ? s.split(' ').filter(Boolean) : [];
}

/** all accepted answer variants: "a / b", "a, or b", "(a)" */
function candidates(correct: string): string[] {
  const base = correct
    .split(/\s*[\/;]\s*|\s+or\s+/i)
    .map((c) => c.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const b of base) {
    // unwrap parentheses contents as extra candidates: "to (go)" -> "to go", "go"
    const inner = b.replace(/[()]/g, ' ');
    out.push(b);
    if (inner !== b) {
      const parts = b.split(/[()]/);
      if (parts.length >= 2) {
        const joined = (parts[0] + ' ' + (parts[1] || '')).replace(/\s+/g, ' ').trim();
        if (joined) out.push(joined);
        const onlyInner = (parts[1] || '').replace(/\s+/g, ' ').trim();
        if (onlyInner) out.push(onlyInner);
      }
    }
    // also accept ellipsis variants "to go ..." -> "to go"
    const noEllipsis = b.replace(/\.{2,}|…/g, ' ').replace(/\s+/g, ' ').trim();
    if (noEllipsis && noEllipsis !== b) out.push(noEllipsis);
  }
  return out;
}

function matchesWord(typedWord: string, answerWord: string, strict: boolean): boolean {
  if (typedWord === answerWord) return true;

  // STRICT mode: if the two words become identical once accents are
  // removed, the only difference IS the accents ("schon" vs "schön").
  // That is exactly the mistake that must grade wrong — return false
  // before the typo-tolerance path can paper over it.
  if (strict && stripDiacritics(typedWord) === stripDiacritics(answerWord)) {
    return false;
  }

  const tol = wordTolerance(answerWord.length);
  if (tol === 0) {
    // very short words must match exactly (but allow simple plural/verb endings)
    return (
      answerWord === typedWord ||
      (answerWord.length > 2 &&
        (answerWord + 's' === typedWord ||
          answerWord.replace(/y$/, 'ies') === typedWord ||
          answerWord === typedWord + 's' ||
          answerWord === typedWord.replace(/y$/, 'ies')))
    );
  }
  return levenshtein(typedWord, answerWord) <= tol;
}

function fullMatch(typed: string[], answer: string[], strict: boolean): boolean {
  if (typed.length !== answer.length) return false;
  return typed.every((w, i) => matchesWord(w, answer[i], strict));
}

function partialMatch(typed: string[], answer: string[], strict: boolean): boolean {
  // every typed token must be found somewhere in the answer, in order tolerance
  let ai = 0;
  for (const tw of typed) {
    let found = -1;
    for (let i = ai; i < answer.length; i++) {
      if (matchesWord(tw, answer[i], strict)) {
        found = i;
        break;
      }
    }
    if (found === -1) return false;
    ai = found + 1;
  }
  return typed.length >= 1;
}

export function grade(
  correct: string,
  typed: string,
  opts: { acceptsPartialAnswer?: boolean } = {},
): GradingResult {
  // STRICT whenever "Allow partial answers" is NOT selected:
  // accents are required and diacritic-only slips never pass.
  const strict = !opts.acceptsPartialAnswer;
  const norm = strict ? normalizeStrict : normalizeLenient;

  const t = norm(typed ?? '');
  if (!t) return { isCorrect: false };
  const cands = candidates(correct ?? '').map(norm).filter(Boolean);
  for (const c of cands) {
    if (t === c) return { isCorrect: true };
    const tw = tokens(t);
    const aw = tokens(c);
    if (fullMatch(tw, aw, strict)) return { isCorrect: true };
    if (opts.acceptsPartialAnswer && partialMatch(tw, aw, strict)) {
      return { isCorrect: true };
    }
  }
  return { isCorrect: false };
}
