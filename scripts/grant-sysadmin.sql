-- Grant system administrator access (UH-21 / EPIC-9)
--
-- The platform stores this on users.privileged. It must only be changed by running a script
-- against the database; there is no application API or UI to grant or revoke it.
--
-- Prerequisites:
-- - The target person must already exist as a normal user (signup: email/password or Google OAuth).
-- - Connect to the same database the application uses (URL/credentials from your environment).
--
-- Safety:
-- - Take a backup before changing production data.
-- - Run in staging first and verify admin endpoints respond as expected after reconnecting or
--   refreshing the session (JWT picks up privileges from the database on each authenticated request).
--
-- Usage (example): replace the email, then execute with sqlcmd, SSMS, or your SQL client.
--

UPDATE users SET privileged = 1 WHERE email = 'replace-with-admin-email@example.com';
