import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { SpeedInsights } from "@vercel/speed-insights/next";

export const metadata: Metadata = {
  title: "Gravity — Quizlet study mode",
  description:
    "Faithful recreation of Quizlet's Gravity study mode (2020–2024): defend your planet from falling asteroids by typing the correct answers. Paste a term list or upload a CSV to play.",
  keywords: [
    "Quizlet",
    "Gravity",
    "study mode",
    "flashcards",
    "game",
    "asteroids",
  ],
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
