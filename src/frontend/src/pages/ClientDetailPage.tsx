import { useCallback, useEffect, useState } from "react";
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
import { translateApiError } from "../api/parseApiErrorMessage";
import { FieldValidationError } from "../components/FieldValidationError";

type Client = {
  id: number;
  fullName: string;
  phone: string | null;
  email: string | null;
  ruc: string | null;
  active: boolean;
  visitCount: number;
};

const PARAGUAY_RUC_PATTERN = /^\d+-\d+$/;

function validateRuc(ruc: string): boolean {
  return PARAGUAY_RUC_PATTERN.test(ruc.trim());
}

export default function ClientDetailPage() {
  const { t } = useTranslation();
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

  async function deactivateClient() {
    if (!client) return;
    if (!window.confirm(t("femme.clients.deactivateConfirm", { name: client.fullName }))) return;
    setDeactivating(true);
    try {
      await femmePostJson<Client>(`/api/clients/${id ?? ""}/deactivate`, {});
      await load();
    } catch (e) {
      setSaveError(translateApiError(e, t, "femme.clients.saveError"));
    } finally {
      setDeactivating(false);
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
            onClick={() => void deactivateClient()}
            disabled={deactivating}
            className="min-h-11 sm:self-auto"
          >
            {t("femme.clients.deactivate")}
          </Button>
        ) : null}
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
              <Alert variant="default" title={t("femme.clients.editSuccess")} className="mb-4">
                {t("femme.clients.editSuccess")}
              </Alert>
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
            <Card className="p-4">
              <Heading as="h2" className="mb-3 text-base">
                {t("femme.clients.appointments")}
              </Heading>
              <Text variant="muted">{t("femme.clients.noAppointments")}</Text>
            </Card>
            <Card className="p-4">
              <Heading as="h2" className="mb-3 text-base">
                {t("femme.clients.invoices")}
              </Heading>
              <Text variant="muted">{t("femme.clients.noInvoices")}</Text>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
