import { Card } from "@/components/ui";

export default function DashboardLoading() {
  return <div aria-busy="true" aria-label="Loading Overview" className="min-w-0">
    <div className="h-3 w-24 animate-pulse rounded bg-brand-subtle" />
    <div className="mt-4 h-10 w-56 animate-pulse rounded-xl bg-surface-muted" />
    <div className="mt-3 h-4 max-w-xl animate-pulse rounded bg-surface-muted" />
    <div className="mt-7 grid gap-4 md:grid-cols-2">
      {[0, 1].map((item) => <Card key={item} className="h-44 animate-pulse bg-surface-muted p-5"><span className="sr-only">Loading</span></Card>)}
    </div>
  </div>;
}
