import type {
  Competition,
  CompetitionEntryFormat,
  CompetitionRankingMethod,
  CompetitionScoreComponent,
  CompetitionScoringMethod,
  CompetitionStatus,
} from "@/lib/competitions";
import type { LeagueSeasonStatus } from "@/lib/league-seasons";

export type CompetitionSeries = {
  id: number;
  organisation_id: number;
  name: string;
  slug: string;
  archived_at: string | null;
  entry_format: CompetitionEntryFormat;
  team_size: number;
  sets_per_round: number;
  shots_per_round: number | null;
  identity_locked_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CompetitionSeriesScoreComponent = {
  competition_series_id: number;
  position: number;
  short_label: string | null;
  maximum_score: number;
  score_method: CompetitionScoringMethod;
};

export type CompetitionSeriesSources = {
  series: Pick<CompetitionSeries, "id" | "name" | "slug" | "identity_locked_at">;
  cutoff: string;
  provisional_cutoff: boolean;
  recommended_source_id: number | null;
  selection_required: boolean;
  ambiguous_latest_date: boolean;
  sources: Array<{
    id: number;
    name: string;
    slug: string;
    status: CompetitionStatus;
    season_id: number;
    season_name: string;
    season_status: LeagueSeasonStatus;
    effective_starts_at: string | null;
    ranking_method: CompetitionRankingMethod;
    number_of_rounds: number;
    configuration_version: string;
  }>;
};

export type CompetitionSeriesCreationOption = {
  series: CompetitionSeries;
  targetEdition: Pick<Competition, "id" | "name" | "slug"> | null;
  components: CompetitionSeriesScoreComponent[];
  sourceInfo: CompetitionSeriesSources;
  sources: Array<{
    metadata: CompetitionSeriesSources["sources"][number];
    competition: Competition;
    components: CompetitionScoreComponent[];
  }>;
};

export type CompetitionSeriesManagementRow = CompetitionSeries & {
  edition_count: number;
};
