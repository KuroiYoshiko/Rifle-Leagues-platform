import { Card } from "@/components/ui";

export default function OrganisationsLoading() {
  return (
    <div className="mx-auto max-w-5xl" aria-busy="true" aria-label="Loading organisations">
      <div className="h-3 w-32 animate-pulse rounded-full bg-brand-subtle" />
      <div className="mt-5 h-10 w-full max-w-xl animate-pulse rounded-xl bg-surface-muted" />
      <div className="mt-3 h-5 w-full max-w-2xl animate-pulse rounded-lg bg-surface-muted" />
      <Card className="mt-8 p-6">
        <div className="h-12 animate-pulse rounded-xl bg-surface-muted" />
      </Card>
      <div className="mt-8 space-y-3">
        {[1, 2, 3].map((item) => (
          <Card key={item} className="p-6">
            <div className="h-5 w-2/3 animate-pulse rounded-lg bg-surface-muted" />
            <div className="mt-3 h-4 w-1/3 animate-pulse rounded-lg bg-surface-muted" />
          </Card>
        ))}
      </div>
    </div>
  );
}
