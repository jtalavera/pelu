-- 1. Replace global email uniqueness on app_users with per-tenant uniqueness.
--    Same email is now allowed across different tenants.
ALTER TABLE app_users DROP CONSTRAINT uq_app_users_email;
CREATE UNIQUE INDEX uq_app_users_tenant_email ON app_users (tenant_id, email);

-- 2. A professional can only be linked to one app_user and vice-versa.
--    NULL is allowed (professional without system access); only non-null values are constrained.
CREATE UNIQUE INDEX uq_professional_user_id ON professionals (user_id)
    WHERE user_id IS NOT NULL;
