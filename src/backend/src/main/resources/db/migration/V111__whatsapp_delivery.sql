-- ── V111: delivery tracking, email fallback and retention (HU-WAP-07) ─────────────────────────
-- fallback_email: where the one-time email fallback goes if WhatsApp fails; it is cleared when the
-- retention job masks the recipient (HU-WAP-07 criterio 9).
IF COL_LENGTH('whatsapp_messages', 'fallback_email') IS NULL
  ALTER TABLE whatsapp_messages ADD fallback_email VARCHAR(320) NULL;
IF COL_LENGTH('whatsapp_messages', 'recipient_masked_at') IS NULL
  ALTER TABLE whatsapp_messages ADD recipient_masked_at DATETIME2 NULL;
