import { useEffect, useState } from "react";
import { apiBaseUrl } from "../api/baseUrl";
import { authHeaders } from "../api/authHeaders";

export type MeProfile = {
  fullName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  photoDataUrl: string | null;
};

export type Me = {
  userId: number;
  tenantId: number;
  email: string;
  role: "SYSTEM_ADMIN" | "ADMIN" | "PROFESSIONAL";
  professionalId: number | null;
  /**
   * When `SYSTEM_ADMIN`, the real salon tenant to use for feature flags and data preview.
   * For other roles, usually matches `tenantId` or is null.
   */
  previewTenantId: number | null;
  /** Profile data from linked Professional; null for admin without linked Professional. */
  profile: MeProfile | null;
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
        const data = (await res.json()) as Me & { previewTenantId?: number | null };
        if (!cancelled) {
          setMe({
            ...data,
            previewTenantId: data.previewTenantId ?? null,
          });
        }
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
