import type { Metadata, Viewport } from "next";
import { Fragment_Mono, Hanken_Grotesk, Tektur } from "next/font/google";
import "./globals.css";
import ClientBody from "./ClientBody";
import Script from "next/script";
import { X_HANDLE } from "@/lib/social";

const tektur = Tektur({
  variable: "--font-tektur",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
});
const fragmentMono = Fragment_Mono({
  variable: "--font-fragment",
  subsets: ["latin"],
  weight: ["400"],
});
const hanken = Hanken_Grotesk({
  variable: "--font-hanken",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "LEGION | Every coin is a legion. Every buy is a reinforcement.",
  description:
    "Solana drone warfare. Every coin is a legion battling for territory on a live world map. Buys launch drones into the fight, sells blow them up.",
  ...(X_HANDLE ? { twitter: { card: "summary", site: `@${X_HANDLE}`, creator: `@${X_HANDLE}` } } : {}),
};

export const viewport: Viewport = {
  themeColor: "#07090A",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`dark ${tektur.variable} ${fragmentMono.variable} ${hanken.variable}`}>
      <head>
        {/* editor-only dev tools (the floating cursor pill); never shipped to the live site */}
        {process.env.NODE_ENV === "development" && (
          <>
            <Script crossOrigin="anonymous" src="//unpkg.com/react-grab/dist/index.global.js" />
            <Script crossOrigin="anonymous" src="//unpkg.com/same-runtime/dist/index.global.js" />
          </>
        )}
      </head>
      <body suppressHydrationWarning className="antialiased">
        <ClientBody>{children}</ClientBody>
      </body>
    </html>
  );
}
