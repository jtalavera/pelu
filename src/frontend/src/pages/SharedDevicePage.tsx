import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { Alert, Button, FlowbitLogo, Heading, Modal, Spinner, Text } from "@design-system";
import {
  fetchPicker,
  pinLogin,
  type PickerProfessional,
  type PickerResponse,
} from "../api/sharedDevices";
import {
  clearSharedDevice,
  endSession,
  getSharedDevice,
  startPinSession,
} from "../auth/sharedDevice";
import { LanguageSwitcher } from "../components/LanguageSwitcher";

const PIN_MAX = 7;
const PIN_MIN = 4;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return (parts.length >= 2 ? parts[0][0] + parts[1][0] : name.slice(0, 2)).toUpperCase();
}

/**
 * HU-66: the shared salon device's home — pick a professional and enter her PIN (criteria 4–11).
 * Reaching this screen always ends whatever session the tab had ("Cambiar de profesional").
 */
export default function SharedDevicePage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const device = getSharedDevice();
  const [picker, setPicker] = useState<PickerResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<PickerProfessional | null>(null);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const formatTime = useCallback(
    (iso: string) =>
      new Date(iso).toLocaleTimeString(i18n.resolvedLanguage ?? "es", {
        hour: "2-digit",
        minute: "2-digit",
      }),
    [i18n.resolvedLanguage],
  );

  const load = useCallback(async () => {
    if (!device) return;
    try {
      const data = await fetchPicker(device.token);
      if (!data) {
        // Revoked (or unknown) device: back to the normal login (criterion 3).
        clearSharedDevice();
        navigate("/login", { replace: true });
        return;
      }
      setPicker(data);
      setLoadError(null);
    } catch {
      setLoadError(t("femme.sharedDevice.loadError"));
    }
  }, [device, navigate, t]);

  useEffect(() => {
    endSession();
    if (!device) {
      navigate("/login", { replace: true });
      return;
    }
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function open(p: PickerProfessional) {
    setSelected(p);
    setPin("");
    setPinError(null);
  }

  function close() {
    setSelected(null);
    setPin("");
    setPinError(null);
  }

  function press(digit: string) {
    setPinError(null);
    setPin((current) => (current.length >= PIN_MAX ? current : current + digit));
  }

  function backspace() {
    setPin((current) => current.slice(0, -1));
  }

  async function submit() {
    if (!device || !selected || pin.length < PIN_MIN || submitting) return;
    setSubmitting(true);
    try {
      const result = await pinLogin(device.token, selected.id, pin);
      if ("accessToken" in result) {
        startPinSession(result.accessToken);
        navigate("/app/calendar", { replace: true });
        return;
      }
      setPin("");
      if (result.status === 401 && result.error === "SHARED_DEVICE_INVALID") {
        clearSharedDevice();
        navigate("/login", { replace: true });
        return;
      }
      if (result.error === "PIN_LOCKED" && result.lockedUntil) {
        setPinError(t("femme.sharedDevice.pinLocked", { time: formatTime(result.lockedUntil) }));
        void load();
      } else if (result.error === "SHARED_DEVICE_PIN_LOCKED" && result.lockedUntil) {
        setPinError(t("femme.sharedDevice.deviceLocked", { time: formatTime(result.lockedUntil) }));
        void load();
      } else {
        setPinError(
          t("femme.sharedDevice.pinInvalid", { count: result.remainingAttempts ?? 0 }),
        );
      }
    } catch {
      setPinError(t("femme.sharedDevice.loadError"));
    } finally {
      setSubmitting(false);
    }
  }

  // Physical keyboard: digits, Backspace and Enter work too.
  useEffect(() => {
    if (!selected) return;
    function onKey(e: KeyboardEvent) {
      if (/^\d$/.test(e.key)) {
        press(e.key);
      } else if (e.key === "Backspace") {
        backspace();
      } else if (e.key === "Enter") {
        void submit();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  const deviceLocked = picker?.deviceLockedUntil ?? null;
  const keypadButton =
    "flex min-h-14 items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-stone-md)] bg-[var(--color-white)] text-xl font-medium text-[var(--color-ink)] active:bg-[var(--color-stone)] disabled:opacity-50";

  return (
    <div
      className="min-h-screen bg-[var(--color-stone)] px-4 py-6 text-[var(--color-ink)] sm:px-8"
      data-testid="shared-device-page"
    >
      <div className="mx-auto flex max-w-4xl flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <FlowbitLogo tone="auto" className="h-8 w-auto" />
            <div className="mt-1 truncate text-lg font-bold text-[var(--color-ink)]">
              {picker?.tenantName ?? device?.tenantName ?? t("femme.appName")}
            </div>
            <Text variant="muted" className="text-xs" data-testid="shared-device-name">
              {t("femme.sharedDevice.deviceLabel", { name: picker?.deviceName ?? device?.name ?? "" })}
            </Text>
          </div>
          <LanguageSwitcher />
        </div>

        <Heading as="h1" className="!text-[var(--color-ink)]">
          {t("femme.sharedDevice.title")}
        </Heading>

        {deviceLocked ? (
          <Alert variant="destructive" data-testid="shared-device-locked">
            {t("femme.sharedDevice.deviceLocked", { time: formatTime(deviceLocked) })}
          </Alert>
        ) : null}
        {loadError ? <Alert variant="destructive">{loadError}</Alert> : null}

        {!picker && !loadError ? (
          <div className="flex justify-center py-12">
            <Spinner size="lg" label={t("femme.platform.loading")} />
          </div>
        ) : null}

        {picker && picker.professionals.length === 0 ? (
          <Alert variant="info">{t("femme.sharedDevice.empty")}</Alert>
        ) : null}

        {picker && picker.professionals.length > 0 ? (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" aria-label={t("femme.sharedDevice.title")}>
            {picker.professionals.map((p) => {
              const locked = p.lockedUntil !== null || deviceLocked !== null;
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    data-testid={`shared-device-professional-${p.id}`}
                    onClick={() => open(p)}
                    disabled={locked}
                    className="flex min-h-32 w-full flex-col items-center justify-center gap-2 rounded-[var(--radius-xl)] border border-[var(--color-stone-md)] bg-[var(--color-white)] p-3 text-center shadow-sm transition-colors hover:bg-[var(--color-rose-lt)] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-[var(--color-white)]"
                  >
                    {p.photoDataUrl ? (
                      <img
                        src={p.photoDataUrl}
                        alt=""
                        className="h-14 w-14 rounded-full object-cover"
                      />
                    ) : (
                      <span
                        aria-hidden
                        className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--color-rose-md)] text-base font-medium text-[var(--color-rose-dk)]"
                      >
                        {initials(p.fullName)}
                      </span>
                    )}
                    <span className="break-words text-sm font-medium">{p.fullName}</span>
                    {p.lockedUntil ? (
                      <span
                        className="text-xs font-medium text-danger"
                        data-testid={`shared-device-locked-${p.id}`}
                      >
                        {t("femme.sharedDevice.professionalLocked", { time: formatTime(p.lockedUntil) })}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}

        <div className="pt-2">
          <Link
            to="/login"
            state={{ fromSharedDevice: true }}
            className="inline-flex min-h-11 items-center text-sm font-medium text-[var(--color-rose)] underline-offset-4 hover:underline"
          >
            {t("femme.sharedDevice.emailLogin")}
          </Link>
        </div>
      </div>

      <Modal
        open={selected !== null}
        onClose={close}
        title={selected ? t("femme.sharedDevice.pinTitle", { name: selected.fullName }) : ""}
        className="max-w-sm"
      >
        <div className="flex flex-col gap-4" data-testid="pin-pad">
          <div
            className="flex justify-center gap-3 py-2"
            aria-label={t("femme.sharedDevice.pinDigits", { count: pin.length })}
            data-testid="pin-dots"
            data-length={pin.length}
          >
            {Array.from({ length: Math.max(PIN_MIN, pin.length) }).map((_, i) => (
              <span
                key={i}
                className={`h-4 w-4 rounded-full border-2 border-[var(--color-rose)] ${
                  i < pin.length ? "bg-[var(--color-rose)]" : "bg-transparent"
                }`}
              />
            ))}
          </div>
          {pinError ? (
            <p role="alert" className="text-center text-sm font-medium text-danger" data-testid="pin-error">
              {pinError}
            </p>
          ) : null}
          <div className="grid grid-cols-3 gap-2">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
              <button key={d} type="button" className={keypadButton} onClick={() => press(d)} disabled={submitting}>
                {d}
              </button>
            ))}
            <button
              type="button"
              className={`${keypadButton} text-sm`}
              onClick={backspace}
              disabled={submitting || pin.length === 0}
              aria-label={t("femme.sharedDevice.backspace")}
            >
              ⌫
            </button>
            <button type="button" className={keypadButton} onClick={() => press("0")} disabled={submitting}>
              0
            </button>
            <Button
              type="button"
              className="min-h-14 w-full sm:h-14 sm:min-h-14"
              onClick={() => void submit()}
              disabled={submitting || pin.length < PIN_MIN}
              data-testid="pin-submit"
            >
              {t("femme.sharedDevice.enter")}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
