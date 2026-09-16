/* Vitest + jsdom; matchers like toBeInTheDocument are optional for this project. */
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

/**
 * `vitest.config.ts` does not enable `test.globals`, so React Testing Library's own
 * afterEach-based auto-cleanup (which only registers when it detects a global `afterEach`)
 * never runs. Without this, every `render()` across every test file appends into the same
 * `document.body` without ever unmounting, so leftover trees (and their still-running
 * intervals/effects) accumulate for the rest of the file — a source of order- and
 * timing-dependent flakiness under CI's slower/contended CPU (see issue #219 CI failures).
 */
afterEach(() => {
  cleanup();
});

Object.defineProperty(window, "matchMedia", {
  writable: true,
  configurable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});
