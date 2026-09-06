import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { DiscoverySearchForm } from "@/components/discovery-search-form";
import { OrganisationDashboardButton } from "@/components/organisation-dashboard-button";
import { Card } from "@/components/ui";
import { getClubLocation } from "@/lib/clubs";
import {
  createPrefixTextSearchQuery,
  normaliseDiscoverySearchTerm,
} from "@/lib/discovery-search";
import {
  organisationColumns,
  type OrganisationStaffAccess,
} from "@/lib/organisations";
import {
  getPublicClubResultsCatalog,
  getPublicResultsCatalog,
  type PublicClub,
  type PublicOrganisation,
} from "@/lib/public-results";
import { createClient } from "@/lib/supabase/server";
import { getViewerId } from "@/lib/viewer";

export const metadata: Metadata = {
  title: "Browse results",
};

const pageSize = 10;

function readSearchTerm(value: string | string[] | undefined) {
  const rawValue = Array.isArray(value) ? value[0] : value;
  return normaliseDiscoverySearchTerm(rawValue ?? "");
}

function readPage(value: string | string[] | undefined) {
  const rawValue = Array.isArray(value) ? value[0] : value;
  const page = Number(rawValue);

  return rawValue && /^\d+$/.test(rawValue) && Number.isSafeInteger(page) && page > 0
    ? page
    : 1;
}

function organisationsHref(searchTerm: string, page: number) {
  const params = new URLSearchParams();
  if (searchTerm) params.set("q", searchTerm);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/organisations?${query}` : "/organisations";
}

function paginationItems(currentPage: number, pageCount: number) {
  if (pageCount <= 9) {
    return Array.from({ length: pageCount }, (_, index) => index + 1);
  }

  const pages = new Set([1, pageCount]);
  for (let page = currentPage - 2; page <= currentPage + 2; page += 1) {
    if (page > 1 && page < pageCount) pages.add(page);
  }

  const sortedPages = Array.from(pages).sort((left, right) => left - right);
  const items: Array<number | string> = [];

  sortedPages.forEach((page, index) => {
    const previousPage = sortedPages[index - 1];
    if (previousPage && page - previousPage > 1) {
      items.push(`ellipsis-${previousPage}`);
    }
    items.push(page);
  });

  return items;
}

function PublicDirectoryCard({
  entity,
}: {
  entity:
    | { type: "club"; value: PublicClub }
    | { type: "organisation"; value: PublicOrganisation };
}) {
  if (entity.type === "club") {
    const club = entity.value;
    const location = getClubLocation(club) ?? club.postcode;

    return (
      <Card className="p-5 sm:p-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-strong">
          Club
        </p>
        <Link
          href={`/clubs/${club.slug}`}
          className="mt-2 inline-flex break-words text-base font-semibold tracking-[-0.02em] text-foreground hover:text-brand-deep hover:underline"
        >
          {club.name}
        </Link>
        <p className="mt-2 text-sm text-muted-foreground">
          {location ?? "Location not yet provided"}
        </p>
        <Link
          href={`/clubs/${club.slug}`}
          className="mt-4 inline-flex text-xs font-semibold text-brand-strong hover:text-brand-deep hover:underline"
        >
          View club →
        </Link>
      </Card>
    );
  }

  const organisation = entity.value;
  return (
    <Card className="p-5 sm:p-6">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-strong">
        Organisation
      </p>
      <Link
        href={`/organisations/${organisation.slug}`}
        className="mt-2 inline-flex break-words text-base font-semibold tracking-[-0.02em] text-foreground hover:text-brand-deep hover:underline"
      >
        {organisation.name}
      </Link>
      <p className="mt-2 text-sm text-muted-foreground">
        {organisation.short_name ??
          organisation.description ??
          "Public league organisation"}
      </p>
      <Link
        href={`/organisations/${organisation.slug}`}
        className="mt-4 inline-flex text-xs font-semibold text-brand-strong hover:text-brand-deep hover:underline"
      >
        View organisation →
      </Link>
    </Card>
  );
}

async function PublicResultsDirectory({
  searchTerm,
  currentPage,
}: {
  searchTerm: string;
  currentPage: number;
}) {
  const rangeStart = (currentPage - 1) * pageSize;
  let organisations: PublicOrganisation[] = [];
  let clubs: PublicClub[] = [];
  let organisationCount = 0;
  let clubCount = 0;
  let loadError = false;

  try {
    const [organisationCatalog, clubCatalog] = await Promise.all([
      getPublicResultsCatalog({
        query: searchTerm,
        offset: rangeStart,
        limit: pageSize,
      }),
      getPublicClubResultsCatalog({
        query: searchTerm,
        offset: rangeStart,
        limit: pageSize,
      }),
    ]);
    organisations = organisationCatalog?.organisations ?? [];
    clubs = clubCatalog?.clubs ?? [];
    organisationCount = organisationCatalog?.total_count ?? 0;
    clubCount = clubCatalog?.total_count ?? 0;
  } catch {
    loadError = true;
  }

  const pageCount = Math.max(
    Math.ceil(organisationCount / pageSize),
    Math.ceil(clubCount / pageSize),
  );
  if (!loadError && pageCount > 0 && currentPage > pageCount) {
    redirect(organisationsHref(searchTerm, pageCount));
  }

  const totalResults = organisationCount + clubCount;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-8">
        <p className="text-xs font-medium text-brand-strong">Browse results</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.045em] text-foreground sm:text-4xl">
          Find a club or league organisation
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
          Search active clubs and league organisations, then follow their public
          Competition participation to released Results.
        </p>
      </div>

      <Card className="p-5 sm:p-7">
        <DiscoverySearchForm
          inputId="public-results-search"
          label="Club or organisation name"
          placeholder="Club or organisation name"
          initialQuery={searchTerm}
          hint="Search checks active clubs and league organisations."
        />
      </Card>

      {loadError ? (
        <Card className="mt-6 border-danger/20 p-6">
          <div role="alert">
            <h2 className="font-semibold text-foreground">
              Public Results discovery unavailable
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Check that the latest public Results SQL has been run in Supabase,
              then refresh this page.
            </p>
          </div>
        </Card>
      ) : (
        <section className="mt-8" aria-labelledby="public-results-heading">
          <div className="mb-5">
            <h2 id="public-results-heading" className="text-lg font-semibold text-foreground">
              {searchTerm ? "Search results" : "Public results directory"}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground" aria-live="polite">
              {totalResults === 0
                ? searchTerm
                  ? `No active clubs or organisations matched “${searchTerm}”.`
                  : "No active clubs or organisations have been added yet."
                : `${clubCount} club${clubCount === 1 ? "" : "s"} · ${organisationCount} organisation${organisationCount === 1 ? "" : "s"}`}
            </p>
          </div>

          {clubs.length > 0 ? (
            <section aria-labelledby="club-directory-heading">
              <h3
                id="club-directory-heading"
                className="mb-3 text-sm font-semibold uppercase tracking-[0.12em] text-foreground"
              >
                Clubs
              </h3>
              <div className="space-y-3">
                {clubs.map((club) => (
                  <PublicDirectoryCard
                    key={`club-${club.id}`}
                    entity={{ type: "club", value: club }}
                  />
                ))}
              </div>
            </section>
          ) : null}

          {organisations.length > 0 ? (
            <section
              className={clubs.length > 0 ? "mt-8" : undefined}
              aria-labelledby="organisation-directory-heading"
            >
              <h3
                id="organisation-directory-heading"
                className="mb-3 text-sm font-semibold uppercase tracking-[0.12em] text-foreground"
              >
                Organisations
              </h3>
              <div className="space-y-3">
                {organisations.map((organisation) => (
                  <PublicDirectoryCard
                    key={`organisation-${organisation.id}`}
                    entity={{ type: "organisation", value: organisation }}
                  />
                ))}
              </div>
            </section>
          ) : null}

          {pageCount > 1 ? (
            <nav
              className="mt-7 flex flex-wrap items-center justify-center gap-2"
              aria-label="Public results directory pages"
            >
              {currentPage > 1 ? (
                <Link
                  href={organisationsHref(searchTerm, currentPage - 1)}
                  rel="prev"
                  className="inline-flex min-h-10 items-center rounded-xl border border-border bg-surface px-4 text-sm font-semibold text-brand-deep transition hover:bg-brand-subtle"
                >
                  Previous
                </Link>
              ) : (
                <span className="inline-flex min-h-10 items-center rounded-xl border border-border bg-surface-muted px-4 text-sm font-semibold text-muted-foreground opacity-60" aria-disabled="true">
                  Previous
                </span>
              )}
              {paginationItems(currentPage, pageCount).map((item) =>
                typeof item === "string" ? (
                  <span key={item} className="px-1 text-sm text-muted-foreground" aria-hidden="true">…</span>
                ) : (
                  <Link
                    key={item}
                    href={organisationsHref(searchTerm, item)}
                    aria-current={item === currentPage ? "page" : undefined}
                    aria-label={`Page ${item}`}
                    className={`grid size-10 place-items-center rounded-xl border text-sm font-semibold transition ${
                      item === currentPage
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-surface text-brand-deep hover:bg-brand-subtle"
                    }`}
                  >
                    {item}
                  </Link>
                ),
              )}
              {currentPage < pageCount ? (
                <Link
                  href={organisationsHref(searchTerm, currentPage + 1)}
                  rel="next"
                  className="inline-flex min-h-10 items-center rounded-xl border border-border bg-surface px-4 text-sm font-semibold text-brand-deep transition hover:bg-brand-subtle"
                >
                  Next
                </Link>
              ) : (
                <span className="inline-flex min-h-10 items-center rounded-xl border border-border bg-surface-muted px-4 text-sm font-semibold text-muted-foreground opacity-60" aria-disabled="true">
                  Next
                </span>
              )}
            </nav>
          ) : null}
        </section>
      )}
    </div>
  );
}

export default async function OrganisationsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string | string[];
    page?: string | string[];
  }>;
}) {
  const { q, page: pageParam } = await searchParams;
  const searchTerm = readSearchTerm(q);
  const currentPage = readPage(pageParam);
  const rangeStart = (currentPage - 1) * pageSize;
  const supabase = await createClient();
  const userId = await getViewerId();

  if (!userId) {
    return (
      <PublicResultsDirectory
        searchTerm={searchTerm}
        currentPage={currentPage}
      />
    );
  }

  const isAuthenticated = Boolean(userId);
  let organisationsResult: {
    data: PublicOrganisation[] | null;
    count: number | null;
    error: unknown;
  };
  let associationsResult: {
    data: Array<{ organisation_id: number }> | null;
    error: unknown;
  } = { data: [], error: null };
  let staffAccessResult: {
    data: OrganisationStaffAccess[] | null;
    error: unknown;
  } = { data: [], error: null };

  if (userId) {
    let organisationsQuery = supabase
      .from("organisations")
      .select(organisationColumns, { count: "exact" })
      .eq("status", "active")
      .order("name")
      .order("id")
      .range(rangeStart, rangeStart + pageSize - 1);

    if (searchTerm) {
      organisationsQuery = organisationsQuery.textSearch(
        "search_document",
        createPrefixTextSearchQuery(searchTerm),
        { config: "simple" },
      );
    }

    const [directory, associations, staffAccess] = await Promise.all([
      organisationsQuery,
      supabase
        .from("user_organisations")
        .select("organisation_id")
        .eq("user_id", userId),
      supabase
        .from("organisation_staff")
        .select("id, organisation_id, role, status, created_at, updated_at")
        .eq("user_id", userId),
    ]);
    organisationsResult = directory as typeof organisationsResult;
    associationsResult = associations as typeof associationsResult;
    staffAccessResult = staffAccess as typeof staffAccessResult;
  } else {
    try {
      const catalog = await getPublicResultsCatalog({
        query: searchTerm,
        offset: rangeStart,
        limit: pageSize,
      });
      organisationsResult = {
        data: catalog?.organisations ?? [],
        count: catalog?.total_count ?? 0,
        error: null,
      };
    } catch (error) {
      organisationsResult = { data: [], count: 0, error };
    }
  }

  const organisations = organisationsResult.data ?? [];
  const totalResults = organisationsResult.count ?? organisations.length;
  const pageCount = Math.ceil(totalResults / pageSize);

  if (!organisationsResult.error && totalResults > 0 && currentPage > pageCount) {
    redirect(organisationsHref(searchTerm, pageCount));
  }

  const addedOrganisationIds = new Set<number>(
    (associationsResult.data ?? []).map(
      (association) => association.organisation_id as number,
    ),
  );
  const accessByOrganisationId = new Map<number, OrganisationStaffAccess>(
    ((staffAccessResult.data ?? []) as OrganisationStaffAccess[]).map((access) => [
      access.organisation_id,
      access,
    ]),
  );
  const statusUnavailable = Boolean(
    associationsResult.error || staffAccessResult.error,
  );

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium text-brand-strong">
            Organisation discovery
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.045em] text-foreground sm:text-4xl">
            Find a league organisation
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            {isAuthenticated
              ? "Add an organisation to your dashboard for quick access to its league context, information, results area and contact details."
              : "Browse active organisations, their public seasons, published Competitions and released Results."}
          </p>
        </div>
        {isAuthenticated ? (
          <Link
            href="/organisations/access"
            className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl border border-border bg-surface px-5 text-sm font-semibold text-brand-deep transition hover:bg-brand-subtle"
          >
            Manage an organisation
          </Link>
        ) : null}
      </div>

      <Card className="p-5 sm:p-7">
        <DiscoverySearchForm
          inputId="organisation-search"
          label="Search organisations"
          placeholder="Organisation name or short name"
          initialQuery={searchTerm}
          hint="Search checks all active organisations by full or abbreviated name."
        />
      </Card>

      {organisationsResult.error ? (
        <Card className="mt-6 border-danger/20 p-6">
          <div role="alert">
            <h2 className="font-semibold text-foreground">
              Organisation discovery unavailable
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              The organisation directory could not be loaded. Check that the
              supplied public Results SQL has been run in Supabase, then refresh
              this page.
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
            <p
              className="mt-1 text-sm text-muted-foreground"
              aria-live="polite"
            >
              {totalResults === 0
                ? searchTerm
                  ? `No active organisations matched “${searchTerm}”.`
                  : "No active league organisations have been added yet."
                : `${totalResults} organisation${totalResults === 1 ? "" : "s"}`}
            </p>
          </div>

          {statusUnavailable ? (
            <p
              className="mb-4 rounded-xl border border-danger/20 bg-danger-subtle px-4 py-3 text-sm text-danger"
              role="alert"
            >
              Your organisation follow or management status could not be loaded.
              Refresh before making dashboard changes.
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
                        className="break-words text-base font-semibold tracking-[-0.02em] text-foreground hover:text-brand-deep hover:underline"
                      >
                        {organisation.name}
                      </Link>
                      {organisation.short_name ? (
                        <p className="mt-1.5 break-words text-sm font-medium text-brand-strong">
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
                    {isAuthenticated ? (
                      <OrganisationDashboardButton
                        organisationId={organisation.id}
                        initiallyAdded={addedOrganisationIds.has(organisation.id)}
                        managementRole={access?.role}
                        managementStatus={access?.status}
                        statusUnavailable={statusUnavailable}
                      />
                    ) : null}
                  </div>
                </Card>
              );
            })}
          </div>

          {pageCount > 1 ? (
            <nav
              className="mt-7 flex flex-wrap items-center justify-center gap-2"
              aria-label="Organisation results pages"
            >
              {currentPage === 1 ? (
                <span
                  className="inline-flex min-h-10 items-center rounded-xl border border-border bg-surface-muted px-4 text-sm font-semibold text-muted-foreground opacity-60"
                  aria-disabled="true"
                >
                  Previous
                </span>
              ) : (
                <Link
                  href={organisationsHref(searchTerm, currentPage - 1)}
                  rel="prev"
                  className="inline-flex min-h-10 items-center rounded-xl border border-border bg-surface px-4 text-sm font-semibold text-brand-deep transition hover:bg-brand-subtle"
                >
                  Previous
                </Link>
              )}

              <div className="flex flex-wrap items-center justify-center gap-1.5">
                {paginationItems(currentPage, pageCount).map((item) =>
                  typeof item === "string" ? (
                    <span
                      key={item}
                      className="px-1 text-sm text-muted-foreground"
                      aria-hidden="true"
                    >
                      …
                    </span>
                  ) : (
                    <Link
                      key={item}
                      href={organisationsHref(searchTerm, item)}
                      aria-current={item === currentPage ? "page" : undefined}
                      aria-label={`Page ${item}`}
                      className={`grid size-10 place-items-center rounded-xl border text-sm font-semibold transition ${
                        item === currentPage
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-surface text-brand-deep hover:bg-brand-subtle"
                      }`}
                    >
                      {item}
                    </Link>
                  ),
                )}
              </div>

              {currentPage === pageCount ? (
                <span
                  className="inline-flex min-h-10 items-center rounded-xl border border-border bg-surface-muted px-4 text-sm font-semibold text-muted-foreground opacity-60"
                  aria-disabled="true"
                >
                  Next
                </span>
              ) : (
                <Link
                  href={organisationsHref(searchTerm, currentPage + 1)}
                  rel="next"
                  className="inline-flex min-h-10 items-center rounded-xl border border-border bg-surface px-4 text-sm font-semibold text-brand-deep transition hover:bg-brand-subtle"
                >
                  Next
                </Link>
              )}
            </nav>
          ) : null}
        </section>
      )}
    </div>
  );
}
