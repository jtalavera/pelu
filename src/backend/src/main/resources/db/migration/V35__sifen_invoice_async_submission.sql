-- RT-20 (Hardening_SIFEN.md): asynchronous SIFEN transmission via Azure Service Bus.
--
-- sifen_processing_started_at is a lease, not a lock: Basic-tier Service Bus has no sessions, so
-- PeekLock only guarantees one consumer per MESSAGE, not per INVOICE — a retry message and the
-- @Scheduled safety net could otherwise both be picked up at once. A conditional claim on this
-- column (SifenInvoiceSubmissionPersistenceService.claimForSubmission, via a pessimistic row lock)
-- is what actually prevents two replicas from transmitting the same fiscal document.
ALTER TABLE invoices ADD sifen_attempt_count INT NOT NULL
  CONSTRAINT df_invoices_sifen_attempt_count DEFAULT 0;
ALTER TABLE invoices ADD sifen_next_attempt_at DATETIME2 NULL;
ALTER TABLE invoices ADD sifen_processing_started_at DATETIME2 NULL;
GO

-- Drives the SifenSubmissionReconciler's scan (both the backoff-retry and the never-enqueued
-- safety-net cases) — filtered so it stays tiny relative to the full invoices table.
CREATE INDEX ix_invoices_sifen_retry ON invoices(sifen_next_attempt_at)
  WHERE sifen_next_attempt_at IS NOT NULL;
