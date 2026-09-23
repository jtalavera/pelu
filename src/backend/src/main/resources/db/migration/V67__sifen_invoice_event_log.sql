-- Issue #205 AC-2: append-only log of every SIFEN interaction for an invoice (submission,
-- cancellation, client-identification attempts), so the "Estado en SIFEN" accordion can show a
-- full history of responses instead of only the latest result per concern. Goes forward only —
-- past attempts recorded before this migration are not retroactively captured.
CREATE TABLE sifen_invoice_event_log (
    id           BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    tenant_id    BIGINT         NOT NULL,
    invoice_id   BIGINT         NOT NULL,
    event_type   VARCHAR(30)    NOT NULL,
    occurred_at  DATETIME2      NOT NULL,
    result_code  NVARCHAR(20)   NULL,
    message      NVARCHAR(1000) NULL,
    CONSTRAINT fk_sifen_invoice_event_log_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    CONSTRAINT fk_sifen_invoice_event_log_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id)
);

CREATE INDEX ix_sifen_invoice_event_log_invoice ON sifen_invoice_event_log(invoice_id, occurred_at);
