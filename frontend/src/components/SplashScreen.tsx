/**
 * SplashScreen — shown during initial auth/data load.
 * Branded, dark, no flash of login or empty state.
 */
export default function SplashScreen() {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6">
      {/* Logo / brand */}
      <div className="mb-10 flex flex-col items-center gap-3">
        <div className="w-14 h-14 rounded-2xl bg-surface border border-border flex items-center justify-center">
          <span className="text-2xl font-bold text-accent-400">K</span>
        </div>
        <span className="text-lg font-semibold text-white tracking-wide">Konto</span>
      </div>

      {/* Skeleton cards mimicking the dashboard */}
      <div className="w-full max-w-sm space-y-3">
        {/* Hero card skeleton */}
        <div className="bg-surface rounded-xl border border-border p-4 flex flex-col items-center gap-2">
          <div className="h-3 w-24 rounded bg-surface-hover animate-pulse" />
          <div className="h-8 w-40 rounded bg-surface-hover animate-pulse" />
        </div>

        {/* 2×2 grid skeleton */}
        <div className="grid grid-cols-2 gap-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-surface rounded-xl border border-border px-3 py-3 flex items-center gap-2.5">
              <div className="w-5 h-5 rounded-full bg-surface-hover animate-pulse flex-shrink-0" />
              <div className="flex-1 space-y-1.5">
                <div className="h-2.5 w-14 rounded bg-surface-hover animate-pulse" />
                <div className="h-3.5 w-20 rounded bg-surface-hover animate-pulse" />
              </div>
            </div>
          ))}
        </div>

        {/* Chart area skeleton */}
        <div className="bg-surface rounded-xl border border-border p-4">
          <div className="h-3 w-32 rounded bg-surface-hover animate-pulse mb-3" />
          <div className="h-28 rounded-lg bg-surface-hover animate-pulse" />
        </div>
      </div>
    </div>
  );
}
