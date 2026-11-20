-- T5 (docs/staging-env.md): MANDATORY sanitization of an imported prod snapshot. up.sh runs it
-- right after the BACPAC import, before the backend image first starts, and refuses to deploy
-- unless verify-sanitized.sql then reports zero violations.
--
-- sqlcmd variables (set by up.sh, never committed):
--   EmailDomain    e.g. example.invalid (RFC 2606: undeliverable by construction)
--   Phone          e.g. 0000000000
--   PasswordHash   BCrypt hash of the shared staging password (STAGING_USER_PASSWORD)
--
-- Runs against the schema of the PROD release that produced the snapshot (the new release's
-- Flyway migrations run afterwards, on boot), so every table is guarded with OBJECT_ID checks.
-- Everything happens in one transaction: a failure leaves the DB untouched and up.sh aborts.

SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @domain NVARCHAR(100) = N'$(EmailDomain)';
DECLARE @phone NVARCHAR(32) = N'$(Phone)';
DECLARE @hash NVARCHAR(255) = N'$(PasswordHash)';

IF @domain = N'' OR @phone = N'' OR @hash NOT LIKE N'$2_$%'
  THROW 50001, 'sanitize: EmailDomain, Phone and a BCrypt PasswordHash are required', 1;

BEGIN TRANSACTION;

-- 1. The imported DB user carries the PROD managed identity SID. Drop it; up.sh re-creates
--    [femme-backend] FROM EXTERNAL PROVIDER for the staging identity (grant-mi-user.sql).
IF EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'femme-backend')
  DROP USER [femme-backend];

-- 2. Contact data. Every e-mail-looking value in a character column whose name contains "email"
--    or ends in "_by" (changed_by_email, notes_updated_by, …) becomes
--    staging+<sha256(lower(email))[0:16]>@<domain>. The mapping is deterministic, so the same
--    person keeps one address across tables (professionals.email ↔ app_users.email stays linked)
--    and per-tenant uniqueness is preserved.
DECLARE @sql NVARCHAR(MAX);
DECLARE @tbl SYSNAME, @col SYSNAME, @len INT;

DECLARE email_cols CURSOR LOCAL FAST_FORWARD FOR
  SELECT c.TABLE_NAME, c.COLUMN_NAME, c.CHARACTER_MAXIMUM_LENGTH
  FROM INFORMATION_SCHEMA.COLUMNS c
  JOIN INFORMATION_SCHEMA.TABLES t ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME
  WHERE t.TABLE_TYPE = 'BASE TABLE' AND c.TABLE_SCHEMA = 'dbo'
    AND c.TABLE_NAME NOT IN ('flyway_schema_history', 'staging_sanitization')
    AND c.DATA_TYPE IN ('varchar', 'nvarchar', 'char', 'nchar')
    AND (c.COLUMN_NAME LIKE '%email%' OR c.COLUMN_NAME LIKE '%[_]by');
OPEN email_cols;
FETCH NEXT FROM email_cols INTO @tbl, @col, @len;
WHILE @@FETCH_STATUS = 0
BEGIN
  IF @len <> -1 AND @len < 64
    SET @sql = N'UPDATE ' + QUOTENAME(@tbl) + N' SET ' + QUOTENAME(@col) + N' = NULL WHERE '
      + QUOTENAME(@col) + N' LIKE N''%@%''';  -- too short for the rewritten form: just drop it
  ELSE
    SET @sql = N'UPDATE ' + QUOTENAME(@tbl) + N' SET ' + QUOTENAME(@col) + N' = CONCAT(N''staging+'', '
      + N'LOWER(LEFT(CONVERT(VARCHAR(64), HASHBYTES(''SHA2_256'', CONVERT(NVARCHAR(4000), LOWER(LTRIM(RTRIM('
      + QUOTENAME(@col) + N'))))), 2), 16)), N''@'', @domain) WHERE ' + QUOTENAME(@col)
      + N' LIKE N''%@%'' AND ' + QUOTENAME(@col) + N' NOT LIKE N''staging+%@'' + @domain';
  EXEC sp_executesql @sql, N'@domain NVARCHAR(100)', @domain = @domain;
  PRINT CONCAT('sanitize: e-mail ', @tbl, '.', @col, ' rows=', @@ROWCOUNT);
  FETCH NEXT FROM email_cols INTO @tbl, @col, @len;
END
CLOSE email_cols;
DEALLOCATE email_cols;

DECLARE phone_cols CURSOR LOCAL FAST_FORWARD FOR
  SELECT c.TABLE_NAME, c.COLUMN_NAME
  FROM INFORMATION_SCHEMA.COLUMNS c
  JOIN INFORMATION_SCHEMA.TABLES t ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME
  WHERE t.TABLE_TYPE = 'BASE TABLE' AND c.TABLE_SCHEMA = 'dbo'
    AND c.DATA_TYPE IN ('varchar', 'nvarchar', 'char', 'nchar')
    AND c.COLUMN_NAME LIKE '%phone%';
OPEN phone_cols;
FETCH NEXT FROM phone_cols INTO @tbl, @col;
WHILE @@FETCH_STATUS = 0
BEGIN
  SET @sql = N'UPDATE ' + QUOTENAME(@tbl) + N' SET ' + QUOTENAME(@col) + N' = @phone WHERE '
    + QUOTENAME(@col) + N' IS NOT NULL AND LTRIM(RTRIM(' + QUOTENAME(@col) + N')) <> N'''' AND '
    + QUOTENAME(@col) + N' <> @phone';
  EXEC sp_executesql @sql, N'@phone NVARCHAR(32)', @phone = @phone;
  PRINT CONCAT('sanitize: phone ', @tbl, '.', @col, ' rows=', @@ROWCOUNT);
  FETCH NEXT FROM phone_cols INTO @tbl, @col;
END
CLOSE phone_cols;
DEALLOCATE phone_cols;

-- 3. Credentials. Every user (tenant users and platform admins) gets the shared staging password;
--    professional PINs (4-digit BCrypt, trivially brute-forced, often reused) are cleared.
UPDATE app_users SET password_hash = @hash;
PRINT CONCAT('sanitize: app_users passwords reset rows=', @@ROWCOUNT);
IF COL_LENGTH('professionals', 'pin_hash') IS NOT NULL
  EXEC sp_executesql N'UPDATE professionals SET pin_hash = NULL WHERE pin_hash IS NOT NULL';

-- 4. One-time tokens and device sessions.
IF OBJECT_ID('professional_pin_locks') IS NOT NULL DELETE FROM professional_pin_locks;
IF OBJECT_ID('shared_devices') IS NOT NULL DELETE FROM shared_devices;
IF OBJECT_ID('app_user_activation_tokens') IS NOT NULL DELETE FROM app_user_activation_tokens;
IF OBJECT_ID('password_reset_tokens') IS NOT NULL DELETE FROM password_reset_tokens;
IF OBJECT_ID('professional_activation_tokens') IS NOT NULL DELETE FROM professional_activation_tokens;

-- 5. SIFEN signing material: the Key Vault refs point at the PROD vault, and staging must never
--    sign as a real taxpayer. The CSC rows are Key Vault refs to real taxpayer CSCs too.
IF OBJECT_ID('sifen_certificates') IS NOT NULL DELETE FROM sifen_certificates;
IF OBJECT_ID('sifen_csc') IS NOT NULL DELETE FROM sifen_csc;
PRINT 'sanitize: SIFEN certificates and CSC refs deleted';

-- 6. Pending work the reconcilers would otherwise replay.
IF COL_LENGTH('invoices', 'sifen_submission_status') IS NOT NULL
  EXEC sp_executesql N'
    UPDATE invoices
    SET sifen_submission_status = ''REJECTED'',
        sifen_submission_message = ''STAGING_SANITIZED: pending submission voided on import'',
        sifen_next_attempt_at = NULL
    WHERE sifen_submission_status IN (''QUEUED'', ''PENDING_VERIFICATION'');
    PRINT CONCAT(''sanitize: pending SIFEN submissions voided rows='', @@ROWCOUNT);';
IF OBJECT_ID('commission_outbox') IS NOT NULL
  EXEC sp_executesql N'UPDATE commission_outbox SET status = ''DONE'' WHERE status <> ''DONE'';';
IF OBJECT_ID('stock_outbox') IS NOT NULL
  EXEC sp_executesql N'
    UPDATE stock_outbox SET status = ''DISCARDED'', next_attempt_at = NULL
    WHERE status IN (''PENDING'', ''PROCESSING'', ''FAILED'');';

-- 7. Marker that up.sh checks before it deploys.
IF OBJECT_ID('staging_sanitization') IS NULL
  CREATE TABLE staging_sanitization (
    id INT IDENTITY(1,1) PRIMARY KEY,
    sanitized_at DATETIME2 NOT NULL,
    email_domain NVARCHAR(100) NOT NULL
  );
INSERT INTO staging_sanitization (sanitized_at, email_domain) VALUES (SYSUTCDATETIME(), @domain);

COMMIT TRANSACTION;
PRINT 'sanitize: done';
