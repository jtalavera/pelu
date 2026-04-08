import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider } from "@design-system";
import i18n from "../i18n";
import ClientsPage from "./ClientsPage";

const femmeJson = vi.fn();
const femmePostJson = vi.fn();

vi.mock("../api/femmeClient", () => ({
  femmeJson: (...args: unknown[]) => femmeJson(...args),
  femmePostJson: (...args: unknown[]) => femmePostJson(...args),
  femmePutJson: vi.fn(),
}));

function renderPage() {
  return render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <ClientsPage />
      </ThemeProvider>
    </I18nextProvider>,
  );
}

const sampleClient = {
  id: 1,
  fullName: "Ana García",
  phone: "0981000001",
  email: "ana@example.com",
  ruc: "80000005-6",
  active: true,
  visitCount: 3,
};

describe("ClientsPage", () => {
  beforeEach(() => {
    void i18n.changeLanguage("en");
    femmeJson.mockReset();
    femmePostJson.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows heading and new client button after loading", async () => {
    femmeJson.mockResolvedValue([sampleClient]);
    renderPage();
    expect(await screen.findByRole("heading", { name: /clients/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /new client/i })).toBeTruthy();
  });

  it("renders client list with name and visit count", async () => {
    femmeJson.mockResolvedValue([sampleClient]);
    renderPage();
    expect(await screen.findByText("Ana García")).toBeTruthy();
    expect(screen.getByText(/3 visit/i)).toBeTruthy();
    expect(screen.getByText("0981000001")).toBeTruthy();
  });

  it("shows empty state when no clients", async () => {
    femmeJson.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText(/no clients yet/i)).toBeTruthy();
  });

  it("search form submit triggers API call", async () => {
    femmeJson.mockResolvedValue([]);
    renderPage();
    await screen.findByRole("heading", { name: /clients/i });
    const input = screen.getByLabelText(/search/i);
    await userEvent.type(input, "ana");
    await userEvent.keyboard("{Enter}");
    expect(femmeJson).toHaveBeenCalled();
  });

  it("opens modal and shows form fields when new client button clicked", async () => {
    femmeJson.mockResolvedValue([]);
    renderPage();
    await screen.findByRole("heading", { name: /clients/i });
    await userEvent.click(screen.getByRole("button", { name: /new client/i }));
    expect(await screen.findByLabelText(/full name/i)).toBeTruthy();
    expect(screen.getByLabelText(/phone/i)).toBeTruthy();
    expect(screen.getByLabelText(/^email/i)).toBeTruthy();
    expect(screen.getByLabelText(/^ruc/i)).toBeTruthy();
  });

  it("validates required full name field", async () => {
    femmeJson.mockResolvedValue([]);
    renderPage();
    await screen.findByRole("heading", { name: /clients/i });
    await userEvent.click(screen.getByRole("button", { name: /new client/i }));
    await screen.findByLabelText(/full name/i);
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(await screen.findByText(/enter the client.*full name/i)).toBeTruthy();
  });

  it("validates invalid RUC format", async () => {
    femmeJson.mockResolvedValue([]);
    renderPage();
    await screen.findByRole("heading", { name: /clients/i });
    await userEvent.click(screen.getByRole("button", { name: /new client/i }));
    await screen.findByLabelText(/full name/i);
    await userEvent.type(screen.getByLabelText(/full name/i), "Test Client");
    await userEvent.type(screen.getByLabelText(/^ruc/i), "invalid-ruc");
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(await screen.findByText(/invalid ruc/i)).toBeTruthy();
  });

  it("saves client successfully and reloads", async () => {
    femmeJson.mockResolvedValue([]);
    femmePostJson.mockResolvedValue({ ...sampleClient });
    renderPage();
    await screen.findByRole("heading", { name: /clients/i });
    await userEvent.click(screen.getByRole("button", { name: /new client/i }));
    await screen.findByLabelText(/full name/i);
    await userEvent.type(screen.getByLabelText(/full name/i), "Ana García");
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(femmePostJson).toHaveBeenCalled());
  });

  it("shows deactivate button for active clients", async () => {
    femmeJson.mockResolvedValue([sampleClient]);
    renderPage();
    await screen.findByText("Ana García");
    expect(screen.getByRole("button", { name: /deactivate/i })).toBeTruthy();
  });

  it("inactive clients show inactive label and no deactivate button", async () => {
    femmeJson.mockResolvedValue([{ ...sampleClient, active: false }]);
    renderPage();
    await screen.findByText("Ana García");
    expect(screen.getByText(/inactive/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /deactivate/i })).toBeNull();
  });
});
