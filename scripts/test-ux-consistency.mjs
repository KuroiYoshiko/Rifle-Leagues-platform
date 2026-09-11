import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { loadModule } from "./helpers/aggregate-ui-path.mjs";

const readSource = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Concurrent creation uses a non-sequential Basic details label while Draft sections stay numbered", async () => {
  const source = await readSource("src/components/concurrent-shooting-management.tsx");
  assert.match(source, />Basic details<\/p>/);
  assert.doesNotMatch(source, /Step 1 · Basic details/i);
  for (const heading of [
    "1. Basic details",
    "2. Select Competitions",
    "3. Map shared physical Rounds",
    "4. Review",
    "5. Activation",
  ]) assert.match(source, new RegExp(heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("Concurrent confirmations use the shared in-app dialog and action-specific consequences", async () => {
  const source = await readSource("src/components/concurrent-shooting-management.tsx");
  assert.doesNotMatch(source, /window\.confirm/);
  assert.match(source, /<ConfirmationDialog/);
  assert.match(source, /title: "Remove shared Round\?"/);
  assert.match(source, /all Draft mappings assigned to it\. It does not change Competition configuration/);
  assert.match(source, /title: "Delete Concurrent Shooting Draft\?"/);
  assert.match(source, /This permanently removes this unused Draft configuration/);
  assert.match(source, /type="button"[\s\S]*onClick=\{\(\) => setConfirmationOpen\(true\)\}/);
  assert.match(source, /onClick=\{\(\) => setConfirmationOpen\(false\)\}[\s\S]*>Cancel/);
  assert.match(source, /<form action=\{action\} className="contents">[\s\S]*<SubmitButton/);
});

test("the shared dialog supplies modal focus, Escape cancellation, accessible labelling, and focus restoration", async () => {
  const source = await readSource("src/components/confirmation-dialog.tsx");
  assert.match(source, /dialog\.showModal\(\)/);
  assert.match(source, /aria-labelledby=\{titleId\}/);
  assert.match(source, /aria-describedby=\{descriptionId\}/);
  assert.match(source, /onCancel=\{\(event\) =>/);
  assert.match(source, /event\.preventDefault\(\)/);
  assert.match(source, /returnFocusRef\.current\?\.focus\(\)/);
});

test("dirty state is pristine initially, blocks after change, and resets after save or discard", async () => {
  const state = await loadModule("src/lib/unsaved-changes-state.ts");
  const initial = { dirty: false, savedSignal: null, discardVersion: 0 };
  assert.equal(state.shouldProtectUnsavedChanges([{ dirty: false, submitting: false }]), false);
  assert.equal(state.shouldProtectUnsavedChanges([{ dirty: true, submitting: false }]), true);
  assert.equal(state.shouldProtectUnsavedChanges([{ dirty: true, submitting: true }]), false);

  const changed = { ...initial, dirty: true };
  assert.equal(state.reconcileDirtyFormState(changed, null, 0).dirty, true);
  assert.equal(state.reconcileDirtyFormState(changed, { status: "success" }, 0).dirty, false);
  assert.equal(state.reconcileDirtyFormState(changed, null, 1).dirty, false);
});

function traversalEvent(overrides = {}) {
  const calls = [];
  return {
    event: {
      navigationType: "traverse",
      canIntercept: true,
      cancelable: true,
      intercept: (options) => calls.push(options),
      ...overrides,
    },
    calls,
  };
}

test("dirty traversals are held before commit and Stay cancels without discarding", async () => {
  const state = await loadModule("src/lib/unsaved-changes-state.ts");
  const { event, calls } = traversalEvent();
  let resolveDecision;
  let discarded = false;
  const settled = [];
  const intercepted = state.interceptUnsavedTraversal({
    event,
    dirty: true,
    suppressed: false,
    requestDecision: () => new Promise((resolve) => { resolveDecision = resolve; }),
    onDiscard: () => { discarded = true; },
    onDecisionSettled: (decision) => settled.push(decision),
  });
  assert.equal(intercepted, true);
  assert.equal(calls.length, 1);
  const precommit = calls[0].precommitHandler();
  assert.equal(typeof resolveDecision, "function", "precommit should request the shared confirmation");
  resolveDecision("stay");
  await assert.rejects(precommit, { name: "AbortError" });
  assert.equal(discarded, false, "Stay must preserve dirty form data");
  assert.deepEqual(settled, ["stay"]);
});

test("Discard resolves the original traversal once and suppression can reset after navigation", async () => {
  const state = await loadModule("src/lib/unsaved-changes-state.ts");
  const { event, calls } = traversalEvent();
  let resolveDecision;
  let discarded = 0;
  let suppressed = false;
  assert.equal(state.interceptUnsavedTraversal({
    event,
    dirty: true,
    suppressed,
    requestDecision: () => new Promise((resolve) => { resolveDecision = resolve; }),
    onDiscard: () => { discarded += 1; },
    onDecisionSettled: (decision) => { suppressed = decision === "discard"; },
  }), true);
  const precommit = calls[0].precommitHandler();
  resolveDecision("discard");
  await precommit;
  assert.equal(discarded, 1);
  assert.equal(suppressed, true);

  const reentrant = traversalEvent();
  assert.equal(state.interceptUnsavedTraversal({
    event: reentrant.event,
    dirty: true,
    suppressed,
    requestDecision: async () => "discard",
    onDiscard: () => { discarded += 1; },
    onDecisionSettled: () => undefined,
  }), false, "the same in-flight traversal must not prompt twice");
  assert.equal(reentrant.calls.length, 0);

  suppressed = false; // mirrors navigatesuccess/navigateerror cleanup in the provider
  const later = traversalEvent();
  assert.equal(state.interceptUnsavedTraversal({
    event: later.event,
    dirty: true,
    suppressed,
    requestDecision: async () => "stay",
    onDiscard: () => undefined,
    onDecisionSettled: () => undefined,
  }), true, "a later traversal should be protectable after suppression resets");
});

test("pristine, saved, and non-interceptable traversals remain untouched", async () => {
  const state = await loadModule("src/lib/unsaved-changes-state.ts");
  for (const [dirty, overrides] of [
    [false, {}],
    [true, { canIntercept: false }],
    [true, { cancelable: false }],
  ]) {
    const { event, calls } = traversalEvent(overrides);
    assert.equal(state.interceptUnsavedTraversal({
      event,
      dirty,
      suppressed: false,
      requestDecision: async () => "discard",
      onDiscard: () => assert.fail("unprotected traversal must not discard state"),
      onDecisionSettled: () => undefined,
    }), false);
    assert.equal(calls.length, 0, "unsupported traversal must not be modified");
  }

  const saved = state.reconcileDirtyFormState(
    { dirty: true, savedSignal: null, discardVersion: 0 },
    { status: "success" },
    0,
  );
  const afterSave = traversalEvent();
  assert.equal(state.interceptUnsavedTraversal({
    event: afterSave.event,
    dirty: saved.dirty,
    suppressed: false,
    requestDecision: async () => "discard",
    onDiscard: () => assert.fail("saved form must not be guarded"),
    onDecisionSettled: () => undefined,
  }), false);
  assert.equal(afterSave.calls.length, 0);

  assert.equal(state.supportsNavigationPrecommit({}), false);
  assert.equal(state.supportsNavigationPrecommit({ navigation: {} }), false);
  assert.equal(state.supportsNavigationPrecommit({
    navigation: {},
    NavigationPrecommitController: function NavigationPrecommitController() {},
  }), true);
});

test("unload and in-app link protection are dirty-only and do not manipulate browser history", async () => {
  const source = await readSource("src/components/unsaved-changes.tsx");
  const shell = await readSource("src/components/app-shell.tsx");
  assert.match(source, /if \(!hasUnsavedChanges\) return;[\s\S]*addEventListener\("beforeunload"/);
  assert.match(source, /document\.addEventListener\("click", handleDocumentClick, true\)/);
  assert.match(source, /event\.preventDefault\(\);[\s\S]*setPendingNavigation\(\{ kind: "link", destination \}\)/);
  assert.match(source, /title="Unsaved changes"/);
  assert.match(source, />\s*Stay here\s*<\/button>/);
  assert.match(source, />\s*Discard changes\s*<\/button>/);
  assert.match(source, /router\.push/);
  assert.match(source, /NavigationPrecommitController/);
  assert.match(source, /navigation\.addEventListener\("navigate", handleNavigate\)/);
  assert.match(source, /navigation\.addEventListener\("navigatesuccess", resetTraversalSuppression\)/);
  assert.match(source, /navigation\.addEventListener\("navigateerror", resetTraversalSuppression\)/);
  assert.doesNotMatch(source, /history\.(pushState|replaceState|go)/);
  assert.doesNotMatch(source, /traverseTo\(/);
  assert.doesNotMatch(source, /addEventListener\("popstate"/);
  assert.match(shell, /<UnsavedChangesProvider>[\s\S]*\{children\}[\s\S]*<\/UnsavedChangesProvider>/);
});

test("only the requested long-form flows opt into the reusable guard", async () => {
  const competition = await readSource("src/components/competition-form.tsx");
  const season = await readSource("src/components/league-season-form.tsx");
  const concurrent = await readSource("src/components/concurrent-shooting-management.tsx");
  for (const source of [competition, season, concurrent]) {
    assert.match(source, /useUnsavedChangesForm/);
    assert.match(source, /onChangeCapture=\{unsavedChanges\.onChangeCapture\}/);
    assert.match(source, /onSubmitCapture=\{unsavedChanges\.onSubmitCapture\}/);
  }
  assert.match(concurrent, /operation="rename"[\s\S]*protectUnsavedChanges/);
  assert.match(concurrent, /operation="update_round"[\s\S]*protectUnsavedChanges/);
  assert.match(concurrent, /operation="set_mapping"[\s\S]*protectUnsavedChanges/);
});
