import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";
import Web3Provider from "@/components/Web3Provider";
import Header from "@/components/Header";
import TxToasts from "@/components/launchpad/TxToasts";
import LiveProvider from "@/components/launchpad/LiveProvider";
import { getLaunchFeed, getLaunchTotals } from "@/lib/launchpad/queries";
import { ethUsd } from "@/lib/launchpad/ethPrice";
import { SITE_URL } from "@/lib/chainPublic";
import { BRAND, BRAND_DOMAIN, BRAND_X, SITE_DESCRIPTION, SITE_TITLE, SOCIAL_DESCRIPTION } from "@/lib/brand";
import Footer from "@/components/Footer";
import RouteProgress from "@/components/RouteProgress";
import ThemeProvider from "@/components/ThemeProvider";
import { Suspense } from "react";
import { inter, geistMono, unbounded } from "./fonts";

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

// Light is the default; dark is a class the header toggle adds, never an OS preference, so the
// pre-CSS hints stay light. ThemeProvider keeps theme-color in step after a toggle.
export const viewport: Viewport = { themeColor: "#FAFAF8", colorScheme: "light", width: "device-width", initialScale: 1, viewportFit: "cover" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Minted per request in src/proxy.ts; next-themes' inline theme script must carry it to run under the CSP.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const usd = await ethUsd();
  const [feed, totals] = await Promise.all([getLaunchFeed(24, usd).catch(() => []), getLaunchTotals(usd)]);
  return (
    <html lang="en" className={`${inter.variable} ${geistMono.variable} ${unbounded.variable}`} suppressHydrationWarning>
      <body id="site-top" tabIndex={-1} className="min-h-screen flex flex-col">
        <ThemeProvider nonce={nonce}>
        <Web3Provider>
          <LiveProvider initial={{ at: 0, feed, totals, ethUsd: usd }}>
          <Suspense fallback={null}>
            <RouteProgress />
          </Suspense>
          <Header />
          <TxToasts />
          <div className="flex-1 min-w-0">{children}</div>
          <Footer />
          </LiveProvider>
        </Web3Provider>
        </ThemeProvider>
      </body>
    </html>
  );
}
