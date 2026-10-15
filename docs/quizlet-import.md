# Quizlet link import

## Request path

The browser sends `POST /api/import-quizlet` with `{ "url": "https://quizlet.com/..." }`. The server accepts Quizlet set-page URLs, strips query strings/fragments, and requests raw HTML from Firecrawl v2. Legacy ID-first links retain their locale/slug. Translated links such as `/de/karteikarten/einmaleins-250942042` are recognised by the locale/resource/slug-ID structure and rebuilt as `https://quizlet.com/250942042/`. Locale and translated resource names are not restricted to a fixed language list. This handles Finnish ID-first links as well as translated and non-Latin URL structures without forwarding arbitrary path segments. It does not forward cookies, login credentials or arbitrary destinations. The former direct proxy, Jina/ZAI and archive creation/lookup paths have been removed. When a validated public page embeds fewer cards than it announces, Firecrawl retrieves Quizlet’s public card batches (500 entries per page) from a server-constructed URL. All batches are checked against the original set identity and count before any result is returned. The legacy GET endpoint remains for already-open tabs.

Parsing is deterministic: it reads the requested set’s embedded JSON, verifies the set/container/item identities and expected active item count, and orders cards by rank. Partial or unsupported pages fail rather than silently importing fewer cards. Cards without text on both sides are counted as skipped and reported. Distinct source IDs with equal text remain distinct. Embedded newlines/tabs are preserved through preview, separator changes and game setup.

## Hosting and cost controls

- Vercel Hobby hosts the small API function. Firecrawl handles retrieval externally.
- `FIRECRAWL_API_KEY` is server-only and required in production. Add it as a Vercel Secret in Production and Preview, then redeploy.
- The provider timeout is 45 seconds; an outer abort is 50 seconds within the route’s 60-second limit. No retry chain runs. Large-set pagination shares that same overall deadline and is bounded to ten card batches (the existing 5,000-card limit).
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

## Initial Firecrawl release (15 October 2026)

Published to https://www.quizletgravity.com using the authenticated Vercel CLI from this worktree. Preview deployment `dpl_GoEgmNQ2dFyCoD5hak7tvyjhpR5G` successfully imported all 62 reference cards with the configured account key before production was published.

Production deployment: `dpl_8onf59TqkqiWrxBwiWqunZbndPay` (https://quizletgravity-launch-i6qoqj8eq-markosarafs-projects.vercel.app). Deployed application source is local commit `55ac012` on `fix/firecrawl-import` (implementation commit `def7781`). Vercel Hobby was retained.

The production browser check verified the actual same-origin POST, all 62 cards with zero skipped, preview-to-game persistence, separator changes, rapid-click deduplication, active gameplay, and manual paste. No browser errors occurred. The production API rejected lookalike hosts and missing URLs with HTTP 400; the apex domain resolves to the live website. Evidence remains outside the repository at `/tmp/quizlet-deployment-browser-evidence.json`.

The source is saved locally in this worktree. GitHub push was rejected because the local Git credentials identify `natasasdj`; no remote branch was changed. The GitHub main branch therefore still contains the previous importer. Before subsequent Git-triggered deployments, push/merge this tested branch using the GitHub account with write access so it does not get overwritten by the old code.

`FIRECRAWL_API_KEY` is configured as a Secret for Production and Preview. No key is in the source or browser bundle. Rotate keys through Firecrawl and update Vercel directly, then redeploy.

## Localized URL regression (15 October 2026)

The initial URL validator rejected the real German route `/de/karteikarten/einmaleins-250942042` before contacting Firecrawl. Structural matching now extracts the terminal set ID without a dictionary of translated route names. Exact hostname checks, bounded numeric IDs, decoded-segment validation and complete fetched-set identity checks remain.

Added synthetic route tests cover German, French, Finnish, Spanish, Japanese, Chinese and Arabic characters plus malformed/encoded/extra-path rejection. Actual provider fixtures verified the user’s German Einmaleins set (100 cards) and a real Finnish `/fi/666063657/quizlet-flash-cards/` set (20 cards). Canonical numeric retrieval of the German set was also verified before deployment. Synthetic localized routes test parser generality and are not claimed to be actual Quizlet endpoints.

## Localized-link production release (15 October 2026)

Localized-link support is live at https://www.quizletgravity.com in deployment `dpl_5X1udabZcyGApZaqn4GawLfNmxLN` (https://quizletgravity-launch-rh3ohhp06-markosarafs-projects.vercel.app), built from local source commit `7602602`. The same source passed on preview `dpl_E44ZYonaAFuhjD3YA5JEtMibkWpx` before publication. No Vercel plan upgrade was needed.

The live browser import form accepted the exact reported German link and imported all 100 cards, with every preview field and stored pair matching the API result, then started active gameplay. It also accepted the real Finnish link and displayed all 20 cards correctly. Both requests returned HTTP 200 with zero skipped cards, and no browser page errors occurred. Evidence is saved outside the repository at `/tmp/quizlet-localized-browser-evidence.json`. Regression tests, type checking, targeted lint and the production build passed before deployment.

## Import-tabs release (15 October 2026)

Deployment `dpl_BnXgCswPjZX8UnTFoVL8pCnPCKyt` at https://www.quizletgravity.com contains source commit `447f4b7`. Import Quizlet Set is the default and remains selected after importing. All three import methods share one selected-tab state, so only one receives the selected styling. Separator controls and manual paste/file inputs appear only for their respective methods. The shared editable preview table is unchanged.

Type checking, targeted ESLint and the Vercel production build passed. Desktop and mobile browser checks verified exclusive selection, separator visibility, preview editing and persistence, plus manual paste and CSV. These UI checks used a previously captured provider response and spent no Firecrawl credits.

The focused UI checks also passed on the published website at 1280×1000 and 390×844, with no browser errors or horizontal overflow. Live-page evidence: `/tmp/quizlet-tabs-browser-evidence.json`; local manual-input evidence: `/tmp/quizlet-manual-tabs-evidence.json`.

## Current production release: large-set pagination (15 October 2026)

The reported set `1023956509` announces 987 entries but embeds only 100 in the initial page. The importer now retrieves the remaining data through public card batches and verifies IDs, ordering, page totals, overlaps and the final unique count. Real retrieval produced 943 playable pairs and explicitly reported 44 entries with an empty side. No missing definitions are guessed. Synthetic regression tests cover 987-card retrieval and truncated, stale, mismatched, repeated and conflicting batches.

Published source `003b8aa` as production deployment `dpl_32BUqaFghtLr2ycqjfFyA44kfJhZ` at https://www.quizletgravity.com. The exact reported URL passed a real browser import: HTTP 200, 943 pairs and 44 explicitly skipped entries, all preview fields identical to the fetched source pairs, persisted cards intact, and active gameplay reached with no browser errors. Evidence: `/tmp/quizlet-large-production-browser-evidence.json`. All 30 automated tests, type checking, targeted lint and the production build passed (one optional external-fixture test skipped).
