import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "../../test/renderWithTour";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider } from "@design-system";
import i18n from "../../i18n";
import { InvoiceTipsPanel, servedProfessionals } from "./InvoiceTipsPanel";
import type { InvoiceTipItem, InvoiceTips } from "../../api/invoiceTips";

const getInvoiceTips = vi.fn();
const addInvoiceTips = vi.fn();
const voidLateTip = vi.fn();
const femmeJson = vi.fn();
let role: "ADMIN" | "PROFESSIONAL" = "ADMIN";

vi.mock("../../api/invoiceTips", () => ({
  getInvoiceTips: (...a: unknown[]) => getInvoiceTips(...a),
  addInvoiceTips: (...a: unknown[]) => addInvoiceTips(...a),
  voidLateTip: (...a: unknown[]) => voidLateTip(...a),
}));
vi.mock("../../api/femmeClient", () => ({
  femmeJson: (...a: unknown[]) => femmeJson(...a),
  femmePostJson: vi.fn(),
}));
vi.mock("../../hooks/useMe", () => ({
  useMe: () => ({ me: { role }, loading: false }),
}));

const served = [
  { id: 20, name: "Laura Benítez" },
  { id: 21, name: "Camila Ortiz" },
];

function tips(items: InvoiceTipItem[], extra: Partial<InvoiceTips> = {}): InvoiceTips {
  const total = items.filter((i) => !i.voided).reduce((acc, i) => acc + Number(i.amount), 0);
  return {
    invoiceId: 30,
    invoiceStatus: "ISSUED",
    items,
    total,
    openCashSessionId: 7,
    openCashSessionOpenedAt: "2026-11-12T11:00:00Z",
    ...extra,
  };
}

function item(over: Partial<InvoiceTipItem>): InvoiceTipItem {
  return {
    source: "LATE",
    id: 1,
    professionalId: 20,
    professionalName: "Laura Benítez",
    amount: 10000,
    paymentMethod: "CASH",
    cardBrand: null,
    cardBrandOtherDescription: null,
    createdAt: "2026-11-12T15:12:00Z",
    createdByName: "ana@demo.com",
    voided: false,
    voidReason: null,
    voidedByName: null,
    cashSessionOpen: true,
    ...over,
  };
}

function renderPanel(props: Partial<React.ComponentProps<typeof InvoiceTipsPanel>> = {}) {
  return render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <InvoiceTipsPanel invoiceId={30} served={served} {...props} />
      </ThemeProvider>
    </I18nextProvider>,
  );
}

async function openPanel() {
  const toggle = await screen.findByTestId("invoice-tips-toggle");
  fireEvent.click(toggle);
  return screen.findByTestId("invoice-tips-body");
}

describe("InvoiceTipsPanel (HU-73)", () => {
  beforeEach(() => {
    void i18n.changeLanguage("en");
    role = "ADMIN";
    getInvoiceTips.mockReset().mockResolvedValue(tips([]));
    addInvoiceTips.mockReset();
    voidLateTip.mockReset();
    femmeJson.mockReset().mockResolvedValue([
      { id: 20, fullName: "Laura Benítez", active: true },
      { id: 21, fullName: "Camila Ortiz", active: true },
      { id: 22, fullName: "Rosa Díaz", active: true },
      { id: 23, fullName: "Inactiva", active: false },
    ]);
  });
  afterEach(() => cleanup());

  describe("the tab", () => {
    it("is collapsed and highlighted as «Pending» on the just-issued screen while nothing is registered", async () => {
      renderPanel({ highlightPending: true });
      const toggle = await screen.findByTestId("invoice-tips-toggle");
      expect(toggle.getAttribute("aria-expanded")).toBe("false");
      expect(screen.getByTestId("invoice-tips").getAttribute("data-state")).toBe("pending");
      expect(screen.getByTestId("invoice-tips-badge").textContent).toBe("Pending");
      expect(screen.getByText("Did the client leave a tip?")).toBeTruthy();
      expect(screen.queryByTestId("invoice-tips-body")).toBeNull();
    });

    it("is neutral («No tips») in the invoice detail, where it is never highlighted", async () => {
      renderPanel();
      await screen.findByTestId("invoice-tips-toggle");
      expect(screen.getByTestId("invoice-tips").getAttribute("data-state")).toBe("none");
      expect(screen.getByTestId("invoice-tips-badge").textContent).toBe("No tips");
    });

    it("shows the registered total instead of «Pending» once there are tips", async () => {
      getInvoiceTips.mockResolvedValue(
        tips([item({ amount: 10000 }), item({ id: 2, professionalId: 21, amount: 5000 })]),
      );
      renderPanel({ highlightPending: true });
      await screen.findByTestId("invoice-tips-toggle");
      expect(screen.getByTestId("invoice-tips").getAttribute("data-state")).toBe("registered");
      expect(screen.getByTestId("invoice-tips-badge").textContent).toBe("15.000 registered");
    });

    it("does not highlight when no professional served the invoice", async () => {
      renderPanel({ highlightPending: true, served: [] });
      await screen.findByTestId("invoice-tips-toggle");
      expect(screen.getByTestId("invoice-tips").getAttribute("data-state")).toBe("none");
    });

    it("is not shown for a voided invoice", async () => {
      getInvoiceTips.mockResolvedValue(tips([], { invoiceStatus: "VOIDED" }));
      renderPanel({ highlightPending: true });
      await waitFor(() => expect(getInvoiceTips).toHaveBeenCalled());
      expect(screen.queryByTestId("invoice-tips")).toBeNull();
    });

    it("is not shown when the tips cannot be read", async () => {
      getInvoiceTips.mockRejectedValue(new Error("boom"));
      renderPanel();
      await waitFor(() => expect(getInvoiceTips).toHaveBeenCalled());
      expect(screen.queryByTestId("invoice-tips")).toBeNull();
    });
  });

  describe("registering tips", () => {
    it("opens straight on the form when pending, with one row per professional who served", async () => {
      renderPanel({ highlightPending: true });
      const body = await openPanel();
      expect(within(body).getAllByTestId("invoice-tips-row")).toHaveLength(2);
      expect(within(body).getByText("Laura Benítez")).toBeTruthy();
      expect(within(body).getByText("Camila Ortiz")).toBeTruthy();
      // One short line instead of the long explanation; nothing to cancel while it is pending.
      expect(screen.getByTestId("invoice-tips-cash-note").textContent).toBe("Added to the open cash register.");
      expect(screen.queryByText(/One per professional/i)).toBeNull();
      expect(screen.queryByTestId("invoice-tips-cancel")).toBeNull();
      expect((screen.getByTestId("invoice-tips-submit") as HTMLButtonElement).disabled).toBe(false);
    });

    it("only offers the form after «+ Add tip» in the detail when there are no tips yet", async () => {
      renderPanel();
      const body = await openPanel();
      expect(within(body).getByTestId("invoice-tips-empty").textContent).toMatch(/no tips registered/i);
      expect(screen.queryByTestId("invoice-tips-form")).toBeNull();
      fireEvent.click(screen.getByTestId("invoice-tips-open-form"));
      expect(await screen.findByTestId("invoice-tips-form")).toBeTruthy();
    });

    it("registers each tip with its own payment method and, for cards, the brand", async () => {
      addInvoiceTips.mockResolvedValue(
        tips([
          item({ amount: 10000 }),
          item({
            id: 2,
            professionalId: 21,
            professionalName: "Camila Ortiz",
            amount: 5000,
            paymentMethod: "DEBIT_CARD",
            cardBrand: "VISA",
          }),
        ]),
      );
      const onChanged = vi.fn();
      renderPanel({ highlightPending: true, onChanged });
      await openPanel();
      const rows = screen.getAllByTestId("invoice-tips-row");

      fireEvent.change(within(rows[0]).getByLabelText(/Tip amount — Laura/), { target: { value: "10000" } });
      fireEvent.change(within(rows[1]).getByLabelText(/Tip amount — Camila/), { target: { value: "5000" } });
      fireEvent.change(within(rows[1]).getByLabelText(/How was it paid\? — Camila/), {
        target: { value: "DEBIT_CARD" },
      });
      fireEvent.change(await within(rows[1]).findByLabelText("Card brand"), { target: { value: "VISA" } });
      // The total typed so far is on the button itself.
      expect(screen.getByTestId("invoice-tips-submit").textContent).toBe("Register · 15.000");

      fireEvent.click(screen.getByTestId("invoice-tips-submit"));

      await waitFor(() => expect(addInvoiceTips).toHaveBeenCalledTimes(1));
      expect(addInvoiceTips).toHaveBeenCalledWith(30, [
        {
          professionalId: 20,
          amount: 10000,
          paymentMethod: "CASH",
          cardBrand: null,
          cardBrandOtherDescription: null,
        },
        {
          professionalId: 21,
          amount: 5000,
          paymentMethod: "DEBIT_CARD",
          cardBrand: "VISA",
          cardBrandOtherDescription: null,
        },
      ]);
      expect((await screen.findByTestId("invoice-tips-notice")).textContent).toMatch(/Tips registered in the cash register/);
      expect(screen.getByTestId("invoice-tips").getAttribute("data-state")).toBe("registered");
      expect(screen.getByTestId("invoice-tips-badge").textContent).toBe("15.000 registered");
      expect(screen.queryByTestId("invoice-tips-form")).toBeNull();
      expect(onChanged).toHaveBeenCalledTimes(1);
    });

    it("skips the professionals left empty and needs at least one amount", async () => {
      renderPanel({ highlightPending: true });
      await openPanel();
      fireEvent.click(screen.getByTestId("invoice-tips-submit"));
      expect((await screen.findByText("Enter at least one tip.")).getAttribute("role")).toBe("alert");
      expect(addInvoiceTips).not.toHaveBeenCalled();
    });

    it("asks for the card brand, and for its description when it is «Other»", async () => {
      renderPanel({ highlightPending: true });
      await openPanel();
      const row = screen.getAllByTestId("invoice-tips-row")[0];
      fireEvent.change(within(row).getByLabelText(/Tip amount — Laura/), { target: { value: "10000" } });
      fireEvent.change(within(row).getByLabelText(/How was it paid\? — Laura/), { target: { value: "CREDIT_CARD" } });
      fireEvent.click(screen.getByTestId("invoice-tips-submit"));
      expect(await within(row).findByText("Select the card brand.")).toBeTruthy();
      expect(addInvoiceTips).not.toHaveBeenCalled();

      fireEvent.change(within(row).getByLabelText("Card brand"), { target: { value: "OTHER" } });
      fireEvent.click(screen.getByTestId("invoice-tips-submit"));
      expect(await within(row).findByLabelText("Brand description")).toBeTruthy();
      expect(addInvoiceTips).not.toHaveBeenCalled();
    });

    it("rejects an amount of zero", async () => {
      renderPanel({ highlightPending: true });
      await openPanel();
      const row = screen.getAllByTestId("invoice-tips-row")[0];
      fireEvent.change(within(row).getByLabelText(/Tip amount — Laura/), { target: { value: "0" } });
      fireEvent.click(screen.getByTestId("invoice-tips-submit"));
      expect(await within(row).findByText(/must be greater than 0/i)).toBeTruthy();
      expect(addInvoiceTips).not.toHaveBeenCalled();
    });

    it("«+ Another professional» adds a row with the active professionals to choose from", async () => {
      renderPanel({ highlightPending: true });
      await openPanel();
      fireEvent.click(screen.getByTestId("invoice-tips-add-other"));
      const rows = await screen.findAllByTestId("invoice-tips-row");
      expect(rows).toHaveLength(3);
      const select = within(rows[2]).getByLabelText("Professional") as HTMLSelectElement;
      await waitFor(() => expect(select.options.length).toBeGreaterThan(1));
      const labels = Array.from(select.options).map((o) => o.textContent);
      expect(labels).toContain("Rosa Díaz");
      expect(labels).not.toContain("Inactiva");
    });

    it("shows the server's error code translated and keeps the form", async () => {
      addInvoiceTips.mockRejectedValue(new Error('{"message":"LATE_TIP_NO_OPEN_CASH_SESSION"}'));
      renderPanel({ highlightPending: true });
      await openPanel();
      const row = screen.getAllByTestId("invoice-tips-row")[0];
      fireEvent.change(within(row).getByLabelText(/Tip amount — Laura/), { target: { value: "10000" } });
      fireEvent.click(screen.getByTestId("invoice-tips-submit"));
      expect(await screen.findByTestId("invoice-tips-submit-error")).toBeTruthy();
      expect(screen.getByTestId("invoice-tips-form")).toBeTruthy();
      expect((screen.getByTestId("invoice-tips-submit") as HTMLButtonElement).disabled).toBe(false);
    });
  });

  describe("without an open cash register", () => {
    beforeEach(() => {
      getInvoiceTips.mockResolvedValue(tips([], { openCashSessionId: null, openCashSessionOpenedAt: null }));
    });

    it("warns, disables the form and offers to go to the cash register", async () => {
      const onGoToCash = vi.fn();
      renderPanel({ highlightPending: true, onGoToCash });
      await openPanel();
      expect(screen.getByTestId("invoice-tips-no-cash").textContent).toMatch(/No cash register is open/);
      expect((screen.getByTestId("invoice-tips-submit") as HTMLButtonElement).disabled).toBe(true);
      const row = screen.getAllByTestId("invoice-tips-row")[0];
      expect((within(row).getByLabelText(/Tip amount — Laura/) as HTMLInputElement).disabled).toBe(true);
      fireEvent.click(screen.getByTestId("invoice-tips-go-cash"));
      expect(onGoToCash).toHaveBeenCalledTimes(1);
    });
  });

  describe("the registered tips", () => {
    const registered = tips([
      item({ source: "ISSUANCE", id: null, amount: 8000, paymentMethod: null, createdAt: null, createdByName: null }),
      item({ id: 1, amount: 10000 }),
      item({
        id: 2,
        professionalId: 21,
        professionalName: "Camila Ortiz",
        amount: 5000,
        paymentMethod: "DEBIT_CARD",
        cardBrand: "VISA",
      }),
      item({
        id: 3,
        amount: 1000,
        voided: true,
        voidReason: "Monto mal cargado",
        voidedByName: "admin@demo.com",
      }),
    ]);

    it("lists them with how each was paid, flags the voided one and counts only the live ones", async () => {
      getInvoiceTips.mockResolvedValue(registered);
      renderPanel();
      const body = await openPanel();
      expect(within(body).getByText("Collected when the invoice was issued")).toBeTruthy();
      expect(within(body).getByTestId("invoice-tip-1").textContent).toMatch(/Cash/);
      expect(within(body).getByTestId("invoice-tip-2").textContent).toMatch(/Debit card · Visa/);
      // Short rows: nobody's e-mail on them.
      expect(within(body).getByTestId("invoice-tip-1").textContent).not.toMatch(/ana@demo.com/);
      // A voided tip only says «Voided» (no who, no reason).
      const voided = within(body).getByTestId("invoice-tip-3");
      expect(voided.textContent).toMatch(/Voided/);
      expect(voided.textContent).not.toMatch(/admin@demo.com|Monto mal cargado/);
      // The total lives in the header badge, not in a red line.
      expect(screen.getByTestId("invoice-tips-badge").textContent).toMatch(/23\.000/);
      expect(within(body).queryByTestId("invoice-tips-total")).toBeNull();
      expect(within(body).queryByText(/not billable/i)).toBeNull();
    });

    it("offers «Void» only to the administrator, only on live late tips of an open register", async () => {
      getInvoiceTips.mockResolvedValue(
        tips([
          item({ source: "ISSUANCE", id: null, amount: 8000, paymentMethod: null }),
          item({ id: 1 }),
          item({ id: 2, cashSessionOpen: false }),
          item({ id: 3, voided: true, voidReason: "x", voidedByName: "a" }),
        ]),
      );
      renderPanel();
      await openPanel();
      expect(screen.getByTestId("invoice-tip-void-1")).toBeTruthy();
      expect(screen.queryByTestId("invoice-tip-void-2")).toBeNull();
      expect(screen.queryByTestId("invoice-tip-void-3")).toBeNull();
      expect(screen.getAllByRole("button", { name: "Void" })).toHaveLength(1);
    });

    it("hides «Void» from everyone but the administrator", async () => {
      role = "PROFESSIONAL";
      getInvoiceTips.mockResolvedValue(registered);
      renderPanel();
      await openPanel();
      expect(screen.queryByTestId("invoice-tip-void-1")).toBeNull();
    });

    it("«+ Add another tip» reveals the form for more tips", async () => {
      getInvoiceTips.mockResolvedValue(registered);
      renderPanel();
      await openPanel();
      expect(screen.queryByTestId("invoice-tips-form")).toBeNull();
      fireEvent.click(screen.getByTestId("invoice-tips-open-form"));
      expect(await screen.findByTestId("invoice-tips-form")).toBeTruthy();
    });
  });

  describe("voiding", () => {
    it("asks for a reason, voids the tip and shows it as voided", async () => {
      getInvoiceTips.mockResolvedValue(tips([item({ id: 1, amount: 10000 })]));
      voidLateTip.mockResolvedValue(
        tips([item({ id: 1, voided: true, voidReason: "Monto mal cargado", voidedByName: "admin@demo.com" })]),
      );
      const onChanged = vi.fn();
      renderPanel({ onChanged });
      await openPanel();
      fireEvent.click(screen.getByTestId("invoice-tip-void-1"));
      expect(await screen.findByTestId("late-tip-void-dialog")).toBeTruthy();

      // The reason is mandatory.
      fireEvent.click(screen.getByTestId("late-tip-void-confirm"));
      expect(await screen.findByText(/Enter the reason for voiding/i)).toBeTruthy();
      expect(voidLateTip).not.toHaveBeenCalled();

      fireEvent.change(screen.getByTestId("late-tip-void-reason"), { target: { value: " Monto mal cargado " } });
      fireEvent.click(screen.getByTestId("late-tip-void-confirm"));

      await waitFor(() => expect(voidLateTip).toHaveBeenCalledWith(1, "Monto mal cargado"));
      await waitFor(() => expect(screen.queryByTestId("late-tip-void-dialog")).toBeNull());
      expect(screen.getByTestId("invoice-tip-1").textContent).toMatch(/Voided/);
      expect(screen.getByTestId("invoice-tips").getAttribute("data-state")).toBe("none");
      expect(screen.getByTestId("invoice-tips-notice").textContent).toMatch(/Tip voided/);
      expect(onChanged).toHaveBeenCalledTimes(1);
    });

    it("keeps the dialog open and shows the translated reason when the server refuses", async () => {
      getInvoiceTips.mockResolvedValue(tips([item({ id: 1 })]));
      voidLateTip.mockRejectedValue(new Error('{"message":"LATE_TIP_VOID_EXCEEDS_BALANCE"}'));
      renderPanel();
      await openPanel();
      fireEvent.click(screen.getByTestId("invoice-tip-void-1"));
      fireEvent.change(await screen.findByTestId("late-tip-void-reason"), { target: { value: "Error" } });
      fireEvent.click(screen.getByTestId("late-tip-void-confirm"));

      expect((await screen.findByTestId("late-tip-void-error")).textContent).toMatch(/already withdrawn this money/);
      expect(screen.getByTestId("late-tip-void-dialog")).toBeTruthy();
    });
  });

  describe("simplified look and one-step load", () => {
    it("shows a tip registered today with its time only", async () => {
      getInvoiceTips.mockResolvedValue(tips([item({ id: 1, createdAt: new Date().toISOString() })]));
      renderPanel();
      const body = await openPanel();
      expect(within(body).getByTestId("invoice-tip-1").textContent).toMatch(/Cash · \d{1,2}:\d{2}/);
      expect(within(body).getByTestId("invoice-tip-1").textContent).not.toMatch(/\d{1,2}\/\d{1,2}\/\d{4}/);
    });

    it("«Cancel» closes the form without registering anything", async () => {
      renderPanel();
      const body = await openPanel();
      fireEvent.click(within(body).getByTestId("invoice-tips-open-form"));
      expect(await screen.findByTestId("invoice-tips-form")).toBeTruthy();
      fireEvent.click(screen.getByTestId("invoice-tips-cancel"));
      expect(screen.queryByTestId("invoice-tips-form")).toBeNull();
      expect(addInvoiceTips).not.toHaveBeenCalled();
    });

    it("uses the tips the screen already read and does not ask for them again", async () => {
      getInvoiceTips.mockClear();
      renderPanel({ initialTips: tips([item({ id: 1 })]) });
      const body = await openPanel();
      expect(within(body).getByTestId("invoice-tip-1")).toBeTruthy();
      expect(getInvoiceTips).not.toHaveBeenCalled();
    });

    it("does not show the tab when the screen's read of the tips failed (null) and does not retry", async () => {
      getInvoiceTips.mockClear();
      renderPanel({ initialTips: null });
      await new Promise((r) => setTimeout(r, 20));
      expect(screen.queryByTestId("invoice-tips")).toBeNull();
      expect(getInvoiceTips).not.toHaveBeenCalled();
    });
  });
});

describe("servedProfessionals", () => {
  it("lists each professional of the lines once, in order, skipping lines without one", () => {
    expect(
      servedProfessionals([
        { professionalId: 20, professionalName: "Laura" },
        { professionalId: null },
        { professionalId: 21, professionalName: "Camila" },
        { professionalId: 20, professionalName: "Laura" },
        { professionalId: 22 },
      ]),
    ).toEqual([
      { id: 20, name: "Laura" },
      { id: 21, name: "Camila" },
      { id: 22, name: "22" },
    ]);
  });

});
