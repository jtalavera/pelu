import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "../test/renderWithTour";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
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
    <MemoryRouter initialEntries={["/app/clients"]}>
      <I18nextProvider i18n={i18n}>
        <ThemeProvider>
          <ClientsPage />
        </ThemeProvider>
      </I18nextProvider>
    </MemoryRouter>,
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

function pageOf(clients: (typeof sampleClient)[]) {
  return {
    content: clients,
    page: 0,
    size: 10,
    totalElements: clients.length,
    totalPages: clients.length === 0 ? 0 : 1,
  };
}

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
    femmeJson.mockResolvedValue(pageOf([sampleClient]));
    renderPage();
    expect(await screen.findByRole("heading", { name: /clients/i })).toBeTruthy();
    expect(screen.getByTestId("clients-new")).toBeTruthy();
  });

  it("renders client list with name and visit count", async () => {
    femmeJson.mockResolvedValue(pageOf([sampleClient]));
    renderPage();
    expect(await screen.findByText("Ana García")).toBeTruthy();
    expect(screen.getByText(/0981000001/)).toBeTruthy();
    expect(screen.getByTestId(`client-switch-${sampleClient.id}`)).toBeTruthy();
  });

  it("shows empty state when no clients", async () => {
    femmeJson.mockResolvedValue(pageOf([]));
    renderPage();
    expect(await screen.findByText(/no clients yet/i)).toBeTruthy();
  });

  it("search form submit triggers API call", async () => {
    femmeJson.mockResolvedValue(pageOf([]));
    renderPage();
    await screen.findByRole("heading", { name: /clients/i });
    const input = screen.getByLabelText(/search/i);
    await userEvent.type(input, "ana");
    await userEvent.keyboard("{Enter}");
    expect(femmeJson).toHaveBeenCalled();
  });

  it("opens modal and shows form fields when new client button clicked", async () => {
    femmeJson.mockResolvedValue(pageOf([]));
    renderPage();
    await screen.findByRole("heading", { name: /clients/i });
    await userEvent.click(screen.getByTestId("clients-new"));
    const dialog = await screen.findByRole("dialog");
    const form = within(dialog);
    expect(form.getByLabelText(/full name/i)).toBeTruthy();
    expect(form.getByLabelText(/^phone$/i)).toBeTruthy();
    // Minimal sign-up: only name and phone until "More options" is opened.
    expect(form.queryByLabelText(/^email$/i)).toBeNull();
    expect(form.queryByLabelText(/document number/i)).toBeNull();
    await userEvent.click(form.getByRole("button", { name: /more options/i }));
    expect(form.getByLabelText(/^email$/i)).toBeTruthy();
    expect(form.getByLabelText(/document type/i)).toBeTruthy();
    expect(form.getByLabelText(/document number/i)).toBeTruthy();
  });

  it("validates required full name field", async () => {
    femmeJson.mockResolvedValue(pageOf([]));
    renderPage();
    await screen.findByRole("heading", { name: /clients/i });
    await userEvent.click(screen.getByTestId("clients-new"));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByLabelText(/full name/i);
    await userEvent.click(within(dialog).getByRole("button", { name: /^save$/i }));
    expect(await screen.findByText(/enter the client.*full name/i)).toBeTruthy();
  });

  it("validates invalid RUC format", async () => {
    femmeJson.mockResolvedValue(pageOf([]));
    renderPage();
    await screen.findByRole("heading", { name: /clients/i });
    await userEvent.click(screen.getByTestId("clients-new"));
    const dialog = await screen.findByRole("dialog");
    const form = within(dialog);
    await form.findByLabelText(/full name/i);
    await userEvent.type(form.getByLabelText(/full name/i), "Test Client");
    await userEvent.click(form.getByRole("button", { name: /more options/i }));
    await userEvent.type(form.getByLabelText(/document number/i), "invalid-ruc");
    await userEvent.click(form.getByRole("button", { name: /^save$/i }));
    expect(await screen.findByText(/invalid ruc/i)).toBeTruthy();
  });

  it("formats the phone field with the Paraguay mask while typing", async () => {
    femmeJson.mockResolvedValue(pageOf([]));
    renderPage();
    await screen.findByRole("heading", { name: /clients/i });
    await userEvent.click(screen.getByTestId("clients-new"));
    const dialog = await screen.findByRole("dialog");
    const form = within(dialog);
    const phoneField = form.getByLabelText(/^phone$/i) as HTMLInputElement;
    await userEvent.click(phoneField);
    await userEvent.keyboard("0981123456");
    expect(phoneField.value).toBe("(0981) 123-456");
  });

  it("blocks save when the phone has fewer than 10 digits", async () => {
    femmeJson.mockResolvedValue(pageOf([]));
    renderPage();
    await screen.findByRole("heading", { name: /clients/i });
    await userEvent.click(screen.getByTestId("clients-new"));
    const dialog = await screen.findByRole("dialog");
    const form = within(dialog);
    await userEvent.type(form.getByLabelText(/full name/i), "Test Client");
    await userEvent.click(form.getByLabelText(/^phone$/i));
    await userEvent.keyboard("0981123");
    await userEvent.click(form.getByRole("button", { name: /^save$/i }));
    expect(await screen.findByText(/enter all 10 digits/i)).toBeTruthy();
    expect(femmePostJson).not.toHaveBeenCalled();
  });

  it("blocks save when the email is invalid", async () => {
    femmeJson.mockResolvedValue(pageOf([]));
    renderPage();
    await screen.findByRole("heading", { name: /clients/i });
    await userEvent.click(screen.getByTestId("clients-new"));
    const dialog = await screen.findByRole("dialog");
    const form = within(dialog);
    await userEvent.type(form.getByLabelText(/full name/i), "Test Client");
    await userEvent.click(form.getByRole("button", { name: /more options/i }));
    await userEvent.type(form.getByLabelText(/^email$/i), "@no-prefix.com");
    await userEvent.click(form.getByRole("button", { name: /^save$/i }));
    expect(await screen.findByText(/enter a valid email/i)).toBeTruthy();
    expect(femmePostJson).not.toHaveBeenCalled();
  });

  it("saves client successfully and reloads", async () => {
    femmeJson.mockResolvedValue(pageOf([]));
    femmePostJson.mockResolvedValue({ ...sampleClient });
    renderPage();
    await screen.findByRole("heading", { name: /clients/i });
    await userEvent.click(screen.getByTestId("clients-new"));
    const dialog = await screen.findByRole("dialog");
    const form = within(dialog);
    await form.findByLabelText(/full name/i);
    await userEvent.type(form.getByLabelText(/full name/i), "Ana García");
    await userEvent.click(form.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(femmePostJson).toHaveBeenCalled());
    expect(await screen.findByTestId("clients-toast")).toBeTruthy();
  });

  it("deactivates an active client with the row switch after confirming", async () => {
    femmeJson.mockResolvedValue(pageOf([sampleClient]));
    femmePostJson.mockResolvedValue({ ...sampleClient, active: false });
    renderPage();
    await screen.findByText("Ana García");
    const sw = screen.getByTestId(`client-switch-${sampleClient.id}`);
    expect((sw as HTMLInputElement).checked).toBe(true);
    await userEvent.click(sw);
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: /^deactivate$/i }));
    await waitFor(() =>
      expect(femmePostJson).toHaveBeenCalledWith(
        `/api/clients/${sampleClient.id}/deactivate`,
        {},
      ),
    );
    expect(await screen.findByTestId("clients-toast")).toBeTruthy();
  });

  it("filters are All, Active and New this month (no With RUC chip)", async () => {
    femmeJson.mockResolvedValue(pageOf([sampleClient]));
    renderPage();
    await screen.findByText("Ana García");
    expect(screen.getByTestId("clients-filter-all")).toBeTruthy();
    expect(screen.getByTestId("clients-filter-active")).toBeTruthy();
    expect(screen.getByTestId("clients-filter-new")).toBeTruthy();
    expect(screen.queryByText(/with ruc/i)).toBeNull();
  });

  it("list with filter All includes both active and inactive clients", async () => {
    femmeJson.mockResolvedValue(
      pageOf([sampleClient, { ...sampleClient, id: 2, fullName: "Bob", active: false }]),
    );
    renderPage();
    await screen.findByText("Ana García");
    expect(screen.getByText("Bob")).toBeTruthy();
    expect(screen.getAllByText(/inactive/i).length).toBeGreaterThanOrEqual(1);
  });

  it("inactive clients are dimmed, marked inactive and reactivate with the switch", async () => {
    femmeJson.mockResolvedValue(pageOf([{ ...sampleClient, active: false }]));
    femmePostJson.mockResolvedValue({ ...sampleClient, active: true });
    renderPage();
    await screen.findByText("Ana García");
    expect(screen.getByText(/inactive/i)).toBeTruthy();
    const sw = screen.getByTestId(`client-switch-${sampleClient.id}`);
    expect((sw as HTMLInputElement).checked).toBe(false);
    await userEvent.click(sw);
    await waitFor(() =>
      expect(femmePostJson).toHaveBeenCalledWith(`/api/clients/${sampleClient.id}/activate`, {}),
    );
  });
});
