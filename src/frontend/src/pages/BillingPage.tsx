import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Badge,
  Button,
  Card,
  Heading,
  Input,
  Label,
  Modal,
  Select,
  Spinner,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Text,
  Textarea,
} from "@design-system";
import { apiBaseUrl } from "../api/baseUrl";
import { authHeaders } from "../api/authHeaders";
import { femmeJson, femmePostJson } from "../api/femmeClient";
import { translateApiError } from "../api/parseApiErrorMessage";
import { FieldValidationError } from "../components/FieldValidationError";

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
};

type InvoiceLine = {
  id: number;
  serviceId: number | null;
  description: string;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
};

type InvoicePayment = {
  method: string;
  amount: string;
};

type InvoiceDetail = {
  id: number;
  invoiceNumber: number;
  invoiceNumberFormatted: string;
  fiscalStampNumber: string;
  clientId: number | null;
  clientDisplayName: string;
  clientRucOverride: string | null;
  status: string;
  subtotal: string;
  discountType: string;
  discountValue: string | null;
  total: string;
  issuedAt: string;
  cashSessionId: number;
  voidReason: string | null;
  lines: InvoiceLine[];
  payments: InvoicePayment[];
};

type InvoiceLineForm = {
  serviceId: string;
  description: string;
  quantity: string;
  unitPrice: string;
};

type PaymentForm = {
  method: string;
  amount: string;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(isoString: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(isoString));
  } catch {
    return isoString;
  }
}

function fmtDate(isoString: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "short" }).format(
      new Date(isoString),
    );
  } catch {
    return isoString;
  }
}

function fmtNum(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "0";
  const n = Number(v);
  return isNaN(n) ? String(v) : n.toLocaleString();
}

const PAYMENT_METHODS = [
  "CASH",
  "DEBIT_CARD",
  "CREDIT_CARD",
  "TRANSFER",
  "OTHER",
] as const;

// ─── InvoiceDetailModal ────────────────────────────────────────────────────────

function InvoiceDetailModal({
  invoiceId,
  onClose,
  onVoided,
}: {
  invoiceId: number;
  onClose: () => void;
  onVoided: () => void;
}) {
  const { t } = useTranslation();
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showVoidForm, setShowVoidForm] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [voidReasonError, setVoidReasonError] = useState<string | null>(null);
  const [voiding, setVoiding] = useState(false);
  const [voidError, setVoidError] = useState<string | null>(null);
  const [voidSuccess, setVoidSuccess] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    femmeJson<InvoiceDetail>(`/api/invoices/${invoiceId}`)
      .then((data) => {
        if (!cancelled) setInvoice(data);
      })
      .catch(() => {
        if (!cancelled) setLoadError(t("femme.billing.history.detail.loadError"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [invoiceId, t]);

  function handleDownloadPdf() {
    const url = `${apiBaseUrl()}/api/invoices/${invoiceId}/pdf`;
    const a = document.createElement("a");
    a.href = url;
    a.download = `invoice-${invoiceId}.pdf`;
    const headers = authHeaders({ json: false });
    fetch(url, { headers })
      .then((r) => r.blob())
      .then((blob) => {
        const blobUrl = URL.createObjectURL(blob);
        a.href = blobUrl;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(blobUrl);
      })
      .catch(() => {});
  }

  async function handleVoid(e: React.FormEvent) {
    e.preventDefault();
    setVoidError(null);
    if (!voidReason.trim()) {
      setVoidReasonError(t("femme.billing.history.detail.voidReasonRequired"));
      return;
    }
    setVoidReasonError(null);
    setVoiding(true);
    try {
      await femmePostJson(`/api/invoices/${invoiceId}/void`, {
        voidReason: voidReason.trim(),
      });
      setVoidSuccess(true);
      setShowVoidForm(false);
      onVoided();
    } catch (err) {
      setVoidError(translateApiError(err, t, "femme.apiErrors.GENERIC"));
    } finally {
      setVoiding(false);
    }
  }

  function discountLabel(type: string, value: string | null): string {
    if (!type || type === "NONE") return "";
    if (type === "PERCENT") return `${fmtNum(value)}%`;
    return fmtNum(value);
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={
        invoice
          ? t("femme.billing.history.detail.title", {
              number: invoice.invoiceNumberFormatted,
            })
          : t("femme.billing.history.detail.loading")
      }
    >
      <div className="flex flex-col gap-4">
        {loading && (
          <div className="flex items-center gap-2">
            <Spinner size="sm" />
            <Text>{t("femme.billing.history.detail.loading")}</Text>
          </div>
        )}
        {loadError && (
          <Alert variant="destructive" title={t("femme.billing.errorTitle")}>
            {loadError}
          </Alert>
        )}
        {voidError && (
          <Alert variant="destructive" title={t("femme.billing.errorTitle")}>
            {voidError}
          </Alert>
        )}
        {voidSuccess && (
          <Alert variant="success" title={t("femme.billing.history.detail.voidSuccess")}>
            {t("femme.billing.history.detail.voidSuccess")}
          </Alert>
        )}
        {invoice && (
          <>
            {/* Status badge */}
            <div className="flex items-center gap-3 flex-wrap">
              <Badge
                variant={invoice.status === "ISSUED" ? "success" : "destructive"}
              >
                {invoice.status === "ISSUED"
                  ? t("femme.billing.history.statusIssued")
                  : t("femme.billing.history.statusVoided")}
              </Badge>
              {invoice.status === "VOIDED" && invoice.voidReason && (
                <Text variant="small" className="text-[rgb(var(--color-muted-foreground))]">
                  {t("femme.billing.history.detail.voidReason2")}: {invoice.voidReason}
                </Text>
              )}
            </div>

            {/* Meta */}
            <div className="grid grid-cols-1 gap-1 sm:grid-cols-2 text-sm">
              <div>
                <span className="font-medium">{t("femme.billing.history.detail.fiscalStamp")}: </span>
                {invoice.fiscalStampNumber}
              </div>
              <div>
                <span className="font-medium">{t("femme.billing.history.detail.issuedAt")}: </span>
                {fmt(invoice.issuedAt)}
              </div>
              <div>
                <span className="font-medium">{t("femme.billing.history.detail.client")}: </span>
                {invoice.clientDisplayName ?? "—"}
              </div>
              {invoice.clientRucOverride && (
                <div>
                  <span className="font-medium">{t("femme.billing.history.detail.clientRuc")}: </span>
                  {invoice.clientRucOverride}
                </div>
              )}
            </div>

            {/* Lines */}
            <div>
              <Text className="font-medium mb-2">{t("femme.billing.history.detail.items")}</Text>
              <div className="overflow-x-auto rounded border border-[rgb(var(--color-border))]">
                <table className="min-w-full text-sm">
                  <thead className="bg-[rgb(var(--color-muted))]">
                    <tr>
                      <th className="px-3 py-2 text-left">{t("femme.billing.history.detail.colDescription")}</th>
                      <th className="px-3 py-2 text-right">{t("femme.billing.history.detail.colQty")}</th>
                      <th className="px-3 py-2 text-right">{t("femme.billing.history.detail.colUnitPrice")}</th>
                      <th className="px-3 py-2 text-right">{t("femme.billing.history.detail.colLineTotal")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoice.lines.map((l) => (
                      <tr key={l.id} className="border-t border-[rgb(var(--color-border))]">
                        <td className="px-3 py-2">{l.description}</td>
                        <td className="px-3 py-2 text-right">{l.quantity}</td>
                        <td className="px-3 py-2 text-right">{fmtNum(l.unitPrice)}</td>
                        <td className="px-3 py-2 text-right">{fmtNum(l.lineTotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Totals */}
            <div className="flex flex-col items-end gap-1 text-sm">
              <div className="flex gap-8">
                <span className="text-[rgb(var(--color-muted-foreground))]">{t("femme.billing.history.detail.subtotal")}</span>
                <span>{fmtNum(invoice.subtotal)}</span>
              </div>
              {invoice.discountType !== "NONE" && (
                <div className="flex gap-8">
                  <span className="text-[rgb(var(--color-muted-foreground))]">{t("femme.billing.history.detail.discount")}</span>
                  <span>{discountLabel(invoice.discountType, invoice.discountValue)}</span>
                </div>
              )}
              <div className="flex gap-8 font-semibold">
                <span>{t("femme.billing.history.detail.total")}</span>
                <span>{fmtNum(invoice.total)}</span>
              </div>
            </div>

            {/* Payments */}
            <div>
              <Text className="font-medium mb-1">{t("femme.billing.history.detail.payments")}</Text>
              <div className="flex flex-col gap-1">
                {invoice.payments.map((p, i) => (
                  <div key={i} className="flex justify-between text-sm">
                    <span>{t(`femme.billing.invoice.paymentMethod${capitalize(p.method)}`)}</span>
                    <span>{fmtNum(p.amount)}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-wrap gap-3 pt-2">
              {invoice.status === "ISSUED" && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleDownloadPdf()}
                >
                  {t("femme.billing.history.detail.downloadPdf")}
                </Button>
              )}
              {invoice.status === "ISSUED" && !showVoidForm && (
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => setShowVoidForm(true)}
                >
                  {t("femme.billing.history.detail.voidButton")}
                </Button>
              )}
              <Button variant="secondary" size="sm" onClick={onClose}>
                {t("femme.billing.history.detail.close")}
              </Button>
            </div>

            {/* Void form */}
            {showVoidForm && invoice.status === "ISSUED" && (
              <form
                className="border-t border-[rgb(var(--color-border))] pt-4 flex flex-col gap-3"
                onSubmit={(e) => void handleVoid(e)}
                noValidate
              >
                <Heading as="h3" className="text-base">
                  {t("femme.billing.history.detail.voidTitle")}
                </Heading>
                <div>
                  <Label htmlFor="void-reason">{t("femme.billing.history.detail.voidReason")}</Label>
                  <Textarea
                    id="void-reason"
                    value={voidReason}
                    onChange={(e) => {
                      setVoidReason(e.target.value);
                      setVoidReasonError(null);
                    }}
                    placeholder={t("femme.billing.history.detail.voidReasonPlaceholder")}
                    rows={2}
                    aria-invalid={!!voidReasonError}
                    aria-describedby={voidReasonError ? "void-reason-err" : undefined}
                    className="mt-1 w-full"
                  />
                  <FieldValidationError id="void-reason-err">{voidReasonError}</FieldValidationError>
                </div>
                <div className="flex gap-2">
                  <Button type="submit" variant="danger" size="sm" disabled={voiding}>
                    {voiding
                      ? t("femme.billing.history.detail.voiding")
                      : t("femme.billing.history.detail.voidConfirm")}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => setShowVoidForm(false)}
                  >
                    {t("femme.billing.history.detail.voidCancel")}
                  </Button>
                </div>
              </form>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

function capitalize(s: string): string {
  return s
    .split("_")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join("");
}

// ─── InvoiceHistoryTab ────────────────────────────────────────────────────────

function InvoiceHistoryTab() {
  const { t } = useTranslation();
  const [invoices, setInvoices] = useState<InvoiceListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<number | null>(null);

  const loadInvoices = useCallback(
    async (from: string, to: string, status: string) => {
      setLoading(true);
      setLoadError(null);
      try {
        const params = new URLSearchParams();
        if (from) params.set("from", new Date(from).toISOString());
        if (to) {
          const toDate = new Date(to);
          toDate.setHours(23, 59, 59, 999);
          params.set("to", toDate.toISOString());
        }
        if (status) params.set("status", status);
        const qs = params.toString();
        const data = await femmeJson<InvoiceListItem[] | null>(
          `/api/invoices${qs ? `?${qs}` : ""}`,
        );
        setInvoices(Array.isArray(data) ? data : []);
      } catch {
        setLoadError(t("femme.billing.history.loadError"));
      } finally {
        setLoading(false);
      }
    },
    [t],
  );

  useEffect(() => {
    void loadInvoices("", "", "");
  }, [loadInvoices]);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    void loadInvoices(filterFrom, filterTo, filterStatus);
  }

  function handleClear() {
    setFilterFrom("");
    setFilterTo("");
    setFilterStatus("");
    void loadInvoices("", "", "");
  }

  return (
    <div className="flex flex-col gap-4">
      <Heading as="h2" className="text-lg">
        {t("femme.billing.history.title")}
      </Heading>

      {/* Filters */}
      <form
        onSubmit={handleSearch}
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
        <Button type="submit" variant="primary" size="sm">
          {t("femme.billing.history.search")}
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={handleClear}>
          {t("femme.billing.history.clearFilters")}
        </Button>
      </form>

      {loadError && (
        <Alert variant="destructive" title={t("femme.billing.errorTitle")}>
          {loadError}
        </Alert>
      )}

      {loading ? (
        <div className="flex items-center gap-2">
          <Spinner size="sm" />
          <Text>{t("femme.billing.history.loading")}</Text>
        </div>
      ) : invoices.length === 0 ? (
        <Text variant="muted">{t("femme.billing.history.empty")}</Text>
      ) : (
        <div className="overflow-x-auto rounded border border-[rgb(var(--color-border))]">
          <table className="min-w-full text-sm">
            <thead className="bg-[rgb(var(--color-muted))]">
              <tr>
                <th className="px-3 py-2 text-left">{t("femme.billing.history.colNumber")}</th>
                <th className="px-3 py-2 text-left">{t("femme.billing.history.colDate")}</th>
                <th className="px-3 py-2 text-left">{t("femme.billing.history.colClient")}</th>
                <th className="px-3 py-2 text-right">{t("femme.billing.history.colTotal")}</th>
                <th className="px-3 py-2 text-center">{t("femme.billing.history.colStatus")}</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr
                  key={inv.id}
                  className="border-t border-[rgb(var(--color-border))] hover:bg-[rgb(var(--color-muted)/0.4)]"
                >
                  <td className="px-3 py-2 font-mono">{inv.invoiceNumberFormatted}</td>
                  <td className="px-3 py-2">{fmtDate(inv.issuedAt)}</td>
                  <td className="px-3 py-2">{inv.clientDisplayName ?? "—"}</td>
                  <td className="px-3 py-2 text-right">{fmtNum(inv.total)}</td>
                  <td className="px-3 py-2 text-center">
                    <Badge variant={inv.status === "ISSUED" ? "success" : "destructive"}>
                      {inv.status === "ISSUED"
                        ? t("femme.billing.history.statusIssued")
                        : t("femme.billing.history.statusVoided")}
                    </Badge>
                  </td>
                  <td className="px-3 py-2">
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
      )}

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

function NewInvoiceTab({ onIssued }: { onIssued: () => void }) {
  const { t } = useTranslation();
  const [clientDisplayName, setClientDisplayName] = useState("");
  const [clientRucOverride, setClientRucOverride] = useState("");
  const [discountType, setDiscountType] = useState("NONE");
  const [discountValue, setDiscountValue] = useState("");
  const [lines, setLines] = useState<InvoiceLineForm[]>([
    { serviceId: "", description: "", quantity: "1", unitPrice: "" },
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

  // Computed totals
  const subtotal = lines.reduce((acc, l) => {
    const qty = parseFloat(l.quantity) || 0;
    const price = parseFloat(l.unitPrice) || 0;
    return acc + qty * price;
  }, 0);

  let discountAmount = 0;
  if (discountType === "FIXED") {
    discountAmount = Math.min(parseFloat(discountValue) || 0, subtotal);
  } else if (discountType === "PERCENT") {
    discountAmount = (subtotal * (parseFloat(discountValue) || 0)) / 100;
  }
  const total = Math.max(0, subtotal - discountAmount);

  const assignedPayments = payments.reduce(
    (acc, p) => acc + (parseFloat(p.amount) || 0),
    0,
  );
  const remaining = total - assignedPayments;

  function addLine() {
    setLines((prev) => [
      ...prev,
      { serviceId: "", description: "", quantity: "1", unitPrice: "" },
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

  function updateLine(idx: number, field: keyof InvoiceLineForm, value: string) {
    setLines((prev) =>
      prev.map((l, i) => (i === idx ? { ...l, [field]: value } : l)),
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
    setPayments((prev) =>
      prev.map((p, i) => (i === idx ? { ...p, [field]: value } : p)),
    );
    if (paymentErrors[idx]) {
      setPaymentErrors((prev) => {
        const next = { ...prev };
        delete next[idx];
        return next;
      });
    }
  }

  function validate(): boolean {
    const newLineErrors: Record<number, Record<string, string>> = {};
    const newPaymentErrors: Record<number, string> = {};
    const errors: string[] = [];

    if (lines.length === 0) {
      errors.push(t("femme.billing.invoice.linesRequired"));
    }

    lines.forEach((l, i) => {
      const fieldErrs: Record<string, string> = {};
      if (!l.description.trim()) {
        fieldErrs.description = t("femme.billing.invoice.lineDescriptionRequired");
      }
      const price = parseFloat(l.unitPrice);
      if (isNaN(price) || price < 0) {
        fieldErrs.unitPrice = t("femme.billing.invoice.lineUnitPriceInvalid");
      }
      if (Object.keys(fieldErrs).length > 0) {
        newLineErrors[i] = fieldErrs;
      }
    });

    if (payments.length === 0) {
      errors.push(t("femme.billing.invoice.paymentsRequired"));
    }

    payments.forEach((p, i) => {
      const amount = parseFloat(p.amount);
      if (isNaN(amount) || amount <= 0) {
        newPaymentErrors[i] = t("femme.billing.invoice.paymentAmountInvalid");
      }
    });

    setLineErrors(newLineErrors);
    setPaymentErrors(newPaymentErrors);
    setGlobalErrors(errors);

    return (
      Object.keys(newLineErrors).length === 0 &&
      Object.keys(newPaymentErrors).length === 0 &&
      errors.length === 0
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    setSuccessInvoiceNumber(null);

    if (!validate()) return;

    const payload = {
      clientDisplayName: clientDisplayName.trim() || null,
      clientRucOverride: clientRucOverride.trim() || null,
      discountType: discountType !== "NONE" ? discountType : null,
      discountValue:
        discountType !== "NONE" && discountValue ? parseFloat(discountValue) : null,
      lines: lines.map((l) => ({
        serviceId: l.serviceId ? parseInt(l.serviceId) : null,
        description: l.description,
        quantity: parseInt(l.quantity) || 1,
        unitPrice: parseFloat(l.unitPrice) || 0,
      })),
      payments: payments.map((p) => ({
        method: p.method,
        amount: parseFloat(p.amount),
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
      // Reset form
      setClientDisplayName("");
      setClientRucOverride("");
      setDiscountType("NONE");
      setDiscountValue("");
      setLines([{ serviceId: "", description: "", quantity: "1", unitPrice: "" }]);
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

  function handleDownloadLastPdf() {
    if (!lastInvoiceId) return;
    const url = `${apiBaseUrl()}/api/invoices/${lastInvoiceId}/pdf`;
    const headers = authHeaders({ json: false });
    fetch(url, { headers })
      .then((r) => r.blob())
      .then((blob) => {
        const a = document.createElement("a");
        const blobUrl = URL.createObjectURL(blob);
        a.href = blobUrl;
        a.download = `invoice-${lastInvoiceId}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(blobUrl);
      })
      .catch(() => {});
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

      <form onSubmit={(e) => void handleSubmit(e)} noValidate className="flex flex-col gap-6">
        {/* Client section */}
        <Card className="p-4 sm:p-6 flex flex-col gap-4">
          <Heading as="h3" className="text-base">
            {t("femme.billing.invoice.clientSection")}
          </Heading>
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
                key={idx}
                className="grid grid-cols-12 gap-2 items-start border border-[rgb(var(--color-border))] rounded p-3"
              >
                <div className="col-span-12 sm:col-span-5">
                  <Label htmlFor={`line-desc-${idx}`}>
                    {t("femme.billing.invoice.lineDescription")}
                  </Label>
                  <Input
                    id={`line-desc-${idx}`}
                    value={line.description}
                    onChange={(e) => updateLine(idx, "description", e.target.value)}
                    placeholder={t("femme.billing.invoice.lineDescriptionPlaceholder")}
                    className="mt-1 w-full"
                    aria-invalid={!!lineErrors[idx]?.description}
                    aria-describedby={
                      lineErrors[idx]?.description ? `line-desc-err-${idx}` : undefined
                    }
                  />
                  <FieldValidationError id={`line-desc-err-${idx}`}>
                    {lineErrors[idx]?.description}
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
                    inputMode="decimal"
                    value={line.unitPrice}
                    onChange={(e) => updateLine(idx, "unitPrice", e.target.value)}
                    placeholder="0"
                    className="mt-1 w-full"
                    aria-invalid={!!lineErrors[idx]?.unitPrice}
                    aria-describedby={
                      lineErrors[idx]?.unitPrice ? `line-price-err-${idx}` : undefined
                    }
                  />
                  <FieldValidationError id={`line-price-err-${idx}`}>
                    {lineErrors[idx]?.unitPrice}
                  </FieldValidationError>
                </div>
                <div className="col-span-9 sm:col-span-1 flex items-end justify-end">
                  <Text variant="small" className="font-medium text-right">
                    {fmtNum(
                      ((parseFloat(line.quantity) || 0) *
                        (parseFloat(line.unitPrice) || 0)).toString(),
                    )}
                  </Text>
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
                  inputMode="decimal"
                  value={discountValue}
                  onChange={(e) => setDiscountValue(e.target.value)}
                  placeholder="0"
                  className="mt-1 w-full"
                />
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
              <span>{fmtNum(subtotal.toFixed(2))}</span>
            </div>
            {discountAmount > 0 && (
              <div className="flex justify-between">
                <span className="text-[rgb(var(--color-muted-foreground))]">
                  {t("femme.billing.invoice.discount")}
                </span>
                <span>-{fmtNum(discountAmount.toFixed(2))}</span>
              </div>
            )}
            <div className="flex justify-between font-semibold">
              <span>{t("femme.billing.invoice.total")}</span>
              <span>{fmtNum(total.toFixed(2))}</span>
            </div>
            <div
              className={`flex justify-between ${Math.abs(remaining) > 0.01 ? "text-red-600 dark:text-red-400" : "text-emerald-600"}`}
            >
              <span>{t("femme.billing.invoice.remaining")}</span>
              <span>{fmtNum(remaining.toFixed(2))}</span>
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
                    inputMode="decimal"
                    value={payment.amount}
                    onChange={(e) => updatePayment(idx, "amount", e.target.value)}
                    placeholder="0"
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
          disabled={submitting}
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
}: {
  currentSession: CashSession | null;
  onSessionChanged: () => void;
}) {
  const { t } = useTranslation();
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

  async function handleOpenSession(e: React.FormEvent) {
    e.preventDefault();
    setOpenSuccess(false);
    setOpenError(null);
    const trimmed = openingAmount.trim();
    if (trimmed === "" || isNaN(Number(trimmed)) || Number(trimmed) < 0) {
      setAmountError(t("femme.billing.openingCashAmountInvalid"));
      return;
    }
    setAmountError(null);
    setSubmitting(true);
    try {
      await femmePostJson("/api/cash-sessions/open", {
        openingCashAmount: Number(trimmed),
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
    const trimmed = countedCash.trim();
    if (trimmed === "" || isNaN(Number(trimmed)) || Number(trimmed) < 0) {
      setCountedCashError(t("femme.billing.close.countedCashAmountInvalid"));
      return;
    }
    setCountedCashError(null);
    setClosing(true);
    try {
      const result = await femmePostJson<CashSessionCloseResponse>(
        "/api/cash-sessions/close",
        { countedCashAmount: Number(trimmed) },
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

  return (
    <div className="flex flex-col gap-6">
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

      {/* Close result summary */}
      {closeResult && (
        <Card className="p-4 sm:p-6 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded-full bg-slate-400" aria-hidden="true" />
            <Heading as="h2" className="text-lg">
              {t("femme.billing.close.closedTitle")}
            </Heading>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <span>
              <span className="font-medium">{t("femme.billing.close.closedAt")}: </span>
              {fmt(closeResult.closedAt)}
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
            <span className="text-right">{fmtNum(closeResult.totalInvoiced)}</span>
            <span className="text-[rgb(var(--color-muted-foreground))]">
              {t("femme.billing.close.invoiceCount")}
            </span>
            <span className="text-right">{closeResult.invoiceCount}</span>
            <span className="text-[rgb(var(--color-muted-foreground))]">
              {t("femme.billing.close.expectedCash")}
            </span>
            <span className="text-right">{fmtNum(closeResult.expectedCashAmount)}</span>
            <span className="text-[rgb(var(--color-muted-foreground))]">
              {t("femme.billing.close.countedCash")}
            </span>
            <span className="text-right">{fmtNum(closeResult.countedCashAmount)}</span>
            <span className={`font-semibold ${diff !== null && diff < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600"}`}>
              {t("femme.billing.close.difference")}
            </span>
            <span className={`text-right font-semibold ${diff !== null && diff < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600"}`}>
              {diff !== null && diff >= 0 ? "+" : ""}
              {fmtNum(closeResult.cashDifference)}
            </span>
          </div>
          {closeResult.paymentSummary.length > 0 && (
            <div className="mt-2">
              <Text className="font-medium text-sm mb-1">
                {t("femme.billing.close.paymentBreakdown")}
              </Text>
              <div className="flex flex-col gap-1">
                {closeResult.paymentSummary.map((ps, i) => (
                  <div key={i} className="flex justify-between text-sm max-w-xs">
                    <span>{t(`femme.billing.invoice.paymentMethod${capitalize(ps.method)}`)}</span>
                    <span>{fmtNum(ps.total)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Current session status */}
      <Card className="p-4 sm:p-6">
        <div className="flex items-center gap-3">
          <span
            className={`inline-block h-3 w-3 rounded-full ${currentSession ? "bg-emerald-500" : "bg-slate-400"}`}
            aria-hidden="true"
          />
          <Heading as="h2" className="text-lg">
            {currentSession
              ? t("femme.billing.sessionOpen")
              : t("femme.billing.sessionClosed")}
          </Heading>
        </div>

        {currentSession ? (
          <div className="mt-4 flex flex-col gap-2">
            <div className="flex flex-wrap gap-x-6 gap-y-1">
              <Text variant="small" className="text-[rgb(var(--color-muted-foreground))]">
                <span className="font-medium text-[rgb(var(--color-foreground))]">
                  {t("femme.billing.openedAt")}:{" "}
                </span>
                {fmt(currentSession.openedAt)}
              </Text>
              <Text variant="small" className="text-[rgb(var(--color-muted-foreground))]">
                <span className="font-medium text-[rgb(var(--color-foreground))]">
                  {t("femme.billing.openedBy")}:{" "}
                </span>
                {currentSession.openedByEmail}
              </Text>
              <Text variant="small" className="text-[rgb(var(--color-muted-foreground))]">
                <span className="font-medium text-[rgb(var(--color-foreground))]">
                  {t("femme.billing.initialAmount")}:{" "}
                </span>
                {fmtNum(currentSession.openingCashAmount)}
              </Text>
            </div>
            {!showCloseForm && (
              <div className="mt-3">
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => setShowCloseForm(true)}
                >
                  {t("femme.billing.close.title")}
                </Button>
              </div>
            )}
          </div>
        ) : (
          <Text variant="muted" className="mt-3">
            {t("femme.billing.noOpenSession")}
          </Text>
        )}
      </Card>

      {/* Close session form */}
      {showCloseForm && currentSession && (
        <Card className="p-4 sm:p-6">
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
                inputMode="decimal"
                value={countedCash}
                onChange={(e) => {
                  setCountedCash(e.target.value);
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
        </Card>
      )}

      {/* Open session form (only when no open session) */}
      {!currentSession && !closeResult && (
        <Card className="p-4 sm:p-6">
          <Heading as="h2" className="text-lg">
            {t("femme.billing.openTitle")}
          </Heading>
          <form className="mt-4 flex flex-col gap-4" onSubmit={(e) => void handleOpenSession(e)} noValidate>
            <div>
              <Label htmlFor="opening-amount">{t("femme.billing.openingCashAmount")}</Label>
              <Input
                id="opening-amount"
                inputMode="decimal"
                value={openingAmount}
                onChange={(e) => {
                  setOpeningAmount(e.target.value);
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
            <Button
              type="submit"
              variant="primary"
              className="min-h-11 w-full sm:w-auto"
              disabled={submitting}
            >
              {submitting ? t("femme.billing.opening") : t("femme.billing.open")}
            </Button>
          </form>
        </Card>
      )}
    </div>
  );
}

// ─── BillingPage ─────────────────────────────────────────────────────────────

export default function BillingPage() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [currentSession, setCurrentSession] = useState<CashSession | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("session");

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
      <div className="flex min-h-[40vh] items-center justify-center gap-3">
        <Spinner size="lg" />
        <Text>{t("femme.billing.loading")}</Text>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Heading as="h1">{t("femme.billing.title")}</Heading>
        <Text variant="muted" className="mt-1">
          {t("femme.billing.lead")}
        </Text>
      </div>

      {loadError && (
        <Alert variant="destructive" title={t("femme.billing.errorTitle")}>
          {loadError}
        </Alert>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="session">{t("femme.billing.tabs.session")}</TabsTrigger>
          <TabsTrigger value="invoice" disabled={!currentSession}>
            {t("femme.billing.tabs.invoice")}
          </TabsTrigger>
          <TabsTrigger value="history">{t("femme.billing.tabs.history")}</TabsTrigger>
        </TabsList>

        <TabsContent value="session">
          <CashSessionTab
            currentSession={currentSession}
            onSessionChanged={() => void loadCurrentSession()}
          />
        </TabsContent>

        <TabsContent value="invoice">
          {currentSession ? (
            <NewInvoiceTab
              onIssued={() => {
                // Stay on invoice tab; history will refresh when user navigates there
              }}
            />
          ) : (
            <Text variant="muted">{t("femme.billing.noOpenSession")}</Text>
          )}
        </TabsContent>

        <TabsContent value="history">
          <InvoiceHistoryTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
