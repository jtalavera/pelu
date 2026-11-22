-- ── V104: Asistente conversacional (requirements/asistente/plan_asistente.md, §4.6) ─────────────
-- A per-user chat (assistant_conversation) with its messages (assistant_message). Retention: 30 days
-- after the last activity (AssistantRetentionJob). assistant_draft is created here as the plan
-- specifies but is only used from phase 2 (invoice / appointment drafts); it has no JPA entity yet.

IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'assistant_conversation') AND type = N'U')
BEGIN
  CREATE TABLE assistant_conversation (
    id             BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    tenant_id      BIGINT    NOT NULL,
    user_id        BIGINT    NOT NULL,
    created_at     DATETIME2 NOT NULL,
    last_activity  DATETIME2 NOT NULL,
    closed_at      DATETIME2 NULL,
    CONSTRAINT fk_assistant_conversation_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    CONSTRAINT fk_assistant_conversation_user FOREIGN KEY (user_id) REFERENCES app_users(id)
  );
  CREATE INDEX ix_assistant_conversation_tenant_user
    ON assistant_conversation(tenant_id, user_id, last_activity);
END;

IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'assistant_message') AND type = N'U')
BEGIN
  CREATE TABLE assistant_message (
    id                 BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    conversation_id    BIGINT        NOT NULL,
    role               VARCHAR(16)   NOT NULL,   -- USER | ASSISTANT | TOOL
    content            NVARCHAR(MAX) NOT NULL,   -- text, or the JSON result of a tool call
    input_mode         VARCHAR(8)    NULL,       -- TEXT | VOICE
    tool_name          VARCHAR(64)   NULL,
    prompt_tokens      INT           NULL,
    completion_tokens  INT           NULL,
    created_at         DATETIME2     NOT NULL,
    CONSTRAINT fk_assistant_message_conversation FOREIGN KEY (conversation_id)
      REFERENCES assistant_conversation(id) ON DELETE CASCADE
  );
  CREATE INDEX ix_assistant_message_conversation ON assistant_message(conversation_id, id);
END;

IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'assistant_draft') AND type = N'U')
BEGIN
  CREATE TABLE assistant_draft (
    id               UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    tenant_id        BIGINT        NOT NULL,
    user_id          BIGINT        NOT NULL,
    conversation_id  BIGINT        NOT NULL,
    type             VARCHAR(16)   NOT NULL,   -- INVOICE | APPOINTMENT
    status           VARCHAR(16)   NOT NULL,   -- DRAFT | SUPERSEDED | DISCARDED | EXPIRED | CONFIRMING | CONFIRMED
    payload          NVARCHAR(MAX) NOT NULL,   -- validated JSON
    payload_hash     CHAR(64)      NOT NULL,
    expires_at       DATETIME2     NOT NULL,   -- created_at + 24 h
    result_type      VARCHAR(16)   NULL,
    result_id        BIGINT        NULL,       -- invoice.id or appointment.id
    created_at       DATETIME2     NOT NULL,
    updated_at       DATETIME2     NOT NULL,
    CONSTRAINT fk_assistant_draft_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    CONSTRAINT fk_assistant_draft_user FOREIGN KEY (user_id) REFERENCES app_users(id),
    CONSTRAINT fk_assistant_draft_conversation FOREIGN KEY (conversation_id)
      REFERENCES assistant_conversation(id) ON DELETE CASCADE
  );
  CREATE INDEX ix_assistant_draft_tenant_status ON assistant_draft(tenant_id, status, expires_at);
END;
