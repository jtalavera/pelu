import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Button, Heading, Input, Label, Text } from "@design-system";
import { apiBaseUrl } from "../api/baseUrl";
import { LanguageSwitcher } from "../components/LanguageSwitcher";

export default function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await fetch(`${apiBaseUrl()}/api/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      setDone(true);
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
          className="rounded-[var(--radius-xl)] p-6 md:p-8"
          style={{
            background: "var(--color-white)",
            border: "var(--border-default)",
            boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
          }}
        >
          <Heading as="h1" className="mb-4 !text-[var(--color-ink)]">
            {t("femme.forgot.title")}
          </Heading>
          {done ? (
            <Text className="text-[var(--color-ink-2)]">{t("femme.forgot.sent")}</Text>
          ) : (
            <form className="flex flex-col gap-4" onSubmit={onSubmit}>
              <div>
                <Label htmlFor="email" className="text-[var(--color-ink-2)]">
                  {t("femme.login.email")}
                </Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className={inputClassName}
                />
              </div>
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
                {submitting ? t("femme.forgot.submitting") : t("femme.forgot.submit")}
              </Button>
            </form>
          )}
          <div className="mt-4">
            <Link
              to="/login"
              className="text-sm font-medium text-[var(--color-rose)] underline-offset-4 hover:text-[var(--color-rose-dk)] hover:underline"
            >
              {t("femme.forgot.backToLogin")}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
