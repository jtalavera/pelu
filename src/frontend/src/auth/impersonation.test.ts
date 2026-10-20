import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/platformTenants", () => ({
  impersonateTenant: vi.fn(),
}));

import { impersonateTenant } from "../api/platformTenants";
import {
  buildImpersonationUrl,
  openImpersonationInNewTab,
  readImpersonationToken,
} from "./impersonation";

describe("buildImpersonationUrl / readImpersonationToken", () => {
  it("puts the token in the fragment of /impersonate and reads it back", () => {
    const url = buildImpersonationUrl("http://localhost:5173", "abc.def.ghi");
    expect(url).toBe("http://localhost:5173/impersonate#token=abc.def.ghi");
    expect(readImpersonationToken(new URL(url).hash)).toBe("abc.def.ghi");
  });

  it("returns null when the fragment carries no token", () => {
    expect(readImpersonationToken("")).toBeNull();
    expect(readImpersonationToken("#token=")).toBeNull();
    expect(readImpersonationToken("#other=1")).toBeNull();
  });
});

describe("openImpersonationInNewTab", () => {
  afterEach(() => vi.clearAllMocks());

  it("opens the tab synchronously, then points it at the handoff URL", async () => {
    let resolveToken: (v: { accessToken: string; expiresInSeconds: number; tokenType: string }) => void =
      () => {};
    vi.mocked(impersonateTenant).mockReturnValue(
      new Promise((r) => {
        resolveToken = r;
      }),
    );
    const tab = { location: { href: "about:blank" }, opener: {} as unknown, close: vi.fn() };
    const open = vi.fn(() => tab as unknown as Window);

    const pending = openImpersonationInNewTab({ tenantId: 7, openWindow: open });
    expect(open).toHaveBeenCalledWith("about:blank");
    resolveToken({ accessToken: "t0k", expiresInSeconds: 300, tokenType: "Bearer" });
    await pending;

    expect(impersonateTenant).toHaveBeenCalledWith(7);
    expect(tab.opener).toBeNull();
    expect(tab.location.href).toBe(`${window.location.origin}/impersonate#token=t0k`);
  });

  it("closes the blank tab and rethrows when the token cannot be obtained", async () => {
    vi.mocked(impersonateTenant).mockRejectedValue(new Error('{"error":"TENANT_SUSPENDED"}'));
    const tab = { location: { href: "about:blank" }, opener: null, close: vi.fn() };
    await expect(
      openImpersonationInNewTab({ tenantId: 7, openWindow: () => tab as unknown as Window }),
    ).rejects.toThrow("TENANT_SUSPENDED");
    expect(tab.close).toHaveBeenCalled();
  });

  it("never falls back to the current tab when pop-ups are blocked", async () => {
    vi.mocked(impersonateTenant).mockResolvedValue({
      accessToken: "t0k",
      expiresInSeconds: 300,
      tokenType: "Bearer",
    });
    const before = window.location.href;
    await expect(openImpersonationInNewTab({ tenantId: 7, openWindow: () => null })).rejects.toThrow(
      "POPUP_BLOCKED",
    );
    expect(window.location.href).toBe(before);
  });
});
