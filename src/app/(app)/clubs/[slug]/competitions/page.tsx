import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ClubMembershipPanel,
  ClubPageFrame,
} from "@/components/club-page-frame";
import { Badge, Card } from "@/components/ui";
import { getClubPageContextBySlug } from "@/lib/clubs";

export const metadata: Metadata = {
  title: "Club competitions",
};

export default async function ClubCompetitionsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const context = await getClubPageContextBySlug(slug);

  if (!context) {
    notFound();
  }

  const { club, membership, informationCardCount } = context;
  const membershipIsActive = membership?.status === "active";

  return (
    <ClubPageFrame
      club={club}
      membership={membership}
      informationCardCount={informationCardCount}
      currentSection="competitions"
    >
      {membershipIsActive ? (
        <Card className="p-6 sm:p-8">
          <div className="flex flex-col items-start gap-5 sm:flex-row">
            <span
              className="grid size-12 shrink-0 place-items-center rounded-2xl bg-brand-subtle text-sm font-bold text-brand-deep"
              aria-hidden="true"
            >
              C
            </span>
            <div>
              <Badge tone="positive">Membership active</Badge>
              <h2 className="mt-3 font-semibold text-foreground">
                No competition data yet
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                Competitions and league entries connected to this club will appear
                here once real competition data exists.
              </p>
            </div>
          </div>
        </Card>
      ) : (
        <>
          <ClubMembershipPanel club={club} membership={membership} />
          <Card className="mt-6 bg-surface-muted p-6 sm:p-8">
            <h2 className="font-semibold text-foreground">
              Club competitions require active membership
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              This member-facing area becomes available when your membership in
              this club is active.
            </p>
            <Link
              href={`/clubs/${club.slug}`}
              className="mt-5 inline-flex min-h-11 items-center justify-center rounded-xl border border-border bg-surface px-5 text-sm font-semibold text-brand-deep transition hover:bg-brand-subtle"
            >
              Return to club overview
            </Link>
          </Card>
        </>
      )}
    </ClubPageFrame>
  );
}
