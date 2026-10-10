-- SIFEN envío por lote: how many consulta-lote polls the invoice's current lote has had. The
-- listener's polling cadence is count-based (30 polls 1s apart, then 15 polls 2s apart, then the
-- minute/hour backoff), so it needs the count rather than the elapsed time. Reset to 0 whenever a
-- new lote is accepted and on "corregir y reenviar".
IF COL_LENGTH('invoices', 'sifen_batch_poll_count') IS NULL
  ALTER TABLE invoices ADD sifen_batch_poll_count INT NOT NULL
    CONSTRAINT df_invoices_sifen_batch_poll_count DEFAULT 0;
