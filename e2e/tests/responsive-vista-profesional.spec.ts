import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { loginAs } from "../fixtures/auth";
import {
  apiBaseUrl,
  apiPostJson,
  calendarVisibleWeekSlotIso,
  createAppointmentApi,
  loginAsDemoApi,
  seedCategoryServiceProfessional,
} from "../fixtures/api";

/**
 * The professional's area (login → calendar → appointment form → profile → my commissions) works
 * on phones and tablets: no horizontal page scroll, the sidebar becomes a drawer opened from the
 * topbar below 1024px, and the touch controls are at least 44px.
 */

const PASSWORD = "ValidPass1!";

const VIEWPORTS = [
  { name: "celular 360", width: 360, height: 740, phone: true, drawer: true },
  { name: "celular 390", width: 390, height: 844, phone: true, drawer: true },
  { name: "tablet vertical", width: 768, height: 1024, phone: false, drawer: true },
  { name: "tablet horizontal", width: 1024, height: 768, phone: false, drawer: false },
] as const;

async function setupProfessional(request: APIRequestContext): Promise<{ email: string; appointmentId: number }> {
  const admin = await loginAsDemoApi(request);
  const salon = await seedCategoryServiceProfessional(request, admin);
  const email = `resp${Date.now()}${Math.floor(Math.random() * 1000)}@test.com`;
  const prof = await apiPostJson<{ id: number }>(request, admin, "/api/professionals", {
    fullName: `E2E Resp ${Date.now()}`,
    email,
  });
  const { rawToken } = await apiPostJson<{ rawToken: string }>(
    request,
    admin,
    `/api/professionals/${prof.id}/grant-access`,
    {},
  );
  const activate = await request.post(`${apiBaseUrl()}/api/auth/activate`, {
    data: { token: rawToken, password: PASSWORD, confirmPassword: PASSWORD },
  });
  expect(activate.ok(), await activate.text()).toBeTruthy();
  const appt = await createAppointmentApi(request, admin, {
    clientId: null,
    professionalId: prof.id,
    serviceId: salon.serviceId,
    startAt: calendarVisibleWeekSlotIso(10, 0),
  });
  return { email, appointmentId: appt.id };
}

async function expectNoHorizontalScroll(page: Page) {
  const [scrollWidth, innerWidth] = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    window.innerWidth,
  ]);
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
}

async function expectTouchTarget(page: Page, selector: string) {
  const box = await page.locator(selector).first().boundingBox();
  expect(box, selector).not.toBeNull();
  expect(box!.height, `${selector} height`).toBeGreaterThanOrEqual(44);
  expect(box!.width, `${selector} width`).toBeGreaterThanOrEqual(44);
}

for (const vp of VIEWPORTS) {
  test.describe(`Vista de la profesional responsive · ${vp.name} (${vp.width}×${vp.height})`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, hasTouch: true });

    test("calendario, menú y formularios se adaptan a la pantalla", async ({ page, request }) => {
      const { email } = await setupProfessional(request);

      await loginAs(page, email, PASSWORD);
      await expect(page).toHaveURL(/\/app\/calendar/);
      await expect(page.getByRole("button", { name: /today/i })).toBeVisible();
      await expectNoHorizontalScroll(page);

      const sidebar = page.getByTestId("app-sidebar");
      const toggle = page.getByTestId("nav-drawer-toggle");
      if (vp.drawer) {
        // Sidebar hidden behind the hamburger; content uses the full width.
        await expect(sidebar).toBeHidden();
        await expectTouchTarget(page, "[data-testid='nav-drawer-toggle']");
        await expect(toggle).toHaveAttribute("aria-expanded", "false");

        await toggle.click();
        await expect(sidebar).toBeVisible();
        await expect(toggle).toHaveAttribute("aria-expanded", "true");
        await expectTouchTarget(page, "[data-testid='app-sidebar'] a[href='/app/calendar']");
        // Escape and the backdrop close it.
        await page.keyboard.press("Escape");
        await expect(sidebar).toBeHidden();
        await toggle.click();
        await page.getByTestId("nav-drawer-backdrop").click({ position: { x: vp.width - 10, y: 300 } });
        await expect(sidebar).toBeHidden();
        // Navigating from the drawer closes it.
        await toggle.click();
        await sidebar.getByRole("link", { name: "Calendar" }).click();
        await expect(sidebar).toBeHidden();
      } else {
        await expect(toggle).toHaveCount(0);
        await expect(sidebar).toBeVisible();
      }

      if (vp.phone) {
        // Theme and language live in the drawer on phones (44px targets), not in the topbar.
        await expect(page.locator("header [data-tour='topbar-lang']")).toHaveCount(0);
        await toggle.click();
        const prefs = page.getByTestId("drawer-preferences");
        await expect(prefs.locator("[data-tour='topbar-lang']")).toBeVisible();
        await expectTouchTarget(page, "[data-testid='drawer-preferences'] [data-tour='topbar-theme']");
        await prefs.getByRole("button", { name: "ES", exact: true }).click();
        await expect(page.getByRole("button", { name: /^hoy$/i })).toBeVisible();
        await prefs.getByRole("button", { name: "EN", exact: true }).click();
        await page.keyboard.press("Escape");
      } else {
        await expect(page.locator("header [data-tour='topbar-lang']")).toBeVisible();
      }

      // Calendar header controls: reachable without overflow, touch-sized below 1024px.
      if (vp.drawer) {
        await expectTouchTarget(page, "[data-tour='calendar-today']");
        await expectTouchTarget(page, "[data-tour='calendar-new-appointment']");
        await expectTouchTarget(page, "[data-tour='calendar-week-nav'] button");
      }
      const filterBox = await page.locator("#prof-filter").boundingBox();
      expect(filterBox!.width).toBeGreaterThanOrEqual(160);
      expect(filterBox!.x + filterBox!.width).toBeLessThanOrEqual(vp.width);
      // Phones show one day at a time; tablets the whole week.
      await expect(page.locator("[data-testid^='calendar-day-col-']")).toHaveCount(vp.phone ? 1 : 7);

      // The appointment form fits the screen.
      await page.locator("[data-tour='calendar-new-appointment']").click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      const dlgBox = await dialog.boundingBox();
      expect(dlgBox!.x).toBeGreaterThanOrEqual(0);
      expect(dlgBox!.x + dlgBox!.width).toBeLessThanOrEqual(vp.width);
      await expectNoHorizontalScroll(page);
      await page.keyboard.press("Escape");

      // Profile (user menu) fits too.
      await page.getByRole("button", { name: /user menu/i }).click();
      await page.getByRole("menuitem").first().click();
      const profile = page.getByRole("dialog");
      await expect(profile).toBeVisible();
      const profileBox = await profile.boundingBox();
      expect(profileBox!.x + profileBox!.width).toBeLessThanOrEqual(vp.width);
      await page.keyboard.press("Escape");

      // My commissions page: no horizontal page scroll either.
      await page.goto("/app/my-commissions");
      await expect(page.locator("main")).toBeVisible();
      await expectNoHorizontalScroll(page);
    });
  });
}
