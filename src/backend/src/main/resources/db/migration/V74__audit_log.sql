-- Auditoría: quién hizo qué en el sistema.
--
-- Una fila por cada operación que modifica datos (POST/PUT/PATCH/DELETE) hecha por un usuario
-- autenticado y que terminó bien. Se registra el usuario, el recurso y la acción, el id del
-- registro afectado y el momento (UTC) — NUNCA el cuerpo del pedido, así que no quedan contraseñas,
-- certificados, CSC ni datos personales en esta tabla.
--
-- tenant_id es NULL para las acciones del usuario root (plataforma). No hay clave foránea al
-- tenant ni al usuario a propósito: la auditoría debe sobrevivir aunque se borre lo auditado, y
-- guarda el email y el rol tal como eran en ese momento.
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'audit_log') AND type = N'U')
BEGIN
  CREATE TABLE audit_log (
    id           BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    tenant_id    BIGINT NULL,
    user_id      BIGINT NULL,
    user_email   NVARCHAR(255) NULL,
    user_role    NVARCHAR(32) NULL,
    http_method  NVARCHAR(8) NOT NULL,
    resource     NVARCHAR(64) NOT NULL,
    operation    NVARCHAR(64) NULL,
    path_pattern NVARCHAR(255) NOT NULL,
    entity_id    NVARCHAR(64) NULL,
    status_code  INT NOT NULL,
    created_at   DATETIME2 NOT NULL
  );
  EXEC('CREATE INDEX ix_audit_log_tenant_created ON audit_log(tenant_id, created_at DESC);');
  EXEC('CREATE INDEX ix_audit_log_created ON audit_log(created_at DESC);');
END;
