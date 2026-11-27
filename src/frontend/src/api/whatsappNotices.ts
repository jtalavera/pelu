import { femmeJson, femmePutJson } from "./femmeClient";

/** HU-WAP-03: the salon turns a client's WhatsApp consent on or off. */
export type ClientConsent = {
  id: number;
  whatsappOptIn: boolean;
  whatsappOptInAt: string | null;
  whatsappOptInSource: string | null;
};

export function setClientWhatsAppConsent(clientId: number, optIn: boolean): Promise<ClientConsent> {
  return femmePutJson<ClientConsent>(`/api/clients/${clientId}/whatsapp-consent`, { optIn });
}

/** HU-WAP-07: the state of the last notice of an appointment (the professional gets `last: null`). */
export type AppointmentNotice = {
  template: string;
  purpose: string;
  status: "QUEUED" | "SENDING" | "SENT" | "DELIVERED" | "READ" | "FAILED" | "CANCELLED" | string;
  errorCode: string | null;
  queuedAt: string | null;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  failedAt: string | null;
  fallbackEmailSent: boolean;
  fallbackEmailAvailable: boolean;
  recipient: string | null;
};

export type AppointmentNotices = { hasNotice: boolean; last: AppointmentNotice | null };

export function getAppointmentNotices(appointmentId: number): Promise<AppointmentNotices> {
  return femmeJson<AppointmentNotices>(`/api/appointments/${appointmentId}/messages`, {
    json: false,
  });
}
