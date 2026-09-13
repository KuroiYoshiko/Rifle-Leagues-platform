import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { installCanonicalDatabase } from "./helpers/canonical-database.mjs";
import { buildStagingDemoModel, AS_OF_DATE } from "./lib/staging-demo-model.mjs";
import { seedStagingDemoDomain } from "./lib/seed-staging-demo-domain.mjs";

const showcase = {
  email: "showcase-owner@example.invalid",
  firstName: "Ada",
  lastName: "Lovelace",
};
const model = buildStagingDemoModel(showcase);
const competitionByKey = new Map(model.competitions.map((item) => [item.key, item]));
const seasonByKey = new Map(model.seasons.map((item) => [item.key, item]));

const hasShooter = (participation, shooterKey) => participation.entrants.some((entrant) => (
  entrant.members.some((member) => member.shooterKey === shooterKey)
));

const quoteIdentifier = (value) => value.split(".")
  .map((part) => `"${part.replaceAll('"', '""')}"`).join(".");

function pglitePostgresTag(database, { onJson = () => {} } = {}) {
  const makeTag = (connection) => {
    function helper(value, ...columns) {
      if (typeof value === "string" && columns.length === 0) {
        return { fragment: quoteIdentifier(value), parameters: [] };
      }
      if (Array.isArray(value) && columns.length === 0) {
        return {
          fragment: `(${value.map((_, index) => `$${index + 1}`).join(", ")})`,
          parameters: value,
        };
      }
      if (Array.isArray(value) && columns.length > 0) {
        const parameters = [];
        const tuples = value.map((row) => `(${columns.map((column) => {
          parameters.push(row[column]);
          return `$${parameters.length}`;
        }).join(", ")})`);
        return {
          fragment: `(${columns.map(quoteIdentifier).join(", ")}) values ${tuples.join(", ")}`,
          parameters,
        };
      }
      throw new Error("Unsupported disposable SQL helper input");
    }
    const tag = async (strings, ...values) => {
      let statement = strings[0];
      const parameters = [];
      values.forEach((value, index) => {
        if (value?.fragment) {
          statement += value.fragment.replace(/\$(\d+)/g, (_, position) => `$${parameters.length + Number(position)}`);
          parameters.push(...value.parameters);
        } else {
          parameters.push(value);
          statement += `$${parameters.length}`;
        }
        statement += strings[index + 1];
      });
      const result = await connection.query(statement, parameters);
      const bigintFields = new Set(
        result.fields.filter((field) => field.dataTypeID === 20).map((field) => field.name),
      );
      // Match Postgres.js' default int8 decoder. Without this parity layer,
      // PGlite returns bigint IDs as numbers and can conceal JSON payload bugs
      // that only occur through the hosted seed's Postgres.js connection.
      return result.rows.map((row) => Object.fromEntries(
        Object.entries(row).map(([name, value]) => [
          name,
          bigintFields.has(name) && value !== null ? String(value) : value,
        ]),
      ));
    };
    tag.json = (value) => {
      onJson(value);
      return { fragment: "$1::jsonb", parameters: [JSON.stringify(value)] };
    };
    return new Proxy(tag, { apply: (_target, _this, argumentsList) => (
      Array.isArray(argumentsList[0]) && Object.hasOwn(argumentsList[0], "raw")
        ? tag(...argumentsList)
        : helper(...argumentsList)
    ) });
  };
  const tag = makeTag(database);
  tag.begin = (callback) => database.transaction((transaction) => callback(makeTag(transaction)));
  return tag;
}

test("generation is deterministic and has the intended top-level scale", () => {
  assert.deepEqual(buildStagingDemoModel(showcase), buildStagingDemoModel(showcase));
  assert.equal(model.organisations.length, 3);
  assert.equal(model.organisations.flatMap((item) => item.clubs).length, 15);
  assert.equal(model.shooters.length, 96);
  assert.equal(model.seasons.length, 18);
  assert.equal(model.series.length, 21);
  assert.equal(model.competitions.length, 91);
});

test("visible names are realistic and the required showcase entities exist", () => {
  const visibleNames = [
    ...model.organisations.map((item) => item.name),
    ...model.organisations.flatMap((item) => item.clubs.map((club) => club.name)),
    ...model.series.map((item) => item.name),
    ...model.competitions.map((item) => item.name),
    ...model.shooters.map((item) => `${item.firstName} ${item.lastName}`),
  ];
  assert.ok(model.organisations.some((item) => item.name === "Eastern Region Shooting Association"));
  assert.ok(model.organisations.flatMap((item) => item.clubs)
    .some((item) => item.name === "Basildon Rifle and Pistol Club"));
  assert.ok(visibleNames.every((name) => !/\b(?:demo|test|fixture)\b/i.test(name)));
});

test("synthetic names are unique and naturally distributed within Organisations", () => {
  const synthetic = model.shooters.filter((item) => !item.showcase);
  const fullNames = synthetic.map((item) => `${item.firstName} ${item.lastName}`);
  assert.equal(new Set(fullNames).size, synthetic.length);

  for (const organisation of model.organisations) {
    const members = synthetic.filter((item) => item.organisationKey === organisation.key);
    const surnames = members.map((item) => item.lastName);
    const frequencies = new Map(surnames.map((surname) => [
      surname, surnames.filter((item) => item === surname).length,
    ]));
    let longestRun = 1;
    let currentRun = 1;
    for (let index = 1; index < surnames.length; index += 1) {
      currentRun = surnames[index] === surnames[index - 1] ? currentRun + 1 : 1;
      longestRun = Math.max(longestRun, currentRun);
    }
    assert.ok(new Set(surnames).size >= 20, `${organisation.key} has too little surname variety`);
    assert.ok(Math.max(...frequencies.values()) <= 2, `${organisation.key} repeats a surname too often`);
    assert.ok(longestRun <= 1, `${organisation.key} has a contiguous surname block`);
  }
});

test("Series recur across Seasons while the One-off remains unlinked", () => {
  for (const series of model.series) {
    const editions = model.competitions.filter((item) => item.seriesKey === series.key);
    assert.ok(editions.length >= 3, `${series.key} has too little history`);
    assert.ok(new Set(editions.map((item) => item.seasonKey)).size === editions.length);
  }
  const oneOffs = model.competitions.filter((item) => item.oneOff);
  assert.equal(oneOffs.length, 1);
  assert.equal(oneOffs[0].key, "eastern:summer-2026:eastern-dewar-open");
  assert.equal(oneOffs[0].seriesKey, null);
});

test("persistent participation is selective rather than universal", () => {
  const recurringCompetitions = model.competitions.filter((item) => !item.oneOff);
  const participationCounts = new Map(model.shooters.map((shooter) => [shooter.key, 0]));
  for (const participation of model.participations) {
    for (const entrant of participation.entrants) {
      for (const member of entrant.members) {
        participationCounts.set(member.shooterKey, participationCounts.get(member.shooterKey) + 1);
      }
    }
  }
  assert.ok([...participationCounts.values()].every((count) => count < recurringCompetitions.length / 2));

  const normal = model.shooters.find((item) => item.key === "eastern-01");
  const normalSeries = new Map();
  for (const participation of model.participations.filter((item) => hasShooter(item, normal.key))) {
    const competition = competitionByKey.get(participation.competitionKey);
    if (!competition.seriesKey) continue;
    normalSeries.set(competition.seriesKey, (normalSeries.get(competition.seriesKey) ?? 0) + 1);
  }
  assert.ok([...normalSeries.values()].some((count) => count >= 3), "a normal shooter should return to a Series");
});

test("showcase shooter enters every applicable edition of exactly four persistent Series", () => {
  const showcaseShooter = model.shooters.find((item) => item.showcase);
  assert.deepEqual(showcaseShooter.seriesKeys, [
    "prone-individual", "prone-pairs", "air-rifle", "three-position",
  ]);
  const participations = model.participations.filter((item) => hasShooter(item, "showcase"));
  const recurringSeries = new Set(participations.map((item) => competitionByKey.get(item.competitionKey).seriesKey));
  assert.equal(recurringSeries.size, 4);
  assert.ok(!recurringSeries.has(null));
  assert.ok(participations.every((item) => !competitionByKey.get(item.competitionKey).oneOff));

  const applicableEditions = model.competitions.filter((item) => item.organisationKey === "eastern"
    && !item.oneOff && showcaseShooter.seriesKeys.includes(item.templateKey));
  assert.deepEqual(
    participations.map((item) => item.competitionKey).sort(),
    applicableEditions.map((item) => item.key).sort(),
  );
  for (const competition of applicableEditions) {
    const season = seasonByKey.get(competition.seasonKey);
    const scoredRounds = new Set(model.scores.filter((source) => source.shooterKey === "showcase"
      && source.usages.some((usage) => usage.competitionKey === competition.key))
      .map((source) => source.roundNumber));
    const expectedRounds = competition.rounds
      .filter((round) => round.deadline < AS_OF_DATE)
      .map((round) => round.number);
    assert.deepEqual([...scoredRounds].sort((left, right) => left - right), expectedRounds);
    if (season.status === "open") assert.equal(scoredRounds.size, 0);
  }

  const sources = model.scores.filter((item) => item.shooterKey === "showcase");
  assert.equal(sources.length, 138);
  assert.equal(sources.flatMap((item) => item.usages).length, 147);
  assert.equal(sources.filter((item) => item.usages.length > 1).length, 9);
});

test("source timestamps are unique and belong to their Competition Round history", () => {
  assert.equal(new Set(model.scores.map((item) => item.occurredAt)).size, model.scores.length);
  for (const source of model.scores) {
    assert.notEqual(source.occurredAt.slice(0, 4), "2020");
    for (const usage of source.usages) {
      const round = competitionByKey.get(usage.competitionKey).rounds[usage.roundNumber - 1];
      assert.equal(source.occurredAt.slice(0, 10), round.deadline);
      assert.ok(source.occurredAt >= `${round.deadline}T00:00:00.000Z`);
      assert.ok(source.occurredAt <= `${round.deadline}T23:59:59.999Z`);
    }
  }
});

test("each Eastern released Season has one missing-not-zero dropout", () => {
  assert.deepEqual(
    model.dropoutCases.map((item) => item.seasonKey),
    [
      "eastern:summer-2024",
      "eastern:winter-2024",
      "eastern:summer-2025",
      "eastern:winter-2025",
      "eastern:summer-2026",
    ],
  );
  for (const dropout of model.dropoutCases) {
    const relevant = model.scores.filter((source) => source.shooterKey === dropout.shooterKey
      && source.usages.some((usage) => usage.competitionKey === dropout.competitionKey));
    assert.deepEqual(relevant.map((source) => source.roundNumber), [1, 2, 3, 4]);
    assert.ok(relevant.flatMap((source) => source.values).every((value) => value.achieved > 0));
  }
});

test("Season states, ten-Round chronology, and unreleased data are correct", () => {
  for (const organisation of model.organisations) {
    const seasons = model.seasons.filter((item) => item.organisationKey === organisation.key);
    assert.equal(seasons.filter((item) => item.status === "active").length, 1);
    assert.equal(seasons.filter((item) => item.status === "open").length, 1);
    assert.equal(seasons.find((item) => item.slug === "summer-2026").status, "active");
    assert.equal(seasons.find((item) => item.slug === "winter-2026").status, "open");
  }
  for (const competition of model.competitions) {
    assert.equal(competition.rounds.length, 10);
    assert.ok(competition.rounds.every((round, index) => index === 0
      || round.deadline > competition.rounds[index - 1].deadline));
    assert.ok(competition.rounds.every((round) => round.shootByDate < round.deadline));
  }
  assert.ok(model.scores.every((source) => source.usages.every((usage) => (
    competitionByKey.get(usage.competitionKey).rounds[usage.roundNumber - 1].deadline < AS_OF_DATE
  ))));
  assert.ok(model.competitions.filter((item) => item.seasonKey.endsWith("winter-2026"))
    .every((competition) => !model.scores.some((source) => source.usages
      .some((usage) => usage.competitionKey === competition.key))));
});

test("all achieved scores and X counts stay within their Course bounds", () => {
  for (const source of model.scores) {
    for (const usage of source.usages) {
      const competition = competitionByKey.get(usage.competitionKey);
      source.values.forEach((value, index) => {
        const component = competition.components[index];
        assert.ok(value.achieved > 0 && value.achieved <= component.maximum);
        if (competition.usesX) assert.ok(value.xCount >= 0 && value.xCount <= component.shots);
        else assert.equal(value.xCount, null);
      });
    }
  }
});

test("Concurrent fixture reuses exactly one physical source per shooter/Round", () => {
  const shared = model.scores.filter((item) => item.concurrent && item.usages.length > 1);
  assert.ok(shared.length > 0);
  for (const source of shared) {
    assert.equal(new Set(source.usages.map((item) => item.competitionKey)).size, 2);
    assert.equal(new Set(source.usages.map((item) => item.roundNumber)).size, 1);
    assert.equal(new Set(source.usages.map((item) => item.shooterKey)).size, 1);
  }
  assert.equal(new Set(model.scores.map((item) => item.key)).size, model.scores.length);
});

test("Average programs separate incompatible structured disciplines and map intended Series", () => {
  const eastern = model.averagePrograms.find((program) => program.organisationKey === "eastern");
  assert.equal(model.averagePrograms.length, 3);
  assert.equal(model.averagePrograms.reduce((sum, program) => sum + program.contexts.length, 0), 14);
  assert.deepEqual(eastern.contexts.map((context) => context.seriesKeys), [
    ["prone-individual", "prone-pairs"],
    ["club-team"],
    ["benchrest"],
    ["air-rifle"],
    ["three-position"],
    ["gallery-rifle"],
  ]);
  assert.ok(model.averagePrograms.every((program) => (
    program.strategy === "current_then_preceding"
    && program.configuration.fallback === "manual"
  )));

  for (const program of model.averagePrograms) {
    const configuredSeries = program.contexts.flatMap((context) => context.seriesKeys);
    assert.equal(new Set(configuredSeries).size, configuredSeries.length);
    for (const context of program.contexts) {
      const signatures = context.seriesKeys.map((localKey) => {
        const series = model.series.find((item) => (
          item.organisationKey === program.organisationKey && item.slug === localKey
        ));
        return JSON.stringify({
          equipment: series.equipment,
          customEquipment: series.customEquipment,
          usesX: series.usesX,
          components: series.components,
        });
      });
      assert.equal(new Set(signatures).size, 1, `${program.organisationKey}:${context.key} mixes Courses`);
    }
  }
});

test("runner has hard safety guards and stays outside canonical deployment", async () => {
  const [runner, domain, canonical, packageJson] = await Promise.all([
    readFile(new URL("./seed-staging-demo.mjs", import.meta.url), "utf8"),
    readFile(new URL("./lib/seed-staging-demo-domain.mjs", import.meta.url), "utf8"),
    readFile(new URL("./helpers/canonical-database.mjs", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
  assert.match(runner, /DEVELOPMENT \/ STAGING ONLY/);
  assert.match(runner, /SHOWCASE_USER_ID must not be the zero UUID/);
  assert.match(runner, /auth_users !== 1/);
  assert.match(runner, /public\.starting_average_score_sources/);
  assert.match(runner, /admin\.createUser/);
  assert.match(runner, /Promise\.allSettled/);
  assert.match(runner, /createdSyntheticUserIds\.push\(data\.user\.id\)/);
  assert.match(runner, /admin\.deleteUser\(userId\)/);
  assert.match(domain, /private\.shooting_score_source_state\(event\.shooting_score_source_id\)/);
  assert.match(domain, /calculate_competition_starting_averages/);
  assert.match(domain, /freeze_competition_starting_averages/);
  assert.doesNotMatch(domain, /insert into public\.competition_participant_starting_averages/i);
  assert.doesNotMatch(domain, /after_state:\s*JSON\.stringify/);
  assert.doesNotMatch(`${runner}\n${domain}`, /\b(?:truncate|delete\s+from|drop\s+(?:table|schema|function|trigger|view))\b/i);
  assert.doesNotMatch(canonical, /seed-staging-demo|staging-demo-model/);
  assert.match(packageJson, /"seed:staging-demo"/);
  assert.doesNotMatch(`${runner}\n${domain}`, /[\w.+-]+@(?!shooters\.invalid)[\w.-]+\.[a-z]{2,}/i);
});

test("model does not embed the runtime showcase identity", () => {
  const defaultModel = buildStagingDemoModel();
  const defaultShowcase = defaultModel.shooters.find((item) => item.showcase);
  assert.equal(defaultShowcase.email, null);
  assert.equal(defaultShowcase.authId, undefined);
  assert.ok(model.shooters.filter((item) => !item.showcase)
    .every((item) => item.email.endsWith("@shooters.invalid")));
  assert.equal(seasonByKey.get("eastern:summer-2026").status, "active");
});

test("domain writer satisfies the complete canonical schema and its validations", { timeout: 300_000 }, async () => {
  const database = new PGlite();
  try {
    await installCanonicalDatabase(database, { concurrentShootingStage3a: true });
    const integrationModel = buildStagingDemoModel(showcase);
    integrationModel.shooters.forEach((shooter, index) => {
      shooter.authId = `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
    });
    integrationModel.showcaseUserId = integrationModel.shooters.find((item) => item.showcase).authId;
    const authRows = integrationModel.shooters.map((shooter) => ({
      id: shooter.authId,
      raw_user_meta_data: { first_name: shooter.firstName, last_name: shooter.lastName },
    }));
    for (const row of authRows) {
      await database.query(
        "insert into auth.users (id, raw_user_meta_data) values ($1, $2::jsonb)",
        [row.id, JSON.stringify(row.raw_user_meta_data)],
      );
    }

    const submittedDivisionPayloads = [];
    const summary = await seedStagingDemoDomain(pglitePostgresTag(database, {
      onJson(value) {
        if (Array.isArray(value) && value.every((item) => (
          item && typeof item === "object" && Array.isArray(item.entrant_ids)
        ))) submittedDivisionPayloads.push(value);
      },
    }), integrationModel);
    assert.deepEqual(
      {
        organisations: summary.organisations,
        clubs: summary.clubs,
        shooters: summary.shooters,
        seasons: summary.seasons,
        series: summary.series,
        competitions: summary.competitions,
        rounds: summary.rounds,
        concurrentGroups: summary.concurrent_groups,
        averageContexts: summary.average_contexts,
      },
      {
        organisations: 3,
        clubs: 15,
        shooters: 96,
        seasons: 18,
        series: 21,
        competitions: 91,
        rounds: 910,
        concurrentGroups: 1,
        averageContexts: 14,
      },
    );
    assert.equal(summary.showcaseStatistics.physical_shoot_count, 138);
    assert.equal(summary.integrity.active_v2_groups, 1);
    assert.equal(summary.integrity.showcase_shared_sources, 9);
    assert.equal(summary.integrity.invalid_concurrent_audit_events, 0);
    assert.equal(summary.integrity.implausible_source_timestamps, 0);
    assert.ok(summary.integrity.frozen_calculated_averages > 0);
    assert.deepEqual({
      policies: summary.average_policies,
      policyVersions: summary.average_policy_versions,
      seriesDefaults: summary.series_average_defaults,
      competitionSettings: summary.competition_average_settings,
      finalisations: summary.average_finalisations,
      snapshots: summary.starting_average_snapshots,
      frozenSnapshots: summary.frozen_starting_averages,
      frozenValues: summary.frozen_starting_average_values,
      frozenNoHistory: summary.frozen_no_history_snapshots,
      provisionalSnapshots: summary.provisional_starting_averages,
      publishedDivisionConfigs: summary.published_division_configs,
      draftDivisionConfigs: summary.draft_division_configs,
    }, {
      policies: 3,
      policyVersions: 3,
      seriesDefaults: 17,
      competitionSettings: 78,
      finalisations: 65,
      snapshots: 1306,
      frozenSnapshots: 1095,
      frozenValues: 805,
      frozenNoHistory: 290,
      provisionalSnapshots: 211,
      publishedDivisionConfigs: 71,
      draftDivisionConfigs: 13,
    });
    assert.equal(summary.integrity.incompatible_structured_contexts, 0);
    assert.equal(summary.integrity.incompatible_score_bases, 0);
    assert.equal(summary.integrity.calculated_provenance_mismatches, 0);
    assert.equal(summary.integrity.nonchronological_starting_averages, 0);
    assert.equal(summary.integrity.manually_supplied_starting_averages, 0);
    assert.equal(summary.integrity.persisted_running_average_columns, 0);
    assert.ok(summary.integrity.current_running_average_values > 0);
    assert.ok(summary.integrity.showcase_frozen_average_series >= 4);
    assert.ok(summary.integrity.current_frozen_average_values > summary.integrity.current_frozen_no_history);
    assert.equal(summary.integrity.deliberate_first_time_nulls, 1);
    assert.equal(summary.integrity.eastern_prone_division_configs, 6);

    const historicalPairDivisionRegression = (await database.query(`
      select
        c.entry_format,
        c.ranking_method,
        count(distinct e.id)::integer as entrant_units,
        count(distinct a.competition_entrant_id)::integer as assigned_units,
        count(*) filter (
          where a.competition_entrant_id is not null
            and (ae.competition_id <> c.id or ae.status <> 'submitted')
        )::integer as invalid_assignments
      from public.organisations o
      join public.league_seasons s on s.organisation_id = o.id
      join public.competitions c on c.league_season_id = s.id
      join public.club_competition_entries e0
        on e0.competition_id = c.id and e0.status = 'submitted'
      join public.competition_entrants e on e.club_competition_entry_id = e0.id
      left join public.competition_division_assignments a
        on a.competition_id = c.id and a.competition_entrant_id = e.id
      left join public.competition_entrants assigned on assigned.id = a.competition_entrant_id
      left join public.club_competition_entries ae on ae.id = assigned.club_competition_entry_id
      where o.slug = 'eastern-region-shooting-association'
        and s.slug = 'summer-2024'
        and c.slug = 'prone-pairs'
      group by c.id, c.entry_format, c.ranking_method
    `)).rows[0];
    assert.deepEqual(historicalPairDivisionRegression, {
      entry_format: "pairs",
      ranking_method: "round_robin",
      entrant_units: historicalPairDivisionRegression.entrant_units,
      assigned_units: historicalPairDivisionRegression.entrant_units,
      invalid_assignments: 0,
    });
    assert.ok(historicalPairDivisionRegression.entrant_units > 0);
    const firstRoundRobinPayload = submittedDivisionPayloads[0];
    assert.ok(firstRoundRobinPayload.length > 0);
    assert.equal(
      firstRoundRobinPayload.flatMap((division) => division.entrant_ids).length,
      historicalPairDivisionRegression.entrant_units,
    );
    assert.ok(firstRoundRobinPayload.every((division) => division.entrant_ids.every((entrantId) => (
      Number.isSafeInteger(entrantId) && entrantId > 0
    ))));

    const realisticResults = (await database.query(`
      select c.slug, c.ranking_method,
        case c.ranking_method
          when 'best_n_average' then public.get_competition_best_n_average_results(o.id,s.id,c.id)
          when 'aggregate' then public.get_competition_aggregate_results(o.id,s.id,c.id)
        end as result
      from public.organisations o
      join public.league_seasons s on s.organisation_id=o.id
      join public.competitions c on c.league_season_id=s.id
      where o.slug='eastern-region-shooting-association'
        and s.slug='summer-2026'
        and c.slug in ('benchrest','prone-individual')
      order by c.slug
    `)).rows;
    const benchrest = realisticResults.find((row) => row.ranking_method === "best_n_average")?.result;
    const proneAggregate = realisticResults.find((row) => row.ranking_method === "aggregate")?.result;
    assert.equal(benchrest.status, "ready");
    assert.equal(benchrest.best_rounds_count, 8);
    assert.equal(benchrest.rounds.length, 10);
    assert.ok(benchrest.groups.length >= 3);
    assert.ok(benchrest.groups.flatMap((group) => group.entrants).length >= 10);
    assert.ok(benchrest.groups.flatMap((group) => group.entrants)
      .every((entrant) => entrant.rounds.filter((_, index) => !benchrest.rounds[index].released)
        .every((round) => round.state === "pending" && round.gun_score === null)));
    assert.equal(proneAggregate.status, "ready");
    assert.ok(proneAggregate.groups.length >= 3);
    assert.ok(proneAggregate.groups.every((group) => /^Division \d+$/.test(group.name)));
    assert.equal(proneAggregate.rounds.length, 10);

    const publicIndividualAverageContexts = (await database.query(`
      select o.id as organisation_id, s.id as season_id, c.id as competition_id,
        c.slug, c.ranking_method
      from public.organisations o
      join public.league_seasons s on s.organisation_id = o.id
      join public.competitions c on c.league_season_id = s.id
      where o.slug = 'eastern-region-shooting-association'
        and s.slug = 'summer-2026'
        and c.slug in ('benchrest', 'three-position')
      order by c.slug
    `)).rows;
    await database.exec("set role anon");
    const publicIndividualAverageResults = [];
    for (const context of publicIndividualAverageContexts) {
      const [{ averages }] = (await database.query(
        "select public.get_competition_result_averages($1,$2,$3) as averages",
        [context.organisation_id, context.season_id, context.competition_id],
      )).rows;
      publicIndividualAverageResults.push({ ...context, averages });
    }
    await database.exec("reset role");
    assert.deepEqual(
      publicIndividualAverageResults.map((row) => row.ranking_method).sort(),
      ["aggregate", "best_n_average"],
    );
    for (const row of publicIndividualAverageResults) {
      assert.ok(row.averages.participants.length > 0, `${row.slug} has no Average participants`);
      assert.ok(row.averages.participants.some((participant) => (
        participant.starting_average !== null
      )), `${row.slug} has no public frozen S/Av`);
      assert.ok(row.averages.participants.some((participant) => (
        participant.running_average !== null
      )), `${row.slug} has no live released R/Av`);
    }

    const audit = (await database.query(`
      select count(*)::integer as event_count,
        bool_and(jsonb_typeof(event.after_state) = 'object') as objects_only,
        bool_and(event.before_state is null) as create_before_state_is_null,
        bool_and(event.after_state = private.shooting_score_source_state(event.shooting_score_source_id))
          as matches_canonical_state
      from public.shooting_score_change_events as event
    `)).rows[0];
    assert.ok(audit.event_count > 0);
    assert.equal(audit.objects_only, true);
    assert.equal(audit.create_before_state_is_null, true);
    assert.equal(audit.matches_canonical_state, true);
  } finally {
    await database.close();
  }
});
