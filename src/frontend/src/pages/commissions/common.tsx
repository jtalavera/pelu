import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@design-system";
import { femmeJson } from "../../api/femmeClient";

export type ProfessionalOption = { id: number; fullName: string; active: boolean };

/** Tenant professionals (active and inactive) for filters and selectors. */
export function useProfessionals(): ProfessionalOption[] {
  const [list, setList] = useState<ProfessionalOption[]>([]);
  useEffect(() => {
    femmeJson<ProfessionalOption[]>("/api/professionals")
      .then((l) => setList(Array.isArray(l) ? l : []))
      .catch(() => setList([]));
  }, []);
  return list;
}

/** "40,5 %" style percent label (es-PY decimals). */
export function formatPercent(v: number | string | null | undefined): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return "—";
  return `${new Intl.NumberFormat("es-PY", { maximumFractionDigits: 2 }).format(n)} %`;
}

/** Accepts "40", "40,5" or "40.5"; returns the normalized "40.5" string or null when invalid. */
export function parsePercentInput(raw: string): string | null {
  const s = raw.trim().replace(",", ".");
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(s)) return null;
  const n = Number(s);
  if (n < 0 || n > 100) return null;
  return s;
}

export function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function firstOfMonthYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

export function SettlementStatusBadge({ status }: { status: string | null }) {
  const { t } = useTranslation();
  const variant =
    status === "PAID" ? "success" : status === "APPROVED" ? "info" : status === "VOIDED" ? "destructive" : "warning";
  return (
    <Badge variant={variant} data-testid="settlement-status">
      {t(`femme.commissions.settlementStatus.${status ?? "UNSETTLED"}`)}
    </Badge>
  );
}

export const thClass =
  "px-3 py-2 text-left text-[10px] font-medium uppercase text-[var(--color-ink-3)] whitespace-nowrap";
export const tdClass = "px-3 py-2 align-top";

export function TableWrap({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <div className="w-full overflow-x-auto" data-testid={testId}>
      <table className="min-w-full text-sm">{children}</table>
    </div>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="text-base font-medium text-[var(--color-ink)]">{children}</h3>;
}
