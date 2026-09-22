import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { loadModule } from "./helpers/aggregate-ui-path.mjs";
import { isPublicResultsPathname } from "../src/lib/public-results-routes.mjs";

const passthrough = ({ children }) => children;
const noopComponent = () => null;

test("unauthenticated private app routes redirect to login", async () => {
  let destination = null;
  const layout = await loadModule("src/app/(app)/layout.tsx", {
    "next/headers": {
      headers: async () => ({ get: () => null }),
    },
    "next/navigation": {
      redirect: (href) => {
        destination = href;
        throw new Error(`redirect:${href}`);
      },
    },
    "@/components/app-shell": { AppShell: passthrough },
    "@/components/public-results-shell": { PublicResultsShell: passthrough },
    "@/lib/supabase/server": {
      createClient: async () => ({
        auth: { getClaims: async () => ({ data: null, error: { code: "no_session" } }) },
      }),
    },
  });

  await assert.rejects(
    () => layout.default({ children: createElement("div") }),
    /redirect:\/login/,
  );
  assert.equal(destination, "/login");
});

test("authenticated outsiders and genuinely missing tenants share not-found behavior", async () => {
  const requestedSlugs = [];
  const page = await loadModule(
    "src/app/(app)/organisations/[slug]/management/page.tsx",
    {
      "next/navigation": {
        notFound: () => {
          throw new Error("not-found");
        },
      },
      "@/components/organisation-page-frame": { OrganisationPageFrame: passthrough },
      "@/components/organisation-management-navigation": {
        OrganisationManagementNavigation: noopComponent,
      },
      "@/components/organisation-staff-actions": {
        OrganisationManagerActions: noopComponent,
        OrganisationRequestDecisionControls: noopComponent,
      },
      "@/components/ui": {
        Badge: passthrough,
        Card: passthrough,
        SectionHeader: noopComponent,
      },
      "@/lib/organisations": {
        getOrganisationManagementContextBySlug: async (slug) => {
          requestedSlugs.push(slug);
          return null;
        },
        getOrganisationStaffName: () => "Hidden",
      },
      "@/lib/supabase/server": {
        createClient: async () => {
          throw new Error("The page must stop before creating a data client");
        },
      },
    },
  );

  await assert.rejects(
    () => page.default({ params: Promise.resolve({ slug: "existing-but-foreign" }) }),
    /not-found/,
  );
  await assert.rejects(
    () => page.default({ params: Promise.resolve({ slug: "genuinely-missing" }) }),
    /not-found/,
  );
  assert.deepEqual(requestedSlugs, ["existing-but-foreign", "genuinely-missing"]);
});

test("public route allow-list excludes every representative management URL", () => {
  for (const pathname of [
    "/organisations/example/management",
    "/organisations/example/leagues/new",
    "/organisations/example/leagues/season/edit",
    "/organisations/example/leagues/season/competitions/new",
    "/organisations/example/leagues/season/competitions/draft/edit",
    "/organisations/example/leagues/season/competitions/draft/scores",
    "/clubs/example/settings",
    "/clubs/example/teams",
  ]) {
    assert.equal(isPublicResultsPathname(pathname), false, pathname);
  }
});

test("a public viewer receives not-found when the public catalog omits a draft Season", async () => {
  let publicCatalogReads = 0;
  let privateSeasonReads = 0;
  const page = await loadModule(
    "src/app/(app)/organisations/[slug]/leagues/[seasonSlug]/page.tsx",
    {
      "next/link": { __esModule: true, default: passthrough },
      "next/navigation": {
        notFound: () => {
          throw new Error("not-found");
        },
      },
      "@/components/league-season-phase-badge": {
        LeagueSeasonPhaseBadge: noopComponent,
      },
      "@/components/organisation-page-frame": { OrganisationPageFrame: passthrough },
      "@/components/ui": {
        Badge: passthrough,
        Card: passthrough,
        SectionHeader: noopComponent,
      },
      "@/lib/competitions": {
        formatCompetitionEntryFee: () => null,
        getCompetitionEntryFormatLabel: () => "Individual",
        getCompetitions: async () => {
          throw new Error("Public viewers must not use the private Competition read");
        },
        getCompetitionScoringMethodLabel: () => "Points scored",
      },
      "@/lib/league-seasons": {
        getLeagueEntryWindowDateDisplay: () => null,
        getLeagueEntryWindowState: () => null,
        getLeagueSeasonBySlug: async () => {
          privateSeasonReads += 1;
          return { id: 99, name: "Private Draft", status: "draft" };
        },
        getLeagueSeasonDateDisplay: () => null,
        getLeagueSeasonPresentationPhase: () => "upcoming",
      },
      "@/lib/organisations": {
        getActiveOrganisationBySlug: async () => ({ id: 1 }),
        getOrganisationManagementContextBySlug: async () => ({ access: { role: "owner" } }),
      },
      "@/lib/public-results": {
        getPublicResultsCatalog: async () => {
          publicCatalogReads += 1;
          return null;
        },
      },
      "@/lib/viewer": { getViewerId: async () => null },
    },
  );

  await assert.rejects(
    () => page.default({
      params: Promise.resolve({ slug: "example", seasonSlug: "private-draft" }),
      searchParams: Promise.resolve({}),
    }),
    /not-found/,
  );
  assert.equal(publicCatalogReads, 1);
  assert.equal(privateSeasonReads, 0);
});
