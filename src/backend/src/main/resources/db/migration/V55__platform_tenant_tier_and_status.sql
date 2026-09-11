-- HU-37 (Épica B — Gestión de Tenants): the "create tenant" form needs a tier to select from
-- (AC-1, "seleccionado de los tiers existentes — ver HU-45") and every tenant needs an explicit
-- lifecycle status (AC-4, Activo by default; HU-40 adds Suspendido). HU-45 (full tier CRUD:
-- create/edit/delete with in-use protection) hasn't landed yet, so this migration creates a
-- minimal `tiers` table now — HU-45 extends it, it doesn't replace it — seeded with one default
-- tier so environments with pre-existing tenants (and this branch's demo tenant) have something to
-- reference.
CREATE TABLE tiers (
  id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  name NVARCHAR(100) NOT NULL,
  description NVARCHAR(500) NULL,
  CONSTRAINT uq_tiers_name UNIQUE (name)
);

INSERT INTO tiers (name, description) VALUES (N'Estándar', N'Tier por defecto.');

-- tier_id is nullable at the schema level (like `domain` above it): the platform "create tenant"
-- endpoint is what enforces "tier required" (AC-1), not the DB, so pre-existing tenants (e.g. the
-- demo tenant seeded by FemmeDataInitializer) don't need a backfill to keep working.
ALTER TABLE tenants ADD tier_id BIGINT NULL;
ALTER TABLE tenants ADD status NVARCHAR(20) NOT NULL CONSTRAINT df_tenants_status DEFAULT 'ACTIVE';
GO

-- Separate batch: SQL Server can't resolve a column added via ALTER TABLE in the same batch.
ALTER TABLE tenants ADD CONSTRAINT fk_tenants_tier FOREIGN KEY (tier_id) REFERENCES tiers(id);
