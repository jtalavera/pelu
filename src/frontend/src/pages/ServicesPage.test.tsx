import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider } from "@design-system";
import i18n from "../i18n";
import ServicesPage from "./ServicesPage";

const femmeJson = vi.fn();
const femmePostJson = vi.fn();
const femmePutJson = vi.fn();

vi.mock("../api/femmeClient", () => ({
  femmeJson: (...args: unknown[]) => femmeJson(...args),
  femmePostJson: (...args: unknown[]) => femmePostJson(...args),
  femmePutJson: (...args: unknown[]) => femmePutJson(...args),
}));

function renderPage() {
  return render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <ServicesPage />
      </ThemeProvider>
    </I18nextProvider>,
  );
}

describe("ServicesPage", () => {
  beforeEach(() => {
    void i18n.changeLanguage("en");
    femmeJson.mockReset();
    femmePostJson.mockReset();
    femmePutJson.mockReset();
  });

  it("loads categories and services and shows actions", async () => {
    femmeJson.mockImplementation((path: string) => {
      if (path.startsWith("/api/service-categories")) {
        return Promise.resolve([{ id: 1, name: "Hair", active: true }]);
      }
      if (path.startsWith("/api/services")) {
        return Promise.resolve([
          {
            id: 10,
            categoryId: 1,
            categoryName: "Hair",
            name: "Cut",
            priceMinor: "10000.00",
            durationMinutes: 30,
            active: true,
          },
        ]);
      }
      return Promise.reject(new Error("unexpected"));
    });

    renderPage();
    expect(await screen.findByRole("heading", { name: /services/i })).toBeTruthy();
    expect(await screen.findByText(/cut/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /new service/i })).toBeTruthy();
    await userEvent.click(screen.getByRole("tab", { name: /categories/i }));
    expect(screen.getByRole("button", { name: /new category/i })).toBeTruthy();
  });

  it("search form submit triggers reload", async () => {
    femmeJson.mockImplementation((path: string) => {
      if (path.startsWith("/api/service-categories")) {
        return Promise.resolve([{ id: 1, name: "Hair", active: true }]);
      }
      return Promise.resolve([]);
    });
    renderPage();
    await screen.findByRole("heading", { name: /services/i });
    const input = screen.getByLabelText(/search/i);
    await userEvent.type(input, "abc");
    await userEvent.keyboard("{Enter}");
    expect(femmeJson).toHaveBeenCalled();
  });
});

