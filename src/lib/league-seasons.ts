import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export const LEAGUE_SEASON_STATUSES = [
  "draft",
  "open",
  "active",
  "completed",
] as const;

export type LeagueSeasonStatus = (typeof LEAGUE_SEASON_STATUSES)[number];
export type LeagueSeasonPresentationPhase =
  | "upcoming"
  | "ongoing"
  | "ended"
  | "unknown";

export type LeagueSeason = {
  id: number;
  organisation_id: number;
  name: string;
  slug: string;
  status: LeagueSeasonStatus;
  entry_opens_at: string | null;
  entry_closes_at: string | null;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
  updated_at: string;
};

const leagueSeasonColumns =
  "id, organisation_id, name, slug, status, entry_opens_at, entry_closes_at, starts_at, ends_at, created_at, updated_at";
const routeSafeSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const statusLabels: Record<LeagueSeasonStatus, string> = {
  draft: "Draft",
  open: "Open",
  active: "Active",
  completed: "Completed",
};

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

const dayMonthFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});

const warsawDatePartsFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "Europe/Warsaw",
});

export const getLeagueSeasons = cache(async (organisationId: number) => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("league_seasons")
    .select(leagueSeasonColumns)
    .eq("organisation_id", organisationId)
    .order("starts_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error("League seasons could not be loaded.");
  }

  return (data ?? []) as LeagueSeason[];
});

export const getLeagueSeasonBySlug = cache(
  async (organisationId: number, seasonSlug: string) => {
    if (
      seasonSlug.length > 180 ||
      !routeSafeSlugPattern.test(seasonSlug)
    ) {
      return null;
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("league_seasons")
      .select(leagueSeasonColumns)
      .eq("organisation_id", organisationId)
      .eq("slug", seasonSlug)
      .maybeSingle();

    if (error) {
      throw new Error("The league season could not be loaded.");
    }

    return data as LeagueSeason | null;
  },
);

export function getLeagueSeasonStatusLabel(status: LeagueSeasonStatus) {
  return statusLabels[status];
}

function formatRequiredLeagueSeasonDate(value: string) {
  return dateFormatter.format(new Date(`${value}T00:00:00Z`));
}

export function formatLeagueSeasonDate(value: string | null) {
  return value ? formatRequiredLeagueSeasonDate(value) : null;
}

export function formatLeagueSeasonDateRange(start: string, end: string) {
  if (start === end) return formatRequiredLeagueSeasonDate(start);

  const startDate = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(`${end}T00:00:00Z`);

  if (start.slice(0, 4) === end.slice(0, 4)) {
    return `${dayMonthFormatter.format(startDate)} – ${dateFormatter.format(endDate)}`;
  }

  return `${dateFormatter.format(startDate)} – ${dateFormatter.format(endDate)}`;
}

export function getLeagueToday() {
  const parts = warsawDatePartsFormatter.formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  return `${year}-${month}-${day}`;
}

export function getLeagueSeasonPresentationPhase(
  season: Pick<LeagueSeason, "starts_at" | "ends_at">,
  today = getLeagueToday(),
): LeagueSeasonPresentationPhase {
  if (season.ends_at && season.ends_at < today) return "ended";
  if (season.starts_at && season.starts_at > today) return "upcoming";

  if (
    season.starts_at &&
    season.ends_at &&
    season.starts_at <= today &&
    season.ends_at >= today
  ) {
    return "ongoing";
  }

  return "unknown";
}

export function getLeagueEntryCloseSummary(
  entryClosesAt: string,
  today = getLeagueToday(),
) {
  if (entryClosesAt === today) return "Entries close today";

  const date = formatRequiredLeagueSeasonDate(entryClosesAt);
  return entryClosesAt < today
    ? `Entries closed ${date}`
    : `Entries close ${date}`;
}

export function getLeagueEntryOpenSummary(
  entryOpensAt: string,
  today = getLeagueToday(),
) {
  if (entryOpensAt === today) return "Entries open today";

  const date = formatRequiredLeagueSeasonDate(entryOpensAt);
  return entryOpensAt < today
    ? `Entries opened ${date}`
    : `Entries open ${date}`;
}

export function getLeagueEntrySummary(
  entryOpensAt: string | null,
  entryClosesAt: string | null,
  today = getLeagueToday(),
) {
  if (entryClosesAt) return getLeagueEntryCloseSummary(entryClosesAt, today);
  if (entryOpensAt) return getLeagueEntryOpenSummary(entryOpensAt, today);
  return null;
}

export function getLeagueEntryWindowState(
  entryOpensAt: string | null,
  entryClosesAt: string | null,
  today = getLeagueToday(),
) {
  if (entryClosesAt && entryClosesAt < today) return "Entries closed";
  if (entryClosesAt === today) return "Entries close today";
  if (entryOpensAt === today) return "Entries open today";

  if (entryOpensAt && entryOpensAt > today) {
    return `Entries open ${formatRequiredLeagueSeasonDate(entryOpensAt)}`;
  }

  if (entryClosesAt) {
    return `Entries close ${formatRequiredLeagueSeasonDate(entryClosesAt)}`;
  }

  if (entryOpensAt) {
    return getLeagueEntryOpenSummary(entryOpensAt, today);
  }

  return null;
}

export function getLeagueEntryWindowDateDisplay(
  entryOpensAt: string | null,
  entryClosesAt: string | null,
) {
  if (entryOpensAt && entryClosesAt) {
    return formatLeagueSeasonDateRange(entryOpensAt, entryClosesAt);
  }

  if (entryOpensAt) {
    return `Opens ${formatRequiredLeagueSeasonDate(entryOpensAt)}`;
  }

  if (entryClosesAt) {
    return `Closes ${formatRequiredLeagueSeasonDate(entryClosesAt)}`;
  }

  return null;
}

export function getLeagueSeasonDateDisplay(
  startsAt: string | null,
  endsAt: string | null,
) {
  if (startsAt && endsAt) {
    return formatLeagueSeasonDateRange(startsAt, endsAt);
  }

  if (startsAt) return `Starts ${formatRequiredLeagueSeasonDate(startsAt)}`;
  if (endsAt) return `Ends ${formatRequiredLeagueSeasonDate(endsAt)}`;
  return null;
}

export function getLeagueSeasonDateSummary(
  startsAt: string | null,
  endsAt: string | null,
) {
  if (startsAt && endsAt) {
    return `Season: ${formatLeagueSeasonDateRange(startsAt, endsAt)}`;
  }

  if (startsAt) return `Season starts ${formatRequiredLeagueSeasonDate(startsAt)}`;
  if (endsAt) return `Season ends ${formatRequiredLeagueSeasonDate(endsAt)}`;
  return null;
}
