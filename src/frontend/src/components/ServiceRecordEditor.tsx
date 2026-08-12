import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Button,
  Card,
  Heading,
  Input,
  Label,
  Spinner,
  Text,
  Textarea,
} from "@design-system";
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
  onSaved?: (record: ServiceRecordDetail) => void;
  onVoided?: (record: ServiceRecordDetail) => void;
  /** Present only in modal/detail contexts — renders "Cerrar" next to "Anular ficha". */
  onClose?: () => void;
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
      : [],
  );
  const [tips, setTips] = useState<Record<number, string>>(() => {
    const map: Record<number, string> = {};
    initial?.tips.forEach((tp) => {
      map[tp.professionalId] = maskMoneyInput(String(Math.round(Number(tp.amount))));
    });
    return map;
  });

  // Bumped after a successful create to force `ClientSearchField` (which keeps its own
  // internal query-text state) to remount and clear its displayed text.
  const [clientFieldResetKey, setClientFieldResetKey] = useState(0);

  const [clientError, setClientError] = useState<string | null>(null);
  const [lineErrors, setLineErrors] = useState<
    Record<number, { service?: string; professional?: string; quantity?: string; unitPrice?: string }>
  >({});
  const [globalErrors, setGlobalErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccessKind, setSaveSuccessKind] = useState<"created" | "updated" | null>(null);

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

  const total = lines.reduce(
    (acc, l) =>
      acc + (l.pickedService ? parseMaskedMoney(l.unitPrice) * (l.quantity || 0) : 0),
    0,
  );
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
    setLines((prev) => prev.filter((l) => l.key !== key));
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

    const newLineErrors: Record<
      number,
      { service?: string; professional?: string; quantity?: string; unitPrice?: string }
    > = {};
    lines.forEach((l, idx) => {
      const err: { service?: string; professional?: string; quantity?: string; unitPrice?: string } =
        {};
      if (!l.pickedService) err.service = t("femme.serviceRecords.lineServiceRequired");
      if (Object.keys(err).length > 0) newLineErrors[idx] = err;
    });
    setLineErrors(newLineErrors);
    if (Object.keys(newLineErrors).length > 0) ok = false;

    setGlobalErrors([]);

    return ok;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaveError(null);
    setSaveSuccessKind(null);
    if (!validate() || clientSelection?.type !== "client") return;

    const payload = {
      clientId: clientSelection.client.id,
      lines: lines.map((l) => ({
        serviceId: l.pickedService!.id,
        professionalId: l.professionalId === "" ? null : l.professionalId,
        quantity: l.quantity || null,
        unitPrice: l.unitPrice && parseMaskedMoney(l.unitPrice) > 0 ? parseMaskedMoney(l.unitPrice) : null,
      })),
      tips: distinctProfessionalIds.map((id) => ({
        professionalId: id,
        amount: parseMaskedMoney(tips[id] ?? ""),
      })),
    };

    const wasCreate = record == null;
    setSaving(true);
    try {
      const result = wasCreate
        ? await createServiceRecord(payload)
        : await updateServiceRecord(record!.id, payload);
      setSaveSuccessKind(wasCreate ? "created" : "updated");
      if (wasCreate) {
        // Reset to a blank "new record" form in place (not a remount) so the success
        // alert stays visible above the cleared fields.
        setRecord(null);
        setClientSelection(null);
        setClientFieldResetKey((k) => k + 1);
        setLines([]);
        setTips({});
        setClientError(null);
        setLineErrors({});
        setGlobalErrors([]);
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else {
        setRecord(result);
        // Updating an existing record happens inside a modal (opened from Historial de fichas or
        // the Panel) whose scrollable area is the modal body, not the window — scroll that into view.
        topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      onSaved?.(result);
    } catch (err) {
      setSaveError(translateApiError(err, t, "femme.apiErrors.GENERIC"));
      if (!wasCreate) {
        topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    } finally {
      setSaving(false);
    }
  }

  function handleGenerateInvoice() {
    if (!record) return;
    navigate("/app/billing", {
      state: {
        activeTab: "invoice",
        prefillServiceRecord: {
          serviceRecordId: record.id,
          client: {
            id: record.clientId,
            fullName: record.clientFullName,
            phone: null,
            email: null,
            ruc: record.clientRuc,
          },
          lines: record.lines.map((l) => ({
            serviceId: l.serviceId,
            description: l.description,
            unitPrice: l.unitPrice,
          })),
          tipsAmount: record.tipsTotal,
        },
      },
    });
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
      setShowVoidForm(false);
      onVoided?.(result);
    } catch (err) {
      setVoidError(translateApiError(err, t, "femme.apiErrors.GENERIC"));
    } finally {
      setVoiding(false);
    }
  }

  return (
    <div ref={topRef} className="flex flex-col gap-4">
      {record && (
        <div className="flex flex-wrap items-center gap-3">
          <span data-testid="service-record-status">
            <StatusBadge status={record.status} />
          </span>
          {record.status === "VOIDED" && record.voidReason && (
            <Text variant="small" className="text-[rgb(var(--color-muted-foreground))]">
              {t("femme.serviceRecords.voidedReasonLabel")}: {record.voidReason}
            </Text>
          )}
          {record.status === "CLOSED" && record.invoiceNumberFormatted && (
            <Text variant="small" className="text-[rgb(var(--color-muted-foreground))]">
              {t("femme.serviceRecords.linkedInvoice")}: {record.invoiceNumberFormatted}
            </Text>
          )}
          <Text variant="small" className="text-[rgb(var(--color-muted-foreground))]">
            {t("femme.serviceRecords.createdAt")}: {formatParaguayDateTime(record.createdAt, dateLocale)}
          </Text>
        </div>
      )}

      {globalErrors.map((err, i) => (
        <Alert key={i} variant="destructive" title={t("femme.serviceRecords.errorTitle")}>
          {err}
        </Alert>
      ))}
      {saveError && (
        <Alert variant="destructive" title={t("femme.serviceRecords.errorTitle")}>
          {saveError}
        </Alert>
      )}
      {saveSuccessKind && (
        <Alert variant="success">
          {saveSuccessKind === "created"
            ? t("femme.serviceRecords.createdSuccess")
            : t("femme.serviceRecords.updatedSuccess")}
        </Alert>
      )}
      {voidError && (
        <Alert variant="destructive" title={t("femme.serviceRecords.errorTitle")}>
          {voidError}
        </Alert>
      )}

      <form onSubmit={(e) => void handleSubmit(e)} noValidate className="flex flex-col gap-6">
        <Card className="p-4 sm:p-6 flex flex-col gap-4">
          <Heading as="h3" className="text-base">
            {t("femme.serviceRecords.clientSection")}
          </Heading>
          {isReadOnly ? (
            <Text>{record?.clientFullName}</Text>
          ) : (
            <>
              <ClientSearchField
                key={clientFieldResetKey}
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
            </>
          )}
        </Card>

        <Card className="p-4 sm:p-6 flex flex-col gap-4">
          <Heading as="h3" className="text-base">
            {t("femme.serviceRecords.linesSection")}
          </Heading>
          <div className="flex flex-col gap-3 overflow-x-auto">
            {lines.map((line, idx) => (
              <div
                key={line.key}
                className="grid grid-cols-12 gap-2 items-start border border-[rgb(var(--color-border))] rounded p-3"
              >
                <div className="col-span-12 sm:col-span-4">
                  {isReadOnly ? (
                    <>
                      <Label>{t("femme.serviceRecords.linesSection")}</Label>
                      <Text>{line.pickedService?.name}</Text>
                    </>
                  ) : (
                    <>
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
                    </>
                  )}
                </div>
                <div className="col-span-12 sm:col-span-3">
                  {isReadOnly ? (
                    <>
                      <Label>{t("femme.serviceRecords.lineProfessionalLabel")}</Label>
                      <Text>{professionalName(line.professionalId)}</Text>
                    </>
                  ) : (
                    <>
                      <SearchableSelect<number>
                        id={`service-record-line-prof-${idx}`}
                        label={t("femme.serviceRecords.lineProfessionalLabel")}
                        value={line.professionalId}
                        onChange={(v) => updateLineProfessional(line.key, v)}
                        options={professionals.map((p) => ({ value: p.id, label: p.fullName }))}
                        filterPlaceholder={t("femme.serviceRecords.lineProfessionalPlaceholder")}
                        noResultsText={t("femme.serviceRecords.lineProfessionalNoResults")}
                        invalid={!!lineErrors[idx]?.professional}
                        describedBy={
                          lineErrors[idx]?.professional
                            ? `service-record-line-prof-err-${idx}`
                            : undefined
                        }
                      />
                      <FieldValidationError id={`service-record-line-prof-err-${idx}`}>
                        {lineErrors[idx]?.professional}
                      </FieldValidationError>
                    </>
                  )}
                </div>
                <div className="col-span-6 sm:col-span-2">
                  {isReadOnly ? (
                    <>
                      <Label>{t("femme.serviceRecords.lineUnitPriceLabel")}</Label>
                      <Text>{line.pickedService ? line.unitPrice || "—" : "—"}</Text>
                    </>
                  ) : (
                    <>
                      <Label htmlFor={`service-record-line-price-${idx}`}>
                        {t("femme.serviceRecords.lineUnitPriceLabel")}
                      </Label>
                      <Input
                        id={`service-record-line-price-${idx}`}
                        inputMode="numeric"
                        value={line.unitPrice}
                        onChange={(e) => updateLineUnitPrice(line.key, e.target.value)}
                        invalid={!!lineErrors[idx]?.unitPrice}
                        aria-describedby={
                          lineErrors[idx]?.unitPrice
                            ? `service-record-line-price-err-${idx}`
                            : undefined
                        }
                      />
                      <FieldValidationError id={`service-record-line-price-err-${idx}`}>
                        {lineErrors[idx]?.unitPrice}
                      </FieldValidationError>
                    </>
                  )}
                </div>
                <div className="col-span-6 sm:col-span-2">
                  {isReadOnly ? (
                    <>
                      <Label>{t("femme.serviceRecords.lineQuantityLabel")}</Label>
                      <Text>{line.quantity}</Text>
                    </>
                  ) : (
                    <>
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
                        invalid={!!lineErrors[idx]?.quantity}
                        aria-describedby={
                          lineErrors[idx]?.quantity
                            ? `service-record-line-qty-err-${idx}`
                            : undefined
                        }
                      />
                      <FieldValidationError id={`service-record-line-qty-err-${idx}`}>
                        {lineErrors[idx]?.quantity}
                      </FieldValidationError>
                    </>
                  )}
                </div>
                {!isReadOnly && (
                  <div className="col-span-12 sm:col-span-1 flex items-end justify-end">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeLine(line.key)}
                      aria-label={t("femme.serviceRecords.removeLine")}
                    >
                      ×
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
          {!isReadOnly && (
            <Button type="button" variant="secondary" size="sm" className="w-fit" onClick={addLine}>
              {t("femme.serviceRecords.addLine")}
            </Button>
          )}
        </Card>

        {distinctProfessionalIds.length > 0 && (
          <Card className="p-4 sm:p-6 flex flex-col gap-4">
            <Heading as="h3" className="text-base">
              {t("femme.serviceRecords.tipsSection")}
            </Heading>
            <div className="flex flex-col gap-3">
              {distinctProfessionalIds.map((id) => (
                <div key={id} className="flex flex-wrap items-center gap-3">
                  <span className="min-w-[160px] text-sm font-medium">{professionalName(id)}</span>
                  {isReadOnly ? (
                    <Text>{formatAmountDecimal(tips[id] ? parseMaskedMoney(tips[id]) : 0)}</Text>
                  ) : (
                    <Input
                      id={`service-record-tip-${id}`}
                      inputMode="numeric"
                      value={tips[id] ?? ""}
                      onChange={(e) =>
                        setTips((prev) => ({ ...prev, [id]: maskMoneyInput(e.target.value) }))
                      }
                      placeholder="0"
                      aria-label={`${t("femme.serviceRecords.tipsAmountLabel")} — ${professionalName(id)}`}
                      className="w-32"
                    />
                  )}
                </div>
              ))}
            </div>
          </Card>
        )}

        <div className="flex flex-col gap-1 text-sm">
          <div className="flex justify-between font-semibold">
            <span>{t("femme.serviceRecords.total")}</span>
            <span>{formatAmountDecimal(total.toFixed(2))}</span>
          </div>
          {tipsTotal > 0 && (
            <div className="flex justify-between">
              <span className="text-[rgb(var(--color-muted-foreground))]">
                {t("femme.serviceRecords.tipsTotal")}
              </span>
              <span>{formatAmountDecimal(tipsTotal.toFixed(2))}</span>
            </div>
          )}
        </div>

        {!isReadOnly && (
          <div className="flex flex-wrap gap-3">
            <Button
              type="submit"
              variant="primary"
              disabled={saving || clientSelection?.type !== "client"}
              data-testid="service-record-submit"
            >
              {saving
                ? t("femme.serviceRecords.saving")
                : record
                  ? t("femme.serviceRecords.saveChanges")
                  : t("femme.serviceRecords.save")}
            </Button>
            {record && isOpen && (
              <Button
                type="button"
                variant="success"
                onClick={handleGenerateInvoice}
                data-testid="service-record-generate-invoice"
              >
                {t("femme.serviceRecords.generateInvoice")}
              </Button>
            )}
            {record && isOpen && (
              <Button
                type="button"
                variant="danger"
                disabled={showVoidForm}
                onClick={() => setShowVoidForm(true)}
              >
                {t("femme.serviceRecords.voidButton")}
              </Button>
            )}
            {record && isOpen && showVoidForm && (
              <Button type="button" variant="secondary" onClick={() => setShowVoidForm(false)}>
                {t("femme.serviceRecords.voidCancel")}
              </Button>
            )}
            {onClose && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={onClose}
                data-testid="service-record-close"
              >
                {t("femme.serviceRecords.close")}
              </Button>
            )}
          </div>
        )}
        {isReadOnly && onClose && (
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onClose}
              data-testid="service-record-close"
            >
              {t("femme.serviceRecords.close")}
            </Button>
          </div>
        )}
      </form>

      {record && isOpen && showVoidForm && (
        <form
          className="border-t border-[rgb(var(--color-border))] pt-4 flex flex-col gap-3"
          onSubmit={(e) => void handleVoid(e)}
          noValidate
        >
          <Heading as="h3" className="text-base">
            {t("femme.serviceRecords.voidTitle")}
          </Heading>
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
          <div className="flex gap-2">
            <Button type="submit" variant="danger" size="sm" disabled={voiding}>
              {voiding ? t("femme.serviceRecords.voiding") : t("femme.serviceRecords.voidConfirm")}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

export function ServiceRecordEditorLoadingFallback() {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2">
      <Spinner size="sm" />
      <Text>{t("femme.serviceRecords.loading")}</Text>
    </div>
  );
}
