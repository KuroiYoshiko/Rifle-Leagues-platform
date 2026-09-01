import {
  DashboardClubCards,
  type DashboardClubMembership,
} from "@/components/dashboard-club-cards";
import type { ClubRole } from "@/lib/clubs";

function membership(id: number, role: ClubRole): DashboardClubMembership {
  return {
    id,
    club_id: id,
    status: "active",
    role,
    created_at: "2026-09-01T00:00:00Z",
    club: {
      id,
      name: "Alignment Test Rifle Club",
      slug: `alignment-test-club-${id}`,
      town: "Basildon",
      county: "Essex",
      postcode: null,
      website: null,
    },
  };
}

const combinations: Array<{
  label: string;
  memberships: DashboardClubMembership[];
}> = [
  {
    label: "Owner and Member",
    memberships: [membership(1, "owner"), membership(2, "member")],
  },
  {
    label: "Owner and Official",
    memberships: [membership(3, "owner"), membership(4, "official")],
  },
  {
    label: "Member and Official",
    memberships: [membership(5, "member"), membership(6, "official")],
  },
];

export default function DashboardCardPreviewPage() {
  return (
    <main className="min-h-screen bg-background p-4 sm:p-8">
      <div className="mx-auto max-w-5xl space-y-10">
        {combinations.map((combination) => (
          <section key={combination.label}>
            <h1 className="mb-4 text-lg font-semibold">{combination.label}</h1>
            <DashboardClubCards memberships={combination.memberships} />
          </section>
        ))}
      </div>
    </main>
  );
}
