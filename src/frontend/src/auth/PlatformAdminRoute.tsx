import { Navigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Spinner, Text } from "@design-system";
import { useMe } from "../hooks/useMe";

type Props = { children: React.ReactNode };

/**
 * HU-35 AC-4: guards the `/platform/**` area — only a `PLATFORM_ADMIN` may reach it. Any other
 * role that navigates there directly by URL is redirected out to their own area; an unauthenticated
 * visitor is sent to `/login` (preserving the return path, like `ProtectedRoute`).
 */
export function PlatformAdminRoute({ children }: Props) {
  const { t } = useTranslation();
  const location = useLocation();
  const { me, loading } = useMe();

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-2 bg-slate-50 p-4 dark:bg-slate-950">
        <Spinner size="lg" label={t("femme.platform.loading")} />
        <Text variant="muted">{t("femme.platform.loading")}</Text>
      </div>
    );
  }

  if (!me) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (me.role !== "PLATFORM_ADMIN") {
    return <Navigate to="/app" replace />;
  }

  return <>{children}</>;
}
