import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Button, Card, Heading, Input, Label, Text } from "@design-system";
import { apiBaseUrl } from "../api/baseUrl";
import { ACCESS_TOKEN_STORAGE_KEY } from "../api/baseUrl";
import { LanguageSwitcher } from "../components/LanguageSwitcher";

export default function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
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
      navigate(from, { replace: true });
    } catch {
      setError(t("femme.login.errorNetwork"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-[rgb(var(--color-bg))] px-4 py-10 text-[rgb(var(--color-fg))]">
      <div className="mx-auto flex max-w-md flex-col gap-6">
        <div className="flex justify-end">
          <LanguageSwitcher />
        </div>
        <Card className="p-6 shadow-sm">
          <Heading as="h1" className="mb-1">
            {t("femme.login.title")}
          </Heading>
          <Text variant="muted" className="mb-6">
            {t("femme.login.subtitle")}
          </Text>
          <form className="flex flex-col gap-4" onSubmit={onSubmit}>
            <div>
              <Label htmlFor="email">{t("femme.login.email")}</Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="mt-1 w-full"
              />
            </div>
            <div>
              <Label htmlFor="password">{t("femme.login.password")}</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="mt-1 w-full"
              />
            </div>
            {error ? (
              <Text variant="small" className="text-[rgb(var(--color-destructive))]">
                {error}
              </Text>
            ) : null}
            <Button type="submit" variant="primary" className="min-h-11 w-full" disabled={submitting}>
              {submitting ? t("femme.login.submitting") : t("femme.login.submit")}
            </Button>
          </form>
          <div className="mt-4 text-center">
            <Link
              to="/forgot-password"
              className="text-sm text-[rgb(var(--color-primary))] underline-offset-4 hover:underline"
            >
              {t("femme.login.forgotPassword")}
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
