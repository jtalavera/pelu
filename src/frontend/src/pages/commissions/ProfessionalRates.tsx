import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Alert, Button, Input, Label, Modal, Select, Spinner } from "@design-system";
import {
  getProfessionalsSummary,
  getRates,
  type ConfigChange,
  type FixedDestination,
  type ProfessionalsRuleSummary,
  type RateException,
  type RateGroup,
  type RateItem,
  type RatesView,
} from "../../api/commissions";
import { translateApiError } from "../../api/parseApiErrorMessage";
import { FieldValidationError } from "../../components/FieldValidationError";
import { ACTION_BUTTON } from "../../components/actionButtons";
import { formatGuaraniesGs } from "../../lib/formatMoney";
import { ApplyChangeDialog } from "./ApplyChangeDialog";
import { formatPercent, parsePercentInput } from "./common";
import { useOverview } from "./overview";
import { ruleValue } from "./ruleMath";

type Mine = { item: RateItem; exception: RateException };
/** What is shown for her: a whole group (every service of it, same %) or one service. */
type Row =
  | { kind: "GROUP"; group: RateGroup; mine: Mine[]; missing: RateItem[]; percent: number }
  | { kind: "SERVICE"; mine: Mine };

type Draft =
  | { kind: "ADD"; mode: "GROUP" | "SERVICE"; groupId: string; serviceId: string; percent: string; error: string | null }
  | { kind: "EDIT"; row: Row; percent: string; error: string | null };

const sameRule = (a: RateException, b: RateException) =>
  Number(a.percent) === Number(b.percent) && Number(a.fixedAmount) === Number(b.fixedAmount) && (a.fixedDestination ?? "") === (b.fixedDestination ?? "");

/** Her exceptions grouped the way they are said: «Corte · 6 de 7 servicios» or one service. */
function rowsOf(rates: RatesView, professionalId: number): Row[] {
  const rows: Row[] = [];
  const single: Mine[] = [];
  for (const g of rates.groups) {
    const mine: Mine[] = g.items.flatMap((item) => {
      const exception = item.exceptions.find((e) => e.professionalId === professionalId);
      return exception ? [{ item, exception }] : [];
    });
    if (mine.length >= 2 && mine.every((m) => sameRule(m.exception, mine[0].exception))) {
      rows.push({
        kind: "GROUP",
        group: g,
        mine,
        missing: g.items.filter((i) => !mine.some((m) => m.item.serviceId === i.serviceId)),
        percent: mine[0].exception.percent,
      });
    } else {
      single.push(...mine);
    }
  }
  for (const item of rates.ungrouped) {
    const exception = item.exceptions.find((e) => e.professionalId === professionalId);
    if (exception) single.push({ item, exception });
  }
  single.sort((a, b) => a.item.name.localeCompare(b.item.name));
  return [...rows, ...single.map((mine) => ({ kind: "SERVICE" as const, mine }))];
}

const rowItems = (r: Row): Mine[] => (r.kind === "GROUP" ? r.mine : [r.mine]);

/**
 * Comisiones › Equipo › one professional › Comisiones (HU-COM-20): she is paid the usual % of each
 * service; here are only her retention for aguinaldo and the services where she is paid differently.
 */
export function ProfessionalRates({ professionalId }: { professionalId: number }) {
  const { t } = useTranslation();
  const { refresh } = useOverview();
  const [rates, setRates] = useState<RatesView | null>(null);
  const [summary, setSummary] = useState<ProfessionalsRuleSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [retention, setRetention] = useState<{ value: string; error: string | null } | null>(null);
  const [apply, setApply] = useState<{ changes: ConfigChange[]; summary: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const [r, s] = await Promise.all([getRates(), getProfessionalsSummary()]);
      setRates(r);
      setSummary(s);
      setError(null);
    } catch (err) {
      setError(translateApiError(err, t));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(() => (rates ? rowsOf(rates, professionalId) : []), [rates, professionalId]);
  const me = summary?.professionals.find((p) => p.professionalId === professionalId) ?? null;
  const name = me?.name ?? "";
  const aguinaldoOn = summary?.aguinaldoEnabled ?? false;
  const retains = me?.retentionPercent ?? null;
  const allItems = useMemo(() => (rates ? [...rates.groups.flatMap((g) => g.items), ...rates.ungrouped] : []), [rates]);

  if (error && !rates) return <Alert variant="destructive">{error}</Alert>;
  if (!rates || !summary) return <Spinner />;

  /** The rule of one of her exceptions: the % she is paid, with the product cost the service has. */
  const valueFor = (item: RateItem, percent: string) =>
    ruleValue({
      paid: percent,
      retention: "",
      fixed: item.normalFixedAmount,
      destination: item.normalFixedDestination === rates.defaultFixedDestination ? "DEFAULT" : (item.normalFixedDestination as FixedDestination),
    });
  const changeFor = (item: RateItem, percent: string | null): ConfigChange => ({
    scope: "RULE",
    serviceId: item.serviceId,
    professionalId,
    value: percent === null ? null : valueFor(item, percent),
  });

  function startAdd() {
    setNotice(null);
    setDraft({ kind: "ADD", mode: "GROUP", groupId: "", serviceId: "", percent: "", error: null });
  }

  function save() {
    if (!draft) return;
    const percent = parsePercentInput(draft.percent);
    if (!draft.percent.trim()) return setDraft({ ...draft, error: t("femme.commissions.rates.validation.required") });
    if (percent === null) return setDraft({ ...draft, error: t("femme.commissions.rates.validation.percent") });
    if (draft.kind === "EDIT") {
      const items = rowItems(draft.row).map((m) => m.item);
      setApply({
        changes: items.map((i) => changeFor(i, percent)),
        summary:
          draft.row.kind === "GROUP"
            ? t("femme.commissions.pro.rates.applyGroup", { name, group: draft.row.group.name, percent: formatPercent(percent) })
            : t("femme.commissions.pro.rates.applyService", { name, service: items[0].name, percent: formatPercent(percent) }),
      });
      return;
    }
    if (draft.mode === "GROUP") {
      const group = rates!.groups.find((g) => String(g.id) === draft.groupId);
      if (!group) return setDraft({ ...draft, error: t("femme.commissions.pro.rates.pickGroup") });
      setApply({
        changes: group.items.map((i) => changeFor(i, percent)),
        summary: t("femme.commissions.pro.rates.applyGroup", { name, group: group.name, percent: formatPercent(percent) }),
      });
    } else {
      const item = allItems.find((i) => String(i.serviceId) === draft.serviceId);
      if (!item) return setDraft({ ...draft, error: t("femme.commissions.pro.rates.pickService") });
      setApply({
        changes: [changeFor(item, percent)],
        summary: t("femme.commissions.pro.rates.applyService", { name, service: item.name, percent: formatPercent(percent) }),
      });
    }
  }

  /** The % she would be paid and what goes to her fund, on a price of Gs. 100.000 (the example of the dialog). */
  function example(percentRaw: string) {
    const percent = parsePercentInput(percentRaw);
    if (percent === null) return null;
    const total = Number(percent);
    const kept = aguinaldoOn && retains ? Math.min(Number(retains), total) : 0;
    return { commission: Math.round(total * 1000), paid: Math.round((total - kept) * 1000), retained: Math.round(kept * 1000), kept };
  }

  const dialogGroup = draft?.kind === "ADD" && draft.mode === "GROUP" ? rates.groups.find((g) => String(g.id) === draft.groupId) : undefined;
  const ex = draft ? example(draft.percent) : null;

  const rowTitle = (r: Row) =>
    r.kind === "GROUP"
      ? t("femme.commissions.pro.rates.groupTitle", { group: r.group.name, count: r.mine.length, total: r.group.items.length })
      : r.mine.item.name;
  const rowNormal = (r: Row) => {
    const normals = [...new Set(rowItems(r).map((m) => m.item.normalPercent))];
    return normals.length === 1 ? t("femme.commissions.pro.rates.normal", { percent: formatPercent(normals[0]) }) : t("femme.commissions.pro.rates.normalVaries");
  };
  const rowPercent = (r: Row) => (r.kind === "GROUP" ? r.percent : r.mine.exception.percent);

  return (
    <section className="flex min-w-0 flex-col gap-3.5" data-testid="pro-rates">
      <div className="rounded-card bg-primary-lt px-5 py-4" data-testid="pro-rates-usual">
        <b className="block text-base text-ink">{t("femme.commissions.pro.rates.usualTitle", { name })}</b>
        <span className="text-sm text-ink-2">
          {t("femme.commissions.pro.rates.usualHelp")}{" "}
          <Link to="/app/commissions/configurar/comisiones" className="font-bold text-primary underline" data-testid="pro-rates-link">
            {t("femme.commissions.pro.rates.usualLink")}
          </Link>
        </span>
      </div>

      {notice && (
        <Alert variant="success" role="status" data-testid="pro-rates-notice">
          {notice}
        </Alert>
      )}
      {error && <Alert variant="destructive">{error}</Alert>}

      {aguinaldoOn && (
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-card border border-line bg-surface px-5 py-4" data-testid="pro-retention">
          <span>
            <b className="block text-[17px] text-ink" data-testid="pro-retention-current">
              {retains ? t("femme.commissions.pro.rates.retention", { percent: formatPercent(retains) }) : t("femme.commissions.pro.rates.retentionNone")}
            </b>
            <span className="text-[13px] text-ink-3">{t("femme.commissions.pro.rates.retentionHelp")}</span>
          </span>
          <Button
            type="button"
            variant="secondary"
            className="min-h-11"
            data-testid="pro-retention-edit"
            onClick={() => {
              setNotice(null);
              setRetention({ value: retains ? String(retains).replace(".", ",") : "", error: null });
            }}
          >
            {t("femme.commissions.rules.change")}
          </Button>
        </div>
      )}

      <div className="flex flex-col gap-1 rounded-card border border-line bg-surface px-5 py-4" data-testid="pro-differences">
        <div className="flex flex-wrap items-center gap-3 pb-1.5">
          <span className="min-w-0 flex-1 basis-64">
            <b className="block text-lg text-ink">{t("femme.commissions.pro.rates.differentTitle")}</b>
            <span className="text-[13px] text-ink-3" data-testid="pro-differences-count">
              {t("femme.commissions.pro.rates.differentCount", { count: rows.length })}
            </span>
          </span>
          <Button type="button" className={ACTION_BUTTON} data-testid="pro-rates-add" onClick={startAdd}>
            {t("femme.commissions.pro.rates.add")}
          </Button>
        </div>

        {rows.length === 0 && (
          <p className="border-t border-line pt-3 text-sm text-ink-3" data-testid="pro-differences-empty">
            {t("femme.commissions.pro.rates.none", { name })}
          </p>
        )}
        {rows.map((r) => (
          <div
            key={r.kind === "GROUP" ? `g${r.group.id}` : `s${r.mine.item.serviceId}`}
            data-testid="pro-rate-row"
            data-kind={r.kind}
            data-name={r.kind === "GROUP" ? r.group.name : r.mine.item.name}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-t border-line py-2.5 sm:grid-cols-[minmax(0,1fr)_auto_auto]"
          >
            <span className="min-w-0">
              <b className="block truncate text-base text-ink" data-testid="pro-rate-title">
                {rowTitle(r)}
              </b>
              <span className="block text-[13px] text-ink-3" data-testid="pro-rate-normal">
                {rowNormal(r)}
              </span>
              {r.kind === "GROUP" && r.missing.length > 0 && (
                <span className="block text-[13px] font-bold text-warning" data-testid="pro-rate-missing">
                  {t("femme.commissions.pro.rates.missing", { count: r.missing.length, names: r.missing.slice(0, 3).map((i) => i.name).join(", ") })}{" "}
                  <button
                    type="button"
                    className="font-extrabold text-primary underline"
                    data-testid="pro-rate-include"
                    onClick={() => {
                      setNotice(null);
                      setApply({
                        changes: r.missing.map((i) => changeFor(i, String(r.percent))),
                        summary: t("femme.commissions.pro.rates.applyInclude", { name, group: r.group.name, count: r.missing.length, percent: formatPercent(r.percent) }),
                      });
                    }}
                  >
                    {t("femme.commissions.pro.rates.include", { count: r.missing.length })}
                  </button>
                </span>
              )}
            </span>
            <b className="text-xl tabular-nums text-ink" data-testid="pro-rate-percent">
              {formatPercent(rowPercent(r))}
            </b>
            <span className="col-span-2 flex justify-end gap-2 sm:col-span-1">
              <Button
                type="button"
                variant="secondary"
                className="min-h-11"
                data-testid="pro-rate-edit"
                aria-label={`${t("femme.commissions.rules.change")}: ${rowTitle(r)}`}
                onClick={() => {
                  setNotice(null);
                  setDraft({ kind: "EDIT", row: r, percent: String(rowPercent(r)).replace(".", ","), error: null });
                }}
              >
                {t("femme.commissions.rules.change")}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="min-h-11 !border-danger/40 !text-danger"
                data-testid="pro-rate-remove"
                aria-label={`${t("femme.commissions.rates.remove")}: ${rowTitle(r)}`}
                onClick={() => {
                  setNotice(null);
                  setApply({
                    changes: rowItems(r).map((m) => changeFor(m.item, null)),
                    summary: t("femme.commissions.pro.rates.applyRemove", { name, what: r.kind === "GROUP" ? r.group.name : r.mine.item.name }),
                  });
                }}
              >
                {t("femme.commissions.rates.remove")}
              </Button>
            </span>
          </div>
        ))}
        {rows.length > 0 && <p className="border-t border-line pt-3 text-[13px] text-ink-3">{t("femme.commissions.pro.rates.footer")}</p>}
      </div>

      <Modal
        open={draft !== null}
        onClose={() => setDraft(null)}
        title={draft?.kind === "EDIT" ? t("femme.commissions.pro.rates.editTitle", { what: rowTitle(draft.row) }) : t("femme.commissions.pro.rates.addTitle", { name })}
        className="max-w-lg"
        footer={
          <>
            <Button type="button" variant="secondary" className={`${ACTION_BUTTON} w-full sm:w-auto`} onClick={() => setDraft(null)}>
              {t("femme.commissions.common.cancel")}
            </Button>
            <Button type="button" className={`${ACTION_BUTTON} w-full sm:w-auto`} data-testid="pro-rate-save" onClick={save}>
              {t("femme.commissions.rules.apply")}
            </Button>
          </>
        }
      >
        {draft && (
          <div className="flex flex-col gap-3" data-testid="pro-rate-dialog">
            {draft.kind === "ADD" && (
              <>
                <div className="flex flex-wrap gap-2" role="group" aria-label={t("femme.commissions.pro.rates.addTitle", { name })}>
                  {(["GROUP", "SERVICE"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      aria-pressed={draft.mode === m}
                      data-testid={`pro-rate-mode-${m}`}
                      onClick={() => setDraft({ ...draft, mode: m, error: null })}
                      className={`min-h-11 rounded-full border px-4 text-sm font-extrabold ${
                        draft.mode === m ? "border-primary bg-primary-lt text-primary" : "border-line bg-surface text-ink"
                      }`}
                    >
                      {t(`femme.commissions.pro.rates.mode.${m}`)}
                    </button>
                  ))}
                </div>
                {draft.mode === "GROUP" ? (
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="pro-rate-group">{t("femme.commissions.pro.rates.groupLabel")}</Label>
                    <Select id="pro-rate-group" value={draft.groupId} data-testid="pro-rate-group" onChange={(e) => setDraft({ ...draft, groupId: e.target.value, error: null })}>
                      <option value="">{t("femme.commissions.pro.rates.pickGroup")}</option>
                      {rates.groups
                        .filter((g) => g.items.length > 0)
                        .map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.name}
                          </option>
                        ))}
                    </Select>
                  </div>
                ) : (
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="pro-rate-service">{t("femme.commissions.pro.rates.serviceLabel")}</Label>
                    <Select id="pro-rate-service" value={draft.serviceId} data-testid="pro-rate-service" onChange={(e) => setDraft({ ...draft, serviceId: e.target.value, error: null })}>
                      <option value="">{t("femme.commissions.pro.rates.pickService")}</option>
                      {allItems
                        .slice()
                        .sort((a, b) => a.name.localeCompare(b.name))
                        .map((i) => (
                          <option key={i.serviceId} value={i.serviceId}>
                            {i.name}
                          </option>
                        ))}
                    </Select>
                  </div>
                )}
              </>
            )}
            <div className="flex flex-col gap-1">
              <Label htmlFor="pro-rate-percent">{t("femme.commissions.pro.rates.percentLabel", { name })}</Label>
              <Input
                id="pro-rate-percent"
                inputMode="decimal"
                className="max-w-[8rem]"
                value={draft.percent}
                invalid={!!draft.error}
                aria-describedby={draft.error ? "pro-rate-error" : undefined}
                data-testid="pro-rate-percent-input"
                onChange={(e) => setDraft({ ...draft, percent: e.target.value, error: null })}
              />
              <FieldValidationError id="pro-rate-error">{draft.error}</FieldValidationError>
            </div>
            {dialogGroup && (
              <p className="rounded-xl bg-bg p-3 text-sm text-ink-2" data-testid="pro-rate-scope">
                {t("femme.commissions.pro.rates.scope", { count: dialogGroup.items.length, normal: dialogGroup.percent === null ? t("femme.commissions.workspace.noPercent") : formatPercent(dialogGroup.percent) })}
              </p>
            )}
            {ex && (
              <p className="rounded-xl bg-bg p-3 text-sm text-ink-2" data-testid="pro-rate-example">
                {ex.kept > 0
                  ? t("femme.commissions.pro.rates.exampleRetains", { percent: formatPercent(retains), paid: formatGuaraniesGs(ex.paid), retained: formatGuaraniesGs(ex.retained) })
                  : t("femme.commissions.pro.rates.example", { paid: formatGuaraniesGs(ex.paid) })}
              </p>
            )}
          </div>
        )}
      </Modal>

      <Modal
        open={retention !== null}
        onClose={() => setRetention(null)}
        title={t("femme.commissions.settings.retentionEditTitle", { name })}
        className="max-w-lg"
        footer={
          <>
            <Button type="button" variant="secondary" className={`${ACTION_BUTTON} w-full sm:w-auto`} onClick={() => setRetention(null)}>
              {t("femme.commissions.common.cancel")}
            </Button>
            <Button
              type="button"
              className={`${ACTION_BUTTON} w-full sm:w-auto`}
              data-testid="pro-retention-save"
              onClick={() => {
                if (!retention) return;
                const raw = retention.value.trim();
                const parsed = raw === "" ? null : parsePercentInput(raw);
                if (raw !== "" && parsed === null) return setRetention({ ...retention, error: t("femme.commissions.validation.percent") });
                setApply({
                  changes: [{ scope: "RETENTION_PROFILE", professionalId, value: parsed }],
                  summary:
                    parsed === null
                      ? t("femme.commissions.settings.retentionNoneSummary", { name })
                      : t("femme.commissions.settings.retentionSummary", { name, value: formatPercent(parsed) }),
                });
                setRetention(null);
              }}
            >
              {t("femme.commissions.rules.apply")}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-1">
          <Label htmlFor="pro-retention-percent">{t("femme.commissions.settings.retentionInputLabel")}</Label>
          <Input
            id="pro-retention-percent"
            inputMode="decimal"
            className="max-w-[8rem]"
            value={retention?.value ?? ""}
            invalid={!!retention?.error}
            aria-describedby={retention?.error ? "pro-retention-error" : undefined}
            data-testid="pro-retention-percent"
            onChange={(e) => setRetention((c) => (c ? { value: e.target.value, error: null } : c))}
          />
          <FieldValidationError id="pro-retention-error">{retention?.error}</FieldValidationError>
          <p className="text-sm text-ink-3">{t("femme.commissions.settings.retentionInputHelp")}</p>
        </div>
      </Modal>

      <ApplyChangeDialog
        open={apply !== null}
        changes={apply?.changes ?? []}
        summary={apply?.summary ?? ""}
        onClose={() => setApply(null)}
        onApplied={() => {
          setApply(null);
          setDraft(null);
          setNotice(t("femme.commissions.applyDialog.applied"));
          void Promise.all([load(), refresh()]);
        }}
      />
    </section>
  );
}
