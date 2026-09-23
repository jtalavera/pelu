-- ── V18: Ficha de servicio — professional is optional per line ─────────────
-- A ficha only requires a client; a service line can be added before a
-- professional is assigned to it.

ALTER TABLE service_record_lines ALTER COLUMN professional_id BIGINT NULL;
