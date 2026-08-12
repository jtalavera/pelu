import { expect, test } from "@playwright/test";
import {
  API_BASE,
  apiPostJson,
  apiPutJson,
  ensureCashSessionOpenApi,
  isoDateLocal,
  listFiscalStamps,
  loginAsDemoApi,
  seedClient,
  seedCategoryServiceProfessional,
} from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";

test.describe.configure({ mode: "serial" });

test.describe("HU-02b · Configurar timbrado fiscal", () => {

  test("HU-02b · 2 formulario Add stamp muestra campos del timbrado", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/settings/fiscal-stamp");
    await expect(page.getByText("Add stamp", { exact: true }).first()).toBeVisible();
    await expect(page.getByLabel("Stamp number", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Validity start", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Validity end", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Number from", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Number to", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Starting invoice number", { exact: true })).toBeVisible();
  });

  test("HU-02b · 3 número inicial fuera del rango muestra error", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/settings/fiscal-stamp");
    await page.getByLabel("Stamp number", { exact: true }).fill("87654321");
    const today = new Date();
    const nextYear = new Date(today);
    nextYear.setFullYear(nextYear.getFullYear() + 1);
    await page.getByLabel("Validity start", { exact: true }).fill(isoDateLocal(today));
    await page.getByLabel("Validity end", { exact: true }).fill(isoDateLocal(nextYear));
    await page.getByLabel("Number from", { exact: true }).fill("1");
    await page.getByLabel("Number to", { exact: true }).fill("10");
    await page.getByLabel("Starting invoice number", { exact: true }).fill("99");
    await page.getByRole("button", { name: "Add stamp" }).click();
    await expect(page.getByText(/Must be between 1 and 10 \(inclusive\)/)).toBeVisible();
  });

  test("HU-02b · 4 fin de vigencia anterior al inicio muestra error", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/settings/fiscal-stamp");
    const today = isoDateLocal(new Date());
    await page.getByLabel("Stamp number", { exact: true }).fill("87654322");
    await page.getByLabel("Validity start", { exact: true }).fill(today);
    await page.getByLabel("Validity end", { exact: true }).fill(today);
    await page.getByLabel("Number from", { exact: true }).fill("1");
    await page.getByLabel("Number to", { exact: true }).fill("10");
    await page.getByLabel("Starting invoice number", { exact: true }).fill("1");
    await page.getByRole("button", { name: "Add stamp" }).click();
    await expect(
      page.getByText("The end of validity must be after the start date.", { exact: true }),
    ).toBeVisible();
  });

  test("HU-02b · 5 solo un timbrado activo: al activar otro, el anterior queda inactivo", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const stamps = await listFiscalStamps(request, token);
    const active = stamps.find((s) => s.active);
    expect(active).toBeTruthy();
    const newStamp = await apiPostJson<{ id: number }>(request, token, "/api/fiscal-stamps", {
      stampNumber: `9${Date.now().toString().slice(-7)}`,
      validFrom: active!.validFrom.slice(0, 10),
      validUntil: active!.validUntil.slice(0, 10),
      rangeFrom: 5_000_000,
      rangeTo: 5_000_100,
      initialEmissionNumber: 5_000_000,
    });
    await apiPostJson(request, token, `/api/fiscal-stamps/${newStamp.id}/activate`, {});

    await loginAsDemo(page);
    await page.goto("/app/settings/fiscal-stamp");
    const previousRow = page.getByTestId(`fiscal-stamp-row-${active!.id}`);
    const newRow = page.getByTestId(`fiscal-stamp-row-${newStamp.id}`);
    await expect(newRow.getByText("Active", { exact: true })).toBeVisible();
    await expect(previousRow.getByText("Inactive", { exact: true })).toBeVisible();
  });

  test("HU-02b · 6 alerta de vencimiento en menos de 30 días en el dashboard", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    await apiPutJson(request, token, "/api/business-profile", {
      businessName: "Demo salon",
      ruc: "80000005-6",
      address: null,
      phone: null,
      contactEmail: null,
      logoDataUrl: null,
    });
    const stamps = await listFiscalStamps(request, token);
    for (const s of stamps) {
      await request.post(`${API_BASE}/api/fiscal-stamps/${s.id}/deactivate`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    }
    const from = new Date();
    const until = new Date();
    until.setDate(until.getDate() + 10);
    const created = await apiPostJson<{ id: number }>(request, token, "/api/fiscal-stamps", {
      stampNumber: `8${Date.now().toString().slice(-7)}`,
      validFrom: isoDateLocal(from),
      validUntil: isoDateLocal(until),
      rangeFrom: 2_000_000,
      rangeTo: 2_000_100,
      initialEmissionNumber: 2_000_000,
    });
    await apiPostJson(request, token, `/api/fiscal-stamps/${created.id}/activate`, {});

    await loginAsDemo(page);
    await page.goto("/app");
    await expect(
      page.getByText("Your fiscal stamp (timbrado) expires in less than 30 days.", { exact: true }),
    ).toBeVisible();
  });

  test("HU-02b · 8 botón Edit stamp solo permite cambiar Starting invoice number", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    /** Fresh active stamp stays unlocked (`lockedAfterInvoice === false`) until an invoice ties to it. */
    const todayStr = isoDateLocal(new Date());
    const until = new Date();
    until.setFullYear(until.getFullYear() + 1);
    const stampNumber = `3${Date.now().toString().slice(-7)}`;
    const created = await apiPostJson<{ id: number }>(request, token, "/api/fiscal-stamps", {
      stampNumber,
      validFrom: todayStr,
      validUntil: isoDateLocal(until),
      rangeFrom: 7_500_100,
      rangeTo: 7_500_199,
      initialEmissionNumber: 7_500_110,
    });
    await apiPostJson(request, token, `/api/fiscal-stamps/${created.id}/activate`, {});
    const refreshed = await listFiscalStamps(request, token);
    const row = refreshed.find((s) => s.stampNumber === stampNumber);
    expect(row).toBeTruthy();
    expect(row!.active).toBe(true);
    expect(row!.lockedAfterInvoice).toBe(false);

    await loginAsDemo(page);
    await page.goto("/app/settings/fiscal-stamp");
    const stampRow = page.getByTestId(`fiscal-stamp-row-${created.id}`);
    await expect(stampRow).toBeVisible({ timeout: 30_000 });
    await stampRow.scrollIntoViewIfNeeded();
    await stampRow.getByRole("button", { name: /^(Edit stamp|Editar timbrado)$/ }).click();
    const dlg = page.getByRole("dialog");
    await expect(
      dlg.getByRole("heading", { name: /^(Edit stamp|Editar timbrado)$/ }),
    ).toBeVisible();
    await expect(dlg.getByLabel(/Starting invoice number|Número de inicio de emisión/)).toBeVisible();
    await expect(dlg.getByLabel(/Validity start|Inicio de vigencia/)).toHaveCount(0);
    await expect(dlg.getByLabel(/Validity end|Fin de vigencia/)).toHaveCount(0);
    await expect(dlg.getByLabel(/Stamp number|Número de timbrado/)).toHaveCount(0);
  });

  test("HU-02b · 9 timbrado bloqueado: se puede avanzar el número de inicio, pero no retrocederlo", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const todayStr = isoDateLocal(new Date());
    const until = new Date();
    until.setFullYear(until.getFullYear() + 1);
    const stampNumber = `6${Date.now().toString().slice(-7)}`;
    const created = await apiPostJson<{ id: number }>(request, token, "/api/fiscal-stamps", {
      stampNumber,
      validFrom: todayStr,
      validUntil: isoDateLocal(until),
      rangeFrom: 6_500_100,
      rangeTo: 6_500_199,
      initialEmissionNumber: 6_500_110,
    });
    await apiPostJson(request, token, `/api/fiscal-stamps/${created.id}/activate`, {});

    // Issuing one invoice against the stamp sets lockedAfterInvoice=true (InvoiceService), the
    // same state a real SIFEN dCodRes=1002 "Documento electrónico duplicado" recovery needs to
    // work from — see FiscalStampService.update().
    await ensureCashSessionOpenApi(request, token);
    const seed = await seedCategoryServiceProfessional(request, token);
    const client = await seedClient(request, token, `E2E HU02b9 ${Date.now()}`);
    await apiPostJson(request, token, "/api/invoices", {
      clientId: client.id,
      clientDisplayName: client.fullName,
      clientRucOverride: null,
      clientIdentityDocumentOverride: null,
      lines: [
        {
          serviceId: seed.serviceId,
          description: seed.serviceFullName,
          quantity: 1,
          unitPrice: 55000,
        },
      ],
      payments: [{ method: "CASH", amount: 55000 }],
    });

    const afterInvoice = await listFiscalStamps(request, token);
    const lockedRow = afterInvoice.find((s) => s.stampNumber === stampNumber);
    expect(lockedRow).toBeTruthy();
    expect(lockedRow!.lockedAfterInvoice).toBe(true);

    await loginAsDemo(page);
    await page.goto("/app/settings/fiscal-stamp");
    const stampRow = page.getByTestId(`fiscal-stamp-row-${created.id}`);
    await expect(stampRow).toBeVisible({ timeout: 30_000 });
    const editButton = stampRow.getByRole("button", { name: /^(Edit stamp|Editar timbrado)$/ });
    await expect(editButton).toBeVisible();
    await editButton.click();

    const dlg = page.getByRole("dialog");
    const startInput = dlg.getByLabel(/Starting invoice number|Número de inicio de emisión/);
    await expect(startInput).toBeVisible();

    // Backward move is rejected client-side, without a round trip to the backend.
    await startInput.fill(String(lockedRow!.nextEmissionNumber - 1));
    await dlg.getByRole("button", { name: /^(Save|Guardar)$/ }).click();
    await expect(
      dlg.getByText(
        /can only move forward, not backward|solo puede avanzar, no retroceder/,
      ),
    ).toBeVisible();
    await expect(dlg).toBeVisible();

    // Forward move (skipping the number SIFEN already rejected) is accepted.
    const advancedTo = lockedRow!.nextEmissionNumber + 5;
    await startInput.fill(String(advancedTo));
    await dlg.getByRole("button", { name: /^(Save|Guardar)$/ }).click();
    await expect(dlg).toHaveCount(0);

    const afterEdit = await listFiscalStamps(request, token);
    const editedRow = afterEdit.find((s) => s.stampNumber === stampNumber);
    expect(editedRow!.nextEmissionNumber).toBe(advancedTo);
  });

  test("HU-02b · 7 alerta de rango de numeración bajo 10%", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    await apiPutJson(request, token, "/api/business-profile", {
      businessName: "Demo salon",
      ruc: "80000005-6",
      address: null,
      phone: null,
      contactEmail: null,
      logoDataUrl: null,
    });
    const stamps = await listFiscalStamps(request, token);
    const target =
      stamps.find((s) => s.active) ?? stamps.sort((a, b) => a.id - b.id)[stamps.length - 1];
    expect(target).toBeTruthy();
    const from = new Date();
    const untilFar = new Date();
    untilFar.setDate(untilFar.getDate() + 400);
    await apiPutJson(request, token, `/api/fiscal-stamps/${target!.id}`, {
      validFrom: isoDateLocal(from),
      validUntil: isoDateLocal(untilFar),
      nextEmissionNumber: target!.rangeTo - 8,
    });

    await loginAsDemo(page);
    await page.goto("/app");
    await expect(
      page.getByText("Less than 10% of invoice numbers remain in the current range.", {
        exact: true,
      }),
    ).toBeVisible();
  });
});
