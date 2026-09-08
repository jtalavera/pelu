-- HU-43 (Desactivar/reactivar usuario de tenant): "cambios de estado ... quedan registrados con
-- quién y cuándo" (PRD "Auditoría") — same convention as tenant_status_changes (V44): one row per
-- app_user, overwritten on each enabled/disabled change.
CREATE TABLE app_user_status_changes (
  id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  app_user_id BIGINT NOT NULL,
  previous_enabled BIT NOT NULL,
  new_enabled BIT NOT NULL,
  changed_at DATETIME2 NOT NULL,
  changed_by_user_id BIGINT NOT NULL,
  changed_by_email NVARCHAR(320) NOT NULL,
  CONSTRAINT uq_app_user_status_changes_user UNIQUE (app_user_id)
);
