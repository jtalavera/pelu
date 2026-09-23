-- ── V16: Ficha de servicio — quantity per line ─────────────────────────────

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'service_record_lines') AND name = N'quantity')
BEGIN
  ALTER TABLE service_record_lines
    ADD quantity INT NOT NULL CONSTRAINT df_service_record_lines_quantity DEFAULT 1;
END;
