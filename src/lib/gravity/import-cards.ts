import type { GravityTerm } from './types';

/** Validate API cards and retain their text without a lossy TSV round trip. */
export function importedCardsToTerms(cards: unknown): GravityTerm[] | null {
  if (!Array.isArray(cards)) return null;
  const terms: GravityTerm[] = [];
  for (const [index, card] of cards.entries()) {
    if (
      !card ||
      typeof card.term !== 'string' ||
      typeof card.definition !== 'string' ||
      !card.term.trim() ||
      !card.definition.trim()
    ) {
      return null;
    }
    const id = `quizlet${index}`;
    terms.push({
      id,
      luid: `term-${id}`,
      word: card.term,
      definition: card.definition,
      starred: false,
    });
  }
  return terms;
}
