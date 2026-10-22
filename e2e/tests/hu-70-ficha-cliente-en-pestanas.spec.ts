import { expect, test, type Page } from "@playwright/test";
import { apiPostJson, loginAsDemoApi } from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";

/**
 * HU-70 · Ficha de la cliente organizada en pestañas: compact header, always-visible stats strip
 * and five tabs (Details · Summary · Technical sheet · Appointments · Invoices), Details by
 * default, active tab in the URL, history loaded only when its tab opens.
 */
test.describe.configure({ mode: "serial" });

const TABS = ["Details", "Summary", "Technical sheet", "Appointments", "Invoices"];

function uniq(): string {
  return `${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

async function seedClient(page: Page) {
  const token = await loginAsDemoApi(page.request);
  return apiPostJson<{ id: number; fullName: string }>(page.request, token, "/api/clients", {
    fullName: `E2E70 Pestanas ${uniq()}`,
    phone: null,
    email: null,
    ruc: null,
    birthdayDay: 15,
    birthdayMonth: 8,
    birthdayYear: 1990,
    acquisitionChannel: "INSTAGRAM",
  });
}

test.describe("HU-70 · Ficha de la cliente en pestañas", () => {
  test("AC1–AC6 · encabezado compacto, indicadores, cinco pestañas en orden y Datos por defecto", async ({
    page,
  }) => {
    const client = await seedClient(page);
    await loginAsDemo(page);
    await page.goto(`/app/clients/${client.id}`);

    // AC1: visits · birthday (age) · channel on one line.
    const facts = page.getByTestId("client-header-facts");
    await expect(facts).toContainText("0 visits");
    await expect(facts).toContainText("Birthday: August 15, 1990 · ");
    await expect(facts).toContainText("Found us through: Instagram");
    const factsBox = await facts.boundingBox();
    expect(factsBox!.height).toBeLessThan(40);

    // AC2/AC3: four stats in one row on desktop, above the tabs.
    const stats = ["usual", "last-visit", "spent", "average"].map((k) =>
      page.getByTestId(`client-summary-${k}`),
    );
    const ys = await Promise.all(stats.map(async (s) => (await s.boundingBox())!.y));
    expect(new Set(ys.map(Math.round)).size).toBe(1);
    const tablistBox = await page.getByRole("tablist").boundingBox();
    expect(ys[0]).toBeLessThan(tablistBox!.y);

    // AC4/AC5: order and default.
    await expect(page.getByRole("tab")).toHaveText(TABS);
    await expect(page.getByRole("tab", { name: "Details" })).toHaveAttribute("aria-selected", "true");

    // AC6: three titled blocks with their fields.
    const contact = page.getByRole("region", { name: "Contact" });
    await expect(contact.getByLabel("Full name")).toBeVisible();
    await expect(contact.getByLabel("Phone")).toBeVisible();
    await expect(contact.getByLabel("Email")).toBeVisible();
    const fiscal = page.getByRole("region", { name: "Tax details" });
    await expect(fiscal.getByLabel("Document type")).toBeVisible();
    await expect(fiscal.locator("#detail-address")).toBeVisible();
    await expect(fiscal.locator("#detail-locality")).toBeVisible();
    const profile = page.getByRole("region", { name: "Profile" });
    await expect(profile.getByLabel("Day")).toHaveValue("15");
    await expect(profile.getByLabel("How did they find us?")).toHaveValue("INSTAGRAM");
    // Side by side, the channel select lines up with the day/month/year inputs (not their labels).
    const dayBox = (await profile.getByLabel("Day").boundingBox())!;
    const channelBox = (await profile.getByLabel("How did they find us?").boundingBox())!;
    expect(Math.abs(channelBox.y - dayBox.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(channelBox.height - dayBox.height)).toBeLessThanOrEqual(1);
    await expect(page.getByRole("button", { name: "Save", exact: true })).toBeVisible();
    await expect(page.getByTestId("client-edit-deactivate")).toBeVisible();
  });

  test("AC2, AC7–AC10, AC13 · contenido de cada pestaña; indicadores siempre visibles; turnos y comprobantes se cargan al abrir su pestaña", async ({
    page,
  }) => {
    const client = await seedClient(page);
    const historyRequests: string[] = [];
    page.on("request", (r) => {
      const u = new URL(r.url());
      if (u.pathname.startsWith("/api/appointments") || u.pathname.startsWith("/api/invoices")) {
        historyRequests.push(u.pathname);
      }
    });
    await loginAsDemo(page);
    historyRequests.length = 0;
    await page.goto(`/app/clients/${client.id}`);
    await expect(page.getByTestId("client-summary-usual")).toBeVisible();
    await page.waitForLoadState("networkidle");
    // AC13: nothing about appointments / invoices on open.
    expect(historyRequests).toEqual([]);

    // AC7
    await page.getByRole("tab", { name: "Summary" }).click();
    await expect(page.getByTestId("client-summary-services")).toContainText("No services performed yet");
    await expect(page.getByTestId("client-summary-products")).toContainText("No products purchased yet");
    await expect(page.getByTestId("client-summary-usual")).toBeVisible();
    // AC8
    await page.getByRole("tab", { name: "Technical sheet" }).click();
    await expect(page.getByTestId("client-technical-sheet").getByLabel("Notes")).toBeVisible();
    await expect(page.getByTestId("client-summary-usual")).toBeVisible();
    expect(historyRequests).toEqual([]);
    // AC9 (+AC13: now they load)
    await page.getByRole("tab", { name: "Appointments" }).click();
    await expect(page.getByText("Upcoming", { exact: true })).toBeVisible();
    await expect(page.getByText("Past", { exact: true })).toBeVisible();
    await expect(page.getByText("No appointments on record.", { exact: true })).toHaveCount(2);
    expect(historyRequests.some((p) => p.startsWith("/api/appointments"))).toBe(true);
    await expect(page.getByTestId("client-summary-usual")).toBeVisible();
    // AC10
    await page.getByRole("tab", { name: "Invoices" }).click();
    await expect(page.getByText("No invoices on record.", { exact: true })).toBeVisible();
    await expect(page.getByTestId("client-summary-usual")).toBeVisible();
  });

  test("AC11 · la pestaña queda en la URL: recarga, Atrás y valor desconocido", async ({ page }) => {
    const client = await seedClient(page);
    await loginAsDemo(page);
    await page.goto(`/app/clients/${client.id}`);
    await page.getByRole("tab", { name: "Appointments" }).click();
    await expect(page).toHaveURL(new RegExp(`/app/clients/${client.id}\\?tab=appointments$`));
    await page.reload();
    await expect(page.getByRole("tab", { name: "Appointments" })).toHaveAttribute("aria-selected", "true");

    await page.getByRole("tab", { name: "Invoices" }).click();
    await expect(page).toHaveURL(/\?tab=invoices$/);
    await page.goBack();
    await expect(page).toHaveURL(/\?tab=appointments$/);
    await expect(page.getByRole("tab", { name: "Appointments" })).toHaveAttribute("aria-selected", "true");

    await page.getByRole("tab", { name: "Details" }).click();
    await expect(page).toHaveURL(new RegExp(`/app/clients/${client.id}$`));

    await page.goto(`/app/clients/${client.id}?tab=sheet`);
    await expect(page.getByRole("tab", { name: "Technical sheet" })).toHaveAttribute("aria-selected", "true");
    await page.goto(`/app/clients/${client.id}?tab=whatever`);
    await expect(page.getByRole("tab", { name: "Details" })).toHaveAttribute("aria-selected", "true");
  });

  test("AC3, AC12, AC14 · celular en tema oscuro: indicadores 2×2, pestañas desplazables, sin scroll de página", async ({
    page,
  }) => {
    const client = await seedClient(page);
    await loginAsDemo(page);
    await page.goto(`/app/clients/${client.id}`);
    // The app's own theme toggle (it doesn't follow the OS preference); on phones it lives in the
    // nav drawer, so switch on desktop first, then shrink to a phone.
    await page.getByRole("button", { name: "Switch to dark mode" }).click();
    await page.setViewportSize({ width: 375, height: 800 });

    const stats = ["usual", "last-visit", "spent", "average"].map((k) =>
      page.getByTestId(`client-summary-${k}`),
    );
    const boxes = await Promise.all(stats.map(async (s) => (await s.boundingBox())!));
    expect(Math.round(boxes[0].y)).toBe(Math.round(boxes[1].y));
    expect(Math.round(boxes[2].y)).toBe(Math.round(boxes[3].y));
    expect(boxes[2].y).toBeGreaterThan(boxes[0].y);

    // Page never scrolls sideways; the tab bar scrolls inside itself.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
    const tablist = page.getByRole("tablist");
    expect(await tablist.evaluate((el) => getComputedStyle(el).overflowX)).toBe("auto");
    const invoicesTab = page.getByRole("tab", { name: "Invoices" });
    await invoicesTab.scrollIntoViewIfNeeded();
    await invoicesTab.click();
    await expect(page.getByText("No invoices on record.", { exact: true })).toBeVisible();
    // Touch target ≥ 44 px.
    for (const name of TABS) {
      expect((await page.getByRole("tab", { name }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }

    // AC14: dark theme actually applied to the stat cards.
    const bg = await stats[0].evaluate((el) => getComputedStyle(el).backgroundColor);
    const [r, g, b] = bg.match(/\d+/g)!.map(Number);
    expect(r + g + b).toBeLessThan(200);
  });

  test("AC15 · el tour guiado describe las pestañas nuevas", async ({ page }) => {
    const client = await seedClient(page);
    await loginAsDemo(page);
    await page.goto(`/app/clients/${client.id}`);
    await page.getByRole("button", { name: "Start guided tour" }).click();
    await page.getByRole("button", { name: /next/i }).first().click();
    await expect(
      page.getByText(/Technical sheet with notes and color formula/).first(),
    ).toBeVisible();
  });
});
