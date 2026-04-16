import { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button, Heading, Input, Label, Spinner, Text } from "@design-system";
import { apiBaseUrl } from "../api/baseUrl";
import { FieldValidationError } from "../components/FieldValidationError";

type TokenInfo = {
  professionalId: number;
  professionalName: string;
  email: string;
};

export default function ActivatePage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const rawToken = searchParams.get("token") ?? "";

  const [tokenInfo, setTokenInfo] = useState<TokenInfo | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [tokenLoading, setTokenLoading] = useState(true);

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!rawToken) {
      setTokenError(t("femme.activate.errorInvalid"));
      setTokenLoading(false);
      return;
    }
    (async () => {
      try {
        const res = await fetch(
          `${apiBaseUrl()}/api/auth/validate-activation-token?token=${encodeURIComponent(rawToken)}`,
        );
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          if (data.error === "TOKEN_EXPIRED") {
            setTokenError(t("femme.activate.errorExpired"));
          } else {
            setTokenError(t("femme.activate.errorInvalid"));
          }
          return;
        }
        const info = (await res.json()) as TokenInfo;
        setTokenInfo(info);
      } catch {
        setTokenError(t("femme.activate.errorNetwork"));
      } finally {
        setTokenLoading(false);
      }
    })();
  }, [rawToken, t]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (password !== confirmPassword) {
      setFormError(t("femme.activate.errorPasswordMismatch"));
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`${apiBaseUrl()}/api/auth/activate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: rawToken, password, confirmPassword }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (data.error === "PASSWORDS_DO_NOT_MATCH") {
          setFormError(t("femme.activate.errorPasswordMismatch"));
        } else if (data.error === "PASSWORD_TOO_WEAK") {
          setFormError(t("femme.activate.errorPasswordWeak"));
        } else if (data.error === "TOKEN_EXPIRED") {
          setFormError(t("femme.activate.errorExpired"));
        } else {
          setFormError(t("femme.activate.errorInvalid"));
        }
        return;
      }
      setDone(true);
    } catch {
      setFormError(t("femme.activate.errorNetwork"));
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
          Femme
        </span>

        <div
          className="rounded-[var(--radius-xl)] p-6 md:p-8"
          style={{
            background: "var(--color-white)",
            border: "var(--border-default)",
            boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
          }}
        >
          {tokenLoading ? (
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <Spinner size="sm" />
              <Text variant="muted">{t("femme.activate.loading")}</Text>
            </div>
          ) : tokenError ? (
            <div className="flex flex-col gap-4">
              <Heading as="h1" className="!text-[var(--color-ink)]">
                {t("femme.activate.title")}
              </Heading>
              <FieldValidationError>{tokenError}</FieldValidationError>
              <Link
                to="/login"
                className="text-sm font-medium text-[var(--color-rose)] underline-offset-4 hover:underline"
              >
                {t("femme.activate.goToLogin")}
              </Link>
            </div>
          ) : done ? (
            <div className="flex flex-col gap-4">
              <Heading as="h1" className="!text-[var(--color-ink)]">
                {t("femme.activate.title")}
              </Heading>
              <Text style={{ color: "var(--color-success)", fontWeight: 500 }}>
                {t("femme.activate.success")}
              </Text>
              <Link
                to="/login"
                className="text-sm font-medium text-[var(--color-rose)] underline-offset-4 hover:underline"
              >
                {t("femme.activate.goToLogin")}
              </Link>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <Heading as="h1" className="mb-1 !text-[var(--color-ink)]">
                {t("femme.activate.title")}
              </Heading>
              <Text variant="muted" className="mb-2 text-[var(--color-ink-3)]">
                {tokenInfo
                  ? t("femme.activate.subTitleNamed", { name: tokenInfo.professionalName })
                  : t("femme.activate.subtitle")}
              </Text>
              <form className="flex flex-col gap-4" onSubmit={onSubmit}>
                <div>
                  <Label htmlFor="activate-password" className="text-[var(--color-ink-2)]">
                    {t("femme.activate.password")}
                  </Label>
                  <Input
                    id="activate-password"
                    name="password"
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className={inputClassName}
                    aria-describedby="activate-password-help"
                  />
                  <Text variant="muted" className="mt-1 text-xs" id="activate-password-help">
                    {t("femme.activate.passwordHelp")}
                  </Text>
                </div>
                <div>
                  <Label htmlFor="activate-confirm-password" className="text-[var(--color-ink-2)]">
                    {t("femme.activate.confirmPassword")}
                  </Label>
                  <Input
                    id="activate-confirm-password"
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
                  {submitting ? t("femme.activate.submitting") : t("femme.activate.submit")}
                </Button>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
