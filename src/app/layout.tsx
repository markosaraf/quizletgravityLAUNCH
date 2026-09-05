import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Analytics } from "@vercel/analytics/next";
import { GAME_FEATURES } from "./seo-content";

/* ----------------------------------------------------------------------------
   YOUR SITE URL — see explanation in the previous version.
   Pick Option A (Vercel env var) or Option B (hard-code below).
---------------------------------------------------------------------------- */
const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://quizletgravity.com";

/* ----------------------------------------------------------------------------
   SEO strings (split per-platform for length tuning — see previous version
   for the rationale).
---------------------------------------------------------------------------- */
const TITLE_LONG = "Quizlet – Gravity Mode | Type to Defend Your Planet";
const TITLE_SHORT = "Quizlet – Gravity Mode";
const DESC_LONG =
  "Quizlet's Gravity mode recreated. Defend your planet from falling asteroids by typing the correct answers. Paste a term list or upload a CSV to play.";
const DESC_SHORT =
  "Defend your planet from falling asteroids by typing the correct answers. Paste a term list or upload a CSV to play.";

/* ----------------------------------------------------------------------------
   Entity dates — used in JSON-LD (datePublished / dateModified).
   datePublished = repo/site launch date; dateModified = last content
   change. Update DATE_MODIFIED whenever you change on-page content.
---------------------------------------------------------------------------- */
const DATE_PUBLISHED = "2026-09-04"; // first commit / site launch
const DATE_MODIFIED = "2026-09-06";  // this schema + SEO content update

/* ----------------------------------------------------------------------------
   OG IMAGE — different image for LinkedIn vs. everywhere else.
   [... unchanged logic from your current file ...]
---------------------------------------------------------------------------- */
const OG_IMAGE_DEFAULT = "/og-image.png";
const OG_IMAGE_LINKEDIN = "/og-image-linkedin.png";

function isLinkedInCrawler(userAgent: string): boolean {
  // LinkedIn's official crawler announces itself with "LinkedInBot".
  // Reference: https://www.linkedin.com/developer/tools/post-inspector
  return /LinkedInBot/i.test(userAgent);
}

/* ----------------------------------------------------------------------------
   generateMetadata() — [... unchanged from your current file ...]
---------------------------------------------------------------------------- */
export async function generateMetadata(): Promise<Metadata> {
  const headersList = await headers();
  const userAgent = headersList.get("user-agent") ?? "";
  const isLinkedIn = isLinkedInCrawler(userAgent);

  const ogImage = isLinkedIn ? OG_IMAGE_LINKEDIN : OG_IMAGE_DEFAULT;

  const ogImages: NonNullable<NonNullable<Metadata["openGraph"]>["images"]> = [
    {
      url: ogImage,
      width: 1200,
      height: isLinkedIn ? 627 : 630,
      alt: "Quizlet Gravity mode — defend your planet from falling asteroids",
    },
  ];
  if (!isLinkedIn) {
    ogImages.push({
      url: "/og-image-square.png",
      width: 1200,
      height: 1200,
      alt: "Quizlet Gravity mode — square thumbnail",
    });
  }

  return {
    title: TITLE_LONG,
    description: DESC_LONG,
    keywords: [
      "Quizlet",
      "Quizlet Gravity",
      "Gravity",
      "Gravity study mode",
      "Quizlet study mode",
      "study mode",
      "flashcards",
      "flashcard game",
      "study game",
      "vocabulary game",
      "typing game",
      "education game",
      "online study game",
      "asteroid game",
      "defend planet game",
      "Quizlet game",
    ],
    applicationName: "Quizlet Gravity",
    authors: [{ name: "Marko Sarafijanovic (markosaraf)", url: "https://github.com/markosaraf" }],
    creator: "Marko Sarafijanovic",
    publisher: "Marko Sarafijanovic",
    metadataBase: new URL(siteUrl),
    alternates: { canonical: "/" },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        "max-image-preview": "large",
        "max-snippet": -1,
        "max-video-preview": -1,
      },
    },
    openGraph: {
      title: TITLE_SHORT,
      description: DESC_SHORT,
      type: "website",
      url: siteUrl,
      siteName: "Quizlet Gravity",
      locale: "en_US",
      images: ogImages,
    },
    twitter: {
      card: "summary_large_image",
      title: TITLE_SHORT,
      description: DESC_SHORT,
      images: [OG_IMAGE_DEFAULT],
    },
    icons: {
      icon: [
        { url: "/favicon.ico", sizes: "16x16 32x32 48x48" },
        { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
        { url: "/icon-32.png", sizes: "32x32", type: "image/png" },
        { url: "/icon.svg", type: "image/svg+xml" },
      ],
      apple: [
        { url: "/apple-icon.png", sizes: "180x180", type: "image/png" },
      ],
    },
  };
}

/* ----------------------------------------------------------------------------
   JSON-LD structured data — same swap applies here. We re-detect the
   LinkedIn crawler inside the component (since generateMetadata and the
   component body run in separate contexts). The square image is used for
   Google rich results (Googlebot), so for LinkedIn we use the LinkedIn
   image instead.

   2026 schema upgrade — the @graph now contains:
     1. WebSite      — the site itself (publisher-linked, no fake SearchAction)
     2. Organization — the publisher, NOW with sameAs (GitHub repo + profile)
                       so LLMs can resolve "Quizlet Gravity" as a real entity
     3. Person       — the author (E-E-A-T signal for Google + AI engines)
     4. VideoGame    — the game entity, now with playMode, numberOfPlayers,
                       featureList, inLanguage, isAccessibleForFree,
                       datePublished/dateModified, keywords, sameAs
     5. WebPage      — the homepage as a distinct node (isPartOf #website),
                       with dates and primaryImageOfPage

   All nodes are interlinked via @id, which is how search engines and LLM
   knowledge graphs stitch the entities together. FAQPage and HowTo live
   in page.tsx next to the visible FAQ / How-to-play sections.
---------------------------------------------------------------------------- */
export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const headersList = await headers();
  const userAgent = headersList.get("user-agent") ?? "";
  const isLinkedIn = isLinkedInCrawler(userAgent);

  const squareOrLinkedIn = isLinkedIn ? OG_IMAGE_LINKEDIN : "/og-image-square.png";

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${siteUrl}/#website`,
        url: siteUrl,
        name: "Quizlet Gravity",
        alternateName: "Quizlet Gravity Mode",
        description: DESC_LONG,
        inLanguage: "en",
        isAccessibleForFree: true,
        publisher: { "@id": `${siteUrl}/#organization` },
        // NOTE: the previous SearchAction was removed — the site has no
        // actual search results page, and pointing potentialAction at a
        // non-existent search violates Google's structured data guidelines
        // (markup must reflect real functionality).
      },
      {
        "@type": "Organization",
        "@id": `${siteUrl}/#organization`,
        name: "Quizlet Gravity",
        url: siteUrl,
        logo: {
          "@type": "ImageObject",
          url: `${siteUrl}/logo.svg`,
          width: 256,
          height: 256,
        },
        // sameAs is THE key field for LLM entity resolution — it connects
        // this organization to its canonical profiles elsewhere on the web.
        sameAs: [
          "https://github.com/markosaraf",
          "https://github.com/markosaraf/quizletgravityLAUNCH",
        ],
        founder: { "@id": `${siteUrl}/#author` },
      },
      {
        "@type": "Person",
        "@id": `${siteUrl}/#author`,
        name: "Marko Sarafijanovic",
        alternateName: "markosaraf",
        url: "https://github.com/markosaraf",
        sameAs: ["https://github.com/markosaraf"],
      },
      {
        "@type": "VideoGame",
        "@id": `${siteUrl}/#game`,
        name: "Quizlet Gravity",
        description: DESC_LONG,
        url: siteUrl,
        applicationCategory: "Game",
        genre: ["Educational", "Typing", "Arcade"],
        gamePlatform: ["Web Browser", "Personal Computer", "Mobile Phone"],
        operatingSystem: "Any (web browser)",
        playMode: "SinglePlayer",
        numberOfPlayers: 1,
        inLanguage: "en",
        isAccessibleForFree: true,
        image: `${siteUrl}${squareOrLinkedIn}`,
        thumbnailUrl: `${siteUrl}${squareOrLinkedIn}`,
        screenshot: `${siteUrl}${OG_IMAGE_DEFAULT}`,
        datePublished: DATE_PUBLISHED,
        dateModified: DATE_MODIFIED,
        keywords:
          "Quizlet, Gravity, study mode, flashcards, study game, typing game, education game, vocabulary game",
        featureList: GAME_FEATURES,
        publisher: { "@id": `${siteUrl}/#organization` },
        author: { "@id": `${siteUrl}/#author` },
        offers: {
          "@type": "Offer",
          price: "0",
          priceCurrency: "USD",
          availability: "https://schema.org/InStock",
        },
        // Link the game entity to its open-source repo — strong signal for
        // LLMs citing/verifying the project.
        sameAs: ["https://github.com/markosaraf/quizletgravityLAUNCH"],
      },
      {
        "@type": "WebPage",
        "@id": `${siteUrl}/#webpage`,
        url: `${siteUrl}/`,
        name: TITLE_LONG,
        description: DESC_LONG,
        isPartOf: { "@id": `${siteUrl}/#website` },
        about: { "@id": `${siteUrl}/#game` },
        primaryImageOfPage: {
          "@type": "ImageObject",
          url: `${siteUrl}${OG_IMAGE_DEFAULT}`,
        },
        inLanguage: "en",
        isAccessibleForFree: true,
        datePublished: DATE_PUBLISHED,
        dateModified: DATE_MODIFIED,
      },
    ],
  };

  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        {/* JSON-LD structured data for Google rich results + LLM grounding. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        {children}
        <Toaster />
        <SpeedInsights />
        <Analytics />
      </body>
    </html>
  );
}
