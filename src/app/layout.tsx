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
    // Next.js auto-serves src/app/icon.svg and src/app/apple-icon.png, but we
    // also set them explicitly here so the <link> tags are deterministic.
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    apple: [
      { url: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
    shortcut: ["/icon.svg"],
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
