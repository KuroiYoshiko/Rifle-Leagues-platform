import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadModule } from "./helpers/aggregate-ui-path.mjs";

const db = new PGlite();
const ownerId = "00000000-0000-0000-0000-000000000001";
const ordinaryId = "00000000-0000-0000-0000-000000000099";

before(async () => {
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create schema private;
    grant usage on schema public to anon, authenticated;

    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;

    create table public.clubs(id bigint primary key, name text, slug text, status text);
    create table public.club_memberships(
      id bigint primary key, club_id bigint, user_id uuid, status text, role text
    );
    create table public.organisations(id bigint primary key, slug text, status text);
    create table public.league_seasons(
      id bigint primary key, organisation_id bigint, slug text, status text,
      starts_at date, ends_at date
    );
    create table public.competitions(
      id bigint primary key, league_season_id bigint, name text, slug text,
      status text, local_scoring_enabled boolean, sets_per_round integer,
      start_date_mode text, custom_starts_at date
    );
    create table public.competition_rounds(
      id bigint primary key, competition_id bigint, round_number integer,
      deadline date, shoot_by_date date
    );
    create table public.competition_score_components(
      id bigint primary key, competition_id bigint, position integer
    );
    create table public.club_competition_entries(
      id bigint primary key, competition_id bigint, club_id bigint, status text
    );
    create table public.competition_entrants(
      id bigint primary key, club_competition_entry_id bigint, position integer
    );
    create table public.competition_entrant_participants(
      id bigint primary key, club_competition_entry_id bigint,
      competition_entrant_id bigint, club_membership_id bigint, slot_number integer
    );
    create table public.competition_score_usages(
      id bigint primary key, shooting_score_source_id bigint,
      competition_id bigint, competition_round_id bigint,
      competition_entrant_participant_id bigint
    );
    create table public.shooting_score_values(
      id bigint primary key, shooting_score_source_id bigint,
      set_number integer, component_position integer
    );

    create function private.get_competition_effective_dates(p_competition_id bigint)
    returns table (
      effective_entry_opens_at date,
      effective_entry_closes_at date,
      effective_starts_at date,
      season_ends_at date
    )
    language sql stable set search_path = '' as $$
      select null::date, null::date,
        case competition.start_date_mode
          when 'custom' then competition.custom_starts_at
          else season.starts_at
        end,
        season.ends_at
      from public.competitions as competition
      join public.league_seasons as season
        on season.id = competition.league_season_id
      where competition.id = p_competition_id
    $$;
  `);

  const sql = await readFile(
    new URL("../database/club-operational-summaries.sql", import.meta.url),
    "utf8",
  );
  await db.exec(sql);
  await db.exec(sql);
});

after(async () => db.close());

beforeEach(async () => {
  await db.exec(`
    begin;
    set request.jwt.claim.sub = '${ownerId}';
    insert into public.organisations values (1, 'county-league', 'active');
    insert into public.league_seasons values (
      1, 1, 'summer-2026', 'active', current_date - 30, current_date + 60
    );
    insert into public.clubs values
      (1, 'Basildon Rifle and Pistol Club', 'basildon-rpc', 'active'),
      (2, 'Another Club', 'another-club', 'active'),
      (3, 'Member Only Club', 'member-only', 'active');
    insert into public.club_memberships values
      (1, 1, '${ownerId}', 'active', 'owner'),
      (2, 2, '${ownerId}', 'active', 'official'),
      (3, 3, '${ordinaryId}', 'active', 'member');
  `);
});

afterEach(async () => {
  await db.exec("rollback; reset role; set request.jwt.claim.sub = '';");
});

async function seedRound({
  clubId = 1,
  competitionId = 1,
  format = "individual",
  teamSize = 1,
  deadlineDays = 10,
  shootByDays = null,
  localScoring = true,
  completedParticipants = [],
  partialParticipants = [],
}) {
  const roundId = competitionId;
  const entryId = competitionId;
  const entrantId = competitionId;
  await db.query(
    `insert into public.competitions values
       ($1, 1, $2, $3, 'published', $4, 2, 'season_default', null)`,
    [
      competitionId,
      `Summer ${format}`,
      `summer-${format}-${competitionId}`,
      localScoring,
    ],
  );
  await db.query(
    `insert into public.competition_rounds values
       ($1, $2, 2, current_date + $3::integer,
        case when $4::integer is null then null else current_date + $4::integer end)`,
    [roundId, competitionId, deadlineDays, shootByDays],
  );
  await db.query(
    `insert into public.competition_score_components values
       ($1 * 10 + 1, $1, 1), ($1 * 10 + 2, $1, 2)`,
    [competitionId],
  );
  await db.query(
    "insert into public.club_competition_entries values ($1,$2,$3,'submitted')",
    [entryId, competitionId, clubId],
  );
  await db.query(
    "insert into public.competition_entrants values ($1,$2,1)",
    [entrantId, entryId],
  );

  for (let index = 0; index < teamSize; index += 1) {
    const participantId = competitionId * 100 + index + 1;
    let membershipId;
    if (index === 0) {
      membershipId = clubId;
    } else {
      membershipId = competitionId * 1000 + index;
      const shooterId = `00000000-0000-0000-0000-${String(
        competitionId * 100 + index,
      ).padStart(12, "0")}`;
      await db.query(
        "insert into public.club_memberships values ($1,$2,$3,'active','member')",
        [membershipId, clubId, shooterId],
      );
    }
    await db.query(
      "insert into public.competition_entrant_participants values ($1,$2,$3,$4,$5)",
      [participantId, entryId, entrantId, membershipId, index + 1],
    );

    const slots = completedParticipants.includes(index)
      ? 4
      : partialParticipants.includes(index)
        ? 3
        : 0;
    if (slots > 0) {
      const sourceId = competitionId * 100 + index + 1;
      await db.query(
        "insert into public.competition_score_usages values ($1,$2,$3,$4,$5)",
        [sourceId, sourceId, competitionId, roundId, participantId],
      );
      const values = [
        [1, 1],
        [1, 2],
        [2, 1],
        [2, 2],
      ].slice(0, slots);
      for (let slotIndex = 0; slotIndex < values.length; slotIndex += 1) {
        await db.query(
          "insert into public.shooting_score_values values ($1,$2,$3,$4)",
          [sourceId * 10 + slotIndex, sourceId, ...values[slotIndex]],
        );
      }
    }
  }
}

async function summaries(userId = ownerId, clubId = null) {
  await db.exec(`set request.jwt.claim.sub = '${userId}'; set role authenticated;`);
  try {
    return (
      await db.query(
        "select * from public.get_club_operational_summaries($1)",
        [clubId],
      )
    ).rows;
  } finally {
    await db.exec("reset role").catch(() => {});
  }
}

test("complete current scores are all on track", async () => {
  await seedRound({ deadlineDays: 4, completedParticipants: [0] });
  const [summary] = await summaries(ownerId, 1);
  assert.equal(summary.attention_status, "all_on_track");
  assert.equal(summary.incomplete_participant_count, 0);
});

test("incomplete work does not warn before the seven-day window", async () => {
  await seedRound({ deadlineDays: 8 });
  const [summary] = await summaries(ownerId, 1);
  assert.equal(summary.attention_status, "all_on_track");
  assert.equal(summary.days_until_cutoff, 8);
});

test("incomplete work within seven days needs action", async () => {
  await seedRound({ deadlineDays: 7 });
  const [summary] = await summaries(ownerId, 1);
  assert.equal(summary.attention_status, "action_needed");
  assert.equal(summary.incomplete_participant_count, 1);
});

test("incomplete work after the cutoff reports deadline passed", async () => {
  await seedRound({ deadlineDays: -1 });
  const [summary] = await summaries(ownerId, 1);
  assert.equal(summary.attention_status, "deadline_passed");
  assert.equal(summary.days_until_cutoff, -1);
});

test("Shoot-by overrides Round End and absent Shoot-by uses Round End", async () => {
  await seedRound({ competitionId: 1, deadlineDays: 20, shootByDays: 2 });
  await seedRound({ competitionId: 2, clubId: 2, deadlineDays: 3 });
  const rows = await summaries();
  const shootBy = rows.find((row) => row.club_id === 1);
  const roundEnd = rows.find((row) => row.club_id === 2);
  assert.equal(shootBy.days_until_cutoff, 2);
  assert.equal(shootBy.attention_status, "action_needed");
  assert.equal(roundEnd.days_until_cutoff, 3);
  assert.equal(roundEnd.attention_status, "action_needed");
});

test("organisation-only scoring creates no Club warning", async () => {
  await seedRound({ deadlineDays: 2, localScoring: false });
  const [summary] = await summaries(ownerId, 1);
  assert.equal(summary.attention_status, "no_active_scoring");
  assert.equal(summary.competition_id, null);
});

test("a Pair remains incomplete when one participant is incomplete", async () => {
  await seedRound({
    format: "pairs",
    teamSize: 2,
    deadlineDays: 2,
    completedParticipants: [0],
  });
  const [summary] = await summaries(ownerId, 1);
  assert.equal(summary.attention_status, "action_needed");
  assert.equal(summary.participant_count, 2);
  assert.equal(summary.complete_participant_count, 1);
  assert.equal(summary.incomplete_participant_count, 1);
});

test("a Team remains incomplete when one participant is incomplete", async () => {
  await seedRound({
    format: "team",
    teamSize: 3,
    deadlineDays: 2,
    completedParticipants: [0, 1],
  });
  const [summary] = await summaries(ownerId, 1);
  assert.equal(summary.attention_status, "action_needed");
  assert.equal(summary.participant_count, 3);
  assert.equal(summary.incomplete_participant_count, 1);
});

test("a score correction immediately updates the derived summary", async () => {
  await seedRound({ deadlineDays: 2, partialParticipants: [0] });
  let [summary] = await summaries(ownerId, 1);
  assert.equal(summary.attention_status, "action_needed");
  await db.exec(`
    insert into public.shooting_score_values values (1013, 101, 2, 2)
  `);
  [summary] = await summaries(ownerId, 1);
  assert.equal(summary.attention_status, "all_on_track");
  assert.equal(summary.incomplete_participant_count, 0);
});

test("managed Club attention is returned first for User Overview", async () => {
  await seedRound({ clubId: 1, competitionId: 1, deadlineDays: 2 });
  await seedRound({
    clubId: 2,
    competitionId: 2,
    deadlineDays: 4,
    completedParticipants: [0],
  });
  const rows = await summaries();
  assert.deepEqual(
    rows.map((row) => [row.club_name, row.attention_status]),
    [
      ["Basildon Rifle and Pistol Club", "action_needed"],
      ["Another Club", "all_on_track"],
    ],
  );
});

test("actionable incomplete work outranks an earlier harmless deadline", async () => {
  await seedRound({
    clubId: 1,
    competitionId: 1,
    deadlineDays: 1,
    completedParticipants: [0],
  });
  await seedRound({ clubId: 1, competitionId: 2, deadlineDays: 5 });
  const [summary] = await summaries(ownerId, 1);
  assert.equal(summary.attention_status, "action_needed");
  assert.equal(summary.competition_id, 2);
  assert.equal(summary.days_until_cutoff, 5);
});

test("ordinary members receive no management action state", async () => {
  assert.deepEqual(await summaries(ordinaryId), []);
});

test("an explicit unauthorised Club read is rejected", async () => {
  await assert.rejects(() => summaries(ordinaryId, 1), /owner or official/i);
});

test("anonymous callers cannot execute the operational RPC", async () => {
  await db.exec("set request.jwt.claim.sub = ''; set role anon;");
  await assert.rejects(
    () => db.query("select * from public.get_club_operational_summaries(null)"),
    /permission denied/i,
  );
});

test("dashboard Club cards and the full widget render the operational hierarchy", async () => {
  const ui = await loadModule("src/components/ui.tsx");
  const presentation = await loadModule(
    "src/lib/club-operational-summary-presentation.ts",
  );
  const widgets = await loadModule(
    "src/components/club-operational-summary.tsx",
    {
      "next/link": {
        __esModule: true,
        default: ({ children, ...props }) => createElement("a", props, children),
      },
      "@/components/ui": ui,
      "@/lib/club-operational-summary-presentation": presentation,
    },
  );
  const dashboardCards = await loadModule(
    "src/components/dashboard-club-cards.tsx",
    {
      "next/link": {
        __esModule: true,
        default: ({ children, ...props }) => createElement("a", props, children),
      },
      "@/components/leave-club-button": { LeaveClubButton: () => null },
      "@/components/ui": ui,
      "@/lib/clubs": {
        getClubLocation: (club) => [club.town, club.county].filter(Boolean).join(", "),
        getClubRoleLabel: (role) => role[0].toUpperCase() + role.slice(1),
      },
      "@/lib/club-operational-summary-presentation": presentation,
    },
  );
  const action = {
    club_id: 1,
    club_name: "Basildon Rifle and Pistol Club",
    club_slug: "basildon-rpc",
    active_member_count: 24,
    active_competition_count: 3,
    attention_status: "action_needed",
    outstanding_score_count: 2,
    competition_id: 1,
    competition_name: "Summer Individual 100",
    competition_slug: "summer-individual-100",
    organisation_slug: "county-league",
    league_season_slug: "summer-2026",
    competition_round_id: 12,
    round_number: 2,
    local_cutoff: "2026-09-08",
    days_until_cutoff: 2,
    participant_count: 6,
    complete_participant_count: 4,
    incomplete_participant_count: 2,
  };
  const healthy = {
    ...action,
    club_id: 2,
    club_name: "Another Club",
    club_slug: "another-club",
    attention_status: "all_on_track",
    incomplete_participant_count: 0,
    complete_participant_count: 6,
  };
  const dashboardHtml = renderToStaticMarkup(
    createElement(dashboardCards.DashboardClubCards, {
      memberships: [
        {
          id: 1,
          club_id: 1,
          status: "active",
          role: "owner",
          created_at: "2026-01-01",
          club: {
            id: 1,
            name: action.club_name,
            slug: action.club_slug,
            town: "Basildon",
            county: "Essex",
          },
        },
        {
          id: 2,
          club_id: 2,
          status: "active",
          role: "official",
          created_at: "2026-01-01",
          club: {
            id: 2,
            name: healthy.club_name,
            slug: healthy.club_slug,
            town: "Chelmsford",
            county: "Essex",
          },
        },
      ],
      operationalSummaries: [action, healthy],
    }),
  );
  const memberHtml = renderToStaticMarkup(
    createElement(dashboardCards.DashboardClubCards, {
      memberships: [{
        id: 3,
        club_id: 3,
        status: "active",
        role: "member",
        created_at: "2026-01-01",
        club: {
          id: 3,
          name: "Member Only Club",
          slug: "member-only",
          town: "Billericay",
          county: "Essex",
        },
      }],
    }),
  );
  const fullHtml = renderToStaticMarkup(
    createElement(widgets.ClubOperationalSummaryCard, { summary: action }),
  );

  assert.ok(dashboardHtml.includes("Action needed"));
  assert.ok(dashboardHtml.includes("Manage scores"));
  assert.ok(dashboardHtml.includes("All required scores currently complete"));
  assert.ok(!dashboardHtml.includes("Club attention"));
  assert.ok(memberHtml.includes("Member Only Club"));
  assert.ok(!memberHtml.includes("incomplete"));
  assert.ok(!memberHtml.includes("Manage scores"));
  assert.ok(fullHtml.includes("target-mark"));
  assert.ok(fullHtml.includes("Active members"));
  assert.ok(fullHtml.includes("Scores required"));
  assert.ok(!dashboardHtml.includes("shooting_score_source_id"));
});

test("overview routes use the cleaned hierarchy with the shared read model", async () => {
  const [dashboardSource, clubSource, clubFrameSource] = await Promise.all([
    readFile(new URL("../src/app/(app)/dashboard/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/(app)/clubs/[slug]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/club-page-frame.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(dashboardSource, /getClubOperationalSummaries\(\)/);
  assert.match(dashboardSource, /operationalSummaries=\{managedClubSummaries\}/);
  assert.match(dashboardSource, /managedClubOrder/);
  assert.doesNotMatch(dashboardSource, /ClubManagementSummary|Club attention/);
  assert.match(clubSource, /manager\s*\?\s*\(await getClubOperationalSummaries\(club\.id\)\)/);
  assert.match(clubSource, /<ClubOperationalSummaryCard/);
  assert.doesNotMatch(clubSource, /ClubMembershipPanel/);
  assert.match(clubFrameSource, /getClubRoleLabel\(membership\.role\)/);
  assert.match(clubFrameSource, /<Badge tone="positive">Active<\/Badge>/);
});
