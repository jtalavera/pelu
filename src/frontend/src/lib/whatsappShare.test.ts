import { describe, expect, it, vi } from "vitest";
import { buildWhatsAppUrl, isMobileDevice, shareFileViaOs } from "./whatsappShare";

const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const WINDOWS_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

function fakeNavigator(overrides: Partial<Navigator> & Record<string, unknown>): Navigator {
  return { userAgent: WINDOWS_UA, ...overrides } as unknown as Navigator;
}

describe("isMobileDevice", () => {
  it.each([
    [ANDROID_UA, true],
    [IPHONE_UA, true],
    [WINDOWS_UA, false],
  ])("detects %s", (ua, expected) => {
    expect(isMobileDevice(fakeNavigator({ userAgent: ua }))).toBe(expected);
  });

  it("trusts userAgentData.mobile when present", () => {
    expect(isMobileDevice(fakeNavigator({ userAgentData: { mobile: true } }))).toBe(true);
  });
});

describe("buildWhatsAppUrl", () => {
  it("desktop with phone goes straight to WhatsApp Web's chat", () => {
    expect(buildWhatsAppUrl("595981123456", "Hola Ana", false)).toBe(
      "https://web.whatsapp.com/send?phone=595981123456&text=Hola%20Ana",
    );
  });

  it("desktop without phone opens WhatsApp Web's composer", () => {
    expect(buildWhatsAppUrl(null, "Hola", false)).toBe("https://web.whatsapp.com/send?text=Hola");
  });

  it("mobile keeps wa.me so the installed app opens", () => {
    expect(buildWhatsAppUrl("595981123456", "Hola", true)).toBe(
      "https://wa.me/595981123456?text=Hola",
    );
    expect(buildWhatsAppUrl(null, "Hola", true)).toBe("https://wa.me/?text=Hola");
  });
});

describe("shareFileViaOs", () => {
  const file = new File(["%PDF"], "KUDE-1.pdf", { type: "application/pdf" });

  it("shares the file with the message when the browser supports it", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const nav = fakeNavigator({ share, canShare: () => true });
    await expect(shareFileViaOs(file, "Hola", nav)).resolves.toBe("shared");
    expect(share).toHaveBeenCalledWith({ files: [file], text: "Hola" });
  });

  it("is unsupported without the Web Share API", async () => {
    await expect(shareFileViaOs(file, "Hola", fakeNavigator({}))).resolves.toBe("unsupported");
  });

  it("is unsupported when files can't be shared", async () => {
    const share = vi.fn();
    const nav = fakeNavigator({ share, canShare: () => false });
    await expect(shareFileViaOs(file, "Hola", nav)).resolves.toBe("unsupported");
    expect(share).not.toHaveBeenCalled();
  });

  it("reports a user cancel separately so no fallback opens", async () => {
    const share = vi.fn().mockRejectedValue(new DOMException("cancel", "AbortError"));
    const nav = fakeNavigator({ share, canShare: () => true });
    await expect(shareFileViaOs(file, "Hola", nav)).resolves.toBe("cancelled");
  });

  it("falls back when the browser refuses (e.g. user activation expired)", async () => {
    const share = vi.fn().mockRejectedValue(new DOMException("no", "NotAllowedError"));
    const nav = fakeNavigator({ share, canShare: () => true });
    await expect(shareFileViaOs(file, "Hola", nav)).resolves.toBe("unsupported");
  });
});
