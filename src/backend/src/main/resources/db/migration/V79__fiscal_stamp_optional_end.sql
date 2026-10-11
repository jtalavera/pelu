-- Issue #290: "Fecha de fin de vigencia" and "Número hasta" are optional — electronic invoicing
-- (SIFEN) requires neither (dFeFinT is not emitted, and a timbrado for DE has no upper number).
ALTER TABLE fiscal_stamps ALTER COLUMN valid_until DATE NULL;
ALTER TABLE fiscal_stamps ALTER COLUMN range_to INT NULL;
