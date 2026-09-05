import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { SpeedInsights } from "@vercel/speed-insights/next";

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
   OG IMAGE — different image for LinkedIn vs. everywhere else.

   WHY THIS IS NEEDED:
   The OpenGraph standard has only one `og:image` tag. Every platform
   (Facebook, Twitter, LinkedIn, Slack, Discord, Teams) reads the same
   value. To show a different image ONLY on LinkedIn, we detect LinkedIn's
   crawler by its User-Agent string (starts with "LinkedInBot") at request
   time and swap the image URL.

   WHY THIS WORKS:
   When you paste your URL into LinkedIn, LinkedIn's bot fetches the page
   HTML to read the OG tags. That bot's User-Agent is "LinkedInBot/1.0
   (compatible; ...)". We sniff for it and serve a different `og:image`
   URL in the HTML LinkedIn sees. Every other platform gets the default.

   CAVEAT:
   LinkedIn caches the OG preview for ~7 days. After deploying, use the
   LinkedIn Post Inspector (https://www.linkedin.com/post-inspector/)
   to force LinkedIn to re-fetch your page and pick up the new image.
---------------------------------------------------------------------------- */
const OG_IMAGE_DEFAULT = "/og-image.png";
const OG_IMAGE_LINKEDIN = "/og-image-linkedin.png";

function isLinkedInCrawler(userAgent: string): boolean {
  // LinkedIn's official crawler announces itself with "LinkedInBot".
  // Reference: https://www.linkedin.com/developer/tools/post-inspector
  return /LinkedInBot/i.test(userAgent);
}

/* ----------------------------------------------------------------------------
   generateMetadata() — replaces the static `export const metadata` so we
   can read the request's User-Agent header at request time. This is the
   only way to differentiate OG images per platform.

   This makes the page's metadata dynamic per-request, which means the
   homepage can no longer be statically prerendered. For this app that's
   fine — the page is already a client-side game ('use client' in page.tsx),
   so there's no real performance cost.
---------------------------------------------------------------------------- */
export async function generateMetadata(): Promise<Metadata> {
  const headersList = await headers();
  const userAgent = headersList.get("user-agent") ?? "";
  const isLinkedIn = isLinkedInCrawler(userAgent);

  // LinkedIn sees the LinkedIn-specific image; everyone else sees the default.
  const ogImage = isLinkedIn ? OG_IMAGE_LINKEDIN : OG_IMAGE_DEFAULT;

  // The square image is only useful for Google rich results (which are read
  // by Googlebot, not LinkedInBot) — so we skip it for LinkedIn to keep
  // the OG image list focused.
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
    // Browser-tab title + Google SERP headline
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
    // Twitter uses twitter:image, which overrides og:image. We always want
    // Twitter to see the default wide card, regardless of which platform
    // is reading the page (Twitter's crawler is Twitterbot, not LinkedInBot,
    // so it will already see the default — but being explicit doesn't hurt).
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
        description: DESC_LONG,
        publisher: { "@id": `${siteUrl}/#organization` },
        potentialAction: {
          "@type": "SearchAction",
          target: `${siteUrl}/?q={search_term_string}`,
          "query-input": "required name=search_term_string",
        },
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
        image: `${siteUrl}${squareOrLinkedIn}`,
        thumbnailUrl: `${siteUrl}${squareOrLinkedIn}`,
        screenshot: `${siteUrl}${OG_IMAGE_DEFAULT}`,
        publisher: { "@id": `${siteUrl}/#organization` },
        author: {
          "@type": "Person",
          name: "markosaraf",
          url: "https://github.com/markosaraf",
        },
        offers: {
          "@type": "Offer",
          price: "0",
          priceCurrency: "USD",
          availability: "https://schema.org/InStock",
        },
      },
    ],
  };

  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        {/* JSON-LD structured data for Google rich results. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        {children}
        <Toaster />
        <SpeedInsights />
      </body>
    </html>
  );
}
