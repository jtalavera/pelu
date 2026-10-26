import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Card, Input, Label, Modal, Radio, RadioGroup, Select, Spinner, Switch, Text } from "@design-system";
import {
  getItemRules,
  getRulesView,
  getSettings,
  type BaseType,
  type ConfigChange,
  type ItemKind,
  type ItemRules,
  type RuleItem,
  type RulesView,
  type SettingsResponse,
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

type SubTab = "SERVICE" | "PRODUCT" | "GENERAL";

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
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [date, setDate] = useState(todayYmd());
  const [onlyExceptions, setOnlyExceptions] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [pending, setPending] = useState<Pending>({});
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [services, products, s] = await Promise.all([
        getRulesView("SERVICE", date),
        getRulesView("PRODUCT", date),
        getSettings(),
      ]);
      setViews({ SERVICE: services, PRODUCT: products });
      setSettings(s);
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

  /** General % of a kind including a pending change. */
  function generalOf(kind: ItemKind): number {
    const c = pending[key({ scope: kind === "PRODUCT" ? "DEFAULT_PRODUCT" : "DEFAULT_SERVICE", serviceId: null, professionalId: null })];
    if (c && c.value !== null) return Number(c.value);
    return Number(views[kind]?.generalPercent ?? 0);
  }

  const base: BaseType =
    (pending[key({ scope: "BASE", serviceId: null, professionalId: null })]?.value as BaseType | undefined) ??
    (views.SERVICE?.baseType as BaseType | undefined) ??
    "NET_OF_TAX";

  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="commission-rules">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <Text variant="small" className="max-w-xl text-[var(--color-ink-3)]">
          {t("femme.commissions.rules.intro")}
        </Text>
        <div className="flex flex-wrap items-center gap-2">
          {pendingList.length > 0 && (
            <>
              <span className="text-xs text-warning" data-testid="rules-pending-count">
                {t("femme.commissions.rules.pendingCount", { count: pendingList.length })}
              </span>
              <Button type="button" variant="secondary" onClick={() => setPending({})} data-testid="rules-discard">
                {t("femme.commissions.rules.discard")}
              </Button>
            </>
          )}
          <Button
            type="button"
            disabled={pendingList.length === 0}
            onClick={() => setSaving(true)}
            data-testid="rules-save"
          >
            {t("femme.commissions.rules.saveChanges")}
          </Button>
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b" role="tablist" aria-label={t("femme.commissions.tabs.rules")}>
        {(["SERVICE", "PRODUCT", "GENERAL"] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => {
              setTab(k);
              setSelected(null);
            }}
            className={
              "min-h-11 border-b-2 px-3 text-sm " +
              (tab === k
                ? "border-[var(--color-rose)] font-medium text-[var(--color-ink)]"
                : "border-transparent text-[var(--color-ink-2)]")
            }
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

      {tab === "GENERAL" ? (
        <GeneralRules
          services={generalOf("SERVICE")}
          products={generalOf("PRODUCT")}
          base={base}
          savedServices={Number(views.SERVICE?.generalPercent ?? 0)}
          savedProducts={Number(views.PRODUCT?.generalPercent ?? 0)}
          savedBase={(views.SERVICE?.baseType as BaseType | undefined) ?? "NET_OF_TAX"}
          periodicity={settings?.periodicity}
          stage={stage}
          unstage={unstage}
        />
      ) : !views[tab] ? (
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
          onEditBase={() => setTab("GENERAL")}
          onSave={() => {
            setSelected(null);
            setSaving(true);
          }}
        />
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

function GeneralRules({
  services,
  products,
  base,
  savedServices,
  savedProducts,
  savedBase,
  periodicity,
  stage,
  unstage,
}: {
  services: number;
  products: number;
  base: BaseType;
  savedServices: number;
  savedProducts: number;
  savedBase: BaseType;
  periodicity?: string;
  stage: (c: ConfigChange) => void;
  unstage: (c: Pick<ConfigChange, "scope" | "serviceId" | "professionalId">) => void;
}) {
  const { t } = useTranslation();
  const [svc, setSvc] = useState(String(services).replace(".", ","));
  const [prod, setProd] = useState(String(products).replace(".", ","));
  const [errors, setErrors] = useState<Record<string, string | null>>({});

  function stagePercent(scope: "DEFAULT_SERVICE" | "DEFAULT_PRODUCT", raw: string, saved: number) {
    const parsed = parsePercentInput(raw);
    if (parsed === null) {
      setErrors((e) => ({ ...e, [scope]: t("femme.commissions.validation.percent") }));
      return;
    }
    setErrors((e) => ({ ...e, [scope]: null }));
    if (Number(parsed) === saved) unstage({ scope, serviceId: null, professionalId: null });
    else stage({ scope, value: parsed });
  }

  return (
    <div className="flex flex-col gap-4" data-testid="rules-general">
      <Card className="grid gap-4 p-4 sm:grid-cols-2">
        {(
          [
            ["DEFAULT_SERVICE", svc, setSvc, savedServices],
            ["DEFAULT_PRODUCT", prod, setProd, savedProducts],
          ] as const
        ).map(([scope, value, setValue, saved]) => (
          <div key={scope} className="flex flex-col gap-1">
            <Label htmlFor={`commission-${scope}`}>{t(`femme.commissions.settings.${scope}`)}</Label>
            <Input
              id={`commission-${scope}`}
              inputMode="decimal"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onBlur={() => stagePercent(scope, value, saved)}
              invalid={!!errors[scope]}
              aria-describedby={errors[scope] ? `commission-${scope}-error` : undefined}
              className="max-w-[8rem]"
            />
            <FieldValidationError id={`commission-${scope}-error`}>{errors[scope]}</FieldValidationError>
            <Text variant="small" className="text-[var(--color-ink-3)]">
              {t(`femme.commissions.settings.${scope}Help`)}
            </Text>
          </div>
        ))}
      </Card>
      <Card className="flex flex-col gap-3 p-4">
        <h3 className="text-base font-medium">{t("femme.commissions.settings.baseTitle")}</h3>
        <RadioGroup
          value={base}
          onChange={(v) => {
            if (v === savedBase) unstage({ scope: "BASE", serviceId: null, professionalId: null });
            else stage({ scope: "BASE", value: v });
          }}
          aria-label={t("femme.commissions.settings.baseTitle")}
        >
          {(["NET_OF_TAX", "TAX_INCLUDED"] as const).map((b) => (
            <label key={b} className="flex min-h-11 cursor-pointer items-start gap-2 text-sm">
              <Radio value={b} data-testid={`commission-base-${b}`} className="mt-1" />
              <span>
                <span className="font-medium">{t(`femme.commissions.base.${b}`)}</span>
                <span className="block text-xs text-[var(--color-ink-3)]">{t(`femme.commissions.baseHelp.${b}`)}</span>
              </span>
            </label>
          ))}
        </RadioGroup>
        <Text variant="small" className="text-[var(--color-ink-3)]">
          {t("femme.commissions.settings.baseExample")}
        </Text>
      </Card>
      {periodicity && (
        <Text variant="small" className="text-[var(--color-ink-3)]">
          {t("femme.commissions.rules.periodicityNote", { periodicity: t(`femme.commissions.periodicity.${periodicity}`) })}
        </Text>
      )}
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
  onEditBase,
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
  onEditBase: () => void;
  onSave: () => void;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
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
  const withExceptions = [...effective.keys()].filter(hasException).length;
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
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full border px-3 py-1 text-xs" data-testid="rules-count-items">
          {t(isProduct ? "femme.commissions.rules.countProducts" : "femme.commissions.rules.countServices", { count: view.itemCount })}
        </span>
        <span
          className="rounded-full border border-warning bg-warning-lt px-3 py-1 text-xs text-warning"
          data-testid="rules-count-exceptions"
        >
          {t("femme.commissions.rules.countWithExceptions", { count: withExceptions })}
        </span>
        <span className="rounded-full border px-3 py-1 text-xs" data-testid="rules-count-professionals">
          {t("femme.commissions.rules.countProfessionals", { count: view.professionals.length })}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-3 text-xs">
          <span>
            {t("femme.commissions.rules.baseLine", { base: t(`femme.commissions.baseShort.${base}`) })}{" "}
            <button type="button" className="underline" onClick={onEditBase} data-testid="rules-edit-base">
              {t("femme.commissions.rules.edit")}
            </button>
          </span>
          <label className="flex min-h-11 items-center gap-2">
            <Switch checked={onlyExceptions} onChange={(e) => onOnlyExceptions(e.target.checked)} data-testid="rules-only-exceptions" />
            {t("femme.commissions.rules.onlyExceptions")}
          </label>
          <div className="flex items-center gap-2">
            <Label htmlFor="rules-date" className="text-xs">
              {t("femme.commissions.rules.atDate")}
            </Label>
            <LocalizedDateInput id="rules-date" value={date} onChange={onDate} />
          </div>
        </div>
      </div>

      <form className="flex max-w-md flex-col gap-1" role="search" onSubmit={(e) => e.preventDefault()}>
        <Label htmlFor="rules-search">
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

      <div className="min-w-0 rounded-lg border">
          <TableWrap testId="rules-table">
            <thead>
              <tr>
                <th className={thClass}>{t(isProduct ? "femme.commissions.rules.colProduct" : "femme.commissions.rules.colService")}</th>
                <th className={thClass}>{t("femme.commissions.rules.colPrice")}</th>
                <th className={thClass}>{t("femme.commissions.rules.colStandard")}</th>
                <th className={thClass}>{t("femme.commissions.rules.colExceptions")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td className={`${tdClass} text-[var(--color-ink-3)]`} colSpan={4} data-testid="rules-empty">
                    {t("femme.commissions.rules.noResults")}
                  </td>
                </tr>
              )}
              {rows.map(({ item: i }) => {
                      const e = effective.get(i.serviceId)!;
                      return (
                        <tr
                          key={i.serviceId}
                          className={
                            "cursor-pointer border-t " +
                            (selected === i.serviceId ? "bg-success-lt" : "hover:bg-[var(--color-stone)]")
                          }
                          onClick={() => onSelect(i.serviceId)}
                          data-testid={`rules-row-${i.serviceId}`}
                        >
                          <td className={`${tdClass} font-medium`}>
                            <button type="button" className="min-h-11 text-left" onClick={() => onSelect(i.serviceId)}>
                              {i.name}
                            </button>
                            {e.dirty && (
                              <span className="ml-2 text-[10px] text-warning">
                                ● {t("femme.commissions.rules.unsaved")}
                              </span>
                            )}
                          </td>
                          <td className={`${tdClass} whitespace-nowrap`}>{formatGuaraniesGs(i.price)}</td>
                          <td className={`${tdClass} whitespace-nowrap`} data-testid={`rules-standard-${i.serviceId}`}>
                            <span className="font-semibold">{formatPercent(e.standard)}</span>
                            {e.ownStandard && e.standard !== general && (
                              <span className="ml-1 rounded border px-1 text-[10px] text-[var(--color-ink-3)]" title={t("femme.commissions.rules.differsFromGeneral")}>
                                ≠ {t("femme.commissions.rules.generalShort")}
                              </span>
                            )}
                            {i.scheduled && <span className="ml-1" title={t("femme.commissions.rules.hasScheduled")}>⏱</span>}
                          </td>
                          <td className={tdClass} data-testid={`rules-exceptions-${i.serviceId}`}>
                            {e.exceptions.size === 0 ? (
                              <span className="text-xs text-[var(--color-ink-3)]">{t("femme.commissions.rules.allInherit")}</span>
                            ) : (
                              <div className="flex flex-wrap gap-1">
                                {view.professionals
                                  .filter((p) => e.exceptions.has(p.id))
                                  .map((p) => {
                                    const x = e.exceptions.get(p.id)!;
                                    return (
                                      <span
                                        key={p.id}
                                        className="rounded-full border border-warning bg-warning-lt px-2 py-0.5 text-xs text-warning"
                                      >
                                        {p.fullName.split(" ")[0]} <strong>{formatPercent(x.percent)}</strong>{" "}
                                        <span className="text-[10px]">{deltaLabel(x.percent - e.standard)}</span>
                                      </span>
                                    );
                                  })}
                              </div>
                            )}
                          </td>
                        </tr>
                      );
              })}
            </tbody>
          </TableWrap>
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
  const [editingStandard, setEditingStandard] = useState(false);
  const [standardInput, setStandardInput] = useState(String(effective.standard).replace(".", ","));
  const [editing, setEditing] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const [adding, setAdding] = useState(false);
  const [addProfessional, setAddProfessional] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [history, setHistory] = useState<ItemRules | null>(null);
  const baseAmount = Number(item.baseAmount);
  const commission = (pct: number) => Math.round((baseAmount * pct) / 100);
  const savedException = (pid: number) => item.exceptions.find((e) => e.professionalId === pid);

  function applyStandard() {
    const parsed = parsePercentInput(standardInput);
    if (parsed === null) {
      setFieldError(t("femme.commissions.validation.percent"));
      return;
    }
    setFieldError(null);
    const change = { scope: "RULE" as const, serviceId: item.serviceId, professionalId: null };
    if (item.ownStandard && Number(parsed) === Number(item.standardPercent)) unstage(change);
    else stage({ ...change, value: parsed });
    setEditingStandard(false);
  }

  function useGeneral() {
    const change = { scope: "RULE" as const, serviceId: item.serviceId, professionalId: null };
    if (!item.ownStandard) unstage(change);
    else stage({ ...change, value: null });
    setEditingStandard(false);
  }

  function applyException(pid: number) {
    const parsed = parsePercentInput(editValue);
    if (parsed === null) {
      setFieldError(t("femme.commissions.validation.percent"));
      return;
    }
    setFieldError(null);
    const change = { scope: "RULE" as const, serviceId: item.serviceId, professionalId: pid };
    const saved = savedException(pid);
    if (saved && Number(saved.percent) === Number(parsed)) unstage(change);
    else stage({ ...change, value: parsed });
    setEditing(null);
    setAdding(false);
    setAddProfessional("");
  }

  function removeException(pid: number) {
    const change = { scope: "RULE" as const, serviceId: item.serviceId, professionalId: pid };
    if (savedException(pid)) stage({ ...change, value: null });
    else unstage(change);
    setEditing(null);
  }

  const inheriting = professionals.filter((p) => !effective.exceptions.has(p.id));

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
        <div className="rounded-md bg-success-lt p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-xs">{t("femme.commissions.rules.itemStandard")}</div>
              <div className="text-2xl font-semibold" data-testid="rules-panel-standard">
                {formatPercent(effective.standard)}
              </div>
              <div className="text-[10px] text-[var(--color-ink-3)]">
                {effective.ownStandard
                  ? t("femme.commissions.rules.ownStandard")
                  : t("femme.commissions.rules.inheritsGeneral", { value: formatPercent(general) })}
              </div>
            </div>
            {!editingStandard && (
              <Button type="button" variant="secondary" onClick={() => setEditingStandard(true)} data-testid="rules-change-standard">
                {t("femme.commissions.rules.change")}
              </Button>
            )}
          </div>
          {editingStandard && (
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <Input
                aria-label={t("femme.commissions.rules.itemStandard")}
                inputMode="decimal"
                value={standardInput}
                onChange={(e) => setStandardInput(e.target.value)}
                className="max-w-[6rem]"
                data-testid="rules-standard-input"
              />
              <Button type="button" size="sm" onClick={applyStandard} data-testid="rules-standard-apply">
                {t("femme.commissions.rules.apply")}
              </Button>
              {effective.ownStandard && (
                <Button type="button" size="sm" variant="secondary" onClick={useGeneral}>
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
          {professionals.map((p) => {
            const exc = effective.exceptions.get(p.id);
            const pct = exc ? exc.percent : effective.standard;
            return (
              <li key={p.id} className="py-2" data-testid={`rules-panel-prof-${p.id}`}>
                <button
                  type="button"
                  className="flex min-h-11 w-full items-start justify-between gap-2 text-left"
                  onClick={() => {
                    setEditing(p.id);
                    setEditValue(String(pct).replace(".", ","));
                    setFieldError(null);
                  }}
                >
                  <span className="min-w-0 break-words text-sm font-medium">{p.fullName}</span>
                  <span className="shrink-0 text-right">
                    {exc ? (
                      <span className="rounded-full border border-warning bg-warning-lt px-2 py-0.5 text-xs font-semibold text-warning">
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
                {editing === p.id && (
                  <div className="mt-1 flex flex-wrap items-end gap-2">
                    <Input
                      aria-label={t("femme.commissions.rules.exceptionFor", { name: p.fullName })}
                      inputMode="decimal"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      className="max-w-[6rem]"
                    />
                    <Button type="button" size="sm" onClick={() => applyException(p.id)}>
                      {t("femme.commissions.rules.apply")}
                    </Button>
                    {exc && (
                      <Button type="button" size="sm" variant="secondary" onClick={() => removeException(p.id)}>
                        {t("femme.commissions.rules.removeException")}
                      </Button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        <FieldValidationError>{fieldError}</FieldValidationError>

        {adding ? (
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
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              className="max-w-[6rem]"
              data-testid="rules-add-percent"
            />
            <Button
              type="button"
              size="sm"
              disabled={!addProfessional}
              onClick={() => applyException(Number(addProfessional))}
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
                setAdding(true);
                setEditValue("");
                setFieldError(null);
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
          <Text variant="small" className="text-warning">
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
