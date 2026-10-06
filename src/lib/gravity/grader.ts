import type { GradingResult } from './types';

/**
 * Answer grader — approximation of Quizlet's shared Kotlin grader
 * (quizlet-shared-kotlin-grader): normalization, multi-answer support
 * and optional partial answers.
 *
 * ── STRICT MODE ("Allow partial answers" OFF — the default) ───────────
 * The answer must be EXACTLY correct. NO difference is allowed:
 *   • accents are required          "schon"   ≠ "schön"
 *   • wrong accents are errors      "conseillèr" ≠ "conseillère"
 *   • no typo tolerance             "vere"    ≠ "verre"
 *   • no plural/verb allowances     "lien"    ≠ "liens"
 *   • no partial answers            "boire"   ≠ "boire un verre"
 * Only two things are still forgiven, matching Quizlet's own defaults:
 *   • letter CASE ("boire un Verre" == "boire un verre")
 *   • punctuation & spacing ("boire un verre." == "boire un verre")
 *
 * ── LENIENT MODE ("Allow partial answers" ON) ─────────────────────────
 * Previous behaviour: diacritics ignored, typo tolerance (Levenshtein
 * distance per word length), simple plural endings and partial answers
 * accepted.
 */

/**
 * Strict normalization: keeps every accented character but makes the
 * different unicode encodings of the same letter comparable, so "é"
 * typed as one codepoint and "é" typed as "e" + combining accent both
 * end up as the identical string before comparing. Punctuation and
 * apostrophe/dash variants collapse the same way on both sides.
 */
function normalizeStrict(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFC') // e + U+0301 -> é (canonical composition)
    .replace(/[\u2018\u2019\u02BC]/g, "'") // typographic apostrophes -> '
    .replace(/[\u2010-\u2015\u2212]/g, '-') // en/em dashes -> hyphen
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

/** allowed typo distance per word, scaling with word length (LENIENT only) */
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

function matchesWord(typedWord: string, answerWord: string): boolean {
  if (typedWord === answerWord) return true;
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

function fullMatch(typed: string[], answer: string[]): boolean {
  if (typed.length !== answer.length) return false;
  return typed.every((w, i) => matchesWord(w, answer[i]));
}

function partialMatch(typed: string[], answer: string[]): boolean {
  // every typed token must be found somewhere in the answer, in order tolerance
  let ai = 0;
  for (const tw of typed) {
    let found = -1;
    for (let i = ai; i < answer.length; i++) {
      if (matchesWord(tw, answer[i])) {
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
  // ════ STRICT — "Allow partial answers" NOT selected ════
  // Exactly correct or nothing: accents required, zero typo tolerance,
  // zero plural allowances, zero partial answers.
  if (!opts.acceptsPartialAnswer) {
    const t = normalizeStrict(typed ?? '');
    if (!t) return { isCorrect: false };
    const cands = candidates(correct ?? '').map(normalizeStrict).filter(Boolean);
    return { isCorrect: cands.includes(t) };
  }

  // ════ LENIENT — "Allow partial answers" selected ════
  // Accents ignored + typo tolerance + plural endings + partial answers
  // (the historical behaviour).
  const t = normalizeLenient(typed ?? '');
  if (!t) return { isCorrect: false };
  const cands = candidates(correct ?? '').map(normalizeLenient).filter(Boolean);
  for (const c of cands) {
    if (t === c) return { isCorrect: true };
    const tw = tokens(t);
    const aw = tokens(c);
    if (fullMatch(tw, aw)) return { isCorrect: true };
    if (partialMatch(tw, aw)) return { isCorrect: true };
  }
  return { isCorrect: false };
}
