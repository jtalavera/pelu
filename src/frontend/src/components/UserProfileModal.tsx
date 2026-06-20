/**
 * HU-30 AC-10/11: Profile edit modal opened from the "Configuración de usuario" user menu option.
 * - For PROFESSIONAL users: shows full profile (nombre, apellido, dirección, teléfono, email, foto)
 *   backed by the linked Professional record.
 * - For ADMIN users (no linked Professional): shows email-only + change-password.
 * Also accessible via the "Cambiar contraseña" menu shortcut (initialTab="password").
 */
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Input, Label, Modal, Spinner, Text } from "@design-system";
import { femmePutJson, femmePostJson } from "../api/femmeClient";
import { translateApiError } from "../api/parseApiErrorMessage";
import { FieldValidationError } from "./FieldValidationError";
import {
  PROFESSIONAL_PHOTO_ACCEPT,
  validateAndReadProfessionalPhotoFile,
} from "../utils/professionalPhotoUpload";
import type { Me } from "../hooks/useMe";

type Tab = "profile" | "password";

type Props = {
  me: Me;
  initialTab?: Tab;
  onClose: () => void;
  onSaved?: () => void;
};

export function UserProfileModal({ me, initialTab = "profile", onClose, onSaved }: Props) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<Tab>(initialTab);

  /* ── Profile form state ── */
  const hasProfile = me.professionalId != null;
  const prof = me.profile;

  function splitName(fullName: string | null): { firstName: string; lastName: string } {
    if (!fullName) return { firstName: "", lastName: "" };
    const idx = fullName.indexOf(" ");
    if (idx === -1) return { firstName: fullName, lastName: "" };
    return { firstName: fullName.slice(0, idx), lastName: fullName.slice(idx + 1) };
  }

  const { firstName: initFirst, lastName: initLast } = splitName(prof?.fullName ?? null);
  const [firstName, setFirstName] = useState(initFirst);
  const [lastName, setLastName] = useState(initLast);
  const [phone, setPhone] = useState(prof?.phone ?? "");
  const [profileEmail, setProfileEmail] = useState(prof?.email ?? me.email ?? "");
  const [address, setAddress] = useState(prof?.address ?? "");
  const [photoDataUrl, setPhotoDataUrl] = useState(prof?.photoDataUrl ?? "");
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSuccess, setProfileSuccess] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);

  /* ── Password form state ── */
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordSuccess, setPasswordSuccess] = useState(false);

  async function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    setPhotoError(null);
    const file = e.target.files?.[0];
    if (!file) return;
    const result = await validateAndReadProfessionalPhotoFile(file);
    if (!result.ok) {
      const codeMap: Record<string, string> = {
        EXTENSION_INVALID: t("femme.professionals.form.photoErrorExtensionInvalid"),
        FILE_TOO_LARGE: t("femme.professionals.form.photoErrorFileTooLarge"),
        DIMENSIONS_TOO_LARGE: t("femme.professionals.form.photoErrorDimensionsTooLarge"),
        IMAGE_LOAD_FAILED: t("femme.professionals.form.photoErrorImageLoadFailed"),
      };
      setPhotoError(codeMap[result.code] ?? t("femme.professionals.form.photoErrorImageLoadFailed"));
      return;
    }
    setPhotoDataUrl(result.dataUrl);
  }

  async function handleProfileSave(e: React.FormEvent) {
    e.preventDefault();
    setProfileError(null);
    setProfileSuccess(false);
    setProfileSaving(true);
    try {
      const fullName = [firstName.trim(), lastName.trim()].filter(Boolean).join(" ");
      await femmePutJson("/api/me/profile", {
        fullName: fullName || undefined,
        phone: phone || null,
        email: profileEmail || null,
        address: address || null,
        photoDataUrl: photoDataUrl || null,
      });
      setProfileSuccess(true);
      onSaved?.();
    } catch (err) {
      setProfileError(translateApiError(err, t, "femme.apiErrors.GENERIC"));
    } finally {
      setProfileSaving(false);
    }
  }

  async function handlePasswordSave(e: React.FormEvent) {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSuccess(false);
    if (newPassword !== confirmPassword) {
      setPasswordError(t("femme.activate.errorPasswordMismatch"));
      return;
    }
    setPasswordSaving(true);
    try {
      await femmePostJson("/api/me/change-password", { newPassword });
      setPasswordSuccess(true);
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      const mapped = translateApiError(err, t, "femme.apiErrors.GENERIC");
      setPasswordError(mapped);
    } finally {
      setPasswordSaving(false);
    }
  }

  const tabStyle = (tab: Tab): React.CSSProperties => ({
    padding: "8px 16px",
    fontSize: 13,
    fontWeight: activeTab === tab ? 600 : 400,
    color: activeTab === tab ? "var(--color-rose-dk)" : "var(--color-ink-2)",
    background: activeTab === tab ? "var(--color-rose-lt)" : "transparent",
    border: "none",
    borderRadius: "var(--radius-md)",
    cursor: "pointer",
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={t("app.userProfile.title")}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Tabs */}
        <div style={{ display: "flex", gap: 4 }} role="tablist">
          {hasProfile && (
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "profile"}
              style={tabStyle("profile")}
              onClick={() => setActiveTab("profile")}
            >
              {t("app.userProfile.tabProfile")}
            </button>
          )}
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "password"}
            style={tabStyle("password")}
            onClick={() => setActiveTab("password")}
          >
            {t("app.userProfile.tabPassword")}
          </button>
        </div>

        {/* Profile tab */}
        {activeTab === "profile" && hasProfile && (
          <form onSubmit={(e) => void handleProfileSave(e)} noValidate>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {profileError && (
                <Alert variant="destructive" title={t("app.userProfile.errorTitle")}>
                  {profileError}
                </Alert>
              )}
              {profileSuccess && (
                <Alert variant="success" title={t("app.userProfile.savedTitle")}>
                  {t("app.userProfile.savedTitle")}
                </Alert>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <Label htmlFor="profile-first-name">{t("app.userProfile.firstName")}</Label>
                  <Input
                    id="profile-first-name"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="profile-last-name">{t("app.userProfile.lastName")}</Label>
                  <Input
                    id="profile-last-name"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="profile-address">{t("app.userProfile.address")}</Label>
                <Input
                  id="profile-address"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                />
              </div>

              <div>
                <Label htmlFor="profile-phone">{t("app.userProfile.phone")}</Label>
                <Input
                  id="profile-phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>

              <div>
                <Label htmlFor="profile-email">{t("app.userProfile.email")}</Label>
                <Input
                  id="profile-email"
                  type="email"
                  value={profileEmail}
                  onChange={(e) => setProfileEmail(e.target.value)}
                />
              </div>

              {/* Photo */}
              <div>
                <Label htmlFor="profile-photo">{t("femme.professionals.form.photoDataUrl")}</Label>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 4 }}>
                  {photoDataUrl && (
                    <img
                      src={photoDataUrl}
                      alt={t("femme.professionals.form.photoPreviewAlt")}
                      style={{
                        width: 52,
                        height: 52,
                        borderRadius: "var(--radius-md)",
                        objectFit: "cover",
                        border: "var(--border-default)",
                      }}
                    />
                  )}
                  <input
                    ref={photoInputRef}
                    id="profile-photo"
                    type="file"
                    accept={PROFESSIONAL_PHOTO_ACCEPT}
                    style={{ display: "none" }}
                    onChange={(e) => void handlePhotoChange(e)}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => photoInputRef.current?.click()}
                  >
                    {photoDataUrl
                      ? t("femme.professionals.form.photoChangeFile")
                      : t("femme.professionals.form.photoChooseFile")}
                  </Button>
                  {photoDataUrl && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setPhotoDataUrl("")}
                    >
                      {t("femme.professionals.form.photoRemove")}
                    </Button>
                  )}
                </div>
                {photoError && <FieldValidationError>{photoError}</FieldValidationError>}
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <Button type="button" variant="secondary" onClick={onClose}>
                  {t("app.userProfile.cancel")}
                </Button>
                <Button type="submit" disabled={profileSaving}>
                  {profileSaving ? <Spinner size="sm" /> : t("app.userProfile.save")}
                </Button>
              </div>
            </div>
          </form>
        )}

        {/* Degraded admin view — only show password tab (no profile) */}
        {activeTab === "profile" && !hasProfile && (
          <Text variant="muted">{t("app.userProfile.adminNoProfile")}</Text>
        )}

        {/* Password tab */}
        {activeTab === "password" && (
          <form onSubmit={(e) => void handlePasswordSave(e)} noValidate>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {passwordError && (
                <Alert variant="destructive" title={t("app.userProfile.errorTitle")}>
                  {passwordError}
                </Alert>
              )}
              {passwordSuccess && (
                <Alert variant="success" title={t("app.userProfile.passwordChangedTitle")}>
                  {t("app.userProfile.passwordChangedTitle")}
                </Alert>
              )}

              <Text variant="small" className="text-[rgb(var(--color-ink-2))]">
                {t("femme.activate.passwordHelp")}
              </Text>

              <div>
                <Label htmlFor="profile-new-password">
                  {t("app.userProfile.newPassword")}
                </Label>
                <Input
                  id="profile-new-password"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  aria-describedby="profile-password-help"
                />
              </div>

              <div>
                <Label htmlFor="profile-confirm-password">
                  {t("app.userProfile.confirmPassword")}
                </Label>
                <Input
                  id="profile-confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <Button type="button" variant="secondary" onClick={onClose}>
                  {t("app.userProfile.cancel")}
                </Button>
                <Button type="submit" disabled={passwordSaving}>
                  {passwordSaving ? <Spinner size="sm" /> : t("app.userProfile.changePassword")}
                </Button>
              </div>
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
}
