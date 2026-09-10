-- Todo tenant debe tener un tier (HU-37 AC-1 / HU-48 AC-2 ya lo exigen en la capa de aplicación;
-- V41 dejó tenants.tier_id NULL-able "porque el endpoint lo valida"). Ahora se hace obligatorio
-- también a nivel de schema, tras backfillear los tenants preexistentes sin tier.

-- 1. Backfill: tenant sin tier -> el tier por defecto ('Estándar', V41).
UPDATE tenants
SET tier_id = (SELECT MIN(id) FROM tiers WHERE name = N'Estándar')
WHERE tier_id IS NULL;
GO

-- 2. Red de seguridad si 'Estándar' no existiera en algún entorno: cualquier tier.
UPDATE tenants
SET tier_id = (SELECT MIN(id) FROM tiers)
WHERE tier_id IS NULL;
GO

-- 3. Hacer la columna obligatoria. La FK fk_tenants_tier (V41) se mantiene.
ALTER TABLE tenants ALTER COLUMN tier_id BIGINT NOT NULL;
GO
