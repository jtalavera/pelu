-- Index for the agenda's week window (findInRange / findInRangeFiltered) and the dashboard's
-- per-day / per-range appointment counts: WHERE tenant_id = ? AND start_at >= ? AND start_at < ?
-- ORDER BY start_at. The existing ix_appointments_tenant_time (tenant_id, professional_id,
-- start_at) cannot seek on start_at without a professional_id filter, so every agenda load read all
-- of the tenant's appointments (~5.7 ms / ~300 reads at ~2,000 rows; staging load test,
-- loadtest-V99-t10-s0 ramp, 2026-11-15). Keep the old index: the overlap checks use it.
IF NOT EXISTS (SELECT 1 FROM sys.indexes
               WHERE name = N'ix_appointments_tenant_start' AND object_id = OBJECT_ID(N'appointments'))
  CREATE INDEX ix_appointments_tenant_start ON appointments(tenant_id, start_at)
    INCLUDE (end_at, status, professional_id, client_id);
