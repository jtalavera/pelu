import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Badge, Button, Heading, Input, Select, Spinner, Text } from "@design-system";
import type { BadgeProps } from "@design-system";
import { translateApiError } from "../api/parseApiErrorMessage";
import {
  acknowledgeWhatsAppAlert,
  getWhatsAppStatus,
  refreshWhatsAppTemplates,
  sendWhatsAppTest,
  type WhatsAppStatus,
} from "../api/platformWhatsapp";
import { ACTION_BUTTON } from "../components/actionButtons";
import { FieldValidationError } from "../components/FieldValidationError";
import { useDateLocale } from "../i18n/dateLocale";

const STATUS_BADGE_VARIANT: Record<string, NonNullable<BadgeProps["variant"]>> = {
  APPROVED: "success",
  PENDING: "warning",
  REJECTED: "destructive",
  PAUSED: "destructive",
  DISABLED: "destructive",
  MISSING: "warning",
  UNKNOWN: "secondary",
};

/**
 * HU-WAP-01/02: Platform → WhatsApp. Shows whether the shared channel is on and configured (only
 * the NAMES of missing values, never a secret), the template catalog with the approval status Meta
 * reports, the open platform alerts, and a test send with the example values of the submission.
 */
export default function PlatformWhatsAppPage() {
  const { t } = useTranslation();
  const dateLocale = useDateLocale();
  const [status, setStatus] = useState<WhatsAppStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [testTemplate, setTestTemplate] = useState("");
  const [testPhone, setTestPhone] = useState("");
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const s = await getWhatsAppStatus();
      setStatus(s);
      setTestTemplate((cur) => cur || s.templates[0]?.name || "");
    } catch (e) {
      setError(translateApiError(e, t, "femme.platform.whatsapp.loadError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function refresh() {
    setRefreshing(true);
    setError(null);
    try {
      setStatus(await refreshWhatsAppTemplates());
    } catch (e) {
      setError(translateApiError(e, t, "femme.apiErrors.GENERIC"));
    } finally {
      setRefreshing(false);
    }
  }

  async function acknowledge(id: number) {
    setError(null);
    try {
      setStatus(await acknowledgeWhatsAppAlert(id));
    } catch (e) {
      setError(translateApiError(e, t, "femme.apiErrors.GENERIC"));
    }
  }

  async function onTestSubmit(ev: FormEvent) {
    ev.preventDefault();
    setTestResult(null);
    setTestError(null);
    if (testPhone.trim() === "") {
      setPhoneError(t("femme.platform.whatsapp.testPhoneRequired"));
      return;
    }
    setPhoneError(null);
    setTesting(true);
    try {
      const r = await sendWhatsAppTest(testPhone.trim(), testTemplate);
      setTestResult(t("femme.platform.whatsapp.testSent", { wamid: r.wamid }));
    } catch (e) {
      setTestError(translateApiError(e, t, "femme.apiErrors.GENERIC"));
    } finally {
      setTesting(false);
    }
  }

  const fmt = (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat(dateLocale, { dateStyle: "short", timeStyle: "short" }).format(
          new Date(iso),
        )
      : "—";

  const th = "px-3 py-2 text-left text-[11px] font-medium uppercase text-[var(--color-ink-3)]";
  const td = "px-3 py-2 align-top text-[12px] text-[var(--color-ink)]";
  const card =
    "rounded-[var(--radius-xl)] border border-[var(--color-stone-md)] bg-[var(--color-white)] p-4";

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
      <div>
        <Heading as="h1">{t("femme.platform.whatsapp.title")}</Heading>
        <Text variant="muted">{t("femme.platform.whatsapp.lead")}</Text>
      </div>

      {error ? (
        <Alert variant="destructive" data-testid="whatsapp-error">
          {error}
        </Alert>
      ) : null}

      {loading && !status ? (
        <div className="flex items-center gap-2">
          <Spinner size="md" />
          <Text variant="muted">{t("femme.platform.loading")}</Text>
        </div>
      ) : null}

      {status ? (
        <>
          <section className={card} aria-labelledby="whatsapp-channel-title">
            <Heading as="h2" id="whatsapp-channel-title">
              {t("femme.platform.whatsapp.channelTitle")}
            </Heading>
            <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <dt className="text-sm text-[var(--color-ink-2)]">
                  {t("femme.platform.whatsapp.switch")}
                </dt>
                <dd data-testid="whatsapp-switch">
                  <Badge variant={status.enabled ? "success" : "secondary"}>
                    {status.enabled
                      ? t("femme.platform.whatsapp.switchOn")
                      : t("femme.platform.whatsapp.switchOff")}
                  </Badge>
                </dd>
              </div>
              <div>
                <dt className="text-sm text-[var(--color-ink-2)]">
                  {t("femme.platform.whatsapp.provider")}
                </dt>
                <dd data-testid="whatsapp-provider">
                  {status.provider === "fake"
                    ? t("femme.platform.whatsapp.providerFake")
                    : t("femme.platform.whatsapp.providerMeta")}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-[var(--color-ink-2)]">
                  {t("femme.platform.whatsapp.operational")}
                </dt>
                <dd data-testid="whatsapp-operational">
                  <Badge variant={status.operational ? "success" : "destructive"}>
                    {status.operational
                      ? t("femme.platform.whatsapp.yes")
                      : t("femme.platform.whatsapp.no")}
                  </Badge>
                </dd>
              </div>
              <div>
                <dt className="text-sm text-[var(--color-ink-2)]">
                  {t("femme.platform.whatsapp.apiVersion")}
                </dt>
                <dd>{status.apiVersion}</dd>
              </div>
            </dl>
            {status.configurationProblems.length > 0 ? (
              <Alert variant="destructive" className="mt-3" data-testid="whatsapp-config-problems">
                <p>{t("femme.platform.whatsapp.missingTitle")}</p>
                <ul className="mt-1 list-disc pl-5 font-mono text-[12px]">
                  {status.configurationProblems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </Alert>
            ) : null}
          </section>

          <section className={card} aria-labelledby="whatsapp-alerts-title">
            <Heading as="h2" id="whatsapp-alerts-title">
              {t("femme.platform.whatsapp.alertsTitle")}
            </Heading>
            {status.alerts.length === 0 ? (
              <Text variant="muted" data-testid="whatsapp-no-alerts">
                {t("femme.platform.whatsapp.noAlerts")}
              </Text>
            ) : (
              <ul className="mt-2 flex flex-col gap-2" data-testid="whatsapp-alerts">
                {status.alerts.map((a) => (
                  <li
                    key={a.id}
                    data-testid={`whatsapp-alert-${a.id}`}
                    className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <Text className="font-medium">
                        {t(`femme.platform.whatsapp.alertCategory.${a.category}`, a.category)} —{" "}
                        <span className="font-mono text-[12px]">{a.subject}</span>
                      </Text>
                      {a.detail ? (
                        <Text variant="muted" className="break-words text-[12px]">
                          {a.detail}
                        </Text>
                      ) : null}
                      <Text variant="muted" className="text-[11px]">
                        {fmt(a.createdAt)}
                      </Text>
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      className={ACTION_BUTTON}
                      onClick={() => void acknowledge(a.id)}
                    >
                      {t("femme.platform.whatsapp.acknowledge")}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={card} aria-labelledby="whatsapp-templates-title">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <Heading as="h2" id="whatsapp-templates-title">
                  {t("femme.platform.whatsapp.templatesTitle")}
                </Heading>
                <Text variant="muted">{t("femme.platform.whatsapp.templatesLead")}</Text>
              </div>
              <Button
                type="button"
                variant="secondary"
                className={ACTION_BUTTON}
                disabled={refreshing}
                data-testid="whatsapp-refresh"
                onClick={() => void refresh()}
              >
                {refreshing
                  ? t("femme.platform.whatsapp.refreshing")
                  : t("femme.platform.whatsapp.refresh")}
              </Button>
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse" data-testid="whatsapp-templates">
                <thead>
                  <tr>
                    <th className={th}>{t("femme.platform.whatsapp.colName")}</th>
                    <th className={th}>{t("femme.platform.whatsapp.colCategory")}</th>
                    <th className={th}>{t("femme.platform.whatsapp.colVariables")}</th>
                    <th className={th}>{t("femme.platform.whatsapp.colButtons")}</th>
                    <th className={th}>{t("femme.platform.whatsapp.colStatus")}</th>
                    <th className={th}>{t("femme.platform.whatsapp.colReason")}</th>
                    <th className={th}>{t("femme.platform.whatsapp.colChecked")}</th>
                  </tr>
                </thead>
                <tbody>
                  {status.templates.map((tpl) => (
                    <tr
                      key={tpl.name}
                      data-testid={`whatsapp-template-${tpl.name}`}
                      className="border-t border-[var(--color-stone-md)]"
                    >
                      <td className={`${td} font-mono`}>{tpl.name}</td>
                      <td className={td}>
                        {t(`femme.platform.whatsapp.category.${tpl.category}`, tpl.category)}
                      </td>
                      <td className={td}>{tpl.bodyVariables}</td>
                      <td className={td}>{tpl.buttons}</td>
                      <td className={td}>
                        <div data-testid={`whatsapp-template-status-${tpl.name}`}>
                          <Badge
                            variant={STATUS_BADGE_VARIANT[tpl.status] ?? "outline"}
                            data-status={tpl.status}
                          >
                            {t(`femme.platform.whatsapp.status.${tpl.status}`, tpl.status)}
                          </Badge>
                        </div>
                      </td>
                      <td className={`${td} max-w-[220px] break-words`}>{tpl.reason ?? "—"}</td>
                      <td className={`${td} whitespace-nowrap`}>{fmt(tpl.checkedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className={card} aria-labelledby="whatsapp-test-title">
            <Heading as="h2" id="whatsapp-test-title">
              {t("femme.platform.whatsapp.testTitle")}
            </Heading>
            <Text variant="muted">{t("femme.platform.whatsapp.testLead")}</Text>
            <form
              className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end"
              onSubmit={(ev) => void onTestSubmit(ev)}
              noValidate
            >
              <div className="w-full min-w-0 sm:max-w-xs">
                <label htmlFor="whatsapp-test-template" className="text-sm text-[var(--color-ink-2)]">
                  {t("femme.platform.whatsapp.testTemplate")}
                </label>
                <Select
                  id="whatsapp-test-template"
                  className="mt-1 w-full"
                  value={testTemplate}
                  onChange={(e) => setTestTemplate(e.target.value)}
                >
                  {status.templates.map((tpl) => (
                    <option key={tpl.name} value={tpl.name}>
                      {tpl.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="w-full min-w-0 sm:max-w-xs">
                <label htmlFor="whatsapp-test-phone" className="text-sm text-[var(--color-ink-2)]">
                  {t("femme.platform.whatsapp.testPhone")}
                </label>
                <Input
                  id="whatsapp-test-phone"
                  className="mt-1"
                  inputMode="tel"
                  autoComplete="off"
                  placeholder={t("femme.platform.whatsapp.testPhonePlaceholder")}
                  value={testPhone}
                  invalid={phoneError != null}
                  aria-describedby={phoneError ? "whatsapp-test-phone-error" : undefined}
                  onChange={(e) => setTestPhone(e.target.value)}
                />
                <FieldValidationError id="whatsapp-test-phone-error">
                  {phoneError}
                </FieldValidationError>
              </div>
              <Button
                type="submit"
                className={ACTION_BUTTON}
                disabled={testing || testTemplate === ""}
                data-testid="whatsapp-test-send"
              >
                {testing
                  ? t("femme.platform.whatsapp.testSending")
                  : t("femme.platform.whatsapp.testSend")}
              </Button>
            </form>
            {testResult ? (
              <Alert variant="success" className="mt-3" data-testid="whatsapp-test-result">
                {testResult}
              </Alert>
            ) : null}
            {testError ? (
              <Alert variant="destructive" className="mt-3" data-testid="whatsapp-test-error">
                {testError}
              </Alert>
            ) : null}
          </section>
        </>
      ) : null}
    </div>
  );
}
