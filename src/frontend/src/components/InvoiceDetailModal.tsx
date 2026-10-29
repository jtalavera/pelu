import { useCallback, useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Button,
  cn,
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
import {
  downloadSifenKude,
  fetchSifenEnvironment,
  fetchSifenKudeBlob,
  sendSifenKudeByEmail,
  triggerBrowserDownload,
} from "../api/downloadSifenKude";
import { translateApiError } from "../api/parseApiErrorMessage";
import { useFeatureFlag } from "../hooks/useFeatureFlags";
import { useMe } from "../hooks/useMe";
import { AssignInvoiceProfessionalsDialog } from "./invoice/AssignInvoiceProfessionalsDialog";
import { FieldValidationError } from "./FieldValidationError";
import { InvoiceCorrectionForm } from "./InvoiceCorrectionForm";
import { InvoiceStatePill, deriveInvoiceState } from "./InvoiceStatePill";
import { SifenStatusBadge } from "./SifenStatusBadge";
import { useDateLocale } from "../i18n/dateLocale";
import { formatAmountDecimal, formatGuaraniesGs } from "../lib/formatMoney";
import { formatParaguayDateTime, formatParaguayTime } from "../lib/paraguayDateTime";
import { toWhatsAppPhone } from "../lib/paraguayPhone";
import {
  WHATSAPP_WINDOW_NAME,
  buildWhatsAppUrl,
  isMobileDevice,
  shareFileViaOs,
} from "../lib/whatsappShare";
import { isSifenStatusInFlight, useSifenStatusLiveRefresh } from "../hooks/useSifenStatusLiveRefresh";

export type InvoiceLine = {
  id: number;
  serviceId: number | null;
  description: string;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
  discountType?: string | null;
  discountValue?: string | null;
  /** HU-COM-10: professional / seller of the line. */
  professionalId?: number | null;
  professionalName?: string | null;
};

export type InvoicePayment = {
  method: string;
  amount: string;
  cardBrand?: string | null;
  cardBrandOtherDescription?: string | null;
};

/** Issue #205 AC-2: one row of GET /api/invoices/{id}/sifen/history. */
type SifenEventLogEntry = {
  eventType: "SUBMISSION" | "CANCELLATION" | "CLIENT_IDENTIFICATION";
  occurredAt: string;
  resultCode: string | null;
  message: string | null;
};

export type InvoiceDetail = {
  id: number;
  invoiceNumber: number;
  invoiceNumberFormatted: string;
  fiscalStampNumber: string;
  clientId: number | null;
  clientDisplayName: string;
  /** Issue #167: the linked client's own email on file, if any — used to prefill the KuDE-by-email field. */
  clientEmail?: string | null;
  /** Issue #215 follow-up: the linked client's own phone on file, if any — used to open the WhatsApp send directly against that contact. */
  clientPhone?: string | null;
  /** Issue #173: the email captured on the comprobante form for this document. */
  recipientEmail?: string | null;
  clientRucOverride: string | null;
  /** Issue #174 AC-01: "TARJETA_DIPLOMATICA" here means the sale was issued IVA-exonerada. */
  clientIdentityDocumentTypeOverride?: string | null;
  /** Issue #175: prefill for the "Corregir y reenviar" form. */
  clientIdentityDocumentOverride?: string | null;
  clientTaxpayerTypeOverride?: string | null;
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
  /**
   * Current "inutilización de numeración" state for this invoice's number
   * (PENDING/APPROVED/APPROVED_WITH_OBSERVATION/REJECTED/CANCELLED), or null if none was recorded.
   * Once APPROVED* the number is dead — "Corregir y reenviar" is hidden.
   */
  sifenNumberVoidingStatus?: string | null;
  /**
   * Issue #190: instant up to which a correct-and-resend still falls inside SIFEN's 72h
   * transmission window (emission + 72h). Non-null only while the invoice is in the "resolve
   * rejected" flow. Used only for a non-blocking warning — the resend itself is never blocked.
   */
  sifenCorrectResendDeadlineAt?: string | null;
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

type DetailPanel = "share" | "void" | "cancel" | "revalidate" | "identify" | "tech";

/** A titled block of the invoice detail's SIFEN tab — stacked bordered sections, no accordion. */
function SifenSection({
  title,
  aside,
  tone = "default",
  className,
  children,
  ...props
}: HTMLAttributes<HTMLElement> & {
  title: ReactNode;
  /** Rendered on the right of the title (e.g. the status badge). */
  aside?: ReactNode;
  /** "attention" tints the section for something the user has to act on (a rejection). */
  tone?: "default" | "attention";
}) {
  return (
    <section
      className={cn(
        "flex flex-col gap-3 rounded-lg border p-4",
        tone === "attention"
          ? "border-red-300 bg-red-50/60 dark:border-red-800 dark:bg-red-950/20"
          : "border-[rgb(var(--color-border))]",
        className,
      )}
      {...props}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Heading as="h3" className="text-base font-semibold">
          {title}
        </Heading>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function InvoiceDetailModal({
  invoiceId,
  onClose,
  onVoided,
  onCorrected,
  allowVoid = true,
}: {
  invoiceId: number;
  onClose: () => void;
  onVoided?: () => void;
  /** Issue #175: called after a rejected invoice is corrected and re-queued. */
  onCorrected?: () => void;
  allowVoid?: boolean;
}) {
  const { t } = useTranslation();
  const dateLocale = useDateLocale();
  /** HU-33 AC-01/AC-03: once SIFEN is active, the traditional PDF format is retired — only the
   * KuDE download (already gated on the invoice's own Approved status further below) remains. */
  const sifenEnabled = useFeatureFlag("SIFEN_ELECTRONIC_INVOICING");
  // "Asignar profesional": assigning a professional accrues a commission, so it needs the
  // commissions module and an ADMIN (same as HU-COM-13).
  const commissionsEnabled = useFeatureFlag("COMMISSIONS");
  const { me } = useMe();
  // Redesign: one view. Share, void, cancel, revalidate, identify and the technical detail are
  // "panels" that open under the actions (the secondary ones from the "⋯" menu); several can be
  // open at once.
  const [openPanels, setOpenPanels] = useState<ReadonlySet<DetailPanel>>(() => new Set());
  const [menuOpen, setMenuOpen] = useState(false);
  const togglePanel = (panel: DetailPanel) =>
    setOpenPanels((prev) => {
      const next = new Set(prev);
      if (next.has(panel)) next.delete(panel);
      else next.add(panel);
      return next;
    });
  const closePanel = (panel: DetailPanel) =>
    setOpenPanels((prev) => {
      const next = new Set(prev);
      next.delete(panel);
      return next;
    });
  const [showAssignProfessionals, setShowAssignProfessionals] = useState(false);
  const [assignProfessionalsSuccess, setAssignProfessionalsSuccess] = useState(false);
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [voidReasonError, setVoidReasonError] = useState<string | null>(null);
  const [voiding, setVoiding] = useState(false);
  const [voidError, setVoidError] = useState<string | null>(null);
  const [voidSuccess, setVoidSuccess] = useState(false);
  // "Anular comprobante" for a rejected invoice = inutilizar su numeración ante SIFEN.
  const [showNullifyForm, setShowNullifyForm] = useState(false);
  const [nullifyReason, setNullifyReason] = useState("");
  const [nullifyReasonError, setNullifyReasonError] = useState<string | null>(null);
  const [nullifying, setNullifying] = useState(false);
  const [nullifyError, setNullifyError] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [checkingSifenStatus, setCheckingSifenStatus] = useState(false);
  const [sifenCheckError, setSifenCheckError] = useState<string | null>(null);
  const [sifenCheckMessage, setSifenCheckMessage] = useState<string | null>(null);
  const [kudeDownloading, setKudeDownloading] = useState(false);
  const [kudeError, setKudeError] = useState<string | null>(null);
  const [sampleKudeDownloading, setSampleKudeDownloading] = useState(false);
  const [sampleKudeError, setSampleKudeError] = useState<string | null>(null);
  const [sifenEnvironment, setSifenEnvironment] = useState<"TEST" | "PRODUCTION" | null>(null);
  const [kudeEmail, setKudeEmail] = useState("");
  const [kudeEmailSending, setKudeEmailSending] = useState(false);
  const [kudeEmailError, setKudeEmailError] = useState<string | null>(null);
  const [kudeEmailSuccess, setKudeEmailSuccess] = useState(false);
  // Issue #215: "Enviar por WhatsApp" — downloads the KuDE and opens a prefilled wa.me chat.
  const [kudeWhatsappSending, setKudeWhatsappSending] = useState(false);
  const [kudeWhatsappError, setKudeWhatsappError] = useState<string | null>(null);
  const [showCancelForm, setShowCancelForm] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelReasonError, setCancelReasonError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [showCorrectionForm, setShowCorrectionForm] = useState(false);
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
  // Issue #205 AC-2: "ver historial de mensajes SIFEN" popup.
  const [showSifenHistory, setShowSifenHistory] = useState(false);
  const [sifenHistoryLoading, setSifenHistoryLoading] = useState(false);
  const [sifenHistoryError, setSifenHistoryError] = useState<string | null>(null);
  const [sifenHistory, setSifenHistory] = useState<SifenEventLogEntry[] | null>(null);

  // SIFEN HU-10 AC-02: ticks the deadline countdown without a full page refresh.
  useEffect(() => {
    const interval = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setLoadError(null);
    femmeJson<InvoiceDetail>(`/api/invoices/${invoiceId}`)
      .then((data) => {
        if (cancelled) return;
        setInvoice(data);
        // Issue #167/#173: prefill the KuDE-by-email field with the email captured on the
        // comprobante form for this document, falling back to the client's own email on file.
        if (data.recipientEmail) setKudeEmail(data.recipientEmail);
        else if (data.clientEmail) setKudeEmail(data.clientEmail);
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

  // SIFEN statuses change in the backend with no user action (queue consumer, consulta-lote
  // polling every second): while this invoice is still "En cola" / "Pendiente de verificación",
  // silently re-read it so the dialog shows the new status as soon as the backend records it.
  // Only the invoice itself is replaced — form fields the user may be typing in stay untouched.
  const liveRefreshInFlightRef = useRef(false);
  const refreshInvoiceSilently = useCallback(() => {
    if (liveRefreshInFlightRef.current) return;
    liveRefreshInFlightRef.current = true;
    femmeJson<InvoiceDetail>(`/api/invoices/${invoiceId}`)
      .then((data) => {
        setInvoice(data);
        // A manual "check status" message ("still pending…") is stale once SIFEN resolved it.
        if (!isSifenStatusInFlight(data.sifenSubmissionStatus)) setSifenCheckMessage(null);
      })
      .catch(() => {
        // Silent refresh: a transient failure just waits for the next tick.
      })
      .finally(() => {
        liveRefreshInFlightRef.current = false;
      });
  }, [invoiceId]);
  useSifenStatusLiveRefresh(
    !loading && !checkingSifenStatus && isSifenStatusInFlight(invoice?.sifenSubmissionStatus),
    refreshInvoiceSilently,
  );

  // Only used to decide whether to offer the "production-style" sample KuDE (test environment only).
  useEffect(() => {
    let cancelled = false;
    fetchSifenEnvironment()
      .then((env) => {
        if (!cancelled) setSifenEnvironment(env);
      })
      .catch(() => {
        if (!cancelled) setSifenEnvironment(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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

  /** Issue #205 AC-2: opens the "historial de mensajes SIFEN" popup, fetching on first open. */
  async function handleOpenSifenHistory() {
    setShowSifenHistory(true);
    setSifenHistoryError(null);
    setSifenHistoryLoading(true);
    try {
      const history = await femmeJson<SifenEventLogEntry[]>(
        `/api/invoices/${invoiceId}/sifen/history`,
      );
      setSifenHistory(history);
    } catch (err) {
      setSifenHistoryError(translateApiError(err, t, "femme.apiErrors.GENERIC"));
    } finally {
      setSifenHistoryLoading(false);
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

  /**
   * Downloads the "production-style" sample KuDE: same document with the issuer's real razón social
   * instead of the test-environment legend, so the business can preview how its invoice will look
   * in production. Downloaded as MUESTRA-…pdf; only offered while SIFEN runs against test.
   */
  async function handleDownloadSampleKude() {
    setSampleKudeError(null);
    setSampleKudeDownloading(true);
    try {
      await downloadSifenKude(invoiceId, { sample: true });
    } catch (err) {
      setSampleKudeError(translateApiError(err, t, "femme.apiErrors.GENERIC"));
    } finally {
      setSampleKudeDownloading(false);
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

  /**
   * Issue #215: "Enviar por WhatsApp". Fetches the KuDE PDF (same fetch the email/download flow
   * already uses), then:
   * - on phones/tablets, opens the OS share sheet with the PDF already attached (the user picks
   *   WhatsApp there); if the browser can't share files, falls back to the download + chat link;
   * - otherwise downloads the PDF and opens the chat with a prefilled text message, inviting the
   *   user to attach the file manually. Desktop goes straight to WhatsApp Web (no "app or web"
   *   chooser page) in a named window, so repeated sends reuse the same WhatsApp tab.
   * When the linked client has a phone number on file, the chat opens directly against that
   * contact; otherwise it opens the composer with no contact preselected.
   * A chat link alone can never carry the PDF: `GET /sifen/kude` requires Bearer auth, so the
   * end client can't fetch it directly from a link — the file always has to move through this
   * browser first.
   */
  async function handleSendKudeWhatsapp() {
    if (!invoice) return;
    setKudeWhatsappError(null);
    setKudeWhatsappSending(true);
    try {
      const { blob, filename } = await fetchSifenKudeBlob(invoiceId);
      const clientName =
        invoice.clientDisplayName ||
        t("femme.billing.history.detail.sifen.kudeWhatsappGenericClient");
      const message = t("femme.billing.history.detail.sifen.kudeWhatsappMessage", {
        client: clientName,
        number: invoice.invoiceNumberFormatted,
        amount: formatGuaraniesGs(invoice.total),
      });
      const whatsappPhone = toWhatsAppPhone(invoice.clientPhone);
      const mobile = isMobileDevice();

      if (mobile) {
        const file = new File([blob], filename, { type: "application/pdf" });
        const result = await shareFileViaOs(file, message);
        if (result !== "unsupported") return;
      }

      triggerBrowserDownload(blob, filename);
      // No `noopener` on desktop: it would make the browser ignore the window name and open a
      // fresh WhatsApp Web tab on every send.
      window.open(
        buildWhatsAppUrl(whatsappPhone, message, mobile),
        mobile ? "_blank" : WHATSAPP_WINDOW_NAME,
        mobile ? "noopener,noreferrer" : undefined,
      );
    } catch (err) {
      setKudeWhatsappError(translateApiError(err, t, "femme.apiErrors.GENERIC"));
    } finally {
      setKudeWhatsappSending(false);
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
      closePanel("void");
      onVoided?.();
    } catch (err) {
      setVoidError(translateApiError(err, t, "femme.apiErrors.GENERIC"));
    } finally {
      setVoiding(false);
    }
  }

  async function handleNullifyNumber(e: React.FormEvent) {
    e.preventDefault();
    setNullifyError(null);
    const trimmed = nullifyReason.trim();
    if (trimmed.length < 5) {
      setNullifyReasonError(
        t("femme.billing.history.detail.sifen.nullifyNumberReasonTooShort"),
      );
      return;
    }
    setNullifyReasonError(null);
    setNullifying(true);
    try {
      const updated = await femmePostJson<InvoiceDetail>(
        `/api/invoices/${invoiceId}/sifen/nullify-number`,
        { reason: trimmed },
      );
      setInvoice(updated);
      setShowNullifyForm(false);
      setNullifyReason("");
      if (updated.status === "VOIDED") {
        onVoided?.();
      }
    } catch (err) {
      setNullifyError(translateApiError(err, t, "femme.apiErrors.GENERIC"));
    } finally {
      setNullifying(false);
    }
  }

  // Issue #145: "Cancelar factura en Sifen" merges the standalone "Anular comprobante" action for
  // any invoice currently eligible for SIFEN cancellation — same condition the SIFEN cancel block
  // below already gates on, kept in sync here so only one of the two ever renders.
  const sifenCancelEligible =
    invoice?.sifenSubmissionStatus === "APPROVED" ||
    invoice?.sifenSubmissionStatus === "APPROVED_WITH_OBSERVATION";

  if (showCorrectionForm && invoice) {
    return (
      <InvoiceCorrectionForm
        invoiceId={invoice.id}
        onClose={() => setShowCorrectionForm(false)}
        onResent={() => {
          setShowCorrectionForm(false);
          onCorrected?.();
          onClose();
        }}
      />
    );
  }

  const canAssignProfessionals =
    invoice != null &&
    invoice.status === "ISSUED" &&
    commissionsEnabled &&
    me?.role === "ADMIN" &&
    invoice.lines.some((l) => l.serviceId != null);
  // The button sits next to "Descargar KuDE" when that one is shown, else in the actions row.
  const kudeRowShown =
    invoice?.sifenSubmissionStatus === "APPROVED" ||
    invoice?.sifenSubmissionStatus === "APPROVED_WITH_OBSERVATION" ||
    invoice?.sifenSubmissionStatus === "QUEUED" ||
    invoice?.sifenSubmissionStatus === "PENDING_VERIFICATION";

  // Tab 2 ("SIFEN"): every SIFEN detail and action, as stacked titled sections (no accordion):
  // status summary first, then whatever needs attention (rejection), then the actions, and the
  // raw document content — the most technical bit — last.
  const sifenSections =
    invoice && invoice.sifenSubmissionStatus
      ? (() => {
          const kudeEligible =
            invoice.sifenSubmissionStatus === "APPROVED" ||
            invoice.sifenSubmissionStatus === "APPROVED_WITH_OBSERVATION" ||
            invoice.sifenSubmissionStatus === "QUEUED" ||
            invoice.sifenSubmissionStatus === "PENDING_VERIFICATION";
          const cancelEligible =
            invoice.sifenSubmissionStatus === "APPROVED" ||
            invoice.sifenSubmissionStatus === "APPROVED_WITH_OBSERVATION";
          const cancelHistoryVisible =
            invoice.sifenSubmissionStatus === "CANCELLED" &&
            !!invoice.sifenCancellationRequestedAt;
          const identifyHistoryVisible = !!invoice.sifenClientIdentificationRequestedAt;
          // Number inutilizada ante SIFEN → dead for good, no more "corregir y reenviar".
          const numberInutilizado =
            invoice.sifenNumberVoidingStatus === "APPROVED" ||
            invoice.sifenNumberVoidingStatus === "APPROVED_WITH_OBSERVATION";

          return {
            status: (
              <>
              <SifenSection
                data-testid="sifen-tab-status"
                title={t("femme.billing.history.detail.sifen.title")}
                aside={<SifenStatusBadge status={invoice.sifenSubmissionStatus} />}
              >
                <dl className="grid grid-cols-1 gap-3 text-sm">
                  {invoice.sifenControlNumber && (
                    <div>
                      <dt className="text-xs font-medium text-[rgb(var(--color-muted-foreground))]">
                        {t("femme.billing.history.detail.sifen.controlNumber")}
                      </dt>
                      <dd className="mt-0.5 font-mono text-xs break-all" data-testid="sifen-control-number">
                        {invoice.sifenControlNumber}
                      </dd>
                    </div>
                  )}
                  {invoice.sifenSubmissionProtocolNumber && (
                    <div>
                      <dt className="text-xs font-medium text-[rgb(var(--color-muted-foreground))]">
                        {t("femme.billing.history.detail.sifen.protocolNumber")}
                      </dt>
                      <dd className="mt-0.5 font-mono text-xs break-all">
                        {invoice.sifenSubmissionProtocolNumber}
                      </dd>
                    </div>
                  )}
                  {invoice.sifenSubmissionMessage && (
                    <div>
                      <dt className="text-xs font-medium text-[rgb(var(--color-muted-foreground))]">
                        {t("femme.billing.history.detail.sifen.resultMessage")}
                      </dt>
                      <dd className="mt-0.5">{invoice.sifenSubmissionMessage}</dd>
                    </div>
                  )}
                </dl>
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
                {/* RT-20 (Hardening_SIFEN.md): while QUEUED, the invoice hasn't been transmitted
                    yet at all — querying SIFEN for a CDC it never received would be pointless, so
                    this shows an informational line instead of the "check status" button below
                    (which only ever makes sense once something was actually sent). */}
                {invoice.sifenSubmissionStatus === "QUEUED" && (
                  <Text
                    variant="small"
                    className="text-[rgb(var(--color-muted-foreground))]"
                    data-testid="sifen-submission-in-progress-note"
                  >
                    {t("femme.billing.history.detail.sifen.submissionInProgressNote")}
                  </Text>
                )}
                <div className="flex flex-wrap gap-2">
                  {invoice.sifenSubmissionStatus === "PENDING_VERIFICATION" && (
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
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    data-testid="sifen-history-button"
                    onClick={() => void handleOpenSifenHistory()}
                  >
                    {t("femme.billing.history.detail.sifen.historyButton")}
                  </Button>
                </div>
              </SifenSection>
              </>
            ),
            correct: (
              <>
              {/* Issue #175 + follow-up: resolve a rejected invoice — correct & resend under
                  the same CDC, or "Anular comprobante" (= inutilizar its numeración ante
                  SIFEN). Right after the status: it is the one thing that needs attention. */}
              {invoice.sifenSubmissionStatus === "REJECTED" && (
                <SifenSection
                  data-testid="sifen-tab-correct-resend"
                  title={t("femme.billing.history.detail.sifen.resolveRejectedTitle")}
                  tone="attention"
                >
                  {invoice.sifenSubmissionMessage && (
                    <Alert
                      variant="destructive"
                      title={t("femme.billing.history.detail.sifen.rejectionMessageTitle")}
                    >
                      {invoice.sifenSubmissionMessage}
                    </Alert>
                  )}

                  {numberInutilizado || invoice.status === "VOIDED" ? (
                    <Text
                      variant="small"
                      className="text-[rgb(var(--color-muted-foreground))]"
                      data-testid="sifen-rejected-resolved-note"
                    >
                      {numberInutilizado
                        ? t("femme.billing.history.detail.sifen.numberInutilizadoNote")
                        : t("femme.billing.history.detail.sifen.rejectedVoidedNote")}
                    </Text>
                  ) : (
                    <>
                      <Text
                        variant="small"
                        className="text-[rgb(var(--color-muted-foreground))]"
                      >
                        {t("femme.billing.history.detail.sifen.correctResendExplanation")}
                      </Text>

                      {/* Issue #190: past SIFEN's 72h transmission window, warn (non-blocking). */}
                      {invoice.sifenCorrectResendDeadlineAt &&
                        nowMs >
                          new Date(invoice.sifenCorrectResendDeadlineAt).getTime() && (
                          <Alert
                            variant="warning"
                            title={t(
                              "femme.billing.history.detail.sifen.correctResendWindowExpiredTitle",
                            )}
                            data-testid="sifen-correct-resend-window-expired"
                          >
                            {t(
                              "femme.billing.history.detail.sifen.correctResendWindowExpiredWarning",
                              { date: formatParaguayDateTime(invoice.issuedAt, dateLocale) },
                            )}
                          </Alert>
                        )}

                      {!showNullifyForm && (
                        <div className="flex flex-wrap gap-2">
                          <Button
                            variant="primary"
                            size="sm"
                            data-testid="sifen-correct-resend-button"
                            onClick={() => setShowCorrectionForm(true)}
                          >
                            {t("femme.billing.history.detail.sifen.correctResendButton")}
                          </Button>
                          {allowVoid && (
                            <Button
                              variant="danger"
                              size="sm"
                              data-testid="sifen-nullify-number-button"
                              onClick={() => setShowNullifyForm(true)}
                            >
                              {t("femme.billing.history.detail.voidButton")}
                            </Button>
                          )}
                        </div>
                      )}

                      {showNullifyForm && (
                        <form
                          onSubmit={(e) => void handleNullifyNumber(e)}
                          noValidate
                          className="flex flex-col gap-3"
                        >
                          <Text
                            variant="small"
                            className="text-[rgb(var(--color-muted-foreground))]"
                          >
                            {t(
                              "femme.billing.history.detail.sifen.nullifyNumberExplanation",
                            )}
                          </Text>
                          {nullifyError && (
                            <Alert
                              variant="destructive"
                              title={t("femme.billing.errorTitle")}
                            >
                              {nullifyError}
                            </Alert>
                          )}
                          <div>
                            <Label htmlFor="nullify-reason">
                              {t(
                                "femme.billing.history.detail.sifen.nullifyNumberReasonLabel",
                              )}
                            </Label>
                            <Textarea
                              id="nullify-reason"
                              value={nullifyReason}
                              onChange={(e) => {
                                setNullifyReason(e.target.value);
                                setNullifyReasonError(null);
                              }}
                              rows={2}
                              className="mt-1 w-full"
                              aria-invalid={!!nullifyReasonError}
                              aria-describedby={
                                nullifyReasonError ? "nullify-reason-err" : undefined
                              }
                            />
                            <FieldValidationError id="nullify-reason-err">
                              {nullifyReasonError}
                            </FieldValidationError>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              onClick={() => {
                                setShowNullifyForm(false);
                                setNullifyReason("");
                                setNullifyReasonError(null);
                                setNullifyError(null);
                              }}
                            >
                              {t("femme.billing.history.detail.voidCancel")}
                            </Button>
                            <Button
                              type="submit"
                              variant="danger"
                              size="sm"
                              disabled={nullifying}
                              data-testid="sifen-nullify-number-confirm"
                            >
                              {nullifying
                                ? t(
                                    "femme.billing.history.detail.sifen.nullifyNumberSubmitting",
                                  )
                                : t(
                                    "femme.billing.history.detail.sifen.nullifyNumberConfirm",
                                  )}
                            </Button>
                          </div>
                        </form>
                      )}
                    </>
                  )}
                </SifenSection>
              )}
              </>
            ),
            email: (
              <>
              {kudeEligible && (
                <SifenSection
                  data-testid="sifen-tab-email"
                  title={t("femme.billing.history.detail.sifen.kudeShareLabel")}
                >
                  <form
                    className="flex flex-wrap items-end gap-2"
                    onSubmit={(e) => void handleSendKudeEmail(e)}
                    noValidate
                  >
                    <div className="flex-1 min-w-[200px]">
                      <Label htmlFor="kude-email">
                        {t("femme.billing.history.detail.sifen.kudeEmailFieldLabel")}
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
                    {/* Issue #215: "Enviar por WhatsApp" — next to the email send button. Plain
                        type="button" so it never submits the email form above. */}
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={kudeWhatsappSending}
                      data-testid="sifen-kude-send-whatsapp-button"
                      onClick={() => void handleSendKudeWhatsapp()}
                    >
                      {kudeWhatsappSending
                        ? t("femme.billing.history.detail.sifen.kudeWhatsappSending")
                        : t("femme.billing.history.detail.sifen.kudeWhatsappButton")}
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
                  {kudeWhatsappError && (
                    <Alert
                      variant="destructive"
                      title={t("femme.billing.errorTitle")}
                      data-testid="sifen-kude-whatsapp-error"
                    >
                      {kudeWhatsappError}
                    </Alert>
                  )}
                </SifenSection>
              )}
              </>
            ),
            revalidate: (
              <>
              {/* SIFEN HU-09 AC-01/AC-05: available regardless of status as long as the invoice
                  actually has a persisted verification URL — i.e. it was really signed/submitted. */}
              {invoice.sifenVerificationUrl && (
                <SifenSection
                  data-testid="sifen-tab-revalidate"
                  title={t("femme.billing.history.detail.sifen.revalidateButton")}
                >
                  {/* Issue #167: visible explanation, not just a hover-only tooltip — most
                      users would never discover the old title-attribute-only hint. */}
                  <Text variant="small" className="text-[rgb(var(--color-muted-foreground))]">
                    {t("femme.billing.history.detail.sifen.revalidateExplanation")}
                    <br />
                    {t("femme.billing.history.detail.sifen.revalidateHint")}
                  </Text>
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
                </SifenSection>
              )}
              </>
            ),
            cancel: (
              <>
              {(cancelEligible || cancelHistoryVisible) && (
                <SifenSection
                  data-testid="sifen-tab-cancel"
                  title={t("femme.billing.history.detail.sifen.cancelButton")}
                >
                  {/* SIFEN HU-10: cancel an approved invoice within the 48h window (AC-01/AC-02) */}
                  {cancelEligible && (
                    <>
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
                              type="button"
                              variant="secondary"
                              size="sm"
                              onClick={() => setShowCancelForm(false)}
                            >
                              {t("femme.billing.history.detail.sifen.cancelDismiss")}
                            </Button>
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
                          </div>
                        </form>
                      )}
                    </>
                  )}
                  {/* SIFEN HU-10 AC-05: historical record, once the invoice is actually cancelled */}
                  {cancelHistoryVisible && (
                    <div
                      className={cancelEligible ? "pt-2 border-t border-[rgb(var(--color-border))]" : undefined}
                      data-testid="sifen-cancellation-history"
                    >
                      <Text className="font-medium">
                        {t("femme.billing.history.detail.sifen.cancellationHistoryTitle")}
                      </Text>
                      <Text variant="small" className="text-[rgb(var(--color-muted-foreground))]">
                        {t("femme.billing.history.detail.sifen.cancellationRequestedAt")}:{" "}
                        {formatParaguayDateTime(invoice.sifenCancellationRequestedAt!, dateLocale)}
                      </Text>
                      {invoice.sifenCancellationRequestedByEmail && (
                        <Text variant="small" className="text-[rgb(var(--color-muted-foreground))]">
                          {t("femme.billing.history.detail.sifen.cancellationRequestedBy")}:{" "}
                          {invoice.sifenCancellationRequestedByEmail}
                        </Text>
                      )}
                      {invoice.sifenCancellationReason && (
                        <Text variant="small" className="text-[rgb(var(--color-muted-foreground))]">
                          {t("femme.billing.history.detail.sifen.cancellationReason")}:{" "}
                          {invoice.sifenCancellationReason}
                        </Text>
                      )}
                    </div>
                  )}
                </SifenSection>
              )}
              </>
            ),
            identify: (
              <>
              {(invoice.sifenClientIdentificationEligible || identifyHistoryVisible) && (
                <SifenSection
                  data-testid="sifen-tab-identify"
                  title={t("femme.billing.history.detail.sifen.identifyClientButton")}
                >
                  {/* SIFEN HU-11 AC-01: identify the client on an invoice issued without one */}
                  {invoice.sifenClientIdentificationEligible && (
                    <>
                      {identifyError && (
                        <Alert variant="destructive" title={t("femme.billing.errorTitle")}>
                          {identifyError}
                        </Alert>
                      )}
                      {(
                        <form
                          className="flex flex-col gap-3"
                          onSubmit={(e) => void handleIdentifyClient(e)}
                          noValidate
                        >
                          {/* Issue #174 AC-03: the section header already reads
                              "Identificar cliente" — no second heading here. */}
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
                          </div>
                        </form>
                      )}
                    </>
                  )}
                  {/* SIFEN HU-11 AC-05/AC-06: last client-identification attempt, either outcome */}
                  {identifyHistoryVisible && (
                    <div
                      className={
                        invoice.sifenClientIdentificationEligible
                          ? "pt-2 border-t border-[rgb(var(--color-border))]"
                          : undefined
                      }
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
                        {formatParaguayDateTime(invoice.sifenClientIdentificationRequestedAt!, dateLocale)}
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
                </SifenSection>
              )}
              </>
            ),
            document: (
              <>
              {(invoice.sifenSubmissionStatus === "APPROVED" ||
                invoice.sifenSubmissionStatus === "APPROVED_WITH_OBSERVATION") &&
                invoice.sifenQueryDocumentContent && (
                <SifenSection
                  data-testid="sifen-tab-document"
                  title={t("femme.billing.history.detail.sifen.documentContent")}
                >
                  <pre className="max-h-40 overflow-auto rounded border border-[rgb(var(--color-border))] bg-[rgb(var(--color-muted))] p-2 text-xs whitespace-pre-wrap break-all">
                    {invoice.sifenQueryDocumentContent}
                  </pre>
                </SifenSection>
              )}
              </>
            ),
            kudeEligible,
            cancelEligible,
            cancelHistoryVisible,
            identifyHistoryVisible,
          };
        })()
      : null;

  // ── Redesigned detail: one view ─────────────────────────────────────────────────────────────
  const detailBody = invoice
    ? (() => {
        const voidAvailable =
          allowVoid &&
          invoice.status === "ISSUED" &&
          !sifenCancelEligible &&
          invoice.sifenSubmissionStatus !== "REJECTED";
        const shareAvailable = !!sifenSections?.kudeEligible;
        const cancelAvailable =
          !!sifenSections && (sifenSections.cancelEligible || sifenSections.cancelHistoryVisible);
        const revalidateAvailable = !!sifenSections && !!invoice.sifenVerificationUrl;
        const identifyAvailable =
          !!sifenSections &&
          (!!invoice.sifenClientIdentificationEligible || sifenSections.identifyHistoryVisible);
        const sampleAvailable = sifenEnvironment === "TEST" && kudeRowShown;

        type MenuItem = {
          key: string;
          label: string;
          testId: string;
          hint?: string;
          active?: boolean;
          disabled?: boolean;
          onSelect: () => void;
        };
        const menuItems: MenuItem[] = [];
        if (voidAvailable) {
          menuItems.push({
            key: "void",
            label: t("femme.billing.history.detail.voidButton"),
            testId: "invoice-menu-void",
            active: openPanels.has("void"),
            onSelect: () => togglePanel("void"),
          });
        }
        if (cancelAvailable) {
          menuItems.push({
            key: "cancel",
            label: t("femme.billing.history.detail.sifen.cancelButton"),
            testId: "invoice-menu-cancel-sifen",
            active: openPanels.has("cancel"),
            onSelect: () => togglePanel("cancel"),
          });
        }
        if (revalidateAvailable) {
          menuItems.push({
            key: "revalidate",
            label: t("femme.billing.history.detail.sifen.revalidateButton"),
            testId: "invoice-menu-revalidate",
            active: openPanels.has("revalidate"),
            onSelect: () => togglePanel("revalidate"),
          });
        }
        if (identifyAvailable) {
          menuItems.push({
            key: "identify",
            label: t("femme.billing.history.detail.sifen.identifyClientButton"),
            testId: "invoice-menu-identify",
            active: openPanels.has("identify"),
            onSelect: () => togglePanel("identify"),
          });
        }
        if (canAssignProfessionals) {
          menuItems.push({
            key: "assign",
            label: t("femme.billing.history.detail.assignProfessionals.button"),
            testId: "invoice-assign-professionals-button",
            onSelect: () => {
              setAssignProfessionalsSuccess(false);
              setShowAssignProfessionals(true);
            },
          });
        }
        if (sampleAvailable) {
          menuItems.push({
            key: "sample",
            label: sampleKudeDownloading
              ? t("femme.billing.history.detail.sifen.kudeSampleDownloading")
              : t("femme.billing.history.detail.sifen.kudeSampleDownloadButton"),
            testId: "sifen-kude-sample-download-button",
            hint: t("femme.billing.history.detail.sifen.kudeSampleHint"),
            disabled: sampleKudeDownloading,
            onSelect: () => void handleDownloadSampleKude(),
          });
        }
        menuItems.push({
          key: "tech",
          label: t("femme.billing.history.detail.technicalDetail"),
          testId: "invoice-menu-technical-detail",
          active: openPanels.has("tech"),
          onSelect: () => togglePanel("tech"),
        });

        const grossDiscount = (l: InvoiceLine) => discountMonetaryAmount(l);
        // SIFEN invoices keep the container the SIFEN specs already use; an invoice never sent to
        // SIFEN has no SIFEN section at all.
        const wrapPanels = (children: ReactNode) =>
          sifenSections ? (
            <div className="flex flex-col gap-4" data-testid="sifen-status-section">
              {children}
            </div>
          ) : (
            <>{children}</>
          );

        return (
          <div className="flex flex-col gap-4" data-testid="invoice-detail-view">
            {/* Header: who, when, one plain-language state, the total */}
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="break-words font-heading text-lg font-extrabold text-ink">
                  {invoice.clientDisplayName || t("femme.billing.invoice.noName")}
                </div>
                <div className="text-sm text-ink-3">
                  {formatParaguayDateTime(invoice.issuedAt, dateLocale)}
                  {invoice.clientRucOverride ? ` · ${invoice.clientRucOverride}` : ""}
                </div>
              </div>
              <div className="flex flex-col items-end gap-1">
                <span className="font-heading text-2xl font-extrabold tabular-nums text-ink">
                  {formatAmountDecimal(invoice.total)}
                </span>
                <span data-testid="invoice-status-badge">
                  <InvoiceStatePill invoice={invoice} />
                </span>
              </div>
            </div>
            {invoice.status === "VOIDED" && invoice.voidReason && (
              <Text variant="small" className="text-ink-3">
                {t("femme.billing.history.detail.voidReason2")}: {invoice.voidReason}
              </Text>
            )}
            {deriveInvoiceState(invoice) === "processing" && (
              <Alert variant="info" data-testid="invoice-detail-processing-note">
                {t("femme.billing.history.detail.processingNote")}
              </Alert>
            )}

            {/* A rejection is the one thing that needs the user to act: it sits on top. */}
            {sifenSections?.correct}

            {/* What was charged */}
            <section className="flex flex-col gap-2">
              <Heading as="h3" className="text-base">
                {t("femme.billing.history.detail.items")}
              </Heading>
              {invoice.clientIdentityDocumentTypeOverride === "TARJETA_DIPLOMATICA" && (
                <Text
                  variant="small"
                  data-testid="invoice-detail-tax-exempt-note"
                  className="text-ink-3"
                >
                  {t("femme.billing.history.detail.taxExemptNote")}
                </Text>
              )}
              <ul className="divide-y divide-line" data-testid="invoice-detail-lines">
                {invoice.lines.map((l) => {
                  const off = grossDiscount(l);
                  return (
                    <li key={l.id} className="flex items-start justify-between gap-3 py-2">
                      <span className="min-w-0">
                        <span className="break-words">{l.description}</span>{" "}
                        <span className="text-ink-3">× {l.quantity}</span>
                        {off && (
                          <span className="block text-xs text-ink-3">
                            {t("femme.billing.history.detail.discount")}:{" "}
                            {discountTypeLabel(l.discountType ?? "", l.discountValue ?? null) === "FIXED"
                              ? t("femme.billing.history.detail.fixedAmount")
                              : discountTypeLabel(l.discountType ?? "", l.discountValue ?? null)}{" "}
                            (−{formatAmountDecimal(off)})
                          </span>
                        )}
                      </span>
                      <span className="font-semibold tabular-nums">{formatAmountDecimal(l.lineTotal)}</span>
                    </li>
                  );
                })}
              </ul>
              <div className="flex flex-col items-end gap-1 border-t border-line pt-2 text-sm">
                {invoice.discountType !== "NONE" && (
                  <>
                    <div className="flex gap-8">
                      <span className="text-ink-3">{t("femme.billing.history.detail.subtotal")}</span>
                      <span className="tabular-nums">{formatAmountDecimal(invoice.subtotal)}</span>
                    </div>
                    <div className="flex gap-8">
                      <span className="text-ink-3">{t("femme.billing.history.detail.discount")}</span>
                      <span className="tabular-nums">
                        {discountLabel(invoice.discountType, invoice.discountValue)}
                      </span>
                    </div>
                  </>
                )}
                <div className="flex gap-8 font-semibold">
                  <span>{t("femme.billing.history.detail.total")}</span>
                  <span className="tabular-nums">{formatAmountDecimal(invoice.total)}</span>
                </div>
              </div>
            </section>

            {/* How it was paid */}
            <section className="flex flex-col gap-1">
              <Heading as="h3" className="text-base">
                {t("femme.billing.history.detail.payments")}
              </Heading>
              {invoice.payments.map((p, i) => (
                <div key={i} className="flex justify-between gap-3 text-sm">
                  <span>
                    {t(`femme.billing.invoice.paymentMethod${capitalize(p.method)}`)}
                    {p.cardBrand &&
                      ` — ${
                        p.cardBrand === "OTHER"
                          ? p.cardBrandOtherDescription
                          : t(`femme.billing.invoice.cardBrand${capitalize(p.cardBrand)}`)
                      }`}
                  </span>
                  <span className="tabular-nums">{formatAmountDecimal(p.amount)}</span>
                </div>
              ))}
            </section>

            {assignProfessionalsSuccess && (
              <Alert variant="success" data-testid="invoice-assign-professionals-success">
                {t("femme.billing.history.detail.assignProfessionals.success")}
              </Alert>
            )}

            {/* Actions: one primary, "Share" on its own, everything else behind "⋯" */}
            {(invoice.sifenSubmissionStatus === "QUEUED" ||
              invoice.sifenSubmissionStatus === "PENDING_VERIFICATION") && (
              <Text
                variant="small"
                className="text-ink-3"
                data-testid="sifen-kude-pending-validation-note"
              >
                {t("femme.billing.history.detail.sifen.kudePendingValidationNote")}
              </Text>
            )}
            {kudeError && (
              <Alert variant="destructive" title={t("femme.billing.errorTitle")}>
                {kudeError}
              </Alert>
            )}
            {sampleKudeError && (
              <Alert variant="destructive" title={t("femme.billing.errorTitle")}>
                {sampleKudeError}
              </Alert>
            )}
            <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
              {kudeRowShown ? (
                <Button
                  variant="primary"
                  size="sm"
                  disabled={kudeDownloading}
                  data-testid="sifen-kude-download-button"
                  onClick={() => void handleDownloadKude()}
                >
                  {kudeDownloading
                    ? t("femme.billing.history.detail.sifen.kudeDownloading")
                    : t("femme.billing.history.detail.sifen.kudeDownloadButton")}
                </Button>
              ) : (
                invoice.status === "ISSUED" &&
                !sifenEnabled && (
                  <Button
                    variant="primary"
                    size="sm"
                    data-testid="invoice-download-pdf-button"
                    onClick={() => void handleDownloadPdf()}
                  >
                    {t("femme.billing.history.detail.downloadPdf")}
                  </Button>
                )
              )}
              {shareAvailable && (
                <Button
                  variant="outline"
                  size="sm"
                  aria-expanded={openPanels.has("share")}
                  data-testid="invoice-share-button"
                  onClick={() => togglePanel("share")}
                >
                  {t("femme.billing.history.detail.share")}
                </Button>
              )}
              <div className="relative">
                <Button
                  variant="outline"
                  size="sm"
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  aria-label={t("femme.billing.history.detail.moreActions")}
                  data-testid="invoice-more-actions-button"
                  onClick={() => setMenuOpen((o) => !o)}
                >
                  ⋯
                </Button>
                {menuOpen && (
                  <ul
                    role="menu"
                    data-testid="invoice-more-actions-menu"
                    className="absolute left-0 top-full z-20 mt-1 min-w-64 rounded-md border border-line bg-surface py-1 shadow-lg"
                  >
                    {menuItems.map((item) => (
                      <li key={item.key} role="none">
                        <button
                          type="button"
                          role="menuitem"
                          data-testid={item.testId}
                          aria-pressed={item.active === undefined ? undefined : item.active}
                          disabled={item.disabled}
                          onClick={() => {
                            setMenuOpen(false);
                            item.onSelect();
                          }}
                          className="block min-h-11 w-full px-3 py-2 text-left text-sm hover:bg-primary-lt disabled:opacity-50"
                        >
                          {item.label}
                          {item.hint && (
                            <span
                              data-testid="sifen-kude-sample-hint"
                              className="block text-xs text-ink-3"
                            >
                              {item.hint}
                            </span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <Button variant="ghost" size="sm" className="ml-auto" onClick={onClose}>
                {t("femme.billing.history.detail.close")}
              </Button>
            </div>

            {/* Panels (the container keeps the testid the SIFEN specs already use) */}
            {wrapPanels(
              <>
            {openPanels.has("share") && shareAvailable && sifenSections?.email}

            {openPanels.has("void") && voidAvailable && (
              <form
                className="flex flex-col gap-3 rounded-lg border border-line p-4"
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
                  <Button type="button" variant="secondary" size="sm" onClick={() => closePanel("void")}>
                    {t("femme.billing.history.detail.voidCancel")}
                  </Button>
                  <Button type="submit" variant="danger" size="sm" disabled={voiding}>
                    {voiding
                      ? t("femme.billing.history.detail.voiding")
                      : t("femme.billing.history.detail.voidConfirm")}
                  </Button>
                </div>
              </form>
            )}

            {openPanels.has("cancel") && cancelAvailable && sifenSections?.cancel}
            {openPanels.has("revalidate") && revalidateAvailable && sifenSections?.revalidate}
            {openPanels.has("identify") && identifyAvailable && sifenSections?.identify}

            {openPanels.has("tech") && (
              <div className="flex flex-col gap-4" data-testid="invoice-detail-technical">
                <SifenSection
                  data-testid="invoice-technical-base"
                  title={t("femme.billing.history.detail.technicalDetail")}
                >
                  <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                    <div>
                      <dt className="text-xs font-medium text-ink-3">
                        {t("femme.billing.history.detail.fiscalStamp")}
                      </dt>
                      <dd>{invoice.fiscalStampNumber}</dd>
                    </div>
                    <div>
                      <dt className="text-xs font-medium text-ink-3">
                        {t("femme.billing.history.detail.issuedAt")}
                      </dt>
                      <dd>{formatParaguayDateTime(invoice.issuedAt, dateLocale)}</dd>
                    </div>
                  </dl>
                </SifenSection>
                {sifenSections?.status}
                {sifenSections?.document}
              </div>
            )}
              </>,
            )}
          </div>
        );
      })()
    : null;

  return (
    <>
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
        {invoice && detailBody}
      </div>
    </Modal>
    {showAssignProfessionals && invoice && (
      <AssignInvoiceProfessionalsDialog
        invoiceId={invoice.id}
        lines={invoice.lines}
        onClose={() => setShowAssignProfessionals(false)}
        onAssigned={() => {
          setShowAssignProfessionals(false);
          setAssignProfessionalsSuccess(true);
          refreshInvoiceSilently();
        }}
      />
    )}
    {showSifenHistory && (
      <Modal
        open
        onClose={() => setShowSifenHistory(false)}
        title={t("femme.billing.history.detail.sifen.historyTitle")}
      >
        <div className="flex flex-col gap-3" data-testid="sifen-history-list">
          {sifenHistoryLoading && (
            <div className="flex items-center gap-2">
              <Spinner size="sm" />
              <Text>{t("femme.billing.history.detail.sifen.historyLoading")}</Text>
            </div>
          )}
          {sifenHistoryError && (
            <Alert variant="destructive" title={t("femme.billing.errorTitle")}>
              {sifenHistoryError}
            </Alert>
          )}
          {!sifenHistoryLoading && !sifenHistoryError && sifenHistory?.length === 0 && (
            <Text variant="muted">{t("femme.billing.history.detail.sifen.historyEmpty")}</Text>
          )}
          {!sifenHistoryLoading &&
            sifenHistory?.map((entry, idx) => (
              <div
                key={idx}
                className="rounded border border-[rgb(var(--color-border))] p-2"
                data-testid="sifen-history-entry"
              >
                <Text variant="small" className="font-medium">
                  {formatParaguayDateTime(entry.occurredAt, dateLocale)} ·{" "}
                  {t(`femme.billing.history.detail.sifen.historyEventType.${entry.eventType}`)}
                </Text>
                {entry.message && (
                  <Text variant="small" className="text-[rgb(var(--color-muted-foreground))]">
                    {entry.message}
                  </Text>
                )}
              </div>
            ))}
        </div>
      </Modal>
    )}
    </>
  );
}
