export default function Loading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <div className="h-8 w-64 animate-pulse rounded-lg bg-surface-2" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="h-20 animate-pulse rounded-[var(--radius-card)] bg-surface" />)}</div>
      <div className="h-64 animate-pulse rounded-[var(--radius-card)] bg-surface" />
    </div>
  );
}
