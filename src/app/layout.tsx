import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Jev Play Games",
  description: "Watch TypeSafe's Jev model play games live, with the odds of every move on screen.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">
        <nav className="border-b border-white/10 bg-black/30 backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 md:px-8">
            <Link href="/" className="text-lg font-black tracking-tight">
              JEV<span className="text-fuchsia-400">·</span>PLAY<span className="text-cyan-300">·</span>GAMES
            </Link>
            <span className="ml-auto text-xs text-zinc-500">powered by typesafe-ai/jev on Vercel AI Gateway</span>
          </div>
        </nav>
        {children}
        <footer className="mx-auto w-full max-w-7xl px-4 py-8 text-xs text-zinc-600 md:px-8">
          Fan-made demo, not affiliated with TypeSafe AI. Games are open clones with original or freely licensed art.{" "}
          <a className="underline hover:text-zinc-400" href="https://github.com/Ege-BULUT/jev-play-games">Source on GitHub</a>
        </footer>
      </body>
    </html>
  );
}
