import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Alert, Button, Input, Label, Text, Textarea } from "@design-system";
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
import { MoreActionsMenu } from "./MoreActionsMenu";
import { FieldValidationError } from "./FieldValidationError";
import { useMe } from "../hooks/useMe";
import { useDateLocale } from "../i18n/dateLocale";
import { formatAmountDecimal } from "../lib/formatMoney";
import { maskMoneyInput, parseMaskedMoney } from "../lib/moneyInputMask";
import { formatParaguayDateTime, formatParaguayTime } from "../lib/paraguayDateTime";
import { fetchProfessionalOptions, type ProfessionalOption } from "../api/professionalOptions";
import { billServiceRecord } from "../lib/serviceRecordBilling";
import { initialsOf } from "../lib/initials";
import { ProfessionalServiceLines, ServicePickerScreen } from "./ProfessionalServiceLines";
import { ActionIcon } from "./actionIcons";
import type { MoreActionsItem } from "./MoreActionsMenu";

type Professional = ProfessionalOption;

/** Data the host started loading before the editor mounted (so nothing waits for the editor). */
export type ServiceRecordEditorPreload = {
  professionals: Promise<ProfessionalOption[]>;
};

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
  professionalMode = false,
  preload,
  onViewInvoice,
}: {
  initial: ServiceRecordDetail | null;
  allowClientCreateNew: boolean;
  /**
   * A professional (regular or shared-device session) edits services and quantities only: no
   * prices or totals, no tips, no void and no "Cobrar". The server enforces the same rules.
   */
  professionalMode?: boolean;
  /** Professionals and frequent services the host already requested, in parallel with the record. */
  preload?: ServiceRecordEditorPreload;
  /** Opens the linked comprobante in place; without it the button goes to Facturación. */
  onViewInvoice?: (invoiceId: number) => void;
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
  const { me } = useMe();
  const myProfessionalId = me?.professionalId ?? null;
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
            priceMinor: l.unitPrice ?? "0",
            durationMinutes: 0,
            active: true,
          },
          professionalId: l.professionalId ?? "",
          quantity: l.quantity,
          unitPrice: maskMoneyInput(String(Math.round(Number(l.unitPrice ?? 0)))),
        }))
      : [emptyLine()],
  );
  const [tips, setTips] = useState<Record<number, string>>(() => {
    const map: Record<number, string> = {};
    initial?.tips.forEach((tp) => {
      map[tp.professionalId] = maskMoneyInput(String(Math.round(Number(tp.amount ?? 0))));
    });
    return map;
  });
  const [tipsOpen, setTipsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const [clientError, setClientError] = useState<string | null>(null);
  /** Per-line expand/collapse chosen by the user; a line never touched is open when it is the only one or has no service yet. */
  const [openLines, setOpenLines] = useState<Record<string, boolean>>({});
  const [lineErrors, setLineErrors] = useState<Record<number, { service?: string }>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const [showVoidForm, setShowVoidForm] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [voidReasonError, setVoidReasonError] = useState<string | null>(null);
  const [voiding, setVoiding] = useState(false);
  const [voidError, setVoidError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (preload?.professionals ?? fetchProfessionalOptions()).then((list) => {
      if (!cancelled) setProfessionals(list);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Tips are not a fixed section any more: they show up once there is a tip or the user asks for
  // them from the «⋯» menu.
  const tipsVisible = tipsOpen || tipsTotal > 0;

  function professionalName(id: number | ""): string {
    if (id === "") return "—";
    return professionals.find((p) => p.id === id)?.fullName ?? String(id);
  }

  /** Professional mode: a service tapped in the picker joins the ficha (same service again adds one). */
  function pickServiceAsProfessional(service: SalonServiceOption) {
    setLines((prev) => {
      const existing = prev.find((l) => l.pickedService?.id === service.id);
      if (existing) {
        return prev.map((l) => (l === existing ? { ...l, quantity: (l.quantity || 0) + 1 } : l));
      }
      const withoutBlank = prev.filter((l) => !isBlankLine(l));
      return [
        ...withoutBlank,
        { ...emptyLine(), pickedService: service, quantity: 1, unitPrice: maskMoneyInput(String(Math.round(Number(service.priceMinor)))) },
      ];
    });
    setPickerOpen(false);
  }

  function decrementLine(key: string) {
    const line = lines.find((l) => l.key === key);
    if (!line) return;
    if ((line.quantity || 0) <= 1) removeLine(key);
    else updateLineQuantity(key, line.quantity - 1);
  }

  function addLine() {
    setLines((prev) => [...prev, emptyLine()]);
  }

  function removeLine(key: string) {
    setLines((prev) => {
      if (prev.length > 1) return prev.filter((l) => l.key !== key);
      // The last service can be removed too (professional mode): it leaves the blank placeholder.
      return professionalMode ? [emptyLine()] : prev;
    });
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

  /** A line nobody touched (no service, professional or price) is ignored: a ficha can be client-only. */
  const isBlankLine = (l: (typeof lines)[number]) =>
    !l.pickedService && l.professionalId === "" && !(l.unitPrice && parseMaskedMoney(l.unitPrice) > 0);

  function validate(): boolean {
    let ok = true;
    if (clientSelection === null) {
      setClientError(t("femme.serviceRecords.clientRequired"));
      ok = false;
    } else {
      setClientError(null);
    }
    const newLineErrors: Record<number, { service?: string }> = {};
    lines.forEach((l, idx) => {
      if (!l.pickedService && !isBlankLine(l)) newLineErrors[idx] = { service: t("femme.serviceRecords.lineServiceRequired") };
    });
    setLineErrors(newLineErrors);
    if (Object.keys(newLineErrors).length > 0) ok = false;
    return ok;
  }

  /** Validates and saves; returns the saved record, or null when validation / the request failed. */
  async function persist(): Promise<ServiceRecordDetail | null> {
    setSaveError(null);
    if (!validate() || clientSelection === null) return null;
    const payload = {
      // "Cliente ocasional" saves with no client id: the server files it under the generic client.
      clientId: clientSelection.type === "client" ? clientSelection.client.id : null,
      lines: lines.filter((l) => !isBlankLine(l)).map((l) => ({
        serviceId: l.pickedService!.id,
        // A professional never picks the professional: a line without one is hers.
        professionalId:
          l.professionalId === "" ? (professionalMode ? myProfessionalId : null) : l.professionalId,
        quantity: l.quantity || null,
        unitPrice:
          !professionalMode && l.unitPrice && parseMaskedMoney(l.unitPrice) > 0
            ? parseMaskedMoney(l.unitPrice)
            : null,
      })),
      tips: professionalMode
        ? []
        : distinctProfessionalIds.map((id) => ({
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

  const dateText = record ? formatParaguayDateTime(record.createdAt, dateLocale) : null;

  // Every turno of the ficha (it may serve several); falls back to the single first one.
  const turnos: { id: number; startAt: string }[] =
    record?.appointments && record.appointments.length > 0
      ? record.appointments
      : record?.appointmentId && record.appointmentStartAt
        ? [{ id: record.appointmentId, startAt: record.appointmentStartAt }]
        : [];
  const turnoTimes = turnos.map((a) => formatParaguayTime(a.startAt, dateLocale));
  const turnoTime = turnoTimes.length > 0 ? turnoTimes.join(" · ") : null;
  const turnoTag =
    turnos.length > 1
      ? t("femme.appointmentFicha.appointmentsTag", { times: turnoTime })
      : t("femme.appointmentFicha.appointmentTag", { time: turnoTime });

  /**
   * CLIENTE, its name big and one grey line with the date and, while the ficha is being edited, the
   * turno it belongs to (the way to open that turno is in the «⋯» menu).
   */
  const clientRow = record ? (
    <section aria-label={t("femme.serviceRecords.clientSection")}>
      <div className={SECTION_TITLE}>{t("femme.serviceRecords.clientSection")}</div>
      <div className="break-words font-heading text-xl font-extrabold leading-tight text-ink">
        {record.clientGeneric ? t("femme.serviceRecords.occasionalClient") : record.clientFullName}
      </div>
      <div className="mt-0.5 text-sm text-ink-3">
        {dateText}
        {isOpen && turnoTime ? (
          <>
            {" · "}
            <span data-testid="service-record-appointment">{turnoTag}</span>
          </>
        ) : null}
      </div>
    </section>
  ) : null;

  /**
   * One discreet line under the client: the turno this ficha belongs to and, once charged, its
   * comprobante, each with a small «Ver» link (the tap area stays 44 px). Nothing when the ficha
   * has neither.
   */
  const showTurno = turnos.length > 0;
  const showInvoice = record?.status === "CLOSED" && Boolean(record.invoiceNumberFormatted);
  const linkClass =
    "relative font-bold text-primary hover:underline after:absolute after:-inset-x-2 after:-inset-y-3.5 after:content-['']";
  const appointmentRow =
    record && (showTurno || showInvoice) ? (
      <div
        data-testid="service-record-meta"
        className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-ink-3"
      >
        {showTurno ? (
          <span data-testid="service-record-appointment" className="inline-flex items-center gap-1.5">
            {turnoTag}
            <span aria-hidden="true">·</span>
            <button
              type="button"
              data-testid="service-record-view-appointment"
              aria-label={t("femme.appointmentFicha.viewAppointment")}
              className={linkClass}
              onClick={() => openTurno()}
            >
              {t("femme.serviceRecords.viewShort")}
            </button>
          </span>
        ) : null}
        {showTurno && showInvoice ? (
          <span aria-hidden="true" className="opacity-50">
            |
          </span>
        ) : null}
        {showInvoice ? (
          <span data-testid="service-record-invoice-line" className="inline-flex items-center gap-1.5">
            {t("femme.serviceRecords.invoiceShort", { number: record.invoiceNumberFormatted })}
            {record.invoiceId != null ? (
              <>
                <span aria-hidden="true">·</span>
                <button
                  type="button"
                  data-testid="service-record-view-invoice"
                  aria-label={t("femme.serviceRecords.viewInvoice")}
                  className={linkClass}
                  onClick={() => {
                    const invoiceId = record.invoiceId as number;
                    if (onViewInvoice) {
                      // The host opens the comprobante right here, on top of the ficha.
                      onViewInvoice(invoiceId);
                      return;
                    }
                    onClose();
                    navigate("/app/billing", { state: { openInvoiceId: invoiceId } });
                  }}
                >
                  {t("femme.serviceRecords.viewShort")}
                </button>
              </>
            ) : null}
          </span>
        ) : null}
      </div>
    ) : null;

  /** Opens a turno of this ficha, the earliest by default (the Agenda, with its detail open). */
  function openTurno(target: { id: number; startAt: string } | undefined = turnos[0]) {
    if (!target) return;
    const appointmentId = target.id;
    const startAt = target.startAt;
    onClose();
    navigate("/app/calendar", {
      state: {
        selectedDate: new Date(startAt).toLocaleDateString("sv-SE"),
        openAppointmentId: appointmentId,
      },
    });
  }

  // Everything that is not the main flow lives in «⋯»: the turno, the tips and voiding the ficha.
  const menuItems: MoreActionsItem[] = [];
  if (record && turnos.length === 1) {
    menuItems.push({
      id: "turno",
      label: t("femme.appointmentFicha.viewAppointment"),
      icon: <ActionIcon name="file" />,
      testId: "service-record-view-appointment",
      onSelect: () => openTurno(),
    });
  } else if (record && turnos.length > 1) {
    turnos.forEach((turno, index) => {
      menuItems.push({
        id: `turno-${turno.id}`,
        label: t("femme.appointmentFicha.viewAppointmentAt", { time: turnoTimes[index] }),
        icon: <ActionIcon name="file" />,
        testId: index === 0 ? "service-record-view-appointment" : `service-record-view-appointment-${turno.id}`,
        onSelect: () => openTurno(turno),
      });
    });
  }
  if (!professionalMode && !tipsVisible) {
    menuItems.push({
      id: "tips",
      label: t("femme.serviceRecords.tipsSection"),
      icon: <ActionIcon name="tag" />,
      testId: "service-record-tips-toggle",
      onSelect: () => setTipsOpen(true),
    });
  }
  if (!professionalMode && record && isOpen && !showVoidForm) {
    menuItems.push({
      id: "void",
      label: t("femme.serviceRecords.voidButton"),
      icon: <ActionIcon name="ban" />,
      destructive: true,
      testId: "service-record-void-open",
      onSelect: () => setShowVoidForm(true),
    });
  }

  if (isReadOnly && record) {
    const tipRows = record.tips.filter((tp) => Number(tp.amount) > 0);
    return (
      <div ref={topRef} className="flex flex-col gap-3" data-testid="service-record-readonly">
        {clientRow}
        {appointmentRow}
        {record.status === "VOIDED" && record.voidReason ? (
          <Text variant="small" className="text-ink-3">
            {t("femme.serviceRecords.voidedReasonLabel")}: {record.voidReason}
          </Text>
        ) : null}
        <section className="flex flex-col gap-2 border-t border-line pt-3" aria-labelledby="sr-lines-h">
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

  const CAPTION = "text-xs font-semibold text-ink-3";

  if (professionalMode && pickerOpen) {
    return <ServicePickerScreen onPick={pickServiceAsProfessional} onBack={() => setPickerOpen(false)} />;
  }

  return (
    <div ref={topRef} className="flex flex-col gap-3">
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
        className="flex flex-col gap-3"
      >
        {record ? (
          clientRow
        ) : (
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
        )}

        <section className="flex flex-col gap-1" aria-labelledby="sr-lines-h">
          <h3 id="sr-lines-h" className={SECTION_TITLE}>
            {t("femme.serviceRecords.linesSection")}
          </h3>
          {professionalMode ? (
            <ProfessionalServiceLines
              items={lines
                .filter((l) => !isBlankLine(l))
                .map((l) => ({ key: l.key, name: l.pickedService?.name ?? "", quantity: l.quantity }))}
              onIncrement={(key) => updateLineQuantity(key, (lines.find((l) => l.key === key)?.quantity ?? 0) + 1)}
              onDecrement={decrementLine}
              onAdd={() => setPickerOpen(true)}
            />
          ) : (
            <>
          {lines.map((line, idx) => {
            const professionalName =
              professionals.find((p) => p.id === line.professionalId)?.fullName ??
              record?.lines.find((l) => l.professionalId === line.professionalId)?.professionalName ??
              undefined;
            // Rows are plain text; only a new (empty) line, one with an error or one the user tapped
            // opens its fields.
            const expanded = !!lineErrors[idx]?.service || (openLines[line.key] ?? !line.pickedService);
            const bodyId = `service-record-line-body-${idx}`;
            const summaryName = line.pickedService?.name ?? t("femme.serviceRecords.newServiceLine");
            const summarySub = professionalName || t("femme.serviceRecords.lineFillIn");
            return (
              <div
                key={line.key}
                data-testid="service-record-line"
                className="border-t border-line first:border-t-0"
              >
                <button
                  type="button"
                  aria-expanded={expanded}
                  aria-controls={bodyId}
                  data-testid="service-record-line-toggle"
                  onClick={() => setOpenLines((o) => ({ ...o, [line.key]: !expanded }))}
                  className="flex min-h-14 w-full items-center gap-3 rounded-lg px-1 py-2.5 text-left hover:bg-bg"
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <b className="truncate text-ink">{summaryName}</b>
                    <span className="truncate text-sm text-ink-3">{summarySub}</span>
                  </span>
                  <span className="shrink-0 text-right">
                    <b
                      className="block whitespace-nowrap font-heading text-ink"
                      data-testid="service-record-line-subtotal"
                    >
                      {formatAmountDecimal(lineSubtotal(line).toFixed(2))}
                    </b>
                    {line.quantity > 1 ? (
                      <span className="block text-xs text-ink-3">× {line.quantity}</span>
                    ) : null}
                  </span>
                  <span aria-hidden="true" className="w-4 shrink-0 text-center text-ink-3">
                    {expanded ? "⌃" : "✎"}
                  </span>
                </button>
                {expanded ? (
                  <div id={bodyId} className="mb-2 flex flex-col gap-2 rounded-card bg-bg p-3.5">
                    <ServiceSearchField
                      id={`service-record-line-svc-${idx}`}
                      label={t("femme.serviceRecords.lineServiceAria", { n: idx + 1 })}
                      labelSrOnly
                      hidePrices={professionalMode}
                      value={line.pickedService}
                      onChange={(svc) => updateLineService(line.key, svc)}
                      invalid={!!lineErrors[idx]?.service}
                      errorDescribedById={`service-record-line-svc-err-${idx}`}
                    />
                    <FieldValidationError id={`service-record-line-svc-err-${idx}`}>
                      {lineErrors[idx]?.service}
                    </FieldValidationError>
                    <div
                      className={`grid grid-cols-[4rem_minmax(0,1fr)] items-end gap-x-2 gap-y-2 ${
                        professionalMode ? "sm:grid-cols-[minmax(0,1fr)_4rem]" : "sm:grid-cols-[minmax(0,1fr)_4rem_7rem]"
                      }`}
                    >
                      {professionalMode ? null : (
                      <div className="order-last col-span-2 flex min-w-0 flex-col gap-1 sm:order-none sm:col-span-1">
                        <span aria-hidden="true" className={CAPTION}>
                          {t("femme.serviceRecords.lineProfessionalLabel")}
                        </span>
                        <SearchableSelect<number>
                          id={`service-record-line-prof-${idx}`}
                          label={t("femme.serviceRecords.lineProfessionalAria", { n: idx + 1 })}
                          labelSrOnly
                          value={line.professionalId}
                          onChange={(v) => updateLineProfessional(line.key, v)}
                          options={professionals.map((p) => ({ value: p.id, label: p.fullName }))}
                          filterPlaceholder={t("femme.serviceRecords.lineProfessionalPlaceholder")}
                          noResultsText={t("femme.serviceRecords.lineProfessionalNoResults")}
                        />
                      </div>
                      )}
                      <div className="flex flex-col gap-1">
                        <span aria-hidden="true" className={CAPTION}>
                          {t("femme.serviceRecords.colQty")}
                        </span>
                        <Label htmlFor={`service-record-line-qty-${idx}`} className="sr-only">
                          {t("femme.serviceRecords.lineQuantityLabel")}
                        </Label>
                        <Input
                          id={`service-record-line-qty-${idx}`}
                          type="number"
                          min={1}
                          step={1}
                          inputMode="numeric"
                          aria-label={t("femme.serviceRecords.lineQuantityLabel")}
                          value={line.quantity}
                          onChange={(e) =>
                            updateLineQuantity(line.key, Math.max(0, Math.floor(Number(e.target.value))))
                          }
                        />
                      </div>
                      {professionalMode ? null : (
                      <div className="flex flex-col gap-1">
                        <span aria-hidden="true" className={CAPTION}>
                          {t("femme.serviceRecords.colPrice")}
                        </span>
                        <Label htmlFor={`service-record-line-price-${idx}`} className="sr-only">
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
                      )}
                    </div>
                    {lines.length > 1 || (professionalMode && line.pickedService) ? (
                      <button
                        type="button"
                        onClick={() => removeLine(line.key)}
                        data-testid="service-record-line-remove"
                        className="min-h-11 self-end rounded-lg px-3 text-sm font-semibold text-ink-3 hover:bg-bg hover:text-danger"
                      >
                        ✕ {t("femme.serviceRecords.removeLine")}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
          <button
            type="button"
            onClick={addLine}
            data-testid="service-record-add-line"
            className="mt-1 flex min-h-11 items-center gap-1.5 bg-transparent px-1 text-sm font-bold text-primary underline-offset-2 hover:underline"
          >
            + {t("femme.serviceRecords.addLine")}
          </button>
            </>
          )}
          {professionalMode ? null : (
            <div className="flex items-baseline justify-between pt-1" data-testid="service-record-total">
              <span className="text-sm font-bold text-ink-2">{t("femme.serviceRecords.total")}</span>
              <span className="font-heading text-2xl font-extrabold text-ink">{formatAmountDecimal(total.toFixed(2))}</span>
            </div>
          )}
        </section>

        {professionalMode || !tipsVisible ? null : (
        <section aria-label={t("femme.serviceRecords.tipsSection")}>
          <div className="flex min-h-11 items-center justify-between">
            <span className={SECTION_TITLE}>{t("femme.serviceRecords.tipsSection")}</span>
            {tipsTotal > 0 ? (
              <span data-testid="service-record-tips-total" className="text-sm font-bold text-ink-3">
                {t("femme.serviceRecords.tipsTotal")} {formatAmountDecimal(tipsTotal.toFixed(2))}
              </span>
            ) : null}
          </div>
          {tipsVisible ? (
            <div id="service-record-tips-body" className="flex flex-col gap-1 pb-2">
              {distinctProfessionalIds.length === 0 ? (
                <Text variant="muted" className="text-sm">
                  {t("femme.serviceRecords.tipsNeedProfessional")}
                </Text>
              ) : (
                <div
                  className="flex flex-col rounded-card border border-line bg-page px-3"
                  data-testid="service-record-tips"
                >
                  {distinctProfessionalIds.map((id) => (
                    <div key={id} className="flex items-center gap-3 border-t border-line py-2 first:border-t-0">
                      <span
                        aria-hidden="true"
                        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-lt font-heading text-xs font-extrabold text-primary"
                      >
                        {initialsOf(professionalName(id))}
                      </span>
                      <Label htmlFor={`service-record-tip-${id}`} className="min-w-0 flex-1 break-words font-semibold">
                        {professionalName(id)}
                      </Label>
                      <Input
                        id={`service-record-tip-${id}`}
                        inputMode="numeric"
                        aria-label={`${t("femme.serviceRecords.tipsAmountLabel")} · ${professionalName(id)}`}
                        className="w-32 shrink-0 text-right"
                        value={tips[id] ?? ""}
                        onChange={(e) =>
                          setTips((prev) => ({ ...prev, [id]: maskMoneyInput(e.target.value) }))
                        }
                        placeholder="0"
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </section>
        )}

        {!professionalMode && record && isOpen && showVoidForm ? (
          <div
            className="flex flex-col gap-3 rounded-xl border border-line p-3"
            data-testid="service-record-void-form"
          >
            {voidError ? (
              <Alert variant="destructive" title={t("femme.serviceRecords.errorTitle")}>
                {voidError}
              </Alert>
            ) : null}
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
                onClick={() => setShowVoidForm(false)}
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
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
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
            variant={record && !professionalMode ? "outline" : "primary"}
            className="min-h-11"
            disabled={saving || clientSelection === null}
            data-testid="service-record-submit"
          >
            {saving ? t("femme.serviceRecords.saving") : t("femme.serviceRecords.saveShort")}
          </Button>
          <span className="flex-1" aria-hidden="true" />
          {!professionalMode && record && isOpen ? (
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
          {menuItems.length > 0 ? (
            <MoreActionsMenu
              compact
              label={t("femme.calendar.action.more")}
              items={menuItems}
              open={menuOpen}
              onOpenChange={setMenuOpen}
              triggerTestId="service-record-more"
              menuTestId="service-record-actions-panel"
              disabled={saving}
            />
          ) : null}
        </div>
      </form>
    </div>
  );
}
