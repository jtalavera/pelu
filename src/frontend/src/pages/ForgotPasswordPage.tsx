import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Button, Card, Heading, Input, Label, Text } from "@design-system";
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

  return (
    <div className="min-h-screen bg-[rgb(var(--color-bg))] px-4 py-10 text-[rgb(var(--color-fg))]">
      <div className="mx-auto flex max-w-md flex-col gap-6">
        <div className="flex justify-end">
          <LanguageSwitcher />
        </div>
        <Card className="p-6 shadow-sm">
          <Heading as="h1" className="mb-4">
            {t("femme.forgot.title")}
          </Heading>
          {done ? (
            <Text>{t("femme.forgot.sent")}</Text>
          ) : (
            <form className="flex flex-col gap-4" onSubmit={onSubmit}>
              <div>
                <Label htmlFor="email">{t("femme.login.email")}</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="mt-1 w-full"
                />
              </div>
              <Button type="submit" variant="primary" className="min-h-11 w-full" disabled={submitting}>
                {submitting ? t("femme.forgot.submitting") : t("femme.forgot.submit")}
              </Button>
            </form>
          )}
          <div className="mt-4">
            <Link to="/login" className="text-sm text-[rgb(var(--color-primary))] underline-offset-4 hover:underline">
              {t("femme.forgot.backToLogin")}
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
