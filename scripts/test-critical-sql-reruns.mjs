import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { installCanonicalDatabase, sqlFile } from "./helpers/canonical-database.mjs";
import {
  CANONICAL_FRESH_INSTALL_ORDER,
  FRESH_INSTALL_ONLY_SQL_FILES,
  INCREMENTAL_UPGRADE_SQL_FILES,
  NON_STANDALONE_SQL_FILES,
  ORDERED_BUNDLE_ONLY_SQL_FILES,
  ORDERED_RERUN_BUNDLES,
  STANDALONE_RERUNNABLE_SQL_FILES,
} from "./helpers/database-install-manifest.mjs";
import {
  assertCriticalReadContracts,
  assertDatabaseMetadataInvariants,
  loadProductionReadProjections,
  seedCriticalReadContractFixture,
} from "./helpers/critical-database-contracts.mjs";

const db = new PGlite();
let projections;

before(async () => {
  projections = await loadProductionReadProjections();
});

after(async () => db.close());

test("the manifest classifies every current database SQL file exactly once", async () => {
  const databaseRoot = new URL("../database/", import.meta.url);
  const entries = await readdir(databaseRoot, { recursive: true });
  const actualFiles = entries
    .filter((name) => name.endsWith(".sql"))
    .map((name) => name.replaceAll("\\", "/").replace(/\.sql$/, ""))
    .sort();
  const classifiedFiles = [
    ...CANONICAL_FRESH_INSTALL_ORDER,
    ...INCREMENTAL_UPGRADE_SQL_FILES,
    ...NON_STANDALONE_SQL_FILES,
  ].sort();

  assert.deepEqual(classifiedFiles, actualFiles);
  assert.equal(new Set(classifiedFiles).size, classifiedFiles.length);
  assert.deepEqual(
    [
      ...STANDALONE_RERUNNABLE_SQL_FILES,
      ...ORDERED_BUNDLE_ONLY_SQL_FILES,
      ...FRESH_INSTALL_ONLY_SQL_FILES,
    ].sort(),
    [...CANONICAL_FRESH_INSTALL_ORDER].sort(),
  );
  for (const bundle of ORDERED_RERUN_BUNDLES) {
    assert.ok(bundle.files.length > 0);
    for (const name of bundle.files) assert.ok(ORDERED_BUNDLE_ONLY_SQL_FILES.includes(name));
  }
});

test("supported SQL reruns preserve current reads, RPCs and database metadata", async () => {
  await installCanonicalDatabase(db);
  await seedCriticalReadContractFixture(db);
  await assertCriticalReadContracts(db, projections);
  await assertDatabaseMetadataInvariants(db, projections);

  for (const name of STANDALONE_RERUNNABLE_SQL_FILES) {
    await db.exec("reset role");
    await db.exec(await sqlFile(name));
    await assertCriticalReadContracts(db, projections);
    await assertDatabaseMetadataInvariants(db, projections);
  }

  for (const bundle of ORDERED_RERUN_BUNDLES) {
    await db.exec("reset role");
    for (const name of bundle.files) {
      await db.exec(await sqlFile(name));
    }
    await assertCriticalReadContracts(db, projections);
    await assertDatabaseMetadataInvariants(db, projections);
  }
});
