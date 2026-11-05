import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadModule } from "./helpers/aggregate-ui-path.mjs";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("authenticated landing actions point directly to Dashboard with prefetch", async () => {
  const dashboardLink = await loadModule("src/components/dashboard-link.tsx", {
    "next/link": { __esModule: true, default: ({ children, prefetch, ...props }) => createElement("a", { ...props, "data-prefetch": String(prefetch) }, children) },
  });
  const home = await loadModule("src/app/page.tsx", {
    "next/link": { __esModule: true, default: ({ children, ...props }) => createElement("a", props, children) },
    "@/components/dashboard-link": dashboardLink,
    "@/lib/supabase/server": { createClient: async () => ({ auth: { getClaims: async () => ({ data: { claims: { sub: "user-1" } }, error: null }) } }) },
  });
  const html = renderToStaticMarkup(await home.default());
  assert.match(html, /href="\/dashboard"[^>]*data-prefetch="true"/);
  assert.match(html, /href="\/dashboard"[^>]*aria-busy="false"/);
  assert.doesNotMatch(html, /href="\/login"/);
  assert.equal((html.match(/href="\/dashboard"/g) ?? []).length, 2);
});

test("Dashboard navigation provides immediate pending feedback and blocks repeat clicks", async () => {
  const link = await read("src/components/dashboard-link.tsx");
  const landing = await read("src/app/page.tsx");
  const loading = await read("src/app/(app)/dashboard/loading.tsx");
  assert.match(link, /setPending\(true\)/);
  assert.match(link, /if \(pending\) \{\s*event\.preventDefault\(\)/);
  assert.match(link, /aria-busy=\{pending\} aria-disabled=\{pending\}/);
  assert.match(link, /Opening…/);
  assert.match(landing, /<DashboardLink prefetch/);
  assert.match(loading, /aria-busy="true"/);
});

test("Dashboard and app layout share a request-scoped verified session", async () => {
  const helper = await read("src/lib/server/verified-request-auth.ts");
  const layout = await read("src/app/(app)/layout.tsx");
  const dashboard = await read("src/app/(app)/dashboard/page.tsx");
  const proxy = await read("src/lib/supabase/proxy.ts");
  assert.match(helper, /cache\(async \(\) =>/);
  assert.match(helper, /auth\.getClaims\(\)/);
  assert.match(layout, /getVerifiedRequestAuth\(\)/);
  assert.match(dashboard, /getVerifiedRequestAuth\(\)/);
  assert.match(layout, /getNavigationProfile\(\)/);
  assert.match(dashboard, /getNavigationProfile\(\)/);
  assert.match(dashboard, /if \(claimsError \|\| !claims\?\.sub\) redirect\("\/login"\)/);
  assert.match(proxy, /request\.cookies\.set/);
  assert.match(proxy, /response\.cookies\.set/);
  assert.match(dashboard, /\] = await Promise\.all\(\[/);
});
