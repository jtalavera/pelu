import { expect, test, type Page } from "@playwright/test";
import { apiPostJson, loginAsDemoApi } from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";

/**
 * HU-70 · Ficha de la cliente organizada en pestañas (rediseño minimalista): encabezado simple
 * y cinco pestañas (Details · Appointments · Invoices · Technical sheet · History), Details por
 * defecto, pestaña activa en la URL, historial de turnos/comprobantes cargado solo al abrir su
 * pestaña. El resumen (visitas, gasto, ticket, servicios) vive ahora en la pestaña History.
 */
test.describe.configure({ mode: "serial" });

const TABS = ["Details", "Appointments", "Invoices", "Technical sheet", /History/];

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
  test("AC1–AC6 · encabezado simple, cinco pestañas en orden y Datos por defecto", async ({
    page,
  }) => {
    const client = await seedClient(page);
    await loginAsDemo(page);
    await page.goto(`/app/clients/${client.id}`);

    // AC1: compact header — visits on one line.
    const facts = page.getByTestId("client-header-facts");
    await expect(facts).toContainText("0 visits");
    expect((await facts.boundingBox())!.height).toBeLessThan(40);

    // AC4/AC5: order and default.
    await expect(page.getByRole("tab")).toHaveText(TABS);
    await expect(page.getByRole("tab", { name: "Details" })).toHaveAttribute("aria-selected", "true");

    // AC6: contact always visible; tax details and profile fold away and carry their fields.
    await expect(page.locator("#detail-fullname")).toBeVisible();
    await expect(page.locator("#detail-phone")).toBeVisible();
    await expect(page.locator("#detail-email")).toBeVisible();
    await page.getByTestId("client-section-fiscal-toggle").click();
    const fiscal = page.getByTestId("client-section-fiscal");
    await expect(fiscal.getByLabel("Document type")).toBeVisible();
    await expect(fiscal.locator("#detail-address")).toBeVisible();
    await expect(fiscal.locator("#detail-locality")).toBeVisible();
    await page.getByTestId("client-section-profile-toggle").click();
    const profile = page.getByTestId("client-section-profile");
    await expect(profile.getByLabel("Day")).toHaveValue("15");
    await expect(profile.getByLabel("How did they find us?")).toHaveValue("INSTAGRAM");
    // Side by side, the channel select lines up with the day/month/year inputs (not their labels).
    const dayBox = (await profile.getByLabel("Day").boundingBox())!;
    const channelBox = (await profile.getByLabel("How did they find us?").boundingBox())!;
    expect(Math.abs(channelBox.y - dayBox.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(channelBox.height - dayBox.height)).toBeLessThanOrEqual(1);
    await expect(page.getByRole("button", { name: "Save", exact: true })).toBeVisible();
    await expect(page.getByTestId("client-active-switch")).toBeVisible();
  });

  test("AC7–AC10, AC13 · contenido de cada pestaña; turnos y comprobantes se cargan al abrir su pestaña", async ({
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
    await expect(page.locator("#detail-fullname")).toBeVisible();
    await page.waitForLoadState("networkidle");
    // AC13: nothing about appointments / invoices on open.
    expect(historyRequests).toEqual([]);

    // AC7: History (summary of the client).
    await page.getByRole("tab", { name: /History/ }).click();
    await expect(page.getByTestId("client-radiography-empty")).toBeVisible();
    await expect(page.getByTestId("client-radiography-visits")).toBeVisible();
    // AC8
    await page.getByRole("tab", { name: "Technical sheet" }).click();
    await expect(page.getByTestId("client-technical-sheet").getByLabel("Notes")).toBeVisible();
    expect(historyRequests).toEqual([]);
    // AC9 (+AC13: now they load)
    await page.getByRole("tab", { name: "Appointments" }).click();
    await expect(page.getByTestId("client-appointments-empty")).toBeVisible();
    expect(historyRequests.some((p) => p.startsWith("/api/appointments"))).toBe(true);
    // AC10
    await page.getByRole("tab", { name: "Invoices" }).click();
    await expect(page.getByTestId("client-invoices-empty")).toBeVisible();
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

  test("AC12, AC14 · celular en tema oscuro: pestañas desplazables, sin scroll de página", async ({
    page,
  }) => {
    const client = await seedClient(page);
    await loginAsDemo(page);
    await page.goto(`/app/clients/${client.id}`);
    // The app's own theme toggle (it doesn't follow the OS preference); on phones it lives in the
    // nav drawer, so switch on desktop first, then shrink to a phone.
    await page.getByRole("button", { name: "Switch to dark mode" }).click();
    await page.setViewportSize({ width: 375, height: 800 });
    await expect(page.locator("#detail-fullname")).toBeVisible();

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
    await expect(page.getByTestId("client-invoices-empty")).toBeVisible();
    // Touch target ≥ 44 px.
    for (const name of ["Details", "Appointments", "Invoices", "Technical sheet", /History/]) {
      expect((await page.getByRole("tab", { name }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }

    // AC14: dark theme actually applied.
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const [r, g, b] = bg.match(/\d+/g)!.map(Number);
    expect(r + g + b).toBeLessThan(200);
  });

  test("AC15 · el tour guiado describe las pestañas", async ({ page }) => {
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
