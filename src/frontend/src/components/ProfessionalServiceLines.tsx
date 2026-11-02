import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { femmeJson } from "../api/femmeClient";
import { sortServicesBeforeProducts, type SalonServiceOption } from "./ServiceSearchField";

const DEBOUNCE_MS = 250;
const BTN_ROUND =
  "flex size-11 shrink-0 items-center justify-center rounded-full border-[1.5px] border-primary bg-transparent font-heading text-xl font-extrabold leading-none text-primary";

export type ProfessionalLineItem = { key: string; name: string; quantity: number };

/**
 * The professional's ficha services, built for a small screen: one row per service with − / + (going
 * below 1 removes it) and one big button that opens the full-screen picker. No prices, no professional.
 */
export function ProfessionalServiceLines({
  items,
  onIncrement,
  onDecrement,
  onAdd,
}: {
  items: ProfessionalLineItem[];
  onIncrement: (key: string) => void;
  onDecrement: (key: string) => void;
  onAdd: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2">
      {items.length === 0 ? (
        <p className="py-1 text-sm text-ink-3" data-testid="service-record-pro-empty">
          {t("femme.serviceRecords.pro.empty")}
        </p>
      ) : null}
      {items.map((item) => (
        <div
          key={item.key}
          data-testid="service-record-line"
          className="flex min-h-14 items-center justify-between gap-3 rounded-card border border-line px-3 py-1.5"
        >
          <span className="min-w-0 break-words font-heading font-extrabold text-ink">{item.name}</span>
          <span className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              className={BTN_ROUND}
              data-testid="service-record-line-dec"
              aria-label={t("femme.serviceRecords.pro.decrease", { name: item.name })}
              onClick={() => onDecrement(item.key)}
            >
              −
            </button>
            <b
              className="min-w-7 text-center font-heading tabular-nums text-ink"
              data-testid="service-record-line-qty"
              aria-live="polite"
            >
              {item.quantity}
            </b>
            <button
              type="button"
              className={BTN_ROUND}
              data-testid="service-record-line-inc"
              aria-label={t("femme.serviceRecords.pro.increase", { name: item.name })}
              onClick={() => onIncrement(item.key)}
            >
              +
            </button>
          </span>
        </div>
      ))}
      <button
        type="button"
        onClick={onAdd}
        data-testid="service-record-add-line"
        className="min-h-12 rounded-card border-[1.5px] border-dashed border-primary bg-transparent px-3 font-heading font-extrabold text-primary"
      >
        + {t("femme.serviceRecords.pro.addService")}
      </button>
    </div>
  );
}

/** Full-screen "Elegí un servicio": big rows (52 px), no prices; tapping one picks it and goes back. */
export function ServicePickerScreen({
  onPick,
  onBack,
}: {
  onPick: (service: SalonServiceOption) => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SalonServiceOption[]>([]);
  const [loading, setLoading] = useState(true);
  const reqId = useRef(0);

  useEffect(() => {
    const id = ++reqId.current;
    const timer = window.setTimeout(
      () => {
        const q = query.trim();
        femmeJson<SalonServiceOption[]>(q ? `/api/services?q=${encodeURIComponent(q)}` : "/api/services")
          .then((data) => {
            if (id !== reqId.current) return;
            const list = Array.isArray(data) ? data : [];
            setResults(sortServicesBeforeProducts(list.filter((s) => s.active)));
          })
          .catch(() => {
            if (id === reqId.current) setResults([]);
          })
          .finally(() => {
            if (id === reqId.current) setLoading(false);
          });
      },
      query ? DEBOUNCE_MS : 0,
    );
    return () => window.clearTimeout(timer);
  }, [query]);

  return (
    <div className="flex min-h-[60vh] flex-col gap-3" data-testid="service-picker">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          aria-label={t("femme.serviceRecords.pro.back")}
          data-testid="service-picker-back"
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary-lt text-xl font-extrabold text-primary"
        >
          ‹
        </button>
        <h2 className="font-heading text-lg font-extrabold text-ink">
          {t("femme.serviceRecords.pro.pickTitle")}
        </h2>
      </div>
      <input
        type="search"
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t("femme.serviceRecords.pro.searchPlaceholder")}
        aria-label={t("femme.serviceRecords.pro.searchPlaceholder")}
        data-testid="service-picker-search"
        className="min-h-12 w-full rounded-xl border-[1.5px] border-primary bg-surface px-3 text-ink"
      />
      <ul className="flex flex-col gap-2" role="listbox" aria-label={t("femme.serviceRecords.pro.pickTitle")}>
        {!loading && results.length === 0 ? (
          <li className="px-1 text-sm text-ink-3">{t("femme.billing.invoice.lineServiceNoResults")}</li>
        ) : null}
        {results.map((s) => (
          <li key={s.id} role="option" aria-selected={false}>
            <button
              type="button"
              data-testid="service-picker-option"
              onClick={() => onPick(s)}
              className="flex min-h-[52px] w-full flex-col justify-center rounded-xl border border-line bg-surface px-3 py-1.5 text-left hover:bg-primary-lt"
            >
              <b className="break-words text-ink">{s.name}</b>
              <small className="text-ink-3">
                {[s.categoryName, s.durationMinutes ? t("femme.billing.invoice.lineServiceDuration", { minutes: s.durationMinutes }) : null]
                  .filter(Boolean)
                  .join(" · ")}
              </small>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
