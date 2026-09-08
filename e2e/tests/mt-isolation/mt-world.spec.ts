import { expect, test } from "@playwright/test";
import { decodeJwtPayload } from "../../fixtures/api";
import { getMtWorld, mtLoginToken } from "../../fixtures/mt/world";

test.describe("mt world provisioning", () => {
  const world = getMtWorld();

  test("three tenants exist with distinct ids and divergent SIFEN config", () => {
    const ids = [world.tenantA.id, world.tenantB.id, world.tenantC.id];
    expect(new Set(ids).size).toBe(3);
    expect(world.tenantA.sifenEnabled).toBe(true);
    expect(world.tenantB.sifenEnabled).toBe(false);
  });

  test("A and B admins log in and their JWT tid matches their own tenant", async ({ request }) => {
    for (const t of [world.tenantA, world.tenantB]) {
      const token = await mtLoginToken(request, t);
      const payload = decodeJwtPayload(token);
      expect(Number(payload.tid)).toBe(t.id);
    }
  });

  test("C is suspended: its admin cannot log in", async ({ request }) => {
    const res = await request.post(`${process.env.MT_API_BASE}/api/auth/login`, {
      data: { email: world.tenantC.adminEmail, password: world.tenantC.adminPassword },
    });
    expect(res.status()).toBe(401);
  });

  test("B has at least two service names deliberately shared with A", () => {
    const shared = world.tenantB.catalog.serviceNames.filter((n) =>
      world.tenantA.catalog.serviceNames.includes(n),
    );
    expect(shared.length).toBeGreaterThanOrEqual(2);
  });
});
