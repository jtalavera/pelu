-- Associate a hostname with a tenant for domain-based tenant resolution at login.
-- NULL means the tenant has no dedicated domain (uses the default fallback).
-- Index is in V7: SQL Server rejects CREATE INDEX on a column added in the same batch.
ALTER TABLE tenants ADD [domain] NVARCHAR(255) NULL;
