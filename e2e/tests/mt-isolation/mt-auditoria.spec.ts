import { expect, test } from "@playwright/test";

import { API_BASE, apiGetJson, apiPostJson, authHeaders } from "../../fixtures/api";
import { getMtWorld, mtLoginToken, mtPlatformToken } from "../../fixtures/mt/world";

/**
 * Issue #284 · ajuste 7 — the audit trail ("quién hizo qué") never crosses tenants:
 *  - a salon administrator reads ONLY their own salon's rows (there is no tenant parameter to tamper
 *    with: `?tenantId=` is ignored on `/api/audit`);
 *  - the root user reads every salon's and can narrow to one;
 *  - the trail records the actor of each salon, never another one's.
 */
const world = getMtWorld();

type AuditPage = {
  content: Array<{ tenantId: number | null; userEmail: string | null; resource: string; httpMethod: string }>;
};

test.describe("mt-isolation · auditoría", () => {
  test("cada salón ve solo su propia auditoría; el root ve la de todos y puede filtrar por salón", async ({
    request,
  }) => {
    const { tenantA, tenantB } = world;
    const tokenA = await mtLoginToken(request, tenantA);
    const tokenB = await mtLoginToken(request, tenantB);
    const stamp = Date.now();
    await apiPostJson(request, tokenA, "/api/clients", { fullName: `MT Audit A ${stamp}`, phone: null, email: null, ruc: null });
    await apiPostJson(request, tokenB, "/api/clients", { fullName: `MT Audit B ${stamp}`, phone: null, email: null, ruc: null });

    const auditA = await apiGetJson<AuditPage>(request, tokenA, "/api/audit?resource=clients&size=100");
    const auditB = await apiGetJson<AuditPage>(request, tokenB, "/api/audit?resource=clients&size=100");

    expect(auditA.content.length).toBeGreaterThan(0);
    expect(auditA.content.every((r) => r.tenantId === tenantA.id)).toBeTruthy();
    expect(auditA.content.every((r) => r.userEmail === tenantA.adminEmail)).toBeTruthy();
    expect(auditB.content.length).toBeGreaterThan(0);
    expect(auditB.content.every((r) => r.tenantId === tenantB.id)).toBeTruthy();
    expect(auditB.content.every((r) => r.userEmail === tenantB.adminEmail)).toBeTruthy();

    // A cannot ask for B's trail by passing B's id.
    const tamper = await apiGetJson<AuditPage>(
      request,
      tokenA,
      `/api/audit?tenantId=${tenantB.id}&size=100`,
    );
    expect(tamper.content.every((r) => r.tenantId === tenantA.id)).toBeTruthy();

    // Root: everything, or one salon.
    const rootToken = await mtPlatformToken(request);
    const all = await apiGetJson<AuditPage>(request, rootToken, "/api/platform/audit?resource=clients&size=100");
    const tenantsSeen = new Set(all.content.map((r) => r.tenantId));
    expect(tenantsSeen.has(tenantA.id)).toBeTruthy();
    expect(tenantsSeen.has(tenantB.id)).toBeTruthy();
    const onlyB = await apiGetJson<AuditPage>(
      request,
      rootToken,
      `/api/platform/audit?tenantId=${tenantB.id}&size=100`,
    );
    expect(onlyB.content.length).toBeGreaterThan(0);
    expect(onlyB.content.every((r) => r.tenantId === tenantB.id)).toBeTruthy();
  });

  test("los salones no pueden leer la auditoría de la plataforma", async ({ request }) => {
    const tokenA = await mtLoginToken(request, world.tenantA);
    const res = await request.get(`${API_BASE}/api/platform/audit`, { headers: authHeaders(tokenA) });
    expect([401, 403]).toContain(res.status());
  });
});
