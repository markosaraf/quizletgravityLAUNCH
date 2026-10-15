# Quizlet Gravity

A faithful recreation of Quizlet's Gravity study mode (2020–2024 era). Defend your planet from falling asteroids by typing the correct answers before they land. Import a public Quizlet set link, paste a term list, or upload a CSV to play.

## Features

- **7 terms per level**, asteroid fall speed scales with level (gravity 9.8 → 11, +0.2/level)
- **5 difficulties**: Sloth, Easy, Medium, Hard, Mad Max
- **Editable terms table** — fix mis-parses from multi-comma terms; star individual terms to study them in Starred-only mode
- **Copy-the-answer modal** on miss — type the correct answer to keep playing; miss the same term twice and the game is over
- **Session leaderboard** — all tries ranked descending; current try highlighted
- **Dark / light mode toggle** — persists across reloads
- **Mobile-responsive** — sidebar collapses, controls move into the top bar
- **Three separator choices**: comma, semicolon, or dash — pick the one that matches your input

## Tech Stack

- **Framework**: Next.js 16 (App Router) + React 19 + TypeScript 5
- **Styling**: Tailwind CSS 4 + shadcn/ui (New York style)
- **Animations**: Framer Motion + CSS transitions
- **State**: Zustand (client) + `useSyncExternalStore` (game state)
- **Persistence**: `localStorage` for the imported term set, separator choice, theme, and "allow partial answers" preference. The game runs in the browser. Public Quizlet link imports use a server-side Firecrawl request and a one-hour parsed-set cache. No database is required.

## Getting Started

### Prerequisites

- Node.js 24 (matching Vercel), and Bun for the existing lockfile
- A package manager: npm, pnpm, yarn, or bun

### Install & Run

```bash
# Install the existing locked dependency versions
bun install --frozen-lockfile
# Without a global Bun installation: npx --yes bun@1.3.4 install --frozen-lockfile

# Start the dev server
bun dev
# or: npm run dev / pnpm dev / yarn dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Build for Production

```bash
bun run build
bun start
# or: npm run build && npm start
```

## Deploy to Vercel

This is a standard Next.js app — Vercel auto-detects the framework.

1. Push this repo to GitHub.
2. Go to [vercel.com](https://vercel.com) → **New Project** → Import the GitHub repo.
3. Vercel auto-detects Next.js, runs `bun install` (or `npm install`) and `next build`.
4. (Optional) Add a custom domain in **Project Settings → Domains** and add the DNS records Vercel shows you at your registrar.

For Quizlet link imports, add `FIRECRAWL_API_KEY` as a **Secret**, for Production and Preview. A free Firecrawl account is sufficient to get started; no Vercel Pro upgrade is required. Never expose the key in a `NEXT_PUBLIC_` variable. Redeploy after adding or rotating it.

Without the key, paste and CSV import still work; link import reports that it is unavailable. For local evaluation only, `FIRECRAWL_ALLOW_KEYLESS=true` opts into Firecrawl’s limited shared test allowance. Production does not use that allowance.

See [the importer notes](docs/quizlet-import.md) for limits and verification.

## How to Play

1. Import a public Quizlet set link, or paste your terms and definitions (one per line) into the textarea, or upload a CSV. Pick your separator (comma, semicolon, or dash).
2. Edit any mis-parsed rows in the table below — you can also star individual terms to focus on them.
3. Click **Start studying** → choose your difficulty and answer side → **Start**.
4. Type the answer to destroy each asteroid before it reaches your planet.
5. If you miss one, you'll have to type the correct answer to keep playing. Miss the same term twice and the game is over.
6. Don't know an answer? Press **ESC** to skip it.
7. Asteroids fall faster as you level up. Good luck!

## License

MIT
