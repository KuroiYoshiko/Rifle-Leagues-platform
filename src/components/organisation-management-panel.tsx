import Link from "next/link";
import { Badge, TargetContextCard } from "@/components/ui";
import type { OrganisationStaffRole } from "@/lib/organisations";

const roleLabels: Record<OrganisationStaffRole, string> = {
  owner: "Owner",
  manager: "Manager",
};

export function OrganisationManagementPanel({
  organisation,
  role,
}: {
  organisation: { name: string; slug: string };
  role: OrganisationStaffRole;
}) {
  return (
    <TargetContextCard className="mb-8 p-5 sm:p-6">
      <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap gap-2">
            <Badge tone="positive">Active</Badge>
            <Badge tone="brand">{roleLabels[role]}</Badge>
          </div>
          <h2 className="mt-3 text-lg font-semibold">
            Organisation management
          </h2>
          <p className="mt-1.5 text-sm leading-6 text-white/70">
            You manage {organisation.name}.
          </p>
          <p className="text-sm leading-6 text-white/58">
            Access season, competition and organisation management tools.
          </p>
        </div>
        <Link
          href={`/organisations/${organisation.slug}/management`}
          className="inline-flex min-h-11 items-center justify-center rounded-xl bg-brand px-5 text-sm font-semibold text-hero-background shadow-sm shadow-black/10 transition hover:bg-brand-subtle hover:text-brand-deep"
        >
          View management
          <span className="ml-2" aria-hidden="true">→</span>
        </Link>
      </div>
    </TargetContextCard>
  );
}
