import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadModule } from "./helpers/aggregate-ui-path.mjs";

const sourcePath = new URL(
  "../src/components/competition-score-entry-editor.tsx",
  import.meta.url,
);

function participant(overrides = {}) {
  return {
    participant_id: 501,
    entrant_id: 401,
    entrant_position: 1,
    club_id: 301,
    club_name: "North Club",
    first_name: "Sam",
    last_name: "Shooter",
    source_version: null,
    source_updated_at: null,
    shared: true,
    shared_metadata: {
      shared: true,
      source_version: null,
      source_updated_at: null,
      can_edit_shared: true,
      linked_competitions: [
        {
          competition_id: 11,
          competition_name: "Individual Short Range",
          competition_round_id: 111,
          round_number: 3,
          participant_match: "matched",
          can_edit: true,
        },
        {
          competition_id: 12,
          competition_name: "Pairs Short Range",
          competition_round_id: 121,
          round_number: 3,
          participant_match: "matched",
          can_edit: true,
        },
        {
          competition_id: 13,
          competition_name: "Team Short Range",
          competition_round_id: 131,
          round_number: 4,
          participant_match: "matched",
          can_edit: true,
        },
      ],
    },
    values: [
      {
        set_number: 1,
        component_position: 1,
        entered_score: null,
        x_count: null,
      },
    ],
    ...overrides,
  };
}

function scoreEntry(overrides = {}) {
  return {
    access_scope: "organisation",
    database_today: "2026-09-11",
    can_edit: true,
    concurrent_shooting: {
      shared: true,
      group_id: 8,
      group_name: "Winter shared shooting",
      physical_round_id: 91,
      physical_round_label: "Short range final",
      linked_competitions: [
        {
          competition_id: 11,
          competition_name: "Individual Short Range",
          competition_round_id: 111,
          round_number: 3,
        },
        {
          competition_id: 12,
          competition_name: "Pairs Short Range",
          competition_round_id: 121,
          round_number: 3,
        },
        {
          competition_id: 13,
          competition_name: "Team Short Range",
          competition_round_id: 131,
          round_number: 4,
          unreleased_result: "DO_NOT_RENDER_UNRELEASED_VALUE",
        },
      ],
    },
    competition: {
      id: 11,
      name: "Individual Short Range",
      entry_format: "individual",
      uses_x_score: false,
      sets_per_round: 1,
      shots_per_round: 10,
      local_scoring_enabled: true,
      effective_starts_at: "2026-09-01",
      started: true,
    },
    round: {
      id: 111,
      round_number: 3,
      deadline: "2026-09-20",
      shoot_by_date: null,
      local_cutoff: "2026-09-20",
      local_cutoff_passed: false,
    },
    components: [
      {
        position: 1,
        short_label: "Prone",
        maximum_score: 100,
        score_method: "points_scored",
      },
    ],
    participants: [participant()],
    ...overrides,
  };
}

async function loadScoreEntryModules(save = async () => ({ status: "success" })) {
  const ui = await loadModule("src/components/ui.tsx");
  const confirmation = await loadModule("src/components/confirmation-dialog.tsx");
  const concurrentState = await loadModule("src/lib/concurrent-score-entry.ts");
  const editor = await loadModule(
    "src/components/competition-score-entry-editor.tsx",
    {
      "next/navigation": {
        usePathname: () => "/scores",
        useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
        useSearchParams: () => new URLSearchParams("round=111"),
      },
      "@/app/(app)/competition-score-actions": {
        saveCompetitionRoundScores: save,
      },
      "@/components/confirmation-dialog": confirmation,
      "@/components/ui": ui,
      "@/lib/competition-score-dates": {
        isCompetitionRoundWithinLocalCutoff: () => true,
      },
      "@/lib/concurrent-score-entry": concurrentState,
    },
  );
  return { concurrentState, editor };
}

function renderEditor(editor, data) {
  return renderToStaticMarkup(
    createElement(editor.CompetitionScoreEntryEditor, {
      data,
      rounds: [data.round],
      organisationId: 1,
      leagueSeasonId: 2,
      clubId: data.access_scope === "club" ? 301 : null,
    }),
  );
}

test("ordinary score entry remains banner-free and ordinary blank submission needs no shared-clear confirmation", async () => {
  const { concurrentState, editor } = await loadScoreEntryModules();
  const ordinary = scoreEntry({
    concurrent_shooting: { shared: false },
    participants: [
      participant({
        shared: false,
        shared_metadata: {
          shared: false,
          source_version: 1,
          source_updated_at: null,
          can_edit_shared: true,
          linked_competitions: [],
        },
      }),
    ],
  });
  const banner = renderToStaticMarkup(
    createElement(editor.ConcurrentScoreEntryBanner, { data: ordinary }),
  );
  assert.equal(banner, "");
  const drafts = ordinary.participants.map((row) => ({
    ...row,
    has_recorded_score: true,
    values: [{ entered_score: "" }],
  }));
  assert.deepEqual(
    concurrentState.getGlobalClearParticipantIds(false, drafts),
    [],
  );
});

test("Active mapped Round banner shows human Competition and Round names without internal or unreleased data", async () => {
  const { editor } = await loadScoreEntryModules();
  const html = renderToStaticMarkup(
    createElement(editor.ConcurrentScoreEntryBanner, { data: scoreEntry() }),
  );
  assert.match(html, /Concurrent Shooting/);
  assert.match(html, /Shared physical score/);
  assert.match(html, /Winter shared shooting/);
  assert.match(html, /Short range final/);
  assert.match(html, /Individual Short Range/);
  assert.match(html, /Pairs Short Range/);
  assert.match(html, /Team Short Range/);
  assert.match(html, /Round 4/);
  assert.match(html, /own Results and release schedule/);
  assert.doesNotMatch(
    html,
    /shooting_score_source|competition_score_usage|canonical source|source ID|DO_NOT_RENDER_UNRELEASED_VALUE/i,
  );
});

test("existing shared scores show a compact correction notice and safe last-updated metadata", async () => {
  const { editor } = await loadScoreEntryModules();
  const recorded = participant({
    source_version: 4,
    source_updated_at: "2026-09-11T09:45:00Z",
    values: [
      {
        set_number: 1,
        component_position: 1,
        entered_score: 95,
        x_count: null,
      },
    ],
  });
  const html = renderEditor(editor, scoreEntry({ participants: [recorded] }));
  assert.match(html, /Changes to an existing shared score will apply/);
  assert.match(html, /Last updated 11 Sept 2026, 09:45 UTC/);
  assert.doesNotMatch(html, />4<|source version/i);
});

test("shared create, correction, clear feedback and returned versions are participant-safe", async () => {
  const { concurrentState } = await loadScoreEntryModules();
  const draft = {
    ...participant(),
    has_recorded_score: false,
    values: [{ entered_score: "91" }],
  };
  assert.equal(
    concurrentState.sharedScoreSuccessMessage({
      participants: [draft],
      clearedParticipantIds: [],
      sharedClearCount: 0,
    }),
    "Shared score saved across 3 linked Competitions.",
  );
  const existing = { ...draft, source_version: 4, has_recorded_score: true };
  assert.equal(
    concurrentState.sharedScoreSuccessMessage({
      participants: [existing],
      clearedParticipantIds: [],
      sharedClearCount: 0,
    }),
    "Shared score updated across 3 linked Competitions.",
  );
  const cleared = { ...existing, values: [{ entered_score: "" }] };
  assert.equal(
    concurrentState.sharedScoreSuccessMessage({
      participants: [cleared],
      clearedParticipantIds: [501],
      sharedClearCount: 1,
    }),
    "Shared score cleared across 3 linked Competitions.",
  );
  const retained = concurrentState.retainReturnedSourceVersions(
    [existing, { ...existing, participant_id: 502, source_version: 7 }],
    { 501: 5 },
  );
  assert.equal(retained[0].source_version, 5);
  assert.equal(retained[1].source_version, 7);
});

test("only a final all-blank recorded participant enters the global-clear confirmation path", async () => {
  const { concurrentState } = await loadScoreEntryModules();
  const partial = {
    ...participant(),
    has_recorded_score: true,
    values: [{ entered_score: "" }, { entered_score: "90" }],
  };
  const cleared = {
    ...participant(),
    has_recorded_score: true,
    values: [{ entered_score: "" }, { entered_score: "" }],
  };
  const neverRecorded = { ...cleared, participant_id: 502, has_recorded_score: false };
  assert.deepEqual(
    concurrentState.getGlobalClearParticipantIds(true, [partial]),
    [],
  );
  assert.deepEqual(
    concurrentState.getGlobalClearParticipantIds(true, [cleared, neverRecorded]),
    [501],
  );
  const source = await readFile(sourcePath, "utf8");
  assert.doesNotMatch(source, /window\.confirm|clear only this Competition/i);
  assert.match(source, /<ConfirmationDialog/);
  assert.match(source, /title="Clear shared score\?"/);
  assert.match(source, /setClearParticipantIds\(participantIds\);\s*return;/);
  assert.match(source, /onCancel=\{\(\) => setClearParticipantIds\(\[\]\)\}/);
  assert.match(source, /onClick=\{\(\) => persistScores\(clearParticipantIds\)\}/);
  assert.match(source, /Competition entries will remain linked/);
});

test("stale rejection is blocking, refresh-only, and never exposes backend text", async () => {
  const revalidated = [];
  const actions = await loadModule("src/app/(app)/competition-score-actions.ts", {
    "next/cache": { revalidatePath: (...args) => revalidated.push(args) },
    "@/lib/supabase/server": {
      createClient: async () => ({
        auth: { getClaims: async () => ({ data: { claims: { sub: "actor" } } }) },
        rpc: async () => ({
          data: null,
          error: {
            code: "40001",
            message: "RAW SQL shared source version 17 stale RPC text",
          },
        }),
      }),
    },
  });
  const result = await actions.saveCompetitionRoundScores({
    organisationId: 1,
    leagueSeasonId: 2,
    competitionId: 11,
    competitionRoundId: 111,
    clubId: null,
    scores: [
      {
        participant_id: 501,
        source_version: 4,
        values: [
          {
            set_number: 1,
            component_position: 1,
            entered_score: "90",
            x_count: null,
          },
        ],
      },
    ],
  });
  assert.equal(result.errorKind, "stale");
  assert.match(result.message, /updated elsewhere|Refresh the latest score/);
  assert.doesNotMatch(result.message, /RAW SQL|RPC|17|source version/i);
  assert.equal(revalidated.length, 0);

  const source = await readFile(sourcePath, "utf8");
  assert.match(source, /Shared score changed/);
  assert.match(source, /Refresh score/);
  assert.match(source, /startRefreshTransition\(\(\) => router\.refresh\(\)\)/);
  assert.match(source, /staleBlocked \|\|\s*isPending/);
  assert.doesNotMatch(source, /errorKind === "stale"[\s\S]{0,300}persistScores/);
});

test("authority, ambiguous, conflict, and missing states use scorer-facing language", async () => {
  const { editor } = await loadScoreEntryModules();
  const states = [
    [
      "ambiguous",
      /appears more than once.*Organisation staff must resolve/s,
    ],
    [
      "source_conflict",
      /conflicting score data.*Organisation staff must resolve/s,
    ],
    [
      "outside_club_scope",
      /outside this club account.*Organisation scorer/s,
    ],
  ];
  for (const [state, expected] of states) {
    const row = participant({
      shared_metadata: {
        ...participant().shared_metadata,
        can_edit_shared: false,
        linked_competitions: participant().shared_metadata.linked_competitions.map(
          (competition, index) => ({
            ...competition,
            participant_match: index === 0 ? state : "matched",
          }),
        ),
      },
    });
    const html = renderEditor(
      editor,
      scoreEntry({ access_scope: "club", can_edit: false, participants: [row] }),
    );
    assert.match(html, expected);
    assert.doesNotMatch(html, new RegExp(`>${state}<`));
  }

  const missingRow = participant({
    shared_metadata: {
      ...participant().shared_metadata,
      linked_competitions: participant().shared_metadata.linked_competitions.map(
        (competition, index) => ({
          ...competition,
          participant_match: index === 2 ? "missing" : "matched",
        }),
      ),
    },
  });
  const missingHtml = renderEditor(
    editor,
    scoreEntry({ participants: [missingRow] }),
  );
  assert.match(missingHtml, /does not participate in Team Short Range/);
  assert.match(missingHtml, /score applies only where this shooter participates/);
  assert.doesNotMatch(missingHtml, /fatal|>missing</i);

  const authorityRow = participant({
    shared_metadata: {
      ...participant().shared_metadata,
      can_edit_shared: false,
      linked_competitions: participant().shared_metadata.linked_competitions.map(
        (competition) => ({ ...competition, can_edit: false })),
    },
  });
  const authorityHtml = renderEditor(
    editor,
    scoreEntry({ access_scope: "club", can_edit: true, participants: [authorityRow] }),
  );
  assert.match(authorityHtml, /outside your scoring permissions or scoring window/);
  assert.match(authorityHtml, /Organisation scorer must make this change/);
  assert.match(authorityHtml, /disabled=""/);
  assert.doesNotMatch(authorityHtml, />Save scores</);

  const organisationHtml = renderEditor(editor, scoreEntry());
  assert.match(organisationHtml, /Organisation scoring/);
  assert.match(organisationHtml, /Save scores/);
});

test("shared shooter-level treatment stays stable for Individual, Pair, and Team entrants", async () => {
  const { editor } = await loadScoreEntryModules();
  for (const [format, label] of [
    ["individual", "Individual 1"],
    ["pairs", "Pair 1"],
    ["team", "Team 1"],
  ]) {
    const data = scoreEntry({
      competition: { ...scoreEntry().competition, entry_format: format },
    });
    const html = renderEditor(editor, data);
    assert.match(html, new RegExp(label));
    assert.match(html, /Sam Shooter/);
    assert.match(html, /Shared score/);
    assert.doesNotMatch(html, /shared total/i);
  }
});

test("friendly Concurrent action errors classify expected backend failures without leaking database messages", async () => {
  const cases = [
    [
      "22023",
      'Shared score cannot be saved because shooter participation is ambiguous in linked Competition "Private Name".',
      "ambiguous_participant",
    ],
    [
      "23505",
      "A linked Competition participant/Round already points to a different score source.",
      "source_conflict",
    ],
    [
      "42501",
      "Shared score requires Organisation scoring because a linked participant is outside this club scope.",
      "shared_authority",
    ],
  ];
  for (const [code, databaseMessage, errorKind] of cases) {
    const actions = await loadModule("src/app/(app)/competition-score-actions.ts", {
      "next/cache": { revalidatePath: () => undefined },
      "@/lib/supabase/server": {
        createClient: async () => ({
          auth: { getClaims: async () => ({ data: { claims: { sub: "actor" } } }) },
          rpc: async () => ({ error: { code, message: databaseMessage } }),
        }),
      },
    });
    const result = await actions.saveCompetitionRoundScores({
      organisationId: 1,
      leagueSeasonId: 2,
      competitionId: 11,
      competitionRoundId: 111,
      clubId: 301,
      scores: [],
    });
    assert.equal(result.errorKind, errorKind);
    assert.doesNotMatch(result.message, /Private Name|different score source|club scope/i);
  }
});
