import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Button,
  Card,
  Heading,
  Input,
  Label,
  Modal,
  Spinner,
  Text,
} from "@design-system";
import { femmeJson, femmePostJson } from "../api/femmeClient";
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

export default function ClientsPage() {
  const { t } = useTranslation();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clients, setClients] = useState<Client[]>([]);

  const [q, setQ] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [ruc, setRuc] = useState("");
  const [fieldError, setFieldError] = useState<{
    fullName?: string;
    ruc?: string;
  } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await femmeJson<Client[]>("/api/clients");
      setClients(Array.isArray(data) ? data : []);
    } catch {
      setError(t("femme.clients.loadError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (q.trim()) qs.set("q", q.trim());
      const data = await femmeJson<Client[]>(`/api/clients?${qs.toString()}`);
      setClients(Array.isArray(data) ? data : []);
    } catch {
      setError(t("femme.clients.loadError"));
    }
  }

  function openNew() {
    setFullName("");
    setPhone("");
    setEmail("");
    setRuc("");
    setFieldError(null);
    setSaveError(null);
    setModalOpen(true);
  }

  async function saveClient() {
    setFieldError(null);
    setSaveError(null);
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
      await femmePostJson<Client>("/api/clients", {
        fullName: fullName.trim(),
        phone: phone.trim() || null,
        email: email.trim() || null,
        ruc: ruc.trim() || null,
      });
      setModalOpen(false);
      await load();
    } catch (e) {
      setSaveError(translateApiError(e, t, "femme.clients.saveError"));
    } finally {
      setSaving(false);
    }
  }

  async function deactivateClient(client: Client) {
    if (!window.confirm(t("femme.clients.deactivateConfirm", { name: client.fullName }))) return;
    try {
      await femmePostJson<Client>(`/api/clients/${client.id}/deactivate`, {});
      await load();
    } catch (e) {
      setError(translateApiError(e, t, "femme.clients.saveError"));
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

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <Heading as="h1">{t("femme.clients.title")}</Heading>
          <Text variant="muted" className="mt-1">
            {t("femme.clients.lead")}
          </Text>
        </div>
        <Button type="button" onClick={openNew} className="w-full sm:w-auto">
          {t("femme.clients.add")}
        </Button>
      </div>

      {error ? (
        <Alert variant="destructive" title={t("femme.clients.errorTitle")}>
          {error}
        </Alert>
      ) : null}

      <Card className="p-4">
        <form onSubmit={onSearchSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1 min-w-0">
            <Label htmlFor="client-q">{t("femme.clients.search.label")}</Label>
            <Input
              id="client-q"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("femme.clients.search.placeholder")}
            />
          </div>
          <Button type="submit" className="w-full sm:w-auto">
            {t("femme.clients.search.submit")}
          </Button>
        </form>
      </Card>

      <div className="flex flex-col gap-3">
        {clients.length === 0 ? (
          <Alert variant="default" title={t("femme.clients.emptyTitle")}>
            {t("femme.clients.emptyBody")}
          </Alert>
        ) : null}
        {clients.map((client) => (
          <Card key={client.id} className="p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <Heading as="h2" className="text-lg">
                  {client.fullName}{" "}
                  {!client.active ? (
                    <span className="text-sm font-medium text-[rgb(var(--color-muted-foreground))]">
                      {t("femme.clients.inactive")}
                    </span>
                  ) : null}
                </Heading>
                <div className="mt-1 flex flex-col gap-0.5">
                  {client.phone ? (
                    <Text variant="muted">{client.phone}</Text>
                  ) : null}
                  {client.email ? (
                    <Text variant="muted">{client.email}</Text>
                  ) : null}
                  {client.ruc ? (
                    <Text variant="muted">
                      {t("femme.clients.ruc")}: {client.ruc}
                    </Text>
                  ) : null}
                  <Text variant="muted">
                    {t("femme.clients.visits", { count: client.visitCount })}
                  </Text>
                </div>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                {client.active ? (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => deactivateClient(client)}
                    className="min-h-11"
                  >
                    {t("femme.clients.deactivate")}
                  </Button>
                ) : null}
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={t("femme.clients.addTitle")}
      >
        <div className="flex flex-col gap-4">
          {saveError ? (
            <Alert variant="destructive" title={t("femme.clients.errorTitle")}>
              {saveError}
            </Alert>
          ) : null}

          <div>
            <Label htmlFor="client-fullname">{t("femme.clients.fullName")}</Label>
            <Input
              id="client-fullname"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              aria-invalid={fieldError?.fullName ? "true" : "false"}
              aria-describedby={fieldError?.fullName ? "client-fullname-err" : undefined}
            />
            <FieldValidationError id="client-fullname-err">
              {fieldError?.fullName}
            </FieldValidationError>
          </div>

          <div>
            <Label htmlFor="client-phone">{t("femme.clients.phone")}</Label>
            <Input
              id="client-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              inputMode="tel"
            />
          </div>

          <div>
            <Label htmlFor="client-email">{t("femme.clients.email")}</Label>
            <Input
              id="client-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div>
            <Label htmlFor="client-ruc">{t("femme.clients.ruc")}</Label>
            <Input
              id="client-ruc"
              value={ruc}
              onChange={(e) => setRuc(e.target.value)}
              placeholder="80000005-6"
              aria-invalid={fieldError?.ruc ? "true" : "false"}
              aria-describedby={fieldError?.ruc ? "client-ruc-err" : undefined}
            />
            <Text variant="muted" className="mt-1 text-sm">
              {t("femme.clients.rucHint")}
            </Text>
            <FieldValidationError id="client-ruc-err">{fieldError?.ruc}</FieldValidationError>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setModalOpen(false)}
              className="min-h-11"
            >
              {t("femme.clients.cancel")}
            </Button>
            <Button
              type="button"
              onClick={saveClient}
              disabled={saving}
              className="min-h-11"
            >
              {saving ? t("femme.clients.saving") : t("femme.clients.save")}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
