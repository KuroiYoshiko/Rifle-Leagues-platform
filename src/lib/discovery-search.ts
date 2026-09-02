export const DISCOVERY_SEARCH_DEBOUNCE_MS = 300;

export function normaliseDiscoverySearchTerm(value: string) {
  return value
    .trim()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}

export function createPrefixTextSearchQuery(searchTerm: string) {
  const safeTerm = normaliseDiscoverySearchTerm(searchTerm);

  return safeTerm
    .split(" ")
    .filter(Boolean)
    .map((term) => `${term}:*`)
    .join(" & ");
}
