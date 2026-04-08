import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Card, Heading, Spinner, Text } from "@design-system";
import { femmeJson } from "../api/femmeClient";

type DashboardResponse = {
  appointmentsToday: {
    total: number;
    pending: number;
    confirmed: number;
    inProgress: number;
    completed: number;
  };
  revenueDay: { invoiced: string | number; collected: string | number };
  revenueWeek: { invoiced: string | number; collected: string | number };
  fiscalAlerts: Array<{ severity: string; messageKey: string; message: string }>;
};

function fmtMoney(v: string | number) {
  return typeof v === "number" ? String(v) : v;
}

const POLL_MS = 60_000;

export default function DashboardPage() {
  const { t } = useTranslation();
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await femmeJson<DashboardResponse>("/api/dashboard", { json: false });
      setData(res);
      setError(null);
    } catch {
      setError(t("femme.dashboard.error"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(id);
  }, [load]);

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center gap-3">
        <Spinner size="lg" />
        <Text>{t("femme.dashboard.loading")}</Text>
      </div>
    );
  }

  if (error || !data) {
    return (
      <Alert variant="destructive" title={t("femme.dashboard.error")}>
        {error}
      </Alert>
    );
  }

  const a = data.appointmentsToday;
  const empty = a.total === 0;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div>
        <Heading as="h1">{t("femme.dashboard.title")}</Heading>
        <Text variant="muted" className="mt-1">
          {t("femme.dashboard.appointmentsToday")}
        </Text>
      </div>

      {empty ? (
        <Alert variant="default" title={t("femme.dashboard.emptyDay")} />
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card className="p-4">
          <Text variant="label">{t("femme.dashboard.total")}</Text>
          <Heading as="h2" className="mt-2 text-3xl">
            {a.total}
          </Heading>
        </Card>
        <Card className="p-4">
          <Text variant="label">{t("femme.dashboard.pending")}</Text>
          <Heading as="h2" className="mt-2 text-3xl">
            {a.pending}
          </Heading>
        </Card>
        <Card className="p-4">
          <Text variant="label">{t("femme.dashboard.confirmed")}</Text>
          <Heading as="h2" className="mt-2 text-3xl">
            {a.confirmed}
          </Heading>
        </Card>
        <Card className="p-4">
          <Text variant="label">{t("femme.dashboard.inProgress")}</Text>
          <Heading as="h2" className="mt-2 text-3xl">
            {a.inProgress}
          </Heading>
        </Card>
        <Card className="p-4">
          <Text variant="label">{t("femme.dashboard.completed")}</Text>
          <Heading as="h2" className="mt-2 text-3xl">
            {a.completed}
          </Heading>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="p-4">
          <Text variant="label">{t("femme.dashboard.revenueDay")}</Text>
          <div className="mt-2 flex flex-col gap-1">
            <Text>
              {t("femme.dashboard.invoiced")}: {fmtMoney(data.revenueDay.invoiced)}
            </Text>
            <Text>
              {t("femme.dashboard.collected")}: {fmtMoney(data.revenueDay.collected)}
            </Text>
          </div>
        </Card>
        <Card className="p-4">
          <Text variant="label">{t("femme.dashboard.revenueWeek")}</Text>
          <div className="mt-2 flex flex-col gap-1">
            <Text>
              {t("femme.dashboard.invoiced")}: {fmtMoney(data.revenueWeek.invoiced)}
            </Text>
            <Text>
              {t("femme.dashboard.collected")}: {fmtMoney(data.revenueWeek.collected)}
            </Text>
          </div>
        </Card>
      </div>

      {data.fiscalAlerts.length > 0 ? (
        <div>
          <Text variant="label" className="mb-2">
            {t("femme.dashboard.fiscalAlerts")}
          </Text>
          <div className="flex flex-col gap-2">
            {data.fiscalAlerts.map((al, i) => (
              <Alert
                key={`${al.messageKey}-${i}`}
                variant={al.severity === "blocking" ? "destructive" : "warning"}
                title={t(`femme.dashboard.alerts.${al.messageKey}`, { defaultValue: al.message })}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
