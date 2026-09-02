import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Heading,
  Label,
  LocalityCombobox,
  Radio,
  RadioGroup,
  Spinner,
  Text,
  type Locality,
} from "@design-system";
import { femmeJson, femmePutJson } from "../api/femmeClient";
import { looksLikeRucValidationError, parseApiErrorMessage, translateApiError } from "../api/parseApiErrorMessage";
import { isValidParaguayRuc } from "../util/paraguayRuc";
import {
  formatParaguayPhone,
  isCompleteParaguayPhone,
} from "../lib/paraguayPhone";
import { isValidEmail } from "../lib/validateEmail";
import { useFeatureFlag } from "../hooks/useFeatureFlags";
import { useLocalitySearch } from "../hooks/useLocalitySearch";
import { useMe } from "../hooks/useMe";
import { useTour } from "../tour/useTour";
import { businessSettingsSteps } from "../tour/steps/businessSettings";

type TaxpayerType = "INDIVIDUAL" | "LEGAL_ENTITY";

type BusinessProfileResponse = {
  businessName: string;
  ruc: string | null;
  address: string | null;
  phone: string | null;
  contactEmail: string | null;
  logoDataUrl: string | null;
  rucValidForInvoicing: boolean;
  taxpayerType: TaxpayerType | null;
  economicActivityCode: string | null;
  economicActivityDescription: string | null;
  sifenFantasyName: string | null;
  kudeFooterMessage: string | null;
  sifenDepartmentCode: string | null;
  sifenDepartmentName: string | null;
  sifenCityCode: string | null;
  sifenCityName: string | null;
};

function localityFromProfile(data: BusinessProfileResponse): Locality | null {
  if (
    !data.sifenDepartmentCode ||
    !data.sifenDepartmentName ||
    !data.sifenCityCode ||
    !data.sifenCityName
  ) {
    return null;
  }
  return {
    departmentCode: data.sifenDepartmentCode,
    departmentName: data.sifenDepartmentName,
    cityCode: data.sifenCityCode,
    cityName: data.sifenCityName,
  };
}

const MAX_LOGO_BYTES = 1_500_000;

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 11,
  fontWeight: 500,
  color: "var(--color-ink-2)",
  marginBottom: 4,
};

const hintStyle: React.CSSProperties = {
  fontSize: 10,
  color: "var(--color-ink-3)",
  marginTop: 3,
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 500,
  letterSpacing: "0.06em",
  color: "var(--color-ink-3)",
  textTransform: "uppercase",
  margin: "14px 0 10px",
  paddingBottom: 6,
  borderBottom: "var(--border-default)",
};

function buildInputStyle(
  hasError: boolean,
  focused: boolean,
): React.CSSProperties {
  const base: React.CSSProperties = {
    padding: "8px 11px",
    border: hasError ? "1px solid var(--color-danger)" : "1px solid var(--color-stone-md)",
    borderRadius: "var(--radius-md)",
    fontSize: 12,
    color: "var(--color-ink)",
    background: "var(--color-white)",
    width: "100%",
    outline: "none",
    boxSizing: "border-box",
  };
  if (focused) {
    base.boxShadow = hasError
      ? "0 0 0 3px var(--color-danger-lt)"
      : "0 0 0 3px var(--color-rose-lt)";
    if (!hasError) base.borderColor = "var(--color-rose)";
  }
  return base;
}

export default function BusinessSettingsPage() {
  const { t } = useTranslation();
  const { me } = useMe();
  const isTenantAdmin = me?.role === "ADMIN";
  const sifenInvoicingEnabled = useFeatureFlag("SIFEN_ELECTRONIC_INVOICING");
  const guidedTourEnabled = useFeatureFlag("GUIDED_TOUR");
  useTour("business-settings", businessSettingsSteps, undefined, guidedTourEnabled);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const localitySearch = useLocalitySearch();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [businessName, setBusinessName] = useState("");
  const [ruc, setRuc] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  /** null = server had no logo; "" = user cleared; string = image data URL */
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const [taxpayerType, setTaxpayerType] = useState<TaxpayerType | "">("");
  const [economicActivityCode, setEconomicActivityCode] = useState("");
  const [economicActivityDescription, setEconomicActivityDescription] = useState("");
  const [sifenFantasyName, setSifenFantasyName] = useState("");
  // Round-tripped unchanged: BusinessProfileService.update replaces this field from every
  // request, so omitting it here would silently wipe it. No editor for it yet (KuDE footer).
  const [kudeFooterMessage, setKudeFooterMessage] = useState<string | null>(null);
  const [locality, setLocality] = useState<Locality | null>(null);
  const [rucError, setRucError] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [contactEmailError, setContactEmailError] = useState<string | null>(null);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [saveValidationError, setSaveValidationError] = useState<string | null>(null);
  const [businessNameError, setBusinessNameError] = useState<string | null>(null);
  const [logoFileLabel, setLogoFileLabel] = useState<string | null>(null);
  const [logoDims, setLogoDims] = useState<{ w: number; h: number } | null>(null);
  const [focusField, setFocusField] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isTenantAdmin) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const data = await femmeJson<BusinessProfileResponse>("/api/business-profile");
      setBusinessName(data.businessName);
      setRuc(data.ruc ?? "");
      setAddress(data.address ?? "");
      setPhone(formatParaguayPhone(data.phone ?? ""));
      setContactEmail(data.contactEmail ?? "");
      setLogoDataUrl(data.logoDataUrl ?? null);
      setLogoFileLabel(null);
      setTaxpayerType(data.taxpayerType ?? "");
      setEconomicActivityCode(data.economicActivityCode ?? "");
      setEconomicActivityDescription(data.economicActivityDescription ?? "");
      setSifenFantasyName(data.sifenFantasyName ?? "");
      setKudeFooterMessage(data.kudeFooterMessage ?? null);
      setLocality(localityFromProfile(data));
    } catch {
      setLoadError(t("femme.businessSettings.loadError"));
      setSuccess(false);
    } finally {
      setLoading(false);
    }
  }, [t, isTenantAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const url = logoDataUrl && logoDataUrl.length > 0 ? logoDataUrl : null;
    if (!url) {
      setLogoDims(null);
      return;
    }
    const img = new Image();
    img.onload = () => {
      setLogoDims({ w: img.naturalWidth, h: img.naturalHeight });
    };
    img.src = url;
  }, [logoDataUrl]);

  function onLogoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_LOGO_BYTES) {
      setLogoError(t("femme.businessSettings.logoTooLarge"));
      return;
    }
    setLogoError(null);
    if (saveValidationError) setSaveValidationError(null);
    setLogoFileLabel(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : null;
      if (result) {
        setLogoDataUrl(result);
        setLogoError(null);
        const img = new Image();
        img.onload = () => {
          setLogoDims({ w: img.naturalWidth, h: img.naturalHeight });
        };
        img.src = result;
      }
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  function clearLogo() {
    setLogoDataUrl("");
    setLogoFileLabel(null);
    setLogoDims(null);
  }

  async function onCancel() {
    setSaveError(null);
    setSuccess(false);
    setBusinessNameError(null);
    setRucError(null);
    setPhoneError(null);
    setContactEmailError(null);
    setLogoError(null);
    setSaveValidationError(null);
    await load();
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSuccess(false);
    setRucError(null);
    setPhoneError(null);
    setContactEmailError(null);
    setSaveValidationError(null);
    setSaveError(null);
    setBusinessNameError(null);
    if (!businessName.trim()) {
      setBusinessNameError(t("femme.businessSettings.businessNameRequired"));
      return;
    }
    const rucTrim = ruc.trim();
    if (rucTrim.length > 0 && !isValidParaguayRuc(rucTrim)) {
      setRucError(t("femme.businessSettings.rucInvalid"));
      return;
    }
    const phoneTrim = phone.trim();
    if (phoneTrim.length > 0 && !isCompleteParaguayPhone(phoneTrim)) {
      setPhoneError(t("femme.businessSettings.phoneInvalid"));
      return;
    }
    const emailTrim = contactEmail.trim();
    if (emailTrim.length > 0 && !isValidEmail(emailTrim)) {
      setContactEmailError(t("femme.businessSettings.contactEmailInvalid"));
      return;
    }
    setSaving(true);
    try {
      await femmePutJson<BusinessProfileResponse>("/api/business-profile", {
        businessName: businessName.trim(),
        ruc: rucTrim.length === 0 ? null : rucTrim,
        address: address.trim() || null,
        phone: phoneTrim.length === 0 ? null : formatParaguayPhone(phoneTrim),
        contactEmail: emailTrim.length === 0 ? null : emailTrim,
        logoDataUrl:
          logoDataUrl === null ? null : logoDataUrl === "" ? "" : logoDataUrl,
        taxpayerType: taxpayerType || null,
        economicActivityCode: economicActivityCode.trim() || null,
        economicActivityDescription: economicActivityDescription.trim() || null,
        sifenFantasyName: sifenFantasyName.trim() || null,
        kudeFooterMessage: kudeFooterMessage || null,
        sifenDepartmentCode: locality?.departmentCode ?? null,
        sifenDepartmentName: locality?.departmentName ?? null,
        sifenCityCode: locality?.cityCode ?? null,
        sifenCityName: locality?.cityName ?? null,
      });
      setSuccess(true);
      await load();
    } catch (err) {
      const code = parseApiErrorMessage(err);
      if (looksLikeRucValidationError(code)) {
        setRucError(t("femme.businessSettings.rucInvalid"));
      } else if (code === "LOGO_TOO_LARGE") {
        setLogoError(t("femme.apiErrors.LOGO_TOO_LARGE"));
      } else if (code === "LOGO_INVALID_FORMAT") {
        setLogoError(t("femme.apiErrors.LOGO_INVALID_FORMAT"));
      } else {
        setSaveError(translateApiError(err, t, "femme.businessSettings.saveError"));
      }
    } finally {
      setSaving(false);
    }
  }

  const logoPreview = logoDataUrl && logoDataUrl.length > 0 ? logoDataUrl : null;

  const ghostBtn: React.CSSProperties = {
    background: "var(--color-white)",
    color: "var(--color-ink-2)",
    border: "var(--border-default)",
    borderRadius: "var(--radius-md)",
    padding: "7px 14px",
    fontSize: 12,
    cursor: "pointer",
  };

  const primaryBtn: React.CSSProperties = {
    background: "var(--color-rose)",
    color: "var(--color-on-primary)",
    border: "none",
    borderRadius: "var(--radius-md)",
    padding: "8px 16px",
    fontSize: 12,
    fontWeight: 500,
    cursor: "pointer",
  };

  const errTextStyle: React.CSSProperties = {
    fontSize: 10,
    color: "var(--color-danger)",
    marginTop: 3,
  };

  if (!isTenantAdmin) {
    return (
      <div>
        <Heading as="h2" className="text-[var(--color-ink)]">
          {t("femme.businessSettings.title")}
        </Heading>
        <p className="mt-2 text-sm text-[var(--color-ink-2)]" role="alert">
          {t("femme.businessSettings.forbidden")}
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ display: "flex", minHeight: "40vh", alignItems: "center", justifyContent: "center", gap: 12 }}>
        <Spinner size="lg" />
        <Text>{t("femme.businessSettings.loading")}</Text>
      </div>
    );
  }

  const feedback = loadError || saveError || success;

  return (
    <div>
      {feedback ? (
        <div
          style={{
            position: "sticky",
            top: 0,
            zIndex: 5,
            marginBottom: 16,
            display: "flex",
            flexDirection: "column",
            gap: 12,
            background: "var(--color-white)",
            paddingBottom: 4,
          }}
        >
          {loadError ? (
            <Alert variant="destructive" title={t("femme.businessSettings.errorTitle")}>
              {loadError}
            </Alert>
          ) : null}
          {saveError ? (
            <Alert variant="destructive" title={t("femme.businessSettings.errorTitle")}>
              {saveError}
            </Alert>
          ) : null}
          {success ? (
            <Alert variant="success" title={t("femme.businessSettings.savedTitle")}>
              {t("femme.businessSettings.savedBody")}
            </Alert>
          ) : null}
        </div>
      ) : null}

      <form data-tour="settings-nav" onSubmit={onSubmit} noValidate>
        {saveValidationError ? (
          <p role="alert" style={errTextStyle}>
            {saveValidationError}
          </p>
        ) : null}

        <div style={sectionTitleStyle}>{t("femme.businessSettings.sectionGeneral")}</div>
        <div
          data-tour="settings-form"
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 12,
          }}
        >
          <div>
            <label htmlFor="businessName" style={labelStyle}>
              {t("femme.businessSettings.businessName")}
              <span style={{ color: "var(--color-rose)" }}> *</span>
            </label>
            <input
              id="businessName"
              value={businessName}
              onChange={(e) => {
                setBusinessName(e.target.value);
                if (businessNameError) setBusinessNameError(null);
                if (saveValidationError) setSaveValidationError(null);
              }}
              className="mt-0 w-full"
              autoComplete="organization"
              aria-invalid={!!businessNameError}
              aria-describedby={businessNameError ? "business-name-error" : undefined}
              onFocus={() => setFocusField("businessName")}
              onBlur={() => setFocusField(null)}
              style={buildInputStyle(!!businessNameError, focusField === "businessName")}
            />
            {businessNameError ? (
              <p id="business-name-error" role="alert" style={errTextStyle}>
                {businessNameError}
              </p>
            ) : null}
          </div>
          <div>
            <label htmlFor="ruc" style={labelStyle}>
              {t("femme.businessSettings.ruc")}
            </label>
            <input
              id="ruc"
              value={ruc}
              onChange={(e) => {
                setRuc(e.target.value);
                if (rucError) setRucError(null);
                if (saveValidationError) setSaveValidationError(null);
              }}
              placeholder="80000005-6"
              aria-invalid={!!rucError}
              aria-describedby={rucError ? "ruc-error" : "ruc-hint"}
              onFocus={() => setFocusField("ruc")}
              onBlur={() => setFocusField(null)}
              style={buildInputStyle(!!rucError, focusField === "ruc")}
            />
            {rucError ? (
              <p id="ruc-error" role="alert" style={errTextStyle}>
                {rucError}
              </p>
            ) : (
              <p id="ruc-hint" style={hintStyle}>
                {t("femme.businessSettings.rucHint")}
              </p>
            )}
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <label htmlFor="address" style={labelStyle}>
              {t("femme.businessSettings.address")}
            </label>
            <textarea
              id="address"
              value={address}
              onChange={(e) => {
                setAddress(e.target.value);
                if (saveValidationError) setSaveValidationError(null);
              }}
              rows={4}
              onFocus={() => setFocusField("address")}
              onBlur={() => setFocusField(null)}
              style={{
                ...buildInputStyle(false, focusField === "address"),
                resize: "none",
                minHeight: 88,
              }}
            />
          </div>
        </div>

        <div style={sectionTitleStyle}>{t("femme.businessSettings.sectionContact")}</div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 12,
          }}
        >
          <div>
            <label htmlFor="phone" style={labelStyle}>
              {t("femme.businessSettings.phone")}
            </label>
            <input
              id="phone"
              value={phone}
              onChange={(e) => {
                setPhone(formatParaguayPhone(e.target.value));
                if (phoneError) setPhoneError(null);
                if (saveValidationError) setSaveValidationError(null);
              }}
              onBlur={() => {
                setFocusField(null);
                const trimmed = phone.trim();
                if (trimmed.length > 0 && !isCompleteParaguayPhone(trimmed)) {
                  setPhoneError(t("femme.businessSettings.phoneInvalid"));
                }
              }}
              placeholder={t("femme.businessSettings.phonePlaceholder")}
              autoComplete="tel"
              inputMode="tel"
              aria-invalid={!!phoneError}
              aria-describedby={phoneError ? "phone-error" : undefined}
              onFocus={() => setFocusField("phone")}
              style={buildInputStyle(!!phoneError, focusField === "phone")}
            />
            {phoneError ? (
              <p id="phone-error" role="alert" style={errTextStyle}>
                {phoneError}
              </p>
            ) : null}
          </div>
          <div>
            <label htmlFor="contactEmail" style={labelStyle}>
              {t("femme.businessSettings.contactEmail")}
            </label>
            <input
              id="contactEmail"
              type="email"
              value={contactEmail}
              onChange={(e) => {
                setContactEmail(e.target.value);
                if (contactEmailError) setContactEmailError(null);
                if (saveValidationError) setSaveValidationError(null);
              }}
              onBlur={() => {
                setFocusField(null);
                const trimmed = contactEmail.trim();
                if (trimmed.length > 0 && !isValidEmail(trimmed)) {
                  setContactEmailError(
                    t("femme.businessSettings.contactEmailInvalid"),
                  );
                }
              }}
              autoComplete="email"
              aria-invalid={!!contactEmailError}
              aria-describedby={contactEmailError ? "contactEmail-error" : undefined}
              onFocus={() => setFocusField("contactEmail")}
              style={buildInputStyle(!!contactEmailError, focusField === "contactEmail")}
            />
            {contactEmailError ? (
              <p id="contactEmail-error" role="alert" style={errTextStyle}>
                {contactEmailError}
              </p>
            ) : null}
          </div>
        </div>

        {sifenInvoicingEnabled ? (
          <>
            <div style={sectionTitleStyle}>{t("femme.businessSettings.sectionSifen")}</div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 12,
              }}
            >
              <div style={{ gridColumn: "1 / -1" }}>
                <Label id="taxpayer-type-label">
                  {t("femme.businessSettings.taxpayerTypeLabel")}
                </Label>
                <RadioGroup
                  aria-labelledby="taxpayer-type-label"
                  value={taxpayerType}
                  onChange={(value) => {
                    setTaxpayerType(value as TaxpayerType);
                    if (saveValidationError) setSaveValidationError(null);
                  }}
                  className="flex-row gap-4 mt-1"
                  name="taxpayer-type"
                >
                  <label className="flex items-center gap-2 text-sm">
                    <Radio value="INDIVIDUAL" />
                    {t("femme.businessSettings.taxpayerTypeIndividual")}
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Radio value="LEGAL_ENTITY" />
                    {t("femme.businessSettings.taxpayerTypeLegalEntity")}
                  </label>
                </RadioGroup>
              </div>
              <div>
                <label htmlFor="economicActivityCode" style={labelStyle}>
                  {t("femme.businessSettings.economicActivityCode")}
                </label>
                <input
                  id="economicActivityCode"
                  value={economicActivityCode}
                  onChange={(e) => {
                    setEconomicActivityCode(e.target.value);
                    if (saveValidationError) setSaveValidationError(null);
                  }}
                  aria-describedby="economicActivityCode-hint"
                  onFocus={() => setFocusField("economicActivityCode")}
                  onBlur={() => setFocusField(null)}
                  style={buildInputStyle(false, focusField === "economicActivityCode")}
                />
                <p id="economicActivityCode-hint" style={hintStyle}>
                  {t("femme.businessSettings.economicActivityCodeHint")}
                </p>
              </div>
              <div>
                <label htmlFor="economicActivityDescription" style={labelStyle}>
                  {t("femme.businessSettings.economicActivityDescription")}
                </label>
                <input
                  id="economicActivityDescription"
                  value={economicActivityDescription}
                  onChange={(e) => {
                    setEconomicActivityDescription(e.target.value);
                    if (saveValidationError) setSaveValidationError(null);
                  }}
                  onFocus={() => setFocusField("economicActivityDescription")}
                  onBlur={() => setFocusField(null)}
                  style={buildInputStyle(false, focusField === "economicActivityDescription")}
                />
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <label htmlFor="sifenFantasyName" style={labelStyle}>
                  {t("femme.businessSettings.sifenFantasyName")}
                </label>
                <input
                  id="sifenFantasyName"
                  value={sifenFantasyName}
                  onChange={(e) => {
                    setSifenFantasyName(e.target.value);
                    if (saveValidationError) setSaveValidationError(null);
                  }}
                  aria-describedby="sifenFantasyName-hint"
                  onFocus={() => setFocusField("sifenFantasyName")}
                  onBlur={() => setFocusField(null)}
                  style={buildInputStyle(false, focusField === "sifenFantasyName")}
                />
                <p id="sifenFantasyName-hint" style={hintStyle}>
                  {t("femme.businessSettings.sifenFantasyNameHint")}
                </p>
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <Label htmlFor="business-locality">{t("femme.clients.locality")}</Label>
                <LocalityCombobox
                  id="business-locality"
                  value={locality}
                  onChange={(next) => {
                    setLocality(next);
                    if (saveValidationError) setSaveValidationError(null);
                  }}
                  onSearch={localitySearch.search}
                  options={localitySearch.options}
                  loading={localitySearch.loading}
                  placeholder={t("femme.clients.localityPlaceholder")}
                  noResultsLabel={t("femme.clients.localityNoResults")}
                />
                <Text variant="muted" className="mt-1 text-sm">
                  {t("femme.clients.localityHint")}
                </Text>
              </div>
            </div>
          </>
        ) : null}

        <div style={sectionTitleStyle}>{t("femme.businessSettings.sectionLogo")}</div>
        <div data-tour="settings-logo" style={{ gridColumn: "1 / -1" }}>
          <label htmlFor="logo-file-input" style={labelStyle}>
            {t("femme.businessSettings.logo")}
          </label>
          <input
            ref={logoInputRef}
            id="logo-file-input"
            type="file"
            accept="image/*"
            onChange={onLogoFile}
            className="sr-only"
          />
          {logoPreview ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: 10,
                background: "var(--color-stone)",
                borderRadius: "var(--radius-md)",
                border: "var(--border-default)",
              }}
            >
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: "var(--radius-md)",
                  overflow: "hidden",
                  flexShrink: 0,
                  background: "var(--color-white)",
                  border: "var(--border-default)",
                }}
              >
                <img src={logoPreview} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, color: "var(--color-ink)", fontWeight: 500 }}>
                  {logoFileLabel
                    ? t("femme.businessSettings.logoFileName", { name: logoFileLabel })
                    : t("femme.businessSettings.logoUploaded")}
                </div>
                {logoDims ? (
                  <div style={{ fontSize: 10, color: "var(--color-ink-3)", marginTop: 2 }}>
                    {t("femme.businessSettings.logoDimensions", {
                      width: logoDims.w,
                      height: logoDims.h,
                    })}
                  </div>
                ) : null}
              </div>
              <button type="button" style={ghostBtn} onClick={() => logoInputRef.current?.click()}>
                {t("femme.businessSettings.changeLogo")}
              </button>
              <button
                type="button"
                onClick={clearLogo}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--color-danger)",
                  fontSize: 12,
                  cursor: "pointer",
                  padding: "4px 8px",
                }}
              >
                {t("femme.businessSettings.removeLogo")}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => logoInputRef.current?.click()}
              aria-invalid={!!logoError}
              aria-describedby={logoError ? "logo-err" : undefined}
              style={{
                width: "100%",
                border: "1.5px dashed var(--color-stone-md)",
                borderRadius: "var(--radius-md)",
                padding: 20,
                textAlign: "center",
                cursor: "pointer",
                background: "var(--color-stone)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "var(--color-rose-md)";
                e.currentTarget.style.background = "var(--color-rose-lt)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "var(--color-stone-md)";
                e.currentTarget.style.background = "var(--color-stone)";
              }}
            >
              <span style={{ fontSize: 12, color: "var(--color-ink-2)" }}>
                {t("femme.businessSettings.logo")}
              </span>
            </button>
          )}
          {logoError ? (
            <p id="logo-err" role="alert" style={errTextStyle}>
              {logoError}
            </p>
          ) : null}
        </div>

        <div
          data-tour="settings-save"
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            marginTop: 16,
            paddingTop: 12,
            borderTop: "var(--border-default)",
          }}
        >
          <button
            type="button"
            onClick={() => void onCancel()}
            disabled={saving}
            style={{
              ...ghostBtn,
              opacity: saving ? 0.6 : 1,
              cursor: saving ? "not-allowed" : "pointer",
            }}
          >
            {t("femme.businessSettings.cancel")}
          </button>
          <button type="submit" style={primaryBtn} disabled={saving}>
            {saving ? t("femme.businessSettings.saving") : t("femme.businessSettings.saveChanges")}
          </button>
        </div>
      </form>
    </div>
  );
}
