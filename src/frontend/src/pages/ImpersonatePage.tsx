import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Alert, Spinner } from "@design-system";
import { ACCESS_TOKEN_STORAGE_KEY } from "../api/baseUrl";
import { readImpersonationToken } from "../auth/impersonation";

/**
 * Issue #310: landing page of the tab opened by "Open as administrator". Stores the impersonation
 * token in this tab's sessionStorage (replacing the copy of the Platform Admin's session the
 * browser may have cloned into it), wipes the fragment from history and enters the tenant panel.
 */
export default function ImpersonatePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [invalid, setInvalid] = useState(false);
  // StrictMode re-runs effects: the fragment is already gone on the second run, so only the first
  // one may read it.
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;
    const token = readImpersonationToken(window.location.hash);
    window.history.replaceState(null, "", window.location.pathname);
    if (!token) {
      sessionStorage.removeItem(ACCESS_TOKEN_STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setInvalid(true);
      return;
    }
    sessionStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, token);
    navigate("/app", { replace: true });
  }, [navigate]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 p-4 dark:bg-slate-950">
      {invalid ? (
        <div className="w-full max-w-md space-y-3">
          <Alert variant="destructive" title={t("femme.impersonation.bannerTitle")}>
            {t("femme.impersonation.invalidLink")}
          </Alert>
          <Link to="/login" className="text-sm font-medium text-[var(--color-rose-dk)] underline">
            {t("femme.impersonation.backToLogin")}
          </Link>
        </div>
      ) : (
        <Spinner size="lg" label={t("femme.platform.loading")} />
      )}
    </div>
  );
}
