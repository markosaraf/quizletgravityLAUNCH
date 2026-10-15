import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchQuizletSet, QuizletImportError } from '../src/lib/gravity/quizlet.ts';

const SET_ID = '123456789';
const SET_URL = `https://quizlet.com/ch/${SET_ID}/example-flash-cards/`;

function payload() {
  const set = { id: Number(SET_ID), numTerms: 2, title: 'Synthetic provider fixture' };
  const redux = {
    setPage: { set },
    studyModesCommon: { studiableData: {
      studiableContainer: set,
      studiableContainerType: 1,
      studiableItems: [0, 1].map((rank) => ({
        id: rank + 1,
        rank,
        isDeleted: false,
        studiableContainerType: 1,
        studiableContainerId: Number(SET_ID),
        cardSides: [
          { label: 'word', media: [{ plainText: `Word ${rank}` }] },
          { label: 'definition', media: [{ plainText: `Meaning ${rank}` }] },
        ],
      })),
    } },
  };
  const state = { query: { setId: SET_ID }, props: { pageProps: { dehydratedReduxStateKey: JSON.stringify(redux) } } };
  return {
    success: true,
    data: { metadata: { statusCode: 200 }, rawHtml: `<script id="__NEXT_DATA__">${JSON.stringify(state)}</script>` },
  };
}

function isImportError(code: string, status: number) {
  return (error: unknown): boolean => {
    assert.ok(error instanceof QuizletImportError);
    assert.equal(error.code, code);
    assert.equal(error.status, status);
    return true;
  };
}

test('makes one bounded rawHtml-only request to the fixed provider endpoint', async () => {
  let calls = 0;
  const result = await fetchQuizletSet(`${SET_URL}?tracking=removed`, {
    apiKey: 'test-token',
    allowKeyless: false,
    fetchImpl: async (input, init) => {
      calls += 1;
      assert.equal(input, 'https://api.firecrawl.dev/v2/scrape');
      assert.equal(init?.method, 'POST');
      assert.equal(init?.cache, 'no-store');
      const headers = new Headers(init?.headers);
      assert.equal(headers.get('authorization'), 'Bearer test-token');
      assert.equal(headers.get('content-type'), 'application/json');
      assert.deepEqual(JSON.parse(String(init?.body)), {
        url: SET_URL,
        formats: ['rawHtml'],
        onlyMainContent: false,
        timeout: 45_000,
        maxAge: 3_600_000,
      });
      assert.ok(init?.signal instanceof AbortSignal);
      return Response.json(payload());
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.setId, SET_ID);
  assert.deepEqual(result.cards, [
    { term: 'Word 0', definition: 'Meaning 0' },
    { term: 'Word 1', definition: 'Meaning 1' },
  ]);
});

test('missing configuration and invalid source URLs never invoke the provider', async () => {
  const unexpectedFetch: typeof fetch = async () => { throw new Error('Provider must not be called'); };
  await assert.rejects(fetchQuizletSet(SET_URL, { apiKey: '', allowKeyless: false, fetchImpl: unexpectedFetch }),
    isImportError('not_configured', 503));
  await assert.rejects(fetchQuizletSet(`https://quizlet.evil.example/${SET_ID}/`, {
    apiKey: 'test-token', allowKeyless: false, fetchImpl: unexpectedFetch,
  }), /quizlet\.com/);
});

test('explicit keyless mode omits authentication', async () => {
  await fetchQuizletSet(SET_URL, {
    apiKey: '',
    allowKeyless: true,
    fetchImpl: async (_input, init) => {
      assert.equal(new Headers(init?.headers).has('authorization'), false);
      return Response.json(payload());
    },
  });
});

test('provider HTTP errors are bounded and do not expose upstream messages', async () => {
  for (const status of [401, 402, 429, 500]) {
    const limited = status === 402 || status === 429;
    let cancelled = false;
    const body = new ReadableStream({ cancel() { cancelled = true; } });
    await assert.rejects(fetchQuizletSet(SET_URL, {
      apiKey: 'test-token', allowKeyless: false,
      fetchImpl: async () => new Response(body, { status }),
    }), isImportError(limited ? 'provider_limit' : `provider_http_${status}`, limited ? 429 : 502));
    assert.equal(cancelled, true);
  }
});

test('upstream status and metadata must confirm a successful page', async () => {
  for (const body of [
    { ...payload(), success: false },
    { success: true, data: { ...payload().data, metadata: { statusCode: 403 } } },
    { success: true, data: { ...payload().data, metadata: { statusCode: 200, error: 'private upstream detail' } } },
    { success: true, data: { markdown: 'Plausible generated cards', metadata: { statusCode: 200 } } },
  ]) {
    await assert.rejects(fetchQuizletSet(SET_URL, {
      apiKey: 'test-token', allowKeyless: false, fetchImpl: async () => Response.json(body),
    }), isImportError('upstream_page_unavailable', 502));
  }
});

test('complete provider responses still fail if the source cards are unavailable or mismatched', async () => {
  const challenge = payload();
  challenge.data.rawHtml = '<html><title>Just a moment...</title></html>';
  const wrongSet = payload();
  wrongSet.data.rawHtml = wrongSet.data.rawHtml.split(SET_ID).join('999999999');
  for (const body of [challenge, wrongSet]) {
    await assert.rejects(fetchQuizletSet(SET_URL, {
      apiKey: 'test-token', allowKeyless: false, fetchImpl: async () => Response.json(body),
    }), isImportError('incomplete_or_unsupported_set', 422));
  }
});

test('network errors and malformed JSON expose only a generic response failure', async () => {
  for (const fetchImpl of [
    async () => { throw new Error('Sensitive upstream error containing test-token'); },
    async () => new Response('Sensitive invalid JSON containing test-token'),
  ]) {
    await assert.rejects(fetchQuizletSet(SET_URL, { apiKey: 'test-token', allowKeyless: false, fetchImpl }), (error) => {
      isImportError('provider_response_failed', 502)(error);
      assert.ok(error instanceof Error);
      assert.doesNotMatch(error.message, /test-token|Sensitive/);
      return true;
    });
  }
});

test('oversized provider responses are cancelled before parsing', async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array(12 * 1_024 * 1_024 + 1)); },
    cancel() { cancelled = true; },
  });
  await assert.rejects(fetchQuizletSet(SET_URL, {
    apiKey: 'test-token', allowKeyless: false, fetchImpl: async () => new Response(stream),
  }), isImportError('response_too_large', 502));
  assert.equal(cancelled, true);
});

test('provider request is aborted within the server function time budget', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let signal: AbortSignal | null | undefined;
  const request = fetchQuizletSet(SET_URL, {
    apiKey: 'test-token', allowKeyless: false,
    fetchImpl: async (_input, init) => new Promise<Response>((_resolve, reject) => {
      signal = init?.signal;
      signal?.addEventListener('abort', () => reject(new Error('Provider request aborted')), { once: true });
    }),
  });
  const rejection = assert.rejects(request, isImportError('provider_timeout', 504));
  context.mock.timers.tick(50_000);
  await rejection;
  assert.equal(signal?.aborted, true);
});
