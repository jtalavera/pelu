import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "../test/renderWithTour";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider } from "@design-system";
import * as femmeClient from "../api/femmeClient";
import i18n from "../i18n";
import PlatformStockIntegrationPage from "./PlatformStockIntegrationPage";

vi.mock("../api/femmeClient", () => ({
  femmeJson: vi.fn(),
}));

vi.mock("../api/platformTenants", () => ({
  listTenantsPaged: vi.fn().mockResolvedValue({ content: [], totalPages: 0 }),
}));

function row(overrides: Record<string, unknown>) {
  return {
    id: 1,
    tenantId: 7,
    tenantName: "Femme Coiffure",
    eventType: "CATALOG_FULL_SYNC",
    status: "PENDING",
    attemptCount: 0,
    lastError: null,
    createdAt: "2026-10-07T12:28:00Z",
    nextAttemptAt: null,
    doneAt: null,
    idempotencyKey: "PELU:CATALOG_FULL:7:abc",
    messages: [],
    blockedByEventId: null,
    ...overrides,
  };
}

const waitingForRetry = row({
  id: 10,
  attemptCount: 6,
  lastError: "STOCK_UNREACHABLE HttpTimeoutException",
  nextAttemptAt: "2026-10-09T17:50:00Z",
  messages: [
    { at: "2026-10-07T12:28:00Z", level: "INFO", code: "ENQUEUED", params: {} },
    {
      at: "2026-10-07T12:28:01Z",
      level: "INFO",
      code: "ATTEMPT_STARTED",
      params: { attempt: 1, maxAttempts: 7 },
    },
    {
      at: "2026-10-07T12:28:11Z",
      level: "WARN",
      code: "ATTEMPT_FAILED_RETRY_SCHEDULED",
      params: {
        attempt: 1,
        maxAttempts: 7,
        reason: "TIMEOUT",
        detail: "STOCK_UNREACHABLE HttpTimeoutException",
        nextAttemptAt: "2026-10-07T12:29:11Z",
      },
    },
  ],
});

const blocked = row({
  id: 11,
  eventType: "SALE",
  blockedByEventId: 10,
  messages: [{ at: "2026-10-07T19:27:00Z", level: "INFO", code: "ENQUEUED", params: {} }],
});

function page(content: unknown[]) {
  return { content, page: 0, size: 20, totalElements: content.length, totalPages: 1 };
}

function lastRequestedPath(): string {
  const calls = vi.mocked(femmeClient.femmeJson).mock.calls;
  return calls[calls.length - 1]?.[0] ?? "";
}

function renderPage() {
  return render(
    <MemoryRouter>
      <I18nextProvider i18n={i18n}>
        <ThemeProvider>
          <PlatformStockIntegrationPage />
        </ThemeProvider>
      </I18nextProvider>
    </MemoryRouter>,
  );
}

describe("PlatformStockIntegrationPage", () => {
  afterEach(cleanup);

  beforeEach(() => {
    void i18n.changeLanguage("en");
    vi.mocked(femmeClient.femmeJson).mockReset();
    vi.mocked(femmeClient.femmeJson).mockResolvedValue(page([waitingForRetry, blocked]) as never);
  });

  it("explains a row waiting for a retry and offers to retry or discard it", async () => {
    renderPage();
    const first = await screen.findByTestId("stock-outbox-row-10");
    expect(within(first).getByTestId("stock-outbox-latest-10").textContent).toMatch(
      /Attempt 1 of 7 failed: Stock did not answer in time/,
    );
    expect(within(first).getByTestId("stock-outbox-next-10").textContent).not.toBe("—");
    expect(within(first).getByRole("button", { name: "Retry now" })).toBeTruthy();
    expect(within(first).getByTestId("stock-outbox-discard-10")).toBeTruthy();
  });

  it("says which delivery a never-attempted row is waiting behind, without actions", async () => {
    renderPage();
    const second = await screen.findByTestId("stock-outbox-row-11");
    expect(within(second).getByTestId("stock-outbox-blocked-11").textContent).toContain(
      "Waiting for delivery #10",
    );
    expect(screen.queryByTestId("stock-outbox-retry-11")).toBeNull();
    expect(screen.queryByTestId("stock-outbox-discard-11")).toBeNull();
  });

  it("shows the whole history of a delivery under Details", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId("stock-outbox-row-10");
    expect(screen.queryByTestId("stock-outbox-history-10")).toBeNull();

    await user.click(screen.getByTestId("stock-outbox-details-10"));

    const items = within(screen.getByTestId("stock-outbox-history-10")).getAllByTestId(
      "stock-outbox-history-item-10",
    );
    expect(items.map((li) => li.getAttribute("data-code"))).toEqual([
      "ENQUEUED",
      "ATTEMPT_STARTED",
      "ATTEMPT_FAILED_RETRY_SCHEDULED",
    ]);
    expect(items[0].textContent).toContain("Queued to be sent to Stock.");
    expect(items[2].textContent).toContain("Technical detail: STOCK_UNREACHABLE HttpTimeoutException");
    await user.click(screen.getByTestId("stock-outbox-details-10"));
    expect(screen.queryByTestId("stock-outbox-history-10")).toBeNull();
  });

  it("tells that old rows have no recorded history", async () => {
    vi.mocked(femmeClient.femmeJson).mockResolvedValue(page([row({ id: 12 })]) as never);
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByTestId("stock-outbox-details-12"));
    expect(screen.getByText(/No history was recorded for this delivery/)).toBeTruthy();
  });

  it("retrying a waiting row calls the retry endpoint and reloads", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByTestId("stock-outbox-retry-10"));
    await waitFor(() =>
      expect(vi.mocked(femmeClient.femmeJson)).toHaveBeenCalledWith(
        "/api/platform/stock/outbox/10/retry",
        { method: "POST" },
      ),
    );
  });

  it("lists 'All' first among the status options and searches every status with it", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId("stock-outbox-row-10");
    const select = screen.getByLabelText("Status") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => [o.value, o.textContent])).toEqual([
      ["ALL", "All"],
      ["", "Pending or failed"],
      ["PENDING", "Pending"],
      ["PROCESSING", "Processing"],
      ["FAILED", "Failed"],
      ["DONE", "Delivered"],
      ["DISCARDED", "Discarded"],
    ]);
    // The default keeps showing only what needs attention.
    expect(select.value).toBe("");
    expect(lastRequestedPath()).not.toContain("status=");

    await user.selectOptions(select, "ALL");

    await waitFor(() => expect(lastRequestedPath()).toContain("status=ALL"));
  });

  it("paints each status with its own colour (delivered green, failed red…)", async () => {
    const statuses = ["PENDING", "PROCESSING", "FAILED", "DONE", "DISCARDED"];
    vi.mocked(femmeClient.femmeJson).mockResolvedValue(
      page(statuses.map((status, i) => row({ id: 100 + i, status, attemptCount: 1 }))) as never,
    );
    renderPage();
    await screen.findByTestId("stock-outbox-row-100");
    const classOf = (id: number) =>
      within(screen.getByTestId(`stock-outbox-status-${id}`)).getByText(
        {
          100: "Pending",
          101: "Processing",
          102: "Failed",
          103: "Delivered",
          104: "Discarded",
        }[id]!,
      ).className;

    expect(classOf(100)).toContain("bg-amber-100");
    expect(classOf(101)).toContain("bg-indigo-100");
    expect(classOf(102)).toContain("bg-red-100");
    expect(classOf(103)).toContain("bg-emerald-100");
    expect(classOf(104)).toContain("bg-slate-100");
    expect(new Set([100, 101, 102, 103, 104].map(classOf)).size).toBe(5);
  });
});
