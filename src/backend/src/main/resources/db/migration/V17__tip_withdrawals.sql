-- ── V17: Propinas — tip withdrawals per professional ────────────────────────

-- One row per withdrawal of accumulated tips from a professional's running
-- tip balance (sum of ServiceRecordTip amounts on CLOSED fichas, minus prior
-- withdrawals).
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'tip_withdrawals') AND type = N'U')
BEGIN
  CREATE TABLE tip_withdrawals (
    id                  BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    tenant_id           BIGINT NOT NULL,
    professional_id     BIGINT NOT NULL,
    amount              DECIMAL(19,2) NOT NULL,
    withdrawn_at        DATETIME2 NOT NULL,
    created_by_user_id  BIGINT NULL,
    CONSTRAINT fk_tip_withdrawals_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    CONSTRAINT fk_tip_withdrawals_professional FOREIGN KEY (professional_id) REFERENCES professionals(id),
    CONSTRAINT fk_tip_withdrawals_created_by FOREIGN KEY (created_by_user_id) REFERENCES app_users(id)
  );
  CREATE INDEX ix_tip_withdrawals_tenant_professional ON tip_withdrawals(tenant_id, professional_id);
END;
