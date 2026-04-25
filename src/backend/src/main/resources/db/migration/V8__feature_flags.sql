-- Global flag definitions (system-wide defaults)
CREATE TABLE feature_flags (
    id          BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    flag_key    VARCHAR(100)  NOT NULL UNIQUE,
    enabled     BIT           NOT NULL CONSTRAINT df_feature_flags_enabled DEFAULT 0,
    description NVARCHAR(500) NULL
);

-- Per-tenant overrides
CREATE TABLE tenant_feature_flags (
    id         BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    tenant_id  BIGINT        NOT NULL,
    flag_key   VARCHAR(100)  NOT NULL,
    enabled    BIT           NOT NULL,
    CONSTRAINT uq_tenant_flag UNIQUE (tenant_id, flag_key),
    CONSTRAINT fk_tenant_feature_flags_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    CONSTRAINT fk_tenant_feature_flags_flag FOREIGN KEY (flag_key) REFERENCES feature_flags(flag_key)
);

INSERT INTO feature_flags (flag_key, enabled, description)
VALUES ('GUIDED_TOUR', 1, 'Show guided tour tooltips on every screen');
