-- HU-69: cumpleaños (día y mes juntos, año opcional) y "cómo nos conoció" de la cliente.
-- Day and month are separate columns (not a DATE) so the year can stay unknown and "birthday
-- today" needs no date functions.
ALTER TABLE clients ADD birthday_day TINYINT NULL;
ALTER TABLE clients ADD birthday_month TINYINT NULL;
ALTER TABLE clients ADD birthday_year SMALLINT NULL;
ALTER TABLE clients ADD acquisition_channel VARCHAR(30) NULL;
ALTER TABLE clients ADD acquisition_channel_other NVARCHAR(100) NULL;
