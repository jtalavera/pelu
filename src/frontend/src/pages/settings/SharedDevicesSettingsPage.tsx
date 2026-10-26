import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Alert, Button, Input, Label, Spinner, Text } from "@design-system";
import {
  activateSharedDevice,
  listSharedDevices,
  revokeSharedDevice,
  unlockSharedDevice,
  type SharedDevice,
} from "../../api/sharedDevices";
import { translateApiError } from "../../api/parseApiErrorMessage";
import {
  clearSharedDevice,
  endSession,
  getSharedDevice,
  setSharedDevice,
  SHARED_DEVICE_PATH,
} from "../../auth/sharedDevice";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { FieldValidationError } from "../../components/FieldValidationError";

/**
 * HU-66: Configuración del negocio → Dispositivos compartidos (administrator only). Enable this
 * device (confirming the password), list / revoke / unlock the salon's shared devices, and switch
 * this device to the professional picker.
 */
export default function SharedDevicesSettingsPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [devices, setDevices] = useState<SharedDevice[] | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [thisDevice, setThisDevice] = useState(() => getSharedDevice());
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [formError, setFormError] = useState<{ name?: string; password?: string; other?: string }>({});
  const [activating, setActivating] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<SharedDevice | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const formatDateTime = useCallback(
    (iso: string) =>
      new Date(iso).toLocaleString(i18n.resolvedLanguage ?? "es", {
        dateStyle: "short",
        timeStyle: "short",
      }),
    [i18n.resolvedLanguage],
  );
  const formatTime = useCallback(
    (iso: string) =>
      new Date(iso).toLocaleTimeString(i18n.resolvedLanguage ?? "es", {
        hour: "2-digit",
        minute: "2-digit",
      }),
    [i18n.resolvedLanguage],
  );

  const load = useCallback(async () => {
    try {
      const list = await listSharedDevices();
      setDevices(list);
      setPageError(null);
      // This browser's device was revoked elsewhere: forget it.
      const local = getSharedDevice();
      if (local && !list.some((d) => d.id === local.deviceId)) {
        clearSharedDevice();
        setThisDevice(null);
      }
    } catch (e) {
      setPageError(translateApiError(e, t, "femme.apiErrors.GENERIC"));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function activate(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const errs: typeof formError = {};
    if (!name.trim()) errs.name = t("femme.sharedDevice.settings.nameRequired");
    if (!password) errs.password = t("femme.sharedDevice.settings.passwordRequired");
    setFormError(errs);
    if (errs.name || errs.password) return;
    setActivating(true);
    try {
      const activated = await activateSharedDevice(name.trim(), password);
      setSharedDevice({
        deviceId: activated.device.id,
        name: activated.device.name,
        tenantName: activated.tenantName,
        token: activated.deviceToken,
      });
      setThisDevice(getSharedDevice());
      setName("");
      setPassword("");
      setMessage(t("femme.sharedDevice.settings.activated", { name: activated.device.name }));
      await load();
    } catch (err) {
      const msg = translateApiError(err, t, "femme.apiErrors.GENERIC");
      if (msg === t("femme.apiErrors.SHARED_DEVICE_PASSWORD_INVALID")) {
        setFormError({ password: msg });
      } else {
        setFormError({ other: msg });
      }
    } finally {
      setActivating(false);
    }
  }

  async function confirmRevoke() {
    const target = revokeTarget;
    setRevokeTarget(null);
    if (!target) return;
    try {
      await revokeSharedDevice(target.id);
      if (thisDevice?.deviceId === target.id) {
        clearSharedDevice();
        setThisDevice(null);
      }
      setMessage(t("femme.sharedDevice.settings.revoked", { name: target.name }));
      await load();
    } catch (err) {
      setPageError(translateApiError(err, t, "femme.apiErrors.GENERIC"));
    }
  }

  async function unlock(device: SharedDevice) {
    try {
      await unlockSharedDevice(device.id);
      setMessage(t("femme.sharedDevice.settings.unlocked", { name: device.name }));
      await load();
    } catch (err) {
      setPageError(translateApiError(err, t, "femme.apiErrors.GENERIC"));
    }
  }

  function openPicker() {
    // The admin's own session ends: from now on this device shows the professional picker.
    endSession();
    navigate(SHARED_DEVICE_PATH, { replace: true });
  }

  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="shared-devices-settings">
      <Text variant="muted">{t("femme.sharedDevice.settings.lead")}</Text>

      {pageError ? <Alert variant="destructive">{pageError}</Alert> : null}
      {message ? (
        <Alert variant="success" data-testid="shared-devices-message">
          {message}
        </Alert>
      ) : null}

      {thisDevice ? (
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-lg)] border border-[var(--color-stone-md)] bg-[var(--color-stone)] p-4"
          data-testid="this-device-active"
        >
          <span className="min-w-0 text-sm">
            {t("femme.sharedDevice.settings.thisDeviceActive", { name: thisDevice.name })}
          </span>
          <Button type="button" className="min-h-11" onClick={openPicker} data-testid="open-shared-device">
            {t("femme.sharedDevice.settings.openPicker")}
          </Button>
        </div>
      ) : (
        <form
          onSubmit={(e) => void activate(e)}
          className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--color-stone-md)] p-4"
          data-testid="activate-shared-device-form"
        >
          <h3 className="text-sm font-medium">{t("femme.sharedDevice.settings.activateTitle")}</h3>
          <Text variant="muted" className="text-xs">
            {t("femme.sharedDevice.settings.activateHint")}
          </Text>
          <div>
            <Label htmlFor="shared-device-name">{t("femme.sharedDevice.settings.name")}</Label>
            <Input
              id="shared-device-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("femme.sharedDevice.settings.namePlaceholder")}
              maxLength={100}
              aria-invalid={formError.name ? true : undefined}
              aria-describedby={formError.name ? "shared-device-name-err" : undefined}
            />
            <FieldValidationError id="shared-device-name-err">{formError.name}</FieldValidationError>
          </div>
          <div>
            <Label htmlFor="shared-device-password">{t("femme.sharedDevice.settings.password")}</Label>
            <Input
              id="shared-device-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={formError.password ? true : undefined}
              aria-describedby={formError.password ? "shared-device-password-err" : undefined}
            />
            <FieldValidationError id="shared-device-password-err">{formError.password}</FieldValidationError>
          </div>
          {formError.other ? <Alert variant="destructive">{formError.other}</Alert> : null}
          <div>
            <Button type="submit" className="min-h-11" disabled={activating} data-testid="activate-shared-device">
              {t("femme.sharedDevice.settings.activate")}
            </Button>
          </div>
        </form>
      )}

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">{t("femme.sharedDevice.settings.listTitle")}</h3>
        {devices === null ? (
          <Spinner label={t("femme.platform.loading")} />
        ) : devices.length === 0 ? (
          <Text variant="muted">{t("femme.sharedDevice.settings.empty")}</Text>
        ) : (
          <ul className="flex flex-col gap-2" data-testid="shared-devices-list">
            {devices.map((d) => (
              <li
                key={d.id}
                data-testid={`shared-device-row-${d.id}`}
                className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-lg)] border border-[var(--color-stone-md)] p-3"
              >
                <div className="min-w-0 text-sm">
                  <div className="font-medium">
                    {d.name}
                    {thisDevice?.deviceId === d.id ? (
                      <span className="ml-2 text-xs font-normal text-[var(--color-ink-3)]">
                        {t("femme.sharedDevice.settings.thisDevice")}
                      </span>
                    ) : null}
                  </div>
                  <div className="text-xs text-[var(--color-ink-3)]">
                    {t("femme.sharedDevice.settings.createdAt", { date: formatDateTime(d.createdAt) })}
                    {" · "}
                    {d.lastUsedAt
                      ? t("femme.sharedDevice.settings.lastUsedAt", { date: formatDateTime(d.lastUsedAt) })
                      : t("femme.sharedDevice.settings.neverUsed")}
                  </div>
                  {d.lockedUntil ? (
                    <div
                      className="text-xs font-medium text-danger"
                      data-testid={`shared-device-row-locked-${d.id}`}
                    >
                      {t("femme.sharedDevice.settings.lockedUntil", { time: formatTime(d.lockedUntil) })}
                    </div>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  {d.lockedUntil ? (
                    <Button
                      type="button"
                      variant="secondary"
                      className="min-h-11"
                      onClick={() => void unlock(d)}
                      data-testid={`shared-device-unlock-${d.id}`}
                    >
                      {t("femme.sharedDevice.settings.unlock")}
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="secondary"
                    className="min-h-11"
                    onClick={() => setRevokeTarget(d)}
                    data-testid={`shared-device-revoke-${d.id}`}
                  >
                    {t("femme.sharedDevice.settings.revoke")}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {revokeTarget ? (
        <ConfirmDialog
          open
          title={t("femme.sharedDevice.settings.revokeTitle")}
          description={t("femme.sharedDevice.settings.revokeDescription", { name: revokeTarget.name })}
          cancelLabel={t("femme.professionals.cancel")}
          confirmLabel={t("femme.sharedDevice.settings.revoke")}
          onCancel={() => setRevokeTarget(null)}
          onConfirm={() => void confirmRevoke()}
        />
      ) : null}
    </div>
  );
}
