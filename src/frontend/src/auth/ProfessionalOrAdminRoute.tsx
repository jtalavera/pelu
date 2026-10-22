import type { ReactNode } from "react";
import { Navigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Spinner } from "@design-system";
import { useMe } from "../hooks/useMe";

/**
 * HU-68 AC9: one URL, two screens — the admin's full client screens, or the professional's
 * restricted ones (names + technical sheet only; the backend enforces the same split).
 */
export function ProfessionalOrAdminRoute({
  admin,
  professional,
}: {
  admin: ReactNode;
  professional: ReactNode;
}) {
  const { t } = useTranslation();
  const { me, loading } = useMe();
  if (loading) {
    return (
      <div className="flex justify-center p-8">
        <Spinner label={t("femme.platform.loading")} />
      </div>
    );
  }
  return <>{me?.role === "PROFESSIONAL" ? professional : admin}</>;
}

/** HU-68 AC9: a professional opening `/app/clients/:id` lands on that client's technical sheet. */
export function RedirectToTechnicalSheet() {
  const { id } = useParams();
  return <Navigate to={`/app/clients/${id ?? ""}/technical-sheet`} replace />;
}
