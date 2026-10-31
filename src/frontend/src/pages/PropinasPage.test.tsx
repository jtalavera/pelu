import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "../test/renderWithTour";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider } from "@design-system";
import i18n from "../i18n";
import PropinasPage from "./PropinasPage";

const femmeJson = vi.fn();
const femmePostJson = vi.fn();

vi.mock("../api/femmeClient", () => ({
  femmeJson: (...args: unknown[]) => femmeJson(...args),
  femmePostJson: (...args: unknown[]) => femmePostJson(...args),
  femmePutJson: vi.fn(),
}));

vi.mock("../api/authHeaders", () => ({ authHeaders: () => ({}) }));

const pros = [
  { id: 1, fullName: "Laura", active: true },
  { id: 2, fullName: "Ana", active: true },
  { id: 3, fullName: "Rosa", active: true },
  { id: 4, fullName: "Inactiva", active: false },
];
let balances: Record<number, number>;

function report(rows: Array<{ professionalId: number; professionalName: string; amount: number; clientName: string; serviceDateTime: string }>) {
  const total = rows.reduce((s, r) => s + r.amount, 0);
  return {
    rows,
    professionalTotals: [],
    grandTotal: total,
    withdrawalsTotal: 60000,
    withdrawalsByProfessional: [],
  };
}

const recent = new Date();
recent.setDate(recent.getDate() - 1);
const wdDate = new Date();
wdDate.setDate(wdDate.getDate() - 2);

function renderPage() {
  return render(
    <MemoryRouter>
      <I18nextProvider i18n={i18n}>
        <ThemeProvider>
          <PropinasPage />
        </ThemeProvider>
      </I18nextProvider>
    </MemoryRouter>,
  );
}

function calls(prefix: string): string[] {
  return femmeJson.mock.calls.map((c) => String(c[0])).filter((u) => u.startsWith(prefix));
}

describe("PropinasPage", () => {
  beforeEach(() => {
    void i18n.changeLanguage("en");
    femmeJson.mockReset();
    femmePostJson.mockReset();
    balances = { 1: 180000, 2: 95000, 3: 0 };
    femmeJson.mockImplementation((url: unknown) => {
      const s = String(url);
      if (s === "/api/professionals") return Promise.resolve(pros);
      if (s.startsWith("/api/propinas/balance")) {
        const id = Number(new URL(s, "http://x").searchParams.get("professionalId"));
        return Promise.resolve({ professionalId: id, professionalName: "x", balance: balances[id] ?? 0 });
      }
      if (s.startsWith("/api/propinas/report?")) {
        return Promise.resolve(
          report([
            {
              professionalId: 1,
              professionalName: "Laura",
              amount: 20000,
              clientName: "Marta Benítez",
              serviceDateTime: recent.toISOString(),
            },
          ]),
        );
      }
      if (s.startsWith("/api/propinas/withdrawals?")) {
        return Promise.resolve({
          content: [{ id: 9, professionalName: "Rosa", amount: 60000, withdrawnAt: wdDate.toISOString() }],
          page: 0,
          size: 200,
          totalElements: 1,
          totalPages: 1,
        });
      }
      return Promise.resolve([]);
    });
  });

  afterEach(() => cleanup());

  it("is one screen (no tabs) with a card per active professional showing the accumulated tips", async () => {
    renderPage();
    expect(await screen.findByTestId("propinas-card-1")).toBeTruthy();
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.queryByTestId("propinas-card-4")).toBeNull();
    await waitFor(() => expect(screen.getByTestId("propinas-balance-1").textContent).toMatch(/180\.000/));
    expect(screen.getByTestId("propinas-balance-2").textContent).toMatch(/95\.000/);
  });

  it("Withdraw is disabled when the balance is zero", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId("propinas-balance-1").textContent).toMatch(/180\.000/));
    expect((screen.getByTestId("propinas-withdraw-3") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("propinas-withdraw-1") as HTMLButtonElement).disabled).toBe(false);
  });

  it("opens on 30 days and the period chips reload the report", async () => {
    renderPage();
    await screen.findByTestId("propinas-card-1");
    expect(screen.getByTestId("propinas-period-30").getAttribute("aria-pressed")).toBe("true");
    const before = calls("/api/propinas/report?").length;
    await userEvent.click(screen.getByTestId("propinas-period-7"));
    expect(screen.getByTestId("propinas-period-7").getAttribute("aria-pressed")).toBe("true");
    await waitFor(() => expect(calls("/api/propinas/report?").length).toBeGreaterThan(before));
    expect(screen.getByTestId("propinas-summary").textContent).toMatch(/Tips in 7 days/);
  });

  it("shows the period summary and one compact list mixing tips and withdrawals", async () => {
    renderPage();
    await waitFor(() => expect(screen.getAllByTestId("propinas-movement")).toHaveLength(2));
    expect(screen.getByTestId("propinas-tips-total").textContent).toMatch(/20\.000/);
    expect(screen.getByTestId("propinas-withdrawn-total").textContent).toMatch(/60\.000/);
    const items = screen.getAllByTestId("propinas-movement");
    // Newest first: the tip (1 day ago) then the withdrawal (2 days ago).
    expect(items.map((el) => el.getAttribute("data-kind"))).toEqual(["tip", "withdrawal"]);
    expect(within(items[0]).getByText(/Marta Benítez/)).toBeTruthy();
    expect(items[1].textContent).toMatch(/Withdrawal/);
    expect(items[1].textContent).toMatch(/− Gs\. 60\.000/);
  });

  it("dates and professional filters are folded behind 'Filters' and changing them clears the period chip", async () => {
    renderPage();
    await screen.findByTestId("propinas-card-1");
    expect(screen.queryByLabelText(/date from/i)).toBeNull();
    const toggle = screen.getByTestId("propinas-filters-toggle");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await userEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    await userEvent.selectOptions(screen.getByLabelText(/^professional$/i), "2");
    await waitFor(() =>
      expect(calls("/api/propinas/report?").some((u) => u.includes("professionalIds=2"))).toBe(true),
    );
    // Only the filtered professional's card remains.
    await waitFor(() => expect(screen.queryByTestId("propinas-card-1")).toBeNull());
    expect(screen.getByTestId("propinas-card-2")).toBeTruthy();
  });

  it("withdrawing: validates, 'withdraw all' fills the balance, and confirming posts and shows a toast", async () => {
    femmePostJson.mockResolvedValue({
      withdrawal: { id: 10, professionalName: "Laura", amount: 180000, withdrawnAt: new Date().toISOString() },
      newBalance: 0,
    });
    renderPage();
    await waitFor(() => expect(screen.getByTestId("propinas-balance-1").textContent).toMatch(/180\.000/));
    await userEvent.click(screen.getByTestId("propinas-withdraw-1"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByTestId("propinas-dialog-balance").textContent).toMatch(/180\.000/);

    await userEvent.click(within(dialog).getByTestId("propinas-withdraw-confirm"));
    expect(await within(dialog).findByText(/amount greater than zero/i)).toBeTruthy();

    await userEvent.type(within(dialog).getByLabelText(/amount to withdraw/i), "999999");
    await userEvent.click(within(dialog).getByTestId("propinas-withdraw-confirm"));
    expect(await within(dialog).findByText(/cannot exceed/i)).toBeTruthy();
    expect(femmePostJson).not.toHaveBeenCalled();

    balances[1] = 0;
    await userEvent.click(within(dialog).getByTestId("propinas-withdraw-all"));
    expect((within(dialog).getByLabelText(/amount to withdraw/i) as HTMLInputElement).value).toBe("180.000");
    await userEvent.click(within(dialog).getByTestId("propinas-withdraw-confirm"));
    await waitFor(() =>
      expect(femmePostJson).toHaveBeenCalledWith("/api/propinas/withdrawals", {
        professionalId: 1,
        amount: 180000,
      }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByTestId("propinas-toast")).toBeTruthy();
    // The card refreshes: nothing left to withdraw.
    await waitFor(() => expect(screen.getByTestId("propinas-balance-1").textContent).toMatch(/Gs\. 0/));
    expect((screen.getByTestId("propinas-withdraw-1") as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows an empty message when there are no movements", async () => {
    femmeJson.mockImplementation((url: unknown) => {
      const s = String(url);
      if (s === "/api/professionals") return Promise.resolve(pros);
      if (s.startsWith("/api/propinas/balance")) return Promise.resolve({ balance: 0 });
      if (s.startsWith("/api/propinas/report?")) {
        return Promise.resolve({ ...report([]), withdrawalsTotal: 0 });
      }
      if (s.startsWith("/api/propinas/withdrawals?")) {
        return Promise.resolve({ content: [], page: 0, size: 200, totalElements: 0, totalPages: 0 });
      }
      return Promise.resolve([]);
    });
    renderPage();
    expect(await screen.findByTestId("propinas-empty")).toBeTruthy();
  });
});
