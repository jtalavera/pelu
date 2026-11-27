-- ── V109: WhatsApp channel base (HU-WAP-01, HU-WAP-02, HU-WAP-07 columns) ───────────────────────
-- whatsapp_messages is the outbox AND the delivery log: a row is written QUEUED in the same
-- transaction as the fact that originates it and sent after the commit (HU-WAP-01, criterio 3).

IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'whatsapp_messages') AND type = N'U')
BEGIN
  CREATE TABLE whatsapp_messages (
    id                BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    tenant_id         BIGINT        NOT NULL,
    appointment_id    BIGINT        NULL,
    client_id         BIGINT        NULL,
    purpose           VARCHAR(32)   NOT NULL,   -- OTP | BOOKING | REMINDER | OTHER
    template          VARCHAR(64)   NOT NULL,
    recipient         VARCHAR(32)   NOT NULL,   -- E.164; masked after the retention period
    payload           NVARCHAR(MAX) NOT NULL,   -- JSON: language, body parameters, buttons (no health data, RT-13)
    dedup_key         VARCHAR(200)  NOT NULL,   -- one message per event (HU-WAP-04, criterio 3)
    status            VARCHAR(16)   NOT NULL,   -- QUEUED | SENDING | SENT | DELIVERED | READ | FAILED | CANCELLED
    meta_message_id   VARCHAR(200)  NULL,       -- wamid
    error_code        VARCHAR(64)   NULL,       -- sanitized, never Meta's free text
    attempts          INT           NOT NULL DEFAULT 0,
    next_attempt_at   DATETIME2     NULL,
    fallback_email_sent_at DATETIME2 NULL,
    queued_at         DATETIME2     NOT NULL,
    sent_at           DATETIME2     NULL,
    delivered_at      DATETIME2     NULL,
    read_at           DATETIME2     NULL,
    failed_at         DATETIME2     NULL,
    CONSTRAINT fk_whatsapp_messages_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
  );
  CREATE UNIQUE INDEX ux_whatsapp_messages_dedup ON whatsapp_messages(tenant_id, dedup_key);
  CREATE INDEX ix_whatsapp_messages_tenant_appointment ON whatsapp_messages(tenant_id, appointment_id);
  CREATE INDEX ix_whatsapp_messages_meta_id ON whatsapp_messages(meta_message_id);
  CREATE INDEX ix_whatsapp_messages_status ON whatsapp_messages(status, next_attempt_at);
END;

IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'whatsapp_template_status') AND type = N'U')
BEGIN
  CREATE TABLE whatsapp_template_status (
    id                BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    template_name     VARCHAR(64)   NOT NULL,
    language          VARCHAR(8)    NOT NULL,
    status            VARCHAR(16)   NOT NULL,   -- APPROVED | PENDING | REJECTED | PAUSED | DISABLED | UNKNOWN
    category          VARCHAR(32)   NULL,
    reason            VARCHAR(500)  NULL,
    checked_at        DATETIME2     NOT NULL,
    changed_at        DATETIME2     NOT NULL
  );
  CREATE UNIQUE INDEX ux_whatsapp_template_status ON whatsapp_template_status(template_name, language);
END;

IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'whatsapp_processed_events') AND type = N'U')
BEGIN
  CREATE TABLE whatsapp_processed_events (
    event_id          VARCHAR(200)  NOT NULL PRIMARY KEY,   -- Meta's id of the incoming message / event
    processed_at      DATETIME2     NOT NULL
  );
END;

IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'platform_alerts') AND type = N'U')
BEGIN
  CREATE TABLE platform_alerts (
    id                BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    category          VARCHAR(48)   NOT NULL,   -- e.g. WHATSAPP_TEMPLATE_PAUSED
    subject           VARCHAR(120)  NOT NULL,   -- what the alert is about (template name, ...)
    detail            VARCHAR(500)  NULL,
    created_at        DATETIME2     NOT NULL,
    acknowledged_at   DATETIME2     NULL
  );
  CREATE INDEX ix_platform_alerts_open ON platform_alerts(acknowledged_at, created_at);
END;
