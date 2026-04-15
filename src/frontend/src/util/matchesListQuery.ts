/**
 * Normalizes text for case-insensitive substring matching in list filters.
 */
export function normalizeForSearch(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * Returns true if `query` is empty or if `text` contains the normalized query.
 */
export function matchesListQuery(text: string, query: string): boolean {
  const q = normalizeForSearch(query);
  if (!q) return true;
  return normalizeForSearch(text).includes(q);
}

/**
 * Filters an array by matching any searchable string from each item.
 */
export function filterByListQuery<T>(
  items: T[],
  query: string,
  getSearchableParts: (item: T) => string[],
): T[] {
  const q = normalizeForSearch(query);
  if (!q) return items;
  return items.filter((item) => {
    const parts = getSearchableParts(item);
    return parts.some((p) => normalizeForSearch(String(p ?? "")).includes(q));
  });
}
