import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getAppointmentNotices, type AppointmentNotices } from "../api/whatsappNotices";
import { useFeatureFlag } from "../hooks/useFeatureFlags";

/**
 * HU-WAP-07 criterio 7: one line with the state of the last notice sent to the client for this
 * turno — «Entregado», «Leído», «No entregado — llamarla al …». The administrator sees the state and
 * the number; the professional only learns whether a notice went out. Not shown (and nothing is
 * requested) when the salon has no WhatsApp channel.
 */
export function AppointmentNoticeLine({ appointmentId }: { appointmentId: number }) {
  const { t } = useTranslation();
  const whatsapp = useFeatureFlag("WHATSAPP_REMINDERS");
  const booking = useFeatureFlag("ONLINE_BOOKING");
  const enabled = whatsapp && booking;
  const [notices, setNotices] = useState<AppointmentNotices | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    getAppointmentNotices(appointmentId)
      .then((n) => {
        if (!cancelled) setNotices(n);
      })
      .catch(() => {
        if (!cancelled) setNotices(null); // an informational line: never an error in the dialog
      });
    return () => {
      cancelled = true;
    };
  }, [appointmentId, enabled]);

  if (!enabled || !notices || !notices.hasNotice) return null;

  const last = notices.last;
  let text: string;
  let tone = "text-ink-2";
  if (!last) {
    text = t("femme.calendar.detail.notice.wentOut");
  } else {
    switch (last.status) {
      case "READ":
        text = t("femme.calendar.detail.notice.read");
        break;
      case "DELIVERED":
        text = t("femme.calendar.detail.notice.delivered");
        break;
      case "SENT":
        text = t("femme.calendar.detail.notice.sent");
        break;
      case "FAILED":
        tone = "text-danger";
        text = last.fallbackEmailSent
          ? t("femme.calendar.detail.notice.failedEmail")
          : last.recipient
            ? t("femme.calendar.detail.notice.failedCall", { phone: last.recipient })
            : t("femme.calendar.detail.notice.failedCallNoPhone");
        break;
      case "CANCELLED":
        text = t("femme.calendar.detail.notice.cancelled");
        break;
      default:
        text = t("femme.calendar.detail.notice.sending");
    }
  }

  return (
    <div data-testid="appointment-notice" data-status={last?.status ?? "NOTICE"}>
      <div className="text-[11px] font-extrabold uppercase tracking-wider text-primary">
        {t("femme.calendar.detail.notice.title")}
      </div>
      <p className={`m-0 break-words ${tone}`}>{text}</p>
    </div>
  );
}
