-- Stock integration (HU-59): feature flags consumed by control-stock. Same mechanism and resolution
-- rule as every other flag (global AND tier AND tenant, V63) — no special-casing. Descriptions
-- mirror control-stock's catalog (GET /api/v1/integration/feature-flags/catalog).
-- STOCK_MODULE starts OFF globally: no tenant has Stock until a Platform Admin turns it on.
-- STOCK_HOST_MOVEMENTS_ALLOW_NEGATIVE is deliberately NOT registered: Stock uses its default (true).
IF NOT EXISTS (SELECT 1 FROM feature_flags WHERE flag_key = 'STOCK_MODULE')
  INSERT INTO feature_flags (flag_key, enabled, description)
  VALUES ('STOCK_MODULE', 0, 'The tenant has the stock module. Off → user API answers 403 STOCK_MODULE_DISABLED.');

IF NOT EXISTS (SELECT 1 FROM feature_flags WHERE flag_key = 'STOCK_PHYSICAL_COUNT')
  INSERT INTO feature_flags (flag_key, enabled, description)
  VALUES ('STOCK_PHYSICAL_COUNT', 1, 'Physical inventory (counts) available.');

IF NOT EXISTS (SELECT 1 FROM feature_flags WHERE flag_key = 'STOCK_TOURS')
  INSERT INTO feature_flags (flag_key, enabled, description)
  VALUES ('STOCK_TOURS', 1, 'Guided tours in the Stock SPA.');
