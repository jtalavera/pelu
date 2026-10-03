-- Stock integration (HU-60): transactional outbox toward control-stock plus per-tenant link state.
-- Same reliability pattern as SIFEN (RT-20): the event is written in the same transaction as the
-- business change, Service Bus only wakes the worker up, and StockOutboxReconciler re-enqueues
-- anything due or whose lease expired. Events are processed per tenant, oldest first.
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'stock_outbox') AND type = N'U')
BEGIN
  CREATE TABLE stock_outbox (
    id                     BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    tenant_id              BIGINT NOT NULL,
    event_type             NVARCHAR(32) NOT NULL,
    source_ref             NVARCHAR(128) NULL,
    payload_json           NVARCHAR(MAX) NOT NULL,
    idempotency_key        NVARCHAR(200) NOT NULL,
    status                 NVARCHAR(16) NOT NULL,
    attempt_count          INT NOT NULL DEFAULT 0,
    next_attempt_at        DATETIME2 NULL,
    processing_started_at  DATETIME2 NULL,
    last_error             NVARCHAR(2000) NULL,
    response_json          NVARCHAR(MAX) NULL,
    created_at             DATETIME2 NOT NULL,
    done_at                DATETIME2 NULL,
    CONSTRAINT fk_stock_outbox_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    CONSTRAINT uq_stock_outbox_idempotency_key UNIQUE (idempotency_key)
  );
  CREATE INDEX ix_stock_outbox_tenant_status ON stock_outbox(tenant_id, status, id);
  CREATE INDEX ix_stock_outbox_status_next ON stock_outbox(status, next_attempt_at);
  CREATE INDEX ix_stock_outbox_source_ref ON stock_outbox(tenant_id, source_ref);
END;

IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'stock_tenant_link') AND type = N'U')
BEGIN
  CREATE TABLE stock_tenant_link (
    tenant_id          BIGINT NOT NULL PRIMARY KEY,
    provisioned_at     DATETIME2 NULL,
    flags_version      BIGINT NOT NULL DEFAULT 0,
    flags_json         NVARCHAR(2000) NULL,
    catalog_synced_at  DATETIME2 NULL,
    last_error         NVARCHAR(2000) NULL,
    CONSTRAINT fk_stock_tenant_link_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
  );
END;
