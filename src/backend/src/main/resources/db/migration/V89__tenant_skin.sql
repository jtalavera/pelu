-- Flowbit rebrand: per-tenant "skin" chosen by the Platform Admin according to the salon type
-- (brand manual, "Variación en Interfaces": one logo, one accent per type of business). The skin
-- only changes the accent color of the tenant's UI (comb and "i" dot of the logo, accent details);
-- the rest of the interface keeps the main palette. Values: DURAZNO (default), CELESTE, ROSA — see
-- the TenantSkin enum. Every existing tenant keeps the default accent.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('tenants') AND name = 'skin')
BEGIN
    ALTER TABLE tenants ADD skin NVARCHAR(20) NOT NULL CONSTRAINT df_tenants_skin DEFAULT 'DURAZNO';
END
