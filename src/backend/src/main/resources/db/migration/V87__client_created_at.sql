-- "Nuevos este mes": the clients list filter needs each client's creation date, which was never
-- stored. New rows get it from the entity (@PrePersist). Existing rows are backfilled with their
-- first known activity (service record, appointment or invoice), capped at now; clients with no
-- activity at all stay NULL and simply never count as "new this month".
ALTER TABLE clients ADD created_at DATETIME2 NULL;
GO

UPDATE c
SET created_at = CASE WHEN f.first_seen > SYSUTCDATETIME() THEN SYSUTCDATETIME() ELSE f.first_seen END
FROM clients c
CROSS APPLY (
  SELECT MIN(v) AS first_seen
  FROM (VALUES
    ((SELECT MIN(sr.created_at) FROM service_records sr WHERE sr.client_id = c.id)),
    ((SELECT MIN(a.start_at) FROM appointments a WHERE a.client_id = c.id)),
    ((SELECT MIN(i.issued_at) FROM invoices i WHERE i.client_id = c.id))
  ) AS t(v)
) f
WHERE f.first_seen IS NOT NULL;
GO

CREATE INDEX ix_clients_tenant_created_at ON clients (tenant_id, created_at);
