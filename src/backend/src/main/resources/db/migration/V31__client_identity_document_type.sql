-- Explicit identity-document-type selector, replacing the implicit "RUC present vs identity
-- document present" detection (which today hardcodes iTipIDRec=1/Cédula paraguaya for any
-- non-RUC value, regardless of what document it actually is). Nullable: no type recorded means
-- the SIFEN XML builder falls back to the same implicit detection it used before this column
-- existed (RUC if ruc/client_ruc_override present, else Cédula paraguaya if a document number is
-- present, else Innominado) — see ClientIdentityDocumentType's javadoc.
ALTER TABLE clients ADD identity_document_type NVARCHAR(20) NULL;
ALTER TABLE invoices ADD client_identity_document_type_override NVARCHAR(20) NULL;

-- Backfill: only rows that already carry a RUC or a document number get an explicit type,
-- reproducing exactly the detection logic being replaced. Rows with neither are left NULL on
-- purpose (a blank client record isn't the same thing as an explicit "Innominado" tag).
UPDATE clients SET identity_document_type = 'RUC'
  WHERE identity_document_type IS NULL AND ruc IS NOT NULL AND ruc <> '';
UPDATE clients SET identity_document_type = 'CEDULA_PARAGUAYA'
  WHERE identity_document_type IS NULL AND identity_document_number IS NOT NULL AND identity_document_number <> '';

UPDATE invoices SET client_identity_document_type_override = 'RUC'
  WHERE client_identity_document_type_override IS NULL AND client_ruc_override IS NOT NULL AND client_ruc_override <> '';
UPDATE invoices SET client_identity_document_type_override = 'CEDULA_PARAGUAYA'
  WHERE client_identity_document_type_override IS NULL AND client_identity_document_override IS NOT NULL AND client_identity_document_override <> '';
