"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import Mark, { Wordmark } from "./launchpad/Mark";
import ConnectButton from "./ConnectButton";
import Sheet from "./Sheet";
import LivePulse from "./launchpad/LivePulse";

const NAV = [
  { href: "/", label: "Launchpad" },
  { href: "/feed", label: "Posts" },
  { href: "/rules", label: "How it works" },
  { href: "/agents", label: "Agents" },
  { href: "/me", label: "Me" },
];

export default function HeaderNav({ pulse }: { pulse: { visits: number; online: number } }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-paper">
      <div className="bb-header-inner mx-auto max-w-6xl px-4 min-h-16 flex items-center gap-3">
        <Link href="/" className="flex items-center gap-2 shrink-0" aria-label="openlaunch.lol home">
          <Mark size={24} />
          <Wordmark />
        </Link>
        <span className="hidden xl:inline text-muted text-xs border-l border-line pl-3">by Gitlawb</span>

        <nav aria-label="Main navigation" className="hidden lg:flex items-center gap-0.5 ml-auto">
          {NAV.map((n) => {
            const active = n.href === "/" ? pathname === "/" || pathname.startsWith("/t/") : pathname.startsWith(n.href);
            return (
              <Link key={n.href} href={n.href} aria-current={active ? "page" : undefined} className={`px-2.5 min-h-11 inline-flex items-center rounded-lg text-xs font-medium whitespace-nowrap ${active ? "text-ink bg-brand-soft" : "text-muted hover:text-ink hover:bg-subtle"}`}>
                {n.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2 min-w-0">
          <Link href="/launch" className="inline-flex items-center min-h-11 px-3.5 rounded-full bg-brand text-brand-fg text-xs font-medium hover:bg-brand-strong whitespace-nowrap">
            Launch<span className="hidden sm:inline">&nbsp;a token</span>
          </Link>
          <div className="hidden lg:block">
            <ConnectButton />
          </div>
          <button type="button" onClick={() => setOpen(true)} aria-label="Open menu" aria-expanded={open} className="lg:hidden h-11 w-11 inline-flex items-center justify-center rounded-xl border border-line bg-card text-ink hover:border-line-strong">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M2.5 5h13M2.5 9h13M2.5 13h13" />
            </svg>
          </button>
        </div>
      </div>
      <div className="bb-network-bar border-t border-line-muted">
        <div className="mx-auto max-w-6xl px-4 min-h-10 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-1 text-[11px] text-muted">
          <span>Base + Robinhood Chain <span className="mx-2 text-line-strong" aria-hidden>/</span> 0% platform fee</span>
          <LivePulse initial={pulse} />
        </div>
      </div>

      {open ? (
        <Sheet title="Menu" onClose={() => setOpen(false)}>
          <nav className="flex flex-col gap-1 pb-3">
            {[{ href: "/launch", label: "Launch a token · free" }, ...NAV].map((n) => {
              const active = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
              return (
                <Link key={n.href} href={n.href} aria-current={active ? "page" : undefined} onClick={() => setOpen(false)} className={`min-h-12 px-3 inline-flex items-center rounded-xl text-base font-medium ${active ? "bg-brand-soft text-brand" : "text-ink hover:bg-paper"}`}>
                  {n.label}
                </Link>
              );
            })}
            <div className="sm:hidden">
              <LivePulse initial={pulse} block />
            </div>
          </nav>
          <div className="border-t border-line pt-4 space-y-3">
            <ConnectButton block />
          </div>
        </Sheet>
      ) : null}
    </header>
  );
}
