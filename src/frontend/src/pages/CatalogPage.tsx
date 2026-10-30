import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { Heading } from "@design-system";
import CatalogItemsPage from "./CatalogItemsPage";
import ProfessionalsPage from "./ProfessionalsPage";

export type CatalogView = "services" | "products" | "professionals";

const VIEWS: CatalogView[] = ["services", "products", "professionals"];

function parseView(raw: string | null): CatalogView {
  return VIEWS.includes(raw as CatalogView) ? (raw as CatalogView) : "services";
}

/**
 * Catalog redesign: Servicios, Productos and Profesionales share one screen. The view lives in the
 * `?view=` query param so the old routes (`/app/services`, …) can redirect straight to it. Only the
 * active view is mounted, and it renders its "+ New" / "⋯" actions into the header slot below.
 */
export default function CatalogPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const view = parseView(params.get("view"));
  const [actionsSlot, setActionsSlot] = useState<HTMLElement | null>(null);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <div data-tour="catalog-header" className="flex flex-wrap items-center justify-between gap-3">
        <Heading as="h1" className="text-2xl">
          {t("femme.catalog.title")}
        </Heading>
        <div ref={setActionsSlot} className="flex items-center gap-2" data-testid="catalog-actions" />
      </div>

      <div
        role="tablist"
        aria-label={t("femme.catalog.viewsLabel")}
        data-tour="catalog-views"
        className="grid grid-cols-3 gap-1 rounded-2xl bg-primary-lt p-1"
      >
        {VIEWS.map((v) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={view === v}
            data-testid={`catalog-view-${v}`}
            onClick={() => setParams({ view: v }, { replace: true })}
            className={`min-h-11 rounded-xl text-sm font-bold ${
              view === v ? "bg-surface text-primary shadow" : "text-ink-2"
            }`}
          >
            {t(`femme.catalog.views.${v}`)}
          </button>
        ))}
      </div>

      {view === "services" && <CatalogItemsPage key="services" kind="SERVICE" actionsSlot={actionsSlot} />}
      {view === "products" && <CatalogItemsPage key="products" kind="PRODUCT" actionsSlot={actionsSlot} />}
      {view === "professionals" && <ProfessionalsPage key="professionals" actionsSlot={actionsSlot} />}
    </div>
  );
}
