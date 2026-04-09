import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Button,
  Card,
  Heading,
  Input,
  Label,
  Modal,
  Select,
  Spinner,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Text,
} from "@design-system";
import { femmeJson, femmePostJson, femmePutJson } from "../api/femmeClient";
import { translateApiError } from "../api/parseApiErrorMessage";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { FieldValidationError } from "../components/FieldValidationError";

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

  const activeCategories = useMemo(() => categories.filter((c) => c.active), [categories]);

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

  async function onSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      const qs = new URLSearchParams();
      if (q.trim()) qs.set("q", q.trim());
      if (categoryFilterId !== "all") qs.set("categoryId", categoryFilterId);
      const res = await femmeJson<SalonService[]>(`/api/services?${qs.toString()}`);
      setServices(Array.isArray(res) ? res : []);
    } catch {
      setError(t("femme.services.loadError"));
    }
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
      <div className="flex min-h-[40vh] items-center justify-center gap-3">
        <Spinner size="lg" />
        <Text>{t("femme.services.loading")}</Text>
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive" title={t("femme.services.errorTitle")}>
        {error}
      </Alert>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <Heading as="h1">{t("femme.services.title")}</Heading>
          <Text variant="muted" className="mt-1">
            {t("femme.services.lead")}
          </Text>
        </div>
        {tab === "services" ? (
          <Button type="button" onClick={openNewService} className="w-full sm:w-auto">
            {t("femme.services.services.add")}
          </Button>
        ) : (
          <Button type="button" onClick={openNewCategory} className="w-full sm:w-auto">
            {t("femme.services.categories.add")}
          </Button>
        )}
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="services">{t("femme.services.tabs.services")}</TabsTrigger>
          <TabsTrigger value="categories">{t("femme.services.tabs.categories")}</TabsTrigger>
        </TabsList>

        <TabsContent value="services" className="mt-4">
          <Card className="p-4">
            <form onSubmit={onSearchSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1 min-w-0">
                <Label htmlFor="svc-q">{t("femme.services.search.label")}</Label>
                <Input
                  id="svc-q"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={t("femme.services.search.placeholder")}
                />
              </div>
              <div className="sm:w-64">
                <Label htmlFor="svc-category">{t("femme.services.filter.label")}</Label>
                <Select
                  id="svc-category"
                  value={categoryFilterId}
                  onChange={(e) => setCategoryFilterId(e.target.value)}
                >
                  {filterOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </div>
              <Button type="submit" className="w-full sm:w-auto">
                {t("femme.services.search.submit")}
              </Button>
            </form>
          </Card>

          <div className="mt-4 flex flex-col gap-3">
            {services.length === 0 ? (
              <Alert variant="default" title={t("femme.services.services.emptyTitle")}>
                {t("femme.services.services.emptyBody")}
              </Alert>
            ) : null}
            {services.map((s) => (
              <Card key={s.id} className="p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <Heading as="h2" className="text-lg">
                      {s.name}{" "}
                      {!s.active ? (
                        <span className="text-sm font-medium text-[rgb(var(--color-muted-foreground))]">
                          {t("femme.services.services.inactive")}
                        </span>
                      ) : null}
                    </Heading>
                    <Text variant="muted" className="mt-1">
                      {t("femme.services.services.meta", {
                        category: s.categoryName,
                        duration: s.durationMinutes,
                        price: String(s.priceMinor),
                      })}
                    </Text>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Button type="button" variant="secondary" onClick={() => openEditService(s)} className="min-h-11">
                      {t("femme.services.services.edit")}
                    </Button>
                    {s.active ? (
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => requestDeactivateService(s)}
                        className="min-h-11"
                      >
                        {t("femme.services.services.deactivate")}
                      </Button>
                    ) : null}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="categories" className="mt-4">
          <div className="flex flex-col gap-3">
            {categories.length === 0 ? (
              <Alert variant="default" title={t("femme.services.categories.emptyTitle")}>
                {t("femme.services.categories.emptyBody")}
              </Alert>
            ) : null}
            {categories.map((c) => (
              <Card key={c.id} className="p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <Heading as="h2" className="text-lg">
                      {c.name}{" "}
                      {!c.active ? (
                        <span className="text-sm font-medium text-[rgb(var(--color-muted-foreground))]">
                          {t("femme.services.categories.inactive")}
                        </span>
                      ) : null}
                    </Heading>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Button type="button" variant="secondary" onClick={() => openEditCategory(c)} className="min-h-11">
                      {t("femme.services.categories.edit")}
                    </Button>
                    {c.active ? (
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => requestDeactivateCategory(c)}
                        className="min-h-11"
                      >
                        {t("femme.services.categories.deactivate")}
                      </Button>
                    ) : null}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>

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

