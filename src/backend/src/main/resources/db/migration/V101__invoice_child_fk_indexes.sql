-- Index the invoice_id foreign key of invoice_lines and invoice_payment_allocations.
-- Without them every "lines/payments of invoice X" lookup scans the whole table: the top two
-- CPU consumers in the staging load test (loadtest-V99-t10-s0 ramp, 2026-11-15), run once per
-- invoice by the invoice list, PDF and issue flows. invoice_tips already has the equivalent index
-- (V88, ix_invoice_tips_invoice).
-- Versioned V101: develop already holds V100 (commission groups).
IF NOT EXISTS (SELECT 1 FROM sys.indexes
               WHERE name = N'ix_invoice_lines_invoice' AND object_id = OBJECT_ID(N'invoice_lines'))
  CREATE INDEX ix_invoice_lines_invoice ON invoice_lines(invoice_id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes
               WHERE name = N'ix_invoice_payment_allocations_invoice'
                 AND object_id = OBJECT_ID(N'invoice_payment_allocations'))
  CREATE INDEX ix_invoice_payment_allocations_invoice ON invoice_payment_allocations(invoice_id);
