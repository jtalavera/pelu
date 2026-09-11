-- HU-40 (Suspender/reactivar tenant): "cambios de estado de tenant quedan registrados con quién y
-- cuándo" (PRD "Auditoría") — same convention as tenant_tier_changes (V42): one row per tenant,
-- overwritten on each status change.
CREATE TABLE tenant_status_changes (
  id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  previous_status NVARCHAR(20) NOT NULL,
  new_status NVARCHAR(20) NOT NULL,
  changed_at DATETIME2 NOT NULL,
  changed_by_user_id BIGINT NOT NULL,
  changed_by_email NVARCHAR(320) NOT NULL,
  CONSTRAINT uq_tenant_status_changes_tenant UNIQUE (tenant_id)
);
