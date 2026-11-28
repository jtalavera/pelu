-- ── V113: online booking skeleton (RSV A0) ────────────────────────────────────────────────────
-- One row per salon. The slug is the salon's public address (/r/<slug>), unique across the whole
-- platform; salons without one simply have no row (or a NULL slug). accepting_bookings is the
-- salon's «Aceptar reservas» switch (RSV-02): OFF by default, and the public page stays neutral
-- until it is on AND the ONLINE_BOOKING flag is on for the salon.
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'booking_settings') AND type = N'U')
BEGIN
  CREATE TABLE booking_settings (
    id                 BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    tenant_id          BIGINT      NOT NULL,
    slug               VARCHAR(40) NULL,
    accepting_bookings BIT         NOT NULL CONSTRAINT df_booking_settings_accepting DEFAULT 0,
    created_at         DATETIME2   NOT NULL,
    updated_at         DATETIME2   NOT NULL,
    CONSTRAINT fk_booking_settings_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    CONSTRAINT uq_booking_settings_tenant UNIQUE (tenant_id)
  );
  -- Filtered: many salons may have no slug yet, but a slug is never shared.
  EXEC('CREATE UNIQUE INDEX ux_booking_settings_slug ON booking_settings(slug) WHERE slug IS NOT NULL');
END;
