-- ── V108: feature flag of the WhatsApp channel (HU-WAP-01, §7.1) ───────────────────────────────
-- Starts OFF globally. Covers every transactional WhatsApp message, not only reminders. The
-- channel also needs ONLINE_BOOKING on for the salon and the platform switch WHATSAPP_ENABLED.
IF NOT EXISTS (SELECT 1 FROM feature_flags WHERE flag_key = 'WHATSAPP_REMINDERS')
  INSERT INTO feature_flags (flag_key, enabled, description)
  VALUES ('WHATSAPP_REMINDERS', 0, 'WhatsApp channel: booking confirmations, reminders and replies (needs ONLINE_BOOKING).');
