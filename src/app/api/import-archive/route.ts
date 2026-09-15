import { NextRequest, NextResponse } from "next/server";
import {
  archiveSaveUrl,
  extractOriginalSet,
  findArchiveSnapshot,
  importFromArchive,
  parseArchiveSnapshot,
  submitArchiveSave,
} from "@/lib/gravity/archiveToday";
import { extractQuizletSetId } from "@/lib/gravity/quizlet";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * The archive.ph fallback workflow, split into two serverless ops the
 * ImportScreen drives from the browser:
 *
 *   GET  /api/import-archive?url=<quizlet link>   → poll + import
 *        Checks whether an archive.today snapshot exists for the set yet
 *        (the exact pasted URL first, then its query-stripped form).
 *        Responds EITHER {ready:false, …} (keep polling) OR the full
 *        import payload {ready:true, title, cards, …} — one call does both
 *        "is it done?" and "give me the terms", so the client needs no
 *        extra round-trip when the snapshot appears.
 *
 *   POST /api/import-archive  {url}              → trigger the save
 *        Best-effort server-side submission of the Quizlet URL to
 *        archive.today's save queue. From Vercel's datacenter IP this often
 *        meets archive.ph's own captcha wall — the response says so and the
 *        client relies on the popup it already opened, where the USER clicks
 *        "Save" with their own browser (and solves any captcha themselves).
 *
 * Only quizlet.com set URLs and archive.today URLs are ever fetched (both
 * validated below), so this route can never be abused as a generic proxy.
 * Full diagnostics are server-log only — the client gets generic wording.
 */

const NO_STORE_HEADERS: Record<string, string> = { "Cache-Control": "no-store" };

const GENERIC_ARCHIVE_ERROR =
  "Couldn't read that set from archive.ph right now. Please try again in a moment.";

/** Classify + import in one pass: the lookup HTML is parsed immediately when
 *  a snapshot is found, so a ready answer never requires a second fetch. */
async function pollAndImport(quizletUrl: string): Promise<NextResponse> {
  const trimmed = quizletUrl.trim();

  // Probe the exact pasted form first (that's what the user archives via the
  // popup), then the query-stripped canonical form (how older snapshots are
  // usually keyed).
  const variants = [trimmed];
  try {
    const u = new URL(trimmed);
    u.hash = "";
    u.search = "";
    const clean = u.toString();
    if (!variants.includes(clean)) variants.push(clean);
  } catch {
    /* keep the raw form only */
  }

  for (const variant of variants) {
    const lookup = await findArchiveSnapshot(variant);
    if (lookup.status === "found") {
      try {
        const result = parseArchiveSnapshot(lookup.html, {
          sourceUrl: variant,
          fallbackSetId: extractOriginalSet(lookup.html).setId ?? undefined,
        });
        return NextResponse.json(
          {
            ready: true,
            title: result.title,
            url: result.url,
            setId: result.setId,
            cards: result.cards,
            skipped: result.skipped,
            snapshotUrl: lookup.snapshotUrl,
          },
          { headers: NO_STORE_HEADERS },
        );
      } catch (err) {
        console.error(
          "[import-archive] snapshot found but parsing failed:",
          err instanceof Error ? err.message : err,
        );
        return NextResponse.json(
          { ready: false, error: GENERIC_ARCHIVE_ERROR },
          { status: 502, headers: NO_STORE_HEADERS },
        );
      }
    }
    if (lookup.status === "saving") {
      return NextResponse.json(
        { ready: false, saving: true },
        { headers: NO_STORE_HEADERS },
      );
    }
    if (lookup.status === "blocked") {
      return NextResponse.json(
        { ready: false, blocked: true },
        { headers: NO_STORE_HEADERS },
      );
    }
    // 'none' — try the next URL variant
  }

  return NextResponse.json({ ready: false }, { headers: NO_STORE_HEADERS });
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url).searchParams.get("url")?.trim() ?? "";
  if (!url) {
    return NextResponse.json(
      { error: "Missing ?url= parameter." },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  // Archive.today snapshot links import directly (same behaviour as
  // /api/import-quizlet — kept here so the poll endpoint is self-sufficient).
  if (/^([a-z0-9-]+\.)*archive\.(ph|today|is|li|md|vn|fo|ng|gg|hk)\//i.test(url)) {
    try {
      const result = await importFromArchive(url);
      return NextResponse.json(
        {
          ready: true,
          title: result.title,
          url: result.url,
          setId: result.setId,
          cards: result.cards,
          skipped: result.skipped,
        },
        { headers: NO_STORE_HEADERS },
      );
    } catch (err) {
      console.error(
        "[import-archive] direct snapshot import failed:",
        err instanceof Error ? err.message : err,
      );
      return NextResponse.json(
        { error: GENERIC_ARCHIVE_ERROR },
        { status: 502, headers: NO_STORE_HEADERS },
      );
    }
  }

  const setId = extractQuizletSetId(url);
  if (!setId) {
    return NextResponse.json(
      { error: "That doesn't look like a Quizlet set link." },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  try {
    return await pollAndImport(url);
  } catch (err) {
    console.error(
      "[import-archive] poll failed:",
      err instanceof Error ? err.message : err,
    );
    return NextResponse.json(
      { error: GENERIC_ARCHIVE_ERROR },
      { status: 502, headers: NO_STORE_HEADERS },
    );
  }
}

export async function POST(request: NextRequest) {
  let body: { url?: unknown } = {};
  try {
    body = (await request.json()) as { url?: unknown };
  } catch {
    return NextResponse.json(
      { error: "Expected a JSON body with a url field." },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (!url || !extractQuizletSetId(url)) {
    return NextResponse.json(
      { error: "That doesn't look like a Quizlet set link." },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const submission = await submitArchiveSave(url);
  if (!submission.submitted) {
    console.error("[import-archive] server-side save attempt failed:", submission.detail);
  } else {
    console.log("[import-archive] server-side save accepted:", submission.detail);
  }

  // The client ALWAYS also gets the popup URL — when the server-side save
  // was blocked (the usual case from a datacenter IP), the user's own
  // browser does the saving there instead.
  return NextResponse.json(
    {
      submitted: submission.submitted,
      blocked: submission.blocked,
      saveUrl: archiveSaveUrl(url),
    },
    { headers: NO_STORE_HEADERS },
  );
}
