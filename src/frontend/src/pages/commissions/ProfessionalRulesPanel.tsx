import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Input, KebabMenu, Label, Modal, Select, Spinner, Text } from "@design-system";
import {
  getProfessionalRules,
  type ConfigChange,
  type FixedDestination,
  type GroupRuleRow,
  type ProfessionalRulesView,
} from "../../api/commissions";
import { translateApiError } from "../../api/parseApiErrorMessage";
import { FieldValidationError } from "../../components/FieldValidationError";
import { formatGuaraniesGs } from "../../lib/formatMoney";
import { ACTION_BUTTON } from "../../components/actionButtons";
import { formatPercent, parsePercentInput, useProfessionals } from "./common";
import { calcLine, parseFixedInput, ruleValue, sameRule } from "./ruleMath";

/** What the user typed in one group row. `destination` "DEFAULT" follows the salon setting. */
type Draft = { paid: string; retention: string; fixed: string; destination: "DEFAULT" | FixedDestination };

type Props = {
  /** Unsaved changes of the Rules tab (shared with its «Guardar cambios» bar). */
  pending: Record<string, ConfigChange>;
  stage: (change: ConfigChange) => void;
  unstage: (change: Pick<ConfigChange, "scope" | "serviceId" | "professionalId" | "groupId">) => void;
  /** Bumped by the Rules tab after saving, so the view is read again. */
  reloadKey: number;
};

const fmtNum = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n).replace(".", ","));
const fmtFixed = (n: number | null | undefined) => (!n ? "" : new Intl.NumberFormat("es-PY").format(n));

function draftOf(row: GroupRuleRow, change: ConfigChange | undefined): Draft | null {
  if (change) {
    if (change.value === null) return null;
    const [p = "", r = "0", f = "0", d = ""] = change.value.split("|");
    return {
      paid: fmtNum(Number(p)),
      retention: Number(r) ? fmtNum(Number(r)) : "",
      fixed: fmtFixed(Number(f)),
      destination: d === "P" ? "PROFESSIONAL" : d === "S" ? "SALON" : "DEFAULT",
    };
  }
  if (!row.ownRule) return null;
  return {
    paid: fmtNum(row.percent),
    retention: row.retentionPercent ? fmtNum(row.retentionPercent) : "",
    fixed: fmtFixed(row.fixedAmount),
    destination: row.fixedDestination ?? "DEFAULT",
  };
}

const EMPTY: Draft = { paid: "", retention: "", fixed: "", destination: "DEFAULT" };

/**
 * HU-COM-14 «Por profesional»: one row per commission group with what is paid, what is retained for
 * aguinaldo, the fixed amount (costo de producto) and who gets it. Edits are staged as GROUP_RULE
 * changes and saved together from the Rules tab bar.
 */
export function ProfessionalRulesPanel({ pending, stage, unstage, reloadKey }: Props) {
  const { t } = useTranslation();
  const professionals = useProfessionals();
  const active = useMemo(() => professionals.filter((p) => p.active), [professionals]);
  const [professionalId, setProfessionalId] = useState<number | null>(null);
  const [view, setView] = useState<ProfessionalRulesView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [rowErrors, setRowErrors] = useState<Record<number, string | null>>({});
  const [selected, setSelected] = useState<number | null>(null);
  const [price, setPrice] = useState("100.000");
  const [showOthers, setShowOthers] = useState(false);
  /** Rows shown above the fold: they had a rule when the view loaded (or were copied in). */
  const [pinned, setPinned] = useState<Set<number>>(new Set());
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyFrom, setCopyFrom] = useState("");
  const [copyError, setCopyError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (professionalId === null && active.length > 0) setProfessionalId(active[0].id);
  }, [active, professionalId]);

  const load = useCallback(async () => {
    if (professionalId === null) return;
    try {
      setView(await getProfessionalRules(professionalId));
      setError(null);
    } catch (err) {
      setError(translateApiError(err, t));
    }
  }, [professionalId, t]);

  useEffect(() => {
    setView(null);
    void load();
  }, [load, reloadKey]);

  const changeOf = useCallback(
    (groupId: number) =>
      professionalId === null
        ? undefined
        : pending[`GROUP_RULE||${professionalId}|${groupId}`],
    [pending, professionalId],
  );

  // Drafts are seeded from the server rule plus whatever is already staged for this professional.
  useEffect(() => {
    if (!view) return;
    const next: Record<number, Draft> = {};
    for (const row of view.groups) {
      const d = draftOf(row, changeOf(row.groupId));
      if (d) next[row.groupId] = d;
    }
    setDrafts(next);
    setPinned(new Set(Object.keys(next).map(Number)));
    setRowErrors({});
    setSelected((cur) => cur ?? view.groups.find((g) => next[g.groupId])?.groupId ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const aguinaldoOn = view?.aguinaldoEnabled ?? false;
  const destLabel = (d: FixedDestination) => t(`femme.commissions.byProfessional.destination.${d}`);
  const defaultDestination = view?.defaultFixedDestination ?? "PROFESSIONAL";

  /** Validates a draft and stages (or unstages) the change; returns the error text, if any. */
  function commit(row: GroupRuleRow, draft: Draft): string | null {
    if (professionalId === null) return null;
    const ref = { scope: "GROUP_RULE" as const, professionalId, groupId: row.groupId };
    const blank = !draft.paid.trim() && !draft.retention.trim() && !draft.fixed.trim();
    if (blank) {
      if (row.ownRule) stage({ ...ref, value: null });
      else unstage(ref);
      return null;
    }
    // An invalid row never stays staged: only valid rules can be saved.
    const invalid = (message: string) => {
      unstage(ref);
      return message;
    };
    const paid = parsePercentInput(draft.paid);
    if (!draft.paid.trim()) return invalid(t("femme.commissions.byProfessional.validation.paidRequired"));
    if (paid === null) return invalid(t("femme.commissions.byProfessional.validation.percent"));
    const retention = draft.retention.trim() ? parsePercentInput(draft.retention) : "0";
    if (retention === null) return invalid(t("femme.commissions.byProfessional.validation.percent"));
    if (Number(paid) + Number(retention) > 100) return invalid(t("femme.commissions.byProfessional.validation.pair"));
    const fixed = parseFixedInput(draft.fixed);
    if (fixed === null) return invalid(t("femme.commissions.byProfessional.validation.fixed"));
    const value = ruleValue({ paid, retention: retention === "0" ? "" : retention, fixed, destination: draft.destination });
    const serverValue = row.ownRule
      ? ruleValue({
          paid: String(row.percent),
          retention: row.retentionPercent ? String(row.retentionPercent) : "",
          fixed: row.fixedAmount ?? 0,
          destination: row.fixedDestination ?? "DEFAULT",
        })
      : null;
    if (sameRule(value, serverValue)) unstage(ref);
    else stage({ ...ref, value });
    return null;
  }

  function edit(row: GroupRuleRow, patch: Partial<Draft>) {
    setNotice(null);
    const base = drafts[row.groupId] ?? EMPTY;
    let next: Draft = { ...base, ...patch };
    // A new rule starts with the professional's usual retention.
    if (!drafts[row.groupId] && patch.paid !== undefined && !next.retention && aguinaldoOn && view?.retentionProfilePercent) {
      next = { ...next, retention: fmtNum(view.retentionProfilePercent) };
    }
    const err = commit(row, next);
    setDrafts((prev) => ({ ...prev, [row.groupId]: next }));
    setSelected(row.groupId);
    setRowErrors((prev) => ({ ...prev, [row.groupId]: err }));
  }

  function removeRule(row: GroupRuleRow) {
    const err = commit(row, EMPTY);
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[row.groupId];
      return next;
    });
    setRowErrors((prev) => ({ ...prev, [row.groupId]: err }));
  }

  const groups = view?.groups ?? [];
  const withRule = groups.filter((g) => pinned.has(g.groupId));
  const others = groups.filter((g) => !withRule.includes(g));

  const selectedRow = groups.find((g) => g.groupId === selected) ?? null;
  const selectedDraft = selectedRow ? drafts[selectedRow.groupId] : undefined;
  const example = useMemo(() => {
    if (!view || !selectedDraft) return null;
    const paid = Number(parsePercentInput(selectedDraft.paid) ?? NaN);
    if (!Number.isFinite(paid)) return null;
    const retentionRaw = selectedDraft.retention.trim() ? parsePercentInput(selectedDraft.retention) : "0";
    const fixed = parseFixedInput(selectedDraft.fixed);
    const priceN = parseFixedInput(price);
    if (retentionRaw === null || fixed === null || priceN === null) return null;
    const destination = selectedDraft.destination === "DEFAULT" ? view.defaultFixedDestination : selectedDraft.destination;
    return {
      calc: calcLine(priceN, { paid, retention: aguinaldoOn ? Number(retentionRaw) : 0, fixed, destination }, view.baseType),
      paid,
      retention: aguinaldoOn ? Number(retentionRaw) : 0,
    };
  }, [view, selectedDraft, price, aguinaldoOn]);

  // Every hook is above this point: only now can the panel bail out.
  if (professionalId === null && professionals.length > 0 && active.length === 0) {
    return <Text variant="muted">{t("femme.commissions.byProfessional.noProfessionals")}</Text>;
  }

  async function copyRules() {
    setCopyError(null);
    const fromId = Number(copyFrom);
    if (!fromId || !view) return;
    try {
      const source = await getProfessionalRules(fromId);
      const rows = source.groups.filter((g) => g.ownRule);
      if (rows.length === 0) {
        setCopyError(t("femme.commissions.byProfessional.copy.none"));
        return;
      }
      const nextDrafts = { ...drafts };
      const nextErrors = { ...rowErrors };
      for (const s of rows) {
        const target = view.groups.find((g) => g.groupId === s.groupId);
        if (!target) continue;
        const d: Draft = {
          paid: fmtNum(s.percent),
          retention: s.retentionPercent ? fmtNum(s.retentionPercent) : "",
          fixed: fmtFixed(s.fixedAmount),
          destination: s.fixedDestination ?? "DEFAULT",
        };
        nextDrafts[s.groupId] = d;
        nextErrors[s.groupId] = commit(target, d);
      }
      setDrafts(nextDrafts);
      setRowErrors(nextErrors);
      setPinned((prev) => new Set([...prev, ...rows.map((r) => r.groupId)]));
      setNotice(t("femme.commissions.byProfessional.copy.done", { count: rows.length }));
      setCopyOpen(false);
    } catch (err) {
      setCopyError(translateApiError(err, t));
    }
  }

  const retains = view?.retentionProfilePercent;
  const th = "px-1 text-[11px] font-extrabold uppercase text-ink-3";

  function renderRow(row: GroupRuleRow) {
    const d = drafts[row.groupId] ?? EMPTY;
    const err = rowErrors[row.groupId];
    const id = `rule-${row.groupId}`;
    const total = Number(parsePercentInput(d.paid) ?? 0) + Number(d.retention.trim() ? (parsePercentInput(d.retention) ?? 0) : 0);
    return (
      <li
        key={row.groupId}
        data-testid="pro-rule-row"
        data-group-id={row.groupId}
        className={`border-t border-line px-3 py-2 first:border-t-0 ${selected === row.groupId ? "bg-primary-lt/40" : ""}`}
        onClick={() => setSelected(row.groupId)}
      >
        <div className="grid min-w-[44rem] grid-cols-[minmax(7rem,1fr)_5.5rem_5.5rem_4rem_7.5rem_8.5rem_2.75rem] items-center gap-2">
          <span className="min-w-0 truncate font-bold text-ink" data-testid="pro-rule-group">
            {row.groupName}
            {row.scheduled && (
              <span className="ml-2 text-xs font-semibold text-warning" title={t("femme.commissions.byProfessional.scheduledRow")}>
                ⏱
              </span>
            )}
          </span>
          <Input
            id={`${id}-paid`}
            aria-label={t("femme.commissions.byProfessional.paidAria", { group: row.groupName })}
            inputMode="decimal"
            value={d.paid}
            invalid={!!err}
            data-testid="pro-rule-paid"
            className="text-right"
            onChange={(e) => edit(row, { paid: e.target.value })}
            aria-describedby={err ? `${id}-error` : undefined}
          />
          {aguinaldoOn ? (
            <Input
              id={`${id}-ret`}
              aria-label={t("femme.commissions.byProfessional.retentionAria", { group: row.groupName })}
              inputMode="decimal"
              value={d.retention}
              invalid={!!err}
              data-testid="pro-rule-retention"
              className="text-right"
              onChange={(e) => edit(row, { retention: e.target.value })}
            />
          ) : (
            <span aria-hidden className="text-center text-ink-3">
              —
            </span>
          )}
          <span className="text-right font-extrabold tabular-nums text-ink-2" data-testid="pro-rule-total">
            {drafts[row.groupId] ? formatPercent(total) : "—"}
          </span>
          <Input
            id={`${id}-fixed`}
            aria-label={t("femme.commissions.byProfessional.fixedAria", { group: row.groupName })}
            inputMode="numeric"
            value={d.fixed}
            invalid={!!err}
            data-testid="pro-rule-fixed"
            className="text-right"
            onChange={(e) => edit(row, { fixed: e.target.value })}
          />
          <Select
            aria-label={t("femme.commissions.byProfessional.destinationAria", { group: row.groupName })}
            value={d.destination}
            data-testid="pro-rule-destination"
            onChange={(e) => edit(row, { destination: e.target.value as Draft["destination"] })}
            disabled={!d.fixed.trim()}
          >
            <option value="DEFAULT">
              {t("femme.commissions.byProfessional.destination.DEFAULT", { value: destLabel(defaultDestination) })}
            </option>
            <option value="PROFESSIONAL">{destLabel("PROFESSIONAL")}</option>
            <option value="SALON">{destLabel("SALON")}</option>
          </Select>
          <KebabMenu
            id={`pro-rule-actions-${row.groupId}`}
            triggerAriaLabel={t("femme.commissions.byProfessional.rowActions", { group: row.groupName })}
            items={[
              {
                id: "remove",
                label: t("femme.commissions.byProfessional.removeRule"),
                onSelect: () => removeRule(row),
              },
            ]}
          />
        </div>
        {err && (
          <FieldValidationError id={`${id}-error`}>{err}</FieldValidationError>
        )}
      </li>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="professional-rules">
      <p className="px-0.5 text-sm text-ink-3">{t("femme.commissions.byProfessional.intro")}</p>

      <div role="group" aria-label={t("femme.commissions.byProfessional.professional")} className="flex flex-wrap gap-2">
        {active.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-pressed={professionalId === p.id}
            data-testid={`pro-rules-professional-${p.id}`}
            onClick={() => {
              setProfessionalId(p.id);
              setSelected(null);
              setNotice(null);
            }}
            className={`min-h-11 rounded-full border px-4 text-sm font-semibold ${
              professionalId === p.id ? "border-primary bg-primary-lt text-primary" : "border-line bg-surface text-ink hover:bg-bg"
            }`}
          >
            {p.displayName ?? p.fullName}
          </button>
        ))}
      </div>

      {notice && (
        <Alert variant="success" role="status" data-testid="pro-rules-notice">
          {notice}
        </Alert>
      )}
      {error && <Alert variant="destructive">{error}</Alert>}
      {!view && !error && <Spinner />}

      {view && (
        <section className="flex flex-col gap-3 rounded-card border border-line bg-surface p-3 shadow-sm sm:p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <h3 className="break-words font-heading text-lg font-extrabold text-ink" data-testid="pro-rules-name">
                {view.professionalName}
              </h3>
              <p className="text-sm text-ink-3">
                {t("femme.commissions.byProfessional.baseLine", { base: t(`femme.commissions.base.${view.baseType}`).toLowerCase() })}
              </p>
            </div>
            {aguinaldoOn && (
              <span
                data-testid="pro-rules-retains"
                className="inline-flex min-h-11 items-center rounded-xl bg-warning-lt px-3 text-sm font-extrabold text-warning"
              >
                {retains
                  ? t("femme.commissions.byProfessional.retains", { percent: formatPercent(retains) })
                  : t("femme.commissions.byProfessional.noRetains")}
              </span>
            )}
          </div>
          {!aguinaldoOn && (
            <Text variant="small" className="text-ink-3" data-testid="pro-rules-retention-off">
              {t("femme.commissions.byProfessional.retentionOff")}
            </Text>
          )}

          {groups.length === 0 ? (
            <Text variant="muted" data-testid="pro-rules-no-groups">
              {t("femme.commissions.byProfessional.noGroups")}
            </Text>
          ) : (
            <div className="w-full overflow-x-auto">
              <div className="min-w-[44rem]">
                <div className="grid grid-cols-[minmax(7rem,1fr)_5.5rem_5.5rem_4rem_7.5rem_8.5rem_2.75rem] gap-2 px-3 pb-1">
                  <span className={th}>{t("femme.commissions.byProfessional.colGroup")}</span>
                  <span className={`${th} text-right`}>{t("femme.commissions.byProfessional.colPaid")}</span>
                  <span className={`${th} text-right text-warning`}>{t("femme.commissions.byProfessional.colRetention")}</span>
                  <span className={`${th} text-right`}>{t("femme.commissions.byProfessional.colTotal")}</span>
                  <span className={`${th} text-right`}>{t("femme.commissions.byProfessional.colFixed")}</span>
                  <span className={th}>{t("femme.commissions.byProfessional.colDestination")}</span>
                  <span />
                </div>
                <ul className="rounded-card border border-line" data-testid="pro-rules-table">
                  {withRule.map(renderRow)}
                </ul>
                {others.length > 0 && (
                  <>
                    <button
                      type="button"
                      aria-expanded={showOthers}
                      data-testid="pro-rules-others-toggle"
                      onClick={() => setShowOthers((o) => !o)}
                      className="mt-2 flex min-h-11 w-full items-center justify-between gap-3 rounded-card border border-line px-3 text-left text-sm text-ink-2"
                    >
                      <span>{t("femme.commissions.byProfessional.otherGroups", { count: others.length })}</span>
                      <span className="font-extrabold text-primary">
                        {showOthers ? t("femme.commissions.byProfessional.hideOthers") : t("femme.commissions.byProfessional.showOthers")}
                      </span>
                    </button>
                    {showOthers && (
                      <ul className="mt-2 rounded-card border border-line" data-testid="pro-rules-others">
                        {others.map(renderRow)}
                      </ul>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          {groups.length > 0 && (
            <Button
              type="button"
              variant="secondary"
              className={`${ACTION_BUTTON} self-start`}
              data-testid="pro-rules-copy"
              onClick={() => {
                setCopyFrom("");
                setCopyError(null);
                setCopyOpen(true);
              }}
            >
              {t("femme.commissions.byProfessional.copy.action")}
            </Button>
          )}
        </section>
      )}

      {view && selectedRow && (
        <section
          className="flex flex-col gap-2 rounded-card border-2 border-primary bg-surface p-3 sm:p-4"
          data-testid="pro-rules-example"
        >
          <h3 className="font-heading text-base font-extrabold text-ink">
            {t("femme.commissions.byProfessional.exampleTitle", { group: selectedRow.groupName })}
          </h3>
          <div className="flex max-w-xs flex-col gap-1">
            <Label htmlFor="pro-rules-example-price">{t("femme.commissions.byProfessional.examplePrice")}</Label>
            <Input
              id="pro-rules-example-price"
              inputMode="numeric"
              value={price}
              className="text-right"
              onChange={(e) => setPrice(e.target.value)}
              data-testid="pro-rules-example-price"
            />
          </div>
          {view.baseType === "NET_OF_TAX" && (
            <Text variant="small" className="text-ink-3">
              {t("femme.commissions.byProfessional.exampleNetNote")}
            </Text>
          )}
          {example ? (
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm" data-testid="pro-rules-example-result">
              <dt>{t("femme.commissions.byProfessional.exampleFixed")}</dt>
              <dd className="text-right tabular-nums" data-testid="example-fixed">
                − {formatGuaraniesGs(example.calc.fixed)}
              </dd>
              <dt className="font-bold">{t("femme.commissions.byProfessional.exampleBase")}</dt>
              <dd className="text-right font-bold tabular-nums" data-testid="example-base">
                {formatGuaraniesGs(example.calc.base)}
              </dd>
              <dt>{t("femme.commissions.byProfessional.examplePaid", { percent: formatPercent(example.paid) })}</dt>
              <dd className="text-right tabular-nums" data-testid="example-paid">
                {formatGuaraniesGs(example.calc.paidAmount)}
              </dd>
              {aguinaldoOn && (
                <>
                  <dt className="text-warning">
                    {t("femme.commissions.byProfessional.exampleRetained", { percent: formatPercent(example.retention) })}
                  </dt>
                  <dd className="text-right tabular-nums text-warning" data-testid="example-retention">
                    {formatGuaraniesGs(example.calc.retentionAmount)}
                  </dd>
                </>
              )}
              <dt className="text-ink-3">
                {example.calc.fixed > 0
                  ? t(
                      example.calc.fixedToProfessional
                        ? "femme.commissions.byProfessional.exampleFixedProfessional"
                        : "femme.commissions.byProfessional.exampleFixedSalon",
                    )
                  : ""}
              </dt>
              <dd />
              <dt className="font-extrabold text-primary">
                {t("femme.commissions.byProfessional.examplePays", { name: view.professionalName })}
              </dt>
              <dd className="text-right font-extrabold tabular-nums text-primary" data-testid="example-pays">
                {formatGuaraniesGs(example.calc.pays)}
              </dd>
              <dt className="text-ink-3">{t("femme.commissions.byProfessional.exampleSalon")}</dt>
              <dd className="text-right tabular-nums text-ink-3" data-testid="example-salon">
                {formatGuaraniesGs(example.calc.salon)}
              </dd>
            </dl>
          ) : (
            <Text variant="small" className="text-ink-3">
              {t("femme.commissions.byProfessional.exampleHint")}
            </Text>
          )}
        </section>
      )}

      <Modal
        open={copyOpen}
        onClose={() => setCopyOpen(false)}
        title={t("femme.commissions.byProfessional.copy.title")}
        description={t("femme.commissions.byProfessional.copy.description", { name: view?.professionalName ?? "" })}
        footer={
          <>
            <Button type="button" variant="secondary" className={`${ACTION_BUTTON} w-full sm:w-auto`} onClick={() => setCopyOpen(false)}>
              {t("femme.commissions.common.cancel")}
            </Button>
            <Button
              type="button"
              className={`${ACTION_BUTTON} w-full sm:w-auto`}
              disabled={!copyFrom}
              data-testid="pro-rules-copy-confirm"
              onClick={() => void copyRules()}
            >
              {t("femme.commissions.byProfessional.copy.confirm")}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor="pro-rules-copy-from">{t("femme.commissions.byProfessional.copy.from")}</Label>
          <Select id="pro-rules-copy-from" value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)} data-testid="pro-rules-copy-from">
            <option value="">{t("femme.commissions.byProfessional.copy.choose")}</option>
            {active
              .filter((p) => p.id !== professionalId)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName ?? p.fullName}
                </option>
              ))}
          </Select>
          {copyError && <Alert variant="destructive">{copyError}</Alert>}
        </div>
      </Modal>
    </div>
  );
}
