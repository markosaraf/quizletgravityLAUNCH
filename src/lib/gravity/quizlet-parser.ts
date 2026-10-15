/** Deterministic parsing of the complete, public set state in Quizlet HTML.
 * This module performs no fetching and never infers cards from page text.
 */

export interface QuizletCard {
  term: string;
  definition: string;
}

export interface QuizletImportResult {
  title: string;
  url: string;
  setId: string;
  cards: QuizletCard[];
  skipped: number;
  via?: string;
}

const MAX_URL_LENGTH = 2_048;
const MAX_HTML_BYTES = 10 * 1_024 * 1_024;
const MAX_CARDS = 5_000;
const MAX_SIDE_LENGTH = 10_000;
const SET_ID = /^[1-9]\d{0,19}$/;

/** Accept set pages, normalize to HTTPS, and remove tracking parameters.
 * URL parsing and an exact hostname allowlist prevent lookalike-domain fetches.
 */
export function normalizeQuizletUrl(raw: string): { setId: string; url: string } {
  if (typeof raw !== 'string') throw new Error('Enter a Quizlet set link.');
  const input = raw.trim();
  if (!input || input.length > MAX_URL_LENGTH || /[\u0000-\u0020\u007f\\]/.test(input)) {
    throw new Error('Enter a valid Quizlet set link.');
  }

  let parsed: URL;
  try {
    parsed = new URL(/^[a-z][a-z\d+.-]*:/i.test(input) ? input : `https://${input}`);
  } catch {
    throw new Error('Enter a valid Quizlet set link.');
  }
  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    !['quizlet.com', 'www.quizlet.com'].includes(parsed.hostname) ||
    parsed.username || parsed.password || parsed.port
  ) {
    throw new Error('Use a link to a set on quizlet.com.');
  }

  // New set links put the ID at the end, for example
  // /de/karteikarten/einmaleins-250942042. The middle segment is translated,
  // so recognise the route structure rather than maintaining a language list.
  // Rebuild a numeric set URL: translated/user-supplied path segments never
  // reach the provider. The returned page must still prove the same set ID.
  const localized = parsed.pathname.match(
    /^\/([a-z]{2,3}(?:-[a-z0-9]{2,8})*)\/([^/]+)\/([^/]+)\/?$/i,
  );
  if (localized && !/^\d+$/.test(localized[2])) {
    let resource: string;
    let slug: string;
    try {
      resource = decodeURIComponent(localized[2]);
      slug = decodeURIComponent(localized[3]);
    } catch {
      throw new Error('Use a valid Quizlet flashcard set page link.');
    }
    const suffix = slug.match(/^[\p{L}\p{M}\p{N}_-]+-([1-9]\d{0,19})$/u);
    if (!/^[\p{L}\p{M}]+(?:-[\p{L}\p{M}]+)*$/u.test(resource) || !suffix) {
      throw new Error('Use the Quizlet flashcard set page link.');
    }
    return { setId: suffix[1], url: `https://quizlet.com/${suffix[1]}/` };
  }

  const match = parsed.pathname.match(
    /^\/(?:([a-z]{2,3}(?:-[a-z0-9]{2,8})*)\/)?([1-9]\d{0,19})(?:\/([^/]+))?\/?$/i,
  );
  const setId = match?.[2];
  if (!setId) throw new Error('Use the Quizlet flashcard set page link.');

  const slug = match[3];
  if (slug) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(slug);
    } catch {
      throw new Error('Use a valid Quizlet flashcard set page link.');
    }
    // Study/test/profile routes are not set-page slugs. Also reject encoded
    // separators, whitespace and traversal before forwarding a provider URL.
    if (!/^(?:[\p{L}\p{N}_-]+-)?flash-cards$/iu.test(decoded)) {
      throw new Error('Use the Quizlet flashcard set page link.');
    }
  }

  const locale = match[1]?.toLowerCase();
  const pathname = `/${locale ? `${locale}/` : ''}${setId}/${slug ? `${slug}/` : ''}`;
  return { setId, url: `https://quizlet.com${pathname}` };
}

type JsonObject = Record<string, unknown>;

function object(value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Quizlet returned unsupported ${label}.`);
  }
  return value as JsonObject;
}

function identifier(value: unknown): string | null {
  if (typeof value === 'string' && SET_ID.test(value)) return value;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value);
  return null;
}

function requireIdentity(value: unknown, setId: string): void {
  if (identifier(value) !== setId) {
    throw new Error('Quizlet returned data for a different or unidentified set.');
  }
}

function expectedCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > MAX_CARDS) {
    throw new Error('Quizlet did not provide a supported complete set size.');
  }
  return value;
}

function readPageState(html: string): JsonObject {
  if (typeof html !== 'string' || Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) {
    throw new Error('The Quizlet page is too large to import.');
  }
  let payload: string | undefined;
  const scripts = html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi);
  for (const script of scripts) {
    if (!/(?:^|\s)id\s*=\s*(?:"__NEXT_DATA__"|'__NEXT_DATA__'|__NEXT_DATA__(?=\s|$))/i.test(script[1])) {
      continue;
    }
    if (payload !== undefined) throw new Error('Quizlet returned ambiguous embedded page data.');
    payload = script[2];
  }
  if (payload === undefined) {
    throw new Error('Quizlet did not return complete embedded set data.');
  }
  try {
    return object(JSON.parse(payload), 'embedded page data');
  } catch {
    throw new Error('Quizlet returned invalid embedded page data.');
  }
}

function sideText(value: unknown): string {
  const side = object(value, 'card side');
  if (!Array.isArray(side.media) || side.media.length > 100) {
    throw new Error('Quizlet returned unsupported card media.');
  }
  const texts: string[] = [];
  for (const value of side.media) {
    const media = object(value, 'card media');
    if (media.plainText === undefined || media.plainText === null) continue;
    if (typeof media.plainText !== 'string') throw new Error('Quizlet returned invalid card text.');
    const text = media.plainText.trim();
    if (text) texts.push(text);
  }
  const text = texts.join('\n');
  if (text.length > MAX_SIDE_LENGTH) throw new Error('A Quizlet card is too long to import.');
  // plainText is already JSON-decoded. Decoding HTML entities here would
  // corrupt cards that intentionally contain strings such as "&amp;".
  return text;
}

function itemCard(item: JsonObject): QuizletCard {
  if (!Array.isArray(item.cardSides) || item.cardSides.length !== 2) {
    throw new Error('Quizlet returned unsupported card sides.');
  }
  const sides = item.cardSides.map((side) => object(side, 'card side'));
  const words = sides.filter((side) => side.label === 'word');
  const definitions = sides.filter((side) => side.label === 'definition');
  if (words.length !== 1 || definitions.length !== 1) {
    throw new Error('Quizlet returned ambiguous card sides.');
  }
  return { term: sideText(words[0]), definition: sideText(definitions[0]) };
}

/** Parse only the scoped state observed in Quizlet's actual set-page payload.
 * Metadata, container and every item must identify the requested set. Counts
 * refer to unique active source items before unsupported nontext cards are
 * skipped. Distinct IDs with equal text remain distinct source cards.
 */
export function parseQuizletHtml(html: string, url: string, setId: string): QuizletImportResult {
  const normalized = normalizeQuizletUrl(url);
  if (!SET_ID.test(setId) || normalized.setId !== setId) {
    throw new Error('The requested Quizlet set identity is inconsistent.');
  }
  const page = readPageState(html);
  requireIdentity(object(page.query, 'page query').setId, setId);
  const props = object(object(page.props, 'page props').pageProps, 'page props');

  let reduxValue = props.dehydratedReduxStateKey;
  if (typeof reduxValue === 'string') {
    try {
      reduxValue = JSON.parse(reduxValue);
    } catch {
      throw new Error('Quizlet returned invalid set state.');
    }
  }
  const redux = object(reduxValue, 'set state');
  const set = object(object(redux.setPage, 'set page').set, 'set metadata');
  requireIdentity(set.id, setId);
  const total = expectedCount(set.numTerms);
  if (set.passwordUse === true || (typeof set.privacyLockStatus === 'number' && set.privacyLockStatus !== 0)) {
    throw new Error('This Quizlet set is not publicly available.');
  }
  if (typeof set.title !== 'string' || !set.title.trim() || set.title.length > 1_000) {
    throw new Error('Quizlet returned invalid set metadata.');
  }

  const data = object(object(redux.studyModesCommon, 'study state').studiableData, 'card data');
  const container = object(data.studiableContainer, 'set container');
  requireIdentity(container.id, setId);
  if (data.studiableContainerType !== 1 || expectedCount(container.numTerms) !== total) {
    throw new Error('Quizlet returned inconsistent set metadata.');
  }
  if (!Array.isArray(data.studiableItems) || data.studiableItems.length > MAX_CARDS * 2) {
    throw new Error('Quizlet returned unsupported card data.');
  }

  const active = new Map<string, { rank: number; card: QuizletCard }>();
  const deleted = new Set<string>();
  const ranks = new Set<number>();
  for (const value of data.studiableItems) {
    const item = object(value, 'card');
    requireIdentity(item.studiableContainerId, setId);
    const id = identifier(item.id);
    if (!id || item.studiableContainerType !== 1 || typeof item.isDeleted !== 'boolean') {
      throw new Error('Quizlet returned invalid card identity.');
    }
    if (item.isDeleted) {
      if (active.has(id)) throw new Error('Quizlet returned conflicting versions of a card.');
      deleted.add(id);
      continue;
    }
    if (deleted.has(id)) throw new Error('Quizlet returned conflicting versions of a card.');
    const rank = item.rank;
    if (typeof rank !== 'number' || !Number.isSafeInteger(rank) || rank < 0) {
      throw new Error('Quizlet returned invalid card order.');
    }
    const card = itemCard(item);
    const previous = active.get(id);
    if (previous) {
      if (previous.rank !== rank || previous.card.term !== card.term || previous.card.definition !== card.definition) {
        throw new Error('Quizlet returned conflicting versions of a card.');
      }
      continue;
    }
    if (ranks.has(rank)) throw new Error('Quizlet returned ambiguous card order.');
    ranks.add(rank);
    active.set(id, { rank, card });
  }

  if (active.size !== total) {
    throw new Error('Quizlet returned an incomplete set. Paste or upload the full set instead.');
  }
  const ordered = [...active.values()].sort((left, right) => left.rank - right.rank);
  const cards = ordered.map(({ card }) => card).filter(({ term, definition }) => term && definition);
  const skipped = total - cards.length;
  if (cards.length < 2) throw new Error('The set needs at least two cards with text on both sides.');
  return { title: set.title.trim(), url: normalized.url, setId, cards, skipped };
}
