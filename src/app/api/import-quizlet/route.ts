import { NextRequest, NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { fetchQuizletSet, QuizletImportError } from '@/lib/gravity/quizlet';
import { normalizeQuizletUrl } from '@/lib/gravity/quizlet-parser';
import { ImportGuard } from '@/lib/gravity/quizlet-import-guard';

export const runtime = 'nodejs';
export const maxDuration = 60;
const guard = new ImportGuard();
const NO_STORE = { 'Cache-Control': 'no-store' };

function failure(message: string, status: number) {
  return NextResponse.json({ error: message }, {
    status, headers: { ...NO_STORE, ...(status === 429 ? { 'Retry-After': '60' } : {}) },
  });
}

function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  return request.headers.get('sec-fetch-site') !== 'cross-site' &&
    (!origin || origin === new URL(request.url).origin);
}

async function importSet(request: NextRequest, raw: unknown) {
  if (!sameOrigin(request)) return failure('Open this importer on Quizlet Gravity.', 403);
  let normalized: ReturnType<typeof normalizeQuizletUrl>;
  try {
    if (typeof raw !== 'string') throw new Error('Enter a Quizlet set link.');
    normalized = normalizeQuizletUrl(raw);
  } catch (error) {
    return failure(error instanceof Error ? error.message : 'Enter a Quizlet set link.', 400);
  }
  const caller = request.headers.get('x-real-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  if (!guard.allow(caller)) return failure('Too many imports. Please wait a minute and try again.', 429);
  try {
    // Cache the complete parsed set, independent of slug, locale or tracking
    // parameters. Exceptions are never saved as successful cache entries.
    const task = guard.run(normalized.setId, () => unstable_cache(
      () => fetchQuizletSet(normalized.url),
      ['quizlet-firecrawl-v1', normalized.setId],
      { revalidate: 3600 },
    )());
    if (!task) return failure('Other sets are importing. Please try again in a moment.', 429);
    const result = await task;
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (error) {
    const known = error instanceof QuizletImportError;
    console.error(JSON.stringify({ event: 'quizlet_import_failed', setId: normalized.setId,
      code: known ? error.code : 'unexpected_error' }));
    return failure(known ? error.message : "Couldn't import that set. Try again or paste your terms below.",
      known ? error.status : 502);
  }
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return failure('Open this importer on Quizlet Gravity.', 403);
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return failure('Send a JSON object containing a Quizlet URL.', 415);
  }
  const reader = request.body?.getReader();
  if (!reader) return failure('Enter a Quizlet set link.', 400);
  let text = '';
  let bytes = 0;
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 4096) {
        await reader.cancel();
        return failure('The import request is too large.', 413);
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    const body = JSON.parse(text);
    return importSet(request, body?.url);
  } catch {
    return failure('Send a JSON object containing a Quizlet URL.', 400);
  } finally {
    reader.releaseLock();
  }
}

/** Keep already-open browser tabs compatible with the former GET importer. */
export async function GET(request: NextRequest) {
  return importSet(request, new URL(request.url).searchParams.get('url'));
}
