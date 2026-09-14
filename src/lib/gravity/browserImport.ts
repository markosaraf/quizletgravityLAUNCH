/**
 * Browser-side Quizlet import — the client-side counterpart of the server
 * fetch chain in lib/gravity/quizlet.ts.
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 * Quizlet's Cloudflare wall challenges essentially every datacenter IP, so
 * the server-side chain (readers, relays, Wayback) fails for many/most sets.
 * The ONE fetcher that always passes the challenge is the user's own real
 * browser — real TLS fingerprint, real IP, real user solving any "one more
 * step" check. So instead of fetching server-side, we let the user's browser
 * load the Quizlet page and get the data out of that tab:
 *
 *   Path A (zero install — copy & paste relay)
 *     The user opens the set tab, solves the challenge if any, presses
 *     Ctrl+A → Ctrl+C, comes back and pastes into the paste zone. The paste
 *     event carries the copied page as text/html (a serialized DOM slice —
 *     Quizlet's term markup classes survive the clipboard), so
 *     parseQuizletClipboardHtml() can rebuild the pairs. Plain text is the
 *     fallback (parseQuizletClipboardText). Nothing to install, works in
 *     every browser, and Quizlet cannot distinguish it from a user copying
 *     notes.
 *
 *   Path B (one click — bookmarklet)
 *     The user drags the "Import to Gravity" bookmarklet (built by
 *     buildBookmarkletHref) to their bookmarks bar once. On the Quizlet set
 *     page, clicking it runs a tiny scraper INSIDE the quizlet.com origin:
 *       1. same-origin fetch of Quizlet's own internal JSON API
 *          /webapi/3.9/studiable-item-documents (paginated, credentials
 *          included) — no CORS problem (same origin) and no Cloudflare
 *          problem (the tab's session already cleared the challenge);
 *       2. fallback: walk the embedded <script id="__NEXT_DATA__"> blob;
 *       3. fallback: scrape the rendered .TermText elements.
 *     It then hands the payload to the Gravity tab via
 *     window.opener.postMessage (cross-origin postMessage is the ONE
 *     communication channel browsers allow between origins) and returns to
 *     quizletgravity.com. The Gravity tab validates the message origin and
 *     pours the cards into the same preview table as every other import.
 *
 * This module must stay client-side only (DOMParser, clipboard, postMessage).
 */

export interface QuizletCard {
  term: string;
  definition: string;
}

export interface BrowserImportResult {
  title: string;
  cards: QuizletCard[];
  skipped: number;
}

/** The only origins whose postMessage payloads we accept. */
const QUIZLET_ORIGIN_RE = /^https:\/\/([a-z0-9-]+\.)*quizlet\.[a-z.]+$/i;

export function isQuizletOrigin(origin: string): boolean {
  return QUIZLET_ORIGIN_RE.test(origin);
}

/** postMessage protocol marker shared with the bookmarklet below. */
export const BROWSER_IMPORT_SOURCE = 'qg-browser-import';
export const BROWSER_IMPORT_TYPE = 'quizlet-cards';

export interface BrowserImportMessage {
  source: typeof BROWSER_IMPORT_SOURCE;
  type: typeof BROWSER_IMPORT_TYPE;
  title: string;
  url: string;
  cards: QuizletCard[];
  skipped: number;
}

/** True when the payload has the exact shape we broadcast from the tab. */
export function isBrowserImportMessage(data: unknown): data is BrowserImportMessage {
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  return (
    d.source === BROWSER_IMPORT_SOURCE &&
    d.type === BROWSER_IMPORT_TYPE &&
    Array.isArray(d.cards)
  );
}

/** Collapse all whitespace (incl. the newlines inside multi-line
 *  definitions) to single spaces — the textarea-driven preview table is
 *  line-oriented, so cells must not contain line breaks. */
function normalizeCell(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** Extract the numeric set id from any Quizlet URL shape — same rules as
 *  extractQuizletSetId in lib/gravity/quizlet.ts, but duplicated here so the
 *  client never imports the server-only fetch module into the bundle. */
export function extractQuizletSetIdClient(rawUrl: string): string | null {
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;
  const normalized = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  if (!/^https?:\/\/([a-z0-9-]+\.)*quizlet\.[a-z.]+\//i.test(normalized)) return null;
  const m = normalized.match(/quizlet\.[a-z.]+\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(\d{6,})/i);
  return m ? m[1] : null;
}

/* ────────────────────────────────────────────────────────────────────────
   Path A — clipboard parsing
   ──────────────────────────────────────────────────────────────────────── */

/** Quizlet renders the terms-section heading in the page's UI locale; the
 *  user may copy from any regional page. Each entry captures the announced
 *  count N. (Mirrors TERMS_HEADER_RES in the server module.) */
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

function announcedCount(text: string): number | null {
  for (const re of TERMS_HEADER_RES) {
    const m = text.match(re);
    if (m) return parseInt(m[1], 10);
  }
  return null;
}

/** Dedupe + drop one-sided pairs (same semantics as the server's
 *  buildCardsFromRawItems: exact duplicates collapse, one-sided cards are
 *  counted as skipped). */
function finalizeCards(pairs: QuizletCard[]): { cards: QuizletCard[]; skipped: number } {
  const cards: QuizletCard[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const p of pairs) {
    const term = normalizeCell(p.term);
    const definition = normalizeCell(p.definition);
    if (!term && !definition) continue;
    if (!term || !definition) {
      skipped += 1;
      continue;
    }
    const key = `${term}\u0000${definition}`;
    if (seen.has(key)) continue;
    seen.add(key);
    cards.push({ term, definition });
  }
  return { cards, skipped };
}

/** Row-container selectors for the clipboard HTML, tried in order. Quizlet's
 *  current markup wraps every term row in a `.SetPageTerm` element holding
 *  exactly two `.TermText` cells (term, definition). The attribute-contains
 *  variants guard against class renames; `[class*="SetPageTerm"]` also
 *  matches the side wrappers, but those hold a single `.TermText` and
 *  therefore never contribute a pair. */
const CLIPBOARD_ROW_SELECTORS = [
  '.SetPageTerm',
  '[class*="SetPageTerm"]',
  '[class*="TermGroup"]',
  '[class*="TermRow"]',
  '[class*="term-row"]',
];

/**
 * Parse the text/html clipboard flavor of a copied Quizlet set page.
 * When the user presses Ctrl+A → Ctrl+C, the clipboard's text/html flavor is
 * a serialization of the selected DOM — class names survive the copy, and
 * Quizlet renders every term/definition in a `.TermText` element.
 *
 * Pairing strategy:
 *   1. Row-scoped (preferred): for each row container, pair its first two
 *      `.TermText` cells. This keeps rows with an image-only definition side
 *      (only ONE `.TermText` in the row) from mispairing the next row.
 *   2. Document-order fallback: if no row container is recognized, pair all
 *      `.TermText` elements in document order (even = term, odd = definition).
 * Consecutive/global exact duplicates (previews, repeats) are dropped.
 */
export function parseQuizletClipboardHtml(html: string): BrowserImportResult | null {
  if (!html || !html.trim()) return null;
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(html, 'text/html');
  } catch {
    return null;
  }

  let pairs: QuizletCard[] = [];

  for (const selector of CLIPBOARD_ROW_SELECTORS) {
    let rows: Element[];
    try {
      rows = Array.from(doc.querySelectorAll(selector));
    } catch {
      return null; // malformed selector — cannot happen with the constants above
    }
    if (rows.length < 2) continue;
    const rowPairs: QuizletCard[] = [];
    for (const row of rows) {
      const cells = Array.from(row.querySelectorAll('.TermText'));
      if (cells.length >= 2) {
        rowPairs.push({
          term: cells[0].textContent ?? '',
          definition: cells[1].textContent ?? '',
        });
      }
    }
    if (rowPairs.length >= 2) {
      pairs = rowPairs;
      break;
    }
  }

  if (pairs.length === 0) {
    const spans = Array.from(doc.querySelectorAll('.TermText'));
    for (let i = 0; i + 1 < spans.length; i += 2) {
      pairs.push({
        term: spans[i].textContent ?? '',
        definition: spans[i + 1].textContent ?? '',
      });
    }
  }

  const { cards, skipped } = finalizeCards(pairs);
  if (cards.length < 2) return null;
  const title = normalizeCell(doc.querySelector('h1')?.textContent ?? '');
  return { title, cards, skipped };
}

/**
 * Plain-text fallback (mobile shares, browsers that strip the html flavor):
 * Quizlet's SSR puts the localized "Terms in this set (N)" heading right
 * before the term list, and each term/definition on its own line. We cut
 * after the LAST heading occurrence (the one next to the list), then pair
 * positionally. The announced count N is used to trim trailing page junk
 * (footer links, ratings, recommended-content labels) when the page copied
 * more than just the list.
 */
export function parseQuizletClipboardText(text: string): BrowserImportResult | null {
  if (!text) return null;
  const announced = announcedCount(text);
  if (announced === null || announced < 2) return null;

  // Cut at the LAST localized heading — the term list follows it.
  let start = -1;
  for (const re of TERMS_HEADER_RES) {
    const m = text.match(re);
    if (m && m.index !== undefined && m.index > start) start = m.index + m[0].length;
  }
  if (start < 0) return null;
  const lines = text
    .slice(start)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length < 4) return null;

  const pairs: QuizletCard[] = [];
  if (lines.length === announced * 2) {
    // Clean copy: exactly the announced pairs, nothing else.
    for (let i = 0; i + 1 < lines.length; i += 2) {
      pairs.push({ term: lines[i], definition: lines[i + 1] });
    }
  } else {
    // Trailing junk around the list: take the first 2N lines (footer junk
    // always comes AFTER the list on the SSR page). If that still doesn't
    // look right, fall back to straight even-count pairing.
    const usable = lines.slice(0, announced * 2);
    for (let i = 0; i + 1 < usable.length; i += 2) {
      pairs.push({ term: usable[i], definition: usable[i + 1] });
    }
  }
  const { cards, skipped } = finalizeCards(pairs);
  if (cards.length < 2) return null;
  return { title: '', cards, skipped };
}

/* ────────────────────────────────────────────────────────────────────────
   Path B — bookmarklet
   ──────────────────────────────────────────────────────────────────────── */

/**
 * The bookmarklet payload, as readable source. It is compiled into a
 * javascript: URL by buildBookmarkletHref(). Written in terse ES5 so it
 * survives URL-encoding and runs on old browsers. See the module header for
 * the strategy order (webapi JSON → __NEXT_DATA__ → .TermText DOM).
 */
export function buildBookmarkletSource(originUrl: string): string {
  const o = originUrl.replace(/\/+$/, '');
  return '(function(){' +
    'var ORIGIN="' + o + '";' +
    'var m=(location.pathname||"").match(/(\\d{6,})/);' +
    'function norm(s){return String(s||"").replace(/\\s+/g," ").trim();}' +
    'function unesc(s){return s.replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,\'"\').replace(/&#39;/g,"\'").replace(/&nbsp;/g," ").replace(/&amp;/g,"&");}' +
    'function sideText(side){var t=(side&&side.media||[]).map(function(x){return x&&typeof x.plainText==="string"?unesc(x.plainText).trim():"";}).filter(Boolean);return t.join("\\n");}' +
    'function collect(node,out,depth){' +
    'if(node==null)return;' +
    'if(typeof node==="string"){if(node.indexOf("cardSides")>-1&&depth<=6){try{collect(JSON.parse(node),out,depth+1);}catch(e){}}return;}' +
    'if(Array.isArray(node)){for(var i=0;i<node.length;i++)collect(node[i],out,depth);return;}' +
    'if(typeof node==="object"){if(Array.isArray(node.cardSides)){out.push(node);return;}var ks=Object.keys(node);for(var j=0;j<ks.length;j++)collect(node[ks[j]],out,depth);}' +
    '}' +
    'function cardsFromItems(items){' +
    'var out=[],seen={},skip=0;' +
    'items.sort(function(a,b){return (a.rank||0)-(b.rank||0);});' +
    'for(var i=0;i<items.length;i++){' +
    'var it=items[i];if(it.isDeleted===true)continue;' +
    'var term="",def="";var sides=it.cardSides||[];' +
    'for(var k=0;k<sides.length;k++){var txt=sideText(sides[k]);if(sides[k].label==="word"&&txt&&!term)term=txt;else if(sides[k].label==="definition"&&txt&&!def)def=txt;}' +
    'if(!term||!def){if(term||def)skip++;continue;}' +
    'var key=term+"\\u0000"+def;if(seen[key])continue;seen[key]=1;' +
    'out.push({term:term,definition:def});' +
    '}' +
    'return {cards:out,skipped:skip};' +
    '}' +
    'function fromNextData(){' +
    'var el=document.getElementById("__NEXT_DATA__");if(!el)return{cards:[],skipped:0};' +
    'var items=[];try{collect(JSON.parse(el.textContent),items,0);}catch(e){return{cards:[],skipped:0};}' +
    'return cardsFromItems(items);' +
    '}' +
    'function fromDom(){' +
    'var els=document.querySelectorAll(".TermText");var pairs=[];var seen={};' +
    'for(var i=0;i+1<els.length;i+=2){var t=norm(els[i].textContent),d=norm(els[i+1].textContent);if(!t||!d)continue;var key=t+"\\u0000"+d;if(seen[key])continue;seen[key]=1;pairs.push({term:t,definition:d});}' +
    'return {cards:pairs,skipped:0};' +
    '}' +
    'function deliver(res){' +
    'if(!res||!res.cards||res.cards.length<2){alert("Gravity: no terms found on this page. If a One-more-step check is showing, solve it first, then click this bookmarklet again. Copy/paste import from the Gravity site also works.");return;}' +
    'var title=norm((document.querySelector("h1")||{}).textContent)||document.title||"Quizlet set";' +
    'var msg={source:"qg-browser-import",type:"quizlet-cards",title:title,url:location.href,cards:res.cards,skipped:res.skipped||0};' +
    'if(window.opener&&!window.opener.closed){' +
    'window.opener.postMessage(msg,ORIGIN);' +
    'setTimeout(function(){try{window.close();}catch(e){}setTimeout(function(){try{if(!window.closed)location.href=ORIGIN;}catch(e){}},400);},300);' +
    '}else{' +
    'alert("Scraped "+res.cards.length+" terms, but no Gravity tab was found. Keep quizletgravity.com open, click Import Quizlet Set there, then run this bookmarklet on the set page again. The copy/paste steps on the Gravity site work too.");' +
    '}' +
    '}' +
    'function fallbackChain(){' +
    'var nd=fromNextData();if(nd.cards.length>=2){deliver(nd);return;}' +
    'var dom=fromDom();deliver(dom);' +
    '}' +
    'try{' +
    'if(m){' +
    'var id=m[1],all=[],page=0;' +
    'function nextPage(){' +
    'page++;' +
    'return fetch("/webapi/3.9/studiable-item-documents?filters%5BstudiableContainerId%5D="+id+"&filters%5BstudiableItemType%5D=card&perPage=100&page="+page,{credentials:"same-origin"})' +
    '.then(function(r){return r.ok?r.json():null;})' +
    '.then(function(j){if(!j)return false;var items=[];collect(j,items,0);if(!items.length)return false;all=all.concat(items);return items.length>=100;})' +
    '.then(function(more){return more&&page<20?nextPage():true;});' +
    '}' +
    'nextPage().then(function(){' +
    'if(all.length){var res=cardsFromItems(all);if(res.cards.length>=2){deliver(res);return;}}' +
    'fallbackChain();' +
    '},fallbackChain);' +
    '}else{fallbackChain();}' +
    '}catch(e){alert("Gravity import failed: "+(e&&e.message||e));}' +
    '})();';
}

/** javascript: URL for the draggable "Import to Gravity" bookmarklet link. */
export function buildBookmarkletHref(originUrl: string): string {
  return `javascript:${encodeURIComponent(buildBookmarkletSource(originUrl))}`;
}
