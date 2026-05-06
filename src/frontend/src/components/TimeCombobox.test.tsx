import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "../test/renderWithTour";
import userEvent from "@testing-library/user-event";
import {
  TimeCombobox,
  buildTimeOptions,
  normalizeTimeInput,
} from "@design-system";

afterEach(() => {
  cleanup();
});

describe("TimeCombobox.normalizeTimeInput", () => {
  it.each([
    ["08:00", "08:00"],
    ["8:00", "08:00"],
    ["8:5", "08:05"],
    ["08", "08:00"],
    ["8", "08:00"],
    ["830", "08:30"],
    ["0830", "08:30"],
    ["08.30", "08:30"],
    ["23:45", "23:45"],
    ["00:00", "00:00"],
  ])("normalizes %s -> %s", (input, expected) => {
    expect(normalizeTimeInput(input)).toBe(expected);
  });

  it.each(["", "   ", "ab:cd", "24:00", "23:60", "-1:00", "x"])(
    "rejects %s",
    (input) => {
      expect(normalizeTimeInput(input)).toBeNull();
    },
  );
});

describe("TimeCombobox.buildTimeOptions", () => {
  it("builds 96 slots from 00:00 to 23:45 in 15 min steps", () => {
    const opts = buildTimeOptions("00:00", "23:45", 15);
    expect(opts).toHaveLength(96);
    expect(opts[0]).toBe("00:00");
    expect(opts[1]).toBe("00:15");
    expect(opts[opts.length - 1]).toBe("23:45");
  });

  it("supports 30-min steps", () => {
    const opts = buildTimeOptions("09:00", "10:00", 30);
    expect(opts).toEqual(["09:00", "09:30", "10:00"]);
  });

  it("returns [] when bounds invalid", () => {
    expect(buildTimeOptions("99:99", "23:45", 15)).toEqual([]);
  });
});

describe("TimeCombobox component", () => {
  it("renders the dropdown with options and lets the user pick one", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <TimeCombobox
        id="test-time"
        value=""
        onChange={onChange}
        placeholder="HH:MM"
        aria-label="Time"
      />,
    );

    const input = screen.getByRole("combobox", { name: /time/i });
    await user.click(input);

    await waitFor(() => {
      expect(screen.getByRole("option", { name: /^00:00$/ })).toBeTruthy();
    });
    expect(screen.getByRole("option", { name: /^09:30$/ })).toBeTruthy();
    expect(screen.getByRole("option", { name: /^23:45$/ })).toBeTruthy();

    const opt = screen.getByRole("option", { name: /^09:30$/ });
    await user.click(opt);

    expect(onChange).toHaveBeenCalledWith("09:30");
  });

  it("accepts a free-text time and normalizes it on Enter", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <TimeCombobox
        id="test-time"
        value=""
        onChange={onChange}
        aria-label="Time"
      />,
    );

    const input = screen.getByRole("combobox", { name: /time/i });
    await user.click(input);
    await user.keyboard("9");
    await user.keyboard("{Enter}");

    expect(onChange).toHaveBeenCalledWith("09:00");
  });

  it("filters options by typed prefix", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <TimeCombobox
        id="test-time"
        value=""
        onChange={onChange}
        aria-label="Time"
      />,
    );

    const input = screen.getByRole("combobox", { name: /time/i });
    await user.click(input);
    await user.keyboard("21:");

    await waitFor(() => {
      expect(screen.getByRole("option", { name: /^21:00$/ })).toBeTruthy();
    });
    expect(screen.queryByRole("option", { name: /^09:00$/ })).toBeNull();
  });
});
