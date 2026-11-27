-- ── V110: WhatsApp consent (HU-WAP-03) ────────────────────────────────────────────────────────
-- Existing clients get NO consent (opt_in = 0): they keep receiving the reminder by email until they
-- agree (D10/D11). The consent is bound to the number it was given for (whatsapp_opt_in_phone, E.164):
-- when the salon changes the client's phone, the consent is cleared.
IF COL_LENGTH('clients', 'whatsapp_opt_in') IS NULL
  ALTER TABLE clients ADD whatsapp_opt_in BIT NOT NULL CONSTRAINT df_clients_whatsapp_opt_in DEFAULT 0;
IF COL_LENGTH('clients', 'whatsapp_opt_in_at') IS NULL
  ALTER TABLE clients ADD whatsapp_opt_in_at DATETIME2 NULL;
IF COL_LENGTH('clients', 'whatsapp_opt_in_source') IS NULL
  ALTER TABLE clients ADD whatsapp_opt_in_source VARCHAR(16) NULL;   -- ONLINE_BOOKING | STAFF | EMAIL_LINK | REPLY
IF COL_LENGTH('clients', 'whatsapp_opt_in_phone') IS NULL
  ALTER TABLE clients ADD whatsapp_opt_in_phone VARCHAR(32) NULL;
IF COL_LENGTH('clients', 'whatsapp_opt_out_at') IS NULL
  ALTER TABLE clients ADD whatsapp_opt_out_at DATETIME2 NULL;

-- Platform-wide opt-out BY PHONE: there is one shared number, so a "BAJA" reply applies to every
-- salon (HU-WAP-03 criterio 5). A salon cannot re-enable a phone listed here.
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'whatsapp_opt_outs') AND type = N'U')
BEGIN
  CREATE TABLE whatsapp_opt_outs (
    phone         VARCHAR(32) NOT NULL PRIMARY KEY,   -- E.164
    opted_out_at  DATETIME2   NOT NULL,
    source        VARCHAR(16) NOT NULL                -- REPLY | STAFF
  );
END;

-- Phones Meta reported as having no WhatsApp: not retried until the client's phone changes
-- (HU-WAP-07 criterio 4).
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'whatsapp_unreachable') AND type = N'U')
BEGIN
  CREATE TABLE whatsapp_unreachable (
    phone      VARCHAR(32) NOT NULL PRIMARY KEY,      -- E.164
    marked_at  DATETIME2   NOT NULL,
    reason     VARCHAR(64) NOT NULL
  );
END;
