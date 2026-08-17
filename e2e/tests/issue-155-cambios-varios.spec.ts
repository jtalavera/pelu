import { expect, test } from "@playwright/test";
import {
  apiPostJson,
  createAppointmentApi,
  instantToOffsetIso,
  loginAsDemoApi,
  seedCategoryServiceProfessional,
  seedClient,
} from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";
import { ensureCashSessionOpen } from "../fixtures/billing";
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
    await page.goto("/app/services");
    await page.locator("#services-list-filter").fill(seed.serviceFullName);
    const card = page.getByTestId(`svc-row-${seed.serviceId}`);
    await expect(card).toBeVisible({ timeout: 20_000 });
    await card.click();
    const dlg = page.getByRole("dialog", { name: "Edit service" });
    await dlg.getByRole("button", { name: "Save" }).click();
    // Issue #157: the success message shows inside the edit form itself, which stays open.
    await expect(dlg).toBeVisible();
    await expect(
      dlg.getByRole("alert").filter({ hasText: "Changes saved successfully." }),
    ).toBeVisible({ timeout: 10_000 });
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
    await page.goto("/app/professionals");
    await page.locator("#professionals-inline-search").fill(prof.fullName);
    const row = page.locator("tr").filter({ hasText: prof.fullName }).first();
    await expect(row).toBeVisible({ timeout: 20_000 });
    await row.click();
    const dlg = professionalFormDialog(page);
    await dlg.getByRole("button", { name: "Save and set schedule" }).click();
    await dlg.getByRole("button", { name: "Save schedule" }).click();
    // Issue #157: the success message shows inside the edit form itself, which stays open.
    await expect(dlg).toBeVisible();
    await expect(
      dlg.getByRole("alert").filter({ hasText: "Changes saved successfully." }),
    ).toBeVisible({ timeout: 10_000 });
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

  test("AC4 · el mensaje de éxito de la ficha desaparece al cambiar de pestaña y volver a Nueva ficha", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const client = await seedClient(request, token, `E2E155 Ficha ${Date.now()}`);
    const seed = await seedCategoryServiceProfessional(request, token);

    await loginAsDemo(page);
    await page.goto("/app/service-records");
    await page.getByLabel("Search or select client").fill(client.fullName.slice(0, 12));
    await page.getByRole("button", { name: client.fullName }).click();
    await page.getByRole("button", { name: "Add service" }).click();
    await page.locator("#service-record-line-svc-0").fill(seed.serviceFullName.slice(0, 12));
    await page.getByRole("button", { name: seed.serviceFullName, exact: false }).click();
    await page.getByTestId("service-record-submit").click();

    const successAlert = page.getByText("Service record created successfully.", {
      exact: false,
    });
    await expect(successAlert).toBeVisible({ timeout: 15_000 });

    await page.getByRole("tab", { name: "History" }).click();
    await expect(successAlert).not.toBeVisible();
    await page.getByRole("tab", { name: "New record" }).click();
    await expect(successAlert).not.toBeVisible();
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
    await page.goto("/app/calendar");
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

  test("AC7 · checkbox Comprobante sin nominar deshabilita y restaura los campos de identificación", async ({
    page,
  }) => {
    await loginAsDemo(page);
    await ensureCashSessionOpen(page);
    await page.getByRole("tab", { name: "Cash Register" }).click();
    await page.getByRole("button", { name: "New Invoice" }).click();

    const nameInput = page.locator("#client-display-name");
    const typeSelect = page.locator("#client-identity-document-type");
    const numberInput = page.locator("#client-identity-document-number");
    const checkbox = page.getByLabel("Unnamed invoice (no client identified)");

    await expect(typeSelect).toHaveValue("RUC");
    await expect(nameInput).toBeEnabled();
    await expect(typeSelect).toBeEnabled();

    await checkbox.check();
    await expect(typeSelect).toHaveValue("INNOMINADO");
    await expect(nameInput).toBeDisabled();
    await expect(typeSelect).toBeDisabled();
    await expect(numberInput).toBeDisabled();

    await checkbox.uncheck();
    await expect(typeSelect).toHaveValue("RUC");
    await expect(nameInput).toBeEnabled();
    await expect(typeSelect).toBeEnabled();
    await expect(numberInput).toBeEnabled();
  });
});
