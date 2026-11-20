-- Calibrate volumes.json from REAL usage without copying prod data (docs/staging-env.md T6).
-- Run against a staging DB brought up with `up.sh --data=prod` (sanitized snapshot):
--   sqlcmd -S tcp:<staging sql>,1433 -d femme_app_db --authentication-method ActiveDirectoryDefault -i loadtest/seed/measure-volumes.sql
-- Only aggregates come out; copy them into volumes.json by hand and bump its "version".

SET NOCOUNT ON;
DECLARE @from DATETIME2 = DATEADD(DAY, -180, SYSUTCDATETIME());

WITH active_tenants AS (
  SELECT DISTINCT tenant_id FROM appointments WHERE start_at >= @from
)
SELECT
  (SELECT COUNT(*) FROM active_tenants) AS active_tenants,
  (SELECT AVG(CAST(n AS FLOAT)) FROM (SELECT COUNT(*) n FROM clients c JOIN active_tenants t ON t.tenant_id = c.tenant_id GROUP BY c.tenant_id) x) AS clients_per_tenant,
  (SELECT AVG(CAST(n AS FLOAT)) FROM (SELECT COUNT(*) n FROM professionals p JOIN active_tenants t ON t.tenant_id = p.tenant_id WHERE p.active = 1 GROUP BY p.tenant_id) x) AS professionals_per_tenant,
  (SELECT AVG(CAST(n AS FLOAT)) FROM (SELECT COUNT(*) n FROM services s JOIN active_tenants t ON t.tenant_id = s.tenant_id GROUP BY s.tenant_id) x) AS services_per_tenant,
  (SELECT AVG(CAST(n AS FLOAT)) FROM (SELECT COUNT(*) n FROM appointments a WHERE a.start_at >= @from GROUP BY a.tenant_id) x) AS appointments_180d_per_tenant,
  (SELECT AVG(CAST(n AS FLOAT)) FROM (SELECT COUNT(*) n FROM invoices i WHERE i.issued_at >= @from GROUP BY i.tenant_id) x) AS invoices_180d_per_tenant,
  (SELECT AVG(CAST(n AS FLOAT)) FROM (SELECT COUNT(*) n FROM cash_sessions s WHERE s.opened_at >= @from GROUP BY s.tenant_id) x) AS cash_sessions_180d_per_tenant;

-- Appointments per professional per working day (median-ish: average over days that had any).
SELECT AVG(CAST(n AS FLOAT)) AS appointments_per_professional_per_day
FROM (SELECT professional_id, CAST(start_at AS DATE) d, COUNT(*) n FROM appointments WHERE start_at >= @from GROUP BY professional_id, CAST(start_at AS DATE)) x;

-- statusMix (%)
SELECT status, CAST(100.0 * COUNT(*) / SUM(COUNT(*)) OVER () AS DECIMAL(5,1)) AS pct
FROM appointments WHERE start_at >= @from AND start_at < SYSUTCDATETIME() GROUP BY status ORDER BY pct DESC;

-- paymentMix (%)
SELECT a.method, CAST(100.0 * COUNT(*) / SUM(COUNT(*)) OVER () AS DECIMAL(5,1)) AS pct
FROM invoice_payment_allocations a JOIN invoices i ON i.id = a.invoice_id WHERE i.issued_at >= @from GROUP BY a.method ORDER BY pct DESC;

-- tipPercentOfInvoices / average tip
SELECT CAST(100.0 * SUM(CASE WHEN tips_amount > 0 THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0) AS DECIMAL(5,1)) AS tip_percent,
       AVG(CASE WHEN tips_amount > 0 THEN tips_amount END) AS avg_tip
FROM invoices WHERE issued_at >= @from;

-- Cash movements per session
SELECT AVG(CAST(n AS FLOAT)) AS cash_movements_per_session
FROM (SELECT s.id, COUNT(m.id) n FROM cash_sessions s LEFT JOIN cash_movements m ON m.cash_session_id = s.id WHERE s.opened_at >= @from GROUP BY s.id) x;

-- Bytes per row for sizeEstimate.bytesPerRow (reserved incl. indexes / rows)
SELECT t.name AS table_name, SUM(p.row_count) AS row_count,
       CAST(SUM(s.reserved_page_count) * 8192.0 / NULLIF(SUM(p.row_count), 0) AS INT) AS bytes_per_row
FROM sys.tables t
JOIN sys.dm_db_partition_stats s ON s.object_id = t.object_id
JOIN (SELECT object_id, SUM(row_count) row_count FROM sys.dm_db_partition_stats WHERE index_id IN (0, 1) GROUP BY object_id) p ON p.object_id = t.object_id
WHERE t.name IN ('clients', 'appointments', 'service_records', 'service_record_lines', 'invoices', 'invoice_lines',
                 'invoice_payment_allocations', 'invoice_tips', 'cash_sessions', 'cash_movements')
GROUP BY t.name ORDER BY t.name;
