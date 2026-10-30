import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { femmeJson } from "../api/femmeClient";
import { useDateLocale } from "../i18n/dateLocale";
import { cardStyle } from "./charts/chartTheme";

/** HU-69: `GET /api/dashboard/birthdays` (`ClientBirthdaysResponse`). */
type Birthday = {
  clientId: number;
  fullName: string;
  phone: string | null;
  /** yyyy-MM-dd (server zone). */
  date: string;
  turningAge: number | null;
};

type BirthdaysResponse = { today: Birthday[]; upcoming: Birthday[]; upcomingDays: number };

function formatDay(isoDate: string, locale: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "long" }).format(
    new Date(y, m - 1, d),
  );
}

const linkClass = "font-medium text-[var(--color-ink)] hover:underline";

/** HU-69 AC5: dashboard alert — active clients whose birthday is today / in the next 7 days. */
/** `embedded`: only the list (no card or title) — used inside the Inicio "Más del día" section. */
export function BirthdaysCard({
  embedded = false,
  onLoaded,
}: { embedded?: boolean; onLoaded?: (count: number) => void } = {}) {
  const { t } = useTranslation();
  const locale = useDateLocale();
  const [data, setData] = useState<BirthdaysResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    femmeJson<BirthdaysResponse>("/api/dashboard/birthdays")
      .then((res) => {
        if (!cancelled) {
          setData(res);
          onLoaded?.((res.today?.length ?? 0) + (res.upcoming?.length ?? 0));
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const today = data?.today ?? [];
  const upcoming = data?.upcoming ?? [];
  const empty = data != null && today.length === 0 && upcoming.length === 0;

  return (
    <div data-testid="dashboard-birthdays" style={embedded ? undefined : { ...cardStyle, marginTop: 16 }}>
      {!embedded && (
        <>
          <div style={{ fontSize: 13, fontWeight: 500, color: "var(--color-ink)" }}>
            🎂 {t("femme.dashboard.birthdays.title")}
          </div>
          <div style={{ fontSize: 11, color: "var(--color-ink-3)", marginTop: 2, marginBottom: 12 }}>
            {t("femme.dashboard.birthdays.subtitle", { days: data?.upcomingDays ?? 7 })}
          </div>
        </>
      )}

      {failed ? (
        <div role="alert" style={{ fontSize: 12, color: "var(--color-ink-3)" }}>
          {t("femme.dashboard.birthdays.loadError")}
        </div>
      ) : data == null ? null : empty ? (
        <div style={{ fontSize: 12, color: "var(--color-ink-3)" }}>
          {t("femme.dashboard.birthdays.empty", { days: data.upcomingDays })}
        </div>
      ) : (
        <div className="flex flex-col gap-3 text-sm">
          {today.length > 0 && (
            <div data-testid="dashboard-birthdays-today">
              <div className="mb-1 text-xs text-[var(--color-ink-2)]">
                {t("femme.dashboard.birthdays.today")}
              </div>
              <ul className="flex flex-col gap-1">
                {today.map((b) => (
                  <li key={b.clientId} className="flex min-h-11 flex-wrap items-center gap-x-2">
                    <Link to={`/app/clients/${b.clientId}`} className={linkClass}>
                      {b.fullName}
                    </Link>
                    <span className="text-[var(--color-ink-2)]">{b.phone ?? "—"}</span>
                    {b.turningAge != null && (
                      <span className="text-[var(--color-ink-3)]">
                        {t("femme.dashboard.birthdays.turns", { count: b.turningAge })}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {upcoming.length > 0 && (
            <div data-testid="dashboard-birthdays-upcoming">
              <div className="mb-1 text-xs text-[var(--color-ink-2)]">
                {t("femme.dashboard.birthdays.upcoming", { days: data?.upcomingDays ?? 7 })}
              </div>
              <ul className="flex flex-col gap-1">
                {upcoming.map((b) => (
                  <li key={b.clientId} className="flex min-h-11 flex-wrap items-center gap-x-2">
                    <Link to={`/app/clients/${b.clientId}`} className={linkClass}>
                      {b.fullName}
                    </Link>
                    <span className="text-[var(--color-ink-2)]">{formatDay(b.date, locale)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
