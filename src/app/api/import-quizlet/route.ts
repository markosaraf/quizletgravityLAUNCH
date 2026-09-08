/* ----------------------------------------------------------------------------
   /api/import-quizlet — server-side Quizlet set importer.

   GET /api/import-quizlet?url=<quizlet set url>

   1. Validates that ?url= points at a Quizlet SET page and extracts the
      numeric set id (never fetched as-is — we rebuild the canonical
      https://quizlet.com/<id>/ URL, so this endpoint can't be abused as an
      open proxy for arbitrary sites).
   2. Fetches the page HTML server-side (browsers can't: Quizlet sends no
      CORS headers) via a fallback chain inside a wall-clock budget:
      z-ai page reader (optional SDK) → direct fetch → web.archive.org
      latest snapshot → web.archive.org Save-Page-Now → allorigins / jina /
      codetabs relays (see src/lib/gravity/quizlet.ts).
   3. Parses the embedded __NEXT_DATA__ payload into ordered
      term/definition pairs.

   Response: { title, url, setId, cards: [{ term, definition }], skipped, via }
   Errors:   400 bad/missing url · 502 fetch/parse failure (message is meant
             to be shown to the user verbatim in the import panel).

   Runs on the Node.js runtime (the optional page_reader strategy may use
   node:fs / node:os to bootstrap credentials) with the maximum serverless
   duration — the fetch chain's own deadline (55s) fires first.
---------------------------------------------------------------------------- */

import { NextRequest, NextResponse } from "next/server";
import {
  extractQuizletSetId,
  fetchQuizletHtml,
  parseQuizletHtml,
} from "@/lib/gravity/quizlet";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const setUrl = new URL(request.url).searchParams.get("url")?.trim() ?? "";

  if (!setUrl) {
    return NextResponse.json(
      { error: "Missing ?url= parameter." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const setId = extractQuizletSetId(setUrl);
  if (!setId) {
    return NextResponse.json(
      {
        error:
          "That doesn't look like a Quizlet set link. Expected something like https://quizlet.com/<id>/…flash-cards…",
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const canonical = `https://quizlet.com/${setId}/`;

  try {
    const { html, via } = await fetchQuizletHtml(canonical);
    const result = parseQuizletHtml(html, canonical, setId);
    // Successful imports are identical for the same set — let the CDN cache
    // them for a day so repeat imports don't hammer Quizlet/Wayback again.
    return NextResponse.json(
      { ...result, via },
      {
        headers: {
          "Cache-Control": "public, max-age=60, s-maxage=86400, stale-while-revalidate=604800",
        },
      },
    );
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Import failed for an unknown reason.",
      },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
