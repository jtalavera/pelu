import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import { Alert, Button, Card, Heading, Spinner, Text } from "@design-system";
import { fetchPublicBooking, type PublicBookingInfo } from "../api/publicBooking";

type State =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; info: PublicBookingInfo };

/**
 * `/r/:slug` — a salon's public booking page (no login). RSV A0 is the skeleton: it resolves the
 * salon by its address and shows either its name or the one neutral «link not available» page, which
 * is identical for an unknown address, a salon with the feature off, suspended or not accepting
 * bookings (RT-01). The service and time pickers arrive with A3.
 */
export default function PublicBookingPage() {
  const { t } = useTranslation();
  const { slug = "" } = useParams<{ slug: string }>();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "loading" });
    fetchPublicBooking(slug, controller.signal)
      .then((info) => setState({ kind: "ready", info }))
      .catch((err: unknown) => {
        if ((err as { name?: string })?.name === "AbortError") return;
        setState({ kind: "error" });
      });
    return () => controller.abort();
  }, [slug, attempt]);

  const available = state.kind === "ready" && state.info.available;
  const name = state.kind === "ready" ? state.info.businessName : undefined;

  useEffect(() => {
    document.title = available && name ? name : t("femme.publicBooking.documentTitle");
  }, [available, name, t]);

  return (
    <main className="flex min-h-screen min-w-0 items-center justify-center bg-page p-4">
      <Card className="w-full min-w-0 max-w-md p-6" data-testid="public-booking-card">
        {state.kind === "loading" ? (
          <div
            className="flex flex-col items-center gap-3 py-6"
            role="status"
            aria-live="polite"
          >
            <Spinner />
            <Text>{t("femme.publicBooking.loading")}</Text>
          </div>
        ) : null}

        {state.kind === "error" ? (
          <div className="flex flex-col gap-4">
            <Alert variant="destructive" role="alert">
              {t("femme.publicBooking.errorNetwork")}
            </Alert>
            <Button type="button" onClick={() => setAttempt((n) => n + 1)}>
              {t("femme.publicBooking.retry")}
            </Button>
          </div>
        ) : null}

        {state.kind === "ready" && !state.info.available ? (
          <div className="flex flex-col gap-2" data-testid="public-booking-unavailable">
            <Heading as="h1" className="text-xl">
              {t("femme.publicBooking.unavailableTitle")}
            </Heading>
            <Text>{t("femme.publicBooking.unavailableBody")}</Text>
          </div>
        ) : null}

        {available ? (
          <div className="flex flex-col gap-2" data-testid="public-booking-open">
            <Heading as="h1" className="break-words text-xl" data-testid="public-booking-name">
              {name}
            </Heading>
            <Text>{t("femme.publicBooking.comingSoon")}</Text>
          </div>
        ) : null}
      </Card>
    </main>
  );
}
