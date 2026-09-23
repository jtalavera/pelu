-- HU-41 (Épica C — Gestión de usuarios y admins de tenant): activation tokens for AppUser rows
-- created directly by the Platform Admin (tenant ADMIN invites) — same shape and purpose as
-- professional_activation_tokens (V3), but linked straight to app_users since there is no
-- Professional row involved for this flow.
CREATE TABLE app_user_activation_tokens (
  id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  app_user_id BIGINT NOT NULL,
  token_hash NVARCHAR(128) NOT NULL,
  expires_at DATETIME2 NOT NULL,
  used BIT NOT NULL CONSTRAINT df_app_user_activation_tokens_used DEFAULT 0,
  CONSTRAINT fk_app_user_activation_tokens_app_user FOREIGN KEY (app_user_id) REFERENCES app_users(id)
);

CREATE INDEX ix_app_user_activation_tokens_app_user ON app_user_activation_tokens(app_user_id);
