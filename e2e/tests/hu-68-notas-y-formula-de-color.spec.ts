import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import {
  API_BASE,
  apiGetJson,
  apiPostJson,
  authHeaders,
  calendarVisibleWeekSlotIso,
  createAppointmentApi,
  loginAsDemoApi,
  seedCategoryServiceProfessional,
} from "../fixtures/api";
import { DEMO_PASSWORD, loginAs, loginAsDemo } from "../fixtures/auth";
import { PASSWORD, professionalWithAccess } from "../fixtures/commissions";
import { pickSearchableOption } from "../fixtures/ui";

/**
 * HU-68 · Notas y fórmula de color de la cliente ("Ficha técnica"): editable by the admin from the
 * client profile and by professionals from the calendar (appointment detail + form), the
 * professional's "Clients" menu and PIN sessions — without exposing any other personal data.
 */
test.describe.configure({ mode: "serial" });

type Client = { id: number; fullName: string; phone: string | null };

function uniq(): string {
  return `${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

/** A unique 09XX phone, so the AC12 "search by phone" probe can't match some other client. */
function uniquePhone(): string {
  return `0981${String(Date.now()).slice(-6)}`;
}

async function seedClientWithPhone(
  request: APIRequestContext,
  token: string,
  name: string,
): Promise<Client> {
  return apiPostJson<Client>(request, token, "/api/clients", {
    fullName: name,
    phone: uniquePhone(),
    email: `hu68-${uniq()}@test.com`,
    ruc: null,
  });
}

async function setSheet(
  request: APIRequestContext,
  token: string,
  clientId: number,
  body: { notes: string | null; colorFormula: string | null },
) {
  const res = await request.put(`${API_BASE}/api/clients/${clientId}/technical-sheet`, {
    headers: authHeaders(token),
    data: body,
  });
  expect(res.ok(), await res.text()).toBeTruthy();
}

async function loginToken(request: APIRequestContext, email: string): Promise<string> {
  const res = await request.post(`${API_BASE}/api/auth/login`, { data: { email, password: PASSWORD } });
  expect(res.ok(), await res.text()).toBeTruthy();
  return ((await res.json()) as { accessToken: string }).accessToken;
}

/** Picks an option of the calendar's professional filter (a searchable combobox). */
async function pickCalendarFilter(page: Page, label: string): Promise<void> {
  const filter = page.locator("#prof-filter");
  await filter.click();
  await filter.fill(label);
  await page.getByRole("option", { name: label, exact: true }).click();
  await expect(filter).toHaveValue(label);
}

test.describe("HU-68 · Notas y fórmula de color de la cliente", () => {
  test("AC1–AC5 · el admin edita la ficha técnica desde la ficha de la cliente", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const client = await seedClientWithPhone(request, token, `E2E68 Admin ${uniq()}`);
    // "Edited by" shows the admin's full name, or the email when the user has none — other specs
    // may change the shared demo admin, so read what the backend will stamp.
    const me = await apiGetJson<{ fullName: string | null; email: string }>(request, token, "/api/me");
    const editorName = me.fullName ?? me.email;

    await loginAsDemo(page);
    // HU-70: the technical sheet has its own tab in the client profile.
    await page.goto(`/app/clients/${client.id}?tab=sheet`);
    const sheet = page.getByTestId("client-technical-sheet");
    await expect(page.getByRole("heading", { name: "Technical sheet" })).toBeVisible();

    // AC4: never edited → no "Edited by".
    await expect(sheet.getByTestId("technical-sheet-notes-edited")).toHaveText("");
    const notes = sheet.getByLabel("Notes");
    const formula = sheet.getByLabel("Color formula");
    await notes.fill("Prefiere café sin azúcar");
    await formula.fill("7.1 + 7.43 (1:1) · 20 vol · 35 min");
    // AC1: counter.
    await expect(sheet.getByText("24 / 2000 characters")).toBeVisible();
    await sheet.getByRole("button", { name: "Save technical sheet" }).click();
    await expect(sheet.getByText("Technical sheet saved.")).toBeVisible();
    // AC4: who and when.
    await expect(sheet.getByTestId("technical-sheet-notes-edited")).toContainText(
      `Edited by ${editorName} · `,
    );
    await expect(sheet.getByTestId("technical-sheet-color-formula-edited")).toContainText(
      `Edited by ${editorName} · `,
    );

    // AC5: saved independently of the basic-data form, persisted after reload.
    await page.reload();
    await expect(sheet.getByLabel("Notes")).toHaveValue("Prefiere café sin azúcar");
    await expect(sheet.getByLabel("Color formula")).toHaveValue("7.1 + 7.43 (1:1) · 20 vol · 35 min");

    // AC2: one single note — saving replaces it.
    await sheet.getByLabel("Notes").fill("Ahora prefiere té");
    await sheet.getByRole("button", { name: "Save technical sheet" }).click();
    await expect(sheet.getByText("Technical sheet saved.")).toBeVisible();
    await page.reload();
    await expect(sheet.getByLabel("Notes")).toHaveValue("Ahora prefiere té");

    // AC5: Cancel discards pending edits.
    await sheet.getByLabel("Notes").fill("cambio sin guardar");
    await sheet.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(sheet.getByLabel("Notes")).toHaveValue("Ahora prefiere té");
  });

  test("AC3 · más de 2000 caracteres: error de campo en la UI y 400 en la API", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const client = await seedClientWithPhone(request, token, `E2E68 Largo ${uniq()}`);

    await loginAsDemo(page);
    // HU-70: the technical sheet has its own tab in the client profile.
    await page.goto(`/app/clients/${client.id}?tab=sheet`);
    const sheet = page.getByTestId("client-technical-sheet");
    await sheet.getByLabel("Notes").fill("x".repeat(2001));
    const err = sheet.locator("#technical-sheet-notes-err");
    await expect(err).toHaveText("Maximum 2000 characters. Shorten the text to save it.");
    await expect(err).toHaveAttribute("role", "alert");
    await expect(sheet.getByLabel("Notes")).toHaveAttribute("aria-invalid", "true");
    await expect(sheet.getByRole("button", { name: "Save technical sheet" })).toBeDisabled();

    const tooLong = "x".repeat(2001);
    for (const [body, code] of [
      [{ notes: tooLong, colorFormula: null }, "CLIENT_NOTES_TOO_LONG"],
      [{ notes: null, colorFormula: tooLong }, "CLIENT_COLOR_FORMULA_TOO_LONG"],
    ] as const) {
      const res = await request.put(`${API_BASE}/api/clients/${client.id}/technical-sheet`, {
        headers: authHeaders(token),
        data: body,
      });
      expect(res.status()).toBe(400);
      expect(await res.text()).toContain(code);
    }
  });

  test("AC6, AC7, AC8, AC10, AC11 · la profesional ve y edita la ficha técnica desde el calendario", async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    const token = await loginAsDemoApi(request);
    const salon = await seedCategoryServiceProfessional(request, token);
    const pro = await professionalWithAccess(request, token, `E2E68 Pro ${uniq()}`);
    const own = await seedClientWithPhone(request, token, `E2E68 Propia ${uniq()}`);
    const other = await seedClientWithPhone(request, token, `E2E68 Ajena ${uniq()}`);
    await setSheet(request, token, own.id, { notes: "Alergia al amoníaco", colorFormula: "6.0 + 20 vol" });
    await setSheet(request, token, other.id, { notes: "Cliente de otra profesional", colorFormula: null });
    const ownAppt = await createAppointmentApi(request, token, {
      clientId: own.id,
      professionalId: pro.id,
      serviceId: salon.serviceId,
      startAt: calendarVisibleWeekSlotIso(10, 0),
    });
    const otherAppt = await createAppointmentApi(request, token, {
      clientId: other.id,
      professionalId: salon.professionalId,
      serviceId: salon.serviceId,
      startAt: calendarVisibleWeekSlotIso(15, 0),
    });
    const proName = (
      (await (await request.get(`${API_BASE}/api/professionals`, { headers: authHeaders(token) })).json()) as Array<{
        id: number;
        fullName: string;
      }>
    ).find((p) => p.id === pro.id)!.fullName;

    await loginAs(page, pro.email, PASSWORD);
    await page.goto("/app/calendar?view=week");
    await expect(page.getByRole("button", { name: /today/i })).toBeVisible();

    // AC6: own appointment → "Technical sheet".
    await page.getByTestId(`calendar-appt-${ownAppt.id}`).click();
    await page.getByRole("button", { name: "Technical sheet", exact: true }).click();
    const sheetDialog = page.getByRole("dialog", { name: "Technical sheet" });
    const sheet = sheetDialog.getByTestId("client-technical-sheet");
    await expect(sheet.getByTestId("technical-sheet-client-name")).toHaveText(own.fullName);
    await expect(sheet.getByLabel("Notes")).toHaveValue("Alergia al amoníaco");
    await expect(sheet.getByLabel("Color formula")).toHaveValue("6.0 + 20 vol");
    // AC10: nothing personal.
    await expect(sheetDialog).not.toContainText(own.phone!);
    await expect(sheetDialog).not.toContainText("@test.com");

    // AC11: she edits; "Edited by" shows her name.
    await sheet.getByLabel("Color formula").fill("6.0 + 6.1 · 30 vol");
    await sheet.getByRole("button", { name: "Save technical sheet" }).click();
    await expect(sheet.getByText("Technical sheet saved.")).toBeVisible();
    await expect(sheet.getByTestId("technical-sheet-color-formula-edited")).toContainText(
      `Edited by ${proName} · `,
    );
    await sheet.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(sheetDialog).toHaveCount(0);
    // The appointment detail below is still open.
    await expect(page.getByRole("dialog", { name: "Appointment detail" })).toBeVisible();
    await page.getByRole("dialog", { name: "Appointment detail" }).getByRole("button", { name: "Close", exact: true }).last().click();

    // AC7: another professional's appointment (read-only) still opens the sheet.
    await pickCalendarFilter(page, salon.professionalFullName);
    await page.getByTestId(`calendar-appt-${otherAppt.id}`).click();
    await expect(page.getByTestId("appointment-read-only-notice")).toBeVisible();
    await page.getByRole("button", { name: "Technical sheet", exact: true }).click();
    await expect(
      page.getByRole("dialog", { name: "Technical sheet" }).getByLabel("Notes"),
    ).toHaveValue("Cliente de otra profesional");
    await page.keyboard.press("Escape");
    await page.getByRole("dialog", { name: "Appointment detail" }).getByRole("button", { name: "Close", exact: true }).last().click();

    // AC8: from the appointment form, once a client is chosen, without losing the form.
    await page.getByRole("button", { name: "New appointment" }).first().click();
    const form = page.getByRole("dialog", { name: "New appointment" });
    await expect(form.getByRole("button", { name: "View technical sheet" })).toHaveCount(0);
    await pickSearchableOption(page, "Client", own.fullName, new RegExp(own.fullName));
    await form.getByRole("button", { name: "View technical sheet" }).click();
    await expect(
      page.getByRole("dialog", { name: "Technical sheet" }).getByLabel("Color formula"),
    ).toHaveValue("6.0 + 6.1 · 30 vol");
    await page.getByRole("dialog", { name: "Technical sheet" }).getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(form).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Client", exact: true })).toHaveValue(own.fullName);
  });

  test("AC9 · menú Clientes de la profesional: búsqueda por nombre y ficha técnica", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const pro = await professionalWithAccess(request, token, `E2E68 Menu ${uniq()}`);
    const client = await seedClientWithPhone(request, token, `E2E68 Menu Cliente ${uniq()}`);
    await setSheet(request, token, client.id, { notes: "Nota desde el menú", colorFormula: null });

    await loginAs(page, pro.email, PASSWORD);
    await page.goto("/app/calendar?view=week");
    await page.getByRole("link", { name: "Clients", exact: true }).click();
    await expect(page).toHaveURL(/\/app\/clients$/);
    // Search by name, submitted with Enter.
    const search = page.getByLabel("Search by name");
    await search.fill(client.fullName);
    await search.press("Enter");
    const list = page.getByTestId("professional-clients-list");
    await expect(list.getByRole("link")).toHaveCount(1);
    // Names only — no phone column.
    await expect(list).not.toContainText(client.phone!);
    await list.getByRole("link", { name: client.fullName }).click();
    await expect(page).toHaveURL(new RegExp(`/app/clients/${client.id}/technical-sheet$`));
    await expect(page.getByTestId("client-technical-sheet").getByLabel("Notes")).toHaveValue(
      "Nota desde el menú",
    );
    // No create / deactivate / basic data on this screen.
    await expect(page.getByRole("button", { name: /deactivate/i })).toHaveCount(0);
    await expect(page.getByLabel("Phone")).toHaveCount(0);

    // The full profile URL redirects to the technical sheet.
    await page.goto(`/app/clients/${client.id}`);
    await expect(page).toHaveURL(new RegExp(`/app/clients/${client.id}/technical-sheet$`));
  });

  test("AC10, AC12 · backend: sin datos personales para la profesional", async ({ request }) => {
    const token = await loginAsDemoApi(request);
    const pro = await professionalWithAccess(request, token, `E2E68 Api ${uniq()}`);
    const client = await seedClientWithPhone(request, token, `E2E68 Api Cliente ${uniq()}`);
    const proToken = await loginToken(request, pro.email);
    const headers = authHeaders(proToken);

    expect((await request.get(`${API_BASE}/api/clients/${client.id}`, { headers })).status()).toBe(403);
    expect(
      (
        await request.put(`${API_BASE}/api/clients/${client.id}`, {
          headers,
          data: { fullName: "X", phone: null, email: null, ruc: null },
        })
      ).status(),
    ).toBe(403);

    const sheet = await request.get(`${API_BASE}/api/clients/${client.id}/technical-sheet`, { headers });
    expect(sheet.status()).toBe(200);
    const sheetBody = await sheet.text();
    expect(sheetBody).not.toContain(client.phone!);
    expect(sheetBody).not.toContain("@test.com");

    // List: id + name only, and the query never matches the phone.
    const byName = await request.get(
      `${API_BASE}/api/clients?q=${encodeURIComponent(client.fullName)}`,
      { headers },
    );
    const rows = (await byName.json()) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0].fullName).toBe(client.fullName);
    for (const field of ["phone", "email", "ruc", "identityDocumentNumber", "address"]) {
      expect(rows[0][field] ?? null, field).toBeNull();
    }
    const byPhone = await request.get(`${API_BASE}/api/clients?q=${client.phone}`, { headers });
    expect((await byPhone.json()) as unknown[]).toHaveLength(0);
  });

  test("AC13 · sesión por PIN: ficha técnica desde el turno, sin menú Clientes", async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    const admin = await loginAsDemoApi(request);
    const salon = await seedCategoryServiceProfessional(request, admin);
    const pin = String(100000 + Math.floor(Math.random() * 899999));
    const pro = await apiPostJson<{ id: number; fullName: string }>(request, admin, "/api/professionals", {
      fullName: `E2E68 Pin ${uniq()}`,
      pin,
      email: null,
    });
    const client = await seedClientWithPhone(request, admin, `E2E68 Pin Cliente ${uniq()}`);
    await setSheet(request, admin, client.id, { notes: "Nota en la tablet", colorFormula: null });
    const appt = await createAppointmentApi(request, admin, {
      clientId: client.id,
      professionalId: pro.id,
      serviceId: salon.serviceId,
      startAt: calendarVisibleWeekSlotIso(11, 0),
    });
    const device = await apiPostJson<{ device: { id: number; name: string }; deviceToken: string; tenantName: string }>(
      request,
      admin,
      "/api/shared-devices",
      { name: `Tablet ${uniq()}`, password: DEMO_PASSWORD },
    );
    await page.addInitScript(
      ([key, value]) => {
        localStorage.setItem(key, value);
        localStorage.setItem("cursor_poc.i18n.language", "en");
        localStorage.setItem("femme.tour.seen.calendar", "true");
      },
      [
        "femme.sharedDevice",
        JSON.stringify({
          deviceId: device.device.id,
          name: device.device.name,
          tenantName: device.tenantName,
          token: device.deviceToken,
        }),
      ] as const,
    );
    await page.goto("/device");
    await page.getByTestId(`shared-device-professional-${pro.id}`).click();
    const pad = page.getByTestId("pin-pad");
    for (const d of pin) await pad.getByRole("button", { name: d, exact: true }).click();
    await page.getByTestId("pin-submit").click();
    await expect(page).toHaveURL(/\/app\/calendar/);

    // No "Clients" menu in a PIN session, and the URL bounces to the calendar.
    await expect(page.getByRole("link", { name: "Clients", exact: true })).toHaveCount(0);

    await page.getByTestId(`calendar-appt-${appt.id}`).click();
    await page.getByRole("button", { name: "Technical sheet", exact: true }).click();
    const sheet = page.getByRole("dialog", { name: "Technical sheet" }).getByTestId("client-technical-sheet");
    await expect(sheet.getByLabel("Notes")).toHaveValue("Nota en la tablet");
    await sheet.getByLabel("Notes").fill("Editada desde la tablet");
    await sheet.getByRole("button", { name: "Save technical sheet" }).click();
    await expect(sheet.getByText("Technical sheet saved.")).toBeVisible();
    await expect(sheet.getByTestId("technical-sheet-notes-edited")).toContainText(`Edited by ${pro.fullName} · `);

    await page.goto("/app/clients");
    await expect(page).toHaveURL(/\/app\/calendar/);
  });

  test("AC14, AC15 · cliente inexistente en el tenant (404) y cliente inactiva solo lectura (409)", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    expect(
      (await request.get(`${API_BASE}/api/clients/99999999/technical-sheet`, { headers: authHeaders(token) })).status(),
    ).toBe(404);

    const client = await seedClientWithPhone(request, token, `E2E68 Inactiva ${uniq()}`);
    await setSheet(request, token, client.id, { notes: "Nota previa", colorFormula: null });
    const deact = await request.post(`${API_BASE}/api/clients/${client.id}/deactivate`, {
      headers: authHeaders(token),
    });
    expect(deact.ok(), await deact.text()).toBeTruthy();

    const put = await request.put(`${API_BASE}/api/clients/${client.id}/technical-sheet`, {
      headers: authHeaders(token),
      data: { notes: "no debería guardarse", colorFormula: null },
    });
    expect(put.status()).toBe(409);
    expect(await put.text()).toContain("CLIENT_INACTIVE");

    await loginAsDemo(page);
    // HU-70: the technical sheet has its own tab in the client profile.
    await page.goto(`/app/clients/${client.id}?tab=sheet`);
    const sheet = page.getByTestId("client-technical-sheet");
    await expect(
      sheet.getByText("This client is inactive: the technical sheet can be viewed but not edited."),
    ).toBeVisible();
    await expect(sheet.getByLabel("Notes")).toHaveValue("Nota previa");
    await expect(sheet.getByLabel("Notes")).toBeDisabled();
    await expect(sheet.getByRole("button", { name: "Save technical sheet" })).toHaveCount(0);
  });
});
