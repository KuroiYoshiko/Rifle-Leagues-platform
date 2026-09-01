import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { OrganisationAccessRequestButton } from "@/components/organisation-access-request-button";
import { Card } from "@/components/ui";
import {
  organisationColumns,
  type Organisation,
  type OrganisationStaffAccess,
} from "@/lib/organisations";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Manage an organisation",
};

const resultLimit = 30;

function readSearchTerm(value: string | string[] | undefined) {
  const rawValue = Array.isArray(value) ? value[0] : value;
  return rawValue?.trim().slice(0, 100) ?? "";
}

export default async function OrganisationAccessPage({
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

  const [organisationsResult, accessResult] = await Promise.all([
    organisationsQuery,
    supabase
      .from("organisation_staff")
      .select("id, organisation_id, role, status, created_at, updated_at")
      .eq("user_id", userId),
  ]);
  const organisations = (organisationsResult.data ?? []) as Organisation[];
  const accessByOrganisationId = new Map<number, OrganisationStaffAccess>(
    ((accessResult.data ?? []) as OrganisationStaffAccess[]).map((access) => [
      access.organisation_id,
      access,
    ]),
  );

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-8">
        <p className="text-xs font-medium text-brand-strong">
          Organisation administration
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.045em] text-foreground sm:text-4xl">
          Manage an organisation
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
          If you are authorised to help administer an organisation already
          registered on RifleLeagues, find it below and request access.
        </p>
        <p className="mt-3 max-w-3xl text-xs leading-5 text-muted-foreground">
          Management access is reviewed by the organisation owner. It is
          separate from adding an organisation to My Organisations.
        </p>
      </div>

      <Card className="p-5 sm:p-7">
        <form action="/organisations/access" method="get" role="search">
          <label
            htmlFor="organisation-access-search"
            className="text-sm font-semibold text-foreground"
          >
            Search organisations
          </label>
          <div className="mt-2 flex flex-col gap-3 sm:flex-row">
            <input
              id="organisation-access-search"
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
                href="/organisations/access"
                className="inline-flex min-h-12 items-center justify-center rounded-xl border border-border bg-surface px-5 text-sm font-semibold text-brand-deep transition hover:bg-brand-subtle"
              >
                Clear
              </Link>
            ) : null}
          </div>
        </form>
      </Card>

      {organisationsResult.error ? (
        <Card className="mt-6 border-danger/20 p-6">
          <div role="alert">
            <h2 className="font-semibold text-foreground">
              Organisations could not be loaded
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Run the supplied organisation SQL in Supabase, then refresh this page.
            </p>
          </div>
        </Card>
      ) : (
        <section className="mt-8" aria-labelledby="access-results-heading">
          <div className="mb-4">
            <h2
              id="access-results-heading"
              className="text-lg font-semibold text-foreground"
            >
              Request management access
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {organisations.length === 0
                ? searchTerm
                  ? `No active organisations matched “${searchTerm}”.`
                  : "No active league organisations are available."
                : `${organisations.length} organisation${
                    organisations.length === 1 ? "" : "s"
                  } shown`}
            </p>
          </div>

          {accessResult.error ? (
            <p
              className="mb-4 rounded-xl border border-danger/20 bg-danger-subtle px-4 py-3 text-sm text-danger"
              role="alert"
            >
              Management access status is unavailable. Run the latest
              organisation staff SQL before requesting access.
            </p>
          ) : null}

          <div className="space-y-3">
            {organisations.map((organisation) => {
              const access = accessByOrganisationId.get(organisation.id);

              return (
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
                    </div>
                    <OrganisationAccessRequestButton
                      organisationId={organisation.id}
                      initialRole={access?.role}
                      initialStatus={access?.status}
                      statusUnavailable={Boolean(accessResult.error)}
                    />
                  </div>
                </Card>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
