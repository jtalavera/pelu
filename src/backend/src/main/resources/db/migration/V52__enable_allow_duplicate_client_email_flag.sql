-- Turns ALLOW_DUPLICATE_CLIENT_EMAIL (V51) ON as the global default so SIFEN electronic-invoicing
-- testing can reuse the same recipient email across many test clients without a SYSTEM_ADMIN having
-- to toggle it in Configuración → Feature Flags first.
--
-- The application still only honours this flag when app.femme.sifen.connection.environment=TEST
-- (see DuplicateClientEmailPolicy) — production ignores it and always enforces client-email
-- uniqueness. Any tenant that needs the check back on can add a per-tenant override = 0.
--
-- Updating V51's inserted row rather than re-inserting: on a fresh DB V51 runs first, so the row
-- always exists here; on an existing DB the UPDATE just flips the value. A no-op (0 rows) is
-- harmless if the row is somehow absent.
UPDATE feature_flags
SET enabled = 1
WHERE flag_key = 'ALLOW_DUPLICATE_CLIENT_EMAIL';
