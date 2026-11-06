/** Lowercases and drops accents («Nuñez» → «nunez») so a search does not depend on them. */
function foldChar(c: string): string {
  return c.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/**
 * Normalizes text for case- and accent-insensitive substring matching in list filters.
 */
export function normalizeForSearch(s: string): string {
  return foldChar(s.trim());
}

/**
 * Where `query` first appears in `text` (case- and accent-insensitive), as the `[start, end)`
 * range of the ORIGINAL text, or null when it does not appear (or the query is empty). Used to
 * highlight the matching part.
 */
export function findQueryMatch(text: string, query: string): [number, number] | null {
  const q = normalizeForSearch(query);
  if (!q) return null;
  let folded = "";
  const origin: number[] = []; // for each folded char, the index in `text` it came from
  let i = 0;
  for (const ch of text) {
    const f = foldChar(ch);
    for (let k = 0; k < f.length; k++) origin.push(i);
    folded += f;
    i += ch.length;
  }
  const at = folded.indexOf(q);
  if (at < 0) return null;
  const start = origin[at];
  const lastFolded = origin[at + q.length - 1];
  const lastChar = String.fromCodePoint(text.codePointAt(lastFolded) ?? 0);
  return [start, lastFolded + lastChar.length];
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
