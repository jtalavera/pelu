-- T6: move a golden load-test DB's dates forward by WHOLE WEEKS so its anchor day is this week
-- again (weekdays — and so the Mon–Sat schedules — are preserved). Run by up.sh --data=loadtest
-- after the import; a no-op when the BACPAC is less than a week old.

SET NOCOUNT ON;
SET XACT_ABORT ON;

IF OBJECT_ID('loadtest_meta') IS NULL
  THROW 50020, 'loadtest_meta missing: not a golden load-test DB (loadtest/seed)', 1;

DECLARE @anchor DATE = (SELECT CAST(v AS DATE) FROM loadtest_meta WHERE k = 'anchor_date');
DECLARE @days INT = 7 * (DATEDIFF(DAY, @anchor, CAST(SYSUTCDATETIME() AS DATE)) / 7);

IF @days > 0
BEGIN
  BEGIN TRANSACTION;
  UPDATE appointments SET start_at = DATEADD(DAY, @days, start_at), end_at = DATEADD(DAY, @days, end_at),
                          reminder_sent_at = DATEADD(DAY, @days, reminder_sent_at);
  UPDATE service_records SET created_at = DATEADD(DAY, @days, created_at), closed_at = DATEADD(DAY, @days, closed_at);
  UPDATE invoices SET issued_at = DATEADD(DAY, @days, issued_at);
  UPDATE cash_sessions SET opened_at = DATEADD(DAY, @days, opened_at), closed_at = DATEADD(DAY, @days, closed_at);
  UPDATE cash_movements SET created_at = DATEADD(DAY, @days, created_at);
  UPDATE clients SET created_at = DATEADD(DAY, @days, created_at);
  UPDATE fiscal_stamps SET valid_from = DATEADD(DAY, @days, valid_from), valid_until = DATEADD(DAY, @days, valid_until)
    WHERE stamp_number LIKE N'LTHIST%';
  UPDATE loadtest_meta SET v = CONVERT(NVARCHAR(10), DATEADD(DAY, @days, @anchor), 23) WHERE k = 'anchor_date';
  COMMIT TRANSACTION;
END
PRINT CONCAT('shift-loadtest-dates: moved ', @days, ' days (anchor was ', @anchor, ')');
