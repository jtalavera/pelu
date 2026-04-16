-- HU-22 / HU-23 / HU-24: employee features

-- Add enabled flag to app_users (used to revoke professional access)
ALTER TABLE app_users ADD enabled BIT NOT NULL CONSTRAINT df_app_users_enabled DEFAULT 1;

-- Add PIN fingerprint (SHA-256 of tenantId:pin, for uniqueness check), system access toggle,
-- and optional FK to the linked app_user for professional accounts
ALTER TABLE professionals ADD pin_fingerprint NVARCHAR(64) NULL;
ALTER TABLE professionals ADD system_access_allowed BIT NOT NULL CONSTRAINT df_professionals_system_access DEFAULT 0;
ALTER TABLE professionals ADD user_id BIGINT NULL;
ALTER TABLE professionals ADD CONSTRAINT fk_professionals_user FOREIGN KEY (user_id) REFERENCES app_users(id);

-- Activation tokens sent via email when a professional is granted system access
CREATE TABLE professional_activation_tokens (
  id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  professional_id BIGINT NOT NULL,
  token_hash NVARCHAR(128) NOT NULL,
  expires_at DATETIME2 NOT NULL,
  used BIT NOT NULL CONSTRAINT df_pat_used DEFAULT 0,
  CONSTRAINT fk_pat_professional FOREIGN KEY (professional_id) REFERENCES professionals(id)
);

CREATE INDEX ix_pat_professional ON professional_activation_tokens(professional_id);
