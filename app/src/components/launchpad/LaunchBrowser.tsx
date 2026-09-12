"use client";

import { type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Star } from "lucide-react";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@/components/vendor/tabs";
import { useWatchlist } from "./useWatchlist";
import WatchlistPanel from "./WatchlistPanel";

export default function LaunchBrowser({ children }: { children: ReactNode }) {
  const params = useSearchParams();
  const router = useRouter();
  const { entries, ready } = useWatchlist();
  const view = params.get("view") === "watchlist" ? "watchlist" : "all";
  function select(value: unknown) {
    const next = new URLSearchParams(params);
    if (value === "watchlist") next.set("view", "watchlist");
    else next.delete("view");
    router.replace(`/${next.size ? `?${next}` : ""}#launches`, { scroll: false });
  }
  return (
    <Tabs id="launches" value={view} onValueChange={select} className="min-w-0 scroll-mt-24">
      <TabsList aria-label="Launch browser" className="gap-6 px-0">
        <TabsTab value="all">All launches</TabsTab>
        <TabsTab value="watchlist"><Star size={15} aria-hidden="true" /> Watchlist <span className="font-mono text-xs text-muted tnum">{ready ? entries.length : ""}</span></TabsTab>
      </TabsList>
      <TabsPanel value="all" keepMounted>{children}</TabsPanel>
      <TabsPanel value="watchlist"><WatchlistPanel onBrowse={() => select("all")} /></TabsPanel>
    </Tabs>
  );
}
