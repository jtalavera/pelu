-- ── V11: Tax types, service tax FK, invoice line tax/discount, tour state ───

-- Tax types per tenant
CREATE TABLE taxes (
  id         BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  tenant_id  BIGINT NOT NULL,
  name       NVARCHAR(100) NOT NULL,
  rate       DECIMAL(5,2) NOT NULL,
  active     BIT NOT NULL CONSTRAINT df_taxes_active DEFAULT 1,
  CONSTRAINT fk_taxes_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);
CREATE INDEX ix_taxes_tenant ON taxes(tenant_id);

-- Assign a tax type to each service (nullable for migration safety)
ALTER TABLE services
  ADD tax_id BIGINT NULL
      CONSTRAINT fk_services_tax FOREIGN KEY REFERENCES taxes(id);

-- Per-line tax snapshot and per-line discount on invoice lines
ALTER TABLE invoice_lines
  ADD discount_type  NVARCHAR(16)  NULL,
      discount_value DECIMAL(19,2) NULL,
      tax_rate       DECIMAL(19,4) NULL,
      tax_amount     DECIMAL(19,4) NULL;

-- Per-user guided-tour seen state
CREATE TABLE app_user_tour_state (
  id        BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  user_id   BIGINT NOT NULL,
  tour_key  NVARCHAR(100) NOT NULL,
  seen_at   DATETIME2 NOT NULL,
  CONSTRAINT fk_tour_state_user FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE,
  CONSTRAINT uq_tour_state_user_key UNIQUE (user_id, tour_key)
);
CREATE INDEX ix_tour_state_user ON app_user_tour_state(user_id);

-- Seed default tax types for the demo tenant (tenant id = 1)
-- These mirror the most common Paraguayan IVA rates.
INSERT INTO taxes (tenant_id, name, rate, active) VALUES
  (1, N'IVA 10%', 10.00, 1),
  (1, N'IVA 5%',   5.00, 1),
  (1, N'Exento',   0.00, 1);

-- Backfill existing services of tenant 1 to IVA 10% (the first tax above)
UPDATE services
SET tax_id = (SELECT TOP 1 id FROM taxes WHERE tenant_id = 1 AND rate = 10.00)
WHERE tenant_id = 1 AND tax_id IS NULL;
