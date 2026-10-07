-- Catalog split (Servicios / Productos): every category now belongs to exactly one kind, so the
-- "Servicios" and "Productos" screens each have their own, non-overlapping set of categories.
--
-- Data migration rule (agreed with the product owner): items whose category is one of the service
-- categories (Servicios de peluquería, Servicios especiales, Tratamientos, Otros, Servicios
-- profesionales) become SERVICE; items in ANY other category become PRODUCT. The category decides:
-- the kind of each category is set first and then copied onto every item it contains, so an item
-- can never disagree with its category afterwards.
--
-- Matching is trimmed, case- and accent-insensitive. The accented names are matched with LIKE '_'
-- wildcards so the script does not depend on the file encoding Flyway reads it with.
--
-- Everything runs once, inside the "column missing" guard: re-running the script never overwrites
-- kinds that users changed later. The UPDATEs are EXEC'd because SQL Server compiles the whole
-- batch before the ALTER takes effect and would otherwise reject the new column name.
IF COL_LENGTH('service_categories', 'kind') IS NULL
BEGIN
  ALTER TABLE service_categories
    ADD kind NVARCHAR(16) NOT NULL CONSTRAINT df_service_categories_kind DEFAULT 'SERVICE';

  EXEC('
    UPDATE service_categories
    SET kind = CASE
      WHEN LTRIM(RTRIM(name)) COLLATE Latin1_General_CI_AI LIKE ''Servicios de peluquer_a''
        OR LTRIM(RTRIM(name)) COLLATE Latin1_General_CI_AI LIKE ''Servicios especiales''
        OR LTRIM(RTRIM(name)) COLLATE Latin1_General_CI_AI LIKE ''Tratamientos''
        OR LTRIM(RTRIM(name)) COLLATE Latin1_General_CI_AI LIKE ''Otros''
        OR LTRIM(RTRIM(name)) COLLATE Latin1_General_CI_AI LIKE ''Servicios profesionales''
      THEN ''SERVICE''
      ELSE ''PRODUCT''
    END;

    UPDATE s
    SET s.kind = c.kind
    FROM services s
    JOIN service_categories c ON c.id = s.category_id;
  ');
END;

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'ix_service_categories_tenant_kind' AND object_id = OBJECT_ID(N'service_categories')
)
  EXEC('CREATE INDEX ix_service_categories_tenant_kind ON service_categories(tenant_id, kind);');
