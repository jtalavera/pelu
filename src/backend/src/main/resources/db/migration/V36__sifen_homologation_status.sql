-- RT-19 (Hardening_SIFEN.md): explicit per-tenant SIFEN homologación state. One row per tenant,
-- created only once a SYSTEM_ADMIN explicitly records it (see SifenHomologationStatusService) — a
-- missing row means PENDING with no marker, same "absence is the safe default" convention as
-- tenant_feature_flags.
CREATE TABLE tenant_sifen_homologation_status (
    id                BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    tenant_id         BIGINT        NOT NULL,
    status            VARCHAR(20)   NOT NULL,
    marked_by_user_id BIGINT        NOT NULL,
    marked_by_email   NVARCHAR(320) NOT NULL,
    marked_at         DATETIME2     NOT NULL,
    CONSTRAINT uq_tenant_sifen_homologation_status_tenant UNIQUE (tenant_id),
    CONSTRAINT fk_tenant_sifen_homologation_status_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);
