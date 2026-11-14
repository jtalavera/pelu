import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Input, Label, Select, Text } from "@design-system";
import {
  addInvoiceTips,
  getInvoiceTips,
  type InvoiceTipItem,
  type InvoiceTips,
  type LateTipInput,
} from "../../api/invoiceTips";
import { femmeJson } from "../../api/femmeClient";
import { translateApiError } from "../../api/parseApiErrorMessage";
import { useMe } from "../../hooks/useMe";
import { useDateLocale } from "../../i18n/dateLocale";
import { formatAmountDecimal } from "../../lib/formatMoney";
import { maskMoneyInput, parseMaskedMoney } from "../../lib/moneyInputMask";
import { formatParaguayDate, formatParaguayDateTime, formatParaguayTime } from "../../lib/paraguayDateTime";
import { withDisplayNames } from "../../lib/professionalDisplay";
import {
  CARD_BRANDS,
  CARD_PAYMENT_METHODS,
  PAYMENT_METHODS,
  capitalize,
} from "../../pages/billing/billingShared";
import { ACTION_BUTTON } from "../actionButtons";
import { FieldValidationError } from "../FieldValidationError";
import { VoidLateTipDialog, type VoidLateTipTarget } from "./VoidLateTipDialog";

type FormRow = {
  key: string;
  /** Professional id as a string; "" while a free row has none chosen yet. */
  professionalId: string;
  /** Set for the professionals who served the invoice (their name is fixed); free rows pick one. */
  fixedName?: string;
  amount: string;
  method: string;
  cardBrand: string;
  cardBrandOther: string;
};

type RowErrors = { professional?: string; amount?: string; brand?: string; brandOther?: string };

type ProfessionalOption = { id: number; fullName: string; active: boolean };

/** The professionals who served the issued invoice's lines (one tip row each), without repeats. */
export function servedProfessionals(
  lines: { professionalId?: number | null; professionalName?: string | null }[],
): { id: number; name: string }[] {
  const seen = new Map<number, string>();
  for (const l of lines) {
    if (l.professionalId != null && !seen.has(l.professionalId)) {
      seen.set(l.professionalId, l.professionalName ?? String(l.professionalId));
    }
  }
  return Array.from(seen, ([id, name]) => ({ id, name }));
}

let rowSeq = 0;
function newRow(init: Partial<FormRow> = {}): FormRow {
  rowSeq += 1;
  return {
    key: `tip-row-${rowSeq}`,
    professionalId: "",
    amount: "",
    method: "CASH",
    cardBrand: "",
    cardBrandOther: "",
    ...init,
  };
}

/**
 * «Propinas» tab of an issued invoice (HU-73): tips left after the invoice was issued. Each one
 * records how it was paid and enters the open cash register; the invoice itself is never touched.
 * Shown on the «Comprobante emitido» screen (highlighted while it is pending, i.e. nothing was
 * registered yet) and inside the invoice detail. Any user can register tips; only the salon
 * administrator sees «Anular».
 */
export function InvoiceTipsPanel({
  invoiceId,
  served,
  highlightPending = false,
  initialTips,
  onGoToCash,
  onChanged,
}: {
  invoiceId: number;
  /** Professionals who served the invoice's lines: one row each in the form. */
  served: { id: number; name: string }[];
  /** Highlights the (collapsed) tab while no tip is registered — only on the just-issued screen. */
  highlightPending?: boolean;
  /**
   * Tips already read by the screen that hosts the panel (the invoice detail reads them together with
   * the invoice, so both appear at once). `null` means that read failed: the tab does not show.
   * Left out, the panel reads its own tips.
   */
  initialTips?: InvoiceTips | null;
  onGoToCash?: () => void;
  /** Called after tips were registered or voided (e.g. to refresh what depends on the cash register). */
  onChanged?: () => void;
}) {
  const { t } = useTranslation();
  const dateLocale = useDateLocale();
  const { me } = useMe();
  const isAdmin = me?.role === "ADMIN";

  const [tips, setTips] = useState<InvoiceTips | null>(initialTips ?? null);
  const [open, setOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [rows, setRows] = useState<FormRow[]>(() =>
    served.map((p) => newRow({ professionalId: String(p.id), fixedName: p.name })),
  );
  const [rowErrors, setRowErrors] = useState<Record<string, RowErrors>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [voidTarget, setVoidTarget] = useState<VoidLateTipTarget | null>(null);
  const [professionals, setProfessionals] = useState<ProfessionalOption[]>([]);

  useEffect(() => {
    if (initialTips !== undefined) return;
    let cancelled = false;
    getInvoiceTips(invoiceId)
      .then((data) => {
        if (!cancelled) setTips(data);
      })
      .catch(() => {
        // Not critical for the screen it sits on: without the answer the tab simply does not show.
      });
    return () => {
      cancelled = true;
    };
  }, [invoiceId, initialTips]);

  const loadProfessionals = useCallback(() => {
    if (professionals.length > 0) return;
    femmeJson<{ id: number; fullName: string; displayName?: string | null; active: boolean }[]>(
      "/api/professionals/options",
    )
      .then((list) =>
        setProfessionals(Array.isArray(list) ? withDisplayNames(list).filter((p) => p.active) : []),
      )
      .catch(() => setProfessionals([]));
  }, [professionals.length]);

  if (!tips || tips.invoiceStatus !== "ISSUED") return null;

  const items = tips.items;
  const hasLive = items.some((i) => !i.voided);
  const pending = highlightPending && !hasLive && served.length > 0;
  const showForm = formOpen || pending;
  const noCash = tips.openCashSessionId == null;
  const state: "pending" | "registered" | "none" = pending ? "pending" : hasLive ? "registered" : "none";

  const methodLabel = (method: string) =>
    t(`femme.billing.invoice.paymentMethod${capitalize(method)}`);
  const paymentLabel = (item: InvoiceTipItem) => {
    if (!item.paymentMethod) return "";
    const parts = [methodLabel(item.paymentMethod)];
    if (item.cardBrand) {
      parts.push(
        item.cardBrand === "OTHER" && item.cardBrandOtherDescription
          ? item.cardBrandOtherDescription
          : t(`femme.billing.invoice.cardBrand${capitalize(item.cardBrand)}`),
      );
    }
    return parts.join(" · ");
  };

  /** «09:14» for a tip registered today, the full date and time for an older one. */
  const whenLabel = (iso: string | null) => {
    if (!iso) return "";
    return formatParaguayDate(iso, dateLocale) === formatParaguayDate(new Date(), dateLocale)
      ? formatParaguayTime(iso, dateLocale)
      : formatParaguayDateTime(iso, dateLocale);
  };

  function updateRow(key: string, patch: Partial<FormRow>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setRowErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setFormError(null);
  }

  function addFreeRow() {
    loadProfessionals();
    setRows((prev) => [...prev, newRow()]);
  }

  function openForm() {
    setNotice(null);
    setFormOpen(true);
    if (rows.length === 0) loadProfessionals();
  }

  function closeForm() {
    setFormOpen(false);
    setSubmitError(null);
    setFormError(null);
    setRowErrors({});
  }

  async function submit() {
    setSubmitError(null);
    setNotice(null);
    const errors: Record<string, RowErrors> = {};
    const inputs: LateTipInput[] = [];
    for (const r of rows) {
      const raw = r.amount.trim();
      if (raw === "") continue;
      const e: RowErrors = {};
      const amount = parseMaskedMoney(r.amount);
      if (!Number.isFinite(amount) || amount <= 0) e.amount = t("femme.billing.invoiceTips.amountInvalid");
      if (r.professionalId === "") e.professional = t("femme.billing.invoiceTips.professionalRequired");
      const isCard = CARD_PAYMENT_METHODS.has(r.method);
      if (isCard && r.cardBrand === "") e.brand = t("femme.billing.invoice.cardBrandRequired");
      if (isCard && r.cardBrand === "OTHER" && r.cardBrandOther.trim() === "") {
        e.brandOther = t("femme.billing.invoice.cardBrandOtherDescriptionLabel");
      }
      if (Object.keys(e).length > 0) {
        errors[r.key] = e;
        continue;
      }
      inputs.push({
        professionalId: Number(r.professionalId),
        amount,
        paymentMethod: r.method,
        cardBrand: isCard ? r.cardBrand : null,
        cardBrandOtherDescription: isCard && r.cardBrand === "OTHER" ? r.cardBrandOther.trim() : null,
      });
    }
    setRowErrors(errors);
    if (Object.keys(errors).length > 0) return;
    if (inputs.length === 0) {
      setFormError(t("femme.billing.invoiceTips.nothingToSave"));
      return;
    }
    setFormError(null);
    setSubmitting(true);
    try {
      const updated = await addInvoiceTips(invoiceId, inputs);
      setTips(updated);
      setNotice(t("femme.billing.invoiceTips.saved"));
      setFormOpen(false);
      setRows(served.map((p) => newRow({ professionalId: String(p.id), fixedName: p.name })));
      setOpen(true);
      onChanged?.();
    } catch (err) {
      setSubmitError(translateApiError(err, t, "femme.apiErrors.GENERIC"));
    } finally {
      setSubmitting(false);
    }
  }

  const enteredTotal = rows.reduce((acc, r) => {
    const n = parseMaskedMoney(r.amount);
    return acc + (Number.isFinite(n) && n > 0 ? n : 0);
  }, 0);

  return (
    <section data-testid="invoice-tips" data-state={state} className="flex flex-col">
      <div className={`overflow-hidden rounded-xl ${state === "pending" ? "border-[1.5px] border-primary" : "border border-line"}`}>
        <button
          type="button"
          data-testid="invoice-tips-toggle"
          aria-expanded={open}
          aria-controls={`invoice-tips-body-${invoiceId}`}
          onClick={() => setOpen((o) => !o)}
          className={`flex min-h-14 w-full items-center justify-between gap-3 px-4 py-2 text-left ${
            state === "pending" ? "bg-primary-lt" : "bg-surface"
          }`}
        >
          <span className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
            <span className="font-heading text-base font-extrabold text-ink">
              {t("femme.billing.invoiceTips.title")}
            </span>
            {state === "pending" ? (
              <>
                <span
                  data-testid="invoice-tips-badge"
                  className="rounded-full bg-primary px-2.5 py-0.5 text-xs font-bold text-primary-fg"
                >
                  {t("femme.billing.invoiceTips.pending")}
                </span>
                <span className="text-sm text-primary-dk">{t("femme.billing.invoiceTips.pendingAsk")}</span>
              </>
            ) : state === "registered" ? (
              <span
                data-testid="invoice-tips-badge"
                className="rounded-full bg-success-lt px-2.5 py-0.5 text-xs font-bold text-success"
              >
                {t("femme.billing.invoiceTips.registeredBadge", {
                  amount: formatAmountDecimal(Number(tips.total).toFixed(2)),
                })}
              </span>
            ) : (
              <span data-testid="invoice-tips-badge" className="text-sm text-ink-3">
                {t("femme.billing.invoiceTips.none")}
              </span>
            )}
          </span>
          <span aria-hidden className={state === "pending" ? "text-primary" : "text-ink-3"}>
            {open ? "⌃" : "⌄"}
          </span>
        </button>

        {open ? (
          <div
            id={`invoice-tips-body-${invoiceId}`}
            data-testid="invoice-tips-body"
            className="flex flex-col gap-3 border-t border-line p-4"
          >
            {notice ? (
              <Alert variant="success" title={notice} data-testid="invoice-tips-notice" />
            ) : null}

            {items.length > 0 ? (
              <ul className="flex flex-col" data-testid="invoice-tips-list">
                {items.map((item, idx) => (
                  <li
                    key={`${item.source}-${item.id ?? idx}`}
                    data-testid={`invoice-tip-${item.source === "LATE" ? item.id : `issuance-${idx}`}`}
                    className="flex min-h-[3.75rem] items-center justify-between gap-2 border-b border-line py-2 last:border-b-0"
                  >
                    <div className={`min-w-0 ${item.voided ? "text-ink-3" : ""}`}>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[15px] font-bold">{item.professionalName}</span>
                        {item.voided ? (
                          <span className="rounded-full bg-line px-2.5 py-0.5 text-xs font-bold text-ink-2">
                            {t("femme.billing.invoiceTips.voidedTag")}
                          </span>
                        ) : null}
                      </div>
                      <div className="text-xs text-ink-3">
                        {item.source === "ISSUANCE"
                          ? t("femme.billing.invoiceTips.atIssuance")
                          : [paymentLabel(item), whenLabel(item.createdAt)].filter(Boolean).join(" · ")}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5">
                      <span
                        className={`text-[15px] font-extrabold tabular-nums ${item.voided ? "text-ink-3 line-through" : ""}`}
                      >
                        {formatAmountDecimal(Number(item.amount).toFixed(2))}
                      </span>
                      {isAdmin && item.source === "LATE" && !item.voided && item.cashSessionOpen ? (
                        <Button
                          type="button"
                          variant="ghost"
                          className={`${ACTION_BUTTON} px-2 font-bold text-danger`}
                          data-testid={`invoice-tip-void-${item.id}`}
                          onClick={() =>
                            setVoidTarget({
                              id: item.id as number,
                              professionalName: item.professionalName,
                              amount: item.amount,
                              paymentLabel: paymentLabel(item),
                            })
                          }
                        >
                          {t("femme.billing.invoiceTips.void")}
                        </Button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            ) : !showForm ? (
              <Text variant="muted" className="text-sm" data-testid="invoice-tips-empty">
                {t("femme.billing.invoiceTips.emptyOpen")}
              </Text>
            ) : null}

            {noCash ? (
              <Alert
                variant="warning"
                title={t("femme.billing.invoiceTips.noCashTitle")}
                data-testid="invoice-tips-no-cash"
              >
                <div className="flex flex-col items-start gap-2">
                  <span>{t("femme.billing.invoiceTips.noCashBody")}</span>
                  {onGoToCash ? (
                    <Button
                      type="button"
                      variant="outline"
                      className={ACTION_BUTTON}
                      data-testid="invoice-tips-go-cash"
                      onClick={onGoToCash}
                    >
                      {t("femme.billing.invoiceTips.goToCash")}
                    </Button>
                  ) : null}
                </div>
              </Alert>
            ) : null}

            {showForm ? (
              <div
                data-testid="invoice-tips-form"
                className={`flex flex-col gap-3 ${items.length > 0 ? "rounded-xl border border-line p-3.5" : ""} ${noCash ? "opacity-50" : ""}`}
              >
                {rows.length === 0 ? (
                  <Text variant="muted" className="text-sm">
                    {t("femme.billing.invoiceTips.noServed")}
                  </Text>
                ) : null}
                {rows.map((r) => {
                  const errs = rowErrors[r.key] ?? {};
                  const isCard = CARD_PAYMENT_METHODS.has(r.method);
                  return (
                    <div
                      key={r.key}
                      data-testid="invoice-tips-row"
                      className="flex flex-col gap-2 border-b border-line pb-3.5 last:border-b-0"
                    >
                      {r.fixedName ? (
                        <div className="text-sm font-bold">{r.fixedName}</div>
                      ) : (
                        <div>
                          <Label htmlFor={`${r.key}-prof`}>{t("femme.billing.invoiceTips.professional")}</Label>
                          <Select
                            id={`${r.key}-prof`}
                            value={r.professionalId}
                            disabled={noCash}
                            className="mt-1 w-full"
                            aria-invalid={!!errs.professional}
                            onChange={(e) => updateRow(r.key, { professionalId: e.target.value })}
                          >
                            <option value="">{t("femme.billing.invoiceTips.professionalPlaceholder")}</option>
                            {professionals.map((p) => (
                              <option key={p.id} value={String(p.id)}>
                                {p.fullName}
                              </option>
                            ))}
                          </Select>
                          <FieldValidationError id={`${r.key}-prof-err`}>{errs.professional}</FieldValidationError>
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-3">
                        <div className="min-w-0">
                          <Label htmlFor={`${r.key}-amount`}>{t("femme.billing.invoiceTips.amountLabel")}</Label>
                          <Input
                            id={`${r.key}-amount`}
                            inputMode="numeric"
                            placeholder="0"
                            value={r.amount}
                            disabled={noCash}
                            aria-invalid={!!errs.amount}
                            aria-describedby={errs.amount ? `${r.key}-amount-err` : undefined}
                            aria-label={`${t("femme.billing.invoiceTips.amountLabel")} — ${r.fixedName ?? t("femme.billing.invoiceTips.professional")}`}
                            className="mt-1 w-full text-right"
                            onChange={(e) => updateRow(r.key, { amount: maskMoneyInput(e.target.value) })}
                          />
                          <FieldValidationError id={`${r.key}-amount-err`}>{errs.amount}</FieldValidationError>
                        </div>
                        <div className="min-w-0">
                          <Label htmlFor={`${r.key}-method`}>{t("femme.billing.invoiceTips.methodLabel")}</Label>
                          <Select
                            id={`${r.key}-method`}
                            value={r.method}
                            disabled={noCash}
                            className="mt-1 w-full"
                            aria-label={`${t("femme.billing.invoiceTips.methodLabel")} — ${r.fixedName ?? t("femme.billing.invoiceTips.professional")}`}
                            onChange={(e) =>
                              updateRow(r.key, { method: e.target.value, cardBrand: "", cardBrandOther: "" })
                            }
                          >
                            {PAYMENT_METHODS.map((m) => (
                              <option key={m} value={m}>
                                {methodLabel(m)}
                              </option>
                            ))}
                          </Select>
                        </div>
                        {isCard ? (
                          <div className="col-span-2 min-w-0">
                            <Label htmlFor={`${r.key}-brand`}>{t("femme.billing.invoice.cardBrandLabel")}</Label>
                            <Select
                              id={`${r.key}-brand`}
                              value={r.cardBrand}
                              disabled={noCash}
                              className="mt-1 w-full"
                              aria-invalid={!!errs.brand}
                              onChange={(e) => updateRow(r.key, { cardBrand: e.target.value })}
                            >
                              <option value="" disabled>
                                {t("femme.billing.invoice.cardBrandPlaceholder")}
                              </option>
                              {CARD_BRANDS.map((b) => (
                                <option key={b} value={b}>
                                  {t(`femme.billing.invoice.cardBrand${capitalize(b)}`)}
                                </option>
                              ))}
                            </Select>
                            <FieldValidationError id={`${r.key}-brand-err`}>{errs.brand}</FieldValidationError>
                          </div>
                        ) : null}
                      </div>
                      {isCard && r.cardBrand === "OTHER" ? (
                        <div>
                          <Label htmlFor={`${r.key}-brand-other`}>
                            {t("femme.billing.invoice.cardBrandOtherDescriptionLabel")}
                          </Label>
                          <Input
                            id={`${r.key}-brand-other`}
                            value={r.cardBrandOther}
                            disabled={noCash}
                            maxLength={100}
                            placeholder={t("femme.billing.invoice.cardBrandOtherDescriptionPlaceholder")}
                            aria-invalid={!!errs.brandOther}
                            className="mt-1 w-full"
                            onChange={(e) => updateRow(r.key, { cardBrandOther: e.target.value })}
                          />
                          <FieldValidationError id={`${r.key}-brand-other-err`}>{errs.brandOther}</FieldValidationError>
                        </div>
                      ) : null}
                    </div>
                  );
                })}

                <Button
                  type="button"
                  variant="ghost"
                  className={`${ACTION_BUTTON} self-start px-0 font-extrabold text-primary`}
                  disabled={noCash}
                  data-testid="invoice-tips-add-other"
                  onClick={addFreeRow}
                >
                  {t("femme.billing.invoiceTips.addOther")}
                </Button>

                <FieldValidationError id="invoice-tips-form-error">{formError}</FieldValidationError>
                {submitError ? (
                  <Alert variant="destructive" title={t("femme.billing.errorTitle")} data-testid="invoice-tips-submit-error">
                    {submitError}
                  </Alert>
                ) : null}

                <div className="flex gap-2.5">
                  {!pending ? (
                    <Button
                      type="button"
                      variant="outline"
                      className={`${ACTION_BUTTON} flex-1`}
                      data-testid="invoice-tips-cancel"
                      onClick={closeForm}
                    >
                      {t("femme.billing.invoiceTips.cancel")}
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="primary"
                    className={`${ACTION_BUTTON} flex-1`}
                    disabled={noCash || submitting}
                    data-testid="invoice-tips-submit"
                    onClick={() => void submit()}
                  >
                    {submitting
                      ? t("femme.billing.invoiceTips.submitting")
                      : enteredTotal > 0
                        ? t("femme.billing.invoiceTips.submitWithTotal", {
                            amount: formatAmountDecimal(enteredTotal.toFixed(2)),
                          })
                        : t("femme.billing.invoiceTips.submit")}
                  </Button>
                </div>
                {!noCash ? (
                  <Text variant="small" className="text-center text-ink-3" data-testid="invoice-tips-cash-note">
                    {t("femme.billing.invoiceTips.cashNoteShort")}
                  </Text>
                ) : null}
              </div>
            ) : (
              <Button
                type="button"
                variant="ghost"
                className={`${ACTION_BUTTON} self-start px-0 font-extrabold text-primary`}
                data-testid="invoice-tips-open-form"
                onClick={openForm}
              >
                {hasLive || items.length > 0
                  ? t("femme.billing.invoiceTips.addAnother")
                  : t("femme.billing.invoiceTips.add")}
              </Button>
            )}
          </div>
        ) : null}
      </div>

      <VoidLateTipDialog
        target={voidTarget}
        onClose={() => setVoidTarget(null)}
        onVoided={(updated) => {
          setTips(updated);
          setVoidTarget(null);
          setNotice(t("femme.billing.invoiceTips.voided"));
          onChanged?.();
        }}
      />
    </section>
  );
}
