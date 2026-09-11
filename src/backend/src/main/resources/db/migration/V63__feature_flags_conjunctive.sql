-- HU-47 (revisión 2026-09-09): la resolución de feature flags pasa de "precedencia"
-- (override > tier > global) a "conjunción" (global AND tier AND tenant). Un flag está ON solo si
-- está ON en todos los niveles que aplican; una fila ausente en un nivel significa "heredar" (ON).
--
-- Consecuencia para SIFEN_ELECTRONIC_INVOICING: hoy su default global es OFF y se prende por
-- tenant/tier. Bajo AND eso ya no puede encenderlo. Se invierte el default global a ON y se
-- preserva el estado efectivo actual apagándolo a nivel tenant para todos los que hoy NO lo
-- resuelven ON.

-- 1. Invertir el default global de SIFEN.
UPDATE feature_flags SET enabled = 1 WHERE flag_key = 'SIFEN_ELECTRONIC_INVOICING';
GO

-- 2. Preservar el estado efectivo: apagar SIFEN a nivel tenant para todo tenant que hoy no lo
--    tiene ON (sin fila propia y sin un tier que lo incluya con enabled = 1).
INSERT INTO tenant_feature_flags (tenant_id, flag_key, enabled)
SELECT t.id, 'SIFEN_ELECTRONIC_INVOICING', 0
FROM tenants t
WHERE NOT EXISTS (
        SELECT 1 FROM tenant_feature_flags f
        WHERE f.tenant_id = t.id AND f.flag_key = 'SIFEN_ELECTRONIC_INVOICING')
  AND NOT EXISTS (
        SELECT 1 FROM tier_feature_flags tf
        WHERE tf.tier_id = t.tier_id
          AND tf.flag_key = 'SIFEN_ELECTRONIC_INVOICING'
          AND tf.enabled = 1);
GO

-- 3. Limpiar filas redundantes enabled = 1: bajo AND no aportan nada (ausencia = heredar ON) y
--    en la UI aparecerían como una restricción falsa. Se hace DESPUÉS del paso 2, que consulta
--    tier_feature_flags.enabled = 1. El historial (*_feature_flag_changes) no se toca.
DELETE FROM tier_feature_flags WHERE enabled = 1;
DELETE FROM tenant_feature_flags WHERE enabled = 1;
GO
