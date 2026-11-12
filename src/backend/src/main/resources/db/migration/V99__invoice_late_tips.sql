-- ── V99: Propinas cargadas después de emitir el comprobante ────────────────

-- A tip left for a professional after the invoice was already issued. Unlike invoice_tips (entered
-- on the comprobante and collected together with its payments), the money of a late tip never
-- travels through the invoice's payments: each row records how it was paid (method, card brand) and
-- the open cash session it entered, so the register's expected cash and per-method breakdown include
-- it. It adds to the professional's tip balance. It is never deleted: it can only be voided (by the
-- salon administrator, with a reason), after which it stops counting everywhere but stays visible.
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'invoice_late_tips') AND type = N'U')
BEGIN
  CREATE TABLE invoice_late_tips (
    id                            BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    tenant_id                     BIGINT NOT NULL,
    invoice_id                    BIGINT NOT NULL,
    professional_id               BIGINT NOT NULL,
    cash_session_id               BIGINT NOT NULL,
    amount                        DECIMAL(19,2) NOT NULL,
    payment_method                VARCHAR(20) NOT NULL,
    card_brand                    VARCHAR(20) NULL,
    card_brand_other_description  NVARCHAR(100) NULL,
    created_by_user_id            BIGINT NULL,
    created_at                    DATETIME2 NOT NULL,
    voided_at                     DATETIME2 NULL,
    voided_by_user_id             BIGINT NULL,
    void_reason                   NVARCHAR(200) NULL,
    CONSTRAINT fk_invoice_late_tips_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    CONSTRAINT fk_invoice_late_tips_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id),
    CONSTRAINT fk_invoice_late_tips_professional FOREIGN KEY (professional_id) REFERENCES professionals(id),
    CONSTRAINT fk_invoice_late_tips_cash_session FOREIGN KEY (cash_session_id) REFERENCES cash_sessions(id),
    CONSTRAINT fk_invoice_late_tips_created_by FOREIGN KEY (created_by_user_id) REFERENCES app_users(id),
    CONSTRAINT fk_invoice_late_tips_voided_by FOREIGN KEY (voided_by_user_id) REFERENCES app_users(id)
  );
  CREATE INDEX ix_invoice_late_tips_invoice ON invoice_late_tips(invoice_id);
  CREATE INDEX ix_invoice_late_tips_tenant_professional ON invoice_late_tips(tenant_id, professional_id);
  CREATE INDEX ix_invoice_late_tips_cash_session ON invoice_late_tips(cash_session_id);
END;
