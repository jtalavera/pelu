import { expect, test } from "@playwright/test";
import { loginAsDemo } from "../fixtures/auth";
import { apiBaseUrl } from "../fixtures/api";

/** Creates a professional via the API and returns their id. */
async function createProfessional(
  token: string,
  name: string,
  email: string | null = null,
): Promise<number> {
  const res = await fetch(`${apiBaseUrl()}/api/professionals`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ fullName: name, email }),
  });
  if (!res.ok) throw new Error(`Create professional failed: ${res.status}`);
  const data = (await res.json()) as { id: number };
  return data.id;
}

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

test.describe("HU-23 · Acceso al sistema para profesionales", () => {
  test("HU-23 · 1 campo system access visible en el formulario de detalles", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/professionals");
    await page.getByRole("button", { name: "+ New professional" }).click();
    const dlg = page.getByRole("dialog");
    await expect(dlg.locator("#prof-system-access")).toBeVisible();
  });

  test("HU-23 · 3 habilitar acceso sin email muestra error", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/professionals");
    const name = `E2E NoEmail ${Date.now()}`;
    await page.getByRole("button", { name: "+ New professional" }).click();
    const dlg = page.getByRole("dialog");
    await dlg.getByLabel("Full name").fill(name);
    // Enable access without email
    await dlg.locator("#prof-system-access").check();
    await dlg.getByRole("button", { name: "Save and set schedule" }).click();
    await expect(dlg.getByText(/no email configured/i)).toBeVisible();
  });

  test("HU-23 · 4 habilitar acceso con email envía activation token (dev)", async ({ page, request }) => {
    const base = apiBaseUrl();
    const token = await adminToken(base);
    const name = `E2E WithEmail ${Date.now()}`;
    const email = `prof${Date.now()}@test.com`;
    const profId = await createProfessional(token, name, email);

    // Grant access via API
    const grantRes = await request.post(`${base}/api/professionals/${profId}/grant-access`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(grantRes.ok()).toBeTruthy();
    const grantData = await grantRes.json() as { rawToken: string; emailSent: boolean };
    expect(grantData.rawToken).toBeTruthy();
    expect(typeof grantData.rawToken).toBe("string");
  });

  test("HU-23 · 5+6 token de activación es válido y vinculado a la profesional", async ({ page, request }) => {
    const base = apiBaseUrl();
    const token = await adminToken(base);
    const name = `E2E TokenVal ${Date.now()}`;
    const email = `tokenval${Date.now()}@test.com`;
    const profId = await createProfessional(token, name, email);

    const grantRes = await request.post(`${base}/api/professionals/${profId}/grant-access`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const { rawToken } = await grantRes.json() as { rawToken: string };

    // Validate the token
    const validateRes = await request.get(`${base}/api/auth/validate-activation-token?token=${rawToken}`);
    expect(validateRes.ok()).toBeTruthy();
    const info = await validateRes.json() as { professionalId: number; professionalName: string; email: string };
    expect(info.professionalId).toBe(profId);
    expect(info.professionalName).toBe(name);
    expect(info.email).toBe(email);
  });

  test("HU-23 · 7 formulario de creación de contraseña se muestra con token válido", async ({ page, request }) => {
    const base = apiBaseUrl();
    const token = await adminToken(base);
    const name = `E2E FormShow ${Date.now()}`;
    const email = `formshow${Date.now()}@test.com`;
    const profId = await createProfessional(token, name, email);

    const grantRes = await request.post(`${base}/api/professionals/${profId}/grant-access`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const { rawToken } = await grantRes.json() as { rawToken: string };

    await page.goto(`/activate?token=${rawToken}`);
    await expect(page.getByRole("heading", { name: /Set your password/i })).toBeVisible();
    await expect(page.locator("#activate-password")).toBeVisible();
    await expect(page.locator("#activate-confirm-password")).toBeVisible();
  });

  test("HU-23 · 8 contraseña débil es rechazada", async ({ page, request }) => {
    const base = apiBaseUrl();
    const token = await adminToken(base);
    const name = `E2E WeakPwd ${Date.now()}`;
    const email = `weakpwd${Date.now()}@test.com`;
    const profId = await createProfessional(token, name, email);

    const grantRes = await request.post(`${base}/api/professionals/${profId}/grant-access`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const { rawToken } = await grantRes.json() as { rawToken: string };

    await page.goto(`/activate?token=${rawToken}`);
    await page.locator("#activate-password").fill("weak");
    await page.locator("#activate-confirm-password").fill("weak");
    await page.getByRole("button", { name: "Set password" }).click();
    await expect(page.getByText(/at least 8 characters/i)).toBeVisible();
  });

  test("HU-23 · 9 contraseñas que no coinciden son rechazadas", async ({ page, request }) => {
    const base = apiBaseUrl();
    const token = await adminToken(base);
    const name = `E2E MismatchPwd ${Date.now()}`;
    const email = `mismatch${Date.now()}@test.com`;
    const profId = await createProfessional(token, name, email);

    const grantRes = await request.post(`${base}/api/professionals/${profId}/grant-access`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const { rawToken } = await grantRes.json() as { rawToken: string };

    await page.goto(`/activate?token=${rawToken}`);
    await page.locator("#activate-password").fill("ValidPass1!");
    await page.locator("#activate-confirm-password").fill("DifferentPass1!");
    await page.getByRole("button", { name: "Set password" }).click();
    await expect(page.getByText(/do not match/i)).toBeVisible();
  });

  test("HU-23 · 10 activación exitosa crea usuario y muestra mensaje de éxito", async ({ page, request }) => {
    const base = apiBaseUrl();
    const token = await adminToken(base);
    const name = `E2E ActivateOK ${Date.now()}`;
    const email = `activateok${Date.now()}@test.com`;
    const profId = await createProfessional(token, name, email);

    const grantRes = await request.post(`${base}/api/professionals/${profId}/grant-access`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const { rawToken } = await grantRes.json() as { rawToken: string };

    await page.goto(`/activate?token=${rawToken}`);
    await page.locator("#activate-password").fill("ValidPass1!");
    await page.locator("#activate-confirm-password").fill("ValidPass1!");
    await page.getByRole("button", { name: "Set password" }).click();
    await expect(page.getByText(/Password set successfully/i)).toBeVisible();
  });

  test("HU-23 · 12 token de activación es de un solo uso", async ({ page, request }) => {
    const base = apiBaseUrl();
    const token = await adminToken(base);
    const name = `E2E OneUse ${Date.now()}`;
    const email = `oneuse${Date.now()}@test.com`;
    const profId = await createProfessional(token, name, email);

    const grantRes = await request.post(`${base}/api/professionals/${profId}/grant-access`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const { rawToken } = await grantRes.json() as { rawToken: string };

    // First activation
    await page.goto(`/activate?token=${rawToken}`);
    await page.locator("#activate-password").fill("ValidPass1!");
    await page.locator("#activate-confirm-password").fill("ValidPass1!");
    await page.getByRole("button", { name: "Set password" }).click();
    await expect(page.getByText(/Password set successfully/i)).toBeVisible();

    // Try to reuse the same token
    await page.goto(`/activate?token=${rawToken}`);
    await expect(page.getByText(/invalid or has already been used/i)).toBeVisible();
  });

  test("HU-23 · 5 token inválido muestra error", async ({ page }) => {
    await page.goto("/activate?token=invalid-token-xyz");
    await expect(page.getByText(/invalid or has already been used/i)).toBeVisible();
  });

  test("HU-23 · 14+15 revocar acceso deshabilita el login de la profesional", async ({ page, request }) => {
    const base = apiBaseUrl();
    const token = await adminToken(base);
    const name = `E2E Revoke ${Date.now()}`;
    const email = `revoke${Date.now()}@test.com`;
    const profId = await createProfessional(token, name, email);

    // Grant access and activate
    const grantRes = await request.post(`${base}/api/professionals/${profId}/grant-access`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const { rawToken } = await grantRes.json() as { rawToken: string };

    const activateRes = await request.post(`${base}/api/auth/activate`, {
      data: { token: rawToken, password: "ValidPass1!", confirmPassword: "ValidPass1!" },
    });
    expect(activateRes.ok()).toBeTruthy();

    // Professional can log in
    const loginRes = await request.post(`${base}/api/auth/login`, {
      data: { email, password: "ValidPass1!" },
    });
    expect(loginRes.ok()).toBeTruthy();

    // Revoke access
    const revokeRes = await request.post(`${base}/api/professionals/${profId}/revoke-access`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(revokeRes.ok()).toBeTruthy();

    // Professional can no longer log in
    const loginAfterRes = await request.post(`${base}/api/auth/login`, {
      data: { email, password: "ValidPass1!" },
    });
    expect(loginAfterRes.status()).toBe(401);
  });
});
