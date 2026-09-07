"use client";

import { useState } from "react";

/** Deterministic hue from an address — same identity trick as the tape dots. */
export function hueOf(addr: string): number {
  let h = 0;
  for (let i = 2; i < Math.min(addr.length, 18); i++) h = (h * 31 + addr.charCodeAt(i)) % 360;
  return h;
}

/** Keep token artwork; missing images use a neutral initial tile. */
export default function TokenAvatar({ symbol, image, size = 40, className = "" }: { token: string; symbol: string; image?: string | null; size?: number; className?: string }) {
  const [broken, setBroken] = useState(false);
  const style = { width: size, height: size, fontSize: Math.max(11, Math.round(size * 0.42)) };
  if (image && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={image}
        alt=""
        width={size}
        height={size}
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
        className={`shrink-0 rounded-xl object-cover bg-paper border border-line ${className}`}
        style={style}
      />
    );
  }
  return (
    <div
      aria-hidden
      className={`shrink-0 rounded-xl grid place-items-center font-display font-medium bg-brand-soft text-ink border border-line select-none ${className}`}
      style={style}
    >
      {symbol.slice(0, 1).toUpperCase()}
    </div>
  );
}
