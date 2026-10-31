import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Input, Label, Modal, Select, Spinner, Switch, Text } from "@design-system";
import {
  getItemRules,
  getRulesView,
  type BaseType,
  type ConfigChange,
  type ItemKind,
  type ItemRules,
  type RuleItem,
  type RulesView,
} from "../../api/commissions";
import { translateApiError } from "../../api/parseApiErrorMessage";
import { FieldValidationError } from "../../components/FieldValidationError";
import { LocalizedDateInput } from "../../components/LocalizedDateInput";
import { useDateLocale } from "../../i18n/dateLocale";
import { formatGuaraniesGs } from "../../lib/formatMoney";
import { formatParaguayDateTime } from "../../lib/paraguayDateTime";
import { ApplyChangeDialog } from "./ApplyChangeDialog";
import { describeVersionValue } from "./ScheduledChangesList";
import { TableWrap, formatPercent, parsePercentInput, tdClass, thClass, todayYmd } from "./common";

type SubTab = "SERVICE" | "PRODUCT";

/** Unsaved changes, keyed by scope + item + professional ("Guardar cambios" applies them all). */
type Pending = Record<string, ConfigChange>;

const key = (c: Pick<ConfigChange, "scope" | "serviceId" | "professionalId">) =>
  `${c.scope}|${c.serviceId ?? ""}|${c.professionalId ?? ""}`;

/** The item as it would look once the pending changes are saved. */
function effectiveItem(item: RuleItem, general: number, pending: Pending, professionals: { id: number; fullName: string }[]) {
  const own = pending[key({ scope: "RULE", serviceId: item.serviceId, professionalId: null })];
  let ownStandard = item.ownStandard;
  let standard = Number(item.standardPercent);
  if (own) {
    ownStandard = own.value !== null;
    standard = own.value !== null ? Number(own.value) : general;
  } else if (!item.ownStandard) {
    standard = general;
  }
  const exceptions = new Map<number, { percent: number; dirty: boolean }>();
  for (const e of item.exceptions) exceptions.set(e.professionalId, { percent: Number(e.percent), dirty: false });
  for (const p of professionals) {
    const c = pending[key({ scope: "RULE", serviceId: item.serviceId, professionalId: p.id })];
    if (!c) continue;
    if (c.value === null) exceptions.delete(p.id);
    else exceptions.set(p.id, { percent: Number(c.value), dirty: true });
  }
  const dirty =
    !!own ||
    professionals.some((p) => !!pending[key({ scope: "RULE", serviceId: item.serviceId, professionalId: p.id })]);
  return { standard, ownStandard, exceptions, dirty, ownDirty: !!own };
}

function deltaLabel(delta: number): string {
  const rounded = Math.round(delta * 100) / 100;
  if (rounded === 0) return "±0";
  return `${rounded > 0 ? "+" : "−"}${new Intl.NumberFormat("es-PY", { maximumFractionDigits: 2 }).format(Math.abs(rounded))}`;
}

/** Case- and accent-insensitive text for the item search ("coloracion" finds "Coloración"). */
const normalize = (v: string) => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** HU-COM-02 rules: general % → item % → professional + item exception (the most specific wins). */
export function RulesTab() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<SubTab>("SERVICE");
  const [views, setViews] = useState<Partial<Record<ItemKind, RulesView>>>({});
  const [date, setDate] = useState(todayYmd());
  const [onlyExceptions, setOnlyExceptions] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [pending, setPending] = useState<Pending>({});
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [services, products] = await Promise.all([getRulesView("SERVICE", date), getRulesView("PRODUCT", date)]);
      setViews({ SERVICE: services, PRODUCT: products });
      setError(null);
    } catch (err) {
      setError(translateApiError(err, t));
    }
  }, [date, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const pendingList = Object.values(pending);

  function stage(change: ConfigChange) {
    setNotice(null);
    setPending((prev) => ({ ...prev, [key(change)]: change }));
  }

  function unstage(change: Pick<ConfigChange, "scope" | "serviceId" | "professionalId">) {
    setPending((prev) => {
      const next = { ...prev };
      delete next[key(change)];
      return next;
    });
  }

  /** General % of a kind (changed from Configuración). */
  function generalOf(kind: ItemKind): number {
    return Number(views[kind]?.generalPercent ?? 0);
  }

  const base: BaseType = (views.SERVICE?.baseType as BaseType | undefined) ?? "NET_OF_TAX";

  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="commission-rules">
      <p className="px-0.5 text-sm text-ink-3">{t("femme.commissions.rules.intro")}</p>

      <div className="flex gap-2" role="group" aria-label={t("femme.commissions.tabs.rules")}>
        {(["SERVICE", "PRODUCT"] as const).map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={tab === k}
            data-testid={`rules-kind-${k}`}
            onClick={() => {
              setTab(k);
              setSelected(null);
            }}
            className={`min-h-11 rounded-full border px-4 text-sm font-semibold ${
              tab === k ? "border-primary bg-primary-lt text-primary" : "border-line bg-surface text-ink hover:bg-bg"
            }`}
          >
            {t(`femme.commissions.rules.subtabs.${k}`)}
          </button>
        ))}
      </div>

      {notice && (
        <Alert variant="success" role="status">
          {notice}
        </Alert>
      )}
      {error && <Alert variant="destructive">{error}</Alert>}

      {!views[tab] ? (
        <Spinner />
      ) : (
        <KindRules
          key={tab}
          view={views[tab]!}
          general={generalOf(tab)}
          base={base}
          date={date}
          onDate={setDate}
          onlyExceptions={onlyExceptions}
          onOnlyExceptions={setOnlyExceptions}
          selected={selected}
          onSelect={setSelected}
          pending={pending}
          stage={stage}
          unstage={unstage}
          onSave={() => {
            setSelected(null);
            setSaving(true);
          }}
        />
      )}

      {pendingList.length > 0 && (
        <>
          <div className="h-16" aria-hidden />
          <div
            className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface px-4 py-3 shadow-[0_-8px_24px_rgba(10,31,51,0.1)]"
            data-testid="rules-pending-bar"
          >
            <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3">
              <span className="text-sm font-semibold text-ink" data-testid="rules-pending-count">
                {t("femme.commissions.rules.pendingCount", { count: pendingList.length })}
              </span>
              <span className="flex gap-2">
                <Button type="button" variant="secondary" className="min-h-11" onClick={() => setPending({})} data-testid="rules-discard">
                  {t("femme.commissions.rules.discard")}
                </Button>
                <Button type="button" className="min-h-11" onClick={() => setSaving(true)} data-testid="rules-save">
                  {t("femme.commissions.rules.saveChanges")}
                </Button>
              </span>
            </div>
          </div>
        </>
      )}

      <ApplyChangeDialog
        open={saving}
        changes={pendingList}
        summary={t("femme.commissions.rules.saveSummary", { count: pendingList.length })}
        onClose={() => setSaving(false)}
        onApplied={() => {
          setSaving(false);
          setPending({});
          setNotice(t("femme.commissions.applyDialog.applied"));
          void load();
        }}
      />
    </div>
  );
}

function KindRules({
  view,
  general,
  base,
  date,
  onDate,
  onlyExceptions,
  onOnlyExceptions,
  selected,
  onSelect,
  pending,
  stage,
  unstage,
  onSave,
}: {
  view: RulesView;
  general: number;
  base: BaseType;
  date: string;
  onDate: (v: string) => void;
  onlyExceptions: boolean;
  onOnlyExceptions: (v: boolean) => void;
  selected: number | null;
  onSelect: (id: number | null) => void;
  pending: Pending;
  stage: (c: ConfigChange) => void;
  unstage: (c: Pick<ConfigChange, "scope" | "serviceId" | "professionalId">) => void;
  onSave: () => void;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [optionsOpen, setOptionsOpen] = useState(false);
  const isProduct = view.kind === "PRODUCT";
  const effective = useMemo(() => {
    const map = new Map<number, ReturnType<typeof effectiveItem>>();
    for (const c of view.categories) for (const i of c.items) map.set(i.serviceId, effectiveItem(i, general, pending, view.professionals));
    return map;
  }, [view, general, pending]);
  const hasException = (id: number) => {
    const e = effective.get(id)!;
    return e.ownStandard || e.exceptions.size > 0;
  };
  const allItems = useMemo(
    () =>
      view.categories
        .flatMap((c) => c.items.map((i) => ({ item: i, category: c.name })))
        .sort((a, b) => a.item.name.localeCompare(b.item.name, "es", { sensitivity: "base" })),
    [view],
  );
  const selectedItem = allItems.find((x) => x.item.serviceId === selected);
  const needle = normalize(search.trim());
  const rows = allItems.filter(
    (x) => (!onlyExceptions || hasException(x.item.serviceId)) && (!needle || normalize(x.item.name).includes(needle)),
  );

  return (
    <div className="flex flex-col gap-3">
      <form role="search" onSubmit={(e) => e.preventDefault()}>
        <Label htmlFor="rules-search" className="sr-only">
          {t(isProduct ? "femme.commissions.rules.searchProduct" : "femme.commissions.rules.searchService")}
        </Label>
        <Input
          id="rules-search"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t(isProduct ? "femme.commissions.rules.searchProductPlaceholder" : "femme.commissions.rules.searchServicePlaceholder")}
          data-testid="rules-search"
        />
      </form>

      <button
        type="button"
        aria-expanded={optionsOpen}
        aria-controls="rules-options"
        data-testid="rules-options-toggle"
        onClick={() => setOptionsOpen((o) => !o)}
        className="flex min-h-12 w-full items-center justify-between gap-3 rounded-card border border-line bg-surface px-4 text-left font-heading font-extrabold text-ink"
      >
        {t("femme.commissions.rules.optionsToggle")}
        <span aria-hidden className={`text-ink-3 transition-transform ${optionsOpen ? "rotate-180" : ""}`}>
          ⌄
        </span>
      </button>
      {optionsOpen && (
        <div id="rules-options" className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <Switch checked={onlyExceptions} onChange={(e) => onOnlyExceptions(e.target.checked)} data-testid="rules-only-exceptions" />
            {t("femme.commissions.rules.onlyExceptions")}
          </label>
          <div className="flex flex-col gap-1">
            <Label htmlFor="rules-date">{t("femme.commissions.rules.atDate")}</Label>
            <LocalizedDateInput id="rules-date" value={date} onChange={onDate} />
          </div>
          <p className="text-sm text-ink-3">
            {t("femme.commissions.rules.baseLine", { base: t(`femme.commissions.baseShort.${base}`) })}
          </p>
        </div>
      )}

      <div className="min-w-0 rounded-card border border-line bg-surface shadow-sm" data-testid="rules-table">
        {rows.length === 0 ? (
          <p className="p-4 text-ink-3" data-testid="rules-empty">
            {t("femme.commissions.rules.noResults")}
          </p>
        ) : (
          <ul>
            {rows.map(({ item: i }) => {
              const e = effective.get(i.serviceId)!;
              const exCount = e.exceptions.size;
              return (
                <li
                  key={i.serviceId}
                  role="button"
                  tabIndex={0}
                  data-testid={`rules-row-${i.serviceId}`}
                  onClick={() => onSelect(i.serviceId)}
                  onKeyDown={(ev) => {
                    if (ev.target !== ev.currentTarget) return;
                    if (ev.key === "Enter" || ev.key === " ") {
                      ev.preventDefault();
                      onSelect(i.serviceId);
                    }
                  }}
                  className={
                    "grid min-h-14 cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 border-t border-line px-4 py-2 first:border-t-0 hover:bg-bg " +
                    (selected === i.serviceId ? "bg-bg" : "")
                  }
                >
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-ink">
                      {i.name}
                      {e.dirty && (
                        <span className="ml-2 text-xs font-normal text-warning" title={t("femme.commissions.rules.unsaved")}>
                          ●<span className="sr-only"> {t("femme.commissions.rules.unsaved")}</span>
                        </span>
                      )}
                    </div>
                    <div className="truncate text-sm text-ink-3" data-testid={`rules-exceptions-${i.serviceId}`}>
                      {formatGuaraniesGs(i.price)}
                      {exCount > 0 ? ` · ${t("femme.commissions.rules.exceptionsCount", { count: exCount })}` : ""}
                      {i.scheduled ? ` · ⏱ ${t("femme.commissions.rules.hasScheduled")}` : ""}
                    </div>
                  </div>
                  <span className="text-right font-heading font-extrabold tabular-nums text-ink" data-testid={`rules-standard-${i.serviceId}`}>
                    {formatPercent(e.standard)}
                    {!e.ownStandard && <span className="block text-xs font-normal text-ink-3">{t("femme.commissions.rules.generalShort")}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {selectedItem && (
        <ItemPanel
          key={selectedItem.item.serviceId}
          item={selectedItem.item}
          category={selectedItem.category}
          general={general}
          base={base}
          effective={effective.get(selectedItem.item.serviceId)!}
          professionals={view.professionals}
          pending={pending}
          stage={stage}
          unstage={unstage}
          onClose={() => onSelect(null)}
          onSave={onSave}
        />
      )}
    </div>
  );
}

type PanelMode = { type: "standard" } | { type: "edit"; professionalId: number } | { type: "add" } | null;

function ItemPanel({
  item,
  category,
  general,
  base,
  effective,
  professionals,
  pending,
  stage,
  unstage,
  onClose,
  onSave,
}: {
  item: RuleItem;
  category: string;
  general: number;
  base: BaseType;
  effective: ReturnType<typeof effectiveItem>;
  professionals: { id: number; fullName: string }[];
  pending: Pending;
  stage: (c: ConfigChange) => void;
  unstage: (c: Pick<ConfigChange, "scope" | "serviceId" | "professionalId">) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const { t } = useTranslation();
  const dateLocale = useDateLocale();
  // One edit at a time (the standard %, one professional's %, or a new exception), each with its own
  // input — so typing in one never changes another (and «Cancelar» leaves each without staging).
  const [mode, setMode] = useState<PanelMode>(null);
  const [standardInput, setStandardInput] = useState("");
  const [editValue, setEditValue] = useState("");
  const [addProfessional, setAddProfessional] = useState("");
  const [addValue, setAddValue] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [history, setHistory] = useState<ItemRules | null>(null);
  const baseAmount = Number(item.baseAmount);
  const commission = (pct: number) => Math.round((baseAmount * pct) / 100);
  const savedException = (pid: number) => item.exceptions.find((e) => e.professionalId === pid);
  const isPending = (pid: number | null) =>
    !!pending[key({ scope: "RULE", serviceId: item.serviceId, professionalId: pid })];

  function open(next: PanelMode) {
    setFieldError(null);
    setMode(next);
  }

  function cancelEdit() {
    setFieldError(null);
    setMode(null);
  }

  function applyStandard() {
    const parsed = parsePercentInput(standardInput);
    if (parsed === null) {
      setFieldError(t("femme.commissions.validation.percent"));
      return;
    }
    setFieldError(null);
    const change = { scope: "RULE" as const, serviceId: item.serviceId, professionalId: null };
    // Back to what is already saved (own % or the inherited general) → nothing left to save.
    if (item.ownStandard ? Number(parsed) === Number(item.standardPercent) : Number(parsed) === general) unstage(change);
    else stage({ ...change, value: parsed });
    setMode(null);
  }

  function useGeneral() {
    const change = { scope: "RULE" as const, serviceId: item.serviceId, professionalId: null };
    if (!item.ownStandard) unstage(change);
    else stage({ ...change, value: null });
    setMode(null);
  }

  function applyException(pid: number, raw: string) {
    const parsed = parsePercentInput(raw);
    if (parsed === null) {
      setFieldError(t("femme.commissions.validation.percent"));
      return;
    }
    setFieldError(null);
    const change = { scope: "RULE" as const, serviceId: item.serviceId, professionalId: pid };
    const saved = savedException(pid);
    if (saved) {
      if (Number(saved.percent) === Number(parsed)) unstage(change);
      else stage({ ...change, value: parsed });
    } else if (Number(parsed) === effective.standard) {
      // Same % the professional already inherits: not an exception, so nothing to save (it used to
      // stage a «20 % ±0» exception that showed up as an unsaved change nobody could see).
      unstage(change);
    } else {
      stage({ ...change, value: parsed });
    }
    setMode(null);
    setAddProfessional("");
  }

  function removeException(pid: number) {
    const change = { scope: "RULE" as const, serviceId: item.serviceId, professionalId: pid };
    if (savedException(pid)) stage({ ...change, value: null });
    else unstage(change);
    setMode(null);
  }

  /** «No comisiona»: a 0 % exception — the professional earns nothing on this item. */
  function excludeProfessional(pid: number) {
    const change = { scope: "RULE" as const, serviceId: item.serviceId, professionalId: pid };
    const saved = savedException(pid);
    if (saved && Number(saved.percent) === 0) unstage(change);
    else stage({ ...change, value: "0" });
    setMode(null);
  }

  const excluded = professionals.filter((p) => effective.exceptions.get(p.id)?.percent === 0);
  const commissioning = professionals.filter((p) => effective.exceptions.get(p.id)?.percent !== 0);
  const inheriting = professionals.filter((p) => !effective.exceptions.has(p.id));
  const unsavedMark = (
    <span className="ml-1 text-[10px] font-normal text-warning" data-testid="rules-panel-unsaved">
      ● {t("femme.commissions.rules.unsaved")}
    </span>
  );

  return (
    <Modal
      open
      // Escape closes the history dialog first, not the item.
      onClose={() => (history ? setHistory(null) : onClose())}
      title={item.name}
      description={`${category} · ${t("femme.commissions.rules.priceLine", {
        price: formatGuaraniesGs(item.price),
        base: t(`femme.commissions.baseShort.${base}`),
        amount: formatGuaraniesGs(item.baseAmount),
      })}`}
      className="max-w-xl"
      footer={
        <>
          <Button type="button" variant="secondary" className="min-h-11 w-full sm:w-auto" onClick={onClose} data-testid="rules-panel-close">
            {t("femme.commissions.common.close")}
          </Button>
          <Button
            type="button"
            className="min-h-11 w-full sm:w-auto"
            disabled={Object.keys(pending).length === 0}
            onClick={onSave}
            data-testid="rules-panel-save"
          >
            {t("femme.commissions.rules.saveChanges")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid="rules-panel">
        <div className="border-b border-line pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-xs">{t("femme.commissions.rules.itemStandard")}</div>
              <div className="flex flex-wrap items-baseline gap-1">
                <span className="text-2xl font-semibold" data-testid="rules-panel-standard">
                  {formatPercent(effective.standard)}
                </span>
                {isPending(null) && unsavedMark}
              </div>
              <div className="text-[10px] text-[var(--color-ink-3)]">
                {effective.ownStandard
                  ? t("femme.commissions.rules.ownStandard")
                  : t("femme.commissions.rules.inheritsGeneral", { value: formatPercent(general) })}
              </div>
            </div>
            {mode?.type !== "standard" && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setStandardInput(String(effective.standard).replace(".", ","));
                  open({ type: "standard" });
                }}
                data-testid="rules-change-standard"
              >
                {t("femme.commissions.rules.change")}
              </Button>
            )}
          </div>
          {mode?.type === "standard" && (
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <Input
                aria-label={t("femme.commissions.rules.itemStandard")}
                inputMode="decimal"
                value={standardInput}
                onChange={(e) => setStandardInput(e.target.value)}
                className="max-w-[6rem]"
                data-testid="rules-standard-input"
              />
              <Button type="button" size="sm" variant="secondary" onClick={cancelEdit} data-testid="rules-standard-cancel">
                {t("femme.commissions.common.cancel")}
              </Button>
              <Button type="button" size="sm" onClick={applyStandard} data-testid="rules-standard-apply">
                {t("femme.commissions.rules.apply")}
              </Button>
              {effective.ownStandard && (
                <Button type="button" size="sm" variant="outline" onClick={useGeneral}>
                  {t("femme.commissions.rules.useGeneral", { value: formatPercent(general) })}
                </Button>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-between gap-2 text-[10px] font-medium uppercase text-[var(--color-ink-3)]">
          <span>{t("femme.commissions.common.professional")}</span>
          <span>{t("femme.commissions.rules.percentAndCommission")}</span>
        </div>
        <ul className="flex flex-col divide-y" data-testid="rules-panel-professionals">
          {commissioning.map((p) => {
            const exc = effective.exceptions.get(p.id);
            const pct = exc ? exc.percent : effective.standard;
            const editing = mode?.type === "edit" && mode.professionalId === p.id;
            return (
              <li key={p.id} className="py-2" data-testid={`rules-panel-prof-${p.id}`}>
                <button
                  type="button"
                  className="flex min-h-11 w-full items-start justify-between gap-2 text-left"
                  onClick={() => {
                    setEditValue(String(pct).replace(".", ","));
                    open({ type: "edit", professionalId: p.id });
                  }}
                >
                  <span className="min-w-0 break-words text-sm font-medium">
                    {p.fullName}
                    {isPending(p.id) && unsavedMark}
                  </span>
                  <span className="shrink-0 text-right">
                    {exc ? (
                      <span className="rounded-full border border-line px-2 py-0.5 text-xs font-semibold text-ink">
                        {formatPercent(exc.percent)} <span className="text-[10px] font-normal">{deltaLabel(exc.percent - effective.standard)}</span>
                      </span>
                    ) : (
                      <span className="text-xs text-[var(--color-ink-3)]">
                        {t("femme.commissions.rules.inherits", { value: formatPercent(effective.standard) })}
                      </span>
                    )}
                    <span className="block text-xs">{formatGuaraniesGs(commission(pct))}</span>
                  </span>
                </button>
                {editing && (
                  <div className="mt-1 flex flex-wrap items-end gap-2">
                    <Input
                      aria-label={t("femme.commissions.rules.exceptionFor", { name: p.fullName })}
                      inputMode="decimal"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      className="max-w-[6rem]"
                      data-testid="rules-edit-percent"
                    />
                    <Button type="button" size="sm" variant="secondary" onClick={cancelEdit} data-testid="rules-edit-cancel">
                      {t("femme.commissions.common.cancel")}
                    </Button>
                    <Button type="button" size="sm" onClick={() => applyException(p.id, editValue)} data-testid="rules-edit-apply">
                      {t("femme.commissions.rules.apply")}
                    </Button>
                    {exc && (
                      <Button type="button" size="sm" variant="outline" onClick={() => removeException(p.id)}>
                        {t("femme.commissions.rules.useStandard")}
                      </Button>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="text-danger"
                      onClick={() => excludeProfessional(p.id)}
                      data-testid="rules-exclude-professional"
                    >
                      {t("femme.commissions.rules.excludeProfessional")}
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        {excluded.length > 0 && (
          <div className="flex flex-col gap-1" data-testid="rules-panel-excluded">
            <div className="text-[10px] font-medium uppercase text-[var(--color-ink-3)]">
              {t("femme.commissions.rules.excludedTitle", { count: excluded.length })}
            </div>
            <ul className="flex flex-col divide-y">
              {excluded.map((p) => (
                <li
                  key={p.id}
                  className="flex min-h-11 flex-wrap items-center justify-between gap-2 py-1"
                  data-testid={`rules-panel-excluded-${p.id}`}
                >
                  <span className="min-w-0 break-words text-sm text-[var(--color-ink-3)] line-through">
                    {p.fullName}
                  </span>
                  <span className="flex items-center gap-2">
                    {isPending(p.id) && unsavedMark}
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => removeException(p.id)}
                      data-testid="rules-include-professional"
                    >
                      {t("femme.commissions.rules.includeProfessional")}
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <FieldValidationError>{fieldError}</FieldValidationError>

        {mode?.type === "add" ? (
          <div className="flex flex-wrap items-end gap-2">
            <Select
              aria-label={t("femme.commissions.common.professional")}
              value={addProfessional}
              onChange={(e) => setAddProfessional(e.target.value)}
              data-testid="rules-add-professional"
            >
              <option value="">{t("femme.commissions.rules.chooseProfessional")}</option>
              {inheriting.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.fullName}
                </option>
              ))}
            </Select>
            <Input
              aria-label={t("femme.commissions.rules.percent")}
              inputMode="decimal"
              value={addValue}
              onChange={(e) => setAddValue(e.target.value)}
              className="max-w-[6rem]"
              data-testid="rules-add-percent"
            />
            <Button type="button" size="sm" variant="secondary" onClick={cancelEdit} data-testid="rules-add-cancel">
              {t("femme.commissions.common.cancel")}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!addProfessional}
              onClick={() => applyException(Number(addProfessional), addValue)}
              data-testid="rules-add-apply"
            >
              {t("femme.commissions.rules.apply")}
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={inheriting.length === 0}
              onClick={() => {
                setAddProfessional("");
                setAddValue("");
                open({ type: "add" });
              }}
              data-testid="rules-add-exception"
            >
              {t("femme.commissions.rules.addException")}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => void getItemRules(item.serviceId).then(setHistory)}
              data-testid="rules-history"
            >
              {t("femme.commissions.rules.viewHistory")}
            </Button>
          </div>
        )}
        {Object.keys(pending).some((k) => k.startsWith(`RULE|${item.serviceId}|`)) && (
          <Text variant="small" className="text-warning" data-testid="rules-panel-pending">
            {t("femme.commissions.rules.panelPending")}
          </Text>
        )}
        <Text variant="small" className="text-[var(--color-ink-3)]">
          {t("femme.commissions.rules.panelFootnote")}
        </Text>

        <Modal open={history !== null} onClose={() => setHistory(null)} title={t("femme.commissions.rules.historyTitle")} className="max-w-3xl">
          {history && (
            <TableWrap testId="commission-rule-history">
              <thead>
                <tr>
                  <th className={thClass}>{t("femme.commissions.history.date")}</th>
                  <th className={thClass}>{t("femme.commissions.common.professional")}</th>
                  <th className={thClass}>{t("femme.commissions.history.previous")}</th>
                  <th className={thClass}>{t("femme.commissions.history.value")}</th>
                  <th className={thClass}>{t("femme.commissions.history.effectiveFrom")}</th>
                  <th className={thClass}>{t("femme.commissions.history.status")}</th>
                  <th className={thClass}>{t("femme.commissions.history.user")}</th>
                </tr>
              </thead>
              <tbody>
                {history.history.map((v) => (
                  <tr key={v.id} className="border-t">
                    <td className={tdClass}>{formatParaguayDateTime(v.createdAt, dateLocale)}</td>
                    <td className={tdClass}>{v.professionalName ?? t("femme.commissions.rules.general")}</td>
                    <td className={tdClass}>{describeVersionValue(t, "RULE", v.previousValue)}</td>
                    <td className={tdClass}>{describeVersionValue(t, "RULE", v.value)}</td>
                    <td className={tdClass}>{formatParaguayDateTime(v.effectiveFrom, dateLocale)}</td>
                    <td className={tdClass}>{t(`femme.commissions.versionStatus.${v.scheduled ? "SCHEDULED" : v.status}`)}</td>
                    <td className={tdClass}>{v.createdByEmail}</td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Modal>
      </div>
    </Modal>
  );
}
