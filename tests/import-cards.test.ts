import assert from 'node:assert/strict';
import test from 'node:test';
const { importedCardsToTerms } = await import(
  new URL('../src/lib/gravity/import-cards.ts', import.meta.url).href
);

test('structured Quizlet cards retain embedded line breaks, tabs, and punctuation', () => {
  const cards = [
    { term: 'le client, la cliente', definition: 'der Kunde, die Kundin' },
    { term: 'first\nsecond\tthird', definition: 'one\r\ntwo\tthree; four - five' },
    { term: 'déçu/e', definition: '"enttäuscht"' },
  ];
  const terms = importedCardsToTerms(cards);
  assert.ok(terms);
  assert.deepEqual(terms.map(({ word, definition }) => ({ term: word, definition })), cards);
  assert.equal(new Set(terms.map(({ id }) => id)).size, cards.length);
  assert.ok(terms.every(({ id, luid }) => !id.includes('-') && luid === `term-${id}`));
});

test('invalid API payloads are rejected instead of silently losing cards', () => {
  for (const cards of [
    undefined,
    {},
    [null],
    [{ term: 'word', definition: 42 }],
    [{ term: 'word', definition: '   ' }],
    [{ term: 'valid', definition: 'pair' }, { term: 'missing definition' }],
  ]) {
    assert.equal(importedCardsToTerms(cards), null);
  }
});
