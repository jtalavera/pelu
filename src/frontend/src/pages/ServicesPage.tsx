import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFeatureFlag } from "../hooks/useFeatureFlags";
import { useTour } from "../tour/useTour";
import { servicesSteps } from "../tour/steps/services";
import {
  Alert,
  Button,
  Input,
  Label,
  Modal,
  Select,
  Spinner,
  Text,
} from "@design-system";
import { femmeJson, femmePostJson, femmePutJson } from "../api/femmeClient";
import { translateApiError } from "../api/parseApiErrorMessage";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { FieldValidationError } from "../components/FieldValidationError";
import { StatusBadge } from "../components/StatusBadge";
import { InlineEditActions } from "../components/ui/InlineEditActions";
import { SearchInput } from "../components/ui/SearchInput";
import { useFilteredList } from "../hooks/useFilteredList";
import { useInlineEdit } from "../hooks/useInlineEdit";
import {
  CATEGORY_ACCENT_KEYS,
  type CategoryAccentKey,
  categoryAccentStyle,
} from "../util/categoryAccent";

// ── Helpers ────────────────────────────────────────────────────────────────
function fmtPrice(minor: string | number): string {
  const n = Number(minor);
  if (!Number.isFinite(n)) return "Gs. —";
  return "Gs. " + Math.round(n).toLocaleString("es-PY");
}

type ServiceCategory = {
  id: number;
  name: string;
  active: boolean;
  accentKey: string;
};
type SalonService = {
  id: number;
  categoryId: number;
  categoryName: string;
  categoryAccentKey: string;
  name: string;
  priceMinor: string | number;
  durationMinutes: number;
  active: boolean;
};

type ServicesDeactivateTarget =
  | { kind: "category"; item: ServiceCategory }
  | { kind: "service"; item: SalonService }
  | null;

function normalizeMoneyInput(raw: string) {
  const s = raw.trim().replace(",", ".");
  const v = Number(s);
  if (!Number.isFinite(v) || v < 0) return null;
  return v;
}

export default function ServicesPage() {
  const { t } = useTranslation();
  const guidedTourEnabled = useFeatureFlag("GUIDED_TOUR");
  useTour("services", servicesSteps, undefined, guidedTourEnabled);
  const [tab, setTab] = useState<"services" | "categories">("services");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [services, setServices] = useState<SalonService[]>([]);

  const [categoryFilterId, setCategoryFilterId] = useState<string>("all");
  /** Client-side quick filter: list order is always active first when "all". */
  const [serviceStatusFilter, setServiceStatusFilter] = useState<"all" | "active" | "inactive">("all");

  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [categoryEditing, setCategoryEditing] = useState<ServiceCategory | null>(null);
  const [categoryName, setCategoryName] = useState("");
  const [categoryAccentKey, setCategoryAccentKey] = useState<CategoryAccentKey>("stone");
  const [categoryNameError, setCategoryNameError] = useState<string | null>(null);
  const [categorySaveError, setCategorySaveError] = useState<string | null>(null);
  const [categorySaving, setCategorySaving] = useState(false);

  const [serviceModalOpen, setServiceModalOpen] = useState(false);
  const [serviceEditing, setServiceEditing] = useState<SalonService | null>(null);
  const [serviceName, setServiceName] = useState("");
  const [serviceCategoryId, setServiceCategoryId] = useState<string>("");
  const [servicePrice, setServicePrice] = useState("");
  const [serviceDuration, setServiceDuration] = useState("");
  const [serviceFieldError, setServiceFieldError] = useState<{
    name?: string;
    categoryId?: string;
    price?: string;
    duration?: string;
  } | null>(null);
  const [serviceSaveError, setServiceSaveError] = useState<string | null>(null);
  const [serviceSaving, setServiceSaving] = useState(false);
  const [serviceReactivating, setServiceReactivating] = useState(false);
  const [activatingServiceId, setActivatingServiceId] = useState<number | null>(null);
  const [activatingCategoryId, setActivatingCategoryId] = useState<number | null>(null);

  const [deactivateTarget, setDeactivateTarget] = useState<ServicesDeactivateTarget>(null);
  const [hoveredCardKey, setHoveredCardKey] = useState<string | null>(null);

  const activeCategories = useMemo(() => categories.filter((c) => c.active), [categories]);

  /** Active categories plus the current service's category when editing (so inactive category still appears). */
  const serviceCategorySelectOptions = useMemo(() => {
    return categories.filter(
      (c) => c.active || (serviceEditing !== null && c.id === serviceEditing.categoryId),
    );
  }, [categories, serviceEditing]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cats, svcs] = await Promise.all([
        femmeJson<ServiceCategory[]>("/api/service-categories"),
        femmeJson<SalonService[]>("/api/services"),
      ]);
      setCategories(Array.isArray(cats) ? cats : []);
      setServices(Array.isArray(svcs) ? svcs : []);
    } catch {
      setError(t("femme.services.loadError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  function handleCategoryPill(val: string) {
    setCategoryFilterId(val);
  }

  function handleServiceStatusPill(val: "all" | "active" | "inactive") {
    setServiceStatusFilter(val);
  }

  function openNewCategory() {
    setCategoryEditing(null);
    setCategoryName("");
    setCategoryAccentKey("stone");
    setCategoryNameError(null);
    setCategorySaveError(null);
    setCategoryModalOpen(true);
  }

  async function saveCategory() {
    setCategoryNameError(null);
    setCategorySaveError(null);
    if (!categoryName.trim()) {
      setCategoryNameError(t("femme.services.categories.nameRequired"));
      return;
    }
    setCategorySaving(true);
    try {
      const payload = { name: categoryName.trim(), accentKey: categoryAccentKey };
      if (categoryEditing) {
        await femmePutJson<ServiceCategory>(
          `/api/service-categories/${categoryEditing.id}`,
          payload,
        );
      } else {
        await femmePostJson<ServiceCategory>("/api/service-categories", payload);
      }
      setCategoryModalOpen(false);
      await load();
    } catch (e) {
      setCategorySaveError(translateApiError(e, t, "femme.services.saveError"));
    } finally {
      setCategorySaving(false);
    }
  }

  function requestDeactivateCategory(c: ServiceCategory) {
    setDeactivateTarget({ kind: "category", item: c });
  }

  async function activateCategoryFromList(c: ServiceCategory) {
    setActivatingCategoryId(c.id);
    setError(null);
    try {
      await femmePostJson(`/api/service-categories/${c.id}/activate`, {});
      await load();
    } catch (e) {
      setError(translateApiError(e, t, "femme.services.saveError"));
    } finally {
      setActivatingCategoryId(null);
    }
  }

  function openNewService() {
    setServiceEditing(null);
    setServiceName("");
    setServiceCategoryId(activeCategories[0]?.id ? String(activeCategories[0].id) : "");
    setServicePrice("");
    setServiceDuration("");
    setServiceFieldError(null);
    setServiceSaveError(null);
    setServiceModalOpen(true);
  }

  async function saveService() {
    setServiceFieldError(null);
    setServiceSaveError(null);
    const nameTrim = serviceName.trim();
    const categoryId = serviceCategoryId.trim();
    const price = normalizeMoneyInput(servicePrice);
    const duration = Number(serviceDuration.trim());
    const nextErr: NonNullable<typeof serviceFieldError> = {};
    if (!nameTrim) nextErr.name = t("femme.services.services.nameRequired");
    if (!categoryId) nextErr.categoryId = t("femme.services.services.categoryRequired");
    if (price == null) nextErr.price = t("femme.services.services.priceInvalid");
    if (!Number.isFinite(duration) || duration < 1) nextErr.duration = t("femme.services.services.durationInvalid");
    if (Object.keys(nextErr).length > 0) {
      setServiceFieldError(nextErr);
      return;
    }

    setServiceSaving(true);
    try {
      const payload = {
        name: nameTrim,
        categoryId: Number(categoryId),
        priceMinor: price,
        durationMinutes: duration,
      };
      if (serviceEditing) {
        await femmePutJson<SalonService>(`/api/services/${serviceEditing.id}`, payload);
      } else {
        await femmePostJson<SalonService>("/api/services", payload);
      }
      setServiceModalOpen(false);
      await load();
    } catch (e) {
      setServiceSaveError(translateApiError(e, t, "femme.services.saveError"));
    } finally {
      setServiceSaving(false);
    }
  }

  function requestDeactivateService(s: SalonService) {
    setDeactivateTarget({ kind: "service", item: s });
  }

  async function activateSalonServiceFromList(s: SalonService) {
    setActivatingServiceId(s.id);
    setError(null);
    try {
      await femmePostJson(`/api/services/${s.id}/activate`, {});
      await load();
    } catch (e) {
      setError(translateApiError(e, t, "femme.services.saveError"));
    } finally {
      setActivatingServiceId(null);
    }
  }

  async function activateSalonServiceFromModal() {
    if (!serviceEditing) return;
    setServiceReactivating(true);
    setServiceSaveError(null);
    try {
      const updated = await femmePostJson<SalonService>(
        `/api/services/${serviceEditing.id}/activate`,
        {},
      );
      setServiceEditing(updated);
      await load();
    } catch (e) {
      setServiceSaveError(translateApiError(e, t, "femme.services.saveError"));
    } finally {
      setServiceReactivating(false);
    }
  }

  async function confirmDeactivateTarget() {
    const target = deactivateTarget;
    if (!target) return;
    setDeactivateTarget(null);
    try {
      if (target.kind === "category") {
        await femmePostJson<ServiceCategory>(
          `/api/service-categories/${target.item.id}/deactivate`,
          {},
        );
      } else {
        await femmePostJson<SalonService>(`/api/services/${target.item.id}/deactivate`, {});
      }
      await load();
    } catch (e) {
      setError(translateApiError(e, t, "femme.services.saveError"));
    }
  }

  const filterOptions = useMemo(() => {
    return [
      { value: "all", label: t("femme.services.filter.allCategories") },
      ...activeCategories.map((c) => ({ value: String(c.id), label: c.name })),
    ];
  }, [activeCategories, t]);

  const statusFilterOptions = useMemo(
    () =>
      [
        { value: "all" as const, label: t("femme.services.filter.statusAll") },
        { value: "active" as const, label: t("femme.services.filter.statusActive") },
        { value: "inactive" as const, label: t("femme.services.filter.statusInactive") },
      ] as const,
    [t],
  );

  const baseFilteredByCategory = useMemo(() => {
    if (categoryFilterId === "all") return services;
    return services.filter((s) => String(s.categoryId) === categoryFilterId);
  }, [services, categoryFilterId]);

  const displayedServices = useMemo(() => {
    const list = baseFilteredByCategory;
    if (serviceStatusFilter === "active") {
      return list.filter((s) => s.active);
    }
    if (serviceStatusFilter === "inactive") {
      return list.filter((s) => !s.active);
    }
    const active = list.filter((s) => s.active);
    const inactive = list.filter((s) => !s.active);
    return [...active, ...inactive];
  }, [baseFilteredByCategory, serviceStatusFilter]);

  const serviceFilterFields = useMemo(() => ["name", "categoryName"] as (keyof SalonService)[], []);
  const {
    query: serviceSearchQuery,
    setQuery: setServiceSearchQuery,
    filtered: servicesTextFiltered,
    highlight: highlightService,
  } = useFilteredList<SalonService>({
    items: displayedServices,
    fields: serviceFilterFields,
  });

  const categoryFilterFields = useMemo(() => ["name"] as (keyof ServiceCategory)[], []);
  const {
    query: categorySearchQuery,
    setQuery: setCategorySearchQuery,
    filtered: categoriesTextFiltered,
    highlight: highlightCategory,
  } = useFilteredList<ServiceCategory>({
    items: categories,
    fields: categoryFilterFields,
  });

  const handleInlineServiceSave = useCallback(
    async (s: SalonService) => {
      const nameTrim = String(s.name ?? "").trim();
      const categoryId = Number(s.categoryId);
      const priceRaw = s.priceMinor;
      const price =
        typeof priceRaw === "number" ? priceRaw : normalizeMoneyInput(String(priceRaw ?? ""));
      const duration = Number(s.durationMinutes);
      if (!nameTrim) throw new Error("INVALID");
      if (!Number.isFinite(categoryId)) throw new Error("INVALID");
      if (price == null || !Number.isFinite(price) || price < 0) throw new Error("INVALID");
      if (!Number.isFinite(duration) || duration < 1) throw new Error("INVALID");
      await femmePutJson<SalonService>(`/api/services/${s.id}`, {
        name: nameTrim,
        categoryId,
        priceMinor: price,
        durationMinutes: duration,
      });
      await load();
    },
    [load],
  );

  const handleInlineCategorySave = useCallback(
    async (c: ServiceCategory) => {
      const nameTrim = String(c.name ?? "").trim();
      if (!nameTrim) throw new Error("INVALID");
      const accentKey = CATEGORY_ACCENT_KEYS.includes(c.accentKey as CategoryAccentKey)
        ? (c.accentKey as CategoryAccentKey)
        : "stone";
      await femmePutJson<ServiceCategory>(`/api/service-categories/${c.id}`, {
        name: nameTrim,
        accentKey,
      });
      await load();
    },
    [load],
  );

  const {
    editingData: serviceEditingData,
    saving: serviceInlineSaving,
    saveError: serviceInlineSaveError,
    startEdit: startServiceEdit,
    cancelEdit: cancelServiceEdit,
    updateField: updateServiceField,
    saveEdit: saveServiceEdit,
    isEditing: isEditingService,
  } = useInlineEdit<SalonService>({
    onSave: handleInlineServiceSave,
    saveErrorMessage: t("femme.inlineEdit.saveError"),
  });

  const {
    editingData: categoryEditingData,
    saving: categoryInlineSaving,
    saveError: categoryInlineSaveError,
    startEdit: startCategoryEdit,
    cancelEdit: cancelCategoryEdit,
    updateField: updateCategoryField,
    saveEdit: saveCategoryEdit,
    isEditing: isEditingCategory,
  } = useInlineEdit<ServiceCategory>({
    onSave: handleInlineCategorySave,
    saveErrorMessage: t("femme.inlineEdit.saveError"),
  });

  const categoriasOrdenadas = useMemo(
    () =>
      [...categoriesTextFiltered].sort((a, b) => {
        if (a.active === b.active) return 0;
        return a.active ? -1 : 1;
      }),
    [categoriesTextFiltered],
  );

  const serviciosOrdenados = useMemo(
    () =>
      [...servicesTextFiltered].sort((a, b) => {
        if (a.active === b.active) return 0;
        return a.active ? -1 : 1;
      }),
    [servicesTextFiltered],
  );

  const keySaveCancelService = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void saveServiceEdit();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      cancelServiceEdit();
    }
  };

  const keySaveCancelCategory = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void saveCategoryEdit();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      cancelCategoryEdit();
    }
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 10,
    fontWeight: 500,
    color: "var(--color-ink-2)",
    display: "block",
    marginBottom: 3,
  };

  const inputEditStyle: React.CSSProperties = {
    padding: "6px 9px",
    border: "1px solid var(--color-rose-md)",
    borderRadius: "var(--radius-md)",
    fontSize: 12,
    color: "var(--color-ink)",
    background: "var(--color-white)",
    outline: "none",
    width: "100%",
  };

  const categoryInputEditStyle: React.CSSProperties = {
    ...inputEditStyle,
    minWidth: 80,
  };

  const inlineServiceCategoryOptions = useMemo(() => {
    const cid = serviceEditingData.categoryId;
    return categories.filter((c) => c.active || c.id === cid);
  }, [categories, serviceEditingData.categoryId]);

  const onServiceCategoryInlineChange = useCallback(
    (categoryId: number) => {
      const cat = categories.find((c) => c.id === categoryId);
      updateServiceField("categoryId", categoryId);
      if (cat) {
        updateServiceField("categoryName", cat.name);
        updateServiceField("categoryAccentKey", cat.accentKey);
      }
    },
    [categories, updateServiceField],
  );

  if (loading) {
    return (
      <div style={{ display: "flex", minHeight: "40vh", alignItems: "center", justifyContent: "center", gap: 12 }}>
        <Spinner size="lg" />
        <Text>{t("femme.services.loading")}</Text>
      </div>
    );
  }

  // ── Shared style constants ────────────────────────────────────────────────
  const primaryBtn: React.CSSProperties = {
    background: "var(--color-rose)",
    color: "var(--color-on-primary)",
    border: "none",
    borderRadius: "var(--radius-md)",
    padding: "8px 16px",
    fontSize: 12,
    fontWeight: 500,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    whiteSpace: "nowrap",
  };

  const pillBase: React.CSSProperties = {
    padding: "5px 12px",
    borderRadius: "var(--radius-pill)",
    fontSize: 11,
    cursor: "pointer",
    border: "var(--border-default)",
    background: "var(--color-white)",
    color: "var(--color-ink-2)",
    whiteSpace: "nowrap",
  };

  const pillActive: React.CSSProperties = {
    ...pillBase,
    background: "var(--color-rose-lt)",
    borderColor: "var(--color-rose-md)",
    color: "var(--color-rose-dk)",
    fontWeight: 500,
  };

  const tabBase: React.CSSProperties = {
    padding: "6px 14px",
    borderRadius: "var(--radius-md)",
    fontSize: 12,
    cursor: "pointer",
    border: "var(--border-default)",
    background: "var(--color-white)",
    color: "var(--color-ink-2)",
  };

  const tabActive: React.CSSProperties = {
    ...tabBase,
    background: "var(--color-rose-lt)",
    borderColor: "var(--color-rose-md)",
    color: "var(--color-rose-dk)",
    fontWeight: 500,
  };

  return (
    <div>
      {/* ── Page header ── */}
      <div
        data-tour="services-header"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 16,
        }}
      >
        <div>
          <div style={{ fontSize: 15, fontWeight: 500, color: "var(--color-ink)" }}>
            {t("femme.services.title")}
          </div>
          <div style={{ fontSize: 11, color: "var(--color-ink-3)", marginTop: 2 }}>
            {t("femme.services.lead")}
          </div>
        </div>
        {tab === "services" ? (
          <button type="button" style={primaryBtn} onClick={openNewService}>
            {t("femme.services.services.addNew")}
          </button>
        ) : (
          <button data-tour="services-add-category" type="button" style={primaryBtn} onClick={openNewCategory}>
            {t("femme.services.categories.addNew")}
          </button>
        )}
      </div>

      {/* ── Error ── */}
      {error && (
        <Alert variant="destructive" title={t("femme.services.errorTitle")}>
          {error}
        </Alert>
      )}

      {/* ── Custom tabs ── */}
      <div style={{ display: "flex", gap: 4, marginBottom: 14 }}>
        {(["services", "categories"] as const).map((v) => (
          <button
            key={v}
            type="button"
            style={tab === v ? tabActive : tabBase}
            onClick={() => setTab(v)}
          >
            {t(`femme.services.tabs.${v}`)}
          </button>
        ))}
      </div>

      {/* ── Services tab ── */}
      {tab === "services" && (
        <div data-tour="services-list">
          {/* Toolbar */}
          <div
            style={{
              display: "flex",
              gap: 8,
              marginBottom: 12,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <SearchInput
              data-tour="services-search"
              id="services-list-filter"
              value={serviceSearchQuery}
              onChange={setServiceSearchQuery}
              placeholder={t("femme.services.services.searchInlinePlaceholder")}
              resultCount={servicesTextFiltered.length}
              totalCount={displayedServices.length}
            />
            <div data-tour="services-filters" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {filterOptions.map((o) => (
              <button
                key={o.value}
                type="button"
                style={categoryFilterId === o.value ? pillActive : pillBase}
                onClick={() => handleCategoryPill(o.value)}
              >
                {o.label}
              </button>
            ))}
            <div
              role="separator"
              aria-orientation="vertical"
              style={{
                width: 1,
                alignSelf: "stretch",
                minHeight: 28,
                background: "var(--color-stone-md)",
                flexShrink: 0,
                margin: "0 4px",
              }}
            />
            <div
              role="group"
              aria-label={t("femme.services.filter.statusLabel")}
              style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}
            >
              {statusFilterOptions.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  style={serviceStatusFilter === o.value ? pillActive : pillBase}
                  onClick={() => handleServiceStatusPill(o.value)}
                >
                  {o.label}
                </button>
              ))}
            </div>
            </div>
          </div>

          {/* Service cards */}
          {services.length === 0 && (
            <div
              style={{
                padding: "20px 0",
                textAlign: "center",
                fontSize: 12,
                color: "var(--color-ink-3)",
              }}
            >
              {t("femme.services.services.emptyBody")}
            </div>
          )}
          {services.length > 0 && displayedServices.length === 0 && (
            <div
              style={{
                padding: "20px 0",
                textAlign: "center",
                fontSize: 12,
                color: "var(--color-ink-3)",
              }}
            >
              {t("femme.listFilter.noMatches")}
            </div>
          )}
          {services.length > 0 && displayedServices.length > 0 && servicesTextFiltered.length === 0 && (
            <div
              style={{
                padding: "20px 0",
                textAlign: "center",
                fontSize: 12,
                color: "var(--color-ink-3)",
              }}
            >
              {t("femme.listFilter.noMatches")}
            </div>
          )}
          {serviciosOrdenados.map((s, index) => {
            const ic = categoryAccentStyle(s.categoryAccentKey);
            const hk = `svc-${s.id}`;
            const isHov = hoveredCardKey === hk;
            const anterior = serviciosOrdenados[index - 1];
            const hayCambioDeEstado =
              index > 0 &&
              anterior.active === true &&
              s.active === false;
            return (
              <Fragment key={s.id}>
                {hayCambioDeEstado ? (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      margin: "16px 0 10px",
                    }}
                  >
                    <div
                      style={{
                        flex: 1,
                        height: "0.5px",
                        background: "var(--color-stone-md)",
                      }}
                    />
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 500,
                        letterSpacing: "0.07em",
                        textTransform: "uppercase",
                        color: "var(--color-ink-3)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {t("femme.services.services.separatorInactive")}
                    </span>
                    <div
                      style={{
                        flex: 1,
                        height: "0.5px",
                        background: "var(--color-stone-md)",
                      }}
                    />
                  </div>
                ) : null}
                {isEditingService(s.id) ? (
                  <div
                    style={{
                      background: "var(--color-rose-lt)",
                      border: "1.5px solid var(--color-rose-md)",
                      borderRadius: "var(--radius-lg)",
                      padding: "14px 16px",
                      marginBottom: 8,
                      display: "flex",
                      flexDirection: "column",
                      gap: 10,
                    }}
                  >
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                        gap: 8,
                      }}
                    >
                      <div>
                        <label style={labelStyle} htmlFor={`svc-inline-name-${s.id}`}>
                          {t("femme.services.services.name")}
                        </label>
                        <input
                          id={`svc-inline-name-${s.id}`}
                          value={String(serviceEditingData.name ?? "")}
                          onChange={(e) => updateServiceField("name", e.target.value)}
                          onKeyDown={keySaveCancelService}
                          style={inputEditStyle}
                        />
                      </div>
                      <div>
                        <label style={labelStyle} htmlFor={`svc-inline-cat-${s.id}`}>
                          {t("femme.services.services.category")}
                        </label>
                        <select
                          id={`svc-inline-cat-${s.id}`}
                          value={String(serviceEditingData.categoryId ?? "")}
                          onChange={(e) => onServiceCategoryInlineChange(Number(e.target.value))}
                          onKeyDown={keySaveCancelService}
                          style={inputEditStyle}
                        >
                          <option value="">{t("femme.services.services.categoryPlaceholder")}</option>
                          {inlineServiceCategoryOptions.map((c) => (
                            <option key={c.id} value={String(c.id)}>
                              {c.name}
                              {!c.active ? ` ${t("femme.services.categories.inactive")}` : ""}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label style={labelStyle} htmlFor={`svc-inline-dur-${s.id}`}>
                          {t("femme.services.services.duration")}
                        </label>
                        <input
                          id={`svc-inline-dur-${s.id}`}
                          type="number"
                          min={1}
                          step={1}
                          value={
                            serviceEditingData.durationMinutes === undefined ||
                            serviceEditingData.durationMinutes === null
                              ? ""
                              : String(serviceEditingData.durationMinutes)
                          }
                          onChange={(e) =>
                            updateServiceField("durationMinutes", Number(e.target.value))
                          }
                          onKeyDown={keySaveCancelService}
                          style={inputEditStyle}
                        />
                      </div>
                      <div>
                        <label style={labelStyle} htmlFor={`svc-inline-price-${s.id}`}>
                          {t("femme.services.services.price")}
                        </label>
                        <input
                          id={`svc-inline-price-${s.id}`}
                          type="number"
                          min={0}
                          step={1000}
                          inputMode="decimal"
                          value={
                            serviceEditingData.priceMinor === undefined ||
                            serviceEditingData.priceMinor === null
                              ? ""
                              : String(serviceEditingData.priceMinor)
                          }
                          onChange={(e) => {
                            const n = normalizeMoneyInput(e.target.value);
                            if (n != null) updateServiceField("priceMinor", n);
                          }}
                          onKeyDown={keySaveCancelService}
                          style={inputEditStyle}
                        />
                      </div>
                    </div>
                    <div style={{ display: "flex", justifyContent: "flex-end" }}>
                      <InlineEditActions
                        isEditing
                        saving={serviceInlineSaving}
                        saveError={serviceInlineSaveError}
                        onEdit={() => {}}
                        onSave={() => void saveServiceEdit()}
                        onCancel={cancelServiceEdit}
                      />
                    </div>
                  </div>
                ) : (
                  <div
                    className={`svc-card ${!s.active ? "card-inactive" : ""}`}
                    onMouseEnter={() => {
                      if (s.active) setHoveredCardKey(hk);
                    }}
                    onMouseLeave={() => {
                      if (s.active) setHoveredCardKey(null);
                    }}
                    style={
                      s.active
                        ? {
                            background: "var(--color-white)",
                            border: isHov
                              ? "0.5px solid var(--color-rose-md)"
                              : "var(--border-default)",
                            borderRadius: "var(--radius-lg)",
                            padding: "14px 16px",
                            display: "flex",
                            alignItems: "center",
                            gap: 12,
                            marginBottom: 8,
                            cursor: "pointer",
                            transition: "border-color 0.15s",
                          }
                        : {
                            borderRadius: "var(--radius-lg)",
                            padding: "14px 16px",
                            display: "flex",
                            alignItems: "center",
                            gap: 12,
                            marginBottom: 8,
                          }
                    }
                  >
                    <div
                      className="cat-ic card-icon"
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: "var(--radius-md)",
                        background: s.active ? ic.bg : "var(--color-stone-md)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      <div
                        style={{
                          width: 16,
                          height: 16,
                          borderRadius: 3,
                          background: s.active ? ic.color : "var(--color-stone-md)",
                        }}
                      />
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        className="card-name"
                        style={{
                          fontSize: 13,
                          fontWeight: 500,
                          color: "var(--color-ink)",
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        {highlightService(s.name)}
                      </div>
                      <div
                        className="card-meta"
                        style={{ fontSize: 11, color: "var(--color-ink-3)", marginTop: 1 }}
                      >
                        {highlightService(s.categoryName)} · {s.durationMinutes} min
                      </div>
                    </div>

                    <div
                      className="card-price"
                      style={{
                        marginLeft: "auto",
                        marginRight: 16,
                        fontSize: 14,
                        fontWeight: 500,
                        color: "var(--color-ink)",
                        whiteSpace: "nowrap",
                        flexShrink: 0,
                      }}
                    >
                      {fmtPrice(s.priceMinor)}
                    </div>

                    <div style={{ display: "flex", gap: 6, flexShrink: 0, alignItems: "center" }}>
                      <InlineEditActions
                        isEditing={false}
                        saving={false}
                        saveError={null}
                        onEdit={() => startServiceEdit(s)}
                        onSave={() => void saveServiceEdit()}
                        onCancel={cancelServiceEdit}
                        onDeactivate={
                          s.active ? () => requestDeactivateService(s) : undefined
                        }
                        onActivate={
                          !s.active
                            ? () => {
                                void activateSalonServiceFromList(s);
                              }
                            : undefined
                        }
                        isActive={s.active}
                        activateLabel={
                          activatingServiceId === s.id
                            ? t("femme.services.saving")
                            : t("femme.services.services.activateShort")
                        }
                        deactivateLabel={t("femme.services.services.deactivateShort")}
                        activateDisabled={activatingServiceId === s.id}
                      />
                    </div>
                  </div>
                )}
              </Fragment>
            );
          })}
        </div>
      )}

      {/* ── Categories tab ── */}
      {tab === "categories" && (
        <div>
          <div
            style={{
              display: "flex",
              gap: 8,
              marginBottom: 12,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <SearchInput
              id="categories-list-filter"
              value={categorySearchQuery}
              onChange={setCategorySearchQuery}
              placeholder={t("femme.services.categories.searchInlinePlaceholder")}
              resultCount={categoriesTextFiltered.length}
              totalCount={categories.length}
            />
          </div>
          {categories.length === 0 && (
            <div
              style={{
                padding: "20px 0",
                textAlign: "center",
                fontSize: 12,
                color: "var(--color-ink-3)",
              }}
            >
              {t("femme.services.categories.emptyBody")}
            </div>
          )}
          {categories.length > 0 && categoriesTextFiltered.length === 0 && (
            <div
              style={{
                padding: "20px 0",
                textAlign: "center",
                fontSize: 12,
                color: "var(--color-ink-3)",
              }}
            >
              {t("femme.listFilter.noMatches")}
            </div>
          )}
          {categoriesTextFiltered.length > 0 ? (
          <div className="min-w-0 overflow-x-auto">
            <table
              style={{
                width: "100%",
                borderCollapse: "separate",
                borderSpacing: "0 8px",
              }}
            >
              <tbody>
                {categoriasOrdenadas.map((c, index) => {
                  const ic = categoryAccentStyle(c.accentKey);
                  const icEditRow = isEditingCategory(c.id)
                    ? categoryAccentStyle(String(categoryEditingData.accentKey ?? c.accentKey))
                    : ic;
                  const anterior = categoriasOrdenadas[index - 1];
                  const hayCambioDeEstado =
                    index > 0 &&
                    anterior.active === true &&
                    c.active === false;
                  const svcCount = services.filter((s) => s.categoryId === c.id).length;
                  return (
                    <Fragment key={c.id}>
                      {hayCambioDeEstado ? (
                        <tr>
                          <td
                            colSpan={4}
                            style={{
                              padding: "6px 14px",
                              fontSize: 10,
                              fontWeight: 500,
                              letterSpacing: "0.06em",
                              textTransform: "uppercase",
                              color: "var(--color-ink-3)",
                              background: "var(--color-stone)",
                              borderBottom: "0.5px solid var(--color-stone-md)",
                            }}
                          >
                            {t("femme.services.categories.separatorInactive")}
                          </td>
                        </tr>
                      ) : null}
                      {isEditingCategory(c.id) ? (
                        <tr
                          key={`${c.id}-edit`}
                          style={{
                            background: "var(--color-rose-lt)",
                            outline: "1.5px solid var(--color-rose-md)",
                            outlineOffset: -1,
                          }}
                        >
                          <td style={{ padding: "8px 12px", verticalAlign: "middle", width: 52 }}>
                            <div
                              className="cat-ic cell-icon"
                              style={{
                                width: 36,
                                height: 36,
                                borderRadius: "var(--radius-md)",
                                background: icEditRow.bg,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                flexShrink: 0,
                              }}
                            >
                              <div
                                style={{
                                  width: 16,
                                  height: 16,
                                  borderRadius: 3,
                                  background: icEditRow.color,
                                }}
                              />
                            </div>
                          </td>
                          <td style={{ padding: "8px 12px", verticalAlign: "middle", minWidth: 0 }}>
                            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                              <div>
                                <label style={labelStyle} htmlFor={`cat-inline-name-${c.id}`}>
                                  {t("femme.services.categories.name")}
                                </label>
                                <input
                                  id={`cat-inline-name-${c.id}`}
                                  value={String(categoryEditingData.name ?? "")}
                                  onChange={(e) => updateCategoryField("name", e.target.value)}
                                  onKeyDown={keySaveCancelCategory}
                                  style={categoryInputEditStyle}
                                />
                              </div>
                              <div>
                                <label style={labelStyle} htmlFor={`cat-inline-accent-${c.id}`}>
                                  {t("femme.services.categories.accent.label")}
                                </label>
                                <select
                                  id={`cat-inline-accent-${c.id}`}
                                  value={
                                    CATEGORY_ACCENT_KEYS.includes(
                                      String(categoryEditingData.accentKey) as CategoryAccentKey,
                                    )
                                      ? String(categoryEditingData.accentKey)
                                      : "stone"
                                  }
                                  onChange={(e) =>
                                    updateCategoryField(
                                      "accentKey",
                                      e.target.value as ServiceCategory["accentKey"],
                                    )
                                  }
                                  onKeyDown={keySaveCancelCategory}
                                  style={categoryInputEditStyle}
                                >
                                  {CATEGORY_ACCENT_KEYS.map((key) => (
                                    <option key={key} value={key}>
                                      {t(`femme.services.categories.accent.${key}`)}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            </div>
                          </td>
                          <td
                            style={{
                              padding: "8px 12px",
                              verticalAlign: "middle",
                              whiteSpace: "nowrap",
                            }}
                          >
                            <span className={c.active ? "badge b-ok" : "badge b-neu"}>
                              {c.active
                                ? t("femme.services.categories.statusBadgeActive")
                                : t("femme.services.categories.statusBadgeInactive")}
                            </span>
                          </td>
                          <td
                            style={{
                              padding: "8px 12px",
                              verticalAlign: "middle",
                              textAlign: "right",
                            }}
                          >
                            <InlineEditActions
                              isEditing
                              saving={categoryInlineSaving}
                              saveError={categoryInlineSaveError}
                              onEdit={() => {}}
                              onSave={() => void saveCategoryEdit()}
                              onCancel={cancelCategoryEdit}
                            />
                          </td>
                        </tr>
                      ) : (
                        <tr
                          className={!c.active ? "row-inactive row-inactive-bg" : ""}
                          style={
                            c.active
                              ? {
                                  background: "var(--color-white)",
                                  border: "var(--border-default)",
                                  borderRadius: "var(--radius-lg)",
                                }
                              : undefined
                          }
                        >
                          <td style={{ padding: "14px 16px", verticalAlign: "middle", width: 52 }}>
                            <div
                              className="cat-ic cell-icon"
                              style={{
                                width: 36,
                                height: 36,
                                borderRadius: "var(--radius-md)",
                                background: c.active ? ic.bg : "var(--color-stone-md)",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                flexShrink: 0,
                              }}
                            >
                              <div
                                style={{
                                  width: 16,
                                  height: 16,
                                  borderRadius: 3,
                                  background: c.active ? ic.color : "var(--color-stone-md)",
                                }}
                              />
                            </div>
                          </td>
                          <td style={{ padding: "14px 16px", verticalAlign: "middle", minWidth: 0 }}>
                            <div
                              className="cell-name"
                              style={{
                                fontSize: 13,
                                fontWeight: 500,
                                color: "var(--color-ink)",
                              }}
                            >
                              {highlightCategory(c.name)}
                            </div>
                            <div
                              className="cell-meta"
                              style={{ fontSize: 11, marginTop: 4, color: "var(--color-ink-3)" }}
                            >
                              {t("femme.services.categories.serviceCount", { count: svcCount })}
                            </div>
                          </td>
                          <td
                            style={{
                              padding: "14px 16px",
                              verticalAlign: "middle",
                              whiteSpace: "nowrap",
                            }}
                          >
                            <span className={c.active ? "badge b-ok" : "badge b-neu"}>
                              {c.active
                                ? t("femme.services.categories.statusBadgeActive")
                                : t("femme.services.categories.statusBadgeInactive")}
                            </span>
                          </td>
                          <td
                            style={{
                              padding: "14px 16px",
                              verticalAlign: "middle",
                              textAlign: "right",
                            }}
                          >
                            <InlineEditActions
                              isEditing={false}
                              saving={false}
                              saveError={null}
                              onEdit={() => startCategoryEdit(c)}
                              onSave={() => void saveCategoryEdit()}
                              onCancel={cancelCategoryEdit}
                              onDeactivate={
                                c.active ? () => requestDeactivateCategory(c) : undefined
                              }
                              onActivate={
                                !c.active
                                  ? () => {
                                      void activateCategoryFromList(c);
                                    }
                                  : undefined
                              }
                              isActive={c.active}
                              activateLabel={
                                activatingCategoryId === c.id
                                  ? t("femme.services.saving")
                                  : t("femme.services.categories.activateShort")
                              }
                              deactivateLabel={t("femme.services.categories.deactivateShort")}
                              activateDisabled={activatingCategoryId === c.id}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          ) : null}
        </div>
      )}

      <Modal
        open={categoryModalOpen}
        onClose={() => setCategoryModalOpen(false)}
        title={
          categoryEditing
            ? t("femme.services.categories.editTitle")
            : t("femme.services.categories.addTitle")
        }
      >
        <div className="flex flex-col gap-4">
          {categorySaveError ? (
            <Alert variant="destructive" title={t("femme.services.errorTitle")}>
              {categorySaveError}
            </Alert>
          ) : null}
          <div>
            <Label htmlFor="cat-name">{t("femme.services.categories.name")}</Label>
            <Input
              id="cat-name"
              value={categoryName}
              onChange={(e) => setCategoryName(e.target.value)}
              aria-invalid={categoryNameError ? "true" : "false"}
              aria-describedby={categoryNameError ? "cat-name-err" : undefined}
            />
            <FieldValidationError id="cat-name-err">{categoryNameError}</FieldValidationError>
          </div>
          <fieldset className="min-w-0 border-0 p-0">
            <legend
              className="mb-2 text-sm font-medium"
              style={{ color: "var(--color-ink)" }}
            >
              {t("femme.services.categories.accent.label")}
            </legend>
            <div
              className="flex flex-wrap gap-2"
              role="group"
              aria-label={t("femme.services.categories.accent.groupLabel")}
            >
              {CATEGORY_ACCENT_KEYS.map((key) => {
                const sw = categoryAccentStyle(key);
                const selected = categoryAccentKey === key;
                return (
                  <button
                    key={key}
                    type="button"
                    className="flex min-h-11 min-w-11 items-center justify-center rounded-md border-2 p-1 transition-colors"
                    style={{
                      borderColor: selected ? "var(--color-rose-md)" : "var(--color-stone-md)",
                      background: "var(--color-white)",
                    }}
                    aria-pressed={selected}
                    aria-label={t(`femme.services.categories.accent.${key}`)}
                    onClick={() => setCategoryAccentKey(key)}
                  >
                    <span
                      className="block size-8 rounded-sm"
                      style={{
                        background: sw.bg,
                        boxShadow: "inset 0 0 0 0.5px var(--color-stone-md)",
                      }}
                    />
                  </button>
                );
              })}
            </div>
          </fieldset>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={() => setCategoryModalOpen(false)} className="min-h-11">
              {t("femme.services.cancel")}
            </Button>
            <Button type="button" onClick={saveCategory} disabled={categorySaving} className="min-h-11">
              {categorySaving ? t("femme.services.saving") : t("femme.services.save")}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={serviceModalOpen}
        onClose={() => setServiceModalOpen(false)}
        title={
          serviceEditing
            ? t("femme.services.services.editTitle")
            : t("femme.services.services.addTitle")
        }
      >
        <div className="flex flex-col gap-4">
          {serviceSaveError ? (
            <Alert variant="destructive" title={t("femme.services.errorTitle")}>
              {serviceSaveError}
            </Alert>
          ) : null}

          {serviceEditing ? (
            <div className="flex flex-col gap-2 rounded-md border border-[rgb(var(--color-border))] bg-[rgb(var(--color-muted))]/30 p-3 dark:bg-[rgb(var(--color-muted))]/20">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-[rgb(var(--color-muted-foreground))]">
                  {t("femme.services.services.statusLabel")}
                </span>
                <StatusBadge status={serviceEditing.active ? "ACTIVE" : "INACTIVE"} />
              </div>
              {!serviceEditing.active ? (
                <>
                  <Text variant="muted" className="text-sm">
                    {t("femme.services.services.inactiveHint")}
                  </Text>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-fit min-h-11 border-[rgb(var(--color-success))] text-[rgb(var(--color-success))] hover:bg-[rgb(var(--color-success))]/10"
                    disabled={serviceReactivating}
                    onClick={() => void activateSalonServiceFromModal()}
                  >
                    {serviceReactivating
                      ? t("femme.services.saving")
                      : t("femme.services.services.activate")}
                  </Button>
                </>
              ) : null}
            </div>
          ) : null}

          <div>
            <Label htmlFor="svc-name">{t("femme.services.services.name")}</Label>
            <Input
              id="svc-name"
              value={serviceName}
              onChange={(e) => setServiceName(e.target.value)}
              aria-invalid={serviceFieldError?.name ? "true" : "false"}
              aria-describedby={serviceFieldError?.name ? "svc-name-err" : undefined}
            />
            <FieldValidationError id="svc-name-err">{serviceFieldError?.name}</FieldValidationError>
          </div>

          <div>
            <Label htmlFor="svc-cat">{t("femme.services.services.category")}</Label>
            <Select
              id="svc-cat"
              value={serviceCategoryId}
              onChange={(e) => setServiceCategoryId(e.target.value)}
              aria-invalid={serviceFieldError?.categoryId ? "true" : "false"}
              aria-describedby={serviceFieldError?.categoryId ? "svc-cat-err" : undefined}
            >
              <option value="">{t("femme.services.services.categoryPlaceholder")}</option>
              {serviceCategorySelectOptions.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.name}
                  {!c.active ? ` ${t("femme.services.categories.inactive")}` : ""}
                </option>
              ))}
            </Select>
            <FieldValidationError id="svc-cat-err">{serviceFieldError?.categoryId}</FieldValidationError>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="svc-price">{t("femme.services.services.price")}</Label>
              <Input
                id="svc-price"
                inputMode="decimal"
                value={servicePrice}
                onChange={(e) => setServicePrice(e.target.value)}
                aria-invalid={serviceFieldError?.price ? "true" : "false"}
                aria-describedby={serviceFieldError?.price ? "svc-price-err" : undefined}
              />
              <FieldValidationError id="svc-price-err">{serviceFieldError?.price}</FieldValidationError>
            </div>
            <div>
              <Label htmlFor="svc-duration">{t("femme.services.services.duration")}</Label>
              <Input
                id="svc-duration"
                inputMode="numeric"
                value={serviceDuration}
                onChange={(e) => setServiceDuration(e.target.value)}
                aria-invalid={serviceFieldError?.duration ? "true" : "false"}
                aria-describedby={serviceFieldError?.duration ? "svc-duration-err" : undefined}
              />
              <FieldValidationError id="svc-duration-err">{serviceFieldError?.duration}</FieldValidationError>
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={() => setServiceModalOpen(false)} className="min-h-11">
              {t("femme.services.cancel")}
            </Button>
            <Button type="button" onClick={saveService} disabled={serviceSaving} className="min-h-11">
              {serviceSaving ? t("femme.services.saving") : t("femme.services.save")}
            </Button>
          </div>
        </div>
      </Modal>

      {deactivateTarget ? (
        <ConfirmDialog
          open
          title={t(
            deactivateTarget.kind === "category"
              ? "femme.services.categories.deactivateDialogTitle"
              : "femme.services.services.deactivateDialogTitle",
          )}
          description={t(
            deactivateTarget.kind === "category"
              ? "femme.services.categories.deactivateDialogDescription"
              : "femme.services.services.deactivateDialogDescription",
            { name: deactivateTarget.item.name },
          )}
          cancelLabel={t("femme.services.cancel")}
          confirmLabel={t(
            deactivateTarget.kind === "category"
              ? "femme.services.categories.deactivate"
              : "femme.services.services.deactivate",
          )}
          onCancel={() => setDeactivateTarget(null)}
          onConfirm={() => void confirmDeactivateTarget()}
        />
      ) : null}
    </div>
  );
}

