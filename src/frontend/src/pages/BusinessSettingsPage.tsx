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
  Textarea,
} from "@design-system";
import { femmeJson, femmePutJson } from "../api/femmeClient";
import { isValidParaguayRuc } from "../util/paraguayRuc";

type BusinessProfileResponse = {
  businessName: string;
  ruc: string | null;
  address: string | null;
  phone: string | null;
  contactEmail: string | null;
  logoDataUrl: string | null;
  rucValidForInvoicing: boolean;
};

const MAX_LOGO_BYTES = 1_500_000;

export default function BusinessSettingsPage() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [businessName, setBusinessName] = useState("");
  const [ruc, setRuc] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  /** null = server had no logo; "" = user cleared; string = image data URL */
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const [rucError, setRucError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await femmeJson<BusinessProfileResponse>("/api/business-profile");
      setBusinessName(data.businessName);
      setRuc(data.ruc ?? "");
      setAddress(data.address ?? "");
      setPhone(data.phone ?? "");
      setContactEmail(data.contactEmail ?? "");
      setLogoDataUrl(data.logoDataUrl ?? null);
    } catch {
      setError(t("femme.businessSettings.loadError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  function onLogoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_LOGO_BYTES) {
      setError(t("femme.businessSettings.logoTooLarge"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : null;
      if (result) {
        setLogoDataUrl(result);
        setError(null);
      }
    };
    reader.readAsDataURL(file);
  }

  function clearLogo() {
    setLogoDataUrl("");
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSuccess(false);
    setRucError(null);
    const rucTrim = ruc.trim();
    if (rucTrim.length > 0 && !isValidParaguayRuc(rucTrim)) {
      setRucError(t("femme.businessSettings.rucInvalid"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await femmePutJson<BusinessProfileResponse>("/api/business-profile", {
        businessName: businessName.trim(),
        ruc: rucTrim.length === 0 ? null : rucTrim,
        address: address.trim() || null,
        phone: phone.trim() || null,
        contactEmail: contactEmail.trim() || null,
        logoDataUrl:
          logoDataUrl === null ? null : logoDataUrl === "" ? "" : logoDataUrl,
      });
      setSuccess(true);
      await load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg || t("femme.businessSettings.saveError"));
    } finally {
      setSaving(false);
    }
  }

  const logoPreview = logoDataUrl && logoDataUrl.length > 0 ? logoDataUrl : null;

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center gap-3">
        <Spinner size="lg" />
        <Text>{t("femme.businessSettings.loading")}</Text>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <Heading as="h1">{t("femme.businessSettings.title")}</Heading>
        <Text variant="muted" className="mt-1">
          {t("femme.businessSettings.lead")}
        </Text>
      </div>

      {error ? (
        <Alert variant="destructive" title={t("femme.businessSettings.errorTitle")}>
          {error}
        </Alert>
      ) : null}
      {success ? (
        <Alert variant="success" title={t("femme.businessSettings.savedTitle")}>
          {t("femme.businessSettings.savedBody")}
        </Alert>
      ) : null}

      <Card className="p-4 sm:p-6">
        <form className="flex flex-col gap-4" onSubmit={onSubmit}>
          <div>
            <Label htmlFor="businessName">{t("femme.businessSettings.businessName")}</Label>
            <Input
              id="businessName"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              required
              className="mt-1 w-full"
              autoComplete="organization"
            />
          </div>
          <div>
            <Label htmlFor="ruc">{t("femme.businessSettings.ruc")}</Label>
            <Input
              id="ruc"
              value={ruc}
              onChange={(e) => setRuc(e.target.value)}
              placeholder="80000005-6"
              className="mt-1 w-full"
              aria-invalid={!!rucError}
            />
            {rucError ? (
              <Text variant="small" className="mt-1 text-[rgb(var(--color-destructive))]">
                {rucError}
              </Text>
            ) : null}
            <Text variant="small" className="mt-1 text-[rgb(var(--color-muted-foreground))]">
              {t("femme.businessSettings.rucHint")}
            </Text>
          </div>
          <div>
            <Label htmlFor="address">{t("femme.businessSettings.address")}</Label>
            <Textarea
              id="address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="mt-1 w-full min-h-[88px]"
            />
          </div>
          <div>
            <Label htmlFor="phone">{t("femme.businessSettings.phone")}</Label>
            <Input
              id="phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="mt-1 w-full"
              autoComplete="tel"
            />
          </div>
          <div>
            <Label htmlFor="contactEmail">{t("femme.businessSettings.contactEmail")}</Label>
            <Input
              id="contactEmail"
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              className="mt-1 w-full"
              autoComplete="email"
            />
          </div>
          <div>
            <Label htmlFor="logo">{t("femme.businessSettings.logo")}</Label>
            <Input
              id="logo"
              type="file"
              accept="image/*"
              onChange={onLogoFile}
              className="mt-1 w-full min-h-11"
            />
            {logoPreview ? (
              <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                <img
                  src={logoPreview}
                  alt=""
                  className="h-16 w-auto max-w-[200px] rounded border border-[rgb(var(--color-border))] object-contain"
                />
                <Button type="button" variant="secondary" onClick={clearLogo} className="min-h-11">
                  {t("femme.businessSettings.removeLogo")}
                </Button>
              </div>
            ) : null}
          </div>
          <Button type="submit" variant="primary" className="min-h-11 w-full sm:w-auto" disabled={saving}>
            {saving ? t("femme.businessSettings.saving") : t("femme.businessSettings.save")}
          </Button>
        </form>
      </Card>
    </div>
  );
}
