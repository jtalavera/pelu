-- SIFEN HU-11: registers a client-identification event ("Evento de Nominación", rGEveNom) against
-- an invoice already Aprobado/Aprobado con observación that was issued without client data. AC-01:
-- sifen_client_identified gates whether the option is offered again (true only once SIFEN itself
-- approves the event) — a rejected attempt (AC-06) leaves it false, so another attempt stays
-- possible, same "not a one-shot lock" behavior as HU-10's own cancellation gate. AC-05: the rest of
-- these columns keep the historical record of the last attempt (date/time, user, the data submitted,
-- SIFEN's own result) — same "single last result" pattern as sifen_cancellation_* (HU-10), never a
-- separate audit-log table.
ALTER TABLE invoices ADD sifen_client_identified BIT NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD sifen_client_identification_requested_at DATETIME2 NULL;
ALTER TABLE invoices ADD sifen_client_identification_requested_by_user_id BIGINT NULL;
ALTER TABLE invoices ADD sifen_client_identification_requested_by_email NVARCHAR(320) NULL;
ALTER TABLE invoices ADD sifen_client_identification_client_type NVARCHAR(20) NULL;
ALTER TABLE invoices ADD sifen_client_identification_ruc NVARCHAR(20) NULL;
ALTER TABLE invoices ADD sifen_client_identification_identity_document NVARCHAR(20) NULL;
ALTER TABLE invoices ADD sifen_client_identification_name NVARCHAR(255) NULL;
ALTER TABLE invoices ADD sifen_client_identification_address NVARCHAR(255) NULL;
ALTER TABLE invoices ADD sifen_client_identification_country_code NVARCHAR(3) NULL;
ALTER TABLE invoices ADD sifen_client_identification_result_code NVARCHAR(10) NULL;
ALTER TABLE invoices ADD sifen_client_identification_message NVARCHAR(2000) NULL;
ALTER TABLE invoices ADD sifen_client_identification_protocol_number NVARCHAR(10) NULL;
