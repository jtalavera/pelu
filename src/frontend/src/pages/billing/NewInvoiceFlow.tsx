import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Alert, Button, Card, Checkbox, Heading, Input, Label, Select, Text } from "@design-system";
import { femmeJson, femmePostJson } from "../../api/femmeClient";
import { translateApiError } from "../../api/parseApiErrorMessage";
import { downloadInvoicePdf } from "../../api/downloadInvoicePdf";
import { downloadSifenKude } from "../../api/downloadSifenKude";
import { validateRuc } from "../../lib/validateRuc";
import { isValidEmail } from "../../lib/validateEmail";
import { ClientSearchField, type ClientSelection } from "../../components/ClientSearchField";
import { ServiceSearchField, type SalonServiceOption } from "../../components/ServiceSearchField";
import { FieldValidationError } from "../../components/FieldValidationError";
import { FiscalRucWarning } from "../../components/FiscalRucWarning";
import { InvoiceDetailModal, type InvoiceDetail } from "../../components/InvoiceDetailModal";
import { InvoiceStatePill } from "../../components/InvoiceStatePill";
import { isSifenStatusInFlight, useSifenStatusLiveRefresh } from "../../hooks/useSifenStatusLiveRefresh";
import { formatAmountDecimal, formatDecimalGs } from "../../lib/formatMoney";
import { maskMoneyInput, parseMaskedMoney } from "../../lib/moneyInputMask";
import { useFeatureFlag } from "../../hooks/useFeatureFlags";
import { useStockAvailability } from "../../stock/useStockAvailability";
import { StockAvailabilityHint } from "../../stock/StockAvailabilityHint";
import {
  CARD_BRANDS,
  CARD_PAYMENT_METHODS,
  PAYMENT_METHODS,
  SIFEN_CLIENT_IDENTIFICATION_THRESHOLD,
  capitalize,
  issueDateOutOfRange,
  localTodayYmd,
  type InvoiceLineForm,
  type PaymentForm,
} from "./billingShared";

export type InitialClientForBilling = {
  id: number;
  fullName: string;
  phone: string | null;
  email: string | null;
  ruc: string | null;
  identityDocumentNumber?: string | null;
  identityDocumentType?: string | null;
  taxpayerType?: string | null;
};

/**
 * Same legacy derivation the backend uses (ClientIdentityDocumentType.resolve): an explicit type
 * wins, otherwise RUC if present, else Cédula paraguaya if a document number is present, else RUC
 * as the default empty state — so pre-existing clients without a stored type still preselect the
 * option that matches what they already have on file.
 */
function resolveIdentityDocumentTypeAndNumber(
  client:
    | { ruc?: string | null; identityDocumentNumber?: string | null; identityDocumentType?: string | null }
    | null
    | undefined,
): { type: string; number: string } {
  if (!client) return { type: "RUC", number: "" };
  if (client.identityDocumentType) {
    const number =
      client.identityDocumentType === "RUC"
        ? (client.ruc ?? "")
        : (client.identityDocumentNumber ?? "");
    return { type: client.identityDocumentType, number };
  }
  if (client.ruc) return { type: "RUC", number: client.ruc };
  if (client.identityDocumentNumber) {
    return { type: "CEDULA_PARAGUAYA", number: client.identityDocumentNumber };
  }
  return { type: "RUC", number: "" };
}

const IDENTITY_DOCUMENT_TYPE_OPTIONS = [
  { value: "RUC", labelKey: "femme.clients.identityDocumentTypeRuc" },
  { value: "CEDULA_PARAGUAYA", labelKey: "femme.clients.identityDocumentTypeCedulaParaguaya" },
  { value: "PASAPORTE", labelKey: "femme.clients.identityDocumentTypePasaporte" },
  { value: "CEDULA_EXTRANJERA", labelKey: "femme.clients.identityDocumentTypeCedulaExtranjera" },
  { value: "CARNET_RESIDENCIA", labelKey: "femme.clients.identityDocumentTypeCarnetResidencia" },
  { value: "TARJETA_DIPLOMATICA", labelKey: "femme.clients.identityDocumentTypeTarjetaDiplomatica" },
  { value: "OTRO", labelKey: "femme.clients.identityDocumentTypeOtro" },
  { value: "INNOMINADO", labelKey: "femme.clients.identityDocumentTypeInnominado" },
] as const;

type PrefillServiceRecordLine = {
  serviceId: number;
  description: string;
  unitPrice: string;
  /** HU-COM-10: preloaded professional of the ficha line. */
  professionalId?: number | null;
};
export type PrefillServiceRecord = {
  /** null when the prefill comes from a turno (Inicio → Cobrar) instead of a ficha. */
  serviceRecordId: number | null;
  /** null for an occasional client (turno without a registered client). */
  client: InitialClientForBilling | null;
  lines: PrefillServiceRecordLine[];
  tipsAmount: string | number;
  /** Per-professional tips of the ficha — prefill the comprobante's "Propinas" section. */
  tips?: { professionalId: number; amount: string | number }[];
};

function emptyLine(): InvoiceLineForm {
  return {
    serviceId: "",
    description: "",
    quantity: "1",
    unitPrice: "",
    pickedService: null,
    discountEnabled: false,
    discountType: "PERCENT",
    discountValue: "",
    professionalId: "",
  };
}

export function NewInvoiceFlow({
  onIssued,
  onBack,
  initialClient,
  onInitialClientConsumed,
  initialPrefillServiceRecord,
  onInitialPrefillConsumed,
  resetKey,
}: {
  onIssued: () => void;
  onBack: () => void;
  initialClient?: InitialClientForBilling | null;
  onInitialClientConsumed?: () => void;
  initialPrefillServiceRecord?: PrefillServiceRecord | null;
  onInitialPrefillConsumed?: () => void;
  /** Bumped by the parent each time "Nuevo comprobante" is clicked, to clear messages left over from a previous invoice. */
  resetKey?: number;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  /** HU-33 AC-01: once SIFEN is active, "Download PDF" always downloads the KuDE format. */
  const sifenEnabled = useFeatureFlag("SIFEN_ELECTRONIC_INVOICING");
  // HU-COM-10: professional / seller per line. The commission only accrues when the commissions
  // module is enabled, but the professional is always selectable: the "Propinas" section tips the
  // professionals who served the lines.
  const commissionsEnabled = useFeatureFlag("COMMISSIONS");
  const [lineProfessionals, setLineProfessionals] = useState<{ id: number; fullName: string; active: boolean }[]>([]);
  const effectiveInitialClient = initialClient ?? initialPrefillServiceRecord?.client ?? null;
  const initialSelection: ClientSelection = effectiveInitialClient
    ? {
        type: "client",
        client: {
          id: effectiveInitialClient.id,
          fullName: effectiveInitialClient.fullName,
          phone: effectiveInitialClient.phone,
          email: effectiveInitialClient.email,
          ruc: effectiveInitialClient.ruc,
          identityDocumentNumber: effectiveInitialClient.identityDocumentNumber,
          identityDocumentType: effectiveInitialClient.identityDocumentType,
          taxpayerType: effectiveInitialClient.taxpayerType,
        },
      }
    : null;
  const [clientSelection, setClientSelection] = useState<ClientSelection>(initialSelection);
  const [clientSearchKey, setClientSearchKey] = useState(0);
  const [linesKey, setLinesKey] = useState(0);
  const [clientDisplayName, setClientDisplayName] = useState(
    effectiveInitialClient?.fullName ?? "",
  );
  // Billing redesign: with no client chosen the invoice goes out "Sin nombre" (INNOMINADO).
  const initialDocTypeAndNumber = effectiveInitialClient
    ? resolveIdentityDocumentTypeAndNumber(effectiveInitialClient)
    : { type: "INNOMINADO", number: "" };
  const [clientIdentityDocumentType, setClientIdentityDocumentType] = useState(
    initialDocTypeAndNumber.type,
  );
  const [clientIdentityDocumentNumber, setClientIdentityDocumentNumber] = useState(
    initialDocTypeAndNumber.number,
  );
  const [clientTaxpayerType, setClientTaxpayerType] = useState(
    effectiveInitialClient?.taxpayerType ?? "PERSONA_FISICA",
  );
  // Issue #173: recipient email for this comprobante. Pre-filled from the selected client's
  // profile, editable; a new value is written back to the client on issue.
  const [clientEmail, setClientEmail] = useState(effectiveInitialClient?.email ?? "");
  const [clientEmailError, setClientEmailError] = useState<string | null>(null);
  // Issue #174 AC-04: emission date. Read-only (and "now") unless the user explicitly ticks the
  // checkbox to edit it, in which case it must stay inside SIFEN's -720h/+120h window.
  const [issueDateEditable, setIssueDateEditable] = useState(false);
  const [issueDate, setIssueDate] = useState(localTodayYmd());
  const [issueDateError, setIssueDateError] = useState<string | null>(null);
  const [serviceRecordId, setServiceRecordId] = useState<number | null>(
    initialPrefillServiceRecord?.serviceRecordId ?? null,
  );
  // Tips per professional ("Propinas" section), keyed by professional id. Prefilled from the ficha.
  const [tips, setTips] = useState<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    initialPrefillServiceRecord?.tips?.forEach((tp) => {
      if (Number(tp.amount) > 0) {
        map[String(tp.professionalId)] = maskMoneyInput(String(Math.round(Number(tp.amount))));
      }
    });
    return map;
  });

  useEffect(() => {
    if (initialClient && onInitialClientConsumed) {
      onInitialClientConsumed();
    }
    if (initialPrefillServiceRecord && onInitialPrefillConsumed) {
      onInitialPrefillConsumed();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [discountType, setDiscountType] = useState("NONE");
  const [discountValue, setDiscountValue] = useState("");
  const [discountValueError, setDiscountValueError] = useState<string | null>(null);
  const [lines, setLines] = useState<InvoiceLineForm[]>(() =>
    initialPrefillServiceRecord && initialPrefillServiceRecord.lines.length > 0
      ? [...initialPrefillServiceRecord.lines.map((l): InvoiceLineForm => ({
          serviceId: String(l.serviceId),
          description: l.description,
          quantity: "1",
          unitPrice: maskMoneyInput(String(Math.round(Number(l.unitPrice)))),
          pickedService: {
            id: l.serviceId,
            categoryId: 0,
            categoryName: "",
            categoryAccentKey: "",
            name: l.description,
            priceMinor: l.unitPrice,
            durationMinutes: 0,
            active: true,
          },
          discountEnabled: false,
          discountType: "PERCENT",
          discountValue: "",
          professionalId: l.professionalId != null ? String(l.professionalId) : "",
        })), emptyLine()]
      : [emptyLine()],
  );
  // "More options" opens by itself when a ficha prefill brings tips or professionals with it.
  const [moreOpen, setMoreOpen] = useState(
    () =>
      !!initialPrefillServiceRecord &&
      (initialPrefillServiceRecord.lines.some((l) => l.professionalId != null) ||
        (initialPrefillServiceRecord.tips ?? []).some((tp) => Number(tp.amount) > 0)),
  );
  const [splitPayments, setSplitPayments] = useState(false);
  // Loaded once an item is picked (or right away with the commissions module, as before).
  const needsLineProfessionals = commissionsEnabled || lines.some((l) => l.pickedService != null);
  useEffect(() => {
    if (!needsLineProfessionals || lineProfessionals.length > 0) return;
    femmeJson<{ id: number; fullName: string; active: boolean }[]>("/api/professionals")
      .then((list) => setLineProfessionals(Array.isArray(list) ? list.filter((p) => p.active) : []))
      .catch(() => setLineProfessionals([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsLineProfessionals]);
  // Issue #284: the payment method starts EMPTY so the user has to choose it on purpose (a silent
  // "Cash" default let invoices go out with the wrong method).
  const [payments, setPayments] = useState<PaymentForm[]>([
    { method: "", amount: "", cardBrand: "", cardBrandOtherDescription: "" },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successInvoiceNumber, setSuccessInvoiceNumber] = useState<string | null>(null);
  const [lastInvoiceId, setLastInvoiceId] = useState<number | null>(null);
  // The invoice just issued: read back so the success screen can show what was billed, and open
  // the full detail without going through the history.
  const [issuedInvoice, setIssuedInvoice] = useState<InvoiceDetail | null>(null);
  const [showIssuedDetail, setShowIssuedDetail] = useState(false);
  const [lineErrors, setLineErrors] = useState<Record<number, Record<string, string>>>({});
  const [paymentErrors, setPaymentErrors] = useState<Record<number, string>>({});
  const [globalErrors, setGlobalErrors] = useState<string[]>([]);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [rucValidForInvoicing, setRucValidForInvoicing] = useState<boolean>(true);

  useEffect(() => {
    if (resetKey === undefined) return;
    setSuccessInvoiceNumber(null);
    setLastInvoiceId(null);
    setIssuedInvoice(null);
    setShowIssuedDetail(false);
    setSubmitError(null);
    setPdfError(null);
    setGlobalErrors([]);
    setIssueDateEditable(false);
    setIssueDate(localTodayYmd());
    setIssueDateError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

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

  /**
   * Loads the display name + document type/number from a selected client's profile.
   * A client profile itself stored as "Sin identificar" (INNOMINADO) would otherwise make the
   * "Comprobante sin nominar" checkbox appear stuck checked when re-loaded here, so that case
   * falls back to RUC with a blank number — same default as no client selected.
   */
  function loadClientIdentity(client: {
    fullName: string;
    email?: string | null;
    ruc?: string | null;
    identityDocumentNumber?: string | null;
    identityDocumentType?: string | null;
    taxpayerType?: string | null;
  }) {
    setClientDisplayName(client.fullName);
    setClientEmail(client.email ?? "");
    setClientEmailError(null);
    const resolved = resolveIdentityDocumentTypeAndNumber(client);
    if (resolved.type === "INNOMINADO") {
      setClientIdentityDocumentType("RUC");
      setClientIdentityDocumentNumber("");
    } else {
      setClientIdentityDocumentType(resolved.type);
      setClientIdentityDocumentNumber(resolved.number);
    }
    setClientTaxpayerType(client.taxpayerType ?? "PERSONA_FISICA");
  }

  function handleClientSelectionChange(sel: ClientSelection) {
    setClientSelection(sel);
    if (sel?.type === "client") {
      loadClientIdentity(sel.client);
    } else if (!sel) {
      // The search box was cleared/edited: back to the default "Sin nombre" invoice.
      setClientDisplayName("");
      setClientIdentityDocumentType("INNOMINADO");
      setClientIdentityDocumentNumber("");
      setClientTaxpayerType("PERSONA_FISICA");
      setClientEmail("");
      setClientEmailError(null);
    } else if (sel?.type === "occasional") {
      setClientDisplayName("");
      setClientIdentityDocumentType("RUC");
      setClientIdentityDocumentNumber("");
      setClientTaxpayerType("PERSONA_FISICA");
      setClientEmail("");
      setClientEmailError(null);
    }
  }

  // Computed totals — mirror the backend math in InvoiceService.issueInvoice so
  // the displayed Total equals the value payments must sum to:
  //   gross line totals → per-item discounts → net subtotal → global discount.
  const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
  // Issue #174 AC-01: a "Tarjeta Diplomática de exoneración fiscal" receiver makes the sale
  // IVA-exonerada — every item and the totals are shown net of the included 10% IVA. Must mirror
  // InvoiceService.issueInvoice exactly: unitPrice / 1.10 rounded to whole guaraníes.
  const taxExemptReceiver = clientIdentityDocumentType === "TARJETA_DIPLOMATICA";
  const effectiveUnitPrice = (l: InvoiceLineForm) => {
    const raw = parseMaskedMoney(l.unitPrice);
    return taxExemptReceiver ? Math.round(raw / 1.1) : raw;
  };
  const lineGross = (l: InvoiceLineForm) =>
    (parseFloat(l.quantity) || 0) * effectiveUnitPrice(l);
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
  // Tips are collected alongside the invoice but never affect subtotal/discount/total
  // (fiscal fields), the printed comprobante, the amount to collect, or the default
  // cash payment fill — they're shown separately and settled outside the invoice math.
  // One tip per distinct professional who served a service line (same as the ficha de servicio).
  const tipProfessionalIds = Array.from(
    new Set(
      lines
        .filter((l) => l.pickedService && l.pickedService.kind !== "PRODUCT" && l.professionalId)
        .map((l) => l.professionalId),
    ),
  );
  const tipProfessionalName = (id: string) =>
    lineProfessionals.find((p) => String(p.id) === id)?.fullName ?? id;
  const tipsTotal = tipProfessionalIds.reduce(
    (acc, id) => acc + parseMaskedMoney(tips[id] ?? ""),
    0,
  );
  const showTips = serviceRecordId != null || tipsTotal > 0;
  const amountToCollect = total;

  const assignedPayments = payments.reduce(
    (acc, p) => acc + parseMaskedMoney(p.amount),
    0,
  );
  const remaining = amountToCollect - assignedPayments;

  // Issue #174 AC-02: whenever Total changes, the first payment row's "Monto" follows it
  // (covering the remaining balance after the other rows) — regardless of the first row's payment
  // method, where the old behaviour only kept a CASH first row in sync. The user can still edit it
  // afterwards for a partial payment; watching `amountToCollect` alone (not the assigned sum)
  // keeps that manual edit from being overwritten and avoids a feedback loop.
  useEffect(() => {
    if (amountToCollect <= 0) return;
    setPayments((prev) => {
      if (prev.length === 0) return prev;
      const othersTotal = prev
        .slice(1)
        .reduce((acc, p) => acc + parseMaskedMoney(p.amount), 0);
      const firstFill = Math.max(0, amountToCollect - othersTotal);
      const nextAmount = firstFill > 0 ? maskMoneyInput(firstFill.toFixed(0)) : "";
      if (prev[0].amount === nextAmount) return prev;
      return prev.map((p, i) => (i === 0 ? { ...p, amount: nextAmount } : p));
    });
  }, [amountToCollect]);

  /**
   * Whether all mandatory fields are filled to enable the "Emit" button:
   *   1. A client is selected from the directory, marked as occasional, or the invoice is
   *      marked "sin nominar".
   *   2. At least one service line with serviceId + valid unit price.
   *   3. At least one payment with method + valid positive amount.
   */
  // Issue #96: a selected client's name/RUC may be left blank on purpose (the PDF then prints
  // "Sin nombre" and a blank RUC) — selecting a client or marking it occasional is enough.
  // "Sin nominar" is its own way of skipping client identification entirely, so it also satisfies
  // this — otherwise the checkbox's whole point (no client lookup needed) can never enable submit.
  const hasClientData =
    clientSelection?.type === "client" ||
    clientSelection?.type === "occasional" ||
    clientIdentityDocumentType === "INNOMINADO";
  const hasServiceLine = lines.some((l) => {
    const price = parseMaskedMoney(l.unitPrice);
    return l.serviceId.trim() !== "" && Number.isFinite(price) && price > 0;
  });
  const hasPayment = payments.some((p) => {
    const amount = parseMaskedMoney(p.amount);
    return p.method.trim() !== "" && Number.isFinite(amount) && amount > 0;
  });
  const canSubmit = hasClientData && hasServiceLine && hasPayment;

  function removeLine(idx: number) {
    setLines((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      // Always keep one empty row at the end: it is the "search an item" box.
      if (next.length === 0 || next[next.length - 1].serviceId) next.push(emptyLine());
      return next;
    });
    setLineErrors((prev) => {
      const next = { ...prev };
      delete next[idx];
      return next;
    });
  }

  // HU-66: how many of each product are left (informative only, never blocks issuing).
  const lineServiceIds = useMemo(
    () => lines.map((l) => Number(l.serviceId)).filter((id) => Number.isFinite(id) && id > 0),
    [lines],
  );
  const stockAvailability = useStockAvailability(lineServiceIds);
  const requestedByService = useMemo(() => {
    const totals = new Map<number, number>();
    for (const l of lines) {
      const id = Number(l.serviceId);
      if (!Number.isFinite(id) || id <= 0) continue;
      totals.set(id, (totals.get(id) ?? 0) + (parseInt(l.quantity) || 0));
    }
    return totals;
  }, [lines]);

  function handleLineServiceChange(idx: number, service: SalonServiceOption | null) {
    setLines((prev) => {
      const next = prev.map((l, i) => {
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
      });
      if (service && idx === next.length - 1) next.push(emptyLine());
      return next;
    });
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
    setPayments((prev) => {
      const used = new Set(prev.map((p) => p.method));
      if (!PAYMENT_METHODS.some((m) => !used.has(m))) return prev;
      return [...prev, { method: "", amount: "", cardBrand: "", cardBrandOtherDescription: "" }];
    });
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
      prev.map((p, i) => {
        if (i !== idx) return p;
        const updated = { ...p, [field]: next };
        // Issue #170: clear the card fields when they no longer apply, so a stale brand/
        // description never rides along after switching payment method or brand.
        if (field === "method" && !CARD_PAYMENT_METHODS.has(next)) {
          updated.cardBrand = "";
          updated.cardBrandOtherDescription = "";
        }
        if (field === "cardBrand" && next !== "OTHER") {
          updated.cardBrandOtherDescription = "";
        }
        return updated;
      }),
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

    // The trailing empty row is only the "search an item" box; at least one item must be picked.
    if (!lines.some((l) => l.serviceId.trim())) {
      newLineErrors[Math.max(0, lines.length - 1)] = {
        service: t("femme.billing.invoice.lineServiceRequired"),
      };
    }

    lines.forEach((l, i) => {
      if (!l.serviceId.trim()) return;
      const fieldErrs: Record<string, string> = {};
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
        return;
      }
      // Issue #170: SIFEN rejects card payments missing the mandatory card brand group.
      if (CARD_PAYMENT_METHODS.has(p.method) && !p.cardBrand.trim()) {
        newPaymentErrors[i] = t("femme.billing.invoice.cardBrandRequired");
      } else if (
        CARD_PAYMENT_METHODS.has(p.method) &&
        p.cardBrand === "OTHER" &&
        !p.cardBrandOtherDescription.trim()
      ) {
        newPaymentErrors[i] = t("femme.billing.invoice.cardBrandOtherDescriptionRequired");
      }
    });

    {
      const isRucType = clientIdentityDocumentType === "RUC";
      const isInnominado = clientIdentityDocumentType === "INNOMINADO";
      const numberTrim = isInnominado ? "" : clientIdentityDocumentNumber.trim();
      if (isRucType && numberTrim && !validateRuc(numberTrim)) {
        errors.push(t("femme.clients.rucInvalid"));
      }
      // Issue #101: name is required only when a RUC is provided; a blank RUC allows a blank
      // name too (Issue #96: the PDF then prints "Sin nombre" for a selected client).
      if (isRucType && numberTrim && !clientDisplayName.trim()) {
        errors.push(t("femme.billing.invoice.clientDisplayNameRequiredWithRuc"));
      }
      // SIFEN HU-02 AC-05: Gs. 7.000.000+ requires identifying the client, sin excepción.
      if (total >= SIFEN_CLIENT_IDENTIFICATION_THRESHOLD && (isInnominado || !numberTrim)) {
        errors.push(t("femme.billing.invoice.clientIdentificationRequiredThreshold"));
      }
      // Issue #174 AC-01: a diplomatic-exoneration receiver must carry its card number, so the
      // exoneration the form is already applying to the amounts also reaches SIFEN.
      if (taxExemptReceiver && !numberTrim) {
        errors.push(t("femme.billing.invoice.diplomaticCardNumberRequired"));
      }
    }

    // Issue #173: with SIFEN e-invoicing enabled the KuDE is auto-emailed after approval, so a
    // recipient email is mandatory — except for a "Sin identificar" (INNOMINADO) comprobante.
    let newClientEmailError: string | null = null;
    {
      const emailTrim = clientEmail.trim();
      const emailRequired =
        sifenEnabled && clientIdentityDocumentType !== "INNOMINADO";
      if (emailRequired && !emailTrim) {
        newClientEmailError = t("femme.billing.invoice.clientEmailRequired");
      } else if (emailTrim && !isValidEmail(emailTrim)) {
        newClientEmailError = t("femme.clients.emailInvalid");
      }
    }
    setClientEmailError(newClientEmailError);

    // Issue #174 AC-04: only validated when the user chose to edit the emission date.
    let newIssueDateError: string | null = null;
    if (issueDateEditable) {
      if (!issueDate) {
        newIssueDateError = t("femme.billing.invoice.issueDateRequired");
      } else if (issueDateOutOfRange(issueDate)) {
        newIssueDateError = t("femme.billing.invoice.issueDateOutOfRange");
      }
    }
    setIssueDateError(newIssueDateError);

    // Errors that live inside "More options" must not stay hidden behind the folded section.
    if (
      newIssueDateError ||
      newDiscountValueError ||
      Object.values(newLineErrors).some((fe) => fe.discountValue)
    ) {
      setMoreOpen(true);
    }

    setLineErrors(newLineErrors);
    setPaymentErrors(newPaymentErrors);
    setGlobalErrors(errors);

    const ok =
      Object.keys(newLineErrors).length === 0 &&
      Object.keys(newPaymentErrors).length === 0 &&
      newDiscountValueError === null &&
      newClientEmailError === null &&
      newIssueDateError === null &&
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
        {
          const isRucType = clientIdentityDocumentType === "RUC";
          const numberTrim = clientIdentityDocumentNumber.trim();
          if (isRucType && numberTrim && !validateRuc(numberTrim)) {
            return "client-identity-document-number";
          }
          if (isRucType && numberTrim && !clientDisplayName.trim()) return "client-display-name";
        }
        {
          const emailTrim = clientEmail.trim();
          const emailRequired = sifenEnabled && clientIdentityDocumentType !== "INNOMINADO";
          if (
            (emailRequired && !emailTrim) ||
            (emailTrim && !isValidEmail(emailTrim))
          ) {
            return "billing-client-email";
          }
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

    const isInnominado = clientIdentityDocumentType === "INNOMINADO";
    const numberTrim = isInnominado ? "" : clientIdentityDocumentNumber.trim();
    const isRucType = clientIdentityDocumentType === "RUC";
    const payload = {
      clientId: clientSelection?.type === "client" ? clientSelection.client.id : null,
      clientDisplayName: clientDisplayName.trim() || null,
      clientRucOverride: isRucType ? numberTrim || null : null,
      clientIdentityDocumentOverride: !isRucType && !isInnominado ? numberTrim || null : null,
      clientIdentityDocumentTypeOverride: numberTrim ? clientIdentityDocumentType : null,
      clientTaxpayerTypeOverride: isRucType && numberTrim ? clientTaxpayerType : null,
      email: clientEmail.trim() || null,
      // Issue #174 AC-04: only sent when the user opted to edit the emission date — noon local
      // time on the picked day, well inside SIFEN's hour-granular window.
      issuedAt:
        issueDateEditable && issueDate
          ? new Date(`${issueDate}T12:00:00`).toISOString()
          : null,
      discountType: discountType !== "NONE" ? discountType : null,
      discountValue:
        discountType !== "NONE" && discountValue
          ? discountType === "FIXED"
            ? parseMaskedMoney(discountValue)
            : parseFloat(discountValue)
          : null,
      lines: lines.filter((l) => l.serviceId.trim() !== "").map((l) => ({
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
        professionalId: l.professionalId ? Number(l.professionalId) : null,
      })),
      payments: payments.map((p) => ({
        method: p.method,
        amount: parseMaskedMoney(p.amount),
        cardBrand: CARD_PAYMENT_METHODS.has(p.method) ? p.cardBrand : null,
        cardBrandOtherDescription:
          CARD_PAYMENT_METHODS.has(p.method) && p.cardBrand === "OTHER"
            ? p.cardBrandOtherDescription
            : null,
      })),
      serviceRecordId: serviceRecordId,
      tipsAmount: tipsTotal,
      tips: tipProfessionalIds
        .map((id) => ({ professionalId: Number(id), amount: parseMaskedMoney(tips[id] ?? "") }))
        .filter((tp) => tp.amount > 0),
    };

    setSubmitting(true);
    try {
      const result = await femmePostJson<{ id: number; invoiceNumberFormatted: string }>(
        "/api/invoices",
        payload,
      );
      setSuccessInvoiceNumber(result.invoiceNumberFormatted);
      setLastInvoiceId(result.id);
      setIssuedInvoice(null);
      femmeJson<InvoiceDetail>(`/api/invoices/${result.id}`)
        .then(setIssuedInvoice)
        .catch(() => setIssuedInvoice(null)); // the summary is a nicety: the success itself stands
      window.scrollTo({ top: 0, behavior: "smooth" });
      // Reset form
      setClientSelection(null);
      setClientSearchKey((k) => k + 1);
      setLinesKey((k) => k + 1);
      setClientDisplayName("");
      setClientIdentityDocumentType("INNOMINADO");
      setClientIdentityDocumentNumber("");
      setClientEmail("");
      setClientEmailError(null);
      setIssueDateEditable(false);
      setIssueDate(localTodayYmd());
      setIssueDateError(null);
      setDiscountType("NONE");
      setDiscountValue("");
      setDiscountValueError(null);
      setLines([emptyLine()]);
      setPayments([
        { method: "", amount: "", cardBrand: "", cardBrandOtherDescription: "" },
      ]);
      setSplitPayments(false);
      setMoreOpen(false);
      setTips({});
      setServiceRecordId(null);
      setLineErrors({});
      setPaymentErrors({});
      setGlobalErrors([]);
      onIssued();
    } catch (err) {
      setSubmitError(translateApiError(err, t, "femme.apiErrors.GENERIC"));
      // Use setTimeout to allow React to commit the state update before we scroll
      setTimeout(() => {
        document
          .getElementById("invoice-submit-error")
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 0);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDownloadLastPdf() {
    if (!lastInvoiceId) return;
    setPdfError(null);
    try {
      if (sifenEnabled) {
        await downloadSifenKude(lastInvoiceId);
      } else {
        await downloadInvoicePdf(lastInvoiceId);
      }
    } catch (err) {
      setPdfError(translateApiError(err, t, "femme.apiErrors.GENERIC"));
    }
  }


  // The state of an invoice sent to SIFEN changes on its own ("In progress" → "Approved").
  const refreshIssuedInvoice = () => {
    if (lastInvoiceId == null) return;
    femmeJson<InvoiceDetail>(`/api/invoices/${lastInvoiceId}`)
      .then(setIssuedInvoice)
      .catch(() => undefined);
  };
  useSifenStatusLiveRefresh(
    !!successInvoiceNumber && !!issuedInvoice && isSifenStatusInFlight(issuedInvoice.sifenSubmissionStatus),
    refreshIssuedInvoice,
  );

  function startAnother() {
    setSuccessInvoiceNumber(null);
    setLastInvoiceId(null);
    setIssuedInvoice(null);
    setShowIssuedDetail(false);
    setPdfError(null);
    window.scrollTo({ top: 0 });
  }

  if (successInvoiceNumber) {
    return (
      <div className="mx-auto flex w-full max-w-[560px] flex-col gap-4" data-testid="billing-invoice-success">
        <Card className="flex flex-col gap-5 p-5 sm:p-7">
          <div className="flex items-center gap-4" role="alert">
            <span
              aria-hidden="true"
              className="flex size-[52px] shrink-0 items-center justify-center rounded-full bg-success-lt text-2xl font-bold text-success"
            >
              ✓
            </span>
            <div className="min-w-0 flex-1">
              <h1 className="font-heading text-[22px] font-extrabold leading-tight text-ink">
                {t("femme.billing.invoice.successTitle")}
              </h1>
              <p className="text-sm text-ink-3">
                <span aria-hidden="true">#{successInvoiceNumber}</span>
                <span className="sr-only">{t("femme.billing.invoice.successBody", { number: successInvoiceNumber })}</span>
              </p>
            </div>
            {issuedInvoice && <InvoiceStatePill invoice={issuedInvoice} />}
          </div>
          {pdfError && (
            <Alert variant="destructive" title={t("femme.billing.errorTitle")}>
              {pdfError}
            </Alert>
          )}
          {issuedInvoice && (
            <section
              className="flex flex-col gap-3 border-t border-line pt-4"
              data-testid="billing-success-summary"
              aria-label={t("femme.billing.invoice.summaryOfIssued")}
            >
              <div>
                <div className="break-words font-semibold text-ink" data-testid="billing-success-client">
                  {issuedInvoice.clientDisplayName || t("femme.billing.invoice.noName")}
                </div>
                <div className="text-sm text-ink-3">
                  {issuedInvoice.payments
                    .map((p) => t(`femme.billing.invoice.paymentMethod${capitalize(p.method)}`))
                    .join(" + ")}
                </div>
              </div>
              <ul className="flex flex-col gap-1" data-testid="billing-success-lines">
                {issuedInvoice.lines.map((l) => (
                  <li key={l.id} className="flex items-start justify-between gap-3 text-sm">
                    <span className="min-w-0 break-words">
                      {l.description} <span className="text-ink-3">× {l.quantity}</span>
                    </span>
                    <span className="tabular-nums">{formatAmountDecimal(l.lineTotal)}</span>
                  </li>
                ))}
              </ul>
              <div className="flex items-baseline justify-between gap-3 border-t border-line pt-3">
                <span className="font-semibold">{t("femme.billing.invoice.total")}</span>
                <span
                  className="font-heading text-[26px] font-extrabold tabular-nums text-ink"
                  data-testid="billing-success-total"
                >
                  {formatAmountDecimal(issuedInvoice.total)}
                </span>
              </div>
            </section>
          )}
          <div className="flex flex-col gap-3">
            {lastInvoiceId && (
              <Button
                type="button"
                variant="primary"
                size="lg"
                className="min-h-12 w-full"
                data-testid="billing-success-download-pdf"
                onClick={() => void handleDownloadLastPdf()}
              >
                {t("femme.billing.invoice.downloadPdf")}
              </Button>
            )}
            <div className="flex gap-3">
              {lastInvoiceId && (
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  className="min-h-12 min-w-0 flex-1"
                  data-testid="billing-success-view-detail"
                  onClick={() => setShowIssuedDetail(true)}
                >
                  {t("femme.billing.invoice.viewDetail")}
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                size="lg"
                className="min-h-12 min-w-0 flex-1"
                data-testid="billing-success-new-invoice"
                onClick={startAnother}
              >
                {t("femme.billing.session.newInvoiceButton")}
              </Button>
            </div>
            <Button
              type="button"
              variant="ghost"
              className="self-center text-primary"
              data-testid="billing-success-back"
              onClick={onBack}
            >
              {t("femme.billing.invoice.backToStart")}
            </Button>
          </div>
        </Card>
        {showIssuedDetail && lastInvoiceId != null && (
          <InvoiceDetailModal
            invoiceId={lastInvoiceId}
            onClose={() => {
              setShowIssuedDetail(false);
              refreshIssuedInvoice();
            }}
            onVoided={() => {
              setShowIssuedDetail(false);
              refreshIssuedInvoice();
              onIssued();
            }}
            onCorrected={() => {
              setShowIssuedDetail(false);
              refreshIssuedInvoice();
              onIssued();
            }}
          />
        )}
      </div>
    );
  }

  const identified = clientIdentityDocumentType !== "INNOMINADO";
  const identificationRequired =
    total >= SIFEN_CLIENT_IDENTIFICATION_THRESHOLD &&
    (!identified || !clientIdentityDocumentNumber.trim());
  const filledLines = lines.filter((l) => l.serviceId.trim() !== "");
  const firstPayment = payments[0];
  const firstAmountNum = parseMaskedMoney(firstPayment?.amount ?? "");
  const firstAmountInvalid = !Number.isFinite(firstAmountNum) || firstAmountNum <= 0;
  const firstMethodMissing = !!firstPayment && firstPayment.method === "" && !firstAmountInvalid;
  const firstCardError =
    !firstAmountInvalid && paymentErrors[0] ? paymentErrors[0] : undefined;

  function renderCardFields(payment: PaymentForm, idx: number, error: string | undefined) {
    if (!CARD_PAYMENT_METHODS.has(payment.method)) return null;
    return (
      <>
        <div className="min-w-[160px] flex-1">
          <Label htmlFor={`pay-card-brand-${idx}`}>{t("femme.billing.invoice.cardBrandLabel")}</Label>
          <Select
            id={`pay-card-brand-${idx}`}
            value={payment.cardBrand}
            onChange={(e) => updatePayment(idx, "cardBrand", e.target.value)}
            className="mt-1 w-full"
            aria-invalid={!!error}
            aria-describedby={error ? `pay-card-brand-err-${idx}` : undefined}
          >
            <option value="" disabled>
              {t("femme.billing.invoice.cardBrandPlaceholder")}
            </option>
            {CARD_BRANDS.map((brand) => (
              <option key={brand} value={brand}>
                {t(`femme.billing.invoice.cardBrand${capitalize(brand)}`)}
              </option>
            ))}
          </Select>
          <FieldValidationError id={`pay-card-brand-err-${idx}`}>{error}</FieldValidationError>
        </div>
        {payment.cardBrand === "OTHER" && (
          <div className="min-w-[160px] flex-1">
            <Label htmlFor={`pay-card-brand-other-${idx}`}>
              {t("femme.billing.invoice.cardBrandOtherDescriptionLabel")}
            </Label>
            <Input
              id={`pay-card-brand-other-${idx}`}
              value={payment.cardBrandOtherDescription}
              onChange={(e) => updatePayment(idx, "cardBrandOtherDescription", e.target.value)}
              placeholder={t("femme.billing.invoice.cardBrandOtherDescriptionPlaceholder")}
              className="mt-1 w-full"
            />
          </div>
        )}
      </>
    );
  }

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      noValidate
      className="mx-auto flex w-full max-w-5xl flex-col gap-4"
    >
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="ghost" onClick={onBack} data-testid="billing-invoice-back" className="text-primary">
          ‹ {t("femme.billing.invoice.back")}
        </Button>
        <Heading as="h1" className="text-xl">
          {t("femme.billing.invoice.title")}
        </Heading>
      </div>

      {globalErrors
        // The identification rule already has its own inline warning in the client step.
        .filter(
          (err) =>
            !(identificationRequired && err === t("femme.billing.invoice.clientIdentificationRequiredThreshold")),
        )
        .map((err, i) => (
          <Alert key={i} variant="destructive" title={t("femme.billing.errorTitle")}>
            {err}
          </Alert>
        ))}
      {submitError && (
        <Alert id="invoice-submit-error" variant="destructive" title={t("femme.billing.errorTitle")}>
          {submitError}
        </Alert>
      )}
      {pdfError && (
        <Alert variant="destructive" title={t("femme.billing.errorTitle")}>
          {pdfError}
        </Alert>
      )}
      {!rucValidForInvoicing && <FiscalRucWarning />}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <div className="flex min-w-0 flex-col gap-4">
          {/* Step 1 — what was done */}
          <Card className="flex flex-col gap-3 p-4 sm:p-6" data-testid="billing-step-items">
            <Heading as="h2" className="text-lg">
              {t("femme.billing.invoice.stepItems")}
            </Heading>
            <div className="flex flex-col">
              {lines.map((line, idx) =>
                line.pickedService ? (
                  <div
                    key={`${linesKey}-${idx}`}
                    className="flex flex-col gap-2 border-b border-line py-3 first:pt-0"
                    data-testid={`billing-line-${idx}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="min-w-0 break-words font-semibold text-ink">
                        {line.pickedService.name}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeLine(idx)}
                        aria-label={t("femme.billing.invoice.removeLine")}
                      >
                        ×
                      </Button>
                    </div>
                    <div className="grid grid-cols-[5rem_minmax(0,1fr)_auto] items-start gap-3">
                      <div>
                        <Label htmlFor={`line-qty-${idx}`}>{t("femme.billing.invoice.lineQuantity")}</Label>
                        <Input
                          id={`line-qty-${idx}`}
                          type="number"
                          min="1"
                          value={line.quantity}
                          onChange={(e) => updateLine(idx, "quantity", e.target.value)}
                          className="mt-1 w-full"
                        />
                      </div>
                      <div className="min-w-0">
                        <Label htmlFor={`line-price-${idx}`}>{t("femme.billing.invoice.lineUnitPrice")}</Label>
                        <Input
                          id={`line-price-${idx}`}
                          inputMode="numeric"
                          value={line.unitPrice}
                          onChange={(e) => updateLine(idx, "unitPrice", e.target.value)}
                          placeholder={t("femme.billing.invoice.lineUnitPricePlaceholder")}
                          className="mt-1 w-full"
                          aria-invalid={!!lineErrors[idx]?.unitPrice}
                          aria-describedby={lineErrors[idx]?.unitPrice ? `line-price-err-${idx}` : undefined}
                        />
                        <FieldValidationError id={`line-price-err-${idx}`}>
                          {lineErrors[idx]?.unitPrice}
                        </FieldValidationError>
                      </div>
                      <span
                        className="pt-8 text-right font-bold tabular-nums text-ink"
                        data-testid={`line-total-${idx}`}
                      >
                        {formatDecimalGs(Math.max(0, lineGross(line) - lineDiscountAmount(line)))}
                      </span>
                    </div>
                    {line.discountEnabled && line.discountValue && (
                      <p
                        data-testid={`line-discounted-total-${idx}`}
                        className="text-sm font-medium tabular-nums text-success"
                      >
                        {t("femme.billing.invoice.lineDiscountedTotal")}:{" "}
                        {formatDecimalGs(Math.max(0, lineGross(line) - lineDiscountAmount(line)))}
                      </p>
                    )}
                    {line.serviceId && stockAvailability.has(Number(line.serviceId)) ? (
                      <StockAvailabilityHint
                        item={stockAvailability.get(Number(line.serviceId))}
                        requested={requestedByService.get(Number(line.serviceId)) ?? 0}
                        testId={`line-stock-${idx}`}
                      />
                    ) : null}
                    {commissionsEnabled && !line.professionalId && line.serviceId ? (
                      <p className="text-xs text-warning" data-testid={`line-no-commission-${idx}`}>
                        {t("femme.billing.invoice.lineNoCommission")}
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <div key={`${linesKey}-${idx}`} className="pt-3 first:pt-0">
                    <ServiceSearchField
                      id={`billing-line-svc-${idx}`}
                      value={line.pickedService}
                      onChange={(svc) => handleLineServiceChange(idx, svc)}
                      label={
                        filledLines.length > 0
                          ? t("femme.billing.invoice.addLine")
                          : t("femme.billing.invoice.lineServiceLabel")
                      }
                      placeholder={t("femme.billing.invoice.lineServicePlaceholder")}
                      invalid={!!lineErrors[idx]?.service}
                      errorDescribedById={`line-svc-err-${idx}`}
                    />
                    <FieldValidationError id={`line-svc-err-${idx}`}>
                      {lineErrors[idx]?.service}
                    </FieldValidationError>
                  </div>
                ),
              )}
            </div>
          </Card>

          {/* Step 2 — who is it for */}
          <Card className="flex flex-col gap-3 p-4 sm:p-6" data-testid="billing-step-client">
            <Heading as="h2" className="text-lg">
              {t("femme.billing.invoice.stepClient")}
            </Heading>
            <ClientSearchField
              key={clientSearchKey}
              id="billing-client-search"
              value={clientSelection}
              onChange={handleClientSelectionChange}
              activeOnly
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
            {!identified && (
              <p className="text-sm text-ink-3" data-testid="billing-client-default">
                <strong className="text-ink">{t("femme.billing.invoice.noName")}</strong> ·{" "}
                {t("femme.billing.invoice.noNameHint")}
              </p>
            )}
            {identificationRequired && (
              <p role="alert" className="rounded-md bg-warning-lt px-3 py-2 text-sm font-medium text-warning" data-testid="billing-identification-required">
                {t("femme.billing.invoice.clientIdentificationRequiredThreshold")}
              </p>
            )}
            {identified && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="client-display-name">{t("femme.billing.invoice.clientDisplayName")}</Label>
                  <Input
                    id="client-display-name"
                    value={clientDisplayName}
                    onChange={(e) => setClientDisplayName(e.target.value)}
                    placeholder={t("femme.billing.invoice.clientDisplayNamePlaceholder")}
                    className="mt-1 w-full"
                  />
                </div>
                <div>
                  <Label htmlFor="client-identity-document-type">{t("femme.clients.identityDocumentType")}</Label>
                  <Select
                    id="client-identity-document-type"
                    value={clientIdentityDocumentType}
                    onChange={(e) => setClientIdentityDocumentType(e.target.value)}
                    className="mt-1 w-full"
                  >
                    {IDENTITY_DOCUMENT_TYPE_OPTIONS.filter((opt) => opt.value !== "INNOMINADO").map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {t(opt.labelKey)}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label htmlFor="client-identity-document-number">{t("femme.clients.identityDocumentNumber")}</Label>
                  <Input
                    id="client-identity-document-number"
                    value={clientIdentityDocumentNumber}
                    onChange={(e) => setClientIdentityDocumentNumber(e.target.value)}
                    placeholder={t("femme.clients.identityDocumentNumberPlaceholder")}
                    className="mt-1 w-full"
                  />
                </div>
                {clientIdentityDocumentType === "RUC" && (
                  <div>
                    <Label htmlFor="client-taxpayer-type">{t("femme.clients.taxpayerType")}</Label>
                    <Select
                      id="client-taxpayer-type"
                      value={clientTaxpayerType}
                      onChange={(e) => setClientTaxpayerType(e.target.value)}
                      className="mt-1 w-full"
                    >
                      <option value="PERSONA_FISICA">{t("femme.clients.taxpayerTypePersonaFisica")}</option>
                      <option value="PERSONA_JURIDICA">{t("femme.clients.taxpayerTypePersonaJuridica")}</option>
                    </Select>
                  </div>
                )}
              </div>
            )}
            {sifenEnabled && identified && (
              <div>
                <Label htmlFor="billing-client-email">{t("femme.billing.invoice.clientEmailLabel")}</Label>
                <Input
                  id="billing-client-email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  value={clientEmail}
                  onChange={(e) => {
                    setClientEmail(e.target.value);
                    setClientEmailError(null);
                  }}
                  placeholder={t("femme.billing.invoice.clientEmailPlaceholder")}
                  aria-invalid={clientEmailError ? true : undefined}
                  aria-describedby={clientEmailError ? "billing-client-email-err" : "billing-client-email-hint"}
                  className="mt-1 w-full"
                />
                {clientEmailError ? (
                  <FieldValidationError id="billing-client-email-err">{clientEmailError}</FieldValidationError>
                ) : (
                  <Text id="billing-client-email-hint" variant="muted" className="mt-1 text-sm">
                    {t("femme.billing.invoice.clientEmailHint")}
                  </Text>
                )}
              </div>
            )}
          </Card>

          {/* Step 3 — how does the client pay */}
          <Card className="flex flex-col gap-3 p-4 sm:p-6" data-testid="billing-step-payment">
            <Heading as="h2" className="text-lg">
              {t("femme.billing.invoice.stepPayment")}
            </Heading>

            {!splitPayments ? (
              <>
                {/* Issue #284: no method is preselected — the user must choose it on purpose. */}
                <div
                  role="group"
                  aria-label={t("femme.billing.invoice.paymentMethod")}
                  className="grid grid-cols-2 gap-2 sm:grid-cols-5"
                >
                  {PAYMENT_METHODS.map((m) => (
                    <button
                      key={m}
                      type="button"
                      id={`pay-method-${m}`}
                      data-testid={`pay-method-${m}`}
                      aria-pressed={firstPayment?.method === m}
                      aria-invalid={firstMethodMissing || undefined}
                      aria-describedby={firstMethodMissing ? "pay-method-err-0" : undefined}
                      onClick={() => updatePayment(0, "method", m)}
                      className="min-h-14 rounded-card border-[1.5px] border-line bg-surface px-2 text-sm font-semibold text-ink hover:bg-primary-lt aria-pressed:border-primary aria-pressed:bg-primary-lt aria-pressed:text-primary-dk"
                    >
                      {t(`femme.billing.invoice.paymentMethod${capitalize(m)}`)}
                    </button>
                  ))}
                </div>
                <FieldValidationError id="pay-method-err-0">
                  {firstMethodMissing ? t("femme.billing.invoice.paymentMethodRequired") : undefined}
                </FieldValidationError>
                {firstPayment && CARD_PAYMENT_METHODS.has(firstPayment.method) && (
                  <div className="flex flex-wrap gap-3">{renderCardFields(firstPayment, 0, firstCardError)}</div>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  className="self-start text-primary"
                  data-testid="billing-split-payment"
                  onClick={() => setSplitPayments(true)}
                >
                  {t("femme.billing.invoice.splitPayment")}
                </Button>
              </>
            ) : (
              <>
                <div className="flex flex-col gap-3">
                  {payments.map((payment, idx) => {
                    const amountNum = parseMaskedMoney(payment.amount);
                    const amountIsInvalid = !Number.isFinite(amountNum) || amountNum <= 0;
                    const methodMissing = payment.method === "" && !amountIsInvalid;
                    const cardError = !amountIsInvalid && paymentErrors[idx] ? paymentErrors[idx] : undefined;
                    return (
                      <div key={idx} className="flex flex-wrap items-start gap-2">
                        <div className="min-w-[160px] flex-1">
                          <Label htmlFor={`pay-method-${idx}`}>{t("femme.billing.invoice.paymentMethod")}</Label>
                          <Select
                            id={`pay-method-${idx}`}
                            value={payment.method}
                            onChange={(e) => updatePayment(idx, "method", e.target.value)}
                            className="mt-1 w-full"
                            aria-invalid={methodMissing}
                            aria-describedby={methodMissing ? `pay-method-err-${idx}` : undefined}
                          >
                            <option value="" disabled>
                              {t("femme.billing.invoice.paymentMethodPlaceholder")}
                            </option>
                            {PAYMENT_METHODS.map((m) => (
                              <option key={m} value={m} disabled={payments.some((p, i) => i !== idx && p.method === m)}>
                                {t(`femme.billing.invoice.paymentMethod${capitalize(m)}`)}
                              </option>
                            ))}
                          </Select>
                          <FieldValidationError id={`pay-method-err-${idx}`}>
                            {methodMissing ? t("femme.billing.invoice.paymentMethodRequired") : undefined}
                          </FieldValidationError>
                        </div>
                        <div className="min-w-[120px] flex-1">
                          <Label htmlFor={`pay-amount-${idx}`}>{t("femme.billing.invoice.paymentAmount")}</Label>
                          <Input
                            id={`pay-amount-${idx}`}
                            inputMode="numeric"
                            value={payment.amount}
                            onChange={(e) => updatePayment(idx, "amount", e.target.value)}
                            placeholder={t("femme.billing.invoice.paymentAmountPlaceholder")}
                            className="mt-1 w-full"
                            aria-invalid={amountIsInvalid && !!paymentErrors[idx]}
                            aria-describedby={
                              idx === 0
                                ? "pay-amount-0-hint"
                                : amountIsInvalid && paymentErrors[idx]
                                  ? `pay-amount-err-${idx}`
                                  : undefined
                            }
                          />
                          {idx === 0 ? (
                            <Text id="pay-amount-0-hint" variant="muted" className="mt-1 text-sm">
                              {t("femme.billing.invoice.paymentAmountFirstRowHint")}
                            </Text>
                          ) : (
                            <FieldValidationError id={`pay-amount-err-${idx}`}>
                              {amountIsInvalid ? paymentErrors[idx] : undefined}
                            </FieldValidationError>
                          )}
                        </div>
                        {renderCardFields(payment, idx, cardError)}
                        {payments.length > 1 && (
                          <div className="flex items-end pb-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => removePayment(idx)}
                              aria-label={t("femme.billing.invoice.removePayment")}
                            >
                              ×
                            </Button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={addPayment}
                    disabled={payments.length >= PAYMENT_METHODS.length}
                  >
                    {t("femme.billing.invoice.addPayment")}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="text-primary"
                    data-testid="billing-single-payment"
                    onClick={() => {
                      setSplitPayments(false);
                      setPayments((prev) => prev.slice(0, 1));
                      setPaymentErrors({});
                    }}
                  >
                    {t("femme.billing.invoice.singlePayment")}
                  </Button>
                </div>
              </>
            )}
          </Card>

          {/* More options — everything that is rarely needed stays folded away. */}
          <details
            open={moreOpen}
            onToggle={(e) => setMoreOpen((e.currentTarget as HTMLDetailsElement).open)}
            data-testid="billing-more-options"
            className="group rounded-card border border-dashed border-line bg-surface"
          >
            <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-4 font-semibold text-primary sm:px-6 [&::-webkit-details-marker]:hidden">
              <span aria-hidden className="transition-transform group-open:rotate-90">›</span>
              {t("femme.billing.invoice.moreOptions")}
              <span className="hidden text-sm font-normal text-ink-3 sm:inline">
                {t("femme.billing.invoice.moreOptionsHint")}
              </span>
            </summary>
            <div className="flex flex-col gap-6 px-4 pb-5 pt-2 sm:px-6">
              {/* Issue #174 AC-04: emission date — read-only unless explicitly unlocked. */}
              <section className="flex flex-col gap-2">
                <Heading as="h3" className="text-base">
                  {t("femme.billing.invoice.issueDateSection")}
                </Heading>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                  <div className="min-w-[160px]">
                    <Label htmlFor="billing-issue-date">{t("femme.billing.invoice.issueDateLabel")}</Label>
                    <Input
                      id="billing-issue-date"
                      type="date"
                      value={issueDate}
                      onChange={(e) => {
                        setIssueDate(e.target.value);
                        setIssueDateError(null);
                      }}
                      disabled={!issueDateEditable}
                      aria-invalid={issueDateError ? true : undefined}
                      aria-describedby={issueDateError ? "billing-issue-date-err" : undefined}
                      className="mt-1 w-full"
                    />
                  </div>
                  <label
                    htmlFor="billing-issue-date-editable"
                    className="flex min-h-11 cursor-pointer items-center gap-2 text-sm"
                  >
                    <Checkbox
                      id="billing-issue-date-editable"
                      checked={issueDateEditable}
                      onChange={(e) => {
                        const on = e.target.checked;
                        setIssueDateEditable(on);
                        setIssueDateError(null);
                        if (!on) setIssueDate(localTodayYmd());
                      }}
                    />
                    {t("femme.billing.invoice.issueDateEditableToggle")}
                  </label>
                </div>
                <FieldValidationError id="billing-issue-date-err">{issueDateError}</FieldValidationError>
                {sifenEnabled && (
                  <Text variant="muted" className="text-sm">
                    {t("femme.billing.invoice.issueDateLegend")}
                  </Text>
                )}
              </section>

              <section className="flex flex-col gap-2">
                <Heading as="h3" className="text-base">
                  {t("femme.billing.invoice.discountSection")}
                </Heading>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                      <Label htmlFor="discount-value">{t("femme.billing.invoice.discountValue")}</Label>
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
                      <FieldValidationError id="discount-value-err">{discountValueError}</FieldValidationError>
                    </div>
                  )}
                </div>
              </section>

              {filledLines.length > 0 && (
                <section className="flex flex-col gap-3" data-testid="billing-per-item-options">
                  <Heading as="h3" className="text-base">
                    {t("femme.billing.invoice.perItemOptions")}
                  </Heading>
                  {lines.map((line, idx) =>
                    line.pickedService ? (
                      <div key={`${linesKey}-opt-${idx}`} className="flex flex-col gap-2 rounded-md border border-line p-3">
                        <span className="font-semibold text-ink">{line.pickedService.name}</span>
                        <div className="flex flex-wrap items-center gap-3">
                          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-ink-2">
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
                                className="min-h-11 rounded-md border border-line bg-surface px-2 text-sm"
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
                                aria-describedby={lineErrors[idx]?.discountValue ? `line-disc-amt-err-${idx}` : undefined}
                                className="w-28"
                              />
                            </>
                          )}
                        </div>
                        <FieldValidationError id={`line-disc-amt-err-${idx}`}>
                          {lineErrors[idx]?.discountValue}
                        </FieldValidationError>
                        <div className="flex flex-col gap-1 sm:max-w-sm">
                          <Label htmlFor={`line-professional-${idx}`}>{t("femme.billing.invoice.lineProfessional")}</Label>
                          <Select
                            id={`line-professional-${idx}`}
                            value={line.professionalId}
                            onChange={(e) =>
                              setLines((prev) =>
                                prev.map((l, i) => (i === idx ? { ...l, professionalId: e.target.value } : l)),
                              )
                            }
                          >
                            <option value="">{t("femme.billing.invoice.lineProfessionalNone")}</option>
                            {lineProfessionals.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.fullName}
                              </option>
                            ))}
                          </Select>
                        </div>
                      </div>
                    ) : null,
                  )}
                </section>
              )}

              {/* Tips — one per professional who served a service line; never added to the total. */}
              <section className="flex flex-col gap-2" data-testid="billing-tips-section">
                <Heading as="h3" className="text-base">
                  {t("femme.billing.invoice.tipsSection")}
                </Heading>
                {tipProfessionalIds.length === 0 ? (
                  <Text variant="muted" className="text-sm" data-testid="billing-tips-empty">
                    {t("femme.billing.invoice.tipsEmpty")}
                  </Text>
                ) : (
                  <div className="flex flex-col gap-3">
                    {tipProfessionalIds.map((id) => (
                      <div key={id} className="flex flex-wrap items-center gap-3">
                        <Label htmlFor={`billing-tip-${id}`} className="min-w-[160px] text-sm font-medium">
                          {tipProfessionalName(id)}
                        </Label>
                        <Input
                          id={`billing-tip-${id}`}
                          inputMode="numeric"
                          value={tips[id] ?? ""}
                          onChange={(e) => setTips((prev) => ({ ...prev, [id]: maskMoneyInput(e.target.value) }))}
                          placeholder="0"
                          aria-label={`${t("femme.billing.invoice.tipsAmountLabel")} — ${tipProfessionalName(id)}`}
                          className="w-32"
                        />
                      </div>
                    ))}
                  </div>
                )}
                {tipsTotal > 0 && (
                  <div className="flex justify-between text-sm font-semibold text-danger">
                    <span>{t("femme.billing.invoice.tipsTotal")}</span>
                    <span data-testid="billing-tips-total">{formatAmountDecimal(tipsTotal.toFixed(2))}</span>
                  </div>
                )}
              </section>
            </div>
          </details>
        </div>

        {/* Summary */}
        <aside aria-label={t("femme.billing.invoice.summary")} className="lg:sticky lg:top-4">
          <Card className="flex flex-col gap-2 p-4 text-sm sm:p-6">
            <Heading as="h2" className="text-base">
              {t("femme.billing.invoice.summary")}
            </Heading>
            {taxExemptReceiver && (
              <Text data-testid="billing-tax-exempt-note" variant="muted" className="text-sm">
                {t("femme.billing.invoice.taxExemptNote")}
              </Text>
            )}
            <div className="flex justify-between">
              <span className="text-ink-3">{t("femme.billing.invoice.subtotal")}</span>
              <span className="tabular-nums">{formatAmountDecimal(subtotal.toFixed(2))}</span>
            </div>
            {discountAmount > 0 && (
              <div className="flex justify-between">
                <span className="text-ink-3">{t("femme.billing.invoice.discount")}</span>
                <span className="tabular-nums">-{formatAmountDecimal(discountAmount.toFixed(2))}</span>
              </div>
            )}
            <div className="flex justify-between font-semibold">
              <span>{t("femme.billing.invoice.total")}</span>
              <span className="tabular-nums">{formatAmountDecimal(total.toFixed(2))}</span>
            </div>
            {showTips && (
              <div className="flex justify-between">
                <span className="text-danger">{t("femme.billing.invoice.tips")}</span>
                <span id="billing-tips-amount" className="tabular-nums text-danger">
                  {formatAmountDecimal(tipsTotal.toFixed(2))}
                </span>
              </div>
            )}
            {(splitPayments || Math.abs(remaining) > 0.01) && (
              <div
                className={`flex justify-between ${Math.abs(remaining) > 0.01 ? "text-danger" : "text-success"}`}
              >
                <span>{t("femme.billing.invoice.remaining")}</span>
                <span className="tabular-nums">{formatAmountDecimal(remaining.toFixed(2))}</span>
              </div>
            )}
          </Card>
        </aside>
      </div>

      {/* Total + primary action, always within reach. */}
      <div className="sticky bottom-0 z-10 -mx-3 border-t border-line bg-surface px-4 py-3 shadow-[0_-4px_16px_rgba(10,31,51,0.08)] sm:mx-0 sm:rounded-card sm:border">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm text-ink-3">{t("femme.billing.invoice.total")}</div>
            <div className="font-heading text-2xl font-extrabold tabular-nums text-ink" data-testid="billing-total">
              {formatDecimalGs(total)}
            </div>
          </div>
          <Button
            type="submit"
            variant="primary"
            size="lg"
            className="min-h-12 min-w-40"
            disabled={submitting || !canSubmit}
            data-testid="billing-invoice-submit"
          >
            {submitting ? t("femme.billing.invoice.submitting") : t("femme.billing.invoice.submit")}
          </Button>
        </div>
      </div>
    </form>
  );
}
