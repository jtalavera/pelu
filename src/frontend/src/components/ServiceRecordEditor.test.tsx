import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "../test/renderWithTour";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider } from "@design-system";
import i18n from "../i18n";
import { ServiceRecordEditor } from "./ServiceRecordEditor";
import type { ServiceRecordDetail } from "../api/serviceRecords";

const femmeJson = vi.fn();
const femmePostJson = vi.fn();
const femmePutJson = vi.fn();

vi.mock("../api/femmeClient", () => ({
  femmeJson: (...args: unknown[]) => femmeJson(...args),
  femmePostJson: (...args: unknown[]) => femmePostJson(...args),
  femmePutJson: (...args: unknown[]) => femmePutJson(...args),
}));

const openRecord: ServiceRecordDetail = {
  id: 7,
  clientId: 1,
  clientFullName: "Marta Benítez",
  clientRuc: null,
  status: "OPEN",
  totalAmount: "310000",
  tipsTotal: "0",
  voidReason: null,
  createdAt: "2026-10-26T13:30:00Z",
  closedAt: null,
  invoiceId: null,
  invoiceNumberFormatted: null,
  lines: [
    {
      id: 1,
      serviceId: 11,
      description: "Coloración",
      unitPrice: "250000",
      quantity: 1,
      lineTotal: "250000",
      professionalId: 3,
      professionalName: "Laura",
    },
    {
      id: 2,
      serviceId: 12,
      description: "Brushing",
      unitPrice: "60000",
      quantity: 1,
      lineTotal: "60000",
      professionalId: 4,
      professionalName: "Ana",
    },
  ],
  tips: [],
};

function renderEditor(
  initial: ServiceRecordDetail | null,
  props: Partial<React.ComponentProps<typeof ServiceRecordEditor>> = {},
) {
  const onClose = vi.fn();
  const utils = render(
    <MemoryRouter initialEntries={["/app/service-records"]}>
      <Routes>
        <Route
          path="/app/service-records"
          element={
            <I18nextProvider i18n={i18n}>
              <ThemeProvider>
                <ServiceRecordEditor
                  initial={initial}
                  allowClientCreateNew={false}
                  onClose={onClose}
                  {...props}
                />
              </ThemeProvider>
            </I18nextProvider>
          }
        />
        <Route path="/app/billing" element={<div>Billing page</div>} />
      </Routes>
    </MemoryRouter>,
  );
  return { ...utils, onClose };
}

describe("ServiceRecordEditor", () => {
  beforeEach(() => {
    void i18n.changeLanguage("en");
    femmeJson.mockReset();
    femmePostJson.mockReset();
    femmePutJson.mockReset();
    femmeJson.mockImplementation((url: unknown) => {
      const s = String(url);
      if (s === "/api/professionals") {
        return Promise.resolve([
          { id: 3, fullName: "Laura", active: true },
          { id: 4, fullName: "Ana", active: true },
        ]);
      }
      if (s.startsWith("/api/clients/")) return Promise.resolve({ email: "marta@example.com" });
      return Promise.resolve([]);
    });
  });

  afterEach(() => cleanup());

  it("a new record starts with one service line, quantity 1, and no remove link", async () => {
    renderEditor(null);
    expect(screen.getAllByTestId("service-record-line")).toHaveLength(1);
    expect((screen.getByLabelText(/quantity/i) as HTMLInputElement).value).toBe("1");
    expect(screen.queryByTestId("service-record-line-remove")).toBeNull();
    expect(screen.getByRole("heading", { name: /^client$/i })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /^services$/i })).toBeTruthy();
    // Save needs a client first.
    expect((screen.getByTestId("service-record-submit") as HTMLButtonElement).disabled).toBe(true);
    // Open record actions don't exist for a new record.
    expect(screen.queryByTestId("service-record-generate-invoice")).toBeNull();
    expect(screen.queryByTestId("service-record-actions-toggle")).toBeNull();
  });

  it("adds another service line and offers Remove once there are two", async () => {
    renderEditor(null);
    await userEvent.click(screen.getByTestId("service-record-add-line"));
    expect(screen.getAllByTestId("service-record-line")).toHaveLength(2);
    expect(screen.getAllByTestId("service-record-line-remove")).toHaveLength(2);
    await userEvent.click(screen.getAllByTestId("service-record-line-remove")[0]);
    expect(screen.getAllByTestId("service-record-line")).toHaveLength(1);
  });

  it("quantity is on every line and recalculates the subtotal and the total", async () => {
    renderEditor(openRecord);
    const total = screen.getByTestId("service-record-total");
    expect(total.textContent).toMatch(/310\.000/);
    const qty = screen.getAllByLabelText(/quantity/i)[1] as HTMLInputElement;
    await userEvent.clear(qty);
    await userEvent.type(qty, "2");
    expect(screen.getAllByTestId("service-record-line-subtotal")[1].textContent).toMatch(/120\.000/);
    expect(total.textContent).toMatch(/370\.000/);
  });

  it("tips live under More options, one field per professional on the lines", async () => {
    renderEditor(openRecord);
    expect(screen.queryByLabelText(/tip/i)).toBeNull();
    const toggle = screen.getByTestId("service-record-more-toggle");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await userEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByLabelText(/tip · Laura/i)).toBeTruthy();
    expect(screen.getByLabelText(/tip · Ana/i)).toBeTruthy();
  });

  it("Save updates the record and hands it to the host (no inline success message)", async () => {
    const saved = { ...openRecord, totalAmount: "370000" };
    femmePutJson.mockResolvedValue(saved);
    const onSaved = vi.fn();
    renderEditor(openRecord, { onSaved });
    const qty = screen.getAllByLabelText(/quantity/i)[1];
    await userEvent.clear(qty);
    await userEvent.type(qty, "2");
    await userEvent.click(screen.getByTestId("service-record-submit"));
    await waitFor(() => expect(femmePutJson).toHaveBeenCalled());
    const [url, payload] = femmePutJson.mock.calls[0];
    expect(url).toBe("/api/service-records/7");
    expect(payload.lines[1]).toMatchObject({ serviceId: 12, quantity: 2, professionalId: 4 });
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved, "updated"));
    expect(screen.queryByText(/changes saved/i)).toBeNull();
  });

  it("Charge saves pending edits and opens Facturación with the record prefilled", async () => {
    femmePutJson.mockResolvedValue(openRecord);
    renderEditor(openRecord);
    await userEvent.click(screen.getByTestId("service-record-generate-invoice"));
    await waitFor(() => expect(femmePutJson).toHaveBeenCalled());
    expect(await screen.findByText("Billing page")).toBeTruthy();
  });

  it("voiding lives behind the ⋯ menu and needs a reason", async () => {
    const voided = { ...openRecord, status: "VOIDED" as const, voidReason: "Left early" };
    femmePostJson.mockResolvedValue(voided);
    const onVoided = vi.fn();
    renderEditor(openRecord, { onVoided });
    expect(screen.queryByTestId("service-record-void-open")).toBeNull();
    await userEvent.click(screen.getByTestId("service-record-actions-toggle"));
    await userEvent.click(screen.getByTestId("service-record-void-open"));
    await userEvent.click(screen.getByTestId("service-record-void-confirm"));
    expect(await screen.findByText(/enter a reason/i)).toBeTruthy();
    expect(femmePostJson).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText(/reason/i), "Left early");
    await userEvent.click(screen.getByTestId("service-record-void-confirm"));
    await waitFor(() => expect(femmePostJson).toHaveBeenCalledWith("/api/service-records/7/void", { voidReason: "Left early" }));
    await waitFor(() => expect(onVoided).toHaveBeenCalledWith(voided));
  });

  it("a paid record is read-only and shows its linked invoice", async () => {
    const closed: ServiceRecordDetail = {
      ...openRecord,
      status: "CLOSED",
      invoiceNumberFormatted: "001-001-0000124",
      tips: [{ professionalId: 3, professionalName: "Laura", amount: "20000" }],
    };
    renderEditor(closed);
    const ro = screen.getByTestId("service-record-readonly");
    expect(within(ro).getByText(/001-001-0000124/)).toBeTruthy();
    expect(within(ro).getByText(/Coloración/)).toBeTruthy();
    expect(screen.queryByTestId("service-record-submit")).toBeNull();
    expect(screen.queryByTestId("service-record-generate-invoice")).toBeNull();
    expect(screen.getByTestId("service-record-close")).toBeTruthy();
  });

  it("a voided record shows its reason and is read-only", async () => {
    renderEditor({ ...openRecord, status: "VOIDED", voidReason: "Left early" });
    expect(screen.getByText(/Left early/)).toBeTruthy();
    expect(screen.queryByTestId("service-record-submit")).toBeNull();
  });
});
