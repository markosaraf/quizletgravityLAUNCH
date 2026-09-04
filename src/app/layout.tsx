import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { SpeedInsights } from "@vercel/speed-insights/next";

/* ----------------------------------------------------------------------------
   Site URL — set NEXT_PUBLIC_SITE_URL in your Vercel project settings (or .env)
   to your deployed domain, e.g. https://quizletgravity.vercel.app.
   Falls back to the placeholder below if unset so the build doesn't crash.
---------------------------------------------------------------------------- */
const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://quizletgravity.vercel.app";

export const metadata: Metadata = {
  // Browser-tab title + Google search result headline (the blue clickable line)
  title: "Quizlet – Gravity Study Mode",

  // Meta description — Google search result grey snippet (~155 chars is the
  // sweet spot; this one is ~210 chars and Google may truncate it).
  description:
    "Faithful recreation of Quizlet's Gravity study mode (2020–2024): defend your planet from falling asteroids by typing the correct answers. Paste a term list or upload a CSV to play.",

  // Meta keywords — Google ignores these for ranking, but Bing / Yandex /
  // some site-search engines still read them. Compound phrases people
  // actually type are more useful than single words.
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

  // Application / authorship metadata
  applicationName: "Quizlet Gravity",
  authors: [{ name: "markosaraf", url: "https://github.com/markosaraf" }],
  creator: "markosaraf",
  publisher: "markosaraf",

  // Required by Next.js for OG / Twitter image URLs to resolve to absolute URLs.
  metadataBase: new URL(siteUrl),

  // Canonical URL — tells Google "this is the one true URL for the homepage".
  alternates: {
    canonical: "/",
  },

  // Search-engine directives baked into the HTML head.
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

  // OpenGraph — Facebook / LinkedIn / Slack / Discord link previews.
  // First image is the wide 1200x630 card; second is the square 1200x1200,
  // which some platforms (notably Google rich results, and Twitter's
  // smaller "summary" card) prefer over the wide one.
  openGraph: {
    title: "Quizlet – Gravity Study Mode",
    description:
      "Faithful recreation of Quizlet's Gravity study mode (2020–2024): defend your planet from falling asteroids by typing the correct answers. Paste a term list or upload a CSV to play.",
    type: "website",
    url: siteUrl,
    siteName: "Quizlet Gravity",
    locale: "en_US",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Quizlet Gravity study mode — defend your planet from falling asteroids",
      },
      {
        url: "/og-image-square.png",
        width: 1200,
        height: 1200,
        alt: "Quizlet Gravity study mode — square thumbnail",
      },
    ],
  },

  // Twitter / X card preview.
  twitter: {
    card: "summary_large_image",
    title: "Quizlet – Gravity Study Mode",
    description:
      "Defend your planet from falling asteroids by typing the correct answers. Paste a term list or upload a CSV to play.",
    images: ["/og-image.png"],
  },

  icons: {
    // Safari does not support SVG favicons (WebKit bug 179014) and caches
    // whatever it finds (or doesn't find) essentially forever. So:
    //  - serve favicon.ico + PNGs FIRST so Safari always has a usable icon
    //  - keep the SVG last as an enhancement for Chrome/Edge/Firefox
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

/* ----------------------------------------------------------------------------
   JSON-LD structured data — this is what Google reads to display rich
   results. We declare two schemas:

   1. WebSite — basic site identity. Enables Google's sitelinks search box
      and confirms the canonical homepage URL.
   2. VideoGame — marks this as a game. This is the schema Google uses to
      show a square thumbnail image next to certain search results
      (the "rich result" card with an image, rating, etc.). The
      `thumbnailUrl` field points at the square image, which is what
      Google uses for the preview thumbnail.

   Both schemas reference the same square image (1200x1200) — that's the
   size Google prefers for rich-result thumbnails.
---------------------------------------------------------------------------- */
const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": `${siteUrl}/#website`,
      url: siteUrl,
      name: "Quizlet Gravity",
      description:
        "Faithful recreation of Quizlet's Gravity study mode (2020–2024). Defend your planet from falling asteroids by typing the correct answers.",
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
      description:
        "Faithful recreation of Quizlet's Gravity study mode (2020–2024): defend your planet from falling asteroids by typing the correct answers. Paste a term list or upload a CSV to play.",
      url: siteUrl,
      applicationCategory: "Game",
      genre: ["Educational", "Typing", "Arcade"],
      gamePlatform: ["Web Browser", "Personal Computer", "Mobile Phone"],
      operatingSystem: "Any (web browser)",
      image: `${siteUrl}/og-image-square.png`,
      thumbnailUrl: `${siteUrl}/og-image-square.png`,
      screenshot: `${siteUrl}/og-image.png`,
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        {/* JSON-LD structured data for Google rich results. Rendered as a
            raw <script> tag — Next.js does not process this; it goes
            straight into the HTML <head> when in app router. */}
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
