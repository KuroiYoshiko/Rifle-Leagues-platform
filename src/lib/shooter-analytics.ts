import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export type ShooterAnalyticsTrendDirection =
  | "up"
  | "down"
  | "steady"
  | "unavailable";

export type ShooterAnalyticsComponent = {
  label: string;
  score_method: "points_scored" | "points_dropped";
  position_mode: "fixed" | "variable" | "not_applicable" | "unspecified";
  position_label: string;
  distance_mode: "fixed" | "variable" | "not_applicable" | "unspecified";
  distance_value: number | null;
  distance_unit: "metres" | "yards" | "feet" | null;
};

export type ShooterAnalyticsContext = {
  competition: string;
  round: string;
  round_end_date: string;
  season: string;
  organisation: string;
  series: string | null;
};

export type ShooterAnalyticsPoint = {
  event_key: string;
  round_end_date: string;
  competition_name: string;
  round_label: string;
  season_name: string;
  organisation_name: string;
  series_name: string | null;
  equipment_label: string;
  component_scope: "all_components" | "filtered_components";
  achieved_score: number;
  maximum_possible_score: number;
  score_percentage: number;
  x_total: number | null;
  components: ShooterAnalyticsComponent[];
  contexts: ShooterAnalyticsContext[];
  shared: boolean;
};

type EquipmentOption = {
  kind: "builtin" | "custom" | "unspecified";
  code: string | null;
  custom_id: number | null;
  label: string;
};

type PositionOption = {
  mode: "fixed" | "variable" | "not_applicable" | "unspecified";
  code: string | null;
  custom_id: number | null;
  label: string;
};

type DistanceOption = {
  mode: "fixed" | "variable" | "not_applicable" | "unspecified";
  value: number | null;
  unit: "metres" | "yards" | "feet" | null;
  label: string;
};

export type ShooterAnalytics = {
  summary: {
    physical_shoot_count: number;
    competition_count: number;
    best_score_percentage: number | null;
    recent_score_percentage: number | null;
    mean_score_percentage: number | null;
    trend_direction: ShooterAnalyticsTrendDirection;
    trend_change: number | null;
  };
  component_scope: "all_components" | "filtered_components";
  chart_truncated: boolean;
  chart_points: ShooterAnalyticsPoint[];
  recent_scores: ShooterAnalyticsPoint[];
  filter_options: {
    seasons: Array<{ id: number; label: string }>;
    equipment: EquipmentOption[];
    positions: PositionOption[];
    distances: DistanceOption[];
  };
};

export type ShooterAnalyticsFilterSelection = {
  season: string;
  equipment: string;
  position: string;
  distance: string;
};

export type ShooterAnalyticsRpcFilters = {
  p_season_id: number | null;
  p_equipment_kind: EquipmentOption["kind"] | null;
  p_equipment_code: string | null;
  p_equipment_custom_id: number | null;
  p_position_mode: PositionOption["mode"] | null;
  p_position_code: string | null;
  p_position_custom_id: number | null;
  p_distance_mode: DistanceOption["mode"] | null;
  p_distance_value: number | null;
  p_distance_unit: DistanceOption["unit"];
};

const codePattern = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;
const positiveIntegerPattern = /^[1-9][0-9]*$/;
const fixedDistancePattern = /^fixed:([0-9]+(?:\.[0-9]{1,3})?):(metres|yards|feet)$/;

function positiveInteger(value: string | undefined) {
  if (!value || !positiveIntegerPattern.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function parseEquipment(value: string | undefined) {
  if (!value) return { kind: null, code: null, customId: null, value: "" } as const;
  if (value === "unspecified") {
    return { kind: "unspecified", code: null, customId: null, value } as const;
  }
  if (value.startsWith("builtin:")) {
    const code = value.slice("builtin:".length);
    if (codePattern.test(code)) {
      return { kind: "builtin", code, customId: null, value } as const;
    }
  }
  if (value.startsWith("custom:")) {
    const customId = positiveInteger(value.slice("custom:".length));
    if (customId) {
      return { kind: "custom", code: null, customId, value } as const;
    }
  }
  return { kind: null, code: null, customId: null, value: "" } as const;
}

function parsePosition(value: string | undefined) {
  if (!value) return { mode: null, code: null, customId: null, value: "" } as const;
  if (["variable", "not_applicable", "unspecified"].includes(value)) {
    return {
      mode: value as "variable" | "not_applicable" | "unspecified",
      code: null,
      customId: null,
      value,
    } as const;
  }
  if (value.startsWith("fixed:builtin:")) {
    const code = value.slice("fixed:builtin:".length);
    if (codePattern.test(code)) {
      return { mode: "fixed", code, customId: null, value } as const;
    }
  }
  if (value.startsWith("fixed:custom:")) {
    const customId = positiveInteger(value.slice("fixed:custom:".length));
    if (customId) {
      return { mode: "fixed", code: null, customId, value } as const;
    }
  }
  return { mode: null, code: null, customId: null, value: "" } as const;
}

function parseDistance(value: string | undefined) {
  if (!value) return { mode: null, valueNumber: null, unit: null, value: "" } as const;
  if (["variable", "not_applicable", "unspecified"].includes(value)) {
    return {
      mode: value as "variable" | "not_applicable" | "unspecified",
      valueNumber: null,
      unit: null,
      value,
    } as const;
  }
  const fixed = fixedDistancePattern.exec(value);
  if (fixed) {
    const valueNumber = Number(fixed[1]);
    if (Number.isFinite(valueNumber) && valueNumber > 0) {
      return {
        mode: "fixed",
        valueNumber,
        unit: fixed[2] as "metres" | "yards" | "feet",
        value,
      } as const;
    }
  }
  return { mode: null, valueNumber: null, unit: null, value: "" } as const;
}

export function parseShooterAnalyticsFilters(input: {
  season?: string;
  equipment?: string;
  position?: string;
  distance?: string;
}) {
  const seasonId = positiveInteger(input.season);
  const equipment = parseEquipment(input.equipment);
  const position = parsePosition(input.position);
  const distance = parseDistance(input.distance);

  return {
    selection: {
      season: seasonId ? String(seasonId) : "",
      equipment: equipment.value,
      position: position.value,
      distance: distance.value,
    } satisfies ShooterAnalyticsFilterSelection,
    rpc: {
      p_season_id: seasonId,
      p_equipment_kind: equipment.kind,
      p_equipment_code: equipment.code,
      p_equipment_custom_id: equipment.customId,
      p_position_mode: position.mode,
      p_position_code: position.code,
      p_position_custom_id: position.customId,
      p_distance_mode: distance.mode,
      p_distance_value: distance.valueNumber,
      p_distance_unit: distance.unit,
    } satisfies ShooterAnalyticsRpcFilters,
  };
}

export function equipmentOptionValue(option: EquipmentOption) {
  if (option.kind === "builtin" && option.code) return `builtin:${option.code}`;
  if (option.kind === "custom" && option.custom_id) return `custom:${option.custom_id}`;
  return "unspecified";
}

export function positionOptionValue(option: PositionOption) {
  if (option.mode === "fixed" && option.code) return `fixed:builtin:${option.code}`;
  if (option.mode === "fixed" && option.custom_id) return `fixed:custom:${option.custom_id}`;
  return option.mode;
}

export function distanceOptionValue(option: DistanceOption) {
  if (option.mode === "fixed" && option.value && option.unit) {
    return `fixed:${option.value}:${option.unit}`;
  }
  return option.mode;
}

export const getMyShooterAnalytics = cache(
  async (filters: ShooterAnalyticsRpcFilters) => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("get_my_shooter_analytics", filters);

    if (error || !data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("Shooter analytics could not be loaded.");
    }

    return data as ShooterAnalytics;
  },
);
