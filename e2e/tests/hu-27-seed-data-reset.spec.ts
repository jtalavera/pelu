import { expect, test } from "@playwright/test";
import { API_BASE, loginAsDemoApi } from "../fixtures/api";

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

  test("HU-27 · AC3 admin@demo.com / Demo123! login works after reset", async ({ request }) => {
    const res = await request.post(`${API_BASE}/api/admin/seed/reset`);
    expect(res.ok()).toBeTruthy();

    const loginRes = await request.post(`${API_BASE}/api/auth/login`, {
      data: { email: "admin@demo.com", password: "Demo123!" },
    });
    expect(loginRes.ok(), await loginRes.text()).toBeTruthy();
    const json = (await loginRes.json()) as { accessToken: string };
    expect(json.accessToken).toBeTruthy();
  });

  test("HU-27 · AC3 service catalog is restored after reset", async ({ request }) => {
    await request.post(`${API_BASE}/api/admin/seed/reset`);

    const token = await loginAsDemoApi(request);
    const categoriesRes = await request.get(`${API_BASE}/api/service-categories`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(categoriesRes.ok()).toBeTruthy();
    const categories = (await categoriesRes.json()) as unknown[];
    expect(categories.length).toBeGreaterThan(0);

    const servicesRes = await request.get(`${API_BASE}/api/services`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(servicesRes.ok()).toBeTruthy();
    const services = (await servicesRes.json()) as unknown[];
    expect(services.length).toBeGreaterThan(0);

    const professionalsRes = await request.get(`${API_BASE}/api/professionals`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(professionalsRes.ok()).toBeTruthy();
    const professionals = (await professionalsRes.json()) as unknown[];
    expect(professionals.length).toBeGreaterThan(0);
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
