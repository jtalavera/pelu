import { femmeJson, femmePostJson } from "./femmeClient";
import { authHeaders } from "./authHeaders";
import { apiBaseUrl } from "./baseUrl";

/** Módulo de comisiones API (requirements/prds/femme_modulo_comisiones_v1.md). */

export type ApplyMode = "IMMEDIATE" | "NEXT_PERIOD" | "PERIOD_START";
export type ConfigScope = "BASE" | "DEFAULT_SERVICE" | "DEFAULT_PRODUCT" | "PERIODICITY" | "RULE";
export type BaseType = "NET_OF_TAX" | "TAX_INCLUDED";
export type Periodicity = "WEEKLY" | "BIWEEKLY" | "MONTHLY" | "MANUAL";
export type ItemKind = "SERVICE" | "PRODUCT";

export type ConfigChange = {
  scope: ConfigScope;
  serviceId?: number | null;
  professionalId?: number | null;
  value: string | null;
  validUntil?: string | null;
};

export type RecalculationPreview = {
  entriesRecalculated: number;
  entriesExcluded: number;
  deltaAmount: number;
  deltaByProfessional: { professionalId: number; professionalName: string | null; amount: number }[];
};

export type ApplyChangesResponse = {
  applyMode: ApplyMode;
  effectiveFrom: string;
  preview: boolean;
  recalculation: RecalculationPreview | null;
};

export type PeriodInfo = { periodicity: Periodicity; from: string | null; to: string | null; nextFrom: string | null };

export type ApplyModeOptions = {
  currentPeriod: PeriodInfo;
  immediateFrom: string;
  nextPeriodFrom: string | null;
  periodStartFrom: string;
  availableModes: ApplyMode[];
};

export type VersionView = {
  id: number;
  scope: ConfigScope;
  serviceId: number | null;
  serviceName: string | null;
  itemKind: ItemKind | null;
  professionalId: number | null;
  professionalName: string | null;
  value: string | null;
  previousValue: string | null;
  effectiveFrom: string;
  applyMode: ApplyMode;
  status: "ACTIVE" | "SUPERSEDED" | "CANCELLED";
  scheduled: boolean;
  createdAt: string;
  createdByEmail: string | null;
};

export type SettingsResponse = {
  base: BaseType;
  defaultPercentService: number;
  defaultPercentProduct: number;
  periodicity: Periodicity;
  currentPeriod: PeriodInfo;
  scheduledChanges: VersionView[];
  history: VersionView[];
};

export type ExceptionView = {
  professionalId: number;
  professionalName: string | null;
  professionalActive: boolean;
  percent: number | null;
  versionId: number | null;
  scheduled: VersionView[];
};

export type ItemRules = {
  serviceId: number;
  serviceName: string;
  itemKind: ItemKind;
  generalPercent: number | null;
  generalVersionId: number | null;
  defaultPercent: number;
  generalScheduled: VersionView[];
  exceptions: ExceptionView[];
  history: VersionView[];
};

export type RuleException = { professionalId: number; professionalName: string; percent: number; delta: number };
export type RuleItem = {
  serviceId: number;
  name: string;
  price: number;
  baseAmount: number;
  standardPercent: number;
  ownStandard: boolean;
  exceptions: RuleException[];
  scheduled: boolean;
};
export type RuleCategory = { categoryId: number; name: string; exceptions: number; items: RuleItem[] };
export type RulesView = {
  kind: ItemKind;
  date: string;
  baseType: BaseType;
  generalPercent: number;
  itemCount: number;
  itemsWithExceptions: number;
  professionals: { id: number; fullName: string }[];
  categories: RuleCategory[];
};

export type ItemWithoutRule = { serviceId: number; serviceName: string; itemKind: ItemKind };

export type EntryView = {
  id: number;
  professionalId: number;
  professionalName: string | null;
  sourceType: "INVOICE_LINE" | "REVERSAL" | "ADJUSTMENT";
  revision: number;
  reasonCode: string | null;
  invoiceId: number | null;
  invoiceNumber: string | null;
  serviceId: number | null;
  itemName: string | null;
  itemKind: ItemKind | null;
  baseType: BaseType | null;
  lineTotal: number | null;
  taxAmount: number | null;
  baseAmount: number | null;
  percentApplied: number | null;
  ruleOrigin: string | null;
  commissionAmount: number;
  accrualAt: string;
  reversesEntryId: number | null;
  settlementId: number | null;
  settlementStatus: string | null;
  note: string | null;
  /** Live INVOICE_LINE entry whose professional can be changed. */
  reassignable: boolean;
};

export type SettlementPreview = {
  professionalId: number;
  professionalName: string | null;
  periodFrom: string;
  periodTo: string;
  total: number;
  servicesTotal: number;
  productsTotal: number;
  adjustmentsTotal: number;
  lines: number;
  entries: EntryView[];
  draftSettlements: SettlementView[];
};

export type SettlementStatus = "DRAFT" | "APPROVED" | "PAID" | "VOIDED";

export type SettlementView = {
  id: number;
  professionalId: number;
  professionalName: string | null;
  periodFrom: string;
  periodTo: string;
  status: SettlementStatus;
  totalAmount: number;
  createdAt: string;
  approvedAt: string | null;
  paidAt: string | null;
  paymentMethod: string | null;
  paymentReference: string | null;
  voidReason: string | null;
};

export type Subtotal = { key: string; label: string; amount: number; lines: number };

export type SettlementDetail = {
  settlement: SettlementView;
  entries: EntryView[];
  adjustments: EntryView[];
  byItem: Subtotal[];
  byKind: Subtotal[];
  mixedBases: boolean;
  history: { fromStatus: string | null; toStatus: string; changedAt: string; changedByEmail: string | null }[];
};

export type PagedSettlements = { items: SettlementView[]; page: number; size: number; total: number };

export type ReportRow = { key: string; label: string | null; itemKind: string | null; amount: number; lines: number };
export type ReportResponse = {
  from: string;
  to: string;
  total: number;
  byProfessional: ReportRow[];
  byItem: ReportRow[];
  byKind: ReportRow[];
  byPeriod: ReportRow[];
};

export type LineWithoutBeneficiary = {
  invoiceLineId: number;
  invoiceId: number;
  invoiceNumber: string;
  issuedAt: string;
  description: string;
  itemKind: ItemKind | null;
  lineTotal: number;
};

export type MyEntryView = {
  id: number;
  sourceType: string;
  reasonCode: string | null;
  invoiceNumber: string | null;
  itemName: string | null;
  itemKind: ItemKind | null;
  baseType: BaseType | null;
  baseAmount: number | null;
  percentApplied: number | null;
  commissionAmount: number;
  accrualAt: string;
  note: string | null;
};

export type MySummary = {
  currentPeriod: PeriodInfo;
  currentPeriodTotal: number;
  servicesTotal: number;
  productsTotal: number;
  currentPeriodEntries: MyEntryView[];
  settlements: SettlementView[];
};

export type MySettlementDetail = { settlement: SettlementView; entries: MyEntryView[]; byKind: Subtotal[] };

export type EntryFilters = {
  from?: string;
  to?: string;
  professionalId?: number | null;
  kind?: string;
  state?: string;
};

function qs(params: Record<string, string | number | null | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

export const getSettings = () => femmeJson<SettingsResponse>("/api/commissions/settings");
export const getApplyModeOptions = () => femmeJson<ApplyModeOptions>("/api/commissions/apply-mode-options");
export const applyChanges = (body: {
  changes: ConfigChange[];
  applyMode: ApplyMode | null;
  replacePending: boolean;
  preview: boolean;
}) => femmePostJson<ApplyChangesResponse>("/api/commissions/changes", body);
export const cancelScheduledChange = (versionId: number) =>
  femmeJson<void>(`/api/commissions/changes/${versionId}`, { method: "DELETE" });
export const getItemRules = (serviceId: number) =>
  femmeJson<ItemRules>(`/api/commissions/items/${serviceId}/rules`);
export const getRulesView = (kind: ItemKind, date?: string) =>
  femmeJson<RulesView>(`/api/commissions/rules-view${qs({ kind, date })}`);
export const getItemsWithoutRule = () => femmeJson<ItemWithoutRule[]>("/api/commissions/items-without-rule");
export const getSettlementPreview = (professionalId: number, from?: string, to?: string) =>
  femmeJson<SettlementPreview>(`/api/commissions/settlement-preview${qs({ professionalId, from, to })}`);
export const reassignEntry = (entryId: number, professionalId: number, reason: string) =>
  femmePostJson<EntryView>(`/api/commissions/entries/${entryId}/reassign`, { professionalId, reason });
export const assignLineProfessional = (invoiceLineId: number, professionalId: number, note: string) =>
  femmePostJson<EntryView>(`/api/commissions/invoice-lines/${invoiceLineId}/assign`, {
    professionalId,
    note: note || null,
  });
/** "Asignar profesional" from the comprobante detail: several lines of one invoice at once. */
export const assignInvoiceLinesProfessionals = (
  invoiceId: number,
  assignments: { invoiceLineId: number; professionalId: number }[],
) =>
  femmePostJson<EntryView[]>(`/api/commissions/invoices/${invoiceId}/assign-lines`, {
    assignments,
    note: null,
  });
export const getEntries = (f: EntryFilters) => femmeJson<EntryView[]>(`/api/commissions/entries${qs(f)}`);
export const getReport = (f: EntryFilters) => femmeJson<ReportResponse>(`/api/commissions/reports${qs(f)}`);
export const getLinesWithoutBeneficiary = (from?: string, to?: string) =>
  femmeJson<LineWithoutBeneficiary[]>(`/api/commissions/lines-without-beneficiary${qs({ from, to })}`);
export const listSettlements = (p: {
  professionalId?: number | null;
  status?: string;
  from?: string;
  to?: string;
  page: number;
  size: number;
}) => femmeJson<PagedSettlements>(`/api/commissions/settlements${qs(p)}`);
export const generateSettlements = (body: { periodFrom: string; periodTo: string; professionalIds: number[] }) =>
  femmePostJson<SettlementView[]>("/api/commissions/settlements/generate", body);
export const getSettlement = (id: number) => femmeJson<SettlementDetail>(`/api/commissions/settlements/${id}`);
export const addAdjustment = (id: number, amount: number, reason: string) =>
  femmePostJson<SettlementDetail>(`/api/commissions/settlements/${id}/adjustments`, { amount, reason });
export const approveSettlement = (id: number) =>
  femmePostJson<SettlementDetail>(`/api/commissions/settlements/${id}/approve`, {});
export const paySettlement = (id: number, paymentMethod: string, paidOn: string | null, paymentReference: string) =>
  femmePostJson<SettlementDetail>(`/api/commissions/settlements/${id}/pay`, { paymentMethod, paidOn, paymentReference });
export const voidSettlement = (id: number, reason: string) =>
  femmePostJson<SettlementDetail>(`/api/commissions/settlements/${id}/void`, { reason });
export const getMySummary = () => femmeJson<MySummary>("/api/commissions/me");
export const getMySettlement = (id: number) => femmeJson<MySettlementDetail>(`/api/commissions/me/settlements/${id}`);

/** Downloads a binary export (CSV / PDF) of the commissions API. */
export async function downloadCommissionFile(path: string, fallbackName: string): Promise<void> {
  const res = await fetch(`${apiBaseUrl()}${path}`, { headers: authHeaders({ json: false }) });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  const blob = await res.blob();
  const match = (res.headers.get("Content-Disposition") ?? "").match(/filename="?([^"]+)"?/);
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = match ? match[1] : fallbackName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(blobUrl);
}

export const entriesCsvPath = (f: EntryFilters) => `/api/commissions/entries.csv${qs(f)}`;
export const settlementsCsvPath = (status?: string) => `/api/commissions/settlements.csv${qs({ status })}`;
export const settlementPdfPath = (id: number) => `/api/commissions/settlements/${id}/pdf`;
