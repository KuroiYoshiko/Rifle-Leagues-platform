export type AveragePolicyStrategy = "manual" | "current_then_preceding";

export type AverageContext = {
  id: number;
  organisation_id: number;
  name: string;
  basis_maximum: number;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AveragePolicyVersion = {
  id: number;
  average_policy_id: number;
  version_number: number;
  strategy: AveragePolicyStrategy;
  configuration: {
    minimum_current_scores?: number;
    minimum_preceding_scores?: number;
    fallback?: "manual";
  };
  created_at: string;
};

export type AveragePolicy = {
  id: number;
  organisation_id: number;
  name: string;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  versions: AveragePolicyVersion[];
  latestVersion: AveragePolicyVersion;
};

export type AverageConfiguration = {
  contexts: AverageContext[];
  policies: AveragePolicy[];
};

export type SeriesAverageDefault = {
  competition_series_id: number;
  average_context_id: number;
  average_policy_version_id: number;
  context: AverageContext | null;
  policy: AveragePolicy | null;
  policyVersion: AveragePolicyVersion | null;
};

export type AverageSeriesManagementRow = {
  id: number;
  name: string;
  archived_at: string | null;
  shooterMaximum: number | null;
  averageDefault: SeriesAverageDefault | null;
};

export type CompetitionAverageSetting = {
  competition_id: number;
  average_context_id: number;
  average_policy_version_id: number;
  contributes_to_history: boolean;
  context: AverageContext | null;
  policy: AveragePolicy | null;
  policyVersion: AveragePolicyVersion | null;
};

export type StartingAverageParticipant = {
  competitionEntrantParticipantId: number;
  competitionEntrantId: number;
  slotNumber: number;
  shooterProfileId: string;
  firstName: string | null;
  lastName: string | null;
  startingAverage: number | null;
  origin: "calculated" | "manual" | null;
  status: "provisional" | "frozen" | null;
  qualifyingScoreCount: number;
  sourceCompetitionId: number | null;
  sourceCompetitionName: string | null;
  manualReason: string | null;
};

export type CompetitionAverageManagement = {
  setting: CompetitionAverageSetting | null;
  participants: StartingAverageParticipant[];
  hasFrozenStartingAverages: boolean;
  finalisedAt: string | null;
  divisionStatus: "draft" | "published" | null;
};

export function getAveragePolicyStrategyLabel(strategy: AveragePolicyStrategy) {
  return strategy === "manual" ? "Manual" : "Current then preceding";
}

export function formatAverageMaximum(value: number) {
  return `Ex${value.toLocaleString("en-GB", { maximumFractionDigits: 2 })}`;
}
