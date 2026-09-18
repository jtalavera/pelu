-- ── V68: Historial de Cajas — manual cash movements + auto-linked tip cash-outs ──

-- One row per cash movement against a cash session: a manual ingreso/egreso
-- entered by staff, or a TIP_WITHDRAWAL_OUT auto-created when a tip withdrawal
-- (tip_withdrawals) happens while that session is open. Amount is always
-- stored positive; direction is derived from `type`.
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'cash_movements') AND type = N'U')
BEGIN
  CREATE TABLE cash_movements (
    id                  BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    tenant_id           BIGINT NOT NULL,
    cash_session_id     BIGINT NOT NULL,
    type                NVARCHAR(32) NOT NULL,
    amount              DECIMAL(19,2) NOT NULL,
    reason              NVARCHAR(500) NULL,
    tip_withdrawal_id   BIGINT NULL,
    created_by_user_id  BIGINT NULL,
    created_at          DATETIME2 NOT NULL,
    CONSTRAINT fk_cash_movements_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    CONSTRAINT fk_cash_movements_session FOREIGN KEY (cash_session_id) REFERENCES cash_sessions(id),
    CONSTRAINT fk_cash_movements_tip_withdrawal FOREIGN KEY (tip_withdrawal_id) REFERENCES tip_withdrawals(id),
    CONSTRAINT fk_cash_movements_created_by FOREIGN KEY (created_by_user_id) REFERENCES app_users(id)
  );
  CREATE INDEX ix_cash_movements_session ON cash_movements(cash_session_id);
  CREATE INDEX ix_cash_movements_tenant ON cash_movements(tenant_id);
END;
