import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { femmeJson } from "../api/femmeClient";
import { translateApiError } from "../api/parseApiErrorMessage";
import { useMe } from "./useMe";

type FeatureFlags = Record<string, boolean>;

type FeatureFlagContextValue = {
  flags: FeatureFlags;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
};

const FeatureFlagContext = createContext<FeatureFlagContextValue | null>(null);

type ProviderProps = { children: ReactNode };

/**
 * Fetches resolved feature flags for the current tenant when the user session is available.
 * Mount only under authenticated layout (e.g. AppShell).
 */
export function FeatureFlagProvider({ children }: ProviderProps) {
  const { me, loading: meLoading } = useMe();
  const { t } = useTranslation();
  const [flags, setFlags] = useState<FeatureFlags>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    if (!me) {
      setFlags({});
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await femmeJson<{ flags: Record<string, boolean> }>("/api/feature-flags", {
        json: false,
      });
      setFlags(res.flags ?? {});
    } catch (e) {
      setFlags({});
      setError(translateApiError(e, t, "femme.apiErrors.GENERIC"));
    } finally {
      setLoading(false);
    }
  }, [me, t]);

  useEffect(() => {
    if (meLoading) return;
    void refetch();
  }, [meLoading, me, refetch]);

  const value = useMemo(
    () => ({ flags, loading, error, refetch }),
    [flags, loading, error, refetch],
  );

  return <FeatureFlagContext.Provider value={value}>{children}</FeatureFlagContext.Provider>;
}

/**
 * For screens that need the full map or a manual refetch (e.g. after admin updates).
 */
export function useFeatureFlagsState(): FeatureFlagContextValue {
  const ctx = useContext(FeatureFlagContext);
  if (!ctx) {
    throw new Error("useFeatureFlagsState must be used within FeatureFlagProvider");
  }
  return ctx;
}

/**
 * Resolves a single feature flag. Unknown keys are false. When the provider is not mounted
 * (e.g. login / public routes), returns false.
 */
export function useFeatureFlag(key: string): boolean {
  const ctx = useContext(FeatureFlagContext);
  if (!ctx) {
    return false;
  }
  return ctx.flags[key] ?? false;
}
