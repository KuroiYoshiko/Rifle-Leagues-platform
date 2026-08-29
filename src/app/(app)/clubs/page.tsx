import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { MembershipRequestButton } from "@/components/membership-request-button";
import { Card } from "@/components/ui";
import {
  getClubLocation,
  type Club,
  type MembershipStatus,
} from "@/lib/clubs";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Find a club",
};

const clubColumns = "id, name, slug, town, county, postcode, website";
const resultLimit = 30;

function readSearchTerm(value: string | string[] | undefined) {
  const rawValue = Array.isArray(value) ? value[0] : value;
  return rawValue?.trim().slice(0, 100) ?? "";
}

export default async function ClubsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const { q } = await searchParams;
  const searchTerm = readSearchTerm(q);
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;

  if (claimsError || !userId) {
    redirect("/login");
  }

  let clubsQuery = supabase
    .from("clubs")
    .select(clubColumns)
    .eq("status", "active")
    .order("name")
    .limit(resultLimit);

  if (searchTerm) {
    clubsQuery = clubsQuery.textSearch("search_document", searchTerm, {
      config: "simple",
      type: "websearch",
    });
  }

  const [clubsResult, membershipsResult] = await Promise.all([
    clubsQuery,
    supabase
      .from("club_memberships")
      .select("club_id, status")
      .eq("user_id", userId),
  ]);

  const clubs = (clubsResult.data ?? []) as Club[];
  const membershipByClub = new Map<number, MembershipStatus>(
    (membershipsResult.data ?? []).map((membership) => [
      membership.club_id as number,
      membership.status as MembershipStatus,
    ]),
  );

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-8">
        <p className="text-xs font-medium text-brand-strong">Club discovery</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.045em] text-foreground sm:text-4xl">
          Find your club
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          Search by club name, town, county or postcode, then send a membership
          request to the club you already shoot with.
        </p>
      </div>

      <Card className="p-5 sm:p-7">
        <form action="/clubs" method="get" role="search">
          <label htmlFor="club-search" className="text-sm font-semibold text-foreground">
            Search clubs
          </label>
          <div className="mt-2 flex flex-col gap-3 sm:flex-row">
            <input
              id="club-search"
              name="q"
              type="search"
              defaultValue={searchTerm}
              maxLength={100}
              placeholder="Club name, town, county or postcode"
              className="min-h-12 min-w-0 flex-1 rounded-xl border border-border bg-surface px-4 text-sm text-foreground outline-none transition placeholder:text-muted-foreground/70 focus:border-brand focus:ring-4 focus:ring-brand/10"
            />
            <button
              type="submit"
              className="min-h-12 rounded-xl bg-primary px-6 text-sm font-semibold text-primary-foreground transition hover:bg-brand-deep"
            >
              Search
            </button>
            {searchTerm ? (
              <Link
                href="/clubs"
                className="inline-flex min-h-12 items-center justify-center rounded-xl border border-border bg-surface px-5 text-sm font-semibold text-brand-deep transition hover:bg-brand-subtle"
              >
                Clear
              </Link>
            ) : null}
          </div>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            Results are limited to {resultLimit}. Refine your search if your club is
            not shown.
          </p>
        </form>
      </Card>

      {clubsResult.error ? (
        <Card className="mt-6 border-danger/20 p-6">
          <div role="alert">
            <h2 className="font-semibold text-foreground">Club discovery unavailable</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              The club database could not be loaded. Run the supplied clubs and
              memberships SQL in Supabase, then refresh this page.
            </p>
          </div>
        </Card>
      ) : (
        <section className="mt-8" aria-labelledby="club-results-heading">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="club-results-heading" className="text-lg font-semibold text-foreground">
                {searchTerm ? "Search results" : "Active clubs"}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {clubs.length === 0
                  ? searchTerm
                    ? `No active clubs matched “${searchTerm}”.`
                    : "No active clubs have been added yet."
                  : `${clubs.length} club${clubs.length === 1 ? "" : "s"} shown`}
              </p>
            </div>
          </div>

          {membershipsResult.error ? (
            <p className="mb-4 rounded-xl border border-danger/20 bg-danger-subtle px-4 py-3 text-sm text-danger" role="alert">
              Your current membership status could not be loaded. Refresh before
              sending a request.
            </p>
          ) : null}

          <div className="space-y-3">
            {clubs.map((club) => {
              const location = getClubLocation(club);

              return (
                <Card key={club.id} className="p-5 sm:p-6">
                  <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                    <div className="min-w-0">
                      <h3 className="text-base font-semibold tracking-[-0.02em] text-foreground">
                        {club.name}
                      </h3>
                      <p className="mt-1.5 text-sm text-muted-foreground">
                        {location ?? club.postcode ?? "Location not yet provided"}
                      </p>
                      {club.postcode && location ? (
                        <p className="mt-1 text-xs text-muted-foreground">{club.postcode}</p>
                      ) : null}
                      {club.website ? (
                        <a
                          href={club.website}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-3 inline-flex text-xs font-semibold text-brand-strong hover:text-brand-deep hover:underline"
                        >
                          Visit club website
                          <span className="ml-1" aria-hidden="true">↗</span>
                        </a>
                      ) : null}
                    </div>
                    <MembershipRequestButton
                      clubId={club.id}
                      currentStatus={membershipByClub.get(club.id)}
                      statusUnavailable={Boolean(membershipsResult.error)}
                    />
                  </div>
                </Card>
              );
            })}
          </div>
        </section>
      )}

      <Card className="mt-8 bg-surface-muted p-5 sm:p-6">
        <h2 className="text-sm font-semibold text-foreground">Can&apos;t find your club?</h2>
        <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
          Requesting registration for a new club will be supported soon.
        </p>
      </Card>
    </div>
  );
}
