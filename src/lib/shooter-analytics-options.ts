export type EquipmentOption = {
  kind: "builtin" | "custom" | "unspecified";
  code: string | null;
  custom_id: number | null;
  label: string;
};

export type PositionOption = {
  mode: "fixed" | "variable" | "not_applicable" | "unspecified";
  code: string | null;
  custom_id: number | null;
  label: string;
};

export type DistanceOption = {
  mode: "fixed" | "variable" | "not_applicable" | "unspecified";
  value: number | null;
  unit: "metres" | "yards" | "feet" | null;
  label: string;
};

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
