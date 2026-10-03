package com.cursorpoc.backend.stock;

import java.util.Collection;

/**
 * Stock integration (HU-61): published (synchronously, inside the changing transaction) whenever a
 * change may alter a tenant's resolved {@code STOCK_*} flags or its identity in Stock — a global,
 * tier or tenant flag change, a tier reassignment, a rename or a status change. {@code tenantIds ==
 * null} with no {@code tierId} means "every tenant" (a global flag change). Decouples {@code
 * FeatureFlagService}/{@code TierAdminService}/{@code TenantAdminService} from {@link
 * StockFeatureFlagPublisher}.
 */
public record StockFlagsChangedEvent(
    Collection<Long> tenantIds, Long tierId, String flagKey, boolean tenantProfileChanged) {

  /** A global flag changed: every tenant may be affected. */
  public static StockFlagsChangedEvent global(String flagKey) {
    return new StockFlagsChangedEvent(null, null, flagKey, false);
  }

  /** A tier's flag changed: every tenant on that tier may be affected. */
  public static StockFlagsChangedEvent tier(long tierId, String flagKey) {
    return new StockFlagsChangedEvent(null, tierId, flagKey, false);
  }

  /** A tenant's own flag changed. */
  public static StockFlagsChangedEvent tenantFlag(long tenantId, String flagKey) {
    return new StockFlagsChangedEvent(java.util.List.of(tenantId), null, flagKey, false);
  }

  /** A tenant was created, renamed, (re)assigned a tier or changed status. */
  public static StockFlagsChangedEvent tenant(long tenantId, boolean profileChanged) {
    return new StockFlagsChangedEvent(java.util.List.of(tenantId), null, null, profileChanged);
  }

  /** Only {@code STOCK_*} keys (or tenant-level changes, {@code flagKey == null}) matter. */
  public boolean relevant() {
    return flagKey == null || flagKey.startsWith(StockFeatureFlagPublisher.PREFIX);
  }
}
