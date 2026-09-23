-- RT-25 (Hardening_SIFEN.md): "Inutilización de numeración" events (Manual Técnico V150 sección
-- 11.6.2) — recorded either manually by a tenant ADMIN or automatically when a rejected invoice
-- leaves a document number unused (see SifenNumberVoidingService's javadoc). invoice_id is nullable
-- (manual records have none); the filtered unique index below still guarantees at most one
-- automatic record per invoice.
CREATE TABLE sifen_number_voiding_events (
    id              BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    tenant_id       BIGINT        NOT NULL,
    fiscal_stamp_id BIGINT        NOT NULL,
    invoice_id      BIGINT        NULL,
    document_type   VARCHAR(20)   NOT NULL,
    range_from      INT           NOT NULL,
    range_to        INT           NOT NULL,
    reason          NVARCHAR(500) NULL,
    status          VARCHAR(30)   NOT NULL,
    deadline_date   DATE          NOT NULL,
    created_at      DATETIME2     NOT NULL,
    submitted_at    DATETIME2     NULL,
    result_code     NVARCHAR(20)  NULL,
    message         NVARCHAR(1000) NULL,
    protocol_number NVARCHAR(50)  NULL,
    CONSTRAINT fk_sifen_number_voiding_events_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    CONSTRAINT fk_sifen_number_voiding_events_stamp FOREIGN KEY (fiscal_stamp_id) REFERENCES fiscal_stamps(id),
    CONSTRAINT fk_sifen_number_voiding_events_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id)
);

CREATE UNIQUE INDEX ux_sifen_number_voiding_events_invoice ON sifen_number_voiding_events(invoice_id)
    WHERE invoice_id IS NOT NULL;

CREATE INDEX ix_sifen_number_voiding_events_tenant ON sifen_number_voiding_events(tenant_id);
