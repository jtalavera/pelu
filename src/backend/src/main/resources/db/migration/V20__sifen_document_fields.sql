-- SIFEN HU-02: fields needed to complete a document's identificación/timbrado/emisor/receptor.

-- Establecimiento (C005/dEst) and punto de expedición (C006/dPunExp) per timbrado. Defaulted to 1
-- ("001" once zero-padded into the CDC) so existing rows and e2e fixtures that create a fiscal
-- stamp without these fields keep working.
ALTER TABLE fiscal_stamps ADD establishment INT NOT NULL DEFAULT 1;
ALTER TABLE fiscal_stamps ADD expedition_point INT NOT NULL DEFAULT 1;

-- Emisor data required by SIFEN (D103/iTipCont, D131/cActEco, D132/dDesActEco) beyond what
-- business_profiles already has (ruc, business_name, address). Nullable: only the SIFEN pilot
-- tenant needs these configured for now.
ALTER TABLE business_profiles ADD taxpayer_type NVARCHAR(20) NULL;
ALTER TABLE business_profiles ADD economic_activity_code NVARCHAR(20) NULL;
ALTER TABLE business_profiles ADD economic_activity_description NVARCHAR(300) NULL;

-- Receptor data: identity document (for a consumidor final without RUC) and address/departamento/
-- ciudad, none of which existed on clients before.
ALTER TABLE clients ADD identity_document_number NVARCHAR(32) NULL;
ALTER TABLE clients ADD address NVARCHAR(500) NULL;
ALTER TABLE clients ADD department NVARCHAR(120) NULL;
ALTER TABLE clients ADD city NVARCHAR(120) NULL;

-- Same identity-document override already available for client_ruc_override (occasional client
-- without a saved Client record), plus the persisted CDC/security code (HU-01 AC-06 determinism:
-- generated once per invoice and reused on every subsequent rebuild of its SIFEN document).
ALTER TABLE invoices ADD client_identity_document_override NVARCHAR(32) NULL;
ALTER TABLE invoices ADD sifen_control_number NVARCHAR(44) NULL;
ALTER TABLE invoices ADD sifen_security_code NVARCHAR(9) NULL;
