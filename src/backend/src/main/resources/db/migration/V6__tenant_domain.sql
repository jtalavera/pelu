-- Associate a hostname with a tenant for domain-based tenant resolution at login.
-- NULL means the tenant has no dedicated domain (uses the default fallback).
ALTER TABLE tenants ADD [domain] NVARCHAR(255) NULL;
CREATE UNIQUE INDEX uq_tenants_domain ON tenants ([domain]) WHERE [domain] IS NOT NULL;
