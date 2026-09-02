import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export const ORGANISATION_STATUSES = ["active", "inactive"] as const;
export const ORGANISATION_TYPES = [
  "county_association",
  "regional_association",
  "business",
  "other",
] as const;
export const ORGANISATION_STAFF_ROLES = ["owner", "manager"] as const;
export const ORGANISATION_STAFF_STATUSES = [
  "pending",
  "active",
  "rejected",
  "revoked",
] as const;

export type OrganisationStatus = (typeof ORGANISATION_STATUSES)[number];
export type OrganisationType = (typeof ORGANISATION_TYPES)[number];
export type OrganisationStaffRole =
  (typeof ORGANISATION_STAFF_ROLES)[number];
export type OrganisationStaffStatus =
  (typeof ORGANISATION_STAFF_STATUSES)[number];

export type Organisation = {
  id: number;
  name: string;
  slug: string;
  short_name: string | null;
  description: string | null;
  website: string | null;
  contact_email: string | null;
  organisation_type: OrganisationType;
  address: string | null;
  postcode: string | null;
  telephone: string | null;
  status: OrganisationStatus;
  created_at: string;
  updated_at: string;
};

export type SidebarOrganisation = Pick<Organisation, "id" | "name" | "slug"> & {
  managementRole: OrganisationStaffRole | null;
};

export type OrganisationStaffAccess = {
  id: number;
  organisation_id: number;
  role: OrganisationStaffRole;
  status: OrganisationStaffStatus;
  created_at: string;
  updated_at: string;
};

export type ManagedOrganisationStaff = {
  staff_id: number;
  first_name: string | null;
  last_name: string | null;
  staff_role: OrganisationStaffRole;
  staff_status: OrganisationStaffStatus;
  created_at: string;
  updated_at: string;
};

export type OrganisationInformationCard = {
  id: number;
  organisation_id: number;
  title: string;
  content: string;
  position: number;
  created_at: string;
  updated_at: string;
};

const organisationTypeLabels: Record<OrganisationType, string> = {
  county_association: "County Association",
  regional_association: "Regional Association",
  business: "Business",
  other: "Other",
};

export const organisationColumns =
  "id, name, slug, short_name, description, website, contact_email, organisation_type, address, postcode, telephone, status, created_at, updated_at";

const routeSafeSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const getActiveOrganisationBySlug = cache(async (slug: string) => {
  if (slug.length > 180 || !routeSafeSlugPattern.test(slug)) {
    return null;
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organisations")
    .select(organisationColumns)
    .eq("slug", slug)
    .eq("status", "active")
    .maybeSingle();

  if (error) {
    throw new Error("The organisation could not be loaded.");
  }

  return data as Organisation | null;
});

export const getOrganisationManagementContextBySlug = cache(
  async (slug: string) => {
    const organisation = await getActiveOrganisationBySlug(slug);

    if (!organisation) return null;

    const supabase = await createClient();
    const { data: claimsData, error: claimsError } =
      await supabase.auth.getClaims();
    const userId = claimsData?.claims?.sub;

    if (claimsError || !userId) return null;

    const { data, error } = await supabase
      .from("organisation_staff")
      .select(
        "id, organisation_id, role, status, created_at, updated_at",
      )
      .eq("organisation_id", organisation.id)
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle();

    if (error) {
      throw new Error("Organisation management access could not be verified.");
    }

    if (!data || (data.role !== "manager" && data.role !== "owner")) {
      return null;
    }

    return {
      organisation,
      access: data as OrganisationStaffAccess,
    };
  },
);

export const getOrganisationInformationCards = cache(
  async (organisationId: number) => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("organisation_information_cards")
      .select(
        "id, organisation_id, title, content, position, created_at, updated_at",
      )
      .eq("organisation_id", organisationId)
      .order("position", { ascending: true })
      .order("id", { ascending: true });

    if (error) {
      throw new Error("Organisation information could not be loaded.");
    }

    return (data ?? []) as OrganisationInformationCard[];
  },
);

export function getOrganisationStaffName(staff: ManagedOrganisationStaff) {
  return (
    [staff.first_name?.trim(), staff.last_name?.trim()]
      .filter(Boolean)
      .join(" ") || "Organisation staff member"
  );
}

export function getOrganisationTypeLabel(type: OrganisationType) {
  return organisationTypeLabels[type];
}
