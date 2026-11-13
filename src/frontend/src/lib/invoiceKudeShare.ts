import type { TFunction } from "i18next";
import { fetchSifenKudeBlob, triggerBrowserDownload } from "../api/downloadSifenKude";
import { formatGuaraniesGs } from "./formatMoney";
import { toWhatsAppPhone } from "./paraguayPhone";
import {
  WHATSAPP_WINDOW_NAME,
  buildWhatsAppUrl,
  isMobileDevice,
  shareFileViaOs,
} from "./whatsappShare";

/** What the WhatsApp hand-off needs from an invoice (the invoice detail response has all of it). */
export type KudeWhatsappInvoice = {
  id: number;
  clientDisplayName?: string | null;
  invoiceNumberFormatted: string;
  total: string | number;
  clientPhone?: string | null;
};

/**
 * Issue #215: "Enviar por WhatsApp". Fetches the KuDE PDF, then:
 * - on phones/tablets, opens the OS share sheet with the PDF already attached (the user picks
 *   WhatsApp there); if the browser can't share files, falls back to the download + chat link;
 * - otherwise downloads the PDF and opens the chat with a prefilled text message, inviting the
 *   user to attach the downloaded file.
 *
 * When the client has a phone number on file the chat opens directly against that contact;
 * otherwise it opens the composer with no contact preselected.
 *
 * A chat link alone can never carry the PDF: `GET /sifen/kude` requires Bearer auth, so the end
 * client can't fetch it directly from a link — the file always has to move through this browser
 * first. Throws the raw error body on failure so callers can forward it to translateApiError().
 *
 * Shared by the invoice detail dialog and the «Comprobantes de hoy» row menu.
 */
export async function sendKudeByWhatsapp(invoice: KudeWhatsappInvoice, t: TFunction): Promise<void> {
  const { blob, filename } = await fetchSifenKudeBlob(invoice.id);
  const clientName =
    invoice.clientDisplayName ||
    t("femme.billing.history.detail.sifen.kudeWhatsappGenericClient");
  const message = t("femme.billing.history.detail.sifen.kudeWhatsappMessage", {
    client: clientName,
    number: invoice.invoiceNumberFormatted,
    amount: formatGuaraniesGs(invoice.total),
  });
  const whatsappPhone = toWhatsAppPhone(invoice.clientPhone);
  const mobile = isMobileDevice();

  if (mobile) {
    const file = new File([blob], filename, { type: "application/pdf" });
    const result = await shareFileViaOs(file, message);
    if (result !== "unsupported") return;
  }

  triggerBrowserDownload(blob, filename);
  // No `noopener` on desktop: it would make the browser ignore the window name and open a fresh
  // WhatsApp Web tab on every send.
  window.open(
    buildWhatsAppUrl(whatsappPhone, message, mobile),
    mobile ? "_blank" : WHATSAPP_WINDOW_NAME,
    mobile ? "noopener,noreferrer" : undefined,
  );
}

/** SIFEN statuses for which the KuDE can already be handed to the client (see the detail dialog). */
const KUDE_SHAREABLE_SIFEN_STATUSES = new Set([
  "APPROVED",
  "APPROVED_WITH_OBSERVATION",
  "QUEUED",
  "PENDING_VERIFICATION",
]);

/** True when the invoice has a KuDE to share: it is not voided and SIFEN has not rejected/cancelled it. */
export function isKudeShareable(inv: {
  status: string;
  sifenSubmissionStatus?: string | null;
}): boolean {
  return (
    inv.status !== "VOIDED" &&
    !!inv.sifenSubmissionStatus &&
    KUDE_SHAREABLE_SIFEN_STATUSES.has(inv.sifenSubmissionStatus)
  );
}
