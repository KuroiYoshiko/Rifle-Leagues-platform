"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  isPublicResultSaved,
  readSavedPublicResults,
  reconcileSavedPublicResults,
  SAVED_PUBLIC_RESULTS_CHANGED_EVENT,
  SAVED_PUBLIC_RESULTS_STORAGE_KEY,
  setPublicResultSaved,
  writeSavedPublicResults,
} from "@/lib/saved-public-results.mjs";

type SavedEntityType = "club" | "organisation";
type SavedItem = { type: SavedEntityType; slug: string };
type ResolvedSavedItem = SavedItem & { name: string };

function notifySavedResultsChanged() {
  window.dispatchEvent(new Event(SAVED_PUBLIC_RESULTS_CHANGED_EVENT));
}

function readResolvedItems(value: unknown): ResolvedSavedItem[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const items = (value as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];

  return items.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const candidate = item as Record<string, unknown>;
    if (
      (candidate.type !== "club" && candidate.type !== "organisation") ||
      typeof candidate.slug !== "string" ||
      typeof candidate.name !== "string" ||
      !candidate.name.trim()
    ) {
      return [];
    }
    return [{
      type: candidate.type,
      slug: candidate.slug,
      name: candidate.name.trim(),
    }];
  });
}

export function SavedPublicResultButton({
  type,
  slug,
}: SavedItem) {
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const refresh = () => {
      setSaved(isPublicResultSaved(window.localStorage, { type, slug }));
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === SAVED_PUBLIC_RESULTS_STORAGE_KEY) {
        refresh();
      }
    };

    refresh();
    window.addEventListener("storage", handleStorage);
    window.addEventListener(SAVED_PUBLIC_RESULTS_CHANGED_EVENT, refresh);
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(SAVED_PUBLIC_RESULTS_CHANGED_EVENT, refresh);
    };
  }, [slug, type]);

  const label = type === "club" ? "club" : "organisation";

  return (
    <button
      type="button"
      aria-pressed={saved}
      aria-label={saved ? `Remove saved ${label}` : `Save ${label}`}
      title={saved ? `Remove saved ${label}` : undefined}
      onClick={() => {
        const next = !saved;
        if (setPublicResultSaved(window.localStorage, { type, slug }, next)) {
          setSaved(next);
          notifySavedResultsChanged();
        }
      }}
      className={`inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl border px-5 text-sm font-semibold transition ${
        saved
          ? "border-brand/35 bg-brand-subtle text-brand-deep hover:bg-surface-muted"
          : "border-border bg-surface text-brand-deep hover:bg-brand-subtle"
      }`}
    >
      {saved ? "Saved" : `Save ${label}`}
    </button>
  );
}

export function isSavedPublicResultRouteActive(
  pathname: string,
  item: SavedItem,
) {
  const basePath = item.type === "club"
    ? `/clubs/${item.slug}`
    : `/organisations/${item.slug}`;
  return pathname === basePath || pathname.startsWith(`${basePath}/`);
}

function SavedNavigationGroup({
  title,
  items,
  pathname,
  onNavigate,
  onRemove,
}: {
  title: string;
  items: ResolvedSavedItem[];
  pathname: string;
  onNavigate?: () => void;
  onRemove: (item: ResolvedSavedItem) => void;
}) {
  if (items.length === 0) return null;

  return (
    <section className="mt-7" aria-label={title}>
      <h2 className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.17em] text-white/35">
        {title}
      </h2>
      <ul className="space-y-1">
        {items.map((item) => {
          const href = item.type === "club"
            ? `/clubs/${item.slug}`
            : `/organisations/${item.slug}`;
          const active = isSavedPublicResultRouteActive(pathname, item);

          return (
            <li
              key={`${item.type}:${item.slug}`}
              className={`group flex min-h-10 items-center rounded-xl transition ${
                active
                  ? "bg-white text-[var(--brand-deep)] shadow-sm"
                  : "text-white/62 hover:bg-white/[.07] hover:text-white"
              }`}
            >
              <Link
                href={href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                title={item.name}
                className="min-w-0 flex-1 truncate py-2.5 pl-3 text-sm font-medium focus-visible:underline"
              >
                {item.name}
              </Link>
              <button
                type="button"
                onClick={() => onRemove(item)}
                className={`mr-1 grid size-8 shrink-0 place-items-center rounded-lg text-base transition focus-visible:outline-2 focus-visible:outline-offset-1 ${
                  active
                    ? "text-[var(--brand-strong)] hover:bg-brand-subtle"
                    : "text-white/35 hover:bg-white/10 hover:text-white"
                }`}
                aria-label={`Remove ${item.name} from saved ${item.type === "club" ? "clubs" : "organisations"}`}
                title="Remove saved shortcut"
              >
                <span aria-hidden="true">×</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function SavedPublicResultsNavigation({
  pathname,
  onNavigate,
}: {
  pathname: string;
  onNavigate?: () => void;
}) {
  const [items, setItems] = useState<ResolvedSavedItem[]>([]);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const refresh = () => {
      if (readSavedPublicResults(window.localStorage).length === 0) {
        setItems([]);
      }
      setRevision((value) => value + 1);
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === SAVED_PUBLIC_RESULTS_STORAGE_KEY) {
        refresh();
      }
    };

    window.addEventListener("storage", handleStorage);
    window.addEventListener(SAVED_PUBLIC_RESULTS_CHANGED_EVENT, refresh);
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(SAVED_PUBLIC_RESULTS_CHANGED_EVENT, refresh);
    };
  }, []);

  useEffect(() => {
    const saved = readSavedPublicResults(window.localStorage);
    if (saved.length === 0) {
      return;
    }

    const controller = new AbortController();
    void fetch("/api/public-results/saved", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: saved }),
      signal: controller.signal,
    })
      .then(async (response) => response.ok ? response.json() : null)
      .then((payload) => {
        if (controller.signal.aborted) return;
        const resolved = readResolvedItems(payload);
        const reconciled = reconcileSavedPublicResults(saved, resolved);
        const resolvedByKey = new Map(
          resolved.map((item) => [`${item.type}:${item.slug}`, item]),
        );
        setItems(reconciled.flatMap((item) => {
          const resolvedItem = resolvedByKey.get(`${item.type}:${item.slug}`);
          return resolvedItem ? [resolvedItem] : [];
        }));

        if (reconciled.length !== saved.length) {
          writeSavedPublicResults(window.localStorage, reconciled);
        }
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setItems([]);
      });

    return () => controller.abort();
  }, [revision]);

  if (items.length === 0) return null;

  const clubs = items.filter((item) => item.type === "club");
  const organisations = items.filter((item) => item.type === "organisation");

  function remove(item: ResolvedSavedItem) {
    if (setPublicResultSaved(window.localStorage, item, false)) {
      setItems((current) => current.filter((candidate) =>
        candidate.type !== item.type || candidate.slug !== item.slug,
      ));
      notifySavedResultsChanged();
    }
  }

  return (
    <>
      <SavedNavigationGroup
        title="Saved clubs"
        items={clubs}
        pathname={pathname}
        onNavigate={onNavigate}
        onRemove={remove}
      />
      <SavedNavigationGroup
        title="Saved organisations"
        items={organisations}
        pathname={pathname}
        onNavigate={onNavigate}
        onRemove={remove}
      />
    </>
  );
}
