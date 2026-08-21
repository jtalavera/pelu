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
  /** null only for PLATFORM_ADMIN (HU-34) — genuinely tenant-independent. */
  tenantId: number | null;
  email: string;
  role: "PLATFORM_ADMIN" | "ADMIN" | "PROFESSIONAL";
  professionalId: number | null;
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
        const data = (await res.json()) as Me;
        if (!cancelled) {
          setMe(data);
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
