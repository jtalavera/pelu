/**
 * Lists show a professional by her nickname when she has one. The pickers keep reading `fullName`,
 * so this puts the display name (nickname, else full name) in that field right after loading;
 * the full name stays untouched in the Catálogo, where it is edited.
 */
export function withDisplayNames<T extends { fullName: string; displayName?: string | null }>(
  list: readonly T[],
): T[] {
  return list.map((p) => ({ ...p, fullName: p.displayName?.trim() || p.fullName }));
}
