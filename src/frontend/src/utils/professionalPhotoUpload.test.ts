import { afterEach, describe, expect, it } from "vitest";
import {
  MAX_PROFESSIONAL_PHOTO_BYTES,
  MAX_PROFESSIONAL_PHOTO_SIDE_PX,
  isAllowedProfessionalPhotoExtension,
  validateAndReadProfessionalPhotoFile,
} from "./professionalPhotoUpload";

const OriginalImage = globalThis.Image;

describe("professionalPhotoUpload", () => {
  afterEach(() => {
    globalThis.Image = OriginalImage;
  });

  it("accepts common image extensions (case-insensitive)", () => {
    expect(isAllowedProfessionalPhotoExtension("photo.JPG")).toBe(true);
    expect(isAllowedProfessionalPhotoExtension("x.jpeg")).toBe(true);
    expect(isAllowedProfessionalPhotoExtension("a.png")).toBe(true);
    expect(isAllowedProfessionalPhotoExtension("w.webp")).toBe(true);
    expect(isAllowedProfessionalPhotoExtension("g.gif")).toBe(true);
  });

  it("rejects disallowed extensions", () => {
    expect(isAllowedProfessionalPhotoExtension("x.bmp")).toBe(false);
    expect(isAllowedProfessionalPhotoExtension("x.jpg.exe")).toBe(false);
    expect(isAllowedProfessionalPhotoExtension("nofileext")).toBe(false);
  });

  it("rejects files over max byte size without reading image", async () => {
    const file = new File([new Uint8Array([0])], "a.jpg", { type: "image/jpeg" });
    Object.defineProperty(file, "size", { value: MAX_PROFESSIONAL_PHOTO_BYTES + 1 });
    const res = await validateAndReadProfessionalPhotoFile(file);
    expect(res).toEqual({ ok: false, code: "FILE_TOO_LARGE" });
  });

  it("rejects invalid extension before FileReader", async () => {
    const file = new File([new Uint8Array([0])], "x.bmp", { type: "image/bmp" });
    const res = await validateAndReadProfessionalPhotoFile(file);
    expect(res).toEqual({ ok: false, code: "EXTENSION_INVALID" });
  });

  it("rejects when image natural dimensions exceed max side", async () => {
    class MockImageWide {
      onload: (() => void) | null = null;
      onerror: ((ev: unknown) => void) | null = null;
      naturalWidth = MAX_PROFESSIONAL_PHOTO_SIDE_PX + 1;
      naturalHeight = 10;
      set src(_v: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    globalThis.Image = MockImageWide as unknown as typeof Image;

    const file = new File([new Uint8Array([1])], "big.png", { type: "image/png" });
    const res = await validateAndReadProfessionalPhotoFile(file);
    expect(res).toEqual({ ok: false, code: "DIMENSIONS_TOO_LARGE" });
  });

  it("accepts a file when image dimensions are within limits", async () => {
    class MockImageOk {
      onload: (() => void) | null = null;
      onerror: ((ev: unknown) => void) | null = null;
      naturalWidth = 8;
      naturalHeight = 8;
      set src(_v: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    globalThis.Image = MockImageOk as unknown as typeof Image;

    const file = new File([new Uint8Array([1])], "tiny.png", { type: "image/png" });
    const res = await validateAndReadProfessionalPhotoFile(file);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.dataUrl.startsWith("data:image/png;base64,")).toBe(true);
    }
  });

});
