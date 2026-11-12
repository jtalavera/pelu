import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Alert, Button, Card, Heading, Input, Label, Spinner, Text } from "@design-system";
import { femmeJson } from "../api/femmeClient";
import { translateApiError } from "../api/parseApiErrorMessage";

type ClientName = { id: number; fullName: string; active: boolean };

/**
 * HU-68 AC9: the professional's "Clientes" screen — search by name, names only, each opening the
 * client's technical sheet. The backend already strips every other field for this role (AC12).
 */
export default function ProfessionalClientsPage() {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [rows, setRows] = useState<ClientName[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRows(null);
    setError(null);
    femmeJson<ClientName[]>(`/api/clients?q=${encodeURIComponent(submitted)}&active=true`)
      .then((data) => {
        if (!cancelled) setRows(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(translateApiError(err, t, "femme.apiErrors.GENERIC"));
      });
    return () => {
      cancelled = true;
    };
  }, [submitted, t]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <Heading as="h1">{t("femme.clients.title")}</Heading>
      <form
        className="flex flex-col gap-2 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitted(query.trim());
        }}
      >
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <Label htmlFor="professional-clients-search">
            {t("femme.clients.technicalSheet.searchLabel")}
          </Label>
          <Input
            id="professional-clients-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("femme.clients.technicalSheet.searchPlaceholder")}
          />
        </div>
        <Button type="submit">{t("femme.clients.technicalSheet.searchButton")}</Button>
      </form>

      <Card className="p-4">
        {error ? (
          <Alert variant="destructive" title={t("femme.clients.errorTitle")}>
            {error}
          </Alert>
        ) : rows == null ? (
          <Spinner size="sm" />
        ) : rows.length === 0 ? (
          <Text variant="muted">{t("femme.clients.technicalSheet.noResults")}</Text>
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--color-border)]" data-testid="professional-clients-list">
            {rows.map((c) => (
              <li key={c.id}>
                <Link
                  to={`/app/clients/${c.id}/technical-sheet`}
                  className="flex min-h-11 items-center px-1 py-2 text-sm font-medium hover:underline"
                >
                  {c.fullName}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
