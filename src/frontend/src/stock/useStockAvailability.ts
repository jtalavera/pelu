import { useEffect, useMemo, useState } from "react";
import { fetchStockAvailability, type StockAvailabilityItem } from "../api/stock";
import { useFeatureFlag } from "../hooks/useFeatureFlags";

/**
 * HU-66: debounced availability of the products among `serviceIds`, for the invoice being drafted.
 * Only when the tenant has STOCK_MODULE. Purely informative: any failure (or `unavailable` from the
 * backend) yields an empty map, so nothing is shown and invoicing goes on as usual.
 */
export function useStockAvailability(
  serviceIds: number[],
  debounceMs = 400,
): Map<number, StockAvailabilityItem> {
  const stockEnabled = useFeatureFlag("STOCK_MODULE");
  const key = useMemo(
    () =>
      Array.from(new Set(serviceIds.filter((id) => Number.isFinite(id) && id > 0)))
        .sort((a, b) => a - b)
        .join(","),
    [serviceIds],
  );
  const [items, setItems] = useState<Map<number, StockAvailabilityItem>>(new Map());

  useEffect(() => {
    if (!stockEnabled || key === "") {
      setItems(new Map());
      return;
    }
    let cancelled = false;
    const handle = setTimeout(() => {
      fetchStockAvailability(key.split(",").map(Number))
        .then((res) => {
          if (cancelled) return;
          if (!res.enabled || res.unavailable) {
            setItems(new Map());
            return;
          }
          setItems(new Map(res.items.map((i) => [i.serviceId, i])));
        })
        .catch(() => {
          if (!cancelled) setItems(new Map());
        });
    }, debounceMs);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [stockEnabled, key, debounceMs]);

  return items;
}

/** es-PY formatting (thousands with ".", decimals with ","), up to 2 decimals. */
export function formatStockQuantity(value: number): string {
  return new Intl.NumberFormat("es-PY", { maximumFractionDigits: 2 }).format(value);
}
