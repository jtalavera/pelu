-- SIFEN HU-07: full document content (xContenDE) returned by SIFEN's consulta (SiConsDE) service
-- when a query resolves to a found/approved CDC. NVARCHAR(MAX), not @Lob — same convention as
-- sifen_certificates.encrypted_p12_base64 (V18) and other large-text SIFEN columns: SQL Server
-- maps @Lob to CLOB, which fails validation (see BusinessProfile.logoDataUrl).
ALTER TABLE invoices ADD sifen_query_document_content NVARCHAR(MAX) NULL;
