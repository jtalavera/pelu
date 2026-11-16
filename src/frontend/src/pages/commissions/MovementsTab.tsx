import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Input, KebabMenu, Label, MultiSelect, PageSizeSelect, Pagination, Text } from "@design-system";
import { getEntries, type EntryFilters, type EntryView } from "../../api/commissions";
import { translateApiError } from "../../api/parseApiErrorMessage";
import { LocalizedDateInput } from "../../components/LocalizedDateInput";
import { useDateLocale } from "../../i18n/dateLocale";
import { formatGuaraniesGs } from "../../lib/formatMoney";
import { formatParaguayDateTime } from "../../lib/paraguayDateTime";
import { ReassignDialog } from "./ReassignDialog";
import { SettlementStatusBadge, oneMonthAgoYmd, formatPercent, todayYmd, useProfessionals } from "./common";
import { groupMovements, type MovementGroup } from "./movementGroups";

/** Every commission movement, with «Cambiar profesional» on the live ones. */
export function MovementsTab({ fixedProfessionalId }: { fixedProfessionalId?: number } = {}) {
  const { t } = useTranslation();
  const dateLocale = useDateLocale();
  const professionals = useProfessionals();
  const [from, setFrom] = useState(oneMonthAgoYmd());
  const [to, setTo] = useState(todayYmd());
  const [professionalIds, setProfessionalIds] = useState<number[]>(fixedProfessionalId ? [fixedProfessionalId] : []);
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [entries, setEntries] = useState<EntryView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toReassign, setToReassign] = useState<EntryView | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(10);
  /** Newest first by default (the list used to come oldest first, so the latest sat on the last page). */
  const [order, setOrder] = useState<"desc" | "asc">("desc");
  /** Paid = already paid in a settlement; unpaid = everything else (not settled, draft, approved). */
  const [pay, setPay] = useState<"all" | "unpaid" | "paid">("all");
  /** HU-COM-29: «Mostrar también las líneas revertidas» opens the history of every sale; each one also opens on its own. */
  const [showReversed, setShowReversed] = useState(false);
  const [openKeys, setOpenKeys] = useState<Set<string>>(new Set());

  const load = useCallback(
    async (filters?: EntryFilters) => {
      try {
        setEntries(await getEntries(filters ?? { from, to, professionalIds }));
        setError(null);
      } catch (err) {
        setError(translateApiError(err, t));
      }
    },
    [from, to, professionalIds, t],
  );

  /** Back to the defaults (this month, every professional, no text) and search again. */
  function clearFilters() {
    const defaults = { from: oneMonthAgoYmd(), to: todayYmd(), professionalIds: (fixedProfessionalId ? [fixedProfessionalId] : []) as number[] };
    setFrom(defaults.from);
    setTo(defaults.to);
    setProfessionalIds(defaults.professionalIds);
    setQuery("");
    setAppliedQuery("");
    setPage(0);
    void load(defaults);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // One movement per sale (HU-COM-29); then the text search (the payment filter shows how many each option would show),
  // then payment and order.
  const groups = useMemo(() => groupMovements(entries ?? []), [entries]);
  const matching = useMemo(() => {
    const q = appliedQuery.trim().toLowerCase();
    return groups.filter(
      (g) => !q || g.entries.some((e) => (e.invoiceNumber ?? "").toLowerCase().includes(q) || (e.itemName ?? "").toLowerCase().includes(q)),
    );
  }, [groups, appliedQuery]);
  const isPaid = (g: MovementGroup) => g.rep.settlementStatus === "PAID";
  const counts = useMemo(() => {
    const paid = matching.filter(isPaid).length;
    return { all: matching.length, paid, unpaid: matching.length - paid };
  }, [matching]);
  const visible = useMemo(() => {
    // By date and time; at the same moment the last one registered goes first.
    const sign = order === "desc" ? -1 : 1;
    return matching
      .filter((g) => pay === "all" || (pay === "paid") === isPaid(g))
      .sort((a, b) => {
        const byDate = Date.parse(a.rep.accrualAt) - Date.parse(b.rep.accrualAt);
        return sign * (byDate !== 0 ? byDate : a.rep.id - b.rep.id);
      });
  }, [matching, order, pay]);
  /** What the lines on screen add up to (all the pages, not just the one shown). */
  const totals = useMemo(
    () => ({ amount: visible.reduce((s, g) => s + g.net, 0), retained: visible.reduce((s, g) => s + g.retained, 0) }),
    [visible],
  );
  const changedCount = visible.filter((g) => g.changed).length;

  /** The «calculation» cell: the rule and how it was split (with a retention) or just the %, and the product cost. */
  function calc(e: EntryView): { main: string; extra: string } {
    const cost = e.fixedAmount !== 0 && e.fixedToProfessional ? t("femme.commissions.settlement.lineProductCost", { amount: formatGuaraniesGs(e.fixedAmount) }) : "";
    if (e.retentionAmount === 0 || e.percentApplied === null) return { main: formatPercent(e.percentApplied), extra: cost };
    const total = Number((e.percentApplied + e.retentionPercent).toFixed(2));
    const retention = t("femme.commissions.movements.calc.retention", { percent: formatPercent(e.retentionPercent), amount: formatGuaraniesGs(e.retentionAmount) });
    return {
      main: t("femme.commissions.movements.calc.ruleToPaid", {
        kind: t(`femme.commissions.movements.ruleKind.${e.itemKind ?? "OTHER"}`),
        total: formatPercent(total),
        paid: formatPercent(e.percentApplied),
      }),
      extra: cost ? `${retention} · ${cost}` : retention,
    };
  }

  function movementLabel(e: EntryView): string {
    if (e.sourceType === "INVOICE_LINE") return t("femme.commissions.movements.type.LINE");
    if (e.sourceType === "REVERSAL") return t(`femme.commissions.reason.${e.reasonCode ?? "VOID"}`);
    return t(`femme.commissions.reason.${e.reasonCode ?? "MANUAL_ADJUSTMENT"}`);
  }

  /** The tag next to the item of a sale that has a history: why it changed. */
  function changeTag(g: MovementGroup): string {
    const known = ["RECALCULATION", "REASSIGNMENT", "VOID", "CORRECTION"];
    return t(`femme.commissions.movements.group.tag.${g.reason && known.includes(g.reason) ? g.reason : "OTHER"}`);
  }

  /** «antes 40 %» / «antes Ana» / «comprobante anulado»: what the commission was before, in a few words. */
  function changeNote(g: MovementGroup): string {
    if (!g.changed) return "";
    if (!g.current) return g.reason === "VOID" ? t("femme.commissions.movements.group.voided") : "";
    const before = [...g.entries].reverse().find((e) => e.sourceType === "INVOICE_LINE" && e.id !== g.current!.id);
    if (!before) return "";
    if (g.reason === "REASSIGNMENT") {
      return before.professionalName && before.professionalId !== g.current.professionalId
        ? t("femme.commissions.movements.group.before", { value: before.professionalName })
        : "";
    }
    if (g.reason === "RECALCULATION" && before.percentApplied !== null && before.percentApplied !== g.current.percentApplied) {
      return t("femme.commissions.movements.group.before", { value: formatPercent(before.percentApplied) });
    }
    return "";
  }

  const pageItems = visible.slice(page * size, (page + 1) * size);
  const totalPages = Math.max(1, Math.ceil(visible.length / size));

  return (
    <div className="flex flex-col gap-3" data-testid="commission-movements">
      <form
        className="flex flex-col gap-3"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          setAppliedQuery(query);
          setPage(0);
          void load();
        }}
      >
        <div className="flex gap-2">
          <div className="min-w-0 flex-1">
            <Label htmlFor="mov-query" className="sr-only">
              {t("femme.commissions.movements.search")}
            </Label>
            <Input
              id="mov-query"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("femme.commissions.movements.searchPlaceholder")}
            />
          </div>
          <Button type="submit" className="min-h-11" data-testid="movements-search">
            {t("femme.commissions.common.search")}
          </Button>
        </div>
        <button
          type="button"
          aria-expanded={filtersOpen}
          aria-controls="movements-filters"
          data-testid="movements-filters-toggle"
          onClick={() => setFiltersOpen((o) => !o)}
          className="flex min-h-12 w-full items-center justify-between gap-3 rounded-card border border-line bg-surface px-4 text-left font-heading font-extrabold text-ink"
        >
          {t("femme.commissions.movements.filtersToggle")}
          <span aria-hidden className={`text-ink-3 transition-transform ${filtersOpen ? "rotate-180" : ""}`}>
            ⌄
          </span>
        </button>
        {filtersOpen && (
          <div id="movements-filters" className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <Label htmlFor="mov-from">{t("femme.commissions.common.from")}</Label>
                <LocalizedDateInput id="mov-from" value={from} onChange={setFrom} />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="mov-to">{t("femme.commissions.common.to")}</Label>
                <LocalizedDateInput id="mov-to" value={to} onChange={setTo} />
              </div>
            </div>
            {!fixedProfessionalId && (
            <MultiSelect
              id="mov-professional"
              label={t("femme.commissions.common.professionals")}
              value={professionalIds}
              onChange={setProfessionalIds}
              options={professionals.map((p) => ({ value: p.id, label: p.fullName }))}
              placeholder={t("femme.commissions.common.allProfessionals")}
              filterPlaceholder={t("femme.commissions.common.filterProfessionals")}
              noResultsText={t("femme.commissions.common.noProfessionals")}
              summaryTemplate={t("femme.commissions.common.professionalsSelected")}
            />
            )}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" className="min-h-11">
                {t("femme.commissions.common.search")}
              </Button>
              <Button type="button" variant="secondary" className="min-h-11" onClick={clearFilters} data-testid="movements-clear-filters">
                {t("femme.commissions.common.clearFilters")}
              </Button>
            </div>
          </div>
        )}
      </form>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-sm font-extrabold text-ink-2">{t("femme.commissions.movements.pay.label")}</span>
        <div role="group" aria-label={t("femme.commissions.movements.pay.aria")} className="inline-flex rounded-full bg-primary-lt p-1">
          {(["all", "unpaid", "paid"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={pay === v}
              data-testid={`movements-pay-${v}`}
              onClick={() => {
                setPay(v);
                setPage(0);
              }}
              className={`min-h-11 rounded-full px-4 text-sm font-extrabold ${pay === v ? "bg-primary text-primary-fg" : "text-ink-2"}`}
            >
              {t(`femme.commissions.movements.pay.${v}`)} · {counts[v]}
            </button>
          ))}
        </div>
        <span className="text-[13px] text-ink-3" data-testid="movements-pay-hint">
          {t("femme.commissions.movements.pay.hint")}
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={showReversed}
          data-testid="movements-show-reversed"
          onClick={() => setShowReversed((v) => !v)}
          className="inline-flex min-h-11 items-center gap-2.5 text-sm font-bold text-ink"
        >
          <span aria-hidden className={`inline-flex h-6 w-10 shrink-0 items-center rounded-full p-0.5 ${showReversed ? "justify-end bg-primary" : "justify-start bg-line"}`}>
            <span className="size-5 rounded-full bg-surface" />
          </span>
          {t("femme.commissions.movements.group.showReversed")}
        </button>
        <button
          type="button"
          data-testid="movements-sort-mobile"
          data-order={order}
          aria-label={t(order === "desc" ? "femme.commissions.movements.sort.ariaDesc" : "femme.commissions.movements.sort.ariaAsc")}
          onClick={() => {
            setOrder(order === "desc" ? "asc" : "desc");
            setPage(0);
          }}
          className="flex min-h-12 w-full items-center justify-between gap-3 rounded-full border border-line bg-surface px-4 text-left text-sm font-extrabold text-primary md:hidden"
        >
          {t("femme.commissions.movements.sort.mobile", { order: t(order === "desc" ? "femme.commissions.movements.sort.desc" : "femme.commissions.movements.sort.asc").toLowerCase() })}
          <span aria-hidden>{order === "desc" ? "↓" : "↑"}</span>
        </button>
      </div>
      <Text variant="small" className="text-ink-3">
        {t("femme.commissions.movements.hint")}
      </Text>
      {notice && (
        <Alert variant="success" role="status">
          {notice}
        </Alert>
      )}
      {error && <Alert variant="destructive">{error}</Alert>}
      <div className="rounded-card border border-line bg-surface shadow-sm" data-testid="movements-table">
        {entries && visible.length === 0 ? (
          <Text variant="muted" className="p-4">
            {t("femme.commissions.movements.empty")}
          </Text>
        ) : (
          <>
            <div className="hidden items-center gap-x-2 border-b border-line bg-primary-lt/40 px-4 py-1 text-xs font-extrabold uppercase tracking-wide text-ink-2 md:grid md:grid-cols-[5.5rem_minmax(0,1.4fr)_6rem_6.5rem_minmax(0,1.3fr)_5.5rem_8.5rem]" data-testid="movements-head">
              <button
                type="button"
                data-testid="movements-sort"
                data-order={order}
                aria-label={t(order === "desc" ? "femme.commissions.movements.sort.ariaDesc" : "femme.commissions.movements.sort.ariaAsc")}
                onClick={() => {
                  setOrder(order === "desc" ? "asc" : "desc");
                  setPage(0);
                }}
                className="inline-flex min-h-11 items-center gap-1 self-center text-left font-extrabold uppercase tracking-wide text-primary underline underline-offset-4"
              >
                {t("femme.commissions.movements.col.date")}
                <span aria-hidden className="text-sm">
                  {order === "desc" ? "↓" : "↑"}
                </span>
              </button>
              <span>{t("femme.commissions.movements.col.item")}</span>
              <span>{t("femme.commissions.movements.col.professional")}</span>
              <span>{t("femme.commissions.movements.col.type")}</span>
              <span>{t("femme.commissions.movements.col.calc")}</span>
              <span>{t("femme.commissions.movements.col.status")}</span>
              <span className="text-right">{t("femme.commissions.movements.col.amount")}</span>
            </div>
            <ul>
              {pageItems.map((g) => {
                const e = g.rep;
                const c = calc(e);
                const note = changeNote(g);
                const open = g.changed && (showReversed || openKeys.has(g.key));
                const [datePart, ...timeParts] = formatParaguayDateTime(e.accrualAt, dateLocale).split(", ");
                return (
                  <li key={g.key} data-testid="movement-row" data-status={e.settlementStatus ?? ""} data-changed={g.changed} className="border-t border-line first:border-t-0">
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-3 text-[13px] md:gap-x-2 md:gap-y-0 md:grid-cols-[5.5rem_minmax(0,1.4fr)_6rem_6.5rem_minmax(0,1.3fr)_5.5rem_8.5rem]">
                      <div data-testid="movement-date" className="order-4 col-span-2 text-ink-3 md:order-none md:col-span-1 md:text-ink">
                        <span className="font-bold md:block">{datePart}</span> <span className="text-ink-3">{timeParts.join(", ")}</span>
                      </div>
                      <div className="order-1 min-w-0 md:order-none">
                        <div data-testid="movement-item" className="break-words text-[15px] font-bold text-ink md:text-[13px]">
                          {e.itemName ?? e.note}
                        </div>
                        {e.invoiceNumber && (
                          <div data-testid="movement-invoice" className="text-ink-3">
                            {e.invoiceNumber}
                          </div>
                        )}
                        {g.changed && (
                          <span
                            data-testid="movement-tag"
                            className={`mt-0.5 inline-flex rounded-full px-2.5 py-0.5 text-xs font-extrabold ${g.reason === "VOID" ? "bg-bg text-ink-2" : "bg-primary-lt text-primary-dk"}`}
                          >
                            {changeTag(g)}
                          </span>
                        )}
                      </div>
                      <div data-testid="movement-professional" className="order-3 col-span-2 font-bold text-ink md:order-none md:col-span-1">
                        {e.professionalName}
                      </div>
                      <div data-testid="movement-type" className="order-5 col-span-2 text-ink-2 md:order-none md:col-span-1">
                        {movementLabel(e)}
                        {e.note && e.sourceType !== "ADJUSTMENT" && <div className="text-ink-3">{e.note}</div>}
                      </div>
                      <div data-testid="movement-calc" className="order-7 col-span-2 min-w-0 md:order-none md:col-span-1">
                        <div data-testid="movement-calc-main" className="font-bold text-ink">
                          {g.current || !g.changed ? c.main : "—"}
                        </div>
                        {(g.current || !g.changed) && c.extra && (
                          <div data-testid="movement-calc-extra" className="text-ink-3">
                            {c.extra}
                          </div>
                        )}
                        {note && (
                          <div data-testid="movement-calc-note" className="text-ink-3">
                            {note}
                          </div>
                        )}
                      </div>
                      <div data-testid="movement-status" className="order-6 col-span-2 md:order-none md:col-span-1">
                        <SettlementStatusBadge status={e.settlementStatus} />
                      </div>
                      <div className="order-2 flex items-center justify-end gap-1 md:order-none">
                        <span
                          data-testid="movement-amount"
                          className={`text-right font-heading text-base font-extrabold tabular-nums ${g.net < 0 ? "text-danger" : g.changed && g.net === 0 ? "text-ink-3" : "text-ink"}`}
                        >
                          {formatGuaraniesGs(g.net)}
                        </span>
                        {e.reassignable ? (
                          <KebabMenu
                            id={`movement-${e.id}`}
                            triggerAriaLabel={t("femme.commissions.movements.rowActions")}
                            items={[
                              {
                                id: "reassign",
                                label: t("femme.commissions.reassign.action"),
                                onSelect: () => setToReassign(e),
                              },
                            ]}
                          />
                        ) : (
                          <span className="w-11" aria-hidden />
                        )}
                      </div>
                    </div>
                    {g.changed && (
                      <div className="px-4 md:pl-[6.5rem]">
                        <button
                          type="button"
                          aria-expanded={open}
                          data-testid="movement-changes-toggle"
                          onClick={() =>
                            setOpenKeys((prev) => {
                              const next = new Set(prev);
                              if (next.has(g.key)) next.delete(g.key);
                              else next.add(g.key);
                              return next;
                            })
                          }
                          className="inline-flex min-h-11 items-center gap-1 text-[13px] font-extrabold text-primary-dk underline underline-offset-4"
                        >
                          {open ? t("femme.commissions.movements.group.hide") : t("femme.commissions.movements.group.show", { count: g.entries.length })}
                          <span aria-hidden>{open ? "⌃" : "⌄"}</span>
                        </button>
                      </div>
                    )}
                    {open && (
                      <div data-testid="movement-changes" className="mx-4 mb-3 mt-1 rounded-2xl border border-line bg-bg/60 px-4 py-3">
                        <div className="mb-1 text-xs font-extrabold uppercase tracking-wide text-ink-3">{t("femme.commissions.movements.group.title")}</div>
                        <ol className="flex flex-col">
                          {g.entries.map((x, i) => {
                            const kind = x.sourceType === "REVERSAL" ? "reversal" : g.current && x.id === g.current.id ? "current" : "reverted";
                            const firstLine = g.entries.findIndex((y) => y.sourceType === "INVOICE_LINE") === i;
                            const reversedAt = x.reversesEntryId ? g.entries.findIndex((y) => y.id === x.reversesEntryId) : -1;
                            const [, ...stepTime] = formatParaguayDateTime(x.accrualAt, dateLocale).split(", ");
                            const label =
                              kind === "reversal"
                                ? t(`femme.commissions.reason.${x.reasonCode ?? "VOID"}`)
                                : t(`femme.commissions.movements.group.step.${kind === "current" ? "current" : firstLine ? "initial" : "previous"}`);
                            const sub = [
                              stepTime.join(", "),
                              new Set(g.entries.map((y) => y.professionalId)).size > 1 ? x.professionalName : null,
                              kind === "reversal" && reversedAt >= 0 ? t("femme.commissions.movements.group.reverses", { n: reversedAt + 1 }) : null,
                              kind === "reversal" ? x.note : null,
                            ]
                              .filter(Boolean)
                              .join(" · ");
                            return (
                              <li key={x.id} data-testid="movement-step" data-kind={kind} className="grid min-h-11 grid-cols-[1.5rem_minmax(0,1fr)_auto] items-start gap-x-2.5 py-1.5">
                                <span
                                  aria-hidden
                                  className={`mt-0.5 inline-flex size-5 items-center justify-center rounded-full text-[11px] font-extrabold ${
                                    kind === "reversal" ? "bg-danger-lt text-danger" : kind === "current" ? "bg-success-lt text-success" : "bg-line text-ink-2"
                                  }`}
                                >
                                  {kind === "reversal" ? "↩" : kind === "current" ? "✓" : i + 1}
                                </span>
                                <span className="flex min-w-0 flex-col">
                                  <b className="text-[13px] text-ink">
                                    {label}
                                    {x.percentApplied !== null && <span className="font-semibold text-ink-2"> · {formatPercent(x.percentApplied)}</span>}
                                  </b>
                                  <span className="text-xs text-ink-3">{sub}</span>
                                </span>
                                <span className="flex flex-col items-end gap-0.5">
                                  <b
                                    data-testid="movement-step-amount"
                                    className={`tabular-nums text-sm ${kind === "reversal" ? "text-danger" : kind === "reverted" ? "text-ink-3 line-through" : "text-ink"}`}
                                  >
                                    {formatGuaraniesGs(x.commissionAmount)}
                                  </b>
                                  <span
                                    className={`rounded-full px-2 py-0.5 text-[11px] font-extrabold ${
                                      kind === "reversal" ? "bg-danger-lt text-danger" : kind === "current" ? "bg-success-lt text-success" : "bg-bg text-ink-2"
                                    }`}
                                  >
                                    {t(`femme.commissions.movements.group.stepTag.${kind}`)}
                                  </span>
                                </span>
                              </li>
                            );
                          })}
                        </ol>
                        <div className="mt-1 border-t border-dashed border-line pt-2 text-[13px] text-ink-2" data-testid="movement-changes-net">
                          {t("femme.commissions.movements.group.net", { amount: formatGuaraniesGs(g.net) })}
                          {!g.current && ` ${t("femme.commissions.movements.group.noCurrent")}`}
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
        {visible.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 border-t border-line bg-bg/60 px-4 py-3 text-sm text-ink-2" data-testid="movements-totals">
            <span>
              {t("femme.commissions.movements.totals.total")}{" "}
              <b className="tabular-nums text-ink" data-testid="movements-total-amount">
                {formatGuaraniesGs(totals.amount)}
              </b>
            </span>
            {changedCount > 0 && (
              <span className="text-ink-3" data-testid="movements-changed-count">
                {t("femme.commissions.movements.group.changedCount", { count: changedCount })}
              </span>
            )}
            {totals.retained !== 0 && (
              <span>
                {t("femme.commissions.movements.totals.retained")}{" "}
                <b className="tabular-nums text-warning" data-testid="movements-total-retained">
                  {formatGuaraniesGs(totals.retained)}
                </b>
              </span>
            )}
          </div>
        )}
        {visible.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-3 py-3">
            <PageSizeSelect
              value={size}
              onChange={(s) => {
                setSize(s);
                setPage(0);
              }}
              label={t("femme.pagination.rowsPerPage")}
            />
            <Text variant="small" className="text-ink-3">
              {t("femme.pagination.showingRange", {
                from: page * size + 1,
                to: Math.min((page + 1) * size, visible.length),
                total: visible.length,
              })}
            </Text>
            <Pagination
              page={page + 1}
              pageCount={totalPages}
              onPageChange={(p) => setPage(p - 1)}
              previousLabel={t("femme.pagination.previous")}
              nextLabel={t("femme.pagination.next")}
            />
          </div>
        )}
      </div>
      <ReassignDialog
        entry={toReassign}
        onClose={() => setToReassign(null)}
        onDone={() => {
          setToReassign(null);
          setNotice(t("femme.commissions.reassign.done"));
          void load();
        }}
      />
    </div>
  );
}
