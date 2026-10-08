-- Stock integration: a per-delivery history of user-facing messages (JSON array of
-- {at, level, code, params}), so the support panel can tell exactly what happened to a delivery:
-- queued, attempted, failed (and why), retried, superseded, discarded, delivered. Codes are
-- translated by the frontend (femme.platform.stock.msg.*); the backend never stores prose.
IF COL_LENGTH('stock_outbox', 'user_messages_json') IS NULL
BEGIN
  ALTER TABLE stock_outbox ADD user_messages_json NVARCHAR(MAX) NULL;
END;
