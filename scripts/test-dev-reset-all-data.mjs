import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { installCanonicalDatabase } from "./helpers/canonical-database.mjs";

const resetPath = new URL("../database/dev/dev-reset-all-data.sql", import.meta.url);
const canonicalInstallerPath = new URL("./helpers/canonical-database.mjs", import.meta.url);
const zeroUuid = "00000000-0000-0000-0000-000000000000";
const referenceTables = new Set(["shooting_equipment_types", "shooting_positions"]);
const db = new PGlite();
let resetSql;
let executableSql;
let canonicalPublicTables;

function withoutComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/--.*$/gm, "");
}

before(async () => {
  [resetSql] = await Promise.all([
    readFile(resetPath, "utf8"),
    installCanonicalDatabase(db, { concurrentShootingStage3a: true }),
  ]);
  executableSql = withoutComments(resetSql);
  const result = await db.query(`
    select tablename
    from pg_catalog.pg_tables
    where schemaname = 'public'
    order by tablename
  `);
  canonicalPublicTables = result.rows.map(({ tablename }) => tablename);
});

after(async () => db.close());

test("reset is visibly destructive local/staging tooling with an enforced placeholder", () => {
  assert.match(resetSql, /DEVELOPMENT \/ STAGING ONLY/);
  assert.match(resetSql, /DESTRUCTIVE/);
  assert.match(resetSql, /NEVER RUN AGAINST PRODUCTION/);
  assert.match(
    executableSql,
    new RegExp(`v_keep_user_id\\s+constant\\s+uuid\\s*:=\\s*'${zeroUuid}'`, "i"),
  );
  assert.equal(resetSql.split(zeroUuid).length - 1, 1);
  assert.match(
    executableSql,
    /if\s+v_keep_user_id::text\s*=\s*repeat\('0',\s*8\)[\s\S]*?then/i,
  );
  assert.match(executableSql, /RESET ABORTED: replace the zero v_keep_user_id UUID/i);
});

test("reset preserves the selected Auth user and its identities", () => {
  assert.match(
    executableSql,
    /delete\s+from\s+auth\.users[\s\S]*?where\s+users\.id\s*<>\s*v_keep_user_id\s*;/i,
  );
  assert.doesNotMatch(executableSql, /delete\s+from\s+auth\.identities/i);
  const truncateStatement = executableSql.match(/truncate\s+table([\s\S]*?);/i);
  assert.ok(truncateStatement);
  assert.doesNotMatch(truncateStatement[0], /auth\./i);
  assert.match(executableSql, /from\s+auth\.identities[\s\S]*?identities\.user_id\s*=\s*v_keep_user_id/i);
  assert.match(executableSql, /v_keep_identity_count_after\s*<>\s*v_keep_identity_count_before/i);
  assert.match(executableSql, /v_auth_users_remaining\s*<>\s*1/i);
});

test("reset contains no schema-destructive statements or trigger weakening", () => {
  assert.doesNotMatch(executableSql, /\bdrop\s+(table|view|materialized\s+view|function|trigger|schema)\b/i);
  assert.doesNotMatch(executableSql, /\balter\s+table\b[\s\S]*?\b(disable|enable)\s+trigger\b/i);
  assert.doesNotMatch(executableSql, /\bset\s+session_replication_role\b/i);
  assert.doesNotMatch(executableSql, /\btruncate\b[\s\S]*?\bcascade\b/i);
  assert.doesNotMatch(executableSql, /\brestart\s+identity\b/i);
  assert.match(executableSql, /^\s*begin\s*;/i);
  assert.match(executableSql, /commit\s*;\s*$/i);
});

test("every canonical application table is reset and only built-in taxonomies survive", () => {
  const truncateStatement = executableSql.match(/truncate\s+table([\s\S]*?);/i);
  assert.ok(truncateStatement, "expected one application-table TRUNCATE statement");
  const resetTables = new Set(
    [...truncateStatement[1].matchAll(/public\.([a-z][a-z0-9_]*)/gi)]
      .map((match) => match[1]),
  );
  const domainArray = executableSql.match(
    /v_domain_tables\s+constant\s+text\[\]\s*:=\s*array\[([\s\S]*?)\];/i,
  );
  assert.ok(domainArray, "expected the validation table array");
  const validatedTables = new Set(
    [...domainArray[1].matchAll(/'([a-z][a-z0-9_]*)'/gi)]
      .map((match) => match[1]),
  );
  const expectedDomainTables = canonicalPublicTables
    .filter((table) => !referenceTables.has(table));

  assert.deepEqual([...resetTables].sort(), expectedDomainTables);
  assert.deepEqual([...validatedTables].sort(), expectedDomainTables);
  assert.deepEqual(
    canonicalPublicTables.filter((table) => !resetTables.has(table)),
    [...referenceTables].sort(),
  );
  assert.match(executableSql, /foreach\s+v_table_name\s+in\s+array\s+v_domain_tables/i);
});

test("reset is outside the canonical database installer", async () => {
  const canonicalInstaller = await readFile(canonicalInstallerPath, "utf8");
  assert.doesNotMatch(canonicalInstaller, /dev-reset-all-data/);
});

test("placeholder aborts and an edited copy resets only a disposable database", async () => {
  const runtimeDb = new PGlite();
  const keepUserId = "90000000-0000-4000-8000-000000000001";
  const disposableUserId = "90000000-0000-4000-8000-000000000002";

  try {
    await installCanonicalDatabase(runtimeDb, { concurrentShootingStage3a: true });
    await runtimeDb.exec(`
      create table auth.identities (
        id uuid primary key,
        user_id uuid not null references auth.users(id) on delete cascade
      );
    `);

    await assert.rejects(
      runtimeDb.exec(resetSql),
      /RESET ABORTED: replace the zero v_keep_user_id UUID/,
    );
    await runtimeDb.exec("rollback");

    await runtimeDb.query(
      "insert into auth.users(id) values ($1), ($2)",
      [keepUserId, disposableUserId],
    );
    await runtimeDb.query(
      "insert into auth.identities(id,user_id) values ($1,$2), ($3,$4)",
      [
        "91000000-0000-4000-8000-000000000001", keepUserId,
        "91000000-0000-4000-8000-000000000002", disposableUserId,
      ],
    );
    await runtimeDb.exec(`
      insert into public.organisations(name,slug,status)
      values ('Disposable Organisation','disposable-organisation','active');
      insert into public.clubs(name,slug,status)
      values ('Disposable Club','disposable-club','active');
      insert into public.club_teams(club_id,name,display_order)
      select id,'Disposable Team',1 from public.clubs where slug='disposable-club';
    `);

    const editedSql = resetSql.replace(
      `v_keep_user_id constant uuid := '${zeroUuid}'`,
      `v_keep_user_id constant uuid := '${keepUserId}'`,
    );
    await runtimeDb.exec(editedSql);

    const users = await runtimeDb.query("select id from auth.users order by id");
    const identities = await runtimeDb.query(
      "select user_id from auth.identities order by user_id",
    );
    const domainCounts = await runtimeDb.query(`
      select
        (select count(*) from public.profiles) as profiles,
        (select count(*) from public.organisations) as organisations,
        (select count(*) from public.club_teams) as club_teams,
        (select count(*) from public.shooting_equipment_types) as equipment_types,
        (select count(*) from public.shooting_positions) as positions
    `);

    assert.deepEqual(users.rows, [{ id: keepUserId }]);
    assert.deepEqual(identities.rows, [{ user_id: keepUserId }]);
    assert.deepEqual(domainCounts.rows, [{
      profiles: 0,
      organisations: 0,
      club_teams: 0,
      equipment_types: 8,
      positions: 4,
    }]);
  } finally {
    await runtimeDb.close();
  }
});
