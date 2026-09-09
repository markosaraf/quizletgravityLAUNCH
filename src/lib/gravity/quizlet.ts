/**
 * Quizlet set importer — fetches a PUBLIC Quizlet flashcard page and extracts
 * the terms & definitions.
 *
 * ── How the parsing works ────────────────────────────────────────────────
 * Two payload shapes are supported, and the fetch chain tags which one it
 * delivered:
 *
 *   format 'html'      — the raw SSR page. Quizlet embeds the full card data
 *                        in a <script id="__NEXT_DATA__"> JSON blob:
 *
 *                          { "rank": 0, "isDeleted": false,
 *                            "cardSides": [
 *                              { "label": "word",       "media": [{ "plainText": "accueillir" }] },
 *                              { "label": "definition", "media": [{ "plainText": "empfangen"  }] } ] }
 *
 *                        The blob is sometimes nested one level deeper (a JSON
 *                        *string* inside the JSON), so the walker json.parses
 *                        any string that mentions "cardSides".
 *
 *   format 'reader-md' — the z.ai web reader's markdown rendering of the
 *                        page. Quizlet server-renders a "Terms in this set
 *                        (N)" section whose entries are blank-line separated
 *                        and strictly alternate term / definition, so pairs
 *                        are reconstructed positionally and validated
 *                        against the announced count N.
 *
 * ── How the page is fetched ──────────────────────────────────────────────
 * Quizlet aggressively blocks datacenter IPs (403 challenges / connection
 * timeouts), so a plain server-side fetch is only the FIRST of several
 * strategies. The chain runs in order and the first usable payload wins:
 *
 *   1. z.ai web reader   — the OFFICIAL public Web Reader REST API
 *                          (POST https://api.z.ai/api/paas/v4/reader —
 *                          docs.z.ai/api-reference/tools/web-reader).
 *                          OPTIONAL: activates only when ZAI_API_KEY is set;
 *                          ZAI_BASE_URL overrides the default
 *                          https://api.z.ai/api/paas/v4 base. NO SDK package
 *                          is needed — it is a plain fetch with Bearer auth.
 *                          MARKDOWN-FIRST: `return_format: 'markdown'` is
 *                          requested because the 'html' format has been
 *                          observed to answer HTTP 200 with an EMPTY result
 *                          for Quizlet's heavy pages; the markdown rendering
 *                          carries the full "Terms in this set (N)" list and
 *                          is parsed by parseQuizletMarkdown(). If the
 *                          markdown somehow lacks the terms list, the reader
 *                          is retried once with return_format 'html' (which
 *                          yields __NEXT_DATA__ when Z.ai honours it).
 *                          BILLING CAVEAT: the reader bills the pay-as-you-go
 *                          API wallet — GLM Coding Plan credits do NOT cover
 *                          it. On error 1113 ("Insufficient balance or no
 *                          resource package") the chain simply moves on to
 *                          the free strategies below.
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
 * platform kills the function. Missing configuration (ZAI_API_KEY) is
 * reported EXPLICITLY in the error message — a silently skipped strategy is
 * indistinguishable from a mysteriously broken one when debugging a deploy.
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

/** Options for fetchQuizletPage — exposed for unit tests. */
export interface QuizletFetchOptions {
  /** Use the optional z.ai web reader strategy (default: true). */
  pageReader?: boolean;
  /** web.archive.org origin (overridable in tests to point at a mock). */
  waybackBase?: string;
  /** Wall-clock budget for the entire chain (default: 55s). */
  deadlineMs?: number;
}

/** The two payload shapes the chain can deliver. */
export type QuizletPayloadFormat = 'html' | 'reader-md';

export interface QuizletFetchedPage {
  /** Raw page HTML ('html') or the reader's markdown rendering ('reader-md'). */
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
const ZAI_READER_TIMEOUT_MS = 30_000;
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

type FetchOutcome =
  | { ok: true; body: string; /** Set by the reader strategy for markdown payloads. */ format?: QuizletPayloadFormat }
  | {
      ok: false;
      error: string;
      /** Z.ai rejected the call with 1113-style "no balance / no resource
          package" — the key is VALID, the reader just isn't covered by the
          Coding Plan (it bills the separate pay-as-you-go API wallet). */
      billingBlocked?: boolean;
    };

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
   Strategy 1 — z.ai web reader (official public REST API, optional)
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
      return {
        ok: false,
        billingBlocked: isZaiBillingError(code, message ?? raw),
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
 * Fetch `url` through Z.ai's documented Web Reader endpoint
 * (POST {base}/reader — https://docs.z.ai/api-reference/tools/web-reader).
 *
 * Credentials come from the environment — NO SDK package required:
 *   ZAI_API_KEY   (required)  key from https://z.ai/manage-apikey/apikey-list
 *   ZAI_BASE_URL  (optional)  default https://api.z.ai/api/paas/v4
 *
 * MARKDOWN-FIRST: live probing (2026-09) showed `return_format:'html'`
 * returns an empty task receipt for Quizlet pages, while 'markdown' returns
 * the rendered page including the full "Terms in this set (N)" list. So the
 * markdown format is requested first and validated against that marker;
 * only when the marker is missing (but the call itself worked) do we retry
 * once with 'html' in case __NEXT_DATA__ is available.
 *
 * Billing rejections (error 1113) abort immediately — a second paid call
 * would fail identically.
 */
async function fetchViaZaiReader(url: string, budgetMs: number): Promise<FetchOutcome> {
  const apiKey = (process.env.ZAI_API_KEY ?? '').trim();
  if (!apiKey) return { ok: false, error: 'ZAI_API_KEY not set on the server' };
  const endpoint = zaiReaderEndpoint((process.env.ZAI_BASE_URL || 'https://api.z.ai/api/paas/v4').trim());

  // Markdown gets the lion's share of the budget — it is the proven path.
  const mdBudget = Math.max(MIN_STRATEGY_BUDGET_MS, Math.floor(budgetMs * 0.65));
  const md = await zaiReaderCall(endpoint, apiKey, url, 'markdown', mdBudget);

  if (md.ok) {
    if (md.body.includes('Terms in this set')) {
      return { ok: true, body: md.body, format: 'reader-md' };
    }
    // Markdown worked but carries no terms list (unexpected for a flashcard
    // set) — one retry with 'html', which carries __NEXT_DATA__ when the
    // reader honours the format.
    const htmlBudget = budgetMs - mdBudget;
    if (htmlBudget >= MIN_STRATEGY_BUDGET_MS) {
      const html = await zaiReaderCall(endpoint, apiKey, url, 'html', htmlBudget);
      if (html.ok && html.body.includes('__NEXT_DATA__')) {
        return { ok: true, body: html.body, format: 'html' };
      }
      const htmlErr = html.ok ? 'html had no embedded page data' : html.error;
      return { ok: false, error: `markdown had no Quizlet terms list; html retry: ${htmlErr}` };
    }
    return { ok: false, error: 'markdown had no Quizlet terms list (no budget left for the html retry)' };
  }

  // Markdown call failed. Billing rejections make a second format pointless.
  if (md.billingBlocked) return md;
  // Other failures (network/timeout/server) — the html retry would face the
  // same infrastructure, so surface the error directly.
  return md;
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

/** Fetch a parseable Quizlet set payload (raw HTML or reader markdown);
    throws with a user-friendly, diagnostic message when every strategy is
    blocked, misconfigured, or runs out of budget. */
export async function fetchQuizletPage(
  canonicalUrl: string,
  opts: QuizletFetchOptions = {},
): Promise<QuizletFetchedPage> {
  const waybackBase = opts.waybackBase ?? DEFAULT_WAYBACK_BASE;
  const deadlineMs = opts.deadlineMs ?? DEFAULT_DEADLINE_MS;
  const startedAt = Date.now();
  const remaining = () => deadlineMs - (Date.now() - startedAt);

  const strategies: Strategy[] = [
    {
      name: 'z-ai web reader',
      via: 'z-ai web reader',
      cap: ZAI_READER_TIMEOUT_MS,
      run: (budget) => fetchViaZaiReader(canonicalUrl, budget),
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
  // The reader is the one strategy whose failure is usually actionable
  // (missing key, no balance, wrong base URL) — remember its outcome for the
  // final diagnosis even when later strategies fail for other reasons.
  let readerError: string | null = null;
  // Set when the z.ai reader was rejected for billing reasons (error 1113) —
  // surfaced as a friendly tip at the end of the error message.
  let zaiBillingHint: string | null = null;

  for (const strategy of strategies) {
    if (strategy.name === 'z-ai web reader') {
      if (opts.pageReader === false) continue;
      if (!(process.env.ZAI_API_KEY ?? '').trim()) {
        // VISIBLE skip — a missing env var on the hosting platform must
        // never look like the reader "mysteriously" never ran.
        attempted.push('z-ai web reader (skipped: ZAI_API_KEY not set on the server)');
        continue;
      }
    }

    const budget = Math.min(strategy.cap, remaining());
    if (budget < MIN_STRATEGY_BUDGET_MS) {
      attempted.push(`${strategy.name} (skipped: out of time)`);
      continue;
    }
    attempted.push(strategy.name);

    const result = await strategy.run(budget);
    const usable =
      result.ok && (result.format === 'reader-md' || result.body.includes('__NEXT_DATA__'));
    if (result.ok && usable) {
      return { payload: result.body, format: result.format ?? 'html', via: strategy.via };
    }
    lastError = result.ok ? 'response did not contain page data' : result.error;
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
  throw new Error(
    `Could not load the Quizlet page (tried ${attempted.join(', ')}).${readerDiag} Last error: ${detail}. ` +
      'Quizlet may temporarily be blocking automated requests — try again in a moment, or paste the terms manually.' +
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

/** Parse the raw SSR HTML of a Quizlet set page (payload format 'html') into
    ordered, deduplicated term/definition pairs. Throws when the payload is
    missing or empty. */
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

/** Parse the z.ai web reader's markdown rendering of a Quizlet set page
    (payload format 'reader-md').

    Quizlet server-renders a "Terms in this set (N)" section whose entries
    are blank-line separated and strictly alternate term / definition, e.g.:

        Terms in this set (62)

        accueillir

        empfangen

        le client, la cliente

        der Kunde, die Kundin

    The pairs are therefore reconstructed positionally: split the section on
    blank lines (dropping image-only blocks), pair the blocks (even = term,
    odd = definition), then dedupe exact duplicates. The announced count N
    is used to report how many cards could not be recovered as text.

    Validated against the live reader output of set 1181229873: 62 announced
    → 62 raw pairs → 61 unique (one genuine duplicate in the source set). */
export function parseQuizletMarkdown(markdown: string, canonicalUrl: string, setId: string): QuizletImportResult {
  const header = markdown.match(/Terms in this set \((\d+)\)/);
  if (!header) {
    throw new Error(
      "Couldn't find the terms list in the Quizlet page text — the set may be private, empty, or not a flashcard set.",
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
