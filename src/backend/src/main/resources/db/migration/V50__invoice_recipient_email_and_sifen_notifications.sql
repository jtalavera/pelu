-- Issue #173: recipient email captured on the comprobante form, plus tracking columns for the
-- two new automatic SIFEN notifications (KuDE after a successful result, cancellation notice).
ALTER TABLE invoices ADD recipient_email NVARCHAR(320) NULL;
ALTER TABLE invoices ADD sifen_kude_emailed_at DATETIME2 NULL;
ALTER TABLE invoices ADD sifen_cancellation_notified_at DATETIME2 NULL;
