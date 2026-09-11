-- HU-38 (Editar tenant) AC-6: "queda registro de quién cambió qué y cuándo, al menos para el
-- cambio de tier" — same audit convention as tenant_feature_flag_changes (V18, SIFEN HU-22): one
-- row per tenant, overwritten on each tier change, storing both the id and a name snapshot so the
-- record still reads correctly even if a tier is later renamed (HU-45 CRUD, not yet built).
CREATE TABLE tenant_tier_changes (
  id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  previous_tier_id BIGINT NULL,
  previous_tier_name NVARCHAR(100) NULL,
  new_tier_id BIGINT NULL,
  new_tier_name NVARCHAR(100) NULL,
  changed_at DATETIME2 NOT NULL,
  changed_by_user_id BIGINT NOT NULL,
  changed_by_email NVARCHAR(320) NOT NULL,
  CONSTRAINT uq_tenant_tier_changes_tenant UNIQUE (tenant_id)
);
