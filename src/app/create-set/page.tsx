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
import { LandingSections } from '@/components/gravity/LandingSections';
import '@/gravity/gravity.css';
import {
  FAQ_ITEMS,
  HOW_TO_STEPS,
} from '../seo-content';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://quizzlet-gravity-preview.vercel.app';

export default function Home() {
  // ---- FAQPage structured data (mirrors the visible FAQ section) ----
  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    '@id': `${siteUrl}/create-set#faq`,
    url: `${siteUrl}/create-set`,
    name: 'Quizzlet Gravity — Frequently asked questions',
    mainEntity: FAQ_ITEMS.map(({ question, answer }) => ({
      '@type': 'Question',
      '@id': `${siteUrl}/create-set#faq-${question.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
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
    '@id': `${siteUrl}/create-set#howto`,
    name: 'How to play Quizzlet Gravity',
    description:
      "Find or import a shared set, or create your own with pasted terms or a CSV. Play as a guest or sign in, share a set link and compete on its leaderboard.",
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
      {/* "How to play" + FAQ — first page only. Still server-rendered
          into the initial HTML for crawlers, but LandingSections removes
          them from the DOM as soon as a game session starts. */}
      <LandingSections />

      {/* Structured data — injected into the initial HTML so every crawler
          (Googlebot, GPTBot, PerplexityBot, ClaudeBot) sees it without
          needing JavaScript. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd).replace(/</g, "\\u003c") }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(howToJsonLd).replace(/</g, "\\u003c") }}
      />
    </>
  );
}
