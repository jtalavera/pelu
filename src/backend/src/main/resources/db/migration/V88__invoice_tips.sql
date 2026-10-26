-- Tips entered directly on the comprobante form (per professional who served a line), for invoices
-- not generated from a "ficha de servicio" — a ficha's own tips stay in service_record_tips.
-- Informational only: never part of subtotal/discount/total or the printed comprobante.
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'invoice_tips') AND type = N'U')
BEGIN
  CREATE TABLE invoice_tips (
    id              BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    invoice_id      BIGINT NOT NULL,
    professional_id BIGINT NOT NULL,
    amount          DECIMAL(19,2) NOT NULL CONSTRAINT df_invoice_tips_amount DEFAULT 0,
    CONSTRAINT fk_invoice_tips_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
    CONSTRAINT fk_invoice_tips_professional FOREIGN KEY (professional_id) REFERENCES professionals(id),
    CONSTRAINT uq_invoice_tips_invoice_professional UNIQUE (invoice_id, professional_id)
  );
  CREATE INDEX ix_invoice_tips_invoice ON invoice_tips(invoice_id);
  CREATE INDEX ix_invoice_tips_professional ON invoice_tips(professional_id);
END;
