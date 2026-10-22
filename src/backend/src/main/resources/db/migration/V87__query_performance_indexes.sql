-- Query-performance indexes (P1 + P2 of the repository/index review). SQL Server does not index
-- foreign keys automatically, so most of these cover FK joins/lookups that were clustered scans.
-- Hibernate sends parameterized SQL, so a filtered index only helps when its filter matches a
-- literal in the query (e.g. "reminder_sent_at IS NULL"), never a bound parameter.
-- Each statement is guarded so the migration is idempotent (same style as V72–V80).

-- P1.1: Invoice.lines lazy load, ON DELETE CASCADE, dashboard top-services join.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_invoice_lines_invoice' AND object_id = OBJECT_ID(N'invoice_lines'))
  EXEC('CREATE INDEX ix_invoice_lines_invoice ON invoice_lines(invoice_id) INCLUDE (service_id, line_total);');

-- P1.2: Invoice.paymentAllocations lazy load, cash-session close per-method sums, payment-mix chart.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_invoice_payment_alloc_invoice' AND object_id = OBJECT_ID(N'invoice_payment_allocations'))
  EXEC('CREATE INDEX ix_invoice_payment_alloc_invoice ON invoice_payment_allocations(invoice_id) INCLUDE (method, amount);');

-- P1.3: SifenSubmissionReconciler (findDueForSifenRetry, every 60 s, cross-tenant) and the
-- rejected-backlog gauge (countSifenRejectedUnresolvedByTenant). The status list is a bound
-- parameter and the retry query also matches sifen_next_attempt_at IS NULL, so the filtered
-- ix_invoices_sifen_retry (V35) could never serve it; seek on the few non-terminal statuses instead.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_invoices_sifen_status' AND object_id = OBJECT_ID(N'invoices'))
  EXEC('CREATE INDEX ix_invoices_sifen_status ON invoices(sifen_submission_status, tenant_id)
        INCLUDE (status, sifen_next_attempt_at, sifen_processing_started_at, sifen_attempt_count, sifen_batch_number);');

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_invoices_sifen_retry' AND object_id = OBJECT_ID(N'invoices'))
  EXEC('DROP INDEX ix_invoices_sifen_retry ON invoices;');

-- P1.4: calendar (no professional selected) and dashboard range queries filter on tenant + start_at
-- only; ix_appointments_tenant_time (tenant_id, professional_id, start_at) can seek on tenant only.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_appointments_tenant_start' AND object_id = OBJECT_ID(N'appointments'))
  EXEC('CREATE INDEX ix_appointments_tenant_start ON appointments(tenant_id, start_at)
        INCLUDE (status, client_id, professional_id, end_at);');

-- P1.5: AppointmentReminderScheduler (findDueForReminder, cross-tenant, every tick).
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_appointments_reminder_due' AND object_id = OBJECT_ID(N'appointments'))
  EXEC('CREATE INDEX ix_appointments_reminder_due ON appointments(start_at) INCLUDE (status)
        WHERE reminder_sent_at IS NULL;');

-- P1.6: client history, client delete guard / FK check, dashboard "inactive clients".
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_appointments_client' AND object_id = OBJECT_ID(N'appointments'))
  EXEC('CREATE INDEX ix_appointments_client ON appointments(client_id, start_at) INCLUDE (status, tenant_id)
        WHERE client_id IS NOT NULL;');

-- P2.7: make ix_invoices_tenant_issued_at (V9) covering for the dashboard revenue sums/projections,
-- which otherwise key-look-up status/sifen_submission_status/total per row.
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes i
  JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.is_included_column = 1
  JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
  WHERE i.name = 'ix_invoices_tenant_issued_at' AND i.object_id = OBJECT_ID(N'invoices') AND c.name = 'total'
)
BEGIN
  IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_invoices_tenant_issued_at' AND object_id = OBJECT_ID(N'invoices'))
    EXEC('CREATE NONCLUSTERED INDEX ix_invoices_tenant_issued_at ON invoices(tenant_id, issued_at DESC)
          INCLUDE (status, sifen_submission_status, total, client_id, cash_session_id) WITH (DROP_EXISTING = ON);');
  ELSE
    EXEC('CREATE NONCLUSTERED INDEX ix_invoices_tenant_issued_at ON invoices(tenant_id, issued_at DESC)
          INCLUDE (status, sifen_submission_status, total, client_id, cash_session_id);');
END;

-- P2.8: cash-session close/detail (findByCashSession_IdAndTenant_Id, sum/count by session and status).
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_invoices_cash_session' AND object_id = OBJECT_ID(N'invoices'))
  EXEC('CREATE INDEX ix_invoices_cash_session ON invoices(cash_session_id, status) INCLUDE (total)
        WHERE cash_session_id IS NOT NULL;');

-- P2.9: invoices by client (existsByClient_Id delete guard / FK check, client filter on the list).
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_invoices_client' AND object_id = OBJECT_ID(N'invoices'))
  EXEC('CREATE INDEX ix_invoices_client ON invoices(client_id, issued_at DESC) WHERE client_id IS NOT NULL;');

-- P2.10: commission reversal lookups (NOT EXISTS ... reverses_entry_id = e.id, existsByReversesEntryId,
-- findReversedIds). Reversals are rare, so the filtered index stays tiny.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_commission_entry_reverses' AND object_id = OBJECT_ID(N'commission_entries'))
  EXEC('CREATE INDEX ix_commission_entry_reverses ON commission_entries(reverses_entry_id) INCLUDE (tenant_id)
        WHERE reverses_entry_id IS NOT NULL;');

-- P2.11: service-record list (ordered by created_at DESC), tips report (status + closed_at range),
-- per-professional tip totals.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_service_records_tenant_created' AND object_id = OBJECT_ID(N'service_records'))
  EXEC('CREATE INDEX ix_service_records_tenant_created ON service_records(tenant_id, created_at DESC);');

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_service_records_tenant_status_closed' AND object_id = OBJECT_ID(N'service_records'))
  EXEC('CREATE INDEX ix_service_records_tenant_status_closed ON service_records(tenant_id, status, closed_at);');

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_service_record_tips_professional' AND object_id = OBJECT_ID(N'service_record_tips'))
  EXEC('CREATE INDEX ix_service_record_tips_professional ON service_record_tips(professional_id)
        INCLUDE (amount, service_record_id);');

-- P2.12: RUC lookup on invoice issue / client import, and the client list sorted by full_name.
-- ix_clients_tenant_name has tenant_id as its leading key, so it replaces ix_clients_tenant (V1).
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_clients_tenant_ruc' AND object_id = OBJECT_ID(N'clients'))
  EXEC('CREATE INDEX ix_clients_tenant_ruc ON clients(tenant_id, ruc) WHERE ruc IS NOT NULL;');

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_clients_tenant_name' AND object_id = OBJECT_ID(N'clients'))
  EXEC('CREATE INDEX ix_clients_tenant_name ON clients(tenant_id, full_name);');

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_clients_tenant' AND object_id = OBJECT_ID(N'clients'))
  EXEC('DROP INDEX ix_clients_tenant ON clients;');
