import type { Metadata, Viewport } from "next";
import { Geist_Mono } from "next/font/google";
import "./globals.css";
import Web3Provider from "@/components/Web3Provider";
import Header from "@/components/Header";
import TxToasts from "@/components/launchpad/TxToasts";
import LiveProvider from "@/components/launchpad/LiveProvider";
import { getLaunchFeed, getLaunchTotals } from "@/lib/launchpad/queries";
import { ethUsd } from "@/lib/launchpad/ethPrice";
import { SITE_URL, explorerAddress } from "@/lib/chainPublic";
import { launchpad } from "@/lib/launchpad/config";
import { BRAND, BRAND_DOMAIN, BRAND_GITHUB, BRAND_TLD, BRAND_X, SITE_DESCRIPTION, SITE_TITLE, SOCIAL_DESCRIPTION } from "@/lib/brand";
import Mark from "@/components/launchpad/Mark";
import RouteProgress from "@/components/RouteProgress";
import { Suspense } from "react";

const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

const TITLE = SITE_TITLE;
const DESCRIPTION = SITE_DESCRIPTION;

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: TITLE, template: `%s · ${BRAND_DOMAIN}` },
  description: DESCRIPTION,
  applicationName: BRAND,
  alternates: { canonical: "/" },
  openGraph: { siteName: BRAND_DOMAIN, title: TITLE, description: SOCIAL_DESCRIPTION, type: "website", url: SITE_URL },
  twitter: { card: "summary_large_image", site: `@${BRAND_X}`, title: TITLE, description: SOCIAL_DESCRIPTION },
};

export const viewport: Viewport = {
  themeColor: [{ media: "(prefers-color-scheme: light)", color: "#ffffff" }, { media: "(prefers-color-scheme: dark)", color: "#000000" }],
  colorScheme: "light dark", width: "device-width", initialScale: 1, viewportFit: "cover",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const usd = await ethUsd();
  const [feed, totals] = await Promise.all([getLaunchFeed(24, usd).catch(() => []), getLaunchTotals(usd)]);
  const b = launchpad("base");
  const r = launchpad("robinhood");
  return (
    <html lang="en" className={geistMono.variable}>
      <body className="min-h-screen flex flex-col">
        <a href="#main-content" className="bb-skip-link">Skip to content</a>
        <Web3Provider>
          <LiveProvider initial={{ at: 0, feed, totals, ethUsd: usd }}>
          <Suspense fallback={null}>
            <RouteProgress />
          </Suspense>
          <Header />
          <TxToasts />
          <div id="main-content" tabIndex={-1} className="flex-1 min-w-0">{children}</div>
          <footer className="bb-footer mx-auto w-full max-w-6xl px-4 py-8 text-xs text-muted flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-line">
            <span className="font-semibold text-ink inline-flex items-center gap-1.5">
              <Mark size={16} />
              {BRAND}<span className="text-brand">{BRAND_TLD}</span>
            </span>
            <span>free · open source · Base + Robinhood Chain · agents welcome</span>
            <a href="/launch" className="hover:text-ink">launch</a>
            <a href="/rules" className="hover:text-ink">how it works</a>
            <a href="/agents" className="hover:text-ink">agents</a>
            <a href="/llms.txt" className="hover:text-ink">llms.txt</a>
            <a href={BRAND_GITHUB} target="_blank" rel="noreferrer" className="hover:text-ink">
              source · GitHub ↗
            </a>
            {b.factory ? (
              <a href={explorerAddress("base", b.factory)} target="_blank" rel="noreferrer" className="hover:text-ink">
                factory · Base ↗
              </a>
            ) : null}
            {r.factory ? (
              <a href={explorerAddress("robinhood", r.factory)} target="_blank" rel="noreferrer" className="hover:text-ink">
                factory · Robinhood ↗
              </a>
            ) : null}
            <a href="/rules#contracts" className="hover:text-ink">
              verified contracts
            </a>
            <a href={`https://x.com/${BRAND_X}`} className="hover:text-ink" target="_blank" rel="noreferrer">
              @{BRAND_X}
            </a>
            <a href="https://gitlawb.com" className="hover:text-ink" target="_blank" rel="noreferrer">
              Built by Gitlawb
            </a>
          </footer>
          </LiveProvider>
        </Web3Provider>
      </body>
    </html>
  );
}
