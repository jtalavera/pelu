import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@design-system";
import { resendProfessionalAccess } from "../api/professionalAccess";
import { translateApiError } from "../api/parseApiErrorMessage";

export type ProfessionalAccessStatus = "NO_ACCESS" | "INVITATION_SENT" | "INVITATION_EXPIRED" | "ACTIVE";

/** The saved access state of a professional, as returned by the API (issue #38). */
export type ProfessionalAccessState = {
  id: number;
  email: string | null;
  systemAccessAllowed: boolean;
  accessStatus: ProfessionalAccessStatus | null;
  accessLoginEmail: string | null;
  invitationSentAt: string | null;
  invitationExpiresAt: string | null;
  resendAvailableAt: string | null;
};

type Props<T extends ProfessionalAccessState> = {
  /** Checkbox state in the form (may differ from the saved state until "Save"). */
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** Whether the email currently typed in the form is a valid email. */
  emailValid: boolean;
  /** The email currently typed in the form. */
  email: string;
  /** Saved professional; null while creating a new one. */
  saved: T | null;
  /** Called with the updated professional after a successful resend. */
  onResent: (updated: T) => void;
  /** Success message of the last save (e.g. invitation sent). */
  message: string | null;
};

function normalizeEmail(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * HU-23 + issue #38: the "Acceso al sistema" block of the professional form — the toggle (only
 * enabled with a valid email), the "Estatus del acceso al sistema" line and the "Reenviar
 * invitación" button (pending invitations only, once every 2 minutes).
 */
export function ProfessionalAccessSection<T extends ProfessionalAccessState>({
  checked,
  onCheckedChange,
  emailValid,
  email,
  saved,
  onResent,
  message,
}: Props<T>) {
  const { t } = useTranslation();
  const [now, setNow] = useState(() => Date.now());
  const [resending, setResending] = useState(false);
  const [resendError, setResendError] = useState<string | null>(null);
  const [resendMessage, setResendMessage] = useState<string | null>(null);

  const savedStatus: ProfessionalAccessStatus = saved?.accessStatus ?? "NO_ACCESS";
  const emailChanged = saved != null && normalizeEmail(saved.email) !== normalizeEmail(email);
  // What the status line shows: the saved state, unless the form has unsaved access changes
  // (access just ticked, or a new email that will get a fresh invitation on save).
  const pendingSave = checked && (!saved?.systemAccessAllowed || emailChanged);
  const invitationPending =
    checked &&
    !pendingSave &&
    (savedStatus === "INVITATION_SENT" || savedStatus === "INVITATION_EXPIRED");

  const resendAt = saved?.resendAvailableAt ? new Date(saved.resendAvailableAt).getTime() : 0;
  const waitMs = resendAt - now;

  useEffect(() => {
    if (!invitationPending || waitMs <= 0) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [invitationPending, waitMs]);

  useEffect(() => {
    setResendError(null);
    setResendMessage(null);
  }, [saved?.id]);

  async function resend() {
    if (!saved) return;
    setResending(true);
    setResendError(null);
    setResendMessage(null);
    try {
      const updated = await resendProfessionalAccess<T>(saved.id);
      setNow(Date.now());
      onResent(updated);
      setResendMessage(t("femme.professionals.form.accessResendDone", { email: updated.accessLoginEmail ?? email }));
    } catch (e) {
      setResendError(translateApiError(e, t, "femme.apiErrors.GENERIC"));
    } finally {
      setResending(false);
    }
  }

  let statusText: string;
  if (!checked) {
    statusText = t("femme.professionals.form.accessStatus.NO_ACCESS");
  } else if (pendingSave) {
    statusText = t("femme.professionals.form.accessStatus.PENDING_SAVE");
  } else if (savedStatus === "ACTIVE") {
    statusText = t("femme.professionals.form.accessStatus.ACTIVE", {
      email: saved?.accessLoginEmail ?? email,
    });
  } else {
    statusText = t(`femme.professionals.form.accessStatus.${savedStatus}`);
  }

  const canToggleOn = checked || emailValid;

  return (
    <div
      style={{
        padding: 12,
        border: "var(--border-default)",
        borderRadius: "var(--radius-md)",
        background: "var(--color-stone)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0, flex: "1 1 200px" }}>
          <div style={{ fontSize: 12, fontWeight: 500, color: "var(--color-ink)" }}>
            {t("femme.professionals.form.systemAccess")}
          </div>
          <div style={{ fontSize: 11, color: "var(--color-ink-3)", marginTop: 2 }} id="prof-system-access-hint">
            {canToggleOn
              ? t("femme.professionals.form.systemAccessHint")
              : t("femme.professionals.form.systemAccessNeedsEmail")}
          </div>
        </div>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            cursor: canToggleOn ? "pointer" : "not-allowed",
            flexShrink: 0,
            minHeight: 44,
            opacity: canToggleOn ? 1 : 0.6,
          }}
        >
          <input
            id="prof-system-access"
            type="checkbox"
            checked={checked}
            disabled={!canToggleOn}
            onChange={(e) => onCheckedChange(e.target.checked)}
            style={{ width: 16, height: 16, cursor: canToggleOn ? "pointer" : "not-allowed" }}
            aria-label={t("femme.professionals.form.systemAccessAllow")}
            aria-describedby="prof-system-access-hint"
          />
          <span style={{ fontSize: 12, color: "var(--color-ink-2)" }}>
            {t("femme.professionals.form.systemAccessAllow")}
          </span>
        </label>
      </div>

      <div
        data-testid="prof-access-status"
        data-status={!checked ? "NO_ACCESS" : pendingSave ? "PENDING_SAVE" : savedStatus}
        style={{ marginTop: 10, fontSize: 12, color: "var(--color-ink-2)" }}
      >
        <span style={{ fontWeight: 500, color: "var(--color-ink)" }}>
          {t("femme.professionals.form.accessStatusLabel")}
        </span>{" "}
        <span data-testid="prof-access-status-text">{statusText}</span>
      </div>

      {invitationPending ? (
        <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <Button
            type="button"
            size="sm"
            variant="outline"
            data-testid="prof-access-resend"
            disabled={resending || waitMs > 0}
            onClick={() => void resend()}
          >
            {resending
              ? t("femme.professionals.form.accessResending")
              : t("femme.professionals.form.accessResend")}
          </Button>
          {waitMs > 0 ? (
            <span data-testid="prof-access-resend-wait" style={{ fontSize: 11, color: "var(--color-ink-3)" }}>
              {t("femme.professionals.form.accessResendWait", { time: formatCountdown(waitMs) })}
            </span>
          ) : null}
        </div>
      ) : null}

      {resendError ? (
        <div role="alert" className="mt-2 text-xs text-danger">
          {resendError}
        </div>
      ) : null}
      {message || resendMessage ? (
        <div
          data-testid="prof-access-message"
          style={{ marginTop: 8, fontSize: 11, color: "var(--color-success)", fontWeight: 500 }}
        >
          {resendMessage ?? message}
        </div>
      ) : null}
    </div>
  );
}
