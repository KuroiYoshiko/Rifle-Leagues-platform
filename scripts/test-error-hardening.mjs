import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { loadModule } from "./helpers/aggregate-ui-path.mjs";

const unexpectedErrors = await loadModule(
  "src/lib/server/unexpected-error.ts",
  { "server-only": {} },
);
const databaseErrors = await loadModule(
  "src/lib/server/database-errors.ts",
  {
    "server-only": {},
    "@/lib/server/unexpected-error": unexpectedErrors,
  },
);
const siteUrl = await loadModule(
  "src/lib/server/site-url.ts",
  { "server-only": {} },
);

const baseOptions = {
  authorizationMessage: "You do not have permission to perform this action.",
  missingMessage: "That resource is no longer available.",
  unexpectedMessage: "The operation could not be completed.",
};

test("known domain errors retain explicit actionable copy", () => {
  const result = databaseErrors.classifyDatabaseError(
    { code: "22023", message: "Competition entries are not currently open." },
    {
      ...baseOptions,
      safeDomainErrors: [{
        code: "22023",
        message: "Competition entries are not currently open.",
        userMessage: "Competition entries are not currently open.",
      }],
    },
  );
  assert.deepEqual(result, {
    kind: "domain",
    message: "Competition entries are not currently open.",
  });
});

test("permission and stale-resource errors use stable safe copy", () => {
  assert.deepEqual(
    databaseErrors.classifyDatabaseError(
      { code: "42501", message: "permission denied for table private_notes" },
      baseOptions,
    ),
    { kind: "authorization", message: baseOptions.authorizationMessage },
  );
  assert.deepEqual(
    databaseErrors.classifyDatabaseError(
      { code: "P0002", message: "private_widget 123 was not found" },
      baseOptions,
    ),
    { kind: "missing", message: baseOptions.missingMessage },
  );
});

test("missing PostgREST and PostgreSQL functions use service-unavailable copy", () => {
  for (const error of [
    { code: "PGRST202", message: "Could not find public.secret_rpc in the schema cache" },
    { code: "42883", message: "function private.secret_rpc() does not exist" },
  ]) {
    const result = databaseErrors.classifyDatabaseError(error, baseOptions);
    assert.equal(result.kind, "deployment");
    assert.equal(result.message, databaseErrors.DATABASE_SERVICE_UNAVAILABLE_MESSAGE);
    assert.doesNotMatch(result.message, /secret_rpc|schema cache|function/i);
  }
});

test("unknown validation and constraint text is never exposed", () => {
  for (const error of [
    {
      code: "23514",
      message: "new row violates check constraint competition_secret_internal_check",
    },
    {
      code: "22023",
      message: "private.validate_hidden_configuration rejected table secret_values",
    },
  ]) {
    const result = databaseErrors.classifyDatabaseError(error, baseOptions);
    assert.deepEqual(result, {
      kind: "unexpected",
      message: baseOptions.unexpectedMessage,
    });
    assert.doesNotMatch(
      result.message,
      /competition_secret_internal_check|validate_hidden_configuration|secret_values/,
    );
  }
});

test("unexpected handled errors invoke the reporter with redacted diagnostics", () => {
  const diagnostics = [];
  const result = databaseErrors.resolveDatabaseError(
    {
      code: "XX000",
      message: "internal failure involving user@example.test and private_table",
    },
    {
      ...baseOptions,
      operation: "test.operation",
      entityIds: { organisationId: 42, ignored: undefined },
      reporter: (diagnostic) => diagnostics.push(diagnostic),
    },
  );

  assert.equal(result.kind, "unexpected");
  assert.equal(result.message, baseOptions.unexpectedMessage);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].operation, "test.operation");
  assert.equal(diagnostics[0].code, "XX000");
  assert.deepEqual(diagnostics[0].entityIds, { organisationId: 42 });
  assert.equal("message" in diagnostics[0], false);
  assert.doesNotMatch(JSON.stringify(diagnostics[0]), /user@example|private_table/);
});

test("audited actions do not retain broad raw database-message exposure", async () => {
  const actionFiles = [
    "../src/app/(app)/competition-entry-actions.ts",
    "../src/app/(app)/division-management-actions.ts",
    "../src/app/(app)/clubs/[slug]/teams/actions.ts",
    "../src/app/(app)/organisations/[slug]/competition-series-actions.ts",
    "../src/app/(app)/organisations/[slug]/leagues/[seasonSlug]/competitions/actions.ts",
  ];
  for (const relativePath of actionFiles) {
    const source = await readFile(new URL(relativePath, import.meta.url), "utf8");
    assert.doesNotMatch(source, /databaseMessage\s*\|\||return\s+error\.message/);
    assert.match(source, /resolveDatabaseError/);
  }
});

test("normal application UI no longer tells users to run database SQL", async () => {
  const applicationRoot = new URL("../src/app/", import.meta.url);
  const files = [
    "(app)/competition-entry-actions.ts",
    "(app)/division-management-actions.ts",
    "(app)/organisations/access/page.tsx",
    "(app)/profile/page.tsx",
    "(app)/clubs/page.tsx",
    "(app)/clubs/[slug]/members/page.tsx",
    "(app)/clubs/[slug]/teams/page.tsx",
    "(app)/organisations/[slug]/management/page.tsx",
    "(app)/organisations/page.tsx",
    "(app)/organisations/[slug]/leagues/actions.ts",
  ];
  for (const file of files) {
    const source = await readFile(new URL(file, applicationRoot), "utf8");
    assert.doesNotMatch(source, /run (?:the )?.*SQL|database upgrade has not been applied/i);
  }
});

test("production confirmation URLs require the configured canonical site", () => {
  assert.equal(
    siteUrl.getRegistrationConfirmationUrl({
      nodeEnv: "production",
      configuredSiteUrl: "https://pilot.example.test",
      requestOrigin: "https://preview.example.test",
    }),
    "https://pilot.example.test/auth/confirm",
  );
  assert.throws(
    () => siteUrl.getRegistrationConfirmationUrl({
      nodeEnv: "production",
      configuredSiteUrl: undefined,
      requestOrigin: "https://preview.example.test",
    }),
    (error) => error.code === "SITE_URL_MISSING",
  );
  assert.equal(
    siteUrl.getRegistrationConfirmationUrl({
      nodeEnv: "development",
      configuredSiteUrl: undefined,
      requestOrigin: null,
    }),
    "http://localhost:3000/auth/confirm",
  );
});
