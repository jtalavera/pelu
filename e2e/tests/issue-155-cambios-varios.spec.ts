import { expect, test } from "@playwright/test";
import {
  API_BASE,
  apiPostJson,
  createAppointmentApi,
  instantToOffsetIso,
  loginAsDemoApi,
  seedCategoryServiceProfessional,
  seedClient,
} from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";
import { goToCatalog } from "../fixtures/catalog";
import { openNewFichaDialog, pickFichaClient, pickLineService } from "../fixtures/fichas";
import { ensureCashSessionOpen, goToBillingHome, goToInvoiceHistory } from "../fixtures/billing";
import { bookingAppointmentDialog, professionalFormDialog } from "../fixtures/ui";

type ClientDto = { id: number; fullName: string };
type ProfessionalDto = { id: number; fullName: string };

test.describe("Issue #155 · Cambios varios", () => {
  test("AC1 · guardar un servicio existente muestra mensaje de éxito", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, token);

    await loginAsDemo(page);
    await goToCatalog(page, "services");
    await page.locator("#services-list-filter").fill(seed.serviceFullName);
    const card = page.getByTestId(`svc-row-${seed.serviceId}`);
    await expect(card).toBeVisible({ timeout: 20_000 });
    await card.click();
    const dlg = page.getByRole("dialog", { name: "Edit service" });
    await dlg.getByRole("button", { name: "Save" }).click();
    // Catalog redesign: saving closes the form and a passing notice confirms it on the list.
    await expect(
      page.getByRole("alert").filter({ hasText: "Changes saved successfully." }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(dlg).toHaveCount(0);
  });

  test("AC1 · guardar una profesional existente muestra mensaje de éxito", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const name = `E2E155 Prof ${Date.now()}`;
    const prof = await apiPostJson<ProfessionalDto>(request, token, "/api/professionals", {
      fullName: name,
      phone: null,
      email: null,
      photoDataUrl: null,
    });

    await loginAsDemo(page);
    await goToCatalog(page, "professionals");
    await page.locator("#professionals-inline-search").fill(prof.fullName);
    const row = page.locator('[data-testid^="prof-row-"]').filter({ hasText: prof.fullName }).first();
    await expect(row).toBeVisible({ timeout: 20_000 });
    await row.click();
    const dlg = professionalFormDialog(page);
    await dlg.getByTestId("prof-save").click();
    // Catalog redesign: saving closes the form and a passing notice confirms it on the list.
    await expect(
      page.getByRole("alert").filter({ hasText: "Changes saved successfully." }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(dlg).toHaveCount(0);
  });

  // AC2 (the client-detail "×" close button) was reverted by issue #157 — see
  // issue-157-ajustes-varios.spec.ts for the regression test confirming its removal.

  test("AC3 · el nombre del cliente se almacena en mayúsculas", async ({ request }) => {
    const token = await loginAsDemoApi(request);
    const lower = `e2e155 lower case client ${Date.now()}`;
    const created = await apiPostJson<ClientDto>(request, token, "/api/clients", {
      fullName: lower,
      phone: null,
      email: null,
      ruc: null,
    });
    expect(created.fullName).toBe(lower.toUpperCase());
  });

  test("AC3 · el nombre de la profesional se almacena en mayúsculas", async ({ request }) => {
    const token = await loginAsDemoApi(request);
    const lower = `e2e155 lower case prof ${Date.now()}`;
    const created = await apiPostJson<ProfessionalDto>(request, token, "/api/professionals", {
      fullName: lower,
      phone: null,
      email: null,
      photoDataUrl: null,
    });
    expect(created.fullName).toBe(lower.toUpperCase());
  });

  test("AC4 · el aviso de éxito de la ficha es pasajero: no queda tras abrir otra vez el formulario", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const client = await seedClient(request, token, `E2E155 Ficha ${Date.now()}`);
    const seed = await seedCategoryServiceProfessional(request, token);

    await loginAsDemo(page);
    const dlg = await openNewFichaDialog(page);
    await pickFichaClient(page, dlg, client.fullName);
    await pickLineService(page, 0, seed.serviceFullName);
    await dlg.getByTestId("service-record-submit").click();

    const toast = page.getByTestId("service-records-toast");
    await expect(toast).toContainText("Record saved.", { timeout: 15_000 });

    // The toast clears itself (4 s) and a freshly opened form never carries a stale message.
    await expect(toast).toHaveCount(0, { timeout: 10_000 });
    await page.getByTestId("service-records-new").click();
    await expect(page.getByText("Record saved.")).toHaveCount(0);
  });

  test("AC5 · el formulario de turno solo muestra clientes activos", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const ts = Date.now();
    const active = await apiPostJson<ClientDto>(request, token, "/api/clients", {
      fullName: `E2E155ActiveCli${ts}`,
      phone: null,
      email: null,
      ruc: null,
    });
    const inactive = await apiPostJson<ClientDto>(request, token, "/api/clients", {
      fullName: `E2E155InactiveCli${ts}`,
      phone: null,
      email: null,
      ruc: null,
    });
    await apiPostJson(request, token, `/api/clients/${inactive.id}/deactivate`, {});

    await loginAsDemo(page);
    await page.goto("/app/calendar?view=week");
    await page.getByRole("button", { name: "New appointment" }).first().click();
    const dlg = bookingAppointmentDialog(page);
    const cb = dlg.getByRole("combobox", { name: "Client", exact: true });
    await cb.click();
    await cb.fill(active.fullName);
    const listbox = page.getByRole("listbox", { name: "Client", exact: true });
    await expect(listbox.getByRole("button", { name: active.fullName, exact: true })).toBeVisible();

    await cb.fill(inactive.fullName);
    await expect(
      listbox.getByRole("button", { name: inactive.fullName, exact: true }),
    ).toHaveCount(0);
  });

  test("AC6 · click en un turno del Panel principal abre su detalle en el Calendario", async ({
    page,
    request,
  }) => {
    // Clean slate: the dashboard's "today's appointments" panel is unpaginated and renders every
    // appointment in the day's range — by the time this runs deep in the full suite, however many
    // other specs' own same-day appointments have accumulated can make the freshly-created row
    // slow enough to find that it exceeds this test's own timeout. Same rationale as issue #216
    // AC3 / issue #223's own resets.
    const resetRes = await request.post(`${API_BASE}/api/admin/seed/reset`);
    expect(resetRes.ok(), await resetRes.text()).toBeTruthy();

    const token = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, token);
    const client = await seedClient(request, token, `E2E155 Dash ${Date.now()}`);
    const now = new Date();
    now.setHours(now.getHours() + 1, 0, 0, 0);
    await createAppointmentApi(request, token, {
      clientId: client.id,
      professionalId: seed.professionalId,
      serviceId: seed.serviceId,
      startAt: instantToOffsetIso(now),
    });

    await loginAsDemo(page);
    const row = page.getByRole("button", { name: new RegExp(client.fullName) });
    await expect(row).toBeVisible({ timeout: 20_000 });
    await row.click();
    await expect(page).toHaveURL(/\/app\/calendar/);
    await expect(page.getByRole("dialog", { name: "Appointment detail" })).toBeVisible({
      timeout: 15_000,
    });
  });

  // Redesign: the "Unnamed invoice" checkbox is gone — an invoice with no client is "No name" by
  // default and shows no identification fields; identifying a client shows them.
  test("AC7 · 'Sin nombre' por defecto oculta los campos de identificación y al identificar un cliente se habilitan", async ({
    page,
  }) => {
    await loginAsDemo(page);
    await ensureCashSessionOpen(page);
    await goToBillingHome(page);
    await page.getByRole("button", { name: "New Invoice" }).click();

    const nameInput = page.locator("#client-display-name");
    const typeSelect = page.locator("#client-identity-document-type");
    const numberInput = page.locator("#client-identity-document-number");

    await expect(page.getByTestId("billing-client-default")).toBeVisible();
    await expect(nameInput).toHaveCount(0);
    await expect(typeSelect).toHaveCount(0);
    await expect(numberInput).toHaveCount(0);

    const search = page.getByLabel("Search or select client");
    await search.click();
    await page.getByRole("button", { name: "Occasional client" }).click();
    await expect(typeSelect).toHaveValue("RUC");
    await expect(nameInput).toBeEnabled();
    await expect(typeSelect).toBeEnabled();
    await expect(numberInput).toBeEnabled();

    // Clearing the search goes back to "No name" and hides the fields again.
    await search.fill("");
    await expect(page.getByTestId("billing-client-default")).toBeVisible();
    await expect(nameInput).toHaveCount(0);
  });
});
