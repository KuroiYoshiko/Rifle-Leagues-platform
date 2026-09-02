import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ActiveClubMembersList } from "@/components/active-club-members-list";
import { MembershipDecisionControls } from "@/components/club-member-actions";
import { ClubPageFrame } from "@/components/club-page-frame";
import { Card, SectionHeader } from "@/components/ui";
import {
  getClubMemberName,
  getClubPageContextBySlug,
  isClubManager,
  type ManagedClubMember,
} from "@/lib/clubs";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Club members",
};

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Europe/London",
});

function formatDate(value: string) {
  return dateFormatter.format(new Date(value));
}

export default async function ClubMembersPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const context = await getClubPageContextBySlug(slug);

  if (!context || !isClubManager(context.membership)) {
    notFound();
  }

  const { club, membership, informationCardCount } = context;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_club_members", {
    p_club_id: club.id,
  });
  const members = (data ?? []) as ManagedClubMember[];
  const pendingMembers = members.filter(
    (member) => member.membership_status === "pending",
  );
  const activeMembers = members.filter(
    (member) => member.membership_status === "active",
  );
  const currentUserIsOwner = membership!.role === "owner";

  return (
    <ClubPageFrame
      club={club}
      membership={membership}
      informationCardCount={informationCardCount}
      currentSection="members"
    >
      {error ? (
        <Card className="border-danger/20 p-6 sm:p-8">
          <div role="alert">
            <h2 className="font-semibold text-foreground">
              Club members could not be loaded
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Run the latest clubs and memberships SQL in Supabase, then refresh
              this page.
            </p>
          </div>
        </Card>
      ) : (
        <>
          <section aria-labelledby="pending-memberships-heading">
            <SectionHeader
              title="Pending membership requests"
              description={`${pendingMembers.length} request${pendingMembers.length === 1 ? "" : "s"} waiting`}
            />
            {pendingMembers.length > 0 ? (
              <div className="space-y-3">
                {pendingMembers.map((member) => {
                  const memberName = getClubMemberName(member);

                  return (
                    <Card key={member.membership_id} className="p-5 sm:p-6">
                      <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                        <div>
                          <h3 className="font-semibold text-foreground">
                            {memberName}
                          </h3>
                          <p className="mt-1.5 text-sm text-muted-foreground">
                            Requested {formatDate(member.updated_at)}
                          </p>
                        </div>
                        <MembershipDecisionControls
                          membershipId={member.membership_id}
                          memberName={memberName}
                          clubSlug={club.slug}
                        />
                      </div>
                    </Card>
                  );
                })}
              </div>
            ) : (
              <Card className="bg-surface-muted p-6">
                <p className="text-sm text-muted-foreground">
                  There are no pending membership requests.
                </p>
              </Card>
            )}
          </section>

          <section className="mt-10">
            <ActiveClubMembersList
              members={activeMembers}
              currentMembershipId={membership!.id}
              currentUserIsOwner={currentUserIsOwner}
              club={{ id: club.id, name: club.name, slug: club.slug }}
            />
          </section>
        </>
      )}
    </ClubPageFrame>
  );
}
