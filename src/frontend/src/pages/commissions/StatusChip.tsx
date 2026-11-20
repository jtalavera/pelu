import { useTranslation } from "react-i18next";
import type { OverviewStatus } from "../../api/commissions";
import { STATUS_META } from "./overview";

/** «Sin liquidar», «Falta aprobar», «Lista para pagar», «Pagada»: the state of a professional in a period. */
export function StatusChip({ status }: { status: OverviewStatus }) {
  const { t } = useTranslation();
  return (
    <span
      data-testid="status-chip"
      data-status={status}
      className={`inline-flex min-h-[30px] items-center justify-center rounded-full px-3 text-xs font-extrabold ${STATUS_META[status].chip}`}
    >
      {t(`femme.commissions.status.${status}`)}
    </span>
  );
}
