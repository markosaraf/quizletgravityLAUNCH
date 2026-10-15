/** Public Quizlet imports through Firecrawl. No relays, archives or AI-generated cards. */
import { normalizeQuizletUrl, parseQuizletHtml } from './quizlet-parser.ts';
import type { QuizletImportResult } from './quizlet-parser.ts';

export class QuizletImportError extends Error {
  code: string;
  status: number;
  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = 'QuizletImportError';
    this.code = code;
    this.status = status;
  }
}

const UNAVAILABLE = "Couldn't read the complete Quizlet set. Make sure it is public, or paste the terms below.";
const MAX_RESPONSE_BYTES = 12 * 1024 * 1024;

async function readResponse(response: Response): Promise<string> {
  if (!response.body) throw new QuizletImportError('empty_response', 502, UNAVAILABLE);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new QuizletImportError('response_too_large', 502, UNAVAILABLE);
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

interface FetchOptions {
  fetchImpl?: typeof fetch;
  apiKey?: string;
  allowKeyless?: boolean;
}

export async function fetchQuizletSet(rawUrl: string, options: FetchOptions = {}): Promise<QuizletImportResult> {
  const { setId, url } = normalizeQuizletUrl(rawUrl);
  const apiKey = (options.apiKey ?? process.env.FIRECRAWL_API_KEY ?? '').trim();
  const allowKeyless = options.allowKeyless ??
    (process.env.NODE_ENV !== 'production' && process.env.FIRECRAWL_ALLOW_KEYLESS === 'true');
  if (!apiKey && !allowKeyless) {
    throw new QuizletImportError('not_configured', 503,
      'Link import is temporarily unavailable. You can still paste your terms below or upload a file.');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 50_000);
  try {
    const response = await (options.fetchImpl ?? fetch)('https://api.firecrawl.dev/v2/scrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
      body: JSON.stringify({ url, formats: ['rawHtml'], onlyMainContent: false, timeout: 45_000, maxAge: 3_600_000 }),
      signal: controller.signal,
      cache: 'no-store',
    });
    if (response.status === 429 || response.status === 402) {
      await response.body?.cancel();
      throw new QuizletImportError('provider_limit', 429,
        'Link imports have reached their current limit. Please try later, or paste your terms below.');
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new QuizletImportError(`provider_http_${response.status}`, 502, UNAVAILABLE);
    }
    const payload = JSON.parse(await readResponse(response));
    if (payload?.success !== true || payload?.data?.metadata?.statusCode !== 200 ||
        payload?.data?.metadata?.error || typeof payload?.data?.rawHtml !== 'string') {
      throw new QuizletImportError('upstream_page_unavailable', 502, UNAVAILABLE);
    }
    let result: QuizletImportResult;
    try {
      result = parseQuizletHtml(payload.data.rawHtml, url, setId);
    } catch {
      throw new QuizletImportError('incomplete_or_unsupported_set', 422, UNAVAILABLE);
    }
    if (Buffer.byteLength(JSON.stringify(result), 'utf8') > 1_000_000) {
      throw new QuizletImportError('set_too_large', 422,
        'This set is too large to import by link. Please split it into smaller sets.');
    }
    return result;
  } catch (error) {
    if (error instanceof QuizletImportError) throw error;
    if (controller.signal.aborted) {
      throw new QuizletImportError('provider_timeout', 504,
        'The set took too long to load. Please try again, or paste your terms below.');
    }
    throw new QuizletImportError('provider_response_failed', 502, UNAVAILABLE);
  } finally {
    clearTimeout(timer);
  }
}
