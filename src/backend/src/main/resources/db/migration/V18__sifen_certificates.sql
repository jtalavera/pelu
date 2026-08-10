-- ── V18: SIFEN — digital certificates uploaded per tenant (HU-18) ───────────

-- One row per .p12 certificate+key uploaded by a tenant admin. The p12 file
-- and its password are stored encrypted at rest (AES-GCM, see
-- SifenCertificateEncryptionService) as base64 text, following the same
-- "NVARCHAR(MAX) text column, not VARBINARY/@Lob" convention already used by
-- business_profiles.logo_data_url (SQL Server maps @Lob to CLOB and Hibernate
-- validation fails).
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'sifen_certificates') AND type = N'U')
BEGIN
  CREATE TABLE sifen_certificates (
    id                      BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    tenant_id               BIGINT NOT NULL,
    encrypted_p12_base64    NVARCHAR(MAX) NOT NULL,
    encrypted_password_base64 NVARCHAR(MAX) NOT NULL,
    not_before              DATE NOT NULL,
    not_after               DATE NOT NULL,
    uploaded_at             DATETIME2 NOT NULL,
    uploaded_by_user_id     BIGINT NOT NULL,
    CONSTRAINT fk_sifen_certificates_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    CONSTRAINT fk_sifen_certificates_uploaded_by FOREIGN KEY (uploaded_by_user_id) REFERENCES app_users(id)
  );
  CREATE INDEX ix_sifen_certificates_tenant ON sifen_certificates(tenant_id);
END;
