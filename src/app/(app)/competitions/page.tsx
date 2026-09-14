import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  MyShootingCompetitionList,
  MyShootingCompetitionTabs,
} from "@/components/my-shooting-competitions";
import {
  addCompletedCompetitionResults,
  getMyShootingCompetitions,
  groupMyShootingCompetitions,
  type MyShootingCompetitionTab,
} from "@/lib/my-shooting-competitions";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "My Competitions",
};

function requestedTab(value: string | string[] | undefined) {
  const candidate = Array.isArray(value) ? value[0] : value;
  return (["active", "upcoming", "completed"] as const).includes(
    candidate as MyShootingCompetitionTab,
  )
    ? (candidate as MyShootingCompetitionTab)
    : "active";
}

export default async function MyCompetitionsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();
  if (claimsError || !claimsData?.claims?.sub) redirect("/login");

  const [{ tab }, data] = await Promise.all([
    searchParams,
    getMyShootingCompetitions(),
  ]);
  const activeTab = requestedTab(tab);
  const grouped = groupMyShootingCompetitions(data);
  const visibleParticipations =
    activeTab === "completed"
      ? await addCompletedCompetitionResults(grouped.completed)
      : grouped[activeTab];
  const counts = {
    active: grouped.active.length,
    upcoming: grouped.upcoming.length,
    completed: grouped.completed.length,
  };

  return (
    <div className="min-w-0">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-brand-strong">
          My Shooting
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-foreground sm:text-4xl">
          Competitions
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground sm:text-base">
          Your submitted Competition entries, upcoming dates, current Rounds and
          official Results across every Club you shoot through.
        </p>
      </div>

      <MyShootingCompetitionTabs activeTab={activeTab} counts={counts} />
      <MyShootingCompetitionList
        tab={activeTab}
        participations={visibleParticipations}
        today={data.as_of_date}
      />
    </div>
  );
}
