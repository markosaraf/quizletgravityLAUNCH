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
  "Search shared study sets by title or original Quizlet set creator",
  "Import public Quizlet links, including text copied from the Quizlet app",
  "Create sets from pasted terms or CSV files",
  "Share a set link and compete on its persistent leaderboard",
  "Repeated imports of the same Quizlet set reuse one shared set and leaderboard",
  "Play as a named guest or sign in with an account",
  "Email verification, password recovery and Google sign-in",
  "One personal best per player on each shared-set leaderboard",
  "5 difficulty levels: Sloth, Easy, Medium, Hard, Mad Max",
  "Editable terms and Starred-only study mode for custom games",
  "Copy the correct answer after a miss; miss the same term twice and the game ends",
  "Light and dark themes in the website and Android and iOS preview apps",
];

/** Visible instructions and HowTo structured data share these strings. */
export const HOW_TO_STEPS: string[] = [
  "Start in Sets. Search by set title or original Quizlet set creator, or paste a public Quizlet set link into Import a Quizlet set. Text copied with the link from the Quizlet app also works.",
  "To use your own material, open Create set. Paste terms and definitions or upload a CSV, then check the editable terms table. You need at least two term/definition pairs.",
  "Choose a guest username or sign in to import and share sets or join a shared-set leaderboard. You can create an account with email and password or continue with Google. Email/password accounts require email confirmation.",
  "For your own shared set, enter a title under Share this set and choose Create shared link. Open the set and leaderboard, then use Copy set link to invite others. An imported Quizlet set already has its shared page.",
  "Choose Play this set on a shared page to play for its leaderboard. For a local custom game, choose Start studying. Select your difficulty and answer side, then start.",
  "Type the correct answers before the asteroids hit your planet. After a missed term, type the displayed answer to continue. Missing the same term twice ends the game.",
  "At game over, a completed shared-set game is submitted to its leaderboard. Your highest score is kept. Sign in with the same account on another device to keep playing under the same identity.",
];

export interface FaqItem {
  question: string;
  answer: string;
}

/** FAQ answers also supply the FAQPage structured data. */
export const FAQ_ITEMS: FaqItem[] = [
  {
    question: "What is Quizzlet Gravity?",
    answer:
      "Quizzlet Gravity is a free study game inspired by Quizlet’s retired Gravity mode. Type answers to your flashcards to defend your planet from falling asteroids. This version adds searchable shared sets, accounts and persistent set leaderboards. It is an independent project and is not affiliated with Quizlet.",
  },
  {
    question: "How do I find a study set?",
    answer:
      "The website and apps open in Sets. Search by set title or original Quizlet set creator, then open a card to see its terms and leaderboard. You can also open a set link someone has shared with you.",
  },
  {
    question: "How do I import a Quizlet set?",
    answer:
      "Paste a public Quizlet set link into Import a Quizlet set and choose Import set. You can paste the full sharing text copied from the Quizlet app, including the words around the link. Choose a guest username or sign in when prompted. The imported set shows its title and original Quizlet set creator.",
  },
  {
    question: "What if someone has already imported the same Quizlet set?",
    answer:
      "Importing the same Quizlet set again opens its existing shared page. It uses the same link and leaderboard, so scores are not split across duplicate imports. The shared set is a saved copy, not a live connection that automatically follows edits on Quizlet.",
  },
  {
    question: "How do I create my own set?",
    answer:
      "Open Create set and paste terms and definitions, one pair per line, or upload a CSV. Commas, semicolons, dashes and tabs are supported as separators. Check and edit the terms before playing. You need at least two pairs, and you can star terms for Starred-only practice.",
  },
  {
    question: "How do I share a set with friends?",
    answer:
      "For a custom set, enter a title under Share this set, choose a guest username or sign in, then select Create shared link. Open the set and leaderboard and choose Copy set link. Imported Quizlet sets already have a shared page. Anyone with the link can open the set and join its leaderboard after choosing a guest username or signing in.",
  },
  {
    question: "Do I need an account?",
    answer:
      "You do not need a Quizlet account. You can browse shared sets and practise with your own pasted terms without signing up. To import, share or record scores on a shared set, choose a guest username or sign in to Quizzlet Gravity. A registered account lets you use the same identity across devices.",
  },
  {
    question: "What is the difference between a guest and an account?",
    answer:
      "Guests can import sets, share links and appear on leaderboards without an email or password. Their identity is tied to the current browser or app session and can be lost when its data is cleared. An account lets you sign in again and access your leaderboard identity across devices. Creating an account from your active guest session transfers its scores to the account.",
  },
  {
    question: "How do email confirmation and password recovery work?",
    answer:
      "When you create an account with email and password, open the confirmation email before signing in. Check your spam folder or use Resend confirmation if needed. If you forget your password, choose Forgot password? to request a recovery link at your account’s email address. Continue with Google is another way to sign in.",
  },
  {
    question: "Which games count towards a leaderboard?",
    answer:
      "Open a shared set and choose Play this set while using a guest username or account. At game over, the completed game is submitted and your highest score for that set is kept, with its level and difficulty. Each player has one personal best per shared set across all difficulties. Local custom games and games abandoned before game over do not add a completed score to that shared leaderboard.",
  },
  {
    question: "How does scoring work?",
    answer:
      "Correct answers earn points based on your consecutive-answer streak and the game’s gravity bonus. Wrong answers subtract 10 points, without taking your score below zero. A shared-set leaderboard keeps your personal best rather than adding all your attempts together.",
  },
  {
    question: "What are the difficulty levels, and what happens when I miss?",
    answer:
      "Choose Sloth, Easy, Medium, Hard or Mad Max. Difficulty changes the pace and behaviour of the asteroids. When an asteroid lands, type the displayed correct answer to continue. Missing the same term twice ends the game.",
  },
  {
    question: "Can I play on my phone or tablet?",
    answer:
      "Yes. You can play in a mobile browser or in the Android and iOS preview apps. Shared set links and leaderboards use the same service. Sign in with the same account to use your leaderboard identity across devices. Both light and dark themes are available.",
  },
  {
    question: "Which information is public, and where is it stored?",
    answer:
      "Imported and shared sets, their titles and terms, creator attribution, leaderboard usernames and scores are public and stored online. Account emails are private, and passwords are stored as hashes rather than readable text. Pasted or CSV terms stay on your device until you choose to share them. Guest access depends on your browser or app session. Only share material you have permission to share.",
  },
];

/* --------------------------- visible sections ----------------------------- */

export function HowToSection() {
  return (
    <section id="howto" className="GravitySEO" aria-labelledby="how-to-play-heading">
      <div className="GravitySEO-inner">
        <h2 id="how-to-play-heading" className="GravitySEO-title">
          How to play
        </h2>
        <p className="GravitySEO-subtitle">
          Defend your planet from incoming asteroids by typing the correct
          answers before they land. Find a shared set, import from Quizlet,
          or create your own and invite friends to its leaderboard.
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
    <section id="faq" className="GravitySEO" aria-labelledby="faq-heading">
      <div className="GravitySEO-inner">
        <h2 id="faq-heading" className="GravitySEO-title">
          Frequently asked questions
        </h2>
        <p className="GravitySEO-subtitle">
          Find out about sets, importing, sharing, accounts, leaderboards and
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

/** Always present on the Sets landing pages, including before hydration. */
export function SetsLandingHelp({path = "/"}: {path?: string}) {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://quizzlet-gravity-preview.vercel.app";
  const url = new URL(path, siteUrl).href;
  const structuredData = [
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      "@id": `${url}#faq`,
      url,
      name: "Quizzlet Gravity — Frequently asked questions",
      mainEntity: FAQ_ITEMS.map(({question, answer}) => ({
        "@type": "Question",
        name: question,
        acceptedAnswer: {"@type": "Answer", text: answer},
      })),
    },
    {
      "@context": "https://schema.org",
      "@type": "HowTo",
      "@id": `${url}#howto`,
      name: "How to play Quizzlet Gravity",
      step: HOW_TO_STEPS.map((text, i) => ({
        "@type": "HowToStep", position: i + 1, text,
      })),
    },
  ];
  return <><HowToSection/><FaqSection/><script type="application/ld+json"
    dangerouslySetInnerHTML={{__html: JSON.stringify(structuredData).replace(/</g, "\\u003c")}}/></>;
}
