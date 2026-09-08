/* ----------------------------------------------------------------------------
   /api/import-quizlet — server-side Quizlet set importer.

   GET /api/import-quizlet?url=<quizlet set url>

   1. Validates that ?url= points at a Quizlet SET page and extracts the
      numeric set id (never fetched as-is — we rebuild the canonical
      https://quizlet.com/<id>/ URL, so this endpoint can't be abused as an
      open proxy for arbitrary sites).
   2. Fetches the page HTML server-side (browsers can't: Quizlet sends no
      CORS headers) via a fallback chain — direct first, then public relays
      (see src/lib/gravity/quizlet.ts).
   3. Parses the embedded __NEXT_DATA__ payload into ordered
      term/definition pairs.

   Response: { title, url, setId, cards: [{ term, definition }], skipped }
   Errors:   400 bad/missing url · 502 fetch/parse failure (message is meant
             to be shown to the user verbatim in the import panel).
---------------------------------------------------------------------------- */

import { NextRequest, NextResponse } from "next/server";
import {
  extractQuizletSetId,
  fetchQuizletHtml,
  parseQuizletHtml,
} from "@/lib/gravity/quizlet";

// Vercel serverless ceiling for this route — covers the worst case where
// every fetch strategy in the chain times out (4 × 7s).
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const setUrl = new URL(request.url).searchParams.get("url")?.trim() ?? "";

  if (!setUrl) {
    return NextResponse.json(
      { error: "Missing ?url= parameter." },
      { status: 400 },
    );
  }

  const setId = extractQuizletSetId(setUrl);
  if (!setId) {
    return NextResponse.json(
      {
        error:
          "That doesn't look like a Quizlet set link. Expected something like https://quizlet.com/<id>/…flash-cards…",
      },
      { status: 400 },
    );
  }

  const canonical = `https://quizlet.com/${setId}/`;

  try {
    const html = await fetchQuizletHtml(canonical);
    const result = parseQuizletHtml(html, canonical, setId);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Import failed for an unknown reason.",
      },
      { status: 502 },
    );
  }
}
