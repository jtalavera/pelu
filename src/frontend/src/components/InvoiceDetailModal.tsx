import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Badge,
  Button,
  Heading,
  Input,
  Modal,
  Radio,
  RadioGroup,
  Select,
  Spinner,
  Text,
  Textarea,
  Label,
} from "@design-system";
import { femmeJson, femmePostJson } from "../api/femmeClient";
import { isValidParaguayRuc } from "../util/paraguayRuc";
import { downloadInvoicePdf } from "../api/downloadInvoicePdf";
import { downloadSifenKude, sendSifenKudeByEmail } from "../api/downloadSifenKude";
import { translateApiError } from "../api/parseApiErrorMessage";
import { useFeatureFlag } from "../hooks/useFeatureFlags";
import { FieldValidationError } from "./FieldValidationError";
import { SifenStatusBadge } from "./SifenStatusBadge";
import { useDateLocale } from "../i18n/dateLocale";
import { formatAmountDecimal } from "../lib/formatMoney";
import { formatParaguayDateTime, formatParaguayTime } from "../lib/paraguayDateTime";

export type InvoiceLine = {
  id: number;
  serviceId: number | null;
  description: string;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
  discountType?: string | null;
  discountValue?: string | null;
};

export type InvoicePayment = {
  method: string;
  amount: string;
};

export type InvoiceDetail = {
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
  sifenControlNumber?: string | null;
  sifenSubmissionStatus?: string | null;
  sifenSubmissionProtocolNumber?: string | null;
  sifenSubmissionResultCode?: string | null;
  sifenSubmissionMessage?: string | null;
  sifenQueryDocumentContent?: string | null;
  /**
   * SIFEN HU-09: the exact verification URL encoded in the KuDE's QR code (HU-08's
   * `SifenQrCodeService`), persisted on the invoice at submission time. Present whenever the
   * invoice was actually signed/submitted, independent of its current status — HU-09 AC-05
   * requires this to keep working once a cancelled state exists (Fase 3, not built yet), so the
   * button below is intentionally not gated on `sifenSubmissionStatus`.
   */
  sifenVerificationUrl?: string | null;
  /** SIFEN HU-10 AC-02: present only while the invoice is actually eligible to be cancelled. */
  sifenCancellationDeadlineAt?: string | null;
  /** Issue #145: present only while eligible — the instant cancellation actually becomes allowed. */
  sifenCancellationAvailableAt?: string | null;
  /** SIFEN HU-10 AC-05: historical record of the last cancellation attempt, either outcome. */
  sifenCancellationRequestedAt?: string | null;
  sifenCancellationRequestedByEmail?: string | null;
  sifenCancellationReason?: string | null;
  sifenCancellationResultCode?: string | null;
  sifenCancellationMessage?: string | null;
  /** SIFEN HU-11 AC-01: true only while "identify client" is currently offered for this invoice. */
  sifenClientIdentificationEligible?: boolean;
  sifenClientIdentified?: boolean;
  /** AC-05/AC-06: historical record of the last client-identification attempt, either outcome. */
  sifenClientIdentificationRequestedAt?: string | null;
  sifenClientIdentificationRequestedByEmail?: string | null;
  sifenClientIdentificationClientType?: string | null;
  sifenClientIdentificationName?: string | null;
  sifenClientIdentificationRuc?: string | null;
  sifenClientIdentificationIdentityDocument?: string | null;
  sifenClientIdentificationAddress?: string | null;
  sifenClientIdentificationCountryCode?: string | null;
  sifenClientIdentificationResultCode?: string | null;
  sifenClientIdentificationMessage?: string | null;
};

/** SIFEN HU-11 AC-04: must stay in sync with the backend's SifenForeignCountry enum. */
const FOREIGN_COUNTRY_CODES = [
  "ARG",
  "BRA",
  "URY",
  "BOL",
  "CHL",
  "PER",
  "COL",
  "MEX",
  "USA",
  "CAN",
  "ESP",
  "FRA",
  "ITA",
  "DEU",
  "GBR",
  "CHN",
  "JPN",
] as const;

/** SIFEN HU-10 AC-02: splits milliseconds remaining into whole hours + minutes for the countdown. */
function remainingHoursMinutes(remainingMs: number): { hours: number; minutes: number } {
  const totalMinutes = Math.max(0, Math.floor(remainingMs / 60000));
  return { hours: Math.floor(totalMinutes / 60), minutes: totalMinutes % 60 };
}

function capitalize(s: string): string {
  if (!s) return "";
  return s
    .split("_")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join("");
}

/** Label for "Tipo Dto." column: shows "20%" for PERCENT or an i18n key resolved externally for FIXED. */
function discountTypeLabel(type: string, value: string | null): string {
  if (!type || type === "NONE") return "—";
  if (type === "PERCENT") {
    if (value == null || value === "") return "0%";
    return `${String(value).trim()}%`;
  }
  // FIXED — caller is responsible for substituting the translated "Monto fijo" text
  return "FIXED";
}

/** Monetary discount amount for "Valor Dto." column, derived from unitPrice * qty - lineTotal. */
function discountMonetaryAmount(line: {
  discountType?: string | null;
  unitPrice: string;
  quantity: number;
  lineTotal: string;
}): string | null {
  if (!line.discountType || line.discountType === "NONE") return null;
  const gross = Number(line.unitPrice) * line.quantity;
  const net = Number(line.lineTotal);
  const amount = gross - net;
  if (amount <= 0) return null;
  return String(amount);
}

/** Used for the invoice-level discount label in the totals section. */
function discountLabel(type: string, value: string | null): string {
  if (!type || type === "NONE") return "";
  if (type === "PERCENT") {
    if (value == null || value === "") return "0%";
    return `${String(value).trim()}%`;
  }
  return formatAmountDecimal(value, "0");
}

export function InvoiceDetailModal({
  invoiceId,
  onClose,
  onVoided,
  allowVoid = true,
}: {
  invoiceId: number;
  onClose: () => void;
  onVoided?: () => void;
  allowVoid?: boolean;
}) {
  const { t } = useTranslation();
  const dateLocale = useDateLocale();
  /** HU-33 AC-01/AC-03: once SIFEN is active, the traditional PDF format is retired — only the
   * KuDE download (already gated on the invoice's own Approved status further below) remains. */
  const sifenEnabled = useFeatureFlag("SIFEN_ELECTRONIC_INVOICING");
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showVoidForm, setShowVoidForm] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [voidReasonError, setVoidReasonError] = useState<string | null>(null);
  const [voiding, setVoiding] = useState(false);
  const [voidError, setVoidError] = useState<string | null>(null);
  const [voidSuccess, setVoidSuccess] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [checkingSifenStatus, setCheckingSifenStatus] = useState(false);
  const [sifenCheckError, setSifenCheckError] = useState<string | null>(null);
  const [sifenCheckMessage, setSifenCheckMessage] = useState<string | null>(null);
  const [kudeDownloading, setKudeDownloading] = useState(false);
  const [kudeError, setKudeError] = useState<string | null>(null);
  const [kudeEmail, setKudeEmail] = useState("");
  const [kudeEmailSending, setKudeEmailSending] = useState(false);
  const [kudeEmailError, setKudeEmailError] = useState<string | null>(null);
  const [kudeEmailSuccess, setKudeEmailSuccess] = useState(false);
  const [showCancelForm, setShowCancelForm] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelReasonError, setCancelReasonError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [showIdentifyForm, setShowIdentifyForm] = useState(false);
  const [identifyClientType, setIdentifyClientType] = useState<"COMPANY" | "PERSON" | "FOREIGN">(
    "PERSON",
  );
  const [identifyRuc, setIdentifyRuc] = useState("");
  const [identifyDocument, setIdentifyDocument] = useState("");
  const [identifyName, setIdentifyName] = useState("");
  const [identifyAddress, setIdentifyAddress] = useState("");
  const [identifyCountryCode, setIdentifyCountryCode] = useState("");
  const [identifyFieldErrors, setIdentifyFieldErrors] = useState<Record<string, string>>({});
  const [identifying, setIdentifying] = useState(false);
  const [identifyError, setIdentifyError] = useState<string | null>(null);

  // SIFEN HU-10 AC-02: ticks the deadline countdown without a full page refresh.
  useEffect(() => {
    const interval = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, []);

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

  async function handleDownloadPdf() {
    setPdfError(null);
    try {
      await downloadInvoicePdf(invoiceId);
    } catch (err) {
      setPdfError(translateApiError(err, t, "femme.apiErrors.GENERIC"));
    }
  }

  /** SIFEN HU-07 AC-04: manually triggers the SIFEN status query for a pending-verification invoice. */
  async function handleCheckSifenStatus() {
    setSifenCheckError(null);
    setSifenCheckMessage(null);
    setCheckingSifenStatus(true);
    try {
      const updated = await femmePostJson<InvoiceDetail>(
        `/api/invoices/${invoiceId}/sifen/check-status`,
        {},
      );
      setInvoice(updated);
      setSifenCheckMessage(
        updated.sifenSubmissionStatus === "PENDING_VERIFICATION"
          ? t("femme.billing.history.detail.sifen.checkStatusStillPending")
          : t("femme.billing.history.detail.sifen.checkStatusResolved"),
      );
    } catch (err) {
      setSifenCheckError(translateApiError(err, t, "femme.apiErrors.GENERIC"));
    } finally {
      setCheckingSifenStatus(false);
    }
  }

  /** SIFEN HU-08 AC-16: downloads the KuDE PDF for an approved invoice. */
  async function handleDownloadKude() {
    setKudeError(null);
    setKudeDownloading(true);
    try {
      await downloadSifenKude(invoiceId);
    } catch (err) {
      setKudeError(translateApiError(err, t, "femme.apiErrors.GENERIC"));
    } finally {
      setKudeDownloading(false);
    }
  }

  /** SIFEN HU-08 AC-17: emails the KuDE to the typed address, or the client's own email if blank. */
  async function handleSendKudeEmail(e: React.FormEvent) {
    e.preventDefault();
    setKudeEmailError(null);
    setKudeEmailSuccess(false);
    setKudeEmailSending(true);
    try {
      await sendSifenKudeByEmail(invoiceId, kudeEmail);
      setKudeEmailSuccess(true);
    } catch (err) {
      setKudeEmailError(translateApiError(err, t, "femme.apiErrors.GENERIC"));
    } finally {
      setKudeEmailSending(false);
    }
  }

  /** SIFEN HU-10: registers a cancellation event; SIFEN's response either way is reflected below. */
  async function handleCancelInvoice(e: React.FormEvent) {
    e.preventDefault();
    setCancelError(null);
    const trimmedReason = cancelReason.trim();
    if (trimmedReason.length < 5) {
      setCancelReasonError(t("femme.billing.history.detail.sifen.cancelReasonTooShort"));
      return;
    }
    setCancelReasonError(null);
    setCancelling(true);
    try {
      const updated = await femmePostJson<InvoiceDetail>(`/api/invoices/${invoiceId}/sifen/cancel`, {
        reason: trimmedReason,
      });
      setInvoice(updated);
      setShowCancelForm(false);
      setCancelReason("");
    } catch (err) {
      setCancelError(translateApiError(err, t, "femme.apiErrors.GENERIC"));
    } finally {
      setCancelling(false);
    }
  }

  /**
   * SIFEN HU-11: registers a client-identification event. AC-02/AC-03/AC-04's field-level
   * validation happens client-side first (mirroring what the backend also enforces), so the user
   * sees a specific error without a round-trip whenever possible.
   */
  async function handleIdentifyClient(e: React.FormEvent) {
    e.preventDefault();
    setIdentifyError(null);
    const errors: Record<string, string> = {};
    const trimmedName = identifyName.trim();
    const trimmedRuc = identifyRuc.trim();
    const trimmedDocument = identifyDocument.trim();
    const trimmedAddress = identifyAddress.trim();

    if (!trimmedName) {
      errors.name = t("femme.billing.history.detail.sifen.identifyClientNameRequired");
    }
    if (identifyClientType === "COMPANY") {
      if (!isValidParaguayRuc(trimmedRuc)) {
        errors.ruc = t("femme.billing.history.detail.sifen.identifyClientRucInvalid");
      }
    } else {
      if (!trimmedRuc && !trimmedDocument) {
        errors.document = t("femme.billing.history.detail.sifen.identifyClientDocumentRequired");
      } else if (trimmedRuc && !isValidParaguayRuc(trimmedRuc)) {
        errors.ruc = t("femme.billing.history.detail.sifen.identifyClientRucInvalid");
      }
    }
    if (identifyClientType === "FOREIGN") {
      if (!trimmedAddress) {
        errors.address = t("femme.billing.history.detail.sifen.identifyClientAddressRequired");
      }
      if (!identifyCountryCode) {
        errors.country = t("femme.billing.history.detail.sifen.identifyClientCountryRequired");
      }
    }
    if (Object.keys(errors).length > 0) {
      setIdentifyFieldErrors(errors);
      return;
    }
    setIdentifyFieldErrors({});
    setIdentifying(true);
    try {
      const updated = await femmePostJson<InvoiceDetail>(
        `/api/invoices/${invoiceId}/sifen/identify-client`,
        {
          clientType: identifyClientType,
          ruc: trimmedRuc || null,
          identityDocumentNumber: trimmedDocument || null,
          name: trimmedName,
          address: identifyClientType === "FOREIGN" ? trimmedAddress : null,
          countryCode: identifyClientType === "FOREIGN" ? identifyCountryCode : null,
        },
      );
      setInvoice(updated);
      setShowIdentifyForm(false);
      setIdentifyRuc("");
      setIdentifyDocument("");
      setIdentifyName("");
      setIdentifyAddress("");
      setIdentifyCountryCode("");
    } catch (err) {
      setIdentifyError(translateApiError(err, t, "femme.apiErrors.GENERIC"));
    } finally {
      setIdentifying(false);
    }
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
      onVoided?.();
    } catch (err) {
      setVoidError(translateApiError(err, t, "femme.apiErrors.GENERIC"));
    } finally {
      setVoiding(false);
    }
  }

  // Issue #145: "Cancelar factura en Sifen" merges the standalone "Anular comprobante" action for
  // any invoice currently eligible for SIFEN cancellation — same condition the SIFEN cancel block
  // below already gates on, kept in sync here so only one of the two ever renders.
  const sifenCancelEligible =
    invoice?.sifenSubmissionStatus === "APPROVED" ||
    invoice?.sifenSubmissionStatus === "APPROVED_WITH_OBSERVATION";

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
        {pdfError && (
          <Alert variant="destructive" title={t("femme.billing.errorTitle")}>
            {pdfError}
          </Alert>
        )}
        {invoice && (
          <>
            {/* Status badge */}
            <div className="flex items-center gap-3 flex-wrap">
              <Badge
                variant={invoice.status === "ISSUED" ? "success" : "destructive"}
                data-testid="invoice-status-badge"
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
                {formatParaguayDateTime(invoice.issuedAt, dateLocale)}
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
                      <th className="px-3 py-2 text-right">{t("femme.billing.history.detail.colItemDiscountType")}</th>
                      <th className="px-3 py-2 text-right">{t("femme.billing.history.detail.colItemDiscountValue")}</th>
                      <th className="px-3 py-2 text-right">{t("femme.billing.history.detail.colLineTotal")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoice.lines.map((l) => (
                      <tr key={l.id} className="border-t border-[rgb(var(--color-border))]">
                        <td className="px-3 py-2">{l.description}</td>
                        <td className="px-3 py-2 text-right">{l.quantity}</td>
                        <td className="px-3 py-2 text-right">{formatAmountDecimal(l.unitPrice)}</td>
                        <td className="px-3 py-2 text-right">
                          {(() => {
                            const label = discountTypeLabel(l.discountType ?? "", l.discountValue ?? null);
                            if (label === "FIXED") return t("femme.billing.history.detail.fixedAmount");
                            return label;
                          })()}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {formatAmountDecimal(discountMonetaryAmount(l), "—")}
                        </td>
                        <td className="px-3 py-2 text-right">{formatAmountDecimal(l.lineTotal)}</td>
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
                <span>{formatAmountDecimal(invoice.subtotal)}</span>
              </div>
              {invoice.discountType !== "NONE" && (
                <div className="flex gap-8">
                  <span className="text-[rgb(var(--color-muted-foreground))]">{t("femme.billing.history.detail.discount")}</span>
                  <span>{discountLabel(invoice.discountType, invoice.discountValue)}</span>
                </div>
              )}
              <div className="flex gap-8 font-semibold">
                <span>{t("femme.billing.history.detail.total")}</span>
                <span>{formatAmountDecimal(invoice.total)}</span>
              </div>
            </div>

            {/* Payments */}
            <div>
              <Text className="font-medium mb-1">{t("femme.billing.history.detail.payments")}</Text>
              <div className="flex flex-col gap-1">
                {invoice.payments.map((p, i) => (
                  <div key={i} className="flex justify-between text-sm">
                    <span>{t(`femme.billing.invoice.paymentMethod${capitalize(p.method)}`)}</span>
                    <span>{formatAmountDecimal(p.amount)}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* SIFEN status — HU-07 */}
            {invoice.sifenSubmissionStatus && (
              <div
                className="border-t border-[rgb(var(--color-border))] pt-4 flex flex-col gap-2"
                data-testid="sifen-status-section"
              >
                <div className="flex items-center gap-3 flex-wrap">
                  <Text className="font-medium">{t("femme.billing.history.detail.sifen.title")}</Text>
                  <SifenStatusBadge status={invoice.sifenSubmissionStatus} />
                </div>
                {invoice.sifenControlNumber && (
                  <Text variant="small" className="text-[rgb(var(--color-muted-foreground))]">
                    {t("femme.billing.history.detail.sifen.controlNumber")}: {invoice.sifenControlNumber}
                  </Text>
                )}
                {invoice.sifenSubmissionProtocolNumber && (
                  <Text variant="small" className="text-[rgb(var(--color-muted-foreground))]">
                    {t("femme.billing.history.detail.sifen.protocolNumber")}: {invoice.sifenSubmissionProtocolNumber}
                  </Text>
                )}
                {invoice.sifenSubmissionMessage && (
                  <Text variant="small" className="text-[rgb(var(--color-muted-foreground))]">
                    {t("femme.billing.history.detail.sifen.resultMessage")}: {invoice.sifenSubmissionMessage}
                  </Text>
                )}
                {(invoice.sifenSubmissionStatus === "APPROVED" ||
                  invoice.sifenSubmissionStatus === "APPROVED_WITH_OBSERVATION") &&
                  invoice.sifenQueryDocumentContent && (
                    <div>
                      <Text variant="small" className="font-medium mb-1">
                        {t("femme.billing.history.detail.sifen.documentContent")}
                      </Text>
                      <pre className="max-h-40 overflow-auto rounded border border-[rgb(var(--color-border))] bg-[rgb(var(--color-muted))] p-2 text-xs whitespace-pre-wrap break-all">
                        {invoice.sifenQueryDocumentContent}
                      </pre>
                    </div>
                  )}
                {/* SIFEN HU-09 AC-01/AC-05: available regardless of status (active or, once
                    Fase 3 ships, cancelled) as long as the invoice actually has a persisted
                    verification URL — i.e. it was really signed/submitted at some point. */}
                {invoice.sifenVerificationUrl && (
                  <div>
                    <Button
                      variant="outline"
                      size="sm"
                      data-testid="sifen-revalidate-button"
                      title={t("femme.billing.history.detail.sifen.revalidateHint")}
                      onClick={() =>
                        window.open(invoice.sifenVerificationUrl!, "_blank", "noopener,noreferrer")
                      }
                    >
                      {t("femme.billing.history.detail.sifen.revalidateButton")}
                    </Button>
                  </div>
                )}
                {sifenCheckError && (
                  <Alert variant="destructive" title={t("femme.billing.errorTitle")}>
                    {sifenCheckError}
                  </Alert>
                )}
                {sifenCheckMessage && !sifenCheckError && (
                  <Alert variant="success" title={sifenCheckMessage}>
                    {sifenCheckMessage}
                  </Alert>
                )}
                {invoice.sifenSubmissionStatus === "PENDING_VERIFICATION" && (
                  <div>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={checkingSifenStatus}
                      data-testid="sifen-check-status-button"
                      onClick={() => void handleCheckSifenStatus()}
                    >
                      {checkingSifenStatus
                        ? t("femme.billing.history.detail.sifen.checkingStatus")
                        : t("femme.billing.history.detail.sifen.checkStatusButton")}
                    </Button>
                  </div>
                )}
                {(invoice.sifenSubmissionStatus === "APPROVED" ||
                  invoice.sifenSubmissionStatus === "APPROVED_WITH_OBSERVATION") && (
                  <div className="flex flex-col gap-2 pt-2 border-t border-[rgb(var(--color-border))]">
                    {kudeError && (
                      <Alert variant="destructive" title={t("femme.billing.errorTitle")}>
                        {kudeError}
                      </Alert>
                    )}
                    <div>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={kudeDownloading}
                        data-testid="sifen-kude-download-button"
                        onClick={() => void handleDownloadKude()}
                      >
                        {kudeDownloading
                          ? t("femme.billing.history.detail.sifen.kudeDownloading")
                          : t("femme.billing.history.detail.sifen.kudeDownloadButton")}
                      </Button>
                    </div>
                    <form
                      className="flex flex-wrap items-end gap-2"
                      onSubmit={(e) => void handleSendKudeEmail(e)}
                      noValidate
                    >
                      <div className="flex-1 min-w-[200px]">
                        <Label htmlFor="kude-email">
                          {t("femme.billing.history.detail.sifen.kudeEmailLabel")}
                        </Label>
                        <Input
                          id="kude-email"
                          type="email"
                          value={kudeEmail}
                          onChange={(e) => {
                            setKudeEmail(e.target.value);
                            setKudeEmailSuccess(false);
                          }}
                          placeholder={t("femme.billing.history.detail.sifen.kudeEmailPlaceholder")}
                          className="mt-1 w-full"
                        />
                      </div>
                      <Button
                        type="submit"
                        variant="secondary"
                        size="sm"
                        disabled={kudeEmailSending}
                        data-testid="sifen-kude-send-email-button"
                      >
                        {kudeEmailSending
                          ? t("femme.billing.history.detail.sifen.kudeEmailSending")
                          : t("femme.billing.history.detail.sifen.kudeEmailButton")}
                      </Button>
                    </form>
                    {kudeEmailError && (
                      <Alert variant="destructive" title={t("femme.billing.errorTitle")}>
                        {kudeEmailError}
                      </Alert>
                    )}
                    {kudeEmailSuccess && !kudeEmailError && (
                      <Alert
                        variant="success"
                        title={t("femme.billing.history.detail.sifen.kudeEmailSuccess")}
                        data-testid="sifen-kude-email-success"
                      >
                        {t("femme.billing.history.detail.sifen.kudeEmailSuccess")}
                      </Alert>
                    )}
                  </div>
                )}
                {/* SIFEN HU-10: cancel an approved invoice within the 48h window (AC-01/AC-02) */}
                {(invoice.sifenSubmissionStatus === "APPROVED" ||
                  invoice.sifenSubmissionStatus === "APPROVED_WITH_OBSERVATION") && (
                  <div className="flex flex-col gap-2 pt-2 border-t border-[rgb(var(--color-border))]">
                    {cancelError && (
                      <Alert variant="destructive" title={t("femme.billing.errorTitle")}>
                        {cancelError}
                      </Alert>
                    )}
                    {/* AC-04: a resultCode here, while status is still Approved(-ish), can only mean
                        the last cancellation attempt was rejected — an approved one would have moved
                        the invoice to CANCELLED, taking it out of this whole gated block. */}
                    {invoice.sifenCancellationResultCode && (
                      <Alert
                        variant="destructive"
                        title={t("femme.billing.history.detail.sifen.cancellationRejectedMessage")}
                        data-testid="sifen-cancellation-rejected"
                      >
                        {invoice.sifenCancellationMessage}
                      </Alert>
                    )}
                    {invoice.sifenCancellationDeadlineAt &&
                      (() => {
                        const deadlineMs = new Date(invoice.sifenCancellationDeadlineAt!).getTime();
                        const remainingMs = deadlineMs - nowMs;
                        const expired = remainingMs <= 0;
                        const { hours, minutes } = remainingHoursMinutes(remainingMs);
                        // Issue #145: SIFEN rejects a cancellation attempted too soon after approval
                        // ("Plazo de solicitud de cancelación... extemporáneo") — block the attempt
                        // client-side with a clear message instead of surfacing that raw rejection.
                        const availableAtMs = invoice.sifenCancellationAvailableAt
                          ? new Date(invoice.sifenCancellationAvailableAt).getTime()
                          : null;
                        const tooSoon = availableAtMs != null && nowMs < availableAtMs;
                        return (
                          <>
                            <Text
                              variant="small"
                              className="text-[rgb(var(--color-muted-foreground))]"
                              data-testid={
                                expired
                                  ? "sifen-cancel-deadline-expired"
                                  : "sifen-cancel-deadline-remaining"
                              }
                            >
                              {expired
                                ? t("femme.billing.history.detail.sifen.cancelDeadlineExpired")
                                : t("femme.billing.history.detail.sifen.cancelDeadlineRemaining", {
                                    hours,
                                    minutes,
                                  })}
                            </Text>
                            {tooSoon && (
                              <Text
                                variant="small"
                                className="text-[rgb(var(--color-muted-foreground))]"
                                data-testid="sifen-cancel-too-soon"
                              >
                                {t("femme.billing.history.detail.sifen.cancelTooSoon", {
                                  time: formatParaguayTime(availableAtMs!, dateLocale),
                                })}
                              </Text>
                            )}
                            {!showCancelForm && (
                              <div>
                                <Button
                                  variant="danger"
                                  size="sm"
                                  disabled={expired || tooSoon}
                                  data-testid="sifen-cancel-button"
                                  onClick={() => setShowCancelForm(true)}
                                >
                                  {t("femme.billing.history.detail.sifen.cancelButton")}
                                </Button>
                              </div>
                            )}
                          </>
                        );
                      })()}
                    {showCancelForm && (
                      <form
                        className="flex flex-col gap-2"
                        onSubmit={(e) => void handleCancelInvoice(e)}
                        noValidate
                      >
                        <Text
                          variant="small"
                          className="text-[rgb(var(--color-muted-foreground))]"
                          data-testid="sifen-cancel-also-voids-hint"
                        >
                          {t("femme.billing.history.detail.sifen.cancelAlsoVoidsHint")}
                        </Text>
                        <div>
                          <Label htmlFor="cancel-reason">
                            {t("femme.billing.history.detail.sifen.cancelReasonLabel")}
                          </Label>
                          <Textarea
                            id="cancel-reason"
                            value={cancelReason}
                            onChange={(e) => {
                              setCancelReason(e.target.value);
                              setCancelReasonError(null);
                            }}
                            placeholder={t(
                              "femme.billing.history.detail.sifen.cancelReasonPlaceholder",
                            )}
                            rows={2}
                            aria-invalid={!!cancelReasonError}
                            aria-describedby={
                              cancelReasonError ? "cancel-reason-err" : undefined
                            }
                            className="mt-1 w-full"
                          />
                          <FieldValidationError id="cancel-reason-err">
                            {cancelReasonError}
                          </FieldValidationError>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            type="submit"
                            variant="danger"
                            size="sm"
                            disabled={cancelling}
                            data-testid="sifen-cancel-confirm-button"
                          >
                            {cancelling
                              ? t("femme.billing.history.detail.sifen.cancelling")
                              : t("femme.billing.history.detail.sifen.cancelConfirm")}
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() => setShowCancelForm(false)}
                          >
                            {t("femme.billing.history.detail.sifen.cancelDismiss")}
                          </Button>
                        </div>
                      </form>
                    )}
                  </div>
                )}
                {/* SIFEN HU-10 AC-05: historical record, once the invoice is actually cancelled */}
                {invoice.sifenSubmissionStatus === "CANCELLED" &&
                  invoice.sifenCancellationRequestedAt && (
                    <div
                      className="flex flex-col gap-1 pt-2 border-t border-[rgb(var(--color-border))]"
                      data-testid="sifen-cancellation-history"
                    >
                      <Text className="font-medium">
                        {t("femme.billing.history.detail.sifen.cancellationHistoryTitle")}
                      </Text>
                      <Text
                        variant="small"
                        className="text-[rgb(var(--color-muted-foreground))]"
                      >
                        {t("femme.billing.history.detail.sifen.cancellationRequestedAt")}:{" "}
                        {formatParaguayDateTime(invoice.sifenCancellationRequestedAt, dateLocale)}
                      </Text>
                      {invoice.sifenCancellationRequestedByEmail && (
                        <Text
                          variant="small"
                          className="text-[rgb(var(--color-muted-foreground))]"
                        >
                          {t("femme.billing.history.detail.sifen.cancellationRequestedBy")}:{" "}
                          {invoice.sifenCancellationRequestedByEmail}
                        </Text>
                      )}
                      {invoice.sifenCancellationReason && (
                        <Text
                          variant="small"
                          className="text-[rgb(var(--color-muted-foreground))]"
                        >
                          {t("femme.billing.history.detail.sifen.cancellationReason")}:{" "}
                          {invoice.sifenCancellationReason}
                        </Text>
                      )}
                    </div>
                  )}
                {/* SIFEN HU-11 AC-01: identify the client on an invoice issued without one */}
                {invoice.sifenClientIdentificationEligible && (
                  <div className="flex flex-col gap-2 pt-2 border-t border-[rgb(var(--color-border))]">
                    {identifyError && (
                      <Alert variant="destructive" title={t("femme.billing.errorTitle")}>
                        {identifyError}
                      </Alert>
                    )}
                    {!showIdentifyForm && (
                      <div>
                        <Button
                          variant="outline"
                          size="sm"
                          data-testid="sifen-identify-client-button"
                          onClick={() => setShowIdentifyForm(true)}
                        >
                          {t("femme.billing.history.detail.sifen.identifyClientButton")}
                        </Button>
                      </div>
                    )}
                    {showIdentifyForm && (
                      <form
                        className="flex flex-col gap-3"
                        onSubmit={(e) => void handleIdentifyClient(e)}
                        noValidate
                      >
                        <Heading as="h3" className="text-base">
                          {t("femme.billing.history.detail.sifen.identifyClientTitle")}
                        </Heading>
                        <div>
                          <Label id="identify-client-type-label">
                            {t("femme.billing.history.detail.sifen.identifyClientTypeLabel")}
                          </Label>
                          <RadioGroup
                            aria-labelledby="identify-client-type-label"
                            value={identifyClientType}
                            onChange={(value) => {
                              setIdentifyClientType(value as "COMPANY" | "PERSON" | "FOREIGN");
                              setIdentifyFieldErrors({});
                            }}
                            className="flex-row gap-4 mt-1"
                            name="identify-client-type"
                          >
                            <label className="flex items-center gap-2 text-sm">
                              <Radio value="PERSON" />
                              {t("femme.billing.history.detail.sifen.identifyClientTypePerson")}
                            </label>
                            <label className="flex items-center gap-2 text-sm">
                              <Radio value="COMPANY" />
                              {t("femme.billing.history.detail.sifen.identifyClientTypeCompany")}
                            </label>
                            <label className="flex items-center gap-2 text-sm">
                              <Radio value="FOREIGN" />
                              {t("femme.billing.history.detail.sifen.identifyClientTypeForeign")}
                            </label>
                          </RadioGroup>
                        </div>

                        <div>
                          <Label htmlFor="identify-client-name">
                            {t("femme.billing.history.detail.sifen.identifyClientNameLabel")}
                          </Label>
                          <Input
                            id="identify-client-name"
                            value={identifyName}
                            onChange={(e) => {
                              setIdentifyName(e.target.value);
                              setIdentifyFieldErrors((prev) => ({ ...prev, name: "" }));
                            }}
                            placeholder={t(
                              "femme.billing.history.detail.sifen.identifyClientNamePlaceholder",
                            )}
                            aria-invalid={!!identifyFieldErrors.name}
                            aria-describedby={
                              identifyFieldErrors.name ? "identify-client-name-err" : undefined
                            }
                            className="mt-1 w-full"
                          />
                          <FieldValidationError id="identify-client-name-err">
                            {identifyFieldErrors.name}
                          </FieldValidationError>
                        </div>

                        {identifyClientType === "COMPANY" ? (
                          <div>
                            <Label htmlFor="identify-client-ruc">
                              {t("femme.billing.history.detail.sifen.identifyClientRucLabel")}
                            </Label>
                            <Input
                              id="identify-client-ruc"
                              value={identifyRuc}
                              onChange={(e) => {
                                setIdentifyRuc(e.target.value);
                                setIdentifyFieldErrors((prev) => ({ ...prev, ruc: "" }));
                              }}
                              placeholder={t(
                                "femme.billing.history.detail.sifen.identifyClientRucPlaceholder",
                              )}
                              aria-invalid={!!identifyFieldErrors.ruc}
                              aria-describedby={
                                identifyFieldErrors.ruc ? "identify-client-ruc-err" : undefined
                              }
                              className="mt-1 w-full"
                            />
                            <FieldValidationError id="identify-client-ruc-err">
                              {identifyFieldErrors.ruc}
                            </FieldValidationError>
                          </div>
                        ) : (
                          <div>
                            <Label htmlFor="identify-client-document">
                              {t("femme.billing.history.detail.sifen.identifyClientDocumentLabel")}
                            </Label>
                            <Input
                              id="identify-client-document"
                              value={identifyDocument}
                              onChange={(e) => {
                                setIdentifyDocument(e.target.value);
                                setIdentifyFieldErrors((prev) => ({ ...prev, document: "" }));
                              }}
                              placeholder={t(
                                "femme.billing.history.detail.sifen.identifyClientDocumentPlaceholder",
                              )}
                              aria-invalid={!!identifyFieldErrors.document}
                              aria-describedby={
                                identifyFieldErrors.document
                                  ? "identify-client-document-err"
                                  : undefined
                              }
                              className="mt-1 w-full"
                            />
                            <FieldValidationError id="identify-client-document-err">
                              {identifyFieldErrors.document}
                            </FieldValidationError>
                          </div>
                        )}

                        {identifyClientType === "FOREIGN" && (
                          <>
                            <div>
                              <Label htmlFor="identify-client-country">
                                {t("femme.billing.history.detail.sifen.identifyClientCountryLabel")}
                              </Label>
                              <Select
                                id="identify-client-country"
                                value={identifyCountryCode}
                                onChange={(e) => {
                                  setIdentifyCountryCode(e.target.value);
                                  setIdentifyFieldErrors((prev) => ({ ...prev, country: "" }));
                                }}
                                invalid={!!identifyFieldErrors.country}
                                aria-describedby={
                                  identifyFieldErrors.country
                                    ? "identify-client-country-err"
                                    : undefined
                                }
                                className="mt-1 w-full"
                              >
                                <option value="">
                                  {t(
                                    "femme.billing.history.detail.sifen.identifyClientCountryPlaceholder",
                                  )}
                                </option>
                                {FOREIGN_COUNTRY_CODES.map((code) => (
                                  <option key={code} value={code}>
                                    {t(`femme.billing.history.detail.sifen.countries.${code}`)}
                                  </option>
                                ))}
                              </Select>
                              <FieldValidationError id="identify-client-country-err">
                                {identifyFieldErrors.country}
                              </FieldValidationError>
                            </div>
                            <div>
                              <Label htmlFor="identify-client-address">
                                {t("femme.billing.history.detail.sifen.identifyClientAddressLabel")}
                              </Label>
                              <Input
                                id="identify-client-address"
                                value={identifyAddress}
                                onChange={(e) => {
                                  setIdentifyAddress(e.target.value);
                                  setIdentifyFieldErrors((prev) => ({ ...prev, address: "" }));
                                }}
                                placeholder={t(
                                  "femme.billing.history.detail.sifen.identifyClientAddressPlaceholder",
                                )}
                                aria-invalid={!!identifyFieldErrors.address}
                                aria-describedby={
                                  identifyFieldErrors.address
                                    ? "identify-client-address-err"
                                    : undefined
                                }
                                className="mt-1 w-full"
                              />
                              <FieldValidationError id="identify-client-address-err">
                                {identifyFieldErrors.address}
                              </FieldValidationError>
                            </div>
                          </>
                        )}

                        <div className="flex gap-2">
                          <Button
                            type="submit"
                            variant="secondary"
                            size="sm"
                            disabled={identifying}
                            data-testid="sifen-identify-client-confirm-button"
                          >
                            {identifying
                              ? t("femme.billing.history.detail.sifen.identifyClientSubmitting")
                              : t("femme.billing.history.detail.sifen.identifyClientSubmit")}
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() => setShowIdentifyForm(false)}
                          >
                            {t("femme.billing.history.detail.sifen.identifyClientDismiss")}
                          </Button>
                        </div>
                      </form>
                    )}
                  </div>
                )}
                {/* SIFEN HU-11 AC-05/AC-06: last client-identification attempt, either outcome */}
                {invoice.sifenClientIdentificationRequestedAt && (
                  <div
                    className="flex flex-col gap-1 pt-2 border-t border-[rgb(var(--color-border))]"
                    data-testid="sifen-client-identification-history"
                  >
                    <Text className="font-medium">
                      {t("femme.billing.history.detail.sifen.identifyClientHistoryTitle")}
                    </Text>
                    {!invoice.sifenClientIdentified && invoice.sifenClientIdentificationMessage && (
                      <Alert
                        variant="destructive"
                        title={t("femme.billing.history.detail.sifen.identifyClientRejectedMessage")}
                        data-testid="sifen-client-identification-rejected"
                      >
                        {invoice.sifenClientIdentificationMessage}
                      </Alert>
                    )}
                    <Text variant="small" className="text-[rgb(var(--color-muted-foreground))]">
                      {t("femme.billing.history.detail.sifen.identifyClientHistoryRequestedAt")}:{" "}
                      {formatParaguayDateTime(invoice.sifenClientIdentificationRequestedAt, dateLocale)}
                    </Text>
                    {invoice.sifenClientIdentificationRequestedByEmail && (
                      <Text variant="small" className="text-[rgb(var(--color-muted-foreground))]">
                        {t("femme.billing.history.detail.sifen.identifyClientHistoryRequestedBy")}:{" "}
                        {invoice.sifenClientIdentificationRequestedByEmail}
                      </Text>
                    )}
                    {invoice.sifenClientIdentificationName && (
                      <Text variant="small" className="text-[rgb(var(--color-muted-foreground))]">
                        {t("femme.billing.history.detail.sifen.identifyClientHistoryName")}:{" "}
                        {invoice.sifenClientIdentificationName}
                      </Text>
                    )}
                    {invoice.sifenClientIdentificationRuc && (
                      <Text variant="small" className="text-[rgb(var(--color-muted-foreground))]">
                        {t("femme.billing.history.detail.sifen.identifyClientHistoryRuc")}:{" "}
                        {invoice.sifenClientIdentificationRuc}
                      </Text>
                    )}
                    {invoice.sifenClientIdentificationIdentityDocument && (
                      <Text variant="small" className="text-[rgb(var(--color-muted-foreground))]">
                        {t("femme.billing.history.detail.sifen.identifyClientHistoryDocument")}:{" "}
                        {invoice.sifenClientIdentificationIdentityDocument}
                      </Text>
                    )}
                    {invoice.sifenClientIdentificationAddress && (
                      <Text variant="small" className="text-[rgb(var(--color-muted-foreground))]">
                        {t("femme.billing.history.detail.sifen.identifyClientHistoryAddress")}:{" "}
                        {invoice.sifenClientIdentificationAddress}
                      </Text>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Actions */}
            <div className="flex flex-wrap gap-3 pt-2">
              {invoice.status === "ISSUED" && !sifenEnabled && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleDownloadPdf()}
                >
                  {t("femme.billing.history.detail.downloadPdf")}
                </Button>
              )}
              {allowVoid && invoice.status === "ISSUED" && !showVoidForm && !sifenCancelEligible && (
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
            {allowVoid && showVoidForm && invoice.status === "ISSUED" && !sifenCancelEligible && (
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
