import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider } from "@design-system";
import i18n from "../i18n";
import { AuditLogPanel } from "./AuditLogPanel";

const femmeJsonMock = vi.fn();
vi.mock("../api/femmeClient", () => ({
  femmeJson: (...args: unknown[]) => femmeJsonMock(...args),
}));

function row(over: Record<string, unknown> = {}) {
  return {
    id: 1,
    tenantId: 7,
    tenantName: "Salón Aurora",
    userEmail: "admin@salon.test",
    userRole: "ADMIN",
    httpMethod: "POST",
    resource: "invoices",
    operation: "void",
    entityId: "42",
    statusCode: 200,
    createdAt: "2026-10-08T12:30:00Z",
    ...over,
  };
}

function page(content: unknown[], totalElements = content.length) {
  return { content, page: 0, size: 10, totalElements, totalPages: Math.max(1, Math.ceil(totalElements / 10)) };
}

function renderPanel(platform = false) {
  return render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <AuditLogPanel platform={platform} />
      </ThemeProvider>
    </I18nextProvider>,
  );
}

describe("AuditLogPanel (Issue #284 · quién hizo qué)", () => {
  beforeEach(() => {
    void i18n.changeLanguage("en");
    femmeJsonMock.mockReset();
  });
  afterEach(() => cleanup());

  it("lists who did what, to which record and when, with a readable action", async () => {
    femmeJsonMock.mockResolvedValue(
      page([
        row(),
        row({ id: 2, httpMethod: "PUT", resource: "clients", operation: null, entityId: "9", userRole: "PROFESSIONAL", userEmail: "pro@salon.test" }),
        row({ id: 3, httpMethod: "POST", resource: "gadgets", operation: null, entityId: null }),
      ]),
    );
    renderPanel();

    const rows = await screen.findAllByTestId("audit-row");
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByTestId("audit-row-user").textContent).toBe("admin@salon.test");
    expect(rows[0].textContent).toContain("Administrator");
    expect(within(rows[0]).getByTestId("audit-row-action").textContent).toBe("Voided an invoice");
    expect(rows[0].textContent).toContain("#42");
    // Generic fallback: verb + resource.
    expect(within(rows[1]).getByTestId("audit-row-action").textContent).toBe("Updated client");
    // Unknown resource: shown as is, never blank.
    expect(within(rows[2]).getByTestId("audit-row-action").textContent).toBe("Created gadgets");
    // Salon view: no "Business" column and the salon endpoint is used.
    expect(screen.queryByText("Business")).toBeNull();
    expect(femmeJsonMock.mock.calls[0][0]).toMatch(/^\/api\/audit\?/);
  });

  it("the root view shows the business of each row and uses the platform endpoint", async () => {
    femmeJsonMock.mockResolvedValue(page([row(), row({ id: 2, tenantId: null, tenantName: null, userRole: "PLATFORM_ADMIN", userEmail: "root@pelu" })]));
    renderPanel(true);

    const rows = await screen.findAllByTestId("audit-row");
    expect(rows[0].textContent).toContain("Salón Aurora");
    expect(rows[1].textContent).toContain("Platform");
    expect(rows[1].textContent).toContain("Root user");
    expect(femmeJsonMock.mock.calls[0][0]).toMatch(/^\/api\/platform\/audit\?/);
  });

  it("searches with Enter/the button (a form) and sends the filters; clearing resets them", async () => {
    femmeJsonMock.mockResolvedValue(page([row()]));
    renderPanel();
    await screen.findAllByTestId("audit-row");

    await userEvent.type(screen.getByLabelText("User"), "ana{Enter}");
    await userEvent.type(screen.getByLabelText("From"), "2026-10-01");
    await userEvent.selectOptions(screen.getByLabelText("What"), "invoices");
    await userEvent.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() => {
      const url = String(femmeJsonMock.mock.calls[femmeJsonMock.mock.calls.length - 1]?.[0]);
      expect(url).toContain("q=ana");
      expect(url).toContain("from=2026-10-01");
      expect(url).toContain("resource=invoices");
      expect(url).toContain("page=0");
    });

    await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    await waitFor(() => {
      const url = String(femmeJsonMock.mock.calls[femmeJsonMock.mock.calls.length - 1]?.[0]);
      expect(url).not.toContain("q=");
      expect(url).not.toContain("from=");
    });
  });

  it("rejects an inverted date range with the rule and an example, without calling the API", async () => {
    femmeJsonMock.mockResolvedValue(page([row()]));
    renderPanel();
    await screen.findAllByTestId("audit-row");
    const calls = femmeJsonMock.mock.calls.length;

    await userEvent.type(screen.getByLabelText("From"), "2026-10-09");
    await userEvent.type(screen.getByLabelText("To"), "2026-10-01");
    await userEvent.click(screen.getByRole("button", { name: "Search" }));

    expect((await screen.findByRole("alert")).textContent).toContain("must be on or before");
    expect(femmeJsonMock.mock.calls.length).toBe(calls);
  });

  it("shows an empty state, and an error alert when the load fails", async () => {
    femmeJsonMock.mockResolvedValueOnce(page([]));
    renderPanel();
    expect((await screen.findByTestId("audit-empty")).textContent).toContain("No activity recorded");

    cleanup();
    femmeJsonMock.mockRejectedValueOnce(new Error("boom"));
    renderPanel();
    expect(await screen.findByText("Could not load the audit trail.")).toBeTruthy();
  });
});
