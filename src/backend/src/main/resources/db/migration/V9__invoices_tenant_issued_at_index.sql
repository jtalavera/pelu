-- List query: WHERE tenant_id = ? AND issued_at >= ? AND issued_at <= ? ORDER BY issued_at DESC
CREATE NONCLUSTERED INDEX ix_invoices_tenant_issued_at ON invoices (tenant_id, issued_at DESC);
