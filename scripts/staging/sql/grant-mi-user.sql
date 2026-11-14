-- up.sh step 4: (re)create the Container App's managed-identity DB user (runbook in
-- infrastructure_v2/infrastructure_v2.md). An imported BACPAC may carry a [femme-backend] user with
-- the SID of ANOTHER identity (prod's, or a previous staging run's), so it is always dropped first.
-- Must run as a member of the SQL Entra admin group (femme-sql-admins).
-- sqlcmd variables: AppName (Container App name, e.g. femme-backend) and ObjectId (its managed
-- identity's principal id, `terraform output -raw container_app_principal_id`).
--
-- WITH OBJECT_ID is required: dev, prod and staging all name their Container App femme-backend,
-- so Entra holds several managed identities with that display name and a plain
-- FROM EXTERNAL PROVIDER fails with Msg 33131 (duplicate display name).

SET NOCOUNT ON;

IF EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'$(AppName)')
  DROP USER [$(AppName)];

CREATE USER [$(AppName)] FROM EXTERNAL PROVIDER WITH OBJECT_ID = '$(ObjectId)';
ALTER ROLE db_datareader ADD MEMBER [$(AppName)];
ALTER ROLE db_datawriter ADD MEMBER [$(AppName)];
ALTER ROLE db_ddladmin ADD MEMBER [$(AppName)];  -- Flyway runs migrations on boot

PRINT 'grant-mi-user: [$(AppName)] created FROM EXTERNAL PROVIDER';
