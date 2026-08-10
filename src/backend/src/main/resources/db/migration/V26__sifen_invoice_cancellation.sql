-- SIFEN HU-10: registers a cancellation event (SiRecepEvento, rGeVeCan) against an invoice already
-- Aprobado/Aprobado con observación. AC-05: keeps a historical record of the last cancellation
-- attempt (date/time, user, reason, SIFEN's own result) — overwritten on each attempt, same
-- "single last result" pattern HU-06/HU-07 already use for sifen_submission_result_code/message
-- (never a separate audit-log table in this codebase). sifen_submission_status only actually
-- transitions to CANCELLED once SIFEN approves the event (AC-03); a rejected attempt (AC-04) still
-- populates these columns but leaves sifen_submission_status untouched.
ALTER TABLE invoices ADD sifen_cancellation_requested_at DATETIME2 NULL;
ALTER TABLE invoices ADD sifen_cancellation_requested_by_user_id BIGINT NULL;
ALTER TABLE invoices ADD sifen_cancellation_requested_by_email NVARCHAR(320) NULL;
ALTER TABLE invoices ADD sifen_cancellation_reason NVARCHAR(500) NULL;
ALTER TABLE invoices ADD sifen_cancellation_result_code NVARCHAR(10) NULL;
ALTER TABLE invoices ADD sifen_cancellation_message NVARCHAR(2000) NULL;
ALTER TABLE invoices ADD sifen_cancellation_protocol_number NVARCHAR(10) NULL;
