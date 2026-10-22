/**
 * Issue #215 follow-up: helpers for the "Enviar por WhatsApp" KuDE hand-off.
 *
 * - Mobile: the OS share sheet (Web Share API Level 2) sends the PDF itself, so the user picks
 *   WhatsApp and the file is already attached. Falls back to `wa.me` (opens the app) when the
 *   browser can't share files.
 * - Desktop: goes straight to WhatsApp Web (`web.whatsapp.com/send`) instead of `wa.me`, skipping
 *   the "open app / use WhatsApp Web" chooser page, and targets a named window so repeated sends
 *   reuse the same WhatsApp tab instead of piling up new ones.
 */

/** Window name every desktop WhatsApp hand-off targets, so the browser reuses that tab. */
export const WHATSAPP_WINDOW_NAME = "femme-whatsapp";

/** True on phones/tablets, where WhatsApp is an installed app rather than WhatsApp Web. */
export function isMobileDevice(nav: Navigator = navigator): boolean {
  const uaData = (nav as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData;
  if (typeof uaData?.mobile === "boolean" && uaData.mobile) return true;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(nav.userAgent);
}

/**
 * Chat URL with the message prefilled. `phone` is the digits-only `<countrycode><number>` shape
 * from toWhatsAppPhone(); null opens the composer with no contact preselected.
 */
export function buildWhatsAppUrl(phone: string | null, text: string, mobile: boolean): string {
  const encodedText = encodeURIComponent(text);
  if (mobile) {
    return `https://wa.me/${phone ?? ""}?text=${encodedText}`;
  }
  return phone
    ? `https://web.whatsapp.com/send?phone=${phone}&text=${encodedText}`
    : `https://web.whatsapp.com/send?text=${encodedText}`;
}

export type ShareFileResult = "shared" | "cancelled" | "unsupported";

/**
 * Opens the OS share sheet with `file` attached. "unsupported" means the caller should fall back
 * to the download + chat link flow — either the browser can't share files, or it refused (e.g.
 * the user-activation window expired while the PDF was being fetched).
 */
export async function shareFileViaOs(
  file: File,
  text: string,
  nav: Navigator = navigator,
): Promise<ShareFileResult> {
  if (typeof nav.share !== "function" || typeof nav.canShare !== "function") return "unsupported";
  if (!nav.canShare({ files: [file] })) return "unsupported";
  try {
    await nav.share({ files: [file], text });
    return "shared";
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return "cancelled";
    return "unsupported";
  }
}
