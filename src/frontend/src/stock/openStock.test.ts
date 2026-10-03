import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/stock", () => ({
  requestStockSso: vi.fn(),
}));

import { requestStockSso } from "../api/stock";
import { buildStockSsoUrl, openStockInNewTab } from "./openStock";

describe("buildStockSsoUrl", () => {
  it("puts theme/lang in the query and the token in the fragment", () => {
    const url = buildStockSsoUrl("https://stock.example", "abc.def.ghi", "dark", "es");
    expect(url).toBe("https://stock.example/sso?theme=dark&lang=es#token=abc.def.ghi&source=PELU");
  });
});

describe("openStockInNewTab", () => {
  afterEach(() => vi.clearAllMocks());

  it("opens the tab synchronously, then points it at the SSO URL", async () => {
    let resolveToken: (v: { token: string; expiresInSeconds: number }) => void = () => {};
    vi.mocked(requestStockSso).mockReturnValue(
      new Promise((r) => {
        resolveToken = r;
      }),
    );
    const tab = { location: { href: "about:blank" }, opener: {} as unknown, close: vi.fn() };
    const open = vi.fn(() => tab as unknown as Window);

    const pending = openStockInNewTab({ theme: "light", lang: "en", openWindow: open });
    // Opened before the token request resolves (pop-up blockers only allow it in the click).
    expect(open).toHaveBeenCalledWith("about:blank");
    resolveToken({ token: "t0k", expiresInSeconds: 300 });
    await pending;

    expect(tab.opener).toBeNull();
    expect(tab.location.href).toContain("/sso?theme=light&lang=en#token=t0k&source=PELU");
  });

  it("closes the blank tab and rethrows when the token cannot be obtained", async () => {
    vi.mocked(requestStockSso).mockRejectedValue(new Error('{"error":"STOCK_MODULE_DISABLED"}'));
    const tab = { location: { href: "about:blank" }, opener: null, close: vi.fn() };
    await expect(
      openStockInNewTab({ theme: "dark", lang: "es", openWindow: () => tab as unknown as Window }),
    ).rejects.toThrow("STOCK_MODULE_DISABLED");
    expect(tab.close).toHaveBeenCalled();
  });
});
