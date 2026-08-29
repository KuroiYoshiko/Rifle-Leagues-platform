import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LeaveClubButton } from "@/components/leave-club-button";
import { MembershipRequestButton } from "@/components/membership-request-button";
import { Badge, Card, ProgressBar, SectionHeader } from "@/components/ui";
import {
  getClubLocation,
  getDashboardMembershipState,
  type ClubMembership,
} from "@/lib/clubs";
import {
  calculateProfileCompleteness,
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

function CompactProfileStatus({
  complete,
  percentage,
}: {
  complete: boolean;
  percentage: number;
}) {
  return (
    <div className="rounded-xl bg-surface-muted px-4 py-3 sm:min-w-44">
      <p className="text-[11px] font-medium text-muted-foreground">Profile</p>
      <p className="mt-1 text-sm font-semibold text-foreground">
        {complete ? "Complete" : `${percentage}% complete`}
      </p>
      {!complete ? (
        <Link
          href="/profile"
          className="mt-2 inline-flex text-xs font-semibold text-brand-strong hover:text-brand-deep hover:underline"
        >
          Complete profile →
        </Link>
      ) : null}
    </div>
  );
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;

  if (claimsError || !claims?.sub) {
    redirect("/login");
  }

  const [profileResult, membershipsResult] = await Promise.all([
    supabase
      .from("profiles")
      .select(profileColumns)
      .eq("id", claims.sub)
      .maybeSingle(),
    supabase
      .from("club_memberships")
      .select(`
        id,
        club_id,
        status,
        created_at,
        club:clubs (
          id,
          name,
          slug,
          town,
          county,
          postcode,
          website
        )
      `)
      .eq("user_id", claims.sub)
      // Historical "left" rows remain available on discovery for rejoining, but
      // they should not determine the dashboard's current membership state.
      .in("status", ["active", "pending", "rejected"])
      .order("created_at", { ascending: false }),
  ]);
  const { data, error } = profileResult;

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
  const membershipState = getDashboardMembershipState(
    membershipsResult.data as unknown as ClubMembership[] | null,
  );
  const metadataFirstName = metadataValue(claims.user_metadata, "first_name");
  const firstName = profile.first_name?.trim() || metadataFirstName || "there";
  const profileIsComplete = completeness.isComplete;
  const showProfileOnboarding =
    !profileIsComplete && membershipState.kind === "none";
  const welcomeCopy =
    membershipState.kind === "active"
      ? "Your club membership is active. Competition features will appear here when they are ready."
      : membershipState.kind === "pending"
        ? "Your club membership request is waiting for approval."
        : membershipState.kind === "rejected"
          ? "Your club membership request needs your attention."
          : profileIsComplete
            ? "Your profile is ready. Connecting with your club is the next step."
            : "Complete your profile and connect with your club when you are ready.";

  const steps = [
    { label: "Account created", complete: true },
    { label: "Complete your profile", complete: profileIsComplete },
    { label: "Find your club", complete: false },
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
          {welcomeCopy}
        </p>
      </div>

      {showProfileOnboarding ? (
        <section className="grid gap-4 xl:grid-cols-[1.3fr_.7fr]">
          <Card
            background="navigation"
            className="relative overflow-hidden border-0 p-6 text-white sm:p-8"
          >
            <div className="target-mark absolute -right-36 -top-36 aspect-square w-[31rem] opacity-20" />
            <div className="relative">
              <Badge tone="brand">Getting started</Badge>
              <h2 className="mt-5 text-2xl font-semibold tracking-[-0.04em] sm:text-3xl">
                Complete your profile
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-white/58">
                Add your remaining details to finish your profile. Club discovery
                remains available separately while you complete it.
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

              <Link
                href="/profile"
                className="mt-7 inline-flex min-h-11 items-center justify-center rounded-xl bg-brand px-5 text-sm font-semibold text-hero-background shadow-sm shadow-black/10 transition hover:bg-brand-subtle hover:text-brand-deep focus-visible:ring-4 focus-visible:ring-white/40"
              >
                Complete profile
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
              <p className="text-xs font-semibold text-foreground">Club discovery</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Finding your club is available now and does not require a complete
                profile.
              </p>
            </div>
          </Card>
        </section>
      ) : null}

      <section
        id="your-club"
        className={showProfileOnboarding ? "mt-10" : undefined}
      >
        <SectionHeader
          title="Your club"
          description="Your current RifleLeagues club membership state"
        />
        {membershipsResult.error ? (
          <Card className="border-danger/20 p-6 sm:p-8">
            <div role="alert">
              <h2 className="font-semibold text-foreground">Club membership unavailable</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Membership data could not be loaded. Run the supplied clubs and
                memberships SQL in Supabase, then refresh this page.
              </p>
            </div>
          </Card>
        ) : membershipState.kind === "pending" ? (
          <Card className="p-6 sm:p-8">
            <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-4">
                <span
                  className="grid size-11 shrink-0 place-items-center rounded-xl bg-warning-subtle text-sm font-bold text-warning"
                  aria-hidden="true"
                >
                  P
                </span>
                <div>
                  <Badge tone="warning">Membership pending</Badge>
                  <h2 className="mt-3 font-semibold text-foreground">
                    {membershipState.membership.club.name}
                  </h2>
                  {getClubLocation(membershipState.membership.club) ? (
                    <p className="mt-1 text-sm text-muted-foreground">
                      {getClubLocation(membershipState.membership.club)}
                    </p>
                  ) : null}
                  <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
                    Your request is waiting for club approval.
                  </p>
                </div>
              </div>
              <CompactProfileStatus
                complete={profileIsComplete}
                percentage={completeness.percentage}
              />
            </div>
          </Card>
        ) : membershipState.kind === "rejected" ? (
          <Card className="border-danger/20 p-6 sm:p-8">
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
              <div className="flex items-start gap-4">
                <span
                  className="grid size-11 shrink-0 place-items-center rounded-xl bg-danger-subtle text-sm font-bold text-danger"
                  aria-hidden="true"
                >
                  R
                </span>
                <div>
                  <span className="inline-flex rounded-full bg-danger-subtle px-2.5 py-1 text-[11px] font-semibold text-danger">
                    Membership request declined
                  </span>
                  <h2 className="mt-3 font-semibold text-foreground">
                    {membershipState.membership.club.name}
                  </h2>
                  {getClubLocation(membershipState.membership.club) ? (
                    <p className="mt-1 text-sm text-muted-foreground">
                      {getClubLocation(membershipState.membership.club)}
                    </p>
                  ) : null}
                  <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
                    This request was not approved. You can send the same membership
                    request again when you are ready.
                  </p>
                </div>
              </div>
              <MembershipRequestButton
                clubId={membershipState.membership.club_id}
                currentStatus="rejected"
                showDeclinedLabel={false}
              />
            </div>
            {!profileIsComplete ? (
              <div className="mt-6 border-t border-border pt-5">
                <CompactProfileStatus
                  complete={false}
                  percentage={completeness.percentage}
                />
              </div>
            ) : null}
          </Card>
        ) : membershipState.kind === "active" ? (
          <Card
            background="navigation"
            className="relative overflow-hidden border-0 p-6 text-white sm:p-8"
          >
            <div className="target-mark absolute -right-36 -top-36 aspect-square w-[31rem] opacity-15" />
            <div className="relative flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-4">
                <span
                  className="grid size-11 shrink-0 place-items-center rounded-xl bg-success-subtle text-sm font-bold text-success"
                  aria-hidden="true"
                >
                  C
                </span>
                <div>
                  <Badge tone="positive">Membership active</Badge>
                  <h2 className="mt-3 text-xl font-semibold text-white">
                    {membershipState.membership.club.name}
                  </h2>
                  {getClubLocation(membershipState.membership.club) ? (
                    <p className="mt-1 text-sm text-white/60">
                      {getClubLocation(membershipState.membership.club)}
                    </p>
                  ) : null}
                  <p className="mt-3 max-w-2xl text-sm leading-6 text-white/62">
                    Your club membership is active. Your dashboard is ready for real
                    competition features when they are introduced.
                  </p>
                </div>
              </div>
              <LeaveClubButton
                membershipId={membershipState.membership.id}
                clubName={membershipState.membership.club.name}
              />
            </div>
          </Card>
        ) : (
          <Card
            background={profileIsComplete ? "navigation" : "surface"}
            className={`p-6 sm:p-8 ${profileIsComplete ? "border-0 text-white" : ""}`}
          >
            <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-4">
                <span
                  className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand-subtle text-sm font-bold text-brand-deep"
                  aria-hidden="true"
                >
                  C
                </span>
                <div>
                  {profileIsComplete ? (
                    <Badge tone="positive">Profile complete</Badge>
                  ) : null}
                  <h2
                    className={`font-semibold ${
                      profileIsComplete ? "mt-3 text-xl text-white" : "text-foreground"
                    }`}
                  >
                    {profileIsComplete ? "Find your club" : "No club connected"}
                  </h2>
                  <p
                    className={`mt-1.5 max-w-2xl text-sm leading-6 ${
                      profileIsComplete ? "text-white/62" : "text-muted-foreground"
                    }`}
                  >
                    {profileIsComplete
                      ? "Your profile is ready. Search for your club and send a membership request."
                      : "You are not currently associated with a club. You can search now without waiting for profile completion."}
                  </p>
                </div>
              </div>
              <Link
                href="/clubs"
                className={`inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl px-5 text-sm font-semibold transition ${
                  profileIsComplete
                    ? "bg-brand text-hero-background hover:bg-brand-subtle hover:text-brand-deep"
                    : "bg-primary text-primary-foreground hover:bg-brand-deep"
                }`}
              >
                Find a club
              </Link>
            </div>
          </Card>
        )}
      </section>

      {membershipState.kind === "active" && !membershipsResult.error ? (
        <section id="competitions" className="mt-10">
          <SectionHeader
            title="Competitions"
            description="Competition activity connected to your club membership"
          />
          <Card className="p-6 sm:p-8">
            <div className="flex items-start gap-4">
              <span
                className="grid size-11 shrink-0 place-items-center rounded-xl bg-surface-muted text-sm font-bold text-neutral-strong"
                aria-hidden="true"
              >
                C
              </span>
              <div>
                <h2 className="font-semibold text-foreground">
                  No competition functionality yet
                </h2>
                <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted-foreground">
                  Entries, rounds, scores, standings and statistics will appear only
                  after those features are implemented and real data exists.
                </p>
              </div>
            </div>
          </Card>
        </section>
      ) : null}

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
