export type StudyCard = {term: string; definition: string};

/** Ignore ordering, outer whitespace and Unicode representation when comparing content. */
export function canonicalCards(cards: StudyCard[]): string {
  return JSON.stringify(cards.map(c => [c.term.trim().normalize('NFC'), c.definition.trim().normalize('NFC')])
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
}
