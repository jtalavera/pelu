-- SIFEN envío por lote (SIFEN_SYNC_SUBMISSION off): the dProtConsLote SIFEN returns when it accepts
-- the lote an invoice was sent in — the number consulta-lote needs to fetch the document's final
-- result. Null for invoices sent through the synchronous service.
IF COL_LENGTH('invoices', 'sifen_batch_number') IS NULL
  ALTER TABLE invoices ADD sifen_batch_number NVARCHAR(64) NULL;
