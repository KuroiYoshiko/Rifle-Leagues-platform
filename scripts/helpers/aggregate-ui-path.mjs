import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { Script } from "node:vm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);

// Compile the real application modules with the installed TypeScript compiler.
// Only Next request context/navigation and unrelated page lookups are supplied
// by the test. The Results loader, Supabase SSR client/SDK, Competition page and table are real.
export async function loadModule(relativePath, dependencies = {}) {
  const filename = new URL(`../../${relativePath}`, import.meta.url);
  const source = await readFile(filename, "utf8");
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const loadedModule = { exports: {} };
  const localRequire = (name) => Object.hasOwn(dependencies, name) ? dependencies[name] : require(name);
  new Script(`(function(require,module,exports){${code}\n})`, { filename: filename.pathname })
    .runInThisContext()(localRequire, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}

export async function renderAggregateResultsRoute({
  readRpc,
  readAveragesRpc = async () => ({ participants: [] }),
  competition,
  organisationId = 1,
  seasonId = 1,
  viewerId = "00000000-0000-0000-0000-000000000001",
}) {
  const calls = [];
  const averageCalls = [];
  const rpcName = competition.ranking_method === "gun_score"
    ? "get_competition_gun_score_results"
    : competition.ranking_method === "round_robin"
    ? "get_competition_round_robin_results"
    : "get_competition_aggregate_results";
  const originalFetch = globalThis.fetch;
  const envKeys = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"];
  const previousEnv = envKeys.map(key => process.env[key]);
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://aggregate-test.invalid";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_fixture_only";
  // No network: the real SDK's HTTP request is dispatched to isolated PostgreSQL.
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    assert.equal(request.method, "POST");
    assert.equal(request.headers.get("content-profile"), "public");
    const parameters = await request.json();
    assert.deepEqual(parameters, {
      p_organisation_id: organisationId,
      p_league_season_id: seasonId,
      p_competition_id: competition.id,
    });
    if (request.url.endsWith("/rpc/get_competition_result_averages")) {
      const payload = await readAveragesRpc(parameters);
      averageCalls.push({ url: request.url, parameters, payload: structuredClone(payload) });
      return new Response(JSON.stringify(payload), { headers: { "Content-Type": "application/json" } });
    }
    assert.equal(request.url, `https://aggregate-test.invalid/rest/v1/rpc/${rpcName}`);
    const payload = await readRpc(parameters);
    calls.push({ url: request.url, parameters, payload: structuredClone(payload) });
    return new Response(JSON.stringify(payload), { headers: { "Content-Type": "application/json" } });
  };
  try {
    const serverClient = await loadModule("src/lib/supabase/server.ts", {
      "next/headers": { cookies: async () => ({ getAll: () => [], set: () => {} }) },
    });
    const resultsLoader = await loadModule("src/lib/competition-aggregate-results.ts", {
      "@/lib/supabase/server": serverClient,
    });
    const gunScoreResultsLoader = await loadModule("src/lib/competition-gun-score-results.ts", {
      "@/lib/competition-aggregate-results": resultsLoader,
      "@/lib/supabase/server": serverClient,
    });
    const ui = await loadModule("src/components/ui.tsx");
    const resultsTable = await loadModule("src/components/competition-aggregate-results.tsx", {
      "@/components/ui": ui,
    });
    const roundRobinLoader = await loadModule("src/lib/competition-round-robin-results.ts", {
      "@/lib/supabase/server": serverClient,
    });
    const resultAveragesLoader = await loadModule("src/lib/competition-result-averages.ts", {
      "@/lib/supabase/server": serverClient,
    });
    const roundRobinTable = await loadModule("src/components/competition-round-robin-results.tsx", {
      "@/components/ui": ui,
      "@/components/competition-aggregate-results": resultsTable,
    });
    const route = await loadModule("src/app/(app)/organisations/[slug]/leagues/[seasonSlug]/competitions/[competitionSlug]/page.tsx", {
      "next/link": { __esModule: true, default: ({ children, ...props }) => createElement("a", props, children) },
      "next/navigation": { notFound: () => { throw new Error("Unexpected notFound in Competition route"); } },
      "@/components/ui": ui,
      "@/components/competition-details-disclosure": {
        CompetitionDetailsDisclosure: ({ showScoringAccess }) =>
          createElement("div", { "data-scoring-access": String(showScoringAccess) }),
      },
      "@/components/competition-entry-controls": {
        CompetitionEntryControls: () => createElement("div", { "data-entry-controls": "true" }),
      },
      "@/components/competition-aggregate-results": resultsTable,
      "@/components/competition-round-robin-results": roundRobinTable,
      "@/components/competition-lifecycle-actions": {
        CompetitionLifecycleActions: () => createElement("div", { "data-lifecycle-actions": "true" }),
      },
      "@/components/organisation-page-frame": { OrganisationPageFrame: ({ children }) => children },
      "@/components/published-competition-divisions": { PublishedCompetitionDivisionsView: () => null },
      "@/lib/competition-aggregate-results": resultsLoader,
      "@/lib/competition-gun-score-results": gunScoreResultsLoader,
      "@/lib/competition-round-robin-results": roundRobinLoader,
      "@/lib/competition-result-averages": resultAveragesLoader,
      "@/lib/competition-divisions": {
        getCompetitionDivisionManagement: async () => null,
        getPublishedCompetitionDivisions: async () => null,
      },
      "@/lib/competition-entries": { getCompetitionClubEntryContext: async () => [] },
      "@/lib/public-results": {
        getPublicResultsCatalog: async () => ({
          organisation: { id: organisationId, slug: "test-org", name: "Test Organisation" },
          season: { id: seasonId, slug: "test-season", name: "Test Season", entry_opens_at: null, entry_closes_at: null, starts_at: null },
          competition,
          rounds: [],
          score_components: [],
          published_divisions: null,
        }),
      },
      "@/lib/public-results-routes.mjs": {
        getCompetitionViewerCapabilities: ({ isAuthenticated, isOwner, hasManagementContext, competitionPublished, hasDivisionManagement }) => ({
          loadEntryContext: isAuthenticated && competitionPublished,
          showEntryControls: isAuthenticated,
          showLifecycleActions: isAuthenticated && isOwner,
          showScoringAccess: isAuthenticated,
          showCompetitionManagement: isAuthenticated && ((hasManagementContext && competitionPublished) || hasDivisionManagement),
        }),
      },
      "@/lib/viewer": { getViewerId: async () => viewerId },
      "@/lib/organisations": {
        getActiveOrganisationBySlug: async () => ({ id: organisationId, slug: "test-org", name: "Test Organisation" }),
        getOrganisationManagementContextBySlug: async () => null,
      },
      "@/lib/league-seasons": {
        formatLeagueSeasonDate: () => null,
        getLeagueSeasonBySlug: async () => ({ id: seasonId, slug: "test-season", name: "Test Season", entry_opens_at: null, entry_closes_at: null, starts_at: null }),
      },
      "@/lib/competitions": {
        getCompetitionBySlug: async () => competition,
        formatCompetitionEntryFee: () => null,
        getCompetitionMaximumPerRound: () => 0,
        getCompetitionEntryFormatLabel: () => "Pairs",
        getCompetitionLifecycleState: async () => null,
        getCompetitionRankingMethodLabel: () => "Aggregate points",
        getCompetitionRounds: async () => [],
        getCompetitionScoreComponents: async () => [],
        getCompetitionScoringMethodLabel: () => "Points scored",
        getCompetitionStatusLabel: () => "Published",
        resolveCompetitionEffectiveDates: () => ({
          effective_entry_opens_at: null,
          effective_entry_closes_at: null,
          effective_starts_at: null,
        }),
      },
    });
    const element = await route.default({
      params: Promise.resolve({ slug: "test-org", seasonSlug: "test-season", competitionSlug: competition.slug }),
      searchParams: Promise.resolve({}),
    });
    const html = renderToStaticMarkup(element);
    assert.equal(calls.length, 1, "Competition page must use one Results RPC");
    assert.equal(averageCalls.length, 1, "Competition page must use one set-based result-averages RPC");
    return { html, call: calls[0], averageCall: averageCalls[0] };
  } finally {
    globalThis.fetch = originalFetch;
    envKeys.forEach((key, index) => {
      if (previousEnv[index] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[index];
    });
  }
}

export const renderGunScoreResultsRoute = renderAggregateResultsRoute;

export async function getCompetitionResultsRedirect(params) {
  let destination;
  const route = await loadModule("src/app/(app)/organisations/[slug]/leagues/[seasonSlug]/competitions/[competitionSlug]/results/page.tsx", {
    "next/navigation": { permanentRedirect: (href) => { destination = href; } },
  });
  await route.default({ params: Promise.resolve(params) });
  return destination;
}
