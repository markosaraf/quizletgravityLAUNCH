/* ----------------------------------------------------------------------------
   /api/indexnow — HTTP endpoint that triggers an IndexNow submission.

   Two ways it gets called:
     1. VERCEL CRON (automatic, daily) — Vercel's scheduler GETs this path.
        Vercel cron invocations carry the `x-vercel-cron` header, so they
        are allowed through without a secret.
     2. MANUAL (you) — POST with a JSON body, or GET with ?secret=...
        Protected by INDEXNOW_SECRET (if set) so randoms can't spam
        submissions through your endpoint.

   Cron schedule lives in /vercel.json at the REPO ROOT (see that file).
---------------------------------------------------------------------------- */

import { NextRequest, NextResponse } from "next/server";
import { submitToIndexNow } from "@/lib/indexnow";

const INDEXNOW_SECRET = process.env.INDEXNOW_SECRET || "";

function isAuthorized(request: NextRequest): boolean {
  // Bearer token in the Authorization header, or ?secret= query param.
  const authHeader = request.headers.get("authorization");
  if (authHeader === `Bearer ${INDEXNOW_SECRET}`) return true;

  const url = new URL(request.url);
  if (url.searchParams.get("secret") === INDEXNOW_SECRET) return true;

  return false;
}

function isVercelCron(request: NextRequest): boolean {
  // Vercel Cron invocations always carry the x-vercel-cron header.
  // Checked by presence (not exact value) to be robust across Vercel
  // versions.
  return Boolean(request.headers.get("x-vercel-cron"));
}

export async function POST(request: NextRequest) {
  if (INDEXNOW_SECRET && !isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Optional body: { "urls": ["https://www.quizletgravity.com", ...] }
    const { urls } = await request.json();

    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return NextResponse.json(
        { error: "urls array required" },
        { status: 400 }
      );
    }

    await submitToIndexNow(urls);
    return NextResponse.json({ submitted: urls });
  } catch (error) {
    return NextResponse.json({ error: "Failed to submit" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  // Allow Vercel Cron without a secret (the header proves it's Vercel's
  // scheduler). Everyone else needs the secret (if one is configured).
  if (!isVercelCron(request) && INDEXNOW_SECRET && !isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // No body needed — submits the full SITE_URLS list from the library.
  await submitToIndexNow();
  return NextResponse.json({
    message: "All site URLs submitted to IndexNow",
  });
}
