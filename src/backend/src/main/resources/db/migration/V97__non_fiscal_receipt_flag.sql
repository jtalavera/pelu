-- Comprobante NO fiscal (tier Estándar): when SIFEN electronic invoicing is not active, the printable
-- comprobante is a non-fiscal receipt (A4 or 80 mm ticket) instead of the old pre-printed form.
-- Same mechanism and resolution rule as every other flag (global AND tier AND tenant, V63). It starts
-- ON globally, so every tier has it (Estándar included); a Platform Admin can switch it off per tier
-- or per tenant. Mirrored in FemmeDataInitializer (Flyway is disabled for `e2e`).
IF NOT EXISTS (SELECT 1 FROM feature_flags WHERE flag_key = 'NON_FISCAL_RECEIPT')
  INSERT INTO feature_flags (flag_key, enabled, description)
  VALUES ('NON_FISCAL_RECEIPT', 1, 'Comprobante no fiscal (A4 o ticket 80 mm) cuando SIFEN no esta activo. Off -> el PDF del comprobante responde 409 NON_FISCAL_RECEIPT_NOT_ENABLED.');
