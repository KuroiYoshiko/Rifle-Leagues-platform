export const PROFILE_TITLES = [
  "Mr",
  "Mrs",
  "Ms",
  "Miss",
  "Dr",
  "Other",
  "Prefer not to say",
] as const;

export type ProfileTitle = (typeof PROFILE_TITLES)[number];

export type Profile = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  title: ProfileTitle | null;
  address: string | null;
  town: string | null;
  county: string | null;
  postcode: string | null;
  phone_number: string | null;
  created_at: string;
  updated_at: string;
};

export type EditableProfile = Pick<
  Profile,
  | "first_name"
  | "last_name"
  | "title"
  | "address"
  | "town"
  | "county"
  | "postcode"
  | "phone_number"
>;

export type ProfileFormValues = Record<keyof EditableProfile, string>;

const completenessFields: ReadonlyArray<{
  key: keyof EditableProfile;
  label: string;
}> = [
  { key: "first_name", label: "first name" },
  { key: "last_name", label: "last name" },
  { key: "title", label: "title" },
  { key: "address", label: "postal address" },
  { key: "town", label: "town" },
  { key: "county", label: "county" },
  { key: "postcode", label: "postcode" },
  { key: "phone_number", label: "phone number" },
];

function hasValue(value: string | null | undefined) {
  return typeof value === "string" && value.trim().length > 0;
}

export function calculateProfileCompleteness(
  profile: Partial<EditableProfile> | null | undefined,
) {
  const missingFields = completenessFields
    .filter(({ key }) => !hasValue(profile?.[key]))
    .map(({ label }) => label);
  const completedFields = completenessFields.length - missingFields.length;
  const percentage = Math.round(
    (completedFields / completenessFields.length) * 100,
  );

  return {
    percentage,
    completedFields,
    totalFields: completenessFields.length,
    missingFields,
    isComplete: missingFields.length === 0,
  };
}

export function profileToFormValues(profile: EditableProfile): ProfileFormValues {
  return {
    first_name: profile.first_name ?? "",
    last_name: profile.last_name ?? "",
    title: profile.title ?? "",
    address: profile.address ?? "",
    town: profile.town ?? "",
    county: profile.county ?? "",
    postcode: profile.postcode ?? "",
    phone_number: profile.phone_number ?? "",
  };
}

export function getProfileDisplayName(
  profile: Pick<Profile, "first_name" | "last_name"> | null | undefined,
  fallback: string,
) {
  return (
    [profile?.first_name, profile?.last_name]
      .filter(hasValue)
      .map((name) => name!.trim())
      .join(" ") || fallback
  );
}

export type DashboardOnboardingState =
  | "profile-incomplete"
  | "profile-complete-no-club";

export function getDashboardOnboardingState(
  profile: Partial<EditableProfile> | null | undefined,
): DashboardOnboardingState {
  return calculateProfileCompleteness(profile).isComplete
    ? "profile-complete-no-club"
    : "profile-incomplete";
}
