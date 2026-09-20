import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { installCanonicalDatabase } from "./helpers/canonical-database.mjs";
import {
  assertCriticalReadContracts,
  loadProductionReadProjections,
  seedCriticalReadContractFixture,
} from "./helpers/critical-database-contracts.mjs";

const db = new PGlite();
let projections;

before(async () => {
  projections = await loadProductionReadProjections();
  await installCanonicalDatabase(db);
  await seedCriticalReadContractFixture(db);
});

after(async () => db.close());

test("authenticated production Organisation, Season and Competition projections remain readable", async () => {
  await assertCriticalReadContracts(db, projections);
});

