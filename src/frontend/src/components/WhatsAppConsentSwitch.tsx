import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Label, Switch } from "@design-system";
import { translateApiError } from "../api/parseApiErrorMessage";
import { setClientWhatsAppConsent, type ClientConsent } from "../api/whatsappNotices";
import { useDateLocale } from "../i18n/dateLocale";
import { useFeatureFlag } from "../hooks/useFeatureFlags";
import { isCompleteParaguayPhone } from "../lib/paraguayPhone";
import { FieldValidationError } from "./FieldValidationError";

type Props = {
  clientId: number;
  /** The phone as SAVED (the consent is recorded for it). */
  savedPhone: string | null;
  /** The phone field has unsaved edits. */
  phoneDirty: boolean;
  active: boolean;
  optIn: boolean;
  optInAt?: string | null;
  onChanged: (updated: ClientConsent) => void;
};

/**
 * HU-WAP-03: «Acepta recibir avisos por WhatsApp» in the client's file. An immediate action (it does
 * not wait for «Guardar»): it records who and when in the audit trail. Only exists when the salon
 * has the WhatsApp channel (WHATSAPP_REMINDERS and ONLINE_BOOKING) — RT-01.
 */
export function WhatsAppConsentSwitch({
  clientId,
  savedPhone,
  phoneDirty,
  active,
  optIn,
  optInAt,
  onChanged,
}: Props) {
  const { t } = useTranslation();
  const dateLocale = useDateLocale();
  const whatsapp = useFeatureFlag("WHATSAPP_REMINDERS");
  const booking = useFeatureFlag("ONLINE_BOOKING");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!whatsapp || !booking) return null;

  const hasPhone = isCompleteParaguayPhone((savedPhone ?? "").trim());
  const disabled = busy || !active || phoneDirty || (!optIn && !hasPhone);
  const hint = !active
    ? t("femme.clients.whatsappConsent.inactive")
    : phoneDirty
      ? t("femme.clients.whatsappConsent.dirtyPhone")
      : !optIn && !hasPhone
        ? t("femme.clients.whatsappConsent.needsPhone")
        : t("femme.clients.whatsappConsent.help");

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      onChanged(await setClientWhatsAppConsent(clientId, !optIn));
    } catch (e) {
      setError(translateApiError(e, t, "femme.clients.whatsappConsent.saveError"));
    } finally {
      setBusy(false);
    }
  }

  const since =
    optIn && optInAt
      ? new Intl.DateTimeFormat(dateLocale, { dateStyle: "long" }).format(new Date(optInAt))
      : null;

  return (
    <div data-testid="client-whatsapp-consent" className="flex items-start gap-3">
      <Switch
        id={`client-whatsapp-consent-${clientId}`}
        className="min-h-11 min-w-11 justify-center"
        checked={optIn}
        disabled={disabled}
        data-testid="client-whatsapp-switch"
        aria-describedby={`client-whatsapp-consent-hint-${clientId}`}
        onChange={() => void toggle()}
      />
      <div className="min-w-0">
        <Label htmlFor={`client-whatsapp-consent-${clientId}`}>
          {t("femme.clients.whatsappConsent.label")}
        </Label>
        <p
          id={`client-whatsapp-consent-hint-${clientId}`}
          className="text-sm text-ink-3"
          data-testid="client-whatsapp-hint"
        >
          {hint}
        </p>
        {since ? (
          <p className="text-sm text-ink-3" data-testid="client-whatsapp-since">
            {t("femme.clients.whatsappConsent.since", { date: since })}
          </p>
        ) : null}
        <FieldValidationError id={`client-whatsapp-consent-err-${clientId}`}>
          {error}
        </FieldValidationError>
      </div>
    </div>
  );
}
