import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, NavLink, useParams, useSearchParams } from "react-router-dom";
import { Alert, Button, Input, Label, Modal, Select, Spinner, Text } from "@design-system";
import {
  applyChanges,
  getProfessionalRules,
  getProfessionalsSummary,
  getSettlementPreview,
  type ConfigChange,
  type FixedDestination,
  type GroupRuleRow,
  type ProfessionalRulesView,
  type ProfessionalsRuleSummary,
  type SettlementPreview,
} from "../../api/commissions";
import { translateApiError } from "../../api/parseApiErrorMessage";
import { FieldValidationError } from "../../components/FieldValidationError";
import { ACTION_BUTTON } from "../../components/actionButtons";
import { formatGuaraniesGs } from "../../lib/formatMoney";
import { AguinaldoTab } from "./AguinaldoTab";
import { ApplyChangeDialog } from "./ApplyChangeDialog";
import { Avatar } from "./HomePage";
import { MovementsTab } from "./MovementsTab";
import { StatusChip } from "./StatusChip";
import { formatPercent, parsePercentInput } from "./common";
import { useOverview } from "./overview";
import { calcLine, parseFixedInput, ruleValue, sameRule } from "./ruleMath";

type Draft = { paid: string; retention: string; fixed: string; destination: "DEFAULT" | FixedDestination };

const fmtNum = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n).replace(".", ","));
const fmtFixed = (n: number | null | undefined) => (!n ? "" : new Intl.NumberFormat("es-PY").format(n));
const EMPTY: Draft = { paid: "", retention: "", fixed: "", destination: "DEFAULT" };

const draftOfRow = (row: GroupRuleRow): Draft => ({
  paid: fmtNum(row.percent),
  retention: row.retentionPercent ? fmtNum(row.retentionPercent) : "",
  fixed: fmtFixed(row.fixedAmount),
  destination: row.fixedDestination ?? "DEFAULT",
});

type TabId = "summary" | "rules" | "aguinaldo" | "history";

/** Comisiones › Equipo › one professional: Resumen · Reglas · Aguinaldo (if used) · Historial (HU-COM-15). */
export default function ProfessionalPage() {
  const { t } = useTranslation();
  const { professionalId: idParam } = useParams();
  const professionalId = Number(idParam);
  const { overview } = useOverview();
  const [params] = useSearchParams();
  const aguinaldo = overview?.aguinaldoEnabled ?? false;
  const requested = params.get("tab") as TabId | null;
  const tab: TabId = requested === "rules" || requested === "history" || (requested === "aguinaldo" && aguinaldo) ? requested : "summary";
  const row = overview?.rows.find((r) => r.professionalId === professionalId) ?? null;

  const tabs: { id: TabId; label: string }[] = [
    { id: "summary", label: t("femme.commissions.pro.tabSummary") },
    { id: "rules", label: t("femme.commissions.pro.tabRules") },
    ...(aguinaldo ? [{ id: "aguinaldo" as const, label: t("femme.commissions.pro.tabAguinaldo") }] : []),
    { id: "history", label: t("femme.commissions.pro.tabHistory") },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="commission-professional">
      <Link to="/app/commissions/equipo" className="inline-flex min-h-11 items-center text-sm font-bold text-primary" data-testid="pro-back">
        ← {t("femme.commissions.pro.back")}
      </Link>
      {row && (
        <header className="flex items-center gap-3">
          <Avatar name={row.professionalName} />
          <div className="min-w-0">
            <h2 className="truncate font-heading text-xl font-extrabold text-ink" data-testid="pro-name">
              {row.professionalName}
            </h2>
            <div className="text-sm text-ink-3">
              {t("femme.commissions.pro.rulesCount", { count: row.ruleCount })}
            </div>
          </div>
        </header>
      )}
      <nav aria-label={t("femme.commissions.pro.tabsAria")} className="flex gap-1 overflow-x-auto rounded-2xl bg-primary-lt p-1">
        {tabs.map((x) => (
          <NavLink
            key={x.id}
            to={x.id === "summary" ? "." : `?tab=${x.id}`}
            end
            data-testid={`pro-tab-${x.id}`}
            aria-current={tab === x.id ? "page" : undefined}
            className={`inline-flex min-h-10 flex-1 items-center justify-center whitespace-nowrap rounded-[10px] px-3 text-sm font-bold ${
              tab === x.id ? "bg-surface text-primary shadow-[0_1px_3px_rgba(10,31,51,0.15)]" : "text-ink-2"
            }`}
          >
            {x.label}
          </NavLink>
        ))}
      </nav>
      {tab === "summary" && <SummaryPane professionalId={professionalId} />}
      {tab === "rules" && <RulesPane professionalId={professionalId} />}
      {tab === "aguinaldo" && <AguinaldoTab professionalId={professionalId} />}
      {tab === "history" && <MovementsTab fixedProfessionalId={professionalId} />}
    </div>
  );
}

/** What she earned in the current period: the former «Vista previa», now one tab of her page. */
function SummaryPane({ professionalId }: { professionalId: number }) {
  const { t } = useTranslation();
  const { overview } = useOverview();
  const [preview, setPreview] = useState<SettlementPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const row = overview?.rows.find((r) => r.professionalId === professionalId) ?? null;
  const from = overview?.period.from ?? undefined;
  const to = overview?.period.to ?? undefined;

  useEffect(() => {
    if (!overview) return;
    getSettlementPreview(professionalId, from, to)
      .then(setPreview)
      .catch((err) => setError(translateApiError(err, t)));
  }, [overview, professionalId, from, to, t]);

  if (error) return <Alert variant="destructive">{error}</Alert>;
  if (!preview || !row) return <Spinner />;
  const line = (label: string, value: number, testId: string, tone = "text-ink") => (
    <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-2.5 first:border-t-0">
      <span className="text-sm text-ink-2">{label}</span>
      <b className={`font-heading tabular-nums ${tone}`} data-testid={testId}>
        {formatGuaraniesGs(value)}
      </b>
    </div>
  );
  return (
    <section className="flex flex-col gap-3" data-testid="pro-summary">
      <div className="rounded-card border border-line bg-surface p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-xs text-ink-3">{t("femme.commissions.pro.summaryTotal")}</div>
            <b className="font-heading text-3xl tabular-nums text-ink" data-testid="pro-summary-total">
              {formatGuaraniesGs(row.amount || preview.total)}
            </b>
          </div>
          <StatusChip status={row.status} />
        </div>
        <Text variant="small" className="mt-1 text-ink-3" data-testid="pro-summary-lines">
          {t("femme.commissions.pro.summaryLines", { count: preview.lines })}
        </Text>
        {preview.carriedAmount !== 0 && (
          <Text variant="small" className="mt-1 text-warning" data-testid="pro-summary-carried">
            {t("femme.commissions.pro.summaryCarried", { amount: formatGuaraniesGs(preview.carriedAmount) })}
          </Text>
        )}
      </div>
      <div className="rounded-card border border-line bg-surface shadow-sm">
        {line(t("femme.commissions.pro.summaryServices"), preview.servicesTotal, "pro-summary-services")}
        {line(t("femme.commissions.pro.summaryProducts"), preview.productsTotal, "pro-summary-products")}
        {preview.adjustmentsTotal !== 0 && line(t("femme.commissions.pro.summaryAdjustments"), preview.adjustmentsTotal, "pro-summary-adjustments")}
        {overview?.aguinaldoEnabled && line(t("femme.commissions.pro.summaryRetained"), preview.retentionTotal, "pro-summary-retained", "text-warning")}
      </div>
      <div className="flex flex-wrap gap-2">
        {row.settlementId ? (
          <Link
            to={`/app/commissions/settlements/${row.settlementId}`}
            className="inline-flex min-h-11 items-center rounded-xl bg-primary px-4 text-sm font-extrabold text-surface"
            data-testid="pro-summary-open-settlement"
          >
            {t("femme.commissions.pro.openSettlement")}
          </Link>
        ) : (
          <Link
            to="/app/commissions/liquidar"
            className="inline-flex min-h-11 items-center rounded-xl bg-primary px-4 text-sm font-extrabold text-surface"
            data-testid="pro-summary-go-settle"
          >
            {t("femme.commissions.pro.goSettle")}
          </Link>
        )}
      </div>
    </section>
  );
}

/** A rule told in words: «Cobra 45 % · retiene 5 % · costo de producto 3.000 Gs (para ella)». */
export function ruleSentence(
  t: (key: string, opts?: Record<string, unknown>) => string,
  row: GroupRuleRow,
  aguinaldo: boolean,
  defaultDestination: FixedDestination,
): string {
  const parts = [t("femme.commissions.pro.sentencePaid", { percent: formatPercent(row.percent) })];
  if (aguinaldo && row.retentionPercent) {
    parts.push(t("femme.commissions.pro.sentenceRetains", { percent: formatPercent(row.retentionPercent) }));
  }
  if (row.fixedAmount) {
    const dest = row.fixedDestination ?? defaultDestination;
    parts.push(
      t(dest === "PROFESSIONAL" ? "femme.commissions.pro.sentenceFixedPro" : "femme.commissions.pro.sentenceFixedSalon", {
        amount: formatGuaraniesGs(row.fixedAmount),
      }),
    );
  }
  return parts.join(" · ");
}

type Pending = { changes: ConfigChange[]; summary: string };

/** Her rules as cards in words, with «Agregar una regla», «Copiar reglas…» and her usual retention. */
function RulesPane({ professionalId }: { professionalId: number }) {
  const { t } = useTranslation();
  const { refresh } = useOverview();
  const [view, setView] = useState<ProfessionalRulesView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ group: GroupRuleRow; draft: Draft; isNew: boolean; error: string | null } | null>(null);
  const [picking, setPicking] = useState(false);
  const [pickGroup, setPickGroup] = useState("");
  const [apply, setApply] = useState<Pending | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyFrom, setCopyFrom] = useState("");
  const [copyError, setCopyError] = useState<string | null>(null);
  const [options, setOptions] = useState<ProfessionalsRuleSummary | null>(null);
  const [retention, setRetention] = useState<{ value: string; error: string | null } | null>(null);
  const [price, setPrice] = useState("100.000");

  const load = useCallback(async () => {
    try {
      setView(await getProfessionalRules(professionalId));
      setError(null);
    } catch (err) {
      setError(translateApiError(err, t));
    }
  }, [professionalId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const aguinaldoOn = view?.aguinaldoEnabled ?? false;
  const groups = view?.groups ?? [];
  const withRule = groups.filter((g) => g.ownRule);
  const without = groups.filter((g) => !g.ownRule);
  const destLabel = (d: FixedDestination) => t(`femme.commissions.byProfessional.destination.${d}`);

  function open(group: GroupRuleRow, isNew: boolean) {
    const base = isNew ? { ...EMPTY } : draftOfRow(group);
    if (isNew && aguinaldoOn && view?.retentionProfilePercent) base.retention = fmtNum(view.retentionProfilePercent);
    setPicking(false);
    setEditor({ group, draft: base, isNew, error: null });
  }

  /** Validates the editor and, when valid, asks how to apply the rule. */
  function next() {
    if (!editor || !view) return;
    const { draft, group } = editor;
    const fail = (key: string) => setEditor({ ...editor, error: t(`femme.commissions.byProfessional.validation.${key}`) });
    if (!draft.paid.trim()) return fail("paidRequired");
    const paid = parsePercentInput(draft.paid);
    if (paid === null) return fail("percent");
    const retentionRaw = aguinaldoOn && draft.retention.trim() ? parsePercentInput(draft.retention) : "0";
    if (retentionRaw === null) return fail("percent");
    if (Number(paid) + Number(retentionRaw) > 100) return fail("pair");
    const fixed = parseFixedInput(draft.fixed);
    if (fixed === null) return fail("fixed");
    const value = ruleValue({ paid, retention: retentionRaw === "0" ? "" : retentionRaw, fixed, destination: draft.destination });
    const current = group.ownRule
      ? ruleValue({
          paid: String(group.percent),
          retention: group.retentionPercent ? String(group.retentionPercent) : "",
          fixed: group.fixedAmount ?? 0,
          destination: group.fixedDestination ?? "DEFAULT",
        })
      : null;
    if (sameRule(value, current)) {
      setEditor(null);
      return;
    }
    setApply({
      changes: [{ scope: "GROUP_RULE", professionalId, groupId: group.groupId, value }],
      summary: t("femme.commissions.pro.applySummary", { group: group.groupName, name: view.professionalName }),
    });
  }

  function remove(group: GroupRuleRow) {
    if (!view) return;
    setApply({
      changes: [{ scope: "GROUP_RULE", professionalId, groupId: group.groupId, value: null }],
      summary: t("femme.commissions.pro.removeSummary", { group: group.groupName, name: view.professionalName }),
    });
  }

  async function startCopy() {
    setCopyFrom("");
    setCopyError(null);
    setCopyOpen(true);
    if (!options) {
      try {
        setOptions(await getProfessionalsSummary());
      } catch (err) {
        setCopyError(translateApiError(err, t));
      }
    }
  }

  async function copyRules() {
    const fromId = Number(copyFrom);
    if (!fromId || !view) return;
    try {
      const source = await getProfessionalRules(fromId);
      const changes: ConfigChange[] = [];
      for (const s of source.groups.filter((g) => g.ownRule)) {
        const target = view.groups.find((g) => g.groupId === s.groupId);
        if (!target) continue;
        const value = ruleValue({
          paid: String(s.percent),
          retention: s.retentionPercent ? String(s.retentionPercent) : "",
          fixed: s.fixedAmount ?? 0,
          destination: s.fixedDestination ?? "DEFAULT",
        });
        const mine = target.ownRule
          ? ruleValue({
              paid: String(target.percent),
              retention: target.retentionPercent ? String(target.retentionPercent) : "",
              fixed: target.fixedAmount ?? 0,
              destination: target.fixedDestination ?? "DEFAULT",
            })
          : null;
        if (!sameRule(value, mine)) changes.push({ scope: "GROUP_RULE", professionalId, groupId: s.groupId, value });
      }
      if (changes.length === 0) {
        setCopyError(t("femme.commissions.byProfessional.copy.none"));
        return;
      }
      setCopyOpen(false);
      setApply({
        changes,
        summary: t("femme.commissions.pro.copySummary", { count: changes.length, name: view.professionalName }),
      });
    } catch (err) {
      setCopyError(translateApiError(err, t));
    }
  }

  async function saveRetention() {
    if (!retention) return;
    const raw = retention.value.trim();
    const parsed = raw === "" ? null : parsePercentInput(raw);
    if (raw !== "" && parsed === null) return setRetention({ ...retention, error: t("femme.commissions.validation.percent") });
    try {
      // It only prefills new rules: nothing is recalculated, so no apply-mode question.
      await applyChanges({
        changes: [{ scope: "RETENTION_PROFILE", professionalId, value: parsed }],
        applyMode: null,
        replacePending: true,
        preview: false,
      });
      setRetention(null);
      setNotice(t("femme.commissions.applyDialog.applied"));
      await load();
    } catch (err) {
      setRetention({ ...retention, error: translateApiError(err, t) });
    }
  }

  const example = useMemo(() => {
    if (!editor || !view) return null;
    const paid = Number(parsePercentInput(editor.draft.paid) ?? NaN);
    const retentionRaw = editor.draft.retention.trim() ? parsePercentInput(editor.draft.retention) : "0";
    const fixed = parseFixedInput(editor.draft.fixed);
    const priceN = parseFixedInput(price);
    if (!Number.isFinite(paid) || retentionRaw === null || fixed === null || priceN === null) return null;
    const destination = editor.draft.destination === "DEFAULT" ? view.defaultFixedDestination : editor.draft.destination;
    return calcLine(priceN, { paid, retention: aguinaldoOn ? Number(retentionRaw) : 0, fixed, destination }, view.baseType);
  }, [editor, view, price, aguinaldoOn]);

  if (error && !view) return <Alert variant="destructive">{error}</Alert>;
  if (!view) return <Spinner />;

  const set = (patch: Partial<Draft>) => editor && setEditor({ ...editor, draft: { ...editor.draft, ...patch }, error: null });
  const retains = view.retentionProfilePercent;

  return (
    <section className="flex min-w-0 flex-col gap-3" data-testid="pro-rules">
      <p className="px-0.5 text-sm text-ink-3">{t("femme.commissions.pro.rulesIntro", { name: view.professionalName })}</p>
      {notice && (
        <Alert variant="success" role="status" data-testid="pro-rules-notice">
          {notice}
        </Alert>
      )}
      {error && <Alert variant="destructive">{error}</Alert>}

      {aguinaldoOn && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-card bg-warning-lt px-4 py-3" data-testid="pro-retention">
          <span className="text-sm font-extrabold text-warning" data-testid="pro-rules-retains">
            {retains
              ? t("femme.commissions.byProfessional.retains", { percent: formatPercent(retains) })
              : t("femme.commissions.byProfessional.noRetains")}
          </span>
          <Button
            type="button"
            variant="secondary"
            className={ACTION_BUTTON}
            data-testid="pro-retention-edit"
            onClick={() => setRetention({ value: retains ? String(retains).replace(".", ",") : "", error: null })}
          >
            {t("femme.commissions.rules.change")}
          </Button>
        </div>
      )}

      {groups.length === 0 ? (
        <div className="rounded-card border border-line bg-surface p-4" data-testid="pro-rules-no-groups">
          <Text variant="muted">{t("femme.commissions.byProfessional.noGroups")}</Text>
          <Link to="/app/commissions/configurar/grupos" className="mt-2 inline-flex min-h-11 items-center font-bold text-primary">
            {t("femme.commissions.pro.createGroups")}
          </Link>
        </div>
      ) : withRule.length === 0 ? (
        <div className="rounded-card border border-dashed border-line bg-surface p-4 text-center" data-testid="pro-rules-empty">
          <Text variant="muted">{t("femme.commissions.pro.noRulesYet", { name: view.professionalName })}</Text>
          <p className="mt-1 text-sm text-ink-3">{t("femme.commissions.pro.defaultNote", { percent: formatPercent(view.defaultPercentService) })}</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="pro-rule-cards">
          {withRule.map((g) => (
            <li
              key={g.groupId}
              data-testid="rule-card"
              data-group={g.groupName}
              className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-surface px-4 py-3 shadow-sm"
            >
              <div className="min-w-0">
                <div className="font-heading font-extrabold text-ink" data-testid="rule-card-group">
                  {g.groupName}
                  {g.scheduled && (
                    <span className="ml-2 text-xs font-semibold text-warning" title={t("femme.commissions.byProfessional.scheduledRow")}>
                      ⏱
                    </span>
                  )}
                </div>
                <div className="text-sm text-ink-2" data-testid="rule-card-sentence">
                  {ruleSentence(t, g, aguinaldoOn, view.defaultFixedDestination)}
                </div>
                <div className="text-xs text-ink-3">{t("femme.commissions.pro.servicesInGroup", { count: g.serviceCount })}</div>
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="secondary" className={ACTION_BUTTON} data-testid="rule-card-edit" aria-label={`${t("femme.commissions.rules.change")}: ${g.groupName}`} onClick={() => open(g, false)}>
                  {t("femme.commissions.rules.change")}
                </Button>
                <Button type="button" variant="secondary" className={ACTION_BUTTON} data-testid="rule-card-remove" aria-label={`${t("femme.commissions.byProfessional.removeRule")}: ${g.groupName}`} onClick={() => remove(g)}>
                  {t("femme.commissions.pro.remove")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {groups.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {without.length > 0 && (
            <Button
              type="button"
              className={ACTION_BUTTON}
              data-testid="rule-add"
              onClick={() => {
                setPickGroup(String(without[0].groupId));
                setPicking(true);
              }}
            >
              + {t("femme.commissions.pro.addRule")}
            </Button>
          )}
          <Button type="button" variant="secondary" className={ACTION_BUTTON} data-testid="rule-copy" onClick={() => void startCopy()}>
            {t("femme.commissions.byProfessional.copy.action")}
          </Button>
        </div>
      )}

      <p className="text-sm text-ink-3">
        {t("femme.commissions.pro.exceptionHint")}{" "}
        <Link to="/app/commissions/configurar/avanzado" className="font-bold text-primary" data-testid="pro-advanced-link">
          {t("femme.commissions.pro.exceptionLink")}
        </Link>
      </p>

      <Modal
        open={picking}
        onClose={() => setPicking(false)}
        title={t("femme.commissions.pro.addRule")}
        description={t("femme.commissions.pro.pickGroup")}
        footer={
          <>
            <Button type="button" variant="secondary" className={`${ACTION_BUTTON} w-full sm:w-auto`} onClick={() => setPicking(false)}>
              {t("femme.commissions.common.cancel")}
            </Button>
            <Button
              type="button"
              className={`${ACTION_BUTTON} w-full sm:w-auto`}
              data-testid="rule-add-confirm"
              onClick={() => {
                const g = groups.find((x) => String(x.groupId) === pickGroup);
                if (g) open(g, true);
              }}
            >
              {t("femme.commissions.pro.next")}
            </Button>
          </>
        }
      >
        <Label htmlFor="rule-add-group">{t("femme.commissions.pro.groupLabel")}</Label>
        <Select id="rule-add-group" value={pickGroup} onChange={(e) => setPickGroup(e.target.value)} data-testid="rule-add-group">
          {without.map((g) => (
            <option key={g.groupId} value={g.groupId}>
              {g.groupName}
            </option>
          ))}
        </Select>
      </Modal>

      <Modal
        open={editor !== null}
        onClose={() => setEditor(null)}
        title={t("femme.commissions.pro.editorTitle", { group: editor?.group.groupName ?? "", name: view.professionalName })}
        className="max-w-lg"
        footer={
          <>
            <Button type="button" variant="secondary" className={`${ACTION_BUTTON} w-full sm:w-auto`} onClick={() => setEditor(null)}>
              {t("femme.commissions.common.cancel")}
            </Button>
            <Button type="button" className={`${ACTION_BUTTON} w-full sm:w-auto`} data-testid="rule-editor-next" onClick={next}>
              {t("femme.commissions.pro.next")}
            </Button>
          </>
        }
      >
        {editor && (
          <div className="flex flex-col gap-3" data-testid="rule-editor">
            <div className="flex flex-col gap-1">
              <Label htmlFor="rule-paid">{t("femme.commissions.pro.fieldPaid")}</Label>
              <Input id="rule-paid" inputMode="decimal" className="max-w-[8rem] text-right" value={editor.draft.paid} invalid={!!editor.error} data-testid="rule-paid" onChange={(e) => set({ paid: e.target.value })} aria-describedby={editor.error ? "rule-editor-error" : undefined} />
              <Text variant="small" className="text-ink-3">{t("femme.commissions.pro.fieldPaidHelp")}</Text>
            </div>
            {aguinaldoOn && (
              <div className="flex flex-col gap-1">
                <Label htmlFor="rule-retention">{t("femme.commissions.pro.fieldRetention")}</Label>
                <Input id="rule-retention" inputMode="decimal" className="max-w-[8rem] text-right" value={editor.draft.retention} data-testid="rule-retention" onChange={(e) => set({ retention: e.target.value })} />
                <Text variant="small" className="text-ink-3">{t("femme.commissions.pro.fieldRetentionHelp")}</Text>
              </div>
            )}
            <div className="flex flex-col gap-1">
              <Label htmlFor="rule-fixed">{t("femme.commissions.pro.fieldFixed")}</Label>
              <Input id="rule-fixed" inputMode="numeric" className="max-w-[10rem] text-right" value={editor.draft.fixed} data-testid="rule-fixed" onChange={(e) => set({ fixed: e.target.value })} />
              <Text variant="small" className="text-ink-3">{t("femme.commissions.pro.fieldFixedHelp")}</Text>
            </div>
            {editor.draft.fixed.trim() !== "" && (
              <div className="flex flex-col gap-1">
                <Label htmlFor="rule-destination">{t("femme.commissions.pro.fieldDestination")}</Label>
                <Select id="rule-destination" value={editor.draft.destination} data-testid="rule-destination" onChange={(e) => set({ destination: e.target.value as Draft["destination"] })}>
                  <option value="DEFAULT">{t("femme.commissions.byProfessional.destination.DEFAULT", { value: destLabel(view.defaultFixedDestination) })}</option>
                  <option value="PROFESSIONAL">{destLabel("PROFESSIONAL")}</option>
                  <option value="SALON">{destLabel("SALON")}</option>
                </Select>
              </div>
            )}
            {editor.error && <FieldValidationError id="rule-editor-error">{editor.error}</FieldValidationError>}

            <div className="rounded-card border-2 border-primary p-3" data-testid="rule-example">
              <div className="flex items-center justify-between gap-2">
                <b className="font-heading text-sm text-ink">{t("femme.commissions.pro.exampleTitle")}</b>
                <Input aria-label={t("femme.commissions.byProfessional.examplePrice")} inputMode="numeric" className="max-w-[8rem] text-right" value={price} data-testid="rule-example-price" onChange={(e) => setPrice(e.target.value)} />
              </div>
              {example ? (
                <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
                  <dt className="font-extrabold text-primary">{t("femme.commissions.byProfessional.examplePays", { name: view.professionalName })}</dt>
                  <dd className="text-right font-extrabold tabular-nums text-primary" data-testid="example-pays">{formatGuaraniesGs(example.pays)}</dd>
                  {aguinaldoOn && (
                    <>
                      <dt className="text-warning">{t("femme.commissions.pro.exampleRetained")}</dt>
                      <dd className="text-right tabular-nums text-warning" data-testid="example-retention">{formatGuaraniesGs(example.retentionAmount)}</dd>
                    </>
                  )}
                  <dt className="text-ink-3">{t("femme.commissions.byProfessional.exampleSalon")}</dt>
                  <dd className="text-right tabular-nums text-ink-3" data-testid="example-salon">{formatGuaraniesGs(example.salon)}</dd>
                </dl>
              ) : (
                <Text variant="small" className="mt-2 text-ink-3">{t("femme.commissions.byProfessional.exampleHint")}</Text>
              )}
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={copyOpen}
        onClose={() => setCopyOpen(false)}
        title={t("femme.commissions.byProfessional.copy.title")}
        description={t("femme.commissions.byProfessional.copy.description", { name: view.professionalName })}
        footer={
          <>
            <Button type="button" variant="secondary" className={`${ACTION_BUTTON} w-full sm:w-auto`} onClick={() => setCopyOpen(false)}>
              {t("femme.commissions.common.cancel")}
            </Button>
            <Button type="button" className={`${ACTION_BUTTON} w-full sm:w-auto`} disabled={!copyFrom} data-testid="rule-copy-confirm" onClick={() => void copyRules()}>
              {t("femme.commissions.pro.next")}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor="rule-copy-from">{t("femme.commissions.byProfessional.copy.from")}</Label>
          <Select id="rule-copy-from" value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)} data-testid="rule-copy-from">
            <option value="">{t("femme.commissions.byProfessional.copy.choose")}</option>
            {(options?.professionals ?? [])
              .filter((p) => p.professionalId !== professionalId)
              .map((p) => (
                <option key={p.professionalId} value={p.professionalId}>
                  {p.name}
                </option>
              ))}
          </Select>
          {copyError && <Alert variant="destructive">{copyError}</Alert>}
        </div>
      </Modal>

      <Modal
        open={retention !== null}
        onClose={() => setRetention(null)}
        title={t("femme.commissions.settings.retentionEditTitle", { name: view.professionalName })}
        className="max-w-lg"
        footer={
          <>
            <Button type="button" variant="secondary" className={`${ACTION_BUTTON} w-full sm:w-auto`} onClick={() => setRetention(null)}>
              {t("femme.commissions.common.cancel")}
            </Button>
            <Button type="button" className={`${ACTION_BUTTON} w-full sm:w-auto`} data-testid="pro-retention-save" onClick={() => void saveRetention()}>
              {t("femme.commissions.common.save")}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-1">
          <Label htmlFor="pro-retention-percent">{t("femme.commissions.settings.retentionInputLabel")}</Label>
          <Input id="pro-retention-percent" inputMode="decimal" className="max-w-[8rem]" value={retention?.value ?? ""} invalid={!!retention?.error} data-testid="pro-retention-percent" onChange={(e) => setRetention((c) => (c ? { value: e.target.value, error: null } : c))} />
          <FieldValidationError id="pro-retention-error">{retention?.error}</FieldValidationError>
          <Text variant="small" className="text-ink-3">{t("femme.commissions.settings.retentionInputHelp")}</Text>
        </div>
      </Modal>

      <ApplyChangeDialog
        open={apply !== null}
        changes={apply?.changes ?? []}
        summary={apply?.summary ?? ""}
        onClose={() => setApply(null)}
        onApplied={() => {
          setApply(null);
          setEditor(null);
          setNotice(t("femme.commissions.applyDialog.applied"));
          void load();
          void refresh();
        }}
      />
    </section>
  );
}
