import { impersonateTenant } from "../api/platformTenants";

/** Route of the page that receives the handoff token in the new tab (outside every auth guard). */
export const IMPERSONATION_PATH = "/impersonate";

/**
 * Issue #310: `/impersonate#token=…`. Like the Stock SSO handoff (HU-65), the token travels in the
 * fragment so it never reaches a server or an access log; ImpersonatePage wipes it right away.
 */
export function buildImpersonationUrl(origin: string, token: string): string {
  const fragment = new URLSearchParams({ token });
  return `${origin}${IMPERSONATION_PATH}#${fragment.toString()}`;
}

/** Reads the handoff token from a `#token=…` fragment; null when absent. */
export function readImpersonationToken(hash: string): string | null {
  const token = new URLSearchParams(hash.replace(/^#/, "")).get("token");
  return token && token.trim() !== "" ? token : null;
}

/**
 * Issue #310: opens the tenant in a NEW tab as its administrator. The tab is opened synchronously
 * (inside the click handler, so the browser does not treat it as a pop-up), then pointed at the
 * handoff URL once the impersonation token arrives. The Platform Admin's own session stays
 * untouched in this tab: the access token lives in per-tab sessionStorage.
 */
export async function openImpersonationInNewTab(options: {
  tenantId: number;
  openWindow?: (url: string) => Window | null;
}): Promise<void> {
  const open = options.openWindow ?? ((url: string) => window.open(url, "_blank"));
  const tab = open("about:blank");
  try {
    const { accessToken } = await impersonateTenant(options.tenantId);
    const url = buildImpersonationUrl(window.location.origin, accessToken);
    if (!tab) {
      // Pop-ups blocked: never fall back to this tab, it would replace the Platform Admin's session.
      throw new Error("POPUP_BLOCKED");
    }
    // The new tab must not be able to navigate this one (reverse tabnabbing).
    try {
      tab.opener = null;
    } catch {
      // cross-origin access can throw on some browsers — harmless
    }
    tab.location.href = url;
  } catch (e) {
    tab?.close();
    throw e;
  }
}
