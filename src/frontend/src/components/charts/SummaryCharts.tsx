import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatGuaraniesGs } from "../../lib/formatMoney";

export type TrendPoint = { date: string; invoiced: string | number };

const num = (v: string | number): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

function shortDate(iso: string, locale: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(locale, { day: "numeric", month: "short" });
}

/** Sum of the plotted days. */
export function trendTotal(points: TrendPoint[]): number {
  return points.reduce((s, p) => s + num(p.invoiced), 0);
}

export type RevenueBucket = {
  /** First day of the bucket (yyyy-MM-dd) — also its stable key. */
  key: string;
  /** Last day of the bucket (equal to `key` for a single day). */
  endDate: string;
  value: number;
};

/**
 * Up to a month the chart shows one bar per day; beyond that the days are grouped by week (7 days,
 * the most recent week last) so 90 days are 13 readable bars instead of 90 slivers.
 */
export function revenueBuckets(data: TrendPoint[]): { buckets: RevenueBucket[]; unit: "day" | "week" } {
  if (data.length <= 31) {
    return {
      unit: "day",
      buckets: data.map((p) => ({ key: p.date, endDate: p.date, value: num(p.invoiced) })),
    };
  }
  const buckets: RevenueBucket[] = [];
  for (let end = data.length; end > 0; end -= 7) {
    const chunk = data.slice(Math.max(0, end - 7), end);
    buckets.unshift({
      key: chunk[0].date,
      endDate: chunk[chunk.length - 1].date,
      value: chunk.reduce((s, p) => s + num(p.invoiced), 0),
    });
  }
  return { buckets, unit: "week" };
}

/**
 * Resumen redesign: the one main chart. Wide, soft bars of the invoiced revenue per day (per week
 * for long periods) with three reference lines (0, half, max), the best bar highlighted and a
 * single line with the figure of the bar tapped (or of the best one). A period with no revenue shows
 * a short line instead of an empty chart.
 */
export function RevenueBars({
  buckets,
  unit,
  locale,
}: {
  buckets: RevenueBucket[];
  unit: "day" | "week";
  locale: string;
}) {
  const { t } = useTranslation();
  const [picked, setPicked] = useState<string | null>(null);
  const total = buckets.reduce((s, b) => s + b.value, 0);
  const compact = useMemo(
    () => new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }),
    [locale],
  );

  if (buckets.length === 0 || total === 0) {
    return (
      <p className="py-5 text-ink-3" data-testid="summary-revenue-empty">
        {t("femme.summary.noRevenue")}
      </p>
    );
  }

  const max = Math.max(...buckets.map((b) => b.value), 1);
  // Round the top of the scale up to a tidy figure so the reference lines read well.
  const mag = 10 ** Math.floor(Math.log10(max));
  const top = Math.ceil(max / (mag / 2)) * (mag / 2);
  const bestKey = buckets.reduce((best, b) => (b.value > best.value ? b : best), buckets[0]).key;
  const shown = buckets.find((b) => b.key === picked) ?? buckets.find((b) => b.key === bestKey)!;
  const range = (b: RevenueBucket) =>
    b.key === b.endDate ? shortDate(b.key, locale) : `${shortDate(b.key, locale)} – ${shortDate(b.endDate, locale)}`;

  return (
    <div data-testid="summary-revenue-chart" role="group" aria-label={t("femme.summary.revenueChartLabel")}>
      <div className="relative mt-2 h-44 pl-12">
        {[1, 0.5, 0].map((f) => (
          <div
            key={f}
            aria-hidden
            className="absolute inset-x-0 flex items-center gap-2"
            style={{ bottom: `${f * 100}%`, transform: "translateY(50%)" }}
          >
            <span className="w-10 shrink-0 text-right text-[11px] text-ink-3">{f === 0 ? "0" : compact.format(top * f)}</span>
            <span className="h-px flex-1 bg-line" />
          </div>
        ))}
        <div className="relative flex h-full items-end gap-1 sm:gap-1.5">
          {buckets.map((b) => {
            const isBest = b.key === bestKey;
            const isPicked = picked === b.key;
            return (
              <button
                key={b.key}
                type="button"
                data-testid={`summary-bar-${b.key}`}
                aria-label={`${range(b)}: ${formatGuaraniesGs(b.value)}`}
                aria-pressed={isPicked}
                onClick={() => setPicked(b.key)}
                onMouseEnter={() => setPicked(b.key)}
                className="group flex h-full min-w-0 flex-1 items-end justify-center"
              >
                <span
                  className={`block w-full max-w-7 rounded-t-md transition-colors ${
                    isBest || isPicked ? "bg-primary" : "bg-primary/30 group-hover:bg-primary/60"
                  }`}
                  style={{ height: b.value > 0 ? `${Math.max((b.value / top) * 100, 2)}%` : 0 }}
                />
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex justify-between pl-12 pt-1.5 text-xs text-ink-3" aria-hidden>
        <span>{shortDate(buckets[0].key, locale)}</span>
        <span>{shortDate(buckets[buckets.length - 1].endDate, locale)}</span>
      </div>
      <p className="mt-2 flex min-h-11 flex-wrap items-center gap-x-2 text-sm text-ink-2" aria-live="polite" data-testid="summary-bar-tip">
        {picked === null ? (
          <span>{t(unit === "week" ? "femme.summary.bestWeek" : "femme.summary.bestDay")}:</span>
        ) : null}
        <span>{range(shown)}</span>
        <b className="font-heading text-base tabular-nums text-ink">{formatGuaraniesGs(shown.value)}</b>
      </p>
    </div>
  );
}

export type RankedItem = { label: string; value: number };

/** A short ranking: name, figure and a thin bar scaled to the first item. */
export function RankedBars({ items, testId }: { items: RankedItem[]; testId: string }) {
  const top = Math.max(...items.map((i) => i.value), 1);
  return (
    <ul className="flex flex-col gap-4" data-testid={testId}>
      {items.map((i) => (
        <li key={i.label}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 break-words text-ink">{i.label}</span>
            <b className="shrink-0 font-heading tabular-nums text-ink">{formatGuaraniesGs(i.value)}</b>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-primary-lt" aria-hidden>
            <div className="h-full rounded-full bg-primary" style={{ width: `${(i.value / top) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

const PAYMENT_COLORS = ["#0E767E", "#E0783A", "#9CCBCF", "#B8C2CC", "#7A3E00", "#5F6B78"];

/** One stacked bar with the share of each payment method, and a legend row per method. */
export function PaymentStack({ items, testId }: { items: RankedItem[]; testId: string }) {
  const total = items.reduce((s, i) => s + i.value, 0) || 1;
  const parts = items.map((i, idx) => ({
    ...i,
    pct: Math.round((i.value / total) * 100),
    share: (i.value / total) * 100,
    color: PAYMENT_COLORS[idx % PAYMENT_COLORS.length],
  }));
  return (
    <div data-testid={testId} className="flex flex-col gap-3">
      <div className="flex h-3.5 gap-0.5 overflow-hidden rounded-full" aria-hidden>
        {parts.map((p) => (
          <span key={p.label} className="block h-full" style={{ width: `${p.share}%`, background: p.color }} />
        ))}
      </div>
      <ul className="flex flex-col">
        {parts.map((p) => (
          <li key={p.label} className="flex min-h-10 items-center gap-2.5 border-t border-line first:border-t-0">
            <span className="size-3 shrink-0 rounded-full" style={{ background: p.color }} aria-hidden />
            <span className="min-w-0 flex-1 break-words text-ink">{p.label}</span>
            <b className="font-heading tabular-nums text-ink">{p.pct}%</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Seven columns, Monday first: the count on top, the day below; the busiest day is highlighted. */
export function WeekdayBars({ items }: { items: Array<{ label: string; count: number }> }) {
  const max = Math.max(...items.map((i) => i.count), 1);
  return (
    <div data-testid="summary-weekday-bars">
      <div className="grid h-36 grid-cols-7 items-end gap-2">
        {items.map((i) => (
          <div key={i.label} className="flex h-full flex-col items-center justify-end gap-1.5">
            <b className="font-heading text-sm tabular-nums text-ink">{i.count}</b>
            <span
              className={`block w-full max-w-11 rounded-t-lg ${
                i.count === max && i.count > 0 ? "bg-primary" : "bg-primary/25"
              }`}
              style={{ height: `${Math.max(4, (i.count / max) * 96)}px` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-2 grid grid-cols-7 gap-2 text-center text-xs text-ink-3">
        {items.map((i) => (
          <span key={i.label}>{i.label}</span>
        ))}
      </div>
    </div>
  );
}
