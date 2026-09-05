import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { SpeedInsights } from "@vercel/speed-insights/next";

/* ----------------------------------------------------------------------------
   YOUR SITE URL — what this is and why it matters

   This is the full public address of your deployed site — e.g.
   https://quizlet-gravity.vercel.app or https://quizletgravity.com.

   WHY IT MATTERS:
   When you share your site on Twitter / Facebook / LinkedIn / Slack, those
   platforms send a crawler to your page to fetch a preview image. They
   look at the `og:image` HTML tag, which says "/og-image.png" — a RELATIVE
   url. The crawler doesn't know what domain to fetch that from. Next.js
   uses this `siteUrl` value to convert "/og-image.png" into the full
   "https://[your-domain]/og-image.png" the crawler can actually fetch.

   If you skip this, Next.js falls back to the placeholder below — a URL
   that doesn't actually exist. That's exactly why opengraph.xyz says
   "Failed to fetch image: Not Found": it's trying to fetch the image
   from a made-up URL.

   Pick ONE of these two options:

   OPTION A (Vercel env var — recommended):
     1. Vercel → your project → Settings → Environment Variables
     2. Add a variable:
          Key         = NEXT_PUBLIC_SITE_URL
          Value       = your real deployed URL
                        (e.g. https://quizlet-gravity.vercel.app)
          Environment = tick Production, Preview, Development
     3. Redeploy (Deployments → ⋯ next to latest → Redeploy)
     The line below will pick up the env var automatically — leave it as-is.

   OPTION B (hard-code — simpler, no Vercel clicking):
     Replace the URL in the parentheses on the line below with your real
     deployed URL. Keep the quotes, no trailing slash, no path after the
     domain. Example: "https://quizlet-gravity-markosaraf.vercel.app"
---------------------------------------------------------------------------- */
const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.quizletgravity.com";

/* ----------------------------------------------------------------------------
   SEO strings — broken out so we can tune length per platform:

   TITLE_LONG  → ~51 chars. Used for the browser tab + Google SERP headline.
                 Google shows ~50-60 chars before truncating with "…".
   TITLE_SHORT → ~22 chars. Used for og:title + twitter:title. Social
                 platforms show less than Google, so a shorter title looks
                 cleaner in Twitter/Facebook/Slack cards.
   DESC_LONG   → ~147 chars. Used for the Google search result snippet AND
                 JSON-LD structured data. Within Google's display range.
   DESC_SHORT  → ~113 chars. Used for og:description + twitter:description.
                 Mobile social previews truncate around ~125 chars.
---------------------------------------------------------------------------- */
const TITLE_LONG = "Quizlet – Gravity Mode | Type to Defend Your Planet";
const TITLE_SHORT = "Quizlet – Gravity Mode";
const DESC_LONG =
  "Quizlet's Gravity mode recreated. Defend your planet from falling asteroids by typing the correct answers. Paste a term list or upload a CSV to play.";
const DESC_SHORT =
  "Defend your planet from falling asteroids by typing the correct answers. Paste a term list or upload a CSV to play.";

export const metadata: Metadata = {
  // Browser-tab title + Google search result headline
  title: TITLE_LONG,

  // Google search result grey snippet — ~147 chars, within Google's range
  description: DESC_LONG,

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
  authors: [{ name: "Marko Sarafijanovic (markosaraf)", url: "https://github.com/markosaraf" }],
  creator: "Marko Sarafijanovic",
  publisher: "Marko Sarafijanovic",

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
    title: TITLE_SHORT,
    description: DESC_SHORT, // ~113 chars — fits mobile previews
    type: "website",
    url: siteUrl,
    siteName: "Quizlet Gravity",
    locale: "en_US",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Quizlet Gravity mode — defend your planet from falling asteroids",
      },
      {
        url: "/og-image-square.png",
        width: 1200,
        height: 1200,
        alt: "Quizlet Gravity mode — square thumbnail",
      },
    ],
  },

  // Twitter / X card preview.
  twitter: {
    card: "summary_large_image",
    title: TITLE_SHORT,
    description: DESC_SHORT,
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
