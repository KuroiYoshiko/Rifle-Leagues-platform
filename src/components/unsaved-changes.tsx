"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEventHandler,
  type ReactNode,
} from "react";
import { ConfirmationDialog } from "@/components/confirmation-dialog";
import {
  interceptUnsavedTraversal,
  reconcileDirtyFormState,
  shouldProtectUnsavedChanges,
  supportsNavigationPrecommit,
  type InterceptableTraversalEvent,
  type UnsavedTraversalDecision,
} from "@/lib/unsaved-changes-state";

type Registration = {
  dirty: boolean;
  submitting: boolean;
};

type UnsavedChangesContextValue = {
  discardVersion: number;
  updateRegistration: (id: string, registration: Registration | null) => void;
};

type PendingNavigation = {
  kind: "link";
  destination: URL;
} | {
  kind: "traverse";
  resolve: (decision: UnsavedTraversalDecision) => void;
};

type NavigationApi = EventTarget & {
  addEventListener(type: "navigate", listener: (event: Event) => void): void;
  removeEventListener(type: "navigate", listener: (event: Event) => void): void;
  addEventListener(type: "navigatesuccess" | "navigateerror", listener: () => void): void;
  removeEventListener(type: "navigatesuccess" | "navigateerror", listener: () => void): void;
};

function getNavigationApi() {
  const browserWindow = window as Window & {
    navigation?: NavigationApi;
    NavigationPrecommitController?: unknown;
  };
  return supportsNavigationPrecommit(browserWindow)
    ? browserWindow.navigation
    : null;
}

const UnsavedChangesContext = createContext<UnsavedChangesContextValue | null>(null);

function sameDocumentDestination(destination: URL) {
  return destination.origin === window.location.origin
    && destination.pathname === window.location.pathname
    && destination.search === window.location.search;
}

export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const bypassUnloadRef = useRef(false);
  const traversalPendingRef = useRef(false);
  const traversalSuppressedRef = useRef(false);
  const [registrations, setRegistrations] = useState(() => new Map<string, Registration>());
  const [discardVersion, setDiscardVersion] = useState(0);
  const [pendingNavigation, setPendingNavigation] = useState<PendingNavigation | null>(null);

  const updateRegistration = useCallback((id: string, registration: Registration | null) => {
    setRegistrations((current) => {
      const next = new Map(current);
      if (registration) next.set(id, registration);
      else next.delete(id);
      return next;
    });
  }, []);

  const hasUnsavedChanges = shouldProtectUnsavedChanges(Array.from(registrations.values()));

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      if (bypassUnloadRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedChanges]);

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    function handleDocumentClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey
        || event.shiftKey || event.altKey || !(event.target instanceof Element)) return;
      const link = event.target.closest<HTMLAnchorElement>("a[href]");
      if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
      const destination = new URL(link.href, window.location.href);
      if (sameDocumentDestination(destination)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setPendingNavigation({ kind: "link", destination });
    }
    document.addEventListener("click", handleDocumentClick, true);
    return () => document.removeEventListener("click", handleDocumentClick, true);
  }, [hasUnsavedChanges]);

  useEffect(() => {
    const navigation = getNavigationApi();
    if (!navigation) return;

    function handleNavigate(rawEvent: Event) {
      const event = rawEvent as Event & InterceptableTraversalEvent;
      const intercepted = interceptUnsavedTraversal({
        event,
        dirty: hasUnsavedChanges,
        suppressed: traversalPendingRef.current || traversalSuppressedRef.current,
        requestDecision: () => new Promise((resolve) => {
          traversalPendingRef.current = true;
          setPendingNavigation({ kind: "traverse", resolve });
        }),
        onDiscard: () => {
          bypassUnloadRef.current = true;
          traversalSuppressedRef.current = true;
          setRegistrations(new Map());
          setDiscardVersion((current) => current + 1);
        },
        onDecisionSettled: (decision) => {
          traversalPendingRef.current = false;
          if (decision === "stay") traversalSuppressedRef.current = false;
        },
      });
      traversalPendingRef.current = intercepted;
    }

    navigation.addEventListener("navigate", handleNavigate);
    return () => navigation.removeEventListener("navigate", handleNavigate);
  }, [hasUnsavedChanges]);

  useEffect(() => {
    const navigation = getNavigationApi();
    if (!navigation) return;
    function resetTraversalSuppression() {
      traversalPendingRef.current = false;
      traversalSuppressedRef.current = false;
      bypassUnloadRef.current = false;
    }
    navigation.addEventListener("navigatesuccess", resetTraversalSuppression);
    navigation.addEventListener("navigateerror", resetTraversalSuppression);
    return () => {
      navigation.removeEventListener("navigatesuccess", resetTraversalSuppression);
      navigation.removeEventListener("navigateerror", resetTraversalSuppression);
    };
  }, []);

  const contextValue = useMemo(() => ({ discardVersion, updateRegistration }), [
    discardVersion,
    updateRegistration,
  ]);

  function stayOnPage() {
    if (pendingNavigation?.kind === "traverse") pendingNavigation.resolve("stay");
    setPendingNavigation(null);
  }

  function discardAndNavigate() {
    if (!pendingNavigation) return;
    if (pendingNavigation.kind === "traverse") {
      const { resolve } = pendingNavigation;
      setPendingNavigation(null);
      resolve("discard");
      return;
    }
    const destination = pendingNavigation.destination;
    setRegistrations(new Map());
    setDiscardVersion((current) => current + 1);
    setPendingNavigation(null);
    if (destination.origin === window.location.origin) {
      router.push(`${destination.pathname}${destination.search}${destination.hash}`);
    } else {
      bypassUnloadRef.current = true;
      window.location.assign(destination.href);
    }
  }

  return (
    <UnsavedChangesContext.Provider value={contextValue}>
      {children}
      <ConfirmationDialog
        open={Boolean(pendingNavigation)}
        title="Unsaved changes"
        description={<p>You have changes that have not been saved. Leaving this page will discard them.</p>}
        onCancel={stayOnPage}
      >
        <button
          type="button"
          onClick={stayOnPage}
          className="inline-flex min-h-11 items-center justify-center rounded-xl border border-border bg-surface px-5 text-sm font-semibold transition hover:bg-surface-muted"
        >
          Stay here
        </button>
        <button
          type="button"
          onClick={discardAndNavigate}
          className="inline-flex min-h-11 items-center justify-center rounded-xl bg-danger px-5 text-sm font-semibold text-white transition hover:brightness-95"
        >
          Discard changes
        </button>
      </ConfirmationDialog>
    </UnsavedChangesContext.Provider>
  );
}

export function useUnsavedChangesForm({
  pending,
  savedSignal = null,
  enabled = true,
}: {
  pending: boolean;
  savedSignal?: unknown;
  enabled?: boolean;
}) {
  const context = useContext(UnsavedChangesContext);
  const id = useId();
  const discardVersion = context?.discardVersion ?? 0;
  const [tracking, setTracking] = useState({
    dirty: false,
    savedSignal,
    discardVersion,
  });
  const reconciledTracking = reconcileDirtyFormState(tracking, savedSignal, discardVersion);
  if (reconciledTracking !== tracking) setTracking(reconciledTracking);
  const dirty = reconciledTracking.dirty;

  useEffect(() => {
    if (!context || !enabled) return;
    context.updateRegistration(id, { dirty, submitting: pending });
    return () => context.updateRegistration(id, null);
  }, [context, dirty, enabled, id, pending]);

  const markDirty = useCallback(() => setTracking((current) => ({ ...current, dirty: true })), []);
  const onSubmitCapture = useCallback<FormEventHandler<HTMLFormElement>>(() => {
    if (context && enabled) context.updateRegistration(id, { dirty, submitting: true });
  }, [context, dirty, enabled, id]);

  return {
    dirty,
    markDirty,
    onChangeCapture: markDirty,
    onSubmitCapture,
  };
}
