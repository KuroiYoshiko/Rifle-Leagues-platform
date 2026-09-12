import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ShooterAnalyticsDashboard } from "@/components/shooter-analytics-dashboard";
import {
  getMyShooterAnalytics,
  parseShooterAnalyticsFilters,
} from "@/lib/shooter-analytics";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Performance analytics",
};

type StatisticsSearchParams = Promise<Record<string, string | string[] | undefined>>;

function single(value: string | string[] | undefined) {
  return typeof value === "string" ? value : undefined;
}

export default async function StatisticsPage({
  searchParams,
}: {
  searchParams: StatisticsSearchParams;
}) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) redirect("/login");

  const params = await searchParams;
  const filters = parseShooterAnalyticsFilters({
    season: single(params.season),
    equipment: single(params.equipment),
    position: single(params.position),
    distance: single(params.distance),
  });
  const analytics = await getMyShooterAnalytics(filters.rpc);

  return (
    <ShooterAnalyticsDashboard
      analytics={analytics}
      selection={filters.selection}
    />
  );
}
