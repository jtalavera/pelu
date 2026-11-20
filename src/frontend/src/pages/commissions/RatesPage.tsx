import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { Alert, Button, Input, Label, Modal, Select, Spinner } from "@design-system";
import { getRates, type ConfigChange, type FixedDestination, type RateGroup, type RateItem, type RatesView } from "../../api/commissions";
import { translateApiError } from "../../api/parseApiErrorMessage";
import { FieldValidationError } from "../../components/FieldValidationError";
import { ACTION_BUTTON } from "../../components/actionButtons";
import { ApplyChangeDialog } from "./ApplyChangeDialog";
import { formatPercent, parsePercentInput } from "./common";
import { useOverview } from "./overview";
import { parseFixedInput, ruleValue } from "./ruleMath";

type Target =
  | { kind: "GENERAL"; itemKind: "SERVICE" | "PRODUCT" }
  | { kind: "GROUP"; group: RateGroup }
  | { kind: "SERVICE"; item: RateItem };

type Draft = { percent: string; fixed: string; destination: "DEFAULT" | FixedDestination; more: boolean; error: string | null };

const normalize = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const num = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n).replace(".", ","));
const money = (n: number | null | undefined) => (!n ? "" : new Intl.NumberFormat("es-PY").format(n));

const LINK_BTN = "inline-flex min-h-11 items-center rounded-xl border border-line px-4 text-sm font-extrabold text-primary";

/**
 * Comisiones › Configurar › Comisiones (HU-COM-20): what each group and each service pays, the same
 * for everybody. A service pays its own %, else its group's, else the general one; if a professional
 * is paid differently it is noted on her page (and shown here under the service).
 */
export function RatesPage() {
  const { t } = useTranslation();
  const { refresh } = useOverview();
  const [params] = useSearchParams();
  const [rates, setRates] = useState<RatesView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [target, setTarget] = useState<Target | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [apply, setApply] = useState<{ changes: ConfigChange[]; summary: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setRates(await getRates());
      setError(null);
    } catch (err) {
      setError(translateApiError(err, t));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const needle = normalize(query.trim());
  const itemMatches = useCallback((i: RateItem) => !needle || normalize(i.name).includes(needle), [needle]);
  const visibleGroups = useMemo(
    () =>
      (rates?.groups ?? []).filter((g) => !needle || normalize(g.name).includes(needle) || g.items.some(itemMatches)),
    [rates, needle, itemMatches],
  );

  if (!rates) return error ? <Alert variant="destructive">{error}</Alert> : <Spinner />;

  const destLabel = (d: FixedDestination) => t(`femme.commissions.rates.destination.${d}`);
  const isOpen = (id: number) => !!needle || open.has(id);
  const toggle = (id: number) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  function startEdit(tg: Target) {
    setNotice(null);
    setTarget(tg);
    if (tg.kind === "GENERAL") {
      const p = tg.itemKind === "PRODUCT" ? rates!.generalProductPercent : rates!.generalServicePercent;
      setDraft({ percent: num(p), fixed: "", destination: "DEFAULT", more: false, error: null });
    } else if (tg.kind === "GROUP") {
      const g = tg.group;
      setDraft({ percent: num(g.percent), fixed: money(g.fixedAmount), destination: g.fixedDestination ?? "DEFAULT", more: !!g.fixedAmount, error: null });
    } else {
      const i = tg.item;
      // Starting from what it pays now, so the user only changes what differs.
      setDraft({
        percent: num(i.ownPercent ?? i.normalPercent),
        fixed: money(i.ownFixedAmount ?? i.normalFixedAmount),
        destination: i.ownFixedDestination ?? "DEFAULT",
        more: !!(i.ownFixedAmount ?? i.normalFixedAmount),
        error: null,
      });
    }
  }

  function save() {
    if (!target || !draft) return;
    const fail = (key: string) => setDraft({ ...draft, error: t(`femme.commissions.rates.validation.${key}`) });
    const percent = parsePercentInput(draft.percent);
    if (!draft.percent.trim()) return fail("required");
    if (percent === null) return fail("percent");
    const fixed = parseFixedInput(draft.fixed);
    if (fixed === null) return fail("fixed");
    const pct = formatPercent(percent);
    if (target.kind === "GENERAL") {
      const current = target.itemKind === "PRODUCT" ? rates!.generalProductPercent : rates!.generalServicePercent;
      if (Number(percent) === Number(current)) return setTarget(null);
      setApply({
        changes: [{ scope: target.itemKind === "PRODUCT" ? "DEFAULT_PRODUCT" : "DEFAULT_SERVICE", value: percent }],
        summary: t("femme.commissions.rates.applyGeneral", { kind: t(`femme.commissions.rates.kind.${target.itemKind}`), percent: pct }),
      });
    } else if (target.kind === "GROUP") {
      setApply({
        changes: [{ scope: "GROUP_RULE", groupId: target.group.id, value: ruleValue({ paid: percent, retention: "", fixed, destination: draft.destination }) }],
        summary: t("femme.commissions.rates.applyGroup", { name: target.group.name, percent: pct }),
      });
    } else {
      setApply({
        changes: [{ scope: "RULE", serviceId: target.item.serviceId, value: ruleValue({ paid: percent, retention: "", fixed, destination: draft.destination }) }],
        summary: t("femme.commissions.rates.applyService", { name: target.item.name, percent: pct }),
      });
    }
  }

  const title = !target
    ? ""
    : target.kind === "GENERAL"
      ? t("femme.commissions.rates.editGeneral", { kind: t(`femme.commissions.rates.kind.${target.itemKind}`) })
      : target.kind === "GROUP"
        ? t("femme.commissions.rates.editGroup", { name: target.group.name })
        : t("femme.commissions.rates.editService", { name: target.item.name });

  const itemRow = (i: RateItem) => (
    <div
      key={i.serviceId}
      data-testid="rates-item"
      data-item-name={i.name}
      data-source={i.source}
      className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-t border-line py-2 first:border-t-0 sm:grid-cols-[minmax(0,1fr)_auto_auto]"
    >
      <span className="min-w-0">
        <span className="block truncate text-[15px] font-bold text-ink">
          {i.name}
          {i.kind === "PRODUCT" && <span className="ml-2 text-[11px] font-extrabold uppercase text-ink-3">{t("femme.commissions.rates.itemKind.PRODUCT")}</span>}
        </span>
        {i.exceptions.length > 0 && (
          <span className="block text-xs font-bold text-warning" data-testid="rates-item-exceptions">
            {t("femme.commissions.rates.exceptions", { count: i.exceptions.length, names: i.exceptions.slice(0, 3).map((e) => `${e.professionalName} ${formatPercent(e.percent)}`).join(", ") })}
          </span>
        )}
      </span>
      <span className={`text-[15px] ${i.source === "SERVICE" ? "font-extrabold text-ink" : "text-ink-3"}`} data-testid="rates-item-percent">
        {formatPercent(i.normalPercent)} <span className="text-xs font-semibold">· {t(`femme.commissions.rates.source.${i.source}`)}</span>
      </span>
      <span className="col-span-2 flex justify-end gap-1 sm:col-span-1">
        {i.source === "SERVICE" ? (
          <>
            <Button type="button" variant="secondary" className="min-h-11" data-testid="rates-item-edit" aria-label={`${t("femme.commissions.rules.change")}: ${i.name}`} onClick={() => startEdit({ kind: "SERVICE", item: i })}>
              {t("femme.commissions.rules.change")}
            </Button>
            <button
              type="button"
              className="inline-flex min-h-11 items-center px-3 text-sm font-extrabold text-danger"
              data-testid="rates-item-remove"
              aria-label={`${t("femme.commissions.rates.remove")}: ${i.name}`}
              onClick={() =>
                setApply({
                  changes: [{ scope: "RULE", serviceId: i.serviceId, value: null }],
                  summary: t("femme.commissions.rates.applyRemove", { name: i.name }),
                })
              }
            >
              {t("femme.commissions.rates.remove")}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="inline-flex min-h-11 items-center px-3 text-sm font-extrabold text-primary"
            data-testid="rates-item-own"
            aria-label={`${t("femme.commissions.rates.own")}: ${i.name}`}
            onClick={() => startEdit({ kind: "SERVICE", item: i })}
          >
            {t("femme.commissions.rates.own")}
          </button>
        )}
      </span>
    </div>
  );

  const percentPill = (p: number | null, testId: string) =>
    p === null ? (
      <span data-testid={testId} className="inline-flex min-h-11 min-w-[76px] items-center justify-center rounded-xl border border-dashed border-warning/50 bg-warning-lt px-3 text-sm font-extrabold text-warning">
        {t("femme.commissions.rates.noPercent")}
      </span>
    ) : (
      <span data-testid={testId} className="inline-flex min-h-11 min-w-[76px] items-center justify-center rounded-xl bg-primary-lt px-3 text-[17px] font-extrabold text-primary-dk">
        {formatPercent(p)}
      </span>
    );

  return (
    <div className="flex flex-col gap-3.5" data-testid="commission-rates">
      <div>
        <Link to="/app/commissions/configurar" className="inline-flex min-h-11 items-center text-sm font-bold text-primary" data-testid="rates-back">
          ← {t("femme.commissions.config.back")}
        </Link>
        <h2 className="font-heading text-2xl font-extrabold text-ink">{t("femme.commissions.rates.title")}</h2>
        <p className="text-sm text-ink-3">{t("femme.commissions.rates.subtitle")}</p>
      </div>

      <form role="search" className="flex gap-2" onSubmit={(e) => e.preventDefault()}>
        <div className="min-w-0 flex-1">
          <Label htmlFor="rates-search" className="sr-only">
            {t("femme.commissions.config.searchLabel")}
          </Label>
          <Input id="rates-search" type="search" value={query} placeholder={t("femme.commissions.config.searchPlaceholder")} data-testid="rates-search" onChange={(e) => setQuery(e.target.value)} />
        </div>
        <Button type="submit" variant="secondary" className="min-h-11" data-testid="rates-search-submit">
          {t("femme.commissions.groups.searchSubmit")}
        </Button>
      </form>

      <p className="rounded-2xl bg-primary-lt px-4 py-3 text-sm text-ink" data-testid="rates-help">
        {t("femme.commissions.rates.help")}
      </p>

      {notice && (
        <Alert variant="success" role="status" data-testid="rates-notice">
          {notice}
        </Alert>
      )}
      {error && <Alert variant="destructive">{error}</Alert>}

      <section className="overflow-hidden rounded-card border border-line bg-surface shadow-sm">
        {/* % general */}
        {(["SERVICE", "PRODUCT"] as const).map((k) => (
          <div key={k} data-testid={`rates-general-${k}`} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 border-b border-line bg-bg px-4 py-3 sm:px-5">
            <span className="min-w-0">
              <b className="block text-base text-ink">{t("femme.commissions.rates.general", { kind: t(`femme.commissions.rates.kind.${k}`) })}</b>
              <span className="text-[13px] text-ink-3">{t("femme.commissions.rates.generalHelp")}</span>
            </span>
            <b className="text-[17px] text-ink" data-testid={`rates-general-${k}-percent`}>
              {formatPercent(k === "PRODUCT" ? rates.generalProductPercent : rates.generalServicePercent)}
            </b>
            <Button type="button" variant="secondary" className="min-h-11" data-testid={`rates-general-${k}-edit`} aria-label={`${t("femme.commissions.rules.change")}: ${t("femme.commissions.rates.general", { kind: t(`femme.commissions.rates.kind.${k}`) })}`} onClick={() => startEdit({ kind: "GENERAL", itemKind: k })}>
              {t("femme.commissions.rules.change")}
            </Button>
          </div>
        ))}

        {/* groups */}
        <ul className="m-0 list-none p-0">
          {visibleGroups.map((g) => {
            const expanded = isOpen(g.id);
            // A search that matches the group's name shows all of its services; otherwise only the ones that match.
            const items = needle && !normalize(g.name).includes(needle) ? g.items.filter(itemMatches) : g.items;
            return (
              <li key={g.id} data-testid="rates-group" data-group-name={g.name} className="border-b border-line last:border-b-0">
                <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 px-4 py-2.5 sm:px-5">
                  <button
                    type="button"
                    aria-expanded={expanded}
                    data-testid="rates-group-toggle"
                    onClick={() => toggle(g.id)}
                    className="min-h-11 min-w-0 text-left"
                  >
                    <b className="block truncate font-heading text-[17px] text-ink">
                      {g.name} <span aria-hidden className={`inline-block text-sm font-semibold text-ink-3 transition-transform ${expanded ? "rotate-180" : ""}`}>⌄</span>
                    </b>
                    <span className="text-[13px] text-ink-3">{t("femme.commissions.groups.services", { count: g.items.length })}</span>
                  </button>
                  {percentPill(g.percent, "rates-group-percent")}
                  <Button
                    type="button"
                    variant={g.percent === null ? "primary" : "secondary"}
                    className="min-h-11"
                    data-testid="rates-group-edit"
                    aria-label={`${g.percent === null ? t("femme.commissions.rates.setPercent") : t("femme.commissions.rules.change")}: ${g.name}`}
                    onClick={() => startEdit({ kind: "GROUP", group: g })}
                  >
                    {g.percent === null ? t("femme.commissions.rates.setPercent") : t("femme.commissions.rules.change")}
                  </Button>
                </div>
                {expanded && (
                  <div className="border-t border-line bg-bg/60 px-4 pb-2.5 pt-1 sm:pl-10 sm:pr-5" data-testid="rates-group-items">
                    {items.length === 0 ? <p className="py-3 text-sm text-ink-3">{t("femme.commissions.rates.noServices")}</p> : items.map(itemRow)}
                  </div>
                )}
              </li>
            );
          })}

          {/* no group */}
          {rates.ungrouped.length > 0 && (!needle || rates.ungrouped.some(itemMatches)) && (
            <li data-testid="rates-ungrouped" className="border-t border-dashed border-ink-3/40 bg-bg/60">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5 sm:px-5">
                <button type="button" aria-expanded={isOpen(0)} data-testid="rates-ungrouped-toggle" onClick={() => toggle(0)} className="min-h-11 min-w-0 text-left">
                  <b className="block text-base text-ink">
                    {t("femme.commissions.rates.ungrouped")} <span aria-hidden className={`inline-block text-sm font-semibold text-ink-3 transition-transform ${isOpen(0) ? "rotate-180" : ""}`}>⌄</span>
                  </b>
                  <span className="text-[13px] text-ink-3" data-testid="rates-ungrouped-help">
                    {t("femme.commissions.rates.ungroupedHelp", { count: rates.ungrouped.length, percent: formatPercent(rates.generalServicePercent) })}
                  </span>
                </button>
                <Link to="/app/commissions/configurar/grupos?group=none" className={LINK_BTN} data-testid="rates-order-link">
                  {t("femme.commissions.rates.order")}
                </Link>
              </div>
              {isOpen(0) && (
                <div className="border-t border-line px-4 pb-2.5 pt-1 sm:pl-10 sm:pr-5" data-testid="rates-ungrouped-items">
                  {rates.ungrouped.filter(itemMatches).map(itemRow)}
                </div>
              )}
            </li>
          )}
        </ul>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <Link to="/app/commissions/configurar/grupos" className={LINK_BTN} data-testid="rates-groups-link">
          {t("femme.commissions.rates.newGroup")}
        </Link>
        <span className="text-[13px] text-ink-3">{t("femme.commissions.rates.footer")}</span>
      </div>

      <Modal
        open={target !== null}
        onClose={() => setTarget(null)}
        title={title}
        className="max-w-lg"
        footer={
          <>
            <Button type="button" variant="secondary" className={`${ACTION_BUTTON} w-full sm:w-auto`} onClick={() => setTarget(null)}>
              {t("femme.commissions.common.cancel")}
            </Button>
            <Button type="button" className={`${ACTION_BUTTON} w-full sm:w-auto`} data-testid="rates-save" onClick={save}>
              {t("femme.commissions.rules.apply")}
            </Button>
          </>
        }
      >
        {draft && target && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="rates-percent">{t("femme.commissions.rates.percentLabel")}</Label>
              <Input
                id="rates-percent"
                inputMode="decimal"
                className="max-w-[8rem]"
                value={draft.percent}
                invalid={!!draft.error}
                aria-describedby={draft.error ? "rates-percent-error" : undefined}
                data-testid="rates-percent"
                onChange={(e) => setDraft({ ...draft, percent: e.target.value, error: null })}
              />
              <FieldValidationError id="rates-percent-error">{draft.error}</FieldValidationError>
              <p className="text-sm text-ink-3">{t("femme.commissions.rates.percentHelp")}</p>
            </div>
            {target.kind !== "GENERAL" && (
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  aria-expanded={draft.more}
                  data-testid="rates-more-toggle"
                  onClick={() => setDraft({ ...draft, more: !draft.more })}
                  className="inline-flex min-h-11 items-center self-start text-sm font-extrabold text-primary"
                >
                  {t("femme.commissions.rates.more")} {draft.more ? "⌃" : "⌄"}
                </button>
                {draft.more && (
                  <div className="flex flex-col gap-3 rounded-xl bg-bg p-3">
                    <div className="flex flex-col gap-1">
                      <Label htmlFor="rates-fixed">{t("femme.commissions.rates.fixedLabel")}</Label>
                      <Input id="rates-fixed" inputMode="numeric" className="max-w-[10rem]" value={draft.fixed} data-testid="rates-fixed" onChange={(e) => setDraft({ ...draft, fixed: e.target.value, error: null })} />
                      <p className="text-sm text-ink-3">{t("femme.commissions.rates.fixedHelp")}</p>
                    </div>
                    <div className="flex flex-col gap-1">
                      <Label htmlFor="rates-destination">{t("femme.commissions.rates.destinationLabel")}</Label>
                      <Select id="rates-destination" value={draft.destination} data-testid="rates-destination" onChange={(e) => setDraft({ ...draft, destination: e.target.value as Draft["destination"] })}>
                        <option value="DEFAULT">{t("femme.commissions.rates.destinationDefault", { value: destLabel(rates.defaultFixedDestination) })}</option>
                        <option value="PROFESSIONAL">{destLabel("PROFESSIONAL")}</option>
                        <option value="SALON">{destLabel("SALON")}</option>
                      </Select>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </Modal>

      <ApplyChangeDialog
        open={apply !== null}
        changes={apply?.changes ?? []}
        summary={apply?.summary ?? ""}
        onClose={() => setApply(null)}
        onApplied={() => {
          setApply(null);
          setTarget(null);
          setNotice(t("femme.commissions.applyDialog.applied"));
          void Promise.all([load(), refresh()]);
        }}
      />
    </div>
  );
}
