import { useTranslation } from "react-i18next";
import { Badge } from "@design-system";

export type InvoiceState = "issued" | "processing" | "attention" | "voided";

/**
 * Billing redesign: the lists show one plain-language state per invoice instead of the raw
 * invoice status plus the raw SIFEN status. The technical detail stays in the invoice dialog.
 */
export function deriveInvoiceState(inv: {
  status: string;
  sifenSubmissionStatus?: string | null;
}): InvoiceState {
  const sifen = inv.sifenSubmissionStatus;
  if (inv.status === "VOIDED" || sifen === "CANCELLED") return "voided";
  if (sifen === "REJECTED") return "attention";
  if (!sifen || sifen === "APPROVED" || sifen === "APPROVED_WITH_OBSERVATION") return "issued";
  return "processing";
}

const VARIANT = {
  issued: "success",
  processing: "warning",
  attention: "destructive",
  voided: "secondary",
} as const;

export function InvoiceStatePill({
  invoice,
  className,
}: {
  invoice: { status: string; sifenSubmissionStatus?: string | null };
  className?: string;
}) {
  const { t } = useTranslation();
  const state = deriveInvoiceState(invoice);
  return (
    <Badge
      variant={VARIANT[state]}
      className={`whitespace-nowrap ${className ?? ""}`}
      data-invoice-state={state}
    >
      {t(`femme.billing.state.${state}`)}
    </Badge>
  );
}
