import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export const ORGANISATION_STATUSES = ["active", "inactive"] as const;

export type OrganisationStatus = (typeof ORGANISATION_STATUSES)[number];

export type Organisation = {
  id: number;
  name: string;
  slug: string;
  short_name: string | null;
  description: string | null;
  website: string | null;
  contact_email: string | null;
  status: OrganisationStatus;
  created_at: string;
  updated_at: string;
};

export type SidebarOrganisation = Pick<Organisation, "id" | "name" | "slug">;

export const organisationColumns =
  "id, name, slug, short_name, description, website, contact_email, status, created_at, updated_at";

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
