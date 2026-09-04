import type { GradingResult } from './types';

/**
 * Answer grader — approximation of Quizlet's shared Kotlin grader
 * (quizlet-shared-kotlin-grader): normalization, typo tolerance,
 * multi-answer support and optional partial answers.
 */

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .replace(/[.,!?;:"'`()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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
  const t = normalize(typed ?? '');
  if (!t) return { isCorrect: false };
  const cands = candidates(correct ?? '').map(normalize).filter(Boolean);
  for (const c of cands) {
    if (t === c) return { isCorrect: true };
    const tw = tokens(t);
    const aw = tokens(c);
    if (fullMatch(tw, aw)) return { isCorrect: true };
    if (opts.acceptsPartialAnswer && partialMatch(tw, aw)) return { isCorrect: true };
  }
  return { isCorrect: false };
}
