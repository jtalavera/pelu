import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Button, Heading, Input, Label, Text } from "@design-system";
import { apiBaseUrl } from "../api/baseUrl";
import { ACCESS_TOKEN_STORAGE_KEY } from "../api/baseUrl";
import { FieldValidationError } from "../components/FieldValidationError";
import { LanguageSwitcher } from "../components/LanguageSwitcher";
import { useTour } from "../tour/useTour";
import { loginSteps } from "../tour/steps/login";

export default function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  useTour("login", loginSteps, undefined, false);
  const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname ?? "/app";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`${apiBaseUrl()}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      if (!res.ok) {
        setError(t("femme.login.errorInvalid"));
        return;
      }
      const data = (await res.json()) as { accessToken: string };
      sessionStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, data.accessToken);
      // Decode JWT payload to get role without an extra API call
      const payloadBase64 = data.accessToken.split(".")[1] ?? "";
      let role = "ADMIN";
      try {
        const decoded = JSON.parse(atob(payloadBase64.replace(/-/g, "+").replace(/_/g, "/"))) as { role?: string };
        role = decoded.role ?? "ADMIN";
      } catch {
        // keep ADMIN default
      }
      const destination =
        from !== "/app"
          ? from
          : role === "PROFESSIONAL"
            ? "/app/calendar"
            : role === "SYSTEM_ADMIN"
              ? "/app/settings/feature-flags"
              : "/app";
      navigate(destination, { replace: true });
    } catch {
      setError(t("femme.login.errorNetwork"));
    } finally {
      setSubmitting(false);
    }
  }

  const inputClassName =
    "mt-1 w-full border-[var(--color-stone-md)] bg-[var(--color-white)] text-[var(--color-ink)] placeholder:text-[var(--color-ink-3)] focus-visible:border-[var(--color-rose)] focus-visible:ring-2 focus-visible:ring-[var(--color-rose-lt)] dark:focus-visible:ring-[var(--color-rose-md)]";

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
        <div className="flex items-center justify-between gap-4">
          <span
            className="text-lg font-medium text-[var(--color-rose)]"
            style={{ letterSpacing: "-0.01em" }}
          >
            {t("femme.appName")}
          </span>
          <LanguageSwitcher />
        </div>

        <div
          data-tour="login-form"
          className="rounded-[var(--radius-xl)] p-6 md:p-8"
          style={{
            background: "var(--color-white)",
            border: "var(--border-default)",
            boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
          }}
        >
          <Heading as="h1" className="mb-1 !text-[var(--color-ink)]">
            {t("femme.login.title")}
          </Heading>
          <Text variant="muted" className="mb-6 text-[var(--color-ink-3)]">
            {t("femme.login.subtitle")}
          </Text>
          <form className="flex flex-col gap-4" onSubmit={onSubmit}>
            <div data-tour="login-email">
              <Label htmlFor="email" className="text-[var(--color-ink-2)]">
                {t("femme.login.email")}
              </Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className={inputClassName}
              />
            </div>
            <div data-tour="login-password">
              <Label htmlFor="password" className="text-[var(--color-ink-2)]">
                {t("femme.login.password")}
              </Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className={inputClassName}
              />
            </div>
            {error ? <FieldValidationError>{error}</FieldValidationError> : null}
            <Button
              data-tour="login-submit"
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
              {submitting ? t("femme.login.submitting") : t("femme.login.submit")}
            </Button>
          </form>
          <div className="mt-4 text-center">
            <Link
              data-tour="login-forgot"
              to="/forgot-password"
              className="text-sm font-medium text-[var(--color-rose)] underline-offset-4 hover:text-[var(--color-rose-dk)] hover:underline"
            >
              {t("femme.login.forgotPassword")}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
