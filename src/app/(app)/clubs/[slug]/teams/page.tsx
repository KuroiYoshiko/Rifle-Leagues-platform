import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ClubPageFrame } from "@/components/club-page-frame";
import { ClubTeamsManager } from "@/components/club-teams-manager";
import { Card } from "@/components/ui";
import { getClubPageContextBySlug, isClubManager } from "@/lib/clubs";
import { getClubTeams } from "@/lib/club-teams";

export const metadata: Metadata = { title: "Club Teams" };

export default async function ClubTeamsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const context = await getClubPageContextBySlug(slug);
  if (!context || context.membership?.status !== "active") notFound();

  const { club, membership, informationCardCount } = context;
  const data = await getClubTeams(club.id, true);

  return (
    <ClubPageFrame
      club={club}
      membership={membership}
      informationCardCount={informationCardCount}
      isAuthenticated
      currentSection="teams"
    >
      {data ? (
        <ClubTeamsManager
          club={club}
          initialTeams={data.teams}
          canManage={isClubManager(membership) && data.can_manage}
        />
      ) : (
        <Card className="border-danger/20 p-6 sm:p-8">
          <h2 className="font-semibold text-foreground">Club Teams could not be loaded</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Run the Club Teams database upgrade, then refresh this page.
          </p>
        </Card>
      )}
    </ClubPageFrame>
  );
}
