import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
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

// ── Helpers ────────────────────────────────────────────────────────────────
function fmtPrice(minor: string | number): string {
  const n = Number(minor);
  if (!Number.isFinite(n)) return "Gs. —";
  return "Gs. " + Math.round(n).toLocaleString("es-PY");
}

function categoryIconStyle(name: string): { bg: string; color: string } {
  const n = name.toLowerCase();
  if (n.includes("corte"))
    return { bg: "var(--color-rose-lt)", color: "var(--color-rose)" };
  if (n.includes("manos") || n.includes("pies") || n.includes("manicura"))
    return { bg: "var(--color-mauve-lt)", color: "var(--color-mauve)" };
  if (n.includes("color") || n.includes("tratamiento"))
    return { bg: "var(--color-success-lt)", color: "var(--color-success)" };
  return { bg: "var(--color-stone)", color: "var(--color-ink-3)" };
}

function SearchIcon() {
  return (
    <svg
      style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}
      width={13} height={13} viewBox="0 0 16 16" fill="none"
    >
      <circle cx="7" cy="7" r="5" stroke="var(--color-ink-3)" strokeWidth="1.5" />
      <path d="M11 11l3 3" stroke="var(--color-ink-3)" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

type ServiceCategory = { id: number; name: string; active: boolean };
type SalonService = {
  id: number;
  categoryId: number;
  categoryName: string;
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
  const [tab, setTab] = useState<"services" | "categories">("services");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [services, setServices] = useState<SalonService[]>([]);

  const [q, setQ] = useState("");
  const [categoryFilterId, setCategoryFilterId] = useState<string>("all");

  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [categoryEditing, setCategoryEditing] = useState<ServiceCategory | null>(null);
  const [categoryName, setCategoryName] = useState("");
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

  const [deactivateTarget, setDeactivateTarget] = useState<ServicesDeactivateTarget>(null);
  const [hoveredCardKey, setHoveredCardKey] = useState<string | null>(null);

  const activeCategories = useMemo(() => categories.filter((c) => c.active), [categories]);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const runSearch = useCallback(async (searchQ: string, catId: string) => {
    try {
      const qs = new URLSearchParams();
      if (searchQ.trim()) qs.set("q", searchQ.trim());
      if (catId !== "all") qs.set("categoryId", catId);
      const res = await femmeJson<SalonService[]>(`/api/services?${qs.toString()}`);
      setServices(Array.isArray(res) ? res : []);
    } catch {
      setError(t("femme.services.loadError"));
    }
  }, [t]);

  async function onSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    await runSearch(q, categoryFilterId);
  }

  function handleQChange(value: string) {
    setQ(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void runSearch(value, categoryFilterId), 350);
  }

  function handleCategoryPill(val: string) {
    setCategoryFilterId(val);
    void runSearch(q, val);
  }

  function openNewCategory() {
    setCategoryEditing(null);
    setCategoryName("");
    setCategoryNameError(null);
    setCategorySaveError(null);
    setCategoryModalOpen(true);
  }

  function openEditCategory(c: ServiceCategory) {
    setCategoryEditing(c);
    setCategoryName(c.name);
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
      if (categoryEditing) {
        await femmePutJson<ServiceCategory>(
          `/api/service-categories/${categoryEditing.id}`,
          { name: categoryName.trim() },
        );
      } else {
        await femmePostJson<ServiceCategory>("/api/service-categories", { name: categoryName.trim() });
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

  function openEditService(s: SalonService) {
    setServiceEditing(s);
    setServiceName(s.name);
    setServiceCategoryId(String(s.categoryId));
    setServicePrice(String(s.priceMinor));
    setServiceDuration(String(s.durationMinutes));
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
      await onSearchSubmit(new Event("submit") as unknown as React.FormEvent);
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
        await onSearchSubmit(new Event("submit") as unknown as React.FormEvent);
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

  const editBtnStyle: React.CSSProperties = {
    padding: "4px 10px",
    borderRadius: "var(--radius-sm)",
    fontSize: 11,
    border: "0.5px solid var(--color-rose-md)",
    background: "transparent",
    color: "var(--color-rose)",
    cursor: "pointer",
    whiteSpace: "nowrap",
  };

  const deactBtnStyle: React.CSSProperties = {
    padding: "4px 10px",
    borderRadius: "var(--radius-sm)",
    fontSize: 11,
    border: "none",
    background: "transparent",
    color: "var(--color-danger)",
    cursor: "pointer",
    whiteSpace: "nowrap",
  };

  const searchInputStyle: React.CSSProperties = {
    width: "100%",
    padding: "7px 10px 7px 30px",
    border: "var(--border-default)",
    borderRadius: "var(--radius-md)",
    fontSize: 12,
    background: "var(--color-stone)",
    color: "var(--color-ink)",
    outline: "none",
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
          <button type="button" style={primaryBtn} onClick={openNewCategory}>
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
        <div>
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
            <div style={{ position: "relative", flex: 1, maxWidth: 280, minWidth: 160 }}>
              <SearchIcon />
              <input
                value={q}
                onChange={(e) => handleQChange(e.target.value)}
                placeholder={t("femme.services.search.placeholder")}
                style={searchInputStyle}
              />
            </div>
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
          {services.map((s) => {
            const ic = categoryIconStyle(s.categoryName);
            const hk = `svc-${s.id}`;
            const isHov = hoveredCardKey === hk;
            return (
              <div
                key={s.id}
                onMouseEnter={() => setHoveredCardKey(hk)}
                onMouseLeave={() => setHoveredCardKey(null)}
                style={{
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
                }}
              >
                {/* Category icon */}
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: "var(--radius-md)",
                    background: ic.bg,
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
                      background: ic.color,
                    }}
                  />
                </div>

                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 500,
                      color: "var(--color-ink)",
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    {s.name}
                    {!s.active && (
                      <span style={{ fontSize: 10, color: "var(--color-ink-3)", fontWeight: 400 }}>
                        {t("femme.services.services.inactive")}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--color-ink-3)", marginTop: 1 }}>
                    {s.categoryName} · {s.durationMinutes} min
                  </div>
                </div>

                {/* Price */}
                <div
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

                {/* Actions */}
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  <button
                    type="button"
                    style={editBtnStyle}
                    onClick={(e) => { e.stopPropagation(); openEditService(s); }}
                  >
                    {t("femme.services.services.edit")}
                  </button>
                  {s.active && (
                    <button
                      type="button"
                      style={deactBtnStyle}
                      onClick={(e) => { e.stopPropagation(); requestDeactivateService(s); }}
                    >
                      {t("femme.services.services.deactivateShort")}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Categories tab ── */}
      {tab === "categories" && (
        <div>
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
          {categories.map((c) => {
            const ic = categoryIconStyle(c.name);
            const hk = `cat-${c.id}`;
            const isHov = hoveredCardKey === hk;
            return (
              <div
                key={c.id}
                onMouseEnter={() => setHoveredCardKey(hk)}
                onMouseLeave={() => setHoveredCardKey(null)}
                style={{
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
                }}
              >
                {/* Category icon */}
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: "var(--radius-md)",
                    background: ic.bg,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <div
                    style={{ width: 16, height: 16, borderRadius: 3, background: ic.color }}
                  />
                </div>

                {/* Name */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 500,
                      color: "var(--color-ink)",
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    {c.name}
                    {!c.active && (
                      <span style={{ fontSize: 10, color: "var(--color-ink-3)", fontWeight: 400 }}>
                        {t("femme.services.categories.inactive")}
                      </span>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  <button
                    type="button"
                    style={editBtnStyle}
                    onClick={(e) => { e.stopPropagation(); openEditCategory(c); }}
                  >
                    {t("femme.services.categories.edit")}
                  </button>
                  {c.active && (
                    <button
                      type="button"
                      style={deactBtnStyle}
                      onClick={(e) => { e.stopPropagation(); requestDeactivateCategory(c); }}
                    >
                      {t("femme.services.categories.deactivateShort")}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
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
              {activeCategories.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.name}
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

