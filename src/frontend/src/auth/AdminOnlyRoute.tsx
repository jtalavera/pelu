import { Navigate, Outlet } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Spinner } from "@design-system";
import { useMe } from "../hooks/useMe";

/**
 * HU-24 AC-12/13: guards the salon's administrative screens. A `PROFESSIONAL` who reaches one by
 * URL is sent to her calendar (the backend answers 403 on those APIs anyway). Every other role
 * passes through; authentication itself is `ProtectedRoute`'s job.
 */
export function AdminOnlyRoute() {
  const { t } = useTranslation();
  const { me, loading } = useMe();

  if (loading) {
    return (
      <div className="flex justify-center p-8">
        <Spinner label={t("femme.platform.loading")} />
      </div>
    );
  }

  if (me?.role === "PROFESSIONAL") {
    return <Navigate to="/app/calendar" replace />;
  }

  return <Outlet />;
}
