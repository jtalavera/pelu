-- ── V112: replies from the client over WhatsApp (HU-WAP-06) ───────────────────────────────────
-- client_confirmed_at: when the client tapped «Confirmo» for the turno's CURRENT slot (reset when the
-- turno is moved, like reminder_sent_at).
IF COL_LENGTH('appointments', 'client_confirmed_at') IS NULL
  ALTER TABLE appointments ADD client_confirmed_at DATETIME2 NULL;

-- whatsapp_auto_replies: the last time the fixed «this number only sends notices» text went to a
-- phone, so it is answered once every 24 hours (criterio 7). Phones only, never message contents.
IF OBJECT_ID('whatsapp_auto_replies', 'U') IS NULL
  CREATE TABLE whatsapp_auto_replies (
    phone      VARCHAR(32) NOT NULL PRIMARY KEY,
    replied_at DATETIME2   NOT NULL
  );
