import { expect, test } from "@playwright/test";

import {
  expectCrossTenantForbidden,
  expectMoneyFormat,
  expectScopedList,
  expectUnchanged,
  snapshotTenant,
} from "../../fixtures/mt/probe";
import { raceAcrossTenants } from "../../fixtures/mt/concurrent";
import { getMtWorld, mtLoginToken } from "../../fixtures/mt/world";

const world = getMtWorld();

test("expectScopedList sees A's own professionals and not B's", async ({ request }) => {
  const tokenA = await mtLoginToken(request, world.tenantA);
  const rows = await expectScopedList(request, tokenA, "/api/professionals", {
    includesIds: world.tenantA.professionalIds,
    excludesIds: world.tenantB.professionalIds,
  });
  expect(rows.length).toBeGreaterThanOrEqual(world.tenantA.professionalIds.length);
});

test("expectCrossTenantForbidden: B token is rejected on an A client that really exists", async ({
  request,
}) => {
  const aClientPath = `/api/clients/${world.tenantA.clientIds[0]}`;

  // Positive control: A's own token CAN read it — the resource exists and is A's. This proves the
  // rejection below is real tenant scoping, not a route-absent 404/405 artifact.
  const tokenA = await mtLoginToken(request, world.tenantA);
  const ownRead = await request.get(`${process.env.MT_API_BASE}${aClientPath}`, {
    headers: { Authorization: `Bearer ${tokenA}` },
  });
  expect(ownRead.status(), await ownRead.text()).toBe(200);

  // Cross-tenant: B's token must be rejected (403 or scoping-404) on A's client.
  const tokenB = await mtLoginToken(request, world.tenantB);
  await expectCrossTenantForbidden(request, tokenB, aClientPath);
});

test("snapshotTenant + raceAcrossTenants run without cross-contamination", async ({ request }) => {
  const [tokenA, tokenB] = [
    await mtLoginToken(request, world.tenantA),
    await mtLoginToken(request, world.tenantB),
  ];

  const [snapA, snapB] = await raceAcrossTenants(
    () => snapshotTenant(request, tokenA),
    () => snapshotTenant(request, tokenB),
  );
  expect(snapA.status, JSON.stringify(snapA)).toBe("fulfilled");
  expect(snapB.status, JSON.stringify(snapB)).toBe("fulfilled");

  if (snapA.status === "fulfilled" && snapB.status === "fulfilled") {
    // A re-snapshot of A must deep-equal the first (nothing mutated during the race).
    expectUnchanged(snapA.value, await snapshotTenant(request, tokenA));
    // The two tenants are genuinely distinct worlds — their appointment id sets don't overlap.
    const overlap = snapA.value.appointmentIds.filter((id) =>
      snapB.value.appointmentIds.includes(id),
    );
    expect(overlap, `appointment ids leaked across tenants: ${JSON.stringify(overlap)}`).toEqual([]);
  }
});

test("expectMoneyFormat accepts 150.000 and rejects 150000.00", () => {
  expectMoneyFormat("Gs. 150.000");
  expectMoneyFormat("1.234.567");
  expectMoneyFormat("500");
  expect(() => expectMoneyFormat("150000.00")).toThrow();
  expect(() => expectMoneyFormat("150.000,50")).toThrow();
  expect(() => expectMoneyFormat("1500")).toThrow();
});
