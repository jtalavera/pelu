import { useTranslation } from "react-i18next";

type Status = "OPEN" | "CLOSED" | "VOIDED";

const STYLE: Record<Status, string> = {
  OPEN: "bg-warning-lt text-warning",
  CLOSED: "bg-success-lt text-success",
  VOIDED: "border border-line bg-bg text-ink-3",
};

const LABEL_KEY: Record<Status, string> = {
  OPEN: "femme.serviceRecords.statusOpen",
  CLOSED: "femme.serviceRecords.statusClosed",
  VOIDED: "femme.serviceRecords.statusVoided",
};

/** Prominent status chip shown next to the service-record title (● Abierta / Cobrada / Anulada). */
export function ServiceRecordStatusPill({ status }: { status: Status }) {
  const { t } = useTranslation();
  return (
    <span
      data-testid="service-record-status"
      data-status={status}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-extrabold ${STYLE[status]}`}
    >
      <i aria-hidden="true" className="size-2 rounded-full bg-current" />
      {t(LABEL_KEY[status])}
    </span>
  );
}
