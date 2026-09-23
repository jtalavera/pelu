import { expect, test } from "@playwright/test";
import { API_BASE, loginAsDemoApi } from "../fixtures/api";
import { DEMO_EMAIL, DEMO_PASSWORD } from "../fixtures/auth";

test.describe("HU-27 · Seed data reset", () => {
  test.describe.configure({ mode: "serial" });

  test("HU-27 · AC1/AC5 POST /api/admin/seed/reset returns 200 with expected body", async ({
    request,
  }) => {
    const res = await request.post(`${API_BASE}/api/admin/seed/reset`);

    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.message).toBe("Seed data reset successfully");
  });

  test("HU-27 · AC1 no authentication required", async ({ request }) => {
    const res = await request.post(`${API_BASE}/api/admin/seed/reset`);
    expect(res.status()).not.toBe(401);
    expect(res.status()).not.toBe(403);
  });

  test("HU-27 · AC3 seeded admin login works after reset", async ({ request }) => {
    const res = await request.post(`${API_BASE}/api/admin/seed/reset`);
    expect(res.ok()).toBeTruthy();

    const loginRes = await request.post(`${API_BASE}/api/auth/login`, {
      data: { email: DEMO_EMAIL, password: DEMO_PASSWORD },
    });
    expect(loginRes.ok(), await loginRes.text()).toBeTruthy();
    const json = (await loginRes.json()) as { accessToken: string };
    expect(json.accessToken).toBeTruthy();
  });

  // HU-58 removed the CSV-based catalog/client reconciliation that used to back this endpoint
  // (`DemoTenantCatalogSeedService`) — it hardcoded a specific tenant's business data, which the
  // PRD's "Sin seed hardcodeado" forbids. A reset now only restores login capability (the admin
  // user) and leaves the catalog empty, the same way HU-56 already left professionals empty; a
  // test that needs a catalog seeds it itself (e.g. seedCategoryServiceProfessional, or the real
  // Excel-import flow).
  test("HU-27 · AC3 catalog stays empty after reset (no hardcoded catalog reseeded)", async ({
    request,
  }) => {
    await request.post(`${API_BASE}/api/admin/seed/reset`);

    const token = await loginAsDemoApi(request);
    const categoriesRes = await request.get(`${API_BASE}/api/service-categories`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(categoriesRes.ok()).toBeTruthy();
    const categories = (await categoriesRes.json()) as unknown[];
    expect(categories.length).toBe(0);

    const servicesRes = await request.get(`${API_BASE}/api/services`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(servicesRes.ok()).toBeTruthy();
    const services = (await servicesRes.json()) as unknown[];
    expect(services.length).toBe(0);

    // HU-56 removed the fixed professional roster (`FemmeSalonCatalogBootstrapData.PROFESSIONALS`)
    // that a seed reset used to auto-create — professionals are no longer part of this seed.
    const professionalsRes = await request.get(`${API_BASE}/api/professionals`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(professionalsRes.ok()).toBeTruthy();
    const professionals = (await professionalsRes.json()) as unknown[];
    expect(professionals.length).toBe(0);
  });

  test("HU-27 · AC4 endpoint is idempotent — two consecutive calls both succeed", async ({
    request,
  }) => {
    const res1 = await request.post(`${API_BASE}/api/admin/seed/reset`);
    expect(res1.status()).toBe(200);
    expect((await res1.json()).status).toBe("ok");

    const res2 = await request.post(`${API_BASE}/api/admin/seed/reset`);
    expect(res2.status()).toBe(200);
    expect((await res2.json()).status).toBe("ok");
  });

  test("HU-27 · AC4 demo login works after second reset", async ({ request }) => {
    await request.post(`${API_BASE}/api/admin/seed/reset`);
    await request.post(`${API_BASE}/api/admin/seed/reset`);

    const token = await loginAsDemoApi(request);
    expect(token).toBeTruthy();
  });

  test("HU-27 · AC2 data created after first reset is wiped by second reset", async ({
    request,
  }) => {
    await request.post(`${API_BASE}/api/admin/seed/reset`);
    const token1 = await loginAsDemoApi(request);

    const createClientRes = await request.post(`${API_BASE}/api/clients`, {
      headers: { Authorization: `Bearer ${token1}`, "Content-Type": "application/json" },
      data: { fullName: `HU27 Test Client ${Date.now()}`, phone: null, email: null, ruc: null },
    });
    expect(createClientRes.ok(), await createClientRes.text()).toBeTruthy();

    await request.post(`${API_BASE}/api/admin/seed/reset`);
    const token2 = await loginAsDemoApi(request);

    const clientsRes = await request.get(`${API_BASE}/api/clients?q=HU27+Test+Client`, {
      headers: { Authorization: `Bearer ${token2}` },
    });
    expect(clientsRes.ok()).toBeTruthy();
    const clients = (await clientsRes.json()) as unknown[];
    expect(clients.length).toBe(0);
  });
});
