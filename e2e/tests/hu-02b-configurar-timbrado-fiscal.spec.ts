import { expect, test } from "@playwright/test";
import {
  API_BASE,
  apiPostJson,
  apiPutJson,
  isoDateLocal,
  listFiscalStamps,
  loginAsDemoApi,
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
    await expect(page.getByText("Inactive", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Valid", { exact: true }).first()).toBeVisible();
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
