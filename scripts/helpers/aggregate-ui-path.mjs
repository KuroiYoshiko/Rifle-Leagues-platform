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
async function loadModule(relativePath, dependencies = {}) {
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

export async function renderAggregateResultsRoute({ readRpc, competition, organisationId = 1, seasonId = 1 }) {
  const calls = [];
  const originalFetch = globalThis.fetch;
  const envKeys = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"];
  const previousEnv = envKeys.map(key => process.env[key]);
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://aggregate-test.invalid";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_fixture_only";
  // No network: the real SDK's HTTP request is dispatched to isolated PostgreSQL.
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    assert.equal(request.url, "https://aggregate-test.invalid/rest/v1/rpc/get_competition_aggregate_results");
    assert.equal(request.method, "POST");
    assert.equal(request.headers.get("content-profile"), "public");
    const parameters = await request.json();
    assert.deepEqual(parameters, {
      p_organisation_id: organisationId,
      p_league_season_id: seasonId,
      p_competition_id: competition.id,
    });
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
    const ui = await loadModule("src/components/ui.tsx");
    const resultsTable = await loadModule("src/components/competition-aggregate-results.tsx", {
      "@/components/ui": ui,
    });
    const route = await loadModule("src/app/(app)/organisations/[slug]/leagues/[seasonSlug]/competitions/[competitionSlug]/page.tsx", {
      "next/link": { __esModule: true, default: ({ children, ...props }) => createElement("a", props, children) },
      "next/navigation": { notFound: () => { throw new Error("Unexpected notFound in Competition route"); } },
      "@/components/ui": ui,
      "@/components/competition-details-disclosure": { CompetitionDetailsDisclosure: () => null },
      "@/components/competition-entry-controls": { CompetitionEntryControls: () => null },
      "@/components/competition-aggregate-results": resultsTable,
      "@/components/competition-lifecycle-actions": { CompetitionLifecycleActions: () => null },
      "@/components/organisation-page-frame": { OrganisationPageFrame: ({ children }) => children },
      "@/components/published-competition-divisions": { PublishedCompetitionDivisionsView: () => null },
      "@/lib/competition-aggregate-results": resultsLoader,
      "@/lib/competition-divisions": {
        getCompetitionDivisionManagement: async () => null,
        getPublishedCompetitionDivisions: async () => null,
      },
      "@/lib/competition-entries": { getCompetitionClubEntryContext: async () => [] },
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
    assert.equal(calls.length, 1, "Competition page must use the single Aggregate RPC");
    return { html, call: calls[0] };
  } finally {
    globalThis.fetch = originalFetch;
    envKeys.forEach((key, index) => {
      if (previousEnv[index] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[index];
    });
  }
}

export async function getCompetitionResultsRedirect(params) {
  let destination;
  const route = await loadModule("src/app/(app)/organisations/[slug]/leagues/[seasonSlug]/competitions/[competitionSlug]/results/page.tsx", {
    "next/navigation": { permanentRedirect: (href) => { destination = href; } },
  });
  await route.default({ params: Promise.resolve(params) });
  return destination;
}
