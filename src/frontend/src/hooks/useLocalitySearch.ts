import { useCallback, useRef, useState } from "react";
import type { Locality } from "@design-system";
import { femmeJson } from "../api/femmeClient";

/**
 * Debounced search-as-you-type against `GET /api/sifen/geographic-localities` (SIFEN HU-02
 * AC-07's department/city picker) — shared by every screen that needs a
 * {@link import("@design-system").LocalityCombobox}, so the debounce/loading/error handling only
 * lives in one place.
 */
export function useLocalitySearch() {
  const [options, setOptions] = useState<Locality[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback((query: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = query.trim();
    if (!trimmed) {
      setOptions([]);
      setLoading(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const result = await femmeJson<Locality[]>(
          `/api/sifen/geographic-localities?q=${encodeURIComponent(trimmed)}`,
        );
        setOptions(result);
      } catch {
        setOptions([]);
      } finally {
        setLoading(false);
      }
    }, 250);
  }, []);

  return { options, loading, search };
}
