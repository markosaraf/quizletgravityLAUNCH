/* ----------------------------------------------------------------------------
   IndexNow submission library — https://indexnow.org

   WHAT THIS DOES:
   IndexNow tells participating search engines (Bing, Yandex, Seznam, Naver)
   "these URLs changed, come crawl them now" — instantly, instead of waiting
   for their organic recrawl schedule. A single POST to the shared endpoint
   (api.indexnow.org) fans out to all participating engines.

   NOTE: Google does NOT participate in IndexNow. Google re-crawls via your
   sitemap + Search Console; this file is purely for Bing & friends — which
   is exactly what you want while waiting on Bing to index a brand-new site.

   HOW THE KEY WORKS:
   The key proves you own the host. Engines verify it by fetching:
       https://www.quizletgravity.com/27d1a1f6394a898f94fcd03d71f91f5e.txt
   ...which must contain exactly this key. That file lives in public/.

   THE KEY MUST BE UNIQUE PER SITE — do not reuse the key from another
   site/domain. (This is a fresh key generated for quizletgravity.com.)
---------------------------------------------------------------------------- */

// Set INDEXNOW_KEY in Vercel env vars to override without redeploying code.
const INDEXNOW_KEY =
  process.env.INDEXNOW_KEY || "27d1a1f6394a898f94fcd03d71f91f5e";

// MUST be the primary (canonical) host — the one the key file is served on.
const SITE_HOST = "www.quizletgravity.com";

// All known pages on the site — add new URLs here when you create new pages
// (e.g., future shareable study-set pages: https://www.quizletgravity.com/s/<id>)
const SITE_URLS: string[] = [
  "https://www.quizletgravity.com",
  // 👆 Add new page URLs here as you create them
];

export async function submitToIndexNow(urls?: string[]): Promise<void> {
  const urlList = urls || SITE_URLS;

  try {
    const response = await fetch("https://api.indexnow.org/IndexNow", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        host: SITE_HOST,
        key: INDEXNOW_KEY,
        keyLocation: `https://${SITE_HOST}/${INDEXNOW_KEY}.txt`,
        urlList,
      }),
    });

    // Status codes: 200 = accepted & key verified, 202 = accepted (key
    // verification pending — engines re-check later), 400 = bad request,
    // 403 = key invalid (key file missing/wrong at keyLocation).
    console.log(
      `[IndexNow] Submitted ${urlList.length} URL(s) — Status: ${response.status}`
    );
  } catch (error) {
    console.error("[IndexNow] Submission failed:", error);
  }
}

// Shortcut: submit a single URL (great for calling after content changes)
export async function submitUrlToIndexNow(url: string): Promise<void> {
  return submitToIndexNow([url]);
}
