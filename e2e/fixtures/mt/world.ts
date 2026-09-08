import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, type APIRequestContext } from "@playwright/test";

import { PLATFORM_ADMIN_EMAIL, PLATFORM_ADMIN_PASSWORD } from "../auth";

/**
 * The three-tenant fixture world every multi-tenant-isolation spec runs against.
 *
 * Provisioned once, before the mt-isolation suite, by `e2e/global-setup.mt.ts` — entirely through
 * the real Platform Admin API (`POST /api/platform/tiers`, `POST /api/platform/tenants`,
 * `POST /api/platform/tenants/{id}/admins`, `POST /api/auth/activate`, `PATCH .../status`), the same
 * flow HU-37/HU-40/HU-41/HU-47 exercise — never a backend boot seed. The dedicated mt backend runs
 * on :8081 with a fresh `e2e`-profile H2 database (see `playwright.mt-isolation.config.ts`), so the
 * first tenant created here is id=1.
 *
 * Divergence baked into the world, so isolation specs have something to tell apart:
 *  - T-A ("MT Salón Aurora") — its tier *includes* SIFEN_ELECTRONIC_INVOICING; RUC set; a full
 *    SIFEN issuer profile (address / taxpayer type / economic activity / contact / department+city,
 *    all demanded by `SifenInvoiceHeaderService.requireIssuerDataComplete`); an uploaded valid
 *    SIFEN certificate; an active fiscal stamp; 2 categories / 3 services / 2 professionals /
 *    3 clients.
 *  - T-B ("MT Barbería Boreal") — a *different* tier *without* the SIFEN flag; RUC set; NO SIFEN
 *    certificate and only the minimal (RUC-only) business profile; an active fiscal stamp (every
 *    invoice-issuing tenant needs one — `InvoiceService.issueInvoice` step 2 requires an active
 *    timbrado regardless of SIFEN); 1 category / 2 services (names deliberately copied from two of
 *    T-A's) / 2 professionals / 3 clients.
 *  - T-C ("MT Ceval Suspendido") — created active, admin activated, seeded (1 service / 1
 *    professional / 1 client), then SUSPENDED. Its admin can no longer log in.
 *  - `mt-shared@e2e.local` — invited as an admin of BOTH A and B, both activations with the same
 *    password: the `TENANT_AMBIGUOUS` fixture (login with no matching Origin resolves to >1 tenant).
 *
 * Idempotent: the mt backend is reused across local runs (`reuseExistingServer`). If T-A's admin can
 * already log in, the world exists — A's and B's ids are re-derived from the list endpoints (sorted
 * by id, i.e. creation order, so the result is byte-identical to a fresh provision), C is confirmed
 * SUSPENDED from the platform tenant listing (never reactivated), and nothing is re-created. A
 * partial/failed prior provisioning is NOT self-healing: restart the mt backend (fresh H2) and
 * delete `e2e/.mt-world.json`.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
/** `e2e/fixtures/mt/world.ts` → `e2e/`. */
const E2E_DIR = path.resolve(__dirname, "..", "..");

/** Absolute path to the JSON handle `global-setup.mt.ts` writes and `getMtWorld()` reads. */
export const MT_WORLD_FILE = path.resolve(E2E_DIR, ".mt-world.json");

const SIFEN_FLAG = "SIFEN_ELECTRONIC_INVOICING";
/** RUC value shared with HU-14's business-profile spec. */
const MT_RUC = "80000005-6";

/**
 * T-A's tier enables SIFEN e-invoicing, and `InvoiceController.issue` refuses to create ANY invoice
 * for a SIFEN tenant with no active certificate (`SifenCertificateService.requireActiveCertificate`
 * → 412 `SIFEN_NO_VALID_CERTIFICATE`, nothing persisted). So the world must give T-A a valid
 * certificate or every mt-caja / mt-ficha invoice scenario is dead on arrival. Same test .p12 +
 * password `sifen-hu-18-cargar-certificado.spec.ts` uses; `POST /api/sifen/certificates` takes JSON
 * `{ fileBase64, password }` (see `SifenCertificateUploadRequest`), not multipart. A freshly
 * uploaded VALID cert is picked up immediately by `requireActiveCertificate` — no activate step.
 */
const SIFEN_TEST_CERT_PATH = path.resolve(E2E_DIR, "fixtures", "sifen", "test-cert.p12");
const SIFEN_TEST_CERT_PASSWORD = "TestPass123!";

/** Verbatim constants — later tasks match tenants/identities by these exact values. */
const MT = {
  A: { name: "MT Salón Aurora", adminEmail: "mt-aurora-admin@e2e.local", adminPassword: "MtAurora1!" },
  B: {
    name: "MT Barbería Boreal",
    adminEmail: "mt-boreal-admin@e2e.local",
    adminPassword: "MtBoreal1!",
  },
  C: { name: "MT Ceval Suspendido", adminEmail: "mt-ceval-admin@e2e.local", adminPassword: "MtCeval1!" },
  sharedAmbiguousEmail: "mt-shared@e2e.local",
  sharedAmbiguousPassword: "MtShared1!",
} as const;

/** T-A's three service names. T-B copies the first two verbatim (the "shared-ambiguous catalog"). */
const A_SERVICE_NAMES = ["MT Corte de Dama", "MT Coloración Completa", "MT Peinado de Novia"] as const;

type TenantKey = "A" | "B" | "C";

export type MtTenant = {
  key: TenantKey;
  id: number;
  name: string;
  adminEmail: string;
  adminPassword: string;
  tierId: number;
  sifenEnabled: boolean;
  catalog: { categoryIds: number[]; serviceIds: number[]; serviceNames: string[] };
  professionalIds: number[];
  professionalPins: string[];
  clientIds: number[];
};

export type MtWorld = {
  tenantA: MtTenant;
  tenantB: MtTenant;
  tenantC: MtTenant;
  sharedAmbiguousEmail: string;
  sharedAmbiguousPassword: string;
};

// --------------------------------------------------------------------------------------------------
// Low-level HTTP against the mt backend (:8081). `global-setup` runs in a plain Node context with no
// Playwright `request` fixture, so — like `e2e/global-setup.ts` — this uses global `fetch` directly.
// Sending no `Origin` header is deliberate: `AuthService` then gathers every AppUser for the email
// across all tenants and lets the password decide (see `candidateUsersForLogin`).
// --------------------------------------------------------------------------------------------------

function mtApiBase(): string {
  return process.env.MT_API_BASE ?? "http://127.0.0.1:8081";
}

type JsonResult<T> = { ok: boolean; status: number; json: T | null; text: string };

async function apiFetch<T>(
  method: string,
  reqPath: string,
  opts: { body?: unknown; token?: string } = {},
): Promise<JsonResult<T>> {
  const hasBody = opts.body !== undefined;
  const res = await fetch(`${mtApiBase()}${reqPath}`, {
    method,
    headers: {
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    body: hasBody ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let json: T | null = null;
  try {
    json = text ? (JSON.parse(text) as T) : null;
  } catch {
    json = null;
  }
  return { ok: res.ok, status: res.status, json, text };
}

async function must<T>(
  method: string,
  reqPath: string,
  opts: { body?: unknown; token?: string } = {},
): Promise<T> {
  const r = await apiFetch<T>(method, reqPath, opts);
  if (!r.ok) {
    throw new Error(`[mt/world] ${method} ${reqPath} -> ${r.status}: ${r.text}`);
  }
  return r.json as T;
}

async function login(email: string, password: string): Promise<string | null> {
  const r = await apiFetch<{ accessToken: string }>("POST", "/api/auth/login", {
    body: { email, password },
  });
  return r.ok && r.json?.accessToken ? r.json.accessToken : null;
}

async function loginOrThrow(email: string, password: string): Promise<string> {
  const token = await login(email, password);
  if (!token) {
    throw new Error(`[mt/world] login failed for ${email} against ${mtApiBase()}`);
  }
  return token;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Platform-admin login with a bounded cold-boot retry. `webServer.url` (`/health`) goes 200 as soon
 * as the web context is up — but `PlatformAdminBootstrap` (a `CommandLineRunner`, gated on
 * `femme.data-init` / zero existing PLATFORM_ADMIN rows) may not have created this user yet, so the
 * first login can 401. A connection error (backend process still starting) is likewise transient.
 * Retry either until a token comes back; a persistent failure throws a message that names the real
 * suspect. Scoped to provisioning only — tenant admins are created by `fullProvision`, so
 * `mtLoginToken` (used by specs) has no equivalent race and gets no retry.
 */
async function loginPlatformAdminWithRetry(
  attempts = 12,
  delayMs = 1000,
): Promise<string> {
  let lastReason = "no attempt made";
  for (let i = 1; i <= attempts; i++) {
    try {
      const r = await apiFetch<{ accessToken: string }>("POST", "/api/auth/login", {
        body: { email: PLATFORM_ADMIN_EMAIL, password: PLATFORM_ADMIN_PASSWORD },
      });
      if (r.ok && r.json?.accessToken) {
        return r.json.accessToken;
      }
      lastReason = `HTTP ${r.status}: ${r.text.slice(0, 200)}`;
    } catch (err) {
      lastReason = `connection error: ${String(err)}`;
    }
    if (i < attempts) {
      await sleep(delayMs);
    }
  }
  throw new Error(
    `[mt/world] platform admin (${PLATFORM_ADMIN_EMAIL}) not usable after ${attempts} attempts ` +
      `(~${Math.round((attempts * delayMs) / 1000)}s) against ${mtApiBase()} — last: ${lastReason}. ` +
      `Is the mt backend up and is PlatformAdminBootstrap / femme.data-init running (application-e2e.properties)?`,
  );
}

/**
 * The idempotent re-derive probe: "does T-A's admin already log in?" A clean 401 means the world
 * isn't provisioned yet (→ full provision, no retry). A connection error means the backend isn't
 * accepting requests yet — retry that briefly. (In practice `loginPlatformAdminWithRetry` has
 * already confirmed the backend is up before this runs, so this is just belt-and-suspenders.)
 */
async function probeExistingTenantA(attempts = 5, delayMs = 1000): Promise<string | null> {
  for (let i = 1; i <= attempts; i++) {
    try {
      return await login(MT.A.adminEmail, MT.A.adminPassword);
    } catch (err) {
      if (i === attempts) {
        throw err;
      }
      await sleep(delayMs);
    }
  }
  return null;
}

// --------------------------------------------------------------------------------------------------
// Deterministic derived values — so the idempotent re-derive path reconstructs the exact same world.
// --------------------------------------------------------------------------------------------------

/** 4-digit PIN, unique within a tenant: `<41|42|43><01-based index>` (e.g. A's 2nd prof → "4102"). */
function mtPinFor(key: TenantKey, index: number): string {
  const prefix = { A: "41", B: "42", C: "43" }[key];
  return `${prefix}${String(index + 1).padStart(2, "0")}`;
}

function isoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// --------------------------------------------------------------------------------------------------
// Platform Admin API building blocks.
// --------------------------------------------------------------------------------------------------

async function createTier(platformToken: string, name: string): Promise<number> {
  const tier = await must<{ id: number; name: string }>("POST", "/api/platform/tiers", {
    body: { name, description: null },
    token: platformToken,
  });
  return tier.id;
}

async function setTierFlagIncluded(
  platformToken: string,
  tierId: number,
  flagKey: string,
  included: boolean,
): Promise<void> {
  await must("PUT", `/api/platform/tiers/${tierId}/feature-flags/${flagKey}`, {
    body: { included },
    token: platformToken,
  });
}

async function createTenant(platformToken: string, name: string, tierId: number): Promise<number> {
  const tenant = await must<{ id: number; name: string }>("POST", "/api/platform/tenants", {
    body: { name, domain: null, tierId },
    token: platformToken,
  });
  return tenant.id;
}

async function inviteAndActivateAdmin(
  platformToken: string,
  tenantId: number,
  email: string,
  password: string,
): Promise<void> {
  const invite = await must<{ rawToken: string }>(
    "POST",
    `/api/platform/tenants/${tenantId}/admins`,
    { body: { email }, token: platformToken },
  );
  await must("POST", "/api/auth/activate", {
    body: { token: invite.rawToken, password, confirmPassword: password },
  });
}

async function setTenantStatus(
  platformToken: string,
  tenantId: number,
  status: "ACTIVE" | "SUSPENDED",
): Promise<void> {
  await must("PATCH", `/api/platform/tenants/${tenantId}/status`, {
    body: { status },
    token: platformToken,
  });
}

async function deriveSifenEnabled(platformToken: string, tenantId: number): Promise<boolean> {
  const rows = await must<Array<{ flagKey: string; effectiveEnabled: boolean }>>(
    "GET",
    `/api/admin/feature-flags/tenants/${tenantId}`,
    { token: platformToken },
  );
  return rows.find((r) => r.flagKey === SIFEN_FLAG)?.effectiveEnabled ?? false;
}

// --------------------------------------------------------------------------------------------------
// Tenant-scoped seeding (uses the tenant admin's own token).
// --------------------------------------------------------------------------------------------------

/**
 * `sifenIssuer: true` (T-A only) fills the whole SIFEN issuer fieldset that
 * `SifenInvoiceHeaderService.requireIssuerDataComplete` demands before `POST /api/invoices` will
 * create anything for a SIFEN-enabled tenant (address, taxpayer type, economic activity, contact
 * phone/email, department + city). Same values `sifen-hu-22-activacion-por-tenant.spec.ts` uses.
 * Without this, T-A's every invoice attempt 412s (`SIFEN_ISSUER_ADDRESS_MISSING` and friends) and
 * the mt-caja / mt-ficha suites cannot run at all. T-B/T-C stay on the minimal profile (RUC only) —
 * SIFEN is off for them, so the extra fields would be inert anyway.
 */
async function putBusinessProfile(
  token: string,
  businessName: string,
  opts: { sifenIssuer?: boolean } = {},
): Promise<void> {
  const sifen = opts.sifenIssuer
    ? {
        address: "Avda. Mcal. Lopez 1234",
        phone: "0981123456",
        contactEmail: "mt-aurora-sifen@e2e.local",
        taxpayerType: "INDIVIDUAL",
        economicActivityCode: "96020",
        economicActivityDescription: "Peluqueria y otros tratamientos de belleza",
        sifenDepartmentCode: "12",
        sifenDepartmentName: "CENTRAL",
        sifenCityCode: "5044",
        sifenCityName: "FERNANDO DE LA MORA",
      }
    : { address: null, phone: null, contactEmail: null };
  await must("PUT", "/api/business-profile", {
    body: { businessName, ruc: MT_RUC, logoDataUrl: null, ...sifen },
    token,
  });
}

async function createCategory(token: string, name: string): Promise<number> {
  const cat = await must<{ id: number }>("POST", "/api/service-categories", {
    body: { name, accentKey: "stone" },
    token,
  });
  return cat.id;
}

async function createService(token: string, name: string, categoryId: number): Promise<number> {
  const svc = await must<{ id: number }>("POST", "/api/services", {
    body: { name, categoryId, priceMinor: 50000, durationMinutes: 60 },
    token,
  });
  return svc.id;
}

async function createProfessional(token: string, fullName: string, pin: string): Promise<number> {
  const prof = await must<{ id: number }>("POST", "/api/professionals", {
    body: { fullName, phone: null, email: null, photoDataUrl: null, pin },
    token,
  });
  return prof.id;
}

async function createClient(token: string, fullName: string): Promise<number> {
  const client = await must<{ id: number }>("POST", "/api/clients", {
    body: { fullName, phone: null, email: null, ruc: null },
    token,
  });
  return client.id;
}

async function ensureActiveFiscalStamp(token: string): Promise<void> {
  const today = new Date();
  const nextYear = new Date(today);
  nextYear.setFullYear(nextYear.getFullYear() + 1);
  const created = await must<{ id: number }>("POST", "/api/fiscal-stamps", {
    body: {
      stampNumber: `7${Date.now().toString().slice(-7)}`,
      validFrom: isoDate(today),
      validUntil: isoDate(nextYear),
      rangeFrom: 1,
      rangeTo: 9_999_999,
      initialEmissionNumber: 100,
    },
    token,
  });
  await must("POST", `/api/fiscal-stamps/${created.id}/activate`, { body: {}, token });
}

/**
 * Idempotent: uploads the test SIFEN certificate for T-A only if the tenant has none yet. Called on
 * BOTH provisioning paths (fresh + re-derive) — on a reused mt backend the cert already exists, so
 * `GET /api/sifen/certificates` returns a non-empty list and this is a no-op.
 */
async function ensureSifenCertificate(token: string): Promise<void> {
  const existing = await must<Array<{ id: number }>>("GET", "/api/sifen/certificates", { token });
  if (existing.length > 0) {
    return;
  }
  const fileBase64 = readFileSync(SIFEN_TEST_CERT_PATH).toString("base64");
  await must("POST", "/api/sifen/certificates", {
    body: { fileBase64, password: SIFEN_TEST_CERT_PASSWORD },
    token,
  });
}

const byIdAsc = <T extends { id: number }>(rows: T[]): T[] =>
  [...rows].sort((a, b) => a.id - b.id);

async function deriveCatalog(
  token: string,
  key: TenantKey,
): Promise<Pick<MtTenant, "catalog" | "professionalIds" | "professionalPins" | "clientIds">> {
  const [cats, svcs, profs, clients] = await Promise.all([
    must<Array<{ id: number; name: string }>>("GET", "/api/service-categories", { token }),
    must<Array<{ id: number; name: string }>>("GET", "/api/services", { token }),
    must<Array<{ id: number }>>("GET", "/api/professionals", { token }),
    must<Array<{ id: number }>>("GET", "/api/clients", { token }),
  ]);
  // The list endpoints sort by NAME (professionals by fullName; services category-grouped, then
  // name), not creation order — so re-sort by the H2 identity id (creation-ordered) before any
  // positional mapping, otherwise the re-derived world diverges from the fresh one and, worse,
  // `professionalPins` gets paired to the wrong professional.
  const sortedProfs = byIdAsc(profs);
  return {
    catalog: {
      categoryIds: byIdAsc(cats).map((c) => c.id),
      serviceIds: byIdAsc(svcs).map((s) => s.id),
      serviceNames: byIdAsc(svcs).map((s) => s.name),
    },
    professionalIds: sortedProfs.map((p) => p.id),
    // PINs aren't returned by any list endpoint; reconstruct them from the fixed per-tenant scheme.
    professionalPins: sortedProfs.map((_, i) => mtPinFor(key, i)),
    clientIds: byIdAsc(clients).map((c) => c.id),
  };
}

/**
 * T-C as recorded in the world: id + admin creds + tier, with EMPTY catalog/professional/client
 * arrays. C is suspended, so the re-derive path can't read its tenant-scoped data without
 * reactivating it (forbidden); no scenario needs C's specific ids anyway. Both provisioning paths
 * use this so the fresh and re-derived `MtWorld` blobs are byte-identical.
 */
function emptyCatalogTenantC(id: number, tierId: number): MtTenant {
  return {
    key: "C",
    id,
    name: MT.C.name,
    adminEmail: MT.C.adminEmail,
    adminPassword: MT.C.adminPassword,
    tierId,
    sifenEnabled: false,
    catalog: { categoryIds: [], serviceIds: [], serviceNames: [] },
    professionalIds: [],
    professionalPins: [],
    clientIds: [],
  };
}

// --------------------------------------------------------------------------------------------------
// Provisioning.
// --------------------------------------------------------------------------------------------------

async function fullProvision(platformToken: string): Promise<MtWorld> {
  // Two dedicated tiers so A and B genuinely diverge on the SIFEN feature flag.
  const tierAId = await createTier(platformToken, "MT Tier Aurora");
  const tierBId = await createTier(platformToken, "MT Tier Boreal");
  await setTierFlagIncluded(platformToken, tierAId, SIFEN_FLAG, true);

  const tenantAId = await createTenant(platformToken, MT.A.name, tierAId);
  const tenantBId = await createTenant(platformToken, MT.B.name, tierBId);
  // C goes on the SIFEN-less Boreal tier (no scenario depends on C's tier) so its recorded
  // sifenEnabled=false stays consistent with its tier resolution.
  const tenantCId = await createTenant(platformToken, MT.C.name, tierBId);

  await inviteAndActivateAdmin(platformToken, tenantAId, MT.A.adminEmail, MT.A.adminPassword);
  await inviteAndActivateAdmin(platformToken, tenantBId, MT.B.adminEmail, MT.B.adminPassword);
  await inviteAndActivateAdmin(platformToken, tenantCId, MT.C.adminEmail, MT.C.adminPassword);

  // The TENANT_AMBIGUOUS identity: same email + same password on both A and B.
  await inviteAndActivateAdmin(
    platformToken,
    tenantAId,
    MT.sharedAmbiguousEmail,
    MT.sharedAmbiguousPassword,
  );
  await inviteAndActivateAdmin(
    platformToken,
    tenantBId,
    MT.sharedAmbiguousEmail,
    MT.sharedAmbiguousPassword,
  );

  const tokenA = await loginOrThrow(MT.A.adminEmail, MT.A.adminPassword);
  const tokenB = await loginOrThrow(MT.B.adminEmail, MT.B.adminPassword);
  const tokenC = await loginOrThrow(MT.C.adminEmail, MT.C.adminPassword);

  // --- T-A: RUC + stamp + 2 categories / 3 services / 2 professionals / 3 clients ---
  await putBusinessProfile(tokenA, MT.A.name, { sifenIssuer: true });
  const aCat1 = await createCategory(tokenA, "MT Cat Aurora Cabello");
  const aCat2 = await createCategory(tokenA, "MT Cat Aurora Color");
  const aSvc1 = await createService(tokenA, A_SERVICE_NAMES[0], aCat1);
  const aSvc2 = await createService(tokenA, A_SERVICE_NAMES[1], aCat2);
  const aSvc3 = await createService(tokenA, A_SERVICE_NAMES[2], aCat1);
  const aProf1 = await createProfessional(tokenA, "MT Prof Aurora Uno", mtPinFor("A", 0));
  const aProf2 = await createProfessional(tokenA, "MT Prof Aurora Dos", mtPinFor("A", 1));
  const aClients = [];
  for (let i = 1; i <= 3; i++) aClients.push(await createClient(tokenA, `MT Cliente Aurora ${i}`));
  await ensureActiveFiscalStamp(tokenA);
  await ensureSifenCertificate(tokenA);

  // --- T-B: RUC, minimal (non-SIFEN) profile, 1 category / 2 services (names copied from A) /
  //     2 professionals / 3 clients, + an active fiscal stamp (traditional numbering still needs
  //     one — see InvoiceService.issueInvoice step 2), but NO SIFEN certificate. ---
  await putBusinessProfile(tokenB, MT.B.name);
  const bCat = await createCategory(tokenB, "MT Cat Boreal");
  const bSvc1 = await createService(tokenB, A_SERVICE_NAMES[0], bCat);
  const bSvc2 = await createService(tokenB, A_SERVICE_NAMES[1], bCat);
  const bProf1 = await createProfessional(tokenB, "MT Prof Boreal Uno", mtPinFor("B", 0));
  const bProf2 = await createProfessional(tokenB, "MT Prof Boreal Dos", mtPinFor("B", 1));
  const bClients = [];
  for (let i = 1; i <= 3; i++) bClients.push(await createClient(tokenB, `MT Cliente Boreal ${i}`));
  await ensureActiveFiscalStamp(tokenB);

  // --- T-C: minimal seed (backend state only — not recorded in the world), THEN suspend ---
  const cCat = await createCategory(tokenC, "MT Cat Ceval");
  await createService(tokenC, "MT Servicio Ceval", cCat);
  await createProfessional(tokenC, "MT Prof Ceval Uno", mtPinFor("C", 0));
  await createClient(tokenC, "MT Cliente Ceval 1");
  await setTenantStatus(platformToken, tenantCId, "SUSPENDED");

  const [sifenA, sifenB] = await Promise.all([
    deriveSifenEnabled(platformToken, tenantAId),
    deriveSifenEnabled(platformToken, tenantBId),
  ]);

  return {
    tenantA: {
      key: "A",
      id: tenantAId,
      name: MT.A.name,
      adminEmail: MT.A.adminEmail,
      adminPassword: MT.A.adminPassword,
      tierId: tierAId,
      sifenEnabled: sifenA,
      catalog: {
        categoryIds: [aCat1, aCat2],
        serviceIds: [aSvc1, aSvc2, aSvc3],
        serviceNames: [...A_SERVICE_NAMES],
      },
      professionalIds: [aProf1, aProf2],
      professionalPins: [mtPinFor("A", 0), mtPinFor("A", 1)],
      clientIds: aClients,
    },
    tenantB: {
      key: "B",
      id: tenantBId,
      name: MT.B.name,
      adminEmail: MT.B.adminEmail,
      adminPassword: MT.B.adminPassword,
      tierId: tierBId,
      sifenEnabled: sifenB,
      catalog: {
        categoryIds: [bCat],
        serviceIds: [bSvc1, bSvc2],
        serviceNames: [A_SERVICE_NAMES[0], A_SERVICE_NAMES[1]],
      },
      professionalIds: [bProf1, bProf2],
      professionalPins: [mtPinFor("B", 0), mtPinFor("B", 1)],
      clientIds: bClients,
    },
    // C's tenant-scoped ids are intentionally NOT recorded: no scenario needs them, and keeping
    // them empty makes the fresh and re-derived worlds byte-identical (the re-derive path can't
    // read a suspended tenant's catalog without reactivating it, which it must never do).
    tenantC: emptyCatalogTenantC(tenantCId, tierBId),
    sharedAmbiguousEmail: MT.sharedAmbiguousEmail,
    sharedAmbiguousPassword: MT.sharedAmbiguousPassword,
  };
}

async function rederiveWorld(platformToken: string, tokenA: string): Promise<MtWorld> {
  const page = await must<{
    content: Array<{ id: number; name: string; tierId: number | null; status: string }>;
  }>("GET", "/api/platform/tenants?page=0&size=200", { token: platformToken });

  const findRow = (name: string) => {
    const row = page.content.find((t) => t.name === name);
    if (!row) {
      throw new Error(
        `[mt/world] idempotent re-derive: tenant "${name}" not found — restart the mt backend and delete ${MT_WORLD_FILE}`,
      );
    }
    return row;
  };

  const rowA = findRow(MT.A.name);
  const rowB = findRow(MT.B.name);
  const rowC = findRow(MT.C.name);

  // C must never be reactivated — an interrupt between a reactivate/suspend pair would strand it
  // ACTIVE and break the "C is suspended" invariant for every later spec. Confirm its status from
  // the platform listing instead, and don't re-derive its (unused) tenant-scoped catalog at all.
  if (rowC.status !== "SUSPENDED") {
    throw new Error(
      `[mt/world] idempotent re-derive: tenant "${MT.C.name}" is ${rowC.status}, expected SUSPENDED — restart the mt backend and delete ${MT_WORLD_FILE}`,
    );
  }

  const tokenB = await loginOrThrow(MT.B.adminEmail, MT.B.adminPassword);

  // T-A's tier enables SIFEN — it must carry a valid certificate to emit any invoice. A partial
  // prior provisioning could have skipped this; re-assert it here (no-op when already present).
  await ensureSifenCertificate(tokenA);

  const [aDerived, bDerived, sifenA, sifenB] = await Promise.all([
    deriveCatalog(tokenA, "A"),
    deriveCatalog(tokenB, "B"),
    deriveSifenEnabled(platformToken, rowA.id),
    deriveSifenEnabled(platformToken, rowB.id),
  ]);

  return {
    tenantA: {
      key: "A",
      id: rowA.id,
      name: MT.A.name,
      adminEmail: MT.A.adminEmail,
      adminPassword: MT.A.adminPassword,
      tierId: rowA.tierId ?? 0,
      sifenEnabled: sifenA,
      ...aDerived,
    },
    tenantB: {
      key: "B",
      id: rowB.id,
      name: MT.B.name,
      adminEmail: MT.B.adminEmail,
      adminPassword: MT.B.adminPassword,
      tierId: rowB.tierId ?? 0,
      sifenEnabled: sifenB,
      ...bDerived,
    },
    tenantC: emptyCatalogTenantC(rowC.id, rowC.tierId ?? 0),
    sharedAmbiguousEmail: MT.sharedAmbiguousEmail,
    sharedAmbiguousPassword: MT.sharedAmbiguousPassword,
  };
}

function writeWorld(world: MtWorld): void {
  writeFileSync(MT_WORLD_FILE, JSON.stringify(world, null, 2), "utf-8");
}

/**
 * Provision (or, if the mt backend is already seeded, re-derive) the three-tenant world.
 * Idempotent — safe to call on every `global-setup.mt` run.
 */
export async function provisionMtWorld(): Promise<MtWorld> {
  // Confirm the backend is up AND the platform admin is bootstrapped before anything else — this
  // absorbs the cold-boot window where /health is 200 but PlatformAdminBootstrap hasn't run.
  const platformToken = await loginPlatformAdminWithRetry();
  const existingA = await probeExistingTenantA();

  const world = existingA
    ? await rederiveWorld(platformToken, existingA)
    : await fullProvision(platformToken);

  writeWorld(world);
  return world;
}

/** Synchronous handle read for specs. Throws if `global-setup.mt.ts` hasn't run. */
export function getMtWorld(): MtWorld {
  try {
    return JSON.parse(readFileSync(MT_WORLD_FILE, "utf-8")) as MtWorld;
  } catch (err) {
    throw new Error(
      `[mt/world] ${MT_WORLD_FILE} is missing or unreadable — global-setup.mt.ts must run first (${String(
        err,
      )})`,
    );
  }
}

/** Log in as a tenant admin against the mt backend, returning the raw access token. */
export async function mtLoginToken(request: APIRequestContext, t: MtTenant): Promise<string> {
  const res = await request.post(`${mtApiBase()}/api/auth/login`, {
    data: { email: t.adminEmail, password: t.adminPassword },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  const json = (await res.json()) as { accessToken: string };
  return json.accessToken;
}

/** Log in as the tenant-independent Platform Admin against the mt backend. */
export async function mtPlatformToken(request: APIRequestContext): Promise<string> {
  const res = await request.post(`${mtApiBase()}/api/auth/login`, {
    data: { email: PLATFORM_ADMIN_EMAIL, password: PLATFORM_ADMIN_PASSWORD },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  const json = (await res.json()) as { accessToken: string };
  return json.accessToken;
}
