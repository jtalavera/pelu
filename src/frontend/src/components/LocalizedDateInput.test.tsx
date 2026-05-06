import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nextProvider } from "react-i18next";
import { cleanup, render, screen, waitFor } from "../test/renderWithTour";
import userEvent from "@testing-library/user-event";
import i18n from "../i18n";
import {
  LocalizedDateInput,
  buildMonthGrid,
  formatIsoForDisplay,
  parseDisplayToIso,
} from "./LocalizedDateInput";

afterEach(() => cleanup());

describe("LocalizedDateInput.formatIsoForDisplay", () => {
  it("renders DD/MM/YYYY in Spanish mode", () => {
    expect(formatIsoForDisplay("2026-04-30", "es")).toBe("30/04/2026");
  });

  it("renders MM/DD/YYYY in English mode", () => {
    expect(formatIsoForDisplay("2026-04-30", "en")).toBe("04/30/2026");
  });

  it("returns empty for invalid ISO", () => {
    expect(formatIsoForDisplay("nope", "es")).toBe("");
  });
});

describe("LocalizedDateInput.parseDisplayToIso", () => {
  it("parses Spanish DD/MM/YYYY", () => {
    expect(parseDisplayToIso("30/04/2026", "es")).toBe("2026-04-30");
  });
  it("parses English MM/DD/YYYY", () => {
    expect(parseDisplayToIso("04/30/2026", "en")).toBe("2026-04-30");
  });
  it("rejects swapped values", () => {
    expect(parseDisplayToIso("30/04/2026", "en")).toBeNull();
  });
  it("rejects junk", () => {
    expect(parseDisplayToIso("abc", "es")).toBeNull();
  });
});

describe("LocalizedDateInput.buildMonthGrid", () => {
  it("returns 42 cells with day numbers in the right slots (April 2026 starts on Wednesday)", () => {
    const cells = buildMonthGrid(2026, 3); // April 2026
    expect(cells).toHaveLength(42);
    // April 1, 2026 is a Wednesday → in a Monday-first grid that's column index 2.
    expect(cells[0]).toBeNull();
    expect(cells[1]).toBeNull();
    expect(cells[2]).toBe(1);
    expect(cells[3]).toBe(2);
  });
});

describe("LocalizedDateInput component", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("es");
  });

  it("renders the value in Spanish format", async () => {
    render(
      <I18nextProvider i18n={i18n}>
        <LocalizedDateInput
          id="d1"
          value="2026-04-30"
          onChange={() => {}}
          aria-label="fecha"
        />
      </I18nextProvider>,
    );
    expect(screen.getByRole("combobox", { name: /fecha/i })).toHaveProperty("value", "30/04/2026");
  });

  it("emits ISO when user picks a day from the calendar popup", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <I18nextProvider i18n={i18n}>
        <LocalizedDateInput
          id="d2"
          value="2026-04-15"
          onChange={onChange}
          aria-label="fecha"
        />
      </I18nextProvider>,
    );
    const input = screen.getByRole("combobox", { name: /fecha/i });
    await user.click(input);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^2026-04-22$/ })).toBeTruthy();
    });
    await user.click(screen.getByRole("button", { name: /^2026-04-22$/ }));
    expect(onChange).toHaveBeenCalledWith("2026-04-22");
  });

  it("accepts a typed Spanish date and emits ISO", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <I18nextProvider i18n={i18n}>
        <LocalizedDateInput
          id="d3"
          value=""
          onChange={onChange}
          aria-label="fecha"
        />
      </I18nextProvider>,
    );
    const input = screen.getByRole("combobox", { name: /fecha/i });
    await user.click(input);
    await user.keyboard("30/04/2026");
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith("2026-04-30");
  });
});
