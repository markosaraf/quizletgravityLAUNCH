import { NextRequest, NextResponse } from "next/server";
import {
  extractQuizletSetId,
  fetchQuizletPage,
  parseQuizletHtml,
  parseQuizletMarkdown,
  parseWebapiJson,
} from "@/lib/gravity/quizlet";

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
          "That doesn't look like a Quizlet set link. Expected something like https://quizlet.com/<id>/flash-cards",
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const canonical = `https://quizlet.com/${setId}/`;

  try {
    const { payload, format } = await fetchQuizletPage(canonical);
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
      {
        headers: {
          "Cache-Control":
            "public, max-age=60, s-maxage=86400, stale-while-revalidate=604800",
        },
      },
    );
  } catch (err) {
    // Full diagnostics go to the server log only — the client always gets
    // the same generic message.
    console.error(
      `[import-quizlet] set ${setId} (${canonical}) failed:`,
      err instanceof Error ? err.message : err,
    );
    return NextResponse.json(
      { error: GENERIC_IMPORT_ERROR },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
