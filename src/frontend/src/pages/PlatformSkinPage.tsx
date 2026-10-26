import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, FlowbitLogo, Heading, Text } from "@design-system";
import { translateApiError } from "../api/parseApiErrorMessage";
import {
  TENANT_SKINS,
  updateTenantSkin,
  type PlatformTenant,
  type TenantSkin,
} from "../api/platformTenants";
import { TenantSearchField, type TenantSelection } from "../components/TenantSearchField";

/** Accent hex per skin (mirror of styles/skins.css; shown to the Platform Admin as a hint). */
const ACCENT_HEX: Record<TenantSkin, string> = {
  DURAZNO: "#F3C6AE",
  CELESTE: "#C9D9E6",
  ROSA: "#F1AFC2",
};

/**
 * "Skin": the Platform Admin picks the accent that dresses a tenant's interface according to its
 * type of salon (brand manual, "Variación en Interfaces"). Lives under `/platform/skin`, inside
 * `PlatformShell`. The three variations are always shown as live previews — each one inside its own
 * `data-skin` container, so the same CSS variables the real app uses repaint the logo and the
 * accent details — and saving needs a tenant to be chosen first.
 */
export default function PlatformSkinPage() {
  const { t } = useTranslation();
  const [selection, setSelection] = useState<TenantSelection>(null);
  const [chosen, setChosen] = useState<TenantSkin | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedFor, setSavedFor] = useState<PlatformTenant | null>(null);
  const [error, setError] = useState<string | null>(null);

  const tenant = selection?.tenant ?? null;
  const effectiveSkin: TenantSkin | null = chosen ?? tenant?.skin ?? null;
  const dirty = tenant != null && effectiveSkin != null && effectiveSkin !== tenant.skin;

  function onTenantChange(next: TenantSelection) {
    setSelection(next);
    setChosen(null);
    setSavedFor(null);
    setError(null);
  }

  async function save() {
    if (!tenant || !effectiveSkin) return;
    setSaving(true);
    setError(null);
    setSavedFor(null);
    try {
      const updated = await updateTenantSkin(tenant.id, effectiveSkin);
      setSelection({ tenant: updated });
      setChosen(null);
      setSavedFor(updated);
    } catch (e) {
      setError(translateApiError(e, t, "femme.platform.skin.loadError"));
    } finally {
      setSaving(false);
    }
  }

  const skinName = (skin: TenantSkin) => t(`femme.platform.skin.options.${skin}.name`);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5" data-testid="platform-skin-page">
      <div>
        <Heading as="h1">{t("femme.platform.skin.title")}</Heading>
        <Text variant="muted" className="mt-1 max-w-3xl">
          {t("femme.platform.skin.lead")}
        </Text>
      </div>

      <div className="max-w-md">
        <TenantSearchField
          value={selection}
          onChange={onTenantChange}
          id="platform-skin-tenant"
          label={t("femme.platform.skin.tenantLabel")}
          placeholder={t("femme.platform.skin.tenantPlaceholder")}
        />
      </div>

      {tenant ? (
        <Text variant="body" data-testid="platform-skin-current">
          {t("femme.platform.skin.currentSkin", {
            name: tenant.name,
            skin: skinName(tenant.skin),
          })}
        </Text>
      ) : (
        <Text variant="muted" data-testid="platform-skin-select-first">
          {t("femme.platform.skin.selectTenantFirst")}
        </Text>
      )}

      {error ? (
        <Alert variant="destructive" data-testid="platform-skin-error">
          {error}
        </Alert>
      ) : null}
      {savedFor ? (
        <Alert variant="success" data-testid="platform-skin-saved">
          {t("femme.platform.skin.saved", { name: savedFor.name })}
        </Alert>
      ) : null}

      <fieldset className="m-0 border-0 p-0">
        <legend className="sr-only">{t("femme.platform.skin.optionsLegend")}</legend>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {TENANT_SKINS.map((skin) => {
            const selected = effectiveSkin === skin;
            const inputId = `platform-skin-option-${skin}`;
            return (
              <label
                key={skin}
                htmlFor={inputId}
                data-testid={`platform-skin-card-${skin}`}
                className={
                  "flex min-w-0 cursor-pointer flex-col gap-3 rounded-card border bg-surface p-4 transition-colors " +
                  (selected
                    ? "border-primary ring-2 ring-primary/30"
                    : "border-line hover:border-primary-md")
                }
              >
                <span className="flex items-start gap-3">
                  <input
                    id={inputId}
                    type="radio"
                    name="platform-skin"
                    value={skin}
                    checked={selected}
                    disabled={!tenant}
                    onChange={() => setChosen(skin)}
                    className="mt-1 size-4 shrink-0 accent-[rgb(var(--fb-primary))]"
                  />
                  <span className="min-w-0">
                    <span className="block font-heading text-base font-bold text-ink">
                      {skinName(skin)}
                    </span>
                    <span className="block text-xs text-ink-3">
                      {t(`femme.platform.skin.options.${skin}.hint`)}
                    </span>
                  </span>
                </span>

                {/* Live preview: the same variables as the real app, scoped to this container. */}
                <span
                  data-skin={skin.toLowerCase()}
                  data-testid={`platform-skin-preview-${skin}`}
                  className="block overflow-hidden rounded-xl border border-line"
                >
                  <span
                    className="flex h-12 items-center justify-between gap-2 px-3"
                    style={{ background: "var(--topbar-bg)" }}
                  >
                    <FlowbitLogo tone="dark" className="h-5 w-auto" />
                    <span
                      aria-label={t("femme.platform.skin.previewAvatar")}
                      className="flex size-7 items-center justify-center rounded-full bg-accent text-[10px] font-bold text-accent-fg"
                    >
                      FB
                    </span>
                  </span>
                  <span className="flex items-center gap-2 bg-surface p-3">
                    <span
                      aria-hidden
                      className="size-6 shrink-0 rounded-full bg-accent"
                      data-testid={`platform-skin-swatch-${skin}`}
                    />
                    <span className="min-w-0 truncate text-xs font-semibold text-ink-2">
                      {t("femme.platform.skin.accentLabel", { hex: ACCENT_HEX[skin] })}
                    </span>
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          data-testid="platform-skin-save"
          disabled={!dirty || saving}
          onClick={() => void save()}
        >
          {saving ? t("femme.platform.skin.saving") : t("femme.platform.skin.save")}
        </Button>
        {tenant ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => onTenantChange(null)}
            data-testid="platform-skin-change-tenant"
          >
            {t("femme.platform.skin.changeTenant")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
