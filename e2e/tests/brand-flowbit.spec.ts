import { expect, test } from "@playwright/test";
import {
  apiBaseUrl,
  calendarVisibleWeekSlotIso,
  createAppointmentApi,
  loginAsDemoApi,
  seedCategoryServiceProfessional,
  seedClient,
} from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";

// Flowbit rebrand — look & feel from the brand manual (flowbit-website/branding).
// Palette: teal #0E767E, tinta noche #0A1F33, durazno #F3C6AE, lino #F6F4EF; Nunito (titles) and
// Nunito Sans (text). These checks read computed styles, not screenshots, so they survive layout tweaks.

const TEAL = "rgb(14, 118, 126)";
const TINTA = "rgb(10, 31, 51)";
const DURAZNO = "rgb(243, 198, 174)";
const LINO = "rgb(246, 244, 239)";
const SURFACE_DARK = "rgb(17, 42, 66)";
const WHITE = "rgb(255, 255, 255)";

test.describe("Flowbit · identidad de marca", () => {
  test("B1: título, favicon, apple-touch-icon, manifest y theme-color", async ({ page, request }) => {
    await page.goto("/login");
    await expect(page).toHaveTitle("Flowbit");
    await expect(page.locator('link[rel="icon"][href="/favicon.ico"]')).toHaveCount(1);
    await expect(page.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveCount(1);
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
      "href",
      "/flowbit-app-icon-180.png",
    );
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#0E767E");

    const manifestHref = await page.locator('link[rel="manifest"]').getAttribute("href");
    expect(manifestHref).toBe("/site.webmanifest");
    const baseUrl = new URL(page.url()).origin;
    const manifest = await request.get(`${baseUrl}${manifestHref}`);
    expect(manifest.ok()).toBeTruthy();
    const json = (await manifest.json()) as { name: string; theme_color: string; icons: unknown[] };
    expect(json.name).toBe("Flowbit");
    expect(json.theme_color).toBe("#0E767E");
    expect(json.icons.length).toBeGreaterThanOrEqual(2);
    for (const icon of ["/favicon.ico", "/flowbit-app-icon.svg", "/flowbit-app-icon-180.png"]) {
      expect((await request.get(`${baseUrl}${icon}`)).ok(), icon).toBeTruthy();
    }
  });

  test("B2: Nunito en títulos y Nunito Sans en texto, autohospedadas (sin Google Fonts)", async ({
    page,
  }) => {
    const fontHosts: string[] = [];
    page.on("request", (r) => {
      const host = new URL(r.url()).host;
      if (host.includes("fonts.googleapis.com") || host.includes("fonts.gstatic.com")) {
        fontHosts.push(host);
      }
    });
    await page.goto("/login");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    const fonts = await page.evaluate(async () => {
      await document.fonts.ready;
      return {
        body: getComputedStyle(document.body).fontFamily,
        heading: getComputedStyle(document.querySelector("h1")!).fontFamily,
        nunitoLoaded: document.fonts.check('700 16px "Nunito Variable"'),
        nunitoSansLoaded: document.fonts.check('400 16px "Nunito Sans Variable"'),
      };
    });
    expect(fonts.body).toContain("Nunito Sans");
    expect(fonts.heading).toContain("Nunito");
    expect(fonts.heading).not.toMatch(/^"?Inter/);
    expect(fonts.nunitoLoaded).toBeTruthy();
    expect(fonts.nunitoSansLoaded).toBeTruthy();
    expect(fontHosts).toEqual([]);
  });

  test("B3: pantalla de login sobre fondo teal con logo y slogan; tarjeta con el primario teal", async ({
    page,
  }) => {
    await page.goto("/login");
    const bg = page.locator(".fb-auth-bg");
    await expect(bg).toHaveCSS("background-color", TEAL);
    await expect(bg.getByTestId("flowbit-logo")).toBeVisible();
    await expect(bg.getByTestId("auth-slogan")).toHaveText("Your salon, tangle-free");
    const signIn = page.getByRole("button", { name: "Sign in" });
    await expect(signIn).toHaveCSS("background-color", TEAL);
    await expect(signIn).toHaveCSS("color", WHITE);
    // Pill-shaped primary button (brand: rounded forms).
    const radius = await signIn.evaluate((el) => parseFloat(getComputedStyle(el).borderTopLeftRadius));
    expect(radius).toBeGreaterThanOrEqual(20);
  });

  test("B4: barra superior de la app teal con el logo; en oscuro, superficie tinta con primario durazno", async ({
    page,
  }) => {
    await loginAsDemo(page);
    const header = page.locator("header").first();
    await expect(header).toHaveCSS("background-color", TEAL);
    await expect(header.getByTestId("flowbit-logo")).toBeVisible();
    await expect(page.locator("body")).toHaveCSS("background-color", LINO);

    await page.getByRole("button", { name: "Switch to dark mode" }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect(header).toHaveCSS("background-color", SURFACE_DARK);
    await expect(page.locator("body")).toHaveCSS("background-color", TINTA);
    await expect(page.locator("body")).toHaveCSS("color", LINO);
  });

  test("B5: en oscuro el botón primario es durazno con texto tinta", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("femme-theme", "dark"));
    await page.goto("/login");
    await expect(page.locator("html")).toHaveClass(/dark/);
    const signIn = page.getByRole("button", { name: "Sign in" });
    await expect(signIn).toHaveCSS("background-color", DURAZNO);
    await expect(signIn).toHaveCSS("color", TINTA);
  });

  test("B6: el tema no depende del SO (sin parpadeo oscuro) y la clave guardada se respeta", async ({
    page,
  }) => {
    // OS in dark mode but no stored preference: the app stays light (it never followed the OS).
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/login");
    await expect(page.locator("html")).not.toHaveClass(/dark/);
    await expect(page.locator("body")).toHaveCSS("background-color", LINO);

    // The stored choice (same key the hook writes) is applied before React mounts.
    await page.evaluate(() => localStorage.setItem("femme-theme", "dark"));
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("html")).toHaveClass(/dark/);
  });

  test("B7: los turnos de la agenda usan los colores de marca", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, token);
    const client = await seedClient(request, token, `E2E Brand ${Date.now()}`);
    const { id } = await createAppointmentApi(request, token, {
      clientId: client.id,
      professionalId: seed.professionalId,
      serviceId: seed.serviceId,
      startAt: calendarVisibleWeekSlotIso(11, 0),
    });
    expect(apiBaseUrl()).toBeTruthy();

    await loginAsDemo(page);
    await page.goto("/app/calendar?view=week");
    const block = page.getByTestId(`calendar-appt-${id}`);
    await expect(block).toBeVisible({ timeout: 15_000 });
    const bg = await block.evaluate((el) => getComputedStyle(el).backgroundColor);
    // teal, durazno, celeste or rosa (the professional's slot in the 4-color cycle).
    expect([TEAL, DURAZNO, "rgb(201, 217, 230)", "rgb(241, 175, 194)"]).toContain(bg);
  });
});
