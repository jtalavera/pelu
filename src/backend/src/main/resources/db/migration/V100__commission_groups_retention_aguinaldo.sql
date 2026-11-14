-- Comisiones v2 (HU-COM-14): grupos de comisión, reglas por profesional + grupo con retención de
-- aguinaldo y monto fijo (costo de producto), y fondo de aguinaldo por profesional.

-- Grupos de comisión: juntan servicios que comisionan igual (Brushing, Color, Manos…).
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'commission_groups') AND type = N'U')
BEGIN
  CREATE TABLE commission_groups (
    id          BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    tenant_id   BIGINT NOT NULL,
    name        NVARCHAR(120) NOT NULL,
    created_at  DATETIME2 NOT NULL,
    CONSTRAINT fk_commission_group_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    CONSTRAINT uq_commission_group_name UNIQUE (tenant_id, name)
  );
END;

-- Cada servicio pertenece como máximo a un grupo.
IF COL_LENGTH('services', 'commission_group_id') IS NULL
BEGIN
  ALTER TABLE services ADD commission_group_id BIGINT NULL;
  ALTER TABLE services ADD CONSTRAINT fk_services_commission_group
    FOREIGN KEY (commission_group_id) REFERENCES commission_groups(id);
END;

-- Las reglas de grupo (scope GROUP_RULE) usan group_id; el valor de una regla ahora puede ser
-- "pago|retención|montoFijo|destino" (p. ej. "45|5|3000|P"), por eso se ensancha config_value.
IF COL_LENGTH('commission_config_versions', 'group_id') IS NULL
BEGIN
  ALTER TABLE commission_config_versions ADD group_id BIGINT NULL;
  ALTER TABLE commission_config_versions ADD CONSTRAINT fk_commission_config_group
    FOREIGN KEY (group_id) REFERENCES commission_groups(id);
END;

ALTER TABLE commission_config_versions ALTER COLUMN config_value NVARCHAR(128) NULL;

-- Snapshot del cálculo en cada movimiento: monto fijo (costo de producto), a quién va, y la
-- retención para aguinaldo. commission_amount pasa a ser lo que se le paga a la profesional por la
-- línea (porcentaje + monto fijo cuando es para la profesional).
IF COL_LENGTH('commission_entries', 'fixed_amount') IS NULL
BEGIN
  ALTER TABLE commission_entries ADD fixed_amount DECIMAL(19,2) NOT NULL CONSTRAINT df_commission_entry_fixed DEFAULT 0;
  ALTER TABLE commission_entries ADD fixed_to_professional BIT NOT NULL CONSTRAINT df_commission_entry_fixed_prof DEFAULT 1;
  ALTER TABLE commission_entries ADD retention_percent DECIMAL(5,2) NOT NULL CONSTRAINT df_commission_entry_ret_pct DEFAULT 0;
  ALTER TABLE commission_entries ADD retention_amount DECIMAL(19,2) NOT NULL CONSTRAINT df_commission_entry_ret DEFAULT 0;
END;

-- Fondo de aguinaldo: lo retenido entra solo (suma de retention_amount de las liquidaciones
-- aprobadas o pagadas); acá quedan los pagos y los ajustes manuales (importe con signo: el pago
-- resta, el ajuste suma o resta).
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'aguinaldo_movements') AND type = N'U')
BEGIN
  CREATE TABLE aguinaldo_movements (
    id                 BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    tenant_id          BIGINT NOT NULL,
    professional_id    BIGINT NOT NULL,
    kind               NVARCHAR(16) NOT NULL,
    amount             DECIMAL(19,2) NOT NULL,
    occurred_on        DATE NOT NULL,
    payment_method     NVARCHAR(32) NULL,
    closes_fund        BIT NOT NULL DEFAULT 0,
    note               NVARCHAR(500) NULL,
    created_at         DATETIME2 NOT NULL,
    created_by_email   NVARCHAR(320) NULL,
    CONSTRAINT fk_aguinaldo_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    CONSTRAINT fk_aguinaldo_professional FOREIGN KEY (professional_id) REFERENCES professionals(id)
  );
  CREATE INDEX ix_aguinaldo_professional ON aguinaldo_movements(tenant_id, professional_id, occurred_on);
END;
