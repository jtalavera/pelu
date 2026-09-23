-- HU-36: migrate the legacy SYSTEM_ADMIN user (root@pelu, tenant-bound via FK for legacy reasons,
-- see V10) to the tenant-independent PLATFORM_ADMIN model introduced in V39/HU-34. Email and
-- password_hash are left untouched so the same credentials keep working after this migration
-- (HU-36 AC-4: no password reset required).
UPDATE app_users
SET role = 'PLATFORM_ADMIN',
    tenant_id = NULL
WHERE role = 'SYSTEM_ADMIN';
