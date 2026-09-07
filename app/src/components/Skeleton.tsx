/**
 * Skeleton primitives (server-safe). Gray placeholders in the shape of the content they replace,
 * shimmering unless the viewer prefers reduced motion. Keep layouts identical to the real component
 * so nothing shifts when data arrives.
 */
export function Sk({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  return <span className={`bb-skel block rounded-md ${className}`} style={style} aria-hidden />;
}

/** One launch row, matching LaunchRow's grid. */
export function SkRow({ i }: { i: number }) {
  return (
    <li className="px-3 sm:px-4 py-3 border-t border-line first:border-t-0">
      <div className="bb-launch-columns grid items-center gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Sk className="h-10 w-10 rounded-xl shrink-0" />
          <div className="min-w-0 space-y-2">
            <Sk className="h-3.5" style={{ width: `${110 + ((i * 37) % 90)}px` }} />
            <Sk className="h-3 w-24" />
          </div>
        </div>
        <Sk className="hidden md:block h-3.5 w-16 ml-auto" />
        <Sk className="hidden md:block h-3.5 w-14 ml-auto" />
        <Sk className="hidden md:block h-3.5 w-12 ml-auto" />
        <Sk className="hidden md:block h-3 w-8 ml-auto" />
      </div>
    </li>
  );
}

export function SkStat() {
  return (
    <div className="rounded-xl bg-card border border-line shadow-card px-3.5 py-3 min-w-0 space-y-2">
      <Sk className="h-3 w-14" />
      <Sk className="h-5 w-20" />
      <Sk className="h-2.5 w-16" />
    </div>
  );
}

export function SkPost() {
  return (
    <li className="px-4 py-3 border-t border-line first:border-t-0 flex gap-3">
      <Sk className="h-8 w-8 rounded-full shrink-0" />
      <div className="flex-1 space-y-2">
        <Sk className="h-3 w-32" />
        <Sk className="h-3.5 w-3/4" />
      </div>
    </li>
  );
}

export function Spinner({ size = 16, className = "" }: { size?: number; className?: string }) {
  return <span className={`bb-spin inline-block rounded-full border-2 border-current border-t-transparent align-[-0.15em] ${className}`} style={{ width: size, height: size }} aria-hidden />;
}
