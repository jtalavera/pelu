-- SIFEN testing: reusing one recipient email across many test clients currently trips the
-- per-tenant "client email must be unique" check (ClientService / InvoiceService#applyClientIdentity).
-- This flag lets a tenant opt out of that check, but the application only honours it when
-- app.femme.sifen.connection.environment=TEST (see DuplicateClientEmailPolicy) — production always
-- enforces uniqueness. Reuses the generic feature-flag mechanism (V8); disabled by default so no
-- tenant is silently affected.
INSERT INTO feature_flags (flag_key, enabled, description)
VALUES ('ALLOW_DUPLICATE_CLIENT_EMAIL', 0, 'Test environment only: skip the per-tenant client-email uniqueness check so SIFEN electronic-invoicing testing can reuse the same recipient email. Ignored unless the SIFEN environment is TEST.');
