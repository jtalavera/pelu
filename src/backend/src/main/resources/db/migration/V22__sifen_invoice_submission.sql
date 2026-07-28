-- SIFEN HU-06: registers the result of sending a signed document to SIFEN's synchronous
-- reception service. sifen_signed_at is the *first* signature timestamp for this invoice's
-- document, persisted once and reused across retries (AC-07 needs a stable point in time to
-- measure the 72-hour transmission window against, not a fresh "now" on every attempt).
-- sifen_submitted_at is set only once an actual response is received from SIFEN — it stays NULL
-- while a submission is PENDING_VERIFICATION (AC-05: no response was received at all).
ALTER TABLE invoices ADD sifen_signed_at DATETIME2 NULL;
ALTER TABLE invoices ADD sifen_submission_status NVARCHAR(32) NULL;
ALTER TABLE invoices ADD sifen_submission_protocol_number NVARCHAR(10) NULL;
ALTER TABLE invoices ADD sifen_submission_result_code NVARCHAR(10) NULL;
ALTER TABLE invoices ADD sifen_submission_message NVARCHAR(2000) NULL;
ALTER TABLE invoices ADD sifen_submitted_at DATETIME2 NULL;
