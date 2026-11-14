-- up.sh step 4: (re)create the Container App's managed-identity DB user (runbook in
-- infrastructure_v2/infrastructure_v2.md). An imported BACPAC may carry a [femme-backend] user with
-- the SID of ANOTHER identity (prod's, or a previous staging run's), so it is always dropped first.
-- Must run as a member of the SQL Entra admin group (femme-sql-admins).
-- sqlcmd variable: AppName (Container App name, e.g. femme-backend).

SET NOCOUNT ON;

IF EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'$(AppName)')
  DROP USER [$(AppName)];

CREATE USER [$(AppName)] FROM EXTERNAL PROVIDER;
ALTER ROLE db_datareader ADD MEMBER [$(AppName)];
ALTER ROLE db_datawriter ADD MEMBER [$(AppName)];
ALTER ROLE db_ddladmin ADD MEMBER [$(AppName)];  -- Flyway runs migrations on boot

PRINT 'grant-mi-user: [$(AppName)] created FROM EXTERNAL PROVIDER';
