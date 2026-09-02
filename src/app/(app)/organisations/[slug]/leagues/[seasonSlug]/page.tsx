import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { OrganisationPageFrame } from "@/components/organisation-page-frame";
import { Badge, Card, SectionHeader } from "@/components/ui";
import {
  formatLeagueSeasonDate,
  getLeagueSeasonBySlug,
  getLeagueSeasonStatusLabel,
  type LeagueSeasonStatus,
} from "@/lib/league-seasons";
import {
  getActiveOrganisationBySlug,
  getOrganisationManagementContextBySlug,
} from "@/lib/organisations";

export const metadata: Metadata = {
  title: "League season",
};

const badgeTones: Record<
  LeagueSeasonStatus,
  "neutral" | "positive" | "warning" | "brand"
> = {
  draft: "warning",
  open: "brand",
  active: "positive",
  completed: "neutral",
};

export default async function LeagueSeasonDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; seasonSlug: string }>;
  searchParams: Promise<{ created?: string | string[] }>;
}) {
  const { slug, seasonSlug } = await params;
  const { created } = await searchParams;
  const [organisation, managementContext] = await Promise.all([
    getActiveOrganisationBySlug(slug),
    getOrganisationManagementContextBySlug(slug),
  ]);

  if (!organisation) {
    notFound();
  }

  const season = await getLeagueSeasonBySlug(organisation.id, seasonSlug);

  if (!season) {
    notFound();
  }

  const isOwner = managementContext?.access.role === "owner";
  const creationSucceeded = Array.isArray(created)
    ? created[0] === "1"
    : created === "1";
  const dates = [
    ["Entry opens", season.entry_opens_at],
    ["Entry closes", season.entry_closes_at],
    ["Starts", season.starts_at],
    ["Ends", season.ends_at],
  ] as const;

  return (
    <OrganisationPageFrame organisation={organisation} currentSection="leagues">
      {creationSucceeded ? (
        <div
          className="mb-6 rounded-2xl border border-success/20 bg-success-subtle px-5 py-4 text-sm leading-6 text-success"
          role="status"
        >
          <strong className="font-semibold">League created.</strong> It is a
          private draft until you move it to Open.
        </div>
      ) : null}

      <Link
        href={`/organisations/${organisation.slug}/leagues`}
        className="inline-flex text-sm font-semibold text-brand-strong hover:text-brand-deep hover:underline"
      >
        ← Back to leagues
      </Link>

      <Card className="mt-5 min-w-0 p-6 sm:p-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <Badge tone={badgeTones[season.status]}>
              {getLeagueSeasonStatusLabel(season.status)}
            </Badge>
            <h2 className="mt-4 break-words text-2xl font-semibold tracking-[-0.035em] text-foreground sm:text-3xl">
              {season.name}
            </h2>
            {season.status === "draft" ? (
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Only the active organisation owner can see this draft.
              </p>
            ) : null}
          </div>
          {isOwner ? (
            <Link
              href={`/organisations/${organisation.slug}/leagues/${season.slug}/edit`}
              className="inline-flex min-h-11 shrink-0 items-center justify-center self-start rounded-xl border border-border bg-surface px-5 text-sm font-semibold text-brand-deep transition hover:bg-brand-subtle"
            >
              Edit league
            </Link>
          ) : null}
        </div>

        <dl className="mt-8 grid gap-5 border-t border-border pt-6 sm:grid-cols-2 lg:grid-cols-4">
          {dates.map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="text-xs font-medium text-muted-foreground">
                {label}
              </dt>
              <dd className="mt-1.5 break-words text-sm font-semibold text-foreground">
                {formatLeagueSeasonDate(value) ?? "Not set"}
              </dd>
            </div>
          ))}
        </dl>
      </Card>

      <section className="mt-10" aria-labelledby="competitions-heading">
        <SectionHeader
          title="Competitions"
          description="Competitions within this league season"
        />
        <Card className="p-6 sm:p-8">
          <div className="flex flex-col items-start gap-5 sm:flex-row">
            <span
              className="grid size-12 shrink-0 place-items-center rounded-2xl bg-brand-subtle text-sm font-bold text-brand-deep"
              aria-hidden="true"
            >
              C
            </span>
            <div>
              <h3 id="competitions-heading" className="font-semibold text-foreground">
                No competitions have been added yet
              </h3>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                Competition creation is intentionally not available in this
                league season foundation.
              </p>
            </div>
          </div>
        </Card>
      </section>
    </OrganisationPageFrame>
  );
}
