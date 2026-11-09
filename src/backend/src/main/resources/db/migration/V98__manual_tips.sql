-- ── V98: Propinas — manual tips loaded by the salon administrator ───────────

-- A tip that does not come from a ficha or a comprobante (e.g. cash handed over directly). It adds to
-- the professional's accumulated tip balance and shows up in Movimientos flagged as "Manual". It can
-- be edited, or voided (never deleted): a voided row stays visible, with who voided it and why, but
-- stops counting in the balance and in the report totals.
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'manual_tips') AND type = N'U')
BEGIN
  CREATE TABLE manual_tips (
    id                  BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    tenant_id           BIGINT NOT NULL,
    professional_id     BIGINT NOT NULL,
    amount              DECIMAL(19,2) NOT NULL,
    tipped_at           DATETIME2 NOT NULL,
    note                NVARCHAR(200) NULL,
    created_by_user_id  BIGINT NULL,
    created_at          DATETIME2 NOT NULL,
    updated_by_user_id  BIGINT NULL,
    updated_at          DATETIME2 NULL,
    voided_at           DATETIME2 NULL,
    voided_by_user_id   BIGINT NULL,
    void_reason         NVARCHAR(200) NULL,
    CONSTRAINT fk_manual_tips_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    CONSTRAINT fk_manual_tips_professional FOREIGN KEY (professional_id) REFERENCES professionals(id),
    CONSTRAINT fk_manual_tips_created_by FOREIGN KEY (created_by_user_id) REFERENCES app_users(id),
    CONSTRAINT fk_manual_tips_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES app_users(id),
    CONSTRAINT fk_manual_tips_voided_by FOREIGN KEY (voided_by_user_id) REFERENCES app_users(id)
  );
  CREATE INDEX ix_manual_tips_tenant_professional ON manual_tips(tenant_id, professional_id);
END;
