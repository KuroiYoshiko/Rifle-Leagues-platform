export const SAVED_PUBLIC_RESULTS_STORAGE_KEY =
  "rifleleagues.saved-public-results.v1";
export const SAVED_PUBLIC_RESULTS_CHANGED_EVENT =
  "rifleleagues:saved-public-results-changed";

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const allowedTypes = new Set(["club", "organisation"]);
const maximumSavedItems = 12;

/**
 * @typedef {{ type: "club" | "organisation", slug: string }} SavedPublicResult
 * @typedef {{ getItem(key: string): string | null, setItem(key: string, value: string): void, removeItem(key: string): void }} StorageLike
 */

/** @param {unknown} value */
export function normaliseSavedPublicResults(value) {
  if (!Array.isArray(value)) return [];

  /** @type {SavedPublicResult[]} */
  const items = [];
  const seen = new Set();

  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      continue;
    }

    const type = candidate.type;
    const slug = candidate.slug;
    if (
      typeof type !== "string" ||
      !allowedTypes.has(type) ||
      typeof slug !== "string" ||
      slug.length > 180 ||
      !slugPattern.test(slug)
    ) {
      continue;
    }

    const key = `${type}:${slug}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(/** @type {SavedPublicResult} */ ({ type, slug }));
    if (items.length === maximumSavedItems) break;
  }

  return items;
}

/** @param {StorageLike} storage */
export function readSavedPublicResults(storage) {
  try {
    const stored = storage.getItem(SAVED_PUBLIC_RESULTS_STORAGE_KEY);
    return stored ? normaliseSavedPublicResults(JSON.parse(stored)) : [];
  } catch {
    return [];
  }
}

/** @param {StorageLike} storage @param {unknown} value */
export function writeSavedPublicResults(storage, value) {
  const items = normaliseSavedPublicResults(value);
  try {
    if (items.length === 0) {
      storage.removeItem(SAVED_PUBLIC_RESULTS_STORAGE_KEY);
    } else {
      storage.setItem(SAVED_PUBLIC_RESULTS_STORAGE_KEY, JSON.stringify(items));
    }
    return true;
  } catch {
    return false;
  }
}

/** @param {SavedPublicResult} left @param {SavedPublicResult} right */
export function savedPublicResultEquals(left, right) {
  return left.type === right.type && left.slug === right.slug;
}

/** @param {StorageLike} storage @param {SavedPublicResult} item */
export function isPublicResultSaved(storage, item) {
  return readSavedPublicResults(storage).some((saved) =>
    savedPublicResultEquals(saved, item),
  );
}

/**
 * Saving or removing is only called by an explicit UI action.
 * @param {StorageLike} storage
 * @param {SavedPublicResult} item
 * @param {boolean} saved
 */
export function setPublicResultSaved(storage, item, saved) {
  const validItem = normaliseSavedPublicResults([item])[0];
  if (!validItem) return false;

  const current = readSavedPublicResults(storage);
  const next = saved
    ? normaliseSavedPublicResults([...current, validItem])
    : current.filter((candidate) =>
        !savedPublicResultEquals(candidate, validItem),
      );
  return writeSavedPublicResults(storage, next);
}

/**
 * Drops saved slugs that no longer resolve to an active public entity while
 * preserving the visitor's original shortcut order.
 * @param {unknown} savedValue
 * @param {unknown} resolvedValue
 */
export function reconcileSavedPublicResults(savedValue, resolvedValue) {
  const saved = normaliseSavedPublicResults(savedValue);
  const resolved = normaliseSavedPublicResults(resolvedValue);
  const resolvedKeys = new Set(
    resolved.map((item) => `${item.type}:${item.slug}`),
  );
  return saved.filter((item) => resolvedKeys.has(`${item.type}:${item.slug}`));
}
