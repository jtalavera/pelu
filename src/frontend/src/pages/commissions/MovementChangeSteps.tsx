import { useTranslation } from "react-i18next";
import { useDateLocale } from "../../i18n/dateLocale";
import { formatGuaraniesGs } from "../../lib/formatMoney";
import { formatParaguayDateTime } from "../../lib/paraguayDateTime";
import { formatPercent } from "./common";
import type { MovementGroup } from "./movementGroups";

/**
 * HU-COM-29 / HU-COM-32: the path of a sale whose commission changed: the first commission, its reversal and the one in
 * force, with the net. Used by Movimientos and by the settlement detail.
 */
export function MovementChangeSteps({ group: g, testIdPrefix = "movement" }: { group: MovementGroup; testIdPrefix?: string }) {
  const { t } = useTranslation();
  const dateLocale = useDateLocale();
  return (
    <div data-testid={`${testIdPrefix}-changes`} className="mx-4 mb-3 mt-1 rounded-2xl border border-line bg-bg/60 px-4 py-3">
      <div className="mb-1 text-xs font-extrabold uppercase tracking-wide text-ink-3">{t("femme.commissions.movements.group.title")}</div>
      <ol className="flex flex-col">
        {g.entries.map((x, i) => {
          const kind = x.sourceType === "REVERSAL" ? "reversal" : g.current && x.id === g.current.id ? "current" : "reverted";
          const firstLine = g.entries.findIndex((y) => y.sourceType === "INVOICE_LINE") === i;
          const reversedAt = x.reversesEntryId ? g.entries.findIndex((y) => y.id === x.reversesEntryId) : -1;
          const [, ...stepTime] = formatParaguayDateTime(x.accrualAt, dateLocale).split(", ");
          const label =
            kind === "reversal"
              ? t(`femme.commissions.reason.${x.reasonCode ?? "VOID"}`)
              : t(`femme.commissions.movements.group.step.${kind === "current" ? "current" : firstLine ? "initial" : "previous"}`);
          const sub = [
            stepTime.join(", "),
            new Set(g.entries.map((y) => y.professionalId)).size > 1 ? x.professionalName : null,
            kind === "reversal" && reversedAt >= 0 ? t("femme.commissions.movements.group.reverses", { n: reversedAt + 1 }) : null,
            kind === "reversal" ? x.note : null,
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <li key={x.id} data-testid={`${testIdPrefix}-step`} data-kind={kind} className="grid min-h-11 grid-cols-[1.5rem_minmax(0,1fr)_auto] items-start gap-x-2.5 py-1.5">
              <span
                aria-hidden
                className={`mt-0.5 inline-flex size-5 items-center justify-center rounded-full text-[11px] font-extrabold ${
                  kind === "reversal" ? "bg-danger-lt text-danger" : kind === "current" ? "bg-success-lt text-success" : "bg-line text-ink-2"
                }`}
              >
                {kind === "reversal" ? "↩" : kind === "current" ? "✓" : i + 1}
              </span>
              <span className="flex min-w-0 flex-col">
                <b className="text-[13px] text-ink">
                  {label}
                  {x.percentApplied !== null && <span className="font-semibold text-ink-2"> · {formatPercent(x.percentApplied)}</span>}
                </b>
                <span className="text-xs text-ink-3">{sub}</span>
              </span>
              <span className="flex flex-col items-end gap-0.5">
                <b
                  data-testid={`${testIdPrefix}-step-amount`}
                  className={`tabular-nums text-sm ${kind === "reversal" ? "text-danger" : kind === "reverted" ? "text-ink-3 line-through" : "text-ink"}`}
                >
                  {formatGuaraniesGs(x.commissionAmount)}
                </b>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-extrabold ${
                    kind === "reversal" ? "bg-danger-lt text-danger" : kind === "current" ? "bg-success-lt text-success" : "bg-bg text-ink-2"
                  }`}
                >
                  {t(`femme.commissions.movements.group.stepTag.${kind}`)}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
      <div className="mt-1 border-t border-dashed border-line pt-2 text-[13px] text-ink-2" data-testid={`${testIdPrefix}-changes-net`}>
        {t("femme.commissions.movements.group.net", { amount: formatGuaraniesGs(g.net) })}
        {!g.current && ` ${t("femme.commissions.movements.group.noCurrent")}`}
      </div>
    </div>
  );
}
