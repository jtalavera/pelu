import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Alert, Button, Input, KebabMenu, Label, Modal, Spinner, Text } from "@design-system";
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
import { SettingsHeaderAction } from "./settingsContext";

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
  const [activateOpen, setActivateOpen] = useState(false);

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
      setActivateOpen(false);
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
    <div className="flex min-w-0 flex-col gap-3" data-testid="shared-devices-settings">
      {!thisDevice && (
        <SettingsHeaderAction>
          <Button type="button" className="min-h-11" onClick={() => setActivateOpen(true)} data-testid="activate-shared-device-open">
            {t("femme.sharedDevice.settings.activateTitle")}
          </Button>
        </SettingsHeaderAction>
      )}
      <p className="px-0.5 text-sm text-ink-3">{t("femme.sharedDevice.settings.lead")}</p>

      {pageError ? <Alert variant="destructive">{pageError}</Alert> : null}
      {message ? (
        <Alert variant="success" data-testid="shared-devices-message">
          {message}
        </Alert>
      ) : null}

      {thisDevice ? (
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-surface p-4"
          data-testid="this-device-active"
        >
          <span className="min-w-0 text-sm text-ink">
            {t("femme.sharedDevice.settings.thisDeviceActive", { name: thisDevice.name })}
          </span>
          <Button type="button" className="min-h-11" onClick={openPicker} data-testid="open-shared-device">
            {t("femme.sharedDevice.settings.openPicker")}
          </Button>
        </div>
      ) : null}

      <div className="rounded-card border border-line bg-surface shadow-sm">
        {devices === null ? (
          <div className="p-4">
            <Spinner label={t("femme.platform.loading")} />
          </div>
        ) : devices.length === 0 ? (
          <Text variant="muted" className="p-4">
            {t("femme.sharedDevice.settings.empty")}
          </Text>
        ) : (
          <ul data-testid="shared-devices-list">
            {devices.map((d) => (
              <li
                key={d.id}
                data-testid={`shared-device-row-${d.id}`}
                className="grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t border-line px-4 py-2 first:border-t-0"
              >
                <div className="min-w-0 text-sm">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold text-ink">
                    {d.name}
                    {thisDevice?.deviceId === d.id ? (
                      <span className="rounded-full bg-success-lt px-2.5 py-0.5 text-xs font-extrabold text-success">
                        {t("femme.sharedDevice.settings.thisDevice")}
                      </span>
                    ) : null}
                    {d.lockedUntil ? (
                      <span
                        className="rounded-full bg-warning-lt px-2.5 py-0.5 text-xs font-extrabold text-warning"
                        data-testid={`shared-device-row-locked-${d.id}`}
                      >
                        {t("femme.sharedDevice.settings.lockedUntil", { time: formatTime(d.lockedUntil) })}
                      </span>
                    ) : null}
                  </div>
                  <div className="text-ink-3">
                    {t("femme.sharedDevice.settings.createdAt", { date: formatDateTime(d.createdAt) })}
                    {" · "}
                    {d.lastUsedAt
                      ? t("femme.sharedDevice.settings.lastUsedAt", { date: formatDateTime(d.lastUsedAt) })
                      : t("femme.sharedDevice.settings.neverUsed")}
                  </div>
                </div>
                <KebabMenu
                  id={`shared-device-${d.id}`}
                  triggerAriaLabel={t("femme.sharedDevice.settings.rowActions", { name: d.name })}
                  items={[
                    ...(d.lockedUntil
                      ? [{ id: "unlock", label: t("femme.sharedDevice.settings.unlock"), onSelect: () => void unlock(d) }]
                      : []),
                    {
                      id: "revoke",
                      label: t("femme.sharedDevice.settings.revoke"),
                      destructive: true,
                      onSelect: () => setRevokeTarget(d),
                    },
                  ]}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <Modal
        open={activateOpen && !thisDevice}
        onClose={() => setActivateOpen(false)}
        title={t("femme.sharedDevice.settings.activateTitle")}
        description={t("femme.sharedDevice.settings.activateHint")}
        className="max-w-md"
        footer={
          <>
            <Button type="button" variant="secondary" className="min-h-11 w-full sm:w-auto" onClick={() => setActivateOpen(false)}>
              {t("femme.professionals.cancel")}
            </Button>
            <Button
              type="submit"
              form="activate-shared-device-form"
              className="min-h-11 w-full sm:w-auto"
              disabled={activating}
              data-testid="activate-shared-device"
            >
              {t("femme.sharedDevice.settings.activate")}
            </Button>
          </>
        }
      >
        <form
          id="activate-shared-device-form"
          onSubmit={(e) => void activate(e)}
          className="flex flex-col gap-3"
          data-testid="activate-shared-device-form"
        >
          <div className="flex flex-col gap-1">
            <Label htmlFor="shared-device-name">{t("femme.sharedDevice.settings.name")}</Label>
            <Input
              id="shared-device-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("femme.sharedDevice.settings.namePlaceholder")}
              maxLength={100}
              invalid={!!formError.name}
              aria-describedby={formError.name ? "shared-device-name-err" : undefined}
            />
            <FieldValidationError id="shared-device-name-err">{formError.name}</FieldValidationError>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="shared-device-password">{t("femme.sharedDevice.settings.password")}</Label>
            <Input
              id="shared-device-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              invalid={!!formError.password}
              aria-describedby={formError.password ? "shared-device-password-err" : undefined}
            />
            <FieldValidationError id="shared-device-password-err">{formError.password}</FieldValidationError>
          </div>
          {formError.other ? <Alert variant="destructive">{formError.other}</Alert> : null}
        </form>
      </Modal>

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
