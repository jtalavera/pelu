-- Módulo de comisiones (requirements/prds/femme_modulo_comisiones_v1.md, HU-COM-01..11).
-- Rubro-agnostic core: beneficiary (professional), commissionable item (services row of kind
-- SERVICE or PRODUCT), append-only ledger of entries, settlements per period.

-- HU-COM-11: the module starts OFF globally; a Platform Admin enables it per tier / tenant.
IF NOT EXISTS (SELECT 1 FROM feature_flags WHERE flag_key = 'COMMISSIONS')
  INSERT INTO feature_flags (flag_key, enabled, description)
  VALUES ('COMMISSIONS', 0, 'Commissions module (rules, accrual on invoice issue, settlements). Off -> API answers 403 FEATURE_NOT_ENABLED.');

-- HU-COM-10: beneficiary (professional / seller) of each invoice line, immutable after issue.
IF COL_LENGTH('invoice_lines', 'professional_id') IS NULL
BEGIN
  ALTER TABLE invoice_lines ADD professional_id BIGINT NULL;
  ALTER TABLE invoice_lines ADD CONSTRAINT fk_invoice_lines_professional
    FOREIGN KEY (professional_id) REFERENCES professionals(id);
END;

-- HU-COM-01/02/09: every calculation input is a timeline of versions per scope
-- (BASE, DEFAULT_SERVICE, DEFAULT_PRODUCT, PERIODICITY, RULE). The value in force at an instant is
-- the ACTIVE version of that scope with the greatest effective_from <= instant. For RULE, a null
-- value means "no rule" (closed); service_id / professional_id identify the rule's scope.
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'commission_config_versions') AND type = N'U')
BEGIN
  CREATE TABLE commission_config_versions (
    id                 BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    tenant_id          BIGINT NOT NULL,
    scope              NVARCHAR(32) NOT NULL,
    service_id         BIGINT NULL,
    professional_id    BIGINT NULL,
    config_value       NVARCHAR(32) NULL,
    effective_from     DATETIME2 NOT NULL,
    apply_mode         NVARCHAR(16) NOT NULL,
    status             NVARCHAR(16) NOT NULL,
    recalculation_id   BIGINT NULL,
    created_at         DATETIME2 NOT NULL,
    created_by_email   NVARCHAR(320) NULL,
    cancelled_at       DATETIME2 NULL,
    cancelled_by_email NVARCHAR(320) NULL,
    CONSTRAINT fk_commission_config_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    CONSTRAINT fk_commission_config_service FOREIGN KEY (service_id) REFERENCES services(id),
    CONSTRAINT fk_commission_config_professional FOREIGN KEY (professional_id) REFERENCES professionals(id)
  );
  CREATE INDEX ix_commission_config_scope
    ON commission_config_versions(tenant_id, scope, service_id, professional_id, status, effective_from);
END;

IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'commission_recalculations') AND type = N'U')
BEGIN
  CREATE TABLE commission_recalculations (
    id                    BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    tenant_id             BIGINT NOT NULL,
    scope                 NVARCHAR(32) NOT NULL,
    service_id            BIGINT NULL,
    professional_id       BIGINT NULL,
    period_from           DATETIME2 NOT NULL,
    entries_recalculated  INT NOT NULL,
    entries_excluded      INT NOT NULL,
    delta_amount          DECIMAL(19,2) NOT NULL,
    created_at            DATETIME2 NOT NULL,
    created_by_email      NVARCHAR(320) NULL,
    CONSTRAINT fk_commission_recalc_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
  );
END;

IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'commission_settlements') AND type = N'U')
BEGIN
  CREATE TABLE commission_settlements (
    id                  BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    tenant_id           BIGINT NOT NULL,
    professional_id     BIGINT NOT NULL,
    period_from         DATE NOT NULL,
    period_to           DATE NOT NULL,
    status              NVARCHAR(16) NOT NULL,
    total_amount        DECIMAL(19,2) NOT NULL,
    created_at          DATETIME2 NOT NULL,
    created_by_email    NVARCHAR(320) NULL,
    approved_at         DATETIME2 NULL,
    approved_by_email   NVARCHAR(320) NULL,
    paid_at             DATETIME2 NULL,
    paid_by_email       NVARCHAR(320) NULL,
    payment_method      NVARCHAR(32) NULL,
    payment_reference   NVARCHAR(200) NULL,
    voided_at           DATETIME2 NULL,
    voided_by_email     NVARCHAR(320) NULL,
    void_reason         NVARCHAR(500) NULL,
    CONSTRAINT fk_commission_settlement_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    CONSTRAINT fk_commission_settlement_professional FOREIGN KEY (professional_id) REFERENCES professionals(id)
  );
  CREATE INDEX ix_commission_settlement_tenant ON commission_settlements(tenant_id, professional_id, status);
END;

IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'commission_settlement_status_changes') AND type = N'U')
BEGIN
  CREATE TABLE commission_settlement_status_changes (
    id                BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    settlement_id     BIGINT NOT NULL,
    from_status       NVARCHAR(16) NULL,
    to_status         NVARCHAR(16) NOT NULL,
    changed_at        DATETIME2 NOT NULL,
    changed_by_email  NVARCHAR(320) NULL,
    CONSTRAINT fk_commission_settlement_change FOREIGN KEY (settlement_id) REFERENCES commission_settlements(id)
  );
END;

-- P2: append-only ledger. Rows are never updated except for settlement_id (assignment to a
-- settlement) and never deleted. Corrections are REVERSAL rows (reverses_entry_id).
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'commission_entries') AND type = N'U')
BEGIN
  CREATE TABLE commission_entries (
    id                 BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    tenant_id          BIGINT NOT NULL,
    professional_id    BIGINT NOT NULL,
    source_type        NVARCHAR(16) NOT NULL,
    revision           INT NOT NULL,
    reason_code        NVARCHAR(32) NULL,
    invoice_id         BIGINT NULL,
    invoice_line_id    BIGINT NULL,
    invoice_number     NVARCHAR(32) NULL,
    service_id         BIGINT NULL,
    item_name          NVARCHAR(255) NULL,
    item_kind          NVARCHAR(16) NULL,
    base_type          NVARCHAR(16) NULL,
    line_total         DECIMAL(19,2) NULL,
    tax_amount         DECIMAL(19,4) NULL,
    base_amount        DECIMAL(19,2) NULL,
    percent_applied    DECIMAL(5,2) NULL,
    rule_version_id    BIGINT NULL,
    rule_origin        NVARCHAR(32) NULL,
    commission_amount  DECIMAL(19,2) NOT NULL,
    currency           NVARCHAR(3) NOT NULL,
    accrual_at         DATETIME2 NOT NULL,
    reverses_entry_id  BIGINT NULL,
    recalculation_id   BIGINT NULL,
    settlement_id      BIGINT NULL,
    note               NVARCHAR(500) NULL,
    created_at         DATETIME2 NOT NULL,
    created_by_email   NVARCHAR(320) NULL,
    CONSTRAINT fk_commission_entry_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    CONSTRAINT fk_commission_entry_professional FOREIGN KEY (professional_id) REFERENCES professionals(id),
    CONSTRAINT fk_commission_entry_settlement FOREIGN KEY (settlement_id) REFERENCES commission_settlements(id)
  );
  -- P4 / C8: idempotency per invoice line, source type and revision.
  CREATE UNIQUE INDEX uq_commission_entry_line_rev
    ON commission_entries(invoice_line_id, source_type, revision) WHERE invoice_line_id IS NOT NULL;
  CREATE INDEX ix_commission_entry_tenant ON commission_entries(tenant_id, professional_id, accrual_at);
  CREATE INDEX ix_commission_entry_invoice ON commission_entries(tenant_id, invoice_id);
  CREATE INDEX ix_commission_entry_settlement ON commission_entries(settlement_id);
END;

-- HU-COM-04: invoice events are written in the issuing transaction and processed after commit;
-- anything left PENDING (e.g. a calculation failure) is retried by CommissionOutboxReconciler, so a
-- commission problem never blocks issuing an invoice.
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'commission_outbox') AND type = N'U')
BEGIN
  CREATE TABLE commission_outbox (
    id             BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    tenant_id      BIGINT NOT NULL,
    invoice_id     BIGINT NOT NULL,
    event_kind     NVARCHAR(16) NOT NULL,
    status         NVARCHAR(16) NOT NULL,
    attempt_count  INT NOT NULL DEFAULT 0,
    last_error     NVARCHAR(2000) NULL,
    created_at     DATETIME2 NOT NULL,
    processed_at   DATETIME2 NULL,
    CONSTRAINT fk_commission_outbox_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
  );
  CREATE INDEX ix_commission_outbox_status ON commission_outbox(status, id);
END;
