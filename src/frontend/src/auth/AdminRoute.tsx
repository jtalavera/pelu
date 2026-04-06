import { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Spinner, Text } from "@design-system";
import { ACCESS_TOKEN_STORAGE_KEY, apiBaseUrl } from "../api/baseUrl";
import { authHeaders } from "../api/authHeaders";

type Props = { children: React.ReactNode };

type GateState = "loading" | "ok" | "denied" | "noSession";

export function AdminRoute({ children }: Props) {
  const { t } = useTranslation();
  const location = useLocation();
  const [state, setState] = useState<GateState>("loading");

  useEffect(() => {
    const token = sessionStorage.getItem(ACCESS_TOKEN_STORAGE_KEY);
    if (!token) {
      setState("noSession");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${apiBaseUrl()}/api/me`, {
          headers: authHeaders({ json: false }),
        });
        if (!res.ok) {
          if (!cancelled) setState("denied");
          return;
        }
        const data = (await res.json()) as { privileged?: boolean };
        if (!cancelled) setState(data.privileged ? "ok" : "denied");
      } catch {
        if (!cancelled) setState("denied");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state === "noSession") {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  if (state === "denied") {
    return <Navigate to="/" replace />;
  }
  if (state === "loading") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-2 bg-slate-50 p-4 dark:bg-slate-950">
        <Spinner size="lg" label={t("admin.loading")} />
        <Text variant="muted">{t("admin.loading")}</Text>
      </div>
    );
  }
  return <>{children}</>;
}
