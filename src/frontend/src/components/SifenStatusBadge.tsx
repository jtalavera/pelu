import { useTranslation } from "react-i18next";
import { Badge } from "@design-system";

/** SIFEN HU-07/RT-20: badge variant + i18n key per sifenSubmissionStatus literal. */
function sifenStatusLabelKey(status: string): string {
  switch (status) {
    case "QUEUED":
      return "femme.billing.history.detail.sifen.statusQueued";
    case "APPROVED":
      return "femme.billing.history.detail.sifen.statusApproved";
    case "APPROVED_WITH_OBSERVATION":
      return "femme.billing.history.detail.sifen.statusApprovedWithObservation";
    case "REJECTED":
      return "femme.billing.history.detail.sifen.statusRejected";
    case "CANCELLED":
      return "femme.billing.history.detail.sifen.statusCancelled";
    default:
      return "femme.billing.history.detail.sifen.statusPendingVerification";
  }
}

function sifenStatusBadgeVariant(
  status: string,
): "success" | "destructive" | "warning" | "info" {
  if (status === "QUEUED") return "info";
  if (status === "APPROVED" || status === "APPROVED_WITH_OBSERVATION") return "success";
  if (status === "REJECTED" || status === "CANCELLED") return "destructive";
  return "warning";
}

/**
 * Single source of truth for rendering an invoice's SIFEN submission status — used by the
 * invoice detail dialog and by every table that lists invoices. Renders a plain dash when the
 * invoice has no status at all (SIFEN disabled for the tenant, or the invoice predates SIFEN),
 * matching how these tables already render other missing values.
 */
export function SifenStatusBadge({ status }: { status?: string | null }) {
  const { t } = useTranslation();
  if (!status) return <>—</>;
  return <Badge variant={sifenStatusBadgeVariant(status)}>{t(sifenStatusLabelKey(status))}</Badge>;
}
