-- SIFEN: chooses the transmission channel for a tenant's electronic documents. Same mechanism and
-- resolution rule as every other flag (global AND tier AND tenant, V63):
--   ON  (effective) → envío inmediato, synchronous SiRecepDE (/de/ws/sync/recibe.wsdl) — the only
--                     channel used until now.
--   OFF (any level) → envío por lote, asynchronous SiRecepLoteDE (/de/ws/async/recibe-lote.wsdl),
--                     one document per lote, result polled through consulta-lote.
-- SIFEN production answers SiRecepDE with dCodRes=1264 "RUC del emisor no está habilitado para
-- utilizar este tipo de servicio" for taxpayers not enabled for the synchronous service, so those
-- tenants need the flag OFF. Global default ON keeps every tenant's current behaviour.
IF NOT EXISTS (SELECT 1 FROM feature_flags WHERE flag_key = 'SIFEN_SYNC_SUBMISSION')
  INSERT INTO feature_flags (flag_key, enabled, description)
  VALUES ('SIFEN_SYNC_SUBMISSION', 1, 'SIFEN transmission channel. On → envío inmediato (synchronous SiRecepDE). Off at any level → envío por lote (asynchronous SiRecepLoteDE + consulta-lote).');
