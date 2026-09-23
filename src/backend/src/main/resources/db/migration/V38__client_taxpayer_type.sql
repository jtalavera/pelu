-- SIFEN D205/iTiContRec (tipo de contribuyente del receptor: 1=Física, 2=Jurídica) was previously
-- hardcoded to "1" (Física) for every receiver with a RUC, regardless of the actual client. This
-- adds an explicit, nullable selector — client_id-level for the client's own profile, plus a
-- per-invoice override mirroring identity_document_type_override, for invoices where the RUC is
-- typed directly (no linked client). Nullable: no value recorded means the SIFEN XML builder falls
-- back to PERSONA_FISICA, reproducing the exact behavior before this column existed.
ALTER TABLE clients ADD taxpayer_type NVARCHAR(20) NULL;
ALTER TABLE invoices ADD client_taxpayer_type_override NVARCHAR(20) NULL;
GO

-- Separate batch: SQL Server can't resolve a column in the same batch that added it via ALTER TABLE.
-- Backfill: only rows that already carry a RUC get an explicit taxpayer type, reproducing exactly
-- the "always Física" behavior being replaced — this is a preservation backfill, not a real
-- classification (nobody has actually confirmed these clients are individuals).
UPDATE clients SET taxpayer_type = 'PERSONA_FISICA'
  WHERE taxpayer_type IS NULL AND ruc IS NOT NULL AND ruc <> '';

UPDATE invoices SET client_taxpayer_type_override = 'PERSONA_FISICA'
  WHERE client_taxpayer_type_override IS NULL AND client_ruc_override IS NOT NULL AND client_ruc_override <> '';
