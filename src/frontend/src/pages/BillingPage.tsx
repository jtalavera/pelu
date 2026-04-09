import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Button,
  Card,
  Heading,
  Input,
  Label,
  Spinner,
  Text,
} from "@design-system";
import { femmeJson, femmePostJson } from "../api/femmeClient";
import { translateApiError } from "../api/parseApiErrorMessage";
import { FieldValidationError } from "../components/FieldValidationError";

type CashSession = {
  id: number;
  tenantId: number;
  openedByUserId: number;
  openedByEmail: string;
  openedAt: string;
  openingCashAmount: string;
  isOpen: boolean;
};

function formatDateTime(isoString: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(isoString));
  } catch {
    return isoString;
  }
}

export default function BillingPage() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [currentSession, setCurrentSession] = useState<CashSession | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [openingAmount, setOpeningAmount] = useState("");
  const [amountError, setAmountError] = useState<string | null>(null);

  const loadCurrentSession = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await femmeJson<CashSession | undefined>("/api/cash-sessions/current");
      setCurrentSession(data ?? null);
    } catch {
      setLoadError(t("femme.billing.loadError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadCurrentSession();
  }, [loadCurrentSession]);

  function validateAmount(raw: string): boolean {
    const trimmed = raw.trim();
    if (trimmed === "") {
      setAmountError(t("femme.billing.openingCashAmountInvalid"));
      return false;
    }
    const parsed = Number(trimmed);
    if (isNaN(parsed) || parsed < 0) {
      setAmountError(t("femme.billing.openingCashAmountInvalid"));
      return false;
    }
    setAmountError(null);
    return true;
  }

  async function onOpenSession(e: React.FormEvent) {
    e.preventDefault();
    setSuccess(false);
    setSaveError(null);

    if (!validateAmount(openingAmount)) return;

    setSubmitting(true);
    try {
      const session = await femmePostJson<CashSession>("/api/cash-sessions/open", {
        openingCashAmount: Number(openingAmount.trim()),
      });
      setCurrentSession(session);
      setOpeningAmount("");
      setAmountError(null);
      setSuccess(true);
    } catch (err) {
      setSaveError(translateApiError(err, t, "femme.billing.saveError"));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center gap-3">
        <Spinner size="lg" />
        <Text>{t("femme.billing.loading")}</Text>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Heading as="h1">{t("femme.billing.title")}</Heading>
        <Text variant="muted" className="mt-1">
          {t("femme.billing.lead")}
        </Text>
      </div>

      {loadError ? (
        <Alert variant="destructive" title={t("femme.billing.errorTitle")}>
          {loadError}
        </Alert>
      ) : null}
      {saveError ? (
        <Alert variant="destructive" title={t("femme.billing.errorTitle")}>
          {saveError}
        </Alert>
      ) : null}
      {success ? (
        <Alert variant="success" title={t("femme.billing.savedTitle")}>
          {t("femme.billing.savedBody")}
        </Alert>
      ) : null}

      <Card className="p-4 sm:p-6">
        <div className="flex items-center gap-3">
          <span
            className={`inline-block h-3 w-3 rounded-full ${currentSession ? "bg-emerald-500" : "bg-slate-400"}`}
            aria-hidden="true"
          />
          <Heading as="h2" className="text-lg">
            {currentSession
              ? t("femme.billing.sessionOpen")
              : t("femme.billing.sessionClosed")}
          </Heading>
        </div>

        {currentSession ? (
          <div className="mt-4 flex flex-col gap-2">
            <div className="flex flex-wrap gap-x-6 gap-y-1">
              <Text variant="small" className="text-[rgb(var(--color-muted-foreground))]">
                <span className="font-medium text-[rgb(var(--color-foreground))]">
                  {t("femme.billing.openedAt")}:{" "}
                </span>
                {formatDateTime(currentSession.openedAt)}
              </Text>
              <Text variant="small" className="text-[rgb(var(--color-muted-foreground))]">
                <span className="font-medium text-[rgb(var(--color-foreground))]">
                  {t("femme.billing.openedBy")}:{" "}
                </span>
                {currentSession.openedByEmail}
              </Text>
              <Text variant="small" className="text-[rgb(var(--color-muted-foreground))]">
                <span className="font-medium text-[rgb(var(--color-foreground))]">
                  {t("femme.billing.initialAmount")}:{" "}
                </span>
                {Number(currentSession.openingCashAmount).toLocaleString()}
              </Text>
            </div>
          </div>
        ) : (
          <Text variant="muted" className="mt-3">
            {t("femme.billing.noOpenSession")}
          </Text>
        )}
      </Card>

      {!currentSession ? (
        <Card className="p-4 sm:p-6">
          <Heading as="h2" className="text-lg">
            {t("femme.billing.openTitle")}
          </Heading>
          <form className="mt-4 flex flex-col gap-4" onSubmit={onOpenSession} noValidate>
            <div>
              <Label htmlFor="opening-amount">{t("femme.billing.openingCashAmount")}</Label>
              <Input
                id="opening-amount"
                inputMode="decimal"
                value={openingAmount}
                onChange={(e) => {
                  setOpeningAmount(e.target.value);
                  setAmountError(null);
                  setSaveError(null);
                  setSuccess(false);
                }}
                className="mt-1 w-full"
                placeholder="0"
                aria-invalid={!!amountError}
                aria-describedby={amountError ? "amount-err" : "amount-hint"}
              />
              <FieldValidationError id="amount-err">{amountError}</FieldValidationError>
              <Text
                variant="small"
                id="amount-hint"
                className="mt-1 text-[rgb(var(--color-muted-foreground))]"
              >
                {t("femme.billing.openingCashAmountHint")}
              </Text>
            </div>
            <Button
              type="submit"
              variant="primary"
              className="min-h-11 w-full sm:w-auto"
              disabled={submitting}
            >
              {submitting ? t("femme.billing.opening") : t("femme.billing.open")}
            </Button>
          </form>
        </Card>
      ) : null}
    </div>
  );
}
