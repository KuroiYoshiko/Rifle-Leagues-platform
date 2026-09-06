import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export const getViewerId = cache(async () => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  return error ? null : (data?.claims?.sub ?? null);
});
