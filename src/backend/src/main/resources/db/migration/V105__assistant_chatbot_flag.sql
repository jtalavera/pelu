-- ── V105: feature flag of the conversational assistant (requirements/asistente/plan_asistente.md) ──
-- Starts OFF globally. Effective value = global AND tier AND tenant (FeatureFlagService), so a
-- Platform Admin turns it on globally and then switches it off for the tiers / tenants that must
-- not have it. Off -> every /api/assistant/** call answers 403 ASSISTANT_DISABLED.
IF NOT EXISTS (SELECT 1 FROM feature_flags WHERE flag_key = 'ASSISTANT_CHATBOT')
  INSERT INTO feature_flags (flag_key, enabled, description)
  VALUES ('ASSISTANT_CHATBOT', 0, 'Conversational assistant in the side panel (queries; later invoicing and booking).');
