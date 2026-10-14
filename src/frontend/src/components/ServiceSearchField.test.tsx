import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "../test/renderWithTour";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider } from "@design-system";
import i18n from "../i18n";
import { ServiceSearchField, type SalonServiceOption } from "./ServiceSearchField";

const femmeJson = vi.fn();

vi.mock("../api/femmeClient", () => ({
  femmeJson: (...args: unknown[]) => femmeJson(...args),
}));

function renderField(
  onChange: (s: SalonServiceOption | null) => void = vi.fn(),
  value: SalonServiceOption | null = null,
) {
  render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <ServiceSearchField value={value} onChange={onChange} />
      </ThemeProvider>
    </I18nextProvider>,
  );
}

const activeSvc: SalonServiceOption = {
  id: 1,
  categoryId: 10,
  categoryName: "Hair",
  categoryAccentKey: "stone",
  name: "Cut",
  priceMinor: 50000,
  durationMinutes: 30,
  active: true,
};

const inactiveSvc: SalonServiceOption = {
  id: 2,
  categoryId: 10,
  categoryName: "Hair",
  categoryAccentKey: "stone",
  name: "Old service",
  priceMinor: 1000,
  durationMinutes: 15,
  active: false,
};

describe("ServiceSearchField", () => {
  beforeEach(() => {
    void i18n.changeLanguage("en");
    femmeJson.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the search input with correct label", () => {
    renderField();
    expect(screen.getByLabelText(/^service$/i)).toBeTruthy();
  });

  it("loads all services on focus then shows only active in list", async () => {
    femmeJson.mockResolvedValue([activeSvc, inactiveSvc]);
    renderField();
    const input = screen.getByRole("combobox");
    await userEvent.click(input);
    await waitFor(() => {
      expect(femmeJson).toHaveBeenCalledWith("/api/services");
    });
    expect(await screen.findByText("Cut", {}, { timeout: 1000 })).toBeTruthy();
    expect(screen.queryByText("Old service")).toBeNull();
  });

  it("lists all services first and then all products, keeping API order within each kind", async () => {
    const mk = (id: number, name: string, kind: "SERVICE" | "PRODUCT"): SalonServiceOption => ({
      ...activeSvc,
      id,
      name,
      kind,
    });
    femmeJson.mockResolvedValue([
      mk(1, "Shampoo", "PRODUCT"),
      mk(2, "Corte", "SERVICE"),
      mk(3, "Acondicionador", "PRODUCT"),
      mk(4, "Brushing", "SERVICE"),
    ]);
    renderField();
    await userEvent.click(screen.getByRole("combobox"));
    await screen.findByText("Corte", {}, { timeout: 1000 });
    const names = screen
      .getAllByRole("option")
      .map((o) => o.querySelector("span.font-medium")?.textContent);
    expect(names).toEqual(["Corte", "Brushing", "Shampoo", "Acondicionador"]);
  });

  it("searches with debounced query param", async () => {
    femmeJson.mockResolvedValue([activeSvc]);
    renderField();
    const input = screen.getByRole("combobox");
    await userEvent.type(input, "cu");
    await waitFor(() => expect(femmeJson).toHaveBeenCalledWith(expect.stringContaining("q=cu")), {
      timeout: 1000,
    });
  });

  it("selects the only service on Enter", async () => {
    femmeJson.mockResolvedValue([activeSvc]);
    const onChange = vi.fn();
    renderField(onChange);
    const input = screen.getByRole("combobox");
    await userEvent.type(input, "Cut");
    await screen.findByText("Cut", {}, { timeout: 2000 });
    await userEvent.keyboard("{Enter}");
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: 1, name: "Cut" })),
    );
  });

  it("calls onChange when a result is clicked", async () => {
    femmeJson.mockResolvedValue([activeSvc]);
    const onChange = vi.fn();
    renderField(onChange);
    const input = screen.getByRole("combobox");
    await userEvent.click(input);
    await screen.findByText("Cut", {}, { timeout: 1000 });
    await userEvent.click(screen.getByRole("button", { name: /Cut/i }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: 1, name: "Cut" }));
  });
});
