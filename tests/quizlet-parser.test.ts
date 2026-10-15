import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
// Node 24 strips TypeScript directly; no test runner dependency is required.
import { normalizeQuizletUrl, parseQuizletHtml } from '../src/lib/gravity/quizlet-parser.ts';

const SET_ID = '123456789';
const URL = `https://quizlet.com/ch/${SET_ID}/example-flash-cards/`;

function item(id: number, rank: number, term = `Term ${id}`, definition = `Definition ${id}`) {
  return {
    id,
    rank,
    isDeleted: false,
    studiableContainerType: 1,
    studiableContainerId: Number(SET_ID),
    cardSides: [
      { label: 'word', media: [{ type: 1, plainText: term }] },
      { label: 'definition', media: [{ type: 1, plainText: definition }] },
    ],
  };
}

function state(items = [item(11, 0), item(12, 1)], count = items.length) {
  const set = { id: Number(SET_ID), numTerms: count, title: 'Synthetic example', passwordUse: false, privacyLockStatus: 0 };
  return {
    setPage: { set },
    studyModesCommon: {
      studiableData: { studiableContainer: { ...set }, studiableContainerType: 1, studiableItems: items },
    },
  };
}

function html(redux = state(), overrides: Record<string, unknown> = {}, attributes = 'id="__NEXT_DATA__" type="application/json"') {
  const data = {
    query: { setId: SET_ID },
    props: { pageProps: { dehydratedReduxStateKey: JSON.stringify(redux) } },
    ...overrides,
  };
  return `<html><script ${attributes}>${JSON.stringify(data)}</script></html>`;
}

test('normalizes real set links while preserving locale and slug', () => {
  for (const input of [
    `quizlet.com/ch/${SET_ID}/example-flash-cards/?i=123#share`,
    `https://www.quizlet.com/ch/${SET_ID}/example-flash-cards`,
    `http://quizlet.com/ch/${SET_ID}/example-flash-cards/`,
  ]) assert.deepEqual(normalizeQuizletUrl(input), { setId: SET_ID, url: URL });
  assert.deepEqual(normalizeQuizletUrl(`quizlet.com/${SET_ID}`), {
    setId: SET_ID, url: `https://quizlet.com/${SET_ID}/`,
  });
  assert.equal(normalizeQuizletUrl(`quizlet.com/de-de/${SET_ID}/flash-cards`).url,
    `https://quizlet.com/de-de/${SET_ID}/flash-cards/`);
  assert.equal(normalizeQuizletUrl('https://quizlet.com/917671023/how-to-make-flashcards/').setId,
    '917671023');
  assert.equal(normalizeQuizletUrl(`https://quizlet.com/hi/${SET_ID}/शब्द-flash-cards/`).setId, SET_ID);
  assert.equal(normalizeQuizletUrl(`https://quizlet.com/fi/${SET_ID}/a%CC%88iti-flash-cards/`).setId, SET_ID);
});

test('rejects spoofed hosts, credentials, paths and protocols before fetching', () => {
  for (const input of [
    `https://quizlet.evil.example/${SET_ID}/`,
    `https://quizlet.com.evil.example/${SET_ID}/`,
    `https://evil.quizlet.com/${SET_ID}/`,
    `https://quizlet.com@evil.example/${SET_ID}/`,
    `https://user:password@quizlet.com/${SET_ID}/`,
    `https://quizlet.com:444/${SET_ID}/`,
    `ftp://quizlet.com/${SET_ID}/`,
    `https://quizlet.com/${SET_ID}oops/`,
    `https://quizlet.com/${SET_ID}/learn`,
    `https://quizlet.com/${SET_ID}/flash-cards/extra`,
    `https://quizlet.com/${SET_ID}/evil%2fflash-cards`,
    `https://quizlet.com/${SET_ID}/evil%5cflash-cards`,
    `https://quizlet.com/${SET_ID}/evil%20flash-cards`,
    `https://quizlet.com/00${SET_ID}/`,
    `https://quizlet.com\\evil.example/${SET_ID}/`,
    'https://quizlet.com/\n123456789/',
    '',
    'a'.repeat(2_049),
  ]) assert.throws(() => normalizeQuizletUrl(input), input);
});

test('accepts translated slug-ID set routes without a language or translation allowlist', () => {
  // German and French are actual route shapes. The other translated paths
  // deliberately test structural support, not an inventory of Quizlet routes.
  for (const path of [
    '/de/karteikarten/einmaleins-250942042',
    '/fr-fr/fiches-de-memorisation/multiplications-250942042/',
    '/fi/muistikortit/kertotaulu-250942042',
    '/es/tarjetas/multiplicacion-250942042',
    '/ja/単語カード/掛け算-250942042',
    '/zh-Hant-TW/学习卡/乘法-250942042',
    '/ar/بطاقات/الضرب-250942042',
  ]) {
    assert.deepEqual(normalizeQuizletUrl(`https://www.quizlet.com${path}?i=share#cards`), {
      setId: '250942042', url: 'https://quizlet.com/250942042/',
    }, path);
  }
  assert.deepEqual(normalizeQuizletUrl('https://quizlet.com/fi/666063657/quizlet-flash-cards/'), {
    setId: '666063657', url: 'https://quizlet.com/fi/666063657/quizlet-flash-cards/',
  });
  assert.equal(normalizeQuizletUrl('https://quizlet.com/de/karteikarten/lektion-6-250942042').setId,
    '250942042');
});

test('translated routes cannot forward arbitrary paths or disguise their numeric ID', () => {
  for (const input of [
    'https://quizlet.com/de/karteikarten/einmaleins-250942042/extra',
    'https://quizlet.com/de/karteikarten/einmaleins-250942042oops',
    'https://quizlet.com/de/karteikarten/einmaleins-0250942042',
    'https://quizlet.com/de/karteikarten/einmaleins-0',
    'https://quizlet.com/de/karteikarten/250942042',
    'https://quizlet.com/de/karteikarten/ein%2fmal-250942042',
    'https://quizlet.com/de/karteikarten/ein%5cmal-250942042',
    'https://quizlet.com/de/karteikarten/ein%00mal-250942042',
    'https://quizlet.com/de/karteikarten/ein%20mal-250942042',
    'https://quizlet.com/de/karteikarten/ein%mal-250942042',
    'https://quizlet.com/de/karte%2fikarten/einmaleins-250942042',
    'https://quizlet.com/de//karteikarten/einmaleins-250942042',
    'https://quizlet.com.evil.example/de/karteikarten/einmaleins-250942042',
  ]) assert.throws(() => normalizeQuizletUrl(input), input);
});

test('imports only scoped cards in rank order and preserves exact decoded text', () => {
  const redux = state([item(12, 1, 'Second'), item(11, 0, 'First &amp; <tag>', 'Line one\nLine two\tend')]);
  const document = html(redux, { unrelated: { cardSides: item(99, 99).cardSides } }, 'type="application/json" id=\'__NEXT_DATA__\'');
  const result = parseQuizletHtml(document, URL, SET_ID);
  assert.deepEqual(result.cards, [
    { term: 'First &amp; <tag>', definition: 'Line one\nLine two\tend' },
    { term: 'Second', definition: 'Definition 12' },
  ]);
  assert.equal(result.title, 'Synthetic example');
  assert.equal(result.skipped, 0);
  assert.equal(result.setId, SET_ID);
});

test('does not use a canonical meta URL as set identity (copied sets can retain parent URLs)', () => {
  const document = html(state()).replace('"pageProps":{', '"pageProps":{"canonicalUrl":"https://quizlet.com/999999/",');
  assert.equal(parseQuizletHtml(document, URL, SET_ID).cards.length, 2);
});

test('rejects mismatched query, metadata, container and card set IDs', () => {
  assert.throws(() => parseQuizletHtml(html(state(), { query: { setId: '999999' } }), URL, SET_ID));
  for (const change of [
    (redux: ReturnType<typeof state>) => { redux.setPage.set.id = 999999; },
    (redux: ReturnType<typeof state>) => { redux.studyModesCommon.studiableData.studiableContainer.id = 999999; },
    (redux: ReturnType<typeof state>) => { redux.studyModesCommon.studiableData.studiableItems[0].studiableContainerId = 999999; },
    (redux: ReturnType<typeof state>) => { redux.studyModesCommon.studiableData.studiableContainerType = 2; },
  ]) {
    const redux = state();
    change(redux);
    assert.throws(() => parseQuizletHtml(html(redux), URL, SET_ID));
  }
  assert.throws(() => parseQuizletHtml(html(), URL, '999999'));
});

test('fails closed for missing, truncated or inconsistent announced counts', () => {
  assert.throws(() => parseQuizletHtml(html(state(undefined, 3)), URL, SET_ID), /incomplete/);
  assert.throws(() => parseQuizletHtml(html(state(undefined, 1)), URL, SET_ID), /incomplete/);
  for (const count of [0, -1, 1.5, 5_001, Number.NaN]) {
    assert.throws(() => parseQuizletHtml(html(state(undefined, count)), URL, SET_ID));
  }
  const inconsistent = state();
  inconsistent.studyModesCommon.studiableData.studiableContainer.numTerms = 3;
  assert.throws(() => parseQuizletHtml(html(inconsistent), URL, SET_ID), /inconsistent/);
  const missing = html().replace(/\\"numTerms\\":2,/g, '');
  assert.throws(() => parseQuizletHtml(missing, URL, SET_ID));
});

test('counts nontext cards explicitly without shifting neighboring pairs', () => {
  const imageOnly = item(13, 2, '', '');
  const oneSided = item(14, 3, 'Image definition', '');
  const deleted = { ...item(15, 4), isDeleted: true };
  const result = parseQuizletHtml(html(state([item(11, 0), imageOnly, oneSided, deleted, item(12, 1)], 4)), URL, SET_ID);
  assert.equal(result.cards.length, 2);
  assert.equal(result.skipped, 2);
  assert.deepEqual(result.cards.map((card: { term: string }) => card.term), ['Term 11', 'Term 12']);
  assert.throws(() => parseQuizletHtml(html(state([imageOnly, oneSided], 2)), URL, SET_ID), /at least two/);
});

test('deduplicates identical source IDs while preserving distinct cards with equal text', () => {
  const first = item(11, 0, 'Same', 'Same');
  const second = item(12, 1, 'Same', 'Same');
  const result = parseQuizletHtml(html(state([first, { ...first }, second], 2)), URL, SET_ID);
  assert.equal(result.cards.length, 2);
  assert.equal(result.skipped, 0);
  assert.throws(() => parseQuizletHtml(html(state([first, { ...first }], 2)), URL, SET_ID), /incomplete/);
});

test('rejects conflicting source IDs, deletion state, ranks and sides', () => {
  for (const cards of [
    [item(11, 0), item(11, 0, 'Different'), item(12, 1)],
    [item(11, 0), { ...item(11, 0), isDeleted: true }, item(12, 1)],
    [{ ...item(11, 0), isDeleted: true }, item(11, 0), item(12, 1)],
    [item(11, 0), item(12, 0)],
    [item(11, 0), item(12, -1)],
    [item(11, 0), item(12, 1.5)],
  ]) assert.throws(() => parseQuizletHtml(html(state(cards, 2)), URL, SET_ID));
  const malformed = state();
  malformed.studyModesCommon.studiableData.studiableItems[0].cardSides[1].label = 'word';
  assert.throws(() => parseQuizletHtml(html(malformed), URL, SET_ID), /ambiguous card sides/);
});

test('rejects challenge pages, markdown, missing state and ambiguous script IDs', () => {
  for (const document of [
    '<html><title>Just a moment...</title></html>',
    '# Set\n\nTerms in this set (2)\n\nOne\n\nTwo\n\nThree\n\nFour',
    '<script id="__NEXT_DATA__">{broken</script>',
    html(state(), { props: {} }),
    html().replace('id="__NEXT_DATA__"', 'data-id="__NEXT_DATA__"'),
    html() + html(),
    'x'.repeat(10 * 1_024 * 1_024 + 1),
  ]) assert.throws(() => parseQuizletHtml(document, URL, SET_ID));
});

test('rejects private flags and excessive card text', () => {
  const privateSet = state();
  privateSet.setPage.set.passwordUse = true;
  assert.throws(() => parseQuizletHtml(html(privateSet), URL, SET_ID), /publicly available/);
  assert.throws(() => parseQuizletHtml(html(state([item(11, 0, 'x'.repeat(10_001)), item(12, 1)])), URL, SET_ID), /too long/);
});

// Opt in locally to the provider response already captured outside the repo:
// QUIZLET_HTML_FIXTURE=/tmp/response.json QUIZLET_FIXTURE_URL=https://quizlet.com/<id>/ node --experimental-strip-types --test tests/quizlet-parser.test.ts
test('parses an optional real provider response without storing source cards in the repository', {
  skip: !process.env.QUIZLET_HTML_FIXTURE,
}, () => {
  const fixture = JSON.parse(readFileSync(process.env.QUIZLET_HTML_FIXTURE!, 'utf8'));
  const source = normalizeQuizletUrl(process.env.QUIZLET_FIXTURE_URL ?? '');
  const result = parseQuizletHtml(fixture.data.rawHtml, source.url, source.setId);
  assert.ok(result.cards.length >= 2);
  assert.equal(result.setId, source.setId);
  const expected = process.env.QUIZLET_FIXTURE_COUNT;
  if (expected) assert.equal(result.cards.length + result.skipped, Number(expected));
});
