-- HU-69 fix-forward: V85 created the birthday columns as TINYINT/SMALLINT, but the entity maps
-- them to Integer, so `ddl-auto=validate` rejected the schema on boot ("found [tinyint], but
-- expecting [int]") and the backend never started. Widen them to INT, and use NVARCHAR for the
-- acquisition channel like every other enum column (V32, V1, …). Nullable, no data loss.
ALTER TABLE clients ALTER COLUMN birthday_day INT NULL;
ALTER TABLE clients ALTER COLUMN birthday_month INT NULL;
ALTER TABLE clients ALTER COLUMN birthday_year INT NULL;
ALTER TABLE clients ALTER COLUMN acquisition_channel NVARCHAR(30) NULL;
