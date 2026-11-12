import { useTranslation } from "react-i18next";
import { FlowbitLogo } from "@design-system";

/**
 * Brand block for the pre-login screens (login, forgot/reset password, activation), which sit on the
 * full-bleed teal background (`.fb-auth-bg`). The slogan is allowed only on large pieces like this.
 * `tenantName` is shown under the logo when the page already knows the salon (activation link).
 */
export function AuthBrandHeader({ tenantName }: { tenantName?: string | null }) {
  const { t } = useTranslation();
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <FlowbitLogo tone="dark" className="h-10 w-auto self-start" />
      <span
        data-testid="auth-slogan"
        className="text-sm font-semibold text-[rgb(var(--fb-lino))] opacity-90"
      >
        {t("femme.brand.slogan")}
      </span>
      {tenantName ? (
        <span
          data-testid="auth-tenant-name"
          className="truncate text-sm font-bold text-[rgb(var(--fb-lino))]"
        >
          {tenantName}
        </span>
      ) : null}
    </div>
  );
}
