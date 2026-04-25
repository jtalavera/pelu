import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Badge,
  Button,
  Card,
  Heading,
  Input,
  Label,
  Spinner,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Text,
} from "@design-system";
import { femmeJson, femmePutJson, femmePostJson } from "../api/femmeClient";
import { listAppointments, type Appointment } from "../api/appointments";
import { listInvoicesByClientId, type InvoiceListItem } from "../api/invoices";
import { translateApiError } from "../api/parseApiErrorMessage";
import { FieldValidationError } from "../components/FieldValidationError";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { StatusBadge } from "../components/StatusBadge";
import { useDateLocale } from "../i18n/dateLocale";
import { formatAmountDecimal } from "../lib/formatMoney";
import { validateRuc } from "../lib/validateRuc";

type Client = {
  id: number;
  fullName: string;
  phone: string | null;
  email: string | null;
  ruc: string | null;
  active: boolean;
  visitCount: number;
};

function formatHistoryDateTime(iso: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function clientAppointmentsTimeRange(): { from: string; to: string } {
  const from = new Date();
  from.setFullYear(from.getFullYear() - 3);
  from.setHours(0, 0, 0, 0);
  const to = new Date();
  to.setFullYear(to.getFullYear() + 3);
  to.setHours(23, 59, 59, 999);
  return { from: from.toISOString(), to: to.toISOString() };
}

function splitAppointmentsByTime(appointments: Appointment[]): {
  upcoming: Appointment[];
  past: Appointment[];
} {
  const t = Date.now();
  const upcoming: Appointment[] = [];
  const past: Appointment[] = [];
  for (const a of appointments) {
    const s = new Date(a.startAt).getTime();
    if (s >= t) {
      upcoming.push(a);
    } else {
      past.push(a);
    }
  }
  upcoming.sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
  past.sort((a, b) => new Date(b.startAt).getTime() - new Date(a.startAt).getTime());
  return { upcoming, past };
}

function HistoryInvoiceStatusPill({ status }: { status: string }) {
  const { t } = useTranslation();
  let bg = "var(--color-warning-lt)";
  let color = "var(--color-warning)";
  let label = t("femme.billing.session.statusPending");
  if (status === "ISSUED") {
    bg = "var(--color-success-lt)";
    color = "var(--color-success)";
    label = t("femme.billing.session.statusIssued");
  } else if (status === "VOIDED") {
    bg = "var(--color-danger-lt)";
    color = "var(--color-danger)";
    label = t("femme.billing.session.statusVoided");
  }
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 500,
        padding: "2px 8px",
        borderRadius: "var(--radius-pill)",
        display: "inline-block",
        whiteSpace: "nowrap",
        background: bg,
        color,
      }}
    >
      {label}
    </span>
  );
}

export default function ClientDetailPage() {
  const { t } = useTranslation();
  const dateLocale = useDateLocale();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [client, setClient] = useState<Client | null>(null);

  const [tab, setTab] = useState("info");

  // Edit form state
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [ruc, setRuc] = useState("");
  const [fieldError, setFieldError] = useState<{
    fullName?: string;
    ruc?: string;
  } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saving, setSaving] = useState(false);

  const [deactivating, setDeactivating] = useState(false);
  const [deactivateTarget, setDeactivateTarget] = useState<Client | null>(null);
  const [reactivating, setReactivating] = useState(false);

  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyAppointments, setHistoryAppointments] = useState<Appointment[] | null>(null);
  const [historyInvoices, setHistoryInvoices] = useState<InvoiceListItem[] | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await femmeJson<Client>(`/api/clients/${id ?? ""}`);
      setClient(data);
      setFullName(data.fullName);
      setPhone(data.phone ?? "");
      setEmail(data.email ?? "");
      setRuc(data.ruc ?? "");
    } catch {
      setLoadError(t("femme.clients.profileLoadError"));
    } finally {
      setLoading(false);
    }
  }, [id, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setHistoryAppointments(null);
    setHistoryInvoices(null);
    setHistoryError(null);
  }, [id]);

  const clientIdNum = id ? Number(id) : NaN;

  useEffect(() => {
    if (tab !== "history" || !id || Number.isNaN(clientIdNum)) return;
    let cancelled = false;
    (async () => {
      setHistoryLoading(true);
      setHistoryError(null);
      const range = clientAppointmentsTimeRange();
      try {
        const [inv, appts] = await Promise.all([
          listInvoicesByClientId(clientIdNum),
          listAppointments(range.from, range.to, null, clientIdNum),
        ]);
        if (!cancelled) {
          setHistoryInvoices(inv);
          setHistoryAppointments(appts);
        }
      } catch (e) {
        if (!cancelled) {
          setHistoryError(translateApiError(e, t, "femme.clients.historyLoadError"));
          setHistoryInvoices(null);
          setHistoryAppointments(null);
        }
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab, id, clientIdNum, t]);

  const apptUpcomingPast = useMemo(
    () =>
      historyAppointments != null
        ? splitAppointmentsByTime(historyAppointments)
        : { upcoming: [] as Appointment[], past: [] as Appointment[] },
    [historyAppointments],
  );

  async function saveClient() {
    setFieldError(null);
    setSaveError(null);
    setSaveSuccess(false);
    const nextErr: NonNullable<typeof fieldError> = {};

    if (!fullName.trim()) {
      nextErr.fullName = t("femme.clients.fullNameRequired");
    }
    if (ruc.trim() && !validateRuc(ruc)) {
      nextErr.ruc = t("femme.clients.rucInvalid");
    }
    if (Object.keys(nextErr).length > 0) {
      setFieldError(nextErr);
      return;
    }

    setSaving(true);
    try {
      const updated = await femmePutJson<Client>(`/api/clients/${id ?? ""}`, {
        fullName: fullName.trim(),
        phone: phone.trim() || null,
        email: email.trim() || null,
        ruc: ruc.trim() || null,
      });
      setClient(updated);
      setFullName(updated.fullName);
      setPhone(updated.phone ?? "");
      setEmail(updated.email ?? "");
      setRuc(updated.ruc ?? "");
      setSaveSuccess(true);
    } catch (e) {
      setSaveError(translateApiError(e, t, "femme.clients.saveError"));
    } finally {
      setSaving(false);
    }
  }

  async function confirmDeactivate() {
    if (!deactivateTarget || !id) return;
    setDeactivating(true);
    try {
      await femmePostJson<Client>(`/api/clients/${id}/deactivate`, {});
      setDeactivateTarget(null);
      await load();
    } catch (e) {
      setSaveError(translateApiError(e, t, "femme.clients.saveError"));
      setDeactivateTarget(null);
    } finally {
      setDeactivating(false);
    }
  }

  async function activateClient() {
    if (!client || !id) return;
    setReactivating(true);
    try {
      await femmePostJson<Client>(`/api/clients/${id}/activate`, {});
      await load();
    } catch (e) {
      setSaveError(translateApiError(e, t, "femme.clients.saveError"));
    } finally {
      setReactivating(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center gap-3">
        <Spinner size="lg" />
        <Text>{t("femme.clients.loading")}</Text>
      </div>
    );
  }

  if (loadError || !client) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <Button
          type="button"
          variant="ghost"
          onClick={() => navigate("/app/clients")}
          className="self-start"
        >
          ← {t("femme.clients.backToList")}
        </Button>
        <Alert variant="destructive" title={t("femme.clients.errorTitle")}>
          {loadError ?? t("femme.clients.profileLoadError")}
        </Alert>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Button
          type="button"
          variant="ghost"
          onClick={() => navigate("/app/clients")}
          className="self-start"
        >
          ← {t("femme.clients.backToList")}
        </Button>
        {client.active ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => setDeactivateTarget(client)}
            disabled={deactivating}
            className="min-h-11 sm:self-auto"
          >
            {t("femme.clients.deactivate")}
          </Button>
        ) : (
          <Button
            type="button"
            variant="ghost"
            onClick={() => void activateClient()}
            disabled={reactivating}
            className="min-h-11 sm:self-auto"
          >
            {reactivating ? t("femme.clients.reactivating") : t("femme.clients.reactivate")}
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <Heading as="h1">{client.fullName}</Heading>
          {!client.active ? (
            <Badge variant="secondary">{t("femme.clients.inactive")}</Badge>
          ) : null}
        </div>
        <Text variant="muted">
          {t("femme.clients.visits", { count: client.visitCount })}
        </Text>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="info">{t("femme.clients.basicInfo")}</TabsTrigger>
          <TabsTrigger value="history">{t("femme.clients.history")}</TabsTrigger>
        </TabsList>

        <TabsContent value="info">
          <Card className="p-6">
            {saveSuccess ? (
              <Alert variant="default" title={t("femme.clients.editSuccess")} className="mb-4" />
            ) : null}
            {saveError ? (
              <Alert variant="destructive" title={t("femme.clients.errorTitle")} className="mb-4">
                {saveError}
              </Alert>
            ) : null}

            <div className="flex flex-col gap-4">
              <div>
                <Label htmlFor="detail-fullname">{t("femme.clients.fullName")}</Label>
                <Input
                  id="detail-fullname"
                  value={fullName}
                  onChange={(e) => { setFullName(e.target.value); setSaveSuccess(false); }}
                  aria-invalid={fieldError?.fullName ? "true" : "false"}
                  aria-describedby={fieldError?.fullName ? "detail-fullname-err" : undefined}
                />
                <FieldValidationError id="detail-fullname-err">
                  {fieldError?.fullName}
                </FieldValidationError>
              </div>

              <div>
                <Label htmlFor="detail-phone">{t("femme.clients.phone")}</Label>
                <Input
                  id="detail-phone"
                  value={phone}
                  onChange={(e) => { setPhone(e.target.value); setSaveSuccess(false); }}
                  inputMode="tel"
                />
              </div>

              <div>
                <Label htmlFor="detail-email">{t("femme.clients.email")}</Label>
                <Input
                  id="detail-email"
                  type="email"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setSaveSuccess(false); }}
                />
              </div>

              <div>
                <Label htmlFor="detail-ruc">{t("femme.clients.ruc")}</Label>
                <Input
                  id="detail-ruc"
                  value={ruc}
                  onChange={(e) => { setRuc(e.target.value); setSaveSuccess(false); }}
                  placeholder="80000005-6"
                  aria-invalid={fieldError?.ruc ? "true" : "false"}
                  aria-describedby={fieldError?.ruc ? "detail-ruc-err" : undefined}
                />
                <Text variant="muted" className="mt-1 text-sm">
                  {t("femme.clients.rucHint")}
                </Text>
                <FieldValidationError id="detail-ruc-err">{fieldError?.ruc}</FieldValidationError>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  onClick={() => void saveClient()}
                  disabled={saving || !client.active}
                  className="min-h-11"
                >
                  {saving ? t("femme.clients.saving") : t("femme.clients.save")}
                </Button>
              </div>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="history">
          <div className="flex flex-col gap-4">
            {historyError ? (
              <Alert variant="destructive" title={t("femme.clients.errorTitle")}>
                {historyError}
              </Alert>
            ) : null}
            {tab === "history" && historyLoading ? (
              <div className="flex items-center justify-center gap-2 py-6">
                <Spinner size="md" />
                <Text>{t("femme.clients.loading")}</Text>
              </div>
            ) : null}
            {tab === "history" && !historyLoading && !historyError ? (
              <>
                <Card className="p-4">
                  <Heading as="h2" className="mb-3 text-base">
                    {t("femme.clients.appointments")}
                  </Heading>
                  {historyAppointments == null ? null : (
                    <div className="flex flex-col gap-4">
                      <div>
                        <Text className="mb-2 text-sm font-medium">
                          {t("femme.clients.historyUpcoming")}
                        </Text>
                        {apptUpcomingPast.upcoming.length === 0 ? (
                          <Text variant="muted" className="text-sm">
                            {t("femme.clients.noAppointments")}
                          </Text>
                        ) : (
                          <ul className="flex flex-col gap-2" role="list">
                            {apptUpcomingPast.upcoming.map((a) => (
                              <li
                                key={a.id}
                                className="flex flex-col gap-1 rounded-md border border-[var(--color-border)]/60 p-3 sm:flex-row sm:items-center sm:justify-between"
                              >
                                <div>
                                  <Text className="font-medium">
                                    {a.serviceName}
                                  </Text>
                                  <Text variant="muted" className="text-sm">
                                    {formatHistoryDateTime(a.startAt, dateLocale)} ·{" "}
                                    {a.professionalName}
                                  </Text>
                                </div>
                                <div className="self-start sm:self-center">
                                  <StatusBadge status={a.status} />
                                </div>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      <div>
                        <Text className="mb-2 text-sm font-medium">
                          {t("femme.clients.historyPast")}
                        </Text>
                        {apptUpcomingPast.past.length === 0 ? (
                          <Text variant="muted" className="text-sm">
                            {t("femme.clients.noAppointments")}
                          </Text>
                        ) : (
                          <ul className="flex flex-col gap-2" role="list">
                            {apptUpcomingPast.past.map((a) => (
                              <li
                                key={a.id}
                                className="flex flex-col gap-1 rounded-md border border-[var(--color-border)]/60 p-3 sm:flex-row sm:items-center sm:justify-between"
                              >
                                <div>
                                  <Text className="font-medium">
                                    {a.serviceName}
                                  </Text>
                                  <Text variant="muted" className="text-sm">
                                    {formatHistoryDateTime(a.startAt, dateLocale)} ·{" "}
                                    {a.professionalName}
                                  </Text>
                                </div>
                                <div className="self-start sm:self-center">
                                  <StatusBadge status={a.status} />
                                </div>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  )}
                </Card>
                <Card className="p-4">
                  <Heading as="h2" className="mb-3 text-base">
                    {t("femme.clients.invoices")}
                  </Heading>
                  {historyInvoices == null || historyInvoices.length === 0 ? (
                    <Text variant="muted">{t("femme.clients.noInvoices")}</Text>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[320px] text-left text-sm">
                        <thead>
                          <tr className="border-b text-xs text-[var(--color-ink-2)]">
                            <th className="py-2 pr-2 font-medium">
                              {t("femme.billing.history.colNumber")}
                            </th>
                            <th className="py-2 pr-2 font-medium">
                              {t("femme.billing.history.colDate")}
                            </th>
                            <th className="py-2 pr-2 font-medium">
                              {t("femme.billing.history.colTotal")}
                            </th>
                            <th className="py-2 font-medium">
                              {t("femme.clients.colStatus")}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {historyInvoices.map((inv) => (
                            <tr
                              key={inv.id}
                              className="border-b border-[var(--color-border)]/60"
                            >
                              <td className="py-2 pr-2 align-top font-mono text-xs">
                                {inv.invoiceNumberFormatted}
                              </td>
                              <td className="py-2 pr-2 align-top">
                                {formatHistoryDateTime(inv.issuedAt, dateLocale)}
                              </td>
                              <td className="py-2 pr-2 align-top">
                                {formatAmountDecimal(inv.total)}
                              </td>
                              <td className="py-2 align-top">
                                <HistoryInvoiceStatusPill status={inv.status} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Card>
              </>
            ) : null}
          </div>
        </TabsContent>
      </Tabs>

      {deactivateTarget ? (
        <ConfirmDialog
          open
          title={t("femme.clients.deactivateDialogTitle")}
          description={t("femme.clients.deactivateDialogDescription", {
            name: deactivateTarget.fullName,
          })}
          cancelLabel={t("femme.clients.cancel")}
          confirmLabel={t("femme.clients.deactivate")}
          onCancel={() => setDeactivateTarget(null)}
          onConfirm={() => void confirmDeactivate()}
        />
      ) : null}
    </div>
  );
}
