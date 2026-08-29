import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { OrganisationDashboardButton } from "@/components/organisation-dashboard-button";
import { Card } from "@/components/ui";
import {
  organisationColumns,
  type Organisation,
} from "@/lib/organisations";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "League organisations",
};

const resultLimit = 30;

function readSearchTerm(value: string | string[] | undefined) {
  const rawValue = Array.isArray(value) ? value[0] : value;
  return rawValue?.trim().slice(0, 100) ?? "";
}

export default async function OrganisationsPage({
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

  let organisationsQuery = supabase
    .from("organisations")
    .select(organisationColumns)
    .eq("status", "active")
    .order("name")
    .limit(resultLimit);

  if (searchTerm) {
    organisationsQuery = organisationsQuery.textSearch(
      "search_document",
      searchTerm,
      { config: "simple", type: "websearch" },
    );
  }

  const [organisationsResult, associationsResult] = await Promise.all([
    organisationsQuery,
    supabase
      .from("user_organisations")
      .select("organisation_id")
      .eq("user_id", userId),
  ]);
  const organisations = (organisationsResult.data ?? []) as Organisation[];
  const addedOrganisationIds = new Set<number>(
    (associationsResult.data ?? []).map(
      (association) => association.organisation_id as number,
    ),
  );

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-8">
        <p className="text-xs font-medium text-brand-strong">
          Organisation discovery
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.045em] text-foreground sm:text-4xl">
          Find a league organisation
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
          Add an organisation to your dashboard for quick access to its public
          league context, information, results area and contact details.
        </p>
      </div>

      <Card className="p-5 sm:p-7">
        <form action="/organisations" method="get" role="search">
          <label
            htmlFor="organisation-search"
            className="text-sm font-semibold text-foreground"
          >
            Search organisations
          </label>
          <div className="mt-2 flex flex-col gap-3 sm:flex-row">
            <input
              id="organisation-search"
              name="q"
              type="search"
              defaultValue={searchTerm}
              maxLength={100}
              placeholder="Organisation name or short name"
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
                href="/organisations"
                className="inline-flex min-h-12 items-center justify-center rounded-xl border border-border bg-surface px-5 text-sm font-semibold text-brand-deep transition hover:bg-brand-subtle"
              >
                Clear
              </Link>
            ) : null}
          </div>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            Results are limited to {resultLimit}. Search by the full or short
            organisation name to refine the list.
          </p>
        </form>
      </Card>

      {organisationsResult.error ? (
        <Card className="mt-6 border-danger/20 p-6">
          <div role="alert">
            <h2 className="font-semibold text-foreground">
              Organisation discovery unavailable
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              The organisation database could not be loaded. Run the supplied
              organisations SQL in Supabase, then refresh this page.
            </p>
          </div>
        </Card>
      ) : (
        <section className="mt-8" aria-labelledby="organisation-results-heading">
          <div className="mb-4">
            <h2
              id="organisation-results-heading"
              className="text-lg font-semibold text-foreground"
            >
              {searchTerm ? "Search results" : "Active organisations"}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {organisations.length === 0
                ? searchTerm
                  ? `No active organisations matched “${searchTerm}”.`
                  : "No active league organisations have been added yet."
                : `${organisations.length} organisation${
                    organisations.length === 1 ? "" : "s"
                  } shown`}
            </p>
          </div>

          {associationsResult.error ? (
            <p
              className="mb-4 rounded-xl border border-danger/20 bg-danger-subtle px-4 py-3 text-sm text-danger"
              role="alert"
            >
              Your organisation list could not be loaded. Refresh before making
              dashboard changes.
            </p>
          ) : null}

          <div className="space-y-3">
            {organisations.map((organisation) => (
              <Card key={organisation.id} className="p-5 sm:p-6">
                <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                  <div className="min-w-0">
                    <Link
                      href={`/organisations/${organisation.slug}`}
                      className="text-base font-semibold tracking-[-0.02em] text-foreground hover:text-brand-deep hover:underline"
                    >
                      {organisation.name}
                    </Link>
                    {organisation.short_name ? (
                      <p className="mt-1.5 text-sm font-medium text-brand-strong">
                        {organisation.short_name}
                      </p>
                    ) : null}
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                      {organisation.description ??
                        "Public organisation information is available from the overview."}
                    </p>
                    <Link
                      href={`/organisations/${organisation.slug}`}
                      className="mt-3 inline-flex text-xs font-semibold text-brand-strong hover:text-brand-deep hover:underline"
                    >
                      View organisation →
                    </Link>
                  </div>
                  <OrganisationDashboardButton
                    organisationId={organisation.id}
                    initiallyAdded={addedOrganisationIds.has(organisation.id)}
                    statusUnavailable={Boolean(associationsResult.error)}
                  />
                </div>
              </Card>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
