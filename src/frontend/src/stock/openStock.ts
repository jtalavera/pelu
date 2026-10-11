import { requestStockSso } from "../api/stock";

/** Stock SPA origin for this build (VITE_STOCK_SPA_URL), without a trailing slash; "" if unset. */
export function stockSpaBaseUrl(): string {
  const raw = (import.meta.env.VITE_STOCK_SPA_URL as string | undefined)?.trim() ?? "";
  return raw.replace(/\/+$/, "");
}

/**
 * HU-65: `{base}/sso?theme=…&lang=…#token=…&source=PELU`. The token travels in the fragment so it
 * never reaches a server or an access log; Stock wipes it from history right away.
 */
export function buildStockSsoUrl(
  base: string,
  token: string,
  theme: "light" | "dark",
  lang: string,
): string {
  const query = new URLSearchParams({ theme, lang });
  const fragment = new URLSearchParams({ token, source: "PELU" });
  return `${base}/sso?${query.toString()}#${fragment.toString()}`;
}

/**
 * HU-65: opens Stock in a NEW tab, already signed in. The tab is opened synchronously (inside the
 * click handler, so the browser does not treat it as a pop-up), then pointed at the SSO URL once
 * the handoff token arrives. Femme stays open in its own tab.
 */
export async function openStockInNewTab(options: {
  theme: "light" | "dark";
  lang: string;
  openWindow?: (url: string) => Window | null;
}): Promise<void> {
  const open = options.openWindow ?? ((url: string) => window.open(url, "_blank"));
  const tab = open("about:blank");
  try {
    const { token } = await requestStockSso();
    const url = buildStockSsoUrl(stockSpaBaseUrl(), token, options.theme, options.lang);
    if (tab) {
      // The new tab must not be able to navigate this one (reverse tabnabbing).
      try {
        tab.opener = null;
      } catch {
        // cross-origin access can throw on some browsers — harmless
      }
      tab.location.href = url;
    } else {
      // Pop-ups blocked anyway: fall back to the same tab rather than doing nothing.
      window.location.assign(url);
    }
  } catch (e) {
    tab?.close();
    throw e;
  }
}
