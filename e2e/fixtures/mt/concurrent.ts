/**
 * Concurrency helper for the multi-tenant-isolation suite: run two tenant-scoped operations at the
 * same time and get both settled results back, so a spec can assert that a race between tenants
 * produced no cross-contamination (both succeed, or each fails on its own terms — never one
 * clobbering the other).
 */
export async function raceAcrossTenants<T>(
  fnA: () => Promise<T>,
  fnB: () => Promise<T>,
): Promise<[PromiseSettledResult<T>, PromiseSettledResult<T>]> {
  const [a, b] = await Promise.allSettled([fnA(), fnB()]);
  return [a, b];
}
