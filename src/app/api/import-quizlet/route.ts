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
    const { payload, format, via } = await fetchQuizletPage(canonical);
    const result =
      format === "reader-md"
        ? parseQuizletMarkdown(payload, canonical, setId)
        : format === "webapi-json"
          ? parseWebapiJson(payload, canonical, setId)
          : parseQuizletHtml(payload, canonical, setId);
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
