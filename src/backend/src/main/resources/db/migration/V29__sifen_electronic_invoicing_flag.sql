-- SIFEN HU-22 (Fase 5): the real per-tenant switch between the SIFEN pipeline (HU-01..HU-21) and
-- the traditional invoice generator. Reuses the generic feature-flag mechanism already built for
-- GUIDED_TOUR (V8) — disabled by default so no tenant is silently switched over.
INSERT INTO feature_flags (flag_key, enabled, description)
VALUES ('SIFEN_ELECTRONIC_INVOICING', 0, 'Route new invoices through the SIFEN electronic-invoicing pipeline instead of the traditional generator');

-- AC-05: "registro histórico de cada cambio de estado del flag: fecha, hora, usuario, valor
-- anterior y nuevo". Same "single last value, overwritten on each attempt" convention already
-- established for every other historical-record AC in this integration (see
-- sifen_cancellation_requested_at/etc. on invoices, V27/V28) rather than a growing audit-log
-- table. Kept as its own table (not columns on tenant_feature_flags) so that resetting a tenant's
-- override to the global default — which deletes the tenant_feature_flags row — doesn't also wipe
-- the record of that very reset.
CREATE TABLE tenant_feature_flag_changes (
    id                 BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    tenant_id          BIGINT        NOT NULL,
    flag_key           VARCHAR(100)  NOT NULL,
    previous_enabled   BIT           NOT NULL,
    new_enabled        BIT           NOT NULL,
    changed_at         DATETIME2     NOT NULL,
    changed_by_user_id BIGINT        NOT NULL,
    changed_by_email   NVARCHAR(320) NOT NULL,
    CONSTRAINT uq_tenant_feature_flag_changes UNIQUE (tenant_id, flag_key),
    CONSTRAINT fk_tenant_feature_flag_changes_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);
