import { useEffect, useState } from "react";
import { apiBaseUrl } from "../api/baseUrl";
import { authHeaders } from "../api/authHeaders";

export type Me = {
  userId: number;
  email: string;
  privileged: boolean;
  accountLocked: boolean;
  tenantAdminTenants?: Array<{
    tenantId: number;
    shortName: string;
    legalName: string;
  }>;
};

export function useMe(): { me: Me | null; loading: boolean } {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${apiBaseUrl()}/api/me`, {
          headers: authHeaders({ json: false }),
        });
        if (!res.ok) {
          if (!cancelled) setMe(null);
          return;
        }
        const data = (await res.json()) as Me;
        if (!cancelled) setMe(data);
      } catch {
        if (!cancelled) setMe(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { me, loading };
}
