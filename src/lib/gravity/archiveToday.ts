/**
 * archive.today (archive.ph) snapshot import — the fallback path for Quizlet
 * sets that Cloudflare blocks from every direct server-side strategy.
 *
 * ── Why this exists ─────────────────────────────────────────────────────
 * Quizlet challenges essentially ALL datacenter IPs (Vercel serverless, CORS
 * relays, AI-reader crawlers — empirically re-verified: direct + browser
 * headers → HTTP 403 "Captcha Challenge", z.ai reader → "Just a moment…").
 * archive.today's own crawler, however, DOES beat Quizlet's protection (its
 * snapshots contain the fully rendered set page — verified against a real
 * snapshot). So the one working road to the terms is:
 *
 *   1. get a snapshot of the set saved on archive.today (the user's browser
 *      clicks "Save" on archive.ph — or the best-effort server-side submit),
 *   2. read that snapshot back (direct fetch / CORS relays / z.ai reader),
 *   3. parse the term rows out of the archived DOM.
 *
 * ── What the archived page looks like ───────────────────────────────────
 * archive.today stores the POST-RENDER DOM with all CSS inlined as style
 * attributes and all <script> tags stripped — so there is no __NEXT_DATA__.
 * What survives (verified on a real 987-term snapshot):
 *
 *   • a "Terms in this set (N)" heading (localized like Quizlet's UI),
 *   • one <div aria-label="Term"> block per card row, each containing the
 *     term and the definition as nested double-<span> text nodes:
 *
 *       <div aria-label="Term" style="…">
 *         … <span style="color:rgb(26,29,40)…"><span style="…">l'apprenti/e</span></span> …
 *         … <span style="color:rgb(26,29,40)…"><span style="…">der/die Lernende</span></span> …
 *       </div>
 *
 *   • the original quizlet.com set URL (used to recover the set id + a clean
 *     canonical URL) and the og:title meta tag.
 *
 * Caveat: Quizlet only server-renders the FIRST ~100 card rows; larger sets
 * yield a snapshot with the first ~100 terms. `skipped` reports the rest.
 *
 * ── How archive.today is accessed ───────────────────────────────────────
 * archive.today serves its own "One more step / complete the CAPTCHA" wall to
 * suspicious IPs (observed on the /newest/ lookup endpoint), so every access
 * runs through a small transport ladder with content sniffing:
 *
 *   • direct fetch (Vercel's IP — sometimes fine for snapshot pages),
 *   • allorigins / codetabs CORS relays (independent IP spaces),
 *   • mirror domains (archive.ph, archive.today, archive.is, … share one
 *     database, so a snapshot id works on every mirror),
 *   • the z.ai web reader (optional, needs ZAI_API_KEY — empirically the
 *     most reliable transport for KNOWN snapshot URLs; it cannot follow the
 *     /newest/ redirect without hitting the captcha wall).
 *
 * This module must stay server-only (it fetches arbitrary remote URLs — but
 * only ever quizlet.com set pages and archive.today hosts, so the API routes
 * using it can never be abused as a generic proxy).
 */

import { zaiReaderEndpoint, type QuizletImportResult } from './quizlet';

/* ────────────────────────────────────────────────────────────────────────
   Constants
   ──────────────────────────────────────────────────────────────────────── */

/** archive.today mirror domains (they all serve the same snapshot database). */
export const ARCHIVE_MIRRORS = [
  'archive.ph',
  'archive.today',
  'archive.is',
  'archive.li',
  'archive.md',
  'archive.vn',
] as const;

const ARCHIVE_HOST_RE = /^(?:[a-z0-9-]+\.)*archive\.(?:ph|today|is|li|md|vn|fo|ng|gg|hk)$/i;

const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9,fr;q=0.8,de;q=0.7',
  'Cache-Control': 'no-cache',
  Pragma: 'no-cache',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Upgrade-Insecure-Requests': '1',
};

const STATUS_ATTEMPT_TIMEOUT_MS = 6_000; // per /newest/ probe
const SNAPSHOT_ATTEMPT_TIMEOUT_MS = 15_000; // per snapshot-page fetch (pages are ~1 MB)
const SAVE_ATTEMPT_TIMEOUT_MS = 12_000;

/** Locale-aware "Terms in this set (N)" headings — mirrors the list in
 *  quizlet.ts (not exported there, so duplicated here). */
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

/* ────────────────────────────────────────────────────────────────────────
   URL classification
   ──────────────────────────────────────────────────────────────────────── */

/** True when `raw` points at an archive.today mirror (any host form). */
export function isArchiveTodayUrl(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  const normalized = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    return ARCHIVE_HOST_RE.test(new URL(normalized).hostname);
  } catch {
    return false;
  }
}

/** Clean an archive.today link: force https, drop the hash. Returns null for
 *  non-archive links. The `?url=` homepage form is passed through untouched
 *  (importFromArchive special-cases it to reach the inner Quizlet URL). */
export function normalizeArchiveUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const normalized = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let u: URL;
  try {
    u = new URL(normalized);
  } catch {
    return null;
  }
  if (!ARCHIVE_HOST_RE.test(u.hostname)) return null;
  u.hash = '';
  return u.toString();
}

/** The archive.today homepage link that pre-fills the save form — this is
 *  what the client opens in a popup so the USER can click "Save" (their
 *  browser passes the captcha; a server cannot). */
export function archiveSaveUrl(quizletUrl: string): string {
  return `https://archive.ph/?url=${encodeURIComponent(quizletUrl.trim())}`;
}

/* ────────────────────────────────────────────────────────────────────────
   Page classification (challenge / snapshot / wip / empty)
   ──────────────────────────────────────────────────────────────────────── */

/** archive.today's "One more step / complete the CAPTCHA" wall (its own
 *  protection — distinct from Cloudflare's, so both are detected). */
function isArchiveChallenge(body: string): boolean {
  return (
    /<title>[^<]*(?:one more step|captcha)[^<]*<\/title>/i.test(body) ||
    (/one more step/i.test(body) && /security check|complete the CAPTCHA/i.test(body)) ||
    /Why do I have to complete a CAPTCHA/i.test(body) ||
    /challenge-platform\/(?:h\/b|scripts)/i.test(body) ||
    /window\._cf_chl|window\.__cf_chl|cf_chl_opt/i.test(body)
  );
}

/** Number of archived card rows (occurrences of the row opener). */
function countTermRows(body: string): number {
  return body.split('<div aria-label="Term"').length - 1;
}

/** Does this body look like a rendered Quizlet set page (i.e. a snapshot)? */
function looksLikeSnapshot(body: string): boolean {
  return countTermRows(body) > 0 || TERMS_HEADER_RES.some((re) => re.test(body));
}

/** Announced term count from the localized heading, if present. */
function announcedTermCount(body: string): number | null {
  for (const re of TERMS_HEADER_RES) {
    const m = body.match(re);
    if (m) return Number(m[1]);
  }
  return null;
}

/** Is this the "snapshot is being rendered right now" page? */
function isWip(finalUrl: string, body: string): boolean {
  return finalUrl.includes('/wip/') || /archive\.(?:ph|today|is|li|md|vn)\/wip\//i.test(body);
}

/* ────────────────────────────────────────────────────────────────────────
   Transport ladder (direct / CORS relays / z.ai reader)
   ──────────────────────────────────────────────────────────────────────── */

type Transport = 'direct' | 'allorigins' | 'codetabs';

interface TransportResult {
  ok: boolean;
  status: number;
  body: string;
  /** Final URL after redirects (direct only) — reveals the snapshot address
   *  behind /newest/ lookups. Relays report the requested URL. */
  finalUrl: string;
  via: string;
}

function viaTransport(transport: Transport, url: string): string {
  switch (transport) {
    case 'direct':
      return url;
    case 'allorigins':
      return `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
    case 'codetabs':
      return `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`;
  }
}

async function fetchVia(
  transport: Transport,
  url: string,
  timeoutMs: number,
): Promise<TransportResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(viaTransport(transport, url), {
      headers: BROWSER_HEADERS,
      redirect: 'follow',
      signal: controller.signal,
    });
    const body = await res.text();
    return { ok: res.ok, status: res.status, body, finalUrl: res.url || url, via: transport };
  } catch {
    return { ok: false, status: 0, body: '', finalUrl: url, via: transport };
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch a KNOWN snapshot URL through the z.ai web reader (optional — needs
 *  ZAI_API_KEY). Empirically the most reliable transport for snapshot pages:
 *  the reader's browser pool renders them without hitting the captcha wall.
 *  Only used for direct snapshot URLs, never for /newest/ lookups (the
 *  redirect makes the reader land on the captcha wall instead). */
async function fetchSnapshotViaZaiReader(
  url: string,
  budgetMs: number,
): Promise<{ ok: boolean; body: string }> {
  const apiKey = (process.env.ZAI_API_KEY ?? '').trim();
  if (!apiKey) return { ok: false, body: '' };
  const endpoint = zaiReaderEndpoint(
    (process.env.ZAI_BASE_URL || 'https://api.z.ai/api/paas/v4').trim(),
  );
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), budgetMs);
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ url, return_format: 'html', timeout: 25 }),
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!res.ok) return { ok: false, body: '' };
    const json = (await res.json().catch(() => null)) as {
      reader_result?: { content?: string };
      error?: { code?: number | string; message?: string };
      code?: number | string;
      msg?: string;
    } | null;
    const content = json?.reader_result?.content ?? '';
    if (!content) return { ok: false, body: '' };
    return { ok: true, body: content };
  } catch {
    return { ok: false, body: '' };
  } finally {
    clearTimeout(timer);
  }
}

/* ────────────────────────────────────────────────────────────────────────
   Snapshot lookup — "does a snapshot exist for this Quizlet URL?"
   ──────────────────────────────────────────────────────────────────────── */

export type ArchiveLookup =
  | { status: 'found'; snapshotUrl: string | null; html: string; via: string }
  | { status: 'saving' }
  | { status: 'none' }
  | { status: 'blocked' };

/**
 * Probe archive.today for the newest snapshot of `quizletUrl` (the EXACT url
 * the user archived — pass their original link, query string included).
 *
 * `/newest/<url>` 302-redirects to the snapshot when one exists; direct
 * fetches expose the redirect target via res.url, relays just deliver the
 * final page body — so both are classified by content sniffing. A /wip/ stop
 * means a save is currently being rendered ("saving"). Challenge walls on all
 * answering transports → 'blocked'.
 */
export async function findArchiveSnapshot(quizletUrl: string): Promise<ArchiveLookup> {
  const target = quizletUrl.trim();
  const attempts: Array<{ transport: Transport; mirror: string }> = [
    { transport: 'direct', mirror: 'archive.ph' },
    { transport: 'allorigins', mirror: 'archive.ph' },
    { transport: 'direct', mirror: 'archive.today' },
    { transport: 'allorigins', mirror: 'archive.today' },
  ];

  let sawSaving = false;
  let challengeCount = 0;
  let answeredCount = 0;

  for (const { transport, mirror } of attempts) {
    const result = await fetchVia(
      transport,
      `https://${mirror}/newest/${target}`,
      STATUS_ATTEMPT_TIMEOUT_MS,
    );
    if (!result.ok && result.status === 0) continue; // network/timeout — try next
    answeredCount += 1;

    if (isArchiveChallenge(result.body)) {
      challengeCount += 1;
      continue;
    }
    if (isWip(result.finalUrl, result.body)) {
      sawSaving = true; // a save is in progress — keep polling, but remember
      continue;
    }
    if (looksLikeSnapshot(result.body)) {
      // Direct transports followed the redirect — res.url IS the snapshot.
      // Relays can't report it, so keep the /newest/ URL (it still resolves).
      const snapshotUrl =
        transport === 'direct' && !result.finalUrl.includes('/newest/')
          ? result.finalUrl
          : `https://${mirror}/newest/${target}`;
      return { status: 'found', snapshotUrl, html: result.body, via: `${mirror} (${transport})` };
    }
    // 404 / "not in the archive yet" / anything else — no snapshot on this path
  }

  if (sawSaving) return { status: 'saving' };
  if (answeredCount > 0 && challengeCount === answeredCount) return { status: 'blocked' };
  return { status: 'none' };
}

/* ────────────────────────────────────────────────────────────────────────
   Best-effort server-side save submission
   ──────────────────────────────────────────────────────────────────────── */

export interface SaveSubmission {
  /** True when archive.today accepted the save (or already had one). */
  submitted: boolean;
  /** True when archive.today answered with its captcha wall. */
  blocked: boolean;
  /** Diagnostic detail — SERVER LOG ONLY, never sent to the client. */
  detail: string;
}

/**
 * Try to submit the URL to archive.today's save queue from the server
 * (GET homepage → grab submitid + cookie → POST /save/). This frequently
 * loses to archive.today's own captcha wall from datacenter IPs — on any
 * failure the caller falls back to the user-assisted popup, where the
 * user's own browser does the clicking. Never throws.
 */
export async function submitArchiveSave(quizletUrl: string): Promise<SaveSubmission> {
  const target = quizletUrl.trim();
  const mirror = 'https://archive.ph';
  try {
    // 1. Homepage: session cookie + the anti-CSRF submitid token.
    let cookieHeader = '';
    let homeBody = '';
    try {
      const home = await fetch(`${mirror}/`, {
        headers: BROWSER_HEADERS,
        redirect: 'follow',
        signal: AbortSignal.timeout(SAVE_ATTEMPT_TIMEOUT_MS),
      });
      homeBody = await home.text();
      const getSetCookie = (home.headers as unknown as { getSetCookie?: () => string[] })
        .getSetCookie;
      const rawCookies =
        typeof getSetCookie === 'function'
          ? getSetCookie.call(home.headers)
          : [home.headers.get('set-cookie')].filter(Boolean);
      cookieHeader = rawCookies.map((c) => c.split(';')[0]).join('; ');
    } catch (err) {
      return {
        submitted: false,
        blocked: false,
        detail: `homepage fetch failed: ${err instanceof Error ? err.message : 'error'}`,
      };
    }

    if (isArchiveChallenge(homeBody)) {
      return { submitted: false, blocked: true, detail: 'homepage served the captcha wall' };
    }

    const submitId =
      homeBody.match(/name="submitid"[^>]*value="([^"]+)"/)?.[1] ??
      homeBody.match(/value="([^"]+)"[^>]*name="submitid"/)?.[1] ??
      null;
    if (!submitId) {
      return { submitted: false, blocked: false, detail: 'no submitid in the homepage form' };
    }

    // 2. Submit the save — same fields the homepage form posts.
    const post = await fetch(`${mirror}/save/`, {
      method: 'POST',
      headers: {
        ...BROWSER_HEADERS,
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: mirror,
        Referer: `${mirror}/`,
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      },
      body: new URLSearchParams({
        url: target,
        submitid: submitId,
        anyway: 'False',
      }).toString(),
      redirect: 'follow',
      signal: AbortSignal.timeout(SAVE_ATTEMPT_TIMEOUT_MS),
    });
    const body = await post.text();
    const finalUrl = post.url || '';

    if (isArchiveChallenge(body)) {
      return { submitted: false, blocked: true, detail: 'save POST served the captcha wall' };
    }
    if (isWip(finalUrl, body)) {
      return { submitted: true, blocked: false, detail: 'save accepted (wip)' };
    }
    if (looksLikeSnapshot(body)) {
      return { submitted: true, blocked: false, detail: 'snapshot already existed' };
    }
    if (/already (?:been )?saved|saved recently/i.test(body)) {
      return { submitted: true, blocked: false, detail: 'already saved recently' };
    }
    return {
      submitted: false,
      blocked: false,
      detail: `unrecognized save response (HTTP ${post.status})`,
    };
  } catch (err) {
    return {
      submitted: false,
      blocked: false,
      detail: err instanceof Error ? err.message : 'network error',
    };
  }
}

/* ────────────────────────────────────────────────────────────────────────
   Parsing
   ──────────────────────────────────────────────────────────────────────── */

/** Minimal HTML-entity unescape (safe order: &amp; LAST). */
function unescapeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/** Nested double-<span> text nodes — Quizlet's term/definition text markup
 *  (the pattern survives archive.today's DOM serialization). */
const DOUBLE_SPAN_RE = /<span[^>]*>\s*<span[^>]*>([\s\S]*?)<\/span>\s*<\/span>/g;

/** Extract the visible term/definition texts of one archived card row
 *  segment. Only the FIRST two double-span texts are used (term, definition)
 *  — later ones belong to page furniture that leaks into the final row's
 *  segment. */
function rowTexts(segment: string): string[] {
  const cleaned = segment.replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, ' ');
  const texts: string[] = [];
  DOUBLE_SPAN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = DOUBLE_SPAN_RE.exec(cleaned)) !== null) {
    const text = unescapeEntities(m[1].replace(/<br\s*\/?>/gi, ' '))
      .replace(/\s+/g, ' ')
      .trim();
    if (text) texts.push(text);
    if (texts.length >= 2) break; // term + definition — nothing else matters
  }
  return texts;
}

/** Clean an archived page title: "Mission 5 … Flashcards | Quizlet" →
 *  "Mission 5 …". */
function cleanTitle(raw: string): string {
  return unescapeEntities(raw)
    .replace(/\s*[|·]\s*Quizlet\s*$/i, '')
    .replace(/\s+Flashcards$/i, '')
    .replace(/\s*[|·]\s*archive\.(?:ph|today|is|li|md|vn)\s*$/i, '')
    .trim();
}

/** Recover the original Quizlet set URL + numeric id from the saved DOM
 *  (the archived page links back to quizlet.com/<locale>/<id>/<slug>). */
export function extractOriginalSet(html: string): { setId: string | null; canonicalUrl: string | null } {
  const m = html.match(/https?:\/\/quizlet\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(\d{6,})/i);
  if (!m) return { setId: null, canonicalUrl: null };
  return { setId: m[1], canonicalUrl: `https://quizlet.com/${m[1]}/` };
}

/**
 * Parse an archived Quizlet set page into term/definition pairs.
 * Throws with a user-friendly message when the page isn't a set snapshot.
 */
export function parseArchiveSnapshot(
  html: string,
  opts: { sourceUrl: string; fallbackSetId?: string },
): QuizletImportResult {
  if (isArchiveChallenge(html)) {
    throw new Error(
      'archive.ph answered with its security check instead of the saved page. Try again in a moment.',
    );
  }

  // Card rows: everything between consecutive <div aria-label="Term" markers.
  const parts = html.split('<div aria-label="Term"');
  const cards: QuizletImportResult['cards'] = [];
  const seen = new Set<string>();
  let rowsWithOneSide = 0;

  for (let i = 1; i < parts.length; i++) {
    const texts = rowTexts(parts[i]);
    if (texts.length >= 2) {
      const [term, definition] = texts;
      const key = `${term}\u0000${definition}`;
      if (seen.has(key)) continue; // exact duplicates in the source set
      seen.add(key);
      cards.push({ term, definition });
    } else if (texts.length === 1) {
      rowsWithOneSide += 1; // image-only definition — can't be typed
    }
  }

  if (cards.length === 0) {
    throw new Error(
      'The archived page has no readable term/definition rows. Make sure the archive.ph link points to the set page itself (not the Study or Test tabs).',
    );
  }

  const announced = announcedTermCount(html);
  const skipped = announced !== null ? Math.max(0, announced - cards.length) : rowsWithOneSide;

  const rawTitle =
    html.match(/<meta property="og:title" content="([^"]+)"/)?.[1] ??
    html.match(/<title>([^<]+)<\/title>/)?.[1] ??
    'Quizlet set (archived)';
  const title = cleanTitle(rawTitle) || 'Quizlet set (archived)';

  const { setId, canonicalUrl } = extractOriginalSet(html);

  return {
    title,
    url: canonicalUrl ?? opts.sourceUrl,
    setId: setId ?? opts.fallbackSetId ?? 'archived',
    cards,
    skipped,
    via: 'archive.today snapshot',
  };
}

/* ────────────────────────────────────────────────────────────────────────
   Snapshot page fetch (KNOWN snapshot URL)
   ──────────────────────────────────────────────────────────────────────── */

/** Swap an archive.today URL's host to the next mirror (same path). */
function swapMirrorHost(url: string): string | null {
  try {
    const u = new URL(url);
    if (!ARCHIVE_HOST_RE.test(u.hostname)) return null;
    const current = u.hostname.toLowerCase();
    const next = ARCHIVE_MIRRORS.find((m) => m !== current);
    if (!next) return null;
    return `${u.protocol}//${next}${u.pathname}${u.search}`;
  } catch {
    return null;
  }
}

/** Fetch a KNOWN snapshot URL through the transport ladder. Throws when no
 *  transport delivers a parseable snapshot page. */
export async function fetchArchiveSnapshotHtml(
  snapshotUrl: string,
): Promise<{ html: string; via: string }> {
  const attempts: Array<{ transport: Transport | 'zai-reader'; url: string }> = [
    { transport: 'direct', url: snapshotUrl },
    { transport: 'allorigins', url: snapshotUrl },
    { transport: 'codetabs', url: snapshotUrl },
  ];
  // Mirror swap: snapshot ids are shared across archive.today's domains, so
  // if the pasted mirror blocks us the same path may answer elsewhere.
  const swapped = swapMirrorHost(snapshotUrl);
  if (swapped && swapped !== snapshotUrl) {
    attempts.push({ transport: 'direct', url: swapped });
  }
  attempts.push({ transport: 'zai-reader', url: snapshotUrl });

  const errors: string[] = [];
  for (const attempt of attempts) {
    if (attempt.transport === 'zai-reader') {
      const key = (process.env.ZAI_API_KEY ?? '').trim();
      if (!key) {
        errors.push('z.ai reader (skipped: ZAI_API_KEY not set on the server)');
        continue;
      }
      const out = await fetchSnapshotViaZaiReader(attempt.url, 28_000);
      if (out.ok && looksLikeSnapshot(out.body) && !isArchiveChallenge(out.body)) {
        return { html: out.body, via: 'z.ai web reader' };
      }
      errors.push('z.ai reader: no snapshot content');
      continue;
    }
    const result = await fetchVia(attempt.transport, attempt.url, SNAPSHOT_ATTEMPT_TIMEOUT_MS);
    if (!result.ok && result.status === 0) {
      errors.push(`${attempt.transport}: network error`);
      continue;
    }
    if (isArchiveChallenge(result.body)) {
      errors.push(`${attempt.transport}: captcha wall`);
      continue;
    }
    if (looksLikeSnapshot(result.body)) {
      return { html: result.body, via: `archive.today (${attempt.transport})` };
    }
    errors.push(`${attempt.transport}: not a snapshot page (HTTP ${result.status})`);
  }
  throw new Error(`could not fetch the archive.ph snapshot — ${errors.join('; ')}`);
}

/* ────────────────────────────────────────────────────────────────────────
   Orchestration
   ──────────────────────────────────────────────────────────────────────── */

/**
 * Import a Quizlet set through archive.today. Accepts EITHER a Quizlet set
 * URL (an existing snapshot is looked up) or a direct archive.today snapshot
 * link (also the `archive.ph/?url=<quizlet-url>` homepage form — its inner
 * URL is extracted). Throws user-friendly errors describing the exact state
 * (no snapshot yet / snapshot rendering / archive blocked).
 */
export async function importFromArchive(rawInput: string): Promise<QuizletImportResult> {
  const input = rawInput.trim();
  if (!input) throw new Error('Empty URL.');

  // Direct snapshot link (or the pre-filled homepage form)?
  if (isArchiveTodayUrl(input)) {
    const normalized = normalizeArchiveUrl(input);
    if (!normalized) throw new Error('That archive.ph link could not be parsed.');
    const u = new URL(normalized);
    // Homepage save-form link → extract the inner Quizlet URL and continue
    // down the quizlet-lookup path below.
    const inner = u.searchParams.get('url');
    if (u.pathname === '/' && inner) {
      const innerUrl = /^https?:\/\//i.test(inner) ? inner : `https://${inner}`;
      if (!/quizlet\./i.test(innerUrl)) {
        throw new Error('That archive.ph save link does not point to a Quizlet set.');
      }
      return importFromArchive(innerUrl);
    }
    // Strip the query for snapshot pages (it is never part of the snapshot id)
    u.search = '';
    const { html } = await fetchArchiveSnapshotHtml(u.toString());
    return parseArchiveSnapshot(html, { sourceUrl: u.toString() });
  }

  // Quizlet URL — look for an existing snapshot.
  if (!/quizlet\.[a-z.]+\//i.test(input)) {
    throw new Error('Not a Quizlet or archive.ph URL.');
  }

  // Probe BOTH the exact pasted form (what the user will archive) and the
  // bare canonical form (how older snapshots are usually keyed).
  const variants = [input];
  try {
    const stripped = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
    stripped.hash = '';
    stripped.search = '';
    const clean = stripped.toString();
    if (!variants.includes(clean)) variants.push(clean);
  } catch {
    /* keep the raw form only */
  }

  for (const variant of variants) {
    const lookup = await findArchiveSnapshot(variant);
    if (lookup.status === 'found') {
      return parseArchiveSnapshot(lookup.html, {
        sourceUrl: variant,
        fallbackSetId: extractOriginalSet(lookup.html).setId ?? undefined,
      });
    }
    if (lookup.status === 'saving') {
      throw new Error(
        'The archive.ph snapshot is being rendered right now — try again in about a minute.',
      );
    }
    if (lookup.status === 'blocked') {
      throw new Error(
        'archive.ph is showing its security check to our server. Save the page in your own browser on archive.ph, then paste the archive.ph link here.',
      );
    }
    // 'none' — try the next URL variant
  }

  throw new Error(
    'No archive.ph snapshot exists for this set yet. Open archive.ph, save the Quizlet page ("My url is alive and I want to archive its content"), wait ~3 minutes, then import again — or paste the archive.ph link you landed on.',
  );
}
