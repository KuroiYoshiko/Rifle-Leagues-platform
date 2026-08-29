import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Card } from "@/components/ui";
import { profileToFormValues, type Profile } from "@/lib/profiles";
import { createClient } from "@/lib/supabase/server";
import { ProfileForm } from "./profile-form";

export const metadata: Metadata = {
  title: "Your profile",
};

const profileColumns =
  "id, first_name, last_name, title, address, town, county, postcode, phone_number, created_at, updated_at";

export default async function ProfilePage() {
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;

  if (claimsError || !claims?.sub) {
    redirect("/login");
  }

  const { data, error } = await supabase
    .from("profiles")
    .select(profileColumns)
    .eq("id", claims.sub)
    .maybeSingle();

  const email = typeof claims.email === "string" ? claims.email : "";

  if (error || !data) {
    return (
      <div className="mx-auto max-w-3xl">
        <h1 className="text-3xl font-semibold tracking-[-0.045em] text-foreground sm:text-4xl">
          Your profile
        </h1>
        <Card className="mt-7 border-danger/20 p-6 sm:p-8">
          <div role="alert" className="flex items-start gap-4">
            <span
              className="grid size-10 shrink-0 place-items-center rounded-full bg-danger-subtle font-semibold text-danger"
              aria-hidden="true"
            >
              !
            </span>
            <div>
              <h2 className="font-semibold text-foreground">Profile unavailable</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                We could not load your profile. If profiles were just added to this
                project, run the supplied database SQL and then refresh this page.
              </p>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  const profile = data as Profile;

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-8">
        <p className="text-xs font-medium text-brand-strong">Account details</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.045em] text-foreground sm:text-4xl">
          Your profile
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          Keep your personal and contact information up to date. Private details
          are visible only to you in this version of RifleLeagues.
        </p>
      </div>

      <Card className="p-5 sm:p-7 lg:p-9">
        <ProfileForm
          initialValues={profileToFormValues(profile)}
          email={email}
        />
      </Card>
    </div>
  );
}
