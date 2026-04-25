-- Filtered unique index: only rows with a non-NULL domain must be unique.
-- Must run in a separate migration from adding the column: SQL Server does not allow
-- creating an index on a column added in the same batch as ALTER TABLE ... ADD.
CREATE UNIQUE INDEX uq_tenants_domain ON tenants ([domain]) WHERE [domain] IS NOT NULL;
