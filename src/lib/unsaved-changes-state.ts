export type DirtyFormState = {
  dirty: boolean;
  savedSignal: unknown;
  discardVersion: number;
};

export function reconcileDirtyFormState(
  current: DirtyFormState,
  savedSignal: unknown,
  discardVersion: number,
) {
  if (current.savedSignal === savedSignal && current.discardVersion === discardVersion) {
    return current;
  }
  return {
    dirty: savedSignal || current.discardVersion !== discardVersion ? false : current.dirty,
    savedSignal,
    discardVersion,
  } satisfies DirtyFormState;
}

export function shouldProtectUnsavedChanges(registrations: Array<{
  dirty: boolean;
  submitting: boolean;
}>) {
  return registrations.some((registration) => registration.dirty && !registration.submitting);
}

export function supportsNavigationPrecommit(value: {
  navigation?: unknown;
  NavigationPrecommitController?: unknown;
}) {
  return Boolean(value.navigation && "NavigationPrecommitController" in value);
}

export type UnsavedTraversalDecision = "stay" | "discard";

export type InterceptableTraversalEvent = {
  navigationType: string;
  canIntercept: boolean;
  cancelable: boolean;
  intercept: (options: {
    precommitHandler: () => Promise<void>;
  }) => void;
};

export function interceptUnsavedTraversal({
  event,
  dirty,
  suppressed,
  requestDecision,
  onDiscard,
  onDecisionSettled,
}: {
  event: InterceptableTraversalEvent;
  dirty: boolean;
  suppressed: boolean;
  requestDecision: () => Promise<UnsavedTraversalDecision>;
  onDiscard: () => void;
  onDecisionSettled: (decision: UnsavedTraversalDecision) => void;
}) {
  if (!dirty || suppressed || event.navigationType !== "traverse"
    || !event.canIntercept || !event.cancelable) return false;

  try {
    event.intercept({
      async precommitHandler() {
        const decision = await requestDecision();
        if (decision === "stay") {
          onDecisionSettled(decision);
          throw new DOMException("Unsaved navigation canceled", "AbortError");
        }
        onDiscard();
        onDecisionSettled(decision);
      },
    });
    return true;
  } catch {
    return false;
  }
}
