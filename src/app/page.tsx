/* ----------------------------------------------------------------------------
   Home page — now a SERVER component (the 'use client' directive is removed;
   GravityApp below carries its own 'use client', so nothing else changes).

   WHY: JSON-LD for FAQPage / HowTo must describe content that is actually
   present in the first server-rendered HTML response. With this page as a
   server component, the FAQ + How-to-play sections and their structured
   data are rendered into the initial HTML that Googlebot, GPTBot,
   PerplexityBot, ClaudeBot & co. receive — no client-side hydration
   required to see them.

   The FAQ_ITEMS / HOW_TO_STEPS arrays are the single source of truth:
   the same strings render on screen AND go into the JSON-LD, so the
   markup can never contradict the visible content (a Google policy
   requirement for FAQ rich results).
---------------------------------------------------------------------------- */

import { GravityApp } from '@/components/gravity/GravityApp';
import '@/gravity/gravity.css';
import {
  FAQ_ITEMS,
  HOW_TO_STEPS,
  FaqSection,
  HowToSection,
} from './seo-content';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://quizletgravity.com';

export default function Home() {
  // ---- FAQPage structured data (mirrors the visible FAQ section) ----
  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    '@id': `${siteUrl}/#faq`,
    url: `${siteUrl}/`,
    name: 'Quizlet Gravity — Frequently asked questions',
    mainEntity: FAQ_ITEMS.map(({ question, answer }) => ({
      '@type': 'Question',
      '@id': `${siteUrl}/#faq-${question.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      name: question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: answer,
      },
    })),
  };

  // ---- HowTo structured data (mirrors the visible How-to-play section) ----
  // Note: Google removed HowTo rich results from search in Sept 2023, but
  // the markup still helps LLMs and answer engines understand the gameplay
  // steps, which is the goal here.
  const howToJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'HowTo',
    '@id': `${siteUrl}/#howto`,
    name: 'How to play Quizlet Gravity',
    description:
      "Defend your planet from falling asteroids by typing the correct answers. Paste a term list or upload a CSV to play Quizlet's Gravity study mode.",
    step: HOW_TO_STEPS.map((text, i) => ({
      '@type': 'HowToStep',
      position: i + 1,
      name: text.split('.')[0],
      text,
    })),
  };

  return (
    <>
      <GravityApp />
      <HowToSection />
      <FaqSection />

      {/* Structured data — injected into the initial HTML so every crawler
          (Googlebot, GPTBot, PerplexityBot, ClaudeBot) sees it without
          needing JavaScript. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(howToJsonLd) }}
      />
    </>
  );
}
