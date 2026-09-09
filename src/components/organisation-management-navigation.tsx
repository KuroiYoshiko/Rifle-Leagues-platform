import Link from "next/link";

export function OrganisationManagementNavigation({
  organisationSlug,
  current,
}: {
  organisationSlug: string;
  current: "overview" | "series" | "averages" | "concurrent";
}) {
  const items = [
    { id: "overview" as const, label: "Overview", href: `/organisations/${organisationSlug}/management` },
    { id: "series" as const, label: "Competition Series", href: `/organisations/${organisationSlug}/management/series` },
    { id: "averages" as const, label: "Averages", href: `/organisations/${organisationSlug}/management/averages` },
    { id: "concurrent" as const, label: "Concurrent Shooting", href: `/organisations/${organisationSlug}/management/concurrent-shooting` },
  ];

  return <nav aria-label="Organisation management sections" className="mb-8 border-b border-border">
    <div className="flex min-w-max gap-5 overflow-x-auto px-1">
      {items.map((item) => <Link
        key={item.id}
        href={item.href}
        aria-current={current === item.id ? "page" : undefined}
        className={`border-b-2 px-1 pb-3 text-sm font-semibold transition ${
          current === item.id
            ? "border-brand text-brand-deep"
            : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
        }`}
      >{item.label}</Link>)}
    </div>
  </nav>;
}
