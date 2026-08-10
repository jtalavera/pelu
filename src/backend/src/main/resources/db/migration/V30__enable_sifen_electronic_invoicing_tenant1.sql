-- Enables SIFEN_ELECTRONIC_INVOICING (V28) for tenant 1 via a per-tenant override, same row shape
-- the SYSTEM_ADMIN toggle at /app/settings/feature-flags writes (FeatureFlagService.upsertTenantOverride).
-- Guarded with WHERE EXISTS because tenant 1 is seeded by FemmeDataInitializer's CommandLineRunner
-- *after* Flyway runs on a boot against a brand-new empty database — an unconditional INSERT would
-- violate fk_tenant_feature_flags_tenant on that first boot. On an already-seeded database (dev,
-- prod, or this repo's own local podman DB) tenant 1 already exists, so the row is inserted.
-- Does not write to tenant_feature_flag_changes (V28): that table's changed_by_user_id/email
-- record a real admin action, which a migration has no honest value for — leaving it absent just
-- means the Feature Flags page shows no "last change" line for this row, which is accurate.
INSERT INTO tenant_feature_flags (tenant_id, flag_key, enabled)
SELECT 1, 'SIFEN_ELECTRONIC_INVOICING', 1
WHERE EXISTS (SELECT 1 FROM tenants WHERE id = 1)
  AND NOT EXISTS (
    SELECT 1 FROM tenant_feature_flags WHERE tenant_id = 1 AND flag_key = 'SIFEN_ELECTRONIC_INVOICING'
  );
