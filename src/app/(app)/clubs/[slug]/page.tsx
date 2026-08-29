import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  ClubMembershipPanel,
  ClubPageFrame,
} from "@/components/club-page-frame";
import { Card, SectionHeader } from "@/components/ui";
import { getClubPageContextBySlug } from "@/lib/clubs";

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
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const context = await getClubPageContextBySlug(slug);

  if (!context) {
    notFound();
  }

  const { club, membership } = context;

  return (
    <ClubPageFrame
      club={club}
      membership={membership}
      currentSection="overview"
    >
      <ClubMembershipPanel club={club} membership={membership} />

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

      <section className="mt-10" aria-labelledby="competition-activity-heading">
        <SectionHeader
          title="Competition activity"
          description="Competition and league activity associated with this club"
        />
        <Card className="p-6 sm:p-8">
          <h2
            id="competition-activity-heading"
            className="font-semibold text-foreground"
          >
            No real competition data has been added yet
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            Competitions and league entries connected to this club will appear here
            once real competition data exists.
          </p>
        </Card>
      </section>
    </ClubPageFrame>
  );
}
