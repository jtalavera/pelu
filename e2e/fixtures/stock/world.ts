import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createCategory,
  pelu,
  peluLogin,
  peluOk,
  platformToken,
  setGlobalFlag,
  setTenantFlag,
  sleep,
  stockSession,
} from "./api";

/**
 * The fixture world of the Stock cross-system suite, provisioned once by global-setup.stock.ts
 * through the real Platform Admin API (same flow as the mt world):
 *
 *  - S1 "Stock Salón Uno" and S2 "Stock Salón Dos": tier "Stock E2E" (inherits STOCK_MODULE ON),
 *    admin + an operator professional with system access (S1), RUC, active fiscal stamp, open cash
 *    session, SIFEN OFF (plain comprobantes).
 *  - S3 "Salón Sin Stock": tier "Sin Stock E2E" whose STOCK_MODULE value is OFF.
 *  - Global STOCK_MODULE is turned ON last — that is what provisions S1 and S2 in control-stock.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const STOCK_WORLD_FILE = path.resolve(__dirname, "..", "..", ".stock-world.json");

export type StockTenant = {
  id: number;
  name: string;
  adminEmail: string;
  adminPassword: string;
  /** PRODUCT category ("Productos"). */
  categoryId: number;
  /** SERVICE category ("Servicios"): plain services can't live in a product category. */
  serviceCategoryId: number;
};

export type StockWorld = {
  /** STOCK_MODULE's global value as found before the world turned it on (V69 default: OFF). */
  stockModuleInitiallyOff: boolean;
  stockTierId: number;
  noStockTierId: number;
  s1: StockTenant & { professionalEmail: string; professionalPassword: string };
  s2: StockTenant;
  s3: StockTenant;
};

export function getStockWorld(): StockWorld {
  if (!existsSync(STOCK_WORLD_FILE)) {
    throw new Error("[stock-e2e] .stock-world.json missing — run via playwright.stock.config.ts");
  }
  return JSON.parse(readFileSync(STOCK_WORLD_FILE, "utf-8")) as StockWorld;
}

const RUC = "80000005-6";

async function createTier(token: string, name: string): Promise<number> {
  return (await peluOk<{ id: number }>("/api/platform/tiers", { token, body: { name, description: null } })).id;
}

async function createTenant(
  token: string,
  name: string,
  tierId: number,
  adminEmail: string,
  adminPassword: string,
): Promise<number> {
  const tenant = await peluOk<{ id: number }>("/api/platform/tenants", {
    token,
    body: { name, domain: null, tierId },
  });
  // Plain (non-SIFEN) comprobantes: no certificate needed.
  await setTenantFlag(token, tenant.id, "SIFEN_ELECTRONIC_INVOICING", false);
  const invite = await peluOk<{ rawToken: string }>(`/api/platform/tenants/${tenant.id}/admins`, {
    token,
    body: { email: adminEmail },
  });
  await peluOk("/api/auth/activate", {
    body: {
      token: invite.rawToken,
      password: adminPassword,
      confirmPassword: adminPassword,
      fullName: `Admin ${name}`,
    },
  });
  return tenant.id;
}

function isoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** RUC + active fiscal stamp + open cash session: ready to issue comprobantes. */
export async function prepareForInvoicing(adminToken: string, businessName: string): Promise<void> {
  await peluOk("/api/business-profile", {
    method: "PUT",
    token: adminToken,
    body: { businessName, ruc: RUC, address: null, phone: null, contactEmail: null, logoDataUrl: null },
  });
  const today = new Date();
  const nextYear = new Date(today);
  nextYear.setFullYear(today.getFullYear() + 1);
  const stamp = await peluOk<{ id: number }>("/api/fiscal-stamps", {
    token: adminToken,
    body: {
      stampNumber: `9${Date.now().toString().slice(-7)}`,
      validFrom: isoDate(today),
      validUntil: isoDate(nextYear),
      rangeFrom: 1,
      rangeTo: 9_999_999,
      initialEmissionNumber: 100,
    },
  });
  await peluOk(`/api/fiscal-stamps/${stamp.id}/activate`, { token: adminToken, body: {} });
  const current = await pelu("/api/cash-sessions/current", { token: adminToken });
  if (current.status !== 200) {
    await peluOk("/api/cash-sessions/open", { token: adminToken, body: { openingCashAmount: 50_000 } });
  }
}

async function createOperator(adminToken: string, email: string, password: string): Promise<void> {
  const prof = await peluOk<{ id: number }>("/api/professionals", {
    token: adminToken,
    body: { fullName: "Operadora Stock", phone: null, email, photoDataUrl: null },
  });
  const grant = await peluOk<{ rawToken: string }>(`/api/professionals/${prof.id}/grant-access`, {
    token: adminToken,
    body: {},
  });
  await peluOk("/api/auth/activate", {
    body: { token: grant.rawToken, password, confirmPassword: password },
  });
}

async function waitStockReady(tenantId: number): Promise<void> {
  for (let i = 0; i < 90; i++) {
    try {
      await stockSession(tenantId);
      return;
    } catch {
      await sleep(1000);
    }
  }
  throw new Error(`[stock-e2e] tenant ${tenantId} never became usable in control-stock`);
}

export async function provisionStockWorld(): Promise<StockWorld> {
  if (existsSync(STOCK_WORLD_FILE)) {
    const existing = JSON.parse(readFileSync(STOCK_WORLD_FILE, "utf-8")) as StockWorld;
    const ok = await pelu("/api/auth/login", {
      body: { email: existing.s1.adminEmail, password: existing.s1.adminPassword },
    });
    if (ok.ok) {
      try {
        await stockSession(existing.s1.id);
        return existing;
      } catch {
        // Stock was restarted (fresh H2) while pelu was reused: re-provision from scratch below.
      }
    }
  }
  const token = await platformToken();
  const suffix = Date.now().toString(36);
  const stockTierId = await createTier(token, `Stock E2E ${suffix}`);
  const noStockTierId = await createTier(token, `Sin Stock E2E ${suffix}`);
  await peluOk(`/api/platform/tiers/${noStockTierId}/feature-flags/STOCK_MODULE`, {
    method: "PUT",
    token,
    body: { enabled: false },
  });

  const mk = (key: string) => ({
    adminEmail: `stock-${key}-${suffix}@e2e.local`,
    adminPassword: "StockE2e1!",
  });
  const s1c = mk("uno");
  const s2c = mk("dos");
  const s3c = mk("sin");
  const s1Id = await createTenant(token, `Stock Salón Uno ${suffix}`, stockTierId, s1c.adminEmail, s1c.adminPassword);
  const s2Id = await createTenant(token, `Stock Salón Dos ${suffix}`, stockTierId, s2c.adminEmail, s2c.adminPassword);
  const s3Id = await createTenant(token, `Salón Sin Stock ${suffix}`, noStockTierId, s3c.adminEmail, s3c.adminPassword);

  const s1Token = await peluLogin(s1c.adminEmail, s1c.adminPassword);
  const s2Token = await peluLogin(s2c.adminEmail, s2c.adminPassword);
  const s3Token = await peluLogin(s3c.adminEmail, s3c.adminPassword);
  await prepareForInvoicing(s1Token, "Stock Salón Uno");
  await prepareForInvoicing(s2Token, "Stock Salón Dos");
  await prepareForInvoicing(s3Token, "Salón Sin Stock");
  const s1Cat = await createCategory(s1Token, "Productos");
  const s2Cat = await createCategory(s2Token, "Productos");
  const s3Cat = await createCategory(s3Token, "Productos");
  const s1SvcCat = await createCategory(s1Token, "Servicios", "SERVICE");
  const s2SvcCat = await createCategory(s2Token, "Servicios", "SERVICE");
  const s3SvcCat = await createCategory(s3Token, "Servicios", "SERVICE");
  const professionalEmail = `stock-operadora-${suffix}@e2e.local`;
  const professionalPassword = "StockOper1!";
  await createOperator(s1Token, professionalEmail, professionalPassword);

  const globals = await peluOk<Array<{ flagKey: string; enabled: boolean }>>(
    "/api/admin/feature-flags",
    { token },
  );
  const stockModuleInitiallyOff = globals.find((f) => f.flagKey === "STOCK_MODULE")?.enabled === false;

  // Stock goes live: the global flag was OFF (V69 default); every tenant whose tier/tenant don't
  // restrict it now resolves ON and gets provisioned in control-stock.
  await setGlobalFlag(token, "STOCK_MODULE", true);
  await waitStockReady(s1Id);
  await waitStockReady(s2Id);

  return {
    stockModuleInitiallyOff,
    stockTierId,
    noStockTierId,
    s1: {
      id: s1Id,
      name: `Stock Salón Uno ${suffix}`,
      ...s1c,
      categoryId: s1Cat,
      serviceCategoryId: s1SvcCat,
      professionalEmail,
      professionalPassword,
    },
    s2: { id: s2Id, name: `Stock Salón Dos ${suffix}`, ...s2c, categoryId: s2Cat, serviceCategoryId: s2SvcCat },
    s3: { id: s3Id, name: `Salón Sin Stock ${suffix}`, ...s3c, categoryId: s3Cat, serviceCategoryId: s3SvcCat },
  };
}
