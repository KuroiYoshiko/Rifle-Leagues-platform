import { cache } from "react";
import type { PublishedCompetitionDivisions } from "@/lib/competition-division-types";
import type { Club } from "@/lib/clubs";
import type {
  Competition,
  CompetitionRound,
  CompetitionScoreComponent,
} from "@/lib/competitions";
import type { LeagueSeason } from "@/lib/league-seasons";
import type { Organisation } from "@/lib/organisations";
import { createClient } from "@/lib/supabase/server";

export type PublicOrganisation = Pick<
  Organisation,
  | "id"
  | "name"
  | "slug"
  | "short_name"
  | "description"
  | "about_content"
  | "status"
>;

export type PublicClub = Pick<
  Club,
  | "id"
  | "name"
  | "slug"
  | "town"
  | "county"
  | "postcode"
  | "website"
  | "about_content"
>;

export type PublicClubInformationCard = {
  id: number;
  title: string;
  content: string;
  position: number;
  updated_at: string;
};

export type PublicClubCompetition = {
  competition_id: number;
  competition_name: string;
  competition_slug: string;
  entry_format: "individual" | "pairs" | "team";
  team_size: number;
  ranking_method: Competition["ranking_method"];
  effective_starts_at: string | null;
  season_name: string;
  season_slug: string;
  season_status: LeagueSeason["status"];
  season_starts_at: string | null;
  season_ends_at: string | null;
  organisation_name: string;
  organisation_slug: string;
  has_released_results: boolean;
};

export type PublicClubResultsCatalog = {
  total_count?: number;
  clubs?: PublicClub[];
  club?: PublicClub;
  information_cards?: PublicClubInformationCard[];
  competitions?: PublicClubCompetition[];
};

export type PublicResultsCatalog = {
  total_count?: number;
  organisations?: PublicOrganisation[];
  organisation?: PublicOrganisation;
  seasons?: LeagueSeason[];
  season?: LeagueSeason;
  competitions?: Competition[];
  competition?: Competition;
  rounds?: CompetitionRound[];
  score_components?: CompetitionScoreComponent[];
  published_divisions?: PublishedCompetitionDivisions | null;
};

type PublicResultsCatalogProjection = Omit<
  PublicResultsCatalog,
  "competitions" | "competition" | "published_divisions"
> & {
  competitions?: Array<Omit<Competition, "local_scoring_enabled">>;
  competition?: Omit<Competition, "local_scoring_enabled">;
  published_divisions?: {
    status: "published";
    divisions: Array<{
      id: number;
      name: string;
      position: number;
      entrants: Array<{
        id: number;
        club_name: string;
        participants: Array<{
          first_name: string | null;
          last_name: string | null;
          slot_number: number;
        }>;
      }>;
    }>;
  } | null;
};

type PublicResultsCatalogInput = {
  organisationSlug?: string;
  seasonSlug?: string;
  competitionSlug?: string;
  query?: string;
  offset?: number;
  limit?: number;
};

export const getPublicResultsCatalog = cache(
  async ({
    organisationSlug,
    seasonSlug,
    competitionSlug,
    query,
    offset = 0,
    limit = 10,
  }: PublicResultsCatalogInput): Promise<PublicResultsCatalog | null> => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("get_public_results_catalog", {
      p_organisation_slug: organisationSlug ?? null,
      p_season_slug: seasonSlug ?? null,
      p_competition_slug: competitionSlug ?? null,
      p_query: query?.trim() || null,
      p_offset: offset,
      p_limit: limit,
    });

    if (error) {
      throw new Error("Public results could not be loaded.");
    }

    if (!data || typeof data !== "object" || Array.isArray(data)) return null;

    const projection = data as PublicResultsCatalogProjection;
    return {
      ...projection,
      competitions: projection.competitions?.map((competition) => ({
        ...competition,
        local_scoring_enabled: false,
      })),
      competition: projection.competition
        ? { ...projection.competition, local_scoring_enabled: false }
        : undefined,
      published_divisions: projection.published_divisions
        ? {
            ...projection.published_divisions,
            divisions: projection.published_divisions.divisions.map(
              (division) => ({
                ...division,
                entrants: division.entrants.map((entrant) => ({
                  ...entrant,
                  is_current_user: false,
                })),
              }),
            ),
          }
        : null,
    };
  },
);

type PublicClubResultsCatalogInput = {
  clubSlug?: string;
  query?: string;
  offset?: number;
  limit?: number;
};

export const getPublicClubResultsCatalog = cache(
  async ({
    clubSlug,
    query,
    offset = 0,
    limit = 10,
  }: PublicClubResultsCatalogInput): Promise<PublicClubResultsCatalog | null> => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc(
      "get_public_club_results_catalog",
      {
        p_club_slug: clubSlug ?? null,
        p_query: query?.trim() || null,
        p_offset: offset,
        p_limit: limit,
      },
    );

    if (error) {
      throw new Error("Public club results could not be loaded.");
    }

    return data && typeof data === "object" && !Array.isArray(data)
      ? (data as PublicClubResultsCatalog)
      : null;
  },
);
