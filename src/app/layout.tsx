// Root layout — font variables, tooltip provider, global stylesheet.

import type { Metadata } from "next";
import { Inter, Work_Sans } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const workSans = Work_Sans({
  variable: "--font-work-sans",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Alpha Term — Institutional Intelligence",
  description: "Synthesized stock analysis with dual-sleeve wheel-entry verdicts.",
};

/** Wraps every page in the html/body shell. */
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${workSans.variable}`}>
      <body>
        <TooltipProvider delayDuration={150}>{children}</TooltipProvider>
      </body>
    </html>
  );
}
