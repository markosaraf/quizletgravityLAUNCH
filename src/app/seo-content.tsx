/* ----------------------------------------------------------------------------
   SEO CONTENT — visible FAQ + "How to play" sections, server-rendered.

   WHY THIS FILE EXISTS:
   Google (and every LLM / answer engine) requires that FAQPage and HowTo
   structured data describe content that is VISIBLE on the page. The game
   UI itself is client-rendered, so its text is invisible to most crawlers
   on first fetch. These two sections are plain server-rendered HTML that
   every bot can read, and they double as the single source of truth for
   the JSON-LD built in page.tsx — the markup and the visible text can
   never drift apart.

   The components use only native HTML (<details>/<summary>, <ol>) —
   zero client-side JavaScript, no hydration cost.
---------------------------------------------------------------------------- */

import "./seo-content.css";

/* ----------------------------- shared data -------------------------------- */

/** Feature list — also fed into the VideoGame JSON-LD in layout.tsx. */
export const GAME_FEATURES: string[] = [
  "7 terms per level, asteroid fall speed scales with level",
  "5 difficulty levels: Sloth, Easy, Medium, Hard, Mad Max",
  "Editable terms table — fix mis-parses, star terms to focus on them",
  "Copy-the-answer modal on a miss — miss a term twice and the game ends",
  "Session leaderboard ranking every try",
  "Dark and light mode, persisted across reloads",
  "Import terms by pasting, or by uploading a CSV file",
  "Comma, semicolon, or dash separator options",
  "Fully client-side — no account, no data upload",
];

/** How-to-play steps — also fed into the HowTo JSON-LD in page.tsx. */
export const HOW_TO_STEPS: string[] = [
  "Paste your terms and definitions (one per line) into the text area, or upload a CSV file. Pick your separator: comma, semicolon, or dash.",
  "Edit any mis-parsed rows in the terms table. Star individual terms to study them in Starred-only mode.",
  "Click Start studying, choose your difficulty and which side to answer with, then click Start.",
  "Type the answer to destroy each asteroid before it reaches your planet.",
  "If you miss one, type the correct answer to keep playing. Miss the same term twice and the game is over.",
  "Don't know an answer? Press ESC to skip it.",
  "Asteroids fall faster as you level up. Good luck!",
];

export interface FaqItem {
  question: string;
  answer: string;
}

/** FAQ — also fed into the FAQPage JSON-LD in page.tsx. */
export const FAQ_ITEMS: FaqItem[] = [
  {
    question: "What is Quizlet Gravity?",
    answer:
      "Quizlet Gravity is a free browser-based study game that faithfully recreates Quizlet's Gravity study mode (the 2020–2024 era version). You defend your planet from falling asteroids by typing the correct answers to your own terms before they land. It runs entirely in your browser — no account required.",
  },
  {
    question: "Do I need a Quizlet account to play?",
    answer:
      "No. The game is fully client-side and works without any account or sign-up. Your imported term set, separator choice, theme, and answer preferences are saved locally in your browser via localStorage, so nothing is uploaded to a server.",
  },
  {
    question: "How do I add my own study set?",
    answer:
      "Paste your terms and definitions into the text area — one pair per line, separated by a comma, semicolon, dash, or tab — or upload a CSV file. The first column is the term and the second is the definition. You need at least 2 term/definition pairs to start, and you can fix any mis-parsed rows in the editable terms table before playing.",
  },
  {
    question: "How does scoring work?",
    answer:
      "Correct answers earn points that scale with your streak of consecutive correct answers and with the current gravity level: 20 × streak + 150 × (1 + level bonus). Wrong answers subtract 10 points. The session leaderboard ranks every try from the same study set.",
  },
  {
    question: "What are the difficulty levels?",
    answer:
      "There are 5 difficulties: Sloth, Easy, Medium, Hard, and Mad Max. Sloth, Easy, and Medium start at Earth gravity (9.8) with a 17-second asteroid interval. Hard starts at gravity 11 with a 3.5-second interval, and Mad Max starts at gravity 12.2 with asteroids spawning every 0.7 seconds. Gravity increases by 0.2 per level on Medium and above.",
  },
  {
    question: "What happens when I miss an asteroid?",
    answer:
      "When an asteroid lands, a copy-the-answer modal appears and you must type the correct answer to keep playing. If you miss the same term twice, the game is over. If you don't know an answer, press ESC to skip it.",
  },
  {
    question: "Does it work on mobile?",
    answer:
      "Yes. The layout is fully responsive: the sidebar collapses and the game controls move into the top bar on narrow screens. It also has a dark and light mode toggle that persists across reloads.",
  },
  {
    question: "Is my data private?",
    answer:
      "Yes. There is no backend and no database. Everything you paste or upload stays in your browser's localStorage — term sets are never sent anywhere. Clearing your browser data removes them.",
  },
];

/* --------------------------- visible sections ----------------------------- */

export function HowToSection() {
  return (
    <section className="GravitySEO" aria-labelledby="how-to-play-heading">
      <div className="GravitySEO-inner">
        <h2 id="how-to-play-heading" className="GravitySEO-title">
          How to play
        </h2>
        <p className="GravitySEO-subtitle">
          Defend your planet from incoming asteroids by typing the correct
          answers before they land. It takes about a minute to set up a game
          with your own terms.
        </p>
        <ol className="GravitySEO-steps">
          {HOW_TO_STEPS.map((step, i) => (
            <li key={i} className="GravitySEO-step">
              <span className="GravitySEO-stepNumber">{i + 1}</span>
              <span className="GravitySEO-stepText">{step}</span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

export function FaqSection() {
  return (
    <section className="GravitySEO" aria-labelledby="faq-heading">
      <div className="GravitySEO-inner">
        <h2 id="faq-heading" className="GravitySEO-title">
          Frequently asked questions
        </h2>
        <p className="GravitySEO-subtitle">
          Everything about how the game works, importing terms, scoring, and
          privacy.
        </p>
        <div className="GravitySEO-faqList">
          {FAQ_ITEMS.map(({ question, answer }) => (
            <details key={question} className="GravitySEO-faqItem">
              <summary className="GravitySEO-faqQuestion">{question}</summary>
              <p className="GravitySEO-faqAnswer">{answer}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
