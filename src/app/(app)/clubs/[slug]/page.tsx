import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ClubAbout } from "@/components/club-about";
import { ClubOperationalSummaryCard } from "@/components/club-operational-summary";
import {
  ClubMembershipPanel,
  ClubPageFrame,
} from "@/components/club-page-frame";
import { Card, SectionHeader } from "@/components/ui";
import {
  getClubPageContextBySlug,
  isClubManager,
  isClubOwner,
} from "@/lib/clubs";
import { getClubOperationalSummaries } from "@/lib/club-operational-summaries";
import { getPublicClubResultsCatalog } from "@/lib/public-results";
import { getViewerId } from "@/lib/viewer";

export const metadata: Metadata = {
  title: "Club overview",
};

function DetailItem({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="rounded-xl bg-surface-muted px-4 py-4">
      <dt className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-2 text-sm font-semibold text-foreground">
        {value ?? "Not provided"}
      </dd>
    </div>
  );
}

export default async function ClubOverviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ registered?: string | string[] }>;
}) {
  const { slug } = await params;
  const { registered } = await searchParams;
  const viewerId = await getViewerId();
  const authenticatedContext = viewerId
    ? await getClubPageContextBySlug(slug)
    : null;
  const publicCatalog = viewerId
    ? null
    : await getPublicClubResultsCatalog({ clubSlug: slug });
  const context = authenticatedContext ??
    (publicCatalog?.club
      ? {
          club: publicCatalog.club,
          membership: null,
          informationCardCount: publicCatalog.information_cards?.length ?? 0,
        }
      : null);

  if (!context) {
    notFound();
  }

  const { club, membership, informationCardCount } = context;
  const owner = isClubOwner(membership);
  const manager = isClubManager(membership);
  const operationalSummary = manager
    ? (await getClubOperationalSummaries(club.id))[0] ?? null
    : null;
  const relatedOrganisations = Array.from(
    new Map(
      (publicCatalog?.competitions ?? []).map((competition) => [
        competition.organisation_slug,
        {
          name: competition.organisation_name,
          slug: competition.organisation_slug,
        },
      ]),
    ).values(),
  ).sort((left, right) => left.name.localeCompare(right.name, "en-GB"));
  const registrationSucceeded = Array.isArray(registered)
    ? registered[0] === "1"
    : registered === "1";

  return (
    <ClubPageFrame
      club={club}
      membership={membership}
      informationCardCount={informationCardCount}
      isAuthenticated={Boolean(viewerId)}
      currentSection="overview"
    >
      {registrationSucceeded && owner ? (
        <div
          className="mb-8 rounded-2xl border border-success/20 bg-success-subtle px-5 py-4 text-sm leading-6 text-success"
          role="status"
        >
          <strong className="font-semibold">Club registered.</strong>{" "}
          You are now its owner, and it has been added to My Clubs through your
          active membership.
        </div>
      ) : null}

      {viewerId ? (
        <ClubMembershipPanel club={club} membership={membership} />
      ) : null}

      {operationalSummary ? (
        <div className="mt-10">
          <ClubOperationalSummaryCard summary={operationalSummary} />
        </div>
      ) : null}

      {club.about_content || owner ? (
        <div className="mt-10">
          <ClubAbout
            key={club.about_content ?? "empty"}
            clubId={club.id}
            initialContent={club.about_content}
            isOwner={owner}
          />
        </div>
      ) : null}

      {relatedOrganisations.length > 0 ? (
        <section className="mt-10" aria-labelledby="related-organisations-heading">
          <SectionHeader
            title="Related organisations"
            description="Derived from this club’s published Competition participation"
          />
          <Card className="p-5 sm:p-6">
            <h2 id="related-organisations-heading" className="sr-only">
              Related organisations
            </h2>
            <ul className="divide-y divide-border">
              {relatedOrganisations.map((organisation) => (
                <li key={organisation.slug}>
                  <Link
                    href={`/organisations/${organisation.slug}`}
                    className="flex min-h-12 items-center py-3 text-sm font-semibold text-brand-deep hover:underline"
                  >
                    {organisation.name}
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      ) : null}

      <section className="mt-10" aria-labelledby="club-details-heading">
        <SectionHeader
          title="Club details"
          description="Published club discovery information"
        />
        <Card className="p-6 sm:p-8">
          <h2 id="club-details-heading" className="sr-only">
            Club details
          </h2>
          <dl className="grid gap-3 sm:grid-cols-3">
            <DetailItem label="Town" value={club.town} />
            <DetailItem label="County" value={club.county} />
            <DetailItem label="Postcode" value={club.postcode} />
          </dl>
          {club.website ? (
            <a
              href={club.website}
              target="_blank"
              rel="noreferrer"
              className="mt-6 inline-flex text-sm font-semibold text-brand-strong hover:text-brand-deep hover:underline"
            >
              Visit club website
              <span className="ml-1" aria-hidden="true">
                ↗
              </span>
            </a>
          ) : null}
        </Card>
      </section>

    </ClubPageFrame>
  );
}
