-- HU-66: ingreso con PIN en un dispositivo compartido.

-- PIN as a credential: a salted (BCrypt) hash next to HU-22's fingerprint, which stays only for
-- the per-tenant uniqueness check. Existing PINs get their hash on their first successful PIN
-- login (lazy migration, checked against the fingerprint). pin_version is bumped whenever the PIN
-- changes or is cleared, so open PIN sessions stop working.
ALTER TABLE professionals ADD pin_hash NVARCHAR(100) NULL;
ALTER TABLE professionals ADD pin_version INT NOT NULL CONSTRAINT df_professionals_pin_version DEFAULT 0;
GO

-- A salon device enabled by an administrator: its credential (hash only) lets the device show the
-- professional picker and exchange a PIN for a professional session — nothing else.
CREATE TABLE shared_devices (
  id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  name NVARCHAR(100) NOT NULL,
  token_hash NVARCHAR(128) NOT NULL,
  created_at DATETIME2 NOT NULL,
  created_by_user_id BIGINT NULL,
  last_used_at DATETIME2 NULL,
  revoked_at DATETIME2 NULL,
  failed_count INT NOT NULL CONSTRAINT df_shared_devices_failed_count DEFAULT 0,
  failed_window_started_at DATETIME2 NULL,
  locked_until DATETIME2 NULL,
  CONSTRAINT fk_shared_devices_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT uq_shared_devices_token UNIQUE (token_hash)
);
CREATE INDEX ix_shared_devices_tenant ON shared_devices(tenant_id);

-- Failed PIN attempts / lock of one professional on one device.
CREATE TABLE professional_pin_locks (
  id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  device_id BIGINT NOT NULL,
  professional_id BIGINT NOT NULL,
  failed_count INT NOT NULL CONSTRAINT df_pin_locks_failed_count DEFAULT 0,
  locked_until DATETIME2 NULL,
  CONSTRAINT fk_pin_locks_device FOREIGN KEY (device_id) REFERENCES shared_devices(id),
  CONSTRAINT fk_pin_locks_professional FOREIGN KEY (professional_id) REFERENCES professionals(id),
  CONSTRAINT uq_pin_locks_device_professional UNIQUE (device_id, professional_id)
);
CREATE INDEX ix_pin_locks_professional ON professional_pin_locks(professional_id);
GO
