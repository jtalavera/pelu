import { expect, test } from "@playwright/test";
import { loginAs } from "../fixtures/auth";
import { apiBaseUrl } from "../fixtures/api";

/** Gets an admin JWT for direct API calls. */
async function adminToken(baseUrl: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@demo.com", password: "Demo123!" }),
  });
  const data = (await res.json()) as { accessToken: string };
  return data.accessToken;
}

/** Creates a professional, grants access, activates with given password. Returns professionalId. */
async function setupProfessionalWithAccess(
  base: string,
  name: string,
  email: string,
  password: string,
): Promise<number> {
  const token = await adminToken(base);

  const createRes = await fetch(`${base}/api/professionals`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ fullName: name, email }),
  });
  if (!createRes.ok) throw new Error(`Create professional failed: ${createRes.status}`);
  const { id: profId } = (await createRes.json()) as { id: number };

  const grantRes = await fetch(`${base}/api/professionals/${profId}/grant-access`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!grantRes.ok) throw new Error(`Grant access failed: ${grantRes.status}`);
  const { rawToken } = (await grantRes.json()) as { rawToken: string };

  const activateRes = await fetch(`${base}/api/auth/activate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: rawToken, password, confirmPassword: password }),
  });
  if (!activateRes.ok) throw new Error(`Activate failed: ${activateRes.status}`);

  return profId;
}

test.describe("HU-24 · Vista del profesional logueado", () => {
  test("HU-24 · 1+2 profesional puede iniciar sesión y el sistema detecta su rol", async ({ page, request }) => {
    const base = apiBaseUrl();
    const email = `hu24login${Date.now()}@test.com`;
    await setupProfessionalWithAccess(base, `E2E Login ${Date.now()}`, email, "ValidPass1!");

    await loginAs(page, email, "ValidPass1!");
    // Professional role redirects to /app/calendar
    await expect(page).toHaveURL(/\/app\/calendar/);
  });

  test("HU-24 · 3 calendario visible tras iniciar sesión como profesional", async ({ page }) => {
    const base = apiBaseUrl();
    const email = `hu24cal${Date.now()}@test.com`;
    await setupProfessionalWithAccess(base, `E2E Cal ${Date.now()}`, email, "ValidPass1!");

    await loginAs(page, email, "ValidPass1!");
    await expect(page).toHaveURL(/\/app\/calendar/);
    // Calendar content visible
    await expect(page.locator("[data-testid='calendar'], .fc, [class*='calendar']").first()).toBeVisible();
  });

  test("HU-24 · 5 selector de profesional no disponible para rol profesional", async ({ page }) => {
    const base = apiBaseUrl();
    const email = `hu24nofilt${Date.now()}@test.com`;
    await setupProfessionalWithAccess(base, `E2E NoFilt ${Date.now()}`, email, "ValidPass1!");

    await loginAs(page, email, "ValidPass1!");
    await page.goto("/app/calendar");
    // The professional filter SearchableSelect should not be rendered
    await expect(page.getByLabel(/professional/i)).not.toBeVisible();
  });

  test("HU-24 · 12 sin acceso al módulo de gestión de profesionales", async ({ page }) => {
    const base = apiBaseUrl();
    const email = `hu24noprof${Date.now()}@test.com`;
    await setupProfessionalWithAccess(base, `E2E NoProf ${Date.now()}`, email, "ValidPass1!");

    await loginAs(page, email, "ValidPass1!");
    // Professionals nav item should not be visible
    await expect(page.getByRole("link", { name: /professionals/i })).not.toBeVisible();
  });

  test("HU-24 · 13 sin acceso a módulos administrativos (dashboard, configuración)", async ({ page }) => {
    const base = apiBaseUrl();
    const email = `hu24noadmin${Date.now()}@test.com`;
    await setupProfessionalWithAccess(base, `E2E NoAdmin ${Date.now()}`, email, "ValidPass1!");

    await loginAs(page, email, "ValidPass1!");
    // Dashboard and Settings nav items should not be visible
    await expect(page.getByRole("link", { name: /dashboard/i })).not.toBeVisible();
    await expect(page.getByRole("link", { name: /settings/i })).not.toBeVisible();
  });

  test("HU-24 · 7+8 profesional puede agendar turno con campo profesional fijo", async ({ page, request }) => {
    const base = apiBaseUrl();
    const suffix = Date.now();
    const email = `hu24book${suffix}@test.com`;
    const name = `E2E Book ${suffix}`;
    await setupProfessionalWithAccess(base, name, email, "ValidPass1!");

    await loginAs(page, email, "ValidPass1!");
    await page.goto("/app/calendar");

    // Open new appointment form
    await page.getByRole("button", { name: /new appointment|nuevo turno|\+/i }).first().click();
    const dlg = page.getByRole("dialog");

    // Professional field should be a read-only display (not a searchable select)
    await expect(dlg.locator("[data-testid='professional-readonly'], .professional-readonly, input[readonly][id*='professional']").first()).toBeVisible().catch(async () => {
      // Alternative: the professional select is hidden and a div shows the name
      await expect(dlg.getByText(name)).toBeVisible();
    });

    // The professional SearchableSelect trigger should not be interactable
    const profSelect = dlg.locator("button[id*='professional'], [data-testid='prof-select']");
    await expect(profSelect).not.toBeVisible();
  });

  test("HU-24 · 11 acceso directo a turno de otra profesional devuelve 403", async ({ request }) => {
    const base = apiBaseUrl();
    const token = await adminToken(base);

    // Get an existing appointment that doesn't belong to our professional (use admin to list)
    const apptRes = await request.get(`${base}/api/appointments`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const appts = (await apptRes.json()) as Array<{ id: number }>;

    if (appts.length === 0) {
      // No appointments to test against — skip gracefully
      return;
    }

    // Create a professional and get their JWT
    const email = `hu24deny${Date.now()}@test.com`;
    const profId = await setupProfessionalWithAccess(base, `E2E Deny ${Date.now()}`, email, "ValidPass1!");

    const loginRes = await request.post(`${base}/api/auth/login`, {
      data: { email, password: "ValidPass1!" },
    });
    const { accessToken: profToken } = (await loginRes.json()) as { accessToken: string };

    // Try to fetch the first appointment (likely belongs to another professional or is admin-created)
    const targetId = appts[0].id;
    const denyRes = await request.get(`${base}/api/appointments/${targetId}`, {
      headers: { Authorization: `Bearer ${profToken}` },
    });
    // Should get 403 (or 404) since the appointment belongs to another professional
    expect([403, 404]).toContain(denyRes.status());
  });

  test("HU-24 · 10 profesional no puede reasignar turno propio a otra profesional (API)", async ({ request }) => {
    const base = apiBaseUrl();
    const token = await adminToken(base);
    const suffix = Date.now();

    // Create two professionals
    const email1 = `hu24own${suffix}@test.com`;
    const profId1 = await setupProfessionalWithAccess(base, `E2E Own ${suffix}`, email1, "ValidPass1!");

    const createProf2Res = await request.post(`${base}/api/professionals`, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      data: { fullName: `E2E Other ${suffix}`, email: null },
    });
    const { id: profId2 } = (await createProf2Res.json()) as { id: number };

    // Get prof1's JWT
    const loginRes = await request.post(`${base}/api/auth/login`, {
      data: { email: email1, password: "ValidPass1!" },
    });
    const { accessToken: profToken } = (await loginRes.json()) as { accessToken: string };

    // Try to create an appointment assigned to prof2 using prof1's token
    const apptRes = await request.post(`${base}/api/appointments`, {
      headers: { Authorization: `Bearer ${profToken}`, "Content-Type": "application/json" },
      data: {
        professionalId: profId2,
        serviceId: null,
        clientId: null,
        startAt: new Date(Date.now() + 86400000).toISOString(),
      },
    });
    // Should be rejected with 403
    expect(apptRes.status()).toBe(403);
  });
});
