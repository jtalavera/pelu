-- SYSTEM_ADMIN and future role names can exceed 32 characters in some cases; use a wider column.
ALTER TABLE app_users ALTER COLUMN role NVARCHAR(64) NOT NULL;
