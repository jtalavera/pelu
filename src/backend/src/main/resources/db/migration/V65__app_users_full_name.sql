-- HU-41 follow-up: a Platform-Admin-invited tenant ADMIN now supplies a full name when they
-- activate their account (ActivatePage), so the app can greet them and show their name in the
-- topbar instead of the email local-part. Nullable: pre-existing AppUser rows (already-activated
-- admins, professionals, the platform admin) have no name and fall back to the email.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'app_users') AND name = N'full_name')
BEGIN
  ALTER TABLE app_users ADD full_name NVARCHAR(255) NULL;
END;
