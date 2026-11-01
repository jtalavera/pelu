import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { DEMO_EMAIL, loginAsDemo } from "../fixtures/auth";
import { apiBaseUrl, authHeaders, loginAsDemoApi } from "../fixtures/api";
import { openProfessionalMoreOptions } from "../fixtures/catalog";

/**
 * Issue #38 · Acceso al sistema para profesionales
 *  1. Access always needs a valid email — on every path (create, edit, clear email, API).
 *  2. Changing the email of a professional with access warns, moves the access to the new email
 *     (new invitation) and deactivates the old-email user; without access, the old user is deactivated.
 *  3. An email belongs to one user; a user to one professional.
 *  4. "System access status" line: no access / invitation sent / password created (+ expired, pending save).
 *  5. "Resend invitation" button: pending invitations only, new 48 h link, once every 2 minutes.
 */

const PASSWORD = "ValidPass1!";
const base = apiBaseUrl();

type Prof = {
  id: number;
  fullName: string;
  email: string | null;
  systemAccessAllowed: boolean;
  hasUserAccount: boolean;
  accessStatus: string | null;
  accessLoginEmail: string | null;
  invitationSentAt: string | null;
  invitationExpiresAt: string | null;
  resendAvailableAt: string | null;
};

function uniqueEmail(prefix: string): string {
  return `${prefix}${Date.now()}${Math.floor(Math.random() * 1000)}@test.com`;
}

async function createProfessional(
  request: APIRequestContext,
  token: string,
  fullName: string,
  email: string | null,
  systemAccessAllowed = false,
): Promise<Prof> {
  const res = await request.post(`${base}/api/professionals`, {
    headers: authHeaders(token),
    data: { fullName, email, systemAccessAllowed },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()) as Prof;
}

async function getProfessional(request: APIRequestContext, token: string, id: number): Promise<Prof> {
  const res = await request.get(`${base}/api/professionals`, { headers: authHeaders(token) });
  expect(res.ok()).toBeTruthy();
  const all = (await res.json()) as Prof[];
  const p = all.find((x) => x.id === id);
  if (!p) throw new Error(`professional ${id} not found`);
  return p;
}

/** Issues a fresh invitation through the explicit grant endpoint and activates it. */
async function grantAndActivate(request: APIRequestContext, token: string, id: number): Promise<void> {
  const grant = await request.post(`${base}/api/professionals/${id}/grant-access`, {
    headers: authHeaders(token),
  });
  expect(grant.ok(), await grant.text()).toBeTruthy();
  const { rawToken } = (await grant.json()) as { rawToken: string };
  const activate = await request.post(`${base}/api/auth/activate`, {
    data: { token: rawToken, password: PASSWORD, confirmPassword: PASSWORD },
  });
  expect(activate.ok(), await activate.text()).toBeTruthy();
}

async function loginStatus(request: APIRequestContext, email: string): Promise<number> {
  const res = await request.post(`${base}/api/auth/login`, { data: { email, password: PASSWORD } });
  return res.status();
}

/** Shifts the professional's latest invitation back in time (test-support endpoint, e2e profile only). */
async function backdateInvitation(
  request: APIRequestContext,
  token: string,
  id: number,
  seconds: number,
): Promise<void> {
  const res = await request.post(
    `${base}/api/admin/professional-access-test-support/${id}/backdate-invitation/${seconds}`,
    { headers: authHeaders(token) },
  );
  expect(res.ok(), await res.text()).toBeTruthy();
}

async function openEditDetails(page: Page, prof: { id: number; fullName: string }) {
  await page.goto("/app/professionals");
  // Wait for the debounced, filtered page so the row doesn't re-render under the click.
  const filtered = page.waitForResponse(
    (r) => r.url().includes("/api/professionals/page") && r.url().includes("q="),
  );
  await page.locator("#professionals-inline-search").fill(prof.fullName);
  await filtered;
  await expect(page.getByTestId(`prof-row-${prof.id}`)).toBeVisible({ timeout: 20_000 });
  await page.getByTestId(`prof-row-${prof.id}`).click();
  const dlg = page.getByRole("dialog");
  await openProfessionalMoreOptions(page);
  await expect(dlg.locator("#prof-system-access")).toBeVisible();
  return dlg;
}

async function saveDetails(page: Page) {
  await page.getByRole("dialog").getByTestId("prof-save").click();
}

const statusText = (page: Page) => page.getByRole("dialog").getByTestId("prof-access-status-text");

test.describe("Issue #38 · Acceso al sistema para profesionales", () => {
  // ── 1. email required ──────────────────────────────────────────────────────────────────────

  test("1 · sin email válido el toggle de acceso no se puede activar", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/professionals");
    await page.getByRole("button", { name: "+ New professional" }).click();
    const dlg = page.getByRole("dialog");
    await openProfessionalMoreOptions(page);
    await dlg.getByLabel("Full name").fill(`E2E I38 NoMail ${Date.now()}`);
    const toggle = dlg.locator("#prof-system-access");
    await expect(toggle).toBeDisabled();
    await expect(dlg.getByText(/Enter a valid email \(e\.g\. ana@salon\.com\) to enable system access/)).toBeVisible();

    await dlg.locator("#prof-email").fill("not-an-email");
    await expect(toggle).toBeDisabled();
    await dlg.locator("#prof-email").fill(uniqueEmail("i38ok"));
    await expect(toggle).toBeEnabled();
  });

  test("1 · tildar acceso y luego borrar el email: al guardar muestra error y no guarda", async ({ page, request }) => {
    await loginAsDemo(page);
    await page.goto("/app/professionals");
    await page.getByRole("button", { name: "+ New professional" }).click();
    const dlg = page.getByRole("dialog");
    await openProfessionalMoreOptions(page);
    const name = `E2E I38 Clear ${Date.now()}`;
    await dlg.getByLabel("Full name").fill(name);
    await dlg.locator("#prof-email").fill(uniqueEmail("i38clear"));
    await dlg.locator("#prof-system-access").check();
    await dlg.locator("#prof-email").fill("");
    await saveDetails(page);
    await expect(dlg.locator("#prof-email-err")).toContainText(/no email configured/i);
    await expect(dlg.locator("#prof-email")).toHaveAttribute("aria-invalid", "true");

    // Nothing was created.
    const token = await loginAsDemoApi(request);
    const res = await request.get(`${base}/api/professionals`, { headers: authHeaders(token) });
    const all = (await res.json()) as Prof[];
    expect(all.some((p) => p.fullName === name.toUpperCase())).toBeFalsy();
  });

  test("1 · profesional con acceso: borrar el email y guardar es rechazado", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    const email = uniqueEmail("i38keep");
    const prof = await createProfessional(request, token, `E2E I38 Keep ${Date.now()}`, email, true);
    await loginAsDemo(page);
    const dlg = await openEditDetails(page, prof);
    await dlg.locator("#prof-email").fill("");
    await saveDetails(page);
    await expect(dlg.locator("#prof-email-err")).toContainText(/no email configured/i);
    const after = await getProfessional(request, token, prof.id);
    expect(after.email).toBe(email);
    expect(after.systemAccessAllowed).toBeTruthy();
  });

  test("1 · la API rechaza habilitar el acceso sin email en todos los caminos", async ({ request }) => {
    const token = await loginAsDemoApi(request);
    const name = `E2E I38 Api ${Date.now()}`;
    const create = await request.post(`${base}/api/professionals`, {
      headers: authHeaders(token),
      data: { fullName: name, email: null, systemAccessAllowed: true },
    });
    expect(create.status()).toBe(400);
    expect(await create.text()).toContain("PROFESSIONAL_EMAIL_REQUIRED_FOR_ACCESS");

    const prof = await createProfessional(request, token, name, null);
    const update = await request.put(`${base}/api/professionals/${prof.id}`, {
      headers: authHeaders(token),
      data: { fullName: name, email: null, systemAccessAllowed: true },
    });
    expect(update.status()).toBe(400);
    const grant = await request.post(`${base}/api/professionals/${prof.id}/grant-access`, {
      headers: authHeaders(token),
    });
    expect(grant.status()).toBe(400);
    const invalid = await request.put(`${base}/api/professionals/${prof.id}`, {
      headers: authHeaders(token),
      data: { fullName: name, email: "nope", systemAccessAllowed: true },
    });
    expect(invalid.status()).toBe(400);
    expect(await invalid.text()).toContain("PROFESSIONAL_EMAIL_INVALID_FOR_ACCESS");
    expect((await getProfessional(request, token, prof.id)).systemAccessAllowed).toBeFalsy();
  });

  // ── 2. email change ────────────────────────────────────────────────────────────────────────

  test("2 · cambiar el mail con acceso activo: advierte, reenvía la invitación al nuevo mail y el anterior deja de acceder", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const oldEmail = uniqueEmail("i38old");
    const prof = await createProfessional(request, token, `E2E I38 Move ${Date.now()}`, oldEmail);
    await grantAndActivate(request, token, prof.id);
    expect(await loginStatus(request, oldEmail)).toBe(200);

    await loginAsDemo(page);
    const dlg = await openEditDetails(page, prof);
    const newEmail = uniqueEmail("i38new");
    await dlg.locator("#prof-email").fill(newEmail);
    const warning = dlg.getByTestId("prof-email-change-warning");
    await expect(warning).toContainText(oldEmail);
    await expect(warning).toContainText(newEmail);
    await expect(warning).toContainText(/enrollment again/i);

    await saveDetails(page);
    const confirm = page.getByRole("dialog", { name: "Change the sign-in email?" });
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "Change email" }).click();
    // Catalog redesign: saving an edit closes the form and a notice confirms it on the list.
    await expect(page.getByRole("alert").filter({ hasText: "Changes saved successfully." })).toBeVisible();

    const after = await getProfessional(request, token, prof.id);
    expect(after.email).toBe(newEmail);
    expect(after.accessStatus).toBe("INVITATION_SENT");
    expect(after.hasUserAccount).toBeFalsy();
    // The old email can no longer sign in; the new one can once it completes the enrollment.
    expect(await loginStatus(request, oldEmail)).toBe(401);
    await grantAndActivate(request, token, prof.id);
    expect(await loginStatus(request, newEmail)).toBe(200);
    expect(await loginStatus(request, oldEmail)).toBe(401);
  });

  test("2 · cancelar el diálogo de cambio de mail no guarda nada", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    const oldEmail = uniqueEmail("i38cancel");
    const prof = await createProfessional(request, token, `E2E I38 Cancel ${Date.now()}`, oldEmail, true);
    await loginAsDemo(page);
    const dlg = await openEditDetails(page, prof);
    await dlg.locator("#prof-email").fill(uniqueEmail("i38other"));
    await saveDetails(page);
    const confirm = page.getByRole("dialog", { name: "Change the sign-in email?" });
    await confirm.getByRole("button", { name: "Cancel" }).click();
    await expect(confirm).toHaveCount(0);
    expect((await getProfessional(request, token, prof.id)).email).toBe(oldEmail);
  });

  test("2 · cambiar el mail sin acceso activo: se permite y el usuario anterior queda inactivo", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const oldEmail = uniqueEmail("i38off");
    const name = `E2E I38 Off ${Date.now()}`;
    const prof = await createProfessional(request, token, name, oldEmail);
    await grantAndActivate(request, token, prof.id);
    // Access is turned off first (user disabled, but still tied to the old email).
    const off = await request.put(`${base}/api/professionals/${prof.id}`, {
      headers: authHeaders(token),
      data: { fullName: name, email: oldEmail, systemAccessAllowed: false },
    });
    expect(off.ok()).toBeTruthy();
    expect((await off.json() as Prof).hasUserAccount).toBeTruthy();

    await loginAsDemo(page);
    const dlg = await openEditDetails(page, prof);
    await dlg.locator("#prof-email").fill(uniqueEmail("i38off2"));
    await expect(dlg.getByTestId("prof-email-change-warning")).toContainText(/will be deactivated|is deactivated/i);
    await saveDetails(page);
    await page.getByRole("dialog", { name: "Change the sign-in email?" }).getByRole("button", { name: "Change email" }).click();
    // Catalog redesign: saving an edit closes the form and a notice confirms it on the list.
    await expect(page.getByRole("alert").filter({ hasText: "Changes saved successfully." })).toBeVisible();

    const after = await getProfessional(request, token, prof.id);
    expect(after.accessStatus).toBe("NO_ACCESS");
    expect(after.hasUserAccount).toBeFalsy();
    expect(await loginStatus(request, oldEmail)).toBe(401);
  });

  // ── 3. uniqueness ──────────────────────────────────────────────────────────────────────────

  test("3 · el email de otro usuario (el admin) no puede usarse para el acceso de una profesional", async ({
    page,
  }) => {
    await loginAsDemo(page);
    await page.goto("/app/professionals");
    await page.getByRole("button", { name: "+ New professional" }).click();
    const dlg = page.getByRole("dialog");
    await openProfessionalMoreOptions(page);
    await dlg.getByLabel("Full name").fill(`E2E I38 Dup ${Date.now()}`);
    await dlg.locator("#prof-email").fill(DEMO_EMAIL);
    await dlg.locator("#prof-system-access").check();
    await saveDetails(page);
    await expect(dlg.locator("#prof-email-err")).toContainText(/already belongs to another user/i);
  });

  test("3 · un usuario está vinculado a una sola profesional: otra no puede tomar su email", async ({ request }) => {
    const token = await loginAsDemoApi(request);
    const email = uniqueEmail("i38one");
    const first = await createProfessional(request, token, `E2E I38 First ${Date.now()}`, email);
    await grantAndActivate(request, token, first.id);
    // Professional emails are unique among professionals...
    const dup = await request.post(`${base}/api/professionals`, {
      headers: authHeaders(token),
      data: { fullName: `E2E I38 Second ${Date.now()}`, email, systemAccessAllowed: true },
    });
    expect(dup.status()).toBe(409);
    expect(await dup.text()).toContain("PROFESSIONAL_EMAIL_DUPLICATE");
  });

  // ── 4. status line ─────────────────────────────────────────────────────────────────────────

  test("4 · la línea de estatus recorre Sin acceso → Invitación enviada → Contraseña creada", async ({
    page,
    request,
  }) => {
    await loginAsDemo(page);
    await page.goto("/app/professionals");
    await page.getByRole("button", { name: "+ New professional" }).click();
    const dlg = page.getByRole("dialog");
    await openProfessionalMoreOptions(page);
    const name = `E2E I38 Status ${Date.now()}`;
    const email = uniqueEmail("i38status");
    await dlg.getByLabel("Full name").fill(name);
    await expect(dlg.getByTestId("prof-access-status")).toContainText("System access status:");
    await expect(statusText(page)).toHaveText("No access");

    await dlg.locator("#prof-email").fill(email);
    await dlg.locator("#prof-system-access").check();
    await expect(statusText(page)).toHaveText("An invitation will be sent when you save");
    await saveDetails(page);
    // Catalog redesign: saving a new professional closes the form and shows the success message.
    await expect(dlg).toBeHidden({ timeout: 20_000 });
    await expect(page.getByText("Professional saved successfully.", { exact: true })).toBeVisible();

    const token = await loginAsDemoApi(request);
    const all = (await (await request.get(`${base}/api/professionals`, { headers: authHeaders(token) })).json()) as Prof[];
    const prof = all.find((p) => p.fullName === name.toUpperCase())!;

    // Reopened: invitation sent.
    const dlgInvited = await openEditDetails(page, prof);
    await expect(statusText(page)).toHaveText("Invitation sent, please open the link to create the password");

    // Unticking (without saving) shows "No access" again.
    await dlgInvited.locator("#prof-system-access").uncheck();
    await expect(statusText(page)).toHaveText("No access");
    await page.keyboard.press("Escape");

    // Password created → ready to sign in with her email.
    await grantAndActivate(request, token, prof.id);
    await page.keyboard.press("Escape");
    const dlg2 = await openEditDetails(page, prof);
    await expect(dlg2.getByTestId("prof-access-status-text")).toHaveText(
      `Password created, the user is ready to sign in with ${email} and the password they created`,
    );
  });

  test("4 · invitación vencida (48 h) se muestra como vencida y se puede reenviar", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    const prof = await createProfessional(request, token, `E2E I38 Exp ${Date.now()}`, uniqueEmail("i38exp"), true);
    await backdateInvitation(request, token, prof.id, 49 * 3600);
    await loginAsDemo(page);
    const dlg = await openEditDetails(page, prof);
    await expect(statusText(page)).toHaveText(/Invitation expired/);
    await expect(dlg.getByTestId("prof-access-resend")).toBeEnabled();
  });

  // ── 5. resend ──────────────────────────────────────────────────────────────────────────────

  test("5 · reenviar invitación: solo con invitación pendiente, cada 2 minutos, y el link anterior deja de valer", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const email = uniqueEmail("i38resend");
    const grant = await createProfessional(request, token, `E2E I38 Resend ${Date.now()}`, email);
    const first = await request.post(`${base}/api/professionals/${grant.id}/grant-access`, {
      headers: authHeaders(token),
    });
    const { rawToken: oldToken } = (await first.json()) as { rawToken: string };

    await loginAsDemo(page);
    let dlg = await openEditDetails(page, grant);
    const resend = dlg.getByTestId("prof-access-resend");
    // Just sent: visible but disabled, with a countdown (≤ 2:00).
    await expect(resend).toBeVisible();
    await expect(resend).toBeDisabled();
    await expect(dlg.getByTestId("prof-access-resend-wait")).toContainText(/You can resend in [0-2]:\d\d/);
    // The backend enforces the same rule.
    const tooSoon = await request.post(`${base}/api/professionals/${grant.id}/resend-access`, {
      headers: authHeaders(token),
    });
    expect(tooSoon.status()).toBe(429);
    expect(await tooSoon.text()).toContain("ACTIVATION_RESEND_TOO_SOON");

    // Unticking the access hides the button.
    await dlg.locator("#prof-system-access").uncheck();
    await expect(resend).toHaveCount(0);
    await page.keyboard.press("Escape");

    // Two minutes later the button works and issues a new 48 h link.
    await backdateInvitation(request, token, grant.id, 121);
    dlg = await openEditDetails(page, grant);
    await expect(dlg.getByTestId("prof-access-resend")).toBeEnabled();
    await dlg.getByTestId("prof-access-resend").click();
    await expect(dlg.getByTestId("prof-access-message")).toContainText(`A new invitation was sent to ${email}`);
    await expect(dlg.getByTestId("prof-access-resend")).toBeDisabled();
    const after = await getProfessional(request, token, grant.id);
    expect(after.accessStatus).toBe("INVITATION_SENT");
    expect(new Date(after.invitationExpiresAt!).getTime() - new Date(after.invitationSentAt!).getTime()).toBe(
      48 * 3600 * 1000,
    );
    // The previous link is no longer valid.
    const oldLink = await request.get(`${base}/api/auth/validate-activation-token?token=${oldToken}`);
    expect(oldLink.ok()).toBeFalsy();
  });

  test("5 · sin botón de reenvío cuando ya creó la contraseña o no tiene acceso", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    const active = await createProfessional(request, token, `E2E I38 Active ${Date.now()}`, uniqueEmail("i38act"));
    await grantAndActivate(request, token, active.id);
    const none = await createProfessional(request, token, `E2E I38 None ${Date.now()}`, uniqueEmail("i38none"));

    await loginAsDemo(page);
    let dlg = await openEditDetails(page, active);
    await expect(statusText(page)).toHaveText(/Password created/);
    await expect(dlg.getByTestId("prof-access-resend")).toHaveCount(0);
    await page.keyboard.press("Escape");
    dlg = await openEditDetails(page, none);
    await expect(statusText(page)).toHaveText("No access");
    await expect(dlg.getByTestId("prof-access-resend")).toHaveCount(0);

    const res = await request.post(`${base}/api/professionals/${active.id}/resend-access`, {
      headers: authHeaders(token),
    });
    expect(res.status()).toBe(409);
    expect(await res.text()).toContain("PROFESSIONAL_ACCESS_ALREADY_ACTIVE");
  });
});
