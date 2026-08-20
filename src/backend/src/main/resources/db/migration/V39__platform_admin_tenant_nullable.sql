-- HU-34: PLATFORM_ADMIN is a genuinely tenant-independent role — its AppUser row has no tenant.
-- Every other existing role (SYSTEM_ADMIN, ADMIN, PROFESSIONAL) keeps a non-null tenant_id in
-- practice; that invariant is enforced in application code (AuthService, FemmeDataInitializer),
-- not by a DB-level NOT NULL, so a single PLATFORM_ADMIN row can have tenant_id = NULL.
ALTER TABLE app_users ALTER COLUMN tenant_id BIGINT NULL;

-- uq_app_users_tenant_email (tenant_id, email) from V5 already allows multiple NULL tenant_id
-- rows as long as their email differs (SQL Server compares the full tuple; NULL only matches NULL
-- when every other column also matches). Add a dedicated filtered index so platform-admin emails
-- are still guaranteed unique among themselves, mirroring the per-tenant guarantee normal users get.
CREATE UNIQUE INDEX uq_app_users_platform_admin_email ON app_users (email) WHERE tenant_id IS NULL;
