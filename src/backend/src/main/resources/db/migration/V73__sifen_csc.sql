-- SIFEN: Código de Seguridad del Contribuyente (CSC) por salón.
--
-- La DNIT entrega un CSC propio y distinto a cada contribuyente (Manual Técnico V150 §13.8.1) y lo
-- usa para validar el hash del QR de cada comprobante, así que cada tenant debe poder cargar el
-- suyo. El valor del CSC es un secreto: NO se guarda en esta tabla sino en el almacén de secretos
-- (Azure Key Vault fuera del perfil e2e), igual que el .p12 del certificado — acá solo queda la
-- referencia (nombre + versión inmutable del secreto) y el IdCSC que la DNIT le asignó.
--
-- Un salón puede tener cargados varios CSC (la DNIT permite hasta dos activos a la vez para rotar),
-- pero solo uno se usa para firmar el QR: el marcado active.
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'sifen_csc') AND type = N'U')
BEGIN
  CREATE TABLE sifen_csc (
    id                 BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    tenant_id          BIGINT NOT NULL,
    id_csc             INT NOT NULL,
    secret_name        NVARCHAR(127) NOT NULL,
    secret_version     NVARCHAR(64) NOT NULL,
    active             BIT NOT NULL CONSTRAINT df_sifen_csc_active DEFAULT 0,
    created_at         DATETIME2 NOT NULL,
    updated_at         DATETIME2 NOT NULL,
    updated_by_user_id BIGINT NULL,
    CONSTRAINT fk_sifen_csc_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    CONSTRAINT uq_sifen_csc_tenant_id_csc UNIQUE (tenant_id, id_csc)
  );
  -- A lo sumo un CSC en uso por salón.
  EXEC('CREATE UNIQUE INDEX ux_sifen_csc_tenant_active ON sifen_csc(tenant_id) WHERE active = 1;');
END;
