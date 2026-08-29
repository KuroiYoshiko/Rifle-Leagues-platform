import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Card, ProgressBar, SectionHeader } from "@/components/ui";
import {
  calculateProfileCompleteness,
  getDashboardOnboardingState,
  type Profile,
} from "@/lib/profiles";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Dashboard",
};

const profileColumns =
  "id, first_name, last_name, title, address, town, county, postcode, phone_number, created_at, updated_at";

function metadataValue(metadata: unknown, key: string) {
  if (!metadata || typeof metadata !== "object") return undefined;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export default async function DashboardPage() {
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

  if (error || !data) {
    return (
      <div className="mx-auto max-w-3xl">
        <h1 className="text-3xl font-semibold tracking-[-0.045em] text-foreground sm:text-4xl">
          Welcome to RifleLeagues
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
              <h2 className="font-semibold text-foreground">Profile setup required</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Your account is signed in, but its application profile could not be
                loaded. Run the supplied profile database SQL, then refresh this page.
              </p>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  const profile = data as Profile;
  const completeness = calculateProfileCompleteness(profile);
  const onboardingState = getDashboardOnboardingState(profile);
  const metadataFirstName = metadataValue(claims.user_metadata, "first_name");
  const firstName = profile.first_name?.trim() || metadataFirstName || "there";
  const profileIsComplete = onboardingState === "profile-complete-no-club";

  const steps = [
    { label: "Account created", complete: true },
    { label: "Complete your profile", complete: profileIsComplete },
    { label: "Join a club", complete: false },
  ];

  return (
    <div>
      <div className="mb-8">
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <span className="size-1.5 rounded-full bg-success" />
          Account ready
        </div>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.045em] text-foreground sm:text-4xl">
          Welcome, {firstName}
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Your dashboard will grow with you as you join a club and start competing.
        </p>
      </div>

      <section className="grid gap-4 xl:grid-cols-[1.3fr_.7fr]">
        <Card
          background="navigation"
          className="relative overflow-hidden border-0 p-6 text-white sm:p-8"
        >
          <div className="target-mark absolute -right-36 -top-36 aspect-square w-[31rem] opacity-20" />
          <div className="relative">
            <Badge tone="brand">
              {profileIsComplete ? "Profile complete" : "Getting started"}
            </Badge>
            <h2 className="mt-5 text-2xl font-semibold tracking-[-0.04em] sm:text-3xl">
              Get ready to compete
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/58">
              {profileIsComplete
                ? "Your profile is ready. Club discovery and membership will be added in the next feature."
                : "Complete your personal details now. Club discovery and competition entry will follow in later features."}
            </p>

            <div className="mt-8 rounded-2xl border border-white/12 bg-white/[.07] p-5 backdrop-blur-sm">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="text-xs font-medium text-white/55">Profile</p>
                  <p className="mt-1 text-xl font-semibold">
                    {completeness.percentage}% complete
                  </p>
                </div>
                <span className="font-mono text-xs text-white/52">
                  {completeness.completedFields} of {completeness.totalFields} fields
                </span>
              </div>
              <div className="mt-4">
                <ProgressBar value={completeness.percentage} light />
              </div>
            </div>

            {!profileIsComplete ? (
              <div className="mt-5">
                <p className="text-xs font-semibold text-white/70">Missing</p>
                <ul className="mt-2 flex flex-wrap gap-2" aria-label="Missing profile fields">
                  {completeness.missingFields.map((field) => (
                    <li
                      key={field}
                      className="rounded-full border border-white/12 bg-white/[.06] px-3 py-1.5 text-xs text-white/62"
                    >
                      {field}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <Link
              href="/profile"
              className="mt-7 inline-flex min-h-11 items-center justify-center rounded-xl bg-brand px-5 text-sm font-semibold text-hero-background shadow-sm shadow-black/10 transition hover:bg-brand-subtle hover:text-brand-deep focus-visible:ring-4 focus-visible:ring-white/40"
            >
              {profileIsComplete ? "Review profile" : "Complete profile"}
              <span className="ml-2" aria-hidden="true">→</span>
            </Link>
          </div>
        </Card>

        <Card className="p-6 sm:p-7">
          <p className="text-xs font-medium text-muted-foreground">Your progress</p>
          <ol className="mt-5 space-y-5">
            {steps.map((step) => (
              <li key={step.label} className="flex items-center gap-3">
                <span
                  className={`grid size-8 shrink-0 place-items-center rounded-full text-xs font-bold ${
                    step.complete
                      ? "bg-success-subtle text-success"
                      : "border border-border bg-background text-muted-foreground"
                  }`}
                  aria-hidden="true"
                >
                  {step.complete ? "✓" : "·"}
                </span>
                <span
                  className={`text-sm ${
                    step.complete
                      ? "font-semibold text-foreground"
                      : "text-muted-foreground"
                  }`}
                >
                  {step.label}
                  <span className="sr-only">
                    {step.complete ? " complete" : " not complete"}
                  </span>
                </span>
              </li>
            ))}
          </ol>
          <div className="mt-7 rounded-xl bg-surface-muted p-4">
            <p className="text-xs font-semibold text-foreground">Competition data</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Leagues, rounds, scores and statistics will appear here only after
              real entries exist.
            </p>
          </div>
        </Card>
      </section>

      <section id="your-club" className="mt-10">
        <SectionHeader
          title="Your club"
          description="Club membership will connect you to competitions and results"
        />
        <Card className="p-6 sm:p-8">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-4">
              <span
                className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand-subtle text-sm font-bold text-brand-deep"
                aria-hidden="true"
              >
                C
              </span>
              <div>
                <h2 className="font-semibold text-foreground">No club connected</h2>
                <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted-foreground">
                  You are not currently associated with a club. Club discovery and
                  membership requests are intentionally not part of this feature.
                </p>
              </div>
            </div>
            <div className="shrink-0">
              <button
                type="button"
                disabled
                aria-describedby="find-club-help"
                className="inline-flex min-h-11 w-full cursor-not-allowed items-center justify-center rounded-xl border border-border bg-surface-muted px-5 text-sm font-semibold text-muted-foreground opacity-75 sm:w-auto"
              >
                Find a club
              </button>
              <p id="find-club-help" className="mt-2 text-center text-[11px] text-muted-foreground">
                Coming in the next feature
              </p>
            </div>
          </div>
        </Card>
      </section>

      <section id="settings" className="mt-10">
        <SectionHeader title="Account" description="Manage the details linked to your account" />
        <Card className="flex flex-col gap-5 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-7">
          <div>
            <h2 className="font-semibold text-foreground">Profile and settings</h2>
            <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
              Update your personal, postal and contact information from your profile.
            </p>
          </div>
          <Link
            href="/profile"
            className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl border border-border bg-surface px-5 text-sm font-semibold text-brand-deep transition hover:bg-brand-subtle"
          >
            Open profile
          </Link>
        </Card>
      </section>
    </div>
  );
}
