import { NextRequest, NextResponse } from "next/server";
import {
  extractQuizletSetId,
  fetchQuizletPage,
  parseQuizletHtml,
  parseQuizletMarkdown,
  parseWebapiJson,
} from "@/lib/gravity/quizlet";
import { importFromArchive, isArchiveTodayUrl } from "@/lib/gravity/archiveToday";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * The ONE error message every import failure returns to the browser.
 * The full technical diagnosis (which fetch strategy failed, why, env-var
 * state, Cloudflare details, …) is logged server-side only — visible to the
 * site owner via `vercel logs`, but never sent to the client, so the
 * response can't reveal how the importer works internally.
 */
const GENERIC_IMPORT_ERROR =
  "Couldn't import that Quizlet set right now. Please try again in a moment — or paste the terms manually below.";

/** JSON headers for a successful import (same caching story as before:
 *  identical sets import identically, so the CDN may cache them a day). */
const SUCCESS_CACHE_HEADERS: Record<string, string> = {
  "Cache-Control": "public, max-age=60, s-maxage=86400, stale-while-revalidate=604800",
};

const NO_STORE_HEADERS: Record<string, string> = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  const setUrl = new URL(request.url).searchParams.get("url")?.trim() ?? "";

  if (!setUrl) {
    return NextResponse.json(
      { error: "Missing ?url= parameter." },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  // ── NEW: direct archive.today snapshot links ───────────────────────────
  // The user may paste the archive.ph link they landed on after saving a
  // snapshot (e.g. https://archive.ph/n1qWi). Import straight from it.
  if (isArchiveTodayUrl(setUrl)) {
    try {
      const result = await importFromArchive(setUrl);
      return NextResponse.json(
        {
          title: result.title,
          url: result.url,
          setId: result.setId,
          cards: result.cards,
          skipped: result.skipped,
        },
        { headers: SUCCESS_CACHE_HEADERS },
      );
    } catch (err) {
      console.error(
        `[import-quizlet] archive.today import failed (${setUrl}):`,
        err instanceof Error ? err.message : err,
      );
      return NextResponse.json(
        { error: err instanceof Error ? err.message : GENERIC_IMPORT_ERROR },
        { status: 502, headers: NO_STORE_HEADERS },
      );
    }
  }

  const setId = extractQuizletSetId(setUrl);
  if (!setId) {
    return NextResponse.json(
      {
        error:
          "That doesn't look like a Quizlet set link. Expected something like https://quizlet.com/<id>/flash-cards — or an archive.ph snapshot link.",
      },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const canonical = `https://quizlet.com/${setId}/`;

  try {
    // The user's FULL link is passed along (originalUrl): its slug path
    // (same host, query/hash stripped) is tried FIRST by the reader
    // strategies — it skips one redirect hop and pins the locale the user
    // actually saw — and is also probed as its own Wayback capture key.
    // The chain's budget is capped at 38 s so the archive.today fallback
    // below still has its share of the 60 s function budget.
    const { payload, format } = await fetchQuizletPage(canonical, {
      originalUrl: setUrl,
      deadlineMs: 38_000,
    });
    const result =
      format === "reader-md"
        ? parseQuizletMarkdown(payload, canonical, setId)
        : format === "webapi-json"
          ? parseWebapiJson(payload, canonical, setId)
          : parseQuizletHtml(payload, canonical, setId);
    // Successful imports are identical for the same set — let the CDN cache
    // them for a day so repeat imports don't hammer Quizlet again. The fetch
    // strategy that delivered the payload (`via`) is deliberately NOT part
    // of the response.
    return NextResponse.json(
      {
        title: result.title,
        url: result.url,
        setId: result.setId,
        cards: result.cards,
        skipped: result.skipped,
      },
      { headers: SUCCESS_CACHE_HEADERS },
    );
  } catch (err) {
    // Full diagnostics go to the server log only — the client always gets
    // the same generic message.
    console.error(
      `[import-quizlet] set ${setId} (${canonical}) failed:`,
      err instanceof Error ? err.message : err,
    );

    // ── NEW: last-resort — an archive.today snapshot may already exist ──
    // Someone may have archived this set before (or the user saved one
    // earlier). A ~20 s probe beats returning an error, and when it hits,
    // the user gets their import with zero extra steps.
    try {
      const result = await importFromArchive(setUrl.includes("quizlet") ? setUrl : canonical);
      console.log(`[import-quizlet] set ${setId} recovered via archive.today snapshot`);
      return NextResponse.json(
        {
          title: result.title,
          url: result.url,
          setId: result.setId,
          cards: result.cards,
          skipped: result.skipped,
        },
        { headers: SUCCESS_CACHE_HEADERS },
      );
    } catch (archiveErr) {
      console.error(
        `[import-quizlet] set ${setId} archive.today fallback also failed:`,
        archiveErr instanceof Error ? archiveErr.message : archiveErr,
      );
    }

    return NextResponse.json(
      { error: GENERIC_IMPORT_ERROR },
      { status: 502, headers: NO_STORE_HEADERS },
    );
  }
}
