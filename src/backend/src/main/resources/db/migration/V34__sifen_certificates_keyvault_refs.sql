-- RT-12/RT-17 (Hardening_SIFEN.md): the .p12 and its password become native Azure Key Vault
-- secrets — the database keeps only a pointer (secret name + version) and non-sensitive metadata,
-- never the material itself, encrypted or otherwise. RT-17 decided there is no migration script:
-- existing certificates cannot be carried forward (their AES-GCM blob is meaningless without the
-- app-wide master key this story removes), so every tenant with a certificate uploaded before this
-- migration must re-upload it through the existing screen afterward.
--
-- IRREVERSIBLE. Before applying against dev/prod, coordinate with every tenant that has a
-- certificate uploaded — after this runs, SIFEN_ELECTRONIC_INVOICING tenants cannot issue an
-- invoice (InvoiceController.issue -> requireActiveCertificate -> 412 SIFEN_NO_VALID_CERTIFICATE)
-- until they re-upload. Check the blast radius first:
--   SELECT tenant_id, COUNT(*) FROM sifen_certificates GROUP BY tenant_id;
DELETE FROM sifen_certificates;
GO

ALTER TABLE sifen_certificates DROP COLUMN encrypted_p12_base64;
ALTER TABLE sifen_certificates DROP COLUMN encrypted_password_base64;
GO

-- Safe as NOT NULL only because the table was emptied above in the same migration.
ALTER TABLE sifen_certificates ADD p12_secret_name NVARCHAR(127) NOT NULL;
ALTER TABLE sifen_certificates ADD p12_secret_version NVARCHAR(64) NOT NULL;
ALTER TABLE sifen_certificates ADD password_secret_name NVARCHAR(127) NOT NULL;
ALTER TABLE sifen_certificates ADD password_secret_version NVARCHAR(64) NOT NULL;
GO

CREATE UNIQUE INDEX ux_sifen_certificates_p12_secret ON sifen_certificates(p12_secret_name);
