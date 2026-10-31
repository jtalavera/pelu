import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Alert, Button, Input, Label, Text, Textarea } from "@design-system";
import { femmeJson } from "../api/femmeClient";
import { translateApiError } from "../api/parseApiErrorMessage";
import {
  createServiceRecord,
  updateServiceRecord,
  voidServiceRecord,
  type ServiceRecordDetail,
} from "../api/serviceRecords";
import { ClientSearchField, type ClientSelection } from "./ClientSearchField";
import { ServiceSearchField, type SalonServiceOption } from "./ServiceSearchField";
import { SearchableSelect } from "./SearchableSelect";
import { FieldValidationError } from "./FieldValidationError";
import { StatusBadge } from "./StatusBadge";
import { useDateLocale } from "../i18n/dateLocale";
import { formatAmountDecimal } from "../lib/formatMoney";
import { maskMoneyInput, parseMaskedMoney } from "../lib/moneyInputMask";
import { formatParaguayDateTime } from "../lib/paraguayDateTime";
import { billServiceRecord } from "../lib/serviceRecordBilling";

type Professional = { id: number; fullName: string; active: boolean };

type LineForm = {
  key: string;
  pickedService: SalonServiceOption | null;
  professionalId: number | "";
  quantity: number;
  unitPrice: string;
};

let keySeq = 0;
function nextKey(): string {
  keySeq += 1;
  return `line-${keySeq}`;
}

function emptyLine(): LineForm {
  return {
    key: nextKey(),
    pickedService: null,
    professionalId: "",
    quantity: 1,
    unitPrice: "",
  };
}

type ClientOverride = {
  id: number;
  fullName: string;
  phone: string | null;
  email: string | null;
  ruc: string | null;
};

const SECTION_TITLE = "text-xs font-extrabold uppercase tracking-wider text-primary";

/**
 * Service-record form (create / edit / read-only), meant to live inside a dialog. Layout: a
 * CLIENTE block, a SERVICIOS block (quantity + unit price on every line) and tips behind
 * "Más opciones". The host closes the dialog and shows the success notice via `onSaved` /
 * `onVoided`.
 */
export function ServiceRecordEditor({
  initial,
  allowClientCreateNew,
  initialClientOverride,
  onInitialClientOverrideConsumed,
  onSaved,
  onVoided,
  onClose,
}: {
  initial: ServiceRecordDetail | null;
  allowClientCreateNew: boolean;
  /** Client selected after returning from the "create new client" round trip. */
  initialClientOverride?: ClientOverride | null;
  onInitialClientOverrideConsumed?: () => void;
  onSaved?: (record: ServiceRecordDetail, kind: "created" | "updated") => void;
  onVoided?: (record: ServiceRecordDetail) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const dateLocale = useDateLocale();
  const topRef = useRef<HTMLDivElement>(null);

  const [record, setRecord] = useState<ServiceRecordDetail | null>(initial);
  const [professionals, setProfessionals] = useState<Professional[]>([]);

  const [clientSelection, setClientSelection] = useState<ClientSelection>(
    initial
      ? {
          type: "client",
          client: {
            id: initial.clientId,
            fullName: initial.clientFullName,
            phone: null,
            email: null,
            ruc: null,
          },
        }
      : null,
  );
  const [lines, setLines] = useState<LineForm[]>(() =>
    initial && initial.lines.length > 0
      ? initial.lines.map((l) => ({
          key: nextKey(),
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
          professionalId: l.professionalId ?? "",
          quantity: l.quantity,
          unitPrice: maskMoneyInput(String(Math.round(Number(l.unitPrice)))),
        }))
      : [emptyLine()],
  );
  const [tips, setTips] = useState<Record<number, string>>(() => {
    const map: Record<number, string> = {};
    initial?.tips.forEach((tp) => {
      map[tp.professionalId] = maskMoneyInput(String(Math.round(Number(tp.amount))));
    });
    return map;
  });
  const [moreOpen, setMoreOpen] = useState(false);

  const [clientError, setClientError] = useState<string | null>(null);
  const [lineErrors, setLineErrors] = useState<Record<number, { service?: string }>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [actionsOpen, setActionsOpen] = useState(false);
  const [showVoidForm, setShowVoidForm] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [voidReasonError, setVoidReasonError] = useState<string | null>(null);
  const [voiding, setVoiding] = useState(false);
  const [voidError, setVoidError] = useState<string | null>(null);

  useEffect(() => {
    femmeJson<Professional[]>("/api/professionals")
      .then((list) => setProfessionals((Array.isArray(list) ? list : []).filter((p) => p.active)))
      .catch(() => setProfessionals([]));
  }, []);

  useEffect(() => {
    if (initialClientOverride) {
      setClientSelection({ type: "client", client: initialClientOverride });
      setClientError(null);
      onInitialClientOverrideConsumed?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialClientOverride]);

  // Keep the tips map in sync with the distinct professionals currently on the lines.
  const distinctProfessionalIds = useMemo(() => {
    const ids = new Set<number>();
    lines.forEach((l) => {
      if (l.professionalId !== "") ids.add(l.professionalId);
    });
    return [...ids];
  }, [lines]);

  useEffect(() => {
    setTips((prev) => {
      const next: Record<number, string> = {};
      distinctProfessionalIds.forEach((id) => {
        next[id] = prev[id] ?? "";
      });
      return next;
    });
  }, [distinctProfessionalIds]);

  const isOpen = record ? record.status === "OPEN" : true;
  const isReadOnly = record != null && record.status !== "OPEN";

  const lineSubtotal = (l: LineForm) =>
    l.pickedService ? parseMaskedMoney(l.unitPrice) * (l.quantity || 0) : 0;
  const total = lines.reduce((acc, l) => acc + lineSubtotal(l), 0);
  const tipsTotal = distinctProfessionalIds.reduce(
    (acc, id) => acc + parseMaskedMoney(tips[id] ?? ""),
    0,
  );

  function professionalName(id: number | ""): string {
    if (id === "") return "—";
    return professionals.find((p) => p.id === id)?.fullName ?? String(id);
  }

  function addLine() {
    setLines((prev) => [...prev, emptyLine()]);
  }

  function removeLine(key: string) {
    setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.key !== key) : prev));
  }

  function updateLineService(key: string, service: SalonServiceOption | null) {
    setLines((prev) =>
      prev.map((l) =>
        l.key === key
          ? {
              ...l,
              pickedService: service,
              unitPrice: service
                ? maskMoneyInput(String(Math.round(Number(service.priceMinor))))
                : "",
              quantity: service ? 1 : l.quantity,
            }
          : l,
      ),
    );
  }

  function updateLineProfessional(key: string, professionalId: number | "") {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, professionalId } : l)));
  }

  function updateLineQuantity(key: string, quantity: number) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, quantity } : l)));
  }

  function updateLineUnitPrice(key: string, raw: string) {
    setLines((prev) =>
      prev.map((l) => (l.key === key ? { ...l, unitPrice: maskMoneyInput(raw) } : l)),
    );
  }

  function validate(): boolean {
    let ok = true;
    if (clientSelection?.type !== "client") {
      setClientError(t("femme.serviceRecords.clientRequired"));
      ok = false;
    } else {
      setClientError(null);
    }
    const newLineErrors: Record<number, { service?: string }> = {};
    lines.forEach((l, idx) => {
      if (!l.pickedService) newLineErrors[idx] = { service: t("femme.serviceRecords.lineServiceRequired") };
    });
    setLineErrors(newLineErrors);
    if (Object.keys(newLineErrors).length > 0) ok = false;
    return ok;
  }

  /** Validates and saves; returns the saved record, or null when validation / the request failed. */
  async function persist(): Promise<ServiceRecordDetail | null> {
    setSaveError(null);
    if (!validate() || clientSelection?.type !== "client") return null;
    const payload = {
      clientId: clientSelection.client.id,
      lines: lines.map((l) => ({
        serviceId: l.pickedService!.id,
        professionalId: l.professionalId === "" ? null : l.professionalId,
        quantity: l.quantity || null,
        unitPrice:
          l.unitPrice && parseMaskedMoney(l.unitPrice) > 0 ? parseMaskedMoney(l.unitPrice) : null,
      })),
      tips: distinctProfessionalIds.map((id) => ({
        professionalId: id,
        amount: parseMaskedMoney(tips[id] ?? ""),
      })),
    };
    setSaving(true);
    try {
      return record == null
        ? await createServiceRecord(payload)
        : await updateServiceRecord(record.id, payload);
    } catch (err) {
      setSaveError(translateApiError(err, t, "femme.apiErrors.GENERIC"));
      topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function handleSave() {
    const wasCreate = record == null;
    const result = await persist();
    if (result) onSaved?.(result, wasCreate ? "created" : "updated");
  }

  /** "Cobrar": saves any pending edits first, then opens Facturación with the record prefilled. */
  async function handlePay() {
    if (!record) return;
    const result = await persist();
    if (result) await billServiceRecord(navigate, result);
  }

  async function handleVoid(e: React.FormEvent) {
    e.preventDefault();
    if (!record) return;
    setVoidError(null);
    if (!voidReason.trim()) {
      setVoidReasonError(t("femme.serviceRecords.voidReasonRequired"));
      return;
    }
    setVoidReasonError(null);
    setVoiding(true);
    try {
      const result = await voidServiceRecord(record.id, voidReason.trim());
      setRecord(result);
      onVoided?.(result);
    } catch (err) {
      setVoidError(translateApiError(err, t, "femme.apiErrors.GENERIC"));
    } finally {
      setVoiding(false);
    }
  }

  const statusLine = record ? (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span data-testid="service-record-status">
        <StatusBadge status={record.status} />
      </span>
      {record.status === "VOIDED" && record.voidReason ? (
        <Text variant="small" className="text-ink-3">
          {t("femme.serviceRecords.voidedReasonLabel")}: {record.voidReason}
        </Text>
      ) : null}
      {record.status === "CLOSED" && record.invoiceNumberFormatted ? (
        <Text variant="small" className="text-ink-3">
          {t("femme.serviceRecords.linkedInvoice")}: {record.invoiceNumberFormatted}
        </Text>
      ) : null}
      <Text variant="small" className="text-ink-3">
        {t("femme.serviceRecords.createdAt")}: {formatParaguayDateTime(record.createdAt, dateLocale)}
      </Text>
    </div>
  ) : null;

  if (isReadOnly && record) {
    const tipRows = record.tips.filter((tp) => Number(tp.amount) > 0);
    return (
      <div ref={topRef} className="flex flex-col gap-4" data-testid="service-record-readonly">
        {statusLine}
        <section className="flex flex-col gap-2" aria-labelledby="sr-client-h">
          <h3 id="sr-client-h" className={SECTION_TITLE}>
            {t("femme.serviceRecords.clientSection")}
          </h3>
          <div className="font-semibold text-ink">{record.clientFullName}</div>
        </section>
        <section className="flex flex-col gap-2 border-t border-line pt-4" aria-labelledby="sr-lines-h">
          <h3 id="sr-lines-h" className={SECTION_TITLE}>
            {t("femme.serviceRecords.linesSection")}
          </h3>
          <ul className="flex flex-col" role="list">
            {record.lines.map((l) => (
              <li
                key={l.id}
                className="flex justify-between gap-3 border-t border-line py-2 first:border-t-0"
              >
                <span className="min-w-0 break-words text-ink">
                  {l.description}
                  {l.professionalName ? ` · ${l.professionalName}` : ""}
                  {l.quantity > 1 ? ` ×${l.quantity}` : ""}
                </span>
                <span className="shrink-0 font-semibold">{formatAmountDecimal(l.lineTotal)}</span>
              </li>
            ))}
            {tipRows.map((tp) => (
              <li
                key={`tip-${tp.professionalId}`}
                className="flex justify-between gap-3 border-t border-line py-2 text-sm text-ink-3"
              >
                <span>
                  {t("femme.serviceRecords.tipsAmountLabel")} · {tp.professionalName}
                </span>
                <span>{formatAmountDecimal(tp.amount)}</span>
              </li>
            ))}
          </ul>
          <div className="flex justify-between font-heading text-lg font-extrabold">
            <span>{t("femme.serviceRecords.total")}</span>
            <span>{formatAmountDecimal(record.totalAmount)}</span>
          </div>
        </section>
        <div className="flex justify-end">
          <Button
            type="button"
            variant="secondary"
            className="min-h-11"
            onClick={onClose}
            data-testid="service-record-close"
          >
            {t("femme.serviceRecords.close")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div ref={topRef} className="flex flex-col gap-4">
      {statusLine}
      {saveError ? (
        <Alert variant="destructive" title={t("femme.serviceRecords.errorTitle")}>
          {saveError}
        </Alert>
      ) : null}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void handleSave();
        }}
        noValidate
        className="flex flex-col gap-4"
      >
        <section className="flex flex-col gap-2" aria-labelledby="sr-client-h">
          <h3 id="sr-client-h" className={SECTION_TITLE}>
            {t("femme.serviceRecords.clientSection")}
          </h3>
          <ClientSearchField
            id="service-record-client-search"
            value={clientSelection}
            onChange={(sel) => {
              setClientSelection(sel);
              setClientError(null);
            }}
            activeOnly
            hideOccasional
            onCreateNew={
              allowClientCreateNew
                ? (q) =>
                    navigate("/app/clients", {
                      state: {
                        openCreateClient: true,
                        prefilledName: q,
                        returnTo: "/app/service-records",
                        returnTab: "new",
                      },
                    })
                : undefined
            }
            label={t("femme.serviceRecords.clientSearchLabel")}
            placeholder={t("femme.serviceRecords.clientPlaceholder")}
          />
          <FieldValidationError id="service-record-client-err">{clientError}</FieldValidationError>
        </section>

        <section className="flex flex-col gap-3 border-t border-line pt-4" aria-labelledby="sr-lines-h">
          <h3 id="sr-lines-h" className={SECTION_TITLE}>
            {t("femme.serviceRecords.linesSection")}
          </h3>
          {lines.map((line, idx) => (
            <div
              key={line.key}
              data-testid="service-record-line"
              className="flex flex-col gap-3 rounded-xl border border-line p-3"
            >
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <ServiceSearchField
                    id={`service-record-line-svc-${idx}`}
                    value={line.pickedService}
                    onChange={(svc) => updateLineService(line.key, svc)}
                    invalid={!!lineErrors[idx]?.service}
                    errorDescribedById={`service-record-line-svc-err-${idx}`}
                  />
                  <FieldValidationError id={`service-record-line-svc-err-${idx}`}>
                    {lineErrors[idx]?.service}
                  </FieldValidationError>
                </div>
                <SearchableSelect<number>
                  id={`service-record-line-prof-${idx}`}
                  label={t("femme.serviceRecords.lineProfessionalLabel")}
                  value={line.professionalId}
                  onChange={(v) => updateLineProfessional(line.key, v)}
                  options={professionals.map((p) => ({ value: p.id, label: p.fullName }))}
                  filterPlaceholder={t("femme.serviceRecords.lineProfessionalPlaceholder")}
                  noResultsText={t("femme.serviceRecords.lineProfessionalNoResults")}
                />
              </div>
              <div className="grid grid-cols-[6rem_minmax(0,1fr)] items-end gap-3 sm:grid-cols-[6rem_minmax(0,1fr)_auto]">
                <div>
                  <Label htmlFor={`service-record-line-qty-${idx}`}>
                    {t("femme.serviceRecords.lineQuantityLabel")}
                  </Label>
                  <Input
                    id={`service-record-line-qty-${idx}`}
                    type="number"
                    min={1}
                    step={1}
                    inputMode="numeric"
                    value={line.quantity}
                    onChange={(e) =>
                      updateLineQuantity(line.key, Math.max(0, Math.floor(Number(e.target.value))))
                    }
                  />
                </div>
                <div>
                  <Label htmlFor={`service-record-line-price-${idx}`}>
                    {t("femme.serviceRecords.lineUnitPriceLabel")}
                  </Label>
                  <Input
                    id={`service-record-line-price-${idx}`}
                    inputMode="numeric"
                    value={line.unitPrice}
                    placeholder="0"
                    onChange={(e) => updateLineUnitPrice(line.key, e.target.value)}
                  />
                </div>
                <div
                  className="col-span-2 flex items-center justify-between sm:col-span-1 sm:flex-col sm:items-end sm:justify-end"
                  data-testid="service-record-line-subtotal"
                >
                  <span className="text-xs text-ink-3">{t("femme.serviceRecords.lineSubtotal")}</span>
                  <b className="font-heading">{formatAmountDecimal(lineSubtotal(line).toFixed(2))}</b>
                </div>
              </div>
              {lines.length > 1 ? (
                <button
                  type="button"
                  onClick={() => removeLine(line.key)}
                  aria-label={t("femme.serviceRecords.removeLine")}
                  data-testid="service-record-line-remove"
                  className="min-h-11 self-end px-1 text-sm font-semibold text-danger underline underline-offset-4"
                >
                  {t("femme.serviceRecords.removeLine")}
                </button>
              ) : null}
            </div>
          ))}
          <button
            type="button"
            onClick={addLine}
            data-testid="service-record-add-line"
            className="min-h-11 self-start px-1 text-sm font-bold text-primary underline underline-offset-4"
          >
            + {t("femme.serviceRecords.addLine")}
          </button>
          <div className="flex justify-between font-heading text-lg font-extrabold" data-testid="service-record-total">
            <span>{t("femme.serviceRecords.total")}</span>
            <span>{formatAmountDecimal(total.toFixed(2))}</span>
          </div>
        </section>

        <div className="border-t border-line">
          <button
            type="button"
            data-testid="service-record-more-toggle"
            aria-expanded={moreOpen}
            aria-controls="service-record-more"
            onClick={() => setMoreOpen((v) => !v)}
            className="flex min-h-11 w-full items-center justify-between text-left font-semibold text-ink"
          >
            {t("femme.serviceRecords.moreOptions")}
            <span aria-hidden="true" className={`transition-transform ${moreOpen ? "rotate-180" : ""}`}>
              ⌄
            </span>
          </button>
          {moreOpen ? (
            <div id="service-record-more" className="flex flex-col gap-3 pb-2">
              <h4 className="font-heading text-base font-bold">{t("femme.serviceRecords.tipsSection")}</h4>
              {distinctProfessionalIds.length === 0 ? (
                <Text variant="muted" className="text-sm">
                  {t("femme.serviceRecords.tipsNeedProfessional")}
                </Text>
              ) : (
                distinctProfessionalIds.map((id) => (
                  <div key={id}>
                    <Label htmlFor={`service-record-tip-${id}`}>
                      {t("femme.serviceRecords.tipsAmountLabel")} · {professionalName(id)}
                    </Label>
                    <Input
                      id={`service-record-tip-${id}`}
                      inputMode="numeric"
                      value={tips[id] ?? ""}
                      onChange={(e) =>
                        setTips((prev) => ({ ...prev, [id]: maskMoneyInput(e.target.value) }))
                      }
                      placeholder="0"
                    />
                  </div>
                ))
              )}
              {tipsTotal > 0 ? (
                <div className="flex justify-between text-sm">
                  <span className="text-ink-3">{t("femme.serviceRecords.tipsTotal")}</span>
                  <span>{formatAmountDecimal(tipsTotal.toFixed(2))}</span>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {record && isOpen && actionsOpen ? (
          <div className="flex flex-col gap-3 rounded-xl border border-line bg-bg p-3" data-testid="service-record-actions-panel">
            {voidError ? (
              <Alert variant="destructive" title={t("femme.serviceRecords.errorTitle")}>
                {voidError}
              </Alert>
            ) : null}
            {showVoidForm ? (
              <div className="flex flex-col gap-3" data-testid="service-record-void-form">
                <div>
                  <Label htmlFor="service-record-void-reason">{t("femme.serviceRecords.voidReason")}</Label>
                  <Textarea
                    id="service-record-void-reason"
                    value={voidReason}
                    onChange={(e) => {
                      setVoidReason(e.target.value);
                      setVoidReasonError(null);
                    }}
                    placeholder={t("femme.serviceRecords.voidReasonPlaceholder")}
                    rows={2}
                    aria-invalid={!!voidReasonError}
                    aria-describedby={voidReasonError ? "service-record-void-reason-err" : undefined}
                    className="mt-1 w-full"
                  />
                  <FieldValidationError id="service-record-void-reason-err">
                    {voidReasonError}
                  </FieldValidationError>
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    className="min-h-11"
                    onClick={() => {
                      setShowVoidForm(false);
                      setActionsOpen(false);
                    }}
                  >
                    {t("femme.serviceRecords.voidCancel")}
                  </Button>
                  <Button
                    type="button"
                    variant="danger"
                    className="min-h-11"
                    disabled={voiding}
                    data-testid="service-record-void-confirm"
                    onClick={(e) => void handleVoid(e)}
                  >
                    {voiding ? t("femme.serviceRecords.voiding") : t("femme.serviceRecords.voidConfirm")}
                  </Button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                data-testid="service-record-void-open"
                onClick={() => setShowVoidForm(true)}
                className="min-h-11 self-start px-1 text-sm font-bold text-danger underline underline-offset-4"
              >
                {t("femme.serviceRecords.voidButton")}
              </button>
            )}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            {record && isOpen ? (
              <button
                type="button"
                data-testid="service-record-actions-toggle"
                aria-label={t("femme.serviceRecords.moreActions")}
                aria-expanded={actionsOpen}
                onClick={() => {
                  setActionsOpen((v) => !v);
                  setShowVoidForm(false);
                }}
                className="min-h-11 min-w-11 rounded-xl border border-line bg-surface text-lg"
              >
                ⋯
              </button>
            ) : null}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              className="min-h-11"
              onClick={onClose}
              data-testid="service-record-close"
            >
              {record ? t("femme.serviceRecords.close") : t("femme.serviceRecords.cancel")}
            </Button>
            <Button
              type="submit"
              variant={record ? "secondary" : "primary"}
              className="min-h-11"
              disabled={saving || clientSelection?.type !== "client"}
              data-testid="service-record-submit"
            >
              {saving ? t("femme.serviceRecords.saving") : t("femme.serviceRecords.saveShort")}
            </Button>
            {record && isOpen ? (
              <Button
                type="button"
                variant="primary"
                className="min-h-11"
                disabled={saving}
                onClick={() => void handlePay()}
                data-testid="service-record-generate-invoice"
              >
                {t("femme.serviceRecords.pay")}
              </Button>
            ) : null}
          </div>
        </div>
      </form>
    </div>
  );
}
