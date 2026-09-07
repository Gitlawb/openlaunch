/**
 * The original geometric oL mark in the shared Gitlawb monochrome palette.
 * `tile=false` draws only the letters in the supplied color.
 */
export default function Mark({ size = 24, className = "", title = "openlaunch", tile = true, color = "#FFFFFF" }: { size?: number; className?: string; title?: string; tile?: boolean; color?: string }) {
  const fg = tile ? "var(--color-brand-fg)" : color;
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" className={className} role="img" aria-label={title}>
      {tile ? <rect width="32" height="32" rx="7" fill="var(--color-brand)" /> : null}
      <path fill={fg} fillRule="evenodd" d="M10.5 13a6.5 6.5 0 1 1 0 13a6.5 6.5 0 1 1 0-13ZM10.5 16.4a3.1 3.1 0 1 0 0 6.2a3.1 3.1 0 1 0 0-6.2Z" />
      <rect x="19.5" y="6" width="4.6" height="20" rx="1.4" fill={fg} />
      <rect x="19.5" y="21.4" width="8.2" height="4.6" rx="1.4" fill={fg} />
    </svg>
  );
}

/** Keep the product name readable alongside the Gitlawb family attribution. */
export function Wordmark({ className = "", size = 15 }: { className?: string; size?: number }) {
  return (
    <span className={`font-semibold tracking-tight text-ink ${className}`} style={{ fontSize: size }}>
      openlaunch<span className="text-muted">.lol</span>
    </span>
  );
}
