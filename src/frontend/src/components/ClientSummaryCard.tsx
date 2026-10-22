import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Card, Heading, Spinner, Text } from "@design-system";
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
};

function formatDate(iso: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(iso));
  } catch {
    return iso;
  }
}

const thClass = "py-2 pr-2 font-medium";
const tdClass = "py-2 pr-2 align-top";

/**
 * HU-67: "Resumen" block on top of the client profile — usual professional(s) over the last 12
 * months, last visit, spend / average ticket, and the last 5 services and products.
 */
export function ClientSummaryCard({ clientId }: { clientId: number }) {
  const { t } = useTranslation();
  const dateLocale = useDateLocale();
  const [summary, setSummary] = useState<ClientSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSummary(null);
    setError(null);
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

  return (
    <Card data-testid="client-summary" className="flex flex-col gap-4 p-4 sm:p-6">
      <Heading as="h2" className="text-base">
        {t("femme.clients.summary.title")}
      </Heading>

      {error ? (
        <Alert variant="destructive" title={t("femme.clients.errorTitle")}>
          {error}
        </Alert>
      ) : summary == null ? (
        <Spinner size="sm" />
      ) : (
        <>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="min-w-0 sm:col-span-2" data-testid="client-summary-usual">
              <dt className="text-xs text-[var(--color-ink-2)]">
                {t("femme.clients.summary.usualProfessional")}
              </dt>
              <dd className="text-sm font-medium">
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
              </dd>
            </div>
            <div className="min-w-0" data-testid="client-summary-last-visit">
              <dt className="text-xs text-[var(--color-ink-2)]">
                {t("femme.clients.summary.lastVisit")}
              </dt>
              <dd className="text-sm font-medium">
                {summary.lastVisitAt
                  ? formatDate(summary.lastVisitAt, dateLocale)
                  : t("femme.clients.summary.noVisits")}
              </dd>
            </div>
            <div className="min-w-0" data-testid="client-summary-spent">
              <dt className="text-xs text-[var(--color-ink-2)]">
                {t("femme.clients.summary.spentLast12Months")}
              </dt>
              <dd className="text-sm font-medium">
                {formatAmountDecimal(summary.spentLast12Months)}
              </dd>
            </div>
            <div className="min-w-0" data-testid="client-summary-average">
              <dt className="text-xs text-[var(--color-ink-2)]">
                {t("femme.clients.summary.averageTicket")}
              </dt>
              <dd className="text-sm font-medium">
                {formatAmountDecimal(summary.averageTicketLast12Months)}
              </dd>
            </div>
          </dl>

          <section data-testid="client-summary-services" className="flex flex-col gap-2">
            <Heading as="h3" className="text-sm">
              {t("femme.clients.summary.lastServices")}
            </Heading>
            {summary.lastServices.length === 0 ? (
              <Text variant="muted">{t("femme.clients.summary.noServices")}</Text>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[320px] text-left text-sm">
                  <thead>
                    <tr className="border-b text-xs text-[var(--color-ink-2)]">
                      <th className={thClass}>{t("femme.clients.summary.colDate")}</th>
                      <th className={thClass}>{t("femme.clients.summary.colService")}</th>
                      <th className={thClass}>{t("femme.clients.summary.colProfessional")}</th>
                      <th className={thClass}>{t("femme.clients.summary.colPrice")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.lastServices.map((s, i) => (
                      <tr key={i} className="border-b border-[var(--color-border)]/60">
                        <td className={tdClass}>{formatDate(s.performedAt, dateLocale)}</td>
                        <td className={tdClass}>{s.serviceName}</td>
                        <td className={tdClass}>{s.professionalName ?? "—"}</td>
                        <td className={tdClass}>{formatAmountDecimal(s.price)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section data-testid="client-summary-products" className="flex flex-col gap-2">
            <Heading as="h3" className="text-sm">
              {t("femme.clients.summary.lastProducts")}
            </Heading>
            {summary.lastProducts.length === 0 ? (
              <Text variant="muted">{t("femme.clients.summary.noProducts")}</Text>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[320px] text-left text-sm">
                  <thead>
                    <tr className="border-b text-xs text-[var(--color-ink-2)]">
                      <th className={thClass}>{t("femme.clients.summary.colDate")}</th>
                      <th className={thClass}>{t("femme.clients.summary.colProduct")}</th>
                      <th className={thClass}>{t("femme.clients.summary.colQuantity")}</th>
                      <th className={thClass}>{t("femme.clients.summary.colUnitPrice")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.lastProducts.map((p, i) => (
                      <tr key={i} className="border-b border-[var(--color-border)]/60">
                        <td className={tdClass}>{formatDate(p.purchasedAt, dateLocale)}</td>
                        <td className={tdClass}>{p.productName}</td>
                        <td className={tdClass}>{p.quantity}</td>
                        <td className={tdClass}>{formatAmountDecimal(p.unitPrice)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </Card>
  );
}
