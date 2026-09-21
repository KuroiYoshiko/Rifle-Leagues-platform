import { Card } from "@/components/ui";

export default function StatisticsLoading() {
  return (
    <div className="min-w-0" aria-busy="true" aria-label="Loading Statistics">
      <div className="h-3 w-24 animate-pulse rounded-full bg-brand-subtle" />
      <div className="mt-4 h-10 w-52 animate-pulse rounded-xl bg-surface-muted" />
      <div className="mt-3 h-5 w-full max-w-2xl animate-pulse rounded-lg bg-surface-muted" />

      <Card className="mt-7 p-5 sm:p-6">
        <div className="h-5 w-36 animate-pulse rounded-lg bg-surface-muted" />
        <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((item) => (
            <div key={item} className="h-11 animate-pulse rounded-xl bg-surface-muted" />
          ))}
        </div>
      </Card>

      <div className="mt-5 grid grid-cols-2 gap-1 rounded-2xl border border-border bg-surface p-1 sm:flex sm:w-fit">
        {[0, 1, 2, 3].map((item) => (
          <div key={item} className="h-11 w-full animate-pulse rounded-xl bg-surface-muted sm:w-28" />
        ))}
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((item) => (
          <Card key={item} className="p-5">
            <div className="h-3 w-24 animate-pulse rounded bg-surface-muted" />
            <div className="mt-4 h-8 w-20 animate-pulse rounded-lg bg-surface-muted" />
            <div className="mt-3 h-4 w-full animate-pulse rounded bg-surface-muted" />
          </Card>
        ))}
      </div>
    </div>
  );
}
