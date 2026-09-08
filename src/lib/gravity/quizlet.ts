/**
 * Quizlet set importer — fetches a PUBLIC Quizlet flashcard page and extracts
 * the terms & definitions.
 *
 * ── How the parsing works ────────────────────────────────────────────────
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
 * JSON), so the walker json.parses any string that mentions "cardSides".
 *
 * ── How the page is fetched ──────────────────────────────────────────────
 * Quizlet aggressively blocks datacenter IPs (403 challenges / connection
 * timeouts), so a plain server-side fetch is only the FIRST of several
 * strategies. The chain runs in order and the first response whose body
 * contains __NEXT_DATA__ wins:
 *
 *   1. z-ai page reader  — the Z.ai "page_reader" function from the
 *                          z-ai-web-dev-sdk package. OPTIONAL: it activates
 *                          only when the package is installed AND credentials
 *                          exist (.z-ai-config in cwd/home//etc, or the
 *                          ZAI_BASE_URL + ZAI_API_KEY env vars). When it is
 *                          not configured it is skipped at zero cost. The
 *                          page_reader service fetches from different
 *                          infrastructure and gets through Quizlet's bot
 *                          wall reliably.
 *   2. direct fetch      — full browser-like headers; works from some hosts.
 *   3. web.archive.org   — latest Wayback snapshot of the set page. The `id_`
 *                          playback modifier serves the ORIGINAL page bytes
 *                          (no Wayback rewriting), so the embedded
 *                          __NEXT_DATA__ payload is intact and parseable.
 *   4. web.archive.org   — if no snapshot exists yet, ask Save-Page-Now to
 *      (Save-Page-Now)     archive the page right now, then fetch the fresh
 *                          snapshot the same way.
 *   5–7. public relays   — allorigins / r.jina.ai (HTML mode) / codetabs
 *                          read-only proxies; each one fetches from its own
 *                          IP space, so a block on one does not imply a block
 *                          on another.
 *
 * The whole chain runs inside a wall-clock budget (deadline guard) so the
 * API route always answers with a clean JSON error before the hosting
 * platform kills the function.
 *
 * We only ever request https://quizlet.com/<numeric-id>/ (plus its Wayback
 * copies) so the endpoint can never be abused as a generic proxy.
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
  /** Which fetch strategy delivered the page — surfaced in the UI status. */
  via?: string;
}

/** Options for fetchQuizletHtml — exposed for unit tests. */
export interface QuizletFetchOptions {
  /** Use the optional z-ai page_reader strategy (default: true). */
  pageReader?: boolean;
  /** web.archive.org origin (overridable in tests to point at a mock). */
  waybackBase?: string;
  /** Wall-clock budget for the entire chain (default: 55s). */
  deadlineMs?: number;
}

export interface QuizletFetchedPage {
  html: string;
  via: string;
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
   Fetch infrastructure
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

// Per-strategy hard caps (ms). Strategies also honor the global deadline —
// a strategy is skipped entirely when less than MIN_STRATEGY_BUDGET of the
// budget remains, so the route can always return a proper JSON error.
const PAGE_READER_TIMEOUT_MS = 25_000;
const DIRECT_TIMEOUT_MS = 6_000;
const WAYBACK_LATEST_TIMEOUT_MS = 20_000;
const SAVE_PAGE_NOW_TIMEOUT_MS = 40_000;
const WAYBACK_FETCH_TIMEOUT_MS = 15_000;
const CDX_TIMEOUT_MS = 8_000;
const ALLORIGINS_TIMEOUT_MS = 10_000;
const JINA_TIMEOUT_MS = 8_000;
const CODETABS_TIMEOUT_MS = 8_000;

const MIN_STRATEGY_BUDGET_MS = 3_000;
const DEFAULT_DEADLINE_MS = 55_000;
const DEFAULT_WAYBACK_BASE = 'https://web.archive.org';

type FetchOutcome = { ok: true; body: string } | { ok: false; error: string };

async function fetchText(url: string, timeoutMs: number, headers: Record<string, string> = BROWSER_HEADERS): Promise<FetchOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers,
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

/* ────────────────────────────────────────────────────────────────────────
   Strategy 1 — z-ai page reader (optional)
   ──────────────────────────────────────────────────────────────────────── */

interface ZaiPageReaderResult {
  data?: { html?: string };
}

interface ZaiClient {
  functions: { invoke: (name: string, args: unknown) => Promise<unknown> };
}

/**
 * Load the optional z-ai-web-dev-sdk and return a page_reader invoker.
 *
 * The specifier is hidden from both TypeScript and the bundler by going
 * through `new Function('return import(m)')`: the project therefore builds
 * even when the package is NOT installed, and at runtime a missing package
 * simply throws and we return null (strategy skipped). Bare specifiers in
 * this construct resolve from the process working directory, which on
 * serverless hosts is the project root — exactly where node_modules lives.
 *
 * Credentials are read from .z-ai-config by the SDK itself (cwd / home /
 * /etc). As a convenience for hosts where committing that file is
 * impractical (Vercel), ZAI_BASE_URL + ZAI_API_KEY env vars are written
 * into a config file in the home directory once, before retrying.
 */
async function loadPageReader(): Promise<ZaiClient['functions']['invoke'] | null> {
  try {
    const dynamicImport = new Function('m', 'return import(m)') as (m: string) => Promise<{
      default: { create: () => Promise<ZaiClient> };
    }>;
    let mod: { default: { create: () => Promise<ZaiClient> } };
    try {
      mod = await dynamicImport('z-ai-web-dev-sdk');
    } catch {
      // Package not installed — page reader strategy unavailable.
      return null;
    }
    try {
      const zai = await mod.default.create();
      return zai.functions.invoke;
    } catch {
      // No .z-ai-config found — retry once with env-provided credentials.
      if (process.env.ZAI_BASE_URL && process.env.ZAI_API_KEY) {
        try {
          const fs = await import('node:fs/promises');
          const os = await import('node:os');
          const path = await import('node:path');
          const cfg: Record<string, string> = {
            baseUrl: process.env.ZAI_BASE_URL,
            apiKey: process.env.ZAI_API_KEY,
          };
          if (process.env.ZAI_CHAT_ID) cfg.chatId = process.env.ZAI_CHAT_ID;
          if (process.env.ZAI_USER_ID) cfg.userId = process.env.ZAI_USER_ID;
          if (process.env.ZAI_TOKEN) cfg.token = process.env.ZAI_TOKEN;
          await fs.writeFile(path.join(os.homedir(), '.z-ai-config'), JSON.stringify(cfg), 'utf8');
          const zai = await mod.default.create();
          return zai.functions.invoke;
        } catch {
          return null;
        }
      }
      return null;
    }
  } catch {
    return null;
  }
}

async function fetchViaPageReader(url: string, budgetMs: number): Promise<FetchOutcome> {
  const invoke = await loadPageReader();
  if (!invoke) return { ok: false, error: 'page reader not configured' };
  try {
    const result = (await Promise.race([
      invoke('page_reader', { url }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), budgetMs),
      ),
    ])) as ZaiPageReaderResult;
    const html = result?.data?.html ?? '';
    if (!html) return { ok: false, error: 'page reader returned no content' };
    return { ok: true, body: html };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'page reader failed' };
  }
}

/* ────────────────────────────────────────────────────────────────────────
   Strategies 3 & 4 — web.archive.org (latest snapshot / Save-Page-Now)
   ──────────────────────────────────────────────────────────────────────── */

/**
 * Fetch the LATEST Wayback snapshot of `pageUrl` serving ORIGINAL bytes.
 * `/web/9999id_/<url>` lets Wayback pick the snapshot closest to year 9999 —
 * i.e. the most recent capture — and the `id_` modifier disables all URL/
 * markup rewriting so the response is byte-for-byte the page Quizlet served
 * to the crawler (including __NEXT_DATA__).
 */
async function fetchViaWaybackLatest(pageUrl: string, budgetMs: number, waybackBase: string): Promise<FetchOutcome> {
  return fetchText(`${waybackBase}/web/9999id_/${pageUrl}`, budgetMs);
}

/** Extract a Wayback timestamp (YYYYMMDDhhmmss…) from a URL path. */
function timestampFromWaybackUrl(url: string): string | null {
  const m = url.match(/\/web\/(\d{4,14})[^/]*\//);
  return m ? m[1] : null;
}

/**
 * No snapshot yet? Ask Save-Page-Now (anonymous GET /save/<url>) to crawl
 * the page right now, then fetch the fresh snapshot via `id_`. The save
 * request normally redirects to the playback URL of the new capture, which
 * contains its timestamp; if it only returns a "saving page now…" page we
 * poll the CDX index a couple of times instead.
 */
async function fetchViaWaybackSave(pageUrl: string, budgetMs: number, waybackBase: string): Promise<FetchOutcome> {
  const deadline = Date.now() + budgetMs;

  // Trigger the save with our own request (not fetchText) because we need
  // the FINAL redirect URL — on success SPN lands on the playback page of
  // the fresh capture, which contains its 14-digit timestamp.
  let finalUrl = '';
  let saveBody = '';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(SAVE_PAGE_NOW_TIMEOUT_MS, budgetMs));
  try {
    const res = await fetch(`${waybackBase}/save/${pageUrl}`, {
      headers: {
        ...BROWSER_HEADERS,
        // SPN occasionally refuses unusual Accept headers; keep it simple.
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    finalUrl = res.url;
    saveBody = await res.text();
    if (!res.ok) return { ok: false, error: `save-page-now: HTTP ${res.status}` };
  } catch (err) {
    return {
      ok: false,
      error: `save-page-now: ${err instanceof Error ? (err.name === 'AbortError' ? 'timeout' : err.message) : 'network error'}`,
    };
  } finally {
    clearTimeout(timer);
  }

  // Timestamp from the final redirect URL, else from the progress page body
  // (SPN's "saving page now…" HTML embeds the target playback URL).
  let ts =
    timestampFromWaybackUrl(finalUrl) ?? saveBody.match(/web\/(\d{4,14})[^\s"'<>]*\//)?.[1] ?? null;

  if (!ts) {
    // Fall back to the CDX index — poll a couple of times because the fresh
    // capture can take a few seconds to appear there.
    const indexUrl = pageUrl.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    const cdxUrl =
      `${waybackBase}/cdx/search/cdx?url=${encodeURIComponent(indexUrl)}` +
      '&matchType=prefix&output=json&fl=timestamp,original&' +
      'filter=statuscode:200&filter=mimetype:text/html&limit=-5';
    for (let attempt = 0; attempt < 2; attempt++) {
      const remaining = deadline - Date.now();
      if (remaining < 6_000) break;
      const poll = await fetchText(cdxUrl, Math.min(CDX_TIMEOUT_MS, remaining));
      if (poll.ok) {
        try {
          const rows = JSON.parse(poll.body) as string[][];
          if (rows.length > 1) {
            const last = rows[rows.length - 1];
            ts = last[0];
            // Use the exact captured URL (may be a slug variant of the set).
            const fresh = await fetchText(
              `${waybackBase}/web/${ts}id_/${last[1]}`,
              Math.min(WAYBACK_FETCH_TIMEOUT_MS, deadline - Date.now()),
            );
            return fresh.ok
              ? fresh
              : { ok: false, error: `fresh snapshot fetch: ${fresh.error}` };
          }
        } catch {
          /* CDX returned something unexpected — keep polling */
        }
      }
      await new Promise((r) => setTimeout(r, 4_000));
    }
    return { ok: false, error: 'save-page-now: capture did not complete in time' };
  }

  return fetchText(
    `${waybackBase}/web/${ts}id_/${pageUrl}`,
    Math.min(WAYBACK_FETCH_TIMEOUT_MS, Math.max(3_000, deadline - Date.now())),
  );
}

/* ────────────────────────────────────────────────────────────────────────
   Strategy chain
   ──────────────────────────────────────────────────────────────────────── */

interface Strategy {
  name: string;
  via: string;
  cap: number;
  run: (budgetMs: number) => Promise<FetchOutcome>;
}

/** Fetch the SSR HTML of a Quizlet set page; throws with a user-friendly
    message when every strategy is blocked or runs out of budget. */
export async function fetchQuizletHtml(
  canonicalUrl: string,
  opts: QuizletFetchOptions = {},
): Promise<QuizletFetchedPage> {
  const waybackBase = opts.waybackBase ?? DEFAULT_WAYBACK_BASE;
  const deadlineMs = opts.deadlineMs ?? DEFAULT_DEADLINE_MS;
  const startedAt = Date.now();
  const remaining = () => deadlineMs - (Date.now() - startedAt);

  const strategies: Strategy[] = [
    {
      name: 'z-ai page reader',
      via: 'z-ai page reader',
      cap: PAGE_READER_TIMEOUT_MS,
      run: (budget) => fetchViaPageReader(canonicalUrl, budget),
    },
    {
      name: 'direct fetch',
      via: 'direct fetch',
      cap: DIRECT_TIMEOUT_MS,
      run: (budget) => fetchText(canonicalUrl, budget),
    },
    {
      name: 'web.archive.org snapshot',
      via: 'web.archive.org snapshot',
      cap: WAYBACK_LATEST_TIMEOUT_MS,
      run: (budget) => fetchViaWaybackLatest(canonicalUrl, budget, waybackBase),
    },
    {
      name: 'web.archive.org Save-Page-Now',
      via: 'web.archive.org (just archived)',
      cap: SAVE_PAGE_NOW_TIMEOUT_MS + WAYBACK_FETCH_TIMEOUT_MS,
      run: (budget) => fetchViaWaybackSave(canonicalUrl, budget, waybackBase),
    },
    {
      name: 'allorigins relay',
      via: 'allorigins relay',
      cap: ALLORIGINS_TIMEOUT_MS,
      run: (budget) =>
        fetchText(`https://api.allorigins.win/raw?url=${encodeURIComponent(canonicalUrl)}`, budget),
    },
    {
      name: 'r.jina.ai relay',
      via: 'r.jina.ai relay',
      cap: JINA_TIMEOUT_MS,
      run: (budget) =>
        fetchText(`https://r.jina.ai/${canonicalUrl}`, budget, {
          ...BROWSER_HEADERS,
          'X-Return-Format': 'html',
        }),
    },
    {
      name: 'codetabs relay',
      via: 'codetabs relay',
      cap: CODETABS_TIMEOUT_MS,
      run: (budget) =>
        fetchText(`https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(canonicalUrl)}`, budget),
    },
  ];

  const attempted: string[] = [];
  const errors: string[] = [];
  let lastError = 'unknown error';

  for (const strategy of strategies) {
    if (strategy.name === 'z-ai page reader' && opts.pageReader === false) continue;

    const budget = Math.min(strategy.cap, remaining());
    if (budget < MIN_STRATEGY_BUDGET_MS) {
      attempted.push(`${strategy.name} (skipped: out of time)`);
      continue;
    }
    attempted.push(strategy.name);

    const result = await strategy.run(budget);
    if (result.ok && result.body.includes('__NEXT_DATA__')) {
      return { html: result.body, via: strategy.via };
    }
    lastError = result.ok ? 'response did not contain page data' : result.error;
    errors.push(`${strategy.name}: ${lastError}`);

    // Out of budget — don't start any further strategy.
    if (remaining() < MIN_STRATEGY_BUDGET_MS) break;
  }

  const detail = errors.length > 0 ? errors[errors.length - 1] : lastError;
  throw new Error(
    `Could not load the Quizlet page (tried ${attempted.join(', ')}; last error: ${detail}). ` +
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
