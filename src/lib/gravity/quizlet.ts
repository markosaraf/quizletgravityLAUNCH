/**
 * Quizlet set importer — fetches a PUBLIC Quizlet flashcard page and extracts
 * the terms & definitions.
 *
 * ── How the parsing works ────────────────────────────────────────────────
 * Three payload shapes are supported, and the fetch chain tags which one it
 * delivered:
 *
 *   format 'html'       — the raw SSR page. Quizlet embeds the full card data
 *                         in a <script id="__NEXT_DATA__"> JSON blob:
 *
 *                           { "rank": 0, "isDeleted": false,
 *                             "cardSides": [
 *                               { "label": "word",       "media": [{ "plainText": "accueillir" }] },
 *                               { "label": "definition", "media": [{ "plainText": "empfangen"  }] } ] }
 *
 *                         The blob is sometimes nested one level deeper (a JSON
 *                         *string* inside the JSON), so the walker json.parses
 *                         any string that mentions "cardSides".
 *
 *   format 'reader-md'  — a reader's markdown rendering of the page (z.ai web
 *                         reader or r.jina.ai). Quizlet server-renders a
 *                         "Terms in this set (N)" section whose entries are
 *                         blank-line separated and strictly alternate term /
 *                         definition, so pairs are reconstructed positionally
 *                         and validated against the announced count N.
 *                         IMPORTANT: the heading is rendered in the UI locale
 *                         of the page (quizlet.com/ch/… may serve German
 *                         "Begriffe in diesem Set (N)" or French "Termes de
 *                         cet ensemble (N)") — the matcher below is
 *                         locale-aware.
 *
 *   format 'webapi-json' — Quizlet's own internal JSON API used by its web
 *                         app (webapi/3.9/studiable-item-documents). Returns
 *                         the SAME studiableItem objects as __NEXT_DATA__
 *                         (cardSides / rank / isDeleted), paginated. The
 *                         strategy concatenates pages, the parser reuses the
 *                         shared cardSides walker.
 *
 * ── How the page is fetched ──────────────────────────────────────────────
 * Quizlet sits behind aggressive Cloudflare bot protection. Since 2026 it
 * challenges essentially ALL datacenter IPs (Vercel/Netlify serverless, the
 * public CORS relays, AI-reader crawlers, even Google's translate.goog):
 * requests get HTTP 403 or the "Just a moment…" JS challenge page, which no
 * plain server can solve. The challenge outcome is INTERMITTENT — the same
 * URL that is challenged now is often served seconds later (egress IP /
 * clearance rotation on the crawler pool) — so a chain of independent
 * strategies is tried in order, and the first usable payload wins:
 *
 *   1. r.jina.ai reader — WITH JINA_API_KEY (free tier available). Jina
 *                         renders pages with real headless browsers and
 *                         passes Cloudflare for most sites, so this is the
 *                         single most reliable server-side path. HTML first
 *                         (carries __NEXT_DATA__), markdown as fallback.
 *                         Without a key the no-auth endpoint is tried late in
 *                         the chain as a cheap hail-mary.
 *   2. z.ai web reader  — official Web Reader REST API (POST {base}/reader,
 *                         docs.z.ai/api-reference/tools/web-reader). Optional:
 *                         activates when ZAI_API_KEY is set; ZAI_BASE_URL
 *                         overrides the default https://api.z.ai/api/paas/v4.
 *                         PERSISTENT MARKDOWN-FIRST: up to THREE markdown
 *                         passes across TWO URL variants (the user's slug
 *                         path and the bare canonical), spaced 2.5s/4s apart,
 *                         then one leftover-budget 'html' attempt. Billing
 *                         caveat: the reader bills the pay-as-you-go API
 *                         wallet (GLM Coding Plan credits do NOT cover it);
 *                         on error 1113 the chain moves on quietly.
 *   3. direct fetch     — full browser-like headers; occasionally works.
 *   4. webapi JSON      — Quizlet's internal JSON API, direct and via
 *                         allorigins (JSON payloads are smaller and slip past
 *                         crowded relays more often than 500 KB HTML pages).
 *   5. web.archive.org  — latest Wayback snapshot (both the bare /<id>/ and
 *                         the /<id>/flash-cards/ URL form — Wayback keeps
 *                         redirect captures separately, so one form can have
 *                         a real capture when the other only has a 302). The
 *                         `id_` playback modifier serves ORIGINAL bytes, so
 *                         __NEXT_DATA__ survives.
 *   6. Save-Page-Now    — if nothing is archived yet, ask Wayback to capture
 *                         the page now, then fetch the fresh snapshot.
 *   7. public relays    — allorigins (HTML) / jina without key / codetabs.
 *                         These relays fetch from their own IP space, so a
 *                         block on one does not imply a block on another —
 *                         but expect most of them to be challenged too.
 *
 * Responses that smell like a Cloudflare challenge ("Just a moment…",
 * challenge-platform, cf-chl…) are detected explicitly and reported as
 * "blocked by Cloudflare challenge" instead of a generic parse failure.
 *
 * The whole chain runs inside a wall-clock budget (deadline guard) so the
 * API route always answers with a clean JSON error before the hosting
 * platform kills the function. Missing configuration (ZAI_API_KEY,
 * JINA_API_KEY) is reported EXPLICITLY in the error message — a silently
 * skipped strategy is indistinguishable from a mysteriously broken one when
 * debugging a deploy.
 *
 * We only ever request https://quizlet.com/<numeric-id>/ URLs (plus their
 * Wayback copies and their webapi JSON), so the endpoint can never be abused
 * as a generic proxy.
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

/** Options for fetchQuizletPage — exposed for unit tests. */
export interface QuizletFetchOptions {
  /** Use the optional z.ai web reader strategy (default: true). */
  pageReader?: boolean;
  /** The user's original pasted link. Its slug path (same host, query/hash
   *  stripped) is tried FIRST by reader strategies — it skips one redirect
   *  hop and pins the locale the user actually saw. */
  originalUrl?: string;
  /** web.archive.org origin (overridable in tests to point at a mock). */
  waybackBase?: string;
  /** Wall-clock budget for the entire chain (default: 55s). */
  deadlineMs?: number;
}

/** The payload shapes the chain can deliver. */
export type QuizletPayloadFormat = 'html' | 'reader-md' | 'webapi-json';

export interface QuizletFetchedPage {
  /** Raw page HTML ('html'), reader markdown ('reader-md') or webapi JSON ('webapi-json'). */
  payload: string;
  format: QuizletPayloadFormat;
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

/** URL variants for reader-based strategies: the slug path of the user's
 *  original link (same host, query/hash stripped) plus the canonical bare
 *  set URL. Different Quizlet edge nodes can answer for each form. */
function buildReaderUrls(canonicalUrl: string, originalUrl?: string): string[] {
  const urls = [canonicalUrl];
  if (originalUrl) {
    const trimmed = originalUrl.trim();
    const normalized = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    if (/^https?:\/\/([a-z0-9-]+\.)*quizlet\.[a-z.]+\//i.test(normalized)) {
      try {
        const u = new URL(normalized);
        const slug = `${u.origin}${u.pathname}`;
        if (!urls.includes(slug)) urls.unshift(slug); // slug first — no redirect
      } catch {
        /* ignore malformed input */
      }
    }
  }
  return urls;
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
const JINA_KEYED_TIMEOUT_MS = 25_000;
const ZAI_READER_TIMEOUT_MS = 34_000;
const DIRECT_TIMEOUT_MS = 5_000;
const WEBAPI_DIRECT_TIMEOUT_MS = 7_000;
const WEBAPI_RELAY_TIMEOUT_MS = 14_000;
const ALLORIGINS_TIMEOUT_MS = 12_000;
const WAYBACK_LATEST_TIMEOUT_MS = 16_000;
const SAVE_PAGE_NOW_TIMEOUT_MS = 40_000;
const WAYBACK_FETCH_TIMEOUT_MS = 12_000;
const CDX_TIMEOUT_MS = 8_000;
const JINA_FREE_TIMEOUT_MS = 8_000;
const CODETABS_TIMEOUT_MS = 8_000;

const MIN_STRATEGY_BUDGET_MS = 3_000;
const DEFAULT_DEADLINE_MS = 55_000;
const DEFAULT_WAYBACK_BASE = 'https://web.archive.org';

type FetchOutcome =
  | { ok: true; body: string; /** Set by reader/markdown strategies. */ format?: QuizletPayloadFormat }
  | {
      ok: false;
      error: string;
      /** Z.ai rejected the call with 1113-style "no balance / no resource
          package" — the key is VALID, the reader just isn't covered by the
          Coding Plan (it bills the separate pay-as-you-go API wallet). */
      billingBlocked?: boolean;
      /** The upstream answered with a Cloudflare "Just a moment…" challenge
          page — i.e. the path is ALIVE but bot-blocked. Lets the final error
          say something actionable instead of a generic timeout. */
      cloudflareBlocked?: boolean;
    };

/** Detect Cloudflare's interstitial challenge page (it can arrive as HTTP 403
    OR as HTTP 200 when a reader helpfully renders the challenge for us). */
function isCloudflareChallenge(body: string): boolean {
  return (
    /<title>[^<]*Just a moment[^<]*<\/title>/i.test(body) ||
    /challenge-platform\/(?:h\/b|scripts)/i.test(body) ||
    /window\._cf_chl|window\.__cf_chl|cf_chl_opt/i.test(body) ||
    /"firewall_manager"|Checking your browser|Attention Required!/i.test(body)
  );
}

/* ────────────────────────────────────────────────────────────────────────
   Terms-section heading (locale-aware)
   ──────────────────────────────────────────────────────────────────────── */

/** Quizlet renders the terms-section heading in the UI language of the page
 *  — and a reader's crawler may be geo-routed to a non-English locale (e.g.
 *  quizlet.com/ch/… serves German or French UI). A reader payload from such
 *  a page contains a LOCALIZED heading, so validation and parsing must match
 *  it. Each entry captures the announced count N. */
const TERMS_HEADER_RES: RegExp[] = [
  /Terms in this set \((\d+)\)/i, // en
  /Begriffe in diesem Set \((\d+)\)/i, // de
  /Termes de cet ensemble \((\d+)\)/i, // fr
  /Términos en este conjunto \((\d+)\)/i, // es
  /Termini in questo set \((\d+)\)/i, // it
  /Termos deste conjunto \((\d+)\)/i, // pt
  /Termen in deze set \((\d+)\)/i, // nl
  /Pojęcia w tym zestawie \((\d+)\)/i, // pl
  /Bu setteki terimler \((\d+)\)/i, // tr
  /Термины в этом наборе \((\d+)\)/i, // ru
];

/** True when the body contains a recognized (possibly localized) terms
 *  heading — used both to validate reader markdown and to parse it. */
function hasTermsHeader(body: string): boolean {
  return TERMS_HEADER_RES.some((re) => re.test(body));
}

async function fetchText(
  url: string,
  timeoutMs: number,
  headers: Record<string, string> = BROWSER_HEADERS,
): Promise<FetchOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers,
      redirect: 'follow',
      signal: controller.signal,
    });
    const body = await res.text();
    if (isCloudflareChallenge(body)) {
      return {
        ok: false,
        cloudflareBlocked: true,
        error: `blocked by Quizlet's Cloudflare challenge (HTTP ${res.status} "Just a moment…" page)`,
      };
    }
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return { ok: true, body };
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
   Strategy 1a — r.jina.ai reader (best path when JINA_API_KEY is set)
   ──────────────────────────────────────────────────────────────────────── */

/**
 * Fetch `url` through r.jina.ai. Jina renders the page with real headless
 * browsers (which execute — and usually pass — Cloudflare's challenge), so
 * with a key this is the most dependable server-side route to a full SSR
 * payload. Free keys: https://jina.ai/reader (rate-limited, no cost).
 *
 *   JINA_API_KEY   (optional) enables the high-priority keyed strategy
 *
 * HTML is requested first because it carries __NEXT_DATA__; markdown (parsed
 * by parseQuizletMarkdown) is the fallback when the HTML pass fails.
 */
async function fetchViaJina(
  url: string,
  mode: 'html' | 'markdown',
  budgetMs: number,
): Promise<FetchOutcome> {
  const apiKey = (process.env.JINA_API_KEY ?? '').trim();
  const headers: Record<string, string> = {
    'User-Agent': BROWSER_HEADERS['User-Agent'],
    'X-Return-Format': mode,
    'X-Timeout': '20',
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const outcome = await fetchText(`https://r.jina.ai/${url}`, budgetMs, headers);
  if (outcome.ok) outcome.format = mode === 'html' ? 'html' : 'reader-md';
  return outcome;
}

/* ────────────────────────────────────────────────────────────────────────
   Strategy 1b — z.ai web reader (official public REST API, optional)
   ──────────────────────────────────────────────────────────────────────── */

/**
 * Build the Web Reader endpoint from a configured base URL. Accepted shapes
 * (trailing slashes tolerated):
 *   https://api.z.ai               → https://api.z.ai/api/paas/v4/reader
 *   https://api.z.ai/api           → https://api.z.ai/api/paas/v4/reader
 *   https://api.z.ai/api/paas/v4   → https://api.z.ai/api/paas/v4/reader
 *   …anything ending in /reader    → kept as-is (already the full endpoint)
 * Exported for unit tests.
 */
export function zaiReaderEndpoint(baseUrl: string): string {
  let b = baseUrl.replace(/\/+$/, '');
  if (/\/reader$/i.test(b)) return b;
  // Tolerate the documented server root (…/api) as well as the
  // OpenAI-style base (…/api/paas/v4) — both must land on the same endpoint.
  b = b.replace(/\/api$/i, '');
  if (/\/paas\/v4$/i.test(b)) return `${b}/reader`;
  return `${b}/api/paas/v4/reader`;
}

interface ZaiReaderResponse {
  reader_result?: { content?: string; title?: string; url?: string };
  error?: { code?: number | string; message?: string };
  code?: number | string;
  msg?: string;
}

/** True for Z.ai error 1113 ("Insufficient balance or no resource package.
 *  Please recharge.") — the Web Reader is a pay-as-you-go tool billed from
 *  the API wallet, so GLM Coding Plan credits never cover it. */
function isZaiBillingError(code: unknown, message: unknown): boolean {
  const codeStr = String(code ?? '');
  const msg = String(message ?? '');
  return codeStr === '1113' || /insufficient balance|resource package|please recharge/i.test(msg);
}

/**
 * ONE Web Reader POST with a fixed return_format. Success is validated from
 * the BODY, not the status code — this API has been observed to answer
 * HTTP 200 in two degenerate ways:
 *   a) with an error JSON body (billing/auth errors), and
 *   b) with NEITHER reader_result NOR an error — an empty task receipt
 *      (observed for return_format:'html' on Quizlet's heavy pages).
 * Case (b) is reported as an empty result so the caller can try a
 * different format instead of giving up.
 */
async function zaiReaderCall(
  endpoint: string,
  apiKey: string,
  url: string,
  returnFormat: 'html' | 'markdown',
  budgetMs: number,
): Promise<FetchOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), budgetMs);
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        url,
        return_format: returnFormat,
        timeout: 25, // reader-side fetch timeout, in seconds
      }),
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!res.ok) {
      const raw = await res.text().catch(() => '');
      let code: unknown;
      let message: unknown;
      try {
        const parsed = JSON.parse(raw) as ZaiReaderResponse;
        code = parsed.error?.code ?? parsed.code;
        message = parsed.error?.message ?? parsed.msg;
      } catch {
        /* body was not JSON — fall through to the raw text below */
      }
      const detail = (typeof message === 'string' && message) || raw.slice(0, 160);
      const cloudflareBlocked = isCloudflareChallenge(raw);
      return {
        ok: false,
        billingBlocked: isZaiBillingError(code, message ?? raw),
        cloudflareBlocked,
        error: `HTTP ${res.status}${detail ? ` — ${detail}` : ''}`,
      };
    }
    const json = (await res.json().catch(() => null)) as ZaiReaderResponse | null;
    if (!json) return { ok: false, error: 'unreadable response body' };
    const content = json.reader_result?.content ?? '';
    if (!content) {
      const code = json.error?.code ?? json.code;
      const message = json.error?.message ?? json.msg;
      // Degenerate empty task receipt (no error keys, no content)?
      if (code === undefined && !message) {
        return { ok: false, error: `empty result (format '${returnFormat}' not fulfilled)` };
      }
      const detail = message ?? (code !== undefined ? `code ${code}` : 'no content');
      return {
        ok: false,
        billingBlocked: isZaiBillingError(code, message),
        error: `web reader: ${detail}`,
      };
    }
    // The reader happily renders Cloudflare's interstitial — detect it so the
    // caller retries instead of treating the challenge as page content.
    if (isCloudflareChallenge(content)) {
      return { ok: false, cloudflareBlocked: true, error: "reader got Cloudflare's 'Just a moment…' challenge page" };
    }
    return { ok: true, body: content };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? (err.name === 'AbortError' ? 'timeout' : err.message) : 'network error',
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch the set through Z.ai's documented Web Reader endpoint
 * (POST {base}/reader — https://docs.z.ai/api-reference/tools/web-reader).
 *
 * Credentials come from the environment — NO SDK package required:
 *   ZAI_API_KEY   (required)  key from https://z.ai/manage-apikey/apikey-list
 *   ZAI_BASE_URL  (optional)  default https://api.z.ai/api/paas/v4
 *
 * PERSISTENT MARKDOWN-FIRST STRATEGY: Quizlet's Cloudflare challenges the
 * reader's crawler INTERMITTENTLY — the same URL that returns the
 * "Just a moment…" page on one attempt is often served properly seconds
 * later (egress IP / clearance rotation). The strategy therefore makes up to
 * THREE markdown passes across the URL variants (slug path + bare
 * canonical), spaced 2.5 s / 4 s apart, before one final 'html' attempt
 * (observed to answer with empty task receipts for Quizlet pages, so it only
 * gets the leftover budget). A markdown pass that DID return a real page but
 * lacks a recognized (possibly localized) terms heading is treated as a miss
 * and the loop continues.
 *
 * Billing rejections (error 1113) abort immediately — a second paid call
 * would fail identically.
 */
async function fetchViaZaiReader(urls: string[], budgetMs: number): Promise<FetchOutcome> {
  const apiKey = (process.env.ZAI_API_KEY ?? '').trim();
  if (!apiKey) return { ok: false, error: 'ZAI_API_KEY not set on the server' };
  const endpoint = zaiReaderEndpoint((process.env.ZAI_BASE_URL || 'https://api.z.ai/api/paas/v4').trim());

  const primary = urls[0];
  const secondary = urls[1] ?? urls[0];
  const attempts: Array<{ url: string; format: 'markdown' | 'html'; delayBeforeMs: number; share: number }> = [
    { url: primary, format: 'markdown', delayBeforeMs: 0, share: 0.28 },
    { url: secondary, format: 'markdown', delayBeforeMs: 2_500, share: 0.28 },
    { url: primary, format: 'markdown', delayBeforeMs: 4_000, share: 0.28 },
    { url: primary, format: 'html', delayBeforeMs: 0, share: 0.16 },
  ];

  // Simple sequential accounting: spent tracks the budget consumed so far.
  let spent = 0;
  const take = (want: number) => Math.max(MIN_STRATEGY_BUDGET_MS, Math.min(want, budgetMs - spent));

  let last: FetchOutcome | null = null;
  for (const attempt of attempts) {
    if (attempt.delayBeforeMs > 0) {
      if (budgetMs - spent < attempt.delayBeforeMs + MIN_STRATEGY_BUDGET_MS) break;
      await new Promise((r) => setTimeout(r, attempt.delayBeforeMs));
      spent += attempt.delayBeforeMs;
    }
    const budget = take(Math.floor(budgetMs * attempt.share));
    if (budget < MIN_STRATEGY_BUDGET_MS || budgetMs - spent < MIN_STRATEGY_BUDGET_MS) break;
    spent += budget;

    const outcome = await zaiReaderCall(endpoint, apiKey, attempt.url, attempt.format, budget);
    if (outcome.ok) {
      if (attempt.format === 'markdown') {
        if (hasTermsHeader(outcome.body)) {
          return { ok: true, body: outcome.body, format: 'reader-md' };
        }
        // The reader returned a page but no recognized terms heading
        // (a shell page, or a locale not covered by the matcher) — try the
        // next attempt instead of giving up.
        last = {
          ok: false,
          error: "markdown had no recognized 'Terms in this set (N)' heading (localized UI or shell page)",
        };
        continue;
      }
      // html attempt — only useful when __NEXT_DATA__ made it through.
      if (outcome.body.includes('__NEXT_DATA__')) {
        return { ok: true, body: outcome.body, format: 'html' };
      }
      last = { ok: false, error: 'html had no embedded page data' };
      continue;
    }
    // Billing rejections make every further attempt pointless.
    if (outcome.billingBlocked) return outcome;
    last = outcome;
  }
  return last ?? { ok: false, error: 'no reader attempts executed' };
}

/* ────────────────────────────────────────────────────────────────────────
   Strategy 2 — Quizlet's internal webapi JSON (direct + via allorigins)
   ──────────────────────────────────────────────────────────────────────── */

/** Build one webapi page request for a set. Same endpoint Quizlet's own web
    app calls; public sets answer without auth (when Cloudflare lets the
    request through). */
function webapiUrl(setId: string, page: number): string {
  const filters =
    `filters%5BstudiableContainerId%5D=${encodeURIComponent(setId)}` +
    `&filters%5BstudiableContainerType%5D=1`;
  return `https://quizlet.com/webapi/3.9/studiable-item-documents?${filters}&perPage=100&page=${page}`;
}

/** Wrap a URL in a relay transport, or pass it through for 'direct'. */
function viaTransport(transport: 'direct' | 'allorigins', url: string): string {
  return transport === 'direct' ? url : `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
}

function parseWebapiPage(body: string): { items: unknown[]; total: number | null } {
  const json = JSON.parse(body) as {
    responses?: Array<{
      models?: { studiableItems?: unknown[] };
      paging?: { correction?: { total?: number } };
    }>;
  };
  const resp = json?.responses?.[0];
  const items = resp?.models?.studiableItems;
  if (!Array.isArray(items)) throw new Error('webapi response has no studiableItems');
  const total = resp?.paging?.correction?.total ?? null;
  return { items, total: typeof total === 'number' ? total : null };
}

/**
 * Fetch ALL studiable items for a set through Quizlet's internal JSON API,
 * using `transport` (direct server-side fetch, or the allorigins relay).
 * Pages of 100 items are concatenated until the announced total is reached
 * (hard cap 8 pages / 800 cards) or the budget runs out. Returns a
 * 'webapi-json' payload: a JSON array string of raw studiableItems, which
 * parseWebapiJson() feeds into the shared cardSides walker.
 */
async function fetchViaWebapi(
  setId: string,
  transport: 'direct' | 'allorigins',
  budgetMs: number,
): Promise<FetchOutcome> {
  const deadline = Date.now() + budgetMs;
  const headers: Record<string, string> = {
    ...BROWSER_HEADERS,
    Accept: 'application/json',
    Referer: `https://quizlet.com/${setId}/`,
  };

  const allItems: unknown[] = [];
  let total: number | null = null;
  const maxPages = 8;

  for (let page = 1; page <= maxPages; page++) {
    const pageBudget = Math.min(transport === 'direct' ? 7_000 : 14_000, deadline - Date.now());
    if (pageBudget < MIN_STRATEGY_BUDGET_MS) break;
    const outcome = await fetchText(viaTransport(transport, webapiUrl(setId, page)), pageBudget, headers);
    if (!outcome.ok) {
      // Page 1 failing means the whole strategy failed; a later page failing
      // just ends pagination — keep the partial result we already have.
      if (page === 1) {
        return { ok: false, cloudflareBlocked: outcome.cloudflareBlocked, error: outcome.error };
      }
      break;
    }
    let parsed: { items: unknown[]; total: number | null };
    try {
      parsed = parseWebapiPage(outcome.body);
    } catch {
      if (page === 1) {
        return { ok: false, error: 'webapi answered with unexpected JSON (no studiableItems)' };
      }
      break; // keep the earlier pages
    }
    allItems.push(...parsed.items);
    total = parsed.total ?? total;
    // Full page fetched and the announced total not yet reached → keep going.
    const fullPage = parsed.items.length >= 100;
    if (!fullPage || (total !== null && allItems.length >= total)) break;
  }

  if (allItems.length === 0) {
    return { ok: false, error: 'webapi returned 0 studiable items' };
  }
  return {
    ok: true,
    body: JSON.stringify(allItems),
    format: 'webapi-json',
  };
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
 *
 * BOTH URL forms of the set are tried (bare /<id>/ and /<id>/flash-cards/):
 * Wayback stores redirect captures separately, so the bare form can hold a
 * mere 302 record whose Location leaves the archive while the flash-cards
 * form holds the real page.
 */
async function fetchViaWaybackLatest(pageUrl: string, budgetMs: number, waybackBase: string): Promise<FetchOutcome> {
  const variants = [pageUrl, `${pageUrl.replace(/\/+$/, '')}/flash-cards/`];
  let last: FetchOutcome = { ok: false, error: 'not attempted' };
  for (let i = 0; i < variants.length; i++) {
    const remaining = budgetMs - (i * budgetMs) / variants.length;
    if (remaining < MIN_STRATEGY_BUDGET_MS) break;
    last = await fetchText(`${waybackBase}/web/9999id_/${variants[i]}`, Math.floor(remaining));
    if (last.ok && last.body.includes('__NEXT_DATA__')) return last;
    // A 200 without page data (e.g. an archived challenge page) — try the
    // next variant before giving up.
  }
  return last;
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
  /** When true the strategy is skipped (with a visible note) unless its env
      var is configured on the server. */
  requiresEnv?: { name: string; value: string };
  run: (budgetMs: number) => Promise<FetchOutcome>;
}

/** Fetch a parseable Quizlet set payload (raw HTML, reader markdown or
    webapi JSON); throws with a user-friendly, diagnostic message when every
    strategy is blocked, misconfigured, or runs out of budget. */
export async function fetchQuizletPage(
  canonicalUrl: string,
  opts: QuizletFetchOptions = {},
): Promise<QuizletFetchedPage> {
  const setId = extractQuizletSetId(canonicalUrl);
  if (!setId) throw new Error(`Internal error: '${canonicalUrl}' is not a canonical Quizlet set URL.`);

  const waybackBase = opts.waybackBase ?? DEFAULT_WAYBACK_BASE;
  const deadlineMs = opts.deadlineMs ?? DEFAULT_DEADLINE_MS;
  const startedAt = Date.now();
  const remaining = () => deadlineMs - (Date.now() - startedAt);

  // Reader strategies get both the user's slug path (preferred — no redirect
  // hop, locale pinned) and the bare canonical URL.
  const readerUrls = buildReaderUrls(canonicalUrl, opts.originalUrl);

  const strategies: Strategy[] = [
    {
      name: 'jina reader (JINA_API_KEY)',
      via: 'jina reader',
      cap: JINA_KEYED_TIMEOUT_MS,
      requiresEnv: { name: 'JINA_API_KEY', value: (process.env.JINA_API_KEY ?? '').trim() },
      run: (budget) => fetchViaJina(readerUrls[0], 'html', budget),
    },
    {
      name: 'z-ai web reader',
      via: 'z-ai web reader',
      cap: ZAI_READER_TIMEOUT_MS,
      requiresEnv: { name: 'ZAI_API_KEY', value: (process.env.ZAI_API_KEY ?? '').trim() },
      run: (budget) => (opts.pageReader === false
        ? Promise.resolve({ ok: false, error: 'disabled' })
        : fetchViaZaiReader(readerUrls, budget)),
    },
    {
      name: 'direct fetch',
      via: 'direct fetch',
      cap: DIRECT_TIMEOUT_MS,
      run: (budget) => fetchText(canonicalUrl, budget),
    },
    {
      name: 'quizlet webapi (direct)',
      via: 'quizlet webapi (direct)',
      cap: WEBAPI_DIRECT_TIMEOUT_MS,
      run: (budget) => fetchViaWebapi(setId, 'direct', budget),
    },
    {
      name: 'quizlet webapi (allorigins relay)',
      via: 'quizlet webapi (allorigins relay)',
      cap: WEBAPI_RELAY_TIMEOUT_MS,
      run: (budget) => fetchViaWebapi(setId, 'allorigins', budget),
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
      name: 'r.jina.ai relay (markdown)',
      via: 'r.jina.ai relay',
      cap: JINA_FREE_TIMEOUT_MS,
      run: (budget) => fetchViaJina(readerUrls[0], 'markdown', budget),
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
  // Remember whether ANY strategy reported the Cloudflare challenge — the
  // final message should name the real adversary instead of a generic
  // "try again later".
  let anyCloudflare = false;
  // The reader is the one strategy whose failure is usually actionable
  // (missing key, no balance, wrong base URL) — remember its outcome for the
  // final diagnosis even when later strategies fail for other reasons.
  let readerError: string | null = null;
  // Set when the z.ai reader was rejected for billing reasons (error 1113) —
  // surfaced as a friendly tip at the end of the error message.
  let zaiBillingHint: string | null = null;

  for (const strategy of strategies) {
    if (strategy.requiresEnv) {
      if (!strategy.requiresEnv.value) {
        // VISIBLE skip — a missing env var on the hosting platform must
        // never look like the strategy "mysteriously" never ran.
        attempted.push(`${strategy.name} (skipped: ${strategy.requiresEnv.name} not set on the server)`);
        continue;
      }
    }
    if (strategy.name === 'z-ai web reader' && opts.pageReader === false) {
      attempted.push('z-ai web reader (skipped: disabled)');
      continue;
    }

    const budget = Math.min(strategy.cap, remaining());
    if (budget < MIN_STRATEGY_BUDGET_MS) {
      attempted.push(`${strategy.name} (skipped: out of time)`);
      continue;
    }
    attempted.push(strategy.name);

    const result = await strategy.run(budget);
    const usable =
      result.ok &&
      (result.format === 'webapi-json' ||
        (result.format === 'reader-md' && hasTermsHeader(result.body)) ||
        (result.format === 'html' && result.body.includes('__NEXT_DATA__')));
    if (result.ok && usable) {
      return { payload: result.body, format: result.format ?? 'html', via: strategy.via };
    }
    lastError = result.ok ? 'response did not contain page data' : result.error;
    if (!result.ok && result.cloudflareBlocked) anyCloudflare = true;
    errors.push(`${strategy.name}: ${lastError}`);
    if (strategy.name === 'z-ai web reader') {
      readerError = lastError;
    }
    if (!result.ok && result.billingBlocked) {
      zaiBillingHint =
        'Tip: your ZAI_API_KEY is valid, but the z.ai Web Reader reports no balance or resource package for it ' +
        '(error 1113 — GLM Coding Plan credits do not cover the reader; it bills the separate pay-as-you-go API wallet), ' +
        'so the import used the credential-free fallbacks. ' +
        'To enable the reader, top up your API wallet or buy a resource package in the z.ai console.';
    }

    // Out of budget — don't start any further strategy.
    if (remaining() < MIN_STRATEGY_BUDGET_MS) break;
  }

  const detail = errors.length > 0 ? errors[errors.length - 1] : lastError;
  const readerDiag = readerError ? ` z-ai web reader: ${readerError}.` : '';
  const cfDiag = anyCloudflare
    ? ' At least one path reached Quizlet but was stopped by its Cloudflare bot protection — free server-side fetches are expected to fail against this.'
    : '';
  throw new Error(
    `Could not load the Quizlet page (tried ${attempted.join(', ')}).${readerDiag} Last error: ${detail}.${cfDiag} ` +
      'Quizlet blocks datacenter IPs with Cloudflare, so server-side imports are best-effort: set the JINA_API_KEY env var (free key from jina.ai/reader) for the reliable browser-rendered path, retry in a moment, or paste the terms manually.' +
      (zaiBillingHint ? ` ${zaiBillingHint}` : ''),
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

/** Depth-first walk of a parsed-JSON tree collecting every object that has a
    cardSides array. JSON-in-JSON strings (double-escaped payloads) are
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

/** Shared post-processing for raw studiableItems (any payload format):
    filter deleted, sort by rank, extract word/definition sides, drop
    image-only cards, dedupe exact duplicates. */
function buildCardsFromRawItems(rawItems: RawStudiableItem[]): { cards: QuizletCard[]; skipped: number } {
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

  return { cards, skipped };
}

/** Parse the raw SSR HTML of a Quizlet set page (payload format 'html') into
    ordered, deduplicated term/definition pairs. Throws when the payload is
    missing or empty. */
export function parseQuizletHtml(html: string, canonicalUrl: string, setId: string): QuizletImportResult {
  if (isCloudflareChallenge(html)) {
    throw new Error(
      "Quizlet answered with its Cloudflare 'Just a moment…' bot-check instead of the page. Try again shortly.",
    );
  }
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

  const { cards, skipped } = buildCardsFromRawItems(rawItems);
  if (cards.length === 0) {
    throw new Error(
      'No term/definition pairs were found on that page. Check that the set is public and contains text cards.',
    );
  }

  return { title, url: canonicalUrl, setId, cards, skipped };
}

/** Parse the 'webapi-json' payload produced by fetchViaWebapi() — a JSON
    array string of raw studiableItems in the same shape as the
    __NEXT_DATA__ entries (cardSides / rank / isDeleted). */
export function parseWebapiJson(payload: string, canonicalUrl: string, setId: string): QuizletImportResult {
  let data: unknown;
  try {
    data = JSON.parse(payload);
  } catch {
    throw new Error('Could not parse the Quizlet API response.');
  }

  const rawItems: RawStudiableItem[] = [];
  collectCards(data, rawItems);

  const { cards, skipped } = buildCardsFromRawItems(rawItems);
  if (cards.length === 0) {
    throw new Error(
      'No term/definition pairs were found in the Quizlet API response. Check that the set is public and contains text cards.',
    );
  }

  return { title: 'Quizlet set', url: canonicalUrl, setId, cards, skipped };
}

/** Parse a reader's markdown rendering of a Quizlet set page (payload format
    'reader-md').

    Quizlet server-renders a terms section whose heading is localized (e.g.
    "Terms in this set (62)" in English, "Begriffe in diesem Set (62)" in
    German, "Termes de cet ensemble (62)" in French) and whose entries are
    blank-line separated and strictly alternate term / definition:

        Terms in this set (62)

        accueillir

        empfangen

        le client, la cliente

        der Kunde, die Kundin

    The pairs are therefore reconstructed positionally: split the section on
    blank lines (dropping image-only blocks), pair the blocks (even = term,
    odd = definition), then dedupe exact duplicates. The announced count N
    is used to report how many cards could not be recovered as text. */
export function parseQuizletMarkdown(markdown: string, canonicalUrl: string, setId: string): QuizletImportResult {
  if (isCloudflareChallenge(markdown)) {
    throw new Error(
      "The reader received Quizlet's Cloudflare 'Just a moment…' bot-check instead of the set. Try again shortly.",
    );
  }
  // Locale-aware heading match — see TERMS_HEADER_RES for the covered UI
  // languages (Quizlet geo-routes crawlers to localized pages).
  let header: RegExpMatchArray | null = null;
  for (const re of TERMS_HEADER_RES) {
    header = markdown.match(re);
    if (header) break;
  }
  if (!header) {
    throw new Error(
      "Couldn't find the terms list in the Quizlet page text — the set may be private, empty, not a flashcard set, or rendered in an unsupported UI language.",
    );
  }
  const expected = Number(header[1]);

  const start = (header.index ?? 0) + header[0].length;
  const afterHeader = markdown.slice(start);
  // The list ends at the next markdown heading ("Students also viewed",
  // footer sections, …) — everything before it belongs to the cards.
  const nextHeading = afterHeader.search(/\n#{1,6} /);
  const section = nextHeading === -1 ? afterHeader : afterHeader.slice(0, nextHeading);

  const blocks = section
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter((b) => b.length > 0 && !b.startsWith('![')); // drop image-only blocks

  const titleMatch = markdown.match(/^# (.+)$/m);
  const title = titleMatch ? unescapeEntities(titleMatch[1].trim()) : 'Quizlet set';

  const cards: QuizletCard[] = [];
  const seen = new Set<string>();
  let rawPairs = 0;

  for (let i = 0; i + 1 < blocks.length; i += 2) {
    const term = unescapeEntities(blocks[i]);
    const definition = unescapeEntities(blocks[i + 1]);
    if (!term || !definition) continue;
    rawPairs += 1;
    const key = `${term}\u0000${definition}`;
    if (seen.has(key)) continue; // the source set may contain exact duplicates
    seen.add(key);
    cards.push({ term, definition });
  }

  const skipped = Math.max(0, expected - rawPairs);

  if (cards.length === 0) {
    throw new Error(
      'No term/definition pairs were found on that page. Check that the set is public and contains text cards.',
    );
  }

  return { title, url: canonicalUrl, setId, cards, skipped };
}
