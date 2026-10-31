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

/**
 * Resumen redesign: the one main chart. Plain SVG bars of the invoiced revenue per day, the busiest
 * day highlighted, a dashed line for the period average and one tap/hover line with the day's
 * figure. A period with no revenue shows a single short line instead of an empty chart.
 */
export function RevenueBars({ data, locale }: { data: TrendPoint[]; locale: string }) {
  const { t } = useTranslation();
  const [picked, setPicked] = useState<number | null>(null);
  const values = useMemo(() => data.map((p) => num(p.invoiced)), [data]);
  const total = values.reduce((s, v) => s + v, 0);

  if (data.length === 0 || total === 0) {
    return (
      <p className="py-5 text-ink-3" data-testid="summary-revenue-empty">
        {t("femme.summary.noRevenue")}
      </p>
    );
  }

  const W = 720;
  const H = 220;
  const pad = { l: 8, r: 8, t: 12, b: 24 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const max = Math.max(...values, 1);
  const bw = iw / values.length;
  const avg = total / values.length;
  const peak = values.indexOf(Math.max(...values));
  const avgY = pad.t + ih - (avg / max) * ih;
  const shown = picked ?? null;

  return (
    <div data-testid="summary-revenue-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t("femme.summary.revenueChartLabel")} className="block h-auto w-full">
        {values.map((v, i) => {
          const h = (v / max) * ih;
          return (
            <rect
              key={data[i].date}
              data-testid={`summary-bar-${data[i].date}`}
              x={pad.l + i * bw + bw * 0.15}
              y={pad.t + ih - h}
              width={bw * 0.7}
              height={v > 0 ? Math.max(h, 2) : 0}
              rx={3}
              className={i === peak ? "fill-primary" : "fill-primary/40 hover:fill-primary"}
              onMouseEnter={() => setPicked(i)}
              onClick={() => setPicked(i)}
            >
              <title>{`${shortDate(data[i].date, locale)}: ${formatGuaraniesGs(v)}`}</title>
            </rect>
          );
        })}
        <line
          x1={pad.l}
          x2={W - pad.r}
          y1={avgY}
          y2={avgY}
          className="stroke-ink-3"
          strokeDasharray="4 4"
          strokeWidth={1.2}
          data-testid="summary-average-line"
        />
        <text x={pad.l} y={H - 6} className="fill-ink-3" fontSize={11}>
          {shortDate(data[0].date, locale)}
        </text>
        <text x={W - pad.r} y={H - 6} textAnchor="end" className="fill-ink-3" fontSize={11}>
          {shortDate(data[data.length - 1].date, locale)}
        </text>
      </svg>
      <p className="min-h-5 pt-1 text-sm font-semibold text-ink-2" aria-live="polite" data-testid="summary-bar-tip">
        {shown !== null
          ? `${shortDate(data[shown].date, locale)} · ${formatGuaraniesGs(values[shown])}`
          : t("femme.summary.barHint")}
      </p>
      <div className="mt-1 flex flex-wrap gap-x-4 text-xs text-ink-3">
        <span>{t("femme.summary.legendDaily")}</span>
        <span>{t("femme.summary.legendAverage", { amount: formatGuaraniesGs(avg) })}</span>
      </div>
    </div>
  );
}

export type RankedItem = { label: string; value: number };

/** A short ranking: name, figure and a bar scaled to the first item. `asPercent` shows each item's share of the total. */
export function RankedBars({
  items,
  asPercent = false,
  testId,
}: {
  items: RankedItem[];
  asPercent?: boolean;
  testId: string;
}) {
  const total = items.reduce((s, i) => s + i.value, 0);
  const top = Math.max(...items.map((i) => i.value), 1);
  return (
    <ul className="flex flex-col gap-2.5" data-testid={testId}>
      {items.map((i) => (
        <li key={i.label} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 text-sm">
          <span className="break-words text-ink">{i.label}</span>
          <span className="text-right font-bold tabular-nums text-ink">
            {asPercent ? `${Math.round((i.value / (total || 1)) * 100)}%` : formatGuaraniesGs(i.value)}
          </span>
          <span className="col-span-2 h-2 overflow-hidden rounded bg-bg" aria-hidden>
            <span className="block h-full rounded bg-primary" style={{ width: `${(i.value / top) * 100}%` }} />
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Seven slim bars, Monday first; the busiest day is highlighted. */
export function WeekdayBars({ items }: { items: Array<{ label: string; count: number }> }) {
  const max = Math.max(...items.map((i) => i.count), 1);
  return (
    <div className="grid h-28 grid-cols-7 items-end gap-2" data-testid="summary-weekday-bars">
      {items.map((i) => (
        <div key={i.label} className="flex h-full flex-col items-center justify-end gap-1 text-xs text-ink-3">
          <b className="tabular-nums text-ink-2">{i.count}</b>
          <i
            className={`block w-full max-w-9 rounded-t-md ${i.count === max && i.count > 0 ? "bg-primary" : "bg-primary/40"}`}
            style={{ height: `${Math.max(3, (i.count / max) * 70)}px` }}
          />
          <span>{i.label}</span>
        </div>
      ))}
    </div>
  );
}
