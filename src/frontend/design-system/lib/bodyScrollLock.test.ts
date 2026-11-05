import { afterEach, describe, expect, it } from "vitest";
import { lockBodyScroll } from "./bodyScrollLock";

afterEach(() => {
  document.body.style.overflow = "";
});

describe("lockBodyScroll", () => {
  it("restores the scroll when stacked locks are released in the order they were opened", () => {
    const a = lockBodyScroll();
    const b = lockBodyScroll();
    expect(document.body.style.overflow).toBe("hidden");
    a();
    expect(document.body.style.overflow).toBe("hidden");
    b();
    expect(document.body.style.overflow).toBe("");
  });

  it("restores the scroll when released in the reverse order", () => {
    const a = lockBodyScroll();
    const b = lockBodyScroll();
    const c = lockBodyScroll();
    b();
    c();
    expect(document.body.style.overflow).toBe("hidden");
    a();
    expect(document.body.style.overflow).toBe("");
  });

  it("releasing twice does not unlock another dialog", () => {
    const a = lockBodyScroll();
    const b = lockBodyScroll();
    a();
    a();
    expect(document.body.style.overflow).toBe("hidden");
    b();
    expect(document.body.style.overflow).toBe("");
  });
});
