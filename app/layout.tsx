import type { Metadata } from "next";
import { Geist, Inter_Tight, JetBrains_Mono } from "next/font/google";
import { WalletProvider } from "@/lib/wallet/WalletContext";
import { SiteHeader } from "@/components/SiteHeader";
import "./globals.css";

const geist = Geist({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--ff-display",
  display: "swap",
});

const interTight = Inter_Tight({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--ff-ui",
  display: "swap",
});

const jetBrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--ff-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Patchrail — a release-acceptance rail for software delivery",
  description:
    "Patchrail freezes a versioned acceptance rail before work starts, has GenLayer validators independently inspect each release candidate against semantic gate criteria, and releases fixed milestone GEN percentages only after accepted gates — on GenLayer Studionet.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${interTight.variable} ${jetBrainsMono.variable}`}>
      <body className="bg-midnight font-ui text-phosphor antialiased">
        <WalletProvider>
          <SiteHeader />
          <main id="main">{children}</main>
        </WalletProvider>
      </body>
    </html>
  );
}
