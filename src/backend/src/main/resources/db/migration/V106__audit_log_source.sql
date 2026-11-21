-- ── V106: origen de la acción en la auditoría ─────────────────────────────────────────────────────
-- NULL = una llamada directa del usuario a la API (lo de siempre). 'ASSISTANT' = una acción de negocio
-- que la persona confirmó desde el asistente conversacional (p. ej. emitir una factura de un borrador).
IF COL_LENGTH('audit_log', 'source') IS NULL
  ALTER TABLE audit_log ADD source NVARCHAR(16) NULL;
