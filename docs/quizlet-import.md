# Quizlet link import

## Request path

The browser sends `POST /api/import-quizlet` with `{ "url": "https://quizlet.com/..." }`. The server accepts only Quizlet set-page URLs, strips query strings/fragments, and requests raw HTML from Firecrawl v2. It does not forward cookies, login credentials or arbitrary destinations. The former proxy, Jina/ZAI, internal web API and archive creation/lookup paths have been removed. The legacy GET endpoint remains for already-open tabs.

Parsing is deterministic: it reads the requested set’s embedded JSON, verifies the set/container/item identities and expected active item count, and orders cards by rank. Partial or unsupported pages fail rather than silently importing fewer cards. Cards without text on both sides are counted as skipped and reported. Distinct source IDs with equal text remain distinct. Embedded newlines/tabs are preserved through preview, separator changes and game setup.

## Hosting and cost controls

- Vercel Hobby hosts the small API function. Firecrawl handles retrieval externally.
- `FIRECRAWL_API_KEY` is server-only and required in production. Add it as a Vercel Secret in Production and Preview, then redeploy.
- The provider timeout is 45 seconds; an outer abort is 50 seconds within the route’s 60-second limit. No retry chain runs.
- Complete results are cached for one hour by numeric set ID, independent of tracking parameters or slug.
- A single process merges concurrent requests for the same set, permits two distinct imports concurrently, and limits each client to ten requests per minute. These guards are instance-local, not a global distributed rate limit.
- Provider quotas apply across instances. Keep the Firecrawl free plan or configure account spending/credit limits before enabling paid usage. Do not enable automatic paid top-ups unintentionally.
- Requests, upstream bodies and parsed responses are bounded. The parsed response is limited to 1 MB to stay within cache/hosting limits.
- Existing JINA/ZAI variables are no longer read. They may be removed from this Vercel project once rollback is no longer needed. No other project keys should be changed.

## Verification

Run `npm test`, `npm run typecheck`, and `npm run build` after installing with the existing Bun lockfile. Tests use synthetic set data. The parser additionally checks the file named by `QUIZLET_HTML_FIXTURE` when set (with `QUIZLET_FIXTURE_URL` and optional `QUIZLET_FIXTURE_COUNT`); the downloaded study content is not committed.

Live reference tested on 15 October 2026: `https://quizlet.com/ch/1181229873/voci-mission-6-flash-cards/` returned all 62 source cards, including the correct first and last entries. This demonstrates one working public set, not guaranteed access to every Quizlet page. Private, password-protected, blocked, changed-format or incomplete pages receive a clear error with paste/file alternatives.

In a browser, import that URL, check the 62-row preview, change separators, and start the game. Also test a lookalike host (rejected without contacting Firecrawl), manual paste, and multiline structured cards. Firecrawl’s key must not appear in browser requests or assets.

## Rollback

Before this change, production was deployment `dpl_9ezFtikmDt7gDqUXR4hqKBD7jgCc`, commit `4acb517b1f2c4f2b9449758f8ca11198d52c5b85`. Vercel can roll back to that deployment. There are no database migrations.

## Provider choice

Firecrawl was selected after a real successful raw-HTML retrieval. Browserbase also runs independently of Vercel but has not been proven against these sets in this project. Both are external services; upgrading Vercel alone does not turn a server request into a human browser.

References: https://www.firecrawl.dev/pricing, https://docs.firecrawl.dev/features/scrape, https://docs.firecrawl.dev/rate-limits, https://www.browserbase.com/pricing.

## Deployment handoff (15 October 2026)

The implementation is committed locally on `fix/firecrawl-import` in this worktree. GitHub push was rejected because the local Git credentials identify `natasasdj`; no remote branch was changed. Vercel MCP/CLI deployment attempts were rejected by account permissions, so the live website still uses the previous importer until a deployment succeeds. The key was confirmed as a Vercel Secret and its target includes Production and Preview.

After signing in to the correct Vercel account with `npx vercel@latest login`, verify this folder resolves to project `quizletgravity-launch` in `markosarafs-projects`. Deploy a preview and verify a real import with the production-like configuration before publishing to the production domain. Do not treat a local successful import as a published fix.
