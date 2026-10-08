import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import { Alert, Heading, Spinner, Text } from "@design-system";
import { femmeJson } from "../api/femmeClient";
import { translateApiError } from "../api/parseApiErrorMessage";
import { SifenCertificatesPanel } from "../components/SifenCertificatesPanel";
import { SifenCscSection } from "../components/SifenCscSection";

type TenantSifenInfo = { tenantId: number; tenantName: string; environment: "TEST" | "PRODUCTION" };

/**
 * Plataforma → Salones → SIFEN. The platform's root user loads the SIFEN fiscal credentials of a
 * salon here: its digital certificate (.p12 + password) and its Código de Seguridad del
 * Contribuyente (CSC). The salon's own administrator can NOT load them — they only see what was
 * loaded, read-only, in Configuración → SIFEN. Both secrets are write-only.
 */
export default function PlatformTenantSifenPage() {
  const { t } = useTranslation();
  const params = useParams();
  const tenantId = Number(params.tenantId);
  const validId = Number.isInteger(tenantId) && tenantId > 0;

  const [info, setInfo] = useState<TenantSifenInfo | null>(null);
  const [error, setError] = useState<string | null>(validId ? null : t("femme.platform.sifen.notFound"));

  useEffect(() => {
    if (!validId) return;
    let cancelled = false;
    femmeJson<TenantSifenInfo>(`/api/platform/tenants/${tenantId}/sifen`)
      .then((data) => {
        if (!cancelled) setInfo(data);
      })
      .catch((err) => {
        if (!cancelled) setError(translateApiError(err, t, "femme.platform.sifen.loadError"));
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId, validId, t]);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6" data-testid="platform-tenant-sifen">
      <div>
        <Link
          to="/platform/tenants"
          className="text-sm text-[var(--color-ink-2)] underline"
          data-testid="platform-tenant-sifen-back"
        >
          {t("femme.platform.sifen.back")}
        </Link>
        <Heading as="h1" className="mt-2">
          {info
            ? t("femme.platform.sifen.titleFor", { name: info.tenantName })
            : t("femme.platform.sifen.title")}
        </Heading>
        <Text variant="muted">{t("femme.platform.sifen.lead")}</Text>
      </div>

      {error ? (
        <Alert variant="destructive" title={t("femme.platform.tenants.errorTitle")}>
          {error}
        </Alert>
      ) : null}

      {!info && !error ? (
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Spinner size="md" />
          <Text>{t("femme.platform.sifen.loading")}</Text>
        </div>
      ) : null}

      {info ? (
        <>
          <section aria-labelledby="platform-sifen-cert-title">
            <Heading as="h2" id="platform-sifen-cert-title" className="mb-3 text-lg">
              {t("femme.sifenSettings.tab.certificate")}
            </Heading>
            <SifenCertificatesPanel tenantId={info.tenantId} />
          </section>

          <section aria-labelledby="platform-sifen-csc-title">
            <Heading as="h2" id="platform-sifen-csc-title" className="mb-3 text-lg">
              {t("femme.sifenSettings.tab.csc")}
            </Heading>
            <SifenCscSection tenantId={info.tenantId} environment={info.environment} />
          </section>
        </>
      ) : null}
    </div>
  );
}
