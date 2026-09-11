-- HU-54 (Épica E — Importación de datos vía Excel): "el reporte de la última importación de cada
-- tenant queda disponible para volver a consultarlo, no solo en el momento de importar" (AC-4).
-- One row per (tenant_id, entity_type), overwritten on each import attempt for that pair — same
-- "single last result" convention as tenant_status_changes (V44) / tier_feature_flag_changes (V47).
-- Persists every attempt, including whole-file rejections (fileAccepted=false, HU-50 AC-5/AC-6), so
-- the Platform Admin can revisit why the last attempt failed, not only successful runs.
CREATE TABLE tenant_import_runs (
  id                        BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  tenant_id                 BIGINT        NOT NULL,
  entity_type               NVARCHAR(20)  NOT NULL,
  file_name                 NVARCHAR(260) NOT NULL,
  file_accepted             BIT           NOT NULL,
  error_code                NVARCHAR(60)  NULL,
  missing_required_columns  NVARCHAR(500) NULL,
  total_rows                INT           NOT NULL,
  imported_count            INT           NOT NULL,
  failed_count              INT           NOT NULL,
  imported_at               DATETIME2     NOT NULL,
  imported_by_user_id       BIGINT        NOT NULL,
  imported_by_email         NVARCHAR(320) NOT NULL,
  CONSTRAINT uq_tenant_import_runs_tenant_entity UNIQUE (tenant_id, entity_type)
);

-- Per-row outcomes (AC-2: row number + specific rejection reason for every failed row). Replaced
-- wholesale (delete + re-insert) every time its parent run is overwritten.
CREATE TABLE tenant_import_run_rows (
  id             BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  import_run_id  BIGINT       NOT NULL,
  row_number     INT          NOT NULL,
  imported       BIT          NOT NULL,
  error_code     NVARCHAR(60) NULL,
  name           NVARCHAR(255) NULL,
  CONSTRAINT fk_tenant_import_run_rows_run FOREIGN KEY (import_run_id)
    REFERENCES tenant_import_runs(id) ON DELETE CASCADE
);

CREATE INDEX ix_tenant_import_run_rows_run ON tenant_import_run_rows(import_run_id);
