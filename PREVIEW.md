# Quizzlet Gravity preview

This branch is isolated from the stable Quizlet Gravity site. The dedicated Vercel project is `quizzlet-gravity-preview`; do not deploy this branch to `quizletgravity-launch`.

## Local development

Use Node.js 24.22.1 or later supported patched release, `npm ci`, and `npm run dev -- --port 3035`.
Secrets belong in `.env.local`, never git. Required: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`. Optional: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `FIRECRAWL_API_KEY`, `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`.

The only application database is `quizzlet_preview` on the isolated Neon branch. `scripts/migrate-community.ts` refuses other database names. Do not migrate the source project's main branch.

## Data model

Original Quizlet numeric IDs are unique, including imports with different locale/slug/tracking URLs. Each ID keeps one immutable imported snapshot and one leaderboard. Custom sets deduplicate normalized term/definition content. Changing a snapshot creates a separate custom set rather than mixing scores from different terms. Search is indexed and paginated (24 results); scores are paginated (50 results) with one best score per player/set. A transaction probe with 10,000 temporary sets returned 25 results in approximately 260 ms and was rolled back.

Guest identity is cookie-based. Registering or signing in merges guest scores and set ownership into the account. Passwords are hashed by Better Auth. Native Google sign-in uses the system browser and a short-lived, one-use PKCE-protected handoff, not embedded Google sign-in or a privileged JavaScript bridge.

Scores use owned, single-completion game runs and basic elapsed-time bounds. They are not a tamper-proof competitive ranking system: gameplay remains client-side. Do not describe scores as server-verified or suitable for prizes.

## Verification

- `npx tsc --noEmit`
- `node --test tests/*.test.ts`
- `node --env-file=.env.local scripts/community-smoke.mjs`
- `node --env-file=.env.local scripts/native-auth-smoke.mjs`
- `TEST_URL=https://quizzlet-gravity-preview.vercel.app node scripts/browser-smoke.mjs`
- `TEST_URL=https://quizzlet-gravity-preview.vercel.app node --env-file=.env.local scripts/shared-game-smoke.mjs`

The API smoke scripts remove their test user/set. Browser smoke creates a disposable named guest. Never test recovery by sending an email from the owner's account. Recovery configuration can be checked by refreshing its OAuth token without sending mail.

## Deployment

Deploy to the dedicated project using `vercel deploy --environment preview`, then assign only `quizzlet-gravity-preview.vercel.app` to the resulting deployment. Do not promote the stable site's deployment. This preview sets noindex headers and disallows crawlers.

## Native builds

Separate app source: `/Users/marko/Documents/marko/Quizlet/quizzlet-gravity-preview-apps`. Android package `com.quizletgravity.preview.android`, iOS bundle `com.quizletgravity.preview.ios`, display name **Quizzlet Gravity**. Preview signing material lives outside either repository. See the native preview readme for installation limitations.

## Verified integrations

Google sign-in is configured for the dedicated preview host. Password recovery uses the owner-authorized send-only Gmail credential; token refresh was verified without sending an email. Firecrawl is on a free account, so imports remain subject to its quota. Existing shared Quizlet IDs are served from the database without another provider fetch. A real 62-card set was checked for title, original creator and complete terms.
