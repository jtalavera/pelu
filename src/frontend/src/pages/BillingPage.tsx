import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Badge,
  Button,
  Card,
  Heading,
  Input,
  Label,
  Select,
  Spinner,
  Text,
} from "@design-system";
import { femmeJson, femmePostJson } from "../api/femmeClient";
import { FiscalRucWarning } from "../components/FiscalRucWarning";
import { InvoiceDetailModal } from "../components/InvoiceDetailModal";
import { downloadInvoicePdf } from "../api/downloadInvoicePdf";
import { translateApiError } from "../api/parseApiErrorMessage";
import { validateRuc } from "../lib/validateRuc";
import { ClientSearchField, type ClientSelection } from "../components/ClientSearchField";
import {
  ServiceSearchField,
  type SalonServiceOption,
} from "../components/ServiceSearchField";
import { FieldValidationError } from "../components/FieldValidationError";
import { ListSearchField } from "../components/ListSearchField";
import { useDateLocale } from "../i18n/dateLocale";
import { formatAmountDecimal, formatDecimalGs, formatGuaraniesGs } from "../lib/formatMoney";
import { maskMoneyInput, moneyDigitsOnly, parseMaskedMoney } from "../lib/moneyInputMask";
import { formatParaguayDateTime } from "../lib/paraguayDateTime";
import { filterByListQuery } from "../util/matchesListQuery";
import { useFeatureFlag } from "../hooks/useFeatureFlags";
import { useTour } from "../tour/useTour";
import { billingSteps, registerBillingTabSwitcher } from "../tour/steps/billing";

// ─── Types ────────────────────────────────────────────────────────────────────

type CashSession = {
  id: number;
  tenantId: number;
  openedByUserId: number;
  openedByEmail: string;
  openedAt: string;
  openingCashAmount: string;
  isOpen: boolean;
};

type CashSessionCloseResponse = {
  id: number;
  tenantId: number;
  openedAt: string;
  closedAt: string;
  closedByEmail: string;
  openingCashAmount: string;
  countedCashAmount: string;
  expectedCashAmount: string;
  cashDifference: string;
  totalInvoiced: string;
  invoiceCount: number;
  paymentSummary: Array<{ method: string; total: string }>;
};

type InvoiceListItem = {
  id: number;
  invoiceNumber: number;
  invoiceNumberFormatted: string;
  clientDisplayName: string;
  status: string;
  total: string;
  issuedAt: string;
  servicesSummary?: string | null;
  paymentMethodsSummary?: string | null;
};


type InvoiceLineForm = {
  serviceId: string;
  description: string;
  quantity: string;
  unitPrice: string;
  pickedService: SalonServiceOption | null;
  discountEnabled: boolean;
  discountType: "FIXED" | "PERCENT";
  discountValue: string;
};

type PaymentForm = {
  method: string;
  amount: string;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(isoString: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(isoString));
  } catch {
    return isoString;
  }
}

function todayRangeIso(): { from: string; to: string } {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  return { from: start.toISOString(), to: end.toISOString() };
}

function InvoiceStatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  let bg = "var(--color-warning-lt)";
  let color = "var(--color-warning)";
  let label = t("femme.billing.session.statusPending");
  if (status === "ISSUED") {
    bg = "var(--color-success-lt)";
    color = "var(--color-success)";
    label = t("femme.billing.session.statusIssued");
  } else if (status === "VOIDED") {
    bg = "var(--color-danger-lt)";
    color = "var(--color-danger)";
    label = t("femme.billing.session.statusVoided");
  }
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 500,
        padding: "2px 8px",
        borderRadius: "var(--radius-pill)",
        display: "inline-block",
        whiteSpace: "nowrap",
        background: bg,
        color,
      }}
    >
      {label}
    </span>
  );
}

const PAYMENT_METHODS = [
  "CASH",
  "DEBIT_CARD",
  "CREDIT_CARD",
  "TRANSFER",
  "OTHER",
] as const;

function capitalize(s: string): string {
  if (!s) return "";
  return s
    .split("_")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join("");
}

function paymentMethodsLabel(
  summary: string | null | undefined,
  t: (key: string) => string,
): string {
  if (!summary?.trim()) return "—";
  return summary
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .map((m) => t(`femme.billing.invoice.paymentMethod${capitalize(m)}`))
    .join(" + ");
}

/** Local calendar dates: yesterday through today (two inclusive days). */
function getDefaultInvoiceHistoryDateRange(): { from: string; to: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  const today = new Date(y, m, d);
  const yesterday = new Date(y, m, d - 1);
  const fmt = (dt: Date) =>
    `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
  return { from: fmt(yesterday), to: fmt(today) };
}

function localDateYmdToIsoStart(ymd: string): string {
  const [yy, mm, dd] = ymd.split("-").map(Number);
  return new Date(yy, mm - 1, dd, 0, 0, 0, 0).toISOString();
}

function localDateYmdToIsoEnd(ymd: string): string {
  const [yy, mm, dd] = ymd.split("-").map(Number);
  return new Date(yy, mm - 1, dd, 23, 59, 59, 999).toISOString();
}

function inclusiveLocalDaysBetween(fromYmd: string, toYmd: string): number {
  const [fy, fm, fd] = fromYmd.split("-").map(Number);
  const [ty, tm, td] = toYmd.split("-").map(Number);
  const a = new Date(fy, fm - 1, fd).getTime();
  const b = new Date(ty, tm - 1, td).getTime();
  return Math.floor((b - a) / 86400000) + 1;
}

/** null = valid; otherwise an i18n key under femme.billing.history.rangeError* */
function invoiceHistoryRangeErrorKey(from: string, to: string): string | null {
  if (!from.trim() || !to.trim()) {
    return "incomplete";
  }
  if (from > to) {
    return "invalidOrder";
  }
  if (inclusiveLocalDaysBetween(from, to) > 31) {
    return "tooLong";
  }
  return null;
}

// ─── InvoiceHistoryTab ────────────────────────────────────────────────────────

function InvoiceHistoryTab() {
  const { t } = useTranslation();
  const dateLocale = useDateLocale();
  const [invoices, setInvoices] = useState<InvoiceListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dateRangeError, setDateRangeError] = useState<string | null>(null);
  const [filterFrom, setFilterFrom] = useState(() => getDefaultInvoiceHistoryDateRange().from);
  const [filterTo, setFilterTo] = useState(() => getDefaultInvoiceHistoryDateRange().to);
  const [filterStatus, setFilterStatus] = useState("");
  const [listTextQuery, setListTextQuery] = useState("");
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<number | null>(null);
  const filterDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadInvoices = useCallback(
    async (from: string, to: string, status: string) => {
      setLoadError(null);
      setDateRangeError(null);
      const rangeErr = invoiceHistoryRangeErrorKey(from, to);
      if (rangeErr) {
        setDateRangeError(t(`femme.billing.history.rangeError${capitalize(rangeErr)}`));
        setInvoices([]);
        return;
      }
      setLoading(true);
      try {
        const params = new URLSearchParams();
        params.set("from", localDateYmdToIsoStart(from));
        params.set("to", localDateYmdToIsoEnd(to));
        if (status) params.set("status", status);
        const qs = params.toString();
        const data = await femmeJson<InvoiceListItem[] | null>(`/api/invoices?${qs}`);
        setInvoices(Array.isArray(data) ? data : []);
      } catch (err) {
        setLoadError(translateApiError(err, t, "femme.billing.history.loadError"));
      } finally {
        setLoading(false);
      }
    },
    [t],
  );

  useEffect(() => {
    if (filterDebounceRef.current) clearTimeout(filterDebounceRef.current);
    filterDebounceRef.current = setTimeout(() => {
      void loadInvoices(filterFrom, filterTo, filterStatus);
    }, 350);
    return () => {
      if (filterDebounceRef.current) clearTimeout(filterDebounceRef.current);
    };
  }, [filterFrom, filterTo, filterStatus, loadInvoices]);

  const filteredInvoices = useMemo(
    () =>
      filterByListQuery(invoices, listTextQuery, (inv) => [
        inv.invoiceNumberFormatted,
        inv.clientDisplayName ?? "",
        inv.servicesSummary ?? "",
        inv.paymentMethodsSummary ?? "",
        String(inv.total ?? ""),
      ]),
    [invoices, listTextQuery],
  );

  function handleClear() {
    const d = getDefaultInvoiceHistoryDateRange();
    setFilterFrom(d.from);
    setFilterTo(d.to);
    setFilterStatus("");
    setListTextQuery("");
    setDateRangeError(null);
  }

  return (
    <div className="flex flex-col gap-4">
      <Heading as="h2" className="text-lg">
        {t("femme.billing.history.title")}
      </Heading>

      <div data-tour="billing-search" className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <ListSearchField
          id="invoice-history-text-filter"
          value={listTextQuery}
          onChange={setListTextQuery}
          label={t("femme.listFilter.label")}
          placeholder={t("femme.listFilter.placeholder")}
          className="w-full min-w-0 sm:max-w-[min(100%,280px)]"
        />
        <form
          onSubmit={(e) => e.preventDefault()}
          className="flex flex-wrap gap-3 items-end"
          noValidate
        >
          <div className="flex flex-col gap-1 min-w-[140px]">
            <Label htmlFor="filter-from">{t("femme.billing.history.filterFrom")}</Label>
            <Input
              id="filter-from"
              type="date"
              value={filterFrom}
              onChange={(e) => setFilterFrom(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1 min-w-[140px]">
            <Label htmlFor="filter-to">{t("femme.billing.history.filterTo")}</Label>
            <Input
              id="filter-to"
              type="date"
              value={filterTo}
              onChange={(e) => setFilterTo(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1 min-w-[140px]">
            <Label htmlFor="filter-status">{t("femme.billing.history.filterStatus")}</Label>
            <Select
              id="filter-status"
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
            >
              <option value="">{t("femme.billing.history.filterStatusAll")}</option>
              <option value="ISSUED">{t("femme.billing.history.statusIssued")}</option>
              <option value="VOIDED">{t("femme.billing.history.statusVoided")}</option>
            </Select>
          </div>
          <Button type="button" variant="secondary" size="sm" onClick={handleClear}>
            {t("femme.billing.history.clearFilters")}
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={() => void loadInvoices(filterFrom, filterTo, filterStatus)}
            disabled={loading}
          >
            {t("femme.billing.history.refresh")}
          </Button>
        </form>
      </div>

      {dateRangeError && (
        <Alert variant="destructive" title={t("femme.billing.errorTitle")}>
          {dateRangeError}
        </Alert>
      )}

      {loadError && (
        <Alert variant="destructive" title={t("femme.billing.errorTitle")}>
          {loadError}
        </Alert>
      )}

      <div data-tour="billing-invoice-list">
      {loading ? (
        <div className="flex items-center gap-2">
          <Spinner size="sm" />
          <Text>{t("femme.billing.history.loading")}</Text>
        </div>
      ) : dateRangeError ? null : invoices.length === 0 ? (
        <Text variant="muted">{t("femme.billing.history.empty")}</Text>
      ) : filteredInvoices.length === 0 ? (
        <Text variant="muted">{t("femme.listFilter.noMatches")}</Text>
      ) : (
        <div
          style={{
            background: "var(--color-white)",
            borderRadius: "var(--radius-xl)",
            border: "var(--border-default)",
            overflow: "hidden",
          }}
        >
          <div className="overflow-x-auto">
            <table
              className="min-w-full text-sm"
              style={{ tableLayout: "fixed" }}
            >
              <colgroup>
                <col style={{ width: "12%" }} />
                <col style={{ width: "18%" }} />
                <col style={{ width: "30%" }} />
                <col style={{ width: "14%" }} />
                <col style={{ width: "16%" }} />
                <col style={{ width: "10%" }} />
              </colgroup>
              <thead>
                <tr>
                  {[
                    { key: "colNumber", align: "left" },
                    { key: "colDate", align: "left" },
                    { key: "colClient", align: "left" },
                    { key: "colTotal", align: "right" },
                    { key: "colStatus", align: "center" },
                    { key: "", align: "right" },
                  ].map(({ key, align }, i) => (
                    <th
                      key={i}
                      style={{
                        padding: "9px 12px",
                        fontSize: 10,
                        fontWeight: 500,
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                        color: "var(--color-ink-3)",
                        background: "var(--color-stone)",
                        textAlign: align as "left" | "right" | "center",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {key ? t(`femme.billing.history.${key}`) : ""}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredInvoices.map((inv) => (
                  <tr
                    key={inv.id}
                    style={{
                      borderTop: "var(--border-default)",
                      cursor: "default",
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLTableRowElement).style.background =
                        "var(--color-rose-lt)";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLTableRowElement).style.background = "";
                    }}
                  >
                    <td style={{ padding: "10px 12px", fontFamily: "monospace" }}>
                      {inv.invoiceNumberFormatted}
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      {formatParaguayDateTime(inv.issuedAt, dateLocale)}
                    </td>
                    <td style={{ padding: "10px 12px" }}>{inv.clientDisplayName ?? "—"}</td>
                    <td style={{ padding: "10px 12px", textAlign: "right" }}>
                      {formatAmountDecimal(inv.total)}
                    </td>
                    <td style={{ padding: "10px 12px", textAlign: "center" }}>
                      <Badge variant={inv.status === "ISSUED" ? "success" : "destructive"}>
                        {inv.status === "ISSUED"
                          ? t("femme.billing.history.statusIssued")
                          : t("femme.billing.history.statusVoided")}
                      </Badge>
                    </td>
                    <td
                      style={{ padding: "10px 12px", textAlign: "right" }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedInvoiceId(inv.id)}
                      >
                        {t("femme.billing.history.viewDetail")}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      </div>

      {selectedInvoiceId !== null && (
        <InvoiceDetailModal
          invoiceId={selectedInvoiceId}
          onClose={() => setSelectedInvoiceId(null)}
          onVoided={() => {
            setSelectedInvoiceId(null);
            void loadInvoices(filterFrom, filterTo, filterStatus);
          }}
        />
      )}
    </div>
  );
}

// ─── NewInvoiceTab ────────────────────────────────────────────────────────────

type InitialClientForBilling = {
  id: number;
  fullName: string;
  phone: string | null;
  email: string | null;
  ruc: string | null;
};

function NewInvoiceTab({
  onIssued,
  initialClient,
  onInitialClientConsumed,
}: {
  onIssued: () => void;
  initialClient?: InitialClientForBilling | null;
  onInitialClientConsumed?: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const initialSelection: ClientSelection = initialClient
    ? {
        type: "client",
        client: {
          id: initialClient.id,
          fullName: initialClient.fullName,
          phone: initialClient.phone,
          email: initialClient.email,
          ruc: initialClient.ruc,
        },
      }
    : null;
  const [clientSelection, setClientSelection] = useState<ClientSelection>(initialSelection);
  const [clientSearchKey, setClientSearchKey] = useState(0);
  const [linesKey, setLinesKey] = useState(0);
  const [clientDisplayName, setClientDisplayName] = useState(
    initialClient?.fullName ?? "",
  );
  const [clientRucOverride, setClientRucOverride] = useState(
    initialClient?.ruc ?? "",
  );

  useEffect(() => {
    if (initialClient && onInitialClientConsumed) {
      onInitialClientConsumed();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [discountType, setDiscountType] = useState("NONE");
  const [discountValue, setDiscountValue] = useState("");
  const [discountValueError, setDiscountValueError] = useState<string | null>(null);
  const [lines, setLines] = useState<InvoiceLineForm[]>([
    {
      serviceId: "",
      description: "",
      quantity: "1",
      unitPrice: "",
      pickedService: null,
      discountEnabled: false,
      discountType: "PERCENT",
      discountValue: "",
    },
  ]);
  const [payments, setPayments] = useState<PaymentForm[]>([
    { method: "CASH", amount: "" },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successInvoiceNumber, setSuccessInvoiceNumber] = useState<string | null>(null);
  const [lastInvoiceId, setLastInvoiceId] = useState<number | null>(null);
  const [lineErrors, setLineErrors] = useState<Record<number, Record<string, string>>>({});
  const [paymentErrors, setPaymentErrors] = useState<Record<number, string>>({});
  const [globalErrors, setGlobalErrors] = useState<string[]>([]);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [rucValidForInvoicing, setRucValidForInvoicing] = useState<boolean>(true);

  useEffect(() => {
    void (async () => {
      try {
        const data = await femmeJson<{ rucValidForInvoicing: boolean }>("/api/business-profile");
        if (data?.rucValidForInvoicing === false) {
          setRucValidForInvoicing(false);
        }
      } catch {
        // silently ignore — warning defaults to not shown on error
      }
    })();
  }, []);

  function handleClientSelectionChange(sel: ClientSelection) {
    setClientSelection(sel);
    if (sel?.type === "client") {
      setClientDisplayName(sel.client.fullName);
      setClientRucOverride(sel.client.ruc ?? "");
    } else if (sel?.type === "occasional") {
      setClientDisplayName("");
      setClientRucOverride("");
    }
  }

  // Computed totals — mirror the backend math in InvoiceService.issueInvoice so
  // the displayed Total equals the value payments must sum to:
  //   gross line totals → per-item discounts → net subtotal → global discount.
  const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
  const lineGross = (l: InvoiceLineForm) =>
    (parseFloat(l.quantity) || 0) * parseMaskedMoney(l.unitPrice);
  const lineDiscountAmount = (l: InvoiceLineForm) => {
    if (!l.discountEnabled || !l.discountValue) return 0;
    const gross = lineGross(l);
    const dv =
      l.discountType === "FIXED"
        ? parseMaskedMoney(l.discountValue)
        : parseFloat(l.discountValue.replace(",", ".")) || 0;
    if (l.discountType === "PERCENT") return round2((gross * dv) / 100);
    return Math.min(round2(dv), gross);
  };

  // Subtotal shown to the user is the gross sum (before any discount); the
  // combined Descuento line reflects per-item + global discounts (AC3).
  const subtotal = lines.reduce((acc, l) => acc + lineGross(l), 0);
  const perItemDiscountTotal = lines.reduce((acc, l) => acc + lineDiscountAmount(l), 0);
  const netSubtotal = Math.max(0, subtotal - perItemDiscountTotal);

  let globalDiscount = 0;
  if (discountType === "FIXED") {
    globalDiscount = Math.min(parseMaskedMoney(discountValue), netSubtotal);
  } else if (discountType === "PERCENT") {
    globalDiscount = round2((netSubtotal * (parseFloat(discountValue) || 0)) / 100);
  }
  const discountAmount = perItemDiscountTotal + globalDiscount;
  const total = Math.max(0, subtotal - discountAmount);

  const assignedPayments = payments.reduce(
    (acc, p) => acc + parseMaskedMoney(p.amount),
    0,
  );
  const remaining = total - assignedPayments;

  /**
   * Whether all mandatory fields are filled to enable the "Emit" button:
   *   1. A client is selected from the directory OR marked as occasional.
   *   2. At least one service line with serviceId + valid unit price.
   *   3. At least one payment with method + valid positive amount.
   */
  const hasClientData = (() => {
    if (clientSelection?.type === "client") {
      return clientDisplayName.trim().length > 0;
    }
    if (clientSelection?.type === "occasional") {
      return true;
    }
    return false;
  })();
  const hasServiceLine = lines.some((l) => {
    const price = parseMaskedMoney(l.unitPrice);
    return l.serviceId.trim() !== "" && Number.isFinite(price) && price > 0;
  });
  const hasPayment = payments.some((p) => {
    const amount = parseMaskedMoney(p.amount);
    return p.method.trim() !== "" && Number.isFinite(amount) && amount > 0;
  });
  const canSubmit = hasClientData && hasServiceLine && hasPayment;

  function addLine() {
    setLines((prev) => [
      ...prev,
      {
        serviceId: "",
        description: "",
        quantity: "1",
        unitPrice: "",
        pickedService: null,
        discountEnabled: false,
        discountType: "PERCENT",
        discountValue: "",
      },
    ]);
  }

  function removeLine(idx: number) {
    setLines((prev) => prev.filter((_, i) => i !== idx));
    setLineErrors((prev) => {
      const next = { ...prev };
      delete next[idx];
      return next;
    });
  }

  function handleLineServiceChange(idx: number, service: SalonServiceOption | null) {
    setLines((prev) =>
      prev.map((l, i) => {
        if (i !== idx) return l;
        if (service) {
          const priceMasked = maskMoneyInput(String(Number(service.priceMinor) || 0));
          return {
            ...l,
            pickedService: service,
            serviceId: String(service.id),
            description: service.name,
            unitPrice: priceMasked,
          };
        }
        return {
          ...l,
          pickedService: null,
          serviceId: "",
        };
      }),
    );
    if (lineErrors[idx]) {
      setLineErrors((prev) => {
        const next = { ...prev };
        const fieldErrs = { ...next[idx] };
        delete fieldErrs.service;
        delete fieldErrs.unitPrice;
        if (Object.keys(fieldErrs).length === 0) delete next[idx];
        else next[idx] = fieldErrs;
        return next;
      });
    }
  }

  function updateLine(
    idx: number,
    field: "serviceId" | "quantity" | "unitPrice" | "discountValue",
    value: string,
  ) {
    setLines((prev) =>
      prev.map((l, i) => {
        if (i !== idx) return l;
        let next = value;
        if (field === "unitPrice" || (field === "discountValue" && l.discountType === "FIXED")) {
          next = maskMoneyInput(value);
        }
        return { ...l, [field]: next };
      }),
    );
    if (lineErrors[idx]?.[field]) {
      setLineErrors((prev) => {
        const next = { ...prev };
        if (next[idx]) {
          const fieldErrs = { ...next[idx] };
          delete fieldErrs[field];
          next[idx] = fieldErrs;
        }
        return next;
      });
    }
  }

  function toggleLineDiscount(idx: number) {
    setLines((prev) =>
      prev.map((l, i) =>
        i === idx ? { ...l, discountEnabled: !l.discountEnabled, discountValue: "" } : l,
      ),
    );
  }

  function setLineDiscountType(idx: number, type: "FIXED" | "PERCENT") {
    setLines((prev) =>
      prev.map((l, i) => (i === idx ? { ...l, discountType: type, discountValue: "" } : l)),
    );
  }

  function addPayment() {
    setPayments((prev) => [...prev, { method: "CASH", amount: "" }]);
  }

  function removePayment(idx: number) {
    setPayments((prev) => prev.filter((_, i) => i !== idx));
    setPaymentErrors((prev) => {
      const next = { ...prev };
      delete next[idx];
      return next;
    });
  }

  function updatePayment(idx: number, field: keyof PaymentForm, value: string) {
    const next = field === "amount" ? maskMoneyInput(value) : value;
    setPayments((prev) =>
      prev.map((p, i) => (i === idx ? { ...p, [field]: next } : p)),
    );
    if (paymentErrors[idx]) {
      setPaymentErrors((prev) => {
        const next = { ...prev };
        delete next[idx];
        return next;
      });
    }
  }

  function validate(): { ok: boolean; lineErrors: Record<number, Record<string, string>>; paymentErrors: Record<number, string>; globalErrors: string[] } {
    const newLineErrors: Record<number, Record<string, string>> = {};
    const newPaymentErrors: Record<number, string> = {};
    const errors: string[] = [];

    if (lines.length === 0) {
      errors.push(t("femme.billing.invoice.linesRequired"));
    }

    lines.forEach((l, i) => {
      const fieldErrs: Record<string, string> = {};
      if (!l.serviceId.trim()) {
        fieldErrs.service = t("femme.billing.invoice.lineServiceRequired");
      }
      const price = parseMaskedMoney(l.unitPrice);
      if (!Number.isFinite(price) || price < 0 || l.unitPrice.trim() === "") {
        fieldErrs.unitPrice = t("femme.billing.invoice.lineUnitPriceInvalid");
      }
      // AC4: per-item discount validations.
      if (l.discountEnabled && l.discountValue.trim() !== "") {
        const dv =
          l.discountType === "FIXED"
            ? parseMaskedMoney(l.discountValue)
            : parseFloat(l.discountValue.replace(",", ".")) || 0;
        if (l.discountType === "PERCENT" && dv > 100) {
          fieldErrs.discountValue = t("femme.billing.invoice.discountPercentTooHigh");
        } else if (l.discountType === "FIXED" && dv > lineGross(l)) {
          fieldErrs.discountValue = t("femme.billing.invoice.discountAmountTooHighLine");
        }
      }
      if (Object.keys(fieldErrs).length > 0) {
        newLineErrors[i] = fieldErrs;
      }
    });

    // AC4: global discount validations.
    let newDiscountValueError: string | null = null;
    if (discountType !== "NONE" && discountValue.trim() !== "") {
      const dv =
        discountType === "FIXED"
          ? parseMaskedMoney(discountValue)
          : parseFloat(discountValue.replace(",", ".")) || 0;
      if (discountType === "PERCENT" && dv > 100) {
        newDiscountValueError = t("femme.billing.invoice.discountPercentTooHigh");
      } else if (discountType === "FIXED" && dv > netSubtotal) {
        newDiscountValueError = t("femme.billing.invoice.discountAmountTooHighTotal");
      }
    }
    setDiscountValueError(newDiscountValueError);

    if (payments.length === 0) {
      errors.push(t("femme.billing.invoice.paymentsRequired"));
    }

    payments.forEach((p, i) => {
      const amount = parseMaskedMoney(p.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        newPaymentErrors[i] = t("femme.billing.invoice.paymentAmountInvalid");
      }
    });

    if (clientSelection?.type === "client") {
      if (!clientDisplayName.trim()) {
        errors.push(t("femme.billing.invoice.clientDisplayNameRequired"));
      }
      const rucTrim = clientRucOverride.trim();
      if (rucTrim && !validateRuc(rucTrim)) {
        errors.push(t("femme.clients.rucInvalid"));
      }
    }

    setLineErrors(newLineErrors);
    setPaymentErrors(newPaymentErrors);
    setGlobalErrors(errors);

    const ok =
      Object.keys(newLineErrors).length === 0 &&
      Object.keys(newPaymentErrors).length === 0 &&
      newDiscountValueError === null &&
      errors.length === 0;
    return { ok, lineErrors: newLineErrors, paymentErrors: newPaymentErrors, globalErrors: errors };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    setSuccessInvoiceNumber(null);

    const validationResult = validate();
    if (!validationResult.ok) {
      // Build an ordered list of candidate field IDs and focus the first with an error
      const firstErrorId = (() => {
        if (clientSelection?.type === "client") {
          if (!clientDisplayName.trim()) return "client-display-name";
          if (clientRucOverride.trim() && !validateRuc(clientRucOverride.trim())) return "client-ruc";
        }
        for (let i = 0; i < lines.length; i++) {
          if (validationResult.lineErrors[i]?.service) return `billing-line-svc-${i}`;
          if (validationResult.lineErrors[i]?.unitPrice) return `line-price-${i}`;
          if (validationResult.lineErrors[i]?.discountValue) return `line-disc-val-${i}`;
        }
        for (let i = 0; i < payments.length; i++) {
          if (validationResult.paymentErrors[i]) return `pay-amount-${i}`;
        }
        return null;
      })();
      if (firstErrorId) {
        // Use setTimeout to allow React to commit the state update before we focus
        setTimeout(() => {
          const el = document.getElementById(firstErrorId);
          if (el) {
            el.scrollIntoView({ behavior: "smooth", block: "center" });
            el.focus();
          }
        }, 0);
      }
      return;
    }

    const payload = {
      clientId: clientSelection?.type === "client" ? clientSelection.client.id : null,
      clientDisplayName: clientDisplayName.trim() || null,
      clientRucOverride: clientRucOverride.trim() || null,
      discountType: discountType !== "NONE" ? discountType : null,
      discountValue:
        discountType !== "NONE" && discountValue
          ? discountType === "FIXED"
            ? parseMaskedMoney(discountValue)
            : parseFloat(discountValue)
          : null,
      lines: lines.map((l) => ({
        serviceId: l.serviceId ? parseInt(l.serviceId) : null,
        description: (l.pickedService?.name ?? l.description).trim(),
        quantity: parseInt(l.quantity) || 1,
        unitPrice: parseMaskedMoney(l.unitPrice),
        discountType: l.discountEnabled && l.discountValue ? l.discountType : null,
        discountValue:
          l.discountEnabled && l.discountValue
            ? l.discountType === "FIXED"
              ? parseMaskedMoney(l.discountValue)
              : parseFloat(l.discountValue.replace(",", "."))
            : null,
      })),
      payments: payments.map((p) => ({
        method: p.method,
        amount: parseMaskedMoney(p.amount),
      })),
    };

    setSubmitting(true);
    try {
      const result = await femmePostJson<{ id: number; invoiceNumberFormatted: string }>(
        "/api/invoices",
        payload,
      );
      setSuccessInvoiceNumber(result.invoiceNumberFormatted);
      setLastInvoiceId(result.id);
      window.scrollTo({ top: 0, behavior: "smooth" });
      // Reset form
      setClientSelection(null);
      setClientSearchKey((k) => k + 1);
      setLinesKey((k) => k + 1);
      setClientDisplayName("");
      setClientRucOverride("");
      setDiscountType("NONE");
      setDiscountValue("");
      setDiscountValueError(null);
      setLines([
        {
          serviceId: "",
          description: "",
          quantity: "1",
          unitPrice: "",
          pickedService: null,
          discountEnabled: false,
          discountType: "PERCENT",
          discountValue: "",
        },
      ]);
      setPayments([{ method: "CASH", amount: "" }]);
      setLineErrors({});
      setPaymentErrors({});
      setGlobalErrors([]);
      onIssued();
    } catch (err) {
      setSubmitError(translateApiError(err, t, "femme.apiErrors.GENERIC"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDownloadLastPdf() {
    if (!lastInvoiceId) return;
    setPdfError(null);
    try {
      await downloadInvoicePdf(lastInvoiceId);
    } catch (err) {
      setPdfError(translateApiError(err, t, "femme.apiErrors.GENERIC"));
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Heading as="h2" className="text-lg">
        {t("femme.billing.invoice.title")}
      </Heading>

      {globalErrors.map((err, i) => (
        <Alert key={i} variant="destructive" title={t("femme.billing.errorTitle")}>
          {err}
        </Alert>
      ))}
      {submitError && (
        <Alert variant="destructive" title={t("femme.billing.errorTitle")}>
          {submitError}
        </Alert>
      )}
      {pdfError && (
        <Alert variant="destructive" title={t("femme.billing.errorTitle")}>
          {pdfError}
        </Alert>
      )}
      {successInvoiceNumber && (
        <Alert
          variant="success"
          title={t("femme.billing.invoice.successTitle")}
        >
          <div className="flex flex-col gap-2">
            <span>
              {t("femme.billing.invoice.successBody", {
                number: successInvoiceNumber,
              })}
            </span>
            {lastInvoiceId && (
              <Button
                variant="outline"
                size="sm"
                className="w-fit"
                onClick={handleDownloadLastPdf}
              >
                {t("femme.billing.invoice.downloadPdf")}
              </Button>
            )}
          </div>
        </Alert>
      )}
      {!rucValidForInvoicing && <FiscalRucWarning />}

      <form onSubmit={(e) => void handleSubmit(e)} noValidate className="flex flex-col gap-6">
        {/* Client section */}
        <Card className="p-4 sm:p-6 flex flex-col gap-4">
          <Heading as="h3" className="text-base">
            {t("femme.billing.invoice.clientSection")}
          </Heading>
          <ClientSearchField
            key={clientSearchKey}
            id="billing-client-search"
            value={clientSelection}
            onChange={handleClientSelectionChange}
            onCreateNew={(q) =>
              navigate("/app/clients", {
                state: {
                  openCreateClient: true,
                  prefilledName: q,
                  returnTo: "/app/billing",
                  returnTab: "invoice",
                },
              })
            }
            label={t("femme.billing.invoice.clientSearchLabel")}
            placeholder={t("femme.billing.invoice.clientPlaceholder")}
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="client-display-name">
                {t("femme.billing.invoice.clientDisplayName")}
              </Label>
              <Input
                id="client-display-name"
                value={clientDisplayName}
                onChange={(e) => setClientDisplayName(e.target.value)}
                placeholder={t("femme.billing.invoice.clientDisplayNamePlaceholder")}
                className="mt-1 w-full"
              />
            </div>
            <div>
              <Label htmlFor="client-ruc">{t("femme.billing.invoice.clientRucOverride")}</Label>
              <Input
                id="client-ruc"
                value={clientRucOverride}
                onChange={(e) => setClientRucOverride(e.target.value)}
                placeholder={t("femme.billing.invoice.clientRucOverridePlaceholder")}
                className="mt-1 w-full"
              />
            </div>
          </div>
        </Card>

        {/* Lines section */}
        <Card className="p-4 sm:p-6 flex flex-col gap-4">
          <Heading as="h3" className="text-base">
            {t("femme.billing.invoice.linesSection")}
          </Heading>
          <div className="flex flex-col gap-3">
            {lines.map((line, idx) => (
              <div
                key={`${linesKey}-${idx}`}
                className="grid grid-cols-12 gap-2 items-start border border-[rgb(var(--color-border))] rounded p-3"
              >
                <div className="col-span-12 sm:col-span-5">
                  <ServiceSearchField
                    id={`billing-line-svc-${idx}`}
                    value={line.pickedService}
                    onChange={(svc) => handleLineServiceChange(idx, svc)}
                    label={t("femme.billing.invoice.lineServiceLabel")}
                    placeholder={t("femme.billing.invoice.lineServicePlaceholder")}
                    invalid={!!lineErrors[idx]?.service}
                    errorDescribedById={`line-svc-err-${idx}`}
                  />
                  <FieldValidationError id={`line-svc-err-${idx}`}>
                    {lineErrors[idx]?.service}
                  </FieldValidationError>
                </div>
                <div className="col-span-4 sm:col-span-2">
                  <Label htmlFor={`line-qty-${idx}`}>
                    {t("femme.billing.invoice.lineQuantity")}
                  </Label>
                  <Input
                    id={`line-qty-${idx}`}
                    type="number"
                    min="1"
                    value={line.quantity}
                    onChange={(e) => updateLine(idx, "quantity", e.target.value)}
                    className="mt-1 w-full"
                  />
                </div>
                <div className="col-span-5 sm:col-span-3">
                  <Label htmlFor={`line-price-${idx}`}>
                    {t("femme.billing.invoice.lineUnitPrice")}
                  </Label>
                  <Input
                    id={`line-price-${idx}`}
                    inputMode="numeric"
                    value={line.unitPrice}
                    onChange={(e) => updateLine(idx, "unitPrice", e.target.value)}
                    placeholder={t("femme.billing.invoice.lineUnitPricePlaceholder")}
                    className="mt-1 w-full"
                    aria-invalid={!!lineErrors[idx]?.unitPrice}
                    aria-describedby={
                      lineErrors[idx]?.unitPrice ? `line-price-err-${idx}` : undefined
                    }
                  />
                  <FieldValidationError id={`line-disc-amt-err-${idx}`}>
                    {lineErrors[idx]?.discountValue}
                  </FieldValidationError>
                  <FieldValidationError id={`line-price-err-${idx}`}>
                    {lineErrors[idx]?.unitPrice}
                  </FieldValidationError>
                  {/* AC2: read-only item total with discount applied, shown only
                      when this item has an active discount, highlighted in green. */}
                  {line.discountEnabled && line.discountValue && (
                    <p
                      data-testid={`line-discounted-total-${idx}`}
                      className="mt-1 text-sm font-medium tabular-nums text-emerald-600 dark:text-emerald-400"
                    >
                      {t("femme.billing.invoice.lineDiscountedTotal")}:{" "}
                      {formatDecimalGs(Math.max(0, lineGross(line) - lineDiscountAmount(line)))}
                    </p>
                  )}
                </div>
                <div className="col-span-9 sm:col-span-1 flex min-h-9 w-full items-end justify-center">
                  <span className="w-full text-center text-sm font-medium tabular-nums text-slate-900 dark:text-slate-100">
                    {formatDecimalGs(Math.max(0, lineGross(line) - lineDiscountAmount(line)))}
                  </span>
                </div>
                <div className="col-span-3 sm:col-span-1 flex items-end justify-end">
                  {lines.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeLine(idx)}
                      aria-label={t("femme.billing.invoice.removeLine")}
                    >
                      ×
                    </Button>
                  )}
                </div>
                {/* Per-line discount row */}
                <div className="col-span-12 flex flex-wrap items-center gap-3">
                  <label className="flex cursor-pointer items-center gap-1.5 text-xs text-[rgb(var(--color-ink-2))]">
                    <input
                      type="checkbox"
                      checked={line.discountEnabled}
                      onChange={() => toggleLineDiscount(idx)}
                      id={`line-disc-toggle-${idx}`}
                    />
                    {t("femme.billing.invoice.lineDiscountToggle")}
                  </label>
                  {line.discountEnabled && (
                    <>
                      <select
                        value={line.discountType}
                        onChange={(e) => setLineDiscountType(idx, e.target.value as "FIXED" | "PERCENT")}
                        aria-label={t("femme.billing.invoice.lineDiscountType")}
                        className="rounded border border-[rgb(var(--color-border))] bg-[rgb(var(--color-white))] px-2 py-1 text-xs"
                      >
                        <option value="PERCENT">{t("femme.billing.invoice.discountTypePercent")}</option>
                        <option value="FIXED">{t("femme.billing.invoice.discountTypeFixed")}</option>
                      </select>
                      <Input
                        id={`line-disc-val-${idx}`}
                        inputMode={line.discountType === "FIXED" ? "numeric" : "decimal"}
                        value={line.discountValue}
                        onChange={(e) => updateLine(idx, "discountValue", e.target.value)}
                        placeholder="0"
                        aria-label={t("femme.billing.invoice.lineDiscountValue")}
                        aria-invalid={!!lineErrors[idx]?.discountValue}
                        aria-describedby={
                          lineErrors[idx]?.discountValue ? `line-disc-amt-err-${idx}` : undefined
                        }
                        className="w-24"
                      />
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="w-fit"
            onClick={addLine}
          >
            {t("femme.billing.invoice.addLine")}
          </Button>
        </Card>

        {/* Discount section */}
        <Card className="p-4 sm:p-6 flex flex-col gap-4">
          <Heading as="h3" className="text-base">
            {t("femme.billing.invoice.discountSection")}
          </Heading>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="discount-type">{t("femme.billing.invoice.discountType")}</Label>
              <Select
                id="discount-type"
                value={discountType}
                onChange={(e) => {
                  setDiscountType(e.target.value);
                  setDiscountValue("");
                }}
                className="mt-1 w-full"
              >
                <option value="NONE">{t("femme.billing.invoice.discountTypeNone")}</option>
                <option value="FIXED">{t("femme.billing.invoice.discountTypeFixed")}</option>
                <option value="PERCENT">{t("femme.billing.invoice.discountTypePercent")}</option>
              </Select>
            </div>
            {discountType !== "NONE" && (
              <div>
                <Label htmlFor="discount-value">
                  {t("femme.billing.invoice.discountValue")}
                </Label>
                <Input
                  id="discount-value"
                  inputMode={discountType === "FIXED" ? "numeric" : "decimal"}
                  value={discountValue}
                  onChange={(e) => {
                    const raw = e.target.value;
                    setDiscountValue(discountType === "FIXED" ? maskMoneyInput(raw) : raw);
                    setDiscountValueError(null);
                  }}
                  placeholder="0"
                  className="mt-1 w-full"
                  aria-invalid={!!discountValueError}
                  aria-describedby={discountValueError ? "discount-value-err" : undefined}
                />
                <FieldValidationError id="discount-value-err">
                  {discountValueError}
                </FieldValidationError>
              </div>
            )}
          </div>
        </Card>

        {/* Payments section */}
        <Card className="p-4 sm:p-6 flex flex-col gap-4">
          <Heading as="h3" className="text-base">
            {t("femme.billing.invoice.paymentsSection")}
          </Heading>

          {/* Summary */}
          <div className="flex flex-col gap-1 text-sm">
            <div className="flex justify-between">
              <span className="text-[rgb(var(--color-muted-foreground))]">
                {t("femme.billing.invoice.subtotal")}
              </span>
              <span>{formatAmountDecimal(subtotal.toFixed(2))}</span>
            </div>
            {discountAmount > 0 && (
              <div className="flex justify-between">
                <span className="text-[rgb(var(--color-muted-foreground))]">
                  {t("femme.billing.invoice.discount")}
                </span>
                <span>-{formatAmountDecimal(discountAmount.toFixed(2))}</span>
              </div>
            )}
            <div className="flex justify-between font-semibold">
              <span>{t("femme.billing.invoice.total")}</span>
              <span>{formatAmountDecimal(total.toFixed(2))}</span>
            </div>
            <div
              className={`flex justify-between ${Math.abs(remaining) > 0.01 ? "text-red-600 dark:text-red-400" : "text-emerald-600"}`}
            >
              <span>{t("femme.billing.invoice.remaining")}</span>
              <span>{formatAmountDecimal(remaining.toFixed(2))}</span>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            {payments.map((payment, idx) => (
              <div key={idx} className="flex flex-wrap gap-2 items-start">
                <div className="flex-1 min-w-[160px]">
                  <Label htmlFor={`pay-method-${idx}`}>
                    {t("femme.billing.invoice.paymentMethod")}
                  </Label>
                  <Select
                    id={`pay-method-${idx}`}
                    value={payment.method}
                    onChange={(e) => updatePayment(idx, "method", e.target.value)}
                    className="mt-1 w-full"
                  >
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {t(`femme.billing.invoice.paymentMethod${capitalize(m)}`)}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="flex-1 min-w-[120px]">
                  <Label htmlFor={`pay-amount-${idx}`}>
                    {t("femme.billing.invoice.paymentAmount")}
                  </Label>
                  <Input
                    id={`pay-amount-${idx}`}
                    inputMode="numeric"
                    value={payment.amount}
                    onChange={(e) => updatePayment(idx, "amount", e.target.value)}
                    placeholder={t("femme.billing.invoice.paymentAmountPlaceholder")}
                    className="mt-1 w-full"
                    aria-invalid={!!paymentErrors[idx]}
                    aria-describedby={
                      paymentErrors[idx] ? `pay-amount-err-${idx}` : undefined
                    }
                  />
                  <FieldValidationError id={`pay-amount-err-${idx}`}>
                    {paymentErrors[idx]}
                  </FieldValidationError>
                </div>
                {payments.length > 1 && (
                  <div className="flex items-end pb-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removePayment(idx)}
                      aria-label={t("femme.billing.invoice.removePayment")}
                    >
                      ×
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>

          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="w-fit"
            onClick={addPayment}
          >
            {t("femme.billing.invoice.addPayment")}
          </Button>
        </Card>

        <Button
          type="submit"
          variant="primary"
          className="min-h-11 w-full sm:w-auto"
          disabled={submitting || !canSubmit}
          data-testid="billing-invoice-submit"
        >
          {submitting
            ? t("femme.billing.invoice.submitting")
            : t("femme.billing.invoice.submit")}
        </Button>
      </form>
    </div>
  );
}

// ─── CashSessionTab ────────────────────────────────────────────────────────────

function CashSessionTab({
  currentSession,
  onSessionChanged,
  onNewInvoice,
  refreshTrigger,
}: {
  currentSession: CashSession | null;
  onSessionChanged: () => void;
  onNewInvoice: () => void;
  refreshTrigger: number;
}) {
  const { t } = useTranslation();
  const dateLocale = useDateLocale();
  const [openingAmount, setOpeningAmount] = useState("");
  const [amountError, setAmountError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const [openSuccess, setOpenSuccess] = useState(false);

  // Close session state
  const [showCloseForm, setShowCloseForm] = useState(false);
  const [countedCash, setCountedCash] = useState("");
  const [countedCashError, setCountedCashError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);
  const [closeResult, setCloseResult] = useState<CashSessionCloseResponse | null>(null);

  const [todayInvoices, setTodayInvoices] = useState<InvoiceListItem[]>([]);
  const [todayLoading, setTodayLoading] = useState(false);
  const [sessionListQuery, setSessionListQuery] = useState("");
  const [hoveredRowId, setHoveredRowId] = useState<number | null>(null);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<number | null>(null);

  const loadTodayInvoices = useCallback(async () => {
    if (!currentSession) {
      setTodayInvoices([]);
      return;
    }
    setTodayLoading(true);
    try {
      const { from, to } = todayRangeIso();
      const qs = new URLSearchParams();
      qs.set("from", from);
      qs.set("to", to);
      const data = await femmeJson<InvoiceListItem[]>(`/api/invoices?${qs.toString()}`);
      setTodayInvoices(Array.isArray(data) ? data : []);
    } catch {
      setTodayInvoices([]);
    } finally {
      setTodayLoading(false);
    }
  }, [currentSession]);

  useEffect(() => {
    void loadTodayInvoices();
  }, [loadTodayInvoices, refreshTrigger, currentSession?.id]);

  const visibleTodayInvoices = useMemo(
    () =>
      filterByListQuery(todayInvoices, sessionListQuery, (inv) => [
        inv.invoiceNumberFormatted,
        inv.clientDisplayName ?? "",
        inv.servicesSummary ?? "",
        inv.paymentMethodsSummary ?? "",
        String(inv.total ?? ""),
      ]),
    [todayInvoices, sessionListQuery],
  );

  const dayTotalIssued = useMemo(() => {
    return visibleTodayInvoices
      .filter((i) => i.status === "ISSUED")
      .reduce((acc, i) => acc + (Number(i.total) || 0), 0);
  }, [visibleTodayInvoices]);

  async function handleOpenSession(e: React.FormEvent) {
    e.preventDefault();
    setOpenSuccess(false);
    setOpenError(null);
    if (moneyDigitsOnly(openingAmount) === "") {
      setAmountError(t("femme.billing.openingCashAmountInvalid"));
      return;
    }
    setAmountError(null);
    setSubmitting(true);
    try {
      await femmePostJson("/api/cash-sessions/open", {
        openingCashAmount: parseMaskedMoney(openingAmount),
      });
      setOpeningAmount("");
      setOpenSuccess(true);
      onSessionChanged();
    } catch (err) {
      setOpenError(translateApiError(err, t, "femme.billing.saveError"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCloseSession(e: React.FormEvent) {
    e.preventDefault();
    setCloseError(null);
    if (moneyDigitsOnly(countedCash) === "") {
      setCountedCashError(t("femme.billing.close.countedCashAmountInvalid"));
      return;
    }
    setCountedCashError(null);
    setClosing(true);
    try {
      const result = await femmePostJson<CashSessionCloseResponse>(
        "/api/cash-sessions/close",
        { countedCashAmount: parseMaskedMoney(countedCash) },
      );
      setCloseResult(result);
      setShowCloseForm(false);
      onSessionChanged();
    } catch (err) {
      setCloseError(translateApiError(err, t, "femme.billing.close.closeError"));
    } finally {
      setClosing(false);
    }
  }

  const diff = closeResult ? parseFloat(closeResult.cashDifference) : null;

  const primaryBtn: React.CSSProperties = {
    background: "var(--color-rose)",
    color: "var(--color-on-primary)",
    border: "none",
    borderRadius: "var(--radius-md)",
    padding: "8px 16px",
    fontSize: 12,
    fontWeight: 500,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    whiteSpace: "nowrap",
  };

  const destructiveSoft: React.CSSProperties = {
    background: "var(--color-danger-lt)",
    color: "var(--color-danger)",
    border: "none",
    borderRadius: "var(--radius-md)",
    padding: "8px 14px",
    fontSize: 12,
    fontWeight: 500,
    cursor: "pointer",
    whiteSpace: "nowrap",
  };

  const thStyle: React.CSSProperties = {
    padding: "9px 12px",
    fontSize: 10,
    fontWeight: 500,
    color: "var(--color-ink-3)",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    textAlign: "left",
    background: "var(--color-stone)",
    whiteSpace: "nowrap",
  };

  return (
    <div>
      {openError && (
        <Alert variant="destructive" title={t("femme.billing.errorTitle")}>
          {openError}
        </Alert>
      )}
      {openSuccess && (
        <Alert variant="success" title={t("femme.billing.savedTitle")}>
          {t("femme.billing.savedBody")}
        </Alert>
      )}
      {closeError && (
        <Alert variant="destructive" title={t("femme.billing.errorTitle")}>
          {closeError}
        </Alert>
      )}

      {closeResult && (
        <div
          style={{
            background: "var(--color-white)",
            borderRadius: "var(--radius-xl)",
            border: "var(--border-default)",
            padding: 16,
            marginBottom: 14,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--color-ink-3)" }}
              aria-hidden
            />
            <Heading as="h2" className="text-lg">
              {t("femme.billing.close.closedTitle")}
            </Heading>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <span>
              <span className="font-medium">{t("femme.billing.close.closedAt")}: </span>
              {fmt(closeResult.closedAt, dateLocale)}
            </span>
            <span>
              <span className="font-medium">{t("femme.billing.close.closedBy")}: </span>
              {closeResult.closedByEmail}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm max-w-sm">
            <span className="text-[rgb(var(--color-muted-foreground))]">
              {t("femme.billing.close.totalInvoiced")}
            </span>
            <span className="text-right">{formatAmountDecimal(closeResult.totalInvoiced)}</span>
            <span className="text-[rgb(var(--color-muted-foreground))]">
              {t("femme.billing.close.invoiceCount")}
            </span>
            <span className="text-right">{closeResult.invoiceCount}</span>
            <span className="text-[rgb(var(--color-muted-foreground))]">
              {t("femme.billing.close.expectedCash")}
            </span>
            <span className="text-right">{formatAmountDecimal(closeResult.expectedCashAmount)}</span>
            <span className="text-[rgb(var(--color-muted-foreground))]">
              {t("femme.billing.close.countedCash")}
            </span>
            <span className="text-right">{formatAmountDecimal(closeResult.countedCashAmount)}</span>
            <span
              className={`font-semibold ${diff !== null && diff < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600"}`}
            >
              {t("femme.billing.close.difference")}
            </span>
            <span
              className={`text-right font-semibold ${diff !== null && diff < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600"}`}
            >
              {diff !== null && diff >= 0 ? "+" : ""}
              {formatAmountDecimal(closeResult.cashDifference)}
            </span>
          </div>
          {(closeResult.paymentSummary ?? []).length > 0 && (
            <div className="mt-2">
              <Text className="font-medium text-sm mb-1">
                {t("femme.billing.close.paymentBreakdown")}
              </Text>
              <div className="flex flex-col gap-1">
                {(closeResult.paymentSummary ?? []).map((ps, i) => (
                  <div key={i} className="flex justify-between text-sm max-w-xs">
                    <span>{t(`femme.billing.invoice.paymentMethod${capitalize(ps.method)}`)}</span>
                    <span>{formatAmountDecimal(ps.total)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Estado de caja */}
      <div
        style={{
          background: "var(--color-white)",
          borderRadius: "var(--radius-xl)",
          border: "var(--border-default)",
          padding: 16,
          marginBottom: 14,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: currentSession ? "var(--color-success)" : "var(--color-ink-3)",
            }}
            aria-hidden
          />
          <span
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: currentSession ? "var(--color-success)" : "var(--color-ink-2)",
            }}
          >
            {currentSession ? t("femme.billing.sessionOpen") : t("femme.billing.sessionClosed")}
          </span>
        </div>

        {currentSession ? (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: 10,
                marginBottom: 14,
              }}
            >
              <div
                style={{
                  background: "var(--color-stone)",
                  borderRadius: "var(--radius-md)",
                  padding: "10px 12px",
                }}
              >
                <div
                  style={{
                    fontSize: 10,
                    color: "var(--color-ink-3)",
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                    marginBottom: 3,
                  }}
                >
                  {t("femme.billing.session.metricOpenedAt")}
                </div>
                <div style={{ fontSize: 13, fontWeight: 500, color: "var(--color-ink)" }}>
                  {fmt(currentSession.openedAt, dateLocale)}
                </div>
              </div>
              <div
                style={{
                  background: "var(--color-stone)",
                  borderRadius: "var(--radius-md)",
                  padding: "10px 12px",
                }}
              >
                <div
                  style={{
                    fontSize: 10,
                    color: "var(--color-ink-3)",
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                    marginBottom: 3,
                  }}
                >
                  {t("femme.billing.session.metricOpenedBy")}
                </div>
                <div style={{ fontSize: 13, fontWeight: 500, color: "var(--color-ink)" }}>
                  {currentSession.openedByEmail}
                </div>
              </div>
              <div
                style={{
                  background: "var(--color-stone)",
                  borderRadius: "var(--radius-md)",
                  padding: "10px 12px",
                }}
              >
                <div
                  style={{
                    fontSize: 10,
                    color: "var(--color-ink-3)",
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                    marginBottom: 3,
                  }}
                >
                  {t("femme.billing.session.metricOpeningAmount")}
                </div>
                <div style={{ fontSize: 13, fontWeight: 500, color: "var(--color-ink)" }}>
                  {formatGuaraniesGs(currentSession.openingCashAmount)}
                </div>
              </div>
            </div>

            {!showCloseForm && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="button" style={primaryBtn} onClick={onNewInvoice}>
                  {t("femme.billing.session.newInvoiceButton")}
                </button>
                <button type="button" style={destructiveSoft} onClick={() => setShowCloseForm(true)}>
                  {t("femme.billing.close.title")}
                </button>
              </div>
            )}
          </>
        ) : (
          !closeResult && (
            <>
              <Text variant="muted" style={{ display: "block", marginBottom: 12 }}>
                {t("femme.billing.noOpenSession")}
              </Text>
              <form
                id="billing-open-session"
                onSubmit={(e) => void handleOpenSession(e)}
                noValidate
                style={{ display: "flex", flexDirection: "column", gap: 12 }}
              >
                <div>
                  <Label htmlFor="opening-amount">{t("femme.billing.openingCashAmount")}</Label>
                  <Input
                    id="opening-amount"
                    inputMode="numeric"
                    value={openingAmount}
                    onChange={(e) => {
                      setOpeningAmount(maskMoneyInput(e.target.value));
                      setAmountError(null);
                      setOpenError(null);
                      setOpenSuccess(false);
                    }}
                    className="mt-1 w-full"
                    placeholder="0"
                    aria-invalid={!!amountError}
                    aria-describedby={amountError ? "amount-err" : "amount-hint"}
                  />
                  <FieldValidationError id="amount-err">{amountError}</FieldValidationError>
                  <Text
                    variant="small"
                    id="amount-hint"
                    className="mt-1 text-[rgb(var(--color-muted-foreground))]"
                  >
                    {t("femme.billing.openingCashAmountHint")}
                  </Text>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="submit"
                    style={primaryBtn}
                    disabled={submitting}
                  >
                    {submitting ? t("femme.billing.opening") : t("femme.billing.open")}
                  </button>
                </div>
              </form>
            </>
          )
        )}
      </div>

      {showCloseForm && currentSession && (
        <div
          style={{
            background: "var(--color-white)",
            borderRadius: "var(--radius-xl)",
            border: "var(--border-default)",
            padding: 16,
            marginBottom: 14,
          }}
        >
          <Heading as="h2" className="text-lg mb-4">
            {t("femme.billing.close.title")}
          </Heading>
          <Text variant="muted" className="mb-4">
            {t("femme.billing.close.lead")}
          </Text>
          <form onSubmit={(e) => void handleCloseSession(e)} noValidate className="flex flex-col gap-4">
            <div>
              <Label htmlFor="counted-cash">
                {t("femme.billing.close.countedCashAmount")}
              </Label>
              <Input
                id="counted-cash"
                inputMode="numeric"
                value={countedCash}
                onChange={(e) => {
                  setCountedCash(maskMoneyInput(e.target.value));
                  setCountedCashError(null);
                }}
                placeholder="0"
                className="mt-1 w-full sm:max-w-xs"
                aria-invalid={!!countedCashError}
                aria-describedby={countedCashError ? "counted-cash-err" : "counted-cash-hint"}
              />
              <FieldValidationError id="counted-cash-err">
                {countedCashError}
              </FieldValidationError>
              <Text
                variant="small"
                id="counted-cash-hint"
                className="mt-1 text-[rgb(var(--color-muted-foreground))]"
              >
                {t("femme.billing.close.countedCashAmountHint")}
              </Text>
            </div>
            <div className="flex gap-3">
              <Button
                type="submit"
                variant="primary"
                className="min-h-11"
                disabled={closing}
              >
                {closing
                  ? t("femme.billing.close.closing")
                  : t("femme.billing.close.confirmClose")}
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="min-h-11"
                onClick={() => setShowCloseForm(false)}
              >
                {t("femme.billing.history.detail.voidCancel")}
              </Button>
            </div>
          </form>
        </div>
      )}

      {currentSession && (
        <div
          style={{
            background: "var(--color-white)",
            borderRadius: "var(--radius-xl)",
            border: "var(--border-default)",
            padding: 16,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              marginBottom: 12,
              gap: 8,
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 500, color: "var(--color-ink)" }}>
              {t("femme.billing.session.todayInvoicesTitle")}
            </span>
            <span style={{ fontSize: 11, color: "var(--color-ink-3)" }}>
              {t("femme.billing.session.todayTotal", { amount: formatGuaraniesGs(dayTotalIssued) })}
            </span>
          </div>

          <div style={{ marginBottom: 12 }}>
            <ListSearchField
              id="billing-session-today-filter"
              value={sessionListQuery}
              onChange={setSessionListQuery}
              label={t("femme.listFilter.label")}
              placeholder={t("femme.listFilter.placeholder")}
            />
          </div>

          {todayLoading ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: 12 }}>
              <Spinner size="sm" />
              <Text>{t("femme.billing.session.loadingToday")}</Text>
            </div>
          ) : todayInvoices.length === 0 ? (
            <Text variant="muted">{t("femme.billing.session.emptyToday")}</Text>
          ) : visibleTodayInvoices.length === 0 ? (
            <Text variant="muted">{t("femme.listFilter.noMatches")}</Text>
          ) : (
            <div style={{ overflowX: "auto", margin: "0 -16px" }}>
              <table
                style={{
                  tableLayout: "fixed",
                  width: "100%",
                  borderCollapse: "collapse",
                  minWidth: 560,
                }}
              >
                <colgroup>
                  <col style={{ width: "13%" }} />
                  <col style={{ width: "22%" }} />
                  <col style={{ width: "18%" }} />
                  <col style={{ width: "13%" }} />
                  <col style={{ width: "12%" }} />
                  <col style={{ width: "12%" }} />
                  <col style={{ width: "10%" }} />
                </colgroup>
                <thead>
                  <tr>
                    <th style={{ ...thStyle, borderBottom: "var(--border-default)" }}>
                      {t("femme.billing.session.colInvoiceNumber")}
                    </th>
                    <th style={{ ...thStyle, borderBottom: "var(--border-default)" }}>
                      {t("femme.billing.history.colClient")}
                    </th>
                    <th style={{ ...thStyle, borderBottom: "var(--border-default)" }}>
                      {t("femme.billing.session.colServices")}
                    </th>
                    <th style={{ ...thStyle, borderBottom: "var(--border-default)" }}>
                      {t("femme.billing.history.colTotal")}
                    </th>
                    <th style={{ ...thStyle, borderBottom: "var(--border-default)" }}>
                      {t("femme.billing.session.colMethod")}
                    </th>
                    <th style={{ ...thStyle, borderBottom: "var(--border-default)" }}>
                      {t("femme.billing.history.colStatus")}
                    </th>
                    <th style={{ ...thStyle, borderBottom: "var(--border-default)" }} />
                  </tr>
                </thead>
                <tbody>
                  {visibleTodayInvoices.map((inv) => {
                    const isHov = hoveredRowId === inv.id;
                    const tdBg = isHov ? "var(--color-rose-lt)" : undefined;
                    const cell: React.CSSProperties = {
                      padding: "10px 12px",
                      fontSize: 12,
                      color: "var(--color-ink)",
                      verticalAlign: "middle",
                      borderBottom: "0.5px solid var(--color-stone)",
                      background: tdBg,
                    };
                    return (
                      <tr
                        key={inv.id}
                        onMouseEnter={() => setHoveredRowId(inv.id)}
                        onMouseLeave={() => setHoveredRowId(null)}
                      >
                        <td
                          style={{
                            ...cell,
                            fontFamily: "monospace",
                            fontSize: 11,
                            color: "var(--color-ink-2)",
                          }}
                        >
                          {inv.invoiceNumberFormatted}
                        </td>
                        <td style={cell}>{inv.clientDisplayName ?? "—"}</td>
                        <td
                          style={{
                            ...cell,
                            color: "var(--color-ink-2)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {inv.servicesSummary?.trim() ? inv.servicesSummary : "—"}
                        </td>
                        <td style={{ ...cell, fontWeight: 500 }}>{formatGuaraniesGs(inv.total)}</td>
                        <td style={{ ...cell, color: "var(--color-ink-2)", fontSize: 11 }}>
                          {paymentMethodsLabel(inv.paymentMethodsSummary, t)}
                        </td>
                        <td style={cell}>
                          <InvoiceStatusBadge status={inv.status} />
                        </td>
                        <td style={{ ...cell, textAlign: "right" }}>
                          <Button
                            variant="ghost"
                            size="sm"
                            data-testid={`billing-today-view-${inv.id}`}
                            onClick={() => setSelectedInvoiceId(inv.id)}
                          >
                            {t("femme.billing.history.viewDetail")}
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {selectedInvoiceId !== null && (
        <InvoiceDetailModal
          invoiceId={selectedInvoiceId}
          onClose={() => setSelectedInvoiceId(null)}
          onVoided={() => {
            setSelectedInvoiceId(null);
            void loadTodayInvoices();
            onSessionChanged();
          }}
        />
      )}
    </div>
  );
}

// ─── BillingPage ─────────────────────────────────────────────────────────────

export default function BillingPage() {
  const { t } = useTranslation();
  const guidedTourEnabled = useFeatureFlag("GUIDED_TOUR");
  useTour("billing", billingSteps, undefined, guidedTourEnabled);
  const location = useLocation();
  const navigate = useNavigate();
  const navState = location.state as
    | {
        activeTab?: "session" | "invoice" | "history";
        selectedClient?: InitialClientForBilling;
      }
    | null;
  const [loading, setLoading] = useState(true);
  const [currentSession, setCurrentSession] = useState<CashSession | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"session" | "invoice" | "history">(
    navState?.activeTab ?? "session",
  );
  const [invoiceListRefresh, setInvoiceListRefresh] = useState(0);
  const [pendingInitialClient, setPendingInitialClient] = useState<
    InitialClientForBilling | null
  >(navState?.selectedClient ?? null);

  useEffect(() => {
    if (navState && (navState.activeTab || navState.selectedClient)) {
      navigate(location.pathname, { replace: true, state: {} });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    registerBillingTabSwitcher(setActiveTab);
    return () => registerBillingTabSwitcher(null);
  }, []);

  const loadCurrentSession = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await femmeJson<CashSession | undefined>("/api/cash-sessions/current");
      setCurrentSession(data ?? null);
    } catch {
      setLoadError(t("femme.billing.loadError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadCurrentSession();
  }, [loadCurrentSession]);

  if (loading) {
    return (
      <div style={{ display: "flex", minHeight: "40vh", alignItems: "center", justifyContent: "center", gap: 12 }}>
        <Spinner size="lg" />
        <Text>{t("femme.billing.loading")}</Text>
      </div>
    );
  }

  const tabBase: React.CSSProperties = {
    padding: "6px 14px",
    borderRadius: "var(--radius-md)",
    fontSize: 12,
    cursor: "pointer",
    border: "var(--border-default)",
    background: "var(--color-white)",
    color: "var(--color-ink-2)",
  };

  const tabActive: React.CSSProperties = {
    ...tabBase,
    background: "var(--color-rose-lt)",
    border: "1px solid var(--color-rose-md)",
    color: "var(--color-rose-dk)",
    fontWeight: 500,
  };

  return (
    <div>
      <div
        data-tour="billing-header"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 16,
        }}
      >
        <div>
          <div style={{ fontSize: 15, fontWeight: 500, color: "var(--color-ink)" }}>
            {t("femme.billing.title")}
          </div>
          <div style={{ fontSize: 11, color: "var(--color-ink-3)", marginTop: 2 }}>
            {t("femme.billing.pageSubtitle")}
          </div>
        </div>
      </div>

      {loadError && (
        <Alert variant="destructive" title={t("femme.billing.errorTitle")}>
          {loadError}
        </Alert>
      )}

      <div data-tour="billing-session" style={{ display: "flex", gap: 4, marginBottom: 14 }} role="tablist" aria-label={t("femme.billing.title")}>
        {(["session", "invoice", "history"] as const).map((tabKey) => {
          const disabled = tabKey === "invoice" && !currentSession;
          if (disabled) {
            return (
              <button
                key={tabKey}
                data-tour={tabKey === "invoice" ? "billing-new-invoice" : undefined}
                type="button"
                role="tab"
                aria-selected={false}
                disabled
                style={{
                  ...tabBase,
                  opacity: 0.45,
                  cursor: "not-allowed",
                }}
              >
                {t(`femme.billing.tabs.${tabKey}`)}
              </button>
            );
          }
          return (
            <button
              key={tabKey}
              data-tour={tabKey === "invoice" ? "billing-new-invoice" : undefined}
              type="button"
              role="tab"
              aria-selected={activeTab === tabKey}
              style={activeTab === tabKey ? tabActive : tabBase}
              onClick={() => setActiveTab(tabKey)}
            >
              {t(`femme.billing.tabs.${tabKey}`)}
            </button>
          );
        })}
      </div>

      <div hidden={activeTab !== "session"}>
        <CashSessionTab
          currentSession={currentSession}
          onSessionChanged={() => void loadCurrentSession()}
          onNewInvoice={() => setActiveTab("invoice")}
          refreshTrigger={invoiceListRefresh}
        />
      </div>

      <div hidden={activeTab !== "invoice"}>
        {currentSession ? (
          <NewInvoiceTab
            onIssued={() => {
              setInvoiceListRefresh((k) => k + 1);
            }}
            initialClient={pendingInitialClient}
            onInitialClientConsumed={() => setPendingInitialClient(null)}
          />
        ) : (
          <Text variant="muted">{t("femme.billing.noOpenSession")}</Text>
        )}
      </div>

      <div hidden={activeTab !== "history"}>
        <InvoiceHistoryTab />
      </div>
    </div>
  );
}
