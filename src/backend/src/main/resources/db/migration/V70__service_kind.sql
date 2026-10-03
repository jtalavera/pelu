-- Stock integration (HU-59): every catalog item is either a SERVICE (haircut, brushing…) or a
-- PRODUCT (sold over the counter). Only PRODUCT items are synchronised to control-stock. Existing
-- rows become SERVICE. sku is an optional code shown in Stock.
IF COL_LENGTH('services', 'kind') IS NULL
  ALTER TABLE services ADD kind NVARCHAR(16) NOT NULL CONSTRAINT df_services_kind DEFAULT 'SERVICE';

IF COL_LENGTH('services', 'sku') IS NULL
  ALTER TABLE services ADD sku NVARCHAR(64) NULL;
