import { femmeJson, femmePostJson } from "./femmeClient";

/** HU-WAP-01/02: Platform Admin view of the shared WhatsApp channel. */
export type WhatsAppTemplateRow = {
  name: string;
  language: string;
  category: "AUTHENTICATION" | "UTILITY" | string;
  bodyVariables: number;
  buttons: number;
  bodyText: string | null;
  status: string;
  reason: string | null;
  checkedAt: string | null;
};

export type PlatformAlertRow = {
  id: number;
  category: string;
  subject: string;
  detail: string | null;
  createdAt: string;
};

export type WhatsAppStatus = {
  enabled: boolean;
  provider: string;
  operational: boolean;
  configurationProblems: string[];
  apiVersion: string;
  templates: WhatsAppTemplateRow[];
  alerts: PlatformAlertRow[];
};

export function getWhatsAppStatus(): Promise<WhatsAppStatus> {
  return femmeJson<WhatsAppStatus>("/api/platform/whatsapp/status", { json: false });
}

export function refreshWhatsAppTemplates(): Promise<WhatsAppStatus> {
  return femmeJson<WhatsAppStatus>("/api/platform/whatsapp/templates/refresh", {
    method: "POST",
  });
}

export function acknowledgeWhatsAppAlert(id: number): Promise<WhatsAppStatus> {
  return femmeJson<WhatsAppStatus>(`/api/platform/whatsapp/alerts/${id}/acknowledge`, {
    method: "POST",
  });
}

export function sendWhatsAppTest(to: string, template: string): Promise<{ wamid: string }> {
  return femmePostJson<{ wamid: string }>("/api/platform/whatsapp/test-send", { to, template });
}
