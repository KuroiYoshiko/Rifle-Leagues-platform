import { Card } from "@/components/ui";

export default function ProfileLoading() {
  return (
    <div className="mx-auto max-w-4xl" aria-busy="true" aria-label="Loading profile">
      <div className="h-4 w-28 animate-pulse rounded bg-surface-muted" />
      <div className="mt-4 h-10 w-56 animate-pulse rounded-lg bg-surface-muted" />
      <div className="mt-3 h-4 max-w-xl animate-pulse rounded bg-surface-muted" />
      <Card className="mt-8 space-y-8 p-5 sm:p-7 lg:p-9">
        {[0, 1, 2].map((section) => (
          <div key={section}>
            <div className="h-6 w-40 animate-pulse rounded bg-surface-muted" />
            <div className="mt-5 grid gap-5 sm:grid-cols-2">
              <div className="h-12 animate-pulse rounded-xl bg-surface-muted" />
              <div className="h-12 animate-pulse rounded-xl bg-surface-muted" />
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}
