-- ── V15: Ficha de servicio (service records) + invoice tips/link ───────────

-- One service record per client visit, from check-in to comprobante issuance.
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'service_records') AND type = N'U')
BEGIN
  CREATE TABLE service_records (
    id           BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    tenant_id    BIGINT NOT NULL,
    client_id    BIGINT NOT NULL,
    status       NVARCHAR(32) NOT NULL CONSTRAINT df_service_records_status DEFAULT 'OPEN',
    total_amount DECIMAL(19,2) NOT NULL CONSTRAINT df_service_records_total DEFAULT 0,
    void_reason  NVARCHAR(500) NULL,
    created_at   DATETIME2 NOT NULL,
    closed_at    DATETIME2 NULL,
    CONSTRAINT fk_service_records_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    CONSTRAINT fk_service_records_client FOREIGN KEY (client_id) REFERENCES clients(id)
  );
  CREATE INDEX ix_service_records_tenant ON service_records(tenant_id);
  CREATE INDEX ix_service_records_client ON service_records(client_id);
END;

-- One line per service performed by a professional during the visit.
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'service_record_lines') AND type = N'U')
BEGIN
  CREATE TABLE service_record_lines (
    id                BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    service_record_id BIGINT NOT NULL,
    service_id        BIGINT NOT NULL,
    professional_id   BIGINT NOT NULL,
    description       NVARCHAR(255) NOT NULL,
    unit_price        DECIMAL(19,2) NOT NULL,
    CONSTRAINT fk_service_record_lines_record FOREIGN KEY (service_record_id) REFERENCES service_records(id) ON DELETE CASCADE,
    CONSTRAINT fk_service_record_lines_service FOREIGN KEY (service_id) REFERENCES services(id),
    CONSTRAINT fk_service_record_lines_professional FOREIGN KEY (professional_id) REFERENCES professionals(id)
  );
  CREATE INDEX ix_service_record_lines_record ON service_record_lines(service_record_id);
  CREATE INDEX ix_service_record_lines_service ON service_record_lines(service_id);
  CREATE INDEX ix_service_record_lines_professional ON service_record_lines(professional_id);
END;

-- One tip row per distinct professional who performed a service on the visit.
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'service_record_tips') AND type = N'U')
BEGIN
  CREATE TABLE service_record_tips (
    id                BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    service_record_id BIGINT NOT NULL,
    professional_id   BIGINT NOT NULL,
    amount            DECIMAL(19,2) NOT NULL CONSTRAINT df_service_record_tips_amount DEFAULT 0,
    CONSTRAINT fk_service_record_tips_record FOREIGN KEY (service_record_id) REFERENCES service_records(id) ON DELETE CASCADE,
    CONSTRAINT fk_service_record_tips_professional FOREIGN KEY (professional_id) REFERENCES professionals(id),
    CONSTRAINT uq_service_record_tips_record_professional UNIQUE (service_record_id, professional_id)
  );
  CREATE INDEX ix_service_record_tips_record ON service_record_tips(service_record_id);
END;

-- Invoices may originate from a service record: carry the tips collected at payment time
-- (informational only — never part of subtotal/discount/total or the printed comprobante)
-- and a one-to-one link back to the ficha, used to auto-close it on issuance.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'invoices') AND name = N'tips_amount')
BEGIN
  ALTER TABLE invoices
    ADD tips_amount DECIMAL(19,2) NOT NULL CONSTRAINT df_invoices_tips_amount DEFAULT 0;
END;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'invoices') AND name = N'service_record_id')
BEGIN
  ALTER TABLE invoices
    ADD service_record_id BIGINT NULL
        CONSTRAINT fk_invoices_service_record FOREIGN KEY REFERENCES service_records(id);
END;
GO

-- Separate batch: SQL Server can't resolve a column in the same batch that added it via ALTER TABLE.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'invoices') AND name = N'uq_invoices_service_record')
BEGIN
  CREATE UNIQUE INDEX uq_invoices_service_record ON invoices(service_record_id) WHERE service_record_id IS NOT NULL;
END;
