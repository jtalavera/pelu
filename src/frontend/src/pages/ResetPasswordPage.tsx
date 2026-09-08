import { useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button, Heading, Input, Label, Text } from "@design-system";
import { apiBaseUrl } from "../api/baseUrl";
import { FieldValidationError } from "../components/FieldValidationError";

// HU-44 AC-2/AC-3/AC-4: the link emailed by both the self-service "forgot password" flow and a
// Platform-Admin-triggered reset (POST /api/auth/reset-password). Unlike ActivatePage there is no
// GET validate-token endpoint for reset tokens — the token is only checked when the new password
// is actually submitted, so this page shows the form immediately instead of a loading state.
export default function ResetPasswordPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const rawToken = searchParams.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(
    rawToken ? null : t("femme.resetPassword.errorInvalid"),
  );
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (password !== confirmPassword) {
      setFormError(t("femme.resetPassword.errorPasswordMismatch"));
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`${apiBaseUrl()}/api/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: rawToken, newPassword: password }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (data.error === "TOKEN_EXPIRED") {
          setFormError(t("femme.resetPassword.errorExpired"));
        } else {
          setFormError(t("femme.resetPassword.errorInvalid"));
        }
        return;
      }
      setDone(true);
    } catch {
      setFormError(t("femme.resetPassword.errorNetwork"));
    } finally {
      setSubmitting(false);
    }
  }

  const inputClassName =
    "mt-1 w-full border-[var(--color-stone-md)] bg-[var(--color-white)] text-[var(--color-ink)] placeholder:text-[var(--color-ink-3)] focus-visible:border-[var(--color-rose)] focus-visible:ring-2 focus-visible:ring-[var(--color-rose-lt)]";

  return (
    <div
      className="min-h-screen bg-[var(--color-stone)] px-4 py-10 text-[var(--color-ink)]"
      style={{
        paddingBottom: "max(2.5rem, env(safe-area-inset-bottom))",
        paddingLeft: "max(1rem, env(safe-area-inset-left))",
        paddingRight: "max(1rem, env(safe-area-inset-right))",
        paddingTop: "max(2.5rem, env(safe-area-inset-top))",
      }}
    >
      <div className="mx-auto flex max-w-md flex-col gap-6">
        <span
          className="text-lg font-medium text-[var(--color-rose)]"
          style={{ letterSpacing: "-0.01em" }}
        >
          {t("femme.appName")}
        </span>

        <div
          className="rounded-[var(--radius-xl)] p-6 md:p-8"
          style={{
            background: "var(--color-white)",
            border: "var(--border-default)",
            boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
          }}
        >
          {done ? (
            <div className="flex flex-col gap-4">
              <Heading as="h1" className="!text-[var(--color-ink)]">
                {t("femme.resetPassword.title")}
              </Heading>
              <Text style={{ color: "var(--color-success)", fontWeight: 500 }}>
                {t("femme.resetPassword.success")}
              </Text>
              <Link
                to="/login"
                className="text-sm font-medium text-[var(--color-rose)] underline-offset-4 hover:underline"
              >
                {t("femme.resetPassword.goToLogin")}
              </Link>
            </div>
          ) : !rawToken ? (
            <div className="flex flex-col gap-4">
              <Heading as="h1" className="!text-[var(--color-ink)]">
                {t("femme.resetPassword.title")}
              </Heading>
              <FieldValidationError>{formError}</FieldValidationError>
              <Link
                to="/login"
                className="text-sm font-medium text-[var(--color-rose)] underline-offset-4 hover:underline"
              >
                {t("femme.resetPassword.goToLogin")}
              </Link>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <Heading as="h1" className="mb-1 !text-[var(--color-ink)]">
                {t("femme.resetPassword.title")}
              </Heading>
              <Text variant="muted" className="mb-2 text-[var(--color-ink-3)]">
                {t("femme.resetPassword.subtitle")}
              </Text>
              <form className="flex flex-col gap-4" onSubmit={onSubmit}>
                <div>
                  <Label htmlFor="reset-password" className="text-[var(--color-ink-2)]">
                    {t("femme.resetPassword.password")}
                  </Label>
                  <Input
                    id="reset-password"
                    name="password"
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className={inputClassName}
                    aria-describedby="reset-password-help"
                  />
                  <Text variant="muted" className="mt-1 text-xs" id="reset-password-help">
                    {t("femme.resetPassword.passwordHelp")}
                  </Text>
                </div>
                <div>
                  <Label htmlFor="reset-confirm-password" className="text-[var(--color-ink-2)]">
                    {t("femme.resetPassword.confirmPassword")}
                  </Label>
                  <Input
                    id="reset-confirm-password"
                    name="confirmPassword"
                    type="password"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    className={inputClassName}
                  />
                </div>
                {formError ? <FieldValidationError>{formError}</FieldValidationError> : null}
                <Button
                  type="submit"
                  variant="primary"
                  className="min-h-11 w-full rounded-[var(--radius-md)]"
                  style={{
                    background: "var(--color-rose)",
                    color: "var(--color-on-primary)",
                    border: "none",
                  }}
                  disabled={submitting}
                >
                  {submitting ? t("femme.resetPassword.submitting") : t("femme.resetPassword.submit")}
                </Button>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
