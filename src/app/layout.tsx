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
  authors: [{ name: "Marko Sarafijanovic (markosaraf)", url: "https://github.com/markosaraf" }],
  creator: "Marko Sarafijanovic",
  publisher: "Marko Sarafijanovic",


  // Required by Next.js for OG / Twitter image URLs to resolve to absolute URLs.
  metadataBase: new URL(siteUrl),

  // Canonical URL — tells Google "this is the one true URL for the homepage".
  alternates: {
    canonical: "/",
  },

  // Search-engine directives baked into the HTML head. (The repo also has
  // public/robots.txt — these two work together; this one is per-page.)
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        {children}
        <Toaster />
        <SpeedInsights />
      </body>
    </html>
  );
}
