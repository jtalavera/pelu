// Volume plan + size estimate for a golden DB (docs/staging-env.md T6).

export const pad3 = (n) => String(n).padStart(3, "0");

export function validateCounts({ tenants, sifenTenants, fromTenants, blockSize }) {
  const errors = [];
  if (!Number.isInteger(tenants) || tenants <= 0 || tenants % blockSize !== 0) {
    errors.push(`--tenants must be a positive multiple of ${blockSize} (got ${tenants})`);
  }
  if (!Number.isInteger(fromTenants) || fromTenants < 0 || fromTenants % blockSize !== 0 || fromTenants >= tenants) {
    errors.push(`--from-tenants must be a multiple of ${blockSize} below --tenants (got ${fromTenants})`);
  }
  if (!Number.isInteger(sifenTenants) || sifenTenants < 0 || sifenTenants > tenants) {
    errors.push(`--sifen-tenants must be between 0 and --tenants (got ${sifenTenants})`);
  }
  return errors;
}

/** Working days in the history window and in the future window. */
export function dayCounts(v) {
  const share = v.workingDays.length / 7;
  return { history: Math.round(v.historyDays * share), future: Math.round(v.futureDays * share) };
}

export function rowsPerTenant(v) {
  const t = v.perTenant;
  const days = dayCounts(v);
  const past = days.history * t.professionals * t.appointmentsPerProfessionalPerDay;
  const future = days.future * t.professionals * t.futureAppointmentsPerProfessionalPerDay;
  const completed = Math.round((past * t.statusMix.COMPLETED) / 100);
  return {
    clients: t.clients,
    appointments: past + future,
    service_records: completed,
    service_record_lines: completed,
    invoices: completed,
    invoice_lines: completed,
    invoice_payment_allocations: completed,
    invoice_tips: Math.round((completed * t.tipPercentOfInvoices) / 100),
    cash_sessions: days.history,
    cash_movements: days.history * t.cashMovementsPerSession,
  };
}

export function estimateBytes(v, tenants) {
  const perTenantRows = rowsPerTenant(v);
  const perTenant = Object.entries(perTenantRows).reduce(
    (sum, [table, n]) => sum + n * (v.sizeEstimate.bytesPerRow[table] ?? 500),
    0,
  );
  return { perTenantRows, perTenantBytes: perTenant, totalBytes: v.sizeEstimate.baseBytes + perTenant * tenants };
}

export const mb = (b) => `${(b / 1024 / 1024).toFixed(1)} MB`;
