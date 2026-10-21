import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { DEMO_PASSWORD, loginAsDemo } from "../fixtures/auth";
import {
  apiBaseUrl,
  apiPostJson,
  authHeaders,
  calendarVisibleWeekSlotIso,
  createAppointmentApi,
  loginAsDemoApi,
  seedCategoryServiceProfessional,
} from "../fixtures/api";

/**
 * HU-66 · Ingreso con PIN en un dispositivo compartido — every acceptance criterion, on a phone
 * and on a tablet where the screen matters. (Criterion 16, PINs set before HU-66, is covered by the
 * backend integration test: it needs a row without the new hash, which the API can't produce.)
 */

const base = apiBaseUrl();
const DEVICE_HEADER = "X-Femme-Device";
const DEVICE_STORAGE_KEY = "femme.sharedDevice";

type Device = { deviceId: number; name: string; tenantName: string; token: string };
type Pro = { id: number; fullName: string };

const VIEWPORTS = [
  { name: "celular", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
] as const;

function uniq(): string {
  return `${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

/** A random 4–6 digit PIN unlikely to collide with other specs' PINs in the demo tenant. */
function randomPin(): string {
  return String(100000 + Math.floor(Math.random() * 899999));
}

async function createPro(
  request: APIRequestContext,
  admin: string,
  pin: string | null,
  name = `E2E Pin ${uniq()}`,
): Promise<Pro> {
  return apiPostJson<Pro>(request, admin, "/api/professionals", { fullName: name, pin, email: null });
}

async function activateDevice(request: APIRequestContext, admin: string, name = `Tablet ${uniq()}`) {
  const res = await apiPostJson<{
    device: { id: number; name: string };
    deviceToken: string;
    tenantName: string;
  }>(request, admin, "/api/shared-devices", { name, password: DEMO_PASSWORD });
  return {
    deviceId: res.device.id,
    name: res.device.name,
    tenantName: res.tenantName,
    token: res.deviceToken,
  } satisfies Device;
}

/** Puts the device credential in the browser, as Configuración does after enabling it. */
async function useDevice(page: Page, device: Device) {
  await page.addInitScript(
    ([key, value]) => {
      localStorage.setItem(key, value);
      localStorage.setItem("cursor_poc.i18n.language", "en");
      localStorage.setItem("femme.tour.seen.calendar", "true");
    },
    [DEVICE_STORAGE_KEY, JSON.stringify(device)] as const,
  );
}

async function pinLoginApi(request: APIRequestContext, device: Device, professionalId: number, pin: string) {
  return request.post(`${base}/api/shared-device/pin-login`, {
    headers: { [DEVICE_HEADER]: device.token, "Content-Type": "application/json" },
    data: { professionalId, pin },
  });
}

async function typePin(page: Page, pin: string) {
  const pad = page.getByTestId("pin-pad");
  for (const d of pin) {
    await pad.getByRole("button", { name: d, exact: true }).click();
  }
  await page.getByTestId("pin-submit").click();
}

async function expectTouchTarget(page: Page, locator: ReturnType<Page["locator"]>) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.width).toBeGreaterThanOrEqual(44);
}

test.describe("HU-66 · Ingreso con PIN en un dispositivo compartido", () => {
  // ── Activación, revocación (1–3) ─────────────────────────────────────────────────────────

  test("1+2+3 · el admin habilita el dispositivo desde Configuración (con su contraseña), lo ve listado y abre la selección", async ({
    page,
  }) => {
    await loginAsDemo(page);
    await page.goto("/app/settings/devices");
    const form = page.getByTestId("activate-shared-device-form");
    await form.locator("#shared-device-name").fill(`Recepción ${uniq()}`);
    await form.locator("#shared-device-password").fill("not-my-password");
    await page.getByTestId("activate-shared-device").click();
    await expect(page.locator("#shared-device-password-err")).toContainText(/Wrong password/);

    await form.locator("#shared-device-password").fill(DEMO_PASSWORD);
    await page.getByTestId("activate-shared-device").click();
    await expect(page.getByTestId("this-device-active")).toBeVisible();
    const stored = await page.evaluate((k) => localStorage.getItem(k), DEVICE_STORAGE_KEY);
    const device = JSON.parse(stored!) as Device;
    await expect(page.getByTestId(`shared-device-row-${device.deviceId}`)).toContainText("(this device)");

    await page.getByTestId("open-shared-device").click();
    await expect(page).toHaveURL(/\/device$/);
    await expect(page.getByTestId("shared-device-name")).toContainText(device.name);
  });

  test("2+3 · la credencial sola no da acceso a datos; un dispositivo revocado vuelve al login", async ({
    page,
    request,
  }) => {
    const admin = await loginAsDemoApi(request);
    const device = await activateDevice(request, admin);
    const onlyDevice = await request.get(`${base}/api/appointments?from=2026-01-01T00:00:00Z&to=2026-01-02T00:00:00Z`, {
      headers: { [DEVICE_HEADER]: device.token },
    });
    expect([401, 403]).toContain(onlyDevice.status());

    const revoke = await request.post(`${base}/api/shared-devices/${device.deviceId}/revoke`, {
      headers: authHeaders(admin),
    });
    expect(revoke.status()).toBe(204);
    await useDevice(page, device);
    await page.goto("/device");
    await expect(page).toHaveURL(/\/login/);
    expect(await page.evaluate((k) => localStorage.getItem(k), DEVICE_STORAGE_KEY)).toBeNull();
  });

  test("4 · la selección muestra solo profesionales activas con PIN, sin datos de contacto", async ({
    page,
    request,
  }) => {
    const admin = await loginAsDemoApi(request);
    const withPin = await createPro(request, admin, randomPin());
    const withoutPin = await createPro(request, admin, null);
    const inactive = await createPro(request, admin, randomPin());
    await request.post(`${base}/api/professionals/${inactive.id}/deactivate`, { headers: authHeaders(admin) });
    const device = await activateDevice(request, admin);

    const picker = await request.get(`${base}/api/shared-device/session`, {
      headers: { [DEVICE_HEADER]: device.token },
    });
    expect(picker.ok()).toBeTruthy();
    const body = (await picker.json()) as { professionals: Array<Record<string, unknown>> };
    const ids = body.professionals.map((p) => p.id);
    expect(ids).toContain(withPin.id);
    expect(ids).not.toContain(withoutPin.id);
    expect(ids).not.toContain(inactive.id);
    expect(Object.keys(body.professionals[0]).sort()).toEqual(["fullName", "id", "lockedUntil", "photoDataUrl"]);

    await useDevice(page, device);
    await page.goto("/device");
    await expect(page.getByTestId(`shared-device-professional-${withPin.id}`)).toBeVisible();
    await expect(page.getByTestId(`shared-device-professional-${withoutPin.id}`)).toHaveCount(0);
    await expect(page.getByTestId(`shared-device-professional-${inactive.id}`)).toHaveCount(0);
  });

  // ── Ingreso con PIN, solo calendario (5–9, 17, 22) — celular y tablet ─────────────────────

  for (const vp of VIEWPORTS) {
    test.describe(`en ${vp.name} (${vp.width}×${vp.height})`, () => {
      test.use({ viewport: { width: vp.width, height: vp.height }, hasTouch: true });

      test("5–9+17+22 · teclado de PIN, ingreso con PIN (sin email), solo calendario y 'Cambiar de profesional'", async ({
        page,
        request,
      }) => {
        const admin = await loginAsDemoApi(request);
        const pin = randomPin();
        const pro = await createPro(request, admin, pin); // no email, no "Acceso al sistema" (22)
        const device = await activateDevice(request, admin);
        await useDevice(page, device);
        await page.goto("/device");

        const card = page.getByTestId(`shared-device-professional-${pro.id}`);
        await expectTouchTarget(page, card);
        await card.click();
        const pad = page.getByTestId("pin-pad");
        await expect(pad).toBeVisible();
        // 5 · big keys, masked digits.
        await expectTouchTarget(page, pad.getByRole("button", { name: "5", exact: true }));
        await expectTouchTarget(page, page.getByTestId("pin-submit"));
        await pad.getByRole("button", { name: "1", exact: true }).click();
        await pad.getByRole("button", { name: "2", exact: true }).click();
        await expect(page.getByTestId("pin-dots")).toHaveAttribute("data-length", "2");
        await expect(page.getByTestId("pin-dots")).toHaveText("");
        await page.getByRole("button", { name: "Delete last digit" }).click();
        await page.getByRole("button", { name: "Delete last digit" }).click();

        // 6 · right PIN → calendar.
        await typePin(page, pin);
        await expect(page).toHaveURL(/\/app\/calendar/);
        await expect(page.getByRole("button", { name: /today/i })).toBeVisible();
        const scroll = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
        expect(scroll[0]).toBeLessThanOrEqual(scroll[1]);

        // 9 · her name and "Cambiar de profesional" are visible.
        await expect(page.getByTestId("pin-session-name").first()).toContainText(pro.fullName.toUpperCase());
        await expectTouchTarget(page, page.getByTestId("switch-professional"));

        // 7 · calendar only: no "Mis comisiones", no profile / password menu; URLs bounce.
        await expect(page.getByRole("button", { name: /user menu/i })).toHaveCount(0);
        await page.goto("/app/my-commissions");
        await expect(page).toHaveURL(/\/app\/calendar/);
        await page.goto("/app/billing");
        await expect(page).toHaveURL(/\/app\/calendar/);

        // 7 + 17 · the backend agrees; and the session is useless off this device.
        const token = await page.evaluate(() => sessionStorage.getItem("accessToken"));
        const withDevice = { Authorization: `Bearer ${token}`, [DEVICE_HEADER]: device.token, "Content-Type": "application/json" };
        expect((await request.get(`${base}/api/professionals`, { headers: withDevice })).status()).toBe(200);
        expect((await request.get(`${base}/api/commissions/me`, { headers: withDevice })).status()).toBe(403);
        expect((await request.put(`${base}/api/me/profile`, { headers: withDevice, data: {} })).status()).toBe(403);
        expect(
          (await request.post(`${base}/api/me/change-password`, { headers: withDevice, data: {} })).status(),
        ).toBe(403);
        const offDevice = await request.get(`${base}/api/professionals`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        expect([401, 403]).toContain(offDevice.status());

        // 19 · "Cambiar de profesional" → back to the picker, device mode kept.
        await page.getByTestId("switch-professional").click();
        await expect(page).toHaveURL(/\/device$/);
        await expect(page.getByTestId(`shared-device-professional-${pro.id}`)).toBeVisible();
        expect(await page.evaluate(() => sessionStorage.getItem("accessToken"))).toBeNull();
      });

      test("8+10+12+13 · PIN incorrecto: error genérico, intentos restantes, bloqueo y desbloqueo por el admin", async ({
        page,
        request,
        browser,
      }) => {
        const admin = await loginAsDemoApi(request);
        const pin = randomPin();
        const pro = await createPro(request, admin, pin);
        const device = await activateDevice(request, admin);
        await useDevice(page, device);
        await page.goto("/device");
        await page.getByTestId(`shared-device-professional-${pro.id}`).click();

        const wrong = pin === "0000" ? "1111" : "0000";
        for (const remaining of [4, 3, 2, 1]) {
          await typePin(page, wrong);
          await expect(page.getByTestId("pin-error")).toHaveText(
            remaining === 1
              ? "Wrong PIN. 1 attempt left before it locks for 15 minutes."
              : `Wrong PIN. ${remaining} attempts left before it locks for 15 minutes.`,
          );
        }
        await typePin(page, wrong);
        await expect(page.getByTestId("pin-error")).toContainText(/Too many wrong PINs: locked until/);
        await page.keyboard.press("Escape");
        // 10 · shown as locked in the picker and not selectable.
        await expect(page.getByTestId(`shared-device-locked-${pro.id}`)).toContainText(/Locked until/);
        await expect(page.getByTestId(`shared-device-professional-${pro.id}`)).toBeDisabled();
        // Even the right PIN is refused (API).
        const refused = await pinLoginApi(request, device, pro.id, pin);
        expect(refused.status()).toBe(423);

        // 15 · a professional cannot unlock.
        const okLogin = await createPro(request, admin, randomPin());
        void okLogin;
        const otherPin = randomPin();
        const other = await createPro(request, admin, otherPin);
        const otherSession = (await (await pinLoginApi(request, device, other.id, otherPin)).json()) as {
          accessToken: string;
        };
        const proUnlock = await request.post(`${base}/api/professionals/${pro.id}/unlock-pin`, {
          headers: { Authorization: `Bearer ${otherSession.accessToken}`, [DEVICE_HEADER]: device.token },
        });
        expect(proUnlock.status()).toBe(403);

        // 12 + 13 · the admin sees the lock in her profile and lifts it.
        const adminPage = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
        await loginAsDemo(adminPage);
        await adminPage.goto("/app/professionals");
        const filtered = adminPage.waitForResponse(
          (r) => r.url().includes("/api/professionals/page") && r.url().includes("q="),
        );
        await adminPage.locator("#professionals-inline-search").fill(pro.fullName);
        await filtered;
        await adminPage.getByTestId(`professionals-row-${pro.id}-trigger`).click();
        await adminPage.getByRole("menuitem", { name: "Edit details and photo" }).click();
        const lockedAlert = adminPage.getByTestId("prof-pin-locked");
        await expect(lockedAlert).toContainText(device.name);
        await adminPage.getByTestId("prof-pin-unlock").click();
        await expect(adminPage.getByTestId("prof-pin-unlocked")).toBeVisible();
        await expect(lockedAlert).toHaveCount(0);
        await adminPage.close();

        await page.reload();
        await page.getByTestId(`shared-device-professional-${pro.id}`).click();
        await typePin(page, pin);
        await expect(page).toHaveURL(/\/app\/calendar/);
      });
    });
  }

  // ── Bloqueo por dispositivo y expiración (10, 11, 14) ──────────────────────────────────────

  test("11+14 · 20 intentos fallidos bloquean el dispositivo; el admin lo desbloquea desde Configuración", async ({
    page,
    request,
  }) => {
    const admin = await loginAsDemoApi(request);
    const pros = await Promise.all([0, 1, 2, 3, 4].map(() => createPro(request, admin, randomPin())));
    const device = await activateDevice(request, admin);
    let last = 0;
    for (let i = 0; i < 20; i++) {
      last = (await pinLoginApi(request, device, pros[i % 5].id, "0000")).status();
    }
    expect(last).toBe(423);

    await useDevice(page, device);
    await page.goto("/device");
    await expect(page.getByTestId("shared-device-locked")).toContainText(/locked on this device until/);

    // The admin unlocks it from Configuración → Dispositivos compartidos (in another session).
    const ctx = await page.context().browser()!.newContext();
    const adminPage = await ctx.newPage();
    await loginAsDemo(adminPage);
    await adminPage.goto("/app/settings/devices");
    await expect(adminPage.getByTestId(`shared-device-row-locked-${device.deviceId}`)).toBeVisible();
    await adminPage.getByTestId(`shared-device-unlock-${device.deviceId}`).click();
    await expect(adminPage.getByTestId(`shared-device-row-locked-${device.deviceId}`)).toHaveCount(0);
    await ctx.close();

    await page.reload();
    await expect(page.getByTestId("shared-device-locked")).toHaveCount(0);
  });

  test("10 · el bloqueo se levanta solo al cumplirse los 15 minutos", async ({ request }) => {
    const admin = await loginAsDemoApi(request);
    const pin = randomPin();
    const pro = await createPro(request, admin, pin);
    const device = await activateDevice(request, admin);
    for (let i = 0; i < 5; i++) await pinLoginApi(request, device, pro.id, "0000");
    expect((await pinLoginApi(request, device, pro.id, pin)).status()).toBe(423);
    const expire = await request.post(
      `${base}/api/admin/shared-device-test-support/${device.deviceId}/expire-locks`,
      { headers: authHeaders(admin) },
    );
    expect(expire.ok()).toBeTruthy();
    expect((await pinLoginApi(request, device, pro.id, pin)).status()).toBe(200);
  });

  // ── Fin de la sesión (19–21) ──────────────────────────────────────────────────────────────

  test("20 · tras 5 minutos sin actividad vuelve a la selección", async ({ page, request }) => {
    const admin = await loginAsDemoApi(request);
    const pin = randomPin();
    const pro = await createPro(request, admin, pin);
    const device = await activateDevice(request, admin);
    await page.clock.install();
    await useDevice(page, device);
    await page.goto("/device");
    await page.getByTestId(`shared-device-professional-${pro.id}`).click();
    await typePin(page, pin);
    await expect(page).toHaveURL(/\/app\/calendar/);
    await page.clock.fastForward("04:30");
    await expect(page).toHaveURL(/\/app\/calendar/);
    await page.clock.fastForward("00:40");
    await expect(page).toHaveURL(/\/device$/);
  });

  /** Triggers an API call from the calendar; a background refresh may already have redirected. */
  async function nudgeCalendar(page: Page) {
    await page
      .getByRole("button", { name: /next/i })
      .first()
      .click({ timeout: 3_000 })
      .catch(() => undefined);
  }

  test("21 · cambiar el PIN o desactivar a la profesional corta su sesión abierta", async ({ page, request }) => {
    const admin = await loginAsDemoApi(request);
    const pin = randomPin();
    const pro = await createPro(request, admin, pin);
    const salon = await seedCategoryServiceProfessional(request, admin);
    await createAppointmentApi(request, admin, {
      clientId: null,
      professionalId: salon.professionalId,
      serviceId: salon.serviceId,
      startAt: calendarVisibleWeekSlotIso(10, 0),
    });
    const device = await activateDevice(request, admin);
    await useDevice(page, device);
    await page.goto("/device");
    await page.getByTestId(`shared-device-professional-${pro.id}`).click();
    await typePin(page, pin);
    await expect(page).toHaveURL(/\/app\/calendar/);

    // The admin changes her PIN → her next action takes the device back to the picker.
    const put = await request.put(`${base}/api/professionals/${pro.id}`, {
      headers: authHeaders(admin),
      data: { fullName: pro.fullName, pin: randomPin() },
    });
    expect(put.ok()).toBeTruthy();
    await nudgeCalendar(page);
    await expect(page).toHaveURL(/\/device$/);

    // Same when she is deactivated.
    const pin2 = randomPin();
    const pro2 = await createPro(request, admin, pin2);
    await page.reload();
    await page.getByTestId(`shared-device-professional-${pro2.id}`).click();
    await typePin(page, pin2);
    await expect(page).toHaveURL(/\/app\/calendar/);
    await request.post(`${base}/api/professionals/${pro2.id}/deactivate`, { headers: authHeaders(admin) });
    await nudgeCalendar(page);
    await expect(page).toHaveURL(/\/device$/);
  });

  // ── Auditoría (18) y login normal (23) ────────────────────────────────────────────────────

  test("18 · ingresos con PIN, bloqueos y activación quedan en la auditoría", async ({ request }) => {
    const admin = await loginAsDemoApi(request);
    const pin = randomPin();
    const pro = await createPro(request, admin, pin);
    const device = await activateDevice(request, admin);
    await pinLoginApi(request, device, pro.id, pin);
    for (let i = 0; i < 5; i++) await pinLoginApi(request, device, pro.id, "0000");
    const res = await request.get(`${base}/api/audit?resource=shared-device&size=100`, {
      headers: authHeaders(admin),
    });
    expect(res.ok()).toBeTruthy();
    const rows = ((await res.json()) as { content: Array<{ operation: string; statusCode: number; userEmail: string }> })
      .content.filter((r) => r.userEmail.includes(`professional-${pro.id}@device-${device.deviceId}`));
    expect(rows.some((r) => r.operation === "pin-login" && r.statusCode === 200)).toBeTruthy();
    expect(rows.some((r) => r.operation === "pin-login" && r.statusCode === 401)).toBeTruthy();
    expect(rows.some((r) => r.operation === "pin-lock" && r.statusCode === 423)).toBeTruthy();
    const activations = await request.get(`${base}/api/audit?resource=shared-devices&size=100`, {
      headers: authHeaders(admin),
    });
    const act = (await activations.json()) as { content: Array<{ httpMethod: string }> };
    expect(act.content.some((r) => r.httpMethod === "POST")).toBeTruthy();
  });

  test("23 · desde la selección, un admin ingresa con email y contraseña y al salir vuelve a la selección", async ({
    page,
    request,
  }) => {
    const admin = await loginAsDemoApi(request);
    const device = await activateDevice(request, admin);
    await useDevice(page, device);
    await page.goto("/device");
    await page.getByRole("link", { name: "Sign in with email and password" }).click();
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByTestId("login-back-to-shared-device")).toBeVisible();
    await page.getByLabel("Email").fill("isabelzymanscki@gmail.com");
    await page.getByLabel("Password").fill(DEMO_PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByRole("link", { name: "Dashboard", exact: true })).toBeVisible();
    // A normal admin session: full menu, no "Cambiar de profesional".
    await expect(page.getByTestId("switch-professional")).toHaveCount(0);
    await page.getByRole("button", { name: /user menu/i }).click();
    await page.getByRole("menuitem", { name: /sign out|log out/i }).click();
    await expect(page).toHaveURL(/\/device$/);
  });
});
