import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Badge,
  Button,
  Heading,
  Input,
  Modal,
  Spinner,
  Text,
  Textarea,
  Label,
} from "@design-system";
import { femmeJson, femmePostJson } from "../api/femmeClient";
import { downloadInvoicePdf } from "../api/downloadInvoicePdf";
import { downloadSifenKude, sendSifenKudeByEmail } from "../api/downloadSifenKude";
import { translateApiError } from "../api/parseApiErrorMessage";
import { FieldValidationError } from "./FieldValidationError";
import { useDateLocale } from "../i18n/dateLocale";
import { formatAmountDecimal } from "../lib/formatMoney";
import { formatParaguayDateTime } from "../lib/paraguayDateTime";

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
};

/** SIFEN HU-07: badge variant + i18n key per sifenSubmissionStatus literal. */
function sifenStatusLabelKey(status: string): string {
  switch (status) {
    case "APPROVED":
      return "femme.billing.history.detail.sifen.statusApproved";
    case "APPROVED_WITH_OBSERVATION":
      return "femme.billing.history.detail.sifen.statusApprovedWithObservation";
    case "REJECTED":
      return "femme.billing.history.detail.sifen.statusRejected";
    default:
      return "femme.billing.history.detail.sifen.statusPendingVerification";
  }
}

function sifenStatusBadgeVariant(status: string): "success" | "destructive" | "warning" {
  if (status === "APPROVED" || status === "APPROVED_WITH_OBSERVATION") return "success";
  if (status === "REJECTED") return "destructive";
  return "warning";
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
                  <Badge variant={sifenStatusBadgeVariant(invoice.sifenSubmissionStatus)}>
                    {t(sifenStatusLabelKey(invoice.sifenSubmissionStatus))}
                  </Badge>
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
              </div>
            )}

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
              {allowVoid && invoice.status === "ISSUED" && !showVoidForm && (
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
            {allowVoid && showVoidForm && invoice.status === "ISSUED" && (
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
