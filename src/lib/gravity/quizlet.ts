/**
 * Quizlet set importer — fetches a PUBLIC Quizlet flashcard page and extracts
 * the terms & definitions.
 *
 * ── How it works ─────────────────────────────────────────────────────────
 * Quizlet server-renders every public flashcard page, and the full card data
 * is embedded in the HTML inside a <script id="__NEXT_DATA__"> JSON blob.
 * Each card ("studiable item") looks like:
 *
 *   { "rank": 0, "isDeleted": false,
 *     "cardSides": [
 *       { "label": "word",       "media": [{ "type": 1, "plainText": "accueillir" }] },
 *       { "label": "definition", "media": [{ "type": 1, "plainText": "empfangen"  }] } ] }
 *
 * The blob is sometimes nested one level deeper (a JSON *string* inside the
 * JSON), so the walker json.loads any string that mentions "cardSides".
 *
 * ── Why a server route ───────────────────────────────────────────────────
 * A browser cannot fetch quizlet.com directly (no CORS headers), so this
 * module runs SERVER-SIDE ONLY (imported by /api/import-quizlet). The
 * fetcher tries a chain of strategies: a direct request with full browser
 * headers, then public read-only relays — first one that returns real page
 * data wins. We only ever request https://quizlet.com/<numeric-id>/ so the
 * endpoint can never be abused as a generic proxy.
 *
 * This module must stay server-only (uses fetch of arbitrary remote URLs).
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
}

/* ────────────────────────────────────────────────────────────────────────
   URL handling
   ──────────────────────────────────────────────────────────────────────── */

/** Extract the numeric set id from any Quizlet URL shape:
 *    quizlet.com/1181229873/…
 *    quizlet.com/ch/1181229873/voci-mission-6-flash-cards/?i=…
 *    quizlet.com/de-de/1181229873/…
 *  A missing https:// prefix is tolerated. Returns null for non-Quizlet or
 *  non-set URLs. */
export function extractQuizletSetId(rawUrl: string): string | null {
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;
  // Only ever used to pull the numeric id out — the fetcher rebuilds the
  // canonical https://quizlet.com/<id>/ URL itself, so scheme-less input
  // (e.g. "quizlet.com/123/…") is safe to accept here.
  const normalized = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  if (!/^https?:\/\/([a-z0-9-]+\.)*quizlet\.[a-z.]+\//i.test(normalized)) return null;
  const m = normalized.match(/quizlet\.[a-z.]+\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(\d{6,})/i);
  return m ? m[1] : null;
}

/* ────────────────────────────────────────────────────────────────────────
   Fetching — direct first, then public relays as fallbacks
   ──────────────────────────────────────────────────────────────────────── */

// Full browser-like header set — maximizes the chance Quizlet's bot filter
// serves the page to a plain server-side fetch.
const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9,fr;q=0.8,de;q=0.7',
  'Cache-Control': 'no-cache',
  Pragma: 'no-cache',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
};

const FETCH_TIMEOUT_MS = 7_000;

async function fetchText(url: string): Promise<{ ok: true; body: string } | { ok: false; error: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: BROWSER_HEADERS,
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return { ok: true, body: await res.text() };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? (err.name === 'AbortError' ? 'timeout' : err.message) : 'network error',
    };
  } finally {
    clearTimeout(timer);
  }
}

// Strategy chain: (1) direct server-side fetch, (2–4) public read-only
// relays that perform the request from THEIR servers and pass the body
// through. Each hop has a different IP reputation, so if Quizlet blocks
// one, another may still succeed.
const RELAYS: Array<(u: string) => string> = [
  (u) => u,
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
  (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
];

/** Fetch the SSR HTML of a Quizlet set page; throws with a user-friendly
    message when every strategy is blocked. */
export async function fetchQuizletHtml(canonicalUrl: string): Promise<string> {
  let lastError = 'unknown error';
  for (const wrap of RELAYS) {
    const result = await fetchText(wrap(canonicalUrl));
    if (result.ok && result.body.includes('__NEXT_DATA__')) {
      return result.body;
    }
    lastError = result.ok ? 'response did not contain page data' : result.error;
  }
  throw new Error(
    `Could not load the Quizlet page (last attempt: ${lastError}). ` +
      'Quizlet may temporarily be blocking automated requests — try again in a moment, or paste the terms manually.',
  );
}

/* ────────────────────────────────────────────────────────────────────────
   Parsing
   ──────────────────────────────────────────────────────────────────────── */

interface RawCardSide {
  label?: string;
  media?: Array<{ type?: number; plainText?: string } | undefined>;
}

interface RawStudiableItem {
  rank?: number;
  isDeleted?: boolean;
  cardSides?: RawCardSide[];
}

/** Minimal HTML-entity unescape (safe order: &amp; LAST). */
function unescapeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/** Depth-first walk of the __NEXT_DATA__ tree collecting every object that
    has a cardSides array. JSON-in-JSON strings (double-escaped payloads) are
    transparently parsed and re-walked.

    Depth only counts NESTED-JSON parses (string → object), not structural
    recursion — the dehydrated payload sits dozens of object levels deep, and
    it's the parse-of-a-parse chain that could theoretically loop. */
function collectCards(node: unknown, out: RawStudiableItem[], depth = 0): void {
  if (node == null) return;
  if (typeof node === 'string') {
    if (node.includes('cardSides')) {
      if (depth > 6) return;
      try {
        collectCards(JSON.parse(node), out, depth + 1);
      } catch {
        /* not JSON after all — ignore */
      }
    }
    return;
  }
  if (Array.isArray(node)) {
    for (const v of node) collectCards(v, out, depth);
    return;
  }
  if (typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    if (Array.isArray(obj.cardSides)) {
      out.push(obj as unknown as RawStudiableItem);
      return; // card found — don't descend into its own sides
    }
    for (const v of Object.values(obj)) collectCards(v, out, depth);
  }
}

/** Concatenate the plain-text media of one card side. */
function sideText(side: RawCardSide): string {
  const texts = (side.media ?? [])
    .map((m) => (m && typeof m.plainText === 'string' ? unescapeEntities(m.plainText).trim() : ''))
    .filter(Boolean);
  return texts.join('\n');
}

/** Parse the SSR HTML of a Quizlet set page into ordered, deduplicated
    term/definition pairs. Throws when the payload is missing or empty. */
export function parseQuizletHtml(html: string, canonicalUrl: string, setId: string): QuizletImportResult {
  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) {
    throw new Error(
      "Couldn't find Quizlet's embedded card data — the page may be a verification wall. Try again shortly.",
    );
  }

  let data: unknown;
  try {
    data = JSON.parse(match[1]);
  } catch {
    throw new Error('Could not parse the Quizlet page data (unexpected response).');
  }

  const rawItems: RawStudiableItem[] = [];
  collectCards(data, rawItems);

  const titleMatch = html.match(/<meta property="og:title" content="([^"]+)"/);
  const title = titleMatch ? unescapeEntities(titleMatch[1]) : 'Quizlet set';

  const cards: QuizletCard[] = [];
  const seen = new Set<string>();
  let skipped = 0;

  rawItems
    .filter((item) => item.isDeleted !== true)
    .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
    .forEach((item) => {
      let term = '';
      let definition = '';
      for (const side of item.cardSides ?? []) {
        const text = sideText(side);
        if (side.label === 'word' && text && !term) term = text;
        else if (side.label === 'definition' && text && !definition) definition = text;
      }
      // Cards with images on the definition side but no text can't be played
      // in a typing game — count them as skipped instead of importing them.
      if (!term || !definition) {
        if (term || definition) skipped += 1;
        return;
      }
      const key = `${term}\u0000${definition}`;
      if (seen.has(key)) return; // the source set may contain exact duplicates
      seen.add(key);
      cards.push({ term, definition });
    });

  if (cards.length === 0) {
    throw new Error(
      'No term/definition pairs were found on that page. Check that the set is public and contains text cards.',
    );
  }

  return { title, url: canonicalUrl, setId, cards, skipped };
}
