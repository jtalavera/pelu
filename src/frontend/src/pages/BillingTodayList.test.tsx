import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "../test/renderWithTour";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import { ThemeProvider } from "@design-system";
import i18n from "../i18n";
import BillingPage from "./BillingPage";

const femmeJson = vi.fn();
const femmePostJson = vi.fn();
const downloadSifenKude = vi.fn();
const sendSifenKudeByEmail = vi.fn();
const sendKudeByWhatsapp = vi.fn();

vi.mock("../api/femmeClient", () => ({
  femmeJson: (...args: unknown[]) => femmeJson(...args),
  femmePostJson: (...args: unknown[]) => femmePostJson(...args),
}));
vi.mock("../api/baseUrl", () => ({ apiBaseUrl: () => "http://localhost:8080" }));
vi.mock("../api/authHeaders", () => ({ authHeaders: () => ({ Authorization: "Bearer test" }) }));
vi.mock("../hooks/useFeatureFlags", () => ({ useFeatureFlag: () => false }));
vi.mock("../api/downloadSifenKude", () => ({
  downloadSifenKude: (...args: unknown[]) => downloadSifenKude(...args),
  sendSifenKudeByEmail: (...args: unknown[]) => sendSifenKudeByEmail(...args),
}));
vi.mock("../lib/invoiceKudeShare", async () => {
  const actual = await vi.importActual<typeof import("../lib/invoiceKudeShare")>("../lib/invoiceKudeShare");
  return { ...actual, sendKudeByWhatsapp: (...args: unknown[]) => sendKudeByWhatsapp(...args) };
});
// The detail dialog is its own feature: here it only matters when it opens and closes.
vi.mock("../components/InvoiceDetailModal", () => ({
  InvoiceDetailModal: ({ invoiceId, onClose }: { invoiceId: number; onClose: () => void }) => (
    <div role="dialog" data-testid="detail-stub">
      <span>detail-{invoiceId}</span>
      <button type="button" onClick={onClose}>
        close-detail
      </button>
    </div>
  ),
}));

const openSession = {
  id: 1,
  tenantId: 1,
  openedByUserId: 10,
  openedByEmail: "admin@demo.com",
  openedAt: "2026-04-09T08:00:00Z",
  openingCashAmount: "50000",
  isOpen: true,
};

// Newest first, like the server. issuedAt is UTC; Paraguay is GMT-3 (13:58 / 14:20 / 14:32 local).
const rejected = {
  id: 3,
  invoiceNumber: 125,
  invoiceNumberFormatted: "001-001-0000125",
  clientDisplayName: "Rosa Benítez",
  status: "ISSUED",
  total: "250000",
  issuedAt: "2026-11-12T17:32:00Z",
  paymentMethodsSummary: "CASH",
  sifenSubmissionStatus: "REJECTED",
};
const inProcess = {
  id: 2,
  invoiceNumber: 124,
  invoiceNumberFormatted: "001-001-0000124",
  clientDisplayName: "",
  status: "ISSUED",
  total: "120000",
  issuedAt: "2026-11-12T17:20:00Z",
  paymentMethodsSummary: "DEBIT_CARD",
  sifenSubmissionStatus: "PENDING_VERIFICATION",
};
const approved = {
  id: 1,
  invoiceNumber: 123,
  invoiceNumberFormatted: "001-001-0000123",
  clientDisplayName: "María Gómez",
  status: "ISSUED",
  total: "370000",
  issuedAt: "2026-11-12T16:58:00Z",
  paymentMethodsSummary: "CASH",
  sifenSubmissionStatus: "APPROVED",
};
const detailOfApproved = {
  id: 1,
  invoiceNumberFormatted: "001-001-0000123",
  clientDisplayName: "María Gómez",
  clientPhone: "0981123456",
  clientEmail: "maria@example.com",
  total: "370000",
};

/** Next answer of the list endpoint, when a test wants to control it (otherwise the three rows). */
let nextListAnswer: (() => Promise<unknown>) | null = null;
const listCalls = () =>
  femmeJson.mock.calls.filter((c) => String(c[0]).startsWith("/api/invoices?")).length;

function renderPage() {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <ThemeProvider>
          <BillingPage />
        </ThemeProvider>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

async function renderHome() {
  renderPage();
  await screen.findByTestId("billing-today-row-1");
}

describe("Billing home · Comprobantes de hoy: refresh, issue time and row menu", () => {
  beforeEach(() => {
    void i18n.changeLanguage("en");
    femmeJson.mockReset();
    femmePostJson.mockReset();
    downloadSifenKude.mockReset().mockResolvedValue(undefined);
    sendSifenKudeByEmail.mockReset().mockResolvedValue(undefined);
    sendKudeByWhatsapp.mockReset().mockResolvedValue(undefined);
    nextListAnswer = null;
    femmeJson.mockImplementation((url: string) => {
      if (url.includes("/api/cash-sessions/current")) return Promise.resolve(openSession);
      if (url.startsWith("/api/invoices?")) {
        if (nextListAnswer) {
          const answer = nextListAnswer;
          nextListAnswer = null;
          return answer();
        }
        return Promise.resolve({
          content: [rejected, inProcess, approved],
          page: 0,
          size: 10,
          totalElements: 3,
          totalPages: 1,
          issuedTotal: 740000,
        });
      }
      if (url === "/api/invoices/1") return Promise.resolve(detailOfApproved);
      return Promise.resolve(undefined);
    });
  });

  describe("issue date and time", () => {
    it("shows each invoice's issue date and time (Paraguay time) instead of the payment method", async () => {
      await renderHome();
      const row = screen.getByTestId("billing-today-row-1");
      expect(within(row).getByTestId("billing-today-issued-at-1").textContent).toMatch(/13:58/);
      expect(screen.getByTestId("billing-today-issued-at-2").textContent).toMatch(/14:20/);
      expect(screen.getByTestId("billing-today-issued-at-3").textContent).toMatch(/14:32/);
      expect(row.textContent).not.toMatch(/cash/i);
      expect(screen.getByTestId("billing-today-row-2").textContent).not.toMatch(/debit/i);
    });
  });

  describe("layout: same table as the Propinas movements", () => {
    it("shows a table with the Propinas look (uppercase header, borderless ⋮ in the last column) from a tablet up", async () => {
      await renderHome();
      const table = screen.getByTestId("billing-today-table");
      const headers = within(table)
        .getAllByRole("columnheader")
        .map((h) => h.textContent);
      expect(headers).toEqual(["Issued", "Number", "Client", "Status", "Total", ""]);
      expect(table.querySelector("thead tr")!.className).toContain("uppercase");
      // One row per invoice, with the row's data in its own cells.
      const row = screen.getByTestId("billing-today-row-1");
      expect(within(row).getAllByRole("cell")).toHaveLength(6);
      expect(within(row).getByTestId("billing-today-menu-1-trigger").className).toContain("border-transparent");
    });

    it("keeps the two-line cards on a phone, like Propinas", async () => {
      const original = window.matchMedia;
      window.matchMedia = ((query: string) => ({
        matches: query.includes("max-width: 639px"),
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })) as unknown as typeof window.matchMedia;
      try {
        await renderHome();
        expect(screen.queryByTestId("billing-today-table")).toBeNull();
        expect(screen.getByTestId("billing-today-row-1")).toBeTruthy();
        expect(screen.getByTestId("billing-today-menu-1-trigger")).toBeTruthy();
      } finally {
        window.matchMedia = original;
      }
    });
  });

  describe("refresh", () => {
    it("shows when the list was last updated", async () => {
      await renderHome();
      expect((await screen.findByTestId("billing-today-updated-at")).textContent).toMatch(
        /^Updated at \d{2}:\d{2}$/,
      );
    });

    it("«Actualizar» re-reads the list, stays disabled as «Refreshing…» meanwhile and keeps the rows on screen", async () => {
      await renderHome();
      const before = listCalls();
      let finish: (v: unknown) => void = () => undefined;
      nextListAnswer = () =>
        new Promise((resolve) => {
          finish = resolve;
        });

      const button = screen.getByTestId("billing-today-refresh") as HTMLButtonElement;
      expect(button.getAttribute("aria-label")).toBe("Refresh");
      fireEvent.click(button);

      await waitFor(() => expect(button.disabled).toBe(true));
      expect(button.getAttribute("aria-label")).toBe("Refreshing…");
      expect(listCalls()).toBe(before + 1);
      // No «Loading…» swap: the rows are still there while it runs.
      expect(screen.getByTestId("billing-today-row-1")).toBeTruthy();

      await act(async () => {
        finish({
          content: [rejected, inProcess, { ...approved, sifenSubmissionStatus: "CANCELLED" }],
          page: 0,
          size: 10,
          totalElements: 3,
          totalPages: 1,
          issuedTotal: 370000,
        });
      });
      await waitFor(() => expect(button.disabled).toBe(false));
      expect(button.getAttribute("aria-label")).toBe("Refresh");
      // The new state is shown.
      expect(
        within(screen.getByTestId("billing-today-row-1")).getByText("Voided"),
      ).toBeTruthy();
    });

    it("tells the user when the refresh fails and keeps the rows", async () => {
      await renderHome();
      nextListAnswer = () => Promise.reject(new Error("boom"));
      fireEvent.click(screen.getByTestId("billing-today-refresh"));

      const notice = await screen.findByTestId("billing-today-notice");
      expect(notice.textContent).toMatch(/unexpected error/i);
      expect(screen.getByTestId("billing-today-row-1")).toBeTruthy();
      expect((screen.getByTestId("billing-today-refresh") as HTMLButtonElement).disabled).toBe(false);
    });

    it("reloads the list, without a loading swap, when the invoice detail is closed", async () => {
      await renderHome();
      fireEvent.click(screen.getByTestId("billing-today-row-1"));
      expect(await screen.findByTestId("detail-stub")).toBeTruthy();
      const before = listCalls();

      fireEvent.click(screen.getByText("close-detail"));

      expect(screen.queryByTestId("detail-stub")).toBeNull();
      // Silent: the rows never leave the screen.
      expect(screen.getByTestId("billing-today-row-1")).toBeTruthy();
      await waitFor(() => expect(listCalls()).toBe(before + 1));
    });
  });

  describe("row menu «Más acciones»", () => {
    it("offers WhatsApp, email, KuDE download and view details for an approved invoice", async () => {
      await renderHome();
      fireEvent.click(screen.getByTestId("billing-today-menu-1-trigger"));

      const whatsapp = (await screen.findByTestId("billing-today-menu-1-item-whatsapp")) as HTMLButtonElement;
      const email = screen.getByTestId("billing-today-menu-1-item-email") as HTMLButtonElement;
      const download = screen.getByTestId("billing-today-menu-1-item-download") as HTMLButtonElement;
      const detail = screen.getByTestId("billing-today-menu-1-item-detail") as HTMLButtonElement;
      expect(whatsapp.textContent).toMatch(/Send by WhatsApp/);
      expect(email.textContent).toMatch(/Send by email/);
      expect(email.textContent).toMatch(/Check the email before sending/);
      expect(download.textContent).toMatch(/Download KuDE/);
      expect(detail.textContent).toMatch(/View details/);
      for (const b of [whatsapp, email, download, detail]) expect(b.disabled).toBe(false);
    });

    it("keeps the KuDE actions enabled while SIFEN is still validating", async () => {
      await renderHome();
      fireEvent.click(screen.getByTestId("billing-today-menu-2-trigger"));
      expect(((await screen.findByTestId("billing-today-menu-2-item-download")) as HTMLButtonElement).disabled).toBe(false);
    });

    it("disables the KuDE actions, with a hint, when SIFEN rejected the invoice; view details stays available", async () => {
      await renderHome();
      fireEvent.click(screen.getByTestId("billing-today-menu-3-trigger"));

      for (const id of ["whatsapp", "email", "download"]) {
        const item = (await screen.findByTestId(`billing-today-menu-3-item-${id}`)) as HTMLButtonElement;
        expect(item.disabled).toBe(true);
        expect(item.textContent).toMatch(/Not available: no approved KuDE/);
      }
      expect((screen.getByTestId("billing-today-menu-3-item-detail") as HTMLButtonElement).disabled).toBe(false);
    });

    it("opening the menu does not open the invoice detail, and «View details» does", async () => {
      await renderHome();
      fireEvent.click(screen.getByTestId("billing-today-menu-1-trigger"));
      await screen.findByTestId("billing-today-menu-1-item-detail");
      expect(screen.queryByTestId("detail-stub")).toBeNull();

      fireEvent.click(screen.getByTestId("billing-today-menu-1-item-detail"));
      expect((await screen.findByTestId("detail-stub")).textContent).toMatch(/detail-1/);
    });

    it("«Descargar KuDE» downloads the KuDE of that invoice", async () => {
      await renderHome();
      fireEvent.click(screen.getByTestId("billing-today-menu-1-trigger"));
      fireEvent.click(await screen.findByTestId("billing-today-menu-1-item-download"));

      await waitFor(() => expect(downloadSifenKude).toHaveBeenCalledWith(1));
      // Picking an option closes the menu, and it must not open the detail either.
      expect(screen.queryByRole("menu")).toBeNull();
      expect(screen.queryByTestId("detail-stub")).toBeNull();
    });

    it("the row's menu button is the same borderless vertical «⋮» as the Propinas rows (KebabMenu)", async () => {
      await renderHome();
      const trigger = screen.getByTestId("billing-today-menu-1-trigger");
      expect(trigger.querySelectorAll("svg circle")).toHaveLength(3);
      expect(trigger.className).toContain("border-transparent");
      expect(trigger.textContent).not.toMatch(/⋯/);
    });

    it("«Enviar por WhatsApp» reads the invoice (for the client's phone) and hands it to the WhatsApp flow", async () => {
      await renderHome();
      fireEvent.click(screen.getByTestId("billing-today-menu-1-trigger"));
      fireEvent.click(await screen.findByTestId("billing-today-menu-1-item-whatsapp"));

      await waitFor(() => expect(sendKudeByWhatsapp).toHaveBeenCalledTimes(1));
      expect(sendKudeByWhatsapp.mock.calls[0][0]).toEqual(detailOfApproved);
      expect(femmeJson.mock.calls.some((c) => c[0] === "/api/invoices/1")).toBe(true);
    });

    it("disables the KuDE options of the row while its KuDE is being prepared", async () => {
      await renderHome();
      let finish: () => void = () => undefined;
      downloadSifenKude.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      );
      fireEvent.click(screen.getByTestId("billing-today-menu-1-trigger"));
      fireEvent.click(await screen.findByTestId("billing-today-menu-1-item-download"));

      // Re-open that row's menu: its KuDE options wait, «Ver detalle» stays available.
      fireEvent.click(screen.getByTestId("billing-today-menu-1-trigger"));
      await waitFor(() =>
        expect((screen.getByTestId("billing-today-menu-1-item-download") as HTMLButtonElement).disabled).toBe(true),
      );
      expect((screen.getByTestId("billing-today-menu-1-item-email") as HTMLButtonElement).disabled).toBe(true);
      expect((screen.getByTestId("billing-today-menu-1-item-detail") as HTMLButtonElement).disabled).toBe(false);
      fireEvent.mouseDown(document.body);

      // Only that row: the others stay usable.
      fireEvent.click(screen.getByTestId("billing-today-menu-2-trigger"));
      expect((await screen.findByTestId("billing-today-menu-2-item-download") as HTMLButtonElement).disabled).toBe(false);
      fireEvent.mouseDown(document.body);

      await act(async () => finish());
      fireEvent.click(screen.getByTestId("billing-today-menu-1-trigger"));
      await waitFor(() =>
        expect((screen.getByTestId("billing-today-menu-1-item-download") as HTMLButtonElement).disabled).toBe(false),
      );
    });

    it("shows an error notice above the list when the KuDE action fails", async () => {
      await renderHome();
      downloadSifenKude.mockRejectedValue(new Error("boom"));
      fireEvent.click(screen.getByTestId("billing-today-menu-1-trigger"));
      fireEvent.click(await screen.findByTestId("billing-today-menu-1-item-download"));

      const notice = await screen.findByTestId("billing-today-notice");
      expect(notice.textContent).toMatch(/unexpected error/i);
      expect((screen.getByTestId("billing-today-menu-1-trigger") as HTMLButtonElement).disabled).toBe(false);
    });
  });

  describe("«Enviar por correo» opens a dialog to check or change the address", () => {
    function stubDetail(extra: Record<string, unknown>) {
      const base = femmeJson.getMockImplementation()!;
      femmeJson.mockImplementation((url: string) =>
        url === "/api/invoices/1" ? Promise.resolve({ ...detailOfApproved, ...extra }) : base(url),
      );
    }

    async function openEmailDialog() {
      await renderHome();
      fireEvent.click(screen.getByTestId("billing-today-menu-1-trigger"));
      fireEvent.click(await screen.findByTestId("billing-today-menu-1-item-email"));
      return screen.findByTestId("kude-email-dialog");
    }

    it("shows the invoice and the client's email on file, and does not send until the user confirms", async () => {
      const dialog = await openEmailDialog();
      const input = (await within(dialog).findByTestId("kude-email-input")) as HTMLInputElement;
      expect(input.value).toBe("maria@example.com");
      expect(dialog.textContent).toMatch(/María Gómez/);
      expect(dialog.textContent).toMatch(/Invoice 001-001-0000123/);
      expect(dialog.textContent).toMatch(/Gs\. 370\.000/);
      expect(within(dialog).getByTestId("kude-email-hint").textContent).toMatch(/email on file for the client/);
      expect(sendSifenKudeByEmail).not.toHaveBeenCalled();
      // The menu is closed and the detail did not open behind it.
      expect(screen.queryByRole("menu")).toBeNull();
      expect(screen.queryByTestId("detail-stub")).toBeNull();
    });

    it("prefers the recipient email saved on the invoice over the client's", async () => {
      stubDetail({ recipientEmail: "factura@example.com" });
      const dialog = await openEmailDialog();
      expect(((await within(dialog).findByTestId("kude-email-input")) as HTMLInputElement).value).toBe(
        "factura@example.com",
      );
    });

    it("sends to the address as edited, closes the dialog and confirms with a notice", async () => {
      const dialog = await openEmailDialog();
      const input = (await within(dialog).findByTestId("kude-email-input")) as HTMLInputElement;
      fireEvent.change(input, { target: { value: "  otra@example.com " } });
      fireEvent.click(within(dialog).getByTestId("kude-email-send"));

      await waitFor(() => expect(sendSifenKudeByEmail).toHaveBeenCalledWith(1, "otra@example.com"));
      await waitFor(() => expect(screen.queryByTestId("kude-email-dialog")).toBeNull());
      expect((await screen.findByTestId("billing-today-notice")).textContent).toMatch(/KuDE sent by email/i);
    });

    it("sends the address on file as is when the user does not change it", async () => {
      const dialog = await openEmailDialog();
      await within(dialog).findByDisplayValue("maria@example.com");
      fireEvent.click(within(dialog).getByTestId("kude-email-send"));
      await waitFor(() => expect(sendSifenKudeByEmail).toHaveBeenCalledWith(1, "maria@example.com"));
    });

    it("starts empty when the client has no email and asks for a valid one, with an example", async () => {
      stubDetail({ clientEmail: null, recipientEmail: null });
      const dialog = await openEmailDialog();
      const input = (await within(dialog).findByTestId("kude-email-input")) as HTMLInputElement;
      expect(input.value).toBe("");
      expect(within(dialog).getByTestId("kude-email-hint").textContent).toMatch(/no email on file/i);

      fireEvent.click(within(dialog).getByTestId("kude-email-send"));
      const error = await within(dialog).findByText("Enter a valid email. Example: client@example.com");
      expect(error.getAttribute("role")).toBe("alert");
      expect(input.getAttribute("aria-invalid")).toBe("true");
      expect(sendSifenKudeByEmail).not.toHaveBeenCalled();

      fireEvent.change(input, { target: { value: "no-es-un-correo" } });
      fireEvent.click(within(dialog).getByTestId("kude-email-send"));
      expect(await within(dialog).findByText(/Enter a valid email/)).toBeTruthy();
      expect(sendSifenKudeByEmail).not.toHaveBeenCalled();
    });

    it("lets the user type the address when the invoice cannot be read", async () => {
      const base = femmeJson.getMockImplementation()!;
      femmeJson.mockImplementation((url: string) =>
        url === "/api/invoices/1" ? Promise.reject(new Error("boom")) : base(url),
      );
      const dialog = await openEmailDialog();
      const input = (await within(dialog).findByTestId("kude-email-input")) as HTMLInputElement;
      expect(input.value).toBe("");
      fireEvent.change(input, { target: { value: "a@b.co" } });
      fireEvent.click(within(dialog).getByTestId("kude-email-send"));
      await waitFor(() => expect(sendSifenKudeByEmail).toHaveBeenCalledWith(1, "a@b.co"));
    });

    it("keeps the dialog open with the translated error when the send fails, and allows retrying", async () => {
      sendSifenKudeByEmail.mockRejectedValueOnce(new Error("boom"));
      const dialog = await openEmailDialog();
      await within(dialog).findByDisplayValue("maria@example.com");
      fireEvent.click(within(dialog).getByTestId("kude-email-send"));

      expect((await within(dialog).findByTestId("kude-email-error")).textContent).toMatch(/unexpected error/i);
      expect(screen.getByTestId("kude-email-dialog")).toBeTruthy();
      expect(screen.queryByTestId("billing-today-notice")).toBeNull();

      fireEvent.click(within(dialog).getByTestId("kude-email-send"));
      await waitFor(() => expect(sendSifenKudeByEmail).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(screen.queryByTestId("kude-email-dialog")).toBeNull());
    });

    it("«Cancel» closes it without sending", async () => {
      const dialog = await openEmailDialog();
      fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
      expect(screen.queryByTestId("kude-email-dialog")).toBeNull();
      expect(sendSifenKudeByEmail).not.toHaveBeenCalled();
    });
  });

  describe("the notices above the list can be closed with a «×»", () => {
    it("closes a success notice", async () => {
      await renderHome();
      fireEvent.click(screen.getByTestId("billing-today-menu-1-trigger"));
      fireEvent.click(await screen.findByTestId("billing-today-menu-1-item-email"));
      const dialog = await screen.findByTestId("kude-email-dialog");
      await within(dialog).findByDisplayValue("maria@example.com");
      fireEvent.click(within(dialog).getByTestId("kude-email-send"));

      const notice = await screen.findByTestId("billing-today-notice");
      const close = within(notice).getByRole("button", { name: "Close notice" });
      expect(close).toBe(within(notice).getByTestId("alert-close"));
      fireEvent.click(close);
      expect(screen.queryByTestId("billing-today-notice")).toBeNull();
    });

    it("closes an error notice too (here, from a failed download)", async () => {
      downloadSifenKude.mockRejectedValue(new Error("boom"));
      await renderHome();
      fireEvent.click(screen.getByTestId("billing-today-menu-1-trigger"));
      fireEvent.click(await screen.findByTestId("billing-today-menu-1-item-download"));
      expect((await screen.findByTestId("billing-today-notice")).textContent).toMatch(/unexpected error/i);

      fireEvent.click(within(screen.getByTestId("billing-today-notice")).getByTestId("alert-close"));
      expect(screen.queryByTestId("billing-today-notice")).toBeNull();
    });

    it("starting a new action clears the previous notice by itself", async () => {
      downloadSifenKude.mockRejectedValueOnce(new Error("boom")).mockResolvedValue(undefined);
      await renderHome();
      fireEvent.click(screen.getByTestId("billing-today-menu-1-trigger"));
      fireEvent.click(await screen.findByTestId("billing-today-menu-1-item-download"));
      await screen.findByTestId("billing-today-notice");

      fireEvent.click(screen.getByTestId("billing-today-menu-1-trigger"));
      fireEvent.click(await screen.findByTestId("billing-today-menu-1-item-download"));
      await waitFor(() => expect(downloadSifenKude).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(screen.queryByTestId("billing-today-notice")).toBeNull());
    });
  });
});
