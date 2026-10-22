import { useTranslation } from "react-i18next";
import { Input, Label, Select } from "@design-system";
import { useDateLocale } from "../i18n/dateLocale";
import { isValidBirthday, monthNames, parseBirthdayYear } from "../lib/clientBirthday";
import { FieldValidationError } from "./FieldValidationError";

/** HU-69: fixed "¿Cómo nos conoció?" options (backend `ClientAcquisitionChannel`). */
export const ACQUISITION_CHANNELS = [
  "INSTAGRAM",
  "FACEBOOK",
  "TIKTOK",
  "GOOGLE",
  "RECOMENDACION",
  "PASO_POR_EL_LOCAL",
  "OTRO",
] as const;

export const ACQUISITION_CHANNEL_OTHER_MAX = 100;

export type ClientProfileExtras = {
  birthdayDay: string;
  birthdayMonth: string;
  birthdayYear: string;
  acquisitionChannel: string;
  acquisitionChannelOther: string;
};

export const EMPTY_PROFILE_EXTRAS: ClientProfileExtras = {
  birthdayDay: "",
  birthdayMonth: "",
  birthdayYear: "",
  acquisitionChannel: "",
  acquisitionChannelOther: "",
};

export function profileExtrasFromClient(c: {
  birthdayDay?: number | null;
  birthdayMonth?: number | null;
  birthdayYear?: number | null;
  acquisitionChannel?: string | null;
  acquisitionChannelOther?: string | null;
}): ClientProfileExtras {
  return {
    birthdayDay: c.birthdayDay != null ? String(c.birthdayDay) : "",
    birthdayMonth: c.birthdayMonth != null ? String(c.birthdayMonth) : "",
    birthdayYear: c.birthdayYear != null ? String(c.birthdayYear) : "",
    acquisitionChannel: c.acquisitionChannel ?? "",
    acquisitionChannelOther: c.acquisitionChannelOther ?? "",
  };
}

/** Request body fields for `POST/PUT /api/clients`. */
export function profileExtrasPayload(v: ClientProfileExtras) {
  return {
    birthdayDay: v.birthdayDay ? Number(v.birthdayDay) : null,
    birthdayMonth: v.birthdayMonth ? Number(v.birthdayMonth) : null,
    birthdayYear: v.birthdayYear.trim() ? Number(v.birthdayYear.trim()) : null,
    acquisitionChannel: v.acquisitionChannel || null,
    acquisitionChannelOther:
      v.acquisitionChannel === "OTRO" ? v.acquisitionChannelOther.trim() || null : null,
  };
}

type Props = {
  idPrefix: string;
  value: ClientProfileExtras;
  onChange: (next: ClientProfileExtras) => void;
  birthdayError?: string | null;
  otherError?: string | null;
  /**
   * The two blocks sit side by side from `md` up (client profile "Perfil" grid): line the channel
   * select up with the day/month/year inputs instead of with their small labels.
   */
  alignColumns?: boolean;
};

/**
 * HU-69: birthday (day + month, optional year) and "¿Cómo nos conoció?" — shared by the "new
 * client" modal (HU-10) and the client profile edit form (HU-12).
 */
export function ClientProfileExtrasFields({
  idPrefix,
  value,
  onChange,
  birthdayError,
  otherError,
  alignColumns = false,
}: Props) {
  const { t } = useTranslation();
  const locale = useDateLocale();
  const months = monthNames(locale);
  const set = (patch: Partial<ClientProfileExtras>) => onChange({ ...value, ...patch });
  const birthdayErrId = `${idPrefix}-birthday-err`;
  const otherErrId = `${idPrefix}-acquisition-other-err`;

  return (
    <>
      <fieldset className="min-w-0">
        <legend className="mb-1 text-sm font-medium">{t("femme.clients.birthday.label")}</legend>
        <div className="grid grid-cols-3 gap-2">
          <div className="min-w-0">
            <Label htmlFor={`${idPrefix}-birthday-day`} className="text-xs">
              {t("femme.clients.birthday.day")}
            </Label>
            <Select
              id={`${idPrefix}-birthday-day`}
              value={value.birthdayDay}
              invalid={!!birthdayError}
              aria-describedby={birthdayError ? birthdayErrId : undefined}
              onChange={(e) => set({ birthdayDay: e.target.value })}
            >
              <option value="">—</option>
              {Array.from({ length: 31 }, (_, i) => (
                <option key={i + 1} value={String(i + 1)}>
                  {i + 1}
                </option>
              ))}
            </Select>
          </div>
          <div className="min-w-0">
            <Label htmlFor={`${idPrefix}-birthday-month`} className="text-xs">
              {t("femme.clients.birthday.month")}
            </Label>
            <Select
              id={`${idPrefix}-birthday-month`}
              value={value.birthdayMonth}
              invalid={!!birthdayError}
              aria-describedby={birthdayError ? birthdayErrId : undefined}
              onChange={(e) => set({ birthdayMonth: e.target.value })}
            >
              <option value="">—</option>
              {months.map((name, i) => (
                <option key={i + 1} value={String(i + 1)}>
                  {name}
                </option>
              ))}
            </Select>
          </div>
          <div className="min-w-0">
            <Label htmlFor={`${idPrefix}-birthday-year`} className="text-xs">
              {t("femme.clients.birthday.yearOptional")}
            </Label>
            <Input
              id={`${idPrefix}-birthday-year`}
              inputMode="numeric"
              maxLength={4}
              value={value.birthdayYear}
              placeholder={t("femme.clients.birthday.yearPlaceholder")}
              invalid={!!birthdayError}
              aria-describedby={birthdayError ? birthdayErrId : undefined}
              onChange={(e) => set({ birthdayYear: e.target.value.replace(/\D/g, "") })}
            />
          </div>
        </div>
        <FieldValidationError id={birthdayErrId}>{birthdayError}</FieldValidationError>
      </fieldset>

      <div className="min-w-0">
        <Label
          htmlFor={`${idPrefix}-acquisition-channel`}
          className={alignColumns ? "mb-1 block" : undefined}
        >
          {t("femme.clients.acquisitionChannel.label")}
        </Label>
        {alignColumns ? (
          // Same height as the "Día / Mes / Año" label row of the birthday block.
          <div aria-hidden="true" className="invisible hidden md:block">
            <span className="text-xs">&nbsp;</span>
          </div>
        ) : null}
        <Select
          id={`${idPrefix}-acquisition-channel`}
          value={value.acquisitionChannel}
          onChange={(e) => set({ acquisitionChannel: e.target.value })}
        >
          <option value="">{t("femme.clients.acquisitionChannel.none")}</option>
          {ACQUISITION_CHANNELS.map((c) => (
            <option key={c} value={c}>
              {t(`femme.clients.acquisitionChannel.options.${c}`)}
            </option>
          ))}
        </Select>
        {value.acquisitionChannel === "OTRO" ? (
          <div className="mt-2">
            <Label htmlFor={`${idPrefix}-acquisition-other`}>
              {t("femme.clients.acquisitionChannel.otherLabel")}
            </Label>
            <Input
              id={`${idPrefix}-acquisition-other`}
              value={value.acquisitionChannelOther}
              maxLength={ACQUISITION_CHANNEL_OTHER_MAX}
              placeholder={t("femme.clients.acquisitionChannel.otherPlaceholder")}
              invalid={!!otherError}
              aria-describedby={otherError ? otherErrId : undefined}
              onChange={(e) => set({ acquisitionChannelOther: e.target.value })}
            />
            <FieldValidationError id={otherErrId}>{otherError}</FieldValidationError>
          </div>
        ) : null}
      </div>
    </>
  );
}

/** Validation shared by both forms; returns i18n'd messages (or nulls). */
export function validateProfileExtras(
  v: ClientProfileExtras,
  t: (key: string, opts?: Record<string, unknown>) => string,
): { birthday: string | null; other: string | null } {
  const ok = isValidBirthday({
    day: v.birthdayDay ? Number(v.birthdayDay) : null,
    month: v.birthdayMonth ? Number(v.birthdayMonth) : null,
    year: parseBirthdayYear(v.birthdayYear),
  });
  return {
    birthday: ok ? null : t("femme.clients.birthday.invalid"),
    other:
      v.acquisitionChannel === "OTRO" &&
      v.acquisitionChannelOther.trim().length > ACQUISITION_CHANNEL_OTHER_MAX
        ? t("femme.clients.acquisitionChannel.otherTooLong", { max: ACQUISITION_CHANNEL_OTHER_MAX })
        : null,
  };
}
