import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadModule } from "./helpers/aggregate-ui-path.mjs";
import {
  isPublicResultSaved,
  normaliseSavedPublicResults,
  readSavedPublicResults,
  reconcileSavedPublicResults,
  SAVED_PUBLIC_RESULTS_STORAGE_KEY,
  setPublicResultSaved,
} from "../src/lib/saved-public-results.mjs";

function browserStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    values,
  };
}

test("explicit save and remove works independently for Clubs and Organisations", () => {
  const storage = browserStorage();
  const club = { type: "club", slug: "basildon-rpc" };
  const organisation = { type: "organisation", slug: "eastern-region" };

  assert.equal(readSavedPublicResults(storage).length, 0);
  assert.equal(storage.values.has(SAVED_PUBLIC_RESULTS_STORAGE_KEY), false);
  assert.equal(setPublicResultSaved(storage, club, true), true);
  assert.equal(setPublicResultSaved(storage, organisation, true), true);
  assert.equal(isPublicResultSaved(storage, club), true);
  assert.deepEqual(readSavedPublicResults(storage), [club, organisation]);

  assert.equal(setPublicResultSaved(storage, club, false), true);
  assert.equal(isPublicResultSaved(storage, club), false);
  assert.deepEqual(readSavedPublicResults(storage), [organisation]);
  assert.equal(setPublicResultSaved(storage, organisation, false), true);
  assert.equal(storage.values.has(SAVED_PUBLIC_RESULTS_STORAGE_KEY), false);
});

test("saved state survives a page-navigation or reload-style storage read", () => {
  const storage = browserStorage();
  const saved = { type: "club", slug: "northbridge-target-shooting-club" };
  setPublicResultSaved(storage, saved, true);

  const laterPageRead = readSavedPublicResults(storage);
  const reloadRead = readSavedPublicResults(storage);
  assert.deepEqual(laterPageRead, [saved]);
  assert.deepEqual(reloadRead, [saved]);
});

test("malformed, duplicate and oversized saved values fail closed", () => {
  const storage = browserStorage({
    [SAVED_PUBLIC_RESULTS_STORAGE_KEY]: JSON.stringify([
      null,
      "club:bad",
      { type: "club", slug: "Valid Slug" },
      { type: "profile", slug: "private-profile" },
      { type: "club", slug: "valid-club", copiedName: "Ignored" },
      { type: "club", slug: "valid-club" },
      { type: "organisation", slug: "valid-organisation" },
    ]),
  });
  assert.deepEqual(readSavedPublicResults(storage), [
    { type: "club", slug: "valid-club" },
    { type: "organisation", slug: "valid-organisation" },
  ]);

  storage.values.set(SAVED_PUBLIC_RESULTS_STORAGE_KEY, "not json");
  assert.deepEqual(readSavedPublicResults(storage), []);
  assert.deepEqual(normaliseSavedPublicResults({ items: [] }), []);
});

test("stale public slugs are removed only after current public resolution", () => {
  const saved = [
    { type: "club", slug: "active-club" },
    { type: "club", slug: "inactive-or-deleted-club" },
    { type: "organisation", slug: "active-league" },
  ];
  const resolved = [
    { type: "organisation", slug: "active-league" },
    { type: "club", slug: "active-club" },
  ];
  assert.deepEqual(reconcileSavedPublicResults(saved, resolved), [
    { type: "club", slug: "active-club" },
    { type: "organisation", slug: "active-league" },
  ]);
});

test("saved shortcut resolver returns current public names and omits stale slugs", async () => {
  const route = await loadModule("src/app/api/public-results/saved/route.ts", {
    "next/server": {
      NextResponse: {
        json: (value, init = {}) => new Response(JSON.stringify(value), {
          ...init,
          headers: { "Content-Type": "application/json", ...init.headers },
        }),
      },
    },
    "@/lib/public-results": {
      getPublicClubResultsCatalog: async ({ clubSlug }) =>
        clubSlug === "active-club"
          ? { club: { name: "Active Club", slug: clubSlug } }
          : null,
      getPublicResultsCatalog: async ({ organisationSlug }) =>
        organisationSlug === "active-league"
          ? { organisation: { name: "Active League", slug: organisationSlug } }
          : null,
    },
    "@/lib/saved-public-results.mjs": { normaliseSavedPublicResults },
  });
  const response = await route.POST(new Request("https://example.test/api/public-results/saved", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items: [
      { type: "club", slug: "active-club" },
      { type: "club", slug: "stale-club" },
      { type: "organisation", slug: "active-league" },
    ] }),
  }));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).items, [
    { type: "club", slug: "active-club", name: "Active Club" },
    { type: "organisation", slug: "active-league", name: "Active League" },
  ]);
});

test("Saved navigation renders no empty section before browser storage resolves", async () => {
  const savedComponents = await loadModule(
    "src/components/saved-public-results.tsx",
    {
      "next/link": {
        __esModule: true,
        default: ({ children, ...props }) => createElement("a", props, children),
      },
      "@/lib/saved-public-results.mjs": {
        isPublicResultSaved: () => false,
        readSavedPublicResults: () => [],
        reconcileSavedPublicResults: () => [],
        SAVED_PUBLIC_RESULTS_CHANGED_EVENT: "test:saved-change",
        SAVED_PUBLIC_RESULTS_STORAGE_KEY: "test.saved",
        setPublicResultSaved: () => true,
        writeSavedPublicResults: () => true,
      },
    },
  );
  const html = renderToStaticMarkup(
    createElement(savedComponents.SavedPublicResultsNavigation, {
      pathname: "/organisations",
    }),
  );
  assert.equal(html, "");
});

test("saved Club and Organisation shortcuts follow their canonical active routes", async () => {
  const savedComponents = await loadModule(
    "src/components/saved-public-results.tsx",
    {
      "next/link": {
        __esModule: true,
        default: ({ children, ...props }) => createElement("a", props, children),
      },
      "@/lib/saved-public-results.mjs": {
        isPublicResultSaved: () => false,
        readSavedPublicResults: () => [],
        reconcileSavedPublicResults: () => [],
        SAVED_PUBLIC_RESULTS_CHANGED_EVENT: "test:saved-change",
        SAVED_PUBLIC_RESULTS_STORAGE_KEY: "test.saved",
        setPublicResultSaved: () => true,
        writeSavedPublicResults: () => true,
      },
    },
  );

  assert.equal(savedComponents.isSavedPublicResultRouteActive(
    "/clubs/basildon/competitions",
    { type: "club", slug: "basildon" },
  ), true);
  assert.equal(savedComponents.isSavedPublicResultRouteActive(
    "/organisations/eastern/leagues/2026/competitions/summer",
    { type: "organisation", slug: "eastern" },
  ), true);
  assert.equal(savedComponents.isSavedPublicResultRouteActive(
    "/clubs/another-club",
    { type: "club", slug: "basildon" },
  ), false);
});

test("public Results shell is minimal and the directory no longer owns a Saved card", async () => {
  const shell = await loadModule("src/components/public-results-shell.tsx", {
    "next/link": {
      __esModule: true,
      default: ({ children, ...props }) => createElement("a", props, children),
    },
    "next/navigation": { usePathname: () => "/organisations" },
    "@/components/application-sidebar-primitives": {
      ApplicationSidebarBrand: () => createElement("a", { href: "/" }, "Rifle Leagues"),
      ApplicationSidebarLink: ({ href, label, active }) => createElement(
        "a",
        { href, "aria-current": active ? "page" : undefined },
        label,
      ),
    },
    "@/components/saved-public-results": {
      SavedPublicResultsNavigation: () => null,
    },
  });
  const html = renderToStaticMarkup(
    createElement(shell.PublicResultsShell, null, createElement("p", null, "Directory")),
  );

  assert.match(html, /Browse results/);
  assert.match(html, /Browse clubs/);
  assert.match(html, /Browse organisations/);
  assert.match(html, /Login/);
  assert.match(html, /Create account/);
  assert.match(html, /aria-label="Open navigation"/);
  assert.doesNotMatch(html, /My clubs|My organisations|Profile|Management|Club settings/);

  const directorySource = await readFile(
    new URL("../src/app/(app)/organisations/page.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(directorySource, /SavedPublicResultsShortcuts|Saved shortcuts/);
});
