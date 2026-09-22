import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("draft Competition readiness is role-aware and shares publication validators", async () => {
  const [page, card, competitionsSql, shootingSql] = await Promise.all([
    read("src/app/(app)/organisations/[slug]/leagues/[seasonSlug]/competitions/[competitionSlug]/page.tsx"),
    read("src/components/competition-readiness-card.tsx"),
    read("database/05_competitions.sql"),
    read("database/14_shooting_details.sql"),
  ]);
  assert.match(page, /managementContext && competition\.status === "draft"/);
  assert.match(page, /<CompetitionReadinessCard[\s\S]*isOwner=\{isOwner\}/);
  assert.match(page, /<CompetitionLifecycleActions[\s\S]*showPublishAction=\{false\}/);
  assert.match(card, /Competition not ready to publish/);
  assert.match(card, /readiness\.requirements\.map/);
  assert.match(card, /Ready to publish/);
  assert.match(card, /Publishing makes this Competition visible when its Season is public/);
  assert.match(card, /Ready for owner review/);
  assert.match(card, /An Organisation Owner must publish this Competition/);
  assert.match(card, /\{isOwner \? \([\s\S]*Publish competition/);
  assert.match(competitionsSql, /competition_publication_readiness_errors/);
  assert.match(competitionsSql, /foreach v_publication_error in array private\.competition_publication_readiness_errors/);
  assert.match(shootingSql, /private\.competition_publication_readiness_errors/);
  assert.match(shootingSql, /private\.competition_has_complete_shooting_details/);
});

test("Competition lifecycle badges are management-only and inline with titles", async () => {
  const [detail, season] = await Promise.all([
    read("src/app/(app)/organisations/[slug]/leagues/[seasonSlug]/competitions/[competitionSlug]/page.tsx"),
    read("src/app/(app)/organisations/[slug]/leagues/[seasonSlug]/page.tsx"),
  ]);
  assert.match(detail, /flex min-w-0 flex-wrap items-center gap-3[\s\S]*<h2[\s\S]*\{competition\.name\}[\s\S]*\{managementContext \? \([\s\S]*<Badge/);
  assert.match(detail, /managementContext \? \([\s\S]*data-competition-lifecycle-badge/);
  assert.doesNotMatch(detail, /<Badge[\s\S]{0,180}<h2/);
  assert.match(season, /<h3[\s\S]*\{competition\.name\}[\s\S]*\{canManage \? \([\s\S]*<Badge/);
  assert.match(season, /canManage \? \([\s\S]*data-competition-lifecycle-badge/);
  assert.doesNotMatch(season, /<Badge[\s\S]{0,180}<h3/);
});

test("draft Season guidance and status meanings preserve Owner and Manager differences", async () => {
  const [page, form] = await Promise.all([
    read("src/app/(app)/organisations/[slug]/leagues/[seasonSlug]/page.tsx"),
    read("src/components/league-season-form.tsx"),
  ]);
  assert.match(page, /season\.status === "draft" && managementContext/);
  assert.match(page, /Add and review its Competitions/);
  assert.match(page, /An Organisation Owner must move the Season to Open/);
  const guidance = page.slice(
    page.indexOf("data-draft-season-guidance"),
    page.indexOf('<section className="mt-10" aria-label="Competitions">'),
  );
  assert.doesNotMatch(guidance, /<Link|Add competition|Edit season/);
  assert.match(form, /draft: "Visible only to Organisation management/);
  assert.match(form, /open: "Public; configured Competition entry windows can accept entries/);
  assert.match(form, /active: "Public; entries are closed and shooting is underway/);
  assert.match(form, /completed: "Public historical and final Season state/);
});

test("empty Season collections own the sole primary creation action", async () => {
  const [seasonsPage, seasonPage] = await Promise.all([
    read("src/app/(app)/organisations/[slug]/leagues/page.tsx"),
    read("src/app/(app)/organisations/[slug]/leagues/[seasonSlug]/page.tsx"),
  ]);

  assert.match(
    seasonsPage,
    /isOwner && seasons\.length > 0 \? \([\s\S]*data-season-create-action="header"/,
  );
  assert.match(
    seasonsPage,
    /seasons\.length === 0 \? \([\s\S]*data-season-create-action="empty"/,
  );
  assert.match(
    seasonPage,
    /canManageCompetitions && competitions\.length > 0 \? \([\s\S]*data-competition-create-action="header"/,
  );
  assert.match(
    seasonPage,
    /competitions\.length === 0 \? \([\s\S]*data-competition-create-action="empty"/,
  );

  for (const page of [seasonsPage, seasonPage]) {
    for (const marker of [
      'data-season-create-action="header"',
      'data-season-create-action="empty"',
      'data-competition-create-action="header"',
      'data-competition-create-action="empty"',
    ]) {
      const start = page.indexOf(marker);
      if (start < 0) continue;
      const link = page.slice(start, page.indexOf("</Link>", start));
      assert.match(link, /bg-primary/);
      assert.match(link, /text-primary-foreground!/);
    }
  }
});

test("Organisation management sees Draft rather than a temporal Upcoming badge for private Seasons", async () => {
  const [seasonsPage, seasonPage] = await Promise.all([
    read("src/app/(app)/organisations/[slug]/leagues/page.tsx"),
    read("src/app/(app)/organisations/[slug]/leagues/[seasonSlug]/page.tsx"),
  ]);
  assert.match(
    seasonsPage,
    /hasManagementAccess && season\.status === "draft" \? \([\s\S]*<Badge tone="warning">Draft<\/Badge>[\s\S]*<LeagueSeasonPhaseBadge phase=\{phase\}/,
  );
  assert.match(
    seasonPage,
    /managementContext && season\.status === "draft" \? \([\s\S]*<Badge tone="warning">Draft<\/Badge>[\s\S]*<LeagueSeasonPhaseBadge phase=\{seasonPhase\}/,
  );
});

test("Season deletion is owner-only, confirmed, and unavailable for used or non-Draft Seasons", async () => {
  const [editPage, panel, actions, seasonsSql] = await Promise.all([
    read("src/app/(app)/organisations/[slug]/leagues/[seasonSlug]/edit/page.tsx"),
    read("src/components/league-season-delete-panel.tsx"),
    read("src/app/(app)/organisations/[slug]/leagues/actions.ts"),
    read("database/04_seasons.sql"),
  ]);
  assert.match(editPage, /context\.access\.role !== "owner"/);
  assert.match(editPage, /season\.status === "draft"[\s\S]*competitions\.length === 0[\s\S]*concurrentShootingGroups\.length === 0/);
  assert.match(editPage, /This Season cannot be deleted while it contains Competitions/);
  assert.match(editPage, /This Season cannot be deleted while it contains Concurrent Shooting setup/);
  assert.match(panel, /Only an unused draft Season can be deleted/);
  assert.match(panel, /<ConfirmationDialog/);
  assert.match(panel, /will be permanently removed/);
  assert.match(actions, /supabase\.rpc\("delete_league_season"/);
  assert.match(actions, /seasonDeleted=1/);
  assert.match(actions, /resolveDatabaseError/);
  assert.match(actions, /operation: "season\.delete"/);
  assert.doesNotMatch(actions, /run .*SQL|database upgrade has not been applied/i);
  assert.match(actions, /Only a draft league season can be deleted/);
  assert.match(actions, /containing Competitions cannot be deleted/);
  assert.match(actions, /containing Concurrent Shooting setup cannot be deleted/);
  assert.doesNotMatch(actions, /The Season could not be deleted\. Only an unused draft Season can be deleted/);
  assert.match(seasonsSql, /staff\.role = 'owner'/);
  assert.match(seasonsSql, /v_season_status <> 'draft'/);
  assert.match(seasonsSql, /from public\.competitions[\s\S]*competition\.league_season_id = p_league_season_id/);
  assert.match(seasonsSql, /from public\.concurrent_shooting_groups[\s\S]*group_row\.league_season_id = p_league_season_id/);
});

test("ordinary Club members receive read-only entry context without management actions", async () => {
  const [sql, controls] = await Promise.all([
    read("database/06_entries.sql"),
    read("src/components/competition-entry-controls.tsx"),
  ]);
  assert.match(sql, /left join public\.club_competition_entries as entry[\s\S]*membership\.role in \('owner', 'official'\) or entry\.status = 'submitted'/);
  assert.doesNotMatch(sql, /and \(membership\.role in \('owner', 'official'\) or entry\.status = 'submitted'\)\s*order by club\.name/);
  assert.match(controls, /Club entry is managed by your Club officials/);
  assert.match(controls, /A Club Owner or Official must prepare and submit/);
  assert.match(controls, /Entries open \{formatEntryDate\(entryOpensAt\)\}/);
  assert.match(controls, /Entries have closed/);
  const memberBranch = controls.slice(controls.indexOf("{memberOnly.map"));
  assert.doesNotMatch(memberBranch, /Start entry|Create Pair|Create Team|Manage club entry/);
});

test("Club Pair and Team creator explains an empty active roster without internal terminology", async () => {
  const [manager, editor, clubsSql, entriesSql] = await Promise.all([
    read("src/components/club-teams-manager.tsx"),
    read("src/components/competition-entry-editor.tsx"),
    read("database/03_clubs.sql"),
    read("database/06_entries.sql"),
  ]);
  assert.match(manager, /memberOptions\.length === 0/);
  assert.match(manager, /No active Club members available/);
  assert.match(manager, /Approve or add active Club members before creating a Club Pair or Club Team/);
  assert.match(manager, /\{canManage \? \([\s\S]*Manage Club members/);
  assert.doesNotMatch(`${manager}\n${editor}`, /persistent Club|persistent unit|Create unit|Archived units|Unavailable unit/i);
  assert.doesNotMatch(`${clubsSql}\n${entriesSql}`, /raise exception '[^']*(?:persistent|unit ID)/i);
});

test("Results and Statistics guidance is visible once per relevant section", async () => {
  const [aggregate, roundRobin, legend, statistics] = await Promise.all([
    read("src/components/competition-aggregate-results.tsx"),
    read("src/components/competition-round-robin-results.tsx"),
    read("src/components/competition-aggregate-results.tsx"),
    read("src/components/shooter-analytics-dashboard.tsx"),
  ]);
  for (const results of [aggregate, roundRobin]) {
    assert.match(results, /No Results released yet/);
    assert.match(results, /Results release automatically after each Round End\. Scores remain hidden until then/);
    assert.match(results, /<ResultsAverageLegend/);
  }
  assert.match(legend, /S\/Av:[\s\S]*Starting Average fixed for this Competition/);
  assert.match(legend, /R\/Av:[\s\S]*live average of this shooter&apos;s complete, released scores/);
  assert.match(statistics, /This is a read-only comparison\. It does not change your official Division or predict promotion or demotion/);
});

test("unresolved sporting rules remain unstated", async () => {
  const [seed, readiness, entry, results] = await Promise.all([
    read("scripts/lib/staging-demo-model.mjs"),
    read("src/components/competition-readiness-card.tsx"),
    read("src/components/competition-entry-controls.tsx"),
    read("src/components/competition-aggregate-results.tsx"),
  ]);
  const guidance = `${seed}\n${readiness}\n${entry}\n${results}`;
  assert.doesNotMatch(guidance, /late substitutions|substitution rule|six (?:cards|scores)|six-card|cross-Series|another Competition Series/i);
  assert.doesNotMatch(guidance, /will be promoted|will be demoted|promotion threshold|demotion threshold/i);
});
