-- ── V107: feature flag of online booking (requirements/user_stories/Especificacion_Reserva_Online_y_Ficha_Tecnica.md, §7.1) ──
-- Starts OFF globally. Effective value = global AND tier AND tenant (FeatureFlagService).
-- It is created with the WhatsApp channel (increment C0) because WhatsApp only works when the
-- salon also has online booking (HU-WAP-01, criterio 8).
IF NOT EXISTS (SELECT 1 FROM feature_flags WHERE flag_key = 'ONLINE_BOOKING')
  INSERT INTO feature_flags (flag_key, enabled, description)
  VALUES ('ONLINE_BOOKING', 0, 'Online booking page for clients (public link, verification code, manage-your-appointment link).');
