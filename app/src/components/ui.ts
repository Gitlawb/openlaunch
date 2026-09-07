/** Shared controls for the Gitlawb Explorer design system. */

const btnBase =
  "inline-flex items-center justify-center gap-1.5 rounded-xl font-medium text-sm whitespace-nowrap transition-colors disabled:opacity-40 disabled:cursor-not-allowed select-none";

export const btn = {
  primary: `${btnBase} min-h-11 px-5 bg-brand text-brand-fg hover:bg-brand-strong`,
  primarySm: `${btnBase} min-h-11 px-3.5 text-[13px] bg-brand text-brand-fg hover:bg-brand-strong`,
  secondary: `${btnBase} min-h-11 px-5 bg-card text-ink border border-line-strong hover:border-ink/40 hover:bg-paper`,
  secondarySm: `${btnBase} min-h-9 px-3.5 text-[13px] bg-card text-ink border border-line-strong hover:border-ink/40`,
  soft: `${btnBase} min-h-11 px-5 bg-brand-soft text-brand hover:bg-brand hover:text-brand-fg`,
  softSm: `${btnBase} min-h-11 px-3.5 text-[13px] bg-brand-soft text-brand hover:bg-brand hover:text-brand-fg`,
  up: `${btnBase} min-h-11 px-5 bg-up text-status-fg hover:brightness-110`,
  warm: `${btnBase} min-h-11 px-5 bg-warm text-status-fg hover:brightness-110`,
  warmOutline: `${btnBase} min-h-11 px-5 bg-warm-soft text-warm-ink border border-warm/40 hover:border-warm`,
  icon: `${btnBase} h-10 w-10 rounded-xl text-ink hover:bg-paper border border-transparent hover:border-line`,
};

export const card = "rounded-2xl bg-card border border-line shadow-card";
export const cardPad = `${card} p-5`;

/** Quiet section label; hierarchy comes from spacing rather than uppercase. */
export const eyebrow = "text-xs font-medium text-muted";

export const input =
  "w-full rounded-xl bg-card border border-line-strong focus:border-brand focus:ring-4 focus:ring-brand/10 outline-none h-12 px-4 text-base text-ink placeholder:text-faint transition-shadow";

export const label = "block text-sm font-medium text-ink mb-1.5";
export const helper = "mt-1.5 text-xs text-muted";

export const pill = "inline-flex items-center gap-1.5 rounded-full border border-line bg-card px-3 py-1.5 text-xs font-medium text-body whitespace-nowrap";

export const codeBlock =
  "overflow-x-auto rounded-xl bg-paper border border-line px-4 py-3 font-mono text-[13px] leading-relaxed text-ink bb-scroll";
