-- RT-24 (Hardening_SIFEN.md): defense in depth for the two fiscal identifiers that must never
-- repeat. Today uniqueness depends entirely on the pessimistic lock in
-- InvoiceService.issueInvoice (FiscalStampRepository.lockByIdAndTenantId, PESSIMISTIC_WRITE) —
-- correct in the one place that generates them, but with no backstop against a future bug, a
-- direct insert, or a code path that bypasses that lock. A duplicate CDC or invoice number is not
-- a cosmetic bug for a fiscal document: it reads as fraud/duplication to SIFEN or to an audit.
--
-- Filtered (sifen_control_number IS NOT NULL) because tenants without SIFEN electronic invoicing
-- enabled never populate that column.
CREATE UNIQUE INDEX ux_invoices_sifen_control_number ON invoices(sifen_control_number)
  WHERE sifen_control_number IS NOT NULL;

CREATE UNIQUE INDEX ux_invoices_stamp_number ON invoices(fiscal_stamp_id, invoice_number);
