import { femmeJson, femmePostJson, femmePutJson } from "./femmeClient";
import { authHeaders } from "./authHeaders";
import { apiBaseUrl } from "./baseUrl";

/** Módulo de comisiones API (requirements/prds/femme_modulo_comisiones_v1.md). */

export type ApplyMode = "IMMEDIATE" | "NEXT_PERIOD" | "PERIOD_START";
export type ConfigScope =
  | "BASE"
  | "DEFAULT_SERVICE"
  | "DEFAULT_PRODUCT"
  | "PERIODICITY"
  | "RULE"
  | "GROUP_RULE"
  | "FIXED_DESTINATION"
  | "AGUINALDO_ENABLED"
  | "AGUINALDO_DEFAULT"
  | "RETENTION_PROFILE";
export type FixedDestination = "PROFESSIONAL" | "SALON";
export type BaseType = "NET_OF_TAX" | "TAX_INCLUDED";
export type Periodicity = "WEEKLY" | "BIWEEKLY" | "MONTHLY" | "MANUAL";
export type ItemKind = "SERVICE" | "PRODUCT";

export type ConfigChange = {
  scope: ConfigScope;
  serviceId?: number | null;
  professionalId?: number | null;
  /** HU-COM-14: commission group of a GROUP_RULE. */
  groupId?: number | null;
  /** A percent, or for rules "pago|retención|montoFijo|destino" (e.g. "45|5|3000|P"). */
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
  groupId: number | null;
  groupName: string | null;
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
  fixedDestination: FixedDestination;
  aguinaldoEnabled: boolean;
  aguinaldoDefaultPercent: number;
  retentionProfiles: RetentionProfile[];
};

/** % retained for aguinaldo from a professional by default (null = she does not retain). */
export type RetentionProfile = {
  professionalId: number;
  professionalName: string | null;
  active: boolean;
  percent: number | null;
};

// ── Commission groups & rules by professional (HU-COM-14) ───────────────────────────────────

export type GroupView = {
  id: number;
  name: string;
  serviceCount: number;
  serviceNames: string[];
  /** The % the group pays to everybody (HU-COM-20); null = it has none. */
  percent: number | null;
};
export type GroupSuggestion = { groupId: number; groupName: string; reason: string };
/** One active catalog item with its current commission group (null = none) and a name suggestion. */
export type GroupServiceRow = {
  serviceId: number;
  name: string;
  categoryName: string | null;
  price: number | null;
  groupId: number | null;
  groupName: string | null;
  suggestion: GroupSuggestion | null;
};
export type ProfessionalRuleSummary = {
  professionalId: number;
  name: string;
  /** Services where she is paid differently. */
  ruleCount: number;
  retentionPercent: number | null;
};
export type ProfessionalsRuleSummary = { aguinaldoEnabled: boolean; professionals: ProfessionalRuleSummary[] };

// ── Commission rates: group → service → professional (HU-COM-20) ─────────────────────────────

/** A professional that is paid a different % than usual for one service. */
export type RateException = {
  professionalId: number;
  professionalName: string;
  percent: number;
  fixedAmount: number;
  /** Set by the rule; null = follows the salon default. */
  fixedDestination: FixedDestination | null;
  scheduled: boolean;
};
export type RateSource = "SERVICE" | "GROUP" | "GENERAL";
export type RateItem = {
  serviceId: number;
  name: string;
  kind: ItemKind;
  ownPercent: number | null;
  ownFixedAmount: number | null;
  ownFixedDestination: FixedDestination | null;
  /** What it pays to everybody: its own %, else its group's, else the general one. */
  normalPercent: number;
  normalFixedAmount: number;
  normalFixedDestination: FixedDestination;
  source: RateSource;
  scheduled: boolean;
  exceptions: RateException[];
};
export type RateGroup = {
  id: number;
  name: string;
  percent: number | null;
  fixedAmount: number | null;
  fixedDestination: FixedDestination | null;
  scheduled: boolean;
  items: RateItem[];
};
export type RatesView = {
  date: string;
  baseType: BaseType;
  generalServicePercent: number;
  generalProductPercent: number;
  defaultFixedDestination: FixedDestination;
  groups: RateGroup[];
  ungrouped: RateItem[];
};

// ── Period overview (HU-COM-15) ─────────────────────────────────────────────────────────────

export type OverviewStatus = "UNSETTLED" | "DRAFT" | "APPROVED" | "PAID" | "NONE";
export type OverviewRow = {
  professionalId: number;
  professionalName: string;
  status: OverviewStatus;
  amount: number;
  retention: number;
  settlementId: number | null;
  ruleCount: number;
  /** Movements behind the amount. */
  lineCount: number;
  /** Day the settlement was paid (PAID only), `YYYY-MM-DD`. */
  paidOn: string | null;
};
export type Overview = {
  period: PeriodInfo;
  offset: number;
  rows: OverviewRow[];
  total: number;
  retentionTotal: number;
  unsettled: number;
  drafts: number;
  approved: number;
  paid: number;
  linesWithoutProfessional: number;
  ungroupedServices: number;
  /** Groups that do not have their % yet (HU-COM-20). */
  groupsWithoutPercent: number;
  groupCount: number;
  aguinaldoEnabled: boolean;
  aguinaldoBalance: number;
  /** Active professionals with a retention % above zero (step 4 of «Configurar»). */
  professionalsRetaining: number;
};

// ── Aguinaldo fund (HU-COM-14) ──────────────────────────────────────────────────────────────

export type AguinaldoBalance = {
  professionalId: number;
  professionalName: string | null;
  active: boolean;
  retained: number;
  paid: number;
  balance: number;
  lastPaymentOn: string | null;
};
export type AguinaldoSummary = { enabled: boolean; totalBalance: number; balances: AguinaldoBalance[] };
export type AguinaldoMovementView = {
  kind: "ACCRUAL" | "PAYMENT" | "ADJUSTMENT";
  date: string;
  concept: string | null;
  amount: number;
  balance: number;
  settlementId: number | null;
  movementId: number | null;
  paymentMethod: string | null;
  closesFund: boolean;
  note: string | null;
};
export type AguinaldoDetail = {
  professionalId: number;
  professionalName: string;
  balance: number;
  movements: AguinaldoMovementView[];
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
  /** What it pays without a % of its own: its group's %, else the general one (HU-COM-20). */
  inheritedPercent: number;
  inheritedFrom: "GROUP" | "GENERAL";
  /** Group the inherited % comes from (only when `inheritedFrom` is GROUP). */
  inheritedGroupName: string | null;
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
  /** The invoice line shared by an entry, its reversal and its new revision (HU-COM-29). */
  invoiceLineId: number | null;
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
  /** What is paid for the line: the paid % plus the fixed amount when it is the professional's. */
  commissionAmount: number;
  fixedAmount: number;
  fixedToProfessional: boolean;
  retentionPercent: number;
  /** Retained for aguinaldo (not paid with the settlement). */
  retentionAmount: number;
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
  retentionTotal: number;
  lines: number;
  entries: EntryView[];
  draftSettlements: SettlementView[];
  /** Part of `total` accrued before `periodFrom` (unsettled, carried from earlier periods). */
  carriedAmount: number;
  carriedEntryIds: number[];
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
  /** Retained for aguinaldo in the settlement's lines (not included in totalAmount). */
  retentionAmount: number;
  /** Fixed amount (costo de producto) for the professional, included in totalAmount. */
  fixedAmount: number;
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
  fixedAmount: number;
  fixedToProfessional: boolean;
  retentionAmount: number;
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
  currentPeriodRetention: number;
  currentPeriodFixed: number;
  aguinaldoEnabled: boolean;
  aguinaldoBalance: number;
};

export type MySettlementDetail = { settlement: SettlementView; entries: MyEntryView[]; byKind: Subtotal[] };

export type EntryFilters = {
  from?: string;
  to?: string;
  professionalId?: number | null;
  /** Several professionals at once (empty = all). */
  professionalIds?: number[];
  kind?: string;
  state?: string;
};

function qs(params: Record<string, string | number | number[] | null | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) for (const item of v) q.append(k, String(item));
    else if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
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
/** "Asignar profesional" from the comprobante detail: assign or change several lines of one invoice. */
export const assignInvoiceLinesProfessionals = (
  invoiceId: number,
  assignments: { invoiceLineId: number; professionalId: number }[],
  note: string,
) =>
  femmePostJson<EntryView[]>(`/api/commissions/invoices/${invoiceId}/assign-lines`, {
    assignments,
    note: note || null,
  });
export const getEntries = (f: EntryFilters) => femmeJson<EntryView[]>(`/api/commissions/entries${qs(f)}`);
export const getReport = (f: EntryFilters) => femmeJson<ReportResponse>(`/api/commissions/reports${qs(f)}`);
export const getLinesWithoutBeneficiary = (from?: string, to?: string) =>
  femmeJson<LineWithoutBeneficiary[]>(`/api/commissions/lines-without-beneficiary${qs({ from, to })}`);
export const listSettlements = (p: {
  professionalId?: number | null;
  /** Several professionals at once (empty = all). */
  professionalIds?: number[];
  status?: string;
  from?: string;
  to?: string;
  page: number;
  size: number;
}) => femmeJson<PagedSettlements>(`/api/commissions/settlements${qs(p)}`);
export type GenerateSettlementsBody = {
  periodFrom: string;
  periodTo: string;
  /** Empty = every professional with unsettled commissions. */
  professionalIds: number[];
  /** Skip professionals that already have a settlement overlapping the period. */
  skipOverlapping?: boolean;
};
export type SettlementConflict = {
  professionalId: number;
  professionalName: string | null;
  settlementId: number;
  status: SettlementStatus;
  periodFrom: string;
  periodTo: string;
};
export type SettlementGenerationCheck = { conflicts: SettlementConflict[]; generatable: number };
export const generateSettlements = (body: GenerateSettlementsBody) =>
  femmePostJson<SettlementView[]>("/api/commissions/settlements/generate", body);
/** Dry run of «Generar»: who already has an overlapping settlement and how many could be created. */
export const checkSettlementGeneration = (body: GenerateSettlementsBody) =>
  femmePostJson<SettlementGenerationCheck>("/api/commissions/settlements/generate/check", body);
export const getSettlement = (id: number) => femmeJson<SettlementDetail>(`/api/commissions/settlements/${id}`);
export const addAdjustment = (id: number, amount: number, reason: string) =>
  femmePostJson<SettlementDetail>(`/api/commissions/settlements/${id}/adjustments`, { amount, reason });
export const approveSettlement = (id: number) =>
  femmePostJson<SettlementDetail>(`/api/commissions/settlements/${id}/approve`, {});
export const paySettlement = (id: number, paymentMethod: string, paidOn: string | null, paymentReference: string) =>
  femmePostJson<SettlementDetail>(`/api/commissions/settlements/${id}/pay`, { paymentMethod, paidOn, paymentReference });
export const voidSettlement = (id: number, reason: string) =>
  femmePostJson<SettlementDetail>(`/api/commissions/settlements/${id}/void`, { reason });
export const getOverview = (offset = 0) => femmeJson<Overview>(`/api/commissions/overview${qs({ offset })}`);
export const getGroups = () => femmeJson<GroupView[]>("/api/commissions/groups");
export const createGroup = (name: string) => femmePostJson<GroupView>("/api/commissions/groups", { name });
export const renameGroup = (id: number, name: string) =>
  femmePutJson<void>(`/api/commissions/groups/${id}`, { name });
export const deleteGroup = (id: number) => femmeJson<void>(`/api/commissions/groups/${id}`, { method: "DELETE" });
export const getGroupServices = (kind: ItemKind = "SERVICE") =>
  femmeJson<GroupServiceRow[]>(`/api/commissions/groups/services${qs({ kind })}`);
export const getProfessionalsSummary = () =>
  femmeJson<ProfessionalsRuleSummary>("/api/commissions/professionals/summary");
export const assignGroups = (assignments: { serviceId: number; groupId: number | null }[]) =>
  femmePostJson<{ changed: number; rows: GroupServiceRow[] }>("/api/commissions/groups/assign", { assignments });
/** HU-COM-20: every group and service with what it pays and who is paid differently. */
export const getRates = (date?: string) => femmeJson<RatesView>(`/api/commissions/rates${date ? `?date=${date}` : ""}`);

export const getAguinaldo = () => femmeJson<AguinaldoSummary>("/api/commissions/aguinaldo");
export const getAguinaldoDetail = (professionalId: number) =>
  femmeJson<AguinaldoDetail>(`/api/commissions/aguinaldo/${professionalId}`);
export const payAguinaldo = (body: {
  professionalId: number;
  /** null = the whole balance. */
  amount: number | null;
  paidOn: string | null;
  paymentMethod: string;
  closesFund: boolean;
  note: string | null;
}) => femmePostJson<AguinaldoDetail>("/api/commissions/aguinaldo/payments", body);
export const payAguinaldoToAll = (body: { paidOn: string | null; paymentMethod: string; note: string | null }) =>
  femmePostJson<{ paid: number }>("/api/commissions/aguinaldo/payments/all", body);
export const adjustAguinaldo = (body: { professionalId: number; amount: number; reason: string }) =>
  femmePostJson<AguinaldoDetail>("/api/commissions/aguinaldo/adjustments", body);

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

/** `lang` = the UI language, so the export's column headers and labels match what the user reads. */
export const entriesCsvPath = (f: EntryFilters, lang: string) => `/api/commissions/entries.csv${qs({ ...f, lang })}`;
export const settlementsCsvPath = (f: { status?: string; professionalIds?: number[] }, lang: string) =>
  `/api/commissions/settlements.csv${qs({ status: f.status, professionalIds: f.professionalIds, lang })}`;
export const settlementPdfPath = (id: number, lang: string) => `/api/commissions/settlements/${id}/pdf${qs({ lang })}`;
