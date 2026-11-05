import "server-only";

import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

// React cache is scoped to the current server render, never shared across users.
export const getVerifiedRequestAuth = cache(async () => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  return { supabase, claims: data?.claims, error };
});

export const getNavigationProfile = cache(async () => {
  const { supabase, claims } = await getVerifiedRequestAuth();
  if (!claims?.sub) return { data: null, error: null };
  return supabase.from("profiles")
    .select("first_name, last_name")
    .eq("id", claims.sub)
    .maybeSingle();
});
