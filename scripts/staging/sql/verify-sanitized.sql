-- T5 acceptance: prints one line "VIOLATIONS=<n>". up.sh refuses to deploy unless n = 0.
-- Counts, across every character column named like *email* / *_by / *phone*, values that still
-- look like a real e-mail or phone, plus leftover SIFEN signing material, tokens and passwords
-- that are not the shared staging hash.
-- sqlcmd variables: EmailDomain, Phone, PasswordHash (same as sanitize-prod-snapshot.sql).

SET NOCOUNT ON;

DECLARE @domain NVARCHAR(100) = N'$(EmailDomain)';
DECLARE @phone NVARCHAR(32) = N'$(Phone)';
DECLARE @hash NVARCHAR(255) = N'$(PasswordHash)';
DECLARE @violations BIGINT = 0, @n BIGINT, @sql NVARCHAR(MAX), @tbl SYSNAME, @col SYSNAME;

IF OBJECT_ID('staging_sanitization') IS NULL
BEGIN
  PRINT 'verify: staging_sanitization marker missing — sanitize-prod-snapshot.sql never ran';
  SET @violations += 1;
END

DECLARE cols CURSOR LOCAL FAST_FORWARD FOR
  SELECT c.TABLE_NAME, c.COLUMN_NAME
  FROM INFORMATION_SCHEMA.COLUMNS c
  JOIN INFORMATION_SCHEMA.TABLES t ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME
  WHERE t.TABLE_TYPE = 'BASE TABLE' AND c.TABLE_SCHEMA = 'dbo'
    AND c.TABLE_NAME NOT IN ('flyway_schema_history', 'staging_sanitization')
    AND c.DATA_TYPE IN ('varchar', 'nvarchar', 'char', 'nchar')
    AND (c.COLUMN_NAME LIKE '%email%' OR c.COLUMN_NAME LIKE '%[_]by' OR c.COLUMN_NAME LIKE '%phone%');
OPEN cols;
FETCH NEXT FROM cols INTO @tbl, @col;
WHILE @@FETCH_STATUS = 0
BEGIN
  IF @col LIKE '%phone%'
    SET @sql = N'SELECT @n = COUNT_BIG(*) FROM ' + QUOTENAME(@tbl) + N' WHERE ' + QUOTENAME(@col)
      + N' IS NOT NULL AND LTRIM(RTRIM(' + QUOTENAME(@col) + N')) <> N'''' AND ' + QUOTENAME(@col) + N' <> @phone';
  ELSE
    SET @sql = N'SELECT @n = COUNT_BIG(*) FROM ' + QUOTENAME(@tbl) + N' WHERE ' + QUOTENAME(@col)
      + N' LIKE N''%@%'' AND ' + QUOTENAME(@col) + N' NOT LIKE N''staging+%@'' + @domain';
  EXEC sp_executesql @sql, N'@n BIGINT OUTPUT, @domain NVARCHAR(100), @phone NVARCHAR(32)',
    @n = @n OUTPUT, @domain = @domain, @phone = @phone;
  IF @n > 0
  BEGIN
    PRINT CONCAT('verify: ', @tbl, '.', @col, ' still has ', @n, ' real-looking value(s)');
    SET @violations += @n;
  END
  FETCH NEXT FROM cols INTO @tbl, @col;
END
CLOSE cols;
DEALLOCATE cols;

SELECT @n = COUNT_BIG(*) FROM app_users WHERE password_hash <> @hash;
IF @n > 0 BEGIN PRINT CONCAT('verify: ', @n, ' app_users with a non-staging password hash'); SET @violations += @n; END

IF OBJECT_ID('sifen_certificates') IS NOT NULL
BEGIN
  SELECT @n = COUNT_BIG(*) FROM sifen_certificates;
  IF @n > 0 BEGIN PRINT CONCAT('verify: ', @n, ' sifen_certificates rows left'); SET @violations += @n; END
END
IF OBJECT_ID('sifen_csc') IS NOT NULL
BEGIN
  SELECT @n = COUNT_BIG(*) FROM sifen_csc;
  IF @n > 0 BEGIN PRINT CONCAT('verify: ', @n, ' sifen_csc rows left'); SET @violations += @n; END
END
IF OBJECT_ID('password_reset_tokens') IS NOT NULL
BEGIN
  SELECT @n = COUNT_BIG(*) FROM password_reset_tokens;
  IF @n > 0 BEGIN PRINT CONCAT('verify: ', @n, ' password reset tokens left'); SET @violations += @n; END
END
IF OBJECT_ID('app_user_activation_tokens') IS NOT NULL
BEGIN
  SELECT @n = COUNT_BIG(*) FROM app_user_activation_tokens;
  IF @n > 0 BEGIN PRINT CONCAT('verify: ', @n, ' activation tokens left'); SET @violations += @n; END
END
IF COL_LENGTH('invoices', 'sifen_submission_status') IS NOT NULL
BEGIN
  EXEC sp_executesql N'SELECT @n = COUNT_BIG(*) FROM invoices WHERE sifen_submission_status IN (''QUEUED'', ''PENDING_VERIFICATION'')',
    N'@n BIGINT OUTPUT', @n = @n OUTPUT;
  IF @n > 0 BEGIN PRINT CONCAT('verify: ', @n, ' pending SIFEN submissions left'); SET @violations += @n; END
END

PRINT CONCAT('VIOLATIONS=', @violations);
