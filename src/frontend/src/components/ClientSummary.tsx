import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Card, DataTable, Heading, Spinner, Text } from "@design-system";
import { femmeJson } from "../api/femmeClient";
import { translateApiError } from "../api/parseApiErrorMessage";
import { useDateLocale } from "../i18n/dateLocale";
import { formatAmountDecimal } from "../lib/formatMoney";

/** HU-67: `GET /api/clients/{id}/summary` (`ClientSummaryResponse`). */
export type ClientSummary = {
  usualProfessionals: Array<{
    id: number;
    fullName: string;
    active: boolean;
    serviceCount: number;
  }>;
  lastVisitAt: string | null;
  spentLast12Months: string | number | null;
  averageTicketLast12Months: string | number | null;
  lastServices: Array<{
    performedAt: string;
    serviceName: string;
    professionalId: number | null;
    professionalName: string | null;
    price: string | number;
  }>;
  lastProducts: Array<{
    purchasedAt: string;
    productName: string;
    quantity: number;
    unitPrice: string | number;
  }>;
  /** Client radiography: services the client gets most often (whole history). */
  topServices: Array<{ serviceName: string; count: number }>;
  /** Client radiography: professionals who attend the client, most services first. */
  professionalRanking: Array<{
    id: number;
    fullName: string;
    active: boolean;
    serviceCount: number;
  }>;
};

function formatDate(iso: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(iso));
  } catch {
    return iso;
  }
}


/** HU-67: loads `GET /api/clients/{id}/summary` once for the stats strip and the lists. */
export function useClientSummary(clientId: number): {
  summary: ClientSummary | null;
  error: string | null;
} {
  const { t } = useTranslation();
  const [summary, setSummary] = useState<ClientSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSummary(null);
    setError(null);
    if (!Number.isFinite(clientId)) return;
    femmeJson<ClientSummary>(`/api/clients/${clientId}/summary`)
      .then((data) => {
        if (!cancelled) setSummary(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(translateApiError(err, t, "femme.apiErrors.GENERIC"));
      });
    return () => {
      cancelled = true;
    };
  }, [clientId, t]);

  return { summary, error };
}

type SummaryState = { summary: ClientSummary | null; error: string | null };

function SummaryStatus({ summary, error }: SummaryState) {
  const { t } = useTranslation();
  if (error) {
    return (
      <Alert variant="destructive" title={t("femme.clients.errorTitle")}>
        {error}
      </Alert>
    );
  }
  return summary == null ? <Spinner size="sm" /> : null;
}

function Stat({ testId, label, children }: { testId: string; label: string; children: ReactNode }) {
  return (
    <Card data-testid={testId} className="min-w-0 p-3">
      <dt className="text-xs text-[var(--color-ink-2)]">{label}</dt>
      <dd className="mt-1 text-sm font-medium">{children}</dd>
    </Card>
  );
}

/**
 * HU-67 / HU-70 AC2–3: compact, always-visible strip — usual stylist (12 months), last visit,
 * 12-month spend and average ticket. One row on wide screens, 2×2 on phones.
 */
export function ClientSummaryStats({ summary, error }: SummaryState) {
  const { t } = useTranslation();
  const dateLocale = useDateLocale();
  if (summary == null) return <SummaryStatus summary={summary} error={error} />;
  return (
    <dl data-testid="client-summary" className="grid grid-cols-2 gap-2 md:grid-cols-4">
      <Stat testId="client-summary-usual" label={t("femme.clients.summary.usualProfessional")}>
        {summary.usualProfessionals.length === 0 ? (
          <span className="font-normal text-[var(--color-ink-2)]">
            {t("femme.clients.summary.noServicesLast12Months")}
          </span>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {summary.usualProfessionals.map((p) => (
              <li key={p.id}>
                {p.fullName}
                {!p.active ? ` ${t("femme.clients.summary.inactiveProfessional")}` : ""}
                {" · "}
                {t("femme.clients.summary.serviceCount", { count: p.serviceCount })}
              </li>
            ))}
          </ul>
        )}
      </Stat>
      <Stat testId="client-summary-last-visit" label={t("femme.clients.summary.lastVisit")}>
        {summary.lastVisitAt
          ? formatDate(summary.lastVisitAt, dateLocale)
          : t("femme.clients.summary.noVisits")}
      </Stat>
      <Stat testId="client-summary-spent" label={t("femme.clients.summary.spentLast12Months")}>
        {formatAmountDecimal(summary.spentLast12Months)}
      </Stat>
      <Stat testId="client-summary-average" label={t("femme.clients.summary.averageTicket")}>
        {formatAmountDecimal(summary.averageTicketLast12Months)}
      </Stat>
    </dl>
  );
}

/** HU-67 / HU-70 AC7: "Resumen" tab — last 5 services and last 5 products. */
export function ClientSummaryLists({ summary, error }: SummaryState) {
  const { t } = useTranslation();
  const dateLocale = useDateLocale();
  if (summary == null) return <SummaryStatus summary={summary} error={error} />;
  return (
    <div className="flex flex-col gap-4">
      <Card data-testid="client-summary-services" className="flex flex-col gap-2 p-4">
        <Heading as="h2" className="text-base">
          {t("femme.clients.summary.lastServices")}
        </Heading>
        {summary.lastServices.length === 0 ? (
          <Text variant="muted">{t("femme.clients.summary.noServices")}</Text>
        ) : (
          <DataTable<ClientSummary["lastServices"][number]>
            minWidthClassName="min-w-[320px]"
            rows={summary.lastServices}
            getRowId={(_, i) => i}
            columns={[
              { id: "date", header: t("femme.clients.summary.colDate"), cell: (s) => formatDate(s.performedAt, dateLocale) },
              { id: "service", header: t("femme.clients.summary.colService"), wrap: true, cell: (s) => s.serviceName },
              { id: "professional", header: t("femme.clients.summary.colProfessional"), cell: (s) => s.professionalName ?? "—" },
              { id: "price", header: t("femme.clients.summary.colPrice"), align: "right", cell: (s) => formatAmountDecimal(s.price) },
            ]}
          />
        )}
      </Card>

      <Card data-testid="client-summary-products" className="flex flex-col gap-2 p-4">
        <Heading as="h2" className="text-base">
          {t("femme.clients.summary.lastProducts")}
        </Heading>
        {summary.lastProducts.length === 0 ? (
          <Text variant="muted">{t("femme.clients.summary.noProducts")}</Text>
        ) : (
          <DataTable<ClientSummary["lastProducts"][number]>
            minWidthClassName="min-w-[320px]"
            rows={summary.lastProducts}
            getRowId={(_, i) => i}
            columns={[
              { id: "date", header: t("femme.clients.summary.colDate"), cell: (p) => formatDate(p.purchasedAt, dateLocale) },
              { id: "product", header: t("femme.clients.summary.colProduct"), wrap: true, cell: (p) => p.productName },
              { id: "quantity", header: t("femme.clients.summary.colQuantity"), align: "right", cell: (p) => p.quantity },
              { id: "unitPrice", header: t("femme.clients.summary.colUnitPrice"), align: "right", cell: (p) => formatAmountDecimal(p.unitPrice) },
            ]}
          />
        )}
      </Card>
    </div>
  );
}
